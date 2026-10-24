// GM08b (docs/briefs/gm08-large-brushes.md): region operations on the editor's terrain grid. A rectangle or a lasso
// drawn on the ground, with an inner feather, becomes a field like a stroke's influence; one operation (level, raise or
// lower by an amount, smooth n passes, paint or erase) runs over it with the stroke's clip and clamps, and commits once.
// Pure module: no DOM; it runs in the browser and in Node.
import { validateDocument } from './document.js';
import { TERRAIN_GRID_MAX_HEIGHT, TERRAIN_GRID_SIZE, TERRAIN_MATERIALS, TERRAIN_MIN_HEIGHT, terrainEditWeights } from './terrainData.js';
import { GRID_CEILING, GRID_FLOOR } from './terrainSculpt.js';
import { blendWeights } from './terrainPaint.js';

export const REGION_SHAPES = Object.freeze(['rect', 'lasso']);
/** A lasso holds 3 to 256 points; the pointer thins it out instead of refusing it (terrainInteraction.js). */
export const REGION_MAX_POINTS = 256;
export const REGION_MAX_FEATHER = 32;
/** Raise and lower move the ground by up to 50 m per operation. */
export const REGION_MAX_AMOUNT = 50;
export const REGION_MAX_PASSES = 16;
const REGION_TOOLS = new Set(['raise', 'lower', 'flatten', 'smooth', 'paint', 'erase']);

const fail = code => { throw Object.assign(new TypeError(`Terrain region failed: ${code}`), { code }); };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/** The outline of a region as a closed polygon: the four corners of a rectangle (two opposite corners), or the lasso. */
export function regionOutline({ shape, points }) {
  if (shape !== 'rect') return points;
  const [a, b] = points, x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  return [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
}

function checkedRegion(region, half) {
  const { shape, points, feather = 0 } = region || {};
  if (!REGION_SHAPES.includes(shape) || !Array.isArray(points) ||
      (shape === 'rect' ? points.length !== 2 : points.length < 3 || points.length > REGION_MAX_POINTS) ||
      points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) > half || Math.abs(p.z) > half)) fail('region');
  if (!Number.isFinite(feather) || feather < 0 || feather > REGION_MAX_FEATHER) fail('parameters');
  return { polygon: regionOutline({ shape, points }), feather };
}

/**
 * The field of a region over the grid window it covers (column i = x + half, row j = z + half), in the format of
 * strokeInfluence: { i0, j0, i1, j1, width, values }. A vertex inside the polygon (even-odd rule) takes 1, or with a
 * feather a smoothstep from 0 to 1 over `feather` metres of chamfer distance to the nearest vertex outside; a vertex
 * outside takes 0. The feather grows inwards, so nothing outside the drawn outline changes.
 */
export function regionInfluence(region, half) {
  const { polygon, feather } = checkedRegion(region, half), last = 2 * half;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  // One vertex of margin: the window's border lies outside the region, so the distance passes start from it.
  const i0 = clamp(Math.floor(x0 + half) - 1, 0, last), i1 = clamp(Math.ceil(x1 + half) + 1, 0, last);
  const j0 = clamp(Math.floor(z0 + half) - 1, 0, last), j1 = clamp(Math.ceil(z1 + half) + 1, 0, last);
  const width = i1 - i0 + 1, height = j1 - j0 + 1, values = new Float64Array(width * height);
  // Inside: the row's crossings with every edge, filled pairwise (Infinity marks a distance still unknown).
  for (let j = j0; j <= j1; j++) {
    const z = j - half, xs = [];
    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
      const p = polygon[a], q = polygon[b];
      if ((p.z > z) !== (q.z > z)) xs.push(p.x + (z - p.z) * (q.x - p.x) / (q.z - p.z));
    }
    xs.sort((m, n) => m - n);
    for (let n = 0; n + 1 < xs.length; n += 2)
      for (let i = Math.max(i0, Math.ceil(xs[n] + half)), to = Math.min(i1, Math.floor(xs[n + 1] + half)); i <= to; i++)
        values[(j - j0) * width + i - i0] = Infinity;
  }
  if (!(feather > 0)) {
    for (let n = 0; n < values.length; n++) if (values[n]) values[n] = 1;
    return { i0, j0, i1, j1, width, values };
  }
  // Two chamfer passes (1 and sqrt 2), as terrainEditWeights; beyond the window counts as outside.
  const at = (i, j) => i < 0 || j < 0 || i >= width || j >= height ? 0 : values[j * width + i];
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const k = j * width + i;
    if (values[k]) values[k] = Math.min(values[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + Math.SQRT2, at(i + 1, j - 1) + Math.SQRT2);
  }
  for (let j = height - 1; j >= 0; j--) for (let i = width - 1; i >= 0; i--) {
    const k = j * width + i;
    if (values[k]) values[k] = Math.min(values[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + Math.SQRT2, at(i - 1, j + 1) + Math.SQRT2);
  }
  for (let n = 0; n < values.length; n++) {
    if (!values[n]) continue;
    const t = Math.min(1, values[n] / feather);
    values[n] = t * t * (3 - 2 * t);
  }
  return { i0, j0, i1, j1, width, values };
}

