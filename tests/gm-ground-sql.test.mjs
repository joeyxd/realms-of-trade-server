import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Economy } from '../src/sim/economy/economy.js';

// SQL040 on PGlite with SQL001-040: the Ground family for GM roster admission. One row is the
// journal intent and its receipt; the commit takes the SQL018 locks and delegates the roster
// contract to SQL036 inside the same transaction.
const WORLD = 'gm-ground-sql';
const CLOCK_ID = 'c0400000-0000-4000-8000-000000000001';
const OP = n => `a0400000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MIGRATIONS = [
  '001_store', '002_accounts', '003_pearl_operations', '004_pearl_ground', '005_pearl_journal', '006_pearl_same_holder',
  '007_pearl_batch', '008_pearl_batch_journal', '009_death_operations', '010_death_journal', '011_death_drop_lifecycle',
  '012_death_drop_journal', '013_ground_clock', '014_economic_operations', '015_resource_operations', '016_logging_operations',
  '017_agent_goods_budget', '018_ground_transactions', '019_ground_transaction_journal', '020_gm_drafts', '021_artisan_operations',
  '022_fire_operations', '023_ground_world_adoption', '024_starter_workshop', '025_companion_config',
  '026_workshop_raft_identifiers', '027_companion_control', '028_inference_config', '029_attribute_operations',
  '030_freshwater_operations', '031_gm_terrain_drafts', '032_canteen_survival_operations', '033_gm_terrain_materials',
  '034_companion_creation', '035_special_meal_operations', '036_gm_resource_roster', '037_torch_resin_coconut',
  '038_player_characters', '039_companion_presence', '040_ground_gm_resources',
];
const sources = await Promise.all(MIGRATIONS.map(name =>
  readFile(new URL(`../server/migrations/${name}.sql`, import.meta.url), 'utf8')));
const copy = value => structuredClone(value);
const BASE = { v: 1, tick: 10, nodes: [
  { id: 'palm-base', kind: 'palm', rev: 1, hits: 0, readyAt: 0 },
  { id: 'rock-base', kind: 'rock', rev: 1, hits: 0, readyAt: 0 },
], cooldowns: {} };

async function database({ resources = BASE, adopt = false, version = 7 } = {}) {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
    for (const sql of sources) await db.exec(sql);
    await db.exec(sources.at(-1)); // SQL040 is re-runnable, like its predecessors.
    const worldData = { v: 1, seed: 7, economy: new Economy(7).serialize(), resources: copy(resources) };
    await db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,$3)', [WORLD, worldData, version]);
    const f = { db, worldData, close: () => db.close() };
    if (adopt) {
      const adopted = await rpc(f, 'mn_adopt_ground_world', 'uuid,jsonb', CLOCK_ID,
        { world: WORLD, expectedWorldVersion: version, worldData });
      assert.equal(adopted.ok, true, JSON.stringify(adopted));
    } else {
      const clock = await rpc(f, 'mn_commit_ground_clock', 'uuid,jsonb', CLOCK_ID,
        { world: WORLD, expectedVersion: 0, expectedTick: 0, tick: resources.tick });
      assert.equal(clock.ok, true, JSON.stringify(clock));
    }
    return f;
  } catch (error) { await db.close(); throw error; }
}

// Service-role call of one SQL function; jsonb results come back parsed unless text is asked for.
async function rpc(f, name, types, ...args) {
  const casts = types ? types.split(',').map((type, i) => `$${i + 1}::${type}`).join(',') : '';
  await f.db.exec('SET ROLE service_role');
  try { return (await f.db.query(`select public.${name}(${casts}) as data`, args)).rows[0].data; }
  finally { await f.db.exec('RESET ROLE'); }
}
async function rpcText(f, name, types, ...args) {
  const casts = types.split(',').map((type, i) => `$${i + 1}::${type}`).join(',');
  await f.db.exec('SET ROLE service_role');
  try { return (await f.db.query(`select public.${name}(${casts})::text as data`, args)).rows[0].data; }
  finally { await f.db.exec('RESET ROLE'); }
}
const prepare = (f, id, request) => rpc(f, 'mn_prepare_ground_gm_admission', 'uuid,jsonb', id, request);
const commit = (f, id, request) => rpc(f, 'mn_commit_ground_gm_admission', 'uuid,jsonb', id, request);

function appended(resources, n = 1) {
  const next = copy(resources);
  for (let i = 0; i < n; i++) {
    const kind = i % 2 ? 'stone' : 'palm', id = `gm_${(i + 1).toString(16).padStart(32, '0')}`;
    next.nodes.push({ id, kind, rev: 1, hits: 0, readyAt: 0 });
    if (kind === 'palm' && next.v >= 2) next.logging[id] = next.v === 3
      ? { cycle: 1, contributors: [], quality: 0 } : { cycle: 1, contributors: [] };
  }
  return next;
}
const request = (resources, { expected = 7, version = 1, tick = resources.tick } = {}) => ({
  world: WORLD, expectedWorldVersion: expected, clock: { operationId: CLOCK_ID, version, tick }, resources });

async function state(f) {
  const world = (await f.db.query('select economy::text as economy,version,updated_at from public.mn_worlds where world=$1', [WORLD])).rows[0];
  const clock = (await f.db.query('select tick,version,operation_id from public.mn_ground_clocks where world=$1', [WORLD])).rows[0];
  const rows = (await f.db.query('select operation_id,state,result::text as result from public.mn_ground_gm_admissions order by created_at,operation_id')).rows;
  return { world, clock, rows };
}

test('SQL040 readiness reports version 1 only for the installed service-role contract', async t => {
  const f = await database(); t.after(() => f.close());
  assert.deepEqual(await rpc(f, 'mn_ground_gm_resources_ready', ''), { version: 1 });
  const service = ['mn_prepare_ground_gm_admission(uuid,jsonb)', 'mn_commit_ground_gm_admission(uuid,jsonb)',
    'mn_pending_ground_gm_admission(text)', 'mn_ground_gm_resources_ready()'];
  const internal = ['mn_valid_ground_gm_admission(uuid,jsonb)', 'mn_valid_ground_gm_admission_result(jsonb,jsonb)',
    'mn_guard_ground_gm_admission()'];
  for (const name of service) {
    const acl = (await f.db.query(`select has_function_privilege('service_role',$1,'EXECUTE') service,
      has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') auth,
      has_function_privilege('public',$1,'EXECUTE') pub`, [`public.${name}`])).rows[0];
    assert.deepEqual(acl, { service: true, anon: false, auth: false, pub: false }, name);
  }
  for (const name of internal) {
    const acl = (await f.db.query(`select has_function_privilege('service_role',$1,'EXECUTE') service,
      has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') auth`,
    [`public.${name}`])).rows[0];
    assert.deepEqual(acl, { service: false, anon: false, auth: false }, name);
  }
  // SECURITY and search_path follow SQL036: RPCs are DEFINER with an empty path, readiness is INVOKER.
  const procs = (await f.db.query(`select proname, prosecdef, proconfig from pg_proc
    where proname in ('mn_prepare_ground_gm_admission','mn_commit_ground_gm_admission','mn_pending_ground_gm_admission',
      'mn_ground_gm_resources_ready') order by proname`)).rows;
  assert.deepEqual(procs.map(p => [p.proname, p.prosecdef, p.proconfig]), [
    ['mn_commit_ground_gm_admission', true, ['search_path=""']],
    ['mn_ground_gm_resources_ready', false, ['search_path=""']],
    ['mn_pending_ground_gm_admission', true, ['search_path=""']],
    ['mn_prepare_ground_gm_admission', true, ['search_path=""']],
  ]);
  const table = (await f.db.query(`select c.relrowsecurity rls,
    has_table_privilege('service_role','public.mn_ground_gm_admissions','SELECT') service_select,
    has_table_privilege('service_role','public.mn_ground_gm_admissions','INSERT') service_insert,
    has_table_privilege('service_role','public.mn_ground_gm_admissions','UPDATE') service_update,
    has_table_privilege('anon','public.mn_ground_gm_admissions','SELECT') anon_select
    from pg_class c where c.oid='public.mn_ground_gm_admissions'::regclass`)).rows[0];
  assert.deepEqual(table, { rls: true, service_select: true, service_insert: false, service_update: false, anon_select: false });
  // A drifted grant is not ready: readiness checks the contract, not just its own presence.
  await f.db.exec('GRANT EXECUTE ON FUNCTION public.mn_commit_ground_gm_admission(uuid,jsonb) TO anon');
  assert.deepEqual(await rpc(f, 'mn_ground_gm_resources_ready', ''), { version: 0 });
  await f.db.exec('REVOKE EXECUTE ON FUNCTION public.mn_commit_ground_gm_admission(uuid,jsonb) FROM anon');
  assert.deepEqual(await rpc(f, 'mn_ground_gm_resources_ready', ''), { version: 1 });
});

