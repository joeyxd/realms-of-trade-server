import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVAL_NAVIGATION as N } from '../src/data/navalNavigation.js';
import {
  buildNavalRig, newNavalState, stepNaval, windEfficiency,
} from '../src/sim/naval/handling.js';
import {
  CURRENT_LANES, currentAt, gustAt, newSailingActivity, sailingEnvironment, stepSailingActivity,
} from '../src/sim/naval/navigation.js';
import { LAB_WINDS, labFixture } from '../tools/naval-lab/fixtures.js';
import { NavalLabClock } from '../tools/naval-lab/clock.js';

const magnitude = ({ x, z }) => Math.hypot(x, z);
const velocity = ({ vx, vz }) => Math.hypot(vx, vz);
const sailRig = (id = 'empty') => {
  const fixture = labFixture(id);
  return buildNavalRig(fixture.parts, fixture.cargo);
};

test('current fields are deterministic, bounded, continuous, and disabled cleanly', () => {
  const samples = [];
  for (let z = -10; z <= 130; z += 5) {
    for (let x = -12; x <= 24; x += 3) {
      const flow = currentAt(x, z);
      assert.ok(Number.isFinite(flow.x) && Number.isFinite(flow.z) && Number.isFinite(flow.strength));
      assert.ok(magnitude(flow) <= N.maxCurrentSpeed + 1e-9);
      assert.ok(flow.strength <= N.maxCurrentSpeed + 1e-9);
      assert.deepEqual(flow, currentAt(x, z));
      samples.push([x, z, flow]);
    }
  }
  assert.ok(CURRENT_LANES.length > 0);
  assert.ok(samples.some(([, , flow]) => flow.strength > 0));
  assert.deepEqual(currentAt(4, 63, false), { x: 0, z: 0, strength: 0 });
  assert.deepEqual(currentAt(Number.NaN, 10), { x: 0, z: 0, strength: 0 });

  // The smooth lateral boundary must not introduce a visible flow discontinuity.
  const lane = CURRENT_LANES[0];
  const centreOffset = lane.bend * Math.sin(Math.PI / 2);
  const edgeX = lane.x + centreOffset + lane.halfWidth;
  const before = currentAt(edgeX - 1e-4, 63), after = currentAt(edgeX + 1e-4, 63);
  assert.ok(magnitude({ x: before.x - after.x, z: before.z - after.z }) < 0.01);
});

test('a stationary hull accelerates toward water flow through relative drag, without additive runaway', () => {
  const rig = sailRig(), wind = LAB_WINDS.find((item) => item.id === 'calm');
  const flow = currentAt(4, 63);
  assert.ok(flow.strength > 0.5);
  let state = { ...newNavalState(), x: 4, z: 63 };
  const initialDifference = magnitude({ x: state.vx - flow.x, z: state.vz - flow.z });
  state = stepNaval(state, {}, rig, wind, { current: flow });
  assert.ok(velocity(state) > 0, 'water carries the hull even without throttle');
  assert.ok(velocity(state) < flow.strength, 'one tick cannot teleport the hull to water speed');
  for (let i = 1; i < 600; i++) state = stepNaval(state, {}, rig, wind, { current: flow });
  assert.ok(magnitude({ x: state.vx - flow.x, z: state.vz - flow.z }) < initialDifference);
  assert.ok(velocity(state) <= N.boostMaxSpeed);
});

test('leaving a current lane changes motion gradually instead of snapping velocity', () => {
  const rig = sailRig(), wind = LAB_WINDS.find((item) => item.id === 'calm');
  let state = { ...newNavalState(), x: 4, z: 99 };
  const startFlow = currentAt(state.x, state.z);
  state.vx = startFlow.x; state.vz = startFlow.z;
  let maxTickChange = 0, sawExit = false;
  for (let i = 0; i < 900; i++) {
    const flow = currentAt(state.x, state.z);
    if (flow.strength === 0) sawExit = true;
    const next = stepNaval(state, {}, rig, wind, { current: flow });
    maxTickChange = Math.max(maxTickChange, magnitude({ x: next.vx - state.vx, z: next.vz - state.vz }));
    state = next;
  }
  assert.ok(sawExit, 'fixture traverses out of the current field');
  assert.ok(maxTickChange < 0.1, `per-tick flow response stays smooth (max ${maxTickChange})`);
  assert.ok(Object.values(state).every(Number.isFinite));
});

