import test from 'node:test';
import assert from 'node:assert/strict';
import { planAttributeChange } from '../src/sim/systems/attributePlan.js';
import { newProfile, sanitizeProfile, syncProfile } from '../src/sim/systems/inventory.js';
import { packLimitsForProfile } from '../src/sim/economy/carry.js';
import { workshopPanelView } from '../src/ui/workshop.js';
import { workshopProfileDelta } from '../server/workshopOperation.mjs';
import { ECS } from '../src/sim/ecs.js';

const adopt = p => ({ type: 'attributes', op: 'adopt', opId: `adopt-${p.eco.tradeRev}`, expectedRev: p.eco.tradeRev });
const legacy = () => {
  const p = newProfile({ starter: false });
  p.eco.pack.goods = { madera: 2 };
  return p;
};

test('explicit adoption works at level one and preserves goods and unrelated fields', () => {
  const p = newProfile(); p.custom = { keep: true };
  const before = structuredClone(p);
  const result = planAttributeChange(p, adopt(p));
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile.attr, { v: 1, carga: 0, re: 0 });
  assert.deepEqual(result.profile.carry, before.carry);
  assert.equal(result.profile.eco.pack.cap, 18);
  assert.equal(result.profile.eco.pack.maxMass, 50);
  assert.deepEqual(result.profile.eco.pack.goods, before.eco.pack.goods);
  assert.deepEqual(result.profile.custom, before.custom);
  assert.equal(result.profile.eco.tradeRev, before.eco.tradeRev + 1);
  assert.deepEqual(p, before);
});

test('explicit adoption accepts only the exact legacy pack and adds the basic carry tier', () => {
  const p = legacy();
  const beforeGoods = structuredClone(p.eco.pack.goods);
  const result = planAttributeChange(p, adopt(p));
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile.carry, { v: 1, backpack: 0 });
  assert.deepEqual(result.profile.attr, { v: 1, carga: 0, re: 0 });
  assert.deepEqual(result.profile.eco.pack, { cap: 18, goods: beforeGoods, maxMass: 50 });
  assert.equal(Object.hasOwn(p, 'carry'), false);
  assert.deepEqual(p.eco.pack, { cap: 10, goods: beforeGoods });
  for (const malformed of [
    { cap: 10, maxMass: 20, goods: {} },
    { cap: 11, goods: {} },
    { cap: 10, goods: {}, extra: true },
  ]) {
    const bad = legacy(); bad.eco.pack = malformed;
    assert.notEqual(planAttributeChange(bad, adopt(bad)).ok, true);
  }
});

test('adoption denials never mutate or silently adopt and enforce target capacity', () => {
  const already = newProfile(); already.attr = { v: 1, carga: 0, re: 0 };
  assert.equal(planAttributeChange(already, adopt(already)).why, 'adopted');
  const legacyPack = legacy(), before = structuredClone(legacyPack);
  const denied = planAttributeChange(legacyPack, { ...adopt(legacyPack), expectedRev: 2 });
  assert.equal(denied.why, 'conflict'); assert.deepEqual(legacyPack, before);
  assert.equal(planAttributeChange(legacyPack, { ...adopt(legacyPack), extra: 1 }).why, 'command');
  const heavy = newProfile(); heavy.carry.backpack = 2; heavy.eco.pack.cap = 42; heavy.eco.pack.goods = { hierro: 9 };
  assert.equal(planAttributeChange(heavy, adopt(heavy)).why, 'heavy');
  assert.equal(Object.hasOwn(heavy, 'attr'), false);
  const reset = planAttributeChange(newProfile(), { ...adopt(newProfile()), op: 'reset' });
  assert.equal(reset.why, 'empty');
});

test('attribute sanitizer retains only valid own fields, observes point budget, and preserves legacy DTO shape', () => {
  const legacyProfile = legacy(), savedLegacy = sanitizeProfile(legacyProfile);
  assert.ok(savedLegacy); assert.equal(Object.hasOwn(savedLegacy, 'attr'), false);
  assert.deepEqual(savedLegacy.eco.pack, legacyProfile.eco.pack);
  const adopted = planAttributeChange(legacyProfile, adopt(legacyProfile)).profile;
  assert.deepEqual(sanitizeProfile(adopted), adopted);
  const badVersion = structuredClone(adopted); badVersion.attr.v = 2;
  assert.equal(sanitizeProfile(badVersion), null);
  const overBudget = structuredClone(adopted); overBudget.attr.carga = 1;
  assert.equal(sanitizeProfile(overBudget), null);
  const inherited = Object.create({ attr: { v: 1, carga: 0, re: 0 } });
  Object.assign(inherited, newProfile());
  assert.equal(sanitizeProfile(inherited), null);
  let getterRuns = 0;
  const accessor = newProfile();
  Object.defineProperty(accessor, 'attr', { enumerable: true, get() { getterRuns++; return { v: 1, carga: 0, re: 0 }; } });
  assert.equal(sanitizeProfile(accessor), null); assert.equal(getterRuns, 0);
});

test('profile carry limits, sync, and workshop backpack upgrades preserve adopted max mass', () => {
  const p = newProfile(); p.lvl = 3; p.attr = { v: 1, carga: 2, re: 0 };
  p.eco.pack.maxMass = 60;
  assert.deepEqual(packLimitsForProfile(p), { volume: 18, maxMass: 60 });
  assert.equal(sanitizeProfile(p).eco.pack.maxMass, 60);
  const world = { profiles: new Map([[1, p]]), ecs: new ECS(2),
    map: { checkpoints: {} } };
  world.ecs.alive[1] = 1; world.ecs.level[1] = 3; world.ecs.xp[1] = 0; world.ecs.potions[1] = 0;
  syncProfile(world, 1);
  assert.equal(p.eco.pack.maxMass, 60);
  p.eco.pack.goods = { madera: 2, lona: 3 };
  const view = workshopPanelView(p);
  assert.equal(view.carry.maxMass, 60);
  const command = { type: 'artisan', op: 'upgradePack', opId: 'upgrade-attr', expectedRev: p.eco.tradeRev };
  const delta = workshopProfileDelta(p, command);
  assert.equal(delta.why, ''); assert.equal(delta.profile.eco.pack.maxMass, 60);
  assert.equal(delta.carry.maxMass, 60);
});
