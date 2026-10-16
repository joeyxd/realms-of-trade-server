import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryPearlJournals, createSupabasePearlJournal, journalEntry } from '../server/pearlJournal.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const WORLD = 'journal:test';
const op = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = (n = 1) => ({ operationId: op(n), uid: `journal-${n}`, kind: 'brasa', from: null,
  to: null, expectedVersion: 0, profiles: [], world: WORLD,
  ground: { x: 3, z: -1, availableAt: 100, returnAt: 200 } });

test('memory journal freezes UUID identity across scopes, payloads and terminal outcomes', async () => {
  const factory = createMemoryPearlJournals(), journal = factory(WORLD), concrete = request();
  const prepared = await journal.prepare('ground', concrete);
  concrete.ground.x = 99; prepared.request.ground.x = 88;
  assert.deepEqual(await journal.list(), [journalEntry(WORLD, 'ground', request())]);
  assert.deepEqual(await journal.prepare('ground', request()), (await journal.list())[0]);
  await assert.rejects(journal.prepare('ground', concrete), { code: 'operation' });
  await assert.rejects(factory('other').prepare('ground', { ...request(), world: 'other' }), { code: 'operation' });
  await assert.rejects(journal.resolve('ground', request(), 'pending'), { code: 'operation' });
  await assert.rejects(journal.resolve('ground', request(9), 'committed'), { code: 'operation' });
  const finished = await journal.resolve('ground', request(), 'committed');
  assert.deepEqual(await journal.resolve('ground', request(), 'committed'), finished);
  assert.deepEqual(await journal.prepare('ground', request()), finished);
  assert.deepEqual(await journal.list(), []);
  await assert.rejects(journal.resolve('ground', request(), 'conflict'), { code: 'operation' });
});

test('memory journal pages pending UUIDs exclusively, isolating scopes and terminal rows', async () => {
  const factory = createMemoryPearlJournals(), journal = factory(WORLD);
  for (const n of [3, 1, 2]) await journal.prepare('ground', request(n));
  await factory('other').prepare('ground', { ...request(4), world: 'other' });
  await journal.resolve('ground', request(2), 'rejected');
  assert.deepEqual((await journal.list({ limit: 1 })).map((r) => r.operationId), [op(1)]);
  assert.deepEqual((await journal.list({ afterId: op(1), limit: 2 })).map((r) => r.operationId), [op(3)]);
  for (const limit of [0, 257, 1.1]) await assert.rejects(journal.list({ limit }), { code: 'operation' });
  await assert.rejects(journal.list({ afterId: 'bad' }), { code: 'identity' });
});

test('journal rejects noncanonical concrete requests and ground world mismatch before RPC', async () => {
  let writes = 0;
  const journal = createSupabasePearlJournal({ async rpc() { writes++; } }, WORLD);
  for (const raw of [{ ...request(), unexpected: true }, { ...request(), world: 'wrong' },
    { ...request(), expectedVersion: 0.1 }, { ...request(), ground: { ...request().ground, returnAt: 50 } }]) {
    await assert.rejects(journal.prepare('ground', raw));
  }
  await assert.rejects(journal.prepare('missing-family', request()), { code: 'operation' });
  assert.equal(writes, 0);
});

test('SDK journal checks complete response identity and terminal state, suppressing provider details', async () => {
  let reply, called;
  const journal = createSupabasePearlJournal({ async rpc(name, args) { called = { name, args }; return reply; } }, WORLD);
  const entry = journalEntry(WORLD, 'ground', request());
  for (const data of [null, { ...entry, scope: 'wrong' }, { ...entry, operationId: op(9) },
    { ...entry, request: { ...entry.request, kind: 'tinta' } }, { ...entry, extra: true }]) {
    reply = { data, error: null };
    await assert.rejects(journal.prepare('ground', request()), { code: 'response' });
  }
  reply = { data: entry, error: null };
  assert.deepEqual(await journal.prepare('ground', request()), entry);
  assert.equal(called.name, 'mn_prepare_pearl_intent');
  assert.equal(called.args.p_operation_id, op(1));
  assert.equal(Object.hasOwn(called.args.p_request, 'operationId'), false);
  await assert.rejects(journal.resolve('ground', request(), 'committed'), { code: 'response' });
  reply = { data: { ...entry, state: 'committed' }, error: null };
  assert.equal((await journal.resolve('ground', request(), 'committed')).state, 'committed');
  reply = { error: { message: 'sensitive-provider-detail', code: 'XX001' } };
  await assert.rejects(journal.prepare('ground', request()), (err) => err.code === 'unavailable' && !err.message.includes('sensitive'));
  reply = { error: { code: 'MNP02' } };
  await assert.rejects(journal.prepare('ground', request()), { code: 'operation' });
});

