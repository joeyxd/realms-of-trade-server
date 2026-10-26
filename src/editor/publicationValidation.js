import { insetMapBounds } from '../sim/mapBounds.js';
import { validateDocument } from './document.js';
import { gmEditableBaseProps } from './baseIdentity.js';
import { resourceLayout } from '../data/resources.js';
import { freshwaterSource } from '../data/freshwater.js';
import { compileTerrainMap, validateTerrainForMap, validateTerrainGridForMap } from './terrainData.js';
import { compileTerrainTiles, isTerrainTilesDocument } from './terrainTiles.js';
import { resourceDescriptor, validateAuthoredResources } from './resourceAdapters.js';
import { WORLD_LOAD_LIMITS, WORLD_OVER_LOAD_BUDGET, worldLoadBudget, worldLoadDomain } from './worldLoad.js';

const MAX_REPORTED_ISSUES = 200;
const MAX_PUBLICATION_EDITS = 1000;
const MAX_PUBLICATION_SCALE = 20;
const MAX_PUBLICATION_RADIUS = 20;
const close = (a, b) => a === b;
const clone = (value) => structuredClone(value);

function baseTransform(prop) {
  return { position: { x: prop.x, y: prop.y, z: prop.z },
    rotation: { x: 0, y: prop.rot, z: 0 }, scale: prop.scale };
}

function sameTransform(a, b) {
  return ['x', 'y', 'z'].every((axis) => close(a.position[axis], b.position[axis])) &&
    ['x', 'y', 'z'].every((axis) => close(a.rotation[axis], b.rotation[axis])) && close(a.scale, b.scale);
}

