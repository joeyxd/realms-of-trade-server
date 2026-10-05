// Tinta (M4.8): deterministic cloud history and short-lived enemy marks. The server owns the effects;
// the client keeps predicted clouds locally until the matching authoritative event adopts them.
import { C } from '../ecs.js';
import { DT } from '../../data/tuning.js';
import { PEARL } from '../../data/pearls.js';

const ticks = (seconds) => Math.max(1, Math.round(seconds / DT));

export function addInkCloud(world, field) {
  if (!field || !Number.isFinite(field.e) || !Number.isFinite(field.seq) || !Number.isFinite(field.x) ||
      !Number.isFinite(field.z) || !Number.isFinite(field.r) || field.r <= 0 || !Number.isFinite(field.t0) ||
      !Number.isFinite(field.tEnd) || field.tEnd <= field.t0) return null;
  const clouds = world.inkClouds || (world.inkClouds = []), seq = field.seq >>> 0;
  const cloud = { type: 'inkCloud', e: field.e, seq, x: field.x, z: field.z, r: field.r,
    t0: field.t0, tEnd: field.tEnd, predicted: !!field.predicted };
  const i = clouds.findIndex((f) => f.e === cloud.e && f.seq === cloud.seq);
  if (i >= 0) {
    const old = clouds[i];
    if (old.predicted && !cloud.predicted) Object.assign(old, cloud);
    return clouds[i];
  }
  clouds.push(cloud);
  return cloud;
}

export function removePredictedInkClouds(world, e) {
  if (!Array.isArray(world.inkClouds)) return;
  world.inkClouds = world.inkClouds.filter((f) => !(f.predicted && f.e === e));
}

export function inkHidden(world, p, tick = world.tick) {
  const ecs = world.ecs;
  if (!ecs.alive[p] || !(ecs.mask[p] & C.PLAYER) || ecs.dead[p] > 0) return false;
  for (const f of world.inkClouds || []) {
    if (tick < f.t0 || tick >= f.tEnd) continue;
    const dx = ecs.x[p] - f.x, dz = ecs.z[p] - f.z;
    if (dx * dx + dz * dz <= f.r * f.r) return true;
  }
  return false;
}

export function markOnHit(world, target, opts = {}) {
  const ecs = world.ecs, b = ecs.brain[target];
  if (!ecs.alive[target] || ecs.dead[target] > 0 || !(ecs.mask[target] & C.ENEMY) || !b || opts.elem !== 4 ||
      !Number.isFinite(opts.dmg ?? opts.damage) || (opts.dmg ?? opts.damage) <= 0) return false;
  b.inkEnd = world.tick + ticks(PEARL.inkMarkTime);
  return true;
}

// Visible pirates refresh a brain's last-seen point. A covered target can only use that point, never live coordinates.
export function inkTargetPoint(world, brain, target, out = {}) {
  const ecs = world.ecs;
  if (!target || !ecs.alive[target] || !(ecs.mask[target] & C.PLAYER) || ecs.dead[target] > 0) return null;
  if (!inkHidden(world, target)) {
    brain.inkSeenId = target;
    brain.inkSeenX = ecs.x[target]; brain.inkSeenY = ecs.y[target]; brain.inkSeenZ = ecs.z[target];
  } else if (brain.inkSeenId !== target) return null;
  out.x = brain.inkSeenX; out.y = brain.inkSeenY; out.z = brain.inkSeenZ;
  return out;
}

export function stepInk(world) {
  const clouds = world.inkClouds;
  if (Array.isArray(clouds)) world.inkClouds = clouds.filter((f) => world.tick - f.tEnd <= 40);
}
