import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { createSupabaseStore } from '../server/store.mjs';
import { database } from './helpers/ground-clock-sql.mjs';

const migration014 = await readFile(new URL('../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const migration015 = await readFile(new URL('../server/migrations/015_resource_operations.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const worldId = 'world:salty-shore', account = id(1), seed = 91;
const initialResources = () => ({ v: 1, tick: 0, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} });
const newWorld = () => ({ v: 1, seed, economy: new Economy(seed).serialize() });
const newCharacter = () => { const p = newProfile(); p.gold = 500; p.eco.pack.goods.tronco = 3; return p; };
const community = () => ({ v: 1, epoch: id(5), project: { id: 'salty-shore-carpentry', version: 1,
  requirements: { madera: 4, piedra: 2 }, contributed: { madera: 0, piedra: 0 } } });
const gather = (opId, changes = {}) => ({ type: 'resource', op: 'gather', opId, node: 'palm-1', expectedRev: 1, ...changes });
const craft = (opId, changes = {}) => ({ type: 'resource', op: 'craft', opId, recipe: 'madera', expectedRev: 0, n: 10, ...changes });
const buy = (opId, changes = {}) => ({ type: 'commerce', op: 'buy', opId, town: 'aldea', g: 'madera', n: 1, expectedTotal: 1, ...changes });
function operation(opId, { profile = newCharacter(), worldData = newWorld(), command = gather(opId), ack = null,
  expectedProfileVersion = 1, expectedWorldVersion = 1 } = {}) {
  return { operationId: opId, request: { world: worldId, account, command, expectedProfileVersion, expectedWorldVersion,
    profile, worldData, ack: ack ?? { type: command.type, op: command.op, opId: command.opId,
      ok: true, why: '', rev: 2, good: 'tronco', count: 2 } } };
}
async function fixture(t) {
  const f = await database(); t.after(() => f.close());
  await f.db.exec('RESET ROLE'); await f.db.exec(migration014); await f.db.exec(migration015); await f.db.exec(migration015);
  await f.db.exec('SET ROLE service_role');
  const store = createSupabaseStore({ async rpc(name, args) {
    let result;
    if (name === 'mn_commit_economic_operation') result = (await f.db.query(
      'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data', [args.p_operation_id, args.p_request])).rows[0].data;
    else if (name === 'mn_load_economic_operation') result = (await f.db.query(
      'select public.mn_load_economic_operation($1::uuid) as data', [args.p_operation_id])).rows[0].data;
    else if (name === 'mn_save_world') result = (await f.db.query(
      'select public.mn_save_world($1,$2::jsonb,$3) as data', [args.p_world, args.p_data, args.p_expected_version])).rows[0].data;
    else if (name === 'mn_resource_operations_ready') result = (await f.db.query(
      'select public.mn_resource_operations_ready() as data')).rows[0].data;
    else throw new Error(`unexpected RPC ${name}`);
    return { data: result, error: null };
  } });
  const profile = newCharacter(), worldData = newWorld();
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [account, profile]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, worldData]);
  return { ...f, store, profile, worldData };
}
async function loadWorld(f) {
  const row = (await f.db.query('select economy,version from public.mn_worlds where world=$1', [worldId])).rows[0];
  return row ? { data: row.economy, version: row.version } : null;
}

test('SQL015 is reapplicable and exposes resource capability only to service_role', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.db.query('select public.mn_resource_operations_ready() as data')).rows[0].data, { version: 1 });
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(f.db.query('select public.mn_resource_operations_ready()'), { code: '42501' });
  }
});

