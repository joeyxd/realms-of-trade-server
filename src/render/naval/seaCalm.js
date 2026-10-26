// The swell's calm mask (PT20b, after T-1025-08). Wind Waker turns its waves off by a global scalar from the distance
// to calm rooms (research/wind-waker 05 section C1: off within 163 units, full 163 further); our island is small and
// has one dock, so the mask is per texel of the water height grid instead: 0 within `near` units of land (height at or
// over the sea level) or of the dock deck, 1 beyond `far`, a smoothstep in between. Pure maths, no three.js: water.js
// wraps the bytes in an R8 texture the swell patch reads, and seaSwell.js samples the same bytes on the CPU, so hulls,
// the boat camera and swimmers ride the surface the GPU draws.
import { NAVAL_SEA as S } from '../../data/navalSea.js';

const INF = 1e20;
const smoothstep = (a, b, v) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Exact one-dimensional squared Euclidean distance transform (Felzenszwalb and Huttenlocher): f holds 0 at seeds and
// INF elsewhere, d receives the squared distance in cells; v and z are scratch (n ints, n + 1 floats).
function edt1d(f, d, n, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// World x, z of texel centre (i, j) of a res x res grid over [-half, half]^2, as the GPU and sampleSeaFloor read it.
const texelCentre = (i, res, half) => ((i + 0.5) / res - 0.5) * 2 * half;

// The dock deck as a seed test (x, z) => boolean: the oriented rectangle the coast geometry uses (1.5 units before the
// base, `len` after it, `halfWidth` each side); null when there is no dock or its deck is under the sea level.
export function dockSeed(dock, seaLevel = S.calm.seaLevel) {
  if (!dock?.base || !dock?.dir || !(dock.len > 0) || !(dock.halfWidth > 0) || !(dock.deckY > seaLevel)) return null;
  const { x: bx, z: bz } = dock.base, { x: dx, z: dz } = dock.dir;
  return (x, z) => {
    const rx = x - bx, rz = z - bz, along = rx * dx + rz * dz, across = -rx * dz + rz * dx;
    return along > -1.5 && along < dock.len && Math.abs(across) < dock.halfWidth;
  };
}

// Mask bytes (0 calm .. 255 full swell) for a res x res height grid over [-half, half]^2. decode maps a stored height to
// units (half floats in the water texture); seedAt(x, z) marks extra calm texels (the dock). O(res^2).
export function buildCalmMask(heights, res, half, {
  decode = (v) => v, seedAt = null, near = S.calm.near, far = S.calm.far, seaLevel = S.calm.seaLevel,
} = {}) {
  if (!(res > 0) || heights.length < res * res) throw new RangeError('Calm mask needs a square height grid');
  const n = res * res, texel = (2 * half) / res;
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(res), z = new Float64Array(res + 1), line = new Float64Array(res), out = new Float64Array(res);
  let seeds = 0;
  for (let j = 0; j < res; j++) {
    const wz = texelCentre(j, res, half);
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const seed = decode(heights[k]) >= seaLevel || (seedAt !== null && seedAt(texelCentre(i, res, half), wz));
      f[k] = seed ? 0 : INF;
      if (seed) seeds++;
    }
  }
  const mask = new Uint8Array(n);
  if (seeds === 0) { mask.fill(255); return mask; }
  for (let i = 0; i < res; i++) { // columns
    for (let j = 0; j < res; j++) line[j] = f[j * res + i];
    edt1d(line, out, res, v, z);
    for (let j = 0; j < res; j++) d[j * res + i] = out[j];
  }
  for (let j = 0; j < res; j++) { // rows, then the distance in units through the smoothstep
    edt1d(d.subarray(j * res, j * res + res), out, res, v, z);
    for (let i = 0; i < res; i++) mask[j * res + i] = Math.round(255 * smoothstep(near, far, Math.sqrt(out[i]) * texel));
  }
  return mask;
}

// A stored mask byte as the swell factor 0..1 (the CPU sampler's decode).
export const calmByteToUnit = (v) => v / 255;
