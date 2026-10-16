import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { groundOperation, groundIntent, checkedGroundReceipt, groundResult } from '../server/pearlGround.mjs';
import { pearlIntent } from '../server/pearlOperations.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { A, B, WORLD, op, seed, meta, request, contract } from './helpers/pearl-same-holder.mjs';

test('same-holder memory implements CAS, exact conservation, receipts and shared UUIDs', (t) =>
  contract(t, () => ({ store: createMemoryStore() })));

test('same-holder DTO rejects incomplete or clamped snapshots before SDK dispatch', async (t) => {
  const store = createMemoryStore(), p = await seed(store), raw = request(p);
  let calls = 0;
  const sdk = createSupabaseStore({ rpc() { calls++; throw new Error('must not dispatch'); } });
  for (const [name, change] of [
    ['fresh mint', (r) => { r.expectedVersion = 0; }],
    ['ground payload', (r) => { r.ground = { x: 0, z: 0, availableAt: 0, returnAt: 1 }; }],
    ['missing account', (r) => { delete r.to; }],
    ['two profile lanes', (r) => { r.profiles.push(structuredClone(r.profiles[0])); }],
    ['wrong profile account', (r) => { r.profiles[0].id = B; }],
    ['sparse profile', (r) => { r.profiles = new Array(1); }],
    ['bag-only no-op', (r) => { r.profiles[0].data = structuredClone(p); }],
    ['missing swallowed', (r) => { r.profiles[0].data.pearls.swallowed = null; }],
    ['different swallowed kind', (r) => { r.profiles[0].data.pearls.swallowed.kind = 'tinta'; }],
    ['duplicate target', (r) => { r.profiles[0].data.pearls.bag.push(r.profiles[0].data.pearls.swallowed); }],
    ['clamped gold', (r) => { r.profiles[0].data.gold = 1e20; }],
    ['clamped pearl', (r) => { r.profiles[0].data.pearls.bag[0].kind = 'bogus'; }],
  ]) await t.test(name, async () => {
    const bad = structuredClone(raw); change(bad);
    await assert.rejects(sdk.commitPearlGround(bad));
    assert.equal(calls, 0);
  });
  assert.throws(() => pearlIntent(meta()), { code: 'operation' }, '003 still rejects same holder');
  assert.throws(() => groundIntent(meta({ from: null, to: A, expectedVersion: -1 })), { code: 'operation' });
});

test('canonical same-holder request detaches and shares immutable ground journal identity', async () => {
  const store = createMemoryStore(), p = await seed(store), raw = request(p);
  const normalized = groundOperation(raw);
  const journals = createMemoryPearlJournals(), journal = journals(WORLD);
  const prepared = await journal.prepare('ground', raw);
  assert.equal(prepared.request.profiles.length, 1); assert.equal(prepared.request.from, A);
  raw.profiles[0].data.gold = 999;
  assert.equal(normalized.request.profiles[0].data.gold, 27);
  const concrete = { operationId: op(2), ...normalized.request };
  assert.deepEqual(await journal.prepare('ground', concrete), prepared);
  await assert.rejects(journal.prepare('ground', { ...concrete, world: 'other-world' }), { code: 'operation' });
  const terminal = await journal.resolve('ground', concrete, 'committed');
  assert.equal(terminal.state, 'committed'); assert.deepEqual(await journal.list(), []);
  await assert.rejects(journal.resolve('ground', concrete, 'rejected'), { code: 'operation' });
  const result = groundResult(normalized.request);
  assert.deepEqual(checkedGroundReceipt({ request: normalized.request, result }, op(2)), { request: normalized.request, result });
  assert.throws(() => checkedGroundReceipt({ request: normalized.request, result: { ...result, unique: { ...result.unique, version: 1 } } }, op(2)), { code: 'response' });
});
