import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UID = 'sql-ground-pearl-1';
const UID2 = 'sql-ground-pearl-2';
const UID3 = 'sql-ground-pearl-3';
const UID4 = 'sql-ground-pearl-4';
const WORLD = 'island:coral';
const op = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migrations = await Promise.all([
  '001_store.sql', '002_accounts.sql', '003_pearl_operations.sql', '004_pearl_ground.sql',
  '005_pearl_journal.sql', '006_pearl_same_holder.sql',
].map((name) => readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8')));
const profile = (gold = 0, pearl = false) => {
  const value = newProfile();
  value.gold = gold;
  if (pearl) value.pearls.bag = [{ uid: UID, kind: 'brasa' }];
  return value;
};
const profileWith = (uid, gold = 0, pearl = false) => {
  const value = newProfile();
  value.gold = gold;
  if (pearl) value.pearls.bag = [{ uid, kind: 'brasa' }];
  return value;
};
const addPearl = (data, uid) => {
  const next = structuredClone(data);
  next.pearls.bag.push({ uid, kind: 'brasa' });
  return next;
};
const endpoint = (id, expectedVersion, data) => ({ id, expectedVersion, data });
const ground = (x = 12, z = -4, availableAt = 100, returnAt = 200) => ({ x, z, availableAt, returnAt });
const mint = (operationId = op(1), patch = {}) => ({
  operationId, uid: UID, kind: 'brasa', from: null, to: null, expectedVersion: 0,
  profiles: [], world: WORLD, ground: ground(), ...patch,
});
const groundMove = (operationId, expectedVersion, patch = {}) => ({
  operationId, uid: UID, kind: 'brasa', from: null, to: null, expectedVersion,
  profiles: [], world: WORLD, ground: ground(15, -7, 300, 400), ...patch,
});
const pickup = (id, operationId, version, profileVersion, data) => ({
  operationId, uid: UID, kind: 'brasa', from: null, to: id, expectedVersion: version,
  profiles: [endpoint(id, profileVersion, data)], world: WORLD, ground: null,
});
const drop = (id, operationId, version, profileVersion, data, spot = ground(22, 9, 500, 600)) => ({
  operationId, uid: UID, kind: 'brasa', from: id, to: null, expectedVersion: version,
  profiles: [endpoint(id, profileVersion, data)], world: WORLD, ground: spot,
});

function rpcFetchFor(db, requests = []) {
  const functions = {
    mn_load_profile: (a) => db.query('select public.mn_load_profile($1::uuid) as data', [a.p_player_id]),
    mn_initialize_profile: (a) => db.query('select public.mn_initialize_profile($1::uuid, $2::jsonb, $3::text) as data', [a.p_player_id, a.p_data, a.p_legacy_key]),
    mn_save_profile: (a) => db.query('select public.mn_save_profile($1::uuid, $2::jsonb, $3::integer) as data', [a.p_player_id, a.p_data, a.p_expected_version]),
    mn_load_unique: (a) => db.query('select public.mn_load_unique($1::text) as data', [a.p_uid]),
    mn_commit_pearl: (a) => db.query('select public.mn_commit_pearl($1::uuid, $2::jsonb) as data', [a.p_operation_id, a.p_request]),
    mn_claim_unique: (a) => db.query('select public.mn_claim_unique($1::text, $2::text, $3::uuid) as data', [a.p_uid, a.p_kind, a.p_holder]),
    mn_release_unique: (a) => db.query('select public.mn_release_unique($1::text, $2::uuid, $3::integer) as data', [a.p_uid, a.p_holder, a.p_version]),
    mn_commit_pearl_ground: (a) => db.query('select public.mn_commit_pearl_ground($1::uuid, $2::jsonb) as data', [a.p_operation_id, a.p_request]),
    mn_load_pearl_location: (a) => db.query('select public.mn_load_pearl_location($1::text) as data', [a.p_uid]),
    mn_list_pearl_ground: (a) => db.query('select public.mn_list_pearl_ground($1::text, $2::text, $3::integer) as data', [a.p_world, a.p_after_uid, a.p_limit]),
    mn_load_pearl_ground_operation: (a) => db.query('select public.mn_load_pearl_ground_operation($1::uuid) as data', [a.p_operation_id]),
  };
  return async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1);
    requests.push({ method: init.method, name, body: JSON.parse(init.body ?? '{}'), contentType: new Headers(init.headers).get('content-type') });
    const run = functions[name];
    if (!run) return new Response(JSON.stringify({ message: 'Unknown RPC', code: '42883' }), { status: 404, headers: { 'content-type': 'application/json' } });
    try {
      const args = JSON.parse(init.body ?? '{}');
      const result = await run(args);
      return new Response(JSON.stringify(result.rows[0].data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: error.message, code: error.code ?? 'XX000' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
}

function sdkStoreFor(db, requests = []) {
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: rpcFetchFor(db, requests) },
  });
  return createSupabaseStore(client);
}

async function freshDatabase() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  for (const migration of migrations) await db.exec(migration);
  await db.exec('SET ROLE service_role');
  return db;
}

