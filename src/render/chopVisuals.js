import { AXES } from '../data/chopping.js';

export function tierFromCadence(cadence) {
  for (let t = 1; t <= 3; t++) if (cadence === AXES[t].cadence || cadence === AXES[t].learned) return t;
  return 1;
}
export const barColor = (fraction) => fraction > .6 ? 0x75bd42 : fraction > .3 ? 0xe8be42 : 0xd95642;
export const barVisible = (hp, maxHp, felled, target, distance, shown = 0) =>
  hp > 0 && maxHp > 0 && !felled && (hp < maxHp || target) && distance <= 30 && shown < 8;
export const pileLogCount = (count) => Math.max(1, Math.min(8, Math.floor(count) || 0));
// Optional preallocated output keeps snapshot updates allocation-free.
export function pileLayout(id, count, out = []) {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  for (let i = 0; i < pileLogCount(count); i++) {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507) >>> 0;
    const row = out[i] || (out[i] = {}), n = seed / 4294967296;
    row.x = (i % 3 - 1) * .32 + (n - .5) * .15; row.y = Math.floor(i / 3) * .18;
    row.z = (n - .5) * .65; row.yaw = (n - .5) * .75 + Math.floor(i / 3) * 1.3;
  }
  return out;
}
export function fallDirection(dir, yaw = 0) {
  const length = dir && Number.isFinite(dir.x) && Number.isFinite(dir.z) ? Math.hypot(dir.x, dir.z) : 0;
  return length > 0 ? { x: dir.x / length, z: dir.z / length } : { x: -Math.cos(yaw), z: Math.sin(yaw) };
}
