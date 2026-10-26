import { mapBounds } from '../sim/mapBounds.js';
import { brushParameters, brushOutline, brushWeight, strokePath } from './terrainBrush.js';
import { createDecoration, validateDocument } from './document.js';
import { OBJECT_MAX_Y } from './terrainData.js';

export const MAX_SCATTER_POINTS = 256;
export const MAX_SCATTER_CANDIDATES = 20_000;
export const MAX_SCATTER_OBJECTS = 120;
export const MAX_SCATTER_TRIANGLES = 250_000;
export const MAX_SCATTER_PRIMITIVES = 256;
export const MAX_PUBLISHED_EDITS = 1_000;
export const MAX_AUTHORED_TRIANGLES = 1_000_000;
export const MAX_AUTHORED_PRIMITIVES = 1_024;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const fail = (code) => { throw Object.assign(new TypeError(`Invalid GM scatter: ${code}`), { code: `scatter_${code}` }); };
const validated = new WeakSet();

/** Validate the shared brush controls plus bounded scatter density, spacing and scale. */
export function scatterParameters({ radius = 6, strength = .5, falloff = .5, shape = 'circle', aspect = .5,
  rotation = 0, spacing = 3, scaleMin = .8, scaleMax = 1.2, seed = 1 } = {}) {
  let brush;
  try { brush = brushParameters({ radius, strength, falloff, shape, aspect, rotation }); }
  catch { fail('parameters'); }
  if (!finite(spacing) || spacing < .5 || spacing > 48 || !finite(scaleMin) || scaleMin < .1 || scaleMin > 10 ||
      !finite(scaleMax) || scaleMax < scaleMin || scaleMax > 10 || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    fail('parameters');
  }
  const result = Object.freeze({ ...brush, spacing, scaleMin, scaleMax, seed });
  validated.add(result);
  return result;
}

function parametersOf(value) {
  return value && validated.has(value) ? value : scatterParameters(value);
}

function metricsOf(metrics) {
  if (!metrics || !Number.isSafeInteger(metrics.triangles) || metrics.triangles < 1 ||
      !Number.isSafeInteger(metrics.primitives) || metrics.primitives < 1 ||
      !finite(metrics.radius) || metrics.radius <= 0 || metrics.radius > 100) fail('metrics');
  return metrics;
}

function cellRandom(seed, x, z, channel = 0) {
  let value = (seed ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca77) ^ Math.imul(channel + 1, 0xc2b2ae3d)) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15; value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function brushExtents(params) {
  // Use the shared outline as the footprint source, then use exact support extents
  // so rotated square corners cannot be clipped between outline segments.
  const outline = brushOutline(params, 256);
  let x = Math.max(...outline.map((point) => Math.abs(point.x)));
  let z = Math.max(...outline.map((point) => Math.abs(point.z)));
  if (params.shape === 'square') {
    const angle = params.rotation * Math.PI / 180;
    const extent = params.radius * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
    x = Math.max(x, extent); z = Math.max(z, extent);
  } else if (params.shape === 'circle') {
    x = Math.max(x, params.radius); z = Math.max(z, params.radius);
  } else {
    const angle = params.rotation * Math.PI / 180, rx = params.radius, rz = params.radius * params.aspect;
    x = Math.max(x, Math.hypot(rx * Math.cos(angle), rz * Math.sin(angle)));
    z = Math.max(z, Math.hypot(rx * Math.sin(angle), rz * Math.cos(angle)));
  }
  return { x, z };
}

function checkedDocument(document) {
  const doc = validateDocument(document);
  if (doc.objects.length + doc.baseOverrides.length > MAX_PUBLISHED_EDITS) fail('document_limit');
  return doc;
}

function checkedExistingCost(cost = { triangles: 0, primitives: 0 }) {
  if (!cost || !Number.isSafeInteger(cost.triangles) || cost.triangles < 0 ||
      !Number.isSafeInteger(cost.primitives) || cost.primitives < 0) fail('existing_cost');
  return cost;
}

