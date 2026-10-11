// RNV07a pure profile transition helpers. World/source/range/damage ownership
// checks belong to the authoritative host before this module is called.
import { FRESHWATER, readVessels, validProfileVessels, vesselsMass, vesselsVolume } from '../../data/freshwater.js';
import { GOODS } from '../../data/goods.js';
import { RAFT, RAFT_LOAD, RAFT_PARTS } from '../../data/raftparts.js';

export { readVessels, vesselsMass, vesselsVolume, validProfileVessels };

const OPS = new Set(['craftBucket', 'fill', 'deposit', 'withdraw', 'decant']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const readStoredVessels = (holder) => {
  if (!holder || typeof holder !== 'object') return [];
  const d = Object.getOwnPropertyDescriptor(holder, 'vessels');
  if (!d) { if ('vessels' in holder) throw new TypeError('Invalid freshwater vessels'); return []; }
  if (!own(d, 'value')) throw new TypeError('Invalid freshwater vessels');
  return readVessels(d.value);
};
function commandValues(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) return null;
  const keys = Reflect.ownKeys(raw), descriptors = Object.getOwnPropertyDescriptors(raw);
  if (keys.some((k) => typeof k !== 'string' || !own(descriptors[k], 'value'))) return null;
  return { keys, descriptors };
}

export function checkedFreshwaterCommand(raw) {
  let safe;
  try { safe = commandValues(raw); } catch { return null; }
  if (!safe) return null;
  const fields = ['type', 'op', 'opId', 'expectedRev', 'source', 'ship', 'part', 'n'];
  if (safe.keys.length !== fields.length || safe.keys.some((k) => !fields.includes(k)) || fields.some((k) => !own(safe.descriptors, k))) return null;
  const c = Object.fromEntries(fields.map((k) => [k, safe.descriptors[k].value]));
  if (c.type !== 'freshwater' || !OPS.has(c.op) || typeof c.opId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(c.opId) ||
      !Number.isSafeInteger(c.expectedRev) || c.expectedRev < 0 || c.expectedRev > FRESHWATER.maxRevision ||
      typeof c.source !== 'string' || c.source.length > 100 || typeof c.ship !== 'string' || c.ship.length > 120 ||
      typeof c.part !== 'string' || c.part.length > 100 || !Number.isSafeInteger(c.n)) return null;
  if (c.op === 'craftBucket') return c.source === '' && c.ship === '' && c.part === '' && c.n === 0 ? c : null;
  if (c.op === 'fill') return c.source === FRESHWATER.sourceId && c.ship === '' && c.part === '' && c.n >= 1 && c.n <= FRESHWATER.bucketCapacity ? c : null;
  if (c.op === 'decant') return c.source === '' && c.ship === '' && c.part === '' && c.n >= 1 && c.n <= FRESHWATER.bucketCapacity ? c : null;
  return c.source === '' && /^[A-Za-z0-9:_-]{1,120}$/.test(c.ship) && /^p[0-9]{1,10}$/.test(c.part) && c.n >= 1 && c.n <= FRESHWATER.barrelCapacity ? c : null;
}