test('a valid append commits once, bumps the world version by one and writes one receipt; a replay is byte-for-byte', async t => {
  const f = await database(); t.after(() => f.close());
  const before = await state(f), raw = request(appended(BASE, 2));
  const intent = await prepare(f, OP(1), raw);
  assert.deepEqual(intent, { operationId: OP(1), request: raw, state: 'pending', result: null });
  assert.deepEqual(await rpc(f, 'mn_pending_ground_gm_admission', 'text', WORLD), intent);
  const receipt = await commit(f, OP(1), raw);
  assert.deepEqual(receipt, { ok: true, worldVersion: 8, added: 2,
    clock: { world: WORLD, tick: 10, version: 1, operationId: CLOCK_ID } });
  const after = await state(f);
  assert.equal(after.world.version, 8, 'one version bump');
  assert.deepEqual(JSON.parse(after.world.economy).resources, raw.resources);
  assert.deepEqual({ ...JSON.parse(after.world.economy), resources: null }, { ...f.worldData, resources: null },
    'only the roster changed in the stored world');
  assert.deepEqual(after.clock, before.clock, 'the Ground clock does not move');
  assert.equal(after.rows.length, 1); assert.equal(after.rows[0].state, 'committed');
  assert.deepEqual(JSON.parse(after.rows[0].result), receipt);
  assert.equal(await rpc(f, 'mn_pending_ground_gm_admission', 'text', WORLD), null);

  const replay = await rpcText(f, 'mn_commit_ground_gm_admission', 'uuid,jsonb', OP(1), raw);
  assert.equal(replay, after.rows[0].result, 'the replay returns the stored receipt byte-for-byte');
  const again = await state(f);
  assert.deepEqual(again, after, 'the replay writes nothing');
  assert.deepEqual((await prepare(f, OP(1), raw)).result, receipt, 'a repeated prepare returns the decided row');
  await assert.rejects(prepare(f, OP(1), request(appended(BASE, 3))), error => error.code === 'MNP02',
    'one exact request per operation ID');
});

