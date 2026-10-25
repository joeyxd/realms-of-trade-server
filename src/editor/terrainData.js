import { gmEditableBaseProps } from './baseIdentity.js';
import { resourceLayout } from '../data/resources.js';
import { freshwaterSource } from '../data/freshwater.js';
import { insetMapBounds, mapBounds, mapGrid } from '../sim/mapBounds.js';

export const TERRAIN_VERSION = 1;
export const TERRAIN_MATERIAL_VERSION = 2;
export const TERRAIN_MATERIALS = Object.freeze(['grass', 'dirt', 'sand', 'rock']);
// Today's 561 x 561 square: the terrain v3/v4 index space and the default shape of a dense grid (GM11b2).
export const TERRAIN_GRID_SEGMENTS = 560;
export const TERRAIN_GRID_SIZE = TERRAIN_GRID_SEGMENTS + 1;
export const TERRAIN_SAMPLE_COUNT = TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE;
export const TERRAIN_MAX_SAMPLES = 20000;
export const TERRAIN_MAX_DELTA_MM = 12000;
export const TERRAIN_MIN_HEIGHT = 0.75;
// GM07 D4: an edited grid vertex compiles to [-40, +200] m. The 12 m delta and 20,000-sample caps stay v1/v2 only.
export const TERRAIN_GRID_MIN_HEIGHT = -40;
export const TERRAIN_GRID_MAX_HEIGHT = 200;
// GM07 D1: world-anchored tiles; tile (tx, tz) owns the integer x in [70tx, 70tx+69] and z in [70tz, 70tz+69].
export const TERRAIN_TILE_SIZE = 70;
// GM07 D4: object y range of a GM document (document.js), also the ground ceiling of the scatter rules.
export const OBJECT_MIN_Y = -64;
export const OBJECT_MAX_Y = 256;

function fail(code) { const error = new TypeError(`Invalid terrain: ${code}`); error.code = code; throw error; }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function validateTerrain(raw) {
  const painted = raw?.version === TERRAIN_MATERIAL_VERSION;
  if (!record(raw) || Object.keys(raw).length !== (painted ? 3 : 2) ||
      (!painted && raw.version !== TERRAIN_VERSION) || !Array.isArray(raw.samples) ||
      (painted && !Array.isArray(raw.materials))) fail('format');
  if (raw.samples.length > TERRAIN_MAX_SAMPLES) fail('sample_limit');
  let previous = -1;
  const samples = raw.samples.map(sample => {
    if (!Array.isArray(sample) || sample.length !== 2) fail('sample');
    const [index, delta] = sample;
    if (!Number.isSafeInteger(index) || index < 0 || index >= TERRAIN_SAMPLE_COUNT) fail('sample_index');
    if (index <= previous) fail('sample_order');
    if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > TERRAIN_MAX_DELTA_MM) fail('sample_delta');
    previous = index;
    return [index, delta];
  });
  if (!painted) return { version: TERRAIN_VERSION, samples };
  if (raw.materials.length > TERRAIN_MAX_SAMPLES) fail('material_limit');
  previous = -1;
  const materials = raw.materials.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 5) fail('material');
    const [index, ...weights] = entry;
    if (!Number.isSafeInteger(index) || index < 0 || index >= TERRAIN_SAMPLE_COUNT) fail('material_index');
    if (index <= previous) fail('material_order');
    if (weights.some(w => !Number.isSafeInteger(w) || w < 0 || w > 255)) fail('material_weight');
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum < 1 || sum > 255) fail('material_weight');
    previous = index;
    return [index, ...weights];
  });
  return { version: TERRAIN_MATERIAL_VERSION, samples, materials };
}

const gridOfCache = new WeakMap();
/**
 * GM11b2: the vertex grid of a base map, frozen { minX, maxX, minZ, maxZ, Nx, Nz, count }: vertex k = j * Nx + i is at
 * x = minX + i, z = minZ + j. Refused ('base_map') unless the map has 1 m cells, whole-metre bounds and a heights
 * array of Nx * Nz. Cached per map object.
 */
