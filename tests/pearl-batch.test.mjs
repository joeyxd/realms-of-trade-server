import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { batchOperation, batchResult, checkedBatchResult, checkedBatchReceipt } from '../server/pearlBatch.mjs';
import { contract, seed, request, op, state } from './helpers/pearl-batch.mjs';

test('memory implements atomic pearl death/replacement CAS and historical receipts', (t) =>
  contract(t, async () => ({ store: createMemoryStore() })));
test('batch DTO refuses malformed requests before storage and detaches every nested field', async (t) => {
  const store = createMemoryStore(), p = await seed(store), raw = request(p), before = await state(store);
  for (const [name, change] of [
    ['empty', (r) => { r.items = []; }], ['duplicate', (r) => { r.items[1] = r.items[0]; }],
    ['unsorted', (r) => r.items.reverse()], ['zero generation', (r) => { r.items[0].expectedVersion = 0; }],
    ['fractional generation', (r) => { r.items[0].expectedVersion = 1.5; }],
    ['UID overflow', (r) => { r.items[0].expectedVersion = 2147483647; }],
    ['profile overflow', (r) => { r.profile.expectedVersion = 2147483647; }],
    ['wrong mode', (r) => { r.mode = 'mint'; }], ['extra key', (r) => { r.guess = 1; }],
    ['extra item field', (r) => { r.items[0].from = r.profile.id; }],
    ['extra profile field', (r) => { r.profile.foo = true; }],
    ['noncanonical profile', (r) => { r.profile.data.unknown = 123; }],
    ['invalid world', (r) => { r.world = '../world'; }], ['death retained UID', (r) => { r.items[0].ground = null; }],
    ['bad ground time', (r) => { r.items[0].ground.returnAt = r.items[0].ground.availableAt; }],
    ['bad coordinate', (r) => { r.items[0].ground.x = Infinity; }],
    ['invalid UID', (r) => { r.items[0].uid = '?'; }], ['invalid kind', (r) => { r.items[0].kind = 'fire'; }],
    ['extra endpoint', (r) => { r.profiles = [r.profile]; }],
  ]) await t.test(name, async () => {
    const bad = structuredClone(raw); change(bad);
    await assert.rejects(store.commitPearlBatch(bad)); assert.deepEqual(await state(store), before);
  });
  const frozen = batchOperation(raw); raw.profile.data.mast[0][1] = 999; raw.items[0].ground.x = 500;
  assert.notEqual(frozen.request.profile.data.mast[0][1], 999);
  assert.notEqual(frozen.request.items[0].ground.x, 500);
  const zero = structuredClone(raw); zero.items[0].ground.x = -0; zero.items[0].ground.z = -0;
  assert.equal(Object.is(batchOperation(zero).request.items[0].ground.x, -0), false, 'wire canonical zero');
  const wanted = batchResult(frozen.request), receipt = { request: frozen.request, result: wanted };
  assert.deepEqual(checkedBatchReceipt(receipt, op(20)), receipt);
  for (const change of [
    (r) => { r.uniques.pop(); }, (r) => { r.locations[0].version++; },
    (r) => { r.profiles[0].version++; }, (r) => { r.extra = 1; },
  ]) { const bad = structuredClone(wanted); change(bad); assert.throws(() => checkedBatchResult(bad, frozen.request), { code: 'response' }); }
  assert.throws(() => checkedBatchReceipt({ ...receipt, result: { ...wanted, replay: true } }, op(20)), { code: 'response' });
});
