import test from 'node:test';
import assert from 'node:assert/strict';
import { MEAL_TICKS, MEALS, mealEffects, mealIndex, readMeal, readMealField } from '../src/data/meals.js';
import { World } from '../src/sim/world.js';
import { attachProfile, installInventory, newProfile, sanitizeProfile, syncProfile } from '../src/sim/systems/inventory.js';
import { applyNeedsProfile, respawnNeeds, stepMeal } from '../src/sim/systems/survival.js';
import { stepPlayerCombat } from '../src/sim/systems/combat.js';
import { packComfort, packLoadTier } from '../src/sim/economy/carry.js';
import { PLAYER_FIELDS } from '../src/sim/ecs.js';
import { GAME } from '../src/data/meta.js';
import { map as island } from './helpers.mjs';

const activeMeal = (kind = 'roastFish', ticks = MEAL_TICKS) => ({ v: 1, kind, ticks });

function fixture() {
  const world = new World(51, { server: true });
  world.survivalEnabled = true;
  installInventory(world, 'meals-core-test');
  const entity = world.spawnPlayer({});
  const profile = newProfile();
  attachProfile(world, entity, profile);
  return { world, entity, profile };
}

test('meal field is optional, strict, and preserves a valid active meal through profile sanitization', () => {
  assert.deepEqual(readMealField({}), { present: false, value: null });
  assert.deepEqual(readMealField({ meal: activeMeal('grog', 17) }),
    { present: true, value: activeMeal('grog', 17) });
  for (const malformed of [
    { ...activeMeal(), extra: true }, { ...activeMeal(), v: 2 }, { ...activeMeal(), kind: 'unknown' },
    { ...activeMeal(), ticks: 0 }, { ...activeMeal(), ticks: MEAL_TICKS + 1 },
    Object.create(activeMeal()),
  ]) assert.equal(readMeal(malformed), null);
  let invoked = false;
  const accessor = {};
  Object.defineProperty(accessor, 'v', { enumerable: true, get() { invoked = true; return 1; } });
  accessor.kind = 'roastFish'; accessor.ticks = 1;
  assert.equal(readMeal(accessor), null); assert.equal(invoked, false);
  const inherited = Object.create({ meal: activeMeal() });
  assert.deepEqual(readMealField(inherited), { present: true, value: null });
  const p = { ...newProfile(), meal: activeMeal('heartyBiscuit', 300) };
  assert.deepEqual(sanitizeProfile(p).meal, p.meal);
  assert.equal(sanitizeProfile({ ...newProfile(), meal: { ...activeMeal(), extra: 1 } }), null);
  assert.equal(readMeal({ v: 1, kind: 'roastFish', ticks: NaN }), null);
  assert.equal(readMeal({ v: 1, kind: 'roastFish', ticks: 1.5 }), null);
  let profileGetterCalled = false;
  const withMealGetter = newProfile();
  Object.defineProperty(withMealGetter, 'meal', { enumerable: true, get() { profileGetterCalled = true; return activeMeal(); } });
  assert.equal(sanitizeProfile(withMealGetter), null);
  assert.equal(profileGetterCalled, false);
});

test('meal duration restores on reconnect, pauses while disabled, counts connected ticks, and persists each second', () => {
  const { world, entity, profile } = fixture();
  const connected = { ...profile, meal: activeMeal('grog', 125) };
  assert.equal(applyNeedsProfile(world, entity, connected), true);
  assert.deepEqual([world.ecs.mealKind[entity], world.ecs.mealTicks[entity]], [2, 125]);
  world.profileDirty.clear();
  stepMeal(world, entity, 1 / 60);
  assert.equal(world.ecs.mealTicks[entity], 124);
  assert.equal(world.profileDirty.has(entity), false);
  for (let i = 0; i < 59; i++) stepMeal(world, entity, 1 / 60);
  assert.equal(world.ecs.mealTicks[entity], 65);
  assert.equal(world.profileDirty.has(entity), true);
  assert.equal(syncProfile(world, entity).meal.ticks, 65);
  world.survivalEnabled = false;
  stepMeal(world, entity, 30);
  assert.equal(world.ecs.mealTicks[entity], 65, 'disabled/offline worlds do not advance meal time');
});

