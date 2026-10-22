import { validateDocument } from './document.js';
import { TERRAIN_GRID_SIZE, TERRAIN_MAX_SAMPLES, TERRAIN_MATERIALS, validateTerrainForMap } from './terrainData.js';
import { brushParameters, brushWeight, strokePath } from './terrainBrush.js';

const fail = code => { throw Object.assign(new TypeError(`Terrain paint failed: ${code}`), { code }); };

// Include the automatic channel in largest-remainder quantization: every blend sums to 255.
function blendWeights(old, channel, amount) {
  const values = [...old, 255 - old.reduce((a, b) => a + b, 0)]
    .map((weight, i) => weight * (1 - amount) + (i === channel ? 255 * amount : 0));
  const quantized = values.map(Math.floor);
  const order = values.map((value, i) => ({ i, remainder: value - quantized[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const remaining = 255 - quantized.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) quantized[order[i].i]++;
  return quantized.slice(0, 4);
}

function checkedStroke(map, doc, baseRevision, points, tool, material) {
  if (!map || !Number.isSafeInteger(map.seed) || doc.base.seed !== (map.seed >>> 0) ||
      typeof baseRevision !== 'string' || doc.base.revision !== baseRevision) fail('base_mismatch');
  if (!['paint', 'erase'].includes(tool) || !TERRAIN_MATERIALS.includes(material)) fail('tool');
  if (!Array.isArray(points) || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.z) ||
      Math.abs(p.x) > map.half || Math.abs(p.z) > map.half)) fail('points');
}

// Strongest brush weight per vertex over the stroke path; `skip(index)` leaves a vertex out (erase on bare ground).
function strokeInfluence(map, path, brush, skip, limit = Infinity) {
  const influence = new Map(), reach = brush.radius * (brush.shape === 'square' ? Math.SQRT2 : 1);
  for (const center of path) {
    const minI = Math.max(0, Math.ceil(center.x + map.half - reach)), maxI = Math.min(560, Math.floor(center.x + map.half + reach));
    const minJ = Math.max(0, Math.ceil(center.z + map.half - reach)), maxJ = Math.min(560, Math.floor(center.z + map.half + reach));
    for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
      const index = j * TERRAIN_GRID_SIZE + i;
      if (skip(index)) continue;
      const weight = brushWeight(i - map.half - center.x, j - map.half - center.z, brush);
      if (weight > (influence.get(index) || 0)) influence.set(index, weight);
      if (influence.size > limit) fail('material_limit');
    }
  }
  return influence;
}

/** Apply one atomic authoring stroke; repeated samples do not accumulate pressure within a stroke. */
export function paintTerrainDocument({ map, document, baseRevision, points, tool = 'paint', material = 'grass', ...options } = {}) {
  const doc = validateDocument(document), brush = brushParameters(options);
  checkedStroke(map, doc, baseRevision, points, tool, material);
  const path = strokePath(points), prior = doc.terrain || { version: 1, samples: [] };
  const materials = new Map((prior.materials || []).map(([index, ...weights]) => [index, weights]));
  const influence = strokeInfluence(map, path, brush, index => tool === 'erase' && !materials.has(index),
    tool === 'paint' ? TERRAIN_MAX_SAMPLES : Infinity);
  for (const [index, weight] of influence) {
    const next = blendWeights(materials.get(index) || [0, 0, 0, 0],
      tool === 'erase' ? 4 : TERRAIN_MATERIALS.indexOf(material), weight * brush.strength);
    if (next.some(Boolean)) materials.set(index, next); else materials.delete(index);
  }
  const entries = [...materials].sort((a, b) => a[0] - b[0]).map(([index, weights]) => [index, ...weights]);
  if (JSON.stringify(entries) === JSON.stringify(prior.materials || [])) return doc;
  const terrain = validateTerrainForMap(map, { version: 2, samples: prior.samples, materials: entries });
  return validateDocument({ ...doc, version: 4, terrain });
}

/**
 * GM07 grid entry point beside paintTerrainDocument: the same stroke and blend over the four weights per vertex of
 * a dense grid (grass, dirt, sand, rock). The grid is not modified: the result is the patch of every vertex whose
 * weights change, { indices, weights } (four bytes per index) in ascending vertex order. No 20,000-vertex cap
 * applies; the caller validates the patched grid and owns tiles and history (terrainSession.js).
 */
export function paintTerrainGrid({ map, grid, document, baseRevision, points, tool = 'paint', material = 'grass', ...options } = {}) {
  const doc = validateDocument(document), brush = brushParameters(options);
  checkedStroke(map, doc, baseRevision, points, tool, material);
  if (!(grid?.weights instanceof Uint8Array) || grid.weights.length !== TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE * 4) fail('grid');
  const weights = grid.weights, painted = index => {
    const w = index * 4;
    return weights[w] !== 0 || weights[w + 1] !== 0 || weights[w + 2] !== 0 || weights[w + 3] !== 0;
  };
  const influence = strokeInfluence(map, strokePath(points), brush, index => tool === 'erase' && !painted(index));
  const channel = tool === 'erase' ? 4 : TERRAIN_MATERIALS.indexOf(material), changes = [];
  for (const [index, weight] of influence) {
    const w = index * 4, old = [weights[w], weights[w + 1], weights[w + 2], weights[w + 3]];
    const next = blendWeights(old, channel, weight * brush.strength);
    if (next.some((value, c) => value !== old[c])) changes.push([index, next]);
  }
  changes.sort((a, b) => a[0] - b[0]);
  const indices = new Int32Array(changes.length), values = new Uint8Array(changes.length * 4);
  changes.forEach(([index, next], n) => { indices[n] = index; values.set(next, n * 4); });
  return { indices, weights: values };
}
