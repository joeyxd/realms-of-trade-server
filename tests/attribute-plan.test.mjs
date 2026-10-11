import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTR, attrPoints, readAttrField } from '../src/data/attributes.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { holdMass, holdUsed } from '../src/sim/economy/cargo.js';
import { planAttributeChange } from '../src/sim/systems/attributePlan.js';

const command = (profile, op, extra = {}) => ({ type: 'attributes', op, opId: `attr-${op}`, expectedRev: profile.eco.tradeRev, ...extra });

function atLevel(level, { carga, re = 0, backpack = 0, goods = {} } = {}) {
  const p = newProfile();
  p.lvl = level;
  p.carry.backpack = backpack;
  p.eco.pack.cap = [18, 30, 42][backpack];
  p.eco.pack.goods = structuredClone(goods);
  p.eco.pack.maxMass = 18 + 2 * (level - 1);
  if (carga !== undefined) {
    p.attr = { v: 1, carga, re };
    p.eco.pack.maxMass = 50 + 5 * carga;
  }
  return p;
}

test('level-one legacy profile keeps attr absent when allocation has no earned point', () => {
  const profile = atLevel(1), before = structuredClone(profile);
  const points = attrPoints(profile);
  assert.deepEqual(points, { attr: { v: 1, carga: 0, re: 0 }, earned: 0, invested: 0, available: 0, resetsLeft: 1 });
  const result = planAttributeChange(profile, command(profile, 'assign', { stat: 'carga', n: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.why, 'points');
  assert.equal(readAttrField(profile).present, false);
  assert.deepEqual(profile, before);
  assert.equal(result.profile, profile);
});

test('assigning every earned point uses current level cap and preserves unrelated profile data', () => {
  const profile = atLevel(10, { goods: { piedra: 9 } });
  profile.flags.keep = 'unchanged';
  const before = structuredClone(profile);
  const result = planAttributeChange(profile, command(profile, 'assign', { stat: 'carga', n: ATTR.maxPoints }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.points, { earned: 9, invested: 9, available: 0, resetsLeft: 1 });
  assert.deepEqual(result.limits, { volume: 18, comfortableMass: 76, maxMass: 95 });
  assert.equal(result.profile.attr.carga, 9);
  assert.equal(result.profile.eco.pack.maxMass, 95);
  assert.equal(result.profile.eco.tradeRev, before.eco.tradeRev + 1);
  assert.deepEqual(result.profile.flags, before.flags);
  assert.equal(result.profile.eco.pack.cap, before.eco.pack.cap);
  assert.deepEqual(result.profile.eco.pack.goods, before.eco.pack.goods);
  assert.deepEqual(profile, before, 'planning never mutates its source');
  assert.equal(holdMass(result.profile.eco.pack), 36);
  assert.equal(holdUsed(result.profile.eco.pack), 18);
});

test('stale expectedRev conflicts and replanning an applied command is not a receipt replay', () => {
  const profile = atLevel(2);
  const request = command(profile, 'assign', { stat: 'carga', n: 1 });
  const first = planAttributeChange(profile, request);
  assert.equal(first.ok, true);
  const conflict = planAttributeChange(first.profile, request);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.why, 'conflict');
  assert.equal(conflict.profile, first.profile);
  assert.deepEqual(first.profile.eco.tradeRev, profile.eco.tradeRev + 1);
});

test('assignment may rescue an over-limit legacy load only when the new ceiling fits it', () => {
  const profile = atLevel(2, { goods: { piedra: 7 } });
  assert.equal(holdMass(profile.eco.pack), 28);
  assert.equal(profile.eco.pack.maxMass, 20);
  assert.equal(holdUsed(profile.eco.pack), 14);
  const result = planAttributeChange(profile, command(profile, 'assign', { stat: 'carga', n: 1 }));
  assert.equal(result.ok, true);
  assert.equal(result.profile.eco.pack.maxMass, 55);
  assert.deepEqual(result.profile.eco.pack.goods, { piedra: 7 });
});

test('reset at exact new ceiling is allowed and can happen only once', () => {
  const profile = atLevel(4, { carga: 2, backpack: 2, goods: { hierro: 8, lona: 1, tabaco: 2 } });
  assert.equal(holdMass(profile.eco.pack), 50);
  const reset = planAttributeChange(profile, command(profile, 'reset'));
  assert.equal(reset.ok, true);
  assert.deepEqual(reset.profile.attr, { v: 1, carga: 0, re: 1 });
  assert.deepEqual(reset.points, { earned: 3, invested: 0, available: 3, resetsLeft: 0 });
  assert.deepEqual(reset.limits, { volume: 42, comfortableMass: 40, maxMass: 50 });
  assert.equal(reset.profile.eco.pack.maxMass, 50);
  assert.deepEqual(reset.profile.eco.pack.goods, profile.eco.pack.goods);
  const second = planAttributeChange(reset.profile, command(reset.profile, 'assign', { stat: 'carga', n: 1 }));
  assert.equal(second.ok, true);
  const secondReset = planAttributeChange(second.profile, command(second.profile, 'reset'));
  assert.equal(secondReset.ok, false);
  assert.equal(secondReset.why, 'used');
});

test('reset is refused above 50 and exactly at the point where a lighter load becomes possible', () => {
  const over = atLevel(4, { carga: 2, backpack: 2, goods: { hierro: 8, lona: 2, tabaco: 1 } });
  assert.equal(holdMass(over.eco.pack), 50.5);
  const denied = planAttributeChange(over, command(over, 'reset'));
  assert.equal(denied.ok, false);
  assert.equal(denied.why, 'heavy');
  assert.deepEqual(over.eco.pack.goods, { hierro: 8, lona: 2, tabaco: 1 });

  const below = atLevel(4, { carga: 2, backpack: 2, goods: { hierro: 8, lona: 1, tabaco: 1 } });
  assert.equal(holdMass(below.eco.pack), 49.5);
  const accepted = planAttributeChange(below, command(below, 'reset'));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.profile.eco.pack.maxMass, 50);
});

test('invalid attrs are rejected without clamping or rewriting legacy/future state', () => {
  const overspent = atLevel(3, { carga: 3 });
  const tooMany = planAttributeChange(overspent, command(overspent, 'assign', { stat: 'carga', n: 1 }));
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.why, 'profile');
  assert.deepEqual(overspent.attr, { v: 1, carga: 3, re: 0 });

  const future = atLevel(3, { carga: 1 });
  future.attr.v = 2;
  const futureResult = planAttributeChange(future, command(future, 'assign', { stat: 'carga', n: 1 }));
  assert.equal(futureResult.ok, false);
  assert.equal(futureResult.why, 'profile');

  let getterRuns = 0;
  const accessor = atLevel(2);
  Object.defineProperty(accessor, 'attr', { enumerable: true, get() { getterRuns++; throw new Error('must not execute'); } });
  const accessorResult = planAttributeChange(accessor, command(accessor, 'assign', { stat: 'carga', n: 1 }));
  assert.equal(accessorResult.ok, false);
  assert.equal(accessorResult.why, 'profile');
  assert.equal(getterRuns, 0);
});