test('meal modifiers affect max HP without healing and expiry clamps HP back to the unbuffed maximum', () => {
  const { world, entity, profile } = fixture();
  const ecs = world.ecs;
  ecs.hp[entity] = 50;
  assert.equal(applyNeedsProfile(world, entity, { ...profile, meal: activeMeal('roastFish', 60) }), true);
  assert.equal(ecs.maxHp[entity], 110);
  assert.equal(ecs.hp[entity], 50, 'activating a max-HP buff does not heal');
  assert.equal(applyNeedsProfile(world, entity, { ...profile, meal: activeMeal('roastFish', 1) }), true);
  ecs.hp[entity] = 105;
  stepMeal(world, entity, 1 / 60);
  assert.equal(ecs.mealKind[entity], 0);
  assert.equal(ecs.maxHp[entity], 100);
  assert.equal(ecs.hp[entity], 100, 'expiring a max-HP bonus clamps current HP');
});

test('respawn clears meal state and persisted buff while the ordinary needs reset remains intact', () => {
  const { world, entity, profile } = fixture();
  applyNeedsProfile(world, entity, { ...profile, surv: { v: 1, sat: 10, hyd: 10 }, meal: activeMeal('roastFish', 700) });
  assert.equal(respawnNeeds(world, entity), true);
  assert.equal(world.ecs.mealKind[entity], 0); assert.equal(world.ecs.mealTicks[entity], 0);
  assert.equal(world.ecs.sat[entity], 50); assert.equal(world.ecs.hyd[entity], 50);
  const saved = syncProfile(world, entity);
  assert.equal(Object.hasOwn(saved, 'meal'), false);
});

test('meal effects and comfort default to the active saved meal without changing carry ceilings', () => {
  assert.deepEqual(mealEffects(0, MEAL_TICKS), { hp: 1, regen: 1, comfort: 0 });
  assert.equal(mealIndex('grog'), 2); assert.equal(mealIndex('bad'), 0);
  assert.equal(mealEffects(2, 60).regen, 1.25);
  assert.equal(mealEffects(3, 60).comfort, 10);
  assert.equal(MEALS.roastFish.hp, 1.1);
  const p = newProfile(); p.carry = { v: 1, backpack: 2 }; p.attr = { v: 1, carga: 0, re: 0 };
  p.eco.pack.cap = 42; p.eco.pack.maxMass = 50; p.eco.pack.goods = { hierro: 8 };
  assert.equal(packComfort(p), 40); assert.equal(packLoadTier(p), 1);
  p.meal = activeMeal('heartyBiscuit', 5);
  assert.equal(packComfort(p), 50); assert.equal(packLoadTier(p), 0, 'the bonus changes comfort without changing the ceiling');
  assert.equal(packComfort(p, 0), 40, 'an explicit caller bonus still overrides the profile default');
  p.meal.ticks = 0;
  assert.equal(packComfort(p), 40, 'expired meals have no comfort bonus');
});

test('authority snapshots and prediction stay bit-identical through hearty-biscuit expiry and load tier change', () => {
  assert.ok(PLAYER_FIELDS.includes('mealKind') && PLAYER_FIELDS.includes('mealTicks'));
  const profile = newProfile();
  profile.carry = { v: 1, backpack: 2 }; profile.attr = { v: 1, carga: 0, re: 0 };
  profile.eco.pack.cap = 42; profile.eco.pack.maxMass = 50; profile.eco.pack.goods = { hierro: 8 };
  profile.meal = activeMeal('heartyBiscuit', 4);
  const authority = new World(GAME.seed, { map: island, server: true });
  const prediction = new World(GAME.seed, { map: island, server: false });
  authority.survivalEnabled = prediction.survivalEnabled = true;
  installInventory(authority, 'meal-snapshot'); installInventory(prediction, 'meal-snapshot');
  const e = authority.spawnPlayer({ x: -20, z: -20 }), predicted = prediction.spawnPlayer({ x: -20, z: -20 });
  attachProfile(authority, e, structuredClone(profile));
  attachProfile(prediction, predicted, structuredClone(profile));
  authority.applyCommand(e, { seq: 0, pt: 0, ax: -20, az: -20, mx: 0, mz: 0, btn: 0, prs: 0 });
  prediction.setPlayerState(predicted, authority.playerState(e));
  assert.equal(authority.ecs.load[e], 0, 'hearty meal moves 48 mass into the 50 mass comfort band');
  const goodsBefore = structuredClone(authority.profiles.get(e).eco.pack.goods);
  for (let seq = 1; seq <= 5; seq++) {
    authority.tick = prediction.tick = seq;
    const command = { seq, pt: seq, ax: -20, az: -20, mx: 0, mz: 0, btn: 0, prs: 0 };
    authority.applyCommand(e, command); prediction.applyCommand(predicted, command);
    const state = authority.playerState(e), predictedState = prediction.playerState(predicted);
    for (let i = 0; i < PLAYER_FIELDS.length; i++)
      assert.equal(predictedState[i], state[i], `${PLAYER_FIELDS[i]} prediction at command ${seq}`);
    if (seq === 2 || seq === 4) prediction.setPlayerState(predicted, state);
    if (seq < 3) assert.equal(authority.ecs.load[e], 0, `meal comfort remains active at command ${seq}`);
    if (seq === 3) assert.equal(authority.ecs.load[e], 1, 'expiry returns the pack to its ordinary comfort tier');
  }
  assert.deepEqual(authority.profiles.get(e).eco.pack.goods, goodsBefore, 'expiry does not remove any carried goods');
  assert.equal(authority.ecs.mealKind[e], 0); assert.equal(authority.ecs.mealTicks[e], 0);
  assert.equal(Object.hasOwn(authority.profiles.get(e), 'meal'), false, 'expired meal is removed from the durable profile');
});