/**
 * One region operation over the grid, beside sculptTerrainGrid and paintTerrainGrid (terrainSession.js picks it when
 * the edit carries `region`). edit = { map, surface, grid, document, baseRevision, tool, region: { shape, points,
 * feather }, level, amount, passes, strength, material }. Per vertex the field times its terrainEditWeights share:
 * - flatten levels to `level`; raise and lower move by `amount` metres; smooth runs `passes` full 3x3 passes
 * - paint blends `material` and erase removes paint, both by `strength`
 * Heights keep the 0.75 m floor and +200 m ceiling clamps of a stroke. The grid is not modified; the result is the
 * patch, { indices, deltasMm } or { indices, weights }, in ascending vertex order.
 */
export function regionTerrainGrid({ map, surface, grid, document, baseRevision, tool, region, level = 2.4, amount = 1,
  passes = 1, strength = .5, material = 'grass' } = {}) {
  const doc = validateDocument(document);
  if (!map || !Number.isSafeInteger(map.seed) || doc.base.seed !== (map.seed >>> 0) ||
      typeof baseRevision !== 'string' || doc.base.revision !== baseRevision) fail('base_mismatch');
  if (!REGION_TOOLS.has(tool) || !TERRAIN_MATERIALS.includes(material)) fail('tool');
  if (!Number.isFinite(level) || level < TERRAIN_MIN_HEIGHT || level > TERRAIN_GRID_MAX_HEIGHT ||
      !Number.isFinite(amount) || amount <= 0 || amount > REGION_MAX_AMOUNT ||
      !Number.isSafeInteger(passes) || passes < 1 || passes > REGION_MAX_PASSES ||
      !Number.isFinite(strength) || strength <= 0 || strength > 1) fail('parameters');
  const paint = tool === 'paint' || tool === 'erase';
  if (paint ? !(grid?.weights instanceof Uint8Array) || grid.weights.length !== TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE * 4
    : !(grid?.deltasMm instanceof Int32Array) || grid.deltasMm.length !== map.heights?.length ||
      surface?.heights?.length !== map.heights.length) fail('grid');
  const field = regionInfluence(region, map.half), share = terrainEditWeights(map);
  const { i0, j0, i1, j1, width } = field, w = new Float64Array(field.values.length);
  for (let j = j0, n = 0; j <= j1; j++) for (let i = i0; i <= i1; i++, n++) w[n] = field.values[n] * share[j * TERRAIN_GRID_SIZE + i];
  const indices = [], values = [];
  if (paint) {
    const weights = grid.weights, channel = tool === 'erase' ? 4 : TERRAIN_MATERIALS.indexOf(material);
    for (let j = j0, n = 0; j <= j1; j++) for (let i = i0; i <= i1; i++, n++) {
      if (w[n] <= 0) continue;
      const index = j * TERRAIN_GRID_SIZE + i, k = index * 4, old = [weights[k], weights[k + 1], weights[k + 2], weights[k + 3]];
      if (tool === 'erase' && !(old[0] || old[1] || old[2] || old[3])) continue;
      const next = blendWeights(old, channel, w[n] * strength);
      if (next.some((weight, c) => weight !== old[c])) { indices.push(index); values.push(...next); }
    }
    return { indices: Int32Array.from(indices), weights: Uint8Array.from(values) };
  }
  const heights = surface.heights, original = new Float64Array(w.length);
  for (let j = j0, n = 0; j <= j1; j++) for (let i = i0; i <= i1; i++, n++) original[n] = heights[j * TERRAIN_GRID_SIZE + i];
  const limit = (target, n) => clamp(target, Math.min(original[n], GRID_FLOOR), Math.max(original[n], GRID_CEILING));
  let result = original;
  if (tool === 'smooth') {
    // Each pass reads the one before; a neighbour outside the window never changes, so it reads the surface.
    let current = original, next = new Float64Array(w.length);
    for (let pass = 0; pass < passes; pass++) {
      for (let j = j0, n = 0; j <= j1; j++) for (let i = i0; i <= i1; i++, n++) {
        if (w[n] <= 0) { next[n] = current[n]; continue; }
        let sum = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const ii = clamp(i + dx, 0, TERRAIN_GRID_SIZE - 1), jj = clamp(j + dz, 0, TERRAIN_GRID_SIZE - 1);
          sum += ii < i0 || ii > i1 || jj < j0 || jj > j1 ? heights[jj * TERRAIN_GRID_SIZE + ii] : current[(jj - j0) * width + ii - i0];
        }
        next[n] = limit(current[n] + (sum / 9 - current[n]) * w[n], n);
      }
      [current, next] = [next, current === original ? new Float64Array(w.length) : current];
    }
    result = current;
  }
  for (let j = j0, n = 0; j <= j1; j++) for (let i = i0; i <= i1; i++, n++) {
    if (w[n] <= 0) continue;
    const index = j * TERRAIN_GRID_SIZE + i, h = original[n];
    const target = tool === 'smooth' ? result[n] : limit(tool === 'flatten' ? h + (level - h) * w[n]
      : h + (tool === 'raise' ? amount : -amount) * w[n], n);
    const delta = Math.round((Math.fround(target) - map.heights[index]) * 1000);
    if (delta !== grid.deltasMm[index]) { indices.push(index); values.push(delta); }
  }
  return { indices: Int32Array.from(indices), deltasMm: Int32Array.from(values) };
}