test('SQL015 validates historical SQL014 receipts without rewriting legacy or progressed profiles on replay', async t => {
  const f = await database(); t.after(() => f.close());
  await f.db.exec('RESET ROLE'); await f.db.exec(migration014); await f.db.exec('SET ROLE service_role');

  const legacyProfile = newCharacter(); delete legacyProfile.progression;
  assert.equal(Object.hasOwn(legacyProfile, 'progression'), false);
  const worldData = newWorld();
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)',
    [account, legacyProfile]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, worldData]);
  const raw = operation(id(5), { profile: legacyProfile, worldData, command: buy('legacy-buy-5'),
    ack: { type: 'commerce', op: 'buy', opId: 'legacy-buy-5', ok: true, why: '', rev: 2 } });
  const committed = (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data', [raw.operationId, raw.request])).rows[0].data;
  assert.deepEqual(committed, { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: raw.request.ack });

  await f.db.exec('RESET ROLE'); await f.db.exec(migration015); await f.db.exec('SET ROLE service_role');
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as valid',
    [raw.operationId, raw.request])).rows[0].valid, true,
  'adding resources must keep a receipt created under the SQL014 validator valid');
  const historical = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid',
    [raw.operationId])).rows[0];
  assert.deepEqual(historical.request.profile, legacyProfile);
  assert.equal(Object.hasOwn(historical.request.profile, 'progression'), false);

  const progressedProfile = newCharacter(); progressedProfile.gold = 777;
  assert.equal(Object.hasOwn(progressedProfile, 'progression'), true);
  await f.db.query('update public.mn_profiles set data=$2::jsonb,version=3 where player_id=$1::uuid',
    [account, progressedProfile]);
  await f.db.exec('RESET ROLE'); await f.db.exec(migration015); await f.db.exec('SET ROLE service_role');
  const replay = (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data', [raw.operationId, raw.request])).rows[0].data;
  assert.deepEqual(replay, { ...committed, replay: true }, 'historical retry returns its original result');
  const currentProfile = (await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid',
    [account])).rows[0];
  assert.deepEqual(currentProfile, { data: progressedProfile, version: 3 },
    'replay does not restore the receipt profile over newer progression');
  const afterReapply = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid',
    [raw.operationId])).rows[0];
  assert.deepEqual(afterReapply, historical, 'reapplication leaves the legacy receipt blob unchanged');
});

test('SQL015 atomically commits resource profile, world state and exact receipt; replay survives', async t => {
  const f = await fixture(t);
  const worldData = { ...f.worldData, community: community(), resources: initialResources() };
  assert.deepEqual(await f.store.saveWorld(worldId, worldData, 1), { ok: true, version: 2 },
    'the first resource/community projection can bootstrap onto an existing world');
  const nextWorld = structuredClone(worldData);
  nextWorld.resources.tick = 1;
  nextWorld.resources.nodes[0].rev = 2; nextWorld.resources.nodes[0].hits = 1;
  nextWorld.resources.cooldowns[account] = 9007199254740991;
  const profile = structuredClone(f.profile); profile.eco.pack.goods.tronco = 1;
  const raw = operation(id(10), { profile, worldData: nextWorld, command: gather('gather-10'), expectedWorldVersion: 2 });
  const committed = await f.store.commitEconomicOperation(raw);
  assert.deepEqual(committed, { ok: true, replay: false, profileVersion: 2, worldVersion: 3, ack: raw.request.ack });
  assert.deepEqual(await f.store.commitEconomicOperation(raw), { ...committed, replay: true });
  assert.deepEqual(await f.store.loadEconomicOperation(id(10)), { request: raw.request,
    result: committed });
  assert.deepEqual(await loadWorld(f), { data: nextWorld, version: 3 });

  const secondWorld = structuredClone(nextWorld);
  secondWorld.resources.tick = 2; secondWorld.resources.nodes[0].rev = 3; secondWorld.resources.nodes[0].hits = 2;
  const second = operation(id(11), { profile, worldData: secondWorld, command: gather('gather-11', { expectedRev: 2 }),
    expectedProfileVersion: 2, expectedWorldVersion: 3,
    ack: { type: 'resource', op: 'gather', opId: 'gather-11', ok: true, why: '', rev: 3, good: 'tronco', count: 0 } });
  assert.equal((await f.store.commitEconomicOperation(second)).ok, true,
    'resource operations can mutate nodes after the resource state is already adopted');
  const rewind = structuredClone(second);
  rewind.operationId = id(13); rewind.request.command.opId = 'gather-rewind';
  rewind.request.expectedProfileVersion = 3; rewind.request.expectedWorldVersion = 4;
  rewind.request.ack.opId = 'gather-rewind'; rewind.request.worldData.resources.tick = 1;
  rewind.request.command.expectedRev = 3; rewind.request.ack.rev = 4; rewind.request.worldData.resources.nodes[0].rev = 4;
  assert.deepEqual(await f.store.commitEconomicOperation(rewind), { ok: false, why: 'conflict' },
    'resource operations cannot commit a world tick rewind even when changing nodes');
  assert.deepEqual(await loadWorld(f), { data: secondWorld, version: 4 });

  await f.db.exec('RESET ROLE'); await f.db.exec(migration015); await f.db.exec('SET ROLE service_role');
  assert.deepEqual(await f.store.loadEconomicOperation(id(10)), { request: raw.request, result: committed },
    'reapplying SQL015 revalidates and retains an existing resource receipt');
  const invalid = structuredClone(raw.request); invalid.worldData.resources.nodes[0].hits = 4;
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as valid',
    [id(10), invalid])).rows[0].valid, false, 'resource validation remains strict after reapplication');
  await f.db.exec('RESET ROLE');
  const badResult = { ok: true, replay: false, profileVersion: 99, worldVersion: 99, ack: raw.request.ack };
  await assert.rejects(f.db.query('insert into public.mn_economic_operations(operation_id,request,result) values($1::uuid,$2::jsonb,$3::jsonb)',
    [id(12), raw.request, badResult]), { code: '23514' }, 'the preexisting result CHECK still validates historical result shape');
  await f.db.exec('SET ROLE service_role');
});

