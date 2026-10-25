import test from 'node:test';
import assert from 'node:assert/strict';
import { createHullMotion, stepHullMotion, createRiderMotion, stepRiderMotion, wwSeaHeight } from '../src/render/naval/hullMotion.js';
import { WW_ANGLE, WW_UNIT } from '../src/data/navalHandling.js';

const DEG = 180 / Math.PI, S16_DEG = WW_ANGLE * DEG;

// Runs `seconds` at `fps`; pose(t) gives the raft's drawn x, z, yaw. Returns every output.
function run(hull, seconds, fps, pose = () => ({ x: 0, z: 0, yaw: 0 })) {
  const outs = [], n = Math.round(seconds * fps);
  for (let i = 0; i <= n; i++) outs.push({ ...stepHullMotion(hull, { dt: i ? 1 / fps : 0, ...pose(i / fps) }) });
  return outs;
}

test('flat sea at rest: the hull settles level and near the water', () => {
  const outs = run(createHullMotion('flat', { waveMax: 0 }), 10, 60);
  // WW's own idle bob (SH:957-958: +30 / +35 s16 a frame against a spring with min-4 damping) rings at +-0.7 degrees
  // around a 0.35 degree offset, so the bound is 1.2 degrees, not the 0.5 the ticket guessed.
  for (const o of outs.slice(-120)) {
    assert.ok(Math.abs(o.pitch * DEG) < 1.2, `pitch ${o.pitch * DEG}`);
    assert.ok(Math.abs(o.roll * DEG) < 1.2, `roll ${o.roll * DEG}`);
    assert.ok(o.y >= -60 * WW_UNIT && o.y <= 40 * WW_UNIT, `y ${o.y}`);
  }
});

test('lean spring: a constant turn overshoots, rings at about 0.94 s and settles at the clamped aim', () => {
  // 300 s16 a frame * 7 = 2100, clamped to 0x600 (8.4 degrees). Yaw grows 300 s16 per WW frame.
  const rate = 300 * WW_ANGLE * 30, fps = 120;
  const hull = createHullMotion('lean', { waveMax: 0 });
  const outs = run(hull, 8, fps, (t) => ({ x: 0, z: 0, yaw: rate * t }));
  const lean = outs.map((o) => o.roll * DEG);
  const aim = 0x600 * S16_DEG;
  assert.ok(lean.slice(-fps).every((v) => v > 0), 'lean has the turn sign');
  const tail = lean.slice(-fps * 2), mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  assert.ok(Math.abs(mean - aim) < 1.2, `settled ${mean} vs ${aim}`);
  const peaks = [];
  for (let i = 1; i < lean.length - 1; i++) if (lean[i] > lean[i - 1] && lean[i] >= lean[i + 1] && lean[i] > aim * 0.9) peaks.push(i);
  assert.ok(peaks.length >= 2, 'at least two peaks');
  assert.ok(lean[peaks[0]] > 1.3 * aim, `first peak ${lean[peaks[0]]} over ${aim}`);
  const period = (peaks[1] - peaks[0]) / fps;
  assert.ok(Math.abs(period - 0.94) <= 0.15, `period ${period}`);
  assert.ok(outs.at(-1).turn > 0 && outs.at(-1).turn <= 1);
  const opposite = run(createHullMotion('lean', { waveMax: 0 }), 4, fps, (t) => ({ x: 0, z: 0, yaw: -rate * t }));
  assert.ok(opposite.at(-1).roll < 0);
});

test('default swell pitches a moored hull a little', () => {
  // Same seed, so the idle bob is identical in both runs and the difference is the swell alone. Its slope is bounded by
  // the sum of A * k over the four components (3.9 degrees at WW's default waveMax 10, 0.6 at our 1.5).
  const at = () => ({ x: 120, z: -80, yaw: 0.4 });
  const swell = run(createHullMotion('swell', { waveMax: 10 }), 20, 60, at), calm = run(createHullMotion('swell', { waveMax: 0 }), 20, 60, at);
  const peak = Math.max(...swell.slice(120).map((o, i) => Math.abs(o.pitch - calm[i + 120].pitch) * DEG));
  assert.ok(peak > 0.1 && peak < 3.9, `swell pitch ${peak}`);
  const knob = run(createHullMotion('swell'), 20, 60, at), knobPeak = Math.max(...knob.slice(120).map((o, i) => Math.abs(o.pitch - calm[i + 120].pitch) * DEG));
  assert.ok(knobPeak > 0 && knobPeak < 1, `our waveMax pitch ${knobPeak}`);
  assert.ok(wwSeaHeight(0, 0, 0, 10) !== wwSeaHeight(5000, 0, 0, 10));
});

test('deterministic and independent of the frame rate', () => {
  const pose = (t) => ({ x: 3 * t, z: 1.5 * t, yaw: 0.2 * t });
  const a = run(createHullMotion('ship-1'), 2, 60, pose).at(-1);
  const b = run(createHullMotion('ship-1'), 2, 60, pose).at(-1);
  assert.deepEqual(a, b);
  const c = run(createHullMotion('ship-1'), 2, 30, pose).at(-1);
  for (const key of ['y', 'pitch', 'roll', 'turn', 'speed']) assert.ok(Math.abs(a[key] - c[key]) < 1e-9, `${key}: ${a[key]} vs ${c[key]}`);
  const fast = run(createHullMotion('ship-1'), 5, 144, pose);
  assert.ok(fast.every((o) => Object.values(o).every(Number.isFinite)));
  const other = run(createHullMotion('ship-2'), 2, 60, pose).at(-1);
  assert.notDeepEqual(a, other);
});

test('rider: the body twists with the turn, within 11 degrees, and tilts after the hull', () => {
  const turning = { pitch: 0.05, roll: 0.1, turn: 1 }, rider = createRiderMotion();
  let out = stepRiderMotion(rider, turning, undefined, 0);
  for (let i = 0; i < 120; i++) out = stepRiderMotion(rider, turning, undefined, 1 / 60);
  assert.ok(out.twist > 0 && Math.abs(out.twist) * DEG <= 11);
  assert.ok(Math.abs(out.twist * DEG - 2000 * S16_DEG) < 0.5);
  assert.ok(out.roll > 0.05, 'roll follows the hull');
  const left = createRiderMotion();
  stepRiderMotion(left, { pitch: 0, roll: 0, turn: -1 }, undefined, 0);
  for (let i = 0; i < 120; i++) out = stepRiderMotion(left, { pitch: 0, roll: 0, turn: -1 }, -1, 1 / 60);
  assert.ok(out.twist < 0 && Math.abs(out.twist) * DEG <= 11);
});
