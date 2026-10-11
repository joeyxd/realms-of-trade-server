import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dockRopeGeometry, createDockRopes } from '../src/render/dockRopes.js';
import { createProps } from '../src/render/props.js';
import { assets } from '../src/render/assets/registry.js';
import { RAFT_ATLAS_ID, RAFT_ATLAS_RECTS } from '../src/render/raftMaterials.js';
import { TOWN_ALBEDO_ID } from '../src/render/townMaterials.js';

const close = (actual, expected, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) <= epsilon,
  `expected ${actual} to be within ${epsilon} of ${expected}`);

function dockFixture({ yaw = 0.73, len = 12, halfWidth = 1.7, count = 8, postScale = 1 } = {}) {
  const base = { x: 23, z: -14 };
  const dir = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const props = [];
  // Mirror the worldgen's four stations and two posts per station, in dock-local coordinates.
  for (let station = 0; station < count / 2; station++) {
    const along = 1.5 + station * ((len - 3) / Math.max(1, count / 2 - 1));
    for (const side of [-1, 1]) {
      const x = side * halfWidth;
      props.push({ kind: 'dockPost', x: base.x + Math.cos(yaw) * x + Math.sin(yaw) * along,
        y: 0.8, z: base.z - Math.sin(yaw) * x + Math.cos(yaw) * along,
        scale: postScale, rot: yaw + 0.4 });
    }
  }
  return { props, npcs: [], dock: { len, halfWidth, deckY: 0.8, base, dir } };
}

function localPoint(map, point) {
  const yaw = Math.atan2(map.dock.dir.x, map.dock.dir.z);
  const dx = point.x - map.dock.base.x, dz = point.z - map.dock.base.z;
  return { x: Math.cos(yaw) * dx - Math.sin(yaw) * dz,
    z: Math.sin(yaw) * dx + Math.cos(yaw) * dz };
}

function disposeGroup(group) {
  group.traverse((object) => { if (object.geometry) object.geometry.dispose(); });
  const materials = new Set();
  group.traverse((object) => {
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) if (material) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

function withTextureLookup(texture, fn, calls = []) {
  const original = assets.texture;
  assets.texture = (id) => { calls.push(id); return id === RAFT_ATLAS_ID ? texture : null; };
  try { return fn(); } finally { assets.texture = original; }
}

test('rope geometry is finite, deterministic, UV-bounded, budgeted, and does not read world RNG', () => {
  const map = dockFixture();
  const before = structuredClone(map);
  Object.defineProperty(map, 'rng', { get() { throw new Error('dock rope rendering must not read world RNG'); } });
  const first = dockRopeGeometry(map, true);
  const second = dockRopeGeometry(map, true);
  assert.ok(first && second);
  assert.deepEqual(map.props, before.props, 'rendering leaves the prop list untouched');
  assert.deepEqual(map.dock, before.dock, 'rendering leaves dock authority untouched');
  assert.equal(first.userData.dockRopes.wraps, 8);
  assert.equal(first.userData.dockRopes.coils, 2);
  assert.equal(first.userData.dockRopes.triangles, 4160);
  assert.ok(first.userData.dockRopes.triangles < 4500);
  assert.equal(first.userData.dockRopes.mapped, true);
  for (const name of ['position', 'normal', 'uv']) {
    const a = first.getAttribute(name), b = second.getAttribute(name);
    assert.ok(a && b, `${name} attribute exists`);
    assert.deepEqual(Array.from(a.array), Array.from(b.array), `${name} is deterministic`);
    for (const value of a.array) assert.ok(Number.isFinite(value), `${name} contains only finite values`);
  }
  const rect = RAFT_ATLAS_RECTS.rope, uv = first.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= rect.u0 - 1e-6 && uv.getX(i) <= rect.u1 + 1e-6);
    assert.ok(uv.getY(i) >= rect.v0 - 1e-6 && uv.getY(i) <= rect.v1 + 1e-6);
  }
  first.dispose(); second.dispose();
});

