import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ContributionError } from '../server/community/contributionContract.mjs';
import { GOODS } from '../src/data/goods.js';
import { createSupabaseContributionStore } from '../server/community/supabaseContributionStore.mjs';
import { adapters, database } from './helpers/community-sql.mjs';

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const execFile = promisify(execFileCallback);
const WORLD = 'world:salty-shore', EPOCH = id(1), CHAR = id(2), PROJECT = 'salty:hall';
const character = ({ characterId = CHAR, worldId = WORLD, worldEpoch = EPOCH, version = 1,
  goods = { madera: 7, piedra: 2 } } = {}) => ({ worldId, worldEpoch, characterId, version, data: {
  v: 1, name: 'Nerea', gold: 321, flags: { tier: 3, nested: ['keep'] },
  eco: { tradeRev: 9, pack: { cap: 40, goods }, markets: { Aldea: { madera: 5 } } },
  raft: { id: 'raft-keep', cargo: { tronco: 4 } }, custom: { untouched: true },
} });
const project = ({ projectId = PROJECT, worldId = WORLD, worldEpoch = EPOCH, version = 1,
  requirements = { madera: 10 }, contributed = { madera: 2 } } = {}) =>
  ({ worldId, worldEpoch, projectId, version, requirements, contributed });
const request = ({ operationId = id(10), worldId = WORLD, worldEpoch = EPOCH, characterId = CHAR,
  projectId = PROJECT, good = 'madera', amount = 4, expectedCharacterVersion = 1,
  expectedProjectVersion = 1 } = {}) => ({ operationId, worldId, worldEpoch, characterId, projectId,
  good, amount, expectedCharacterVersion, expectedProjectVersion });
const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
};
async function seeded(t, { character: c = character(), project: p = project(), ...options } = {}) {
  const sql = await database(undefined, options);
  t.after(() => sql.close());
  assert.deepEqual(await sql.store.initializeCharacter(c), { ok: true, character: c });
  assert.deepEqual(await sql.store.initializeProject(p), { ok: true, project: p });
  return { ...sql, c, p };
}
const outcome = (x) => x.receipt?.result ?? x;
const stripReplay = (x) => { const y = structuredClone(x); delete y.replay; return y; };

test('Supabase fixture commits a conserved profile delta, caps at project remainder, and replays exactly', async (t) => {
  const initial = character({ goods: { madera: 12, piedra: 2 } });
  const sql = await seeded(t, { character: initial }); const r = request({ amount: 20 });
  assert.equal(sql.store.kind, 'community-supabase'); assert.equal(sql.store.durable, true);
  const first = await sql.store.commitContribution(r), result = outcome(first);
  assert.equal(result.ok, true); assert.equal(result.accepted, 8);
  const after = await sql.store.loadCharacter(WORLD, EPOCH, CHAR);
  assert.equal(after.version, 2); assert.equal(after.data.eco.tradeRev, 10);
  assert.equal(after.data.eco.pack.goods.madera, 4);
  assert.equal(after.data.eco.pack.goods.piedra, 2);
  const expectedProfile = structuredClone(initial.data);
  expectedProfile.eco.tradeRev++;
  expectedProfile.eco.pack.goods = { madera: 4, piedra: 2 };
  assert.deepEqual(after.data, expectedProfile);
  assert.deepEqual(await sql.store.loadProject(WORLD, EPOCH, PROJECT), {
    ...sql.p, version: 2, contributed: { madera: 10 },
  });
  assert.deepEqual(await sql.store.loadContributionReceipt(r.operationId), { request: r, result });
  const replay = await sql.store.commitContribution(r);
  assert.equal(replay.replay, true); assert.deepEqual(stripReplay(outcome(replay)), stripReplay(result));
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 2);
});

test('stale current state does not change an accepted receipt replay; denials are terminal', async (t) => {
  const sql = await seeded(t);
  const first = request({ operationId: id(20), amount: 2 });
  const accepted = outcome(await sql.store.commitContribution(first));
  await sql.store.commitContribution(request({ operationId: id(21), amount: 1,
    expectedCharacterVersion: 2, expectedProjectVersion: 2 }));
  const replay = await sql.store.commitContribution(first);
  assert.equal(replay.replay, true); assert.deepEqual(stripReplay(outcome(replay)), stripReplay(accepted));
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 3);

  const deniedReq = request({ operationId: id(22), characterId: id(8), amount: 4 });
  const denied = outcome(await sql.store.commitContribution(deniedReq));
  assert.deepEqual(denied, { ok: false, why: 'missing', replay: false });
  assert.equal(outcome(await sql.store.commitContribution(deniedReq)).replay, true);
  assert.deepEqual(stripReplay(outcome(await sql.store.commitContribution(deniedReq))), stripReplay(denied));
});

