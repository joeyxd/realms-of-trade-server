import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_COMPANION_PRESET, companionCreationConfig } from '../src/net/companionCreation.js';
import { createSupabaseCompanionCreationMethods } from '../server/companionCreationStore.mjs';
import { createSupabaseCompanionPresenceMethods } from '../server/companionPresenceStore.mjs';

const migrations = await Promise.all(['025_companion_config.sql','027_companion_control.sql','034_companion_creation.sql',
  '039_companion_presence.sql'].map(name => readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8')));
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOwner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const world = 'world:salty-shore';
const run = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const nextRun = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function rpcFor(db) {
  return async (name, args = {}) => {
    const calls = {
      mn_companion_presence_ready: () => db.query('select public.mn_companion_presence_ready() as data'),
      mn_load_companion_presence: () => db.query('select public.mn_load_companion_presence($1,$2::uuid,$3::uuid) as data',
        [args.p_world,args.p_owner,args.p_character]),
      mn_save_companion_presence: () => db.query('select public.mn_save_companion_presence($1,$2::uuid,$3::uuid,$4,$5,$6::uuid) as data',
        [args.p_world,args.p_owner,args.p_character,args.p_expected_revision,args.p_active,args.p_run_id]),
      mn_companion_creation_ready: () => db.query('select public.mn_companion_creation_ready() as data'),
      mn_load_companion_creation: () => db.query('select public.mn_load_companion_creation($1,$2::uuid) as data',
        [args.p_world,args.p_owner]),
      mn_create_companion: () => db.query('select public.mn_create_companion($1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb) as data',
        [args.p_world,args.p_owner,args.p_creation_id,JSON.stringify(args.p_preset),JSON.stringify(args.p_config)]),
    };
    try {
      if (!calls[name]) throw new Error('unexpected rpc');
      return { data: (await calls[name]()).rows[0].data, error: null };
    } catch (error) { return { data: null, error: { code: error.code ?? 'XX000', message: 'SQL error' } }; }
  };
}

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO PUBLIC; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.mn_profiles(player_id uuid PRIMARY KEY);`);
  for (const migration of migrations) { await db.exec(migration); await db.exec(migration); }
  await db.exec('SET ROLE service_role');
  const rpc = rpcFor(db);
  const create = createSupabaseCompanionCreationMethods({ rpc });
  const presence = createSupabaseCompanionPresenceMethods({ rpc });
  const make = async (account, creationId) => {
    const result = await create.createCompanion({ world, owner: account, creationId,
      preset: structuredClone(DEFAULT_COMPANION_PRESET), config: companionCreationConfig(structuredClone(DEFAULT_COMPANION_PRESET)) });
    assert.equal(result.ok, true);
    return { world, owner: account, character: result.record.characterKey };
  };
  return { db, create, presence, make };
}

test('SQL039 is rerunnable, private, and readiness checks RLS, exact grants, FK, and definer configuration', async t => {
  const { db, presence, make } = await fixture(t);
  const scope = await make(owner, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(await presence.checkCompanionPresence(), { version: 1 });
  assert.deepEqual(await presence.loadCompanionPresence(scope), { revision: 0, active: false, runId: null, savedAt: null });
  await assert.rejects(db.query('select * from public.mn_companion_presence'), error => error.code === '42501');

  await db.exec('RESET ROLE');
  for (const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('select * from public.mn_companion_presence'), error => error.code === '42501');
    await assert.rejects(db.query(`select public.mn_load_companion_presence('${scope.world}','${scope.owner}','${scope.character}')`),
      error => error.code === '42501');
    await db.exec('RESET ROLE');
  }
  await db.exec('GRANT SELECT ON public.mn_companion_presence TO service_role; SET ROLE service_role');
  await assert.rejects(presence.checkCompanionPresence(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE SELECT ON public.mn_companion_presence FROM service_role; ALTER TABLE public.mn_companion_presence DISABLE ROW LEVEL SECURITY; SET ROLE service_role');
  await assert.rejects(presence.checkCompanionPresence(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_presence ENABLE ROW LEVEL SECURITY; ALTER FUNCTION public.mn_load_companion_presence(text,uuid,uuid) SET search_path = public; SET ROLE service_role');
  await assert.rejects(presence.checkCompanionPresence(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER FUNCTION public.mn_load_companion_presence(text,uuid,uuid) SET search_path = \'\'; GRANT EXECUTE ON FUNCTION public.mn_save_companion_presence(text,uuid,uuid,integer,boolean,uuid) TO authenticated; SET ROLE service_role');
  await assert.rejects(presence.checkCompanionPresence(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE EXECUTE ON FUNCTION public.mn_save_companion_presence(text,uuid,uuid,integer,boolean,uuid) FROM authenticated; SET ROLE service_role');
  assert.deepEqual(await presence.checkCompanionPresence(), { version: 1 });
  await db.exec('RESET ROLE; GRANT SELECT (run_id) ON public.mn_companion_presence TO service_role; SET ROLE service_role');
  await assert.rejects(presence.checkCompanionPresence(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE SELECT (run_id) ON public.mn_companion_presence FROM service_role; ' +
    'ALTER TABLE public.mn_companion_presence DROP CONSTRAINT mn_companion_presence_creation_fk; ' +
    'ALTER TABLE public.mn_companion_presence ADD CONSTRAINT mn_companion_presence_creation_fk ' +
    'FOREIGN KEY (world,owner_id,character_id) REFERENCES public.mn_companion_creations(world,owner_id,character_id); SET ROLE service_role');
  await assert.rejects(presence.checkCompanionPresence(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_presence DROP CONSTRAINT mn_companion_presence_creation_fk; ' +
    'ALTER TABLE public.mn_companion_presence ADD CONSTRAINT mn_companion_presence_creation_fk ' +
    'FOREIGN KEY (world,owner_id,character_id) REFERENCES public.mn_companion_creations(world,owner_id,character_id) ON DELETE CASCADE; SET ROLE service_role');
  assert.deepEqual(await presence.checkCompanionPresence(), { version: 1 });
});

test('SQL039 admits one host run, closes only that run, and rejects stale, reused, or invalid transitions', async t => {
  const { db, presence, make } = await fixture(t);
  const scope = await make(owner, '22222222-2222-4222-8222-222222222222');
  const other = await make(otherOwner, '33333333-3333-4333-8333-333333333333');
  const started = await presence.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run });
  assert.equal(started.ok, true); assert.equal(started.replay, false); assert.equal(started.head.revision, 1);
  assert.equal(started.head.active, true); assert.equal(started.head.runId, run);
  assert.deepEqual(await presence.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run }),
    { ...started, replay: true });
  assert.deepEqual(await presence.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: nextRun }),
    { ok: false, why: 'conflict', head: started.head });
  assert.deepEqual(await presence.saveCompanionPresence({ ...scope, expectedRevision: 1, active: false, runId: nextRun }),
    { ok: false, why: 'conflict', head: started.head });

  const closed = await presence.saveCompanionPresence({ ...scope, expectedRevision: 1, active: false, runId: run });
  assert.equal(closed.ok, true); assert.equal(closed.head.revision, 2); assert.equal(closed.head.active, false);
  assert.equal(closed.head.runId, run);
  assert.deepEqual(await presence.saveCompanionPresence({ ...scope, expectedRevision: 1, active: false, runId: run }),
    { ...closed, replay: true });
  assert.deepEqual(await presence.saveCompanionPresence({ ...scope, expectedRevision: 2, active: true, runId: run }),
    { ok: false, why: 'conflict', head: closed.head });
  const restart = await presence.saveCompanionPresence({ ...scope, expectedRevision: 2, active: true, runId: nextRun });
  assert.equal(restart.ok, true); assert.equal(restart.head.revision, 3); assert.equal(restart.head.runId, nextRun);
  assert.deepEqual(await presence.loadCompanionPresence(other), { revision: 0, active: false, runId: null, savedAt: null });

  await assert.rejects(presence.loadCompanionPresence({ ...scope, character: owner }), /invalid companion presence scope/);
  await assert.rejects(presence.saveCompanionPresence({ ...scope, expectedRevision: 2147483647, active: true, runId: run }),
    /invalid companion presence revision/);
  await assert.rejects(db.query('select public.mn_save_companion_presence($1,$2::uuid,$3::uuid,0,true,$4::uuid)',
    [world,owner,scope.character,'00000000-0000-0000-0000-000000000000']), error => error.code === 'CPS01');
  await assert.rejects(db.query('select public.mn_load_companion_presence($1,$2::uuid,$3::uuid)',
    [world,owner,'44444444-4444-4444-8444-444444444444']), error => error.code === 'CPS02');
  await db.exec('RESET ROLE');
  assert.equal((await db.query('select count(*)::int as n from public.mn_companion_presence')).rows[0].n, 1,
    'presence records only the explicitly admitted companion');
});

test('SQL039 serializes concurrent admission and restart leaves an active row requiring host recovery', async t => {
  const { presence, make } = await fixture(t);
  const scope = await make(owner, '55555555-5555-4555-8555-555555555555');
  const race = await Promise.all([
    presence.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: run }),
    presence.saveCompanionPresence({ ...scope, expectedRevision: 0, active: true, runId: nextRun }),
  ]);
  assert.equal(race.filter(value => value.ok).length, 1);
  assert.equal(race.filter(value => !value.ok && value.why === 'conflict').length, 1);
  const stored = await presence.loadCompanionPresence(scope);
  assert.equal(stored.active, true, 'the store never silently clears active presence on process restart');
});