export function terrainGridOf(map) {
  const cached = gridOfCache.get(map);
  if (cached) return cached;
  let b, grid;
  try { b = mapBounds(map); grid = mapGrid(map); } catch { fail('base_map'); }
  const { Nx, Nz } = grid;
  if ((map.res ?? 1) !== 1 || ![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isInteger) ||
      Nx !== b.maxX - b.minX + 1 || Nz !== b.maxZ - b.minZ + 1 || !map.heights || map.heights.length !== Nx * Nz) fail('base_map');
  const result = Object.freeze({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, Nx, Nz, count: Nx * Nz });
  gridOfCache.set(map, result);
  return result;
}

// The grid of a map the edit rules read: terrainGridOf plus a groundAt to sample.
function sampledGridOf(map) {
  const g = terrainGridOf(map);
  if (typeof map.groundAt !== 'function') fail('base_map');
  return g;
}

function heightFrom(heights, Nx, i, j) { return heights[j * Nx + i]; }

function triangleHeight(heights, Nx, i, j, tx, tz) {
  const h00 = heightFrom(heights, Nx, i, j), h10 = heightFrom(heights, Nx, i + 1, j);
  const h01 = heightFrom(heights, Nx, i, j + 1), h11 = heightFrom(heights, Nx, i + 1, j + 1);
  if ((i + j) & 1) {
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h10 * (1 - tz) + h01 * (1 - tx) + h11 * (tx + tz - 1);
  }
  if (tz >= tx) return h00 + (h01 - h00) * tz + (h11 - h01) * tx;
  return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
}

const policyCache = new WeakMap();
function protectedMask(map) {
  const cached = policyCache.get(map);
  if (cached) return cached;
  const points = [];
  const add = (id, p, radius = 0) => { if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) points.push({ id, x: p.x, z: p.z, radius }); };
  const l = map.landmarks || {};
  add('spawn', l.spawn, 4); add('village', l.village, 4); add('dockBase', l.dockBase, 3); add('dockEnd', l.dockEnd, 3);
  add('arena', l.arena, l.arenaR || 19); add('volcano', l.volcano, 12); add('cala', map.cala, map.cala?.r || 0);
  add('freshwater:salty-spring', freshwaterSource(map), 3);
  for (const [key, p] of Object.entries(map.checkpoints || {})) add(`checkpoint:${key}`, p, 2);
  for (const [kind, list] of [['npc', map.npcs], ['rack', map.racks], ['enemySpawn', map.enemySpawns]])
    for (let i = 0; i < (list || []).length; i++) add(`${kind}:${i}`, list[i], 2);
  for (const key of ['dummy', 'cannon', 'ring']) add(`practice:${key}`, map.practice?.[key], (map.practice?.[key]?.r || 0) + 2);
  const resources = resourceLayout(map);
  for (const node of resources.nodes) add(`resource:${node.id}`, node, 1);
  add('resource:bench', resources.bench, 3);
  const editableIds = new Set(gmEditableBaseProps(map, map.baseRevision || '').map(entry => entry.index));
  for (let i = 0; i < (map.props || []).length; i++) {
    const p = map.props[i];
    if (editableIds.has(i)) continue;
    add(`prop:${i}`, p, Math.max(1, p.r || 0));
  }
  const b = mapBounds(map), Nx = b.maxX - b.minX + 1, Sx = Nx - 1, Sz = b.maxZ - b.minZ;
  const mask = new Uint8Array(Nx * (Sz + 1));
  for (const p of points) {
    const radius = p.radius + 2, cx = p.x - b.minX, cz = p.z - b.minZ;
    for (let j = Math.max(0, Math.ceil(cz - radius)); j <= Math.min(Sz, Math.floor(cz + radius)); j++)
      for (let i = Math.max(0, Math.ceil(cx - radius)); i <= Math.min(Sx, Math.floor(cx + radius)); i++)
        if (Math.hypot(i - cx, j - cz) < radius) mask[j * Nx + i] = 1;
  }
  const result = { points, mask };
  policyCache.set(map, result);
  return result;
}

