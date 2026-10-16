import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { attachProfile, detachProfile, installInventory, newProfile, sanitizeProfile, syncProfile } from '../src/sim/systems/inventory.js';
import { captureDeathPlan } from '../server/deathPlan.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { Economy } from '../src/sim/economy/economy.js';
import { readProgression } from '../src/sim/systems/progression.js';
import { economicOperation, checkedEconomicReceipt } from '../server/economicOperation.mjs';
import { deathOperation, deathResult, checkedDeathReceipt } from '../server/deathOperation.mjs';
import { pearlOperation, pearlResult, checkedPearlReceipt } from '../server/pearlOperations.mjs';
import { map, A } from './helpers.mjs';

const progression = (logging = 0, milestones = [], knowledge = []) => ({
  v: 1, practice: { logging }, milestones, knowledge,
});

test('new profiles and signed saves preserve a detached progression value', () => {
  const p = newProfile();
  assert.deepEqual(p.progression, progression());
  p.progression = progression(60, ['logging_steady']);
  const saves = hmacSaves('progression-profile-test-key');
  const loaded = saves.load(saves.store(p));
  assert.deepEqual(loaded.progression, p.progression);
  assert.notEqual(loaded.progression, p.progression);
  assert.notEqual(loaded.progression.practice, p.progression.practice);
});

test('legacy profiles default missing progression without changing their source', () => {
  const raw = newProfile();
  delete raw.progression;
  raw.lvl = 7;
  const before = structuredClone(raw);
  const loaded = sanitizeProfile(raw);
  assert.ok(loaded);
  assert.equal(Object.hasOwn(loaded, 'progression'), false);
  assert.deepEqual(readProgression(loaded.progression), progression());
  assert.equal(loaded.lvl, 7);
  assert.deepEqual(raw, before);
});

test('legacy signed saves and M5 receipt readers preserve the absent progression field', () => {
  const account = '11111111-1111-4111-8111-111111111111';
  const legacy = newProfile(); delete legacy.progression; legacy.pirateId = `account:${account}`;
  const saves = hmacSaves('legacy-progression-profile-test-key');
  const loaded = saves.load(saves.store(legacy));
  assert.ok(loaded);
  assert.equal(Object.hasOwn(loaded, 'progression'), false);
  assert.equal(Object.hasOwn(saves.load(saves.store(loaded)), 'progression'), false);

  const opId = '11111111-1111-4111-8111-111111111112';
  const command = { type: 'commerce', op: 'buy', opId: 'legacy-buy', town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 };
  const worldData = { v: 1, seed: 91, economy: new Economy(91).serialize() };
  const ack = { type: 'commerce', op: 'buy', opId: 'legacy-buy', ok: true, why: '', rev: 1 };
  const economic = economicOperation({ operationId: opId, request: { world: 'legacy-world', account, command,
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: loaded, worldData, ack } });
  const economicReceipt = checkedEconomicReceipt({ request: economic.request,
    result: { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack } }, opId);
  assert.equal(Object.hasOwn(economicReceipt.request.profile, 'progression'), false);

  const deathId = '11111111-1111-4111-8111-111111111113';
  const afterDeath = structuredClone(loaded); afterDeath.stats.deaths++;
  const death = deathOperation({ operationId: deathId, world: 'legacy-world', victim: account, killer: null,
    rules: { lawless: false, xpBefore: loaded.xp, xpLossFraction: 0.1 },
    profiles: [{ id: account, expectedVersion: 1, before: loaded, data: afterDeath }], pearls: [], drops: [] });
  const deathReceipt = checkedDeathReceipt({ request: death.request,
    result: deathResult(death.request, deathId) }, deathId);
  assert.equal(Object.hasOwn(deathReceipt.request.profiles[0].before, 'progression'), false);
  assert.equal(Object.hasOwn(deathReceipt.request.profiles[0].data, 'progression'), false);

  const pearlId = '11111111-1111-4111-8111-111111111114';
  const pearl = pearlOperation({ operationId: pearlId, uid: 'legacy-pearl', kind: 'brasa', from: null, to: account,
    expectedVersion: 0, profiles: [{ id: account, expectedVersion: 1, data: loaded }] });
  const pearlReceipt = checkedPearlReceipt({ request: pearl.request, result: pearlResult(pearl.request) }, pearlId);
  assert.equal(Object.hasOwn(pearlReceipt.request.profiles[0].data, 'progression'), false);
});

