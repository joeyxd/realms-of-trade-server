import { mapBounds } from '../sim/mapBounds.js';
import { canScatterAt } from './terrainData.js';
import { resourceLayout } from '../data/resources.js';

const RESOURCE_DESCRIPTORS = Object.freeze({
  'prop:gm-resource-palm-v1': Object.freeze({
    alias: 'prop:gm-resource-palm-v1', kind: 'palm', sourceAssetId: 'model:palm-tall-v1',
    label: Object.freeze({ es: 'Palmera talable', en: 'Harvestable palm' }),
    minScale: 0.75, maxScale: 1.25,
  }),
  'prop:gm-resource-stone-v1': Object.freeze({
    alias: 'prop:gm-resource-stone-v1', kind: 'stone', sourceAssetId: 'model:coast-rock-v1',
    label: Object.freeze({ es: 'Piedra recogible', en: 'Collectible stone' }),
    minScale: 1, maxScale: 1,
  }),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_ID = /^gm_[0-9a-f]{32}$/;
const RESOURCE_LIMIT = 128;
const MIN_SPACING = 5;
const BENCH_SPACING = 6;
const GROUND_TOLERANCE = 0.15;

export class GmResourceValidationError extends TypeError {
  constructor(code, objectId = undefined) {
    super(`Invalid GM resource: ${code}`);
    this.name = 'GmResourceValidationError'; this.code = code;
    if (objectId !== undefined) this.objectId = objectId;
  }
}

const fail = (code, objectId) => { throw new GmResourceValidationError(code, objectId); };

export function resourceAdapter(id) { return RESOURCE_DESCRIPTORS[id] || null; }
export const resourceDescriptor = resourceAdapter;

export function sourceAssetId(id) { return resourceAdapter(id)?.sourceAssetId ?? id; }

export function gmResourceId(objectId) {
  if (typeof objectId !== 'string' || !objectId.startsWith('gm-') || !UUID.test(objectId.slice(3)))
    fail('id', objectId);
  return `gm_${objectId.slice(3).replaceAll('-', '').toLowerCase()}`;
}

function authoredObject(item) {
  return !!resourceAdapter(item?.assetId);
}

function slope(map, x, z) {
  const groundAt = map.groundAt;
  const dx = groundAt(x + 1, z) - groundAt(x - 1, z);
  const dz = groundAt(x, z + 1) - groundAt(x, z - 1);
  return Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) / 2 <= 0.55;
}

/** Compile resource aliases into the exact stable node layout used by simulation. */
export function compileAuthoredResources(map, document) {
  try { mapBounds(map); } catch { fail('map'); }
  if (!map || typeof map.groundAt !== 'function' || !document ||
      !Array.isArray(document.objects)) fail('map');
  const objects = document.objects.filter(authoredObject);
  if (objects.length > RESOURCE_LIMIT) fail('limit');
  if (!objects.length) return [];
  const resources = [], ids = new Set(), sites = [];
  const baseline = resourceLayout({ ...map, gmResources: [] });
  for (const item of objects) {
    const id = gmResourceId(item.id), descriptor = resourceAdapter(item.assetId);
    if (ids.has(id)) fail('duplicate_id', item.id);
    ids.add(id);
    const { position, rotation, scale } = item.transform;
    if (item.collider !== 'none') fail('collider', item.id);
    if (descriptor.kind === 'palm') {
      if (scale < descriptor.minScale || scale > descriptor.maxScale ||
          Math.abs(rotation.x) > 1e-9 || Math.abs(rotation.z) > 1e-9) fail('transform', item.id);
    } else if (scale !== 1 || rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0) {
      fail('transform', item.id);
    }
    const { x, z } = position;
    const sampledY = map.groundAt(x, z);
    if (![x, sampledY, z].every(Number.isFinite) || Math.abs(position.y - sampledY) > GROUND_TOLERANCE) fail('ground_height', item.id);
    // Hash-stable millimeter precision avoids cross-runtime interpolation noise.
    const y = Math.round(sampledY * 1000) / 1000;
    if (y <= 0.65 || map.onDock?.(x, z) || map.lawlessAt?.(x, z)) fail('protected_ground', item.id);
    if (!slope(map, x, z)) fail('slope', item.id);
    if (!canScatterAt(map, x, z, 1)) fail('protected_ground', item.id);
    if (baseline.nodes.some((node) => Math.hypot(x - node.x, z - node.z) < MIN_SPACING) ||
        baseline.bench && Math.hypot(x - baseline.bench.x, z - baseline.bench.z) < BENCH_SPACING)
      fail('resource_spacing', item.id);
    sites.push({ id, objectId: item.id, kind: descriptor.kind, x, y, z });
    resources.push({ id, kind: descriptor.kind, x, y, z,
      ...(descriptor.kind === 'palm' ? { scale, rot: rotation.y } : {}),
      gmResource: true, sourceObjectId: item.id, sourceAssetId: descriptor.sourceAssetId });
  }
  for (let i = 0; i < sites.length; i++) {
    const a = sites[i];
    for (let j = 0; j < i; j++) if (Math.hypot(a.x - sites[j].x, a.z - sites[j].z) < MIN_SPACING)
      fail('resource_spacing', a.objectId);
    for (const item of document.objects) {
      if (authoredObject(item)) continue;
      if (item.collider !== 'none' && Math.hypot(a.x - item.transform.position.x, a.z - item.transform.position.z) <
          item.collider.radius * item.transform.scale + 1.5) fail('object_collision', a.objectId);
    }
  }
  return resources;
}

export function validateAuthoredResources(map, document) {
  try { return { valid: true, resources: compileAuthoredResources(map, document), issues: [] }; }
  catch (error) {
    if (!(error instanceof GmResourceValidationError)) throw error;
    return { valid: false, resources: [], issues: [{ code: error.code, objectId: error.objectId }] };
  }
}

export const GM_RESOURCE_LIMIT = RESOURCE_LIMIT;
