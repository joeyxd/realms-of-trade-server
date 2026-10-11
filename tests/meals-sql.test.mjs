import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Economy } from '../src/sim/economy/economy.js';
import { freshwaterProfileDelta } from '../src/sim/economy/waterContainers.js';

const ACCOUNT = 'aaaa0000-0000-4000-8000-000000000035';
const WORLD = 'special-meals-sql';
const OP = 'f3500000-0000-4000-8000-000000000001';
const copy = value => structuredClone(value);
const TOWNS = ['aldea','cala','sol','ceniza','corona','coral'];
const initialWorld = () => ({ v: 1, seed: 350, economy: { v: 2,
  markets: Object.fromEntries(TOWNS.map(id => [id, { id, stock: {}, last: {} }])),
  plots: Object.fromEntries(TOWNS.map(id => [id, []])) } });

async function database({ include035 = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
    const names = ['001_store','002_accounts','003_pearl_operations','004_pearl_ground','005_pearl_journal','006_pearl_same_holder',
      '007_pearl_batch','008_pearl_batch_journal','009_death_operations','010_death_journal','011_death_drop_lifecycle',
      '012_death_drop_journal','013_ground_clock','014_economic_operations','015_resource_operations','016_logging_operations',
      '017_agent_goods_budget','018_ground_transactions','019_ground_transaction_journal','020_gm_drafts','021_artisan_operations',
      '022_fire_operations','023_ground_world_adoption','024_starter_workshop','025_companion_config',
      '026_workshop_raft_identifiers','027_companion_control','028_inference_config','029_attribute_operations',
      '030_freshwater_operations','031_gm_terrain_drafts','032_canteen_survival_operations','033_gm_terrain_materials',
      '034_companion_creation'];
    if (include035) names.push('035_special_meal_operations');
    for (const name of names)
      await db.exec(await readFile(new URL(`../server/migrations/${name}.sql`, import.meta.url), 'utf8'));
    const profile = { v: 1, lvl: 1, carry: { v: 1, backpack: 0 }, eco: { tradeRev: 0,
      pack: { cap: 18, maxMass: 18, goods: { pescado: 2, ron: 2, agua: 2, galleta: 2, harina: 2, madera: 2, fruta: 2 }, vessels: [] }, ships: [] } };
    const world = initialWorld();
    await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [ACCOUNT, profile]);
    await db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, world]);
    return { db, profile, world, close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}

async function serviceRole(db, action) {
  await db.exec('SET ROLE service_role');
  try { return await action(); }
  finally { await db.exec('RESET ROLE'); }
}

function request(before, profile, command, ack, world = initialWorld(), expectedProfileVersion = 1, expectedWorldVersion = 1) {
  return { world: WORLD, account: ACCOUNT, command, expectedProfileVersion, expectedWorldVersion,
    before, profile, worldData: world, ack };
}

function mealCommand(profile, source, opId, extra = {}) {
  return { type:'freshwater', op:'meal', opId, expectedRev:profile.eco.tradeRev,
    source, ship:'', part:'', n:1, ...extra };
}

function mealDelta(before, command) {
  const after = copy(before), kind = command.source;
  const costs = kind === 'roastFish' ? { pescado:1 } : kind === 'grog' ? { ron:1, agua:1 } : { galleta:1, harina:1 };
  for (const [good, count] of Object.entries(costs)) {
    if ((after.eco.pack.goods[good] ?? 0) < count) return null;
    after.eco.pack.goods[good] -= count;
    if (!after.eco.pack.goods[good]) delete after.eco.pack.goods[good];
  }
  after.eco.pack.vessels ??= [];
  const oldNeeds = before.surv ?? { v:1, sat:100, hyd:100 };
  const sat = kind === 'roastFish' ? 35 : kind === 'grog' ? 5 : 25;
  const hyd = kind === 'grog' ? 55 : 0;
  after.surv = { v:1, sat:Math.min(100,oldNeeds.sat+sat), hyd:Math.min(100,oldNeeds.hyd+hyd) };
  after.meal = { v:1, kind, ticks:54000 };
  after.eco.tradeRev++;
  return after;
}

