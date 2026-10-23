import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ACCOUNT = 'aaaa0000-0000-4000-8000-000000000001';
const WORLD = 'freshwater-sql';
const OP = 'f0000000-0000-4000-8000-000000000001';
const SEED = 314;
const copy = value => structuredClone(value);
const TOWNS = ['aldea','cala','sol','ceniza','corona','coral'];
const initialWorld = () => ({ v: 1, seed: SEED, economy: { v: 2,
  markets: Object.fromEntries(TOWNS.map(id => [id, { id, stock: {}, last: {} }])),
  plots: Object.fromEntries(TOWNS.map(id => [id, []])) } });

async function database() {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
    const names = ['001_store','002_accounts','003_pearl_operations','004_pearl_ground','005_pearl_journal','006_pearl_same_holder',
      '007_pearl_batch','008_pearl_batch_journal','009_death_operations','010_death_journal','011_death_drop_lifecycle',
      '012_death_drop_journal','013_ground_clock','014_economic_operations','015_resource_operations','016_logging_operations',
      '017_agent_goods_budget','018_ground_transactions','019_ground_transaction_journal','020_gm_drafts','021_artisan_operations',
      '022_fire_operations','023_ground_world_adoption','024_starter_workshop','025_companion_config',
      '026_workshop_raft_identifiers','027_companion_control','028_inference_config','029_attribute_operations','030_freshwater_operations'];
    for (const name of names)
      await db.exec(await readFile(new URL(`../server/migrations/${name}.sql`, import.meta.url), 'utf8'));
    const profile = { v: 1, lvl: 1, carry: { v: 1, backpack: 0 }, eco: { tradeRev: 0,
      pack: { cap: 18, maxMass: 18, goods: { madera: 2 } }, ships: [] } };
    const world = initialWorld();
    await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [ACCOUNT, profile]);
    await db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, world]);
    return { db, profile, world, close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}

function request(before, profile, command, ack, world = initialWorld(), expectedProfileVersion = 1, expectedWorldVersion = 1) {
  return { world: WORLD, account: ACCOUNT, command, expectedProfileVersion, expectedWorldVersion,
    before, profile, worldData: world, ack };
}

function craftRequest(before, opId = 'freshwater-craft') {
  const profile = copy(before);
  profile.eco.pack.goods = {};
  profile.eco.pack.vessels = [{ id: 'bucket', kind: 'bucket', water: 0 }];
  profile.eco.tradeRev++;
  const command = { type: 'freshwater', op: 'craftBucket', opId, expectedRev: before.eco.tradeRev,
    source: '', ship: '', part: '', n: 0 };
  const ack = { type: 'freshwater', op: command.op, opId, ok: true, why: '', rev: profile.eco.tradeRev };
  return request(before, profile, command, ack);
}

function raftProfile() {
  const p = { v: 1, lvl: 1, carry: { v: 1, backpack: 0 }, eco: { tradeRev: 0,
    pack: { cap: 18, maxMass: 18, goods: {} }, ships: [] } };
  p.eco.ships.push({ id: 'raft-1', kind: 'raft', at: 'aldea', hp: 100, rev: 1,
    grid: { parts: [['foundation',0,0,0,0], ['floor',0,0,1,0]] },
    condition: { v: 1, next: 1, entries: [['base','foundation',0,0,0,0,25],['floor','floor',0,0,1,0,25]] },
    hold: { cap: 6, goods: { madera: 2 } } });
  p.eco.pack.goods = { madera: 2 };
  return p;
}

function barrelProfile() {
  const p = raftProfile(), ship = p.eco.ships[0];
  ship.grid.parts.push(['waterBarrel',0,0,1,0]);
  ship.condition.next = 2;
  ship.condition.entries.push(['p1','waterBarrel',0,0,1,0,25]);
  return p;
}

function barrelPlace(before) {
  const profile = copy(before), ship = profile.eco.ships[0];
  ship.grid.parts.push(['waterBarrel',0,0,1,0]);
  ship.condition.next = 2;
  ship.condition.entries.push(['p1','waterBarrel',0,0,1,0,25]);
  ship.hold.goods = {};
  profile.eco.pack.goods = {};
  ship.rev++;
  const command = { type: 'raft', op: 'place', opId: 'barrel-place', id: ship.id, expectedRev: 1,
    piece: ['waterBarrel',0,0,1,0], rules: 2 };
  const ack = { type: 'raftEdit', id: ship.id, op: 'place', opId: command.opId, ok: true, why: '', rev: 2 };
  return request(before, profile, command, ack);
}

