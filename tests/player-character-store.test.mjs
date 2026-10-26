import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { createMemoryPlayerCharacterMethods, PlayerCharacterStoreError } from '../server/playerCharacterStore.mjs';

const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const request = (n, patch = {}) => ({ requestId: id(n), name: `Pirata ${n}`, skin: 0, weapon: 0, mode: 'new', ...patch });
const key = 'a'.repeat(64);

function fixture({ seed = [], ids = [] } = {}) {
  const profiles = new Map(seed.map(([owner, profile, version = 1]) => [owner, { data: structuredClone(profile), version }]));
  const claimed = new Map(); let next = 0;
  const methods = createMemoryPlayerCharacterMethods({
    loadProfile: async owner => profiles.has(owner) ? structuredClone(profiles.get(owner)) : null,
    initializeProfile: async (owner, profile, legacyKey = null) => {
      if (profiles.has(owner)) return structuredClone(profiles.get(owner));
      if (legacyKey && claimed.has(legacyKey) && claimed.get(legacyKey) !== owner) {
        const error = new Error('legacy used'); error.code = 'legacy_used'; throw error;
      }
      const row = { data: structuredClone(profile), version: 1 };
      profiles.set(owner, row);
      if (legacyKey) claimed.set(legacyKey, owner);
      return structuredClone(row);
    },
    uuid: () => ids[next++] ?? id(next + 100),
  });
  return { ...methods, profiles, claimed };
}

function saved(gold = 0, pirateId = 'old-world:pirate') {
  const profile = newProfile(); profile.gold = gold; profile.pirateId = pirateId; return profile;
}

test('legacy account profile registers in slot zero without changing its JSON, version, or item identity', async () => {
  const old = saved(777), row = { data: structuredClone(old), version: 42 }, f = fixture({ seed: [[ownerA, old, 42]] });
  assert.deepEqual(await f.listPlayerCharacters(ownerA), { characters: [], legacy: true });
  await assert.rejects(f.createPlayerCharacter(ownerA, request(1), newProfile()), { code: 'legacy_required' });
  const character = await f.createPlayerCharacter(ownerA, request(2, { mode: 'legacy', skin: 2, weapon: 1 }), null);
  assert.deepEqual(character, { id: ownerA, slot: 0, name: 'Pirata 2', skin: 2, weapon: 1, lastPlayed: true });
  assert.deepEqual(f.profiles.get(ownerA), row, 'registering the old slot never invokes a profile write');
  assert.deepEqual(await f.listPlayerCharacters(ownerA), { characters: [character], legacy: false });
  assert.deepEqual(await f.createPlayerCharacter(ownerA, request(2, { mode: 'legacy', skin: 2, weapon: 1 }), null), character);
  await assert.rejects(f.createPlayerCharacter(ownerA, request(2, { mode: 'legacy', name: 'Changed', skin: 2, weapon: 1 }), null),
    { code: 'operation' });
});