async function commitMeal(f, before, source, opId, versions = { profile:1, world:1 }, operationId = OP) {
  const command = mealCommand(before, source, opId, source === 'grog' ? {} : { ship:'raft-1', part:'p1' });
  const profile = mealDelta(before, command);
  const ack = { type:'freshwater', op:'meal', opId, ok:true, why:'', rev:profile.eco.tradeRev };
  const req = request(before, profile, command, ack, f.world, versions.profile, versions.world);
  const result = await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [operationId, req])).rows[0].result);
  return { command, profile, req, result };
}

test('SQL035 readiness, strict meal profile, and service-role-only helper ACL', async t => {
  const f = await database(); t.after(() => f.close());
  const migration = await readFile(new URL('../server/migrations/035_special_meal_operations.sql', import.meta.url), 'utf8');
  await f.db.exec(migration);
  await f.db.exec(migration);
  assert.deepEqual(await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_special_meal_operations_ready() ready')).rows[0].ready), { version:1 });
  const acl = (await f.db.query(`select has_function_privilege('service_role','public.mn_special_meal_operations_ready()','EXECUTE') as service,
    has_function_privilege('anon','public.mn_special_meal_operations_ready()','EXECUTE') as anon,
    has_function_privilege('authenticated','public.mn_freshwater_profile_transition(jsonb)','EXECUTE') as authenticated`)).rows[0];
  assert.deepEqual(acl, { service:true, anon:false, authenticated:false });
  const constraint = (await f.db.query(`select pg_catalog.pg_get_expr(c.conbin,c.conrelid) expression,
    pg_catalog.bool_or(d.refobjid='public.mn_valid_economic_request(uuid,jsonb)'::pg_catalog.regprocedure::oid) as current_validator,
    pg_catalog.bool_or(d.refobjid='public.mn_valid_economic_request_034(uuid,jsonb)'::pg_catalog.regprocedure::oid) as old_validator
    from pg_catalog.pg_constraint c join pg_catalog.pg_depend d on d.classid='pg_catalog.pg_constraint'::pg_catalog.regclass and d.objid=c.oid
      and d.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass
    where c.conrelid='public.mn_economic_operations'::pg_catalog.regclass and c.conname='mn_economic_operations_resource_check'
    group by c.conbin,c.conrelid`)).rows[0];
  assert.match(constraint.expression, /IS TRUE/i);
  assert.equal(constraint.current_validator, true);
  assert.equal(constraint.old_validator, false);
  for (const value of [
    { v:1, kind:'roastFish', ticks:1 }, { v:1, kind:'grog', ticks:54000 }, { v:1, kind:'heartyBiscuit', ticks:7 },
  ]) assert.equal((await f.db.query('select public.mn_survival_profile_valid($1::jsonb) ok', [{ ...f.profile, meal:value }])).rows[0].ok, true);
  for (const value of [null, { v:1, kind:'roastFish', ticks:0 }, { v:1, kind:'roastFish', ticks:54001 },
    { v:1, kind:'roastFish', ticks:1.5 }, { v:1, kind:'unknown', ticks:1 }, { v:1, kind:'grog', ticks:1, extra:true },
    { v:2, kind:'grog', ticks:1 }, { v:1, kind:'grog', ticks:'1' }]) {
    assert.equal((await f.db.query('select public.mn_survival_profile_valid($1::jsonb) ok', [{ ...f.profile, meal:value }])).rows[0].ok, false);
  }
  assert.equal((await f.db.query('select public.mn_survival_profile_valid($1::jsonb) ok', [f.profile])).rows[0].ok, true);
});

test('SQL035 commits all three recipes, needs, container normalization, and replacement at full needs', async t => {
  const f = await database(); t.after(() => f.close());
  let before = copy(f.profile), versions = { profile:1, world:1 };
  before.surv = { v:1, sat:80, hyd:70 };
  before.meal = { v:1, kind:'grog', ticks:120 };
  delete before.eco.pack.vessels;
  await f.db.query('update public.mn_profiles set data=$1::jsonb where player_id=$2::uuid', [before, ACCOUNT]);
  const expected = [
    ['roastFish', { sat:100, hyd:70 }, { pescado:1 }],
    ['grog', { sat:100, hyd:100 }, { ron:1, agua:1 }],
    ['heartyBiscuit', { sat:100, hyd:100 }, { galleta:1, harina:1 }],
  ];
  let seq = 1;
  for (const [kind, needs, costs] of expected) {
    const { profile, req, result } = await commitMeal(f, before, kind, `meal-${seq}`, versions,
      `f3500000-0000-4000-8000-${String(seq++).padStart(12,'0')}`);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(profile.surv, { v:1, ...needs });
    assert.deepEqual(profile.meal, { v:1, kind, ticks:54000 });
    assert.deepEqual(profile.eco.pack.vessels, []);
    for (const [good, count] of Object.entries(costs)) assert.equal((before.eco.pack.goods[good] ?? 0) - (profile.eco.pack.goods[good] ?? 0), count);
    const replay = await serviceRole(f.db, async () => (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [
      `f3500000-0000-4000-8000-${String(seq-1).padStart(12,'0')}`, req])).rows[0].result);
    assert.equal(replay.replay, true);
    const persisted = (await f.db.query(`select p.data,p.version,w.version as world_version
      from public.mn_profiles p cross join public.mn_worlds w
      where p.player_id=$1::uuid and w.world=$2`, [ACCOUNT, WORLD])).rows[0];
    assert.deepEqual(persisted.data, profile);
    before = persisted.data; versions = { profile:persisted.version, world:persisted.world_version };
  }
});