test('SDK journal validates ordered exclusive pending pages instead of trusting a matching UUID', async () => {
  let data;
  const journal = createSupabasePearlJournal({ async rpc() { return { data, error: null }; } }, WORLD);
  const first = journalEntry(WORLD, 'ground', request(1)), next = journalEntry(WORLD, 'ground', request(2));
  for (const raw of [null, [next, first], [first, first], [{ ...first, state: 'committed' }],
    [{ ...first, scope: 'other' }], [first, next]]) {
    data = raw;
    await assert.rejects(journal.list({ limit: 1 }), { code: 'response' });
  }
  data = [first];
  await assert.rejects(journal.list({ afterId: op(1) }), { code: 'response' });
  data = [next];
  assert.deepEqual(await journal.list({ afterId: op(1) }), [next]);
});

test('lost committed journal reply followed by advanced state retires its local fence without changing audit', async () => {
  const store = createMemoryStore(), durable = createMemoryPearlJournals()(WORLD);
  let lose = true, writes = 0;
  const journal = { ...durable, async resolve(...args) {
    const result = await durable.resolve(...args);
    if (lose) { lose = false; throw new StoreError('unavailable'); }
    return result;
  } };
  const sessions = new ProfileSessions({ ...store, async commitPearlGround(raw) {
    writes++; return store.commitPearlGround(raw);
  } }, null, { journal });
  await sessions.recoverPearls();
  await assert.rejects(sessions.commitPearlGround(request(), () => []), { code: 'unavailable' });
  assert.equal(sessions.pearls.unresolved.size, 1);
  const later = { ...request(), operationId: op(8), expectedVersion: 1,
    ground: { ...request().ground, x: 40 } };
  assert.equal((await store.commitPearlGround(later)).ok, true);
  await assert.rejects(sessions.reconcilePearlGround(op(1)), { code: 'conflict' });
  assert.equal(sessions.pearls.unresolved.size, 0);
  assert.equal(sessions.pearls.uids.size, 0);
  assert.equal(writes, 1);
  assert.equal((await durable.prepare('ground', request())).state, 'committed');
  assert.equal((await store.loadPearlLocation(request().uid)).ground.x, 40);
});

test('malformed current profile, ledger and location reads keep recovery pending', async (t) => {
  const id = '66000000-0000-4000-8000-000000000001';
  for (const target of ['profile', 'unique', 'location']) await t.test(target, async () => {
    const base = createMemoryStore(), journal = createMemoryPearlJournals()(WORLD);
    const data = newProfile(); await base.saveProfile(id, data, 0);
    data.pearls.bag.push({ uid: request().uid, kind: 'brasa' });
    const concrete = { ...request(), to: id, ground: null, profiles: [{ id, expectedVersion: 1, data }] };
    await journal.prepare('ground', concrete); await base.commitPearlGround(concrete);
    let sends = 0;
    const store = { ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } };
    if (target === 'profile') store.loadProfile = async () => ({ data: { v: 1 }, version: 2 });
    if (target === 'unique') store.loadUnique = async () => ({ kind: 'pearl:brasa', holder: id, version: '1' });
    if (target === 'location') store.loadPearlLocation = async () => ({ world: WORLD, ground: null, version: '1' });
    const sessions = new ProfileSessions(store, null, { journal });
    assert.deepEqual(await sessions.recoverPearls(), [{ operationId: op(1), outcome: 'pending' }]);
    await assert.rejects(sessions.open('fixture', id), { code: 'busy' });
    await assert.rejects(sessions.resumePearlGround(op(1)), { code: 'response' });
    assert.equal(sends, 0);
    assert.equal(sessions.pearls.unresolved.size, 1);
    assert.equal((await journal.list()).length, 1);
  });
});

test('terminal conflict fallback rejects malformed, mismatched and pending journal evidence', async (t) => {
  for (const target of ['malformed', 'different', 'pending']) await t.test(target, async () => {
    const base = createMemoryStore(), durable = createMemoryPearlJournals()(WORLD);
    let prepareCount = 0, lose = true;
    const journal = { ...durable, async prepare(...args) {
      const row = await durable.prepare(...args);
      if (++prepareCount === 1) return row;
      if (target === 'malformed') return { ...row, unexpected: true };
      if (target === 'different') return { ...row, request: { ...row.request, kind: 'tinta' } };
      return { ...row, state: 'pending' };
    }, async resolve(...args) {
      const row = await durable.resolve(...args);
      if (lose) { lose = false; throw new StoreError('unavailable'); }
      return row;
    } };
    const sessions = new ProfileSessions(base, null, { journal });
    await sessions.recoverPearls();
    await assert.rejects(sessions.commitPearlGround(request(), () => []), { code: 'unavailable' });
    await base.commitPearlGround({ ...request(), operationId: op(7), expectedVersion: 1,
      ground: { ...request().ground, x: 70 } });
    await assert.rejects(sessions.reconcilePearlGround(op(1)));
    assert.equal(sessions.pearls.unresolved.size, 1);
    await assert.rejects(sessions.commitPearlGround({ ...request(), operationId: op(9) }, () => []), { code: 'busy' });
  });
});
