// GM08c (docs/briefs/gm08-large-brushes.md): procedural terrain on the editor's grid. A seeded value-noise fBm that the
// noise tool adds to the ground (brush and region), and two erosions over a region: thermal (ground steeper than the
// talus angle slides down to its lower neighbours) and a simple hydraulic one (seeded droplets carry sediment
// downhill). Every result is deterministic for its parameters and seed, and is stored as tiles like any stroke.
// Pure module: no DOM; it runs in the browser and in Node.

export const NOISE_MAX_OCTAVES = 6;
export const NOISE_MIN_SCALE = 4, NOISE_MAX_SCALE = 256;
export const NOISE_MIN_AMPLITUDE = .1, NOISE_MAX_AMPLITUDE = 20;
export const THERMAL_MIN_TALUS = 25, THERMAL_MAX_TALUS = 45;
export const THERMAL_MIN_ITERATIONS = 10, THERMAL_MAX_ITERATIONS = 200;
export const HYDRAULIC_MIN_DROPLETS = 1000, HYDRAULIC_MAX_DROPLETS = 50000;
/**
 * The thermal cost bound: editable vertices x iterations. About 200 ms on a desktop (the whole editable island,
 * about 35,000 vertices, takes about 110 iterations); a larger product is refused with the code 'cost'.
 */
export const THERMAL_MAX_WORK = 4000000;

const SEED_MAX = 0xffffffff;
const between = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;

export const validSeed = seed => Number.isSafeInteger(seed) && seed >= 0 && seed <= SEED_MAX;
export const validNoise = ({ amplitude, octaves, scale, seed } = {}) => validSeed(seed) &&
  Number.isSafeInteger(octaves) && octaves >= 1 && octaves <= NOISE_MAX_OCTAVES &&
  between(scale, NOISE_MIN_SCALE, NOISE_MAX_SCALE) && between(amplitude, NOISE_MIN_AMPLITUDE, NOISE_MAX_AMPLITUDE);
export const validThermal = ({ talus, iterations } = {}) => between(talus, THERMAL_MIN_TALUS, THERMAL_MAX_TALUS) &&
  Number.isSafeInteger(iterations) && iterations >= THERMAL_MIN_ITERATIONS && iterations <= THERMAL_MAX_ITERATIONS;
export const validHydraulic = ({ droplets, seed } = {}) => validSeed(seed) &&
  Number.isSafeInteger(droplets) && droplets >= HYDRAULIC_MIN_DROPLETS && droplets <= HYDRAULIC_MAX_DROPLETS;

// A lattice value in [-1, 1] for integer coordinates and a 32-bit seed (an integer hash, no table).
function lattice(seed, x, z) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
}

/**
 * Seeded value-noise fBm at world (x, z) metres, in [-1, 1]: `octaves` layers, the first with a lattice cell of
 * `scale` metres, each next one half the cell and half the weight. World-anchored, so two strokes with the same seed
 * draw the same field and meet without a seam.
 */
export function fbmNoise(x, z, { octaves = 4, scale = 32, seed = 1 } = {}) {
  let sum = 0, weight = 1, total = 0, cell = scale, s = seed >>> 0;
  for (let o = 0; o < octaves; o++) {
    const u = x / cell, v = z / cell, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    // Quintic fade: the field and its slope are continuous across lattice cells.
    const a = fu * fu * fu * (fu * (fu * 6 - 15) + 10), b = fv * fv * fv * (fv * (fv * 6 - 15) + 10);
    const h00 = lattice(s, iu, iv), h10 = lattice(s, iu + 1, iv), h01 = lattice(s, iu, iv + 1), h11 = lattice(s, iu + 1, iv + 1);
    sum += weight * (h00 + (h10 - h00) * a + (h01 - h00) * b + (h00 - h10 - h01 + h11) * a * b);
    total += weight; weight /= 2; cell /= 2; s = (s + 0x9e3779b9) >>> 0;
  }
  return sum / total;
}

// mulberry32: a small seeded generator in [0, 1).
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const activeVertices = (weights) => {
  const active = [];
  for (let n = 0; n < weights.length; n++) if (weights[n] > 0) active.push(n);
  return Int32Array.from(active);
};

/** The thermal work of a field: its editable vertices x iterations (THERMAL_MAX_WORK bounds it). */
export function thermalWork(weights, iterations) { return activeVertices(weights).length * iterations; }

const RING = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * Thermal erosion of a window of heights (row-major, `width` columns, 1 m apart), in place. `weights` is the edit share
 * per vertex (0 never changes). Each iteration, a vertex whose drop to a neighbour exceeds the talus slope (the tan of
 * `talus` degrees per metre) moves half its largest excess to its lower neighbours, in proportion to their excess and
 * scaled by the smaller share of the pair; all vertices move together (a Jacobi step), so the total height is kept.
 */
export function thermalErosion(heights, weights, width, { talus = 35, iterations = 50 } = {}) {
  const rows = heights.length / width, tan = Math.tan(talus * Math.PI / 180), active = activeVertices(weights);
  // Each active vertex's neighbours that may change too: the neighbour, the drop the talus allows, the pair's share.
  const start = new Int32Array(active.length + 1), to = [], allowed = [], pair = [];
  for (let a = 0; a < active.length; a++) {
    const n = active[a], i = n % width, j = (n - i) / width;
    for (const [di, dj] of RING) {
      const ii = i + di, jj = j + dj, m = jj * width + ii;
      if (ii < 0 || jj < 0 || ii >= width || jj >= rows || !(weights[m] > 0)) continue;
      to.push(m); allowed.push(tan * (di && dj ? Math.SQRT2 : 1)); pair.push(Math.min(weights[n], weights[m]));
    }
    start[a + 1] = to.length;
  }
  const next = Int32Array.from(to), drop = Float64Array.from(allowed), share = Float64Array.from(pair);
  const delta = new Float64Array(heights.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let a = 0; a < active.length; a++) {
      const n = active[a], h = heights[n];
      let total = 0, most = 0;
      for (let k = start[a]; k < start[a + 1]; k++) {
        const excess = h - heights[next[k]] - drop[k];
        if (excess > 0) { total += excess; if (excess > most) most = excess; }
      }
      if (!(total > 0)) continue;
      const move = most / 2 / total;
      for (let k = start[a]; k < start[a + 1]; k++) {
        const excess = h - heights[next[k]] - drop[k];
        if (excess > 0) { const amount = excess * move * share[k]; delta[n] -= amount; delta[next[k]] += amount; }
      }
    }
    for (let a = 0; a < active.length; a++) { const n = active[a]; heights[n] += delta[n]; delta[n] = 0; }
  }
}

