// Trading on the server (M7, PLAN-M7.md): the world's economy (sim/economy/economy.js), a player's trade state in
// their profile (p.eco), and the market command. You trade in the town you stand in (walkable towns: within its
// radius of its landmark); ports you sail to (M6) will put you "in" theirs on arrival.
//
// Command  {type: 'market', op: 'list' | 'buy' | 'sell', town, g (good id), n}
// Events   private {type: 'market', to, town, hour, rows: [{g, stock, buy, sell, trend, illegal}], pack, cap}
//          private {type: 'traded', to, e, town, g, n, side, total, gold, pack}
//          private {type: 'tradeDenied', to, why: 'town' | 'far' | 'combat' | 'good' | 'n' | 'law' | 'stock' | 'gold' |
//                   'room' | 'have'}
import { TOWNS, TOWN_IDS } from '../../data/towns.js';
import { Economy } from '../economy/economy.js';
import { board } from '../economy/market.js';
import { newHold, sanitizeHold, holdUsed, PACK_CAP } from '../economy/cargo.js';
import { HULLS, MODULES } from '../../data/ships.js';
import { newRaft, raftStats, sanitizeRaft } from '../economy/raft.js';

// p.eco: id (stable owner key for plots and ships; '' until first needed), pack (what you carry on foot), ships
// (vessels or rafts), raftV (one-time starter migration), deeds ([[town, plot index]]; M8).
const starterRaft = () => {
  const grid = newRaft();
  return { kind: 'raft', id: '', rev: 1, berth: -1, berthBasis: null, n: 'La Balsa', grid, hold: newHold(raftStats(grid).hold), at: 'aldea', hp: 1, look: null };
};
export const newEco = () => ({ id: '', pack: newHold(PACK_CAP), ships: [starterRaft()], raftV: 1, deeds: [] });
export function sanitizeEco(raw) {
  const o = newEco();
  if (!raw || typeof raw !== 'object') return o;
  const legacyRaftState = raw.raftV !== 1;
  o.ships = [];
  if (typeof raw.id === 'string' && /^[a-z0-9]{1,24}$/.test(raw.id)) o.id = raw.id;
  o.pack = sanitizeHold(raw.pack, PACK_CAP);
  if (Array.isArray(raw.ships)) {
    const raftIds = new Set();
    o.ships = raw.ships.slice(0, 8).filter((s) => s && (HULLS[s.hull] || s.kind === 'raft')).map((s) => {
      if (s.kind === 'raft') {
        const candidateId = typeof s.id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(s.id) ? s.id : '';
        const id = candidateId && !raftIds.has(candidateId) ? candidateId : '';
        if (id) raftIds.add(id);
        const hp = Number.isFinite(s.hp) ? s.hp : 1;
        const rev = Number.isInteger(s.rev) ? Math.max(1, Math.min(2147483647, s.rev)) : 1;
        const berth = Number.isInteger(s.berth) ? Math.max(-1, Math.min(63, s.berth)) : -1;
        // Keep the mooring's original grid origin while a builder expands the blueprint.
        // These bounded grid coordinates derive a server berth; saved world positions stay ignored.
        const b = s.berthBasis;
        const berthBasis = Array.isArray(b) && b.length === 4 && b.every((n) => Number.isInteger(n) && Math.abs(n) <= 600)
          && b[1] >= b[0] && b[1] - b[0] < 12 && b[3] >= b[2] && b[3] - b[2] < 12 ? [...b] : null;
        const grid = sanitizeRaft(s.grid);
        const hold = sanitizeHold(s.hold, 1e6);
        hold.cap = raftStats(grid).hold;
        return { kind: 'raft', id, rev, berth, berthBasis, n: String(s.n || 'La Balsa').slice(0, 24), grid, hold, at: TOWNS[s.at] ? s.at : '', hp: Math.max(0, Math.min(1, hp)), look: s.look && typeof s.look === 'object' ? { banner: String(s.look.banner || '').slice(0, 16), paint: s.look.paint | 0 } : null };
      }
      const mods = (Array.isArray(s.mods) ? s.mods : []).filter((m) => MODULES[m]).slice(0, 32);
      return { n: String(s.n || HULLS[s.hull].name).slice(0, 24), hull: s.hull, mods, hold: sanitizeHold(s.hold, 1e6), at: TOWNS[s.at] ? s.at : '', hp: Math.max(0, Math.min(1, +s.hp || 1)) };
    });
  }
  o.raftV = 1;
  if (legacyRaftState && o.ships.length < 8 && !o.ships.some((s) => s.kind === 'raft')) o.ships.push(starterRaft());
  if (Array.isArray(raw.deeds)) o.deeds = raw.deeds.filter((d) => Array.isArray(d) && TOWNS[d[0]] && Number.isInteger(d[1]) && d[1] >= 0 && d[1] < TOWNS[d[0]].plots).slice(0, 16);
  return o;
}

// Server: the economy on the world (one per world, shared by all players), with upkeep paid from owners' profiles.
export function installTrade(world) {
  world.economy = new Economy(world.seed);
  world.economy.payUpkeep = (owner, gold) => {
    for (const p of world.profiles.values()) {
      if (p.eco && p.eco.id === owner) { if (p.gold < gold) return false; p.gold -= gold; return true; }
    }
    return false; // owner offline: the debt piles up (M5 charges it from the database)
  };
}

// The walkable town e stands in, or ''.
export function townAt(world, e) {
  const ecs = world.ecs, x = ecs.x[e], z = ecs.z[e], map = world.map;
  for (const id of TOWN_IDS) {
    const T = TOWNS[id];
    if (!T.walkable) continue;
    const at = (map.landmarks && map.landmarks[T.landmark]) || map[T.landmark];
    if (at && Math.hypot(x - at.x, z - at.z) <= T.r) return id;
  }
  return '';
}

export const TRADE = { calm: 3 }; // s without damage before you can trade

const deny = (world, e, why) => { world.emit({ type: 'tradeDenied', to: e, why }); return false; };

export function marketCmd(world, e, msg) {
  const p = world.profiles && world.profiles.get(e), eco = world.economy;
  if (!p || !eco) return false;
  if (!p.eco) p.eco = newEco();
  const town = String(msg.town || '');
  if (!TOWNS[town]) return deny(world, e, 'town');
  if (townAt(world, e) !== town) return deny(world, e, 'far');
  const op = String(msg.op || 'list');
  if (op === 'list') {
    world.emit({ type: 'market', to: e, town, hour: +eco.hourOfDay.toFixed(2), day: eco.day, rows: board(eco.markets[town], TOWNS[town]), pack: { ...p.eco.pack.goods }, cap: p.eco.pack.cap, used: holdUsed(p.eco.pack) });
    return true;
  }
  if (op !== 'buy' && op !== 'sell') return deny(world, e, 'n');
  const ecs = world.ecs;
  if (ecs.dead[e] > 0 || ecs.regenT[e] < TRADE.calm) return deny(world, e, 'combat'); // no shopping mid-fight
  const wallet = { gold: p.gold, hold: p.eco.pack };
  const r = eco.trade(town, String(msg.g || ''), msg.n | 0, op, wallet);
  if (!r.ok) return deny(world, e, r.why);
  p.gold = wallet.gold;
  if (world.profileDirty) world.profileDirty.add(e);
  world.emit({ type: 'traded', to: e, e, town, g: String(msg.g), n: r.n, side: op, total: r.total, gold: p.gold, pack: { ...p.eco.pack.goods } });
  return true;
}
