import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildNavalRig, newNavalState } from '../src/sim/naval/handling.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { LAYER } from '../src/render/pipeline.js';
import { NavalLabEffects } from '../tools/naval-lab/effects.js';

function boat(overrides = {}) {
  return { ...newNavalState(), x: 18, z: 26, yaw: 0, vx: 0, vz: 2.5, ...overrides };
}

function wakeMeshes(fx) {
  return fx.scene.children.filter((object) => object.name.startsWith('naval-lab-wake-ribbon-'));
}

function spraySheets(scene) {
  return scene.children.filter((object) => object.name.startsWith('naval-lab-bow-spray-'));
}

function drawPositions(mesh) {
  const attribute = mesh.geometry.getAttribute('position');
  const count = mesh.geometry.drawRange.count === Infinity
    ? attribute.count
    : Math.min(attribute.count, mesh.geometry.drawRange.count);
  return attribute.array.slice(0, count * attribute.itemSize);
}

function wakeCentroid(fx) {
  let x = 0, z = 0, count = 0;
  for (const mesh of wakeMeshes(fx)) {
    const values = drawPositions(mesh);
    for (let i = 0; i < values.length; i += 3) { x += values[i]; z += values[i + 2]; count++; }
  }
  assert.ok(count > 0, 'wake geometry has visible vertices');
  return [x / count, z / count];
}

function advance(fx, state, rig, frames, dt = 0.05) {
  for (let i = 0; i < frames; i++) {
    state.yaw = 0.24 + i * 0.012;
    state.x += Math.sin(state.yaw) * state.vz * dt;
    state.z += Math.cos(state.yaw) * state.vz * dt;
    fx.update(dt, { state, rig });
  }
}

function advanceStraight(fx, state, rig, frames, dt = 0.05) {
  const yaw = state.yaw;
  for (let i = 0; i < frames; i++) {
    state.x += Math.sin(yaw) * state.vz * dt;
    state.z += Math.cos(yaw) * state.vz * dt;
    fx.update(dt, { state, rig });
  }
}

test('wake history follows a sustained curved run within its per-side time and vertex budgets', () => {
  for (const mobile of [true, false]) {
    const fx = new NavalLabEffects(new THREE.Scene(), { mobile, reducedMotion: true });
    const rig = buildNavalRig(STARTER_RAFT, []), state = boat();
    const d0 = fx.diagnostics();
    const capacity = mobile ? 24 : 40;
    assert.equal(d0.wakeCapacity, capacity);
    assert.equal(d0.wakeSeconds, 4);
    assert.equal(d0.poolCapacity, mobile ? 144 : 288);

    advance(fx, state, rig, 180);
    const d = fx.diagnostics();
    const meshes = wakeMeshes(fx);
    assert.equal(meshes.length, 2);
    assert.ok(d.wakeSamples > 1, 'smooth motion builds a continuous trail');
    assert.ok(d.wakeSamples <= capacity, 'sample storage stays within the device budget');
    assert.ok(d.wakeVertices > 0);
    assert.ok(d.wakeVertices <= (capacity - 1) * 12, 'mesh work is bounded by the fixed two-side vertex buffers');
    assert.equal(d.wakeVertices, meshes.reduce((sum, mesh) => sum + mesh.geometry.drawRange.count, 0));
    assert.ok(meshes.every((mesh) => mesh.geometry.getAttribute('position').count === (capacity - 1) * 6));

    const points = meshes.flatMap((mesh) => Array.from(drawPositions(mesh)));
    assert.ok(points.every(Number.isFinite), 'curved history contains finite world positions');
    const xs = [], zs = [];
    for (let i = 0; i < points.length; i += 3) { xs.push(points[i]); zs.push(points[i + 2]); }
    assert.ok(Math.max(...xs) - Math.min(...xs) > 2, 'the history spans the run instead of collapsing to a point');
    assert.ok(Math.max(...zs) - Math.min(...zs) > 2);
    fx.dispose();
  }
});

