import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVAL_STEP, navalPose } from '../src/sim/naval/handling.js';
import { createTrialBody, damageTrialBody, stepTrialBody } from '../src/sim/naval/trialBody.js';
import { hullIntegrity } from '../src/sim/naval/structure.js';
import { labFixture } from '../tools/naval-lab/fixtures.js';

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${label}: expected ${expected}, got ${actual}`);
const starter = () => labFixture('empty').parts;

test('trial body preserves the requested origin, yaw and vertical baseline for varied poses', () => {
  const parts = labFixture('house').parts, before = JSON.stringify(parts);
  for (const yaw of [0, Math.PI / 2, -Math.PI / 3, Math.PI * 0.83]) {
    const desired = { x: 35.5, y: 2.4, z: -18.25, yaw };
    const body = createTrialBody(parts, desired, 'trial:1', 20);
    const rendered = navalPose(body.state, body.operational.rig);
    close(rendered.x, desired.x, 'origin x');
    close(rendered.z, desired.z, 'origin z');
    close(body.pose.x, desired.x, 'saved pose x');
    close(body.pose.y, desired.y, 'saved vertical baseline');
    close(body.pose.z, desired.z, 'saved pose z');
    close(body.pose.yaw, yaw, 'saved yaw');
    assert.equal(body.state.tick, 20);
    assert.ok(Object.isFrozen(body) && Object.isFrozen(body.structure.entries[0].part) && Object.isFrozen(body.state) && Object.isFrozen(body.pose));
  }
  assert.equal(JSON.stringify(parts), before, 'source blueprint stays untouched');
});

test('trial step advances fixed ticks without mutating the previous body and retains its vertical offset', () => {
  const body = createTrialBody(starter(), { x: 1, y: 1.75, z: -2, yaw: 0.4 }, 'trial:step');
  const before = JSON.stringify(body), offset = body.pose.y - navalPose(body.state, body.operational.rig).y;
  const next = stepTrialBody(body, { throttle: 1, steer: 0.2 }, { yaw: 0.4, strength: 0.8 });
  const hydro = navalPose(next.state, next.operational.rig);
  assert.equal(next.state.tick, body.state.tick + 1);
  assert.ok(Math.hypot(next.state.x - body.state.x, next.state.z - body.state.z) > 0);
  close(next.pose.y - hydro.y, offset, 'vertical offset');
  assert.equal(JSON.stringify(body), before);
  assert.ok(next.pose.x !== body.pose.x || next.pose.z !== body.pose.z);
  assert.ok(NAVAL_STEP > 0);
});

test('damage keeps instance IDs and world origin stable while rebuilding live rig', () => {
  const parts = starter(), body = createTrialBody(parts, { x: -9, y: 0.72, z: 13, yaw: 1.1 }, 'trial:damage');
  const moving = stepTrialBody(body, { throttle: 1, steer: 0.3 }, { yaw: 0, strength: 0.5 });
  const originalOrigin = { ...moving.pose }, originalIds = moving.structure.entries.map((entry) => entry.id);
  const damagedFoundation = moving.structure.entries.find((entry) => entry.part[0] === 'foundation');
  const result = damageTrialBody(moving, damagedFoundation.id, damagedFoundation.maxHp);
  assert.equal(result.event.partId, damagedFoundation.id);
  assert.equal(result.event.destroyed, true);
  assert.deepEqual(result.body.structure.entries.map((entry) => entry.id), originalIds);
  close(result.body.pose.x, originalOrigin.x, 'damage keeps world origin x');
  close(result.body.pose.z, originalOrigin.z, 'damage keeps world origin z');
  close(result.body.pose.yaw, originalOrigin.yaw, 'damage keeps yaw');
  assert.equal(result.body.structure.entries.find((entry) => entry.id === damagedFoundation.id).hp, 0);
  assert.ok(result.body.operational.rig.buoyancy < moving.operational.rig.buoyancy);
  assert.equal(moving.structure.entries.find((entry) => entry.id === damagedFoundation.id).hp, damagedFoundation.maxHp);
  const noChange = damageTrialBody(result.body, damagedFoundation.id, 10);
  assert.equal(noChange.event, null);
  assert.equal(noChange.body, result.body);
});

test('destroyed sail loses propulsion but does not affect aggregate hull integrity', () => {
  const body = createTrialBody(starter(), { x: 3, y: 0.72, z: 4, yaw: -0.3 }, 'trial:sail');
  const beforeHull = hullIntegrity(body.structure), sail = body.structure.entries.find((entry) => entry.part[0] === 'sail');
  const result = damageTrialBody(body, sail.id, sail.maxHp);
  assert.equal(result.body.operational.rig.sail, 0);
  assert.deepEqual(hullIntegrity(result.body.structure), beforeHull);
  assert.equal(result.body.structure.entries.find((entry) => entry.id === sail.id).part[0], 'sail');
});

test('destroying the last float freezes motion and retains the final visual pose across disabled ticks', () => {
  const parts = [['foundation', 0, 0, 0], ['sail', 0, 0, 0]];
  const created = createTrialBody(parts, { x: 7, y: 1.1, z: -5, yaw: 0.8 }, 'trial:disabled');
  const moving = stepTrialBody(created, { throttle: 1 }, { yaw: 0.8, strength: 1 });
  const foundation = moving.structure.entries.find((entry) => entry.part[0] === 'foundation');
  const destroyed = damageTrialBody(moving, foundation.id, foundation.maxHp).body;
  assert.equal(destroyed.operational.disabled, true);
  assert.equal(destroyed.operational.rig, null);
  assert.deepEqual(destroyed.pose, moving.pose);
  assert.deepEqual([destroyed.state.vx, destroyed.state.vz, destroyed.state.omega], [0, 0, 0]);

  const next = stepTrialBody(destroyed, { throttle: 1, steer: 1 }, { yaw: -1, strength: 1 });
  assert.equal(next.state.tick, destroyed.state.tick + 1);
  assert.deepEqual(next.pose, destroyed.pose);
  assert.deepEqual([next.state.x, next.state.z, next.state.yaw, next.state.vx, next.state.vz, next.state.omega],
    [destroyed.state.x, destroyed.state.z, destroyed.state.yaw, 0, 0, 0]);
  assert.equal(next.structure.entries.length, parts.length);
  assert.equal(next.structure.entries[0].part[0], 'foundation');
});

test('trial creation rejects invalid pose, tick, namespace and oversized blueprints', () => {
  for (const pose of [null, { x: NaN, y: 0, z: 0, yaw: 0 }, { x: 0, y: Infinity, z: 0, yaw: 0 }])
    assert.throws(() => createTrialBody(starter(), pose, 'trial:bad'), TypeError);
  for (const tick of [-1, 0.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() => createTrialBody(starter(), { x: 0, y: 0, z: 0, yaw: 0 }, 'trial:bad', tick), TypeError);
  for (const namespace of ['', 'space id', 'x'.repeat(100)])
    assert.throws(() => createTrialBody(starter(), { x: 0, y: 0, z: 0, yaw: 0 }, namespace), TypeError);
  assert.throws(() => createTrialBody(new Array(601), { x: 0, y: 0, z: 0, yaw: 0 }, 'trial:large'), TypeError);
});

test('trial creation rejects out-of-range origin and a centre of mass beyond the supported state bounds', () => {
  assert.throws(() => createTrialBody(starter(), { x: 1e12, y: 0, z: 0, yaw: 0 }, 'trial:far'), TypeError);
  assert.throws(() => createTrialBody(starter(), { x: 999999999, y: 0, z: 0, yaw: 0 }, 'trial:com-edge'), TypeError);
});

test('a step that crosses the supported coordinate bound fails without changing the input body', () => {
  const parts = starter(), yaw = Math.PI / 2;
  const reference = createTrialBody(parts, { x: 0, y: 0.72, z: 0, yaw }, 'trial:step-reference');
  const body = createTrialBody(parts, { x: 1e9 - Math.cos(yaw) * reference.operational.rig.cx -
    Math.sin(yaw) * reference.operational.rig.cz, y: 0.72, z: 0, yaw }, 'trial:step-edge');
  assert.ok(body.state.x > 999999999.99);
  const before = JSON.stringify(body);
  assert.throws(() => stepTrialBody(body, { throttle: 1 }, { yaw: Math.PI / 2, strength: 1 }), TypeError);
  assert.equal(JSON.stringify(body), before);
});
