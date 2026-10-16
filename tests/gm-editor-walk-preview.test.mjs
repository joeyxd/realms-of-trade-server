import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { createPreviewMap, EditorWalkPreview } from '../src/editor/walkPreview.js';

class FakeWindow {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, capture = false) {
    const entries = this.listeners.get(type) || [];
    entries.push({ fn, capture }); this.listeners.set(type, entries);
  }
  removeEventListener(type, fn, capture = false) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry.fn !== fn || entry.capture !== capture));
  }
  dispatch(type, event = {}) {
    const e = { code: '', target: null, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...event };
    for (const { fn } of this.listeners.get(type) || []) { fn(e); if (e.stopped) break; }
    return e;
  }
  count(type) { return (this.listeners.get(type) || []).length; }
}

function fixture() {
  const map = generateWorld(91724);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 1400);
  camera.position.set(8, 10, 15); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
  const win = new FakeWindow(); globalThis.window = win;
  let created = 0, disposed = 0, lastState = null;
  const preview = new EditorWalkPreview({ camera, canvas: {}, map, ownsTarget: (target) => target?.ownsControls,
    createView: () => { created++; return { update(_dt, state) { lastState = state; }, dispose() { disposed++; } }; } });
  return { map, camera, win, preview, counts: () => ({ created, disposed }), lastState: () => lastState };
}

test('preview map copies collider data and queries large and huge circles conservatively', () => {
  const map = generateWorld(91724), source = [{ x: 101, z: -99, r: 0.5 }, { x: -1, z: 2, r: 23 }];
  const preview = createPreviewMap(map, source);
  source[0].x = -500;
  assert.equal(preview.colliders[0].x, 101);
  assert.notEqual(preview.colliders, source);
  assert.deepEqual([...preview.queryColliders(0, 0, 110)].sort(), [0, 1]);
  const huge = createPreviewMap(map, [{ x: 1e7, z: 0, r: 1e7 }]);
  assert.deepEqual(huge.queryColliders(0, 0, 0), [0]);
  assert.equal(map.colliders.length > 0, true);
});

test('preview walks across open terrain and restores camera and listeners on stop', () => {
  const f = fixture(), beforePosition = f.camera.position.clone(), beforeQuaternion = f.camera.quaternion.clone();
  assert.equal(f.preview.start({ colliders: [], point: f.map.landmarks.village }), true);
  const start = f.preview.position;
  assert.ok(start);
  f.win.dispatch('keydown', { code: 'KeyW' });
  for (let i = 0; i < 60; i++) f.preview.update(1 / 60);
  assert.notDeepEqual(f.preview.position, start);
  assert.ok(f.lastState());
  f.preview.stop();
  assert.equal(f.preview.active, false);
  assert.equal(f.preview.world, null);
  assert.deepEqual(f.camera.position.toArray(), beforePosition.toArray());
  assert.deepEqual(f.camera.quaternion.toArray(), beforeQuaternion.toArray());
  assert.equal(f.win.count('keydown'), 0); assert.equal(f.win.count('keyup'), 0); assert.equal(f.win.count('blur'), 0);
  assert.deepEqual(f.counts(), { created: 1, disposed: 1 });
});

test('player radius collides with preview-only static circles', () => {
  const f = fixture(), p = f.map.landmarks.village;
  // Camera forward is close to -Z; the circle is across the walking line.
  const wall = { x: p.x, z: p.z - 2, r: 0.8 };
  f.preview.start({ colliders: [wall], point: p });
  const start = f.preview.position;
  assert.ok(Math.hypot(start.x - p.x, start.z - p.z) < 0.01, 'spawn should use the requested standable point');
  f.win.dispatch('keydown', { code: 'KeyW' });
  for (let i = 0; i < 120; i++) f.preview.update(1 / 60);
  const end = f.preview.position;
  assert.ok(Math.hypot(end.x - wall.x, end.z - wall.z) >= wall.r + 0.4 - 1e-5);
  assert.ok(end.z < start.z, 'player should advance until the circle blocks further travel');
  f.preview.stop();
});