test('resource states v1, v2 and v3 admit schema-correct appended identities', async t => {
  const db0 = new PGlite();
  let v2, v3;
  try {
    await db0.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
    for (const sql of sources) await db0.exec(sql);
    v2 = (await db0.query('select public.mn_upgrade_resource_state($1::jsonb) state', [BASE])).rows[0].state;
    v3 = (await db0.query('select public.mn_upgrade_resource_state_timing($1::jsonb) state', [v2])).rows[0].state;
  } finally { await db0.close(); }
  for (const resources of [BASE, v2, v3]) await t.test(`v${resources.v}`, async st => {
    const f = await database({ resources }); st.after(() => f.close());
    const raw = request(appended(resources, 2));
    await prepare(f, OP(2), raw);
    const receipt = await commit(f, OP(2), raw);
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    const saved = JSON.parse((await state(f)).world.economy).resources;
    assert.deepEqual(saved, raw.resources);
    const palm = `gm_${'1'.padStart(32, '0')}`;
    if (resources.v === 1) assert.equal(Object.hasOwn(saved, 'logging'), false);
    else assert.deepEqual(saved.logging[palm], resources.v === 3
      ? { cycle: 1, contributors: [], quality: 0 } : { cycle: 1, contributors: [] });
  });
});

test('a stale world version or a moved clock returns conflict and changes nothing', async t => {
  const f = await database(); t.after(() => f.close());
  const before = await state(f);
  for (const [n, raw] of [[3, request(appended(BASE), { expected: 6 })], [4, request(appended(BASE), { version: 2 })],
    [5, request({ ...appended(BASE), tick: 11 })]]) {
    await prepare(f, OP(n), raw);
    assert.deepEqual(await commit(f, OP(n), raw), { ok: false, why: 'conflict' }, `candidate ${n}`);
    const row = (await f.db.query('select state,result::text as result from public.mn_ground_gm_admissions where operation_id=$1', [OP(n)])).rows[0];
    assert.deepEqual(row, { state: 'conflict', result: '{"ok": false, "why": "conflict"}' }, 'the intent is resolved, no receipt');
    assert.equal(await rpcText(f, 'mn_commit_ground_gm_admission', 'uuid,jsonb', OP(n), raw), row.result,
      'a resolved conflict replays byte-for-byte');
  }
  const after = await state(f);
  assert.deepEqual(after.world, before.world, 'world economy, version and timestamp are untouched');
  assert.deepEqual(after.clock, before.clock);
  assert.equal(after.rows.filter(row => row.state === 'committed').length, 0);
});

