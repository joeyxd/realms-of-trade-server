import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { batchIntent } from '../server/pearlBatch.mjs';
import { A, WORLD, op, request, seed } from './helpers/pearl-batch.mjs';
import { intent, queueContract } from './helpers/pearl-batch-queue-contract.mjs';

test('batch queue memory contract', async (t) => queueContract(t, async () => {
  const store = createMemoryStore(); return { store, journal: createMemoryPearlJournals(store)(WORLD) };
}));

test('profile-free batch intent rejects changed shapes/order/generations and detaches nested data', async () => {
  const store = createMemoryStore(), p = await seed(store), raw = intent(request(p)), normalized = batchIntent(raw);
  raw.items[0].ground.x = 999; assert.notEqual(normalized.items[0].ground.x, 999);
  for (const change of [r => { r.actor = 'guest'; }, r => { r.items.reverse(); }, r => { r.items[1] = r.items[0]; },
    r => { delete r.items[1]; }, r => { r.items[1].expectedVersion = 0; }, r => { r.profile = {}; },
    r => { r.world = 'bad world'; }, r => { r.mode = 'sale'; }, r => { r.items[1].ground = null; }]) {
    const bad = structuredClone(normalized); change(bad); assert.throws(() => batchIntent(bad));
  }
  assert.equal(normalized.actor, A); assert.equal(normalized.operationId, op(20));
});
