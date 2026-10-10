import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { createDecoration, createDocument, setBaseOverride } from '../src/editor/document.js';
import { compileGmColliders, validateGmPublication } from '../src/editor/publicationValidation.js';
import { createPreviewMap } from '../src/editor/walkPreview.js';
import { resourceLayout } from '../src/data/resources.js';

const seed = 12345;
const baseRevision = 'terrain-s21-v1';
const map = generateWorld(seed);
const doc = () => createDocument({ seed, baseRevision });
const transform = (map, x, z, { height = 0, scale = 1, rx = 0, rz = 0 } = {}) => ({
  position: { x, y: map.groundAt(x, z) + height, z },
  rotation: { x: rx, y: 0, z: rz }, scale,
});
const circle = (id, map, x, z, radius = 1, options = {}) => createDecoration({ id,
  assetId: 'prop:storage-crate', position: { x, y: map.groundAt(x, z) + (options.height || 0), z },
  rotation: { x: options.rx || 0, y: 0, z: options.rz || 0 }, scale: options.scale || 1,
  collider: { type: 'circle', radius } });
const visual = (id, map, x, z, options = {}) => createDecoration({ id,
  assetId: 'prop:storage-crate', position: { x, y: map.groundAt(x, z) + (options.height || 0), z },
  rotation: { x: options.rx || 0, y: 0, z: options.rz || 0 }, scale: options.scale || 1 });

function safePoint(map) {
  for (let z = -250; z <= 250; z += 10) for (let x = -250; x <= 250; x += 10) {
    if (!map.pathInfo(x, z) || map.pathInfo(x, z).d > 15) return { x, z };
  }
  return { x: 0, z: 0 };
}

test('preflight and collider compilation are pure; preview sees the compiled collider list', () => {
  const p = safePoint(map), originalProps = structuredClone(map.props), originalColliders = structuredClone(map.colliders);
  const originalResources = resourceLayout(map), item = circle('crate', map, p.x, p.z, 1.2, { scale: 1.5 });
  const document = { ...doc(), objects: [item] };
  const compiled = compileGmColliders(map, document, baseRevision);
  const result = validateGmPublication({ map, document, baseRevision });
  assert.deepEqual(createPreviewMap(map, compiled).colliders, compiled);
  assert.equal(compiled.at(-1).x, p.x);
  assert.equal(compiled.at(-1).z, p.z);
  assert.ok(Math.abs(compiled.at(-1).r - 1.8) < 1e-12);
  assert.deepEqual(map.props, originalProps);
  assert.deepEqual(map.colliders, originalColliders);
  assert.deepEqual(resourceLayout(map), originalResources);
  assert.equal(result.colliders.length, compiled.length);
});

test('hiding a uniquely colliding base prop removes its collider while preserving other base colliders', () => {
  const entry = gmEditableBaseProps(map, baseRevision).find((item) => item.prop.r > 0);
  assert.ok(entry);
  const baseline = baseTransformFor(entry), document = setBaseOverride(doc(), { id: entry.id, transform: baseline, hidden: true });
  const output = compileGmColliders(map, document, baseRevision);
  const ownedIndex = map.colliders.findIndex((c) => c.x === entry.prop.x && c.z === entry.prop.z && c.r === entry.prop.r);
  assert.notEqual(ownedIndex, -1);
  assert.deepEqual(output, map.colliders.filter((_, index) => index !== ownedIndex));
});

test('moving a base rock removes its original collider and appends the transformed effective circle', () => {
  const entry = gmEditableBaseProps(map, baseRevision).find((item) => item.prop.r > 0);
  assert.ok(entry);
  const point = safePoint(map), next = transform(map, point.x, point.z, { scale: 1.5 });
  const document = setBaseOverride(doc(), { id: entry.id, transform: next, hidden: false });
  const compiled = compileGmColliders(map, document, baseRevision);
  assert.equal(compiled.length, map.colliders.length);
  assert.deepEqual(compiled.at(-1), { x: point.x, z: point.z, r: entry.prop.r / entry.prop.scale * 1.5 });
});

test('transformed base circles preserve collider ownership metadata', () => {
  const entry = gmEditableBaseProps(map, baseRevision).find((item) => item.prop.r > 0);
  assert.ok(entry);
  const owned = map.colliders.findIndex((c) => c.x === entry.prop.x && c.z === entry.prop.z && c.r === entry.prop.r);
  const metaMap = { ...map, colliders: map.colliders.map((c, i) => i === owned
    ? { ...c, owner: 'fixture-prop', provenance: { generatedIndex: entry.index } } : c) };
  const point = safePoint(map), document = setBaseOverride(doc(), { id: entry.id,
    transform: transform(map, point.x, point.z, { scale: 1.25 }), hidden: false });
  const compiled = compileGmColliders(metaMap, document, baseRevision);
  assert.deepEqual(compiled.at(-1), { ...metaMap.colliders[owned], x: point.x, z: point.z,
    r: entry.prop.r / entry.prop.scale * 1.25 });
});

test('base references, seed, and revision must match exactly', () => {
  const entry = gmEditableBaseProps(map, baseRevision)[0];
  assert.throws(() => compileGmColliders(map, { ...doc(), base: { seed, revision: 'old' } }, baseRevision), { code: 'base_mismatch' });
  assert.throws(() => compileGmColliders(map, { ...doc(), baseOverrides: [{ id: 'base:rock:9:deadbeef',
    transform: entry ? transform(map, 0, 0) : {}, hidden: false }] }, baseRevision), { code: 'base_reference' });
});

