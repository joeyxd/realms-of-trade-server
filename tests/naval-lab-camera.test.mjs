import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NavalLabCamera } from '../tools/naval-lab/camera.js';
import { LAB_FIXTURES, labFixture } from '../tools/naval-lab/fixtures.js';
import {
  buildNavalRig, jettisonLabCargo, navalPose, newNavalState,
} from '../src/sim/naval/handling.js';

const ASPECTS = [1.6, 0.76, 2.16];

function frameFor(fixture, aspect, { yaw = 0, reducedMotion = false } = {}) {
  const rig = buildNavalRig(fixture.parts, fixture.cargo);
  const state = { ...newNavalState(), yaw };
  const pose = navalPose(state, rig);
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1400);
  const controller = new NavalLabCamera(camera, { reducedMotion });
  controller.update(1 / 60, { state, rig, pose });
  return { camera, controller, fixture, rig, state, pose };
}

function boatPoint(pose, yaw, x, y, z) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return new THREE.Vector3(pose.x + x * c + z * s, pose.y + y,
    pose.z - x * s + z * c);
}

function screenPoint(camera, point) {
  const ndc = point.clone().project(camera);
  return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2, depth: ndc.z };
}

function horizonScreenY(camera) {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  direction.y = 0;
  direction.normalize();
  const point = camera.position.clone().addScaledVector(direction, 1000);
  point.y = camera.position.y;
  return screenPoint(camera, point).y;
}

function range(points, key) {
  const values = points.map((point) => point[key]);
  return [Math.min(...values), Math.max(...values)];
}

