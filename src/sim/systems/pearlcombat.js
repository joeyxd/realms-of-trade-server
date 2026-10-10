// Brasa's shared water curse and server-owned burns. Movement, cooldowns and bullet clearing of G
// live in skills.js, where the client replays exactly the same command ticks as the server.
import { PEARL } from '../../data/pearls.js';
import { ENEMIES, ENEMY_KINDS } from '../../data/enemies.js';
import { DT, tuning } from '../../data/tuning.js';
import { C } from '../ecs.js';
import { historyAt } from './enemies.js';
import { hurtPlayer } from './combat.js';

// A successful Storm hit on an NPC jumps once to the nearest other hittable NPC, without chaining again.
export function lightningOnHit(w, target, raw, opts, sourcePos) {
  const s = w.ecs, by = opts.by;
  if (!(s.mask[target] & C.ENEMY) || !(by > 0) || !s.alive[by]) return;
  const back = (opts.pt ?? w.tick) - tuning.combat.interpTicks, from = w.tmpLightningFrom || (w.tmpLightningFrom = {});
  const to = w.tmpLightningTo || (w.tmpLightningTo = {});
  if (sourcePos) { from.x = sourcePos.x; from.z = sourcePos.z; }
  else historyAt(w, target, back, from);
  let best = 0, bestD = Infinity, bx = 0, bz = 0;
  for (let e = 1; e < s.cap; e++) {
    if (e === target || !(s.mask[e] & C.ENEMY) || !w.canHit(by, e)) continue;
    historyAt(w, e, back, to);
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    if (d > PEARL.lightningRange) continue;
    if (d < bestD || (d === bestD && (!best || e < best))) { best = e; bestD = d; bx = to.x; bz = to.z; }
  }
  if (!best) return;
  const seq = opts.seq || 0;
  w.strike(best, raw * PEARL.lightningMult, {
    by, kind: 'chain', skill: 'lightning', seq, x: from.x, z: from.z,
    noCrit: true, noElement: true, elem: 3, pt: opts.pt,
  });
  w.emit({ type: 'lightning', id: w.nextLightning++, e: by, seq, points: [{ id: target, x: from.x, z: from.z }, { id: best, x: bx, z: bz }],
    kind: 'chain', elem: 3, x: from.x, z: from.z });
}

export function burnOnHit(w, e, by) {
  const s = w.ecs;
  if (!s.alive[e] || s.dead[e] > 0) return;
  const burns = w.burns || (w.burns = new Map()), old = burns.get(e);
  const every = Math.round(PEARL.burnEvery / DT);
  burns.set(e, { until: w.tick + Math.round(PEARL.burnTime / DT), next: old?.next || w.tick + every,
    raw: Math.max(old?.raw || 0, s.atk[by] * PEARL.burnMult), by,
    pirateId: w.profiles?.get(by)?.pirateId || '' });
  w.emit({ type: 'burn', id: e, by, x: s.x[e], z: s.z[e], until: w.tick + Math.round(PEARL.burnTime / DT), elem: 1 });
}

export function chillOnHit(w, e, by) {
  const s = w.ecs;
  if (!s.alive[e] || s.dead[e] > 0 || !(s.mask[e] & C.ENEMY)) return;
  const chills = w.chills || (w.chills = new Map()), old = chills.get(e);
  const active = old && old.until >= w.tick ? old : { hits: 0, freezeUntil: 0 };
  active.until = w.tick + Math.round(PEARL.chillTime / DT);
  active.by = by;
  active.hits++;
  const boss = !!ENEMIES[ENEMY_KINDS[s.enemy[e]]]?.boss;
  let froze = false;
  if (active.hits >= PEARL.chillHits) {
    active.hits = 0;
    if (!boss) {
      active.freezeUntil = w.tick + Math.round(PEARL.freezeTime / DT);
      froze = true;
    }
  }
  chills.set(e, active);
  w.emit({ type: 'chill', id: e, by, x: s.x[e], z: s.z[e], until: active.until, stacks: active.hits, elem: 2 });
  if (froze) w.emit({ type: 'freeze', id: e, by, x: s.x[e], z: s.z[e], until: active.freezeUntil, elem: 2 });
}

export function stepChills(w) {
  for (const [e, c] of w.chills || []) {
    if (!w.ecs.alive[e] || w.ecs.dead[e] > 0 || w.tick > c.until) w.chills.delete(e);
  }
}

export function enemyChillMul(w, e) {
  const c = w.chills?.get(e);
  if (!c || w.tick > c.until) return 1;
  if (c.freezeUntil > w.tick) return 0;
  return PEARL.chillSlow;
}

export function stepBurns(w) {
  const s = w.ecs;
  // The Cometa leaves burning ground for two seconds. One pulse per half second; its attack key makes
  // overlapping trail segments hit a given target only once per pulse.
  const trails = w.fireTrails || [];
  for (let i = trails.length - 1; i >= 0; i--) {
    const f = trails[i];
    if (w.tick > f.until || !s.alive[f.e] || (f.pirateId && w.profiles?.get(f.e)?.pirateId !== f.pirateId)) { trails.splice(i, 1); continue; }
    if (w.tick < f.next) continue;
    f.next += Math.round(PEARL.burnEvery / DT);
    w.pathHits(f.e, f.x0, f.z0, f.x1, f.z1, 0.85, 0.12, -f.castId * 100000 - w.tick,
      { skill: 'comet', kind: 'fire', knock: 0, fire: 1 }, w.tick, 0);
  }
  for (const [e, b] of w.burns || []) {
    if (!s.alive[e] || s.dead[e] > 0 || w.tick > b.until) { w.burns.delete(e); continue; }
    if (w.tick < b.next) continue;
    b.next += Math.round(PEARL.burnEvery / DT);
    const by = s.alive[b.by] && (!b.pirateId || w.profiles?.get(b.by)?.pirateId === b.pirateId) ? b.by : 0;
    if (s.mask[e] & C.ENEMY) w.strike(e, b.raw, { by, kind: 'burn', x: s.x[e], z: s.z[e], knock: 0, pierce: true, above: true, noCrit: true, noElement: true, elem: 1 });
    else hurtPlayer(w, e, b.raw, { by, kind: 'burn', x: s.x[e], z: s.z[e], knock: 0, noInv: true, pierce: true, seq: 0, fire: 1 });
  }
}
export function stepWaterCurse(w, e, dt, seq) {
  const s = w.ecs;
  if (s.elem[e] !== 1 || s.dead[e] > 0) { s.waterT[e] = 0; return; }
  const wet = !w.map.onDock(s.x[e], s.z[e]) && !w.raftDeck?.surface(s.x[e], s.z[e], s.y[e]) &&
    tuning.world.waterLevel - w.map.groundAt(s.x[e], s.z[e]) > 0.05;
  if (!wet) { s.waterT[e] = 0; return; }
  s.waterT[e] += dt;
  while (s.waterT[e] + 1e-9 >= PEARL.waterEvery && s.dead[e] <= 0) {
    s.waterT[e] -= PEARL.waterEvery;
    hurtPlayer(w, e, s.maxHp[e] * PEARL.waterDps * PEARL.waterEvery,
      { kind: 'water', x: s.x[e], z: s.z[e], knock: 0, noInv: true, pierce: true, seq });
  }
}
