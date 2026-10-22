export const DOCUMENT_SCHEMA = 'marea.gm.map-draft';
export const DOCUMENT_VERSION = 2;
const TERRAIN_DOCUMENT_VERSION = 3;
const MATERIAL_DOCUMENT_VERSION = 4;
import { OBJECT_MAX_Y, OBJECT_MIN_Y, validateTerrain } from './terrainData.js';
import { TERRAIN_TILES_VERSION, TILES_DOCUMENT_VERSION, validateTerrainTiles } from './terrainTiles.js';
export const MAX_OBJECTS = 5000;
export const MAX_OBJECT_ID_LENGTH = 96;
export const MAX_ASSET_ID_LENGTH = 160;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const BASE_OVERRIDE_ID = /^base:(rock|flower|pebble):\d+:[a-f0-9]+$/;
const MAX_HORIZONTAL_COORDINATE = 280;
const MIN_HEIGHT = OBJECT_MIN_Y;
const MAX_HEIGHT = OBJECT_MAX_Y;
const MAX_ROTATION = Math.PI * 200;
const MIN_SCALE = 0.001;
const MAX_SCALE = 1000;
const MAX_RADIUS = 10000;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const finiteIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export class DocumentValidationError extends TypeError {
  constructor(code) { super(`Invalid GM map document: ${code}`); this.name = 'DocumentValidationError'; this.code = code; }
}

function fail(code) { throw new DocumentValidationError(code); }

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function validateTransform(transform) {
  if (!exactKeys(transform, ['position', 'rotation', 'scale'])) fail('transform');
  if (!exactKeys(transform.position, ['x', 'y', 'z']) || !exactKeys(transform.rotation, ['x', 'y', 'z'])) fail('transform');
  for (const axis of ['x', 'z']) {
    if (!finiteIn(transform.position[axis], -MAX_HORIZONTAL_COORDINATE, MAX_HORIZONTAL_COORDINATE)) fail('position');
    if (!finiteIn(transform.rotation[axis], -MAX_ROTATION, MAX_ROTATION)) fail('rotation');
  }
  if (!finiteIn(transform.position.y, MIN_HEIGHT, MAX_HEIGHT) ||
      !finiteIn(transform.rotation.y, -MAX_ROTATION, MAX_ROTATION)) fail('position');
  if (!finiteIn(transform.scale, MIN_SCALE, MAX_SCALE)) fail('scale');
  return {
    position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
    rotation: { x: transform.rotation.x, y: transform.rotation.y, z: transform.rotation.z },
    scale: transform.scale,
  };
}

function validateObject(raw) {
  if (!exactKeys(raw, ['id', 'assetId', 'transform', 'collider'])) fail('object');
  if (typeof raw.id !== 'string' || !OBJECT_ID.test(raw.id)) fail('object_id');
  if (typeof raw.assetId !== 'string' || !ID.test(raw.assetId) || raw.assetId.length > MAX_ASSET_ID_LENGTH) fail('asset_id');
  const transform = validateTransform(raw.transform);
  let collider;
  if (raw.collider === 'none') collider = 'none';
  else if (exactKeys(raw.collider, ['type', 'radius']) && raw.collider.type === 'circle' &&
      finiteIn(raw.collider.radius, 0.001, MAX_RADIUS)) {
    collider = { type: 'circle', radius: raw.collider.radius };
  } else fail('collider');
  return {
    id: raw.id,
    assetId: raw.assetId,
    transform,
    collider,
  };
}

function validateBaseOverride(raw) {
  if (!exactKeys(raw, ['id', 'transform', 'hidden'])) fail('base_override');
  if (typeof raw.id !== 'string' || raw.id.length > MAX_OBJECT_ID_LENGTH || !BASE_OVERRIDE_ID.test(raw.id)) fail('base_override_id');
  if (typeof raw.hidden !== 'boolean') fail('base_override_hidden');
  return { id: raw.id, transform: validateTransform(raw.transform), hidden: raw.hidden };
}