test('present malformed or future progression rejects the profile', () => {
  const invalid = [
    null,
    undefined,
    { ...progression(), v: 3 },
    { ...progression(), extra: true },
    { ...progression(), practice: { logging: -1 } },
    { ...progression(), practice: { logging: 1.5 } },
    { ...progression(), practice: { logging: 1, mining: 2 } },
    { ...progression(), milestones: ['unknown'] },
    { ...progression(), knowledge: ['unknown'] },
  ];
  for (const value of invalid) assert.equal(sanitizeProfile({ ...newProfile(), progression: value }), null);
});

test('progression accessors are rejected without invoking them', () => {
  let reads = 0;
  const raw = newProfile();
  Object.defineProperty(raw, 'progression', { enumerable: true, get() { reads++; throw new Error('executed'); } });
  assert.equal(sanitizeProfile(raw), null);
  assert.equal(reads, 0);
  for (const field of ['milestones', 'knowledge']) {
    for (const key of ['some', Symbol.iterator]) {
      const list = [], prototype = Object.create(Array.prototype);
      Object.defineProperty(prototype, key, { get() { reads++; throw new Error('executed'); } });
      Object.setPrototypeOf(list, prototype);
      const candidate = newProfile(); candidate.progression[field] = list;
      assert.equal(sanitizeProfile(candidate), null);
      assert.equal(reads, 0);
    }
  }
});

test('inherited progression data is rejected without reading accessors', () => {
  let reads = 0;
  const prototype = {};
  Object.defineProperty(prototype, 'progression', { get() { reads++; return progression(); } });
  const raw = Object.create(prototype), data = newProfile(); delete data.progression;
  Object.defineProperties(raw, Object.getOwnPropertyDescriptors(data));
  assert.equal(sanitizeProfile(raw), null);
  assert.equal(reads, 0);
});

test('progression survives attach, ECS sync, detach, and re-entry', () => {
  const world = new World(431, { map });
  installInventory(world, 'progression-profile');
  const expected = progression(23, ['logging_steady']);
  const p = newProfile(); p.progression = expected;
  const first = world.spawnPlayer({ x: A.x, z: A.z });
  attachProfile(world, first, p);
  assert.deepEqual(syncProfile(world, first).progression, expected);
  const detached = detachProfile(world, first);
  assert.deepEqual(detached.progression, expected);
  world.despawn(first);
  const rejoined = world.spawnPlayer({ x: A.x, z: A.z });
  attachProfile(world, rejoined, sanitizeProfile(detached));
  assert.deepEqual(world.profiles.get(rejoined).progression, expected);
});

test('death planning preserves progression exactly while applying the existing death delta', () => {
  const world = new World(432, { map, server: true });
  installInventory(world, 'progression-death');
  const p = newProfile();
  p.pirateId = 'account:progression-death';
  p.progression = progression(42, ['logging_steady']);
  const entity = world.spawnPlayer({ x: A.x, z: A.z });
  attachProfile(world, entity, p);
  world.ecs.regenT[entity] = 99;
  const plan = captureDeathPlan(world, entity);
  const victim = plan.profiles.find(row => row.entity === entity);
  assert.deepEqual(victim.before.progression, p.progression);
  assert.deepEqual(victim.after.progression, p.progression);
  assert.equal(victim.after.stats.deaths, victim.before.stats.deaths + 1);
});