/** Produce deterministic, bounded positions. isAllowed owns the site's protected-footprint policy. */
export function planScatter({ map, document, assetId, points, parameters, metrics,
  existingCost = { triangles: 0, primitives: 0 }, isAllowed } = {}) {
  const params = parametersOf(parameters), model = metricsOf(metrics), doc = checkedDocument(document);
  const priorCost = checkedExistingCost(existingCost);
  if (priorCost.triangles > MAX_AUTHORED_TRIANGLES) fail('authored_triangle_limit');
  if (priorCost.primitives > MAX_AUTHORED_PRIMITIVES) fail('authored_primitive_limit');
  let edge;
  try { edge = mapBounds(map); } catch { fail('map'); }
  if (typeof map.groundAt !== 'function') fail('map');
  if (typeof assetId !== 'string' || !/^(?:model|prop):[A-Za-z0-9][A-Za-z0-9._:-]{0,156}$/.test(assetId)) fail('asset');
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_SCATTER_POINTS ||
      points.some((point) => !point || !finite(point.x) || !finite(point.z))) fail('points');
  if (typeof isAllowed !== 'function') fail('policy');

  const footprint = model.radius * params.scaleMax;
  const minX = edge.minX + footprint, maxX = edge.maxX - footprint;
  const minZ = edge.minZ + footprint, maxZ = edge.maxZ - footprint;
  let path;
  try { path = strokePath(points); }
  catch { fail('path_limit'); }
  if (path.length > 8_192) fail('path_limit');
  const extents = brushExtents(params);
  const bounds = path.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x - extents.x), maxX: Math.max(box.maxX, point.x + extents.x),
    minZ: Math.min(box.minZ, point.z - extents.z), maxZ: Math.max(box.maxZ, point.z + extents.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const step = params.spacing;
  const offsetX = cellRandom(params.seed, 0, 0, 0) * step, offsetZ = cellRandom(params.seed, 0, 0, 1) * step;
  const startX = Math.floor((bounds.minX - offsetX) / step), endX = Math.ceil((bounds.maxX - offsetX) / step);
  const startZ = Math.floor((bounds.minZ - offsetZ) / step), endZ = Math.ceil((bounds.maxZ - offsetZ) / step);
  const width = Math.max(0, endX - startX + 1), height = Math.max(0, endZ - startZ + 1);
  if (width * height > MAX_SCATTER_CANDIDATES) fail('candidate_limit');

  const occupied = doc.objects.map((item) => ({ x: item.transform.position.x, z: item.transform.position.z }));
  const minDistance2 = params.spacing * params.spacing;
  const placements = [];
  let skipped = 0;
  let triangles = 0, primitives = 0;
  for (let iz = startZ; iz <= endZ; iz++) for (let ix = startX; ix <= endX; ix++) {
    const jitterX = cellRandom(params.seed, ix, iz, 2), jitterZ = cellRandom(params.seed, ix, iz, 3);
    const x = ix * step + offsetX + (jitterX - .5) * step * .6;
    const z = iz * step + offsetZ + (jitterZ - .5) * step * .6;
    let weight = 0;
    for (const sample of path) {
      weight = Math.max(weight, brushWeight(x - sample.x, z - sample.z, params));
      if (weight >= 1) break;
    }
    if (!weight || cellRandom(params.seed, ix, iz, 4) >= params.strength * weight) continue;
    if (x < minX || x > maxX || z < minZ || z > maxZ) { skipped++; continue; }
    const y = map.groundAt(x, z);
    if (!finite(y) || y < .75 || y > OBJECT_MAX_Y) { skipped++; continue; }
    if (!isAllowed(x, z, footprint)) { skipped++; continue; }
    let spaced = true;
    for (const point of occupied) {
      const dx = x - point.x, dz = z - point.z;
      if (dx * dx + dz * dz + 1e-9 < minDistance2) { spaced = false; break; }
    }
    if (!spaced) { skipped++; continue; }
    const nextCount = placements.length + 1;
    const nextTriangles = nextCount * model.triangles, nextPrimitives = nextCount * model.primitives;
    if (nextCount > MAX_SCATTER_OBJECTS) fail('object_limit');
    if (nextTriangles > MAX_SCATTER_TRIANGLES) fail('triangle_limit');
    if (nextPrimitives > MAX_SCATTER_PRIMITIVES) fail('primitive_limit');
    if (priorCost.triangles + nextTriangles > MAX_AUTHORED_TRIANGLES) fail('authored_triangle_limit');
    if (priorCost.primitives + nextPrimitives > MAX_AUTHORED_PRIMITIVES) fail('authored_primitive_limit');
    if (doc.objects.length + doc.baseOverrides.length + nextCount > MAX_PUBLISHED_EDITS) fail('document_limit');
    const scale = params.scaleMin + cellRandom(params.seed, ix, iz, 5) * (params.scaleMax - params.scaleMin);
    placements.push({ position: { x, y, z }, rotation: { x: 0, y: cellRandom(params.seed, ix, iz, 6) * Math.PI * 2, z: 0 }, scale });
    occupied.push({ x, z });
    triangles = nextTriangles;
    primitives = nextPrimitives;
  }

  const cost = { triangles, primitives, totalTriangles: priorCost.triangles + triangles,
    totalPrimitives: priorCost.primitives + primitives };
  return { assetId, placements, skipped, candidates: width * height, cost };
}

/** Append a planned stroke as one validated document change. */
export function applyScatter(document, plan, makeId) {
  const doc = checkedDocument(document);
  if (!plan || !Array.isArray(plan.placements) || plan.placements.length > MAX_SCATTER_OBJECTS ||
      typeof plan.assetId !== 'string' || typeof makeId !== 'function') fail('plan');
  if (doc.objects.length + doc.baseOverrides.length + plan.placements.length > MAX_PUBLISHED_EDITS) fail('document_limit');
  const ids = [], additions = plan.placements.map((placement, index) => {
    const id = makeId(index);
    ids.push(id);
    return createDecoration({ id, assetId: plan.assetId, position: placement.position,
      rotation: placement.rotation, scale: placement.scale, collider: 'none' });
  });
  const next = validateDocument({ ...doc, objects: [...doc.objects, ...additions] });
  return { document: next, ids };
}
