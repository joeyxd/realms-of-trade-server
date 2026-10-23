import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { measureModelCost } from '../src/editor/modelCost.js';

function geometry(points = [0, 0, 0, 1, 0, 0, 0, 0, 1]) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return result;
}

function model(meshes) {
  const root = new THREE.Group();
  for (const mesh of meshes) root.add(mesh);
  return root;
}

function mesh(geo = geometry(), material = new THREE.MeshBasicMaterial()) {
  return new THREE.Mesh(geo, material);
}

test('measures indexed and non-indexed triangles with drawRange and group intersections', () => {
  const indexed = geometry([
    0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 0, 0, 3, 0, 0, 2, 0, 1,
  ]);
  indexed.setIndex([0, 1, 2, 3, 4, 5]);
  indexed.addGroup(0, 3, 0);
  indexed.addGroup(3, 3, 1);
  indexed.setDrawRange(1, 5);
  const first = new THREE.MeshBasicMaterial();
  const second = new THREE.MeshBasicMaterial();
  const grouped = mesh(indexed, [first, second]);
  const plain = mesh(geometry([0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1]));
  plain.geometry.setDrawRange(0, 5);
  const result = measureModelCost(model([grouped, plain]));
  assert.equal(result.triangles, 2, 'group clips produce one indexed triangle and one partial non-indexed triangle');
  assert.equal(result.primitives, 3, 'two visible material groups plus one ungrouped draw call');
  assert.equal(result.geometries, 2);
  assert.equal(result.materials, 3);
});

test('deduplicates shared geometry, materials, and loaded texture maps in the cost estimate', () => {
  const sharedGeometry = geometry();
  const sharedTexture = new THREE.Texture();
  sharedTexture.image = { width: 64, height: 32 };
  const sharedMaterial = new THREE.MeshBasicMaterial({ map: sharedTexture });
  const result = measureModelCost(model([mesh(sharedGeometry, sharedMaterial), mesh(sharedGeometry, sharedMaterial)]));
  assert.equal(result.triangles, 2);
  assert.equal(result.primitives, 2);
  assert.equal(result.geometries, 1);
  assert.equal(result.materials, 1);
  assert.deepEqual(result.textures, [{ width: 64, height: 32 }]);
  assert.equal(result.textureBytes, Math.ceil(64 * 32 * 4 * (4 / 3)));
});

test('uses conservative root-local XZ bounds after child transforms', () => {
  const root = new THREE.Group();
  root.position.set(12, 4, -8);
  root.rotation.y = Math.PI / 4;
  const child = mesh(geometry([-1, 0, -2, 1, 0, -2, 0, 3, 2]));
  child.position.set(3, 0, 4);
  child.scale.set(2, 1, 0.5);
  root.add(child);
  const result = measureModelCost(root);
  assert.ok(result.radius >= Math.hypot(5, 5), `expected a conservative radius, got ${result.radius}`);
  assert.ok(result.radius < 10);
});

test('ignores invisible objects and material groups while retaining visible group cost', () => {
  const geo = geometry([
    0, 0, 0, 1, 0, 0, 0, 0, 1,
    2, 0, 0, 3, 0, 0, 2, 0, 1,
  ]);
  geo.addGroup(0, 3, 0);
  geo.addGroup(3, 3, 1);
  const hidden = new THREE.MeshBasicMaterial(); hidden.visible = false;
  const visible = new THREE.MeshBasicMaterial();
  const hiddenObject = mesh(); hiddenObject.visible = false;
  const result = measureModelCost(model([hiddenObject, mesh(geo, [hidden, visible])]));
  assert.equal(result.triangles, 1);
  assert.equal(result.primitives, 1);
  assert.equal(result.materials, 1);
});

test('fails closed on empty, non-triangle, unbounded, and not-yet-loaded models', () => {
  assert.throws(() => measureModelCost(new THREE.Group()), /no supported rendered mesh triangles/);
  assert.throws(() => measureModelCost(model([mesh(new THREE.BufferGeometry())])), /position attribute|empty geometry/);
  const noBounds = geometry();
  noBounds.setAttribute('position', new THREE.Float32BufferAttribute([NaN, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  assert.throws(() => measureModelCost(model([mesh(noBounds)])), /finite bounds/);
  const texture = new THREE.Texture();
  assert.throws(() => measureModelCost(model([mesh(geometry(), new THREE.MeshBasicMaterial({ map: texture }))])), /loaded image dimensions/);
});