test('SQL035 rejects forged recipe, vessel, cost, needs, and meal deltas', async t => {
  const f = await database(); t.after(() => f.close());
  const before = copy(f.profile); before.surv = { v:1, sat:10, hyd:20 };
  const command = mealCommand(before, 'roastFish', 'meal-forge', { ship:'raft-1', part:'p1' });
  const profile = mealDelta(before, command);
  const ack = { type:'freshwater', op:'meal', opId:command.opId, ok:true, why:'', rev:1 };
  const req = request(before, profile, command, ack);
  const mutations = [
    r => { r.command.source='roast-fish'; }, r => { r.command.n=0; },
    r => { r.command.ship=''; }, r => { r.command.part='part-1'; },
    r => { r.profile.eco.pack.goods.pescado=2; }, r => { r.profile.surv.sat=100; },
    r => { r.profile.meal.ticks=53999; }, r => { r.profile.meal.kind='grog'; },
    r => { r.profile.eco.pack.vessels=[{ id:'canteen', kind:'canteen', water:1 }]; },
  ];
  for (const mutate of mutations) {
    const bad = copy(req); mutate(bad);
    assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) ok', [bad])).rows[0].ok, false);
  }
  for (const commandBad of [
    mealCommand(before, 'roastFish', 'bad-source', { ship:'raft-1', part:'bad' }),
    mealCommand(before, 'grog', 'bad-grog-target', { ship:'raft-1' }),
    mealCommand(before, 'heartyBiscuit', 'bad-ship', { ship:'bad ship', part:'p1' }),
    mealCommand(before, 'roastFish', 'bad-count', { ship:'raft-1', part:'p1', n:2 }),
  ]) {
    const bad = request(before, profile, commandBad, { ...ack, opId:commandBad.opId });
    assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [OP, bad])).rows[0].ok, false);
  }
});

test('SQL035 records a valid no-op denial when ingredients are missing and replays it exactly', async t => {
  const f = await database(); t.after(() => f.close());
  const before = copy(f.profile); before.eco.pack.goods = { madera:2 };
  before.meal = { v:1, kind:'grog', ticks:100 };
  await f.db.query('update public.mn_profiles set data=$1::jsonb where player_id=$2::uuid', [before, ACCOUNT]);
  const command = mealCommand(before, 'roastFish', 'meal-denied', { ship:'raft-1', part:'p1' });
  const ack = { type:'freshwater', op:'meal', opId:command.opId, ok:false, why:'empty', rev:0 };
  const req = request(before, copy(before), command, ack);
  const result = await serviceRole(f.db, async () => (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, req])).rows[0].result);
  assert.equal(result.ok, true);
  assert.equal(result.ack.ok, false);
  assert.deepEqual((await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data, before);
  const replay = await serviceRole(f.db, async () => (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, req])).rows[0].result);
  assert.equal(replay.replay, true);
  const mismatch = copy(req); mismatch.command.source='grog';
  assert.deepEqual(await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, mismatch])).rows[0].result),
    { ok:false, why:'operation' });
});

