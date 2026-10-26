// Connected, moored rafts work on the economy's simulation clock. Profile preflight precedes every change.
import { CLOCK } from '../../data/clock.js';
import { stepRaftProduction, productionRows, productionKey, sanitizeProduction } from '../economy/raftProduction.js';
import { holdLoadIncreases } from '../economy/raftCapacity.js';
import { poweredFireKeys } from './fire.js';
import { activeRaftParts } from '../naval/condition.js';

const MAX_REV = 2147483647;

// Describe the same conditions used by the mounted tick, including dormant damaged modules.
export function raftWorkStatus(w, active) {
  const blocked = w.navalPilot?.locked?.(active.owner) ? 'voyage'
    : active.productionBlocked === 'voyage' ? '' : active.productionBlocked || '';
  return {
    production: productionRows(active.ship.grid, active.ship.hold, { blocked,
      poweredKeys: poweredFireKeys(w, active),
      activeKeys: new Set(activeRaftParts(active).map(productionKey).filter(Boolean)) }),
    productionBlocked: blocked, daySec: CLOCK.daySec,
  };
}

export function stepRaftWork(w, days, saveFits = () => true) {
  if (!(Number.isFinite(days) && days > 0)) return;
  for (const active of w.rafts.values()) {
    const { ship, owner } = active, profile = w.profiles.get(owner);
    if (!profile || !w.ecs.alive[owner] || ship.at !== 'aldea' || !(ship.hp > 0)
        || !profile.eco.ships.includes(ship)) continue;
    const previousBlock = active.productionBlocked || '';
    let blocked = '', result = { made: {}, used: {}, changed: false };
    if (w.navalPilot?.locked?.(owner)) blocked = 'voyage';
    else if (ship.rev >= MAX_REV || profile.eco.tradeRev >= MAX_REV) blocked = 'revisionLimit';
    else {
      const grid = { ...ship.grid, work: { ...ship.grid.work } };
      const hold = { cap: ship.hold.cap, goods: { ...ship.hold.goods } };
      const parts = activeRaftParts(active), workingGrid = { parts, work: sanitizeProduction(parts, grid.work) };
      result = stepRaftProduction(workingGrid, hold, days, { poweredKeys: poweredFireKeys(w, active) });
      // Preserve dormant work on destroyed modules; no elapsed time is banked while absent.
      grid.work = { ...grid.work, ...workingGrid.work };
      for (const row of productionRows(workingGrid, hold))
        if (!Object.hasOwn(workingGrid.work, row.key)) delete grid.work[row.key];
      if (result.changed) {
        const settled = Object.keys(result.made).length > 0;
        const nextShip = { ...ship, grid, hold, rev: ship.rev + (settled ? 1 : 0) };
        const eco = { ...profile.eco, tradeRev: profile.eco.tradeRev + (settled ? 1 : 0),
          ships: profile.eco.ships.map((s) => s === ship ? nextShip : s) };
        let fits = false;
        try { fits = saveFits(owner, { ...profile, eco }) === true; } catch { /* Keep the entire tick unchanged. */ }
        if (holdLoadIncreases(parts, ship.hold, hold)) { blocked = 'capacity'; result = { made: {}, used: {}, changed: false }; }
        else if (!fits) { blocked = 'saveSize'; result = { made: {}, used: {}, changed: false }; }
        else {
          ship.grid = grid; ship.hold = hold; ship.rev = nextShip.rev;
          profile.eco.tradeRev = eco.tradeRev;
          w.profileDirty.add(owner);
        }
      }
    }
    active.productionBlocked = blocked;
    if (previousBlock !== blocked || Object.keys(result.made).length) {
      w.emit({ type: 'raftProduction', to: owner, id: ship.id, raftRev: ship.rev,
        rev: profile.eco.tradeRev, ...raftWorkStatus(w, active), made: result.made, used: result.used });
    }
  }
}
