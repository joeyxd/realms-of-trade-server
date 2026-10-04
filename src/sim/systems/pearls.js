// Server-owned pearl circulation. The in-memory ledger remembers a UID's current owner/location, so an
// old signed browser save cannot reclaim a pearl after a death, sale or transfer in this server session.
// This is deliberately not durable across restarts; M5 moves these claims into the database.
import { PEARLS, PEARL_IDS, PEARL, newPearls } from '../../data/pearls.js';
import { DT, tuning } from '../../data/tuning.js';
import { refreshStats } from './stats.js';
import { canStand } from './movement.js';

export function installPearls(world, namespace = `solo-${world.seed}`) {
  world.pearlLedger = new Map();
  world.pearlNamespace = namespace; world.nextPearl = 1; world.nextPirate = 1;
}
const profile = (w, e) => w.profiles?.get(e);
const owned = (p) => p.pearls || (p.pearls = newPearls());
const mark = (w, e) => w.profileDirty.add(e);
const deny = (w, e, why) => { w.emit({ type: 'pearlDenied', to: e, e, why }); return false; };
function calm(w, e) {
  const s = w.ecs;
  // Nearby active foes also count as combat, including while the pirate has avoided every blow.
  if (!s.alive[e] || s.dead[e] > 0 || s.regenT[e] < PEARL.calm || s.castK[e] > 0 || s.atkStage[e] > 0 || s.dashT[e] >= 0) return false;
  for (let o = 1; o < s.cap; o++) {
    const b = s.brain[o];
    if (s.alive[o] && b?.target === e && !['idle', 'dormant', 'return'].includes(b.state) &&
        Math.hypot(s.x[o] - s.x[e], s.z[o] - s.z[e]) < 18) return false;
  }
  return true;
}
function claim(w, e, pearl) {
  const p = profile(w, e), at = w.pearlLedger.get(pearl.uid);
  if (at && (at.owner !== p.pirateId || at.place !== 'profile' || (at.entity && at.entity !== e))) return false;
  w.pearlLedger.set(pearl.uid, { owner: p.pirateId, entity: e, place: 'profile' });
  return true;
}
export function attachPearls(w, e, p) {
  if (!w.pearlLedger) installPearls(w);
  if (!p.pirateId) p.pirateId = `${w.pearlNamespace}:p${w.nextPirate++}`;
  const ps = owned(p), lost = [];
  if (ps.swallowed && !claim(w, e, ps.swallowed)) { lost.push(ps.swallowed.uid); ps.swallowed = null; }
  ps.bag = ps.bag.filter((q) => { if (claim(w, e, q)) return true; lost.push(q.uid); return false; });
  if (lost.length) w.emit({ type: 'pearlDenied', to: e, e, why: 'stale', n: lost.length });
}
export function detachPearls(w, e) {
  for (const at of w.pearlLedger.values()) if (at.entity === e) at.entity = 0;
}
export function makePearl(w, kind = PEARL_IDS[0]) {
  if (!Object.hasOwn(PEARLS, kind)) return null;
  let uid;
  do { uid = `${w.pearlNamespace}:${w.nextPearl++}`; } while (w.pearlLedger.has(uid));
  return { uid, kind };
}
export function givePearl(w, e, kind = PEARL_IDS[0]) {
  const p = profile(w, e);
  if (!p || owned(p).bag.length >= PEARL.bag) return null;
  const pearl = makePearl(w, kind);
  if (!pearl) return null;
  owned(p).bag.push(pearl); claim(w, e, pearl); mark(w, e);
  w.emit({ type: 'pickup', to: e, e, id: 0, kind: 'pearl', pearl });
  return pearl;
}
export function dropPearl(w, pearl, x, z, from = 0, scatter = false) {
  const fx = x, fz = z;
  if (scatter && from) {
    for (let k = 0; k < 12; k++) {
      const a = w.ecs.facing[from] + k * Math.PI / 6;
      const tx = fx + Math.sin(a) * 2.3, tz = fz + Math.cos(a) * 2.3;
      if (canStand(w, tx, tz, 0.2)) { x = tx; z = tz; break; }
    }
  }
  // If a death happened in water, retain a reachable drop near the last checkpoint.
  if (!canStand(w, x, z, 0.2)) {
    const s = w.ecs, cp = w.map.landmarks.spawn;
    x = from ? s.cpX[from] : cp.x; z = from ? s.cpZ[from] : cp.z;
  }
  const d = { id: w.nextDrop++, to: 0, kind: 'pearl', pearl, x, z,
    t: w.tick + Math.round(PEARL.returnAfter / DT), pickAt: w.tick + 30,
    ...(from ? { from, fromName: w.ecs.names[from] } : {}) };
  w.drops.set(d.id, d);
  w.pearlLedger.set(pearl.uid, { owner: '', entity: 0, place: 'ground', drop: d.id });
  w.emit({ type: 'loot', pub: 1, fx, fz, drops: [pearlDropView(d)] });
  return d;
}
export const pearlDropView = (d) => ({ id: d.id, kind: 'pearl', pearl: d.pearl, x: d.x, z: d.z, pub: 1, ...(d.fromName ? { from: d.fromName } : {}) });
export function pickPearl(w, d, e) {
  const p = profile(w, e), at = w.pearlLedger.get(d.pearl.uid);
  if (!p || w.tick < d.pickAt || at?.place !== 'ground' || at.drop !== d.id) return false;
  if (owned(p).bag.length >= PEARL.bag) {
    const told = d.full || (d.full = new Set());
    if (!told.has(e)) { told.add(e); deny(w, e, 'full'); }
    return false;
  }
  owned(p).bag.push(d.pearl);
  w.pearlLedger.set(d.pearl.uid, { owner: p.pirateId, entity: e, place: 'profile' });
  w.drops.delete(d.id); mark(w, e);
  w.emit({ type: 'pickup', to: e, e, id: d.id, kind: 'pearl', pearl: d.pearl, x: d.x, z: d.z, pub: 1, back: d.from === e ? 1 : 0 });
  w.emit({ type: 'unloot', pub: 1, ids: [d.id], why: 'pick', by: e });
  return true;
}
export function returnPearl(w, d) {
  // Deterministic coastal search. Only accept standable beach points, never the dock or deep water.
  const map = w.map, spawn = map.landmarks.spawn;
  let x = spawn.x, z = spawn.z;
  const rng = w.lootRng, half = map.half - 3;
  for (let i = 0; i < 256; i++) {
    const tx = rng.range(-half, half), tz = rng.range(-half, half), h = map.groundAt(tx, tz);
    if (h < tuning.world.waterLevel + 0.15 || h > tuning.world.waterLevel + 1.1 || map.onDock(tx, tz) || !canStand(w, tx, tz, 0.2)) continue;
    x = tx; z = tz; break;
  }
  w.drops.delete(d.id);
  w.emit({ type: 'unloot', pub: 1, ids: [d.id], why: 'expire' });
  const fresh = dropPearl(w, d.pearl, x, z);
  w.emit({ type: 'pearlReturn', uid: d.pearl.uid, x: fresh.x, z: fresh.z, zone: map.zoneAt?.(fresh.x, fresh.z)?.name || 'la playa' });
  return fresh;
}
function changed(w, e, op, pearl) {
  const s = w.ecs;
  s.gBuf[e] = 0; s.cdG[e] = Math.max(s.cdG[e], PEARL.swapCd); s.waterT[e] = 0;
  refreshStats(w, e); mark(w, e);
  w.emit({ type: 'pearlChanged', to: e, e, op, pearl });
}
export function swallowPearl(w, e, uid, replaceUid) {
  const p = profile(w, e);
  if (!p) return false;
  if (!calm(w, e)) return deny(w, e, 'combat');
  const ps = owned(p), i = ps.bag.findIndex((q) => q.uid === uid);
  if (i < 0) return deny(w, e, 'unknown');
  // The confirmation names the currently swallowed UID; an out-of-date UI cannot eject a different pearl.
  if (ps.swallowed && replaceUid !== ps.swallowed.uid) return deny(w, e, 'confirm');
  const pearl = ps.bag.splice(i, 1)[0], old = ps.swallowed;
  ps.swallowed = pearl;
  if (old) dropPearl(w, old, w.ecs.x[e], w.ecs.z[e], e, true);
  changed(w, e, 'swallow', pearl); return true;
}
export function spitPearl(w, e) {
  const p = profile(w, e);
  if (!p || !owned(p).swallowed) return false;
  if (!calm(w, e)) return deny(w, e, 'combat');
  const pearl = p.pearls.swallowed; p.pearls.swallowed = null;
  dropPearl(w, pearl, w.ecs.x[e], w.ecs.z[e], e, true);
  changed(w, e, 'spit', pearl); return true;
}
export function leavePearl(w, e, uid) {
  const p = profile(w, e);
  if (!p) return false;
  if (!calm(w, e)) return deny(w, e, 'combat');
  const i = owned(p).bag.findIndex((q) => q.uid === uid);
  if (i < 0) return deny(w, e, 'unknown');
  const pearl = p.pearls.bag.splice(i, 1)[0];
  dropPearl(w, pearl, w.ecs.x[e], w.ecs.z[e], e, true); mark(w, e);
  w.emit({ type: 'pearlChanged', to: e, e, op: 'leave', pearl }); return true;
}
export function transferPearl(w, e, uid, target) {
  const p = profile(w, e), q = profile(w, target), s = w.ecs;
  if (!p || !q || e === target) return deny(w, e, 'unknown');
  if (!calm(w, e) || !calm(w, target)) return deny(w, e, 'combat');
  if (Math.hypot(s.x[e] - s.x[target], s.z[e] - s.z[target]) > PEARL.transferR) return deny(w, e, 'far');
  if (owned(q).bag.length >= PEARL.bag) return deny(w, e, 'full');
  const i = owned(p).bag.findIndex((a) => a.uid === uid);
  if (i < 0) return deny(w, e, 'unknown');
  const pearl = p.pearls.bag.splice(i, 1)[0]; q.pearls.bag.push(pearl);
  w.pearlLedger.set(uid, { owner: q.pirateId, entity: target, place: 'profile' });
  mark(w, e); mark(w, target);
  w.emit({ type: 'pearlChanged', to: e, e, op: 'give', pearl });
  w.emit({ type: 'pickup', to: target, e: target, id: 0, kind: 'pearl', pearl }); return true;
}
export function sellPearl(w, e, uid) {
  const p = profile(w, e), s = w.ecs;
  if (!p) return false;
  if (!calm(w, e)) return deny(w, e, 'combat');
  const vendor = w.map.npcs.find((n) => n.id === 'vendor');
  if (!vendor || Math.hypot(s.x[e] - vendor.x, s.z[e] - vendor.z) > 4) return deny(w, e, 'vendor');
  const i = owned(p).bag.findIndex((q) => q.uid === uid);
  if (i < 0) return deny(w, e, 'unknown');
  const pearl = p.pearls.bag.splice(i, 1)[0];
  // The vendor releases it into the sea, rather than deleting a circulating UID.
  const d = dropPearl(w, pearl, s.x[e], s.z[e]); returnPearl(w, d);
  p.gold += PEARL.value; mark(w, e);
  w.emit({ type: 'pearlChanged', to: e, e, op: 'sell', pearl, gold: PEARL.value }); return true;
}
export function spillPearls(w, e) {
  const p = profile(w, e);
  if (!p) return 0;
  const ps = owned(p), all = [...ps.bag, ...(ps.swallowed ? [ps.swallowed] : [])];
  if (!all.length) return 0;
  p.pearls = newPearls();
  for (const pearl of all) dropPearl(w, pearl, w.ecs.x[e], w.ecs.z[e], e);
  changed(w, e, 'death', null);
  return all.length;
}
export function rollPearl(w, chance, tier = 1) {
  return w.lootRng() < Math.min(1, chance * (1 + PEARL.tideBonus * Math.max(0, tier - 1))) ? makePearl(w, PEARL_IDS[w.lootRng.int(0, PEARL_IDS.length - 1)]) : null;
}
