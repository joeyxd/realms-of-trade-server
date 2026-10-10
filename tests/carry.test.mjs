import test from 'node:test';
import assert from 'node:assert/strict';
import { carryLimits, nextBackpack, readCarry } from '../src/data/carry.js';
import { holdMass, holdUsed, load, newHold, roomFor, sanitizeHold } from '../src/sim/economy/cargo.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { newEco } from '../src/sim/systems/trade.js';

test('new pack carries four timber units or six logs within volume and mass limits', () => {
  const profile = newProfile();
  assert.deepEqual(profile.carry, { v: 1, backpack: 0 });
  assert.equal(profile.eco.pack.cap, 18);
  assert.equal(profile.eco.pack.maxMass, 18);

  const timber = sanitizeHold({ goods: { madera: 4 } }, profile.eco.pack.cap, profile.eco.pack.maxMass);
  assert.deepEqual(timber.goods, { madera: 4 });
  assert.equal(holdUsed(timber), 12);
  assert.equal(holdMass(timber), 12);
  const logs = sanitizeHold({ goods: { tronco: 6 } }, profile.eco.pack.cap, profile.eco.pack.maxMass);
  assert.deepEqual(logs.goods, { tronco: 6 });
  assert.equal(holdUsed(logs), 18);
  assert.equal(holdMass(logs), 18);
});

test('mass can stop a dense item before volume, and strength raises only mass capacity', () => {
  const profile = newProfile();
  const pack = newHold(profile.eco.pack.cap, profile.eco.pack.maxMass);
  assert.equal(load(pack, 'piedra', 4), true);
  assert.equal(roomFor(pack, 'piedra'), 0, '18 mass leaves room for no fifth 4-mass stone');
  assert.equal(holdUsed(pack), 8, 'volume remains available');
  assert.equal(load(pack, 'piedra', 1), false);

  const stronger = carryLimits(profile.carry, 3);
  assert.equal(stronger.strength, 12);
  assert.equal(stronger.maxMass, 22);
  assert.equal(stronger.volume, 18);
  assert.equal(load(newHold(stronger.volume, stronger.maxMass), 'piedra', 5), true);
});

test('backpack tiers increase volume without changing strength-based mass', () => {
  const upgraded = nextBackpack({ v: 1, backpack: 0 });
  assert.deepEqual(upgraded, { v: 1, backpack: 1 });
  assert.deepEqual(carryLimits(upgraded, 1), { volume: 30, strength: 10, maxMass: 18 });
  assert.deepEqual(carryLimits(nextBackpack(upgraded), 1), { volume: 42, strength: 10, maxMass: 18 });
  assert.equal(nextBackpack({ v: 1, backpack: 2 }), null);
});

test('legacy profiles retain the old cap and canonical pack shape without losing valid cargo', () => {
  assert.deepEqual(newEco().pack, { cap: 10, goods: {} }, 'generic and legacy eco fixtures keep the old default');
  const profile = newProfile();
  delete profile.carry;
  profile.eco.pack = { cap: 10, goods: { madera: 1, piedra: 2 } };
  const restored = sanitizeProfile(profile);
  assert.ok(restored);
  assert.equal(Object.hasOwn(restored, 'carry'), false);
  assert.deepEqual(restored.eco.pack, { cap: 10, goods: { madera: 1, piedra: 2 } });
});

test('carry metadata reader rejects corrupt, future, accessor, and inherited forms', () => {
  assert.equal(readCarry({ v: 2, backpack: 0 }), null);
  assert.equal(readCarry({ v: 1, backpack: 3 }), null);
  assert.equal(readCarry({ v: 1, backpack: 0, extra: true }), null);
  const accessor = {};
  Object.defineProperty(accessor, 'v', { enumerable: true, get() { throw new Error('must not run'); } });
  Object.defineProperty(accessor, 'backpack', { enumerable: true, value: 0 });
  assert.equal(readCarry(accessor), null);

  const profile = newProfile();
  Object.defineProperty(profile, 'carry', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.equal(sanitizeProfile(profile), null);
  const inherited = Object.create({ carry: { v: 1, backpack: 0 } });
  Object.assign(inherited, newProfile());
  delete inherited.carry;
  assert.equal(sanitizeProfile(inherited), null);
});
