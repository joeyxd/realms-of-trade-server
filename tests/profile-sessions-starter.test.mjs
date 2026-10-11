import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { ProfileSessions } from '../server/profileSessions.mjs';

const UUID = '9af00100-0000-4000-8000-000000000001';

test('starter-disabled fresh profiles keep the SQL021 legacy pack shape', () => {
  const profile = newProfile({ starter: false });
  assert.equal(Object.hasOwn(profile, 'carry'), false);
  assert.equal(Object.hasOwn(profile, 'workshop'), false);
  assert.deepEqual(profile.eco.pack, { cap: 10, goods: {} });
  assert.deepEqual(sanitizeProfile(profile), profile);
});

test('profile sessions gate only fresh-profile defaults and preserve an existing legacy row', async () => {
  const freshStore = { async loadProfile() { return null; } };
  const fresh = await new ProfileSessions(freshStore, () => {}, { starter: false })
    .open('client-fresh', UUID);
  assert.equal(Object.hasOwn(fresh, 'carry'), false);
  assert.equal(Object.hasOwn(fresh, 'workshop'), false);
  assert.equal(fresh.eco.pack.cap, 10);
  assert.equal(Object.hasOwn(fresh.eco.pack, 'maxMass'), false);

  const existingRow = { version: 1, data: newProfile({ starter: false }) };
  const existingStore = { async loadProfile() { return existingRow; } };
  const loaded = await new ProfileSessions(existingStore, () => {}, { starter: true })
    .open('client-existing', UUID);
  assert.equal(Object.hasOwn(loaded, 'carry'), false);
  assert.equal(Object.hasOwn(loaded, 'workshop'), false);
  assert.equal(loaded.eco.pack.cap, 10);
  assert.equal(Object.hasOwn(loaded.eco.pack, 'maxMass'), false);
});
