import { gmEditableBaseProps } from './baseIdentity.js';
import { resourceLayout } from '../data/resources.js';

export const TERRAIN_VERSION = 1;
export const TERRAIN_GRID_SEGMENTS = 560;
export const TERRAIN_GRID_SIZE = TERRAIN_GRID_SEGMENTS + 1;
export const TERRAIN_SAMPLE_COUNT = TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE;
export const TERRAIN_MAX_SAMPLES = 20000;
export const TERRAIN_MAX_DELTA_MM = 12000;
export const TERRAIN_MIN_HEIGHT = 0.75;

function fail(code) { const error = new TypeError(`Invalid terrain: ${code}`); error.code = code; throw error; }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function validateTerrain(raw) {
  if (!record(raw) || Object.keys(raw).length !== 2 || raw.version !== TERRAIN_VERSION || !Array.isArray(raw.samples)) fail('format');
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
  return { version: TERRAIN_VERSION, samples };
}

function heightFrom(heights, i, j) { return heights[j * TERRAIN_GRID_SIZE + i]; }

function triangleHeight(heights, i, j, tx, tz) {
  const h00 = heightFrom(heights, i, j), h10 = heightFrom(heights, i + 1, j);
  const h01 = heightFrom(heights, i, j + 1), h11 = heightFrom(heights, i + 1, j + 1);
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
  const mask = new Uint8Array(TERRAIN_SAMPLE_COUNT);
  for (const p of points) {
    const radius = p.radius + 2, cx = p.x + map.half, cz = p.z + map.half;
    for (let j = Math.max(0, Math.ceil(cz - radius)); j <= Math.min(TERRAIN_GRID_SEGMENTS, Math.floor(cz + radius)); j++)
      for (let i = Math.max(0, Math.ceil(cx - radius)); i <= Math.min(TERRAIN_GRID_SEGMENTS, Math.floor(cx + radius)); i++)
        if (Math.hypot(i - cx, j - cz) < radius) mask[j * TERRAIN_GRID_SIZE + i] = 1;
  }
  const result = { points, mask };
  policyCache.set(map, result);
  return result;
}

export function validateTerrainForMap(baseMap, terrain) {
  const checked = validateTerrain(terrain);
  if (!baseMap || baseMap.size !== TERRAIN_GRID_SEGMENTS || baseMap.N !== TERRAIN_GRID_SIZE ||
      baseMap.res !== 1 || !baseMap.heights || baseMap.heights.length !== TERRAIN_SAMPLE_COUNT ||
      typeof baseMap.groundAt !== 'function') fail('base_map');
  const { mask: protectedAreas } = protectedMask(baseMap);
  const sampleDeltas = new Map(checked.samples);
  const checkedIndices = new Set();
  for (const [index] of checked.samples) {
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

export function compileTerrainMap(baseMap, terrain) {
  const checked = validateTerrain(terrain);
  if (!baseMap || baseMap.size !== TERRAIN_GRID_SEGMENTS || baseMap.N !== TERRAIN_GRID_SIZE ||
      baseMap.res !== 1 || !baseMap.heights || baseMap.heights.length !== TERRAIN_SAMPLE_COUNT) fail('base_map');
  if (checked.samples.length === 0) return { ...baseMap, gmTerrain: false, terrain: checked };
  const heights = new Float32Array(baseMap.heights);
  const changedCells = new Uint8Array(TERRAIN_GRID_SEGMENTS * TERRAIN_GRID_SEGMENTS);
  for (const [index, deltaMm] of checked.samples) heights[index] += deltaMm / 1000;
  for (const [index] of checked.samples) {
    const i = index % TERRAIN_GRID_SIZE, j = Math.floor(index / TERRAIN_GRID_SIZE);
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const ci = i + dx, cj = j + dz;
      if (ci >= 0 && ci < TERRAIN_GRID_SEGMENTS && cj >= 0 && cj < TERRAIN_GRID_SEGMENTS)
        changedCells[cj * TERRAIN_GRID_SEGMENTS + ci] = 1;
    }
  }
  const half = baseMap.half;
  const heightAt = (x, z) => {
    const wx = x + half, wz = z + half;
    if (wx < 0 || wx > TERRAIN_GRID_SEGMENTS || wz < 0 || wz > TERRAIN_GRID_SEGMENTS) return baseMap.heightAt(x, z);
    const fx = Math.min(TERRAIN_GRID_SEGMENTS - 1e-7, wx), fz = Math.min(TERRAIN_GRID_SEGMENTS - 1e-7, wz);
    const i = Math.floor(fx), j = Math.floor(fz);
    if (!changedCells[j * TERRAIN_GRID_SEGMENTS + i]) return baseMap.heightAt(x, z);
    return triangleHeight(heights, i, j, fx - i, fz - j);
  };
  const groundAt = (x, z) => {
    if (!isAffected(x, z)) return baseMap.groundAt(x, z);
    return baseMap.onDock?.(x, z) ? Math.max(heightAt(x, z), baseMap.dock?.deckY ?? 1.05) : heightAt(x, z);
  };
  function isAffected(x, z) {
    const wx = x + half, wz = z + half;
    if (wx < 0 || wx > TERRAIN_GRID_SEGMENTS || wz < 0 || wz > TERRAIN_GRID_SEGMENTS) return false;
    const i = Math.floor(Math.min(TERRAIN_GRID_SEGMENTS - 1e-7, wx));
    const j = Math.floor(Math.min(TERRAIN_GRID_SEGMENTS - 1e-7, wz));
    return !!changedCells[j * TERRAIN_GRID_SEGMENTS + i];
  }
  const materialAt = (x, z) => {
    if (!isAffected(x, z)) return baseMap.materialAt(x, z);
    if (baseMap.onDock?.(x, z)) return 'wood';
    const h = groundAt(x, z);
    if (h < -.05) return 'water';
    const m = baseMap.masks?.(x, z) || {};
    if (m.volcanic > .5 || m.arenaFloor > .5) return 'rock';
    if (m.path > .5) return 'dirt';
    return h < 1.5 ? 'sand' : 'grass';
  };
  const hasTerrain = checked.samples.length > 0;
  return { ...baseMap, heights, heightAt, groundAt, materialAt,
    ...(hasTerrain ? { fullsegments: TERRAIN_GRID_SEGMENTS } : {}),
    gmTerrain: hasTerrain, terrain: checked,
    terrainProjection: true, terrainSource: baseMap.terrainSource || baseMap };
}