test('post wraps follow the rotated dock axis and the existing post positions and scale', () => {
  const map = dockFixture({ count: 2, postScale: 1.35 });
  const mesh = createDockRopes(map, null);
  assert.ok(mesh);
  mesh.updateMatrixWorld(true);
  const yaw = Math.atan2(map.dock.dir.x, map.dock.dir.z);
  close(mesh.rotation.y, yaw);
  const post = map.props.find((p) => p.kind === 'dockPost' && p.x > map.dock.base.x);
  const local = localPoint(map, post);
  const candidates = [];
  const pos = mesh.geometry.getAttribute('position');
  // The right-hand post's two-turn wrap starts at local angle zero.
  for (let i = 0; i < pos.count; i++) {
    const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (Math.abs(p.x - (local.x + 0.243 * post.scale)) < 0.055 &&
      Math.abs(p.y - (post.y + 0.23 * post.scale)) < 0.055 && Math.abs(p.z - local.z) < 0.055) candidates.push(p);
  }
  assert.ok(candidates.length > 0, 'wrap tube contains vertices at the transformed post start');
  const world = candidates[0].clone().applyMatrix4(mesh.matrixWorld);
  close(world.x, post.x + Math.cos(yaw) * 0.243 * post.scale, 0.07);
  close(world.z, post.z - Math.sin(yaw) * 0.243 * post.scale, 0.07);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('coil bounds stay in dock edge strips while leaving the central 1.4-unit walkway open', () => {
  const map = dockFixture({ halfWidth: 1.7 });
  const geometry = dockRopeGeometry(map, false);
  assert.ok(geometry);
  const { min, max } = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox);
  const centers = geometry.userData.dockRopes.coilCenters;
  assert.equal(centers.length, 2);
  for (const center of centers) {
    assert.ok(Math.abs(center.x) >= 1.2, 'each coil center is outside the center walkway');
    assert.ok(Math.abs(center.x) + 0.13 + 0.24 + 0.052 < map.dock.halfWidth,
      'spiral outer radius and tube thickness fit inside the dock edge');
  }
  // Coil tubes occupy a narrow deck-height band, separate from post wraps higher above the boards.
  const p = geometry.getAttribute('position');
  const coilVertices = [];
  for (let i = 0; i < p.count; i++) {
    const nearCoil = centers.some((center) => Math.abs(p.getZ(i) - center.z) < 0.65);
    if (nearCoil && Math.abs(p.getY(i) - map.dock.deckY) < 0.15) coilVertices.push(p.getX(i));
  }
  assert.ok(coilVertices.length > 0);
  assert.ok(Math.min(...coilVertices.map(Math.abs)) > 0.7,
    'the full coil spirals and tails leave the 1.4-unit center walkway clear');
  assert.ok(Math.max(...coilVertices.map(Math.abs)) < map.dock.halfWidth + 0.06,
    'coil tubes stay within the dock edge, allowing only tube-radius tolerance');
  assert.ok(min.x < -1.5 && max.x > 1.5, 'the ropes visibly occupy both dock edge strips');
  geometry.dispose();
});

test('createProps adds one rope mesh on the reused atlas without changing the canonical dock deck', () => {
  const atlas = new THREE.Texture();
  let atlasDisposed = false;
  atlas.addEventListener('dispose', () => { atlasDisposed = true; });
  try {
    const lookups = [];
    withTextureLookup(atlas, () => {
      const map = dockFixture();
      const baselineMap = { ...map, props: [] };
      const baseline = createProps(baselineMap);
      const withRopes = createProps(map);
      const ropes = [];
      withRopes.group.traverse((object) => { if (object.name === 'dockRopes') ropes.push(object); });
      assert.equal(ropes.length, 1);
      assert.equal(ropes[0].material.map, atlas);
      assert.equal(ropes[0].userData.dockRopes.atlas, RAFT_ATLAS_ID);
      assert.equal(ropes[0].userData.dockRopes.texturesAdded, 0);
      assert.equal(ropes[0].geometry.userData.dockRopes.triangles, 4160);
      assert.deepEqual(lookups, [TOWN_ALBEDO_ID, RAFT_ATLAS_ID, TOWN_ALBEDO_ID, RAFT_ATLAS_ID],
        'props uses the existing town and raft atlas lookups without loading a rope-specific asset');
      const originalDeck = baseline.group.getObjectByName('dockDeck').geometry;
      const newDeck = withRopes.group.getObjectByName('dockDeck').geometry;
      for (const name of ['position', 'normal', 'color', 'uv']) {
        const a = originalDeck.getAttribute(name), b = newDeck.getAttribute(name);
        assert.equal(!!a, !!b, `${name} attribute presence stays the same`);
        if (a) assert.deepEqual(Array.from(a.array), Array.from(b.array), `${name} deck geometry stays canonical`);
      }
      disposeGroup(baseline.group); disposeGroup(withRopes.group);
      assert.equal(atlasDisposed, false, 'disposing rendered props leaves the shared atlas alive');
    }, lookups);
  } finally { atlas.dispose(); }
});

test('fallbacks need no rope texture; invalid tiny docks omit ropes and wrap selection caps at sixteen posts', () => {
  const map = dockFixture();
  const fallback = createDockRopes(map, null);
  assert.ok(fallback);
  assert.equal(fallback.material.map, null);
  assert.equal(fallback.userData.dockRopes.atlas, null);
  assert.equal(fallback.userData.dockRopes.mapped, false);
  fallback.geometry.dispose(); fallback.material.dispose();

  assert.equal(dockRopeGeometry(dockFixture({ len: 2.9 }), false), null);
  const tiny = dockFixture({ len: 2.9 });
  withTextureLookup(null, () => {
    const props = createProps(tiny);
    assert.equal(props.group.getObjectByName('dockRopes'), undefined);
    disposeGroup(props.group);
  });

  const crowded = dockFixture({ count: 20 });
  const capped = dockRopeGeometry(crowded, false);
  assert.ok(capped);
  assert.equal(capped.userData.dockRopes.wraps, 16);
  assert.equal(capped.userData.dockRopes.triangles, 16 * 380 + 1120);
  capped.dispose();
});
