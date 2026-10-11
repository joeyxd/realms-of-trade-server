import { MAX_OBJECTS, createDecoration, validateDocument } from './document.js';
import { transformSelection } from './selection.js';

export const TEMPLATE_SCHEMA = 'marea.gm.template';
export const TEMPLATE_VERSION = 1;
export const TEMPLATE_LIBRARY_SCHEMA = 'marea.gm.template-library';
export const TEMPLATE_LIBRARY_VERSION = 1;
export const MAX_TEMPLATES = 32;
export const MAX_TEMPLATE_MEMBERS = 120;
export const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = (code) => { throw Object.assign(new TypeError(`GM template: ${code}`), { code: `template_${code}` }); };
const clone = (value) => structuredClone(value);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TEMPLATE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const BASE_ID = /^base:(rock|flower|pebble):\d+:[a-f0-9]+$/;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function baseValue(raw) {
  if (!exact(raw, ['seed', 'revision']) || !Number.isSafeInteger(raw.seed) || raw.seed < 0 || raw.seed > 0xffffffff ||
      typeof raw.revision !== 'string' || !raw.revision || raw.revision.length > 128 || /[\u0000-\u001f]/.test(raw.revision)) fail('base');
  return { seed: raw.seed, revision: raw.revision };
}

function localObject(raw) {
  if (!exact(raw, ['id', 'assetId', 'transform', 'collider']) || !/^member-[1-9]\d{0,2}$/.test(raw.id) ||
      typeof raw.assetId !== 'string' || !ID.test(raw.assetId) || raw.assetId.length > 160 || !exact(raw.transform, ['position', 'rotation', 'scale'])) fail('member');
  const { position, rotation, scale } = raw.transform;
  if (!exact(position, ['x', 'y', 'z']) || !exact(rotation, ['x', 'y', 'z']) ||
      !['x', 'y', 'z'].every((axis) => finite(position[axis]) && finite(rotation[axis])) ||
      Math.abs(position.x) > 560 || Math.abs(position.z) > 560 || position.y < 0 || position.y > 164 ||
      !finite(scale) || scale <= 0) fail('transform');
  let collider = raw.collider;
  if (!(collider === 'none' || exact(collider, ['type', 'radius']) && collider.type === 'circle' && finite(collider.radius))) fail('collider');
  try {
    // Reuse canonical transform, asset, and collider validation at a safe origin.
    const checked = createDecoration({ id: raw.id, assetId: raw.assetId, position: { x: 0, y: 0, z: 0 }, rotation,
      scale, collider });
    collider = checked.collider;
  } catch { fail('member'); }
  return { id: raw.id, assetId: raw.assetId, transform: { position: { ...position }, rotation: { ...rotation }, scale }, collider: clone(collider) };
}

export function validateTemplate(raw) {
  if (!exact(raw, ['schema', 'version', 'id', 'name', 'base', 'objects']) || raw.schema !== TEMPLATE_SCHEMA || raw.version !== TEMPLATE_VERSION ||
      typeof raw.id !== 'string' || !TEMPLATE_ID.test(raw.id) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 64 ||
      !Array.isArray(raw.objects) || raw.objects.length < 1 || raw.objects.length > MAX_TEMPLATE_MEMBERS) fail('format');
  const base = baseValue(raw.base), objects = raw.objects.map(localObject), ids = new Set();
  for (const object of objects) { if (ids.has(object.id)) fail('duplicate_member'); ids.add(object.id); }
  return { schema: TEMPLATE_SCHEMA, version: TEMPLATE_VERSION, id: raw.id, name: raw.name.trim(), base, objects };
}

