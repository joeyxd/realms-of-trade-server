import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { projectGmContent, installGmContent, validateGmRoutes } from '../src/editor/contentProjection.js';

const BASE = 'terrain-s21-v1';

function documentFor(map, objects = [], baseOverrides = []) {
  return createDocument({ seed: map.seed, baseRevision: BASE, objects, baseOverrides });
}

test('projection keeps stable base data and builds a fresh indexed collision contract', () => {
  const base = generateWorld(20261010), props = base.props, groundAt = base.groundAt;
  const originalColliders = structuredClone(base.colliders);
  const x = 0, z = 100;
  const doc = documentFor(base, [createDecoration({ id: 'wall', assetId: 'prop:storage-crate',
    position: { x, y: base.groundAt(x, z), z }, collider: { type: 'circle', radius: 1.2 } })]);
  const projected = projectGmContent(base, doc, BASE);
  assert.notEqual(projected, base);
  assert.equal(projected.props, props);
  assert.equal(projected.groundAt, groundAt);
  assert.equal(base.colliders.length, originalColliders.length);
  assert.deepEqual(base.colliders, originalColliders);
  assert.notEqual(projected.colliders, base.colliders);
  const indices = projected.queryColliders(x, z, 3);
  assert.ok(indices.every((i) => i >= 0 && i < projected.colliders.length));
  assert.ok(indices.some((i) => projected.colliders[i].x === x && projected.colliders[i].z === z && projected.colliders[i].r === 1.2));
  const candidate = projected.queryColliders(240, 240, 2);
  assert.deepEqual(candidate, [...new Set(candidate)]);
});

test('null projection clones colliders and query results keep generated-map index semantics', () => {
  const base = generateWorld(20261011), projected = projectGmContent(base, null, BASE);
  assert.notEqual(projected.colliders, base.colliders);
  assert.deepEqual(projected.colliders, base.colliders);
  for (const point of [base.landmarks.spawn, base.landmarks.village, { x: 170, z: 170 }]) {
    const a = new Set(base.queryColliders(point.x, point.z, 5));
    const b = new Set(projected.queryColliders(point.x, point.z, 5));
    assert.deepEqual([...b].sort((x, y) => x - y), [...a].sort((x, y) => x - y));
  }
});

test('base decoration override and hidden edit compile into exact projection without mutating document or props', () => {
  const base = generateWorld(20261012), entry = gmEditableBaseProps(base, BASE).find((item) => item.prop.r > 0);
  assert.ok(entry);
  const original = structuredClone(entry.prop), next = { position: { x: 0, y: 1, z: 100 },
    rotation: { x: 0, y: 0.5, z: 0 }, scale: entry.prop.scale * 1.5 };
  const doc = documentFor(base, [], [{ id: entry.id, transform: next, hidden: false }]);
  const before = structuredClone(doc), projected = projectGmContent(base, doc, BASE);
  assert.deepEqual(doc, before);
  assert.deepEqual(entry.prop, original);
  assert.ok(projected.colliders.some((c) => c.x === next.position.x && c.z === next.position.z));
  const hidden = projectGmContent(base, documentFor(base, [], [{ id: entry.id, transform: next, hidden: true }]), BASE);
  assert.equal(hidden.colliders.filter((c) => c.x === next.position.x && c.z === next.position.z).length, 0);
});

test('in-place installation changes only collider list and query function', () => {
  const base = generateWorld(20261013), map = { ...base }, refs = Object.fromEntries(Object.entries(map).filter(([k]) => !['colliders', 'queryColliders'].includes(k)));
  const doc = documentFor(base, [createDecoration({ id: 'circle', assetId: 'prop:storage-crate', position: { x: 0, y: 0, z: 100 }, collider: { type: 'circle', radius: 2 } })]);
  assert.equal(installGmContent(map, base, doc, BASE), map);
  assert.notEqual(map.colliders, base.colliders);
  for (const [key, value] of Object.entries(refs)) assert.equal(map[key], value, key);
  assert.ok(map.queryColliders(0, 100, 3).some((i) => map.colliders[i].x === 0 && map.colliders[i].z === 100));
});

test('route validation rejects only clearance losses against previously walkable routes', () => {
  const base = generateWorld(20261014), projected = projectGmContent(base, null, BASE);
  const route = base.landmarks.path;
  const mid = route[Math.floor(route.length / 2)];
  const blocked = { ...projected, colliders: [...projected.colliders, { x: mid.x, z: mid.z, r: 4 }] };
  blocked.queryColliders = (x, z, r) => {
    const result = projected.queryColliders(x, z, r).slice();
    if (Math.abs(mid.x - x) <= r + 4 && Math.abs(mid.z - z) <= r + 4) result.push(blocked.colliders.length - 1);
    return result;
  };
  const report = validateGmRoutes(base, blocked);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'route_regression' && issue.routeId === 'main-trail'));
  assert.deepEqual(validateGmRoutes(base, projected), { valid: true, issues: [] });
});

test('a blocked part of the base route does not grandfather a new obstruction on its clear remainder', () => {
  const base = { colliders: [{ x: 2, z: 0, r: 2 }], landmarks: { path: [{ x: 0, z: 0 }, { x: 10, z: 0 }] },
    checkpoints: {}, queryColliders: () => [] };
  const target = { ...base, colliders: [...base.colliders, { x: 7.137, z: 0.2, r: 0.01 }], queryColliders: () => [] };
  const result = validateGmRoutes(base, target);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.routeId === 'main-trail'));
});

test('route clearance uses analytic segment-circle overlap for small obstacles between samples', () => {
  const base = { colliders: [], landmarks: { path: [{ x: 0, z: 0 }, { x: 100, z: 0 }] },
    checkpoints: {}, queryColliders: () => [] };
  const target = { ...base, colliders: [{ x: 51.337, z: 0.01, r: 0.001 }] };
  assert.equal(validateGmRoutes(base, target).valid, false);
});
