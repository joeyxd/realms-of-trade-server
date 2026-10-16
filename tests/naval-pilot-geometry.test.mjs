import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolatePilotPose, pilotLocal, pilotPoint } from '../src/sim/naval/pilotGeometry.js';

const close = (actual, expected, eps = 1e-10) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);
const angleClose = (actual, expected, eps = 1e-10) => close(Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)), 0, eps);

test('pilot local/world transforms round-trip at cardinal and arbitrary raft headings and deck levels', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.47]) {
    const pose = { x: 37.25, y: 4.8, z: -19.5, yaw };
    for (const local of [
      { x: 0.35, y: 0, z: 1.2, f: 0.4 },
      { x: -2.1, y: 3.75, z: 6.2, f: -2.8 },
    ]) {
      const world = pilotPoint(pose, local);
      const restored = pilotLocal(pose, world);
      for (const key of ['x', 'y', 'z']) close(restored[key], local[key]);
      angleClose(restored.f, local.f);
      assert.ok(Object.isFrozen(world));
      assert.ok(Object.isFrozen(restored));
    }
  }
});

test('pilot headings wrap across the minus-pi/plus-pi boundary', () => {
  const local = pilotLocal({ x: 0, y: 0, z: 0, yaw: Math.PI - 0.1 },
    { x: 0, y: 0, z: 0, f: -Math.PI + 0.1 });
  angleClose(local.f, 0.2);
  const world = pilotPoint({ x: 0, y: 0, z: 0, yaw: Math.PI - 0.1 }, local);
  angleClose(world.f, -Math.PI + 0.1);
});

test('raft pose interpolation clamps alpha and takes the short yaw path across pi', () => {
  const a = { x: 0, y: 2, z: -4, yaw: Math.PI - 0.1 };
  const b = { x: 10, y: 8, z: 6, yaw: -Math.PI + 0.1 };
  const mid = interpolatePilotPose(a, b, 0.5);
  close(mid.x, 5); close(mid.y, 5); close(mid.z, 1);
  angleClose(mid.yaw, Math.PI);
  assert.ok(Object.isFrozen(mid));
  assert.deepEqual(interpolatePilotPose(a, b, -1), { ...a, yaw: ((a.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI });
  const end = interpolatePilotPose(a, b, 2);
  close(end.x, b.x); close(end.y, b.y); close(end.z, b.z); angleClose(end.yaw, b.yaw);
});

test('transforms and interpolation reject missing or non-finite values without mutating inputs', () => {
  const pose = { x: 1, y: 2, z: 3, yaw: 0.25 }, point = { x: 4, y: 5, z: 6, f: -0.5 };
  const anchor = { x: -3, y: 0.75, z: 2, f: 0.6 };
  const a = { x: 0, y: 1, z: 2, yaw: 3 }, b = { x: 4, y: 5, z: 6, yaw: -3 };
  const before = structuredClone({ pose, point, anchor, a, b });
  for (const bad of [undefined, null, {}, { ...pose, yaw: Infinity }, { ...pose, x: NaN }]) {
    assert.throws(() => pilotLocal(bad, point), TypeError);
    assert.throws(() => pilotPoint(bad, anchor), TypeError);
  }
  for (const bad of [undefined, {}, { ...point, f: NaN }, { ...point, z: -Infinity }]) {
    assert.throws(() => pilotLocal(pose, bad), TypeError);
    assert.throws(() => pilotPoint(pose, bad), TypeError);
  }
  for (const bad of [NaN, Infinity, -Infinity]) assert.throws(() => interpolatePilotPose(a, b, bad), TypeError);
  assert.throws(() => interpolatePilotPose(a, { ...b, yaw: NaN }, 0.5), TypeError);
  assert.deepEqual({ pose, point, anchor, a, b }, before);
});
