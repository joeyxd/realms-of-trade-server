import test from 'node:test';
import assert from 'node:assert/strict';
import { random3, random4, uniformRange } from './core/rng.js';
import { sampleCurve, validateCurve } from './core/curve.js';
import { rateStep, rateBirthAge } from './core/spawn-rate.js';
import { DT, normalizedAge, normalizedAgeByReciprocal, ageParticle, integrateVelocity } from './core/particle-state.js';
import { subUVFrame } from './core/subuv.js';

const f32 = Math.fround;
const curve = (samples, minTime = 0, inverseRange = 1) => ({ minTime, inverseRange, samples });
const options = (sampleCount, message) => ({ sampleCount, min: 0, max: 2, message });

test('uniformRange maps r = 0 to a and r near 1 toward b', () => {
  assert.equal(uniformRange(2, 10, 0), 2);
  assert.ok(Math.abs(uniformRange(2, 10, 1 - 2 ** -24) - 10) < 1e-5);
  assert.equal(uniformRange(-1, 1, 0.5), 0);
});

test('random3 and random4 are deterministic and return unit-interval values', () => {
  for (const [fn, length] of [[random3, 3], [random4, 4]]) {
    const a = fn(7, 12, 6371, 2);
    assert.equal(a.length, length);
    assert.ok(a.every(v => v >= 0 && v < 1));
    assert.deepEqual(fn(7, 12, 6371, 2), a);
    assert.notDeepEqual(fn(8, 12, 6371, 2), a);
  }
});

test('sampleCurve clamps outside the LUT and interpolates between samples', () => {
  const c = curve([0, 1, 2]);
  assert.equal(sampleCurve(c, -5), 0);
  assert.equal(sampleCurve(c, 5), 2);
  assert.equal(sampleCurve(c, 0.25), 0.5);
  assert.equal(sampleCurve(c, 0.5), 1);
  assert.equal(sampleCurve(curve([0, 2], 1, 0.5), 2), 1);
});

test('validateCurve accepts a valid curve and rejects bad shapes with the given message', () => {
  const ok = curve([0, 0.5, 1, 1.5, 2]);
  assert.equal(validateCurve(ok, options(5, 'bad')), ok);
  assert.throws(() => validateCurve(ok, options(4, 'wrong length')), /^Error: wrong length$/);
  assert.throws(() => validateCurve(curve([0, NaN, 1, 1, 1]), options(5, 'not finite')), /^Error: not finite$/);
  assert.throws(() => validateCurve(curve([0, 1, 2, 3, 4]), options(5, 'out of range')), /^Error: out of range$/);
  assert.throws(() => validateCurve(curve([0, 1, 1, 1, 1], 0, 0), options(5, 'zero range')), /^Error: zero range$/);
  assert.throws(() => validateCurve(curve([0, 1, 1, 1, 1], Infinity), options(5, 'min time')), /^Error: min time$/);
  assert.throws(() => validateCurve(null, options(5, 'missing')), /^Error: missing$/);
});

test('rateStep accumulates the remainder: rate 3 at 60 Hz births its first particle on call 20', () => {
  const interval = f32(1 / 3);
  let remainder = 0;
  const counts = [];
  for (let i = 0; i < 20; i++) {
    const step = rateStep(remainder, 3, interval, DT);
    counts.push(step.count);
    remainder = step.remainder;
  }
  assert.deepEqual(counts, [...Array(19).fill(0), 1]);
  assert.ok(remainder >= 0 && remainder < 1e-6);
  assert.equal(rateStep(0, 3, interval, DT).start, interval);
  assert.equal(rateStep(0.5, 3, interval, DT).start, f32(interval * 0.5));
});

test('rateBirthAge returns the age inside the tick and rejects ages outside [0, dt)', () => {
  assert.equal(rateBirthAge(0.25, 0.5, 0, 1), 0.75);
  assert.equal(rateBirthAge(0.25, 0.5, 1, 1), 0.25);
  assert.throws(() => rateBirthAge(0.25, 0.5, 2, 1), /Unsupported native birth timing/);
  assert.throws(() => rateBirthAge(0, 0.5, 0, 1), /Unsupported native birth timing/);
});

test('normalizedAge divides; the reciprocal variant multiplies by the rounded reciprocal', () => {
  assert.equal(normalizedAge(0.5, 2), 0.25);
  assert.equal(normalizedAgeByReciprocal(0.5, 2), 0.25);
  assert.equal(normalizedAgeByReciprocal(1, 3), f32(f32(1 / 3)));
});

test('ageParticle: null epsilon kills at lifetime, a number kills at lifetime minus epsilon', () => {
  const run = (age, epsilon) => {
    const p = { age, lifetime: 1 };
    return [ageParticle(p, 0.25, epsilon), p.age];
  };
  assert.deepEqual(run(0.5, null), [true, 0.75]);
  assert.deepEqual(run(0.75, null), [false, 1]);
  assert.deepEqual(run(0.75, 0.0001), [false, 1]);
  // One step earlier than the unrounded rule: 0.99995 is alive at lifetime but dead at lifetime - 0.0001.
  assert.equal(run(f32(0.74995), null)[0], true);
  assert.equal(run(f32(0.74995), 0.0001)[0], false);
});

test('integrateVelocity adds velocity * dt per axis', () => {
  const p = { position: [1, 2, 3], velocity: [4, 0, -8] };
  integrateVelocity(p, 0.25);
  assert.deepEqual(p.position, [2, 2, 1]);
});

test('subUVFrame scales the normalized age by the frame count', () => {
  assert.equal(subUVFrame(0.5, 40), 20);
  assert.equal(subUVFrame(0, 40), 0);
});
