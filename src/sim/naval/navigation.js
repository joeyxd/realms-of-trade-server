// Pure opportunities for the isolated bay. There is no inventory, progress or wall clock here.
import { NAVAL_NAVIGATION as N } from '../../data/navalNavigation.js';
import { NAVAL_STEP } from '../../data/navalHandling.js';
import { windEfficiency } from './handling.js';

export const CURRENT_LANES = Object.freeze([
  Object.freeze({ x: 0, z: 18, yaw: 0, halfWidth: 5, length: 90, speed: 2.4, bend: 4 }),
  Object.freeze({ x: 12, z: 54, yaw: Math.PI / 3, halfWidth: 4, length: 65, speed: 2.8, bend: -3 }),
]);
const smooth = (v) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };

export function currentAt(x, z, enabled = true) {
  if (!enabled || !Number.isFinite(x) || !Number.isFinite(z)) return { x: 0, z: 0, strength: 0 };
  let vx = 0, vz = 0;
  for (const lane of CURRENT_LANES) {
    const s = Math.sin(lane.yaw), c = Math.cos(lane.yaw), dx = x - lane.x, dz = z - lane.z;
    const along = dx * s + dz * c;
    if (along < 0 || along > lane.length) continue;
    const phase = Math.PI * along / lane.length, curve = lane.bend * Math.sin(phase);
    const side = dx * c - dz * s - curve;
    const weight = smooth(1 - Math.abs(side) / lane.halfWidth) * smooth(along / 6) * smooth((lane.length - along) / 6);
    const slope = lane.bend * Math.PI / lane.length * Math.cos(phase);
    const scale = lane.speed * weight / Math.hypot(1, slope);
    vx += (s + c * slope) * scale; vz += (c - s * slope) * scale;
  }
  const speed = Math.hypot(vx, vz), cap = speed > N.maxCurrentSpeed ? N.maxCurrentSpeed / speed : 1;
  return { x: vx * cap, z: vz * cap, strength: Math.min(speed, N.maxCurrentSpeed) };
}

export function gustAt(tick, wind, enabled = true) {
  const id = Math.floor(tick / N.cycleTicks), local = tick % N.cycleTicks;
  const end = N.windowStart + N.windowTicks;
  if (!enabled || !(wind?.strength > 0)) return { id, phase: 'idle', progress: 0, remaining: 0 };
  const phase = local < N.announcementTick || local >= end ? 'idle' : local < N.windowStart ? 'approach' : 'window';
  const next = local < N.windowStart ? N.windowStart - local : N.cycleTicks - local + N.windowStart;
  return { id, phase, progress: phase === 'idle' ? 0 : (local - N.announcementTick) / (end - N.announcementTick),
    remaining: (phase === 'window' ? end - local : next) * NAVAL_STEP };
}

export function newSailingActivity() {
  return { boostUntil: 0, multiplier: 1, lastAttempt: -1, result: '', resultUntil: 0 };
}

export function stepSailingActivity(activity, state, input, rig, wind, enabled = true) {
  let next = { ...activity }, event = null;
  if (!enabled) return { activity: newSailingActivity(), event };
  if (state.tick >= next.boostUntil) next.multiplier = 1;
  if (state.tick >= next.resultUntil) next.result = '';
  const gust = gustAt(state.tick, wind, enabled);
  if (!input?.capture || gust.phase === 'idle' || next.lastAttempt === gust.id) return { activity: next, event };
  // One attempt per announced gust; holding a control or missing cannot farm repeated boosts.
  next.lastAttempt = gust.id;
  if (gust.phase !== 'window') event = 'early';
  else if (!(rig.sail > 0) || windEfficiency(state.yaw, wind) < 0.55) event = 'angle';
  else if (!(input.throttle > 0.1) || input.brake > 0.1) event = 'miss';
  else {
    const centre = N.windowStart + N.windowTicks / 2;
    event = Math.abs(state.tick % N.cycleTicks - centre) <= N.perfectTicks ? 'perfect' : 'capture';
    next.boostUntil = state.tick + N.boostTicks;
    next.multiplier = event === 'perfect' ? N.perfectMultiplier : N.captureMultiplier;
  }
  next.result = event; next.resultUntil = state.tick + 150;
  return { activity: next, event };
}

export function sailingEnvironment(activity, state, enabledCurrent = true) {
  const boosting = state.tick < activity.boostUntil;
  return { current: currentAt(state.x, state.z, enabledCurrent),
    // Keep one absolute envelope: expiry removes thrust, never clips an existing burst abruptly.
    sailMultiplier: boosting ? activity.multiplier : 1, maxSpeed: N.boostMaxSpeed };
}