test('D moves along the actual camera-right direction', () => {
  const f = fixture(), direction = new THREE.Vector3();
  f.camera.getWorldDirection(direction); direction.y = 0; direction.normalize();
  const right = new THREE.Vector3(-direction.z, 0, direction.x);
  f.preview.start({ colliders: [], point: f.map.landmarks.village });
  const start = f.preview.position;
  f.win.dispatch('keydown', { code: 'KeyD' });
  for (let i = 0; i < 30; i++) f.preview.update(1 / 60);
  const end = f.preview.position;
  const displacement = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
  assert.ok(displacement.dot(right) > 0.5, `D should move right, got dot=${displacement.dot(right)}`);
  f.preview.stop();
});

test('blocked or water spawn searches nearby, while fully blocked terrain reports unavailable', () => {
  const f = fixture(), p = f.map.landmarks.village;
  const blocker = [{ x: p.x, z: p.z, r: 1.2 }];
  f.preview.start({ colliders: blocker, point: p });
  assert.ok(Math.hypot(f.preview.position.x - p.x, f.preview.position.z - p.z) > 0.5);
  f.preview.stop();
  assert.throws(() => f.preview.start({ colliders: [{ x: p.x, z: p.z, r: 100 }], point: p }), /spawn_unavailable/);
  assert.equal(f.preview.active, false);
});

test('blur clears held movement and velocity; UI-owned keys pass through', () => {
  const f = fixture(); f.preview.start({ colliders: [], point: f.map.landmarks.village });
  const owned = f.win.dispatch('keydown', { code: 'KeyW', target: { ownsControls: true } });
  assert.equal(owned.stopped, false);
  f.win.dispatch('keydown', { code: 'KeyW' });
  for (let i = 0; i < 10; i++) f.preview.update(1 / 60);
  f.win.dispatch('blur');
  assert.equal(f.preview.keys.size, 0);
  assert.equal(f.preview.world.ecs.vx[f.preview.body], 0);
  assert.equal(f.preview.world.ecs.vz[f.preview.body], 0);
  f.preview.stop();
});

test('startup failure and repeated lifecycle leave no view or listeners behind', () => {
  const f = fixture();
  const p = f.map.landmarks.village;
  assert.throws(() => f.preview.start({ colliders: [{ x: p.x, z: p.z, r: 100 }], point: p }), /spawn_unavailable/);
  assert.equal(f.win.count('keydown'), 0);
  f.preview.start({ colliders: [], point: f.map.landmarks.village });
  assert.equal(f.preview.start({ colliders: [], point: f.map.landmarks.village }), true);
  f.preview.stop(); f.preview.stop();
  assert.deepEqual(f.counts(), { created: 1, disposed: 1 });
  assert.equal(f.win.count('keydown'), 0);
});

test('createView failure restores camera and removes preview listeners', () => {
  const map = generateWorld(91724), camera = new THREE.PerspectiveCamera(35, 1, 0.5, 1400);
  camera.position.set(8, 10, 15); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
  const beforePosition = camera.position.clone(), beforeQuaternion = camera.quaternion.clone(), win = new FakeWindow();
  globalThis.window = win;
  const preview = new EditorWalkPreview({ camera, canvas: {}, map, createView() { throw new Error('view_failed'); } });
  assert.throws(() => preview.start({ colliders: [], point: map.landmarks.village }), /view_failed/);
  assert.equal(preview.active, false); assert.equal(preview.world, null);
  assert.deepEqual(camera.position.toArray(), beforePosition.toArray());
  assert.deepEqual(camera.quaternion.toArray(), beforeQuaternion.toArray());
  assert.equal(win.count('keydown'), 0); assert.equal(win.count('keyup'), 0); assert.equal(win.count('blur'), 0);
});
