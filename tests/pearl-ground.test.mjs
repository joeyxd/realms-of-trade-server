import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WORLD = 'isla:calavera';
const UID = 'ground-pearl-1';
const UID2 = 'ground-pearl-2';
const UID3 = 'ground-pearl-3';
const op = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile = (gold = 0, pearls = []) => {
  const p = newProfile();
  p.gold = gold;
  p.pearls.bag = pearls.map(({ uid = UID, kind = 'brasa' } = {}) => ({ uid, kind }));
  return p;
};
const pearl = (uid = UID, kind = 'brasa') => ({ uid, kind });
const endpoint = (id, expectedVersion, data) => ({ id, expectedVersion, data });
const coords = (x = 12.5, z = -7.25, availableAt = 1000, returnAt = 91000) => ({ x, z, availableAt, returnAt });
const request = ({ operationId = op(1), uid = UID, kind = 'brasa', from = null, to = null,
  expectedVersion = 0, profiles = [], world = WORLD, ground = coords() } = {}) => ({
  operationId, uid, kind, from, to, expectedVersion, profiles, world, ground,
});
async function account(store, id, data = profile()) { assert.equal((await store.saveProfile(id, data, 0)).ok, true); }

test('ground mint, pickup, transfer, sale, relocation and replay retain one UID generation', async () => {
  const store = createMemoryStore();
  await account(store, A); await account(store, B, profile(10));

  const mint = request({ operationId: op(1) });
  const minted = await store.commitPearlGround(mint);
  assert.equal(minted.ok, true); assert.equal(minted.replay, false);
  assert.deepEqual(minted.location, { uid: UID, world: WORLD, ground: mint.ground, version: 1 });
  assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: null, version: 1 });

  const pickupData = profile(0, [pearl()]);
  const pickup = request({ operationId: op(2), expectedVersion: 1, to: A, ground: null,
    profiles: [endpoint(A, 1, pickupData)] });
  const picked = await store.commitPearlGround(pickup);
  assert.deepEqual(picked.location, { uid: UID, world: WORLD, ground: null, version: 2 });
  assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: null, version: 2 });

  const transfer = request({ operationId: op(3), from: A, to: B, expectedVersion: 2, ground: null,
    profiles: [endpoint(A, 2, profile()), endpoint(B, 1, profile(10, [pearl()]))] });
  assert.equal((await store.commitPearlGround(transfer)).location.version, 3);
  const release = request({ operationId: op(4), from: B, expectedVersion: 3, ground: coords(4, 5, 2000, 92000),
    profiles: [endpoint(B, 2, profile(610))] });
  const released = await store.commitPearlGround(release);
  assert.deepEqual(released.location, { uid: UID, world: WORLD, ground: release.ground, version: 4 });
  assert.equal((await store.loadProfile(B)).data.gold, 610);
  const releaseReplay = await store.commitPearlGround(release);
  assert.equal(releaseReplay.replay, true);
  assert.deepEqual(releaseReplay.location, released.location);
  assert.equal((await store.loadProfile(B)).version, 3);
  assert.equal((await store.loadProfile(B)).data.gold, 610);

  const relocate = request({ operationId: op(5), expectedVersion: 4, ground: coords(-2, 8, 3000, 93000) });
  const relocated = await store.commitPearlGround(relocate);
  assert.deepEqual(relocated.location, { uid: UID, world: WORLD, ground: relocate.ground, version: 5 });
  const replay = await store.commitPearlGround(relocate);
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.location, relocated.location);
  assert.equal((await store.loadProfile(B)).version, 3, 'sale replay does not credit gold again');
  assert.equal((await store.loadProfile(B)).data.gold, 610);
  assert.deepEqual(await store.commitPearlGround({ ...relocate, ground: coords(50, 60, 3000, 93000) }), { ok: false, why: 'operation' });
});

