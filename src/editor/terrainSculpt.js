import { validateDocument } from './document.js';
import { compileTerrainMap, TERRAIN_GRID_SIZE, TERRAIN_GRID_MAX_HEIGHT, TERRAIN_MAX_DELTA_MM, TERRAIN_MIN_HEIGHT,
  validateTerrainForMap } from './terrainData.js';
import { gmEditableBaseProps } from './baseIdentity.js';
import { brushParameters, brushWeight, strokePath } from './terrainBrush.js';

const fail = code => { const error = new TypeError(`Terrain sculpt failed: ${code}`); error.code = code; throw error; };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function checkedInput({ map, document, baseRevision, tool, points, radius = 6, strength = .5, falloff = .5, shape = 'circle', aspect = .5, rotation = 0, level = 2.4 }) {
  const doc = validateDocument(document);
  if (!map || !Number.isSafeInteger(map.seed) || doc.base.seed !== (map.seed >>> 0) ||
      doc.base.revision !== baseRevision || typeof baseRevision !== 'string') fail('base_mismatch');
  if (!['raise', 'lower', 'flatten', 'smooth', 'ramp'].includes(tool)) fail('tool');
  if (!Array.isArray(points) || points.length < (tool === 'ramp' ? 2 : 1) ||
      (tool === 'ramp' && points.length !== 2) ||
      points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) > map.half || Math.abs(p.z) > map.half)) fail('points');
  try { brushParameters({ radius, strength, falloff, shape, aspect, rotation }); }
  catch { fail('parameters'); }
  // GM07 D4: flatten reaches the [-40, +200] m range; the 0.75 m floor stays.
  if (!Number.isFinite(level) || level < TERRAIN_MIN_HEIGHT || level > TERRAIN_GRID_MAX_HEIGHT) fail('parameters');
  if (tool === 'ramp' && dist(points[0], points[1]) < .25) fail('ramp_length');
  return { doc, tool, points, radius, strength, falloff, shape, aspect, rotation, level };
}

function weight(distance, radius, falloff) {
  if (distance > radius) return 0;
  const t = distance / radius;
  const hard = t <= falloff ? 1 : 1 - (t - falloff) / Math.max(1e-9, 1 - falloff);
  return hard * hard * (3 - 2 * hard);
}

function rampHeight(point, a, b, hA, hB) {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2, 0, 1);
  return hA + (hB - hA) * t;
}

function rampDistance(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2, 0, 1);
  return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

function originalHeight(map, index) {
  return map.heights[index];
}

// The per-vertex rule of every sculpt tool, shared by the sparse document and the grid entry points.
function strokeTarget({ tool, strength, level, points }, sampleHeight, i, j, x, z, influence, rampEndpoints) {
  const current = sampleHeight(i, j);
  if (tool === 'raise') return current + strength * influence;
  if (tool === 'lower') return current - strength * influence;
  if (tool === 'flatten') return current + (level - current) * strength * influence;
  if (tool === 'smooth') {
    let sum = 0, n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const xx = clamp(i + dx, 0, 560), zz = clamp(j + dz, 0, 560); sum += sampleHeight(xx, zz); n++;
    }
    return current + (sum / n - current) * strength * influence;
  }
  const ramp = rampHeight({ x, z }, points[0], points[1], rampEndpoints[0], rampEndpoints[1]);
  return current + (ramp - current) * influence;
}

const squareReach = (shape, radius, rotation) => shape === 'square'
  ? radius * (Math.abs(Math.cos(rotation * Math.PI / 180)) + Math.abs(Math.sin(rotation * Math.PI / 180))) : radius;

/**
 * Editor decorations and editable base props keep their height above ground across a terrain change: each moves by
 * the ground difference at its position between beforeMap and afterMap. Returns { baseOverrides, objects }.
 */