test('fresh slots get independent character-keyed profiles and Buccaneer starts with pistol weapon metadata', async () => {
  const f = fixture({ ids: [id(10), id(11), id(12)] });
  const firstProfile = newProfile(); firstProfile.gold = 125; firstProfile.eq.weapon.b = 'sable';
  const first = await f.createPlayerCharacter(ownerA, request(3, { name: 'Corsario' }), firstProfile);
  const buccaneerProfile = newProfile({ weapon: 1 }); buccaneerProfile.gold = 9;
  const buccaneer = await f.createPlayerCharacter(ownerA,
    request(4, { name: 'Bucanero', skin: 2, weapon: 1 }), buccaneerProfile);
  assert.notEqual(first.id, ownerA); assert.notEqual(first.id, buccaneer.id);
  assert.equal(first.slot, 0); assert.equal(buccaneer.slot, 1);
  assert.deepEqual({ skin: buccaneer.skin, weapon: buccaneer.weapon }, { skin: 2, weapon: 1 });
  assert.equal(f.profiles.get(first.id).data.gold, 125);
  assert.equal(f.profiles.get(buccaneer.id).data.gold, 9);
  assert.equal(f.profiles.get(buccaneer.id).data.pirateId, `account:${buccaneer.id}`);
  assert.equal(f.profiles.get(first.id).data.pirateId, `account:${first.id}`);
  assert.deepEqual((await f.listPlayerCharacters(ownerA)).characters.map(c => c.lastPlayed), [false, true]);
  assert.deepEqual(await f.selectPlayerCharacter(ownerA, first.id), { ...first, lastPlayed: true });
  assert.deepEqual((await f.listPlayerCharacters(ownerA)).characters.map(c => c.lastPlayed), [true, false]);
  await assert.rejects(f.selectPlayerCharacter(ownerB, first.id), { code: 'forbidden' });
  await f.createPlayerCharacter(ownerA, request(5), newProfile());
  await assert.rejects(f.createPlayerCharacter(ownerA, request(7), newProfile()), { code: 'limit' });
});

test('request retries create once, reuse their exact metadata, and reject request ID rebinding', async () => {
  const f = fixture({ ids: [id(20), id(21)] }), input = request(6);
  const [a, b] = await Promise.all([
    f.createPlayerCharacter(ownerA, input, newProfile()),
    f.createPlayerCharacter(ownerA, input, newProfile()),
  ]);
  assert.deepEqual(a, b);
  assert.equal(f.profiles.size, 1);
  await assert.rejects(f.createPlayerCharacter(ownerA, request(6, { name: 'Other' }), newProfile()), { code: 'operation' });
  const created = await Promise.allSettled(Array.from({ length: 4 }, (_, n) =>
    f.createPlayerCharacter(ownerB, request(10 + n), newProfile())));
  assert.equal(created.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(created.filter(result => result.status === 'rejected' && result.reason.code === 'limit').length, 1);
});

test('signed import initializes only an empty roster, records account pirateId, and consumes its legacy key once', async () => {
  const f = fixture();
  const imported = saved(500, 'old-world:captain');
  const row = await f.createPlayerCharacter(ownerA, request(30, { mode: 'import', name: 'Imported' }), imported, key);
  assert.equal(row.id, ownerA); assert.equal(row.slot, 0);
  assert.equal(f.profiles.get(ownerA).data.gold, 500);
  assert.equal(f.profiles.get(ownerA).data.pirateId, `account:${ownerA}`);
  assert.deepEqual(await f.createPlayerCharacter(ownerA, request(30, { mode: 'import', name: 'Imported' }), imported, key), row);
  await assert.rejects(f.createPlayerCharacter(ownerA, request(30, { mode: 'import', name: 'Imported' }), imported, 'c'.repeat(64)),
    { code: 'operation' });
  await assert.rejects(f.createPlayerCharacter(ownerB, request(31, { mode: 'import' }), imported, key),
    { code: 'legacy_used' });
  await assert.rejects(f.createPlayerCharacter(ownerB, request(32, { mode: 'import' }), imported),
    error => error instanceof PlayerCharacterStoreError && error.code === 'legacy_key');
  const next = await f.createPlayerCharacter(ownerA, request(33), newProfile());
  assert.equal(next.slot, 1);
});

test('creation validates normalized names and enforces Buccaneer-only pistol loadout', async () => {
  const f = fixture({ ids: [id(40)] });
  const created = await f.createPlayerCharacter(ownerA, request(40, { name: '  Bucanero  ', skin: 2, weapon: 1 }), newProfile());
  assert.equal(created.name, 'Bucanero');
  await assert.rejects(f.createPlayerCharacter(ownerB, request(41, { skin: 2, weapon: 0 }), newProfile()), { code: 'operation' });
  await assert.rejects(f.createPlayerCharacter(ownerB, request(42, { name: ' <> ' }), newProfile()), { code: 'name' });
});