test('ground listing is sorted, paged by UID, isolated by world and retains expired rows', async () => {
  const store = createMemoryStore();
  for (const [index, uid] of ['pearl-z', 'pearl-a', 'pearl-m', 'pearl-b'].entries()) {
    assert.equal((await store.commitPearlGround(request({ uid, operationId: op(10 + index),
      ground: coords(index, -index, 0, 1) }))).ok, true);
  }
  await store.commitPearlGround(request({ uid: 'other-world-pearl', operationId: op(20), world: 'otra-isla' }));
  const first = await store.listPearlGround(WORLD, { afterUid: null, limit: 2 });
  assert.deepEqual(first.map((row) => row.uid), ['pearl-a', 'pearl-b']);
  assert.equal(first[0].kind, 'brasa');
  assert.equal(first[0].returnAt, undefined);
  const second = await store.listPearlGround(WORLD, { afterUid: first.at(-1).uid, limit: 2 });
  assert.deepEqual(second.map((row) => row.uid), ['pearl-m', 'pearl-z']);
  assert.equal(second[0].ground.returnAt, 1, 'expired rows remain available for recovery scans');
  assert.deepEqual(await store.listPearlGround('otra-isla', { afterUid: null, limit: 64 }).then((rows) => rows.map((r) => r.uid)), ['other-world-pearl']);
  await assert.rejects(store.listPearlGround(WORLD, { afterUid: null, limit: 0 }), { code: 'operation' });
});

test('contending pickups admit one owner and stale profile CAS cannot partially drop a pearl', async () => {
  const store = createMemoryStore();
  await account(store, A); await account(store, B);
  await store.commitPearlGround(request());
  const results = await Promise.all([A, B].map((id, i) => store.commitPearlGround(request({
    operationId: op(70 + i), to: id, expectedVersion: 1, ground: null,
    profiles: [endpoint(id, 1, profile(0, [pearl()]))],
  }))));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.deepEqual(results.find((r) => !r.ok), { ok: false, why: 'conflict' });
  const owner = results[0].ok ? A : B, other = owner === A ? B : A;
  assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: owner, version: 2 });
  assert.equal((await store.loadProfile(other)).version, 1);
  assert.deepEqual((await store.loadProfile(other)).data.pearls.bag, []);
  const confirmed = await store.loadProfile(owner), progress = structuredClone(confirmed.data);
  progress.gold = 10;
  await store.saveProfile(owner, progress, confirmed.version);
  const staleDrop = request({ operationId: op(72), from: owner, expectedVersion: 2,
    profiles: [endpoint(owner, confirmed.version, profile(600))] });
  assert.deepEqual(await store.commitPearlGround(staleDrop), { ok: false, why: 'conflict' });
  assert.deepEqual(await store.loadProfile(owner), { data: progress, version: 3 });
  assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: null, version: 2 });
  assert.equal(await store.loadPearlGroundOperation(op(72)), null);
});

test('world and kind mismatches, pickup without ground and stale generations leave all state unchanged', async () => {
  const store = createMemoryStore();
  await account(store, A); await account(store, B);
  await store.commitPearlGround(request({ operationId: op(21) }));

  const wrongKind = await store.commitPearlGround(request({ operationId: op(22), kind: 'tinta', expectedVersion: 1 }));
  assert.deepEqual(wrongKind, { ok: false, why: 'kind' });
  const wrongWorld = await store.commitPearlGround(request({ operationId: op(23), expectedVersion: 1, to: A,
    world: 'otra-isla', ground: null, profiles: [endpoint(A, 1, profile(0, [pearl()]))] }));
  assert.deepEqual(wrongWorld, { ok: false, why: 'ownership' });
  const pickup = await store.commitPearlGround(request({ operationId: op(24), expectedVersion: 1, to: A,
    ground: null, profiles: [endpoint(A, 1, profile(0, [pearl()]))] }));
  assert.equal(pickup.ok, true);
  const noGroundPickup = await store.commitPearlGround(request({ operationId: op(25), expectedVersion: 2, to: B,
    ground: null, profiles: [endpoint(B, 1, profile(0, [pearl()]))] }));
  assert.deepEqual(noGroundPickup, { ok: false, why: 'conflict' });
  const worldMismatch = await store.commitPearlGround(request({ operationId: op(27), expectedVersion: 2, to: B,
    ground: null, world: 'different-world', profiles: [endpoint(B, 1, profile(0, [pearl()]))] }));
  assert.deepEqual(worldMismatch, { ok: false, why: 'conflict' });
  const stale = await store.commitPearlGround(request({ operationId: op(26), expectedVersion: 1,
    ground: coords(1, 2, 10, 20) }));
  assert.deepEqual(stale, { ok: false, why: 'conflict' });
  assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: null, version: 2 });
  assert.equal((await store.loadProfile(A)).version, 2);
  assert.equal(await store.loadProfile(B).then((r) => r.version), 1);
});