export function followGround(doc, map, baseRevision, beforeMap, afterMap) {
  const baseRevisionProps = gmEditableBaseProps(map, baseRevision);
  const baseById = new Map(baseRevisionProps.map(entry => [entry.id, entry.prop]));
  const baseOverrideById = new Map(doc.baseOverrides.map((item, index) => [item.id, index]));
  const baseOverrides = doc.baseOverrides.map(item => {
    const prop = baseById.get(item.id);
    if (!prop || item.hidden) return item;
    const x = item.transform.position.x, z = item.transform.position.z;
    return { ...item, transform: { ...item.transform, position: { ...item.transform.position,
      y: item.transform.position.y + afterMap.groundAt(x, z) - beforeMap.groundAt(x, z) } } };
  });
  for (const { id, prop } of baseRevisionProps) {
    if (baseOverrideById.has(id)) continue;
    const dy = afterMap.groundAt(prop.x, prop.z) - beforeMap.groundAt(prop.x, prop.z);
    if (Math.abs(dy) < 1e-9) continue;
    baseOverrides.push({ id, hidden: false, transform: {
      position: { x: prop.x, y: prop.y + dy, z: prop.z },
      rotation: { x: 0, y: prop.rot, z: 0 }, scale: prop.scale,
    } });
  }
  const objects = doc.objects.map(item => {
    const x = item.transform.position.x, z = item.transform.position.z;
    return { ...item, transform: { ...item.transform, position: { ...item.transform.position,
      y: item.transform.position.y + afterMap.groundAt(x, z) - beforeMap.groundAt(x, z) } } };
  });
  return { baseOverrides, objects };
}

export function sculptTerrainDocument({ map, document, baseRevision, tool, points, radius = 6,
  strength = .5, falloff = .5, shape = 'circle', aspect = .5, rotation = 0, level = 2.4 } = {}) {
  const input = checkedInput({ map, document, baseRevision, tool, points, radius, strength, falloff, shape, aspect, rotation, level });
  const { doc } = input;
  const prior = doc.terrain || { version: 1, samples: [] };
  const beforeMap = compileTerrainMap(map, prior);
  const path = tool === 'ramp' ? [] : strokePath(points);
  const brush = brushParameters({ radius, strength, falloff, shape, aspect, rotation });
  const footprint = squareReach(shape, radius, rotation);
  const rampEndpoints = tool === 'ramp' ? [beforeMap.groundAt(points[0].x, points[0].z), beforeMap.groundAt(points[1].x, points[1].z)] : null;
  const minI = clamp(Math.floor(Math.min(...points.map(p => p.x)) + map.half - footprint - 1), 0, 560);
  const maxI = clamp(Math.ceil(Math.max(...points.map(p => p.x)) + map.half + footprint + 1), 0, 560);
  const minJ = clamp(Math.floor(Math.min(...points.map(p => p.z)) + map.half - footprint - 1), 0, 560);
  const maxJ = clamp(Math.ceil(Math.max(...points.map(p => p.z)) + map.half + footprint + 1), 0, 560);
  const smoothSource = beforeMap.heights;
  const newHeights = new Float32Array(smoothSource);
  const sampleHeight = (i, j) => smoothSource[j * TERRAIN_GRID_SIZE + i];
  for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
    const x = i - map.half, z = j - map.half, index = j * TERRAIN_GRID_SIZE + i;
    let influence = 0;
    // Ramps retain their legacy circular corridor, independent of brush shape.
    if (tool === 'ramp') influence = weight(rampDistance({ x, z }, points[0], points[1]), radius, falloff);
    else for (const center of path) influence = Math.max(influence, brushWeight(x - center.x, z - center.z, brush));
    if (influence <= 0) continue;
    newHeights[index] = strokeTarget(input, sampleHeight, i, j, x, z, influence, rampEndpoints);
  }
  const samples = [];
  for (let index = 0; index < newHeights.length; index++) {
    const delta = Math.round((newHeights[index] - originalHeight(map, index)) * 1000);
    if (delta) {
      if (Math.abs(delta) > TERRAIN_MAX_DELTA_MM) fail('delta_limit');
      samples.push([index, delta]);
    }
  }
  const terrain = { ...prior, version: prior.version === 2 ? 2 : 1, samples };
  if (samples.length > 20000) fail('sample_limit');
  const checkedTerrain = validateTerrainForMap(map, terrain);
  const afterMap = compileTerrainMap(map, checkedTerrain);

  // Preserve vertical offsets for editor decorations while the sample edits stay atomic.
  const { baseOverrides, objects } = followGround(doc, map, baseRevision, beforeMap, afterMap);
  return validateDocument({ ...doc, version: prior.version === 2 ? 4 : 3, terrain: checkedTerrain, baseOverrides, objects });
}