test('base cloned assets resolve against eligible IDs; unrelated base references fail', () => {
  const entry = gmEditableBaseProps(map, baseRevision).find((item) => item.prop.r > 0);
  const point = safePoint(map);
  const valid = { ...doc(), objects: [createDecoration({ id: 'clone', assetId: entry.id,
    position: { x: point.x, y: map.groundAt(point.x, point.z), z: point.z } })] };
  assert.doesNotThrow(() => compileGmColliders(map, valid, baseRevision));
  const invalid = { ...valid, objects: [createDecoration({ id: 'clone', assetId: 'base:rock:999:deadbeef',
    position: { x: point.x, y: map.groundAt(point.x, point.z), z: point.z } })] };
  assert.throws(() => compileGmColliders(map, invalid, baseRevision), { code: 'base_reference' });
});

test('untouched colliders are cloned and retain order and metadata', () => {
  const document = doc(), output = compileGmColliders(map, document, baseRevision);
  assert.deepEqual(output, map.colliders);
  assert.notEqual(output[0], map.colliders[0]);
});

test('visual-only additions produce one aggregate warning', () => {
  const p = safePoint(map), document = { ...doc(), objects: [visual('a', map, p.x, p.z), visual('b', map, p.x + 10, p.z)] };
  const result = validateGmPublication({ map, document, baseRevision });
  assert.equal(result.valid, true);
  assert.equal(result.issues.filter((i) => i.code === 'visual_only_objects').length, 1);
});

test('circle collision radius includes scale and X/Z rotation is reported as an aggregate warning', () => {
  const p = safePoint(map), item = circle('tilted', map, p.x, p.z, 2, { scale: 2, rx: 0.25 });
  const result = validateGmPublication({ map, document: { ...doc(), objects: [item] }, baseRevision });
  assert.deepEqual(result.colliders.at(-1), { x: p.x, z: p.z, r: 4 });
  assert.ok(result.issues.some((i) => i.code === 'circle_rotation_ignored'));
});

test('protected spawn and resource sites reject authored colliders', () => {
  const spawn = map.landmarks.spawn, atSpawn = circle('spawn-hit', map, spawn.x, spawn.z, 1);
  const spawnResult = validateGmPublication({ map, document: { ...doc(), objects: [atSpawn] }, baseRevision });
  assert.ok(spawnResult.issues.some((i) => i.code === 'protected_anchor_collision' && i.anchorId === 'spawn'));
  const node = resourceLayout(map).nodes.find((item) => map.pathInfo(item.x, item.z).d > 6);
  assert.ok(node);
  const resourceResult = validateGmPublication({ map, document: { ...doc(), objects: [circle('resource-hit', map, node.x, node.z, 1)] }, baseRevision });
  assert.ok(resourceResult.issues.some((i) => i.code === 'resource_collision' && i.anchorId === `resource:${node.id}`));
});

test('path corridor blocks circles only when its projection is on the route segment', () => {
  const point = map.landmarks.path[Math.floor(map.landmarks.path.length / 2)];
  const result = validateGmPublication({ map, document: { ...doc(), objects: [circle('path-hit', map, point.x, point.z, 1)] }, baseRevision });
  assert.ok(result.issues.some((i) => i.code === 'path_collision'));
});

test('map bounds, support height, scale, and radius limits are publication errors', () => {
  const items = [
    circle('bounds', map, map.half - 2, 0, 2),
    visual('floating', map, 0, 0, { height: 21 }),
    visual('scale', map, 10, 10, { scale: 21 }),
    circle('radius', map, 20, 20, 11, { scale: 2 }),
  ];
  const result = validateGmPublication({ map, document: { ...doc(), objects: items }, baseRevision });
  assert.ok(result.issues.some((i) => i.code === 'map_bounds' && i.objectId === 'bounds'));
  assert.ok(result.issues.some((i) => i.code === 'unsupported_height' && i.objectId === 'floating'));
  assert.ok(result.issues.some((i) => i.code === 'scale_limit' && i.objectId === 'scale'));
  assert.ok(result.issues.some((i) => i.code === 'radius_limit' && i.objectId === 'radius'));
  assert.equal(result.valid, false);
});

test('unchanged base overrides do not create false collision findings', () => {
  const entry = gmEditableBaseProps(map, baseRevision).find((item) => item.prop.r > 0);
  const point = map.landmarks.spawn, next = { ...doc(), baseOverrides: [{ id: entry.id,
    transform: baseTransformFor(entry), hidden: false }] };
  const result = validateGmPublication({ map, document: next, baseRevision });
  assert.equal(result.valid, true);
  assert.equal(result.summary.errors, 0);
});

test('edit budget and capped issue display remain invalid using uncapped error counts', () => {
  const objects = Array.from({ length: 1001 }, (_, i) => visual(`item-${i}`, map, 0, 0, { scale: 21 }));
  const result = validateGmPublication({ map, document: { ...doc(), objects }, baseRevision });
  assert.equal(result.valid, false);
  assert.ok(result.issues.length <= 200);
  assert.ok(result.summary.errors > 200);
  assert.ok(result.summary.omittedIssues > 0);
  assert.equal(result.issues.some((i) => i.code === 'edit_limit'), true);
});

function baseTransformFor(entry) {
  const p = entry.prop;
  return { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: 0, y: p.rot, z: 0 }, scale: p.scale };
}
