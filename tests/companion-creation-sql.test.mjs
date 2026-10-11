import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_COMPANION_PRESET, companionCreationConfig, validateCompanionPreset } from '../src/net/companionCreation.js';
import { createSupabaseCompanionCreationMethods } from '../server/companionCreationStore.mjs';

const migrations = await Promise.all(['025_companion_config.sql','027_companion_control.sql','034_companion_creation.sql']
  .map(name => readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8')));
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const world = 'world:salty-shore';
const creationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const preset = () => structuredClone(DEFAULT_COMPANION_PRESET);
const config = () => companionCreationConfig(preset());

function rpcFor(db) {
  return async (name, args = {}) => {
    const calls = {
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

async function fixture(t, path = undefined) {
  const db = new PGlite(path);
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await db.close(); } };
  t.after(close);
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO PUBLIC;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.mn_profiles(player_id uuid PRIMARY KEY);
  `);
  for (const migration of migrations) { await db.exec(migration); await db.exec(migration); }
  await db.exec('SET ROLE service_role');
  return { db, close, methods: createSupabaseCompanionCreationMethods({ rpc: rpcFor(db) }) };
}

test('SQL034 is rerunnable, private, and gates readiness on ACLs, RLS, constraints, and RPC grants', async t => {
  const { db, methods } = await fixture(t);
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });
  assert.equal(await methods.loadCompanionCreation({ world, owner }), null);
  await assert.rejects(db.query('select * from public.mn_companion_creations'), error => error.code === '42501');

  await db.exec('RESET ROLE');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('select * from public.mn_companion_creations'), error => error.code === '42501');
    await assert.rejects(db.query(`select public.mn_load_companion_creation('${world}','${owner}')`),
      error => error.code === '42501');
    await db.exec('RESET ROLE');
  }
  await db.exec('GRANT SELECT ON public.mn_companion_creations TO service_role; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionCreation(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE SELECT ON public.mn_companion_creations FROM service_role; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });

  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_creations DISABLE ROW LEVEL SECURITY; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionCreation(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_creations ENABLE ROW LEVEL SECURITY; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });

  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_configs DISABLE ROW LEVEL SECURITY; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionCreation(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_configs ENABLE ROW LEVEL SECURITY; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });

  await db.exec('RESET ROLE; GRANT EXECUTE ON FUNCTION public.mn_create_companion(text,uuid,uuid,jsonb,jsonb) TO authenticated; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionCreation(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE EXECUTE ON FUNCTION public.mn_create_companion(text,uuid,uuid,jsonb,jsonb) FROM authenticated; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });
});

test('SQL034 creates identity, SQL025 config, and stopped SQL027 control atomically with exact retry semantics', async t => {
  const { db, methods } = await fixture(t);
  const request = { world, owner, creationId, preset: preset(), config: config() };
  const created = await methods.createCompanion(request);
  assert.equal(created.ok, true); assert.equal(created.replay, false);
  assert.equal(created.record.creationId, creationId);
  assert.equal(created.record.configuration.revision, 1);
  assert.equal(created.record.control.revision, 1); assert.equal(created.record.control.stopped, true);
  assert.notEqual(created.record.characterKey, owner);
  assert.deepEqual(await methods.loadCompanionCreation({ world, owner }), created.record);
  assert.deepEqual(await methods.createCompanion(request), { ...created, replay: true });

  const differentPreset = preset(); differentPreset.name = 'Otra';
  assert.deepEqual(await methods.createCompanion({ ...request, preset: differentPreset, config: companionCreationConfig(differentPreset) }),
    { ok: false, why: 'conflict', record: created.record });
  assert.deepEqual(await methods.createCompanion({ ...request, creationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    { ok: false, why: 'limit', record: created.record });

  await db.exec('RESET ROLE');
  assert.equal((await db.query('select count(*)::int as n from public.mn_companion_creations')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from public.mn_companion_configs')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from public.mn_companion_controls')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from public.mn_profiles')).rows[0].n, 0,
    'creation does not create a gameplay profile');
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 0,
    'creation does not create an auth user');
});

test('SQL034 rolls back every row when the stopped-control insert fails', async t => {
  const { db, methods } = await fixture(t);
  await db.exec(`
    RESET ROLE;
    CREATE FUNCTION public.fail_companion_control() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected failure'; END $$;
    CREATE TRIGGER fail_companion_control BEFORE INSERT ON public.mn_companion_controls
      FOR EACH ROW EXECUTE FUNCTION public.fail_companion_control();
    SET ROLE service_role;
  `);
  await assert.rejects(methods.createCompanion({ world, owner, creationId, preset: preset(), config: config() }),
    error => error.code === 'unavailable');
  await db.exec('RESET ROLE');
  for (const table of ['mn_companion_creations','mn_companion_configs','mn_companion_controls']) {
    assert.equal((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n, 0, `${table} rolled back`);
  }
});

test('SQL034 load and create fail closed when any registered operational row is missing', async t => {
  const { db, methods } = await fixture(t);
  const request = { world, owner, creationId, preset: preset(), config: config() };
  const created = await methods.createCompanion(request);
  await db.exec('RESET ROLE');
  await db.query('delete from public.mn_companion_configs where world=$1 and owner_id=$2::uuid', [world, owner]);
  await db.exec('SET ROLE service_role');
  await assert.rejects(methods.loadCompanionCreation({ world, owner }), error => error.code === 'unavailable');
  await assert.rejects(methods.createCompanion(request), error => error.code === 'unavailable');
  const changedPreset = preset(); changedPreset.name = 'Cobalto';
  await assert.rejects(methods.createCompanion({ ...request, preset: changedPreset, config: companionCreationConfig(changedPreset) }),
    error => error.code === 'unavailable', 'a changed preset cannot mask the incomplete registry as a conflict');
  await assert.rejects(methods.createCompanion({ ...request, creationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    error => error.code === 'unavailable', 'a different request cannot mask the incomplete registry as a limit denial');

  const other = { world, owner: owner2, creationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', preset: preset(), config: config() };
  await methods.createCompanion(other);
  await db.exec('RESET ROLE');
  await db.query('delete from public.mn_companion_controls where world=$1 and owner_id=$2::uuid', [world, owner2]);
  await db.exec('SET ROLE service_role');
  await assert.rejects(methods.loadCompanionCreation({ world, owner: owner2 }), error => error.code === 'unavailable');
  await assert.rejects(methods.createCompanion(other), error => error.code === 'unavailable');
  assert.ok(created.record.characterKey);
});

test('SQL preset validator agrees on accents, NFC, Unicode character length, and trimmed whitespace', async t => {
  const { db } = await fixture(t);
  await db.exec('RESET ROLE');
  const check = async value => (await db.query('select public.mn_valid_companion_creation_preset($1::jsonb) as valid',
    [JSON.stringify(value)])).rows[0].valid;
  const accented = preset(); accented.name = 'Bóreas';
  const decomposed = preset(); decomposed.name = 'Bo\u0301reas';
  const eightAstral = preset(); eightAstral.name = '😀'.repeat(8);
  const nineAstral = preset(); nineAstral.name = '😀'.repeat(9);
  const padded = preset(); padded.name = ' Brisa ';
  const blank = preset(); blank.name = '   ';
  assert.doesNotThrow(() => validateCompanionPreset(accented));
  assert.equal(await check(accented), true);
  assert.throws(() => validateCompanionPreset(decomposed));
  assert.equal(await check(decomposed), false);
  assert.doesNotThrow(() => validateCompanionPreset(eightAstral));
  assert.equal(await check(eightAstral), true);
  assert.throws(() => validateCompanionPreset(nineAstral));
  assert.equal(await check(nineAstral), false);
  for (const value of [padded, blank]) {
    assert.throws(() => validateCompanionPreset(value));
    assert.equal(await check(value), false);
  }
});

test('SQL034 treats a registered companion UUID as an invalid future owner identity', async t => {
  const { methods } = await fixture(t);
  await methods.createCompanion({ world, owner, creationId, preset: preset(), config: config() });
  const character = (await methods.loadCompanionCreation({ world, owner })).characterKey;
  await assert.rejects(methods.createCompanion({ world: 'another-world', owner: character,
    creationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', preset: preset(), config: config() }),
  error => error.code === 'unavailable');
});

test('SQL034 readiness checks the character uniqueness definition, not only its constraint name', async t => {
  const { db, methods } = await fixture(t);
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_creations DROP CONSTRAINT mn_companion_creations_character_uq; ' +
    'ALTER TABLE public.mn_companion_creations ADD CONSTRAINT mn_companion_creations_character_uq UNIQUE (world,character_id); SET ROLE service_role');
  await assert.rejects(methods.checkCompanionCreation(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_creations DROP CONSTRAINT mn_companion_creations_character_uq; ' +
    'ALTER TABLE public.mn_companion_creations ADD CONSTRAINT mn_companion_creations_character_uq UNIQUE (character_id); SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionCreation(), { version: 1 });
});

test('SQL034 enforces account/world scope and the 64 companion world cap', async t => {
  const { db, methods } = await fixture(t);
  const first = await methods.createCompanion({ world, owner, creationId, preset: preset(), config: config() });
  const second = await methods.createCompanion({ world, owner: owner2, creationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', preset: preset(), config: config() });
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.equal(await methods.loadCompanionCreation({ world: 'another-world', owner }), null);
  assert.equal(await methods.loadCompanionCreation({ world, owner: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }), null);

  await db.exec('RESET ROLE');
  for (let index = 2; index < 64; index++) {
    const id = String(index).padStart(12, '0');
    const other = `dddddddd-dddd-4ddd-8ddd-${id}`;
    const requestId = `eeeeeeee-eeee-4eee-8eee-${id}`;
    await db.query('select public.mn_create_companion($1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb)',
      [world, other, requestId, JSON.stringify(preset()), JSON.stringify(config())]);
  }
  await db.exec('SET ROLE service_role');
  const over = await methods.createCompanion({ world, owner: '99999999-9999-4999-8999-999999999999',
    creationId: '88888888-8888-4888-8888-888888888888', preset: preset(), config: config() });
  assert.deepEqual(over, { ok: false, why: 'limit', record: null });
});

test('SQL034 durable creation survives a disk database reopen and rejects invalid inputs', async t => {
  const base = await realpath(tmpdir());
  const dir = await mkdtemp(join(base, 'companion-creation-')), path = join(dir, 'db');
  t.after(async () => {
    const target = await realpath(dir);
    assert.equal(target, dir);
    assert.ok(basename(target).startsWith('companion-creation-') && resolve(target).startsWith(resolve(base) + sep));
    await rm(target, { recursive: true, force: true });
  });
  const first = await fixture(t, path);
  const request = { world, owner, creationId, preset: preset(), config: config() };
  const saved = await first.methods.createCompanion(request);
  await first.close();

  const reopened = new PGlite(path);
  t.after(() => reopened.close());
  await reopened.exec('SET ROLE service_role');
  const methods = createSupabaseCompanionCreationMethods({ rpc: rpcFor(reopened) });
  assert.deepEqual(await methods.loadCompanionCreation({ world, owner }), saved.record);
  assert.deepEqual(await methods.createCompanion(request), { ...saved, replay: true });
  await assert.rejects(methods.createCompanion({ ...request, creationId: '00000000-0000-0000-0000-000000000000' }), TypeError);
  await assert.rejects(methods.loadCompanionCreation({ world, owner, extra: true }), TypeError);
  const invalidPreset = preset(); invalidPreset.skin = 9;
  await assert.rejects(methods.createCompanion({ ...request, preset: invalidPreset }), TypeError);
  await assert.rejects(methods.createCompanion({ ...request, config: { v: 1, personality: 'sk-AAAAAAAAAAAAAAAA', goals: [] } }), TypeError);

  await reopened.exec('RESET ROLE');
  await assert.rejects(reopened.query('select public.mn_create_companion($1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb)',
    ['bad world',owner,creationId,JSON.stringify(preset()),JSON.stringify(config())]), error => error.code === 'CCN01');
  const invalidPresetForSql = preset(); invalidPresetForSql.skin = 9;
  await assert.rejects(reopened.query('select public.mn_create_companion($1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb)',
    [world,owner,'ffffffff-ffff-4fff-8fff-ffffffffffff',JSON.stringify(invalidPresetForSql),JSON.stringify(config())]), error => error.code === 'CCN01');
});