test('reduced motion freezes current flow phase while the curved band keeps its fixed geometry budget', () => {
  const fx = new NavalLabEffects(new THREE.Scene(), { mobile: true, reducedMotion: true });
  const rig = buildNavalRig(STARTER_RAFT, []), state = boat({ vx: 0, vz: 0 });
  const before = fx.diagnostics();
  const positions = fx.currentBand.geometry.getAttribute('position').array.slice();
  const flow = fx.currentBand.geometry.getAttribute('aFlow').array.slice();
  assert.ok(before.currentTriangles > 0);

  for (let i = 0; i < 80; i++) fx.update(0.05, { state, rig, currents: true });
  const after = fx.diagnostics();
  assert.equal(after.flowPhase, 0, 'reduced motion keeps the shader phase at its static value');
  assert.equal(after.currentTriangles, before.currentTriangles);
  assert.equal(after.currentTriangles, positions.length / 9);
  assert.deepEqual(fx.currentBand.geometry.getAttribute('position').array, positions);
  assert.deepEqual(fx.currentBand.geometry.getAttribute('aFlow').array, flow);
  fx.dispose();
});

test('stationary and low-speed updates do not add geometric tracks; existing wakes age out', () => {
  const fx = new NavalLabEffects(new THREE.Scene(), { mobile: true, reducedMotion: true });
  const rig = buildNavalRig(STARTER_RAFT, []), state = boat();
  advance(fx, state, rig, 12);
  const before = fx.diagnostics();
  assert.ok(before.wakeSamples > 0);
  const emissions = before.wakeEmissions;
  const anchors = fx.trails.map((trail) => trail.history.map((point) => [...point]));

  state.vz = 0.12;
  for (let i = 0; i < 20; i++) fx.update(0.05, { state, rig });
  assert.equal(fx.diagnostics().wakeEmissions, emissions, 'slow drift emits no new wake samples');
  assert.ok(fx.diagnostics().wakeSamples <= before.wakeSamples, 'aging may retire samples but cannot add low-speed samples');
  for (let side = 0; side < fx.trails.length; side++) {
    for (const point of fx.trails[side].history) {
      assert.ok(anchors[side].some((old) => old.every((value, axis) => Math.abs(value - point[axis]) < 1e-6)),
        'remaining anchors belong to the earlier moving wake');
    }
  }

  for (let i = 0; i < 86; i++) fx.update(0.05, { state, rig });
  const aged = fx.diagnostics();
  assert.equal(aged.wakeSamples, 0);
  assert.equal(aged.wakeVertices, 0);
  assert.ok(wakeMeshes(fx).every((mesh) => mesh.geometry.drawRange.count === 0));
  fx.dispose();
});

test('pause freezes wake geometry, age, and particles; reset and dispose release wake state', () => {
  const scene = new THREE.Scene();
  const fx = new NavalLabEffects(scene, { mobile: true, reducedMotion: false });
  const rig = buildNavalRig(STARTER_RAFT, []), state = boat();
  advance(fx, state, rig, 16);
  const before = fx.diagnostics();
  const positions = wakeMeshes(fx).map(drawPositions);
  const colors = wakeMeshes(fx).map((mesh) => mesh.geometry.getAttribute('color').array.slice());
  const particles = fx.pool.alive.slice();
  state.x += 80;
  state.z -= 30;
  for (let i = 0; i < 30; i++) fx.update(0.05, { state, rig, paused: true });
  assert.deepEqual(fx.diagnostics(), before, 'paused simulation time does not age wake or particles');
  assert.deepEqual(wakeMeshes(fx).map(drawPositions), positions);
  assert.deepEqual(wakeMeshes(fx).map((mesh) => mesh.geometry.getAttribute('color').array.slice()), colors);
  assert.deepEqual(fx.pool.alive, particles);

  fx.reset();
  assert.equal(fx.diagnostics().wakeSamples, 0);
  assert.equal(fx.diagnostics().wakeVertices, 0);
  assert.equal(fx.diagnostics().wakeEmissions, 0);
  assert.ok(wakeMeshes(fx).every((mesh) => mesh.geometry.drawRange.count === 0));
  assert.equal(fx.diagnostics().activeParticles, 0);
  fx.dispose();
  assert.equal(wakeMeshes(fx).length, 0);
  assert.equal(fx.diagnostics().disposed, true);
});

