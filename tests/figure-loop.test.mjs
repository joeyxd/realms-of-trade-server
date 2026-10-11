import test from 'node:test';
import assert from 'node:assert/strict';
import { createFigureLoop } from '../src/ui/figureLoop.js';

function fakeFrames() {
  let nextId = 0;
  const pending = new Map();
  return {
    request: (callback) => { const id = nextId++; pending.set(id, callback); return id; },
    cancel: (id) => pending.delete(id),
    step(timestamp) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(timestamp));
    },
    get count() { return pending.size; },
  };
}

function makeLoop(frames, shouldRun, draw, options = {}) {
  return createFigureLoop({ requestFrame: frames.request, cancelFrame: frames.cancel, shouldRun, draw, ...options });
}

test('figure loop caps updates at 24 FPS and caps a delayed frame delta at 0.1s', () => {
  const frames = fakeFrames(), times = [], deltas = [];
  const loop = makeLoop(frames, () => true, (delta) => { times.push(now); deltas.push(delta); });
  let now = 0;
  loop.sync();
  for (now = 0; now <= 1000; now += 10) frames.step(now);
  assert.ok(times.length <= 24, `draws=${times.length}`);
  assert.ok(times.length >= 20, `draws=${times.length}`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1000 / 24 - 1e-3);
  assert.ok(deltas.every((delta) => delta >= 0 && delta <= 0.1));
  loop.dispose();
  assert.equal(frames.count, 0);
});

test('stopping cancels the pending frame and reopening resets the animation clock', () => {
  const frames = fakeFrames(), deltas = [];
  let enabled = true;
  const loop = makeLoop(frames, () => enabled, (delta) => deltas.push(delta));
  loop.sync(); frames.step(100); // Establish a frame-clock baseline.
  assert.equal(frames.count, 1);
  enabled = false; loop.sync();
  assert.equal(frames.count, 0);
  frames.step(10_000);
  assert.deepEqual(deltas, []);

  enabled = true; loop.sync();
  frames.step(20_000); // First visible frame establishes a fresh baseline.
  frames.step(20_050);
  assert.deepEqual(deltas, [0.05]);
  loop.dispose();
});

test('all visibility and accessibility gates must pass before a frame is scheduled', () => {
  const frames = fakeFrames();
  const state = { open: true, profile: true, sheet: true, canvasVisible: true, pageVisible: true, motionAllowed: true, animated: true };
  const loop = makeLoop(frames, () => Object.values(state).every(Boolean), () => {});
  loop.sync();
  assert.equal(frames.count, 1);
  for (const key of Object.keys(state)) {
    const prior = state[key]; state[key] = false;
    loop.sync();
    assert.equal(frames.count, 0, `${key} should stop the loop`);
    state[key] = prior;
  }
  loop.sync();
  assert.equal(frames.count, 1);
  loop.dispose();
});

test('sync coalesces requests and dispose prevents later scheduling', () => {
  const frames = fakeFrames();
  const loop = makeLoop(frames, () => true, () => {});
  loop.sync(); loop.sync();
  assert.equal(frames.count, 1);
  loop.dispose();
  assert.equal(frames.count, 0);
  loop.sync();
  assert.equal(frames.count, 0);
});
