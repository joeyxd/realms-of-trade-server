export const DOCUMENT_SCHEMA = 'marea.gm.map-draft';
export const DOCUMENT_VERSION = 2;
export const MAX_OBJECTS = 5000;
export const MAX_OBJECT_ID_LENGTH = 96;
export const MAX_ASSET_ID_LENGTH = 160;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const BASE_OVERRIDE_ID = /^base:(rock|flower|pebble):\d+:[a-f0-9]+$/;
const MAX_HORIZONTAL_COORDINATE = 280;
const MIN_HEIGHT = -64;
const MAX_HEIGHT = 100;
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
  if ((!legacy && raw.version !== DOCUMENT_VERSION) ||
      !exactKeys(raw, legacy ? ['schema', 'version', 'base', 'objects'] : ['schema', 'version', 'base', 'objects', 'baseOverrides'])) fail('format');
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
  return {
    schema: DOCUMENT_SCHEMA,
    version: DOCUMENT_VERSION,
    base: { seed: raw.base.seed, revision: raw.base.revision },
    objects,
    baseOverrides: validatedOverrides,
  };
}

export function createDocument({ seed, baseRevision, objects = [], baseOverrides = [] }) {
  return validateDocument({
    schema: DOCUMENT_SCHEMA,
    version: DOCUMENT_VERSION,
    base: { seed, revision: baseRevision },
    objects,
    baseOverrides,
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

export function createDocumentHistory(initialDocument, { limit = 100 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('history_limit');
  let entries = [validateDocument(initialDocument)];
  let index = 0;
  return Object.freeze({
    current() { return clone(entries[index]); },
    canUndo() { return index > 0; },
    canRedo() { return index < entries.length - 1; },
    commit(nextDocument) {
      const next = validateDocument(nextDocument);
      if (JSON.stringify(next) === JSON.stringify(entries[index])) return this.current();
      entries = entries.slice(0, index + 1);
      entries.push(next);
      if (entries.length > limit + 1) entries.shift();
      index = entries.length - 1;
      return this.current();
    },
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
