import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDecoration, createDocument, createDocumentHistory, DocumentValidationError, validateDocument } from '../src/editor/document.js';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { MAX_SELECTION, duplicateSelection, removeSelection, selectionPivot, transformSelection, updateSelection } from '../src/editor/selection.js';

const baseId = 'base:rock:14:abcdef123456';
const transform = (x, y = 0, z = 0, rotation = { x: 0, y: 0, z: 0 }, scale = 1) => ({
  position: { x, y, z }, rotation: { ...rotation }, scale,
});
const decoration = (id, x, z = 0, options = {}) => createDecoration({ id, assetId: options.assetId || 'prop.rock.small',
  position: { x, y: options.y || 0, z }, rotation: options.rotation, scale: options.scale || 1,
  collider: options.collider || 'none' });
const documentWith = (...objects) => createDocument({ seed: 42, baseRevision: 'terrain-a', objects });
const member = (object) => ({ ...object, base: false, hidden: false });
const baseMember = (id = baseId, value = transform(0, 0, 0), extra = {}) => ({ id, assetId: id, transform: value,
  collider: 'none', base: true, hidden: false, ...extra });
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('selection pivot is the centroid and has neutral orientation and scale', () => {
  const items = [member(decoration('a', -2, 1)), member(decoration('b', 4, 5, { y: 3 }))];
  assert.deepEqual(selectionPivot(items), { position: { x: 1, y: 1.5, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 });
});

test('selection transform applies a world-space pivot delta to rotated and tilted items', () => {
  const items = [member(decoration('a', 3, 1, { y: 2, rotation: { x: .2, y: -.5, z: .35 }, scale: 1.25 })),
    member(decoration('b', -2, 4, { rotation: { x: -.4, y: .3, z: .1 }, scale: .75 }))];
  const from = transform(1, 0, 1, { x: 0, y: 0, z: 0 }, 1);
  const to = transform(6, 3, -2, { x: .2, y: 1.1, z: -.15 }, 1.4);
  const result = transformSelection(items, from, to);
  const delta = new Matrix4().compose(new Vector3(6, 3, -2), new Quaternion().setFromEuler(new Euler(.2, 1.1, -.15, 'YXZ')), new Vector3(1.4, 1.4, 1.4))
    .multiply(new Matrix4().compose(new Vector3(1, 0, 1), new Quaternion(), new Vector3(1, 1, 1)).invert());
  for (let i = 0; i < items.length; i++) {
    const item = items[i], actual = result[i];
    const expected = delta.clone().multiply(new Matrix4().compose(new Vector3(item.transform.position.x, item.transform.position.y, item.transform.position.z),
      new Quaternion().setFromEuler(new Euler(item.transform.rotation.x, item.transform.rotation.y, item.transform.rotation.z, 'YXZ')),
      new Vector3(item.transform.scale, item.transform.scale, item.transform.scale)));
    const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
    expected.decompose(position, quaternion, scale);
    assert.equal(actual.id, item.id);
    close(actual.transform.position.x, position.x); close(actual.transform.position.y, position.y); close(actual.transform.position.z, position.z);
    close(actual.transform.scale, scale.x); close(actual.transform.scale, scale.y); close(actual.transform.scale, scale.z);
    const actualQuaternion = new Quaternion().setFromEuler(new Euler(actual.transform.rotation.x, actual.transform.rotation.y, actual.transform.rotation.z, 'YXZ'));
    assert.ok(Math.abs(actualQuaternion.dot(quaternion)) > 1 - 1e-8);
  }
});

test('batch update handles base and draft objects, preserves unrelated fields, and leaves inputs untouched', () => {
  const draft = decoration('draft-a', 2, 3, { collider: { type: 'circle', radius: 1.2 } });
  const other = decoration('other', 9, 9);
  const initial = documentWith(draft, other);
  const items = [member(draft), baseMember()];
  const inputs = structuredClone({ initial, items });
  const updated = updateSelection(initial, items, [
    { id: draft.id, transform: transform(5, 1, 6, { x: 0, y: .3, z: 0 }, 2) },
    { id: baseId, transform: transform(-3, 0, 2) },
  ]);
  assert.deepEqual(updated.objects.find((item) => item.id === 'draft-a').transform, transform(5, 1, 6, { x: 0, y: .3, z: 0 }, 2));
  assert.deepEqual(updated.objects.find((item) => item.id === 'draft-a').collider, draft.collider);
  assert.deepEqual(updated.objects.find((item) => item.id === 'other'), other);
  assert.deepEqual(updated.baseOverrides, [{ id: baseId, transform: transform(-3, 0, 2), hidden: false }]);
  assert.deepEqual({ initial, items }, inputs);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(updated))), updated);
});

test('duplicate flattens draft and base members into new ordinary decorations', () => {
  const draft = decoration('draft-a', 1, 2, { collider: { type: 'circle', radius: 1.5 } });
  const initial = documentWith(draft);
  const members = [member(draft), baseMember(baseId, transform(-4, 3, 8), { collider: { type: 'circle', radius: 2 } })];
  const result = duplicateSelection(initial, members, (() => { let i = 0; return () => `copy-${++i}`; })());
  assert.deepEqual(result.ids, ['copy-1', 'copy-2']);
  assert.deepEqual(result.document.objects.map((item) => item.id), ['draft-a', 'copy-1', 'copy-2']);
  assert.deepEqual(result.document.objects[1].transform.position, { x: 3, y: 0, z: 4 });
  assert.deepEqual(result.document.objects[1].collider, draft.collider);
  assert.deepEqual(result.document.objects[2].transform.position, { x: -2, y: 3, z: 10 });
  assert.deepEqual(result.document.objects[2].collider, { type: 'circle', radius: 2 });
  assert.deepEqual(result.document.baseOverrides, []);
});

