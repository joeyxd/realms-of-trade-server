import test from 'node:test';
import assert from 'node:assert/strict';
import { NavalPilotPrediction } from '../src/client/navalPilotPrediction.js';
import { createTrialBody, stepTrialBody } from '../src/sim/naval/trialBody.js';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';
import { labFixture } from '../tools/naval-lab/fixtures.js';

const wind = { yaw: 0.25, strength: 0.75 };
const axesA = { throttle: 0.8, brake: 0, steer: 0.3 };
const axesB = { throttle: 0.2, brake: 0.1, steer: -0.4 };
const startBody = (yaw = 0.5, tick = 10) => createTrialBody(labFixture('empty').parts,
  { x: 4, y: 1.2, z: -3, yaw }, 'trial:pilot', tick);
const wire = (body, { epoch = 1, active = true, ack = 0, shipId = 41, anchor = { x: 0, y: 0.8, z: 0.2, f: 0.1 } } = {}) =>
  JSON.parse(JSON.stringify({ epoch, active, ack, shipId, body, anchor, wind }));
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: expected ${b}, got ${a}`);

test('reconciles delayed ACKs by dropping acknowledged input and replaying the remaining fixed steps', () => {
  const client = new NavalPilotPrediction();
  let authority = startBody();
  assert.equal(client.acceptSnapshot(wire(authority)), 'accepted');
  const c1 = client.step(axesA), c2 = client.step(axesB);
  assert.deepEqual([c1.seq, c2.seq], [1, 2]);

  authority = stepTrialBody(authority, axesA, wind);
  assert.equal(client.acceptSnapshot(wire(authority, { ack: 1 })), 'accepted');
  authority = stepTrialBody(authority, axesB, wind);
  for (const key of ['x', 'y', 'z', 'yaw']) close(client.body.pose[key], authority.pose[key], `replayed ${key}`);
  assert.deepEqual(client.pending.map((p) => p.seq), [2]);
  assert.equal(client.ack, 1);
});

test('rejects invalid controls without mutation; neutral queues a command without predicting a tick', () => {
  const client = new NavalPilotPrediction();
  assert.equal(client.receive(wire(startBody())), true);
  const body = client.body, seq = client.seq;
  assert.equal(client.step({ throttle: 1.1, brake: 0, steer: 0 }), null);
  assert.equal(client.step({ throttle: NaN, brake: 0, steer: 0 }), null);
  assert.equal(client.step({ throttle: 0, brake: 0, steer: 0, other: 1 }), null);
  assert.equal(client.body, body);
  assert.equal(client.seq, seq);

  const tick = client.body.state.tick;
  const cmd = client.neutral();
  assert.deepEqual(cmd, { epoch: 1, seq: 1, throttle: 0, brake: 1, steer: 0 });
  assert.equal(client.body.state.tick, tick);
  assert.equal(client.pending[0].advance, false);
  assert.equal(client.step(axesA).seq, 2);
  assert.equal(client.body.state.tick, tick + 1);
});

test('classifies accepted, duplicate and rejected snapshots while accepting a new mount epoch', () => {
  const client = new NavalPilotPrediction();
  const initial = startBody();
  assert.equal(client.acceptSnapshot(wire(initial)), 'accepted');
  client.step(axesA);
  const newer = stepTrialBody(initial, axesA, wind);
  assert.equal(client.acceptSnapshot(wire(newer, { ack: 1 })), 'accepted');
  assert.equal(client.acceptSnapshot(wire(newer, { ack: 1 })), 'duplicate', 'same tick and ACK is duplicate');
  assert.equal(client.receive(wire(newer, { ack: 1 })), false, 'boolean compatibility reports only acceptance');

  const before = JSON.stringify({ body: client.body, ack: client.ack, epoch: client.epoch, pending: client.pending });
  assert.equal(client.acceptSnapshot(wire(initial, { ack: 2 })), 'rejected', 'body tick cannot regress');
  assert.equal(client.acceptSnapshot(wire(newer, { ack: 0 })), 'rejected', 'ACK cannot regress');
  assert.equal(client.acceptSnapshot(wire(newer, { epoch: 0, ack: 2 })), 'rejected', 'epoch cannot regress');
  assert.equal(JSON.stringify({ body: client.body, ack: client.ack, epoch: client.epoch, pending: client.pending }), before);

  const remount = stepTrialBody(newer, axesB, wind);
  assert.equal(client.acceptSnapshot(wire(remount, { epoch: 2, ack: 0, shipId: 99 })), 'accepted');
  assert.equal(client.seq, 0);
  assert.deepEqual(client.pending, []);
  assert.equal(client.shipId, 99);
});

test('duplicate snapshots validate their nested body and never mutate prediction state', () => {
  const client = new NavalPilotPrediction();
  const anchor = wire(startBody());
  assert.equal(client.acceptSnapshot(anchor), 'accepted');
  client.step(axesA);
  const before = { body: client.body, pending: client.pending, prevPose: client.prevPose,
    ack: client.ack, epoch: client.epoch, seq: client.seq, authorityTick: client.authorityTick };
  const duplicate = wire(startBody(), { ack: 0 });
  assert.equal(client.acceptSnapshot(duplicate), 'duplicate');
  assert.equal(client.body, before.body);
  assert.equal(client.pending, before.pending);
  assert.equal(client.prevPose, before.prevPose);
  assert.equal(client.ack, before.ack);
  assert.equal(client.epoch, before.epoch);
  assert.equal(client.seq, before.seq);
  assert.equal(client.authorityTick, before.authorityTick);

  const invalidDuplicate = wire(startBody(), { ack: 0 });
  invalidDuplicate.body.operational.rig.mass = null;
  assert.equal(client.acceptSnapshot(invalidDuplicate), 'rejected', 'invalid nested rig data is not accepted as heartbeat');
  assert.equal(client.body, before.body);
  assert.equal(client.pending, before.pending);
  assert.equal(client.seq, before.seq);
  assert.equal(client.acceptSnapshot({ epoch: 1, active: false }), 'accepted', 'same epoch leave is accepted');
});

test('leave clears prediction and fences reactivation until a higher epoch', () => {
  const client = new NavalPilotPrediction();
  const body = startBody();
  client.receive(wire(body));
  client.step(axesA);
  assert.equal(client.receive({ epoch: 1, active: false }), true);
  assert.equal(client.active, false);
  assert.equal(client.body, null);
  assert.equal(client.anchor, null);
  assert.deepEqual(client.pending, []);
  assert.equal(client.neutral(), null);
  assert.equal(client.receive(wire(body)), false, 'same mount epoch cannot reactivate');
  assert.equal(client.receive(wire(body, { epoch: 2 })), true);
});

test('wire body and commands are isolated; projection and pilot position use the same interpolated pose', () => {
  const client = new NavalPilotPrediction();
  const source = wire(startBody());
  assert.equal(client.receive(source), true);
  const originalX = client.body.pose.x;
  source.body.pose.x = 500;
  source.wind.yaw = 2;
  assert.equal(client.body.pose.x, originalX);
  assert.equal(Object.isFrozen(client.body.structure.entries[0].part), true);

  const records = [{ id: 41, x: 0, y: 0, z: 0, yaw: 0 }, { id: 8, x: 9, y: 0, z: 9, yaw: 0 }];
  const projected = client.project(records);
  assert.notEqual(projected, records);
  close(projected[0].x, client.body.pose.x, 'projected raft x');
  assert.equal(projected[1], records[1], 'unrelated raft record is preserved');
  const p = client.position();
  close(p.x, client.body.pose.x + Math.cos(client.body.pose.yaw) * 0 + Math.sin(client.body.pose.yaw) * 0.2, 'pilot x');
  close(p.z, client.body.pose.z - Math.sin(client.body.pose.yaw) * 0 + Math.cos(client.body.pose.yaw) * 0.2, 'pilot z');
});

test('pose interpolation follows the short angular path across the wrap boundary', () => {
  const client = new NavalPilotPrediction();
  const body = startBody(Math.PI - 0.02);
  assert.equal(client.receive(wire(body)), true);
  // The authenticated next snapshot can cross +pi to -pi while moving a short distance.
  const crossed = JSON.parse(JSON.stringify(body));
  crossed.pose.yaw = -Math.PI + 0.02;
  crossed.state.tick++;
  assert.equal(client.receive(wire(crossed, { ack: 1 })), true);
  const mid = client.pose(0.5).yaw;
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.02, `midpoint should stay near pi, got ${mid}`);
});

test('sequence and pending storage remain bounded', () => {
  const client = new NavalPilotPrediction();
  client.receive(wire(startBody()));
  for (let i = 0; i < 250; i++) assert.ok(client.step({ throttle: 0, brake: 1, steer: 0 }));
  assert.equal(client.seq, 250);
  assert.equal(client.pending.length, 240);
  client.seq = NAVAL_TRIAL.maxSequence;
  assert.equal(client.step(axesA), null);
});
