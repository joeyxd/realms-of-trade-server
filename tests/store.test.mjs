import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSupabaseStore, playerKey, StoreError, storeFromEnv } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function profile(gold = 0) {
  const value = newProfile();
  value.gold = gold;
  return value;
}

test('memory profile roundtrip sanitizes and returns isolated snapshots', async () => {
  const store = createMemoryStore();
  const input = profile(41);
  input.lvl = 999999;
  input.unrecognized = 'discard me';
  assert.deepEqual(await store.loadProfile(A), null);
  assert.deepEqual(await store.saveProfile(A, input, 0), { ok: true, version: 1 });

  const first = await store.loadProfile(A);
  assert.equal(first.version, 1);
  assert.equal(first.data.gold, 41);
  assert.equal(first.data.lvl, 10);
  assert.equal(Object.hasOwn(first.data, 'unrecognized'), false);
  first.data.gold = -10;
  first.data.flags.tier = 999;
  const second = await store.loadProfile(A);
  assert.equal(second.data.gold, 41);
  assert.notEqual(second.data.flags.tier, 999);

  const worldInput = { stock: { rum: 7 } };
  assert.deepEqual(await store.saveWorld('isla-1', worldInput, 0), { ok: true, version: 1 });
  worldInput.stock.rum = 0;
  const world = await store.loadWorld('isla-1');
  assert.equal(world.data.stock.rum, 7);
  world.data.stock.rum = 12;
  assert.equal((await store.loadWorld('isla-1')).data.stock.rum, 7);
});

test('memory store rejects invalid identity, data and unknown profile versions', async () => {
  const store = createMemoryStore();
  assert.throws(() => playerKey('not-a-uuid'), (e) => e instanceof StoreError && e.code === 'identity');
  await assert.rejects(store.loadProfile('not-a-uuid'), { code: 'identity' });
  await assert.rejects(store.saveProfile(A, { ...profile(), v: 2 }, 0), { code: 'profile' });
  await assert.rejects(store.saveProfile(A, [], 0), { code: 'data' });
  await assert.rejects(store.saveWorld('x', null, 0), { code: 'data' });
  await assert.rejects(store.saveWorld('x', {}, -1), { code: 'version' });
});

test('concurrent create and compare-and-swap writes admit one winner', async () => {
  const store = createMemoryStore();
  const creates = await Promise.all([
    store.saveProfile(A, profile(10), 0),
    store.saveProfile(A, profile(20), 0),
  ]);
  assert.equal(creates.filter((r) => r.ok).length, 1);
  assert.equal(creates.filter((r) => r.why === 'conflict').length, 1);
  const before = await store.loadProfile(A);
  const updates = await Promise.all([
    store.saveProfile(A, profile(30), before.version),
    store.saveProfile(A, profile(40), before.version),
  ]);
  assert.equal(updates.filter((r) => r.ok).length, 1);
  assert.equal(updates.filter((r) => r.why === 'conflict').length, 1);
  assert.equal((await store.loadProfile(A)).version, 2);
});