test('batch removal deletes draft objects and hides base members; hidden base removal is a no-op', () => {
  const draft = decoration('draft-a', 1, 2);
  const initial = documentWith(draft);
  const hidden = { ...baseMember(), hidden: true };
  const removed = removeSelection(initial, [member(draft), baseMember()]);
  assert.deepEqual(removed.objects, []);
  assert.deepEqual(removed.baseOverrides, [{ id: baseId, transform: transform(0), hidden: true }]);
  assert.deepEqual(removeSelection(removed, [hidden]), removed);
  assert.deepEqual(removeSelection(initial, []), initial);
});

test('one history commit undoes and redoes a whole batch', () => {
  const initial = documentWith(decoration('a', 0, 0), decoration('b', 4, 0));
  const items = initial.objects.map(member);
  const moved = updateSelection(initial, items, [
    { id: 'a', transform: transform(2, 0, 0) }, { id: 'b', transform: transform(6, 0, 0) },
  ]);
  const history = createDocumentHistory(initial);
  history.commit(moved);
  assert.deepEqual(history.undo(), initial);
  assert.deepEqual(history.redo(), moved);
});

test('selection caps, malformed members, missing/duplicate IDs, hidden edits, and bad transforms reject atomically', () => {
  const initial = documentWith(decoration('a', 0, 0));
  assert.equal(MAX_SELECTION, 120);
  assert.throws(() => selectionPivot([]), { code: 'selection' });
  assert.throws(() => selectionPivot(Array.from({ length: MAX_SELECTION + 1 }, (_, i) => member(decoration(`x${i}`, 0, 0)))), { code: 'selection_limit' });
  assert.throws(() => updateSelection(initial, [member(initial.objects[0]), member(initial.objects[0])], []), { code: 'selection' });
  assert.throws(() => updateSelection(initial, [member(decoration('missing', 0, 0))], [{ id: 'missing', transform: transform(1) }]), { code: 'selection' });
  assert.throws(() => updateSelection(initial, [{ ...member(initial.objects[0]), hidden: true }], [{ id: 'a', transform: transform(1) }]), { code: 'selection_hidden' });
  assert.throws(() => transformSelection([member(initial.objects[0])], transform(0), transform(1, 0, 0, { x: 0, y: 0, z: 0 }, -1)), { code: 'selection_transform' });
  assert.throws(() => transformSelection([member(initial.objects[0])], transform(0), { ...transform(1), scale: NaN }), { code: 'selection_transform' });
  assert.throws(() => transformSelection([member(initial.objects[0])], transform(0), { ...transform(1), scale: { x: 1, y: 2, z: 1 } }), { code: 'selection_transform' });
});

test('boundary, invalid IDs, duplicate generated IDs, and object limits reject the complete batch', () => {
  const initial = documentWith(decoration('a', 279, 0), decoration('b', 0, 0));
  const items = initial.objects.map(member);
  assert.throws(() => updateSelection(initial, items, [
    { id: 'a', transform: transform(281) }, { id: 'b', transform: transform(2) },
  ]), (error) => error instanceof DocumentValidationError && error.code === 'position');
  assert.throws(() => duplicateSelection(documentWith(decoration('a', 0, 0)), [member(decoration('a', 0, 0))], () => 'bad/id'),
    (error) => error instanceof DocumentValidationError && error.code === 'object_id');
  assert.throws(() => duplicateSelection(documentWith(decoration('a', 0, 0)), [member(decoration('a', 0, 0))], () => 'a'),
    (error) => error instanceof DocumentValidationError && error.code === 'duplicate_id');

  const many = Array.from({ length: 5000 }, (_, i) => decoration(`d${i}`, 0, 0));
  const full = documentWith(...many);
  let generated = false;
  assert.throws(() => duplicateSelection(full, [member(full.objects[0])], () => { generated = true; return 'copy'; }),
    (error) => error instanceof DocumentValidationError && error.code === 'object_limit');
  assert.equal(generated, false);
});

test('updated and duplicated selections remain valid canonical publication content', () => {
  const seed = 12345, baseRevision = 'terrain-s21-v1', map = generateWorld(seed);
  let point = null;
  for (let z = -250; z <= 250 && !point; z += 10) for (let x = -250; x <= 250 && !point; x += 10) {
    const path = map.pathInfo(x, z);
    if (!path || path.d > 15) point = { x, z };
  }
  assert.ok(point);
  const source = createDecoration({ id: 'placed-a', assetId: 'prop.rock.small',
    position: { x: point.x, y: map.groundAt(point.x, point.z), z: point.z } });
  const initial = createDocument({ seed, baseRevision, objects: [source] });
  const items = initial.objects.map(member), pivot = selectionPivot(items);
  const moved = updateSelection(initial, items, transformSelection(items, pivot,
    transform(point.x + 1, map.groundAt(point.x + 1, point.z), point.z)));
  const duplicated = duplicateSelection(moved, moved.objects.map(member), () => 'placed-copy');
  const canonical = validateDocument(JSON.parse(JSON.stringify(duplicated.document)));
  const publication = validateGmPublication({ map, document: canonical, baseRevision });
  assert.equal(JSON.stringify(canonical), JSON.stringify(duplicated.document));
  assert.equal(publication.valid, true, JSON.stringify(publication.issues));
});