function colliderIndex(map, prop) {
  if (!(prop.r > 0)) return null;
  const matches = [];
  map.colliders.forEach((c, i) => {
    if (c.x === prop.x && c.z === prop.z && c.r === prop.r) matches.push(i);
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * GM07b2c: the terrain of a document v5 over a base map. `tiles` is a Map sha256 -> MNT1 bytes holding every tile the
 * document references (tilesToGrid refuses a missing blob, a wrong length or a blob whose own key differs from its
 * reference). Compiles with compileTerrainTiles, then checks the GM05 and D4 map rules on the whole compiled grid
 * (validateTerrainGridForMap without dirty tiles, the check validateTerrainTilesForMap runs). Throws the terrain code.
 */
export function compileTileTerrainForMap(map, document, baseRevision, tiles) {
  const compiled = compileTerrainTiles(map, { tiles: document.terrain.tiles, blobs: tiles }, baseRevision);
  validateTerrainGridForMap(map, compiled.terrain);
  return compiled;
}

// `tiles` is used by a document v5 only; without it (null) the terrain of a v5 is not compiled, which only the
// collision compile may ask for (colliders never depend on terrain).
function resolve(map, document, baseRevision, tiles = null) {
  if (!map || !Array.isArray(map.props) || !Array.isArray(map.colliders) ||
      !Number.isSafeInteger(map.seed) || typeof map.groundAt !== 'function') {
    throw new TypeError('A generated map with props, colliders, seed, and groundAt is required');
  }
  const doc = validateDocument(document);
  if (doc.base.seed !== (map.seed >>> 0) || doc.base.revision !== baseRevision) {
    const error = new TypeError('GM publication base does not match the generated map');
    error.code = 'base_mismatch'; throw error;
  }
  const terrainMap = isTerrainTilesDocument(doc) ? (tiles === null ? map : compileTileTerrainForMap(map, doc, baseRevision, tiles))
    : doc.terrain ? (validateTerrainForMap(map, doc.terrain), compileTerrainMap(map, doc.terrain)) : map;
  const editable = gmEditableBaseProps(map, baseRevision);
  const byId = new Map(editable.map((entry) => [entry.id, entry]));
  for (const item of doc.baseOverrides) if (!byId.has(item.id)) {
    const error = new TypeError('Unknown or non-editable GM base override');
    error.code = 'base_reference'; throw error;
  }
  for (const item of doc.objects) if (item.assetId.startsWith('base:') && !byId.has(item.assetId)) {
    const error = new TypeError('Unknown or non-editable GM base asset reference');
    error.code = 'base_reference'; throw error;
  }
  return { doc, byId, terrainMap };
}

/** Compile the static collision view used by publication and private walk preview. */
export function compileGmColliders(map, document, baseRevision) {
  const { doc, byId } = resolve(map, document, baseRevision);
  const replaced = new Set();
  const transformed = [];
  for (const override of doc.baseOverrides) {
    const entry = byId.get(override.id), index = colliderIndex(map, entry.prop);
    if (index === null) continue;
    replaced.add(index);
    if (override.hidden) continue;
    transformed.push({ ...map.colliders[index], x: override.transform.position.x, z: override.transform.position.z,
      r: (entry.prop.r / entry.prop.scale) * override.transform.scale });
  }
  const result = map.colliders.filter((_, index) => !replaced.has(index)).map(clone);
  result.push(...transformed);
  for (const item of doc.objects) if (item.collider !== 'none') result.push({
    x: item.transform.position.x, z: item.transform.position.z,
    r: item.collider.radius * item.transform.scale,
  });
  return result;
}

function nativeRadius(point, fallback = 0) {
  const value = Number.isFinite(point?.r) ? point.r : Number.isFinite(point?.radius) ? point.radius : fallback;
  return Math.max(0, value);
}

function anchorList(map) {
  const anchors = [];
  const add = (id, point, radius = 0) => {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.z))
      anchors.push({ id, x: point.x, z: point.z, radius: Math.max(radius, nativeRadius(point)) });
  };
  const lm = map.landmarks || {};
  add('spawn', lm.spawn, 4); add('village', lm.village, 4);
  add('dockBase', lm.dockBase, 3); add('dockEnd', lm.dockEnd, 3);
  add('arena', lm.arena, Number.isFinite(lm.arenaR) ? lm.arenaR : 19);
  add('volcano', lm.volcano, 12);
  add('freshwater:salty-spring', freshwaterSource(map), 3);
  for (const [id, point] of Object.entries(map.checkpoints || {})) add(`checkpoint:${id}`, point, 2);
  for (const [kind, list] of [['npc', map.npcs], ['rack', map.racks], ['enemySpawn', map.enemySpawns]]) {
    for (let i = 0; i < (Array.isArray(list) ? list.length : 0); i++) add(`${kind}:${list[i].id || i}`, list[i], 2);
  }
  for (const key of ['dummy', 'cannon', 'ring']) add(`practice:${key}`, map.practice?.[key], 2);
  return anchors;
}

/**
 * Return bounded, deterministic warnings/errors for the conservative v1 publication policy. A document v5 needs
 * `tiles` (Map sha256 -> MNT1 bytes): its terrain is compiled and checked before any object or resource rule.
 * `loadLimits` (worldLoad.js) is the single-load budget; tests pass a smaller one to reach it on today's map.
 */
export function validateGmPublication({ map, document, baseRevision, tiles = null, loadLimits = WORLD_LOAD_LIMITS } = {}) {
  if (isTerrainTilesDocument(document) && !(tiles instanceof Map)) {
    throw Object.assign(new TypeError('A document v5 needs its terrain tiles'), { code: 'tile_blobs' });
  }
  const { doc, byId, terrainMap } = resolve(map, document, baseRevision, tiles);
  const issues = [], counts = { errors: 0, warnings: 0 };
  const issue = (severity, code, objectId, anchorId) => {
    counts[severity === 'error' ? 'errors' : 'warnings']++;
    if (issues.length < MAX_REPORTED_ISSUES) {
      const item = { severity, code };
      if (objectId) item.objectId = objectId;
      if (anchorId) item.anchorId = anchorId;
      issues.push(item);
    }
  };
  const changed = [];
  for (const override of doc.baseOverrides) {
    const entry = byId.get(override.id), baseline = baseTransform(entry.prop);
    if (override.hidden || sameTransform(override.transform, baseline)) continue;
    changed.push({ id: override.id, transform: override.transform,
      collider: entry.prop.r > 0 && colliderIndex(map, entry.prop) !== null
        ? { type: 'circle', radius: entry.prop.r / entry.prop.scale } : 'none', base: true });
  }
  for (const item of doc.objects) if (!resourceDescriptor(item.assetId)) changed.push({ ...item, base: false });

  const editCount = doc.baseOverrides.length + doc.objects.length;
  if (editCount > MAX_PUBLICATION_EDITS) issue('error', 'edit_limit');
  // GM11a: a world over the single-load budget is never prepared, activated or rebuilt; its draft still saves. Under
  // the budget the report stays as before, so retained revisions keep their identity.
  if (worldLoadBudget(worldLoadDomain(map, baseRevision), doc, loadLimits).level === 'over') issue('error', WORLD_OVER_LOAD_BUDGET);
  const anchors = anchorList(map), resources = resourceLayout(map);
  const authored = validateAuthoredResources(terrainMap, doc);
  for (const problem of authored.issues) issue('error', `resource_${problem.code}`, problem.objectId);
  resources.nodes.push(...authored.resources);
  let visualOnlyCount = 0, rotatedCircleCount = 0;
  const circles = [], edge = insetMapBounds(map, 2);
  for (const item of changed) {
    const { id, transform } = item, { x, y, z } = transform.position;
    const radius = item.collider === 'none' ? 0 : item.collider.radius * transform.scale;
    if (transform.scale > MAX_PUBLICATION_SCALE) issue('error', 'scale_limit', id);
    if (radius > MAX_PUBLICATION_RADIUS) issue('error', 'radius_limit', id);
    if (x - radius < edge.minX || x + radius > edge.maxX || z - radius < edge.minZ || z + radius > edge.maxZ)
      issue('error', 'map_bounds', id);
    const ground = terrainMap.groundAt(x, z);
    if (!Number.isFinite(ground) || y - ground < -2 || y - ground > 20)
      issue('error', 'unsupported_height', id);
    if (item.collider === 'none') visualOnlyCount++;
    else {
      circles.push({ id, x, z, r: radius });
      if (Math.abs(transform.rotation.x) > 1e-9 || Math.abs(transform.rotation.z) > 1e-9) rotatedCircleCount++;
    }
  }
  for (const circle of circles) {
    for (const anchor of anchors) if (Math.hypot(circle.x - anchor.x, circle.z - anchor.z) < circle.r + anchor.radius) {
      issue('error', 'protected_anchor_collision', circle.id, anchor.id);
    }
    for (const node of resources.nodes || []) if (Math.hypot(circle.x - node.x, circle.z - node.z) < circle.r + 1.5)
      issue('error', 'resource_collision', circle.id, `resource:${node.id}`);
    if (resources.bench && Math.hypot(circle.x - resources.bench.x, circle.z - resources.bench.z) < circle.r + 3)
      issue('error', 'resource_collision', circle.id, 'resource:bench');
    const path = map.pathInfo?.(circle.x, circle.z);
    if (path && path.t >= 0 && path.t <= 1 && path.d < 3 + circle.r)
      issue('error', 'path_collision', circle.id);
  }
  if (visualOnlyCount) issue('warning', 'visual_only_objects');
  if (rotatedCircleCount) issue('warning', 'circle_rotation_ignored');
  const totalIssues = counts.errors + counts.warnings;
  return { valid: counts.errors === 0, issues,
    summary: { edits: editCount, errors: counts.errors, warnings: counts.warnings,
      totalIssues, omittedIssues: Math.max(0, totalIssues - issues.length) },
    colliders: compileGmColliders(map, doc, baseRevision) };
}