/**
 * GM07 grid entry point beside sculptTerrainDocument: the same tools, parameters and per-vertex rule over a dense
 * grid (terrainData.js createTerrainGrid). `map` is the base map, `surface` the compiled map of `grid` (the heights
 * the stroke starts from). The grid is not modified: the result is the patch of every vertex whose delta changes,
 * { indices, deltasMm } in ascending vertex order. No 12 m or 20,000-sample cap applies here; the caller validates
 * the patched grid (validateTerrainGridForMap) and owns tiles and history (terrainSession.js).
 */
export function sculptTerrainGrid({ map, surface, grid, document, baseRevision, tool, points, radius = 6,
  strength = .5, falloff = .5, shape = 'circle', aspect = .5, rotation = 0, level = 2.4 } = {}) {
  const input = checkedInput({ map, document, baseRevision, tool, points, radius, strength, falloff, shape, aspect, rotation, level });
  if (!(grid?.deltasMm instanceof Int32Array) || grid.deltasMm.length !== map.heights?.length ||
      surface?.heights?.length !== map.heights.length) fail('grid');
  const path = tool === 'ramp' ? [] : strokePath(points);
  const brush = brushParameters({ radius, strength, falloff, shape, aspect, rotation });
  const footprint = squareReach(shape, radius, rotation);
  const rampEndpoints = tool === 'ramp' ? [surface.groundAt(points[0].x, points[0].z), surface.groundAt(points[1].x, points[1].z)] : null;
  const minI = clamp(Math.floor(Math.min(...points.map(p => p.x)) + map.half - footprint - 1), 0, 560);
  const maxI = clamp(Math.ceil(Math.max(...points.map(p => p.x)) + map.half + footprint + 1), 0, 560);
  const minJ = clamp(Math.floor(Math.min(...points.map(p => p.z)) + map.half - footprint - 1), 0, 560);
  const maxJ = clamp(Math.ceil(Math.max(...points.map(p => p.z)) + map.half + footprint + 1), 0, 560);
  const width = maxI - minI + 1, influence = new Float64Array(width * (maxJ - minJ + 1));
  if (tool === 'ramp') {
    for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++)
      influence[(j - minJ) * width + i - minI] = weight(rampDistance({ x: i - map.half, z: j - map.half }, points[0], points[1]), radius, falloff);
  } else {
    // Each path sample only reaches its own footprint window: the same maximum as the document loop, at stroke cost.
    for (const center of path) {
      const i0 = clamp(Math.floor(center.x + map.half - footprint - 1), minI, maxI), i1 = clamp(Math.ceil(center.x + map.half + footprint + 1), minI, maxI);
      const j0 = clamp(Math.floor(center.z + map.half - footprint - 1), minJ, maxJ), j1 = clamp(Math.ceil(center.z + map.half + footprint + 1), minJ, maxJ);
      for (let j = j0; j <= j1; j++) for (let i = i0, n = (j - minJ) * width + i0 - minI; i <= i1; i++, n++) {
        const value = brushWeight(i - map.half - center.x, j - map.half - center.z, brush);
        if (value > influence[n]) influence[n] = value;
      }
    }
  }
  const heights = surface.heights, sampleHeight = (i, j) => heights[j * TERRAIN_GRID_SIZE + i];
  const indices = [], deltas = [];
  for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
    const amount = influence[(j - minJ) * width + i - minI];
    if (amount <= 0) continue;
    const index = j * TERRAIN_GRID_SIZE + i;
    const target = strokeTarget(input, sampleHeight, i, j, i - map.half, j - map.half, amount, rampEndpoints);
    const delta = Math.round((Math.fround(target) - originalHeight(map, index)) * 1000);
    if (delta !== grid.deltasMm[index]) { indices.push(index); deltas.push(delta); }
  }
  return { indices: Int32Array.from(indices), deltasMm: Int32Array.from(deltas) };
}