/** Conservative cosmetic scatter policy. The full fitted footprint avoids functional ground. */
export function canScatterAt(map, x, z, radius = 0) {
  if (!map || ![x, z, radius].every(Number.isFinite) || radius < 0 || radius > 24) return false;
  let edge;
  try { edge = insetMapBounds(map, 2); } catch { return false; }
  if (x + radius >= edge.maxX || x - radius <= edge.minX || z + radius >= edge.maxZ || z - radius <= edge.minZ) return false;
  const { points } = protectedMask(map);
  if (points.some(p => Math.hypot(x - p.x, z - p.z) < radius + p.radius + 2)) return false;
  const safe = (px, pz) => {
    const h = map.groundAt(px, pz), m = map.masks?.(px, pz);
    if (!Number.isFinite(h) || h < TERRAIN_MIN_HEIGHT || h > OBJECT_MAX_Y || map.onDock?.(px, pz) || map.lawlessAt?.(px, pz) ||
        map.pathInfo?.(px, pz)?.d < 2 || map.trailInfo?.(px, pz)?.d < 2 ||
        (m && (m.arenaFloor > 0 || m.lava > 0 || m.volcanic > 0))) return false;
    const dx = map.groundAt(px + .5, pz) - map.groundAt(px - .5, pz);
    const dz = map.groundAt(px, pz + .5) - map.groundAt(px, pz - .5);
    return Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) <= .75;
  };
  if (!safe(x, z)) return false;
  // Include a grid-cell margin so a coastline cannot pass between tested vertices.
  for (let iz = Math.floor(z - radius - 1); iz <= Math.ceil(z + radius + 1); iz++)
    for (let ix = Math.floor(x - radius - 1); ix <= Math.ceil(x + radius + 1); ix++)
      if (Math.hypot(ix - x, iz - z) <= radius + 1 && !safe(ix, iz)) return false;
  return true;
}

function checkBaseMap(baseMap, sampled) {
  if (!baseMap || baseMap.size !== TERRAIN_GRID_SEGMENTS || baseMap.N !== TERRAIN_GRID_SIZE ||
      baseMap.res !== 1 || !baseMap.heights || baseMap.heights.length !== TERRAIN_SAMPLE_COUNT ||
      (sampled && typeof baseMap.groundAt !== 'function')) fail('base_map');
}

export function validateTerrainForMap(baseMap, terrain) {
  const checked = validateTerrain(terrain);
  checkBaseMap(baseMap, true);
  const { mask: protectedAreas } = protectedMask(baseMap);
  const sampleDeltas = new Map(checked.samples);
  const checkedIndices = new Set();
  for (const [index] of [...checked.samples, ...(checked.materials || [])]) {
    const i = index % TERRAIN_GRID_SIZE, j = Math.floor(index / TERRAIN_GRID_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const xIndex = i + dx, zIndex = j + dz;
      if (xIndex >= 0 && xIndex < TERRAIN_GRID_SIZE && zIndex >= 0 && zIndex < TERRAIN_GRID_SIZE)
        checkedIndices.add(zIndex * TERRAIN_GRID_SIZE + xIndex);
    }
  }
  for (const index of checkedIndices) {
    const i = index % TERRAIN_GRID_SIZE, j = Math.floor(index / TERRAIN_GRID_SIZE);
    const x = -baseMap.half + i, z = -baseMap.half + j;
    const before = baseMap.groundAt(x, z), after = before + (sampleDeltas.get(index) || 0) / 1000;
    if (baseMap.onDock?.(x, z) || baseMap.lawlessAt?.(x, z) || before < TERRAIN_MIN_HEIGHT || after < TERRAIN_MIN_HEIGHT) fail('protected_ground');
    const masks = baseMap.masks?.(x, z);
    if (baseMap.pathInfo?.(x, z)?.d < 2 || baseMap.trailInfo?.(x, z)?.d < 2 ||
        (masks && (masks.arenaFloor > 0 || masks.lava > 0 || masks.volcanic > 0))) fail('protected_route');
    if (protectedAreas[index]) fail('protected_area');
  }
  return checked;
}

function markChangedCells(changedCells, index, Nx, Nz) {
  const i = index % Nx, j = Math.floor(index / Nx);
  for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
    const ci = i + dx, cj = j + dz;
    if (ci >= 0 && ci < Nx - 1 && cj >= 0 && cj < Nz - 1) changedCells[cj * (Nx - 1) + ci] = 1;
  }
}