test('operation UUID is global, scope and epoch are isolated, and initialization never overwrites', async (t) => {
  const sql = await seeded(t), otherWorld = 'world:other', nextEpoch = id(30);
  const original = await sql.store.loadCharacter(WORLD, EPOCH, CHAR);
  const replacement = character({ goods: { madera: 99 } });
  assert.deepEqual(await sql.store.initializeCharacter(replacement), { ok: false, why: 'conflict' });
  assert.deepEqual(await sql.store.loadCharacter(WORLD, EPOCH, CHAR), original);
  assert.deepEqual(await sql.store.initializeCharacter(original), { ok: true, character: original });
  assert.deepEqual(await sql.store.initializeProject(await sql.store.loadProject(WORLD, EPOCH, PROJECT)),
    { ok: true, project: sql.p });
  assert.deepEqual(await sql.store.initializeProject(project({ requirements: { madera: 11 } })),
    { ok: false, why: 'conflict' });
  const alternate = character({ worldId: otherWorld });
  assert.deepEqual(await sql.store.initializeCharacter(alternate), { ok: true, character: alternate });
  assert.deepEqual(await sql.store.initializeProject(project({ worldId: otherWorld })),
    { ok: true, project: project({ worldId: otherWorld }) });
  assert.deepEqual(await sql.store.initializeCharacter(character({ worldEpoch: nextEpoch })),
    { ok: true, character: character({ worldEpoch: nextEpoch }) });
  assert.deepEqual(await sql.store.initializeProject(project({ worldEpoch: nextEpoch })),
    { ok: true, project: project({ worldEpoch: nextEpoch }) });
  const r = request({ operationId: id(31), amount: 1 });
  assert.equal((await sql.store.commitContribution(r)).ok, true);
  assert.deepEqual(await sql.store.commitContribution({ ...r, worldId: otherWorld }),
    { ok: false, why: 'operation', replay: false });
  assert.equal((await sql.store.loadCharacter(otherWorld, EPOCH, CHAR)).data.eco.pack.goods.madera, 7);
  assert.equal((await sql.store.loadCharacter(WORLD, nextEpoch, CHAR)).data.eco.pack.goods.madera, 7);
});

test('concurrent optimistic writers settle once with no inventory or project overdraw', async (t) => {
  const sql = await seeded(t);
  // PGlite serializes these SDK calls; this verifies the database outcome, not production lock scheduling.
  const [a, b] = await Promise.all([
    sql.store.commitContribution(request({ operationId: id(40), amount: 1 })),
    sql.store.commitContribution(request({ operationId: id(41), amount: 1 })),
  ]);
  assert.equal([a, b].filter((x) => outcome(x).ok).length, 1);
  assert.equal([a, b].filter((x) => !outcome(x).ok).length, 1);
  assert.equal((await sql.store.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 3);
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera, 6);
  assert.ok(await sql.store.loadContributionReceipt(id(40)));
  assert.ok(await sql.store.loadContributionReceipt(id(41)));
});

test('a denial remains terminal after later state changes would produce another denial', async (t) => {
  const sql = await seeded(t);
  const one = character({ characterId: id(70), goods: { madera: 1 } });
  const donor = character({ characterId: id(71), goods: { madera: 7 } });
  await sql.store.initializeCharacter(one); await sql.store.initializeCharacter(donor);
  const deniedRequest = request({ operationId: id(72), characterId: one.characterId,
    expectedCharacterVersion: 1, expectedProjectVersion: 1, amount: 4 });
  const denied = outcome(await sql.store.commitContribution(deniedRequest));
  assert.deepEqual(denied, { ok: false, why: 'goods', replay: false });
  const payMost = await sql.store.commitContribution(request({ operationId: id(73), characterId: donor.characterId,
    expectedCharacterVersion: 1, expectedProjectVersion: 1, amount: 7 }));
  assert.equal(outcome(payMost).ok, true);
  const nowAffordable = await sql.store.commitContribution(request({ operationId: id(74), characterId: one.characterId,
    expectedCharacterVersion: 1, expectedProjectVersion: 2, amount: 4 }));
  assert.equal(outcome(nowAffordable).ok, true);
  assert.equal(outcome(nowAffordable).accepted, 1);
  const replay = await sql.store.commitContribution(deniedRequest);
  assert.equal(replay.replay, true); assert.deepEqual(stripReplay(outcome(replay)), stripReplay(denied));
});

