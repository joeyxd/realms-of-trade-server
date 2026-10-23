import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { seed, request, state, WORLD, A, pearls, op, ground } from './helpers/pearl-batch.mjs';

const older = (id) => ({ operationId: id, ...pearls[0], from: null, to: null,
  expectedVersion: 0, profiles: [], world: WORLD, ground: ground(1) });
const fixture = async () => {
  const store = createMemoryStore(), factory = createMemoryPearlJournals(store), journal = factory(WORLD);
  const p = await seed(store), raw = request(p); return { store, factory, journal, p, raw };
};

test('bound journal factories share the store identity namespace across reconstruction', async () => {
  const f = await fixture(); await f.journal.prepare('batch', f.raw);
  const other = createMemoryPearlJournals(f.store)(WORLD);
  assert.deepEqual(await other.list(), await f.journal.list());
  assert.throws(() => createMemoryPearlJournals({ ...f.store }), { code: 'configuration' });
  assert.equal((await f.store.commitPearlBatch(f.raw)).ok, true);
  await other.resolve('batch', f.raw, 'committed'); assert.deepEqual(await f.journal.list(), []);
  assert.equal((await f.store.commitPearlBatch(f.raw)).replay, true);
});

for (const stateName of ['rejected','conflict','committed']) test(`terminal ${stateName} without a receipt never authorizes a batch dispatch`, async () => {
  const f = await fixture(); await f.journal.prepare('batch', f.raw); await f.journal.resolve('batch', f.raw, stateName);
  const before = await state(f.store);
  assert.deepEqual(await f.store.commitPearlBatch(f.raw), { ok: false, why: 'operation' });
  assert.deepEqual(await state(f.store), before); assert.equal(await f.store.loadPearlBatchOperation(f.raw.operationId), null);
});

test('batch intent rejects any changed batch payload and both older receipt families before mutation', async () => {
  const f = await fixture(); await f.journal.prepare('batch', f.raw); const before = await state(f.store);
  const changed = structuredClone(f.raw); changed.items[1].ground.x++;
  assert.deepEqual(await f.store.commitPearlBatch(changed), { ok: false, why: 'operation' });
  const old = { ...older(f.raw.operationId), from: A, expectedVersion: 1,
    profiles: [{ id: A, expectedVersion: f.p.version, data: f.p.data }] };
  assert.deepEqual(await f.store.commitPearlGround(old), { ok: false, why: 'operation' });
  const { world: _world, ground: _ground, ...pearl } = { ...old, to: null };
  assert.deepEqual(await f.store.commitPearl(pearl), { ok: false, why: 'operation' });
  assert.deepEqual(await state(f.store), before);
});

test('old intent and old receipts exclude batch identity in both insertion orders', async () => {
  const f = await fixture(), before = await state(f.store);
  await f.journal.prepare('ground', older(f.raw.operationId));
  assert.deepEqual(await f.store.commitPearlBatch(f.raw), { ok: false, why: 'operation' });
  await assert.rejects(f.journal.prepare('batch', f.raw), { code: 'operation' });
  await assert.rejects(f.journal.prepare('batch', { ...f.raw, operationId: op(1) }), { code: 'operation' });
  assert.deepEqual(await state(f.store), before);
});

test('existing batch receipt permits only exact batch intent, retaining ordinary 004 child receipts', async () => {
  const f = await fixture(); assert.equal((await f.store.commitPearlBatch(f.raw)).ok, true);
  await assert.rejects(f.journal.prepare('ground', older(f.raw.operationId)), { code: 'operation' });
  const changed = structuredClone(f.raw); changed.profile.data.xp++;
  await assert.rejects(f.journal.prepare('batch', changed), { code: 'operation' });
  assert.equal((await f.journal.prepare('batch', f.raw)).state, 'pending');
  assert.ok(await f.store.loadPearlOperation(op(1))); assert.ok(await f.store.loadPearlGroundOperation(op(1)));
  assert.deepEqual(await f.factory('other').list(), []);
  await assert.rejects(f.factory('other').prepare('batch', { ...f.raw, world: 'other' }), { code: 'operation' });
});
