import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NavalLabCamera } from '../tools/naval-lab/camera.js';
import { labFixture } from '../tools/naval-lab/fixtures.js';
import { buildNavalRig, navalPose, newNavalState } from '../src/sim/naval/handling.js';

function setup() {
  const fixture = labFixture('empty');
  const rig = buildNavalRig(fixture.parts, fixture.cargo);
  const state = Object.freeze({ ...newNavalState(), x: 13, z: -29, yaw: 2.4,
    vx: 2.1, vz: -0.75, omega: 0.12 });
  const pose = Object.freeze(navalPose(state, rig));
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 1400);
  const framing = new NavalLabCamera(camera);
  return { fixture, rig, state, pose, camera, framing };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('setLook clamps each stick axis and maps non-finite samples to neutral', () => {
  const { framing, state, rig, pose } = setup();
  const input = Object.freeze({ x: 9, y: -Infinity });
  framing.setLook(input);
  assert.deepEqual(framing.look, { x: 1, y: 0 });
  framing.update(0.05, { state, rig, pose });
  assert.ok(Math.abs(framing.orbitYaw - 0.095) < 1e-12);
  assert.equal(framing.orbitPitch, 0);
  framing.setLook({ x: NaN, y: 8 });
  assert.deepEqual(framing.look, { x: 0, y: 1 });
  framing.setLook({ x: -8, y: NaN });
  assert.deepEqual(framing.look, { x: -1, y: 0 });
});

test('orbit integrates bounded dt, wraps yaw, and caps pitch at its safe view limits', () => {
  const { framing, state, rig, pose } = setup();
  framing.setLook({ x: 1, y: 1 });
  framing.update(10, { state, rig, pose });
  assert.ok(Math.abs(framing.orbitYaw - 0.19) < 1e-12, 'a long frame contributes at most 100 ms');
  assert.ok(Math.abs(framing.orbitPitch - 0.085) < 1e-12);
  for (let i = 0; i < 20; i++) framing.update(0.1, { state, rig, pose });
  assert.ok(framing.orbitYaw >= -Math.PI && framing.orbitYaw <= Math.PI);
  assert.ok(framing.orbitPitch <= 0.68 && framing.orbitPitch >= -0.18);
  framing.setLook({ x: 0, y: -1 });
  for (let i = 0; i < 20; i++) framing.update(0.1, { state, rig, pose });
  assert.ok(Math.abs(framing.orbitPitch + 0.18) < 1e-12);
  const yaw = framing.orbitYaw;
  framing.update(-1, { state, rig, pose });
  assert.equal(framing.orbitYaw, yaw, 'negative dt must not run the orbit backward');
});

test('NaN dt is neutral and cannot poison the orbit or camera transform', () => {
  const { framing, camera, state, rig, pose } = setup();
  framing.setLook({ x: 1, y: 1 });
  framing.update(Number.NaN, { state, rig, pose });
  assert.ok(Number.isFinite(framing.orbitYaw) && Number.isFinite(framing.orbitPitch));
  assert.ok(camera.position.toArray().every(Number.isFinite));
  assert.ok(framing.diagnostics().target.every(Number.isFinite));
});

test('recenter clears both orbit offsets and the held look input', () => {
  const { framing, state, rig, pose, camera } = setup();
  framing.setLook({ x: 1, y: 1 });
  framing.update(0.1, { state, rig, pose });
  assert.ok(Math.abs(framing.orbitYaw) > 0 && framing.orbitPitch > 0);
  framing.recenter();
  assert.deepEqual(framing.look, { x: 0, y: 0 });
  assert.equal(framing.orbitYaw, 0); assert.equal(framing.orbitPitch, 0);
  framing.update(0.1, { state, rig, pose });
  const hull = new THREE.Vector3(pose.x + rig.hullCx * Math.cos(state.yaw) + rig.hullCz * Math.sin(state.yaw),
    pose.y, pose.z - rig.hullCx * Math.sin(state.yaw) + rig.hullCz * Math.cos(state.yaw));
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  assert.ok(camera.position.clone().sub(hull).dot(forward) < 0, 'recentered chase view stays behind the boat');
});

test('camera orbit never edits helm yaw, velocity, pose, or rig inputs', () => {
  const { framing, state, rig, pose } = setup();
  const before = { ...state }, poseBefore = { ...pose }, rigBefore = structuredClone(rig);
  framing.setLook({ x: -1, y: 0.8 });
  for (let i = 0; i < 12; i++) framing.update(0.05, { state, rig, pose });
  assert.deepEqual(state, before);
  assert.deepEqual(pose, poseBefore);
  assert.deepEqual(rig, rigBefore);
  assert.ok(Math.abs(wrap(state.yaw - before.yaw)) < 1e-12);
  assert.equal(state.vx, before.vx); assert.equal(state.vz, before.vz); assert.equal(state.omega, before.omega);
  assert.notEqual(framing.orbitYaw, 0, 'camera look is kept in camera-local orbit state');
});

test('paused frames do not accumulate held orbit input for later unpaused frames', () => {
  const { framing, state, rig, pose } = setup();
  framing.setLook({ x: 1, y: -1 });
  for (let i = 0; i < 50; i++) framing.update(0.1, { state, rig, pose, paused: true });
  assert.equal(framing.orbitYaw, 0); assert.equal(framing.orbitPitch, 0);
  framing.setLook({ x: 0, y: 0 });
  framing.update(0.1, { state, rig, pose, paused: false });
  assert.equal(framing.orbitYaw, 0); assert.equal(framing.orbitPitch, 0,
    'resume starts with the current stick sample and does not apply paused elapsed time');
});
