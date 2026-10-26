import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSupabaseStore, StoreError } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UID = 'black-pearl-1';
const op = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile = (gold = 0, pearls = []) => {
  const value = newProfile();
  value.gold = gold;
  value.pearls.bag = pearls.map((kind) => ({ uid: UID, kind }));
  return value;
};
const endpoint = (id, expectedVersion, data) => ({ id, expectedVersion, data });
const grant = (id, data, operationId = op(1)) => ({
  operationId, uid: UID, kind: 'brasa', from: null, to: id, expectedVersion: 0,
  profiles: [endpoint(id, 1, data)],
});
const transfer = (from, to, generation, fromVersion, toVersion, fromData, toData, operationId) => ({
  operationId, uid: UID, kind: 'brasa', from, to, expectedVersion: generation,
  profiles: [endpoint(from, fromVersion, fromData), endpoint(to, toVersion, toData)],
});

test('managed pearl can be granted, transferred, released, reclaimed and replayed once', async () => {
  const store = createMemoryStore();
  await store.initializeProfile(A, profile(10));
  await store.initializeProfile(B, profile(20));
  await store.initializeProfile(C, profile(30));

  const grantRequest = grant(A, profile(10, ['brasa']));
  const granted = await store.commitPearl(grantRequest);
  assert.deepEqual(granted, {
    ok: true, replay: false,
    profiles: [{ id: A, version: 2 }],
    unique: { uid: UID, kind: 'pearl:brasa', holder: A, version: 1 },
  });
  assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: A, version: 1 });

  const ownerProgress = (await store.loadProfile(A)).data;
  ownerProgress.gold = 11;
  ownerProgress.pearls.bag = [];
  ownerProgress.pearls.swallowed = { uid: UID, kind: 'brasa' };
  assert.deepEqual(await store.saveProfile(A, ownerProgress, 2), { ok: true, version: 3 });

  const sourceAfterTransfer = structuredClone(ownerProgress);
  sourceAfterTransfer.pearls.swallowed = null;
  const move = transfer(A, B, 1, 3, 1, sourceAfterTransfer, profile(20, ['brasa']), op(2));
  const moved = await store.commitPearl(move);
  assert.equal(moved.unique.holder, B);
  assert.equal(moved.unique.version, 2);
  assert.deepEqual((await store.loadProfile(A)).data.pearls.bag, []);
  assert.deepEqual((await store.loadProfile(B)).data.pearls.bag, [{ uid: UID, kind: 'brasa' }]);

  // A release may carry its gold credit in the same authoritative profile snapshot.
  const release = transfer(B, null, 2, 2, 1, profile(20), profile(620), op(3));
  release.profiles = [endpoint(B, 2, profile(620))];
  const released = await store.commitPearl(release);
  assert.deepEqual(released.unique, { uid: UID, kind: 'pearl:brasa', holder: null, version: 3 });
  assert.equal((await store.loadProfile(B)).data.gold, 620);
  assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: null, version: 3 });

  await assert.rejects(store.saveProfile(A, ownerProgress, 4), { code: 'ownership' });
  assert.equal((await store.loadProfile(A)).version, 4);

  const reclaim = { ...grant(C, profile(30, ['brasa']), op(4)), expectedVersion: 3 };
  const reclaimed = await store.commitPearl(reclaim);
  assert.deepEqual(reclaimed.unique, { uid: UID, kind: 'pearl:brasa', holder: C, version: 4 });

  const replay = await store.commitPearl(release);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal((await store.loadProfile(B)).data.gold, 620);
  assert.equal((await store.loadProfile(B)).version, 3);
  assert.equal((await store.loadUnique(UID)).version, 4);
  assert.deepEqual(await store.commitPearl({ ...release, profiles: [endpoint(B, 2, profile(621))] }), { ok: false, why: 'operation' });
});

