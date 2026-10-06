import assert from 'node:assert/strict';
import { PearlStaging } from '../../server/pearlStaging.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { World } from '../../src/sim/world.js';
import { newProfile, installInventory, attachProfile } from '../../src/sim/systems/inventory.js';
import { map, A as arena } from '../helpers.mjs';
import { WORLD as scope } from './pearl-same-holder.mjs';

export { scope };
export const accounts = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
export const uid = 'swallow-staging-target';
export const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
export const memory = async () => ({ store: createMemoryStore(), journal: createMemoryPearlJournals()(scope), close: async () => {} });

export async function fixture({ backend = memory, wrapStore = (base) => base, wrapJournal = (base) => base, kind = 'brasa', limit } = {}) {
  const database = await backend(), base = database.store;
  for (const id of accounts) {
    const p = newProfile(); p.pirateId = `account:${id}`; p.gold = 20;
    assert.equal((await base.saveProfile(id, p, 0)).ok, true);
  }
  const pearls = [{ uid: 'swallow-first', kind: 'escarcha' }, { uid, kind }, { uid: 'swallow-last', kind: 'tinta' }];
  for (const [index, pearl] of pearls.entries()) {
    const row = await base.loadProfile(accounts[0]), data = structuredClone(row.data); data.pearls.bag.push(pearl);
    assert.equal((await base.commitPearl({ operationId: `61000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      ...pearl, from: null, to: accounts[0], expectedVersion: 0,
      profiles: [{ id: accounts[0], expectedVersion: row.version, data }] })).ok, true);
  }
  const errors = [], store = wrapStore(base), journal = wrapJournal(database.journal);
  const sessions = new ProfileSessions(store, (id, code) => errors.push({ id, code }), { journal });
  await sessions.recoverPearls();
  const w = new World(42, { map, server: true }); installInventory(w, scope);
  const entities = [];
  for (let i = 0; i < accounts.length; i++) {
    const p = await sessions.open(i + 1, accounts[i]), entity = w.spawnPlayer({ x: arena.x + i * 0.2, z: arena.z + 4, clientId: i + 1 });
    attachProfile(w, entity, p); w.ecs.regenT[entity] = 99; entities.push(entity);
  }
  const e = entities[0]; w.ecs.gBuf[e] = 0.9; w.ecs.cdG[e] = 2; w.ecs.waterT[e] = 1.2;
  w.ecs.hp[e] = w.ecs.maxHp[e] * 0.36; w.ecs.guardSt[e] = 90;
  w.events.length = 0; w.profileDirty.clear();
  const staging = new PearlStaging(sessions, w, scope, limit === undefined ? {} : { limit });
  return { database, base, store, journal, sessions, staging, w, entities, errors,
    pearl: pearls[1], command: () => ({ uid, expectedVersion: 1, source: { clientId: 1, entity: e } }),
    give: () => ({ uid, expectedVersion: 1, source: { clientId: 1, entity: e }, target: { clientId: 2, entity: entities[1] } }),
    close: () => database.close() };
}

export const state = (w) => structuredClone({ profiles: [...w.profiles], ledger: [...w.pearlLedger], dirty: [...w.profileDirty],
  events: w.events, drops: [...w.drops], nextDrop: w.nextDrop, nextPearl: w.nextPearl,
  rng: w.rng.state(), lootRng: w.lootRng.state(), ecs: w.ecs });
export const row = (ecs, entity) => Object.fromEntries(Object.entries(ecs).filter(([, v]) => ArrayBuffer.isView(v)).map(([k, v]) => [k, v[entity]]));
export const expected = (f) => {
  const ecs = structuredClone(f.w.ecs), profile = structuredClone(f.w.profiles.get(f.entities[0]));
  return { ecs, profiles: new Map([[f.entities[0], profile]]), profileDirty: new Set(), events: [],
    emit(event) { this.events.push(structuredClone(event)); } };
};
