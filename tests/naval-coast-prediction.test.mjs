import test from 'node:test';
import assert from 'node:assert/strict';
import { NavalPilotPrediction } from '../src/client/navalPilotPrediction.js';
import { createTrialBody, stepTrialBody } from '../src/sim/naval/trialBody.js';
import { createNavalCoast } from '../src/sim/naval/coastGeometry.js';

const wind = { yaw: 0, strength: 0.75 }, axes = { throttle: 1, brake: 0, steer: 0 };
function fixture() {
  const half = 8, N = 17, heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = j - half >= 4 ? 1 : -1;
  const map = { half, N, res: 1, heights, seed: 91 };
  const body = createTrialBody([['foundation', 0, 0, 0], ['foundation', 0, -1, 0]],
    { x: 0, y: 0.72, z: 1.4, yaw: 0 }, 'coast-pred');
  // A controlled high-speed state fixture tests replay across destruction, not a player velocity command.
  const moving = Object.freeze({ ...body, state: Object.freeze({ ...body.state, vz: 40 }) });
  const snapshot = (body, ack) => ({ epoch: 1, active: true, shipId: 'ship:1', ack, body,
    anchor: { x: 1, y: 0, z: -1, f: 0 }, wind, coast: { version: 1, seed: map.seed } });
  return { map, moving, snapshot, coast: createNavalCoast(map) };
}

test('delayed coastal ACK replays across a destroyed foundation without applying HP loss twice', () => {
  const f = fixture(), p = new NavalPilotPrediction(f.map);
  assert.equal(p.receive(f.snapshot(f.moving, 0)), true);
  p.step(axes); p.step(axes);
  const first = stepTrialBody(f.moving, axes, wind, f.coast), second = stepTrialBody(first, axes, wind, f.coast);
  assert.equal(first.structure.entries[0].hp, 0, 'the first tick crosses coast and destroys the forward cell');
  assert.ok(first.structure.entries[1].hp > 0, 'a neighboring cell receives no excess damage');
  assert.equal(p.acceptSnapshot(f.snapshot(first, 1)), 'accepted');
  assert.deepEqual(p.body, second, 'pending second tick replays from impacted authority');
  assert.equal(p.pending.length, 1);
  const replayed = p.body;
  assert.equal(p.acceptSnapshot(f.snapshot(first, 1)), 'duplicate');
  assert.equal(p.body, replayed, 'heartbeat does not repeat contact damage or rewind prediction');
  assert.equal(p.acceptSnapshot(f.snapshot(second, 2)), 'accepted');
  assert.deepEqual(p.body, second); assert.equal(p.pending.length, 0);
  assert.equal(f.moving.structure.entries[0].hp, 60, 'original source remains intact');
});

test('predicted public geometry and per-instance HP match the impacted body before the next snapshot', () => {
  const f = fixture(), p = new NavalPilotPrediction(f.map);
  p.receive(f.snapshot(f.moving, 0)); p.step(axes);
  const r = p.project([{ id: 'ship:1', parts: [['foundation', 99, 99, 0]] }])[0];
  assert.deepEqual(r.parts, p.body.operational.parts);
  assert.equal(r.partHealth.find(e => e.id === 'coast-pred:p1').hp, 0);
  assert.equal(r.hull.hp, 60); assert.equal(r.hull.maxHp, 120);
  assert.equal(r.hull.fraction, 0.5);
});

test('coastal epoch cannot downgrade its geometry or accept malformed nested impact feedback', () => {
  const f = fixture(), p = new NavalPilotPrediction(f.map);
  p.receive(f.snapshot(f.moving, 0)); p.step(axes);
  const initial = p.body;
  const first = stepTrialBody(f.moving, axes, wind, f.coast);
  const downgrade = f.snapshot(first, 1); downgrade.coast = null;
  assert.equal(p.acceptSnapshot(downgrade), 'rejected'); assert.equal(p.body, initial);
  const invalid = structuredClone(f.snapshot(first, 1)); invalid.body.impacts[0].speed = Infinity;
  assert.equal(p.acceptSnapshot(invalid), 'rejected'); assert.equal(p.body, initial);
  const wrongMap = f.snapshot(first, 1); wrongMap.coast = { version: 1, seed: f.map.seed + 1 };
  assert.equal(p.acceptSnapshot(wrongMap), 'rejected'); assert.equal(p.body, initial);
});
