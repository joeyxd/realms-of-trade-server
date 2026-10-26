// INV02 overload (PLAN-PROGRESSION §15.7.4): with Carga adopted, a pack above its comfortable load walks slower without
// dash; a pack without Carga keeps its level ceiling as a plain limit and never slows down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { PLAYER_FIELDS } from '../src/sim/ecs.js';
import { BTN } from '../src/sim/systems/movement.js';
import { comfortMass, loadTier } from '../src/data/carry.js';
import { packComfort, packLoadTier } from '../src/sim/economy/carry.js';
import { arena } from './helpers.mjs';

// Level 1, Carga adopted with no points: comfortable 40, ceiling 50 (hierro weighs 6).
const adopted = (goods) => {
  const p = newProfile(); p.carry = { v: 1, backpack: 2 }; p.attr = { v: 1, carga: 0, re: 0 };
  p.eco.pack.cap = 42; p.eco.pack.maxMass = 50; p.eco.pack.goods = goods; return p;
};

test('the comfortable load is 80 % of the ceiling only with Carga adopted', () => {
  assert.equal(comfortMass(50, true), 40);
  assert.equal(comfortMass(50, true, 10), 50, 'a meal bonus adds comfort');
  assert.equal(comfortMass(18, false), 18, 'without Carga the ceiling is the comfortable load');
  assert.equal(loadTier(40, 50, 40), 0); assert.equal(loadTier(41, 50, 40), 1);
  assert.equal(loadTier(50, 50, 40), 1); assert.equal(loadTier(51, 50, 40), 2);
  assert.equal(loadTier(999, undefined), 0, 'a pack without a weight limit is never heavy');
  assert.equal(packComfort(adopted({})), 40);
  assert.equal(packLoadTier(adopted({ hierro: 8 })), 1);
  assert.equal(packLoadTier(adopted({ hierro: 8 }), 10), 0, 'galleta reforzada: 48 of 50 comfortable');
  const legacy = newProfile(); legacy.eco.pack.goods = { hierro: 3 }; // 18 of the level-1 ceiling 18
  assert.equal(legacy.eco.pack.maxMass, 18);
  assert.equal(packComfort(legacy), 18); assert.equal(packLoadTier(legacy), 0);
  const unlimited = newProfile({ starter: false }); unlimited.eco.pack.goods = { hierro: 1 };
  assert.equal(packComfort(unlimited), null); assert.equal(packLoadTier(unlimited), 0);
});

test('a heavy pack walks at 70 % without dash; above the ceiling at 40 %; the client predicts the server tier', () => {
  assert.ok(PLAYER_FIELDS.includes('load'), 'the tier travels with the predicted player state');
  const run = (profile, dash = false) => {
    const { w, e, step } = arena();
    if (!w.profiles) w.profiles = new Map();
    w.profiles.set(e, profile);
    const x0 = w.ecs.x[e], z0 = w.ecs.z[e], dashes = w.ecs.dashCount[e];
    for (let i = 0; i < 40; i++) step({ mx: 0, mz: 1, prs: dash && i === 5 ? BTN.DASH : 0 });
    return { load: w.ecs.load[e], moved: Math.hypot(w.ecs.x[e] - x0, w.ecs.z[e] - z0), dashed: w.ecs.dashCount[e] - dashes };
  };
  const light = run(adopted({ hierro: 6 })), heavy = run(adopted({ hierro: 8 })), over = run(adopted({ hierro: 10 }));
  assert.equal(light.load, 0); assert.equal(heavy.load, 1); assert.equal(over.load, 2);
  assert.ok(Math.abs(heavy.moved / light.moved - 0.7) < 0.08, `heavy ${heavy.moved} vs light ${light.moved}`);
  assert.ok(Math.abs(over.moved / light.moved - 0.4) < 0.08, `over ${over.moved} vs light ${light.moved}`);
  assert.equal(run(adopted({ hierro: 6 }), true).dashed, 1);
  assert.equal(run(adopted({ hierro: 8 }), true).dashed, 0, 'no dash while heavy');
  const full = newProfile(); full.eco.pack.goods = { hierro: 3 }; // without Carga: at its ceiling, full speed and dash
  const legacy = run(full, true);
  assert.equal(legacy.load, 0); assert.equal(legacy.dashed, 1);
});

test('an unadopted legacy pack above its ceiling keeps its goods, normal walking and dash', () => {
  for (const withCarry of [false, true]) {
    const profile = newProfile();
    if (withCarry) profile.carry = { v: 1, backpack: 0 };
    profile.eco.pack.goods = { hierro: 4 };
    assert.equal(packComfort(profile), 18);
    assert.equal(packLoadTier(profile), 0, 'legacy limits must not silently activate Carga penalties');
    const before = structuredClone(profile), { w, e, step } = arena();
    w.profiles = new Map([[e, profile]]);
    const start = w.ecs.z[e];
    for (let i = 0; i < 20; i++) step({ mz: 1 });
    assert.equal(w.ecs.load[e], 0);
    assert.equal(w.ecs.vz[e], w.ecs.speed[e]);
    assert.ok(w.ecs.z[e] > start, 'legacy cargo never immobilizes the character');
    step({ mz: 1, prs: BTN.DASH });
    assert.equal(w.ecs.dashCount[e], 1);
    assert.deepEqual(profile, before, 'movement must not adopt Carga or discard legacy cargo');
  }
});
