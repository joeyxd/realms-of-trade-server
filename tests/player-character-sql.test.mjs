import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { createSupabasePlayerCharacterMethods } from '../server/playerCharacterStore.mjs';

const OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const key = 'b'.repeat(64);
const request = (n, patch = {}) => ({ requestId: id(n), name: `Pirata ${n}`, skin: 0, weapon: 0, mode: 'new', ...patch });

async function fixture(t, { reapply = false } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
  END $$; GRANT USAGE ON SCHEMA public TO PUBLIC;`);
  for (const path of ['001_store.sql', '002_accounts.sql', '038_player_characters.sql']) {
    const sql = await readFile(new URL(`../server/migrations/${path}`, import.meta.url), 'utf8');
    await db.exec(sql);
    if (reapply && path === '038_player_characters.sql') await db.exec(sql);
  }
  await db.exec('SET ROLE service_role');
  const routes = {
    mn_player_characters_ready: ['public.mn_player_characters_ready()', []],
    mn_list_player_characters: ['public.mn_list_player_characters($1::uuid)', ['p_owner']],
    mn_create_player_character: ['public.mn_create_player_character($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5::text)',
      ['p_owner', 'p_character_id', 'p_request', 'p_profile', 'p_legacy_key']],
    mn_select_player_character: ['public.mn_select_player_character($1::uuid,$2::uuid)', ['p_owner', 'p_character_id']],
  };
  const fetch = async (url, init = {}) => {
    const name = new URL(url).pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}'), route = routes[name];
    if (!route) return new Response(JSON.stringify({ message: 'unexpected rpc', code: 'XX000' }), { status: 400 });
    try {
      const value = (await db.query(`select ${route[0]} as value`, route[1].map(field => body[field]))).rows[0].value;
      return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: error.message, code: error.code }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  const methods = createSupabasePlayerCharacterMethods(client);
  return { db, ...methods };
}

async function seedProfile(db, owner, profile) {
  await db.query('select public.mn_initialize_profile($1::uuid,$2::jsonb,NULL)', [owner, profile]);
  return (await db.query('select public.mn_load_profile($1::uuid) as row', [owner])).rows[0].row;
}

test('SQL038 applies twice, readiness checks service RPC ACLs, and roster tables stay private', async t => {
  const f = await fixture(t, { reapply: true });
  assert.deepEqual(await f.checkPlayerCharacters(), { version: 1 });
  assert.equal((await f.db.query(`select has_function_privilege('anon', 'public.mn_list_player_characters(uuid)', 'EXECUTE') as can_run,
      has_function_privilege('authenticated', 'public.mn_create_player_character(uuid,uuid,jsonb,jsonb,text)', 'EXECUTE') as can_create,
      has_function_privilege('service_role', 'public.mn_select_player_character(uuid,uuid)', 'EXECUTE') as can_select`)).rows[0].can_run, false);
  const acl = (await f.db.query(`select
    has_function_privilege('authenticated', 'public.mn_create_player_character(uuid,uuid,jsonb,jsonb,text)', 'EXECUTE') as auth_create,
    has_function_privilege('service_role', 'public.mn_create_player_character(uuid,uuid,jsonb,jsonb,text)', 'EXECUTE') as service_create,
    has_table_privilege('service_role', 'public.mn_player_characters', 'INSERT') as direct_insert`)).rows[0];
  assert.deepEqual(acl, { auth_create: false, service_create: true, direct_insert: false });
  await f.db.exec('SET ROLE authenticated');
  await assert.rejects(f.db.query('select * from public.mn_player_characters'));
  await f.db.exec('RESET ROLE; SET ROLE service_role');
});

test('SQL legacy registration retains exact profile bytes/version and slot 0 blocks premature replacement', async t => {
  const f = await fixture(t), original = newProfile(); original.gold = 888; original.pirateId = 'old-world:save';
  const before = await seedProfile(f.db, OWNER_A, original);
  assert.deepEqual(await f.listPlayerCharacters(OWNER_A), { characters: [], legacy: true });
  await assert.rejects(f.createPlayerCharacter(OWNER_A, request(1), newProfile()), { code: 'legacy_required' });
  const registered = await f.createPlayerCharacter(OWNER_A,
    request(2, { mode: 'legacy', name: 'Old Pirate', skin: 1, weapon: 0 }), null);
  assert.deepEqual(registered, { id: OWNER_A, slot: 0, name: 'Old Pirate', skin: 1, weapon: 0, lastPlayed: true });
  assert.deepEqual((await f.db.query('select public.mn_load_profile($1::uuid) as row', [OWNER_A])).rows[0].row, before);
  assert.deepEqual(await f.listPlayerCharacters(OWNER_A), { characters: [registered], legacy: false });
  await assert.rejects(f.selectPlayerCharacter(OWNER_B, OWNER_A), { code: 'forbidden' });
});

test('SQL creates independent character profiles and selects one last-played slot with pistol contract', async t => {
  const f = await fixture(t), oldSword = newProfile(); oldSword.gold = 120;
  const first = await f.createPlayerCharacter(OWNER_A, request(10, { name: 'Corsario' }), oldSword);
  const pistolProfile = newProfile({ weapon: 1 }); pistolProfile.gold = 7;
  const buccaneerRequest = request(11, { name: 'Bucanero', skin: 2, weapon: 1 });
  const buccaneer = await f.createPlayerCharacter(OWNER_A, buccaneerRequest, pistolProfile);
  assert.equal(first.slot, 0); assert.equal(buccaneer.slot, 1); assert.notEqual(first.id, buccaneer.id);
  assert.equal((await f.db.query('select (public.mn_load_profile($1::uuid)->\'data\'->>\'pirateId\') as id', [first.id])).rows[0].id, `account:${first.id}`);
  const firstData = (await f.db.query('select (public.mn_load_profile($1::uuid)->\'data\') as data', [first.id])).rows[0].data;
  const buccaneerData = (await f.db.query('select (public.mn_load_profile($1::uuid)->\'data\') as data', [buccaneer.id])).rows[0].data;
  assert.equal(firstData.gold, 120); assert.equal(buccaneerData.gold, 7);
  assert.equal(buccaneerData.pirateId, `account:${buccaneer.id}`);
  assert.deepEqual((await f.listPlayerCharacters(OWNER_A)).characters.map(c => c.lastPlayed), [false, true]);
  await f.selectPlayerCharacter(OWNER_A, first.id);
  assert.deepEqual((await f.listPlayerCharacters(OWNER_A)).characters.map(c => c.lastPlayed), [true, false]);
  assert.deepEqual(await f.createPlayerCharacter(OWNER_A, buccaneerRequest, pistolProfile), { ...buccaneer, lastPlayed: false },
    'retry returns the same roster entry without selecting it again');
  await f.createPlayerCharacter(OWNER_A, request(12), newProfile());
  await assert.rejects(f.createPlayerCharacter(OWNER_A, request(13), newProfile()), { code: 'limit' });
  assert.deepEqual((await f.listPlayerCharacters(OWNER_B)).characters, []);
});

test('SQL imported legacy key is consumed once, profile initialization and roster insert are atomic', async t => {
  const f = await fixture(t), imported = newProfile(); imported.gold = 500; imported.pirateId = 'old-world:captain';
  const importedRecord = await f.createPlayerCharacter(OWNER_A, request(20, { mode: 'import', name: 'Imported' }), imported, key);
  assert.equal(importedRecord.id, OWNER_A); assert.equal(importedRecord.lastPlayed, true);
  const row = (await f.db.query('select public.mn_load_profile($1::uuid) as row', [OWNER_A])).rows[0].row;
  assert.equal(row.version, 1); assert.equal(row.data.gold, 500); assert.equal(row.data.pirateId, `account:${OWNER_A}`);
  await assert.rejects(f.createPlayerCharacter(OWNER_A, request(20, { mode: 'import', name: 'Imported' }), imported, 'c'.repeat(64)),
    { code: 'operation' });
  await assert.rejects(f.createPlayerCharacter(OWNER_B, request(21, { mode: 'import' }), imported, key), { code: 'legacy_used' });
  assert.equal((await f.db.query('select public.mn_load_profile($1::uuid) as row', [OWNER_B])).rows[0].row, null,
    'failed import leaves no profile row behind');
  assert.equal((await f.listPlayerCharacters(OWNER_B)).characters.length, 0,
    'failed import leaves no roster row behind');
});

test('SQL rejects account-only profile initialization after child character creation', async t => {
  const f = await fixture(t);
  await f.createPlayerCharacter(OWNER_A, request(30), newProfile());
  await assert.rejects(f.db.query('select public.mn_initialize_profile($1::uuid,$2::jsonb,NULL)', [OWNER_A, newProfile()]));
  assert.equal((await f.listPlayerCharacters(OWNER_A)).legacy, false);
});
