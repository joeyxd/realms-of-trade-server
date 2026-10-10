import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { createSupabaseStore, StoreError } from '../server/store.mjs';
import { database } from './helpers/ground-clock-sql.mjs';

const migration = await readFile(new URL('../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const worldId = 'world:salty-shore', account = id(1), seed = 91;
const newWorld = () => ({ v: 1, seed, economy: new Economy(seed).serialize() });
const newCharacter = () => { const p = newProfile(); p.gold = 500; p.eco.pack.goods.madera = 3; return p; };
const command = (opId, changes = {}) => ({ type: 'commerce', op: 'buy', opId,
  town: 'aldea', g: 'madera', n: 2, expectedTotal: 20, ...changes });
function operation(opId, { profile = newCharacter(), worldData = newWorld(), ack = null,
  expectedProfileVersion = 1, expectedWorldVersion = 1, command: cmd = command(opId) } = {}) {
  return { operationId: opId, request: { world: worldId, account, command: cmd, expectedProfileVersion,
    expectedWorldVersion, profile, worldData,
    ack: ack ?? { type: cmd.type, op: cmd.op, opId: cmd.opId, ok: true, why: '', rev: 1 } } };
}
async function fixture(t) {
  const f = await database();
  t.after(() => f.close());
  await f.db.exec('RESET ROLE'); await f.db.exec(migration); await f.db.exec(migration); await f.db.exec('SET ROLE service_role');
  const calls = [];
  let loseCommitReply = false;
  const store = createSupabaseStore({ async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    let result;
    if (name === 'mn_commit_economic_operation') {
      result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data',
        [args.p_operation_id, args.p_request])).rows[0].data;
      if (loseCommitReply) { loseCommitReply = false; throw new Error('lost economic response'); }
    } else if (name === 'mn_load_economic_operation') {
      result = (await f.db.query('select public.mn_load_economic_operation($1::uuid) as data', [args.p_operation_id])).rows[0].data;
    } else if (name === 'mn_save_world') {
      result = (await f.db.query('select public.mn_save_world($1,$2::jsonb,$3) as data',
        [args.p_world, args.p_data, args.p_expected_version])).rows[0].data;
    } else throw new Error(`unexpected RPC ${name}`);
    return { data: result, error: null };
  } });
  const profile = newCharacter(), worldData = newWorld();
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, profile]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, worldData]);
  return { ...f, store, calls, profile, worldData, loseNextReply() { loseCommitReply = true; } };
}
async function loadProfile(f) {
  const row = (await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [account])).rows[0];
  return row ? { data: row.data, version: row.version } : null;
}
async function loadWorld(f) {
  const row = (await f.db.query('select economy,version from public.mn_worlds where world=$1', [worldId])).rows[0];
  return row ? { data: row.economy, version: row.version } : null;
}

test('SQL014 atomically commits M5 profile, world snapshot and exact receipt; replay survives response loss', async t => {
  const f = await fixture(t), opId = id(10);
  const profile = structuredClone(f.profile); profile.gold -= 20; profile.eco.pack.goods.madera = 2;
  const worldData = structuredClone(f.worldData); worldData.economy.markets.aldea.stock.madera -= 2;
  const raw = operation(opId, { profile, worldData });
  assert.deepEqual(await f.store.commitEconomicOperation(raw), {
    ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: raw.request.ack,
  });
  assert.deepEqual(await f.store.loadEconomicOperation(opId), { request: raw.request,
    result: { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: raw.request.ack } });
  assert.deepEqual(await f.store.commitEconomicOperation(raw), {
    ok: true, replay: true, profileVersion: 2, worldVersion: 2, ack: raw.request.ack,
  });
  assert.deepEqual(f.calls[0], { name: 'mn_commit_economic_operation', args: { p_operation_id: opId, p_request: raw.request } });
  assert.deepEqual(await loadProfile(f), { data: profile, version: 2 });
  assert.deepEqual(await loadWorld(f), { data: worldData, version: 2 });

  const lostId = id(11), lost = operation(lostId, { profile: { ...profile, gold: profile.gold + 4 }, worldData,
    expectedProfileVersion: 2, expectedWorldVersion: 2 });
  f.loseNextReply();
  await assert.rejects(f.store.commitEconomicOperation(lost), error => error instanceof StoreError && error.code === 'unavailable');
  assert.ok(await f.store.loadEconomicOperation(lostId));
  assert.equal((await f.store.commitEconomicOperation(lost)).replay, true);
  assert.deepEqual(await loadProfile(f), { data: lost.request.profile, version: 3 });
});