test('SQL030 stores freshwater commands in the existing immutable economic receipt with replay', async t => {
  const f = await database();
  t.after(() => f.close());
  assert.deepEqual((await f.db.query('select public.mn_freshwater_operations_ready() as ready')).rows[0].ready, { version: 1 });
  const grants = (await f.db.query("select has_function_privilege('service_role','public.mn_commit_economic_operation_freshwater_base(uuid,jsonb)','EXECUTE') as base, has_function_privilege('service_role','public.mn_freshwater_raft_profile_transition(jsonb)','EXECUTE') as helper")).rows[0];
  assert.equal(grants.base, false, 'the renamed writer is inaccessible to direct service-role calls');
  assert.equal(grants.helper, true, 'the trusted wrapper can execute the raft transition helper');
  const before = copy(f.profile), opId = OP;
  const req = craftRequest(before, 'freshwater-craft');
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok', [opId, req])).rows[0].ok, true);
  const committed = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result', [opId, req])).rows[0].result;
  assert.equal(committed.ok, true);
  const saved = (await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.data.eco.pack.vessels, [{ id: 'bucket', kind: 'bucket', water: 0 }]);
  assert.deepEqual(saved.data.eco.pack.goods, {});
  const replay = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result', [opId, req])).rows[0].result;
  assert.equal(replay.replay, true);
  assert.equal((await f.db.query('select version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].version, 2);
});

test('SQL030 rejects forged vessel deltas, duplicate containers, and unsupported command shapes', async t => {
  const f = await database();
  t.after(() => f.close());
  const before = copy(f.profile), req = craftRequest(before, 'freshwater-invalid');
  const forged = copy(req); forged.profile.gold++;
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) as ok', [forged])).rows[0].ok, false);
  const duplicate = copy(req); duplicate.profile.eco.pack.vessels.push({ id: 'bucket', kind: 'bucket', water: 0 });
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok', [OP, duplicate])).rows[0].ok, false);
  const extra = copy(req); extra.command.untrusted = true;
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok', [OP, extra])).rows[0].ok, false);
  const collision = await f.db.query("select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result", [OP, forged]);
  assert.ok(collision.rows[0].result.why === 'operation' || collision.rows[0].result.ok === false);
});

test('SQL030 keeps legacy profiles without vessels valid and rejects invalid container bounds', async t => {
  const f = await database();
  t.after(() => f.close());
  const legacy = copy(f.profile);
  delete legacy.eco.pack.vessels;
  assert.equal((await f.db.query('select public.mn_freshwater_valid_profile($1::jsonb) as ok', [legacy])).rows[0].ok, true);
  const invalid = copy(legacy);
  invalid.eco.pack.vessels = [{ id: 'bucket', kind: 'bucket', water: 5 }];
  assert.equal((await f.db.query('select public.mn_freshwater_valid_profile($1::jsonb) as ok', [invalid])).rows[0].ok, false);
  const noCapacity = copy(legacy);
  noCapacity.eco.pack.vessels = [{ id: 'bucket', kind: 'bucket', water: 0 }];
  noCapacity.eco.pack.cap = 1;
  assert.equal((await f.db.query('select public.mn_freshwater_valid_profile($1::jsonb) as ok', [noCapacity])).rows[0].ok, false);
});

test('SQL030 records a denied freshwater interaction without changing profile contents', async t => {
  const f = await database();
  t.after(() => f.close());
  const before = copy(f.profile);
  const command = { type: 'freshwater', op: 'fill', opId: 'freshwater-empty-bucket', expectedRev: before.eco.tradeRev,
    source: 'salty-spring', ship: '', part: '', n: 1 };
  const ack = { type: 'freshwater', op: command.op, opId: command.opId, ok: false, why: 'container', rev: before.eco.tradeRev };
  const req = request(before, copy(before), command, ack);
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok', [OP, req])).rows[0].ok, true);
  const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result', [OP, req])).rows[0].result;
  assert.equal(result.ok, true, 'the denial itself is a durable terminal receipt');
  assert.deepEqual((await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data, before);
});

test('SQL030 charges hold-first for a waterBarrel and rejects filled-barrel removal', async t => {
  const f = await database();
  t.after(() => f.close());
  const before = raftProfile(), req = barrelPlace(before);
  assert.equal((await f.db.query('select public.mn_freshwater_valid_profile($1::jsonb) as ok', [before])).rows[0].ok, true);
  const implicitEmpty = barrelProfile();
  implicitEmpty.eco.ships[0].hold.vessels = [];
  assert.equal((await f.db.query('select public.mn_freshwater_valid_profile($1::jsonb) as ok', [implicitEmpty])).rows[0].ok, true);
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok', [OP, req])).rows[0].ok, true);
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) as ok', [req])).rows[0].ok, true);
  const placed = copy(req.profile);
  const emptyAfter = copy(placed), emptyShip = emptyAfter.eco.ships[0];
  emptyShip.grid.parts.pop(); emptyShip.condition.entries.pop(); emptyShip.rev++;
  emptyAfter.eco.pack.goods = { madera: 2 };
  const emptyRemove = request(placed, emptyAfter,
    { type: 'raft', op: 'remove', opId: 'barrel-empty-remove', id: 'raft-1', expectedRev: 2,
      piece: ['waterBarrel',0,0,1,0], index: 2, rules: 2 },
    { type: 'raftEdit', id: 'raft-1', op: 'remove', opId: 'barrel-empty-remove', ok: true, why: '', rev: 3 });
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) as ok', [emptyRemove])).rows[0].ok, true);
  const filled = copy(req.profile);
  filled.eco.ships[0].hold.vessels = [{ id: 'p1', kind: 'barrel', water: 1 }];
  const removeCommand = { type: 'raft', op: 'remove', opId: 'barrel-remove', id: 'raft-1', expectedRev: 2,
    piece: ['waterBarrel',0,0,1,0], index: 2, rules: 2 };
  const removeAck = { type: 'raftEdit', id: 'raft-1', op: 'remove', opId: removeCommand.opId, ok: true, why: '', rev: 3 };
  const forgedRemove = request(req.profile, filled, removeCommand, removeAck);
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) as ok', [forgedRemove])).rows[0].ok, false);
  const filledBaseline = copy(req.profile);
  filledBaseline.eco.ships[0].hold.vessels = [{ id: 'p1', kind: 'barrel', water: 1 }];
  const filledAfter = copy(filledBaseline);
  filledAfter.eco.ships[0].grid.parts.pop(); filledAfter.eco.ships[0].condition.entries.pop();
  filledAfter.eco.ships[0].hold.vessels = [];
  filledAfter.eco.ships[0].rev++;
  filledAfter.eco.pack.goods = { madera: 2 };
  const filledRemove = request(filledBaseline, filledAfter, removeCommand, removeAck);
  assert.equal((await f.db.query('select public.mn_freshwater_profile_transition($1::jsonb) as ok', [filledRemove])).rows[0].ok, false);
});

