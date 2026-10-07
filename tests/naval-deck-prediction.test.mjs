import test from 'node:test';
import assert from 'node:assert/strict';
import { NavalDeckPrediction } from '../src/client/navalDeckPrediction.js';
import { DeckWalkEngine } from '../src/sim/naval/deckWalk.js';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';

const parts = Array.from({ length: 16 }, (_, i) => ['foundation', Math.floor(i / 4), i % 4, 0]);
const params = { speed: 4, radius: 0.3 };
const start = (f = 0) => ({ x: 1.5, y: 0, z: 1.5, f, vx: 0, vz: 0, mag: 0 });
const snapshot = (state, options = {}) => ({ active: true, epoch: 1, shipId: 'raft-a', mode: 'walk', ack: 0,
  tick: 40, state: structuredClone(state), parts: structuredClone(parts), params: structuredClone(params), ...options });
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `${label}: expected ${expected}, got ${actual}`);

test('ACK drops acknowledged steps and replays the remaining bounded walk commands', () => {
  const client = new NavalDeckPrediction(), authority = new DeckWalkEngine();
  const initial = start();
  assert.equal(client.acceptSnapshot(snapshot(initial)), 'accepted');
  const c1 = client.step({ mx: 0, mz: 1 }), c2 = client.step({ mx: 1, mz: 0 });
  assert.deepEqual([c1.seq, c2.seq], [1, 2]);

  const acknowledged = authority.step(initial, { mx: 0, mz: 1 }, parts, params);
  assert.equal(client.acceptSnapshot(snapshot(acknowledged, { ack: 1, tick: 41 })), 'accepted');
  let expected = authority.step(acknowledged, { mx: 1, mz: 0 }, parts, params);
  for (const key of ['x', 'y', 'z', 'f', 'vx', 'vz', 'mag']) near(client.state[key], expected[key], `replayed ${key}`);
  assert.deepEqual(client.pending.map((command) => command.seq), [2]);
  assert.equal(client.ack, 1);
  assert.equal(client.acceptSnapshot(snapshot(acknowledged, { ack: 1, tick: 41 })), 'duplicate');
});

test('neutral consumes a sequence without advancing prediction; invalid input leaves state untouched', () => {
  const client = new NavalDeckPrediction();
  assert.equal(client.acceptSnapshot(snapshot(start())), 'accepted');
  const before = client.state;
  assert.equal(client.step({ mx: 2, mz: 0 }), null);
  assert.equal(client.step({ mx: 0, mz: NaN }), null);
  assert.equal(client.state, before);

  const tickState = client.state;
  assert.deepEqual(client.neutral(), { epoch: 1, seq: 1, mx: 0, mz: 0 });
  assert.equal(client.state, tickState);
  assert.equal(client.pending[0].advance, false);
  assert.equal(client.step({ mx: 0, mz: 1 }).seq, 2);
  assert.ok(client.state.z > tickState.z);
});

test('snapshot validation is atomic, including duplicate nested state and frozen cloned data', () => {
  const client = new NavalDeckPrediction(), source = snapshot(start());
  assert.equal(client.acceptSnapshot(source), 'accepted');
  client.step({ mx: 0, mz: 1 });
  const before = { state: client.state, parts: client.parts, params: client.params,
    pending: client.pending, seq: client.seq, ack: client.ack, tick: client.authorityTick };
  source.state.x = 99;
  source.parts[0][1] = 99;
  source.params.speed = 40;
  assert.equal(client.state.x, 1.5);
  assert.equal(client.parts[0][1], 0);
  assert.equal(client.params.speed, 4);
  assert.equal(Object.isFrozen(client.parts[0]), true);

  const invalidDuplicate = snapshot({ ...start(), x: 257 });
  assert.equal(client.acceptSnapshot(invalidDuplicate), 'rejected');
  assert.equal(client.state, before.state);
  assert.equal(client.parts, before.parts);
  assert.equal(client.params, before.params);
  assert.equal(client.pending, before.pending);
  assert.equal(client.seq, before.seq);
  assert.equal(client.ack, before.ack);
  assert.equal(client.authorityTick, before.tick);
  assert.equal(client.acceptSnapshot(snapshot(start(), { ack: 0, tick: 39 })), 'rejected', 'authority tick cannot regress');
  assert.equal(client.acceptSnapshot(snapshot(start(), { ack: 2, tick: 41 })), 'rejected', 'ACK cannot exceed sent sequence');
});

test('epochs fence leave/remount and sequence storage remains bounded', () => {
  const client = new NavalDeckPrediction();
  assert.equal(client.acceptSnapshot(snapshot(start())), 'accepted');
  client.step({ mx: 0, mz: 1 });
  assert.equal(client.acceptSnapshot({ active: false, epoch: 1 }), 'accepted');
  assert.equal(client.active, false);
  assert.equal(client.state, null);
  assert.deepEqual(client.pending, []);
  assert.equal(client.step({ mx: 0, mz: 1 }), null);
  assert.equal(client.acceptSnapshot(snapshot(start())), 'rejected', 'same epoch cannot reactivate after leave');
  assert.equal(client.acceptSnapshot(snapshot(start(), { epoch: 2, tick: 0 })), 'accepted');
  assert.equal(client.seq, 0);

  for (let i = 0; i < 250; i++) assert.ok(client.step({ mx: 0, mz: 0 }));
  assert.equal(client.pending.length, 240);
  client.seq = NAVAL_TRIAL.maxSequence;
  assert.equal(client.step({ mx: 0, mz: 0 }), null);
  assert.equal(client.neutral(), null);
});

test('local heading interpolates across the short angle and transforms through one raft pose', () => {
  const client = new NavalDeckPrediction();
  assert.equal(client.acceptSnapshot(snapshot(start(Math.PI - 0.02))), 'accepted');
  const crossed = { ...start(-Math.PI + 0.02), x: 1.7, z: 1.6 };
  assert.equal(client.acceptSnapshot(snapshot(crossed, { ack: 0, tick: 41 })), 'accepted');
  const pose = { x: 20, y: 2, z: -7, yaw: Math.PI / 2 };
  const half = client.position(pose, 0.5);
  const midF = Math.abs(Math.abs(half.f - pose.yaw) - Math.PI);
  assert.ok(midF < 0.03, `short local angle path should face near pi, got ${half.f}`);

  const local = { x: 1.6, y: 0, z: 1.55, f: Math.PI };
  const expected = {
    x: pose.x + Math.cos(pose.yaw) * local.x + Math.sin(pose.yaw) * local.z,
    y: pose.y + local.y,
    z: pose.z - Math.sin(pose.yaw) * local.x + Math.cos(pose.yaw) * local.z,
  };
  near(half.x, expected.x, 'rigid x');
  near(half.y, expected.y, 'rigid y');
  near(half.z, expected.z, 'rigid z');
  assert.equal(client.position(pose, -1).x, client.position(pose, 0).x, 'alpha clamps low');
  assert.equal(client.position(pose, 2).x, client.position(pose, 1).x, 'alpha clamps high');
});