test('world state is isolated by key and each key has independent CAS versions', async () => {
  const store = createMemoryStore();
  assert.deepEqual(await store.saveWorld('north', { n: 1 }, 0), { ok: true, version: 1 });
  assert.deepEqual(await store.saveWorld('south', { n: 9 }, 0), { ok: true, version: 1 });
  const results = await Promise.all([
    store.saveWorld('north', { n: 2 }, 1),
    store.saveWorld('north', { n: 3 }, 1),
    store.saveWorld('south', { n: 10 }, 1),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(results.filter((r) => r.why === 'conflict').length, 1);
  assert.equal((await store.loadWorld('north')).version, 2);
  assert.equal((await store.loadWorld('south')).version, 2);
});

test('unique ownership arbitrates competing owners and release generations', async () => {
  const store = createMemoryStore();
  const claims = await Promise.all([
    store.claimUnique('relic:1', 'relic', A),
    store.claimUnique('relic:1', 'relic', B),
  ]);
  assert.equal(claims.filter((r) => r.ok).length, 1);
  assert.equal(claims.filter((r) => r.why === 'occupied').length, 1);
  const winner = claims.find((r) => r.ok);
  const loser = claims.filter((r) => !r.ok)[0];
  const owner = winner === claims[0] ? A : B;
  const other = owner === A ? B : A;
  assert.equal(loser.why, 'occupied');
  assert.deepEqual(await store.claimUnique('relic:1', 'different-kind', other), { ok: false, why: 'kind' });
  assert.deepEqual(await store.releaseUnique('relic:1', owner, winner.version), { ok: true, version: 2 });
  const reacquired = await store.claimUnique('relic:1', 'relic', owner);
  assert.deepEqual(reacquired, { ok: true, version: 3 });
  assert.deepEqual(await store.releaseUnique('relic:1', owner, winner.version), { ok: false, why: 'conflict' });
  assert.deepEqual(await store.releaseUnique('relic:1', owner, reacquired.version), { ok: true, version: 4 });
});

test('Supabase adapter uses fixed RPC names, validated arguments and sanitized records', async () => {
  const calls = [];
  const rpcReplies = [
    { data: { data: { ...profile(999999), unknown: true }, version: 2 } },
    { data: { ok: true, version: 3 } },
    { data: { data: { stock: { rum: 4 }, ignored: true }, version: 1 } },
    { data: { ok: false, why: 'kind' } },
  ];
  const store = createSupabaseStore({ async rpc(name, args) { calls.push({ name, args }); return rpcReplies.shift(); } });
  const p = await store.loadProfile(A.toUpperCase());
  assert.equal(p.data.gold, 999999);
  assert.equal(Object.hasOwn(p.data, 'unknown'), false);
  assert.deepEqual(await store.saveProfile(A, profile(2), 2), { ok: true, version: 3 });
  const world = await store.loadWorld('world');
  assert.deepEqual(world.data, { stock: { rum: 4 }, ignored: true });
  assert.deepEqual(await store.claimUnique('u', 'blade', B), { ok: false, why: 'kind' });
  assert.deepEqual(calls, [
    { name: 'mn_load_profile', args: { p_player_id: A, } },
    { name: 'mn_save_profile', args: { p_player_id: A, p_data: profile(2), p_expected_version: 2 } },
    { name: 'mn_load_world', args: { p_world: 'world' } },
    { name: 'mn_claim_unique', args: { p_uid: 'u', p_kind: 'blade', p_holder: B } },
  ]);
});

test('Supabase adapter rejects malformed responses and redacts provider errors', async () => {
  const bad = createSupabaseStore({ async rpc() { return { data: 'malformed-record' }; } });
  await assert.rejects(bad.loadWorld('world'), { code: 'response' });
  const secret = 'service-role-key-must-not-escape';
  const broken = createSupabaseStore({ async rpc() { throw new Error(secret); } });
  await assert.rejects(broken.loadWorld('world'), (e) => e.code === 'unavailable' && !e.message.includes(secret));
});

test('storeFromEnv uses memory only when credentials are both absent and configures service auth', () => {
  assert.equal(storeFromEnv({}, () => { throw new Error('must not be called'); }).kind, 'memory');
  for (const env of [{ SUPABASE_URL: 'https://example.supabase.co' }, { SUPABASE_SERVICE_KEY: 'key' }]) {
    assert.throws(() => storeFromEnv(env, () => ({})), { code: 'configuration' });
  }
  let received;
  const configured = storeFromEnv({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-secret' }, (...args) => {
    received = args;
    return { rpc() {} };
  });
  assert.equal(configured.kind, 'supabase');
  assert.equal(received[0], 'https://example.supabase.co');
  assert.equal(received[1], 'service-secret');
  assert.deepEqual(received[2].auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  assert.equal(typeof received[2].global.fetch, 'function');
});