test('SQL030 commits fill, deposit, withdraw, and decant through the existing receipt writer', async t => {
  const f = await database();
  t.after(() => f.close());
  let profile = barrelProfile();
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [ACCOUNT, profile]);
  let profileVersion = 1, worldVersion = 1;
  const commit = async (command, mutate) => {
    const before = copy(profile), after = copy(profile);
    mutate(after);
    const ack = { type: 'freshwater', op: command.op, opId: command.opId, ok: true, why: '', rev: after.eco.tradeRev };
    const req = request(before, after, command, ack, initialWorld(), profileVersion, worldVersion);
    await f.db.exec('SET ROLE service_role');
    const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result',
      [`f0000000-0000-4000-8000-${String(profileVersion).padStart(12,'0')}`, req])).rows[0].result;
    await f.db.exec('RESET ROLE');
    assert.equal(result.ok, true, `${command.op} receipt rejected: ${result.why}`);
    profileVersion++; worldVersion++;
    profile = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data;
  };
  await commit({ type:'freshwater', op:'craftBucket', opId:'seq-craft', expectedRev:0, source:'', ship:'', part:'', n:0 }, p => {
    p.eco.pack.goods = {};
    p.eco.pack.vessels = [{ id:'bucket', kind:'bucket', water:0 }];
    p.eco.tradeRev++;
  });
  await commit({ type:'freshwater', op:'fill', opId:'seq-fill', expectedRev:1, source:'salty-spring', ship:'', part:'', n:4 }, p => {
    p.eco.pack.vessels[0].water = 4; p.eco.tradeRev++;
  });
  await commit({ type:'freshwater', op:'deposit', opId:'seq-deposit', expectedRev:2, source:'', ship:'raft-1', part:'p1', n:3 }, p => {
    p.eco.pack.vessels[0].water = 1;
    p.eco.ships[0].hold.vessels = [{ id:'p1', kind:'barrel', water:3 }];
    p.eco.ships[0].rev++; p.eco.tradeRev++;
  });
  await commit({ type:'freshwater', op:'withdraw', opId:'seq-withdraw', expectedRev:3, source:'', ship:'raft-1', part:'p1', n:2 }, p => {
    p.eco.pack.vessels[0].water = 3;
    p.eco.ships[0].hold.vessels[0].water = 1;
    p.eco.ships[0].rev++; p.eco.tradeRev++;
  });
  await commit({ type:'freshwater', op:'decant', opId:'seq-decant', expectedRev:4, source:'', ship:'', part:'', n:2 }, p => {
    p.eco.pack.vessels[0].water = 1; p.eco.pack.goods.agua = 2; p.eco.tradeRev++;
  });
  assert.deepEqual(profile.eco.pack.vessels, [{ id:'bucket', kind:'bucket', water:1 }]);
  assert.deepEqual(profile.eco.pack.goods, { agua:2 });
  assert.deepEqual(profile.eco.ships[0].hold.vessels, [{ id:'p1', kind:'barrel', water:1 }]);
  assert.equal(profile.eco.ships[0].rev, 3);
  assert.equal(profile.eco.tradeRev, 5);
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_economic_operations')).rows[0].n, 5);
});

