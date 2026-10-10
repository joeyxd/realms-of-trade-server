import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { database } from './helpers/ground-clock-sql.mjs';

const migration014 = await readFile(new URL('../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const migration015 = await readFile(new URL('../server/migrations/015_resource_operations.sql', import.meta.url), 'utf8');
const migration016 = await readFile(new URL('../server/migrations/016_logging_operations.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const worldId = 'logging-sql-world', actor = id(1), contributor = id(2), seed = 91;
const profile = () => newProfile();
const v1Resources = () => ({ v: 1, tick: 20, nodes: [
  { id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 },
  { id: 'rock-1', kind: 'rock', rev: 1, hits: 0, readyAt: 0 },
], cooldowns: {} });
const v2Resources = () => ({ v: 2, tick: 20, nodes: [
  { id: 'palm-1', kind: 'palm', rev: 3, hits: 2, readyAt: 0 },
  { id: 'rock-1', kind: 'rock', rev: 1, hits: 0, readyAt: 0 },
], cooldowns: {}, logging: {
  'palm-1': { cycle: 1, contributors: [{ actor: contributor, hits: 2 }] },
} });
const world = resources => ({ v: 1, seed, economy: new Economy(seed).serialize(), resources });

async function migrated(t) {
  const f = await database(); t.after(() => f.close());
  await f.db.exec('RESET ROLE');
  await f.db.exec(migration014);
  await f.db.exec(migration015);
  await f.db.exec(migration016);
  await f.db.exec(migration016);
  await f.db.exec('SET ROLE service_role');
  return f;
}

test('SQL016 reapplication and readiness RPC preserve the service-only boundary', async t => {
  const f = await migrated(t);
  assert.deepEqual((await f.db.query('select public.mn_logging_operations_ready() as data')).rows[0].data, { version: 1 });
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(f.db.query('select public.mn_logging_operations_ready()'), { code: '42501' });
  }
});

test('v1 adoption preserves existing state and v2 save cannot erase or rewrite its ledger', async t => {
  const f = await migrated(t);
  const legacy = v1Resources(); legacy.nodes[0].hits = 1; legacy.nodes[0].rev = 2;
  const original = world(legacy);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [worldId, original]);
  const upgradedResources = {
    ...legacy, v: 2, logging: { 'palm-1': null },
  };
  delete upgradedResources.logging['rock-1'];
  const upgraded = world(upgradedResources);
  assert.deepEqual((await f.db.query('select public.mn_valid_resource_state($1::jsonb) as ok, public.mn_upgrade_resource_state($2::jsonb) as upgraded',
    [upgradedResources, legacy])).rows[0], { ok: true, upgraded: upgradedResources });
  assert.equal((await f.db.query("select jsonb_typeof($1::jsonb) as typ, public.mn_valid_resource_state($1::jsonb->'resources') as valid", [upgraded])).rows[0].valid, true);
  assert.deepEqual((await f.db.query("select $1::text as world, char_length($1::text) as n, jsonb_typeof($2::jsonb) as typ, $3::integer as expected, public.mn_valid_resource_state_v1($2::jsonb->'resources') as v1, public.mn_valid_resource_state($2::jsonb->'resources') as v2", [worldId, upgraded, 7])).rows[0],
    { world: worldId, n: worldId.length, typ: 'object', expected: 7, v1: false, v2: true });
  const result = (await f.db.query('select public.mn_save_world($1,$2::jsonb,$3) as data',
    [worldId, upgraded, 7])).rows[0].data;
  assert.deepEqual(result, { ok: true, version: 8 });
  assert.deepEqual((await f.db.query('select economy from public.mn_worlds where world=$1', [worldId])).rows[0].economy.resources,
    upgradedResources, 'upgrade keeps tick, nodes, and cooldowns byte-for-byte in JSON value');

  const withoutLedger = structuredClone(upgraded); delete withoutLedger.resources.logging;
  await assert.rejects(f.db.query('select public.mn_save_world($1,$2::jsonb,$3) as data',
    [worldId, withoutLedger, 8]), { code: '22023' });
  const rewrite = structuredClone(upgraded); rewrite.resources.logging['palm-1'] = {
    cycle: 1, contributors: [{ actor, hits: 1 }],
  };
  rewrite.resources.tick++;
  assert.deepEqual((await f.db.query('select public.mn_save_world($1,$2::jsonb,$3) as data',
    [worldId, rewrite, 8])).rows[0].data, { ok: false, why: 'conflict' });
});

test('one logging receipt CAS commits the finisher and offline contributor profiles with the world', async t => {
  const f = await migrated(t);
  const beforeActor = profile(), beforeContributor = profile();
  const nextActor = structuredClone(beforeActor), nextContributor = structuredClone(beforeContributor);
  nextActor.eco.pack.goods.tronco = 2;
  nextActor.eco.tradeRev++;
  nextActor.progression.practice.logging = 3;
  nextContributor.progression.practice.logging = 7;
  const resources = v2Resources();
  resources.tick = 21;
  resources.cooldowns[actor] = 75;
  resources.nodes[0] = { id: 'palm-1', kind: 'palm', rev: 4, hits: 3, readyAt: 3621 };
  resources.logging['palm-1'] = { cycle: 1, contributors: [
    { actor, hits: 1 }, { actor: contributor, hits: 2 },
  ] };
  const oldWorld = world(v2Resources()), nextWorld = world(resources);
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1),($3::uuid,$4::jsonb,1)',
    [actor, beforeActor, contributor, beforeContributor]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, oldWorld]);
  const opId = id(900);
  const request = {
    world: worldId, account: actor,
    command: { type: 'resource', op: 'gather', opId: 'logging-final-1', node: 'palm-1', expectedRev: 3 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: nextActor, worldData: nextWorld,
    ack: { type: 'resource', op: 'gather', opId: 'logging-final-1', ok: true, why: '', rev: 4, good: 'tronco', count: 2, actionTicks: 54 },
    beneficiaries: [
      { account: actor, expectedVersion: 1, before: beforeActor, profile: nextActor },
      { account: contributor, expectedVersion: 1, before: beforeContributor, profile: nextContributor },
    ],
  };
  const commit = raw => f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data', [opId, raw]);

  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok', [opId, request])).rows[0].ok, true);

  const stale = structuredClone(request);
  stale.beneficiaries[1].expectedVersion = 2;
  assert.deepEqual((await commit(stale)).rows[0].data, { ok: false, why: 'conflict' });
  assert.deepEqual((await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [actor])).rows[0],
    { data: beforeActor, version: 1 }, 'a stale offline participant prevents the actor row from being written');
  assert.deepEqual((await f.db.query('select economy,version from public.mn_worlds where world=$1', [worldId])).rows[0],
    { economy: oldWorld, version: 1 }, 'a conflict leaves world and receipts untouched');

  const result = (await commit(request)).rows[0].data;
  assert.equal(result.ok, true);
  assert.deepEqual(result.profiles, [
    { account: actor, version: 2 }, { account: contributor, version: 2 },
  ]);
  assert.deepEqual((await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [actor])).rows[0],
    { data: nextActor, version: 2 });
  assert.deepEqual((await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [contributor])).rows[0],
    { data: nextContributor, version: 2 });
  assert.deepEqual((await f.db.query('select economy,version from public.mn_worlds where world=$1', [worldId])).rows[0],
    { economy: nextWorld, version: 2 });
  assert.deepEqual((await commit(request)).rows[0].data, { ...result, replay: true }, 'replay returns the immutable multi-profile receipt');
});