test('guard regeneration applies grog after hunger and remains zero at empty needs', () => {
  const guardGain = ({ sat = 100, hyd = 100, meal = null } = {}) => {
    const { world, entity, profile } = fixture();
    const saved = { ...profile, surv: { v: 1, sat, hyd }, ...(meal ? { meal } : {}) };
    assert.equal(applyNeedsProfile(world, entity, saved), true);
    const ecs = world.ecs;
    ecs.guardRegT[entity] = 1;
    ecs.guardSt[entity] = 0;
    stepPlayerCombat(world, entity, { seq: 1, pt: 1, ax: 0, az: 0, mx: 0, mz: 0, btn: 0, prs: 0, w: 0 }, 1 / 60);
    return ecs.guardSt[entity];
  };
  const baseline = guardGain();
  const grog = guardGain({ meal: activeMeal('grog', 600) });
  const grogAtThirty = guardGain({ sat: 30, hyd: 30, meal: activeMeal('grog', 600) });
  const grogAtZero = guardGain({ sat: 0, hyd: 0, meal: activeMeal('grog', 600) });
  assert.ok(grog > baseline, `grog ${grog} should exceed baseline ${baseline}`);
  assert.ok(Math.abs(grog / baseline - 1.25) < 1e-9, 'grog applies its 1.25 regen multiplier');
  assert.ok(Math.abs(grogAtThirty / baseline - 1.25) < 1e-9, '30 needs retains normal recovery before the meal bonus');
  assert.equal(grogAtZero, 0, 'the meal does not restore stamina recovery when needs are empty');
});

test('replacing roast fish with grog uses one bonus, preserves HP, and clamps to the new maximum', () => {
  const { world, entity, profile } = fixture();
  const ecs = world.ecs;
  assert.equal(applyNeedsProfile(world, entity, { ...profile, meal: activeMeal('roastFish', 900) }), true);
  assert.equal(ecs.maxHp[entity], 110);
  ecs.hp[entity] = 80;
  assert.equal(applyNeedsProfile(world, entity, { ...profile, meal: activeMeal('grog', 900) }), true);
  assert.equal(ecs.mealKind[entity], 2); assert.equal(ecs.mealTicks[entity], 900);
  assert.equal(ecs.maxHp[entity], 100, 'replacement uses the new meal only, without stacking old HP bonus');
  assert.equal(ecs.hp[entity], 80, 'replacement preserves current HP below the new maximum');

  const clampFixture = fixture(), cecs = clampFixture.world.ecs;
  applyNeedsProfile(clampFixture.world, clampFixture.entity,
    { ...clampFixture.profile, meal: activeMeal('roastFish', 900) });
  cecs.hp[clampFixture.entity] = 105;
  applyNeedsProfile(clampFixture.world, clampFixture.entity,
    { ...clampFixture.profile, meal: activeMeal('grog', 900) });
  assert.equal(cecs.hp[clampFixture.entity], 100, 'replacement clamps HP above the new maximum');
});
