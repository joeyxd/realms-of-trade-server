import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPistolRecoil, kickPistolRecoil, stepPistolRecoil, PISTOL_RECOIL,
} from '../src/render/pistolRecoil.js';

test('quick and powerful shots produce distinct normalized recoil profiles', () => {
  const quick = kickPistolRecoil(createPistolRecoil(), 1, false);
  const powerful = kickPistolRecoil(createPistolRecoil(), -1, true);
  assert.equal(quick.recoilL, 1);
  assert.equal(quick.recoilLAmp, 1);
  assert.equal(quick.recoilLDecay, 1 / PISTOL_RECOIL.quick.duration);
  assert.equal(powerful.recoilR, 1);
  assert.equal(powerful.recoilRAmp, 1.45);
  assert.equal(powerful.recoilRDecay, 1 / PISTOL_RECOIL.powerful.duration);
  assert.ok(powerful.recoilRAmp > quick.recoilLAmp);
  assert.ok(powerful.recoilRDecay < quick.recoilLDecay);
});

test('simultaneous hands decay independently and settle back to zero', () => {
  const both = kickPistolRecoil(kickPistolRecoil(createPistolRecoil(), 1), -1, true);
  const middle = stepPistolRecoil(both, 0.2);
  assert.equal(middle.recoilL, 0, 'quick recoil has already settled');
  assert.ok(middle.recoilR > 0 && middle.recoilR < 1, 'powerful recoil is still decaying');
  assert.equal(middle.recoilRAmp, 1.45);
  assert.equal(middle.recoilLAmp, 1);

  const settled = stepPistolRecoil(middle, 1);
  assert.equal(settled.recoilL, 0);
  assert.equal(settled.recoilR, 0);
  assert.equal(settled.recoilRAmp, 1);
});

test('a new shot resets only its hand while preserving the other hand', () => {
  const both = kickPistolRecoil(kickPistolRecoil(createPistolRecoil(), 1), -1, true);
  const after = kickPistolRecoil(stepPistolRecoil(both, 0.1), 1);
  assert.equal(after.recoilL, 1);
  assert.equal(after.recoilLAmp, 1);
  assert.ok(after.recoilR < 1 && after.recoilR > 0);
  assert.equal(after.recoilRAmp, 1.45);
});

test('nonfinite and negative time or invalid fields cannot create nonfinite recoil', () => {
  const bad = { recoilL: Infinity, recoilR: NaN, recoilLAmp: Infinity, recoilRAmp: NaN,
    recoilLDecay: -1, recoilRDecay: Infinity };
  for (const dt of [NaN, Infinity, -Infinity, -1]) {
    const state = stepPistolRecoil(bad, dt);
    for (const key of ['recoilL', 'recoilR', 'recoilLAmp', 'recoilRAmp', 'recoilLDecay', 'recoilRDecay'])
      assert.ok(Number.isFinite(state[key]), `${key} remains finite`);
  }
  const ignored = kickPistolRecoil(createPistolRecoil(), NaN, true);
  assert.equal(ignored.recoilL, 0);
  assert.equal(ignored.recoilR, 0);
});
