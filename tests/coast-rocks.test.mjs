import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import { readGlb, summarize } from '../tools/glb.mjs';
import { coastRockBase, coastRockGeometry, coastRockVariant, isCoastRock } from '../src/render/coastRockGeometry.js';

const EPS = 1e-6;

test('delivered coastal GLB keeps a small mobile budget without embedded texture payloads', () => {
  const bytes = fs.readFileSync(new URL('../assets/models/coast-rock-v1.glb', import.meta.url));
  const parsed = readGlb(bytes), info = summarize(parsed);
  assert.ok(bytes.length <= 16384);
  assert.equal(info.meshes, 1);
  assert.ok(info.tris > 0 && info.tris <= 100);
  assert.deepEqual(info.images, []);
  assert.deepEqual(info.animations, []);
  const primitive = parsed.json.meshes[0].primitives[0];
  assert.ok(primitive.attributes.NORMAL !== undefined && primitive.attributes.COLOR_0 !== undefined);
  const accessor = parsed.json.accessors[primitive.attributes.POSITION];
  const view = parsed.json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  for (let i = 0; i < accessor.count; i++) {
    const at = start + i * (view.byteStride || 12);
    const x = parsed.bin.readFloatLE(at), y = parsed.bin.readFloatLE(at + 4), z = parsed.bin.readFloatLE(at + 8);
    assert.ok(Math.hypot(x, z) <= 0.52 + EPS);
    assert.ok(y >= -EPS && y <= 0.78 + EPS);
  }
});

function geometryState(geometry) {
  return {
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, [...attribute.array]])),
    index: geometry.index ? [...geometry.index.array] : null,
    groups: geometry.groups.map((group) => ({ ...group })),
  };
}

test('coastal rock silhouettes fit every rotation, sit on the base, and have finite shaded surface data', () => {
  const source = new THREE.IcosahedronGeometry(1, 1);
  const expectedHeights = [0.78, 0.56, 0.36];

  for (let variant = 0; variant < 3; variant++) {
    const geometry = coastRockGeometry(source, variant);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const colors = geometry.getAttribute('color');
    let minY = Infinity, maxY = -Infinity, maxRadius = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      maxRadius = Math.max(maxRadius, Math.hypot(x, z));
      assert.ok(Number.isFinite(normals.getX(i)) && Number.isFinite(normals.getY(i)) && Number.isFinite(normals.getZ(i)));
      for (let channel = 0; channel < 3; channel++) {
        const value = colors.getComponent(i, channel);
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `color ${i}:${channel} is in range`);
      }
    }
    assert.ok(maxRadius <= 0.52 + EPS, `variant ${variant} stays inside the collision radius when rotated`);
    assert.ok(Math.abs(minY) <= EPS, 'the bottom of the mesh reaches its placement base');
    assert.ok(Math.abs((maxY - minY) - expectedHeights[variant]) <= EPS);
    assert.ok(positions.count > 0 && geometry.index === null, 'the returned surface is a non-indexed triangle mesh');
    assert.ok(geometry.boundingBox.min.y >= -EPS && geometry.boundingBox.max.y <= expectedHeights[variant] + EPS);
    geometry.dispose();
  }
  source.dispose();
});

test('coastal rock generation preserves indexed source geometry and its attributes', () => {
  const source = new THREE.BoxGeometry(1.8, 1.4, 1.2, 2, 2, 2);
  const before = geometryState(source);
  const variant = coastRockGeometry(source, 1);
  assert.deepEqual(geometryState(source), before);
  assert.ok(source.index, 'fixture remains indexed');
  variant.dispose();
  source.dispose();
});

test('coastal-rock eligibility requires sand rock outside every excluded mask', () => {
  const p = { kind: 'rock', x: 4, z: 7 };
  let material = 'sand';
  let masks = { path: 0, volcanic: 0, arenaFloor: 0, lava: 0 };
  const map = { materialAt: () => material, masks: () => masks };
  assert.equal(isCoastRock(map, p), true);
  assert.equal(isCoastRock(map, { ...p, kind: 'tree' }), false);
  material = 'stone';
  assert.equal(isCoastRock(map, p), false);
  material = 'sand';
  for (const key of ['path', 'volcanic', 'arenaFloor', 'lava']) {
    masks = { path: 0, volcanic: 0, arenaFloor: 0, lava: 0, [key]: key === 'path' || key === 'volcanic' ? 0.2 : 0.1 };
    assert.equal(isCoastRock(map, p), false, `${key} boundary excludes the placement`);
  }
});

test('coastal-rock variants cover three deterministic buckets', () => {
  assert.deepEqual([0, 0.32, 0.34, 0.66, 0.67, 1].map((v) => coastRockVariant({ v })), [0, 0, 1, 1, 2, 2]);
  assert.equal(coastRockVariant({ v: -1 }), 0);
  assert.equal(coastRockVariant({ v: 4 }), 2);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => coastRockVariant({ v: 0.9 }, i)), [0, 1, 2, 0, 1, 2, 0, 1]);
});

test('rock base samples the center and eight-ring, then sinks below the lowest contact', () => {
  const p = { x: 2, z: -3, scale: 2 };
  const calls = [];
  const heightAt = (x, z) => {
    calls.push([x, z]);
    return calls.length === 5 ? -0.4 : 1 + x * 0.01 + z * 0.02;
  };
  const map = { heightAt };
  const result = coastRockBase(map, p);
  assert.equal(calls.length, 9);
  assert.deepEqual(calls[0], [p.x, p.z]);
  const ringRadius = 0.48 * p.scale;
  for (let i = 0; i < 8; i++) {
    const [x, z] = calls[i + 1];
    assert.ok(Math.abs(Math.hypot(x - p.x, z - p.z) - ringRadius) <= EPS, `sample ${i} lies on the contact ring`);
  }
  assert.equal(result, -0.4 - 0.035 * p.scale);
});
