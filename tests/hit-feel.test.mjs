// CMB hit feel and the ultimate's drama (docs/research/melee/11-ultimate-feel.md): Ultimate's hitlag shake tables on the
// victim and the attacker, and the rumble patterns. View and controller only; no sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAKE, startLaunch, stepLaunch, startAtkShake, stepAtkShake } from '../src/render/launchPose.js';
import { hitRumble, patternRumble, rumble } from '../src/ui/rumble.js';
import { LAWLESS } from '../src/data/lawless.js';
import { tuning } from '../src/data/tuning.js';

const DT = 1 / 60, U = LAWLESS.meleeUnit, near = (a, b) => Math.abs(a - b) < 1e-9;

test('the victim shakes along the blow by Ultimate damage table (2, 0, -2 units at 2 entries a frame) through its hitlag', () => {
  assert.deepEqual(SHAKE.damage.x, [2, 0, -2]);
  const hl = 8, L = startLaunch({ kb: 40, hl, la: 0 }), o = {}, seen = [];
  for (let f = 0; f < hl - 1; f++) { stepLaunch(L, DT, o); seen.push(o.ox / U); }
  // step f plays entry floor((f + 1) * 2) % 3 (L.t is already one frame on when the first step returns)
  const want = seen.map((_, f) => SHAKE.damage.x[Math.floor((f + 1) * 2) % 3]);
  seen.forEach((v, f) => assert.ok(near(v, want[f]), `frame ${f}: ${v} vs ${want[f]}`));
  assert.ok(seen.some((v) => v > 1.9) && seen.some((v) => v < -1.9), 'it swings the full 2 units both ways');
});

test('a lightning blow (elem 3) plays damage_elec: a jolt up of 5 units', () => {
  const L = startLaunch({ kb: 40, hl: 10, la: 0, elem: 3 }), o = {};
  let top = 0;
  for (let f = 0; f < 9; f++) { stepLaunch(L, DT, o); top = Math.max(top, o.lift); }
  assert.ok(near(top, 5 * U));
});

test('the attacker shakes 1 unit along its facing, two frames each way, for exactly its hitlag', () => {
  assert.equal(startAtkShake(0), null);
  const A = startAtkShake(6), seen = [];
  for (;;) { const s = stepAtkShake(A, DT); if (s === null) break; seen.push(Math.round(s / U)); }
  assert.deepEqual(seen, [1, -1, -1, 1, 1]);
});

test('a hit rumbles longer the bigger the blow, the victim longer and harder than the attacker', () => {
  const v5 = hitRumble(5, 'victim'), v12 = hitRumble(12, 'victim'), a5 = hitRumble(5, 'attacker');
  const R = tuning.feel.rumble;
  assert.equal(v5.ms, Math.round((R.victim.base + R.victim.perHl * 5) * 1000 / 60));
  assert.ok(v12.ms > v5.ms && v5.ms > a5.ms && v5.strong > a5.strong);
  assert.equal(patternRumble('explosion').ms, 500);
  assert.equal(patternRumble('nope'), null);
});

test('rumble drives every connected pad as dual-rumble, and the Vibración switch silences it', () => {
  const calls = [], pad = { connected: true, vibrationActuator: { playEffect: (kind, o) => { calls.push([kind, o]); return Promise.resolve(); } } };
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [null, pad] }, configurable: true });
  try {
    rumble({ haptics: false }, hitRumble(6, 'victim'));
    assert.equal(calls.length, 0);
    rumble({ haptics: true }, patternRumble('explosion'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'dual-rumble');
    assert.deepEqual(calls[0][1], { startDelay: 0, duration: 500, strongMagnitude: 1, weakMagnitude: 1 });
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real); else delete globalThis.navigator;
  }
});
