import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { createDecoration, createDocument, validateDocument, MAX_OBJECTS } from '../src/editor/document.js';
import { createTemplate, createTemplateLibrary, instantiateTemplate, parseTemplateLibrary, validateTemplate } from '../src/editor/templates.js';

const base = { seed: 42, revision: 'terrain-a' };
const transform = (x, y = 0, z = 0, rotation = { x: 0, y: 0, z: 0 }, scale = 1) => ({
  position: { x, y, z }, rotation: { ...rotation }, scale,
});
const deco = (id, assetId, at, collider = 'none') => ({ id, assetId, transform: at, collider });
const doc = (objects = [], baseOverrides = []) => createDocument({ seed: base.seed, baseRevision: base.revision, objects, baseOverrides });
const ordinary = (id, x, y, z, options = {}) => createDecoration({ id, assetId: options.assetId || 'prop:crate',
  position: { x, y, z }, rotation: options.rotation, scale: options.scale || 1, collider: options.collider || 'none' });

test('template captures visible mixed selection with centroid XZ/minimum Y and preserves base IDs', () => {
  const a = ordinary('a', -4, 3, 2, { rotation: { x: .2, y: .4, z: -.1 }, scale: 1.2,
    collider: { type: 'circle', radius: 1.5 } });
  const baseId = 'base:rock:14:abcdef12';
  const baseObject = { id: baseId, transform: transform(8, 0, 10), hidden: false };
  const document = doc([a], [{ id: baseId, transform: transform(8, 1, 10), hidden: false }]);
  const saved = createTemplate({ id: 'tpl-a', name: 'Camp', document, items: [
    { ...a, base: false, hidden: false }, { ...baseObject, assetId: baseId, collider: 'none', base: true },
  ] });
  assert.deepEqual(saved.base, base);
  assert.deepEqual(saved.objects[0].transform.position, { x: -6, y: 2, z: -4 });
  assert.deepEqual(saved.objects[1].transform.position, { x: 6, y: 0, z: 4 });
  assert.equal(saved.objects[1].assetId, baseId);
  assert.deepEqual(saved.objects[0].collider, { type: 'circle', radius: 1.5 });
  assert.deepEqual(a.transform.position, { x: -4, y: 3, z: 2 });
});

test('placement composes relative transforms at one YXZ pivot and makes independent ordinary instances', () => {
  const source = doc([ordinary('a', -2, 2, 0, { rotation: { x: .2, y: .35, z: -.1 }, scale: 1.25 }),
    ordinary('b', 2, 4, 0, { assetId: 'base:flower:4:deadbeef', rotation: { x: -.15, y: -.2, z: .3 }, scale: .8,
      collider: { type: 'circle', radius: .5 } })]);
  const template = createTemplate({ id: 'tpl-a', name: 'Pair', document: source, items: source.objects.map((item) => ({ ...item, base: false, hidden: false })) });
  const target = doc([ordinary('existing', 0, 0, 0)]);
  const placed = instantiateTemplate(target, template, transform(20, 5, -10, { x: .1, y: .8, z: -.05 }, 1.1), (() => { let n = 0; return () => `new-${++n}`; })());
  assert.deepEqual(placed.ids, ['new-1', 'new-2']);
  assert.deepEqual(placed.document.objects.slice(1).map((item) => item.id), placed.ids);
  assert.equal(placed.document.objects[2].assetId, 'base:flower:4:deadbeef');
  assert.deepEqual(placed.document.objects[2].collider, { type: 'circle', radius: .5 });
  const local = template.objects[0].transform, actual = placed.document.objects[1].transform;
  const destination = new Matrix4().compose(new Vector3(20, 5, -10),
    new Quaternion().setFromEuler(new Euler(.1, .8, -.05, 'YXZ')), new Vector3(1.1, 1.1, 1.1));
  const sourceMatrix = new Matrix4().compose(new Vector3(local.position.x, local.position.y, local.position.z),
    new Quaternion().setFromEuler(new Euler(local.rotation.x, local.rotation.y, local.rotation.z, 'YXZ')),
    new Vector3(local.scale, local.scale, local.scale));
  const expected = destination.clone().multiply(sourceMatrix), position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
  expected.decompose(position, quaternion, scale);
  assert.ok(Math.abs(actual.position.x - position.x) < 1e-8);
  assert.ok(Math.abs(actual.position.y - position.y) < 1e-8);
  assert.ok(Math.abs(actual.position.z - position.z) < 1e-8);
  assert.ok(Math.abs(actual.scale - scale.x) < 1e-8);
  const actualRotation = new Quaternion().setFromEuler(new Euler(actual.rotation.x, actual.rotation.y,
    actual.rotation.z, 'YXZ'));
  assert.ok(Math.abs(actualRotation.dot(quaternion)) > 1 - 1e-8);
  assert.ok(Math.abs(placed.document.objects[2].collider.radius * placed.document.objects[2].transform.scale - .44) < 1e-8);
  assert.deepEqual(target.objects.map((item) => item.id), ['existing']);
  const placedAgain = instantiateTemplate(placed.document, template, transform(30, 5, 4), (() => { let n = 0; return () => `again-${++n}`; })());
  assert.deepEqual(placedAgain.document.objects.slice(-2).map((item) => item.id), ['again-1', 'again-2']);
  assert.notDeepEqual(placedAgain.document.objects.slice(-2), placed.document.objects.slice(-2));
  assert.deepEqual(validateDocument(placed.document), placed.document);
});

