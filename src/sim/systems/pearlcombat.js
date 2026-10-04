// Brasa's shared water curse and server-owned burns. Movement, cooldowns and bullet clearing of G
// live in skills.js, where the client replays exactly the same command ticks as the server.
import { PEARL } from '../../data/pearls.js';
import { DT, tuning } from '../../data/tuning.js';
import { C } from '../ecs.js';
import { hurtPlayer } from './combat.js';

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
      { skill: 'comet', kind: 'fire', knock: 0 }, w.tick, 0);
  }
  for (const [e, b] of w.burns || []) {
    if (!s.alive[e] || s.dead[e] > 0 || w.tick > b.until) { w.burns.delete(e); continue; }
    if (w.tick < b.next) continue;
    b.next += Math.round(PEARL.burnEvery / DT);
    const by = s.alive[b.by] && (!b.pirateId || w.profiles?.get(b.by)?.pirateId === b.pirateId) ? b.by : 0;
    if (s.mask[e] & C.ENEMY) w.strike(e, b.raw, { by, kind: 'burn', x: s.x[e], z: s.z[e], knock: 0, pierce: true, above: true, noCrit: true, noElement: true, elem: 1 });
    else hurtPlayer(w, e, b.raw, { by, kind: 'burn', x: s.x[e], z: s.z[e], knock: 0, noInv: true, pierce: true, seq: 0 });
  }
}
export function stepWaterCurse(w, e, dt, seq) {
  const s = w.ecs;
  if (s.elem[e] !== 1 || s.dead[e] > 0) { s.waterT[e] = 0; return; }
  const wet = !w.map.onDock(s.x[e], s.z[e]) && tuning.world.waterLevel - w.map.groundAt(s.x[e], s.z[e]) > 0.05;
  if (!wet) { s.waterT[e] = 0; return; }
  s.waterT[e] += dt;
  while (s.waterT[e] + 1e-9 >= PEARL.waterEvery && s.dead[e] <= 0) {
    s.waterT[e] -= PEARL.waterEvery;
    hurtPlayer(w, e, s.maxHp[e] * PEARL.waterDps * PEARL.waterEvery,
      { kind: 'water', x: s.x[e], z: s.z[e], knock: 0, noInv: true, pierce: true, seq });
  }
}
