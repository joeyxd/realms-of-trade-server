import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBaseDecorationLayer } from '../src/editor/baseDecoration.js';

const rock = (overrides = {}) => ({ kind: 'rock', x: 4, y: 1, z: -3, rot: 0.4, scale: 2,
  r: 1.1, v: 0.7, h: 0, ...overrides });
const flower = (overrides = {}) => ({ kind: 'flower', x: -2, y: 0.2, z: 5, rot: 1.1, scale: 0.8,
  r: 0, v: 0.35, h: 0, ...overrides });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function fixture({ props = [rock(), flower()], duplicateRockCollider = false } = {}) {
  const scene = new THREE.Scene();
  const map = { seed: 34567, props, colliders: [
    { x: 4, z: -3, r: 1.1, source: 'rock-prop', metadata: { owner: 0 } },
    { x: 25, z: 26, r: 0.55, source: 'practice-rack', metadata: { owner: 'rack' } },
  ] };
  if (duplicateRockCollider) map.colliders.push({ x: 4, z: -3, r: 1.1 });
  const meshes = [];
  for (const [name, kind] of [['rocks0', 'rock'], ['flowers1', 'flower']]) {
    const list = props.filter((p) => p.kind === kind);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }), list.length);
    mesh.name = name;
    mesh.userData.gmBaseProps = list;
    mesh.layers.set(3);
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
    list.forEach((p, i) => {
      const logical = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot),
        new THREE.Vector3(p.scale, p.scale, p.scale));
      const art = new THREE.Matrix4().makeTranslation(0.25, 0.4, -0.15)
        .multiply(new THREE.Matrix4().makeScale(1, 0.6, 1.2));
      mesh.setMatrixAt(i, logical.multiply(art));
      mesh.setColorAt(i, new THREE.Color(kind === 'flower' ? 0xff5577 : 0x8c887f));
    });
    scene.add(mesh); meshes.push(mesh);
  }
  const excluded = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  excluded.name = 'volcanicRocks0'; excluded.userData.gmBaseProps = [rock({ x: 99, z: 99 })];
  scene.add(excluded);
  return { scene, map, meshes };
}

const readMatrix = (mesh, index = 0) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(index, m); return m; };
const baseTransform = (p) => ({ position: { x: p.x, y: p.y, z: p.z },
  rotation: { x: 0, y: p.rot, z: 0 }, scale: p.scale });

test('base IDs are stable for one seed/revision and bind to source prop fingerprints', () => {
  const a = fixture(), b = fixture();
  const one = createBaseDecorationLayer({ ...a, baseRevision: 'map-r1' });
  const two = createBaseDecorationLayer({ ...b, baseRevision: 'map-r1' });
  const changed = fixture({ props: [rock({ x: 4.25 }), flower()] });
  const newer = createBaseDecorationLayer({ ...changed, baseRevision: 'map-r1' });
  assert.deepEqual(one.list().map((e) => e.id), two.list().map((e) => e.id));
  assert.notEqual(one.list()[0].id, newer.list()[0].id);
  assert.ok(one.list().every((e) => e.id.length <= 96));
  assert.equal(one.list().length, 2);
  assert.equal(one.get('missing'), null);
  assert.equal(one.resolveHit({ object: a.meshes[0], instanceId: 0 }).id, one.list()[0].id);
  assert.equal(one.resolveHit({ object: a.meshes[0], instanceId: 20 }), null);
  assert.equal(one.resolveHit({ object: a.meshes[0] }), null);
});

test('move, rotate and scale preserve instance-local artwork; invalid apply is atomic and restore is exact', () => {
  const f = fixture(), layer = createBaseDecorationLayer({ ...f, baseRevision: 'map-r1' });
  const entry = layer.list().find((e) => e.kind === 'rock');
  const original = readMatrix(entry.mesh, entry.instanceIndex);
  const next = { position: { x: 14, y: 3, z: -8 }, rotation: { x: 0.2, y: 1.2, z: -0.3 }, scale: 3 };
  layer.apply([{ id: entry.id, transform: next, hidden: false }]);
  assert.deepEqual(layer.get(entry.id).transform, baseTransform(f.map.props[0]), 'public transform stays at base');
  const actual = readMatrix(entry.mesh, entry.instanceIndex);
  const base = new THREE.Matrix4().compose(new THREE.Vector3(4, 1, -3),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4), new THREE.Vector3(2, 2, 2));
  const target = new THREE.Matrix4().compose(new THREE.Vector3(14, 3, -8),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.2, -0.3, 'YXZ')), new THREE.Vector3(3, 3, 3));
  const expected = target.multiply(base.invert()).multiply(original);
  for (let i = 0; i < 16; i++) close(actual.elements[i], expected.elements[i]);
  const changed = actual.clone();
  assert.throws(() => layer.apply([{ id: 'base:unknown', transform: next, hidden: false }]));
  const afterInvalid = readMatrix(entry.mesh, entry.instanceIndex);
  for (let i = 0; i < 16; i++) close(afterInvalid.elements[i], changed.elements[i]);
  layer.restore();
  const restored = readMatrix(entry.mesh, entry.instanceIndex);
  for (let i = 0; i < 16; i++) close(restored.elements[i], original.elements[i]);
  assert.deepEqual(layer.get(entry.id).transform, baseTransform(f.map.props[0]));
});

