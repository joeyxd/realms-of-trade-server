import test from 'node:test';
import assert from 'node:assert/strict';
import { random3, random4, uniformRange, uniformSpan, randomUnitVector } from '../../src/render/vfx/niagara/core/rng.js';
import { sampleCurve, validateCurve } from '../../src/render/vfx/niagara/core/curve.js';
import { rateStep, rateBirthAge, spawnUpdateDt } from '../../src/render/vfx/niagara/core/spawn-rate.js';
import { DT, normalizedAge, normalizedAgeByReciprocal, ageParticle, integrateVelocity, scaleColor, scaleSpriteSize } from '../../src/render/vfx/niagara/core/particle-state.js';
import { subUVFrame } from '../../src/render/vfx/niagara/core/subuv.js';
import { emitterStateOnce, burstWindow, burstBirthAge } from '../../src/render/vfx/niagara/core/burst.js';
import { dragVelocity, addVelocityFromPoint, sizeFromMass } from '../../src/render/vfx/niagara/core/physics.js';

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

// BasicHit primitives (T-1021-03).
const TWO_PI_VM = f32(6.28319);

test('uniformSpan draws min + span * r and equals uniformRange with the folded span', () => {
  assert.equal(uniformSpan(2, 8, 0), 2);
  assert.equal(uniformSpan(0.25, 0.25, 0.5), 0.375);
  for (const [a, b] of [[0.1, 0.6], [0.4, 2], [75, 400], [0.7, 1], [0.25, 0.5], [-1, 1]])
    for (const r of [0, 0.125, 0.5, 0.999, 1 - 2 ** -24])
      assert.equal(uniformSpan(a, f32(f32(b) - f32(a)), r), uniformRange(a, b, r));
});

test('randomUnitVector maps (phi, cos theta) to a unit vector with z = cos theta', () => {
  assert.deepEqual(randomUnitVector([0, 0.5], [0, -1], [TWO_PI_VM, 2]), [1, 0, 0]);
  assert.deepEqual(randomUnitVector([0, 0], [0, -1], [TWO_PI_VM, 2]), [0, 0, -1]);
  for (const id of [0, 1, 77, 249]) {
    const random = random3(id, 0, 6373, 7), v = randomUnitVector(random, [0, -1], [TWO_PI_VM, 2]);
    assert.equal(v[2], uniformSpan(-1, 2, random[1]));
    assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-6);
  }
});

test('spawnUpdateDt is shared: rateBirthAge keeps the pilot guard, burstBirthAge accepts exactly dt', () => {
  assert.equal(spawnUpdateDt(0.25, 0.5, 1, 1), rateBirthAge(0.25, 0.5, 1, 1));
  assert.equal(spawnUpdateDt(0, 0, 0, DT), DT);
  assert.throws(() => rateBirthAge(0, 0, 0, DT), /Unsupported native birth timing/);
  assert.equal(burstBirthAge(0, 0, 0, DT), DT);
  assert.equal(burstBirthAge(0, 0, 249, DT), DT);
  assert.equal(burstBirthAge(f32(0.25), 0, 0, 1), 0.75);
  assert.throws(() => burstBirthAge(DT, 0, 0, DT), /Unsupported burst birth timing/);
  assert.throws(() => burstBirthAge(-1, 0, 0, DT), /Unsupported burst birth timing/);
});

test('emitterStateOnce deactivates at the end of the loop and stays inactive', () => {
  const state = { loopedAge: 0, active: true };
  let ticks = 0;
  while (emitterStateOnce(state, DT, 1)) ticks++;
  // 60 f32 steps of 1/60 stay just below 1: the loop closes on tick 61.
  assert.equal(ticks, 60);
  assert.deepEqual(state, { loopedAge: 0, active: false });
  assert.equal(emitterStateOnce(state, DT, 1), false);
  assert.equal(state.loopedAge, DT);
});

test('burstWindow fires once at SpawnTime 0 with InterpStartDt +0 for either first delta', () => {
  for (const first of [f32(0.0001), DT]) {
    const state = { loopedAge: 0, active: true };
    emitterStateOnce(state, first, 1);
    const tick1 = burstWindow(0, state.loopedAge, first);
    assert.equal(tick1.fires, true);
    assert.ok(Object.is(tick1.interpStartDt, 0));
    emitterStateOnce(state, DT, 1);
    assert.equal(burstWindow(0, state.loopedAge, DT).fires, false);
  }
  // The tick that closes the loop resets LoopedAge to 0: no burst in that tick.
  assert.equal(burstWindow(0, 0, DT).fires, false);
  const mid = burstWindow(0.5, f32(0.51), f32(0.02));
  assert.equal(mid.fires, true);
  assert.equal(mid.interpStartDt, f32(0.5 - f32(f32(0.51) - f32(0.02))));
});

test('dragVelocity divides by drag * dt + 1; zero or negative drag keeps the velocity', () => {
  const denominator = f32(f32(0.75 * DT) + 1);
  assert.deepEqual(dragVelocity([3, -6, 0], 0.75, DT), [f32(3 / denominator), f32(-6 / denominator), 0]);
  assert.deepEqual(dragVelocity([3, -6, 0], 0, DT), [3, -6, 0]);
  assert.deepEqual(dragVelocity([3, -6, 0], -1, DT), [3, -6, 0]);
});

test('addVelocityFromPoint adds strength * fallback on the origin and rejects other geometry', () => {
  const threshold = f32(f32(1e-5) * f32(1e-5));
  assert.deepEqual(addVelocityFromPoint([0, 0, 0], [0, 0, 0], [0, 0, 0], 100, [0.6, 0, -0.8], threshold), [60, 0, -80]);
  assert.deepEqual(addVelocityFromPoint([1, 2, 3], [0, 0, 0], [0, 0, 0], 2, [1, 0, 0], threshold), [3, 2, 3]);
  assert.throws(() => addVelocityFromPoint([0, 0, 0], [1, 0, 0], [0, 0, 0], 100, [1, 0, 0], threshold), /Unsupported AddVelocityFromPoint/);
  assert.throws(() => addVelocityFromPoint([0, 0, 0], [0, 0, 0], [0, 0, 5], 100, [1, 0, 0], threshold), /Unsupported AddVelocityFromPoint/);
});

test('sizeFromMass is the cube-root edge of mass / density in cm3, clamped at 0', () => {
  const exponent = f32(0.333333);
  assert.ok(Math.abs(sizeFromMass(f32(8.05), 8050, 1e6, exponent) - 10) < 1e-4);
  assert.equal(sizeFromMass(f32(8.05), 8050, 1e6, exponent), f32(Math.pow(1000, exponent)));
  assert.equal(sizeFromMass(0, 8050, 1e6, exponent), 0);
  assert.equal(sizeFromMass(-1, 8050, 1e6, exponent), 0);
});

test('scaleColor scales only alpha; scaleSpriteSize scales both axes of the initial values', () => {
  const initial = [3470, f32(468.92), 0.5, 1];
  assert.deepEqual(scaleColor(initial, 0.25), [3470, f32(468.92), 0.5, 0.25]);
  assert.deepEqual(scaleColor([37, 6, f32(0.7), 0.5], f32(1.1)), [37, 6, f32(0.7), f32(0.5 * f32(1.1))]);
  assert.deepEqual(scaleSpriteSize([120, 120], 0.5), [60, 60]);
  assert.deepEqual(scaleSpriteSize([f32(5.5), f32(5.5)], f32(0.3)), [f32(f32(5.5) * f32(0.3)), f32(f32(5.5) * f32(0.3))]);
});
