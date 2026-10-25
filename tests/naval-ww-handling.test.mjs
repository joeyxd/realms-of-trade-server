import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';
import { WW_SPEED, WW_ANGLE } from '../src/data/navalHandling.js';
import { PILOTING } from '../src/data/progression.js';
import { buildNavalRig, newNavalState, stepNaval, jettisonLabCargo } from '../src/sim/naval/handling.js';
import { rebaseNavalState } from '../src/sim/naval/operational.js';
import { createTrialBody, stepTrialBody, parkTrialBody, damageTrialBody } from '../src/sim/naval/trialBody.js';

const rig = buildNavalRig(STARTER_RAFT), wind = NAVAL_TRIAL.wind, env = { handling: 'windwaker' };
const top = 55 * WW_SPEED, full = Math.PI / 4;
const close = (actual, expected, tolerance, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} versus ${expected} (tolerance ${tolerance})`);
const forward = (s) => s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
const advance = (s, input, ticks, w = wind, environment = env, r = rig) => {
  for (let i = 0; i < ticks; i++) s = stepNaval(s, input, r, w, environment);
  return s;
};

// Independent 30 Hz reference: WW units, one addCalc per frame, tiller then turn then speed.
function addCalc(value, target, scale, maxStep, minStep) {
  const gap = target - value;
  const step = Math.abs(gap * scale) >= minStep ? Math.min(Math.abs(gap * scale), maxStep)
    : Math.min(Math.abs(gap), minStep);
  return value + Math.sign(gap) * step;
}
function reference(s, { throttle = 0, brake = 0, steer = 0 }, w = wind) {
  const helm = addCalc(s.helm, steer * 8192, 0.25, 700, 256);
  const turn = Math.max(0.1, Math.min(3.6, 4 - 3 * Math.abs(s.speed) / 55));
  const yaw = s.yaw + turn * helm / 64 * WW_ANGLE;
  const angle = Math.abs(Math.atan2(Math.sin(w.yaw - yaw), Math.cos(w.yaw - yaw))) / WW_ANGLE;
  const factor = angle < 16384 ? 1 - angle / 65536 : angle <= 24576
    ? 0.75 - (angle - 16384) * 5.493164e-5 : Math.max(0, 0.3 - (angle - 24576) * 0.00032967);
  const sail = throttle * Math.min(1, w.strength / 0.5) * factor * 55, paddle = throttle * 10;
  const target = brake > 0 ? 0 : Math.max(sail, paddle);
  const params = brake > 0 ? [0.1, brake, 0.1 * brake] : sail > 0 && sail >= paddle && s.speed < sail
    ? [0.1, 0.5, 0.1] : [0.05, 0.1, 0.015];
  return { helm, yaw, speed: addCalc(s.speed, target, ...params) };
}

test('tailwind speed follows the 30 Hz reference for twenty seconds at the WW proportion', () => {
  let s = newNavalState(), ref = { speed: 0, helm: 0, yaw: 0 }, reached = 0;
  for (let tick = 1; tick <= 1200; tick++) {
    s = stepNaval(s, { throttle: 1 }, rig, wind, env);
    if (!reached && forward(s) >= 50 * WW_SPEED) reached = tick;
    if (tick % 2 === 0) {
      ref = reference(ref, { throttle: 1 });
      close(forward(s), ref.speed * WW_SPEED, top * 0.005, `tick ${tick}`);
    }
  }
  close(forward(s), 21.03, 21.03 * 0.005);
  close(reached, 200, 4, 'first tick at 50 WW speed');
});

test('beam and quarter winds sail; a headwind falls back to the paddle target', () => {
  for (const [degrees, expected] of [[90, 41.25], [135, 16.5], [160, 10]]) {
    const s = advance(newNavalState(), { throttle: 1 }, 2400, { yaw: degrees * Math.PI / 180, strength: 0.75 });
    close(forward(s), expected * WW_SPEED, expected * WW_SPEED * 0.01, `${degrees} degrees`);
  }
});

test('tiller follows the reference and reaches full lock at thirty ticks', () => {
  let s = newNavalState(), ref = { speed: 0, helm: 0, yaw: 0 }, reached = 0;
  for (let tick = 1; tick <= 120; tick++) {
    s = stepNaval(s, { steer: 1 }, rig, wind, env);
    if (!reached && s.helm === full) reached = tick;
    if (tick % 2 === 0) {
      ref = reference(ref, { steer: 1 });
      close(s.helm, ref.helm * WW_ANGLE, full * 0.01, `tick ${tick}`);
    }
  }
  close(reached, 30, 2);
});

test('full-lock yaw rate falls with forward speed and preserves the positive steer sign', () => {
  for (const [speed, expected] of [[0, 1.325], [top, 0.368]]) {
    const s = stepNaval({ ...newNavalState(), helm: full, vz: speed }, { steer: 1 }, rig, wind, env);
    close(s.omega, expected, expected * 0.02);
    assert.ok(s.yaw > 0);
  }
});

test('hard turns have no drift and move using the new velocity', () => {
  const initial = { ...newNavalState(), vz: top };
  const next = stepNaval(initial, { throttle: 1, steer: 1 }, rig, wind, env);
  close(next.x, next.vx / 60, 1e-12);
  close(next.z, next.vz / 60, 1e-12);
  const s = advance(initial, { throttle: 1, steer: 1 }, 180);
  close(s.vx * Math.cos(s.yaw) - s.vz * Math.sin(s.yaw), 0, 1e-9);
});

test('braking matches the reference and coasting retains speed', () => {
  let s = { ...newNavalState(), vz: top }, ref = { speed: 55, helm: 0, yaw: 0 };
  for (let tick = 1; tick <= 192; tick++) {
    s = stepNaval(s, { brake: 1 }, rig, wind, env);
    if (tick % 2 === 0) {
      ref = reference(ref, { brake: 1 });
      close(forward(s), ref.speed * WW_SPEED, top * 0.01, `brake tick ${tick}`);
    }
  }
  assert.ok(forward(s) < 0.05);
  assert.ok(forward(advance({ ...newNavalState(), vz: top }, {}, 300)) > 14);
});

const body = (navigation = true) => createTrialBody(STARTER_RAFT, { x: 0, y: 0.72, z: 0, yaw: 0 }, 'ww:test', 0,
  navigation ? { navigation: true, wind, flowOrigin: { x: 0, z: 0, yaw: 0 } } : {});

test('JSON transport preserves tiller and deterministic navigation replay', () => {
  const moving = stepTrialBody(body(), { throttle: 1, steer: 1 }, wind);
  const transported = JSON.parse(JSON.stringify(moving));
  assert.equal(transported.state.helm, moving.state.helm);
  assert.ok(transported.state.helm > 0);
  const input = { throttle: 0.75, steer: -0.5 };
  assert.deepEqual(stepTrialBody(transported, input, wind), stepTrialBody(moving, input, wind));
  const parked = parkTrialBody(moving, true);
  assert.equal(parked.state.helm, 0);
  assert.equal(stepTrialBody(parked, input, wind).state.helm, 0);
  let damaged = moving;
  for (const entry of moving.structure.entries.filter((e) => e.part[0] === 'foundation'))
    damaged = damageTrialBody(damaged, entry.id, entry.maxHp).body;
  assert.equal(damaged.state.helm, 0);
  assert.equal(stepTrialBody(damaged, input, wind).state.helm, 0);
});

test('D08 non-navigation bodies still use the unchanged force model', () => {
  const lab = body(false), input = { throttle: 1, steer: 0.7 };
  assert.deepEqual(stepTrialBody(lab, input, wind).state, stepNaval(lab.state, input, lab.operational.rig, wind));
  assert.notDeepEqual(stepNaval(lab.state, input, rig, wind, env), stepNaval(lab.state, input, rig, wind));
});

test('tiller is validated, defaults for old states and survives coordinate transforms', () => {
  for (const helm of [undefined, null, NaN, Infinity, full + 2e-9, -full - 2e-9])
    assert.throws(() => stepNaval({ ...newNavalState(), helm }, {}, rig, wind), TypeError);
  const old = newNavalState(); delete old.helm;
  assert.equal(stepNaval(old, {}, rig, wind, env).helm, 0);
  const s = { ...newNavalState(), helm: 0.3 }, cargo = [{ mass: 3, x: 1, z: 1 }];
  const loaded = buildNavalRig(STARTER_RAFT, cargo);
  assert.equal(rebaseNavalState(s, loaded, rig).helm, s.helm);
  assert.equal(jettisonLabCargo({ parts: STARTER_RAFT, cargo }, s).state.helm, s.helm);
});

test('WW retains current, gust envelope, overload and piloting without using mass or inertia', () => {
  const s = { ...newNavalState(), helm: full, vz: top };
  const input = { throttle: 1, steer: 1 };
  const base = stepNaval(s, input, rig, wind, env);
  assert.deepEqual(stepNaval(s, input, { ...rig, mass: 100, inertia: 1000, cells: 20, wetted: 8, stability: 0.2 }, wind, env), base);
  const skilled = stepNaval(s, input, rig, wind, { ...env, rudderMultiplier: PILOTING.rudderMultiplier });
  close(skilled.omega, base.omega * PILOTING.rudderMultiplier, 1e-12);
  const overloaded = advance(newNavalState(), { throttle: 1 }, 2400, wind, env, { ...rig, flotation: 0.5 });
  close(forward(overloaded), top / 2, top * 0.005);
  const boosted = advance(newNavalState(), { throttle: 1 }, 2400, wind, { ...env, maxSpeed: 13, sailMultiplier: 2.8 });
  close(forward(boosted), top * 1.3, top * 0.005);
  const current = { x: 1, z: -0.5 };
  const drift = stepNaval({ ...newNavalState(), vx: 1, vz: -0.5 }, {}, rig, wind, { ...env, current });
  assert.equal(drift.vx, current.x); assert.equal(drift.vz, current.z);
});