// The one compile behind terrain v1/v2 and grids. heights: a Float32Array copy of the base with the deltas added
// (or the base array itself when no height changed); changedCells: the cells around every height delta (paint never
// marks a cell); paint: four weights per vertex, or null. changedCells holds (Nx - 1) * (Nz - 1) cells of the base grid.
function projectTerrain(baseMap, heights, changedCells, paint, terrain) {
  const { minX, minZ, Nx, Nz } = terrainGridOf(baseMap), Sx = Nx - 1, Sz = Nz - 1;
  const heightAt = (x, z) => {
    const wx = x - minX, wz = z - minZ;
    if (wx < 0 || wx > Sx || wz < 0 || wz > Sz) return baseMap.heightAt(x, z);
    const fx = Math.min(Sx - 1e-7, wx), fz = Math.min(Sz - 1e-7, wz);
    const i = Math.floor(fx), j = Math.floor(fz);
    if (!changedCells[j * Sx + i]) return baseMap.heightAt(x, z);
    return triangleHeight(heights, Nx, i, j, fx - i, fz - j);
  };
  const groundAt = (x, z) => {
    if (!isAffected(x, z)) return baseMap.groundAt(x, z);
    return baseMap.onDock?.(x, z) ? Math.max(heightAt(x, z), baseMap.dock?.deckY ?? 1.05) : heightAt(x, z);
  };
  function isAffected(x, z) {
    const wx = x - minX, wz = z - minZ;
    if (wx < 0 || wx > Sx || wz < 0 || wz > Sz) return false;
    const i = Math.floor(Math.min(Sx - 1e-7, wx));
    const j = Math.floor(Math.min(Sz - 1e-7, wz));
    return !!changedCells[j * Sx + i];
  }
  const automaticMaterialAt = (x, z) => {
    if (!isAffected(x, z)) return baseMap.materialAt(x, z);
    if (baseMap.onDock?.(x, z)) return 'wood';
    const h = groundAt(x, z);
    if (h < -.05) return 'water';
    const m = baseMap.masks?.(x, z) || {};
    if (m.volcanic > .5 || m.arenaFloor > .5) return 'rock';
    if (m.path > .5) return 'dirt';
    return h < 1.5 ? 'sand' : 'grass';
  };
  // Same alternating triangles as heights and the GPU mesh; no independent splat grid.
  const materialWeightsAt = (x, z, out = [0, 0, 0, 0]) => {
    out.fill(0);
    const wx = x - minX, wz = z - minZ;
    if (!paint || wx < 0 || wz < 0 || wx > Sx || wz > Sz) return out;
    const i = Math.min(Sx - 1, Math.floor(wx)), j = Math.min(Sz - 1, Math.floor(wz));
    const tx = wx - i, tz = wz - j, a = j * Nx + i, b = a + 1, c = a + Nx, d = c + 1;
    let i0, i1, i2, w0, w1, w2;
    if ((i + j) & 1) {
      if (tx + tz <= 1) { i0 = a; i1 = b; i2 = c; w0 = 1 - tx - tz; w1 = tx; w2 = tz; }
      else { i0 = b; i1 = c; i2 = d; w0 = 1 - tz; w1 = 1 - tx; w2 = tx + tz - 1; }
    } else if (tz >= tx) { i0 = a; i1 = c; i2 = d; w0 = 1 - tz; w1 = tz - tx; w2 = tx; }
    else { i0 = a; i1 = b; i2 = d; w0 = 1 - tx; w1 = tx - tz; w2 = tz; }
    for (let k = 0; k < 4; k++) out[k] = (paint[i0 * 4 + k] * w0 +
      paint[i1 * 4 + k] * w1 + paint[i2 * 4 + k] * w2) / 255;
    return out;
  };
  const materialAt = (x, z) => {
    const weights = materialWeightsAt(x, z);
    let material = automaticMaterialAt(x, z);
    const automaticWeight = 1 - weights.reduce((a, b) => a + b, 0), automaticIndex = TERRAIN_MATERIALS.indexOf(material);
    if (automaticIndex >= 0) weights[automaticIndex] += automaticWeight;
    let best = automaticIndex < 0 ? automaticWeight : weights[automaticIndex];
    for (let k = 0; k < 4; k++) if (weights[k] > best) { best = weights[k]; material = TERRAIN_MATERIALS[k]; }
    return material;
  };
  // terrainPaint: the four weights per vertex this map draws (null: none), compared by the editor preview (GM08).
  const projected = { ...baseMap, heights, heightAt, groundAt, materialAt, fullsegments: Sx,
    gmTerrain: true, terrain, materialWeightsAt, terrainPaint: paint,
    terrainProjection: true, terrainSource: baseMap.terrainSource || baseMap };
  if (Nx !== Nz) delete projected.fullsegments;
  return projected;
}

