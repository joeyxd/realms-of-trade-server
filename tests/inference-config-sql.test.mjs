import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createSupabaseInferenceConfigMethods } from '../server/inferenceConfigStore.mjs';

const migration = await readFile(new URL('../server/migrations/028_inference_config.sql', import.meta.url), 'utf8');
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const character = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const character2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const world = 'world:salty-shore';
const config = () => ({ v: 1, ceilingNanoUsd: 9000000000,
  connections: [{ id: 'local', ceilingNanoUsd: 4000000000 }, { id: 'remote', ceilingNanoUsd: 8000000000 }],
  companions: [{ character, connectionId: 'local', modelId: 'provider:model-a' },
    { character: character2, connectionId: 'remote', modelId: 'provider:model-b' }] });

function rpcFor(db) {
  return async (name, args = {}) => {
    const calls = {
      mn_inference_config_ready: () => db.query('select public.mn_inference_config_ready() as data'),
      mn_load_inference_config: () => db.query('select public.mn_load_inference_config($1,$2::uuid) as data',
        [args.p_world, args.p_owner]),
      mn_save_inference_config: () => db.query('select public.mn_save_inference_config($1,$2::uuid,$3,$4::jsonb) as data',
        [args.p_world, args.p_owner, args.p_expected_revision, JSON.stringify(args.p_config)]),
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
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO PUBLIC;`);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('SET ROLE service_role');
  return { db, close, methods: createSupabaseInferenceConfigMethods({ rpc: rpcFor(db) }) };
}

test('SQL028 is rerunnable, private, and readiness checks RLS, schema and grants', async t => {
  const { db, methods } = await fixture(t);
  assert.deepEqual(await methods.checkInferenceConfig(), { version: 1 });
  assert.deepEqual(await methods.loadInferenceConfig({ world, owner }), { revision: 0, config: null, savedAt: null });
  await assert.rejects(db.query('select * from public.mn_inference_configs'), error => error.code === '42501');

  await db.exec('RESET ROLE');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('select * from public.mn_inference_configs'), error => error.code === '42501');
    await assert.rejects(db.query(`select public.mn_load_inference_config('${world}','${owner}')`), error => error.code === '42501');
    await db.exec('RESET ROLE');
  }
  await db.exec('GRANT SELECT ON public.mn_inference_configs TO service_role; SET ROLE service_role');
  await assert.rejects(methods.checkInferenceConfig(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE SELECT ON public.mn_inference_configs FROM service_role; SET ROLE service_role');
  assert.deepEqual(await methods.checkInferenceConfig(), { version: 1 });
  await db.exec('RESET ROLE; ALTER TABLE public.mn_inference_configs DISABLE ROW LEVEL SECURITY; SET ROLE service_role');
  await assert.rejects(methods.checkInferenceConfig(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_inference_configs ENABLE ROW LEVEL SECURITY; SET ROLE service_role');
  assert.deepEqual(await methods.checkInferenceConfig(), { version: 1 });
  await db.exec('RESET ROLE; ALTER TABLE public.mn_inference_configs DROP CONSTRAINT mn_inference_configs_pkey; ' +
    'ALTER TABLE public.mn_inference_configs ADD PRIMARY KEY (world); SET ROLE service_role');
  await assert.rejects(methods.checkInferenceConfig(), error => error.code === 'response');
});

test('SQL028 CAS isolates owners/worlds, exact immediate retry replays, and concurrent writers serialize', async t => {
  const { db, methods } = await fixture(t);
  const scope = { world, owner }, value = config();
  const saved = await methods.saveInferenceConfig({ ...scope, expectedRevision: 0, config: value });
  assert.equal(saved.ok, true); assert.equal(saved.replay, false); assert.equal(saved.head.revision, 1);
  assert.deepEqual(saved.head.config, value);
  assert.equal(Number.isFinite(Date.parse(saved.head.savedAt)), true);
  assert.deepEqual(await methods.saveInferenceConfig({ ...scope, expectedRevision: 0, config: value }),
    { ...saved, replay: true });
  const changed = config(); changed.ceilingNanoUsd--;
  assert.deepEqual(await methods.saveInferenceConfig({ ...scope, expectedRevision: 0, config: changed }),
    { ok: false, why: 'conflict', head: saved.head });
  const next = await methods.saveInferenceConfig({ ...scope, expectedRevision: 1, config: changed });
  assert.equal(next.ok, true); assert.equal(next.head.revision, 2);
  assert.deepEqual(await methods.saveInferenceConfig({ ...scope, expectedRevision: 0, config: value }),
    { ok: false, why: 'conflict', head: next.head });

  for (const foreign of [{ world, owner: owner2 }, { world: 'another-world', owner }]) {
    assert.deepEqual(await methods.loadInferenceConfig(foreign), { revision: 0, config: null, savedAt: null });
  }
  const one = config(), two = config(); two.ceilingNanoUsd--;
  const race = await Promise.all([
    methods.saveInferenceConfig({ ...scope, expectedRevision: 2, config: one }),
    methods.saveInferenceConfig({ ...scope, expectedRevision: 2, config: two }),
  ]);
  assert.equal(race.filter(result => result.ok).length, 1);
  assert.equal(race.filter(result => !result.ok && result.why === 'conflict').length, 1);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('select count(*)::int as n from public.mn_inference_configs')).rows[0].n, 1);
});

test('SQL validator rejects malformed ceilings, duplicate/unsorted rows, missing references and unsafe models', async t => {
  const { db } = await fixture(t);
  await db.exec('RESET ROLE');
  const bad = [
    null,
    { ...config(), v: 2 },
    { ...config(), extra: true },
    { ...config(), ceilingNanoUsd: -1 },
    { ...config(), ceilingNanoUsd: 1000000000001 },
    { ...config(), ceilingNanoUsd: 1.5 },
    { ...config(), connections: [{ id: 'remote', ceilingNanoUsd: 1 }, { id: 'local', ceilingNanoUsd: 1 }] },
    { ...config(), connections: [{ id: 'local', ceilingNanoUsd: 1 }, { id: 'local', ceilingNanoUsd: 1 }] },
    { ...config(), connections: [{ id: 'local', ceilingNanoUsd: 9000000001 }] },
    { ...config(), companions: [{ character, connectionId: 'missing', modelId: 'provider:model' }] },
    { ...config(), companions: [{ character, connectionId: 'local', modelId: 'https://example.invalid' }] },
    { ...config(), companions: [{ character, connectionId: 'local', modelId: 'sk-abcdefghijklmnop' }] },
    { ...config(), companions: [{ character, connectionId: 'local', modelId: 'x' },
      { character, connectionId: 'local', modelId: 'y' }] },
    { ...config(), companions: [{ character: character2, connectionId: 'local', modelId: 'x' },
      { character, connectionId: 'local', modelId: 'y' }] },
  ];
  for (const value of bad) {
    const result = await db.query('select public.mn_valid_inference_config($1::jsonb) as valid', [JSON.stringify(value)]);
    assert.equal(result.rows[0].valid, false);
  }
  assert.equal((await db.query('select public.mn_valid_inference_config($1::jsonb) as valid',
    [JSON.stringify(config())])).rows[0].valid, true);
});

test('SQL028 configuration survives disk reopen and immediate retry after a lost reply', async t => {
  const base = await realpath(tmpdir()), dir = await mkdtemp(join(base, 'inference-config-')), path = join(dir, 'db');
  t.after(async () => {
    const target = await realpath(dir);
    assert.equal(target, dir);
    assert.ok(basename(target).startsWith('inference-config-') && resolve(target).startsWith(resolve(base) + sep));
    await rm(target, { recursive: true, force: true });
  });
  const first = await fixture(t, path);
  const input = { world, owner, expectedRevision: 0, config: config() };
  const saved = await first.methods.saveInferenceConfig(input);
  assert.equal(saved.ok, true);
  await first.close();
  const reopened = new PGlite(path);
  t.after(() => reopened.close());
  await reopened.exec('SET ROLE service_role');
  const methods = createSupabaseInferenceConfigMethods({ rpc: rpcFor(reopened) });
  assert.deepEqual(await methods.loadInferenceConfig({ world, owner }), saved.head);
  assert.deepEqual(await methods.saveInferenceConfig(input), { ...saved, replay: true });
});