test('SQL ground mint, reads, pickup, transfer, sale, drop and restore preserve UID generations', async () => {
  const db = await freshDatabase();
  try {
    const requests = [], store = sdkStoreFor(db, requests);
    await store.saveProfile(A, profile(10), 0);
    await store.saveProfile(B, profile(20), 0);
    const created = await store.commitPearlGround(mint());
    assert.equal(created.ok, true);
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(), version: 1 });
    assert.deepEqual(await store.listPearlGround(WORLD, { afterUid: null, limit: 64 }), [
      { uid: UID, kind: 'brasa', world: WORLD, ground: ground(), version: 1 },
    ]);
    const mintRequest = { ...mint() };
    delete mintRequest.operationId;
    assert.deepEqual((await store.loadPearlGroundOperation(op(1))).request, mintRequest);
    assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: null, version: 1 });

    assert.equal((await store.commitPearlGround(pickup(A, op(2), 1, 1, profile(10, true)))).ok, true);
    const moved = { ...profile(20, true) };
    assert.equal((await store.commitPearlGround({
      operationId: op(3), uid: UID, kind: 'brasa', from: A, to: B, expectedVersion: 2,
      profiles: [endpoint(A, 2, profile(10)), endpoint(B, 1, moved)], world: WORLD, ground: null,
    })).ok, true);
    const saleData = profile(620);
    assert.equal((await store.commitPearlGround({
      operationId: op(4), uid: UID, kind: 'brasa', from: B, to: null, expectedVersion: 3,
      profiles: [endpoint(B, 2, saleData)], world: WORLD, ground: ground(30, 12, 450, 550),
    })).ok, true);
    assert.equal((await store.loadProfile(B)).data.gold, 620);
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(30, 12, 450, 550), version: 4 });
    assert.equal((await store.commitPearlGround({
      operationId: op(5), uid: UID, kind: 'brasa', from: null, to: null, expectedVersion: 4,
      profiles: [], world: WORLD, ground: ground(22, 9, 500, 600),
    })).ok, true);
    const replay = await store.commitPearlGround({
      operationId: op(5), uid: UID, kind: 'brasa', from: null, to: null, expectedVersion: 4,
      profiles: [], world: WORLD, ground: ground(22, 9, 500, 600),
    });
    assert.equal(replay.replay, true);
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(22, 9, 500, 600), version: 5 });
    assert.equal((await store.commitPearlGround(pickup(A, op(6), 5, 3, profile(10, true)))).ok, true);
    assert.equal((await store.commitPearlGround(drop(A, op(7), 6, 4, profile(10)))).ok, true);
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(22, 9, 500, 600), version: 7 });
    assert.equal((await store.commitPearlGround(pickup(A, op(2), 1, 1, profile(10, true)))).replay, true);
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(22, 9, 500, 600), version: 7 });
    assert.ok(requests.some((r) => r.name === 'mn_list_pearl_ground' && r.body.p_world === WORLD && r.body.p_after_uid === null && r.body.p_limit === 64));
  } finally { await db.close(); }
});

test('ground replay payload, stale generation, wrong kind/world and missing-ground pickup leave state unchanged', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    assert.deepEqual(await store.commitPearlGround(pickup(A, op(5), 1, 1, profile(0, true))), { ok: false, why: 'conflict' });
    assert.equal(await store.loadPearlLocation(UID), null);
    assert.equal((await store.commitPearlGround(mint())).ok, true);
    assert.deepEqual(await store.commitPearlGround({ ...mint(), ground: ground(99) }), { ok: false, why: 'operation' });
    assert.deepEqual(await store.commitPearlGround(groundMove(op(2), 8)), { ok: false, why: 'conflict' });
    assert.deepEqual(await store.commitPearlGround(groundMove(op(3), 1, { world: 'other:world' })), { ok: false, why: 'ownership' });
    assert.deepEqual(await store.commitPearlGround(groundMove(op(4), 1, { kind: 'tinta' })), { ok: false, why: 'kind' });
    assert.deepEqual(await store.commitPearlGround({ ...pickup(A, op(5), 1, 1, profile(0, true)), world: 'other:world' }), { ok: false, why: 'ownership' });
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(), version: 1 });
    assert.equal((await store.loadProfile(A)).version, 1);
    assert.equal(await store.loadPearlGroundOperation(op(2)), null);
  } finally { await db.close(); }
});

