import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { deathDropOperation, deathDropResult, checkedDeathDropResult, checkedDeathDropReceipt,
  checkedCurrentDeathDrop, checkedCurrentDeathDropPage } from '../server/deathDropOperation.mjs';
import { seedDeathDropScenario, pickupRequest, expiryRequest, expectedPickupProfile, KILLER, VICTIM, WORLD, deathOp } from './helpers/death-drop-storage.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const clone = structuredClone;
test('strict drop DTO does not execute accessors or silently discard unsupported data', async (t) => {
  const store = createMemoryStore(), source = await seedDeathDropScenario(store), raw = await pickupRequest(store, source);
  const mutations = [
    ['symbol key', r => { r[Symbol('extra')] = true; }],
    ['nonenumerable key', r => { Object.defineProperty(r.drop, 'extra', { value: true }); }],
    ['custom prototype', r => { Object.setPrototypeOf(r.profile.before, { privileged: true }); }],
    ['sparse bag', r => { r.profile.before.bag = new Array(1); }],
    ['cyclic profile', r => { r.profile.before.loop = r.profile.before; }],
    ['unsafe tick', r => { r.at = Number.MAX_SAFE_INTEGER + 1; }],
    ['fractional generation', r => { r.drop.expectedVersion = 1.5; }],
    ['uppercase account', r => { r.profile.id = r.profile.id.toUpperCase(); }],
    ['source receipt reused', r => { r.operationId = r.drop.operationId; }],
    ['UID overflow', r => { r.profile.before.uid = 2147483647; r.profile.data.uid = 2147483648; }],
    ['progress altered', r => { r.profile.data.mast[0][1]++; }],
    ['item altered', r => { r.profile.data.bag.at(-1).r++; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const bad = clone(raw); mutate(bad); assert.throws(() => deathDropOperation(bad));
  });
  let calls = 0;
  const bad = clone(raw);
  Object.defineProperty(bad, 'world', { enumerable: true, get() { calls++; throw new Error('executed'); } });
  assert.throws(() => deathDropOperation(bad)); assert.equal(calls, 0);
  const toJSON = clone(raw); toJSON.profile.before.toJSON = () => { calls++; return {}; };
  assert.throws(() => deathDropOperation(toJSON)); assert.equal(calls, 0);
});

test('SDK responses must exactly match receiver, source, generation and terminal state', async (t) => {
  const memory = createMemoryStore(), source = await seedDeathDropScenario(memory), raw = await pickupRequest(memory, source);
  const { operationId, request } = deathDropOperation(raw), result = deathDropResult(request, operationId);
  const mutations = [
    ['changed holder', r => { r.drop.holder = VICTIM; }],
    ['wrong state', r => { r.drop.state = 'ground'; }],
    ['wrong generation', r => { r.drop.version++; }],
    ['wrong transition ID', r => { r.drop.transitionOperationId = deathOp(9999); }],
    ['invented field', r => { r.extra = true; }],
    ['wrong profile version', r => { r.profiles[0].version++; }],
    ['changed source item', r => { r.drop.item.u++; }],
    ['extra result profile', r => { r.profiles.push(r.profiles[0]); }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const bad = clone(result); mutate(bad);
    const store = createSupabaseStore({ rpc: async () => ({ data: bad, error: null }) });
    await assert.rejects(store.commitDeathDrop(raw), { code: 'response' });
  });
  for (const mutate of [r => { r.at = r.drop.ground.expiresAt + 1; }, r => { r.drop.expectedVersion = 2; }]) {
    const invalid = clone(raw); mutate(invalid); const parsed = deathDropOperation(invalid);
    assert.throws(() => checkedDeathDropResult(deathDropResult(parsed.request, parsed.operationId), parsed.request, parsed.operationId), { code: 'response' });
  }
  const valid = createSupabaseStore({ rpc: async () => ({ data: result, error: null }) });
  assert.deepEqual(await valid.commitDeathDrop(raw), result);
  assert.throws(() => checkedDeathDropReceipt({ request, result: { ...result, replay: true } }, operationId), { code: 'response' });
  assert.throws(() => checkedDeathDropResult({ ok: false, why: 'invented' }, request, operationId), { code: 'response' });
  assert.throws(() => checkedCurrentDeathDrop({ ...result.drop, version: 1 }), { code: 'response' });
  assert.throws(() => checkedCurrentDeathDropPage([result.drop], { world: WORLD, after: null, limit: 2 }), { code: 'response' });
  assert.throws(() => checkedCurrentDeathDrop(result.drop, { operationId: deathOp(999), ordinal: 1 }), { code: 'response' });
  const unavailable = createSupabaseStore({ rpc: async () => { throw new Error('secret provider diagnostic'); } });
  await assert.rejects(unavailable.commitDeathDrop(raw), e => e.code === 'unavailable' && !e.message.includes('secret'));
});

test('own equipment recovery also assigns a fresh character-local item UID', async () => {
  const store = createMemoryStore(), source = await seedDeathDropScenario(store);
  const raw = await pickupRequest(store, source), row = await store.loadProfile(VICTIM);
  raw.profile = { id: VICTIM, expectedVersion: row.version, before: row.data, data: expectedPickupProfile(source.itemDrop, row.data) };
  assert.notEqual(raw.profile.data.bag.at(-1).u, source.itemDrop.item.u);
  const prior = clone(row.data); assert.equal((await store.commitDeathDrop(raw)).ok, true);
  const current = (await store.loadProfile(VICTIM)).data;
  assert.equal(current.bag.at(-1).u, prior.uid);
  assert.deepEqual(current.mast, prior.mast); assert.equal(current.gold, prior.gold); assert.equal(current.xp, prior.xp);
});

test('one ground row can be claimed by only one account, or expired, despite overlapping attempts', async () => {
  const store = createMemoryStore(), source = await seedDeathDropScenario(store), first = await pickupRequest(store, source);
  const secondId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', profile = newProfile(); profile.pirateId = 'account:' + secondId;
  await store.saveProfile(secondId, profile, 0);
  const row = await store.loadProfile(secondId), second = clone(first); second.operationId = deathOp(888);
  second.profile = { id: secondId, expectedVersion: row.version, before: row.data, data: expectedPickupProfile(source.itemDrop, row.data) };
  const results = await Promise.all([store.commitDeathDrop(first), store.commitDeathDrop(second), store.commitDeathDrop(await expiryRequest(source))]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.deepEqual(results.slice(1), [{ ok: false, why: 'conflict' }, { ok: false, why: 'conflict' }]);
  assert.deepEqual(await store.loadProfile(secondId), row);
  assert.equal(await store.loadDeathDropOperation(second.operationId), null);
  assert.equal((await store.listCurrentDeathDrops(WORLD)).length, source.death.drops.length - 1);
});

test('pre-existing death and pending journal intents reserve UUIDs against drop mutations', async () => {
  const store = createMemoryStore(), source = await seedDeathDropScenario(store), raw = await pickupRequest(store, source);
  raw.operationId = source.request.operationId;
  assert.throws(() => deathDropOperation(raw), { code: 'operation' });
  raw.operationId = deathOp(999);
  const current = await store.loadProfile(KILLER), withPearl = clone(current.data); withPearl.pearls.bag.push({ uid: 'reserved', kind: 'brasa' });
  const intent = { operationId: raw.operationId, uid: 'reserved', kind: 'brasa', from: null, to: KILLER, expectedVersion: 0,
    profiles: [{ id: KILLER, expectedVersion: current.version, data: withPearl }] };
  await createMemoryPearlJournals(store)(WORLD).prepare('pearl', intent);
  assert.deepEqual(await store.commitDeathDrop(raw), { ok: false, why: 'operation' });
  assert.equal((await store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal)).state, 'ground');
});
