import { validateDocument } from './document.js';
import { compileTerrainMap, TERRAIN_GRID_SIZE, TERRAIN_MAX_DELTA_MM, validateTerrainForMap } from './terrainData.js';
import { gmEditableBaseProps } from './baseIdentity.js';

const MAX_STROKE_POINTS = 2048;
const fail = code => { const error = new TypeError(`Terrain sculpt failed: ${code}`); error.code = code; throw error; };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function checkedInput({ map, document, baseRevision, tool, points, radius = 6, strength = .5, falloff = .5, level = 2.4 }) {
  const doc = validateDocument(document);
  if (!map || !Number.isSafeInteger(map.seed) || doc.base.seed !== (map.seed >>> 0) ||
      doc.base.revision !== baseRevision || typeof baseRevision !== 'string') fail('base_mismatch');
  if (!['raise', 'lower', 'flatten', 'smooth', 'ramp'].includes(tool)) fail('tool');
  if (!Array.isArray(points) || points.length < (tool === 'ramp' ? 2 : 1) ||
      (tool === 'ramp' && points.length !== 2) || points.length > MAX_STROKE_POINTS ||
      points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) > map.half || Math.abs(p.z) > map.half)) fail('points');
  if (!Number.isFinite(radius) || radius < 2 || radius > 24 || !Number.isFinite(strength) || strength <= 0 || strength > 1 ||
      !Number.isFinite(falloff) || falloff < 0 || falloff > 1 || !Number.isFinite(level) || level < .75 || level > 100) fail('parameters');
  if (tool === 'ramp' && dist(points[0], points[1]) < .25) fail('ramp_length');
  return { doc, points, radius, strength, falloff, level };
}

function strokePath(points) {
  const path = [points[0]];
  for (let n = 1; n < points.length; n++) {
    const a = points[n - 1], b = points[n], length = dist(a, b), count = Math.max(1, Math.ceil(length / .5));
    for (let s = 1; s <= count; s++) path.push({ x: a.x + (b.x - a.x) * s / count, z: a.z + (b.z - a.z) * s / count });
  }
  return path;
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

export function sculptTerrainDocument({ map, document, baseRevision, tool, points, radius = 6,
  strength = .5, falloff = .5, level = 2.4 } = {}) {
  const input = checkedInput({ map, document, baseRevision, tool, points, radius, strength, falloff, level });
  const { doc } = input;
  const prior = doc.terrain || { version: 1, samples: [] };
  const beforeMap = compileTerrainMap(map, prior);
  const path = tool === 'ramp' ? [] : strokePath(points);
  const rampEndpoints = tool === 'ramp' ? [beforeMap.groundAt(points[0].x, points[0].z), beforeMap.groundAt(points[1].x, points[1].z)] : null;
  const minI = clamp(Math.floor(Math.min(...points.map(p => p.x)) + map.half - radius - 1), 0, 560);
  const maxI = clamp(Math.ceil(Math.max(...points.map(p => p.x)) + map.half + radius + 1), 0, 560);
  const minJ = clamp(Math.floor(Math.min(...points.map(p => p.z)) + map.half - radius - 1), 0, 560);
  const maxJ = clamp(Math.ceil(Math.max(...points.map(p => p.z)) + map.half + radius + 1), 0, 560);
  const smoothSource = beforeMap.heights;
  const newHeights = new Float32Array(smoothSource);
  const sampleHeight = (i, j) => smoothSource[j * TERRAIN_GRID_SIZE + i];
  for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
    const x = i - map.half, z = j - map.half, index = j * TERRAIN_GRID_SIZE + i;
    let influence = 0;
    if (tool === 'ramp') influence = weight(rampDistance({ x, z }, points[0], points[1]), radius, falloff);
    else for (const center of path) influence = Math.max(influence, weight(Math.hypot(x - center.x, z - center.z), radius, falloff));
    if (influence <= 0) continue;
    const current = sampleHeight(i, j);
    let target = current;
    if (tool === 'raise') target = current + strength * influence;
    else if (tool === 'lower') target = current - strength * influence;
    else if (tool === 'flatten') target = current + (level - current) * strength * influence;
    else if (tool === 'smooth') {
      let sum = 0, n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = clamp(i + dx, 0, 560), zz = clamp(j + dz, 0, 560); sum += sampleHeight(xx, zz); n++;
      }
      target = current + (sum / n - current) * strength * influence;
    } else {
      const ramp = rampHeight({ x, z }, points[0], points[1], rampEndpoints[0], rampEndpoints[1]);
      target = current + (ramp - current) * influence;
    }
    newHeights[index] = target;
  }
  const samples = [];
  for (let index = 0; index < newHeights.length; index++) {
    const delta = Math.round((newHeights[index] - originalHeight(map, index)) * 1000);
    if (delta) {
      if (Math.abs(delta) > TERRAIN_MAX_DELTA_MM) fail('delta_limit');
      samples.push([index, delta]);
    }
  }
  const terrain = { version: 1, samples };
  if (samples.length > 20000) fail('sample_limit');
  const checkedTerrain = validateTerrainForMap(map, terrain);
  const afterMap = compileTerrainMap(map, checkedTerrain);

  // Preserve vertical offsets for editor decorations while the sample edits stay atomic.
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
  return validateDocument({ ...doc, version: 3, terrain: checkedTerrain, baseOverrides, objects });
}