test('tracked and historical UIDs reject legacy bypasses, unregistered claims and contradictory raw saves', async () => {
  const store = createMemoryStore();
  await account(store, A); await account(store, B);
  const owned = { operationId: op(30), uid: UID, kind: 'brasa', from: null, to: A, expectedVersion: 0,
    profiles: [endpoint(A, 1, profile(0, [pearl()]))] };
  assert.equal((await store.commitPearl(owned)).ok, true);
  const ground = request({ operationId: op(31), from: A, expectedVersion: 1, profiles: [endpoint(A, 2, profile())] });
  const dropped = await store.commitPearlGround(ground);
  assert.equal(dropped.location.version, 2);
  const legacyMove = await store.commitPearl({ operationId: op(32), uid: UID, kind: 'brasa', from: null, to: B,
    expectedVersion: 2, profiles: [endpoint(B, 1, profile(0, [pearl()]))] });
  assert.equal(legacyMove.ok, false);
  assert.ok(['operation', 'ownership'].includes(legacyMove.why));
  await assert.rejects(store.saveProfile(B, profile(0, [pearl()]), 1), { code: 'ownership' });
  assert.equal((await store.loadProfile(A)).version, 3);
  assert.equal((await store.loadProfile(B)).version, 1);
  assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground.ground, version: 2 });
  assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: null, version: 2 });

  const owner = await store.loadProfile(A), addHistorical = structuredClone(owner.data);
  addHistorical.pearls.bag.push(pearl(UID2));
  assert.equal((await store.commitPearl({ operationId: op(33), uid: UID2, kind: 'brasa', from: null, to: A,
    expectedVersion: 0, profiles: [endpoint(A, owner.version, addHistorical)] })).ok, true);
  const held = await store.loadProfile(A), removeHistorical = structuredClone(held.data);
  removeHistorical.pearls.bag = removeHistorical.pearls.bag.filter((q) => q.uid !== UID2);
  assert.equal((await store.commitPearl({ operationId: op(34), uid: UID2, kind: 'brasa', from: A, to: null,
    expectedVersion: 1, profiles: [endpoint(A, held.version, removeHistorical)] })).ok, true);
  const pickupWithoutRecordedGround = await store.commitPearlGround(request({ operationId: op(35), uid: UID2,
    expectedVersion: 2, to: B, ground: null, profiles: [endpoint(B, 1, profile(0, [pearl(UID2)]))] }));
  assert.deepEqual(pickupWithoutRecordedGround, { ok: false, why: 'ownership' });

  const unregistered = await store.initializeProfile(C, profile(0, [pearl(UID3)]));
  const adoption = await store.commitPearlGround(request({ operationId: op(36), uid: UID3, from: C,
    expectedVersion: 1, profiles: [endpoint(C, unregistered.version, profile())] }));
  assert.deepEqual(adoption, { ok: false, why: 'conflict' });
  assert.equal(await store.loadPearlLocation(UID3), null);
});

test('legacy receipt IDs cannot be converted into ground-family operations', async () => {
  const store = createMemoryStore();
  await account(store, A); await account(store, B);
  const original = { operationId: op(40), uid: UID, kind: 'brasa', from: null, to: A, expectedVersion: 0,
    profiles: [endpoint(A, 1, profile(0, [pearl()]))] };
  assert.equal((await store.commitPearl(original)).ok, true);
  const conversion = request({ operationId: op(40), from: A, expectedVersion: 1, ground: coords(),
    profiles: [endpoint(A, 2, profile())] });
  assert.deepEqual(await store.commitPearlGround(conversion), { ok: false, why: 'operation' });
  assert.equal(await store.loadPearlLocation(UID), null);
  assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: A, version: 1 });

  const groundMint = request({ operationId: op(41), uid: UID2 });
  assert.equal((await store.commitPearlGround(groundMint)).ok, true);
  const reverseConversion = await store.commitPearl({ operationId: op(41), uid: UID2, kind: 'brasa',
    from: null, to: B, expectedVersion: 1, profiles: [endpoint(B, 1, profile(0, [pearl(UID2)]))] });
  assert.deepEqual(reverseConversion, { ok: false, why: 'operation' });
  assert.equal((await store.loadProfile(B)).version, 1);
  assert.deepEqual(await store.loadPearlLocation(UID2), { world: WORLD, ground: groundMint.ground, version: 1 });
});