test('relative height spans document range and placement at minimum height stays valid', () => {
  const low = ordinary('low', 4, -64, 2), high = ordinary('high', 4, 100, 2);
  const source = doc([low, high]);
  const template = createTemplate({ id: 'tpl-height', name: 'Tall', document: source,
    items: source.objects.map((item) => ({ ...item, base: false, hidden: false })) });
  assert.deepEqual(template.objects.map((item) => item.transform.position.y), [0, 164]);
  const placed = instantiateTemplate(doc(), template, transform(0, -64, 0), (() => { let n = 0; return () => `height-${++n}`; })());
  assert.deepEqual(placed.document.objects.map((item) => item.transform.position.y), [-64, 100]);
});

test('template, library, import bytes, base mismatch, and malformed selection reject atomically', () => {
  const object = ordinary('a', 0, 0, 0), source = doc([object]);
  const template = createTemplate({ id: 'tpl-a', name: 'Solo', document: source, items: [{ ...object, base: false, hidden: false }] });
  assert.throws(() => createTemplate({ id: 'tpl-b', name: 'Hidden', document: source, items: [{ ...object, base: false, hidden: true }] }), { code: 'template_selection' });
  assert.throws(() => validateTemplate({ ...template, unknown: true }), { code: 'template_format' });
  assert.throws(() => validateTemplate({ ...template, id: 'x'.repeat(97) }), { code: 'template_format' });
  assert.throws(() => validateTemplate({ ...template, name: 'x'.repeat(65) }), { code: 'template_format' });
  assert.throws(() => createTemplateLibrary([template, { ...template, id: 'tpl-b', base: { seed: 3, revision: 'other' } }]), { code: 'template_base' });
  assert.throws(() => parseTemplateLibrary(' '.repeat(2 * 1024 * 1024 + 1)), { code: 'template_size' });
  const otherBase = createDocument({ seed: 43, baseRevision: 'terrain-a', objects: [], baseOverrides: [] });
  assert.throws(() => instantiateTemplate(otherBase, template, transform(0), () => 'fresh'), { code: 'template_base' });
  assert.throws(() => createTemplate({ id: 'tpl-c', name: 'Bad', document: source, items: [{ ...object, id: 'missing', base: false, hidden: false }] }), { code: 'template_selection' });
  assert.throws(() => createTemplate({ id: 'tpl-c', name: 'Bad', document: source, items: [{ ...object, base: undefined, hidden: false }] }), { code: 'template_selection' });
  assert.throws(() => createTemplate({ id: 'tpl-c', name: 'Bad', document: source, items: [
    { id: 'base:tree:1:deadbeef', assetId: 'base:tree:1:deadbeef', transform: transform(0), collider: 'none', base: true, hidden: false },
  ] }), { code: 'template_selection' });
  assert.throws(() => createTemplate({ id: 'tpl-c', name: 'Bad', document: source, items: [
    { id: 'base:rock:1:deadbeef', assetId: 'base:rock:1:deadbeef', transform: transform(0, 101), collider: 'none', base: true, hidden: false },
  ] }), { code: 'template_selection' });
  const bad = { ...template, objects: [{ ...template.objects[0], transform: transform(561) }] };
  assert.throws(() => validateTemplate(bad), { code: 'template_transform' });
});

test('placement checks whole batch against document bounds and combined object ceiling', () => {
  const source = doc([ordinary('a', 0, 0, 0), ordinary('b', 1, 0, 0)]);
  const template = createTemplate({ id: 'tpl-a', name: 'Pair', document: source, items: source.objects.map((item) => ({ ...item, base: false, hidden: false })) });
  const before = doc([ordinary('existing', 0, 0, 0)]);
  assert.throws(() => instantiateTemplate(before, template, transform(280), () => 'copy'), { code: 'template_document' });
  const full = doc(Array.from({ length: MAX_OBJECTS - 1 }, (_, i) => ordinary(`d${i}`, 0, 0, 0)));
  let generated = false;
  assert.throws(() => instantiateTemplate(full, template, transform(0), () => { generated = true; return 'copy'; }), { code: 'template_object_limit' });
  assert.equal(generated, false);
  assert.deepEqual(before.objects.map((item) => item.id), ['existing']);
});