test('gust announcement, approach, window and calm/disabled states are tick-defined', () => {
  const wind = LAB_WINDS.find((item) => item.id === 'tail');
  assert.equal(gustAt(0, wind).phase, 'idle');
  assert.equal(gustAt(N.announcementTick - 1, wind).phase, 'idle');
  assert.equal(gustAt(N.announcementTick, wind).phase, 'approach');
  assert.equal(gustAt(N.windowStart - 1, wind).phase, 'approach');
  assert.equal(gustAt(N.windowStart, wind).phase, 'window');
  assert.equal(gustAt(N.windowStart + N.windowTicks - 1, wind).phase, 'window');
  assert.equal(gustAt(N.windowStart + N.windowTicks, wind).phase, 'idle');
  assert.equal(gustAt(N.windowStart, LAB_WINDS.find((item) => item.id === 'calm')).phase, 'idle');
  assert.equal(gustAt(N.windowStart, wind, false).phase, 'idle');
  assert.equal(gustAt(N.windowStart, wind).id, 0);
  assert.equal(gustAt(N.cycleTicks + N.windowStart, wind).id, 1);
});

test('capture resolves perfect, normal, early, poor-angle and no-throttle attempts once', () => {
  const rig = sailRig(), tail = LAB_WINDS.find((item) => item.id === 'tail');
  const attempt = (tick, input, wind = tail) => stepSailingActivity(
    newSailingActivity(), { ...newNavalState(), tick }, input, rig, wind,
  );

  const perfect = attempt(N.windowStart + N.windowTicks / 2, { capture: true, throttle: 1, brake: 0 });
  assert.equal(perfect.event, 'perfect');
  assert.equal(perfect.activity.multiplier, N.perfectMultiplier);
  assert.equal(perfect.activity.boostUntil, N.windowStart + N.windowTicks / 2 + N.boostTicks);

  const normal = attempt(N.windowStart + 1, { capture: true, throttle: 1, brake: 0 });
  assert.equal(normal.event, 'capture');
  assert.equal(normal.activity.multiplier, N.captureMultiplier);

  const early = attempt(N.windowStart - 1, { capture: true, throttle: 1, brake: 0 });
  assert.equal(early.event, 'early');
  const tooEarlyToRetry = stepSailingActivity(early.activity,
    { ...newNavalState(), tick: N.windowStart }, { capture: true, throttle: 1, brake: 0 }, rig, tail);
  assert.equal(tooEarlyToRetry.event, null);
  assert.equal(tooEarlyToRetry.activity.multiplier, 1);

  const head = LAB_WINDS.find((item) => item.id === 'head');
  assert.ok(windEfficiency(0, head) < 0.55);
  assert.equal(attempt(N.windowStart + 1, { capture: true, throttle: 1 }, head).event, 'angle');
  assert.equal(attempt(N.windowStart + 1, { capture: true, throttle: 0, brake: 0 }, tail).event, 'miss');
});