test('failed location upsert rolls profile, UID and ground receipt back together', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.commitPearlGround(mint());
    await db.exec(`
      RESET ROLE;
      CREATE FUNCTION public.mn_test_fail_ground_location() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected ground location failure'; END $$;
      CREATE TRIGGER mn_test_fail_ground_location BEFORE INSERT OR UPDATE ON public.mn_pearl_locations
        FOR EACH ROW EXECUTE FUNCTION public.mn_test_fail_ground_location();
      SET ROLE service_role;
    `);
    const attempted = pickup(A, op(20), 1, 1, profile(0, true));
    await assert.rejects(store.commitPearlGround(attempted), { code: 'unavailable' });
    assert.equal((await store.loadProfile(A)).version, 1);
    assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: null, version: 1 });
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(), version: 1 });
    assert.equal(await store.loadPearlGroundOperation(op(20)), null);
    assert.equal((await db.query('select count(*)::int as n from public.mn_pearl_operations where operation_id = $1::uuid', [op(20)])).rows[0].n, 0);
  } finally { await db.close(); }
});

test('tracked ground UID cannot be changed through D09a RPC or raw profile location writes', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.commitPearlGround(mint());
    await assert.rejects(db.query('select public.mn_commit_pearl($1::uuid, $2::jsonb)', [op(30), {
      uid: UID, kind: 'brasa', from: null, to: A, expectedVersion: 1,
      profiles: [endpoint(A, 1, profile(0, true))],
    }]), (error) => error.code === 'MNP01' || error.code === 'MNP02' || error.code === '42501');
    await assert.rejects(store.saveProfile(A, profile(0, true), 1), { code: 'ownership' });
    await assert.rejects(db.query('update public.mn_pearl_locations set ground = $2::jsonb where uid = $1', [UID, ground(88)]), (error) => error.code === 'MNP01' || error.code === 'MNP02');
    assert.equal((await store.loadProfile(A)).version, 1);
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(), version: 1 });
  } finally { await db.close(); }
});

test('ground paging uses stable ASCII UID order, filters worlds and retains expired entries', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    const oldGround = ground(-1000000, 1000000, 1, 2);
    for (const [n, uid, world] of [
      [60, 'z-uid', WORLD], [61, 'a-uid', WORLD], [62, 'A-uid', WORLD], [63, 'a-uid-other-world', 'other:world'],
    ]) assert.equal((await store.commitPearlGround(mint(op(n), { uid, world, ground: oldGround }))).ok, true);
    assert.deepEqual(await store.listPearlGround(WORLD, { afterUid: null, limit: 64 }), [
      { uid: 'A-uid', kind: 'brasa', world: WORLD, ground: oldGround, version: 1 },
      { uid: 'a-uid', kind: 'brasa', world: WORLD, ground: oldGround, version: 1 },
      { uid: 'z-uid', kind: 'brasa', world: WORLD, ground: oldGround, version: 1 },
    ]);
    assert.deepEqual((await store.listPearlGround(WORLD, { afterUid: 'A-uid', limit: 64 })).map((row) => row.uid), ['a-uid', 'z-uid']);
    assert.equal((await store.listPearlGround('other:world', { afterUid: null, limit: 64 }))[0].uid, 'a-uid-other-world');
  } finally { await db.close(); }
});

test('raw location deletion or generation edits cannot bypass the ledger guard; ledger cleanup cascades', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.commitPearlGround(mint());
    await assert.rejects(db.query('delete from public.mn_pearl_locations where uid = $1', [UID]), (error) => error.code === 'MNP01');
    await assert.rejects(db.query('update public.mn_unique_items set version = version + 1 where uid = $1', [UID]), (error) => error.code === 'MNP01');
    await assert.rejects(db.query('update public.mn_pearl_locations set version = version + 1 where uid = $1', [UID]), (error) => error.code === 'MNP01');
    await assert.rejects(db.query("insert into public.mn_pearl_locations(uid, world, ground, version) values ('orphan-ground', $1, $2::jsonb, 2)", [WORLD, ground()]), (error) => error.code === '23503' || error.code === 'MNP01');
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(), version: 1 });
    await db.query('delete from public.mn_unique_items where uid = $1', [UID]);
    assert.equal(await store.loadPearlLocation(UID), null);
  } finally { await db.close(); }
});

