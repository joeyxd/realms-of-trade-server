import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import {
  buildNavalRig, jettisonLabCargo, NAVAL_STEP, navalPose, newNavalState,
  stepNaval, windEfficiency,
} from '../src/sim/naval/handling.js';
import { LAB_WINDS, labFixture } from '../tools/naval-lab/fixtures.js';
import { measureHandling } from '../tools/naval-lab/measure.js';

const speed = (state) => Math.hypot(state.vx, state.vz);
const run = (fixture, input, wind, ticks, state = newNavalState()) => {
  const rig = buildNavalRig(fixture.parts, fixture.cargo);
  for (let i = 0; i < ticks; i++) state = stepNaval(state, input, rig, wind);
  return { state, rig };
};

test('D08 fixtures build finite aggregate mass, buoyancy, centre and inertia', () => {
  for (const id of ['empty', 'center', 'rim', 'side', 'house']) {
    const rig = buildNavalRig(labFixture(id).parts, labFixture(id).cargo);
    for (const value of Object.values(rig)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${id} rig field is finite`);
    assert.ok(rig.mass > 0);
    assert.ok(rig.buoyancy > 0);
    assert.ok(rig.inertia > 0);
    assert.equal(rig.mass, rig.dryMass + rig.cargoMass);
  }
});

test('equal ballast mass at the rim increases rotational inertia while a high side load shifts and destabilizes COM', () => {
  const centered = buildNavalRig(labFixture('center').parts, labFixture('center').cargo);
  const rim = buildNavalRig(labFixture('rim').parts, labFixture('rim').cargo);
  const side = buildNavalRig(labFixture('side').parts, labFixture('side').cargo);
  assert.equal(centered.cargoMass, rim.cargoMass);
  assert.equal(centered.mass, rim.mass);
  assert.ok(rim.inertia > centered.inertia * 2);
  assert.ok(side.cx > centered.cx + 0.5);
  assert.ok(side.height > centered.height);
  assert.ok(side.stability < centered.stability);
});

test('renderer origin from navalPose reconstructs the simulated COM at any heading', () => {
  const rig = buildNavalRig(labFixture('side').parts, labFixture('side').cargo);
  const state = { tick: 19, x: 17.25, z: -8.5, yaw: Math.PI / 2, vx: 0, vz: 0, omega: 0 };
  const pose = navalPose(state, rig);
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  assert.ok(Math.abs(pose.x + c * rig.cx + s * rig.cz - state.x) < 1e-10);
  assert.ok(Math.abs(pose.z - s * rig.cx + c * rig.cz - state.z) < 1e-10);
  assert.equal(pose.y, 0.72 - Math.min(0.18, rig.load * 0.12));
  assert.equal(pose.yaw, state.yaw);
});

test('fixed-tick controls are exactly repeatable and neutral motion coasts down without snapping', () => {
  const fixture = labFixture('empty');
  const first = run(fixture, { throttle: 1, steer: 0.25 }, LAB_WINDS[3], 240);
  const second = run(fixture, { throttle: 1, steer: 0.25 }, LAB_WINDS[3], 240);
  assert.equal(first.state.tick, 240);
  assert.deepEqual(first.state, second.state);
  assert.equal(NAVAL_STEP, 1 / 60);

  const initial = { ...newNavalState(), vz: 2 };
  const coast = run(fixture, {}, LAB_WINDS[3], 1, initial).state;
  assert.ok(speed(coast) < speed(initial));
  assert.ok(speed(coast) > 0, 'one tick of neutral input must retain momentum');
  assert.ok(coast.z > initial.z, 'forward momentum advances the vessel');
});

test('thrust follows the wind, calm retains paddle assistance, and braking cannot reverse forward travel', () => {
  const rig = buildNavalRig(STARTER_RAFT, []);
  assert.ok(windEfficiency(0, LAB_WINDS[0]) > windEfficiency(0, LAB_WINDS[1]));
  assert.ok(windEfficiency(0, LAB_WINDS[1]) > windEfficiency(0, LAB_WINDS[2]));
  assert.equal(windEfficiency(0, LAB_WINDS[3]), 0);

  const input = { throttle: 1 };
  const tail = run(labFixture('empty'), input, LAB_WINDS[0], 360).state;
  const head = run(labFixture('empty'), input, LAB_WINDS[2], 360).state;
  const calm = run(labFixture('empty'), input, LAB_WINDS[3], 360).state;
  assert.ok(speed(tail) > speed(head));
  assert.ok(speed(calm) > 0, 'the balsa remains movable without wind');

  const braking = stepNaval({ ...newNavalState(), vz: 0.2 }, { brake: 1 }, rig, LAB_WINDS[0]);
  assert.ok(braking.vz >= 0, 'braking removes forward speed without instantly driving a sail backward');
});

test('handling comparisons show added mass slows acceleration and braking, while peripheral ballast resists turning', () => {
  const empty = measureHandling(labFixture('empty'), LAB_WINDS[3]);
  const centered = measureHandling(labFixture('center'), LAB_WINDS[3]);
  const rim = measureHandling(labFixture('rim'), LAB_WINDS[3]);
  const house = measureHandling(labFixture('house'), LAB_WINDS[3]);
  assert.ok(centered.acceleration.speed < empty.acceleration.speed);
  assert.ok(centered.braking.seconds > empty.braking.seconds);
  assert.ok(empty.braking.reached && centered.braking.reached);
  assert.ok(rim.turning.seconds > centered.turning.seconds);
  assert.ok(empty.turning.reached && centered.turning.reached && rim.turning.reached);
  assert.ok(house.turning.reached && house.turning.seconds <= 60,
    'the larger house fixture completes the standardized quarter-turn within the measurement window');
});

test('measurement scripts are deterministic and expose their fixed 6 second acceleration sample', () => {
  const fixture = labFixture('empty');
  const a = measureHandling(fixture, LAB_WINDS[0]);
  const b = measureHandling(fixture, LAB_WINDS[0]);
  assert.deepEqual(a, b);
  assert.equal(a.acceleration.seconds, 6);
  assert.equal(a.step, NAVAL_STEP);
  assert.equal(a.initialSpeed, 2);
});

test('lab jettison clears ballast without moving the hull or changing its rigid-body motion', () => {
  const fixture = labFixture('side');
  const state = { tick: 42, x: 3, z: -4, yaw: 1.2, vx: 0.4, vz: 1.7, omega: -0.08 };
  const originalFixture = structuredClone(fixture), originalState = { ...state };
  const result = jettisonLabCargo(fixture, state);
  assert.deepEqual(fixture, originalFixture);
  assert.deepEqual(state, originalState);
  assert.deepEqual(result.fixture.cargo, []);
  assert.deepEqual(result.fixture.parts, fixture.parts);
  assert.notEqual(result.fixture, fixture);
  assert.notEqual(result.fixture.parts, fixture.parts);
  assert.notEqual(result.fixture.parts[0], fixture.parts[0]);
  assert.notEqual(result.state, state);
  assert.equal(result.state.tick, state.tick);
  assert.equal(result.state.yaw, state.yaw);
  assert.equal(result.state.omega, state.omega);
  assert.ok(Number.isFinite(result.state.vx) && Number.isFinite(result.state.vz));
  const beforeRig = buildNavalRig(fixture.parts, fixture.cargo);
  const beforePose = navalPose(state, beforeRig);
  const unloaded = buildNavalRig(result.fixture.parts, result.fixture.cargo);
  const afterPose = navalPose(result.state, unloaded);
  assert.ok(Math.abs(afterPose.x - beforePose.x) < 1e-10, 'blueprint origin stays in place');
  assert.ok(Math.abs(afterPose.z - beforePose.z) < 1e-10, 'blueprint origin stays in place');
  assert.equal(afterPose.yaw, beforePose.yaw);
  assert.notEqual(afterPose.y, beforePose.y, 'calculated draft may change when ballast leaves');

  // Compare velocity at the unchanged blueprint origin, whose offset from COM changes on jettison.
  const pointVelocity = (motion, pose) => ({
    x: motion.vx + motion.omega * (pose.z - motion.z),
    z: motion.vz - motion.omega * (pose.x - motion.x),
  });
  const beforePointVelocity = pointVelocity(state, beforePose);
  const afterPointVelocity = pointVelocity(result.state, afterPose);
  assert.ok(Math.abs(afterPointVelocity.x - beforePointVelocity.x) < 1e-10);
  assert.ok(Math.abs(afterPointVelocity.z - beforePointVelocity.z) < 1e-10);
  assert.equal(unloaded.cargoMass, 0);
});

test('invalid lab ballast and blueprints are rejected before a rig is built', () => {
  assert.throws(() => buildNavalRig([], []), TypeError);
  assert.throws(() => buildNavalRig([['unknown', 0, 0, 0]], []), TypeError);
  assert.throws(() => buildNavalRig(STARTER_RAFT, [{ mass: 0, x: 0, z: 0 }]), TypeError);
  assert.throws(() => buildNavalRig(STARTER_RAFT, [{ mass: 2, x: Number.NaN, z: 0 }]), TypeError);
  assert.throws(() => buildNavalRig(STARTER_RAFT, [{ mass: 2, x: 30, z: 0 }]), TypeError);
});

test('malformed body state and rig inputs are rejected before advancing', () => {
  const rig = buildNavalRig(STARTER_RAFT, []);
  for (const state of [
    { ...newNavalState(), x: Number.NaN },
    { ...newNavalState(), vz: Number.POSITIVE_INFINITY },
    { ...newNavalState(), tick: -1 },
    { ...newNavalState(), vx: 101 },
  ]) assert.throws(() => stepNaval(state, {}, rig, LAB_WINDS[3]), TypeError);
  assert.throws(() => stepNaval(newNavalState(), {}, { ...rig, mass: Number.POSITIVE_INFINITY }, LAB_WINDS[3]), TypeError);
  assert.throws(() => stepNaval(newNavalState(), {}, { ...rig, inertia: 0 }, LAB_WINDS[3]), TypeError);
});

test('combined forward and lateral speed remains capped for arbitrary initial velocity', () => {
  const rig = buildNavalRig(STARTER_RAFT, []);
  let state = { ...newNavalState(), vx: 9, vz: 9 };
  state = stepNaval(state, {}, rig, LAB_WINDS[3]);
  assert.ok(speed(state) <= 10);
  assert.ok(Number.isFinite(state.vx) && Number.isFinite(state.vz));
});

test('ten thousand mixed helm ticks remain finite, bounded, and damp lateral drift', () => {
  const rig = buildNavalRig(labFixture('empty').parts, labFixture('empty').cargo);
  let state = newNavalState();
  for (let i = 0; i < 10_000; i++) {
    const phase = i % 240;
    const input = phase < 150 ? { throttle: 1, steer: 1 } : phase < 195 ? {} : { brake: 1 };
    state = stepNaval(state, input, rig, LAB_WINDS[1]);
    assert.ok(Object.values(state).every(Number.isFinite), `state remains finite at tick ${i + 1}`);
    assert.ok(state.yaw >= -Math.PI && state.yaw <= Math.PI, `yaw is normalized at tick ${i + 1}`);
    assert.ok(speed(state) <= 10 + 1e-9, `combined velocity is capped at tick ${i + 1}`);
    const sideSpeed = state.vx * Math.cos(state.yaw) - state.vz * Math.sin(state.yaw);
    assert.ok(Math.abs(sideSpeed) < 1.5, `lateral drift stays bounded at tick ${i + 1}`);
  }
  assert.equal(state.tick, 10_000);
  assert.ok(Math.hypot(state.x, state.z) < 1000, 'long-run position remains bounded');
});
