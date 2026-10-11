import assert from 'node:assert/strict';
import { PearlStaging } from '../../server/pearlStaging.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { World } from '../../src/sim/world.js';
import { newProfile, installInventory, attachProfile } from '../../src/sim/systems/inventory.js';
import { map, A as arena } from '../helpers.mjs';
import { WORLD, pearls, op } from './pearl-batch.mjs';

export { WORLD };
export const accounts = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
export const incomingUid = pearls[1].uid;
export const outgoingUid = pearls[3].uid;
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

export async function fixture({ backend, wrapStore = (store) => store, wrapJournal = (journal) => journal,
  incomingKind = pearls[1].kind } = {}) {
  const database = backend ? await backend() : { store: createMemoryStore(), close: async () => {} };
  const base = database.store;
  let profile = newProfile(); profile.pirateId = `account:${accounts[0]}`;
  profile.gold = 37; profile.xp = 21; profile.mast[0] = [3, 123]; profile.stats.kills = 17;
  let saved = await base.saveProfile(accounts[0], profile, 0);
  assert.equal(saved.ok, true);
  const second = newProfile(); second.pirateId = `account:${accounts[1]}`;
  await base.saveProfile(accounts[1], second, 0);
  let version = saved.version;
  const inventory = pearls.map((pearl, i) => i === 1 ? { ...pearl, kind: incomingKind } : pearl);
  for (let i = 0; i < 4; i++) {
    const pearl = inventory[i], data = structuredClone(profile);
    data.pearls.bag.push(pearl);
    const result = await base.commitPearlGround({ operationId: op(i + 1), ...pearl,
      from: null, to: accounts[0], expectedVersion: 0, world: WORLD, ground: null,
      profiles: [{ id: accounts[0], expectedVersion: version, data }] });
    assert.equal(result.ok, true);
    profile = data; version++;
  }
  // Install a known swallowed UID while retaining bag order and extra profile progress.
  const outgoing = profile.pearls.bag.find((q) => q.uid === outgoingUid);
  profile.pearls.bag = profile.pearls.bag.filter((q) => q.uid !== outgoingUid);
  profile.pearls.swallowed = outgoing;
  saved = await base.saveProfile(accounts[0], profile, version);
  assert.equal(saved.ok, true); version = saved.version;

  const journalBase = database.journal ?? createMemoryPearlJournals(base)(WORLD);
  const store = wrapStore(base), journal = wrapJournal(journalBase);
  const errors = [], sessions = new ProfileSessions(store, (id, code) => errors.push({ id, code }), { journal });
  await sessions.recoverPearls();
  const world = new World(42, { map, server: true }); installInventory(world, WORLD);
  const entities = [];
  for (let i = 0; i < accounts.length; i++) {
    const clientId = i + 1, loaded = await sessions.open(clientId, accounts[i]);
    const entity = world.spawnPlayer({ x: arena.x + i * 0.2, z: arena.z + 4, clientId });
    attachProfile(world, entity, loaded); world.ecs.regenT[entity] = 99; entities.push(entity);
  }
  world.events.length = 0; world.profileDirty.clear();
  const staging = new PearlStaging(sessions, world, WORLD);
  const command = () => ({ uid: incomingUid, replaceUid: outgoingUid,
    expectedVersion: 1, replaceExpectedVersion: 1, source: { clientId: 1, entity: entities[0] } });
  return { database, base, store, journal, sessions, staging, world, entities, errors, profile: structuredClone(profile),
    command, close: () => database.close?.() };
}

export const state = (world) => structuredClone({ profiles: [...world.profiles], ledger: [...world.pearlLedger],
  dirty: [...world.profileDirty], events: world.events, drops: [...world.drops], nextDrop: world.nextDrop,
  nextPearl: world.nextPearl, rng: world.rng.state(), lootRng: world.lootRng.state(), ecs: world.ecs });

export const row = (ecs, entity) => Object.fromEntries(Object.entries(ecs)
  .filter(([, column]) => ArrayBuffer.isView(column)).map(([key, column]) => [key, column[entity]]));

export const profileData = (world, entity) => world.profiles.get(entity);