export function compileTerrainMap(baseMap, terrain) {
  const checked = validateTerrain(terrain);
  checkBaseMap(baseMap, false);
  const hasPaint = !!checked.materials?.length;
  if (checked.samples.length === 0 && !hasPaint) return { ...baseMap, gmTerrain: false, terrain: checked };
  const heights = checked.samples.length ? new Float32Array(baseMap.heights) : baseMap.heights;
  const changedCells = new Uint8Array(TERRAIN_GRID_SEGMENTS * TERRAIN_GRID_SEGMENTS);
  for (const [index, deltaMm] of checked.samples) heights[index] += deltaMm / 1000;
  for (const [index] of checked.samples) markChangedCells(changedCells, index, TERRAIN_GRID_SIZE, TERRAIN_GRID_SIZE);
  const paint = hasPaint ? new Uint8Array(TERRAIN_SAMPLE_COUNT * 4) : null;
  for (const [index, ...weights] of checked.materials || []) paint.set(weights, index * 4);
  return projectTerrain(baseMap, heights, changedCells, paint, checked);
}

// --- GM07 dense grids (GM11b2: the shape follows the base map bounds; today's world is the 561 x 561 square). ---

/**
 * A terrain grid: deltasMm[k] is the height delta in mm of vertex k = j * Nx + i (x = minX + i, z = minZ + j of the
 * base map's terrainGridOf) and weights[k*4 + c] its paint weight of family c (grass, dirt, sand, rock = material ids
 * 1..4). shape = { Nx, Nz } (a terrainGridOf result fits); default and a grid with no Nx/Nz: today's 561 square. Tiles
 * are derived from a grid and decoded into one (terrainTiles.js).
 */
export function createTerrainGrid({ Nx, Nz } = { Nx: TERRAIN_GRID_SIZE, Nz: TERRAIN_GRID_SIZE }) {
  return { Nx, Nz, deltasMm: new Int32Array(Nx * Nz), weights: new Uint8Array(Nx * Nz * 4) };
}

const gridShape = grid => ({ Nx: grid.Nx ?? TERRAIN_GRID_SIZE, Nz: grid.Nz ?? TERRAIN_GRID_SIZE });

/** Key of tile (tx, tz) in dirty tile lists: 'tx,tz'. */
export function terrainTileKey(tx, tz) {
  if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(tz)) fail('tile_key');
  return `${tx},${tz}`;
}
const TILE_KEY = /^(-?[0-9]{1,5}),(-?[0-9]{1,5})$/;

function checkGridShape(grid) {
  if (!grid) fail('grid');
  const { Nx, Nz } = gridShape(grid);
  if (!Number.isSafeInteger(Nx) || !Number.isSafeInteger(Nz) || Nx < 2 || Nz < 2 ||
      !(grid.deltasMm instanceof Int32Array) || grid.deltasMm.length !== Nx * Nz ||
      !(grid.weights instanceof Uint8Array) || grid.weights.length !== Nx * Nz * 4) fail('grid');
}

// The grid of a base map for a dense grid: terrainGridOf (plus a groundAt to sample), and the grid of the same shape.
function gridFor(baseMap, grid, sampled) {
  const g = sampled ? sampledGridOf(baseMap) : terrainGridOf(baseMap), { Nx, Nz } = gridShape(grid);
  if (Nx !== g.Nx || Nz !== g.Nz) fail('grid');
  return g;
}

function touched(deltasMm, weights, k) {
  const w = k * 4;
  return deltasMm[k] !== 0 || weights[w] !== 0 || weights[w + 1] !== 0 || weights[w + 2] !== 0 || weights[w + 3] !== 0;
}

