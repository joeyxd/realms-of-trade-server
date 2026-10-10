// Holds (M6 / M7): what a ship (or your pack on foot) carries. Volume and mass are independent; perishables rot on the
// game clock. A hold is plain data { cap, goods: { id: n } } so it saves and travels as JSON.
import { GOODS } from '../../data/goods.js';

export const PACK_CAP = 10; // what a pirate carries on foot (no ship)

export const newHold = (cap = PACK_CAP, maxMass) => ({ cap, ...(Number.isFinite(maxMass) ? { maxMass } : {}), goods: {} });
// Catalog dimensions are abstract game units. The legacy w alias remains volume for old callers.
export const goodVolume = (g) => GOODS[g]?.volume ?? GOODS[g]?.w ?? 1;
export const goodMass = (g) => GOODS[g]?.mass ?? GOODS[g]?.w ?? 1;
export function holdUsed(h) {
  let u = 0;
  for (const [g, n] of Object.entries(h.goods)) u += goodVolume(g) * n;
  return u;
}
export function holdMass(h) {
  let mass = 0;
  for (const [g, n] of Object.entries(h?.goods || {})) mass += goodMass(g) * n;
  return mass;
}
export const holdFree = (h) => Math.max(0, h.cap - holdUsed(h));
// How many units of g still fit.
export const roomFor = (h, g) => {
  if (!GOODS[g]) return 0;
  const volumeRoom = Math.floor(holdFree(h) / goodVolume(g));
  if (!Number.isFinite(h?.maxMass)) return volumeRoom;
  return Math.min(volumeRoom, Math.floor(Math.max(0, h.maxMass - holdMass(h)) / goodMass(g)));
};

export function load(h, g, n) {
  if (!GOODS[g] || !(n > 0) || roomFor(h, g) < n) return false;
  h.goods[g] = (h.goods[g] || 0) + n;
  return true;
}
export function unload(h, g, n) {
  if (!(n > 0) || (h.goods[g] || 0) < n) return false;
  h.goods[g] -= n;
  if (!h.goods[g]) delete h.goods[g];
  return true;
}
// Perishables lose their share over `days` (whole units, at least one when any rots).
export function rot(h, days) {
  const lost = {};
  for (const [g, n] of Object.entries(h.goods)) {
    const p = GOODS[g] && GOODS[g].perish;
    if (!p) continue;
    const k = Math.floor(n * (1 - Math.pow(1 - p, days)));
    if (k > 0) { unload(h, g, k); lost[g] = k; }
  }
  return lost;
}
// A saved hold made safe: known goods, whole non-negative counts, within its cap (extra is dropped).
export function sanitizeHold(raw, cap, maxMass) {
  const h = newHold(cap, maxMass);
  const src = raw && typeof raw === 'object' && raw.goods && typeof raw.goods === 'object' ? raw.goods : {};
  for (const [g, n] of Object.entries(src)) {
    const k = Math.floor(Number(n));
    if (GOODS[g] && k > 0) load(h, g, Math.min(k, roomFor(h, g)));
  }
  return h;
}
