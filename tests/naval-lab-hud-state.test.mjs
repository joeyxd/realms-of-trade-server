import test from 'node:test';
import assert from 'node:assert/strict';
import { navalHudState } from '../tools/naval-lab/hud-state.js';
import { NAVAL_NAVIGATION as N } from '../src/data/navalNavigation.js';
import { NAVAL_STEP } from '../src/data/navalHandling.js';

const input = (overrides = {}) => ({
  state: { tick: 100, yaw: 0, vx: 0, vz: 0 },
  rig: { load: 0.75, cargoMass: 24 },
  wind: { yaw: 0, strength: 1 },
  gust: { id: 0, phase: 'approach', progress: 0.5, remaining: 2.25 },
  activity: { boostUntil: 0, lastAttempt: -1, result: '', resultUntil: 0 },
  current: { x: 0, z: 0, strength: 0 },
  ...overrides,
});

test('compass directions use the boat axes and wrap negative or rounded full turns', () => {
  const eastWind = navalHudState(input({
    state: { tick: 0, yaw: -Math.PI / 2, vx: 0, vz: 0 },
    wind: { yaw: Math.PI / 2, strength: 1 }, current: { x: 2, z: 0, strength: 2 },
  }));
  assert.equal(eastWind.heading, 270);
  assert.equal(eastWind.headingText, '270');
  assert.equal(eastWind.windDegrees, 90);
  assert.equal(eastWind.currentDegrees, 90);

  const north = navalHudState(input({ state: { tick: 0, yaw: (359.8 * Math.PI) / 180, vx: 0, vz: 0 } }));
  assert.equal(north.heading, 0, 'rounding 360 wraps to north');
  assert.equal(north.headingText, '000');
  assert.equal(north.windDegrees, 0);
});

test('speed gauge caps its fill while retaining actual speed text', () => {
  const hud = navalHudState(input({ state: { tick: 0, yaw: 0, vx: 15, vz: 0 } }));
  assert.equal(hud.speed, 15);
  assert.equal(hud.speedText, '15.0');
  assert.equal(hud.speedFraction, 1);
});

test('boost and result feedback expire at their actual ticks', () => {
  const live = navalHudState(input({
    state: { tick: 20, yaw: 0, vx: 0, vz: 0 },
    activity: { boostUntil: 50, lastAttempt: -1, result: 'perfect', resultUntil: 30 },
  }));
  assert.equal(live.boostSeconds, 30 * NAVAL_STEP);
  assert.equal(live.boostFraction, 30 / N.boostTicks);
  assert.equal(live.boostActive, true);
  assert.equal(live.resultText, '¡PERFECTO! La vela ruge.');
  assert.equal(live.calloutText, '¡PERFECTO!');
  assert.equal(live.calloutTone, 'gold');
  assert.equal(live.calloutDetail, `${(30 * NAVAL_STEP).toFixed(1)} s`);

  const expired = navalHudState(input({
    state: { tick: 50, yaw: 0, vx: 0, vz: 0 },
    activity: { boostUntil: 50, lastAttempt: -1, result: 'capture', resultUntil: 50 },
  }));
  assert.equal(expired.boostSeconds, 0);
  assert.equal(expired.boostFraction, 0);
  assert.equal(expired.boostActive, false);
  assert.equal(expired.resultText, '');
  assert.equal(expired.calloutText, '');
});

test('capture is disabled by pause, options, calm, or an attempt and ready only in an enabled window', () => {
  const window = { id: 7, phase: 'window', progress: 1, remaining: 0.5 };
  assert.equal(navalHudState(input({ gust: window })).captureReady, true);
  for (const overrides of [
    { paused: true, gust: window },
    { gusts: false, gust: window },
    { wind: { yaw: 0, strength: 0 }, gust: window },
    { activity: { boostUntil: 0, lastAttempt: 7, result: '', resultUntil: 0 }, gust: window },
  ]) {
    const hud = navalHudState(input(overrides));
    assert.equal(hud.captureDisabled, true);
    assert.equal(hud.captureReady, false);
  }
});

test('gust marks locate the approach, capture window, and perfect band on the progress track', () => {
  const hud = navalHudState(input());
  const span = N.windowStart + N.windowTicks - N.announcementTick;
  const mark = (tick) => (tick - N.announcementTick) / span;
  assert.equal(hud.gustMarks.approach, mark(N.windowStart));
  assert.equal(hud.gustMarks.windowStart, mark(N.windowStart));
  assert.equal(hud.gustMarks.windowEnd, 1);
  assert.equal(hud.gustMarks.perfectStart, mark(N.windowStart + N.windowTicks / 2 - N.perfectTicks));
  assert.equal(hud.gustMarks.perfectEnd, mark(N.windowStart + N.windowTicks / 2 + N.perfectTicks));
});

test('HUD leaves frozen simulation inputs unchanged and never invents load or cargo mass', () => {
  const source = input({
    state: Object.freeze({ tick: 12, yaw: 0, vx: 3, vz: 4 }),
    rig: Object.freeze({}), wind: Object.freeze({ yaw: 0, strength: 1 }),
    gust: Object.freeze({ id: 0, phase: 'approach', progress: 0.4, remaining: 4 }),
    activity: Object.freeze({ boostUntil: 0, lastAttempt: -1, result: 'early', resultUntil: 100 }),
    current: Object.freeze({ x: 0, z: 0, strength: 0 }), cargoCount: 3,
  });
  const before = structuredClone(source);
  const hud = navalHudState(source);
  assert.deepEqual(source, before);
  assert.equal(hud.speed, 5);
  assert.equal(hud.loadPercent, null);
  assert.equal(hud.cargoMass, null);
  assert.equal(hud.cargoCount, 3);
  assert.equal(hud.resultText, 'Demasiado pronto. Espera la siguiente.');
});

test('calm wind and weak current omit direction markers and show their honest labels', () => {
  const hud = navalHudState(input({ wind: { yaw: 0, strength: 0 }, current: { x: 0.1, z: 0, strength: 0.1 } }));
  assert.equal(hud.windDegrees, null);
  assert.equal(hud.currentDegrees, null);
  assert.equal(hud.gustText, 'Sin ráfagas');
  assert.equal(hud.flowText, 'Busca las flechas de agua');
});

test('an opposing current is labeled active without claiming it helps, with live result boost detail', () => {
  const hud = navalHudState(input({
    state: { tick: 100, yaw: 0, vx: 0, vz: 0 },
    activity: { boostUntil: 0, lastAttempt: -1, result: '', resultUntil: 0 },
    current: { x: 0, z: -2, strength: 2 },
  }));
  assert.equal(hud.currentDegrees, 180);
  assert.equal(hud.calloutText, 'CORRIENTE ACTIVA');
  assert.equal(hud.calloutTone, 'cyan');
  assert.equal(hud.calloutDetail, '2.0 u/s');

  const captured = navalHudState(input({
    state: { tick: 100, yaw: 0, vx: 0, vz: 0 },
    activity: { boostUntil: 130, lastAttempt: -1, result: 'capture', resultUntil: 120 },
    current: { x: 0, z: -2, strength: 2 },
  }));
  assert.equal(captured.calloutText, '¡RÁFAGA CAZADA!');
  assert.equal(captured.calloutDetail, `${(30 * NAVAL_STEP).toFixed(1)} s`);
});