test('malformed command shapes, identifiers, and amounts are rejected', () => {
  const profile = atLevel(2);
  const valid = command(profile, 'assign', { stat: 'carga', n: 1 });
  for (const bad of [
    { ...valid, t: 'command' },
    { ...valid, unexpected: true },
    { ...valid, opId: '' },
    { ...valid, opId: 'contains spaces' },
    { ...valid, opId: 'colon:not-safe' },
    { ...valid, opId: 'x'.repeat(65) },
    { ...valid, n: 0 },
    { ...valid, n: 1.5 },
    { ...valid, n: 10 },
    { ...valid, stat: 'strength' },
    { ...valid, expectedRev: 2147483646 },
  ]) {
    const result = planAttributeChange(profile, bad);
    assert.equal(result.ok, false);
    assert.equal(result.why, 'command');
    assert.equal(result.profile, profile);
  }

  const getterCommand = { type: 'attributes', op: 'assign', opId: 'safe', expectedRev: profile.eco.tradeRev, stat: 'carga', n: 1 };
  Object.defineProperty(getterCommand, 'n', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.equal(planAttributeChange(profile, getterCommand).why, 'command');
});

test('point and receipt limits refuse changes without altering the profile', () => {
  const none = atLevel(2, { carga: 0 });
  const empty = planAttributeChange(none, command(none, 'reset'));
  assert.equal(empty.why, 'empty');

  const funded = atLevel(2);
  const points = planAttributeChange(funded, command(funded, 'assign', { stat: 'carga', n: 2 }));
  assert.equal(points.why, 'points');

  const revLimit = atLevel(2);
  revLimit.eco.tradeRev = 2147483646;
  const limit = planAttributeChange(revLimit, { type: 'attributes', op: 'assign', opId: 'at-limit',
    expectedRev: 2147483645, stat: 'carga', n: 1 });
  assert.equal(limit.why, 'limit', 'the current revision cannot be incremented');
  const matchingLimit = planAttributeChange(revLimit, { type: 'attributes', op: 'assign', opId: 'at-limit',
    expectedRev: 2147483646, stat: 'carga', n: 1 });
  assert.equal(matchingLimit.why, 'command');
});

test('non-JSON or accessor-bearing source profiles fail closed without invoking getters', () => {
  const profile = atLevel(2);
  let getterRuns = 0;
  Object.defineProperty(profile.flags, 'opaque', { enumerable: true, get() { getterRuns++; throw new Error('must not execute'); } });
  const result = planAttributeChange(profile, command(profile, 'assign', { stat: 'carga', n: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.why, 'profile');
  assert.equal(getterRuns, 0);
});

test('carry state and recorded capacity must match the canonical source profile', () => {
  const absent = atLevel(2);
  delete absent.carry;
  assert.equal(planAttributeChange(absent, command(absent, 'assign', { stat: 'carga', n: 1 })).why, 'carry');

  const wrongCap = atLevel(2);
  wrongCap.eco.pack.cap = 30;
  assert.equal(planAttributeChange(wrongCap, command(wrongCap, 'assign', { stat: 'carga', n: 1 })).why, 'carry');

  const wrongMass = atLevel(2);
  wrongMass.eco.pack.maxMass = 50;
  assert.equal(planAttributeChange(wrongMass, command(wrongMass, 'assign', { stat: 'carga', n: 1 })).why, 'carry');

  const overVolume = atLevel(2, { goods: { piedra: 10 } });
  assert.equal(planAttributeChange(overVolume, command(overVolume, 'assign', { stat: 'carga', n: 1 })).why, 'carry');
});