test('invalid ground DTOs and detached request, result and receipt snapshots are enforced', async () => {
  const store = createMemoryStore();
  const base = request({ operationId: op(50) });
  const invalid = [
    { ...base, world: 'bad world' },
    { ...base, ground: { ...base.ground, x: Infinity } },
    { ...base, ground: { ...base.ground, z: 1_000_001 } },
    { ...base, ground: { ...base.ground, availableAt: 1.5 } },
    { ...base, ground: { ...base.ground, returnAt: base.ground.availableAt } },
    { ...base, ground: null },
  ];
  for (const value of invalid) {
    await assert.rejects(store.commitPearlGround(value), (error) => error.code === 'operation');
  }

  const ground = structuredClone(base.ground);
  const good = { ...base, ground };
  const result = await store.commitPearlGround(good);
  const originalLocation = structuredClone(result.location);
  good.ground.x = 999;
  result.location.ground.z = 999;
  assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: originalLocation.ground, version: 1 });
  const receipt = await store.loadPearlGroundOperation(op(50));
  assert.deepEqual(receipt.result.location, originalLocation);
  receipt.request.ground.x = -999;
  assert.equal((await store.loadPearlGroundOperation(op(50))).request.ground.x, originalLocation.ground.x);
});

test('mocked Supabase SDK validates ground RPCs, bounded result DTOs, receipts and fixed errors', async () => {
  const ground = coords(8, 9, 4, 100);
  const location = { world: WORLD, ground, version: 1 };
  const row = { uid: UID, kind: 'brasa', world: WORLD, ground, version: 1 };
  const requestBody = { uid: UID, kind: 'brasa', from: null, to: null,
    expectedVersion: 0, profiles: [], world: WORLD, ground };
  const resultBody = { ok: true, replay: false, profiles: [], unique: { uid: UID, kind: 'pearl:brasa', holder: null, version: 1 },
    location: { uid: UID, world: WORLD, ground, version: 1 } };
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'mn_commit_pearl_ground') return { data: resultBody };
      if (name === 'mn_load_pearl_location') return { data: location };
      if (name === 'mn_list_pearl_ground') return { data: [row] };
      if (name === 'mn_load_pearl_ground_operation') return { data: { request: requestBody, result: resultBody } };
      throw new Error('unexpected RPC');
    },
  };
  const store = createSupabaseStore(client);
  const committed = await store.commitPearlGround(request({ operationId: op(60), ground }));
  assert.deepEqual(committed.location, resultBody.location);
  assert.deepEqual(await store.loadPearlLocation(UID), location);
  assert.deepEqual(await store.listPearlGround(WORLD, { afterUid: null, limit: 64 }), [row]);
  const receipt = await store.loadPearlGroundOperation(op(60));
  assert.deepEqual(receipt.request, requestBody);
  assert.ok(calls.some((call) => call.name === 'mn_commit_pearl_ground' && call.args.p_operation_id === op(60)));
  assert.ok(calls.some((call) => call.name === 'mn_load_pearl_ground_operation' && call.args.p_operation_id === op(60)));

  const malformed = createSupabaseStore({ ...client, async rpc(name) {
    if (name === 'mn_load_pearl_location') return { data: { world: WORLD, ground: { ...ground, x: Infinity }, version: 1 } };
    if (name === 'mn_list_pearl_ground') return { data: [{ ...row, version: -1 }] };
    return { data: { ...resultBody, location: { ...resultBody.location, ground: null } } };
  } });
  await assert.rejects(malformed.loadPearlLocation(UID), { code: 'response' });
  await assert.rejects(malformed.listPearlGround(WORLD, { afterUid: null, limit: 64 }), { code: 'response' });
  await assert.rejects(malformed.commitPearlGround(request({ operationId: op(61) })), { code: 'response' });
  const providerSecret = 'ground-rpc-provider-secret';
  const failed = createSupabaseStore({ rpc: async () => ({ error: { message: providerSecret, code: 'XX000' } }) });
  await assert.rejects(failed.commitPearlGround(request({ operationId: op(62) })),
    (error) => error.code === 'unavailable' && !error.message.includes(providerSecret));
});