// The outer vertex ring (x = minX or maxX, z = minZ or maxZ) is not editable: the world edge stays base ocean, and
// x = maxX or z = maxZ belongs to no tile.
function checkGridRing(grid) {
  const { deltasMm, weights } = grid, { Nx, Nz } = gridShape(grid), last = (Nz - 1) * Nx;
  for (let n = 0; n < Nx; n++) if (touched(deltasMm, weights, n) || touched(deltasMm, weights, last + n)) fail('grid_edge');
  for (let n = 0; n < Nz; n++) if (touched(deltasMm, weights, n * Nx) || touched(deltasMm, weights, n * Nx + Nx - 1)) fail('grid_edge');
}

/** Structural check of a grid: its shape, an untouched outer ring, every per-vertex weight sum <= 255. */
export function validateTerrainGrid(grid) {
  checkGridShape(grid);
  checkGridRing(grid);
  const weights = grid.weights;
  for (let w = 0; w < weights.length; w += 4)
    if (weights[w] + weights[w + 1] + weights[w + 2] + weights[w + 3] > 255) fail('material_weight');
  return grid;
}

/**
 * Compile a grid exactly as compileTerrainMap compiles terrain v1/v2 (same compile, same map fields).
 * For a grid, map.terrain holds the grid object itself (the same reference, not a copy); heights and paint are
 * copies, so later edits of the grid never reach a compiled map.
 */
export function compileTerrainGrid(baseMap, grid) {
  validateTerrainGrid(grid);
  const { Nx, Nz, count } = gridFor(baseMap, grid, false);
  const { deltasMm, weights } = grid;
  let hasHeights = false, hasPaint = false;
  for (let k = 0; k < count; k++) if (deltasMm[k] !== 0) { hasHeights = true; break; }
  for (let w = 0; w < weights.length; w++) if (weights[w] !== 0) { hasPaint = true; break; }
  if (!hasHeights && !hasPaint) return { ...baseMap, gmTerrain: false, terrain: grid };
  const heights = hasHeights ? new Float32Array(baseMap.heights) : baseMap.heights;
  const changedCells = new Uint8Array((Nx - 1) * (Nz - 1));
  if (hasHeights) for (let k = 0; k < count; k++) {
    const deltaMm = deltasMm[k];
    if (deltaMm === 0) continue;
    heights[k] += deltaMm / 1000;
    markChangedCells(changedCells, k, Nx, Nz);
  }
  return projectTerrain(baseMap, heights, changedCells, hasPaint ? new Uint8Array(weights) : null, grid);
}

const FREE = 0, GROUND = 1, UNKNOWN = 255;
const FORBIDDEN = Object.freeze([null, 'protected_ground', 'protected_route', 'protected_area']);
const editPolicyCache = new WeakMap();

// The GM05 rules of validateTerrainForMap per vertex of a base map, filled on first use and cached per map like
// protectedMask: codes[k] is 0 free, 1 protected_ground (dock, lawless, base ground < 0.75 m), 2 protected_route,
// 3 protected_area; ground[k] is the base groundAt, for the after < 0.75 m rule. A map whose groundAt was replaced
// gets a new policy; otherwise the base map must not change once it has been validated.
function editPolicy(baseMap, g) {
  let policy = editPolicyCache.get(baseMap);
  if (!policy || policy.groundAt !== baseMap.groundAt) {
    policy = { groundAt: baseMap.groundAt, codes: new Uint8Array(g.count).fill(UNKNOWN),
      ground: new Float64Array(g.count), mask: protectedMask(baseMap).mask };
    editPolicyCache.set(baseMap, policy);
  }
  return policy;
}

function baseCode(baseMap, policy, g, k) {
  let code = policy.codes[k];
  if (code !== UNKNOWN) return code;
  const i = k % g.Nx, j = (k - i) / g.Nx;
  const x = g.minX + i, z = g.minZ + j, before = baseMap.groundAt(x, z);
  policy.ground[k] = before;
  if (baseMap.onDock?.(x, z) || baseMap.lawlessAt?.(x, z) || before < TERRAIN_MIN_HEIGHT) code = GROUND;
  else {
    const masks = baseMap.masks?.(x, z);
    code = baseMap.pathInfo?.(x, z)?.d < 2 || baseMap.trailInfo?.(x, z)?.d < 2 ||
      (masks && (masks.arenaFloor > 0 || masks.lava > 0 || masks.volcanic > 0)) ? 2 : policy.mask[k] ? 3 : FREE;
  }
  policy.codes[k] = code;
  return code;
}