test('boost expires without a hard speed-envelope cut and disabled activity cannot retain a boost', () => {
  const rig = sailRig(), wind = LAB_WINDS.find((item) => item.id === 'tail');
  const tick = N.windowStart + N.windowTicks / 2;
  const captured = stepSailingActivity(newSailingActivity(), { ...newNavalState(), tick },
    { capture: true, throttle: 1 }, rig, wind);
  const before = { ...newNavalState(), tick: captured.activity.boostUntil - 1, vz: 12.5 };
  const atExpiry = { ...before, tick: captured.activity.boostUntil };
  assert.equal(sailingEnvironment(captured.activity, before, false).sailMultiplier, N.perfectMultiplier);
  assert.equal(sailingEnvironment(captured.activity, before, false).maxSpeed, N.boostMaxSpeed);
  assert.equal(sailingEnvironment(captured.activity, atExpiry, false).sailMultiplier, 1);
  assert.equal(sailingEnvironment(captured.activity, atExpiry, false).maxSpeed, N.boostMaxSpeed);
  const afterTick = stepNaval(before, {}, rig, wind, sailingEnvironment(captured.activity, before, false));
  const expiryTick = stepNaval(afterTick, {}, rig, wind, sailingEnvironment(captured.activity, atExpiry, false));
  assert.ok(magnitude({ x: expiryTick.vx - afterTick.vx, z: expiryTick.vz - afterTick.vz }) < 0.5,
    'expiry removes extra thrust gradually and does not clip existing speed');

  const disabled = stepSailingActivity(captured.activity, atExpiry,
    { capture: true, throttle: 1 }, rig, wind, false);
  assert.equal(disabled.event, null);
  assert.equal(disabled.activity.multiplier, 1);
  assert.equal(disabled.activity.boostUntil, 0);
});

test('announced boost produces a meaningful but mass-sensitive distance gain', () => {
  const wind = LAB_WINDS.find((item) => item.id === 'tail');
  const run = (id, capture) => {
    const rig = sailRig(id);
    let state = newNavalState(), activity = newSailingActivity();
    for (let i = 0; i < 900; i++) {
      const result = stepSailingActivity(activity, state,
        { capture: capture && state.tick === N.windowStart + N.windowTicks / 2, throttle: 1 }, rig, wind);
      activity = result.activity;
      state = stepNaval(state, { throttle: 1 }, rig, wind, sailingEnvironment(activity, state, false));
    }
    return state;
  };
  const lightBase = run('empty', false), lightBoost = run('empty', true);
  const heavyBase = run('house', false), heavyBoost = run('house', true);
  const distance = (state) => Math.hypot(state.x, state.z);
  const lightGain = distance(lightBoost) - distance(lightBase);
  const heavyGain = distance(heavyBoost) - distance(heavyBase);
  assert.ok(lightGain > 1, `active trim should change the route (gain ${lightGain})`);
  assert.ok(heavyGain > 0, 'a heavy vessel can benefit from trim');
  assert.ok(lightBoost.tick === heavyBoost.tick);
  assert.ok(velocity(lightBoost) <= N.boostMaxSpeed + 1e-9);
  assert.ok(velocity(heavyBoost) <= N.boostMaxSpeed + 1e-9);
  assert.ok(lightGain > heavyGain, `same force should accelerate the light fixture more (${lightGain} vs ${heavyGain})`);
});

test('current and gust outcome are identical across 30, 60 and 120 render FPS', () => {
  const fixture = labFixture('rim'), rig = buildNavalRig(fixture.parts, fixture.cargo);
  const wind = LAB_WINDS.find((item) => item.id === 'tail');
  const run = (fps) => {
    const clock = new NavalLabClock();
    let state = { ...newNavalState(), x: 4, z: 63 }, activity = newSailingActivity();
    for (let frame = 0; frame < fps * 18; frame++) clock.advance(1 / fps, () => {
      const result = stepSailingActivity(activity, state,
        { capture: state.tick === N.windowStart + N.windowTicks / 2, throttle: 1 }, rig, wind);
      activity = result.activity;
      state = stepNaval(state, { throttle: 1, steer: state.tick < 600 ? 0.1 : -0.1 }, rig, wind,
        sailingEnvironment(activity, state));
    });
    assert.equal(state.tick, 1080);
    return { state, activity, dropped: clock.dropped };
  };
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(60), run(120));
});
