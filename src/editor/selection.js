import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { DocumentValidationError, MAX_OBJECTS, validateDocument } from './document.js';

export const MAX_SELECTION = 120;

const fail = (code) => { throw new DocumentValidationError(code); };
const BASE_ID = /^base:(rock|flower|pebble):\d+:[a-f0-9]+$/;
const finiteVector = (value) => value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));

function checkedTransform(transform) {
  if (!transform || !finiteVector(transform.position) || !finiteVector(transform.rotation) ||
      !Number.isFinite(transform.scale) || transform.scale <= 0) fail('selection_transform');
  return transform;
}

function checkedItems(items, { allowEmpty = false, allowHidden = false } = {}) {
  if (!Array.isArray(items)) fail('selection');
  if (!items.length && !allowEmpty) fail('selection');
  if (items.length > MAX_SELECTION) fail('selection_limit');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail('selection');
    if (item.base !== undefined && typeof item.base !== 'boolean') fail('selection');
    if (item.base && !BASE_ID.test(item.id)) fail('base_override_id');
    ids.add(item.id);
    checkedTransform(item.transform);
    if (item.hidden && !allowHidden) fail('selection_hidden');
  }
  return items;
}

function matrixFor(transform) {
  checkedTransform(transform);
  const position = new Vector3(transform.position.x, transform.position.y, transform.position.z);
  const rotation = new Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z, 'YXZ');
  const quaternion = new Quaternion().setFromEuler(rotation);
  const scale = new Vector3(transform.scale, transform.scale, transform.scale);
  return new Matrix4().compose(position, quaternion, scale);
}

function transformFromMatrix(matrix, id) {
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  const tolerance = 1e-7 * Math.max(1, Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  if (![position.x, position.y, position.z, scale.x, scale.y, scale.z].every(Number.isFinite) ||
      scale.x <= 0 || scale.y <= 0 || scale.z <= 0 ||
      Math.abs(scale.x - scale.y) > tolerance || Math.abs(scale.x - scale.z) > tolerance || matrix.determinant() <= 0) {
    fail('selection_transform');
  }
  const rotation = new Euler().setFromQuaternion(quaternion, 'YXZ');
  return { id, transform: {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
    scale: (scale.x + scale.y + scale.z) / 3,
  } };
}

/** Return the world-space centroid pivot for a non-empty selection. */
export function selectionPivot(items) {
  checkedItems(items);
  const position = items.reduce((sum, item) => {
    sum.x += item.transform.position.x; sum.y += item.transform.position.y; sum.z += item.transform.position.z;
    return sum;
  }, { x: 0, y: 0, z: 0 });
  const count = items.length;
  return { position: { x: position.x / count, y: position.y / count, z: position.z / count },
    rotation: { x: 0, y: 0, z: 0 }, scale: 1 };
}

/** Apply a pivot delta to every item, preserving its relative transform. */
export function transformSelection(items, fromPivot, toPivot) {
  checkedItems(items);
  const delta = matrixFor(toPivot).multiply(matrixFor(fromPivot).invert());
  return items.map((item) => transformFromMatrix(delta.clone().multiply(matrixFor(item.transform)), item.id));
}

function resolveSelection(document, items) {
  const current = validateDocument(document);
  checkedItems(items);
  const objectById = new Map(current.objects.map((item) => [item.id, item]));
  const overrideById = new Map(current.baseOverrides.map((item) => [item.id, item]));
  for (const item of items) {
    if (item.base) {
      if (objectById.has(item.id)) fail('selection');
      // The document validator checks the base-ID contract when the override is written.
    } else if (!objectById.has(item.id)) fail('selection');
  }
  return { current, objectById, overrideById };
}

/** Apply all selected transforms in one immutable document validation pass. */
export function updateSelection(document, items, transforms) {
  const { current, objectById, overrideById } = resolveSelection(document, items);
  if (!Array.isArray(transforms) || transforms.length !== items.length) fail('selection');
  const transformById = new Map();
  for (const value of transforms) {
    if (!value || typeof value.id !== 'string' || transformById.has(value.id)) fail('selection');
    checkedTransform(value.transform);
    transformById.set(value.id, value.transform);
  }
  const selectedIds = new Set(items.map((item) => item.id));
  if (transformById.size !== selectedIds.size || [...transformById.keys()].some((id) => !selectedIds.has(id))) fail('selection');

  const objects = current.objects.map((object) => selectedIds.has(object.id)
    ? { ...object, transform: transformById.get(object.id) } : object);
  const baseOverrides = current.baseOverrides.slice();
  for (const item of items) if (item.base) {
    const existing = overrideById.get(item.id);
    const override = { id: item.id, transform: transformById.get(item.id), hidden: existing?.hidden ?? false };
    const index = baseOverrides.findIndex((candidate) => candidate.id === item.id);
    if (index < 0) baseOverrides.push(override); else baseOverrides[index] = override;
  }
  return validateDocument({ ...current, objects, baseOverrides });
}

/** Remove selected decorations and hide selected generated-base decorations atomically. */
export function removeSelection(document, items) {
  const current = validateDocument(document);
  checkedItems(items, { allowEmpty: true, allowHidden: true });
  if (!items.length) return current;
  const objectById = new Map(current.objects.map((item) => [item.id, item]));
  const overrideById = new Map(current.baseOverrides.map((item) => [item.id, item]));
  for (const item of items) {
    if (!item || typeof item.id !== 'string') fail('selection');
    if (item.base) {
      if (objectById.has(item.id)) fail('selection');
    } else if (!objectById.has(item.id)) fail('selection');
  }
  const removed = new Set(items.filter((item) => !item.base && !item.hidden).map((item) => item.id));
  const objects = current.objects.filter((item) => !removed.has(item.id));
  const baseOverrides = current.baseOverrides.slice();
  for (const item of items) if (item.base && !item.hidden) {
    const existing = overrideById.get(item.id);
    const override = { id: item.id, transform: existing?.transform ?? item.transform, hidden: true };
    const index = baseOverrides.findIndex((candidate) => candidate.id === item.id);
    if (index < 0) baseOverrides.push(override); else baseOverrides[index] = override;
  }
  return validateDocument({ ...current, objects, baseOverrides });
}

/** Duplicate selected items as ordinary decoration instances with a fixed world-space offset. */
export function duplicateSelection(document, items, makeId, offset = { x: 2, z: 2 }) {
  const { current, objectById } = resolveSelection(document, items);
  if (typeof makeId !== 'function' || !offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.z)) fail('selection');
  if (current.objects.length + current.baseOverrides.length + items.length > MAX_OBJECTS) fail('object_limit');
  const copies = items.map((item) => {
    const source = objectById.get(item.id) || item;
    const transform = source.transform;
    return { id: makeId(), assetId: source.assetId,
      transform: { position: { x: transform.position.x + offset.x, y: transform.position.y, z: transform.position.z + offset.z },
        rotation: { ...transform.rotation }, scale: transform.scale }, collider: source.collider || 'none' };
  });
  const documentWithCopies = { ...current, objects: [...current.objects, ...copies] };
  return { document: validateDocument(documentWithCopies), ids: copies.map((item) => item.id) };
}