test('wake position follows the actual hull centre when the rig blueprint is shifted', () => {
  const normalRig = buildNavalRig(STARTER_RAFT, []);
  const shiftedRig = buildNavalRig(STARTER_RAFT, [{ mass: 800, x: 18, z: -16, height: 0 }]);
  assert.ok(Math.hypot(shiftedRig.hullCx - shiftedRig.cx, shiftedRig.hullCz - shiftedRig.cz) >
    Math.hypot(normalRig.hullCx - normalRig.cx, normalRig.hullCz - normalRig.cz) + 3);
  const first = new NavalLabEffects(new THREE.Scene(), { mobile: true, reducedMotion: true });
  const second = new NavalLabEffects(new THREE.Scene(), { mobile: true, reducedMotion: true });
  const stateA = boat({ yaw: 0.68 }), stateB = { ...stateA };
  advanceStraight(first, stateA, normalRig, 28);
  advanceStraight(second, stateB, shiftedRig, 28);

  const [ax, az] = wakeCentroid(first), [bx, bz] = wakeCentroid(second);
  const hullToComX = (shiftedRig.hullCx - shiftedRig.cx) - (normalRig.hullCx - normalRig.cx);
  const hullToComZ = (shiftedRig.hullCz - shiftedRig.cz) - (normalRig.hullCz - normalRig.cz);
  const expectedX = Math.cos(stateA.yaw) * hullToComX + Math.sin(stateA.yaw) * hullToComZ;
  const expectedZ = -Math.sin(stateA.yaw) * hullToComX + Math.cos(stateA.yaw) * hullToComZ;
  assert.ok(Math.abs((bx - ax) - expectedX) < 0.003, 'the wake moves with the shifted hull rather than the simulation origin');
  assert.ok(Math.abs((bz - az) - expectedZ) < 0.003);
  first.dispose(); second.dispose();
});

test('bow spray sheets stay bounded, respond asymmetrically to a turn, and clean up across reruns', () => {
  for (const mobile of [true, false]) {
    const scene = new THREE.Scene();
    const fx = new NavalLabEffects(scene, { mobile });
    const rig = buildNavalRig(STARTER_RAFT, []);
    const sheets = spraySheets(scene);
    const segments = mobile ? 6 : 9;
    assert.equal(sheets.length, 2);
    assert.equal(fx.diagnostics().spraySheetTriangles, mobile ? 48 : 72);
    assert.ok(sheets.every((sheet) => sheet.layers.isEnabled(LAYER.FX)));
    assert.notEqual(sheets[0].geometry, sheets[1].geometry);
    assert.notEqual(sheets[0].material, sheets[1].material);

    const state = boat({ vx: 0, vz: 8, omega: 1.2 });
    fx.update(0.05, { state, rig });
    assert.ok(sheets.every((sheet) => sheet.visible));
    for (const sheet of sheets) {
      const positions = sheet.geometry.getAttribute('position');
      const colors = sheet.geometry.getAttribute('color');
      assert.equal(positions.count, segments * 12);
      assert.equal(colors.count, positions.count);
      let top = -Infinity;
      for (let i = 1; i < positions.array.length; i += 3) top = Math.max(top, positions.array[i]);
      assert.ok(top > 0.08, 'fast motion raises a visible bow sheet');
      assert.ok(top <= 0.9, 'white water remains below its vertical budget');
    }
    const sideHeights = sheets.map((sheet) => {
      const values = sheet.geometry.getAttribute('position').array;
      let top = -Infinity;
      for (let i = 1; i < values.length; i += 3) top = Math.max(top, values[i]);
      return top;
    });
    assert.ok(Math.abs(sideHeights[0] - sideHeights[1]) > 0.03, 'turn load makes port and starboard spray visibly asymmetric');
    const frozen = sheets.map((sheet) => sheet.geometry.getAttribute('position').array.slice());
    state.x += 40;
    for (let i = 0; i < 20; i++) fx.update(0.05, { state, rig, paused: true });
    assert.deepEqual(sheets.map((sheet) => sheet.geometry.getAttribute('position').array.slice()), frozen,
      'pause freezes both spray surfaces');

    fx.update(0.05, { state: { ...state, vx: 0, vz: 1.8 }, rig });
    assert.ok(sheets.every((sheet) => !sheet.visible), 'spray is hidden below its speed threshold');
    fx.reset();
    assert.ok(sheets.every((sheet) => !sheet.visible), 'reset hides the sheets');
    fx.dispose();
    assert.equal(spraySheets(scene).length, 0);
    fx.dispose();

    const rerun = new NavalLabEffects(scene, { mobile, reducedMotion: true });
    assert.equal(spraySheets(scene).length, 2, 'a new lab run owns exactly two fresh sheets');
    rerun.update(0.05, { state: boat({ vx: 0, vz: 8 }), rig });
    assert.ok(spraySheets(scene).every((sheet) => !sheet.visible), 'reduced motion suppresses bow spray');
    assert.equal(rerun.diagnostics().spraySheetTriangles, mobile ? 48 : 72, 'reduced motion retains the fixed mesh budget');
    rerun.dispose();
    assert.equal(spraySheets(scene).length, 0);
  }
});