export function freshwaterProfileDelta(profile, command) {
  const cmd = checkedFreshwaterCommand(command);
  if (!cmd) return { profile: null, why: 'command' };
  if (!profile || typeof profile !== 'object' || !profile.eco || typeof profile.eco !== 'object') return { profile: null, why: 'owner' };
  if (!profile.eco.pack || typeof profile.eco.pack !== 'object' || !Array.isArray(profile.eco.ships)) return { profile: null, why: 'owner' };
  if (!validProfileVessels(profile)) return { profile: null, why: 'command' };
  const eco = profile.eco, rev = Number.isSafeInteger(eco.tradeRev) ? eco.tradeRev : 0;
  if (cmd.expectedRev !== rev) return { profile: null, why: 'revision' };
  if (rev >= FRESHWATER.maxRevision) return { profile: null, why: 'revisionLimit' };
  let packV, ships;
  try {
    packV = readStoredVessels(eco.pack);
    ships = Array.isArray(eco.ships) ? eco.ships : [];
    // Validate each hold before cloning so malformed contents cannot be normalized away.
    for (const s of ships) readStoredVessels(s?.hold);
  } catch { return { profile: null, why: 'command' }; }

  const out = structuredClone(profile);
  out.eco.pack.vessels = packV;
  out.eco.ships = ships.map((_, i) => {
    const copy = out.eco.ships[i];
    if (copy?.hold && own(copy.hold, 'vessels')) copy.hold.vessels = readStoredVessels(copy.hold);
    return copy;
  });
  const pack = out.eco.pack;
  const bucket = () => pack.vessels.find((v) => v.kind === 'bucket');
  const packFits = () => {
    const used = Object.entries(pack.goods).reduce((n, [g, k]) => n + (GOODS[g]?.volume ?? GOODS[g]?.w ?? 1) * k, 0) + vesselsVolume(pack);
    const mass = Object.entries(pack.goods).reduce((n, [g, k]) => n + (GOODS[g]?.mass ?? GOODS[g]?.w ?? 1) * k, 0) + vesselsMass(pack);
    return used <= pack.cap && (!Number.isFinite(pack.maxMass) || mass <= pack.maxMass);
  };
  const fail = (why) => ({ profile: null, why });
  if (cmd.op === 'craftBucket') {
    if (bucket()) return fail('full');
    if ((pack.goods.madera || 0) < 2) return fail('goods');
    pack.goods.madera -= 2; if (!pack.goods.madera) delete pack.goods.madera;
    pack.vessels.push({ id: 'bucket', kind: 'bucket', water: 0 });
    if (!packFits()) return fail('room');
  } else if (cmd.op === 'fill') {
    const b = bucket(); if (!b) return fail('empty');
    if (b.water + cmd.n > FRESHWATER.bucketCapacity) return fail('full');
    b.water += cmd.n;
    if (!packFits()) return fail('room');
  } else if (cmd.op === 'decant') {
    const b = bucket(); if (!b || b.water < cmd.n) return fail('empty');
    pack.goods.agua = (pack.goods.agua || 0) + cmd.n; b.water -= cmd.n;
    if (!b.water) b.water = 0;
    if (!packFits()) return fail('room');
  } else {
    const shipIndex = ships.findIndex((s) => s?.id === cmd.ship && s.kind === 'raft');
    if (shipIndex < 0) return fail('owner');
    const ship = out.eco.ships[shipIndex];
    if (!ship?.hold || typeof ship.hold !== 'object') return fail('owner');
    if (!Array.isArray(ship.hold.vessels)) ship.hold.vessels = [];
    const gridPart = ship.grid?.parts?.find((p) => Array.isArray(p) && p[0] === 'waterBarrel' && ship.condition?.entries?.some((r) => Array.isArray(r) && r[0] === cmd.part && r[1] === 'waterBarrel' && p.slice(1, 5).every((n, i) => n === r[i + 2])));
    const row = ship.condition?.entries?.find((r) => Array.isArray(r) && r[0] === cmd.part && r[1] === 'waterBarrel');
    if (!gridPart || !row) return fail('owner');
    if (!(row[6] > 0)) return fail('condition');
    let barrel = ship.hold.vessels.find((v) => v.kind === 'barrel' && v.id === cmd.part);
    if (cmd.op === 'deposit') {
      const b = bucket(); if (!b || b.water < cmd.n) return fail('empty');
      if (barrel && barrel.water + cmd.n > FRESHWATER.barrelCapacity) return fail('full');
      if (!barrel) {
        if (ship.hold.vessels.length >= FRESHWATER.maxVessels) return fail('full');
        barrel = { id: cmd.part, kind: 'barrel', water: 0 }; ship.hold.vessels.push(barrel);
      }
      barrel.water += cmd.n; b.water -= cmd.n;
      if (!b.water) b.water = 0;
      if (!packFits()) return fail('room');
      if (raftWouldWorsen(ship, ships[shipIndex], eco.pack)) return fail('room');
    } else {
      if (!barrel || barrel.water < cmd.n) return fail('empty');
      const b = bucket(); if (!b) return fail('empty');
      if (b.water + cmd.n > FRESHWATER.bucketCapacity) return fail('full');
      barrel.water -= cmd.n; b.water += cmd.n;
      if (!packFits()) return fail('room');
      if (raftWouldWorsen(ship, ships[shipIndex], eco.pack)) return fail('room');
    }
  }
  out.eco.tradeRev = rev + 1;
  if (cmd.op === 'deposit' || cmd.op === 'withdraw') {
    const ship = out.eco.ships.find((s) => s?.id === cmd.ship);
    if (!Number.isSafeInteger(ship.rev) || ship.rev >= 2147483647) return fail('revisionLimit');
    ship.rev++;
  }
  return { profile: out, why: '' };

  function raftWouldWorsen(ship, beforeShip, beforePack) {
    // The raft cargo contract may be further checked by the host; this prevents
    // our added barrel water from increasing an already-overloaded hold.
    const cap = ship.hold?.cap;
    const goodsVolume = Object.entries(ship.hold?.goods || {}).reduce((n, [g, k]) => n + (GOODS[g]?.volume ?? GOODS[g]?.w ?? 1) * k, 0);
    const holdOverVolume = Number.isFinite(cap) ? Math.max(0, goodsVolume + vesselsVolume(ship.hold) - cap) : 0;
    const beforeHoldVolume = Object.entries(beforeShip.hold?.goods || {}).reduce((n, [g, k]) => n + (GOODS[g]?.volume ?? GOODS[g]?.w ?? 1) * k, 0) + vesselsVolume(beforeShip.hold);
    const beforeHoldOverVolume = Number.isFinite(beforeShip.hold?.cap) ? Math.max(0, beforeHoldVolume - beforeShip.hold.cap) : 0;
    if (holdOverVolume > beforeHoldOverVolume + 1e-8) return true;
    const packVolume = Object.entries(pack.goods).reduce((n, [g, k]) => n + (GOODS[g]?.volume ?? GOODS[g]?.w ?? 1) * k, 0) + vesselsVolume(pack);
    const packOverVolume = Number.isFinite(pack.cap) ? Math.max(0, packVolume - pack.cap) : 0;
    const beforePackVolume = Object.entries(beforePack.goods || {}).reduce((n, [g, k]) => n + (GOODS[g]?.volume ?? GOODS[g]?.w ?? 1) * k, 0) + vesselsVolume(beforePack);
    const beforePackOverVolume = Number.isFinite(beforePack.cap) ? Math.max(0, beforePackVolume - beforePack.cap) : 0;
    if (packOverVolume > beforePackOverVolume + 1e-8) return true;
    const parts = ship.condition?.entries ? ship.condition.entries.filter((r) => Array.isArray(r) && r[6] > 0).map((r) => r.slice(1, 6)) : (ship.grid?.parts || []);
    let dry = 0, buoyancy = 0, structural = 0;
    for (const [id] of parts) { const part = RAFT_PARTS[id]; if (part) { dry += part.weight; buoyancy += (part.floats || 0) * RAFT.buoyancy; structural += part.structuralCapacity || 0; } }
    const goodsMass = (h) => Object.entries(h?.goods || {}).reduce((n, [g, k]) => n + (GOODS[g]?.mass ?? GOODS[g]?.w ?? 1) * k, 0);
    const cargo = goodsMass(ship.hold) + vesselsMass(ship.hold) + goodsMass(pack) + vesselsMass(pack);
    const cargoLimit = Math.min(structural, buoyancy * RAFT_LOAD.safeFraction) - dry - RAFT_LOAD.crewMass;
    const beforeParts = beforeShip.condition?.entries ? beforeShip.condition.entries.filter((r) => Array.isArray(r) && r[6] > 0).map((r) => r.slice(1, 6)) : (beforeShip.grid?.parts || []);
    let beforeDry = 0, beforeBuoyancy = 0, beforeStructural = 0;
    for (const [id] of beforeParts) { const part = RAFT_PARTS[id]; if (part) { beforeDry += part.weight; beforeBuoyancy += (part.floats || 0) * RAFT.buoyancy; beforeStructural += part.structuralCapacity || 0; } }
    const beforeCargo = goodsMass(beforeShip.hold) + vesselsMass(beforeShip.hold) + goodsMass(beforePack) + vesselsMass(beforePack);
    const beforeLimit = Math.min(beforeStructural, beforeBuoyancy * RAFT_LOAD.safeFraction) - beforeDry - RAFT_LOAD.crewMass;
    const beforeOverMass = Math.max(0, beforeCargo - Math.max(0, beforeLimit));
    const afterOverMass = Math.max(0, cargo - Math.max(0, cargoLimit));
    return afterOverMass > beforeOverMass + 1e-8;
  }
}