export function createTemplate({ id, name, document, items }) {
  let doc;
  try { doc = validateDocument(document); } catch { fail('document'); }
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_TEMPLATE_MEMBERS) fail('selection');
  const objectMap = new Map(doc.objects.map((item) => [item.id, item]));
  const overrides = new Map(doc.baseOverrides.map((item) => [item.id, item]));
  const seen = new Set(), resolved = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || item.hidden || typeof item.base !== 'boolean') fail('selection');
    seen.add(item.id);
    let source = objectMap.get(item.id);
    if (item.base === true) {
      if (source || !BASE_ID.test(item.id)) fail('selection');
      const override = overrides.get(item.id);
      const selectedTransform = override?.transform || item.transform;
      if (override?.hidden) fail('selection');
      try {
        // Confirm the selected generated-base instance still has a document-valid transform and collider.
        source = createDecoration({ id: item.id, assetId: item.id, position: selectedTransform.position,
          rotation: selectedTransform.rotation, scale: selectedTransform.scale, collider: item.collider || 'none' });
      } catch { fail('selection'); }
    } else if (!source) fail('selection');
    resolved.push({ ...source, base: item.base === true, hidden: false });
  }
  const origin = { x: resolved.reduce((n, item) => n + item.transform.position.x, 0) / resolved.length,
    y: Math.min(...resolved.map((item) => item.transform.position.y)),
    z: resolved.reduce((n, item) => n + item.transform.position.z, 0) / resolved.length };
  const objects = resolved.map((item, index) => ({ id: `member-${index + 1}`, assetId: item.assetId,
    transform: { position: { x: item.transform.position.x - origin.x, y: item.transform.position.y - origin.y,
      z: item.transform.position.z - origin.z }, rotation: { ...item.transform.rotation }, scale: item.transform.scale },
    collider: item.collider || 'none' }));
  return validateTemplate({ schema: TEMPLATE_SCHEMA, version: TEMPLATE_VERSION, id, name,
    base: doc.base, objects });
}

export function createTemplateLibrary(templates = []) {
  if (!Array.isArray(templates) || templates.length > MAX_TEMPLATES) fail('library_limit');
  const checked = templates.map(validateTemplate), ids = new Set();
  let base = null;
  for (const template of checked) {
    if (ids.has(template.id)) fail('duplicate_template');
    ids.add(template.id);
    if (!base) base = template.base;
    else if (base.seed !== template.base.seed || base.revision !== template.base.revision) fail('base');
  }
  const library = { schema: TEMPLATE_LIBRARY_SCHEMA, version: TEMPLATE_LIBRARY_VERSION, templates: checked };
  if (new TextEncoder().encode(JSON.stringify(library)).byteLength > MAX_TEMPLATE_BYTES) fail('size');
  return library;
}

export function validateTemplateLibrary(raw) {
  if (!exact(raw, ['schema', 'version', 'templates']) || raw.schema !== TEMPLATE_LIBRARY_SCHEMA || raw.version !== TEMPLATE_LIBRARY_VERSION) fail('library_format');
  return createTemplateLibrary(raw.templates);
}

export function parseTemplateLibrary(serialized) {
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).byteLength > MAX_TEMPLATE_BYTES) fail('size');
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { fail('json'); }
  return validateTemplateLibrary(parsed);
}

export function instantiateTemplate(document, template, placementTransform, makeId) {
  let current, checked;
  try { current = validateDocument(document); checked = validateTemplate(template); } catch { fail('document'); }
  if (current.base.seed !== checked.base.seed || current.base.revision !== checked.base.revision) fail('base');
  if (typeof makeId !== 'function') fail('id_factory');
  if (current.objects.length + current.baseOverrides.length + checked.objects.length > MAX_OBJECTS) fail('object_limit');
  const transformed = transformSelection(checked.objects.map((item) => ({ ...item, hidden: false, base: false })),
    { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, placementTransform);
  const ids = transformed.map(() => makeId());
  const objects = checked.objects.map((item, index) => ({ ...item, id: ids[index], transform: transformed[index].transform }));
  let next;
  try { next = validateDocument({ ...current, objects: [...current.objects, ...objects] }); } catch { fail('document'); }
  return { document: next, ids };
}