test('non-append rosters and over-cap admissions are rejected and change nothing', async t => {
  const f = await database(); t.after(() => f.close());
  const before = await state(f);
  const candidates = {};
  candidates.reset = appended({ ...BASE, nodes: BASE.nodes.slice(1) }, 2);
  candidates.reorder = appended({ ...BASE, nodes: [BASE.nodes[1], BASE.nodes[0]] });
  candidates.changedState = appended(BASE); candidates.changedState.nodes[1].rev = 2;
  candidates.overCap = copy(BASE);
  for (let i = 0; i < 129; i++) candidates.overCap.nodes.push({ id: `gm_${(i + 1).toString(16).padStart(32, '0')}`,
    kind: 'stone', rev: 1, hits: 0, readyAt: 0 });
  candidates.nothingNew = copy(BASE);
  candidates.usedNewNode = appended(BASE); candidates.usedNewNode.nodes[2].rev = 2;
  let n = 10;
  for (const [label, resources] of Object.entries(candidates)) {
    const raw = request(resources), id = OP(n++);
    await prepare(f, id, raw);
    assert.deepEqual(await commit(f, id, raw), { ok: false, why: 'invalid' }, label);
    const row = (await f.db.query('select state from public.mn_ground_gm_admissions where operation_id=$1', [id])).rows[0];
    assert.equal(row.state, 'rejected', label);
  }
  const after = await state(f);
  assert.deepEqual(after.world, before.world, 'no candidate changed the world');
  assert.deepEqual(after.clock, before.clock);
  // The same cap and append contract as SQL036: 128 new identities are one admission.
  const cap = copy(candidates.overCap); cap.nodes.pop();
  await prepare(f, OP(30), request(cap));
  assert.equal((await commit(f, OP(30), request(cap))).added, 128);
});

test('the journal comes first: no commit without its intent, one pending intent per world, no identity reuse', async t => {
  const f = await database(); t.after(() => f.close());
  const before = await state(f), raw = request(appended(BASE));
  assert.deepEqual(await commit(f, OP(40), raw), { ok: false, why: 'operation' });
  assert.deepEqual(await state(f), before, 'an unjournaled commit writes nothing');
  await prepare(f, OP(41), raw);
  await assert.rejects(prepare(f, OP(42), raw), error => error.code === 'MNP02' && /pending for this world/.test(error.message),
    'a second pending intent for the world');
  assert.deepEqual(await commit(f, OP(41), { ...raw, expectedWorldVersion: 6 }), { ok: false, why: 'operation' },
    'the commit must carry the exact journaled request');
  await assert.rejects(prepare(f, OP(43), { ...raw, clock: { ...raw.clock, operationId: OP(43) } }),
    error => error.code === 'MNP02' && /invalid/.test(error.message), 'the clock and the admission never share an ID');
  await assert.rejects(prepare(f, CLOCK_ID, { ...raw, clock: { ...raw.clock, operationId: OP(44) } }),
    error => error.code === 'MNP02' && /identity collision/.test(error.message), 'an existing Ground clock receipt ID');
  await assert.rejects(f.db.query('delete from public.mn_ground_gm_admissions'), /immutable/);
  await assert.rejects(f.db.query(`update public.mn_ground_gm_admissions set state='committed'`), /mismatch|check/);
  assert.equal((await commit(f, OP(41), raw)).ok, true, 'the journaled intent still commits once');
});

test('an adopted world accepts the GM roster only through the SQL040 Ground family', async t => {
  const f = await database({ adopt: true }); t.after(() => f.close());
  const raw = request(appended(BASE));
  await assert.rejects(rpc(f, 'mn_admit_gm_resources', 'text,integer,jsonb', WORLD, 7, raw.resources),
    /common ground transaction/, 'the SQL036 entry point is a legacy writer for an adopted world');
  await prepare(f, OP(50), raw);
  const receipt = await commit(f, OP(50), raw);
  assert.equal(receipt.ok, true, JSON.stringify(receipt)); assert.equal(receipt.worldVersion, 8);
  assert.equal((await f.db.query('select count(*)::int n from public.mn_ground_world_write_context')).rows[0].n, 0,
    'the write context exists only inside the commit');
  assert.deepEqual(JSON.parse((await state(f)).world.economy).resources, raw.resources);
});