// Hydraulic constants (after Hans Beyer's droplet model), in metres with a 1 m vertex spacing. Capacity and erosion
// were cut from his 4 and 0.3 (GM08c, measured on the generated island): 1,000 drops on a 40 m square lower it by at
// most 1.2 m (90 % of the changes under 0.25 m); 50,000 over the whole island cut channels up to 3.8 m deep.
const INERTIA = .05, CAPACITY = 1, MIN_CAPACITY = .01, ERODE = .05, DEPOSIT = .3, EVAPORATE = .01, GRAVITY = 4, LIFETIME = 30;
// The erosion footprint: the 3 x 3 vertices around the one nearest the drop, weighted by 2 - distance, normalised.
const FOOTPRINT_DI = Int32Array.of(-1, 0, 1, -1, 0, 1, -1, 0, 1), FOOTPRINT_DJ = Int32Array.of(-1, -1, -1, 0, 0, 0, 1, 1, 1);
const FOOTPRINT_W = (() => {
  const w = Float64Array.from(FOOTPRINT_DI, (di, n) => 2 - Math.hypot(di, FOOTPRINT_DJ[n])), sum = w.reduce((a, b) => a + b, 0);
  return w.map(v => v / sum);
})();

/**
 * Simple hydraulic erosion of a window of heights, in place: `droplets` drops, each starting on a random editable
 * vertex (seeded), roll downhill with a little inertia for up to 30 steps of 1 m. A drop picks up sediment while its
 * capacity (drop x speed x water) exceeds its load, never more than the drop of the step, from a 3 x 3 footprint; it
 * lays sediment down when overloaded or when the next step climbs, and lays what it still carries where it ends. Both
 * are scaled by each vertex's share, so a vertex with share 0 never changes. A drop that leaves the window takes its
 * load with it.
 */
export function hydraulicErosion(heights, weights, width, { droplets = 10000, seed = 1 } = {}) {
  const rows = heights.length / width, active = activeVertices(weights), next = random(seed);
  if (!active.length) return;
  const inside = (x, z) => x >= 0 && z >= 0 && x < width - 1 && z < rows - 1;
  // Lay `amount` on the four vertices around (x, z) by their bilinear weights and shares; returns what was laid.
  const lay = (x, z, amount) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, k = j * width + i;
    const a = amount * (1 - fx) * (1 - fz) * weights[k], b = amount * fx * (1 - fz) * weights[k + 1];
    const c = amount * (1 - fx) * fz * weights[k + width], d = amount * fx * fz * weights[k + width + 1];
    heights[k] += a; heights[k + 1] += b; heights[k + width] += c; heights[k + width + 1] += d;
    return a + b + c + d;
  };
  for (let d = 0; d < droplets; d++) {
    const origin = active[Math.floor(next() * active.length)];
    let x = origin % width + next() - .5, z = Math.floor(origin / width) + next() - .5;
    if (!inside(x, z)) continue;
    let dx = 0, dz = 0, speed = 1, water = 1, load = 0, left = false;
    for (let life = 0; life < LIFETIME; life++) {
      const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, k = j * width + i;
      const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + width], h11 = heights[k + width + 1];
      const gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz, gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const h = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
      dx = dx * INERTIA - gx * (1 - INERTIA); dz = dz * INERTIA - gz * (1 - INERTIA);
      const length = Math.sqrt(dx * dx + dz * dz);
      if (!(length > 0)) break;
      dx /= length; dz /= length;
      const nx = x + dx, nz = z + dz;
      if (!inside(nx, nz)) { left = true; break; }
      const ni = Math.floor(nx), nj = Math.floor(nz), gu = nx - ni, gv = nz - nj, q = nj * width + ni;
      const dh = heights[q] * (1 - gu) * (1 - gv) + heights[q + 1] * gu * (1 - gv) + heights[q + width] * (1 - gu) * gv +
        heights[q + width + 1] * gu * gv - h;
      const capacity = Math.max(-dh * speed * water * CAPACITY, MIN_CAPACITY);
      if (load > capacity || dh > 0) load -= lay(x, z, dh > 0 ? Math.min(dh, load) : (load - capacity) * DEPOSIT);
      else {
        const amount = Math.min((capacity - load) * ERODE, -dh), ci = Math.round(x), cj = Math.round(z);
        for (let f = 0; f < 9; f++) {
          const ii = ci + FOOTPRINT_DI[f], jj = cj + FOOTPRINT_DJ[f];
          if (ii < 0 || jj < 0 || ii >= width || jj >= rows) continue;
          const m = jj * width + ii, taken = amount * FOOTPRINT_W[f] * weights[m];
          heights[m] -= taken; load += taken;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * GRAVITY));
      water *= 1 - EVAPORATE;
      x = nx; z = nz;
    }
    if (!left && load > 0) lay(x, z, load);
  }
}