test('hide is draft-only, rebuilds bounds, and restore re-enables exact original matrices', () => {
  const f = fixture(), layer = createBaseDecorationLayer({ ...f, baseRevision: 'map-r1' });
  const entry = layer.list().find((e) => e.kind === 'flower');
  const before = readMatrix(entry.mesh, entry.instanceIndex);
  const version = entry.mesh.instanceMatrix.version;
  const originalProps = structuredClone(f.map.props), originalColliders = structuredClone(f.map.colliders);
  layer.apply([{ id: entry.id, transform: entry.transform, hidden: true }]);
  assert.ok(readMatrix(entry.mesh, entry.instanceIndex).determinant() === 0);
  assert.ok(entry.mesh.instanceMatrix.version > version);
  assert.deepEqual(f.map.props, originalProps);
  assert.deepEqual(f.map.colliders, originalColliders);
  layer.restore();
  const after = readMatrix(entry.mesh, entry.instanceIndex);
  for (let i = 0; i < 16; i++) close(after.elements[i], before.elements[i]);
});

test('proxy model shares geometry, preserves per-instance color and relative transform', () => {
  const f = fixture(), layer = createBaseDecorationLayer({ ...f, baseRevision: 'map-r1' });
  const entry = layer.list().find((e) => e.kind === 'flower');
  const proxy = layer.model(entry.id);
  const mesh = proxy.children[0], color = new THREE.Color();
  entry.mesh.getColorAt(entry.instanceIndex, color);
  assert.equal(mesh.geometry, entry.mesh.geometry);
  assert.notEqual(mesh.material, entry.mesh.material);
  assert.ok(mesh.material.color.equals(color));
  assert.equal(mesh.matrixAutoUpdate, false);
  assert.deepEqual(proxy.position.toArray(), [0, 0, 0]);
  assert.deepEqual(proxy.rotation.toArray(), [0, 0, 0, 'XYZ']);
  assert.deepEqual(proxy.scale.toArray(), [1, 1, 1]);
  assert.equal(proxy.visible, true);
  for (let i = 0; i < 16; i++) close(mesh.matrix.elements[i], layer.entries.get(entry.id).relative.elements[i]);
  assert.equal(mesh.layers.mask, entry.mesh.layers.mask);
  assert.equal(mesh.customDepthMaterial, entry.mesh.customDepthMaterial);
  assert.equal(proxy.userData.gmBaseDecorationId, entry.id);
});

test('collider edits replace only one owned source circle and preserve independent obstacles', () => {
  const f = fixture(), layer = createBaseDecorationLayer({ ...f, baseRevision: 'map-r1' });
  const entry = layer.list().find((e) => e.kind === 'rock');
  const next = { position: { x: 9, y: 1, z: 11 }, rotation: { x: 0, y: 1, z: 0 }, scale: 4 };
  const result = layer.colliders([{ id: entry.id, transform: next, hidden: false }]);
  assert.deepEqual(result, [
    { x: 25, z: 26, r: 0.55, source: 'practice-rack', metadata: { owner: 'rack' } },
    { x: 9, z: 11, r: entry.collider.radius * 4, source: 'rock-prop', metadata: { owner: 0 } },
  ]);
  assert.deepEqual(f.map.colliders, [
    { x: 4, z: -3, r: 1.1, source: 'rock-prop', metadata: { owner: 0 } },
    { x: 25, z: 26, r: 0.55, source: 'practice-rack', metadata: { owner: 'rack' } },
  ]);
  const hidden = layer.colliders([{ id: entry.id, transform: next, hidden: true }]);
  assert.deepEqual(hidden, [{ x: 25, z: 26, r: 0.55, source: 'practice-rack', metadata: { owner: 'rack' } }]);
});

test('ambiguous collider ownership prevents edits instead of removing unrelated obstacles', () => {
  const f = fixture({ duplicateRockCollider: true });
  const layer = createBaseDecorationLayer({ ...f, baseRevision: 'map-r1' });
  const entry = layer.list().find((e) => e.kind === 'rock');
  assert.equal(entry.editable, false);
  assert.equal(layer.resolveHit({ object: entry.mesh, instanceId: entry.instanceIndex }), null);
  assert.throws(() => layer.apply([{ id: entry.id, transform: entry.transform, hidden: false }]));
  assert.deepEqual(layer.colliders(), f.map.colliders);
});

test('two props sharing one exact collider are both non-editable and cannot claim that collider', () => {
  const props = [rock(), rock({ v: 0.8 }), flower()];
  const f = fixture({ props });
  const original = structuredClone(f.map.colliders);
  const layer = createBaseDecorationLayer({ ...f, baseRevision: 'map-r1' });
  const entries = layer.list().filter((entry) => entry.kind === 'rock');
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => !entry.editable));
  for (const entry of entries) {
    assert.throws(() => layer.apply([{ id: entry.id, transform: entry.transform, hidden: false }]));
  }
  assert.deepEqual(layer.colliders(), original);
  assert.deepEqual(f.map.colliders, original);
});
