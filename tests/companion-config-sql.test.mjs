import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createSupabaseCompanionConfigMethods } from '../server/companionConfigStore.mjs';

const migration = await readFile(new URL('../server/migrations/025_companion_config.sql', import.meta.url), 'utf8');
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const character = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const character2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const world = 'world:salty-shore';
const config = () => ({ v: 1, personality: 'Amable y prudente', goals: [
  { id: 'help-village', status: 'active', text: 'Ayudar a la aldea cuando sea seguro.', constraints: ['No gastar oro sin autorización'] },
] });

function rpcFor(db) {
  return async (name, args = {}) => {
    const calls = {
      mn_companion_config_ready: () => db.query('select public.mn_companion_config_ready() as data'),
      mn_load_companion_config: () => db.query('select public.mn_load_companion_config($1,$2::uuid,$3::uuid) as data',
        [args.p_world,args.p_owner,args.p_character]),
      mn_save_companion_config: () => db.query('select public.mn_save_companion_config($1,$2::uuid,$3::uuid,$4,$5::jsonb) as data',
        [args.p_world,args.p_owner,args.p_character,args.p_expected_revision,JSON.stringify(args.p_config)]),
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
  `);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('SET ROLE service_role');
  return { db, close, methods: createSupabaseCompanionConfigMethods({ rpc: rpcFor(db) }) };
}

test('SQL025 is rerunnable, private, and gates readiness on table ACLs and RPC grants', async t => {
  const { db, methods } = await fixture(t);
  assert.deepEqual(await methods.checkCompanionConfig(), { version: 1 });
  assert.deepEqual(await methods.loadCompanionConfig({ world, owner, character }),
    { revision: 0, config: null, savedAt: null });
  await assert.rejects(db.query('select * from public.mn_companion_configs'), error => error.code === '42501');

  await db.exec('RESET ROLE');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('select * from public.mn_companion_configs'), error => error.code === '42501');
    await assert.rejects(db.query(`select public.mn_load_companion_config('${world}','${owner}','${character}')`),
      error => error.code === '42501');
    await db.exec('RESET ROLE');
  }
  await db.exec('GRANT SELECT ON public.mn_companion_configs TO service_role; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionConfig(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE SELECT ON public.mn_companion_configs FROM service_role; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionConfig(), { version: 1 });

  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_configs DISABLE ROW LEVEL SECURITY; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionConfig(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_configs ENABLE ROW LEVEL SECURITY; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionConfig(), { version: 1 });

  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_configs DROP CONSTRAINT mn_companion_configs_pkey; ' +
    'ALTER TABLE public.mn_companion_configs ADD PRIMARY KEY (world, owner_id); SET ROLE service_role');
  await assert.rejects(methods.checkCompanionConfig(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_configs DROP CONSTRAINT mn_companion_configs_pkey; ' +
    'ALTER TABLE public.mn_companion_configs ADD PRIMARY KEY (world, owner_id, character_id); SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionConfig(), { version: 1 });

  await db.exec('RESET ROLE; GRANT EXECUTE ON FUNCTION public.mn_load_companion_config(text,uuid,uuid) TO authenticated; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionConfig(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE EXECUTE ON FUNCTION public.mn_load_companion_config(text,uuid,uuid) FROM authenticated; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionConfig(), { version: 1 });
});

test('SQL025 CAS isolates accounts/worlds/characters and exact immediate retries are idempotent', async t => {
  const { db, methods } = await fixture(t);
  const scope = { world, owner, character };
  const first = await methods.saveCompanionConfig({ ...scope, expectedRevision: 0, config: config() });
  assert.equal(first.ok, true); assert.equal(first.replay, false); assert.equal(first.head.revision, 1);
  assert.deepEqual(first.head.config, config());
  assert.equal(Number.isFinite(Date.parse(first.head.savedAt)), true);
  assert.deepEqual(await methods.saveCompanionConfig({ ...scope, expectedRevision: 0, config: config() }),
    { ...first, replay: true });

  const changed = config(); changed.personality = 'Más directa';
  assert.deepEqual(await methods.saveCompanionConfig({ ...scope, expectedRevision: 0, config: changed }),
    { ok: false, why: 'conflict', head: first.head });
  const second = await methods.saveCompanionConfig({ ...scope, expectedRevision: 1, config: changed });
  assert.equal(second.ok, true); assert.equal(second.replay, false); assert.equal(second.head.revision, 2);
  assert.deepEqual(await methods.saveCompanionConfig({ ...scope, expectedRevision: 0, config: config() }),
    { ok: false, why: 'conflict', head: second.head });

  for (const foreign of [
    { ...scope, owner: owner2 }, { ...scope, character: character2 }, { ...scope, world: 'another-world' },
  ]) assert.deepEqual(await methods.loadCompanionConfig(foreign), { revision: 0, config: null, savedAt: null });
  await db.exec('RESET ROLE');
  assert.equal((await db.query('select count(*)::int as n from public.mn_companion_configs')).rows[0].n, 1);
});

test('SQL025 races admit one CAS writer and reject malformed or unsafe configurations', async t => {
  const { db, methods } = await fixture(t);
  const first = config(), second = config(); second.personality = 'Segunda';
  const race = await Promise.all([
    methods.saveCompanionConfig({ world, owner, character, expectedRevision: 0, config: first }),
    methods.saveCompanionConfig({ world, owner, character, expectedRevision: 0, config: second }),
  ]);
  assert.equal(race.filter(value => value.ok).length, 1);
  assert.equal(race.filter(value => !value.ok && value.why === 'conflict').length, 1);

  await db.exec('RESET ROLE');
  const bad = [
    { v: 2, personality: '', goals: [] },
    { v: 1, personality: '', goals: [{ id: 'bad id', status: 'active', text: 'x', constraints: [] }] },
    { v: 1, personality: '', goals: [{ id: 'x', status: 'active', text: 'x', constraints: ['\u0001'] }] },
    { v: 1, personality: '', goals: [{ id: 'x', status: 'unknown', text: 'x', constraints: [] }] },
    { v: 1, personality: 'api_key: sk-secret-value-that-is-long', goals: [] },
    { v: 1, personality: '', goals: [{ id: 'blank', status: 'active', text: '\u00a0\uFEFF', constraints: [] }] },
    { v: 1, personality: '', goals: Array.from({ length: 16 }, (_, index) => ({
      id: `goal-${index}`, status: 'active', text: 'x'.repeat(2000), constraints: Array(8).fill('x'.repeat(500)),
    })) },
  ];
  for (const value of bad) {
    const result = await db.query('select public.mn_valid_companion_config($1::jsonb) as valid', [JSON.stringify(value)]);
    assert.equal(result.rows[0].valid, false);
  }
  const control = { v: 1, personality: 'válido\u0085', goals: [] };
  assert.equal((await db.query('select public.mn_valid_companion_config($1::jsonb) as valid',
    [JSON.stringify(control)])).rows[0].valid, true, 'SQL matches the shared validator for allowed C1 Unicode text');
  await db.exec('SET ROLE service_role');
  const invalid = config(); invalid.goals[0].id = 'has spaces';
  await assert.rejects(methods.saveCompanionConfig({ world, owner, character, expectedRevision: 1, config: invalid }),
    error => error instanceof TypeError && error.message === 'invalid_config');
  await assert.rejects(methods.saveCompanionConfig({ world, owner: character, character, expectedRevision: 1, config: config() }),
    /invalid companion config scope/);
});

test('SQL025 state survives reopening a disk database', async t => {
  const base = await realpath(tmpdir());
  const dir = await mkdtemp(join(base, 'companion-config-')), path = join(dir, 'db');
  t.after(async () => {
    const target = await realpath(dir);
    assert.equal(target, dir);
    assert.ok(basename(target).startsWith('companion-config-') && resolve(target).startsWith(resolve(base) + sep));
    await rm(target, { recursive: true, force: true });
  });
  const first = await fixture(t, path);
  const saved = await first.methods.saveCompanionConfig({ world, owner, character, expectedRevision: 0, config: config() });
  assert.equal(saved.ok, true);
  await first.close();

  const reopened = new PGlite(path);
  t.after(() => reopened.close());
  await reopened.exec('SET ROLE service_role');
  const methods = createSupabaseCompanionConfigMethods({ rpc: rpcFor(reopened) });
  assert.deepEqual(await methods.loadCompanionConfig({ world, owner, character }), saved.head);
  assert.deepEqual(await methods.saveCompanionConfig({ world, owner, character, expectedRevision: 0, config: config() }),
    { ok: true, replay: true, head: saved.head });
});