// Same precedence as validateTerrainForMap: ground (including after < 0.75 m), then route, then area.
function vertexCode(baseMap, policy, g, deltasMm, k) {
  const code = baseCode(baseMap, policy, g, k);
  if (code === GROUND) return GROUND;
  const deltaMm = deltasMm[k];
  return deltaMm !== 0 && policy.ground[k] + deltaMm / 1000 < TERRAIN_MIN_HEIGHT ? GROUND : code;
}

// Rows to check as [j, i0, i1] triples in ascending vertex order: the whole grid, or the union of the dirty tiles.
function checkedRows(g, dirtyTiles) {
  const { Nx, Nz } = g, lastI = Nx - 1, lastJ = Nz - 1;
  if (dirtyTiles === undefined) {
    const rows = new Int32Array(Nz * 3);
    for (let j = 0; j < Nz; j++) { rows[j * 3] = j; rows[j * 3 + 2] = lastI; }
    return rows;
  }
  if (!Array.isArray(dirtyTiles)) fail('tile_key');
  // Tiles of the grid: the far ring (x = maxX or z = maxZ) belongs to none, so -4..3 for the 561 grid.
  const firstX = Math.floor(g.minX / TERRAIN_TILE_SIZE), lastX = Math.floor((g.maxX - 1) / TERRAIN_TILE_SIZE);
  const firstZ = Math.floor(g.minZ / TERRAIN_TILE_SIZE), lastZ = Math.floor((g.maxZ - 1) / TERRAIN_TILE_SIZE);
  const tiles = new Map();
  for (const key of dirtyTiles) {
    const match = typeof key === 'string' ? TILE_KEY.exec(key) : null;
    if (!match) fail('tile_key');
    const tx = Number(match[1]), tz = Number(match[2]);
    if (tx < firstX || tx > lastX || tz < firstZ || tz > lastZ) fail('tile_key');
    const i0 = TERRAIN_TILE_SIZE * tx - g.minX, j0 = TERRAIN_TILE_SIZE * tz - g.minZ;
    tiles.set(j0 * (Nx + TERRAIN_TILE_SIZE) + i0, [i0, j0]);
  }
  const sorted = [...tiles.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const rows = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end < sorted.length && sorted[end][1] === sorted[start][1]) end++;
    const j0 = sorted[start][1];
    for (let j = Math.max(0, j0); j <= Math.min(lastJ, j0 + TERRAIN_TILE_SIZE - 1); j++)
      for (let t = start; t < end; t++)
        rows.push(j, Math.max(0, sorted[t][0]), Math.min(lastI, sorted[t][0] + TERRAIN_TILE_SIZE - 1));
    start = end;
  }
  return Int32Array.from(rows);
}

/**
 * The GM05 edit rules of validateTerrainForMap for a grid, with the same error codes: every vertex with a height
 * delta or any paint weight needs a free 3x3 neighbourhood. Plus the D4 range: the compiled height of every vertex
 * with a delta lies in [-40, +200] m (height_range). Without options the whole grid is checked; with
 * { dirtyTiles: ['tx,tz', ...] } only those tiles are (the outer ring always), so the cost follows the tiles and the
 * rest of the grid must have passed before. Returns the grid.
 */
export function validateTerrainGridForMap(baseMap, grid, { dirtyTiles } = {}) {
  checkGridShape(grid);
  const g = gridFor(baseMap, grid, true), { Nx, Nz } = g;
  checkGridRing(grid);
  const rows = checkedRows(g, dirtyTiles);
  const { deltasMm, weights } = grid, heights = baseMap.heights;
  for (let r = 0; r < rows.length; r += 3) {
    const row = rows[r] * Nx;
    for (let k = row + rows[r + 1], end = row + rows[r + 2]; k <= end; k++) {
      const w = k * 4;
      if (weights[w] + weights[w + 1] + weights[w + 2] + weights[w + 3] > 255) fail('material_weight');
      const deltaMm = deltasMm[k];
      if (deltaMm === 0) continue;
      const height = Math.fround(heights[k] + deltaMm / 1000);
      if (!(height >= TERRAIN_GRID_MIN_HEIGHT && height <= TERRAIN_GRID_MAX_HEIGHT)) fail('height_range');
    }
  }
  const policy = editPolicy(baseMap, g);
  for (let r = 0; r < rows.length; r += 3) {
    const j = rows[r];
    for (let i = rows[r + 1], end = rows[r + 2]; i <= end; i++) {
      if (!touched(deltasMm, weights, j * Nx + i)) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xIndex = i + dx, zIndex = j + dz;
        if (xIndex < 0 || xIndex >= Nx || zIndex < 0 || zIndex >= Nz) continue;
        const code = vertexCode(baseMap, policy, g, deltasMm, zIndex * Nx + xIndex);
        if (code !== FREE) fail(FORBIDDEN[code]);
      }
    }
  }
  return grid;
}