test('SQL030 replays an ordinary no-before receipt after bucket crafting changes the profile vessels', async t => {
  const f = await database();
  t.after(() => f.close());
  const before = copy(f.profile);
  const command = { type:'commerce', op:'buy', opId:'old-denied-buy', town:'aldea', g:'madera', n:1, expectedTotal:0 };
  const original = { world:WORLD, account:ACCOUNT, command, expectedProfileVersion:1, expectedWorldVersion:1,
    profile:copy(before), worldData:initialWorld(), ack:{ type:'commerce', op:'buy', opId:command.opId, ok:false, why:'gold', rev:0 } };
  const first = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result', [OP, original])).rows[0].result;
  assert.equal(first.ok, true);
  const state = (await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
  const world = (await f.db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0];
  const afterCraft = copy(state.data);
  afterCraft.eco.pack.goods = {};
  afterCraft.eco.pack.vessels = [{ id:'bucket', kind:'bucket', water:0 }];
  afterCraft.eco.tradeRev++;
  const craft = { type:'freshwater', op:'craftBucket', opId:'after-old-buy', expectedRev:0, source:'', ship:'', part:'', n:0 };
  const craftReq = request(state.data, afterCraft, craft,
    { type:'freshwater', op:'craftBucket', opId:craft.opId, ok:true, why:'', rev:1 },
    initialWorld(), state.version, world.version);
  assert.equal((await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result',
    ['f0000000-0000-4000-8000-000000000002', craftReq])).rows[0].result.ok, true);
  const replay = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result', [OP, original])).rows[0].result;
  assert.equal(replay.replay, true);
});

test('SQL030 records stale rules:2 raft no-op denials with the normal current-revision record', async t => {
  const f = await database();
  t.after(() => f.close());
  const before = barrelProfile();
  before.eco.ships[0].rev = 4;
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [ACCOUNT, before]);
  const command = { type:'raft', op:'remove', opId:'stale-barrel-remove', id:'raft-1', expectedRev:1,
    piece:['waterBarrel',0,0,1,0], index:2, rules:2 };
  const ack = { type:'raftEdit', id:'raft-1', op:'remove', opId:command.opId, ok:false, why:'revision', rev:4,
    record:{ id:'raft-1', revision:4 } };
  const req = request(before, copy(before), command, ack);
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok', [OP, req])).rows[0].ok, true);
  const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result', [OP, req])).rows[0].result;
  assert.equal(result.ok, true);
  assert.deepEqual((await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data, before);
});

test('SQL030 preserves and validates bucket mass through attribute assignment', async t => {
  const f = await database();
  t.after(() => f.close());
  const before = copy(f.profile);
  before.lvl = 3;
  before.carry = { v:1, backpack:0 };
  before.attr = { v:1, carga:0, re:0 };
  before.eco.pack = { cap:18, maxMass:50, goods:{}, vessels:[{ id:'bucket', kind:'bucket', water:4 }] };
  await f.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [ACCOUNT, before]);
  const profile = copy(before);
  profile.attr.carga = 1; profile.eco.pack.maxMass = 55; profile.eco.tradeRev++;
  const command = { type:'attributes', op:'assign', opId:'water-carga', expectedRev:0, stat:'carga', n:1 };
  const req = request(before, profile, command, { type:'attributes', op:'assign', opId:command.opId, ok:true, why:'', rev:1,
    points:{ earned:2, invested:1, available:1, resetsLeft:1 },
    limits:{ volume:18, comfortableMass:44, maxMass:55 } });
  assert.equal((await f.db.query('select public.mn_valid_economic_request($1::uuid,$2::jsonb) as ok', [OP, req])).rows[0].ok, true);
  const result = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as result', [OP, req])).rows[0].result;
  assert.equal(result.ok, true);
  assert.deepEqual(result.ack, req.ack);
  const saved = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0].data;
  assert.deepEqual(saved.eco.pack.vessels, [{ id:'bucket', kind:'bucket', water:4 }]);
});