test('SQL014 accepts client operation strings independently from UUID receipt identity and rejects altered replay', async t => {
  const f = await fixture(t), receiptId = id(19);
  const raw = operation(receiptId, { command: command('ui-buy-19') });
  assert.equal((await f.store.commitEconomicOperation(raw)).ack.opId, 'ui-buy-19');
  assert.equal((await f.store.commitEconomicOperation(raw)).replay, true);
  const altered = structuredClone(raw);
  altered.request.command.op = 'sell'; altered.request.ack.op = 'sell';
  assert.deepEqual(await f.store.commitEconomicOperation(altered), { ok: false, why: 'operation' });
  const tooLarge = operation(id(191), { command: { type: 'community', op: 'contribute', opId: 'community-191',
    projectId: 'salty:hall', good: 'madera', amount: 501, expectedRev: 1 } });
  await assert.rejects(f.store.commitEconomicOperation(tooLarge), error => error instanceof StoreError && error.code === 'input');
});

test('SQL014 terminal denial is receipted; CAS conflict writes neither snapshot nor receipt', async t => {
  const f = await fixture(t), deniedId = id(20);
  const denied = operation(deniedId, { ack: { type: 'commerce', op: 'buy', opId: deniedId, ok: false, why: 'price', rev: 0 } });
  assert.equal((await f.store.commitEconomicOperation(denied)).ack.ok, false);
  assert.deepEqual(await loadProfile(f), { data: f.profile, version: 2 });
  assert.deepEqual(await loadWorld(f), { data: f.worldData, version: 2 });
  assert.equal((await f.store.commitEconomicOperation(denied)).replay, true);

  const stale = operation(id(21), { expectedProfileVersion: 1, expectedWorldVersion: 2 });
  assert.deepEqual(await f.store.commitEconomicOperation(stale), { ok: false, why: 'conflict' });
  assert.equal(await f.store.loadEconomicOperation(stale.operationId), null);
  assert.deepEqual(await loadProfile(f), { data: f.profile, version: 2 });
  assert.deepEqual(await loadWorld(f), { data: f.worldData, version: 2 });
});

test('SQL014 community contributions debit the M5 profile and advance world project metadata atomically', async t => {
  const f = await fixture(t), opId = id(25);
  const profile = structuredClone(f.profile); delete profile.eco.pack.goods.madera;
  const worldData = structuredClone(f.worldData);
  worldData.community = { projects: { 'salty:hall': { version: 2, contributed: { madera: 3 } } } };
  const cmd = { type: 'community', op: 'contribute', opId, projectId: 'salty:hall', good: 'madera', amount: 3, expectedRev: 1 };
  const raw = operation(opId, { profile, worldData, command: cmd,
    ack: { type: 'community', op: 'contribute', opId, ok: true, why: '', rev: 2, accepted: 3 } });
  assert.deepEqual(await f.store.commitEconomicOperation(raw), { ok: true, replay: false,
    profileVersion: 2, worldVersion: 2, ack: raw.request.ack });
  assert.deepEqual(await loadProfile(f), { data: profile, version: 2 });
  assert.deepEqual(await loadWorld(f), { data: worldData, version: 2 });
});

test('SQL014 ordinary world saves cannot erase or alter economically committed community metadata', async t => {
  const f = await fixture(t);
  const initialCommunity = { v: 1, epoch: id(60), project: { id: 'salty-shore-carpentry', version: 1,
    requirements: { madera: 4, piedra: 2 }, contributed: { madera: 0, piedra: 0 } } };
  const startup = { ...f.worldData, community: initialCommunity };
  assert.deepEqual(await f.store.saveWorld(worldId, startup, 1), { ok: true, version: 2 },
    'startup can add project metadata to a preexisting world with no community field');

  const nextWorld = structuredClone(startup);
  nextWorld.community.project.version = 2; nextWorld.community.project.contributed.madera = 2;
  const profile = structuredClone(f.profile); delete profile.eco.pack.goods.madera;
  const raw = operation(id(61), { profile, worldData: nextWorld, expectedWorldVersion: 2 });
  assert.equal((await f.store.commitEconomicOperation(raw)).worldVersion, 3);

  const ordinary = structuredClone(nextWorld); ordinary.economy.hours++;
  assert.deepEqual(await f.store.saveWorld(worldId, ordinary, 3), { ok: true, version: 4 },
    'ordinary economy updates remain available when they carry the exact committed community JSON');
  const omitted = structuredClone(ordinary); delete omitted.community;
  assert.deepEqual(await f.store.saveWorld(worldId, omitted, 4), { ok: false, why: 'conflict' });
  const changed = structuredClone(ordinary); changed.community.epoch = id(62);
  assert.deepEqual(await f.store.saveWorld(worldId, changed, 4), { ok: false, why: 'conflict' },
    'changing the epoch is also rejected even when project progress looks unchanged');
  assert.deepEqual(await loadWorld(f), { data: ordinary, version: 4 });
});