test('SQL035 freezes meal state on old drink, eat, bucket, and unrelated economic receipts', async t => {
  for (const family of ['drink','eat','bucket']) {
    const f = await database();
    try {
      const before = copy(f.profile); before.meal = { v:1, kind:'roastFish', ticks:321 };
      before.surv = { v:1, sat:40, hyd:50 };
      let command; let profile;
      if (family === 'bucket') {
        before.eco.pack.goods = { madera:2 };
        command = { type:'freshwater', op:'craftBucket', opId:'legacy-bucket', expectedRev:0, source:'', ship:'', part:'', n:0 };
        profile = freshwaterProfileDelta(before, command).profile;
      } else if (family === 'eat') {
        before.eco.pack.goods = { fruta:1 };
        command = { type:'freshwater', op:'eat', opId:'legacy-eat', expectedRev:0, source:'fruta', ship:'', part:'', n:1 };
        profile = freshwaterProfileDelta(before, command).profile;
      } else {
        before.eco.pack.goods = {};
        before.eco.pack.vessels = [{ id:'canteen', kind:'canteen', water:1 }];
        command = { type:'freshwater', op:'drink', opId:'legacy-drink', expectedRev:0, source:'', ship:'', part:'', n:1 };
        profile = freshwaterProfileDelta(before, command).profile;
      }
      await f.db.query('update public.mn_profiles set data=$1::jsonb where player_id=$2::uuid', [before, ACCOUNT]);
      const ack = { type:'freshwater', op:command.op, opId:command.opId, ok:true, why:'', rev:1 };
      const req = request(before, profile, command, ack);
      const checks = (await f.db.query(`select public.mn_valid_economic_request($1::uuid,$2::jsonb) valid,
        public.mn_freshwater_profile_transition($2::jsonb) transition`, [OP, req])).rows[0];
      assert.deepEqual(checks, { valid:true, transition:true }, family);
      assert.equal(await serviceRole(f.db, async () => (await f.db.query(
        'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, req])).rows[0].result.ok), true, family);
      assert.deepEqual(profile.meal, before.meal);
      await f.close();
    } catch (error) { await f.close(); throw error; }
  }

  const f = await database(); t.after(() => f.close());
  const before = copy(f.profile); before.eco.pack.goods = {}; before.meal = { v:1, kind:'grog', ticks:99 };
  await f.db.query('update public.mn_profiles set data=$1::jsonb where player_id=$2::uuid', [before, ACCOUNT]);
  const command = { type:'commerce', op:'buy', opId:'ordinary-meal-freeze', town:'aldea', g:'madera', n:1, expectedTotal:0 };
  const baseAck = { type:'commerce', op:'buy', opId:command.opId, ok:false, why:'gold', rev:0 };
  for (const mutate of [
    p => { p.meal = { v:1, kind:'roastFish', ticks:54000 }; },
    p => { delete p.meal; },
    p => { p.meal.ticks = 54000; },
  ]) {
    const profile = copy(before); mutate(profile);
    const req = { world:WORLD, account:ACCOUNT, command, expectedProfileVersion:1, expectedWorldVersion:1,
      profile, worldData:f.world, ack:baseAck };
    assert.equal(await serviceRole(f.db, async () => (await f.db.query(
      'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, req])).rows[0].result.ok), false);
  }
  const req = { world:WORLD, account:ACCOUNT, command, expectedProfileVersion:1, expectedWorldVersion:1,
    profile:copy(before), worldData:f.world, ack:baseAck };
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) valid', [OP, req])).rows[0].valid, true);
  assert.equal(await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, req])).rows[0].result.ok), true);
});

test('SQL035 replays a pre-migration economic receipt byte-for-byte', async t => {
  const f = await database({ include035:false }); t.after(() => f.close());
  const before = copy(f.profile); before.eco.pack.goods = { madera:2 };
  await f.db.query('update public.mn_profiles set data=$1::jsonb where player_id=$2::uuid', [before, ACCOUNT]);
  const command = { type:'freshwater', op:'craftBucket', opId:'before-sql035', expectedRev:0, source:'', ship:'', part:'', n:0 };
  const profile = freshwaterProfileDelta(before, command).profile;
  const ack = { type:'freshwater', op:'craftBucket', opId:command.opId, ok:true, why:'', rev:1 };
  const req = request(before, profile, command, ack);
  const saved = await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, req])).rows[0].result);
  assert.equal(saved.ok, true);
  const prior = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid', [OP])).rows[0];
  const migration = await readFile(new URL('../server/migrations/035_special_meal_operations.sql', import.meta.url), 'utf8');
  await f.db.exec(migration);
  const replay = await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [OP, req])).rows[0].result);
  assert.equal(replay.replay, true);
  const after = (await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid', [OP])).rows[0];
  assert.deepEqual(after.request, prior.request);
  assert.deepEqual(after.result, prior.result);
  assert.deepEqual((await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data, profile);
});

