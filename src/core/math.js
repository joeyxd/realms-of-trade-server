// Small math helpers shared by sim and client. Pure.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp01((v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential smoothing.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const dampFactor = (lambda, dt) => 1 - Math.exp(-lambda * dt);

export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleDelta = (from, to) => wrapAngle(to - from);
export const dampAngle = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));

export const len2 = (x, z) => Math.sqrt(x * x + z * z);

export const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Damped spring (semi-implicit Euler, sub-stepped so it stays stable at any frame rate). state = {x, v}
export function spring(state, target, stiffness, damping, dt) {
  let left = Math.min(dt, 0.25);
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    const f = -stiffness * (state.x - target) - damping * state.v;
    state.v += f * h;
    state.x += state.v * h;
    left -= h;
  }
  if (!Number.isFinite(state.x)) { state.x = target; state.v = 0; }
  return state.x;
}

// Distance from point to segment (2D on XZ).
export function distToSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp01(t);
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}