test('SQL014 CAS serializes concurrent requests based on the same account and world versions', async t => {
  const f = await fixture(t);
  const a = structuredClone(f.profile); a.gold -= 10;
  const b = structuredClone(f.profile); b.gold -= 20;
  const first = operation(id(26), { profile: a, worldData: f.worldData });
  const second = operation(id(27), { profile: b, worldData: f.worldData });
  const results = await Promise.all([f.store.commitEconomicOperation(first), f.store.commitEconomicOperation(second)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.why === 'conflict').length, 1);
  assert.equal((await loadProfile(f)).version, 2);
  assert.equal((await loadWorld(f)).version, 2);
  const winner = results.find(result => result.ok);
  assert.ok(await f.store.loadEconomicOperation(winner.ack.opId));
});

test('SQL014 rolls back both M5 rows if a later write fails', async t => {
  const f = await fixture(t), opId = id(30), raw = operation(opId);
  await f.db.exec('RESET ROLE');
  await f.db.exec(`CREATE FUNCTION public.mn_economic_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected economic failure'; END $$;
    CREATE TRIGGER mn_economic_test_abort BEFORE UPDATE ON public.mn_worlds
      FOR EACH ROW EXECUTE FUNCTION public.mn_economic_test_abort();
    SET ROLE service_role;`);
  await assert.rejects(f.store.commitEconomicOperation(raw), error => error instanceof StoreError && error.code === 'unavailable');
  await f.db.exec('RESET ROLE; DROP TRIGGER mn_economic_test_abort ON public.mn_worlds; DROP FUNCTION public.mn_economic_test_abort(); SET ROLE service_role');
  assert.deepEqual(await loadProfile(f), { data: f.profile, version: 1 });
  assert.deepEqual(await loadWorld(f), { data: f.worldData, version: 1 });
  assert.equal(await f.store.loadEconomicOperation(opId), null);
});

test('SQL014 operation UUID collides bidirectionally with ground-clock receipts and pearl intents', async t => {
  const f = await fixture(t), clockId = id(40);
  assert.equal((await f.db.query('select public.mn_commit_ground_clock($1::uuid,$2::jsonb) as data',
    [clockId, { world: worldId, expectedVersion: 0, expectedTick: 0, tick: 1 }])).rows[0].data.ok, true);
  assert.deepEqual(await f.store.commitEconomicOperation(operation(clockId)), { ok: false, why: 'operation' });

  const economicId = id(41);
  assert.equal((await f.store.commitEconomicOperation(operation(economicId))).ok, true);
  const clockReplay = (await f.db.query('select public.mn_commit_ground_clock($1::uuid,$2::jsonb) as data',
    [economicId, { world: worldId, expectedVersion: 0, expectedTick: 0, tick: 1 }])).rows[0].data;
  assert.deepEqual(clockReplay, { ok: false, why: 'operation' });

  const intentId = id(42);
  const intentRequest = { uid: 'pearl:test', kind: 'brasa', from: null, to: account, expectedVersion: 0,
    profiles: [{ id: account, expectedVersion: 1, data: f.profile }] };
  await f.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',
    [worldId, 'pearl', intentId, intentRequest]);
  assert.deepEqual(await f.store.commitEconomicOperation(operation(intentId)), { ok: false, why: 'operation' });
  await assert.rejects(f.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',
    [worldId, 'pearl', economicId, intentRequest]), { code: 'MNP02' });
});

test('SQL014 keeps receipts private and immutable and remains safely reapplicable', async t => {
  const f = await fixture(t), opId = id(50);
  await f.store.commitEconomicOperation(operation(opId));
  await f.db.exec('RESET ROLE'); await f.db.exec(migration); await f.db.exec('SET ROLE service_role');
  assert.ok(await f.store.loadEconomicOperation(opId));
  await assert.rejects(f.db.query('update public.mn_economic_operations set result = result where operation_id = $1::uuid', [opId]), { code: '42501' });
  await assert.rejects(f.db.query('delete from public.mn_economic_operations where operation_id = $1::uuid', [opId]), { code: '42501' });
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb)', [id(51), operation(id(51)).request]), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_load_economic_operation($1::uuid)', [opId]), { code: '42501' });
    await assert.rejects(f.db.query('select * from public.mn_economic_operations'), { code: '42501' });
  }
  await f.db.exec('RESET ROLE; SET ROLE service_role');
});