export function validateDocument(raw) {
  if (!isRecord(raw) || raw.schema !== DOCUMENT_SCHEMA) fail('format');
  const legacy = raw.version === 1;
  const terrainVersion = raw.version === TERRAIN_DOCUMENT_VERSION || raw.version === MATERIAL_DOCUMENT_VERSION ||
    raw.version === TILES_DOCUMENT_VERSION;
  if ((!legacy && raw.version !== DOCUMENT_VERSION && !terrainVersion) ||
      !exactKeys(raw, legacy ? ['schema', 'version', 'base', 'objects'] :
        terrainVersion ? ['schema', 'version', 'base', 'objects', 'baseOverrides', 'terrain'] :
          ['schema', 'version', 'base', 'objects', 'baseOverrides'])) fail('format');
  if (!exactKeys(raw.base, ['seed', 'revision']) || !Number.isSafeInteger(raw.base.seed) ||
      raw.base.seed < 0 || raw.base.seed > 0xffffffff || typeof raw.base.revision !== 'string' ||
      raw.base.revision.length < 1 || raw.base.revision.length > 128 || /[\u0000-\u001f]/.test(raw.base.revision)) fail('base');
  if (!Array.isArray(raw.objects)) fail('objects');
  const objects = raw.objects.map(validateObject);
  const baseOverrides = legacy ? [] : raw.baseOverrides;
  if (!Array.isArray(baseOverrides) || objects.length + baseOverrides.length > MAX_OBJECTS) fail('object_limit');
  const validatedOverrides = baseOverrides.map(validateBaseOverride);
  const ids = new Set();
  for (const object of objects) {
    if (ids.has(object.id)) fail('duplicate_id');
    ids.add(object.id);
  }
  const overrideIds = new Set();
  for (const override of validatedOverrides) {
    if (overrideIds.has(override.id) || ids.has(override.id)) fail('duplicate_id');
    overrideIds.add(override.id);
  }
  const result = {
    schema: DOCUMENT_SCHEMA,
    version: terrainVersion ? raw.version : DOCUMENT_VERSION,
    base: { seed: raw.base.seed, revision: raw.base.revision },
    objects,
    baseOverrides: validatedOverrides,
  };
  if (raw.version === TILES_DOCUMENT_VERSION) {
    // Document v5 (GM07 D7): tile references only, structural and synchronous; the tile bytes live beside it.
    if (raw.terrain?.version !== TERRAIN_TILES_VERSION) fail('terrain_version');
    result.terrain = validateTerrainTiles(raw.terrain, raw.base.revision);
  } else if (terrainVersion) {
    result.terrain = validateTerrain(raw.terrain);
    if (result.terrain.version !== (raw.version === MATERIAL_DOCUMENT_VERSION ? 2 : 1)) fail('terrain_version');
  }
  return result;
}

export function createDocument({ seed, baseRevision, objects = [], baseOverrides = [], terrain }) {
  return validateDocument({
    schema: DOCUMENT_SCHEMA,
    version: terrain === undefined ? DOCUMENT_VERSION : terrain.version === TERRAIN_TILES_VERSION ? TILES_DOCUMENT_VERSION :
      terrain.version === 2 ? MATERIAL_DOCUMENT_VERSION : TERRAIN_DOCUMENT_VERSION,
    base: { seed, revision: baseRevision },
    objects,
    baseOverrides,
    ...(terrain === undefined ? {} : { terrain }),
  });
}

export function createDecoration({ id, assetId, position, rotation = { x: 0, y: 0, z: 0 }, scale = 1, collider = 'none' }) {
  return validateObject({ id, assetId, transform: { position, rotation, scale }, collider });
}

export function addDecoration(document, decoration) {
  const current = validateDocument(document);
  const object = validateObject(decoration);
  if (current.objects.length + current.baseOverrides.length >= MAX_OBJECTS) fail('object_limit');
  if (current.objects.some((item) => item.id === object.id)) fail('duplicate_id');
  return validateDocument({ ...current, objects: [...current.objects, object] });
}

export function setBaseOverride(document, { id, transform, hidden = false }) {
  const current = validateDocument(document);
  const override = validateBaseOverride({ id, transform, hidden });
  if (current.objects.some((item) => item.id === id)) fail('duplicate_id');
  const existing = current.baseOverrides.findIndex((item) => item.id === id);
  if (existing < 0 && current.objects.length + current.baseOverrides.length >= MAX_OBJECTS) fail('object_limit');
  const baseOverrides = current.baseOverrides.slice();
  if (existing < 0) baseOverrides.push(override);
  else baseOverrides[existing] = override;
  return validateDocument({ ...current, baseOverrides });
}

export function removeBaseOverride(document, id) {
  const current = validateDocument(document);
  if (typeof id !== 'string' || id.length > MAX_OBJECT_ID_LENGTH || !BASE_OVERRIDE_ID.test(id)) fail('base_override_id');
  const baseOverrides = current.baseOverrides.filter((item) => item.id !== id);
  if (baseOverrides.length === current.baseOverrides.length) fail('missing_base_override');
  return validateDocument({ ...current, baseOverrides });
}