test('beneficiaries must be sorted and non-actors may change only progression', async t => {
  const f = await migrated(t);
  const beforeActor = profile(), beforeContributor = profile();
  const afterActor = structuredClone(beforeActor), afterContributor = structuredClone(beforeContributor);
  afterActor.eco.pack.goods.tronco = 2; afterActor.eco.tradeRev++;
  afterActor.progression.practice.logging = 3; afterContributor.progression.practice.logging = 7;
  const resources = v2Resources(); resources.tick++;
  resources.nodes[0] = { id: 'palm-1', kind: 'palm', rev: 4, hits: 3, readyAt: 3621 };
  resources.logging['palm-1'] = { cycle: 1, contributors: [{ actor, hits: 1 }, { actor: contributor, hits: 2 }] };
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1),($3::uuid,$4::jsonb,1)',
    [actor, beforeActor, contributor, beforeContributor]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, world(v2Resources())]);
  const request = {
    world: worldId, account: actor,
    command: { type: 'resource', op: 'gather', opId: 'logging-final-2', node: 'palm-1', expectedRev: 3 },
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: afterActor, worldData: world(resources),
    ack: { type: 'resource', op: 'gather', opId: 'logging-final-2', ok: true, why: '', rev: 4, good: 'tronco', count: 2 },
    beneficiaries: [
      { account: actor, expectedVersion: 1, before: beforeActor, profile: afterActor },
      { account: contributor, expectedVersion: 1, before: beforeContributor, profile: afterContributor },
    ],
  };
  const invalidOrder = structuredClone(request); invalidOrder.beneficiaries.reverse();
  assert.deepEqual((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok',
    [id(901), invalidOrder])).rows[0].ok, false);
  const illicitCargo = structuredClone(request); illicitCargo.beneficiaries[1].profile.eco.pack.goods.tronco = 99;
  assert.deepEqual((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok',
    [id(902), illicitCargo])).rows[0].ok, false);
});