test('raw RPC validation cannot be bypassed with fractional amounts, extras, nil UUIDs or string versions', async (t) => {
  const sql = await seeded(t), good = request();
  for (const malformed of [
    { ...good, amount: 1.5 }, { ...good, unexpected: true },
    { ...good, operationId: '00000000-0000-0000-0000-000000000000' },
    { ...good, expectedCharacterVersion: '1' }, { ...good, good: 'not-a-material' },
  ]) {
    await assert.rejects(rpc(sql.client, 'mn_comm_commit_contribution', { p_request: malformed }));
  }
  const rawDecimal = JSON.stringify(good).replace('"amount":4', '"amount":4.0');
  await sql.db.exec('BEGIN');
  const decimal = (await sql.db.query('select public.mn_comm_commit_contribution($1::jsonb) as data', [rawDecimal])).rows[0].data;
  assert.equal(decimal.ok, true);
  await sql.db.exec('ROLLBACK');
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 1);
});

test('SQL material catalog matches GOODS and SDK rejects hostile replies and times out cleanly', async (t) => {
  const sql = await seeded(t);
  const sqlGoods = (await sql.db.query('select public.mn_comm_good_ids(true) as goods')).rows[0].goods;
  const jsGoods = Object.entries(GOODS).filter(([, value]) => value.cat === 'material').map(([key]) => key);
  assert.deepEqual([...sqlGoods].sort(), jsGoods.sort());

  await sql.db.exec('BEGIN');
  const hostile = adapters(sql.db, [], { transformReply: (name, value) => name === 'mn_comm_commit_contribution'
    ? { ...value, character: { ...value.character, version: value.character.version + 2 } } : value });
  await assert.rejects(hostile.store.commitContribution(request({ operationId: id(80), amount: 1 })),
    (error) => error instanceof ContributionError && error.code === 'response');
  await sql.db.exec('ROLLBACK');
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 1);

  const hanging = adapters(sql.db, [], { hangRequest: (name) => name === 'mn_comm_load_receipt' });
  const timed = createSupabaseContributionStore(hanging.client, { timeoutMs: 15 });
  await assert.rejects(timed.loadContributionReceipt(id(81)),
    (error) => error instanceof ContributionError && error.code === 'unavailable');
});

test('SQL grants service role read-only table access and keeps storage and RPCs private to clients', async (t) => {
  const sql = await seeded(t);
  await sql.db.exec('RESET ROLE');
  const functions = (await sql.db.query(`select p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') service_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'mn_comm_%' order by p.proname`)).rows;
  for (const fn of functions) {
    assert.equal(fn.anon_exec, false, fn.proname);
    assert.equal(fn.auth_exec, false, fn.proname);
    if (['mn_comm_commit_contribution', 'mn_comm_good_ids', 'mn_comm_initialize_character',
      'mn_comm_initialize_project', 'mn_comm_load_character', 'mn_comm_load_project',
      'mn_comm_load_receipt', 'mn_comm_valid_request'].includes(fn.proname)) assert.equal(fn.service_exec, true, fn.proname);
  }
  const tables = (await sql.db.query(`select tablename from pg_tables where schemaname='public'
    and tablename like 'mn_comm_%' order by tablename`)).rows.map((row) => row.tablename);
  assert.deepEqual(tables, ['mn_comm_characters', 'mn_comm_contributions', 'mn_comm_projects']);
  for (const table of tables) {
    assert.equal((await sql.db.query(`select has_table_privilege('service_role', 'public.${table}', 'SELECT') ok`)).rows[0].ok, true);
    for (const action of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      assert.equal((await sql.db.query(`select has_table_privilege('service_role', 'public.${table}', '${action}') ok`)).rows[0].ok, false,
        `${table} ${action}`);
    }
    assert.equal((await sql.db.query(`select has_table_privilege('anon', 'public.${table}', 'SELECT') ok`)).rows[0].ok, false);
    assert.equal((await sql.db.query(`select has_table_privilege('authenticated', 'public.${table}', 'SELECT') ok`)).rows[0].ok, false);
  }
  await sql.db.exec('SET ROLE anon');
  await assert.rejects(sql.db.query('select * from public.mn_comm_characters'), (error) => error.code === '42501');
  await sql.db.exec('RESET ROLE; SET ROLE service_role');
  await assert.rejects(sql.db.exec('insert into public.mn_comm_characters default values'), (error) => error.code === '42501');
});