test('chase framing projects the deck, sail, and house inside the intended screen composition', () => {
  const failures = [];
  for (const fixtureId of ['empty', 'house']) {
    for (const aspect of ASPECTS) {
      const fixture = labFixture(fixtureId);
      const { camera, rig, state, pose } = frameFor(fixture, aspect);
      const deck = [
        boatPoint(pose, state.yaw, rig.hullCx - rig.beam / 2, 0, rig.hullCz - rig.length / 2),
        boatPoint(pose, state.yaw, rig.hullCx + rig.beam / 2, 0, rig.hullCz - rig.length / 2),
        boatPoint(pose, state.yaw, rig.hullCx - rig.beam / 2, 0, rig.hullCz + rig.length / 2),
        boatPoint(pose, state.yaw, rig.hullCx + rig.beam / 2, 0, rig.hullCz + rig.length / 2),
      ].map((point) => screenPoint(camera, point));
      const [left, right] = range(deck, 'x');
      const [top, bottom] = range(deck, 'y');
      const deckCenterY = (top + bottom) / 2;
      const sails = fixture.parts.filter(([kind]) => kind === 'sail').map(([, x, z]) =>
        screenPoint(camera, boatPoint(pose, state.yaw, (x + 0.5) * 2 - 0.4,
          fixtureId === 'house' ? 3.4 : 3.4, (z + 0.5) * 2)));
      const envelopeTop = fixtureId === 'house'
        ? screenPoint(camera, boatPoint(pose, state.yaw, rig.hullCx, 5.8, rig.hullCz))
        : sails[0];
      const metrics = JSON.stringify({ fixture: fixtureId, aspect, horizonY: horizonScreenY(camera),
        deckX: [left, right], deckY: [top, bottom], deckCenterY, sailTops: sails,
        highestEnvelope: envelopeTop, fov: camera.fov });

      if (Math.abs(horizonScreenY(camera) - 0.25) > 0.05) failures.push(`horizon target: ${metrics}`);
      if (!(deckCenterY >= 0.5 && deckCenterY <= 0.84)) failures.push(`deck vertical target: ${metrics}`);
      if (!(left >= 0.02 && right <= 0.98 && top >= 0.02 && bottom <= 0.98)) {
        failures.push(`full hull visibility: ${metrics}`);
      }
      if (!sails.every(({ x, y }) => x >= 0.02 && x <= 0.98 && y >= 0.02 && y <= 0.98)) {
        failures.push(`sail top visibility: ${metrics}`);
      }
      if (!(envelopeTop.x >= 0.02 && envelopeTop.x <= 0.98 &&
        envelopeTop.y >= 0.02 && envelopeTop.y <= 0.98)) {
        failures.push(`highest raft/house envelope visibility: ${metrics}`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('chase view stays aft and follows a heading across the yaw wrap without a camera snap', () => {
  const fixture = labFixture('empty');
  const { camera, controller, rig, pose } = frameFor(fixture, 1.6, { yaw: Math.PI - 0.01 });
  const hullCenter = boatPoint(pose, Math.PI - 0.01, rig.hullCx, 0, rig.hullCz);
  const offset = camera.position.clone().sub(hullCenter);
  const forward = new THREE.Vector3(Math.sin(Math.PI - 0.01), 0, Math.cos(Math.PI - 0.01));
  const starboard = new THREE.Vector3(Math.cos(Math.PI - 0.01), 0, -Math.sin(Math.PI - 0.01));
  assert.ok(offset.dot(forward) < 0, 'camera must stay behind the raft along its heading');
  assert.ok(offset.dot(starboard) > 0, 'camera must keep the approved rear-quarter side');

  const before = controller.diagnostics();
  const nextState = { ...newNavalState(), yaw: -Math.PI + 0.01 };
  const nextPose = navalPose(nextState, rig);
  const after = controller.update(1 / 60, { state: nextState, rig, pose: nextPose });
  const yawStep = Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw));
  const cameraStep = new THREE.Vector3(...after.position).distanceTo(new THREE.Vector3(...before.position));
  assert.ok(Math.abs(yawStep) < 0.03, `wrapped yaw should take the short path (${yawStep})`);
  assert.ok(cameraStep < 0.5, `one frame across the yaw wrap must not snap (${cameraStep})`);
});

test('chase FOV remains in its 50 plus-or-minus 6 degree envelope, with reduced motion fixed', () => {
  const fixture = labFixture('empty');
  for (const fovOffset of [-6, 0, 6]) {
    const { camera, controller, state, rig, pose } = frameFor(fixture, 1.6);
    controller.update(1 / 60, { state, rig, pose, fovOffset });
    assert.ok(camera.fov >= 44 && camera.fov <= 56, `unexpected chase FOV ${camera.fov}`);
  }
  const reduced = frameFor(fixture, 0.76, { reducedMotion: true });
  reduced.controller.update(1 / 60, { state: reduced.state, rig: reduced.rig, pose: reduced.pose, fovOffset: 6 });
  assert.equal(reduced.camera.fov, 50, 'reduced motion keeps the neutral chase FOV');
});

test('pause freezes camera follow, ballast release preserves the hull view, and simulation inputs stay untouched', () => {
  const fixture = labFixture('side');
  const rig = buildNavalRig(fixture.parts, fixture.cargo);
  const state = Object.freeze({ ...newNavalState(), x: 17, z: -31, yaw: 0.62,
    vx: 2.4, vz: -0.8, omega: 0.17 });
  const pose = Object.freeze(navalPose(state, rig));
  const stateBefore = { ...state }, poseBefore = { ...pose }, rigBefore = { ...rig };
  const camera = new THREE.PerspectiveCamera(50, 0.76, 0.1, 1400);
  const controller = new NavalLabCamera(camera);
  controller.update(1 / 60, { state, rig, pose });
  const pausedBefore = controller.diagnostics();

  const movedState = Object.freeze({ ...state, x: state.x + 30, z: state.z - 20, yaw: -1.2 });
  const movedPose = Object.freeze(navalPose(movedState, rig));
  const pausedAfter = controller.update(1, { state: movedState, rig, pose: movedPose, paused: true });
  assert.deepEqual(pausedAfter.position, pausedBefore.position, 'pause must freeze the camera position');
  assert.deepEqual(pausedAfter.target, pausedBefore.target, 'pause must freeze the camera aim');
  assert.equal(pausedAfter.yaw, pausedBefore.yaw, 'pause must freeze camera heading');

  const ejected = jettisonLabCargo(fixture, state);
  const emptyRig = buildNavalRig(ejected.fixture.parts, ejected.fixture.cargo);
  const emptyPose = navalPose(ejected.state, emptyRig);
  const releaseCamera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 1400);
  const releaseController = new NavalLabCamera(releaseCamera);
  releaseController.update(1 / 60, { state, rig, pose });
  const beforeJettison = releaseController.diagnostics();
  const afterJettison = releaseController.update(1 / 60, {
    state: ejected.state, rig: emptyRig, pose: emptyPose,
  });
  const hullBefore = boatPoint(pose, state.yaw, rig.hullCx, 0, rig.hullCz);
  const hullAfter = boatPoint(emptyPose, ejected.state.yaw, emptyRig.hullCx, 0, emptyRig.hullCz);
  assert.ok(Math.hypot(hullBefore.x - hullAfter.x, hullBefore.z - hullAfter.z) < 1e-9,
    'jettison must preserve the geometric hull center');
  const jettisonDelta = new THREE.Vector3(...afterJettison.position)
    .distanceTo(new THREE.Vector3(...beforeJettison.position));
  assert.ok(jettisonDelta < 0.08,
    `dropping ballast should not teleport the view from the same hull (${jettisonDelta})`);

  assert.deepEqual(state, stateBefore, 'camera follow must not alter simulated state');
  assert.deepEqual(pose, poseBefore, 'camera follow must not alter the render pose input');
  assert.deepEqual(rig, rigBefore, 'camera follow must not alter the handling rig');
});
