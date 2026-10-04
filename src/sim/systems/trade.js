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
import { sanitizeRaft } from '../economy/raft.js';

// p.eco: id (stable owner key for plots and ships; '' until first needed), pack (what you carry on foot), ships
// ([{ n: name, hull, mods: [ids], hold, at: town | '' at sea, hp }], or a raft you build: { kind: 'raft', n, grid
// (sim/economy/raft.js), hold, at, hp, look }; M6), deeds ([[town, plot index]]; M8).
export const newEco = () => ({ id: '', pack: newHold(PACK_CAP), ships: [], deeds: [] });
export function sanitizeEco(raw) {
  const o = newEco();
  if (!raw || typeof raw !== 'object') return o;
  if (typeof raw.id === 'string' && /^[a-z0-9]{1,24}$/.test(raw.id)) o.id = raw.id;
  o.pack = sanitizeHold(raw.pack, PACK_CAP);
  if (Array.isArray(raw.ships)) {
    o.ships = raw.ships.slice(0, 8).filter((s) => s && (HULLS[s.hull] || s.kind === 'raft')).map((s) => {
      if (s.kind === 'raft') return { kind: 'raft', n: String(s.n || 'La Balsa').slice(0, 24), grid: sanitizeRaft(s.grid), hold: sanitizeHold(s.hold, 1e6), at: TOWNS[s.at] ? s.at : '', hp: Math.max(0, Math.min(1, +s.hp || 1)), look: s.look && typeof s.look === 'object' ? { banner: String(s.look.banner || '').slice(0, 16), paint: s.look.paint | 0 } : null };
      const mods = (Array.isArray(s.mods) ? s.mods : []).filter((m) => MODULES[m]).slice(0, 32);
      return { n: String(s.n || HULLS[s.hull].name).slice(0, 24), hull: s.hull, mods, hold: sanitizeHold(s.hold, 1e6), at: TOWNS[s.at] ? s.at : '', hp: Math.max(0, Math.min(1, +s.hp || 1)) };
    });
  }
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