test('SQL015 accepts strict craft/gather bounds and rejects malformed resource snapshots', async t => {
  const f = await fixture(t), state = initialResources();
  const validCraft = operation(id(20), { worldData: { ...f.worldData, resources: state }, command: craft('craft-20'),
    ack: { type: 'resource', op: 'craft', opId: 'craft-20', ok: true, why: '', rev: 0, good: 'madera', count: 10 } });
  assert.equal((await f.store.commitEconomicOperation(validCraft)).ok, true);
  const invalid = structuredClone(validCraft.request);
  invalid.command.expectedRev = -1;
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as valid',
    [id(21), invalid])).rows[0].valid, false);
  for (const mutate of [
    resources => { resources.tick = -1; },
    resources => { resources.tick = '1'; },
    resources => { resources.nodes[0].hits = 4; },
    resources => { resources.nodes.push({ ...resources.nodes[0] }); },
    resources => { resources.cooldowns[account] = 9007199254740992; },
    resources => { resources.cooldowns[account] = '123'; },
  ]) {
    const request = structuredClone(validCraft.request), resources = request.worldData.resources;
    mutate(resources);
    assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as valid',
      [id(22), request])).rows[0].valid, false);
  }
});

test('ordinary economic writes preserve bootstrapped resources and saveWorld cannot erase or rewrite them', async t => {
  const f = await fixture(t), seeded = { ...f.worldData, resources: initialResources(), community: community() };
  assert.deepEqual(await f.store.saveWorld(worldId, seeded, 1), { ok: true, version: 2 });
  const omitted = operation(id(30), { command: buy('buy-30'), expectedWorldVersion: 2, expectedProfileVersion: 1 });
  assert.deepEqual(await f.store.commitEconomicOperation(omitted), { ok: false, why: 'conflict' });
  const alteredCommunity = operation(id(31), { command: gather('resource-31'), expectedWorldVersion: 2,
    worldData: { ...seeded, community: { ...community(), epoch: id(6) } } });
  assert.deepEqual(await f.store.commitEconomicOperation(alteredCommunity), { ok: false, why: 'conflict' });
  const tickAdvance = structuredClone(seeded); tickAdvance.resources.tick = 1;
  const ordinaryAdvance = operation(id(32), { command: buy('buy-32'), expectedWorldVersion: 2, worldData: tickAdvance });
  assert.equal((await f.store.commitEconomicOperation(ordinaryAdvance)).ok, true,
    'ordinary economic commands may carry a monotonic clock checkpoint with unchanged node data');
  const loaded = await loadWorld(f), preserved = structuredClone(loaded.data); preserved.economy.hours++;
  preserved.resources.tick++;
  assert.deepEqual(await f.store.saveWorld(worldId, preserved, loaded.version), { ok: true, version: loaded.version + 1 });
  const without = structuredClone(preserved); delete without.resources;
  assert.deepEqual(await f.store.saveWorld(worldId, without, loaded.version + 1), { ok: false, why: 'conflict' });
  const rewound = structuredClone(preserved); rewound.resources.tick--;
  assert.deepEqual(await f.store.saveWorld(worldId, rewound, loaded.version + 1), { ok: false, why: 'conflict' },
    'resource clock checkpoints cannot move backwards');
  const rewritten = structuredClone(preserved); rewritten.resources.nodes[0].rev++; rewritten.resources.tick++;
  assert.deepEqual(await f.store.saveWorld(worldId, rewritten, loaded.version + 1), { ok: false, why: 'conflict' });
  assert.deepEqual(await loadWorld(f), { data: preserved, version: loaded.version + 1 });
});
