import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const migration = await readFile(new URL('../server/migrations/001_store.sql', import.meta.url), 'utf8');

function profile(gold = 0) {
  const value = newProfile();
  value.gold = gold;
  return value;
}

function rpcFetchFor(db, requests) {
  const functions = {
    mn_load_profile: (a) => db.query('select public.mn_load_profile($1::uuid) as data', [a.p_player_id]),
    mn_save_profile: (a) => db.query('select public.mn_save_profile($1::uuid, $2::jsonb, $3::integer) as data', [a.p_player_id, a.p_data, a.p_expected_version]),
    mn_load_world: (a) => db.query('select public.mn_load_world($1::text) as data', [a.p_world]),
    mn_save_world: (a) => db.query('select public.mn_save_world($1::text, $2::jsonb, $3::integer) as data', [a.p_world, a.p_data, a.p_expected_version]),
    mn_claim_unique: (a) => db.query('select public.mn_claim_unique($1::text, $2::text, $3::uuid) as data', [a.p_uid, a.p_kind, a.p_holder]),
    mn_release_unique: (a) => db.query('select public.mn_release_unique($1::text, $2::uuid, $3::integer) as data', [a.p_uid, a.p_holder, a.p_version]),
  };
  return async (input, init = {}) => {
    const url = new URL(input);
    const name = url.pathname.split('/').at(-1);
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
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO PUBLIC;
  `);
  await db.exec(migration);
  await db.exec('SET ROLE service_role');
  return db;
}

test('fresh PostgreSQL migration supports versioned storage and protects tables and RPCs', async () => {
  const db = await freshDatabase();
  try {
    const sdkRequests = [];
    const store = sdkStoreFor(db, sdkRequests);

    assert.deepEqual(await store.loadProfile(A), null);
    const create = await store.saveProfile(A, profile(12), 0);
    assert.deepEqual(create, { ok: true, version: 1 });
    const loaded = await store.loadProfile(A);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.data.gold, 12);

    const profileWrites = await Promise.all([
      store.saveProfile(A, profile(13), 1),
      store.saveProfile(A, profile(14), 1),
    ]);
    assert.equal(profileWrites.filter((value) => value.ok).length, 1);
    assert.equal(profileWrites.filter((value) => value.why === 'conflict').length, 1);
    assert.equal((await store.loadProfile(A)).version, 2);

    assert.deepEqual(await store.saveWorld('island-a', { stock: 3 }, 0), { ok: true, version: 1 });
    assert.deepEqual(await store.saveWorld('island-b', { stock: 8 }, 0), { ok: true, version: 1 });
    const worlds = await Promise.all([
      store.saveWorld('island-a', { stock: 4 }, 1),
      store.saveWorld('island-a', { stock: 5 }, 1),
      store.saveWorld('island-b', { stock: 9 }, 1),
    ]);
    assert.equal(worlds.filter((value) => value.ok).length, 2);
    assert.equal(worlds.filter((value) => value.why === 'conflict').length, 1);
    assert.equal((await store.loadWorld('island-a')).version, 2);
    assert.equal((await store.loadWorld('island-b')).version, 2);
    assert.ok(sdkRequests.length >= 8);
    assert.ok(sdkRequests.every((request) => request.method === 'POST' && request.contentType?.includes('application/json')));
    assert.ok(sdkRequests.some((request) => request.name === 'mn_save_profile' && request.body.p_expected_version === 0 && request.body.p_data.gold === 12));

    const claims = await Promise.all([
      store.claimUnique('relic-a', 'relic', A),
      store.claimUnique('relic-a', 'relic', B),
    ]);
    assert.equal(claims.filter((value) => value.ok).length, 1);
    assert.equal(claims.filter((value) => value.why === 'occupied').length, 1);
    const generation = claims.find((value) => value.ok).version;
    const owner = claims[0].ok ? A : B;
    assert.deepEqual(await store.claimUnique('relic-a', 'other', owner), { ok: false, why: 'kind' });
    assert.deepEqual(await store.releaseUnique('relic-a', owner, generation), { ok: true, version: generation + 1 });
    const reacquired = await store.claimUnique('relic-a', 'relic', owner);
    assert.equal(reacquired.version, generation + 2);
    assert.deepEqual(await store.releaseUnique('relic-a', owner, generation), { ok: false, why: 'conflict' });
    assert.deepEqual(await store.releaseUnique('relic-a', owner, reacquired.version), { ok: true, version: generation + 3 });

    const rls = await db.query(`
      select c.relname, c.relrowsecurity
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('mn_profiles', 'mn_worlds', 'mn_unique_items')
      order by c.relname
    `);
    assert.deepEqual(rls.rows.map((row) => [row.relname, row.relrowsecurity]), [
      ['mn_profiles', true], ['mn_unique_items', true], ['mn_worlds', true],
    ]);

    // Reapplying the migration must preserve rows while safely replacing its routines/grants.
    await db.exec('RESET ROLE');
    await db.exec(migration);
    await db.exec('SET ROLE service_role');
    assert.equal((await store.loadProfile(A)).version, 2);
    assert.equal((await store.loadWorld('island-a')).version, 2);

    await assert.rejects(
      db.query("select public.mn_save_world('bad-world', null::jsonb, -1)"),
      (error) => error.code === '22023',
    );

    await db.exec('RESET ROLE');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      for (const table of ['mn_profiles', 'mn_worlds', 'mn_unique_items']) {
        await assert.rejects(db.query(`select * from public.${table} limit 1`), (error) => error.code === '42501');
        await assert.rejects(db.query(`insert into public.${table} default values`), (error) => error.code === '42501');
        await assert.rejects(db.query(`update public.${table} set version = version`), (error) => error.code === '42501');
      }
      const deniedRpcs = [
        "select public.mn_load_profile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)",
        "select public.mn_save_profile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '{}'::jsonb, 0)",
        "select public.mn_load_world('island-a'::text)",
        "select public.mn_save_world('island-a'::text, '{}'::jsonb, 0)",
        "select public.mn_claim_unique('denied'::text, 'relic'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)",
        "select public.mn_release_unique('denied'::text, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 1)",
      ];
      for (const query of deniedRpcs) {
        await assert.rejects(db.query(query), (error) => error.code === '42501');
      }
      await db.exec('RESET ROLE');
    }
  } finally {
    await db.close();
  }
});
