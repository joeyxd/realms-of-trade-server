// Connected, moored rafts work on the economy's simulation clock. Profile preflight precedes every change.
import { CLOCK } from '../../data/clock.js';
import { stepRaftProduction, productionRows } from '../economy/raftProduction.js';

const MAX_REV = 2147483647;

export function stepRaftWork(w, days, saveFits = () => true) {
  if (!(Number.isFinite(days) && days > 0)) return;
  for (const active of w.rafts.values()) {
    const { ship, owner } = active, profile = w.profiles.get(owner);
    if (!profile || !w.ecs.alive[owner] || ship.at !== 'aldea' || !(ship.hp > 0)
        || !profile.eco.ships.includes(ship)) continue;
    const previousBlock = active.productionBlocked || '';
    let blocked = '', result = { made: {}, used: {}, changed: false };
    if (ship.rev >= MAX_REV || profile.eco.tradeRev >= MAX_REV) blocked = 'revisionLimit';
    else {
      const grid = { ...ship.grid, work: { ...ship.grid.work } };
      const hold = { cap: ship.hold.cap, goods: { ...ship.hold.goods } };
      result = stepRaftProduction(grid, hold, days);
      if (result.changed) {
        const settled = Object.keys(result.made).length > 0;
        const nextShip = { ...ship, grid, hold, rev: ship.rev + (settled ? 1 : 0) };
        const eco = { ...profile.eco, tradeRev: profile.eco.tradeRev + (settled ? 1 : 0),
          ships: profile.eco.ships.map((s) => s === ship ? nextShip : s) };
        let fits = false;
        try { fits = saveFits(owner, { ...profile, eco }) === true; } catch { /* Keep the entire tick unchanged. */ }
        if (!fits) { blocked = 'saveSize'; result = { made: {}, used: {}, changed: false }; }
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
        rev: profile.eco.tradeRev, production: productionRows(ship.grid, ship.hold, { blocked }),
        productionBlocked: blocked, daySec: CLOCK.daySec, made: result.made, used: result.used });
    }
  }
}