/**
 * Vertices of a base map an edit may touch: off the outer ring, with no vertex of the 3x3 neighbourhood forbidden by
 * the base rules. An edit there still needs after >= 0.75 m and the height range. Fills the policy cache.
 */
export function terrainEditableMask(baseMap) {
  const g = sampledGridOf(baseMap), { Nx, Nz, count } = g;
  const policy = editPolicy(baseMap, g), codes = policy.codes, mask = new Uint8Array(count);
  for (let k = 0; k < count; k++) baseCode(baseMap, policy, g, k);
  for (let j = 1; j < Nz - 1; j++) for (let i = 1; i < Nx - 1; i++) {
    let free = 1;
    for (let dz = -1; dz <= 1 && free; dz++) for (let dx = -1; dx <= 1; dx++)
      if (codes[(j + dz) * Nx + i + dx] !== FREE) { free = 0; break; }
    mask[j * Nx + i] = free;
  }
  return mask;
}

/** GM08: the distance in metres over which a brush fades out before a vertex it may not touch. */
export const TERRAIN_EDIT_FEATHER = 4;
const editWeightCache = new WeakMap();

/**
 * GM08: the share of a stroke each vertex takes, so a brush of any size stops softly at docks, paths, services, the
 * shore and the outer ring instead of refusing the whole stroke: 0 off terrainEditableMask, rising with a smoothstep
 * to 1 at TERRAIN_EDIT_FEATHER m (chamfer distance) from the nearest vertex off the mask. Cached per base map (as the
 * edit policy); the caller must not modify the returned array.
 */
export function terrainEditWeights(baseMap) {
  const cached = editWeightCache.get(baseMap);
  if (cached && cached.groundAt === baseMap.groundAt) return cached.weights;
  const mask = terrainEditableMask(baseMap), { Nx, Nz, count } = terrainGridOf(baseMap), distance = new Float32Array(count);
  for (let k = 0; k < count; k++) distance[k] = mask[k] ? Infinity : 0;
  // Two chamfer passes (1 and sqrt 2): distance to the nearest vertex off the mask, exact enough below a few metres.
  for (let j = 0; j < Nz; j++) for (let i = 0, k = j * Nx; i < Nx; i++, k++) {
    if (distance[k] === 0) continue;
    let d = distance[k];
    if (i > 0) d = Math.min(d, distance[k - 1] + 1);
    if (j > 0) d = Math.min(d, distance[k - Nx] + 1, i > 0 ? distance[k - Nx - 1] + Math.SQRT2 : d, i < Nx - 1 ? distance[k - Nx + 1] + Math.SQRT2 : d);
    distance[k] = d;
  }
  for (let j = Nz - 1; j >= 0; j--) for (let i = Nx - 1, k = j * Nx + i; i >= 0; i--, k--) {
    if (distance[k] === 0) continue;
    let d = distance[k];
    if (i < Nx - 1) d = Math.min(d, distance[k + 1] + 1);
    if (j < Nz - 1) d = Math.min(d, distance[k + Nx] + 1, i < Nx - 1 ? distance[k + Nx + 1] + Math.SQRT2 : d, i > 0 ? distance[k + Nx - 1] + Math.SQRT2 : d);
    distance[k] = d;
  }
  const weights = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const t = Math.min(1, distance[k] / TERRAIN_EDIT_FEATHER);
    weights[k] = t * t * (3 - 2 * t);
  }
  editWeightCache.set(baseMap, { groundAt: baseMap.groundAt, weights });
  return weights;
}