test('003 and ground receipts share UUID uniqueness; legacy drops establish location and locationless pickups fail', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.saveProfile(B, profile(), 0);
    assert.equal((await store.commitPearlGround(mint(op(50), { uid: UID2 }))).ok, true);
    const sameGroundReceiptIn003 = await store.commitPearl({
      operationId: op(50), uid: UID2, kind: 'brasa', from: null, to: A, expectedVersion: 0,
      profiles: [endpoint(A, 1, profileWith(UID2, 0, true))],
    });
    assert.deepEqual(sameGroundReceiptIn003, { ok: false, why: 'operation' });

    assert.equal((await store.commitPearl({
      operationId: op(51), uid: UID4, kind: 'brasa', from: null, to: A, expectedVersion: 0,
      profiles: [endpoint(A, 1, profileWith(UID4, 0, true))],
    })).ok, true);
    const same003ReceiptInGround = await store.commitPearlGround({
      operationId: op(51), uid: UID4, kind: 'brasa', from: A, to: null, expectedVersion: 1,
      profiles: [endpoint(A, 2, profile())], world: WORLD, ground: ground(41, 8),
    });
    assert.deepEqual(same003ReceiptInGround, { ok: false, why: 'operation' });
    assert.equal((await store.loadProfile(A)).version, 2);
    assert.equal(await store.loadPearlLocation(UID4), null);
    assert.equal((await store.commitPearlGround({
      operationId: op(52), uid: UID4, kind: 'brasa', from: A, to: null, expectedVersion: 1,
      profiles: [endpoint(A, 2, profile())], world: WORLD, ground: ground(41, 8),
    })).ok, true);
    assert.deepEqual(await store.loadPearlLocation(UID4), { world: WORLD, ground: ground(41, 8), version: 2 });

    assert.equal((await store.commitPearl({
      operationId: op(55), uid: UID3, kind: 'brasa', from: null, to: B, expectedVersion: 0,
      profiles: [endpoint(B, 1, profileWith(UID3, 0, true))],
    })).ok, true);
    assert.equal((await store.commitPearl({
      operationId: op(56), uid: UID3, kind: 'brasa', from: B, to: null, expectedVersion: 1,
      profiles: [endpoint(B, 2, profile())],
    })).ok, true);
    const noGroundPickup = await store.commitPearlGround({
      operationId: op(57), uid: UID3, kind: 'brasa', from: null, to: A, expectedVersion: 2,
      profiles: [endpoint(A, 3, addPearl((await store.loadProfile(A)).data, UID3))], world: WORLD, ground: null,
    });
    assert.deepEqual(noGroundPickup, { ok: false, why: 'ownership' });
    assert.equal((await store.loadProfile(A)).version, 3);
    assert.deepEqual(await store.loadUnique(UID3), { kind: 'pearl:brasa', holder: null, version: 2 });
    assert.equal(await store.loadPearlGroundOperation(op(57)), null);
  } finally { await db.close(); }
});

test('ground commits and tracked profile writes require READ COMMITTED', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.commitPearlGround(mint());
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
    assert.deepEqual(await store.commitPearlGround(groundMove(op(40), 1)), { ok: false, why: 'operation' });
    await assert.rejects(store.saveProfile(A, profile(), 1), { code: 'operation' });
    await db.exec('ROLLBACK');
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(), version: 1 });
    assert.equal((await store.loadProfile(A)).version, 1);
  } finally { await db.close(); }
});

test('004 is idempotent and ground tables, trigger and RPCs remain service-only', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.commitPearlGround(mint());
    await db.exec('RESET ROLE');
    await db.exec(migrations[3]);
    await db.exec('SET ROLE service_role');
    assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: ground(), version: 1 });
    assert.equal((await store.commitPearlGround(mint())).replay, true);
    const protectedTables = ['mn_pearl_locations', 'mn_pearl_ground_operations'];
    const rls = await db.query(`select c.relname, c.relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relname = any($1::text[]) order by c.relname`, [protectedTables]);
    assert.deepEqual(rls.rows.map((r) => [r.relname, r.relrowsecurity]), protectedTables.slice().sort().map((name) => [name, true]));
    await db.exec('RESET ROLE; SET ROLE anon');
    for (const table of protectedTables) await assert.rejects(db.query(`select * from public.${table}`), (error) => error.code === '42501');
    for (const call of [
      `select public.mn_commit_pearl_ground('${op(99)}'::uuid, '{}'::jsonb)`,
      `select public.mn_load_pearl_location('${UID}')`,
      `select public.mn_list_pearl_ground('${WORLD}', null, 64)`,
      `select public.mn_load_pearl_ground_operation('${op(1)}'::uuid)`,
    ]) await assert.rejects(db.query(call), (error) => error.code === '42501');
    await db.exec('RESET ROLE; SET ROLE authenticated');
    await assert.rejects(db.query(`select public.mn_load_pearl_location('${UID}')`), (error) => error.code === '42501');
  } finally { await db.close(); }
});
