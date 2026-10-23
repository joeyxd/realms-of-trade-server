import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createMemoryStore, createSupabaseStore, StoreError } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY = 'a'.repeat(64);
const migration = await readFile(new URL('../server/migrations/002_accounts.sql', import.meta.url), 'utf8');
const baseMigration = await readFile(new URL('../server/migrations/001_store.sql', import.meta.url), 'utf8');

function profile(gold = 0) {
  const value = newProfile();
  value.gold = gold;
  return value;
}

test('memory import creates one profile and atomically consumes a legacy receipt', async () => {
  const store = createMemoryStore();
  const first = await store.initializeProfile(A, profile(12), KEY);
  assert.deepEqual(first, { data: profile(12), version: 1 });
  assert.equal(await store.legacyClaimed(KEY), true);

  const ignored = 'b'.repeat(64);
  assert.deepEqual(await store.initializeProfile(A, profile(99), ignored), first);
  assert.equal(await store.legacyClaimed(ignored), false);
  await assert.rejects(store.initializeProfile(B, profile(80), KEY), (error) => error instanceof StoreError && error.code === 'legacy_used');
  assert.equal(await store.loadProfile(B), null);
  assert.equal((await store.loadProfile(A)).data.gold, 12);
});

test('memory import serializes competing accounts and validates server hash format', async () => {
  const store = createMemoryStore();
  const results = await Promise.allSettled([
    store.initializeProfile(A, profile(1), KEY),
    store.initializeProfile(B, profile(2), KEY),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'legacy_used').length, 1);
  await assert.rejects(store.legacyClaimed(KEY.toUpperCase()), (error) => error.code === 'legacy_key');
  await assert.rejects(store.initializeProfile(A, profile(), 'not-a-hash'), (error) => error.code === 'legacy_key');
});

function rpcFetchFor(db, requests) {
  const functions = {
    mn_initialize_profile: (a) => db.query('select public.mn_initialize_profile($1::uuid, $2::jsonb, $3::text) as data', [a.p_player_id, a.p_data, a.p_legacy_key]),
    mn_legacy_claimed: (a) => db.query('select public.mn_legacy_claimed($1::text) as data', [a.p_legacy_key]),
    mn_load_profile: (a) => db.query('select public.mn_load_profile($1::uuid) as data', [a.p_player_id]),
  };
  return async (input, init = {}) => {
    const url = new URL(input);
    const name = url.pathname.split('/').at(-1);
    requests.push({ name, body: JSON.parse(init.body ?? '{}') });
    const run = functions[name];
    if (!run) return new Response(JSON.stringify({ message: 'Unknown RPC', code: '42883' }), { status: 404, headers: { 'content-type': 'application/json' } });
    try {
      const result = await run(JSON.parse(init.body ?? '{}'));
      return new Response(JSON.stringify(result.rows[0].data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: error.message, code: error.code ?? 'XX000' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
}

async function freshDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO PUBLIC;
  `);
  await db.exec(baseMigration);
  await db.exec(migration);
  await db.exec('SET ROLE service_role');
  return db;
}

function sdkStoreFor(db, requests = []) {
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: rpcFetchFor(db, requests) },
  });
  return createSupabaseStore(client);
}

test('SQL and Supabase SDK import atomically, preserve accounts, and protect receipt authority', async () => {
  const db = await freshDatabase();
  try {
    const requests = [];
    const store = sdkStoreFor(db, requests);
    assert.equal(await store.legacyClaimed(KEY), false);

    const first = await store.initializeProfile(A, profile(7), KEY);
    assert.deepEqual(first, { data: profile(7), version: 1 });
    assert.equal(await store.legacyClaimed(KEY), true);

    const ignoredKey = 'b'.repeat(64);
    assert.deepEqual(await store.initializeProfile(A, profile(99), ignoredKey), first);
    assert.equal(await store.legacyClaimed(ignoredKey), false);

    await assert.rejects(store.initializeProfile(B, profile(88), KEY), (error) => error instanceof StoreError && error.code === 'legacy_used');
    assert.equal(await store.loadProfile(B), null);
    assert.equal((await store.loadProfile(A)).data.gold, 7);

    const claims = await Promise.allSettled([
      store.initializeProfile(C, profile(11), 'c'.repeat(64)),
      store.initializeProfile(D, profile(12), 'c'.repeat(64)),
    ]);
    assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(claims.filter((result) => result.status === 'rejected' && result.reason.code === 'legacy_used').length, 1);
    assert.equal(await store.legacyClaimed('c'.repeat(64)), true);

    await assert.rejects(store.initializeProfile(B, profile(), 'A'.repeat(64)), (error) => error.code === 'legacy_key');
    const rows = await db.query('select player_id::text as player_id, data, version from public.mn_profiles order by player_id');
    assert.equal(rows.rows.length, 2);
    assert.equal(rows.rows.every((row) => row.version === 1 && row.data.v === 1), true);
    assert.ok(requests.every((request) => request.name === 'mn_initialize_profile' || request.name === 'mn_legacy_claimed' || request.name === 'mn_load_profile'));

    // Reapplication preserves both the imported account and its one-time receipt.
    await db.exec('RESET ROLE');
    await db.exec(migration);
    await db.exec('SET ROLE service_role');
    assert.equal((await store.loadProfile(A)).version, 1);
    assert.equal(await store.legacyClaimed(KEY), true);

    const table = await db.query(`
      select c.relrowsecurity from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'mn_legacy_imports'
    `);
    assert.deepEqual(table.rows, [{ relrowsecurity: true }]);
    await db.exec('RESET ROLE');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('select * from public.mn_legacy_imports'), (error) => error.code === '42501');
      await assert.rejects(db.query(`insert into public.mn_legacy_imports (legacy_key, player_id) values ('${'e'.repeat(64)}', '${D}')`), (error) => error.code === '42501');
      await assert.rejects(db.query('update public.mn_legacy_imports set imported_at = imported_at'), (error) => error.code === '42501');
      await assert.rejects(db.query('delete from public.mn_legacy_imports'), (error) => error.code === '42501');
      await assert.rejects(db.query(`select public.mn_legacy_claimed('${KEY}')`), (error) => error.code === '42501');
      await assert.rejects(db.query(`select public.mn_initialize_profile('${B}'::uuid, '${JSON.stringify(profile())}'::jsonb, null)`), (error) => error.code === '42501');
      await db.exec('RESET ROLE');
    }
  } finally {
    await db.close();
  }
});