export function updateDecoration(document, id, patch) {
  const current = validateDocument(document);
  if (typeof id !== 'string' || !OBJECT_ID.test(id) || !isRecord(patch)) fail('object_id');
  const index = current.objects.findIndex((object) => object.id === id);
  if (index < 0) fail('missing_object');
  const allowed = ['assetId', 'transform', 'collider'];
  if (Object.keys(patch).some((key) => !allowed.includes(key))) fail('object_patch');
  const objects = current.objects.slice();
  objects[index] = validateObject({ ...objects[index], ...clone(patch), id });
  return validateDocument({ ...current, objects });
}

export function removeDecoration(document, id) {
  const current = validateDocument(document);
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) fail('object_id');
  const objects = current.objects.filter((object) => object.id !== id);
  if (objects.length === current.objects.length) fail('missing_object');
  return validateDocument({ ...current, objects });
}

// GM07 D8: unique tile bytes the undo history may reference; the oldest entries are dropped first.
export const HISTORY_TILE_BYTES = 64 * 1024 * 1024;

const tileReferences = (document) => document?.version === TILES_DOCUMENT_VERSION ? document.terrain.tiles : [];

/**
 * Undo history of whole-document snapshots. A document v5 keeps tile references only; their bytes live in one shared
 * content-addressed map (sha256 -> Uint8Array, never mutated) filled by commit({ tiles }). At most `limit` commits and
 * `tileBytes` unique tile bytes referenced by entries stay; tiles no entry and no retained (saved) document reference
 * are released.
 */
export function createDocumentHistory(initialDocument, { limit = 100, tiles = null, tileBytes = HISTORY_TILE_BYTES } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('history_limit');
  if (!Number.isSafeInteger(tileBytes) || tileBytes < 0) fail('history_limit');
  const store = new Map();
  let retained = [];
  // Every referenced tile must already be held or arrive in `incoming` with the referenced length; nothing changes
  // unless all of them do.
  const admit = (document, incoming) => {
    const added = [];
    for (const [, , sha256, bytes] of tileReferences(document)) {
      if (store.has(sha256)) continue;
      const blob = incoming instanceof Map ? incoming.get(sha256) : undefined;
      if (!(blob instanceof Uint8Array) || blob.length !== bytes) fail('tile_missing');
      added.push([sha256, blob]);
    }
    for (const [sha256, blob] of added) store.set(sha256, blob);
  };
  const usedBytes = () => {
    const seen = new Map();
    for (const entry of entries) for (const [, , sha256, bytes] of tileReferences(entry)) seen.set(sha256, bytes);
    let total = 0;
    for (const bytes of seen.values()) total += bytes;
    return total;
  };
  const release = () => {
    const keep = new Set(retained);
    for (const entry of entries) for (const reference of tileReferences(entry)) keep.add(reference[2]);
    for (const sha256 of [...store.keys()]) if (!keep.has(sha256)) store.delete(sha256);
  };
  let entries = [validateDocument(initialDocument)];
  admit(entries[0], tiles);
  let index = 0;
  return Object.freeze({
    current() { return clone(entries[index]); },
    canUndo() { return index > 0; },
    canRedo() { return index < entries.length - 1; },
    commit(nextDocument, { tiles: incoming = null } = {}) {
      const next = validateDocument(nextDocument);
      if (JSON.stringify(next) === JSON.stringify(entries[index])) return this.current();
      admit(next, incoming);
      entries = entries.slice(0, index + 1);
      entries.push(next);
      if (entries.length > limit + 1) entries.shift();
      while (entries.length > 1 && usedBytes() > tileBytes) entries.shift();
      index = entries.length - 1;
      release();
      return this.current();
    },
    /** Tile bytes by sha256 while an entry or the retained document references them (shared, read-only). */
    tile(sha256) { return store.get(sha256); },
    /** The tiles a document references, as a new Map (shared bytes); fails tile_missing when one is not held. */
    tilesOf(document = entries[index]) {
      const result = new Map();
      for (const [, , sha256] of tileReferences(document)) {
        const blob = store.get(sha256);
        if (!blob) fail('tile_missing');
        result.set(sha256, blob);
      }
      return result;
    },
    /** Keep the tiles of the saved record while history moves on; `tiles` supplies any not held yet. */
    retain(document, tiles = null) {
      const checked = document ? validateDocument(document) : null;
      if (checked) admit(checked, tiles);
      retained = tileReferences(checked).map((reference) => reference[2]);
      release();
    },
    /** Unique tile bytes referenced by the entries (the budget measure). */
    tileBytes() { return usedBytes(); },
    entryCount() { return entries.length; },
    undo() {
      if (index > 0) index--;
      return this.current();
    },
    redo() {
      if (index < entries.length - 1) index++;
      return this.current();
    },
  });
}