test('SQL035 validates actor and cooperative beneficiaries with frozen meal fields', async t => {
  const f = await database(); t.after(() => f.close());
  const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const contributor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const seed = 91, worldId = 'meal-logging-world';
  const baseProfile = () => {
    const p = copy(f.profile);
    p.progression = { v:1, practice:{ logging:0 }, milestones:[], knowledge:[] };
    p.surv = { v:1, sat:60, hyd:45 };
    return p;
  };
  const beforeActor = baseProfile(); beforeActor.meal = { v:1, kind:'roastFish', ticks:1234 };
  const beforeContributor = baseProfile(); beforeContributor.meal = { v:1, kind:'grog', ticks:4321 };
  const nextActor = copy(beforeActor), nextContributor = copy(beforeContributor);
  nextActor.eco.pack.goods.tronco = 2; nextActor.eco.tradeRev++;
  nextActor.progression.practice.logging = 3;
  nextContributor.progression.practice.logging = 7;
  const oldResources = { v:2, tick:20, nodes:[
    { id:'palm-1', kind:'palm', rev:3, hits:2, readyAt:0 },
    { id:'rock-1', kind:'rock', rev:1, hits:0, readyAt:0 },
  ], cooldowns:{}, logging:{ 'palm-1':{ cycle:1, contributors:[{ actor:contributor, hits:2 }] } } };
  const nextResources = copy(oldResources);
  nextResources.tick = 21; nextResources.cooldowns[actor] = 75;
  nextResources.nodes[0] = { id:'palm-1', kind:'palm', rev:4, hits:3, readyAt:3621 };
  nextResources.logging['palm-1'] = { cycle:1, contributors:[{ actor, hits:1 },{ actor:contributor, hits:2 }] };
  const world = resources => ({ v:1, seed, economy:new Economy(seed).serialize(), resources });
  const oldWorld = world(oldResources), nextWorld = world(nextResources);
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1),($3::uuid,$4::jsonb,1)',
    [actor, beforeActor, contributor, beforeContributor]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [worldId, oldWorld]);
  const operationId = 'f3500000-0000-4000-8000-000000000099';
  const req = {
    world:worldId, account:actor,
    command:{ type:'resource', op:'gather', opId:'meal-logging-final', node:'palm-1', expectedRev:3 },
    expectedProfileVersion:1, expectedWorldVersion:1, profile:nextActor, worldData:nextWorld,
    ack:{ type:'resource', op:'gather', opId:'meal-logging-final', ok:true, why:'', rev:4, good:'tronco', count:2, actionTicks:54 },
    beneficiaries:[
      { account:actor, expectedVersion:1, before:beforeActor, profile:nextActor },
      { account:contributor, expectedVersion:1, before:beforeContributor, profile:nextContributor },
    ],
  };
  assert.equal(await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [operationId, req])).rows[0].ok), true);
  const forged = copy(req); forged.beneficiaries[1].profile.meal.ticks = 1;
  assert.equal(await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_valid_economic_request($1::uuid,$2::jsonb) ok', [operationId, forged])).rows[0].ok), false);
  assert.equal(await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [operationId, forged])).rows[0].result.ok), false);
  const committed = await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [operationId, req])).rows[0].result);
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.deepEqual((await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [actor])).rows[0],
    { data:nextActor, version:2 });
  assert.deepEqual((await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [contributor])).rows[0],
    { data:nextContributor, version:2 });
  assert.deepEqual(nextActor.meal, beforeActor.meal);
  assert.deepEqual(nextContributor.meal, beforeContributor.meal);
  const replay = await serviceRole(f.db, async () => (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result', [operationId, req])).rows[0].result);
  assert.equal(replay.replay, true);
});