test('concurrent first grants have one winner and stale endpoint CAS has no partial writes', async () => {
  const store = createMemoryStore();
  await store.initializeProfile(A, profile());
  await store.initializeProfile(B, profile());
  const [a, b] = await Promise.all([
    store.commitPearl(grant(A, profile(0, ['brasa']), op(10))),
    store.commitPearl(grant(B, profile(0, ['brasa']), op(11))),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal([a, b].filter((r) => r.why === 'conflict').length, 1);
  const owner = a.ok ? A : B;
  const loser = owner === A ? B : A;
  assert.equal((await store.loadProfile(owner)).version, 2);
  assert.equal((await store.loadProfile(loser)).version, 1);
  assert.equal((await store.loadUnique(UID)).holder, owner);

  const stale = transfer(owner, loser, 1, 1, 1,
    profile(0), profile(0, ['brasa']), op(12));
  assert.deepEqual(await store.commitPearl(stale), { ok: false, why: 'conflict' });
  assert.equal((await store.loadProfile(owner)).version, 2);
  assert.equal((await store.loadProfile(loser)).version, 1);
  assert.equal((await store.loadUnique(UID)).version, 1);
});

test('ownership conservation and legacy write paths cannot contradict the pearl ledger', async () => {
  const store = createMemoryStore();
  await store.initializeProfile(A, profile());
  await store.initializeProfile(B, profile());
  assert.deepEqual(await store.commitPearl(grant(A, profile(0, ['brasa']))), {
    ok: true, replay: false,
    profiles: [{ id: A, version: 2 }],
    unique: { uid: UID, kind: 'pearl:brasa', holder: A, version: 1 },
  });

  // A request that leaves the pearl in the source is an ownership failure.
  const wrongTarget = transfer(A, B, 1, 2, 1, profile(0, ['brasa']), profile(), op(21));
  assert.deepEqual(await store.commitPearl(wrongTarget), { ok: false, why: 'ownership' });
  assert.equal((await store.loadProfile(A)).version, 2);
  assert.equal((await store.loadUnique(UID)).version, 1);

  const forged = profile(9, ['brasa']);
  await assert.rejects(store.saveProfile(B, forged, 1), { code: 'ownership' });
  await assert.rejects(store.initializeProfile(C, forged), { code: 'ownership' });
  await assert.rejects(store.claimUnique(UID, 'pearl:brasa', B), { code: 'operation' });
  await assert.rejects(store.releaseUnique(UID, A, 1), { code: 'operation' });
  assert.equal((await store.loadProfile(B)).version, 1);
  assert.deepEqual((await store.loadProfile(B)).data.pearls.bag, []);
  assert.equal(await store.loadProfile(C), null);
});

test('request and returned snapshots are detached from committed profile and receipt state', async () => {
  const store = createMemoryStore();
  await store.initializeProfile(A, profile(17));
  const request = grant(A, profile(17, ['brasa']), op(30));
  const expected = structuredClone(request);
  const result = await store.commitPearl(request);
  const expectedResult = structuredClone(result);
  request.profiles[0].data.gold = 999;
  request.profiles[0].data.pearls.bag[0].uid = 'changed';
  result.profiles[0].version = 999;
  result.unique.holder = B;
  assert.equal((await store.loadProfile(A)).data.gold, 17);
  assert.deepEqual((await store.loadProfile(A)).data.pearls.bag, [{ uid: UID, kind: 'brasa' }]);
  assert.equal((await store.loadUnique(UID)).holder, A);
  assert.deepEqual(await store.commitPearl(expected), { ...expectedResult, replay: true });
});

test('operation shape is validated and moves preserve every unrelated UID', async () => {
  const store = createMemoryStore();
  const otherUid = 'unrelated-pearl';
  const source = profile(0, ['brasa']);
  source.pearls.bag.push({ uid: otherUid, kind: 'tinta' });
  const beforeGrant = profile();
  beforeGrant.pearls.bag.push({ uid: otherUid, kind: 'tinta' });
  await store.initializeProfile(A, beforeGrant);
  await store.initializeProfile(B, profile());
  const create = grant(A, source, op(60));
  create.profiles[0].expectedVersion = 1;
  assert.equal((await store.commitPearl(create)).ok, true);

  const changedOther = transfer(A, B, 1, 2, 1, profile(), profile(0, ['brasa']), op(61));
  assert.deepEqual(await store.commitPearl(changedOther), { ok: false, why: 'ownership' });
  assert.equal((await store.loadProfile(A)).version, 2);
  assert.equal((await store.loadProfile(B)).version, 1);

  const valid = grant(A, profile(0, ['brasa']), op(62));
  const malformed = [
    { ...valid, from: A },
    { ...valid, from: A, to: A },
    { ...valid, expectedVersion: -1 },
    { ...valid, profiles: [endpoint(B, 1, profile(0, ['brasa']))] },
    { ...valid, profiles: [valid.profiles[0], valid.profiles[0]] },
  ];
  for (const request of malformed) await assert.rejects(store.commitPearl(request), { code: 'operation' });
});

test('lost response after commit can be retried through the Supabase adapter without repeating effects', async () => {
  const memory = createMemoryStore();
  await memory.initializeProfile(A, profile(3));
  const request = grant(A, profile(3, ['brasa']), op(40));
  let calls = 0;
  const adapter = createSupabaseStore({ async rpc(name, args) {
    if (name !== 'mn_commit_pearl') throw new Error('unexpected RPC');
    calls++;
    const result = await memory.commitPearl({ ...args.p_request, operationId: args.p_operation_id });
    if (calls === 1) throw new Error('simulated transport loss after commit');
    return { data: result };
  } });

  await assert.rejects(adapter.commitPearl(request), (error) => error.code === 'unavailable' && !error.message.includes('transport'));
  const retry = await adapter.commitPearl(request);
  assert.equal(retry.ok, true);
  assert.equal(retry.replay, true);
  assert.equal(calls, 2);
  assert.equal((await memory.loadProfile(A)).version, 2);
  assert.equal((await memory.loadUnique(UID)).version, 1);
});

test('Supabase pearl reads and commits reject corrupted provider responses and redact errors', async () => {
  const request = grant(A, profile(0, ['brasa']), op(50));
  const malformed = createSupabaseStore({ async rpc(name) {
    return { data: name === 'mn_load_unique' ? { kind: 'pearl:brasa', holder: 'not-a-uuid', version: 1 } : { ok: true, replay: false, profiles: [], unique: {} } };
  } });
  await assert.rejects(malformed.loadUnique(UID), { code: 'response' });
  await assert.rejects(malformed.commitPearl(request), { code: 'response' });

  const secret = 'provider-internal-service-role-secret';
  const failed = createSupabaseStore({ async rpc() { return { error: { message: secret, code: 'XX000' } }; } });
  await assert.rejects(failed.commitPearl(request), (error) => error.code === 'unavailable' && !error.message.includes(secret));
});
