import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createSupabaseCompanionControlMethods } from '../server/companionControlStore.mjs';

const migration = await readFile(new URL('../server/migrations/027_companion_control.sql', import.meta.url), 'utf8');
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const character = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const character2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const world = 'world:salty-shore';
const scope = { world, owner, character };
const initial = { revision: 0, stopped: true, savedAt: null };

function rpcFor(db) {
  return async (name, args = {}) => {
    const calls = {
      mn_companion_control_ready: () => db.query('select public.mn_companion_control_ready() as data'),
      mn_load_companion_control: () => db.query('select public.mn_load_companion_control($1,$2::uuid,$3::uuid) as data',
        [args.p_world,args.p_owner,args.p_character]),
      mn_save_companion_control: () => db.query('select public.mn_save_companion_control($1,$2::uuid,$3::uuid,$4,$5) as data',
        [args.p_world,args.p_owner,args.p_character,args.p_expected_revision,args.p_stopped]),
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
  return { db, close, methods: createSupabaseCompanionControlMethods({ rpc: rpcFor(db) }) };
}

test('SQL027 is rerunnable, private, and gates readiness on ACLs, RLS, and RPC grants', async t => {
  const { db, methods } = await fixture(t);
  assert.deepEqual(await methods.checkCompanionControl(), { version: 1 });
  assert.deepEqual(await methods.loadCompanionControl(scope), initial);
  await assert.rejects(db.query('select * from public.mn_companion_controls'), error => error.code === '42501');

  await db.exec('RESET ROLE');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('select * from public.mn_companion_controls'), error => error.code === '42501');
    await assert.rejects(db.query(`select public.mn_load_companion_control('${world}','${owner}','${character}')`),
      error => error.code === '42501');
    await db.exec('RESET ROLE');
  }

  await db.exec('GRANT SELECT ON public.mn_companion_controls TO service_role; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionControl(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE SELECT ON public.mn_companion_controls FROM service_role; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionControl(), { version: 1 });

  await db.exec('RESET ROLE; GRANT SELECT (stopped) ON public.mn_companion_controls TO service_role; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionControl(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE SELECT (stopped) ON public.mn_companion_controls FROM service_role; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionControl(), { version: 1 });

  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_controls DISABLE ROW LEVEL SECURITY; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionControl(), error => error.code === 'response');
  await db.exec('RESET ROLE; ALTER TABLE public.mn_companion_controls ENABLE ROW LEVEL SECURITY; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionControl(), { version: 1 });

  await db.exec('RESET ROLE; GRANT EXECUTE ON FUNCTION public.mn_load_companion_control(text,uuid,uuid) TO authenticated; SET ROLE service_role');
  await assert.rejects(methods.checkCompanionControl(), error => error.code === 'response');
  await db.exec('RESET ROLE; REVOKE EXECUTE ON FUNCTION public.mn_load_companion_control(text,uuid,uuid) FROM authenticated; SET ROLE service_role');
  assert.deepEqual(await methods.checkCompanionControl(), { version: 1 });
});

test('SQL027 CAS isolates accounts/worlds/characters and exact immediate retries are idempotent', async t => {
  const { db, methods } = await fixture(t);
  const first = await methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false });
  assert.equal(first.ok, true); assert.equal(first.replay, false); assert.equal(first.head.revision, 1);
  assert.equal(first.head.stopped, false); assert.equal(Number.isFinite(Date.parse(first.head.savedAt)), true);
  assert.deepEqual(await methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false }),
    { ...first, replay: true });

  assert.deepEqual(await methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: true }),
    { ok: false, why: 'conflict', head: first.head });
  const second = await methods.saveCompanionControl({ ...scope, expectedRevision: 1, stopped: true });
  assert.equal(second.ok, true); assert.equal(second.replay, false); assert.equal(second.head.revision, 2);
  assert.equal(second.head.stopped, true);
  assert.deepEqual(await methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false }),
    { ok: false, why: 'conflict', head: second.head });

  for (const foreign of [
    { ...scope, owner: owner2 }, { ...scope, character: character2 }, { ...scope, world: 'another-world' },
  ]) assert.deepEqual(await methods.loadCompanionControl(foreign), initial);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('select count(*)::int as n from public.mn_companion_controls')).rows[0].n, 1);
  await db.exec('SET ROLE service_role');
  await assert.rejects(methods.saveCompanionControl({ ...scope, owner: character, expectedRevision: 0, stopped: false }),
    /invalid companion control scope/);
});

test('SQL027 admits one concurrent CAS writer and rejects malformed RPC arguments', async t => {
  const { db, methods } = await fixture(t);
  const race = await Promise.all([
    methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false }),
    methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: true }),
  ]);
  assert.equal(race.filter(value => value.ok).length, 1);
  assert.equal(race.filter(value => !value.ok && value.why === 'conflict').length, 1);

  await assert.rejects(db.query('select public.mn_save_companion_control($1,$2::uuid,$3::uuid,0,null)',
    [world, owner, character]));
  await assert.rejects(db.query('select public.mn_load_companion_control($1,$2::uuid,$3::uuid)',
    ['bad world', owner, character]));
  await assert.rejects(methods.saveCompanionControl({ ...scope, expectedRevision: 2147483647, stopped: false }),
    /invalid companion control revision/);
});

test('SQL027 state survives reopening a disk database', async t => {
  const base = await realpath(tmpdir());
  const dir = await mkdtemp(join(base, 'companion-control-')), path = join(dir, 'db');
  t.after(async () => {
    const target = await realpath(dir);
    assert.equal(target, dir);
    assert.ok(basename(target).startsWith('companion-control-') && resolve(target).startsWith(resolve(base) + sep));
    await rm(target, { recursive: true, force: true });
  });
  const first = await fixture(t, path);
  const saved = await first.methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false });
  assert.equal(saved.ok, true);
  await first.close();

  const reopened = new PGlite(path);
  t.after(() => reopened.close());
  await reopened.exec('SET ROLE service_role');
  const methods = createSupabaseCompanionControlMethods({ rpc: rpcFor(reopened) });
  assert.deepEqual(await methods.loadCompanionControl(scope), saved.head);
  assert.deepEqual(await methods.saveCompanionControl({ ...scope, expectedRevision: 0, stopped: false }),
    { ok: true, replay: true, head: saved.head });
});
