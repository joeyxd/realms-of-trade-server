import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UID = 'sql-black-pearl-1';
const op = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migrations = await Promise.all(['001_store.sql', '002_accounts.sql', '003_pearl_operations.sql']
  .map((name) => readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8')));
const profile = (gold = 0, pearl = false) => {
  const value = newProfile();
  value.gold = gold;
  if (pearl) value.pearls.bag = [{ uid: UID, kind: 'brasa' }];
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

function rpcFetchFor(db, requests = []) {
  const functions = {
    mn_load_profile: (a) => db.query('select public.mn_load_profile($1::uuid) as data', [a.p_player_id]),
    mn_initialize_profile: (a) => db.query('select public.mn_initialize_profile($1::uuid, $2::jsonb, $3::text) as data', [a.p_player_id, a.p_data, a.p_legacy_key]),
    mn_save_profile: (a) => db.query('select public.mn_save_profile($1::uuid, $2::jsonb, $3::integer) as data', [a.p_player_id, a.p_data, a.p_expected_version]),
    mn_load_unique: (a) => db.query('select public.mn_load_unique($1::text) as data', [a.p_uid]),
    mn_commit_pearl: (a) => db.query('select public.mn_commit_pearl($1::uuid, $2::jsonb) as data', [a.p_operation_id, a.p_request]),
    mn_claim_unique: (a) => db.query('select public.mn_claim_unique($1::text, $2::text, $3::uuid) as data', [a.p_uid, a.p_kind, a.p_holder]),
    mn_release_unique: (a) => db.query('select public.mn_release_unique($1::text, $2::uuid, $3::integer) as data', [a.p_uid, a.p_holder, a.p_version]),
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
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;`);
  for (const migration of migrations) await db.exec(migration);
  await db.exec('SET ROLE service_role');
  return db;
}

test('SQL pearl operations arbitrate grant, transfer, release, reclaim and exact replays', async () => {
  const db = await freshDatabase();
  try {
    const requests = [], store = sdkStoreFor(db, requests);
    for (const id of [A, B, C]) assert.deepEqual(await store.saveProfile(id, profile(id === B ? 20 : 0), 0), { ok: true, version: 1 });
    const first = await store.commitPearl(grant(A, profile(0, true)));
    assert.deepEqual(first.unique, { uid: UID, kind: 'pearl:brasa', holder: A, version: 1 });
    assert.equal(first.replay, false);
    assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: A, version: 1 });

    const ownerProgress = (await store.loadProfile(A)).data;
    ownerProgress.gold = 11;
    ownerProgress.pearls.bag = [];
    ownerProgress.pearls.swallowed = { uid: UID, kind: 'brasa' };
    assert.deepEqual(await store.saveProfile(A, ownerProgress, 2), { ok: true, version: 3 });
    const sourceAfterTransfer = structuredClone(ownerProgress);
    sourceAfterTransfer.pearls.swallowed = null;
    const move = transfer(A, B, 1, 3, 1, sourceAfterTransfer, profile(20, true), op(2));
    const moved = await store.commitPearl(move);
    assert.deepEqual(moved.unique, { uid: UID, kind: 'pearl:brasa', holder: B, version: 2 });
    const release = { ...transfer(B, null, 2, 2, null, profile(20), profile(620), op(3)), profiles: [endpoint(B, 2, profile(620))] };
    const released = await store.commitPearl(release);
    assert.deepEqual(released.unique, { uid: UID, kind: 'pearl:brasa', holder: null, version: 3 });
    const replay = await store.commitPearl(release);
    assert.equal(replay.replay, true);
    assert.deepEqual(replay.unique, released.unique);
    assert.equal((await store.loadProfile(B)).data.gold, 620);
    assert.equal((await store.loadProfile(B)).version, 3);

    await assert.rejects(store.saveProfile(A, ownerProgress, 4), { code: 'ownership' });
    assert.equal((await store.loadProfile(A)).version, 4);

    const reclaimed = await store.commitPearl({ ...grant(C, profile(0, true), op(4)), expectedVersion: 3 });
    assert.deepEqual(reclaimed.unique, { uid: UID, kind: 'pearl:brasa', holder: C, version: 4 });
    assert.deepEqual(await store.commitPearl({ ...release, profiles: [endpoint(B, 2, profile(621))] }), { ok: false, why: 'operation' });
    assert.equal((await db.query('select count(*)::int as n from public.mn_pearl_operations')).rows[0].n, 4);
    assert.ok(requests.some((request) => request.name === 'mn_commit_pearl' && request.body.p_request.uid === UID));
  } finally { await db.close(); }
});

test('SQL rejects contenders and stale or contradictory ownership without partial state', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.saveProfile(B, profile(), 0);
    // The SDK shim uses one PGlite instance; Promise.all checks stable outcomes, not independent-connection locking.
    const results = await Promise.all([
      store.commitPearl(grant(A, profile(0, true), op(10))),
      store.commitPearl(grant(B, profile(0, true), op(11))),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => r.why === 'conflict').length, 1);
    const owner = results[0].ok ? A : B, loser = owner === A ? B : A;
    const stale = transfer(owner, loser, 1, 1, 1, profile(), profile(0, true), op(12));
    assert.deepEqual(await store.commitPearl(stale), { ok: false, why: 'conflict' });
    assert.equal((await store.loadProfile(owner)).version, 2);
    assert.equal((await store.loadProfile(loser)).version, 1);
    assert.equal((await store.loadUnique(UID)).version, 1);

    const contradictory = profile(99, true);
    await assert.rejects(store.saveProfile(loser, contradictory, 1), { code: 'ownership' });
    await assert.rejects(store.claimUnique(UID, 'pearl:brasa', loser), { code: 'operation' });
    await assert.rejects(store.releaseUnique(UID, owner, 1), { code: 'operation' });
    assert.equal((await store.loadProfile(loser)).version, 1);
  } finally { await db.close(); }
});

test('SQL save and import guards reject managed UID forgery without leaving profile or import rows', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.saveProfile(B, profile(), 0);
    await store.commitPearl(grant(A, profile(0, true), op(15)));

    await assert.rejects(store.saveProfile(B, profile(0, true), 1), { code: 'ownership' });
    assert.equal((await store.loadProfile(B)).version, 1);
    const legacyKey = 'c'.repeat(64);
    await assert.rejects(store.initializeProfile(C, profile(0, true), legacyKey), { code: 'ownership' });
    assert.equal(await store.loadProfile(C), null);
    assert.equal((await db.query('select count(*)::int as n from public.mn_legacy_imports where legacy_key = $1', [legacyKey])).rows[0].n, 0);
  } finally { await db.close(); }
});

test('SQL first managed grant detects a duplicate in a third previously unmanaged profile', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.saveProfile(B, profile(), 0);
    await store.saveProfile(C, profile(0, true), 0);
    const result = await store.commitPearl(grant(A, profile(0, true), op(16)));
    assert.deepEqual(result, { ok: false, why: 'ownership' });
    assert.equal((await store.loadProfile(A)).version, 1);
    assert.deepEqual((await store.loadProfile(A)).data.pearls.bag, []);
    assert.equal((await store.loadProfile(C)).version, 1);
    assert.equal(await store.loadUnique(UID), null);
    assert.equal((await db.query('select count(*)::int as n from public.mn_pearl_operations where operation_id = $1::uuid', [op(16)])).rows[0].n, 0);
  } finally { await db.close(); }
});

test('SQL rejects pearl commits and raw profile writes outside read committed without mutation', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.saveProfile(B, profile(), 0);
    await store.commitPearl(grant(A, profile(0, true), op(17)));

    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const move = transfer(A, B, 1, 2, 1, profile(), profile(0, true), op(18));
    assert.deepEqual(await store.commitPearl(move), { ok: false, why: 'operation' });
    assert.equal((await store.loadProfile(A)).version, 2);
    assert.equal((await store.loadProfile(B)).version, 1);
    assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: A, version: 1 });
    await assert.rejects(store.saveProfile(B, profile(0, true), 1), { code: 'operation' });
    await db.exec('ROLLBACK');

    assert.equal((await store.loadProfile(A)).version, 2);
    assert.equal((await store.loadProfile(B)).version, 1);
    assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: A, version: 1 });
    assert.equal((await db.query('select count(*)::int as n from public.mn_pearl_operations where operation_id = $1::uuid', [op(18)])).rows[0].n, 0);
  } finally { await db.close(); }
});

test('SQL rolls profile, ledger and provisional receipt back if first endpoint update fails', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(), 0);
    await store.saveProfile(B, profile(), 0);
    await store.commitPearl(grant(A, profile(0, true), op(20)));
    await db.exec(`
      RESET ROLE;
      CREATE FUNCTION public.mn_test_fail_first_pearl_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected profile update failure'; END $$;
      CREATE TRIGGER mn_test_fail_first_pearl_update AFTER UPDATE ON public.mn_profiles
        FOR EACH ROW WHEN (NEW.player_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)
        EXECUTE FUNCTION public.mn_test_fail_first_pearl_update();
      SET ROLE service_role;
    `);
    const attempted = transfer(A, B, 1, 2, 1, profile(), profile(0, true), op(21));
    await assert.rejects(store.commitPearl(attempted), { code: 'unavailable' });
    assert.equal((await store.loadProfile(A)).version, 2);
    assert.deepEqual((await store.loadProfile(A)).data.pearls.bag, [{ uid: UID, kind: 'brasa' }]);
    assert.equal((await store.loadProfile(B)).version, 1);
    assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: A, version: 1 });
    assert.equal((await db.query('select count(*)::int as n from public.mn_pearl_operations where operation_id = $1::uuid', [op(21)])).rows[0].n, 0);

    await db.exec('RESET ROLE; DROP TRIGGER mn_test_fail_first_pearl_update ON public.mn_profiles; DROP FUNCTION public.mn_test_fail_first_pearl_update(); SET ROLE service_role;');
    const retried = await store.commitPearl(attempted);
    assert.equal(retried.ok, true);
    assert.deepEqual(retried.unique, { uid: UID, kind: 'pearl:brasa', holder: B, version: 2 });
  } finally { await db.close(); }
});

test('SQL migration is safely reapplied and table, trigger and RPC privileges stay server-only', async () => {
  const db = await freshDatabase();
  try {
    const store = sdkStoreFor(db);
    await store.saveProfile(A, profile(8), 0);
    await store.commitPearl(grant(A, profile(8, true)));
    await db.exec('RESET ROLE');
    for (const migration of migrations) await db.exec(migration);
    await db.exec('SET ROLE service_role');
    assert.equal((await store.loadProfile(A)).version, 2);
    assert.deepEqual(await store.loadUnique(UID), { kind: 'pearl:brasa', holder: A, version: 1 });
    assert.equal((await store.commitPearl(grant(A, profile(8, true)))).replay, true);

    const protectedTables = ['mn_profiles', 'mn_worlds', 'mn_unique_items', 'mn_pearl_operations'];
    const rls = await db.query(`select c.relname, c.relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relname = any($1::text[]) order by c.relname`, [protectedTables]);
    assert.deepEqual(rls.rows.map((row) => [row.relname, row.relrowsecurity]), protectedTables.slice().sort().map((name) => [name, true]));
    const triggerState = await db.query(`
      select t.tgenabled, pg_catalog.has_function_privilege('anon', 'public.mn_lock_profile_pearl_keys()', 'EXECUTE') as anon_exec,
        pg_catalog.has_function_privilege('service_role', 'public.mn_lock_profile_pearl_keys()', 'EXECUTE') as service_exec
      from pg_catalog.pg_trigger t where t.tgname = 'mn_profile_pearl_keys' and not t.tgisinternal
    `);
    assert.deepEqual(triggerState.rows, [{ tgenabled: 'O', anon_exec: false, service_exec: true }]);

    await db.exec('RESET ROLE');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      for (const table of protectedTables) {
        await assert.rejects(db.query(`select * from public.${table} limit 1`), (error) => error.code === '42501');
        await assert.rejects(db.query(`insert into public.${table} default values`), (error) => error.code === '42501');
      }
      const denied = [
        `select public.mn_load_unique('${UID}'::text)`,
        `select public.mn_commit_pearl('${op(99)}'::uuid, '{}'::jsonb)`,
        'select public.mn_lock_profile_pearl_keys()',
        `select public.mn_claim_unique('denied'::text, 'pearl:brasa'::text, '${A}'::uuid)`,
        `select public.mn_release_unique('denied'::text, '${A}'::uuid, 1)`,
      ];
      for (const statement of denied) await assert.rejects(db.query(statement), (error) => error.code === '42501');
      await db.exec('RESET ROLE');
    }
  } finally { await db.close(); }
});
