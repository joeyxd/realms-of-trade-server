import test from 'node:test';
import assert from 'node:assert/strict';
import { DeckWalkEngine } from '../src/sim/naval/deckWalk.js';
import { RAFT, RAFT_PARTS } from '../src/data/raftparts.js';
import { tuning } from '../src/data/tuning.js';

const params = { speed: tuning.player.runSpeed, radius: tuning.player.radius };
const flat = (width = 3, depth = 2) => {
  const parts = [];
  for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) parts.push(['foundation', x, z, 0]);
  return parts;
};
const stateAt = (x, z, y = 0, f = 0) => ({ x, y, z, f, vx: 0, vz: 0, mag: 0 });
const run = (engine, state, axes, parts, n, p = params) => {
  for (let i = 0; i < n; i++) state = engine.step(state, axes, parts, p);
  return state;
};

test('walking accelerates, preserves inertia briefly, then decelerates to rest', () => {
  const engine = new DeckWalkEngine(), parts = flat();
  const start = stateAt(1, 1);
  const moving = run(engine, start, { mx: 0, mz: 1 }, parts, 8);
  assert.ok(moving.z > start.z);
  assert.ok(moving.vz > 0);
  const coast = engine.step(moving, { mx: 0, mz: 0 }, parts, params);
  assert.ok(coast.z > moving.z, 'zero input retains one deceleration step of inertia');
  const stopped = run(engine, coast, { mx: 0, mz: 0 }, parts, 30);
  assert.equal(stopped.vx, 0);
  assert.equal(stopped.vz, 0);
  assert.equal(stopped.mag, 0);
});

test('local collision blocks a missing foundation cell and a wall independent of world yaw', () => {
  const gap = [['foundation', 0, 0, 0], ['foundation', 2, 0, 0],
    ['foundation', 0, 1, 0], ['foundation', 1, 1, 0], ['foundation', 2, 1, 0]];
  const gapEngine = new DeckWalkEngine();
  const acrossGap = run(gapEngine, stateAt(0.5, 0.5), { mx: 1, mz: 0 }, gap, 100);
  assert.ok(acrossGap.x < 2.4, `unsupported gap should stop the body: x=${acrossGap.x}`);

  const wall = [...flat(2, 2), ['wall', 0, 0, 0, 1]];
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.47]) {
    const engine = new DeckWalkEngine();
    const blocked = run(engine, stateAt(0.5, 1), { mx: 1, mz: 0 }, wall, 100);
    assert.ok(blocked.x <= 2 - params.radius + 0.08, `wall collision at carrier yaw ${yaw}`);
  }
});

test('existing deck geometry carries the body up and down stairs in all four directions', () => {
  const forward = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  for (let dir = 0; dir < 4; dir++) {
    const [fx, fz] = forward[dir], parts = flat(3, 3).map((p) => ['foundation', p[1] - 1, p[2] - 1, 0]);
    parts.push(['pillar', fx, fz, 0], ['floor', fx, fz, 1], ['stairs', 0, 0, 0, dir]);
    assert.ok(parts.every((part) => RAFT_PARTS[part[0]]));
    const start = { x: 1 - fx * 2, z: 1 - fz * 2 };
    const engine = new DeckWalkEngine();
    let state = run(engine, stateAt(start.x, start.z), { mx: fx, mz: fz }, parts, 100);
    assert.ok(Math.abs(state.y - RAFT.levelHeight) < 1e-6, `orientation ${dir} reaches upper floor, y=${state.y}`);
    state = run(engine, state, { mx: -fx, mz: -fz }, parts, 100);
    assert.ok(Math.abs(state.y) < 1e-6, `orientation ${dir} returns to lower deck, y=${state.y}`);
  }
});

test('input objects are immutable, results are frozen, bad bounds are rejected, and replay is deterministic', () => {
  const engine = new DeckWalkEngine(), parts = flat(), state = stateAt(1, 1), axes = { mx: 0, mz: 1 };
  const before = structuredClone({ state, axes, parts });
  const first = engine.step(state, axes, parts, params);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual({ state, axes, parts }, before);
  assert.deepEqual(engine.step(state, axes, parts, params), first);

  for (const bad of [
    { ...state, x: Infinity }, { ...state, x: 257 }, { ...state, y: -1.01 },
    { ...state, z: -257 }, { ...state, mag: 1.01 }, { ...state, vx: 51 },
    { ...state, vz: 1e20 },
  ]) assert.throws(() => engine.step(bad, axes, parts, params), TypeError);
  for (const bad of [{ mx: NaN, mz: 0 }, { mx: 1.01, mz: 0 }])
    assert.throws(() => engine.step(state, bad, parts, params), TypeError);
  for (const bad of [{ speed: -0.1, radius: 0.4 }, { speed: 51, radius: 0.4 },
    { speed: 1, radius: 0.04 }, { speed: 1, radius: 2.01 }])
    assert.throws(() => engine.step(state, axes, parts, bad), TypeError);
  for (const badParts of [{}, [], [['unknown', 0, 0, 0]], [['foundation', 0, 0]],
    [['foundation', 129, 0, 0]], [['foundation', 0, 0, 9]], [['foundation', 0, 0, 0, 4]],
    Array.from({ length: 601 }, () => ['foundation', 0, 0, 0])])
    assert.throws(() => engine.step(state, axes, badParts, params), TypeError);
  assert.throws(() => engine.step(stateAt(12, 1), axes, parts, params), /support/,
    'a snapshot outside every deck surface is not accepted');
  const wall = [...flat(2, 2), ['wall', 0, 0, 0, 1]];
  assert.throws(() => engine.step(stateAt(1.95, 1), axes, wall, params), /support/,
    'a snapshot inside the wall radius is not accepted');

  const replay = new DeckWalkEngine();
  let a = state, b = structuredClone(state);
  for (let i = 0; i < 50; i++) {
    const cmd = i < 24 ? { mx: 0.4, mz: 0.7 } : { mx: 0, mz: 0 };
    a = engine.step(a, cmd, parts, params);
    b = replay.step(b, cmd, parts, params);
    assert.deepEqual(a, b);
  }
});