test('SQL transaction rolls back injected failure after character mutation and before receipt', async (t) => {
  const sql = await seeded(t), r = request({ operationId: id(50), amount: 1 });
  await sql.db.exec('RESET ROLE');
  await sql.db.exec(`create function public.mn_comm_test_abort() returns trigger language plpgsql as $$
    begin if new.project_id = '${PROJECT}' then raise exception 'injected commit failure'; end if; return new; end $$;
    create trigger mn_comm_test_abort before update on public.mn_comm_projects
      for each row execute function public.mn_comm_test_abort();
    SET ROLE service_role;`);
  await assert.rejects(sql.store.commitContribution(r), ContributionError);
  assert.deepEqual(await sql.store.loadCharacter(WORLD, EPOCH, CHAR), sql.c);
  assert.deepEqual(await sql.store.loadProject(WORLD, EPOCH, PROJECT), sql.p);
  assert.equal(await sql.store.loadContributionReceipt(r.operationId), null);
});

test('fresh Node process recovers disk receipt and replay; lost SDK response remains reconcilable', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mn-community-sql-'));
  let sql = await database(dir); const r = request({ operationId: id(60), amount: 2 });
  t.after(() => sql?.close());
  await sql.store.initializeCharacter(character()); await sql.store.initializeProject(project());
  const committed = outcome(await sql.store.commitContribution(r));
  await sql.close();
  sql = null;
  const helperUrl = pathToFileURL(path.resolve('tests/helpers/community-sql.mjs')).href;
  const childScript = `import { database } from ${JSON.stringify(helperUrl)};
    const sql = await database(process.argv[1]);
    const request = JSON.parse(process.argv[2]);
    const receipt = await sql.store.loadContributionReceipt(request.operationId);
    const replay = await sql.store.commitContribution(request);
    const character = await sql.store.loadCharacter(request.worldId, request.worldEpoch, request.characterId);
    console.log(JSON.stringify({ receipt, replay, version: character.version }));
    await sql.close();`;
  const child = await execFile(process.execPath, ['--input-type=module', '-e', childScript, dir, JSON.stringify(r)], {
    cwd: process.cwd(), maxBuffer: 1024 * 1024,
  });
  const recoveredDisk = JSON.parse(child.stdout.trim());
  assert.equal(recoveredDisk.receipt.result.ok, true);
  assert.equal(recoveredDisk.version, 2);
  assert.equal(recoveredDisk.replay.replay, true);
  assert.deepEqual(stripReplay(recoveredDisk.replay), stripReplay(committed));
  sql = await database(dir);

  const lostId = id(61), lostReq = request({ operationId: lostId, amount: 1,
    expectedCharacterVersion: 2, expectedProjectVersion: 2 });
  let loseNextCommitReply = true;
  const lost = adapters(sql.db, [], { loseReply: (name) => {
    if (name !== 'mn_comm_commit_contribution' || !loseNextCommitReply) return false;
    loseNextCommitReply = false;
    return true;
  } });
  await assert.rejects(lost.store.commitContribution(lostReq), (error) => error instanceof ContributionError && error.code === 'unavailable');
  const receipt = await sql.store.loadContributionReceipt(lostId);
  assert.ok(receipt); assert.equal(receipt.result.accepted, 1);
  const recovered = await lost.store.commitContribution(lostReq);
  assert.equal(recovered.replay, true);
  assert.equal((await sql.store.loadCharacter(WORLD, EPOCH, CHAR)).version, 3);
});
