// The open sea's swell after Wind Waker's Great Sea (research/wind-waker 01 section 5, 05 section C; T-1025-08). Pure
// maths, no three.js: the four travelling cosines in our units and seconds, their slope, the depth and patch-edge fades,
// a shared clock (water.js registers the shader clock) and seabed sampler, and the same function as GLSL for the water.
// Everything that floats in the client (hulls, the boat camera, swimmers) reads seaSurfaceY; the sim keeps y 0.
import { NAVAL_SEA as S } from '../../data/navalSea.js';
import { WW_ANGLE, WW_UNIT } from '../../data/navalHandling.js';

const TAU = Math.PI * 2;

export const SEA_AMP = S.waveAmp * S.waveMax * WW_UNIT; // one component's amplitude, our units
export const SEA_CELL = S.cell * WW_UNIT; // patch cell, our units
export const SEA_PATCH = S.cells * SEA_CELL; // patch side, our units
// Per component in our units and seconds: theta = kx x + kz z - 2 pi fract(t w) + ph, where
// -0x10000 (ratio - 0.5) = -2 pi ratio + pi and ratio = frame / period = fract(t * 30 / period).
export const SEA_WAVES = Object.freeze(S.waves.map((w) => {
  const k = w.km * S.kScale / WW_UNIT;
  return Object.freeze({ kx: k * w.vx, kz: k * w.vz, w: S.frameRate / w.period, ph: w.phase * WW_ANGLE + Math.PI });
}));

const smoothstep = (a, b, v) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Swell height (our units) at our world x, z and time t (seconds), no fades.
export function seaSwellHeight(x, z, t) {
  let h = 0;
  for (let i = 0; i < SEA_WAVES.length; i++) {
    const w = SEA_WAVES[i], c = t * w.w;
    h += Math.cos(w.kx * x + w.kz * z - TAU * (c - Math.floor(c)) + w.ph);
  }
  return h * SEA_AMP;
}

// Analytic slope { x: dh/dx, z: dh/dz } of seaSwellHeight, written into `out`.
export function seaSwellSlope(x, z, t, out = { x: 0, z: 0 }) {
  let sx = 0, sz = 0;
  for (let i = 0; i < SEA_WAVES.length; i++) {
    const w = SEA_WAVES[i], c = t * w.w;
    const s = Math.sin(w.kx * x + w.kz * z - TAU * (c - Math.floor(c)) + w.ph);
    sx -= s * w.kx; sz -= s * w.kz;
  }
  out.x = sx * SEA_AMP; out.z = sz * SEA_AMP;
  return out;
}

// Amplitude factor by water depth (our units, positive below the still level).
export const seaDepthFade = (depth) => smoothstep(S.depthFade.d0, S.depthFade.d1, depth);

// Patch edge factor for one axis' vertex index (0 .. cells): 0, 1/6 .. 5/6 over the outer rings, then 1.
export const seaEdgeFade = (i) => Math.min(Math.max(Math.min(i, S.cells - i) / S.edgeCells, 0), 1);

// The patch's min corner { x, y = z } for a camera at x, z: snapped to whole cells, the camera's cell in the middle.
export function seaPatchOrigin(x, z, out = { x: 0, y: 0 }) {
  const mid = (S.cells - 1) / 2;
  out.x = (Math.floor(x / SEA_CELL) - mid) * SEA_CELL;
  out.y = (Math.floor(z / SEA_CELL) - mid) * SEA_CELL;
  return out;
}

// The seabed as the water shader sees it: a res x res single-channel grid over [-half, half]^2 read with linear
// filtering and clamp-to-edge (texel centres at (i + 0.5) / res), floorOutside off the texture. decode maps a stored
// value to a height (half floats for the water texture).
export function sampleSeaFloor(data, res, half, x, z, decode = (v) => v) {
  const u = x / (half * 2) + 0.5, v = z / (half * 2) + 0.5;
  if (!(u >= 0 && v >= 0 && u <= 1 && v <= 1)) return S.floorOutside;
  const fx = Math.min(Math.max(u * res - 0.5, 0), res - 1), fz = Math.min(Math.max(v * res - 0.5, 0), res - 1);
  const i = Math.floor(fx), j = Math.floor(fz), i1 = Math.min(i + 1, res - 1), j1 = Math.min(j + 1, res - 1);
  const tx = fx - i, tz = fz - j;
  const a = decode(data[j * res + i]), b = decode(data[j * res + i1]), c = decode(data[j1 * res + i]), d = decode(data[j1 * res + i1]);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// Shared clock (seconds; water.js registers the shader's mnTime) and seabed height sampler (our units). Until a water
// registers its seabed the floor is the still level: no sea drawn, no swell.
const noClock = () => 0, noFloor = () => 0;
let clock = noClock, floor = noFloor;
export function setSeaClock(fn) { clock = typeof fn === 'function' ? fn : noClock; }
export function setSeaFloor(fn) { floor = typeof fn === 'function' ? fn : noFloor; }
export function seaTime() { const t = clock(); return Number.isFinite(t) ? t : 0; }
export function seaFloorAt(x, z) { const h = floor(x, z); return Number.isFinite(h) ? h : 0; }

// The drawn sea surface's height over the still level at time t: the swell times the depth fade (the patch edge fade
// is left out: it only touches cells 270+ units from the camera).
export const seaSurfaceAt = (x, z, t) => seaSwellHeight(x, z, t) * seaDepthFade(-seaFloorAt(x, z));
export const seaSurfaceY = (x, z) => seaSurfaceAt(x, z, seaTime());

const glf = (v) => { const s = Number(v).toPrecision(10); return /[.e]/.test(s) ? s : `${s}.0`; };
const vec4 = (key) => `vec4(${SEA_WAVES.map((w) => glf(w[key])).join(', ')})`;

// The same functions for the water shaders (constants interpolated from the tables above).
export const SEA_SWELL_GLSL = /* glsl */ `
const vec4 MN_SEA_KX = ${vec4('kx')};
const vec4 MN_SEA_KZ = ${vec4('kz')};
const vec4 MN_SEA_W = ${vec4('w')};
const vec4 MN_SEA_PH = ${vec4('ph')};
const float MN_SEA_AMP = ${glf(SEA_AMP)};
const float MN_SEA_CELL = ${glf(SEA_CELL)};
const float MN_SEA_CELLS = ${glf(S.cells)};
// Height (x) and slope d/dx, d/dz (y, z) of the swell at world xz, time t seconds.
vec3 mnSeaSwell(vec2 p, float t) {
  vec4 th = MN_SEA_KX * p.x + MN_SEA_KZ * p.y - 6.283185307 * fract(t * MN_SEA_W) + MN_SEA_PH;
  vec4 s = sin(th);
  return MN_SEA_AMP * vec3(dot(cos(th), vec4(1.0)), -dot(s, MN_SEA_KX), -dot(s, MN_SEA_KZ));
}
float mnSeaDepthFade(float depth) { return smoothstep(${glf(S.depthFade.d0)}, ${glf(S.depthFade.d1)}, depth); }
float mnSeaEdgeFade(vec2 idx) {
  vec2 e = clamp(min(idx, MN_SEA_CELLS - idx) / ${glf(S.edgeCells)}, 0.0, 1.0);
  return e.x * e.y;
}
`;
