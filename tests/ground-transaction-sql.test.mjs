import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { upgradeLoggingState } from '../server/resourceState.mjs';
import { economicOperation } from '../server/economicOperation.mjs';
import { groundOperation } from '../server/pearlGround.mjs';
import { deathOperation } from '../server/deathOperation.mjs';
import { deathDropOperation } from '../server/deathDropOperation.mjs';
import { expectedPickupProfile } from './helpers/death-drop-storage.mjs';
import { makeDeath, planRequest, seedDeathStore, deathOp, WORLD as DEATH_WORLD, VICTIM, KILLER } from './helpers/death-storage.mjs';
import { database, reopenDatabase } from './helpers/ground-transaction-sql.mjs';

const migration014 = await readFile(new URL('../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const migration015 = await readFile(new URL('../server/migrations/015_resource_operations.sql', import.meta.url), 'utf8');
const migration016 = await readFile(new URL('../server/migrations/016_logging_operations.sql', import.meta.url), 'utf8');
const migration017Agent = await readFile(new URL('../server/migrations/017_agent_goods_budget.sql', import.meta.url), 'utf8');
const id = n => `f0170000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = structuredClone;
const ACCOUNT = 'ac170000-0000-4000-8000-000000000001';
const WORLD = 'ground-transaction-world';
const SEED = 91;
const initialResources = (tick = 500) => ({ v: 1, tick, nodes: [
  { id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 },
], cooldowns: {} });
const worldData = (resources = initialResources()) => ({ v: 1, seed: SEED,
  economy: new Economy(SEED).serialize(),
  community: { v: 1, epoch: id(90), project: { id: 'salty-shore-carpentry', version: 1,
    requirements: { madera: 4, piedra: 2 }, contributed: { madera: 0, piedra: 0 } } }, resources });

async function fixture(t, { world = WORLD, account = ACCOUNT, tick = 500, path = undefined, seedProfile = true,
  autoClose = true } = {}) {
  const f = await database(path);
  if (autoClose) t.after(() => f.close());
  await f.store.commitGroundClock({ operationId: id(1), world, expectedVersion: 0, expectedTick: 0, tick });
  const profile = newProfile(); profile.pirateId = `account:${account}`;
  if (seedProfile) await f.store.saveProfile(account, profile, 0);
  const data = worldData(initialResources(tick));
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [world, data]);
  return { ...f, account, world, profile, data, tick };
}

function transaction({ operationId, world, expectedWorldVersion, worldData: data, family, operation, clock }) {
  return { operationId, request: { world, expectedWorldVersion, worldData: data, family, operation, clock } };
}

function economicRequest({ operationId, account, world, expectedProfileVersion, expectedWorldVersion,
  profile, worldData: data, command, ack }) {
  return economicOperation({ operationId, request: { world, account, expectedProfileVersion, expectedWorldVersion,
    profile, worldData: data, command, ack } }).request;
}

async function storedWorld(f, world = f.world) {
  const row = (await f.db.query('select economy,version from public.mn_worlds where world=$1', [world])).rows[0];
  return row ? { data: row.economy, version: row.version } : null;
}

async function storedClock(f, world = f.world) {
  return f.store.loadGroundClock(world);
}

test('SQL018 readiness is service-only and resource gather/craft share the durable clock transaction', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.store.checkGroundTransactions(), { version: 1 });

  const currentProfile = (await f.store.loadProfile(f.account)).data;
  const gatheredProfile = clone(currentProfile);
  gatheredProfile.eco.pack.goods.tronco = (currentProfile.eco.pack.goods.tronco ?? 0) + 1;
  const gatherData = clone(f.data); gatherData.resources.tick = 510;
  gatherData.resources.nodes[0] = { id: 'palm-1', kind: 'palm', rev: 2, hits: 1, readyAt: 800 };
  const gatherId = id(10), gather = economicRequest({ operationId: gatherId, account: f.account, world: f.world,
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: gatheredProfile, worldData: gatherData,
    command: { type: 'resource', op: 'gather', opId: 'gather-10', node: 'palm-1', expectedRev: 1 },
    ack: { type: 'resource', op: 'gather', opId: 'gather-10', ok: true, why: '', rev: 2, good: 'tronco', count: 1 } });
  const gatherTx = transaction({ operationId: gatherId, world: f.world, expectedWorldVersion: 1, worldData: gatherData,
    family: 'economic', operation: gather,
    clock: { operationId: id(11), expectedVersion: 1, expectedTick: 500, tick: 510 } });
  const gathered = await f.store.commitGroundTransaction(gatherTx);
  assert.equal(gathered.ok, true); assert.equal(gathered.replay, false);
  assert.equal(gathered.clock.tick, 510); assert.equal(gathered.clock.version, 2);
  assert.equal(gathered.effect.ok, true); assert.equal(gathered.effect.replay, false);
  assert.deepEqual(await storedClock(f), gathered.clock);
  assert.deepEqual((await storedWorld(f)).data.resources, gatherData.resources);

  const afterGather = (await f.store.loadProfile(f.account)).data;
  const craftedProfile = clone(afterGather);
  delete craftedProfile.eco.pack.goods.tronco;
  craftedProfile.eco.pack.goods.madera = (afterGather.eco.pack.goods.madera ?? 0) + 1;
  const craftData = clone(gatherData);
  const craftId = id(12), craft = economicRequest({ operationId: craftId, account: f.account, world: f.world,
    expectedProfileVersion: 2, expectedWorldVersion: 2, profile: craftedProfile, worldData: craftData,
    command: { type: 'resource', op: 'craft', opId: 'craft-12', recipe: 'madera', expectedRev: 0, n: 1 },
    ack: { type: 'resource', op: 'craft', opId: 'craft-12', ok: true, why: '', rev: 0, good: 'madera', count: 1 } });
  const craftTx = transaction({ operationId: craftId, world: f.world, expectedWorldVersion: 2, worldData: craftData,
    family: 'economic', operation: craft,
    clock: { operationId: id(11), expectedVersion: 2, expectedTick: 510, tick: 510 } });
  const crafted = await f.store.commitGroundTransaction(craftTx);
  assert.equal(crafted.ok, true); assert.deepEqual(crafted.clock, gathered.clock,
    'same-tick operations retain the current clock receipt and generation');
  assert.equal((await storedWorld(f)).version, 3);
  assert.equal((await storedClock(f)).version, 2);

  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(f.db.query('select public.mn_ground_transactions_ready()'), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_commit_ground_transaction($1::uuid,$2::jsonb)', [id(80), null]), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_load_ground_transaction($1::uuid)', [id(80)]), { code: '42501' });
    await assert.rejects(f.db.query('select * from public.mn_ground_transactions'), { code: '42501' });
  }
  await f.db.exec('RESET ROLE; SET ROLE service_role');
  await assert.rejects(f.db.query("insert into public.mn_ground_transactions(operation_id,request,result) values($1,'{}','{}')", [id(81)]), { code: '42501' });
  await assert.rejects(f.db.query('update public.mn_ground_transactions set request=$2 where operation_id=$1', [gatherId, '{}']), { code: '42501' });
  await assert.rejects(f.db.query('delete from public.mn_ground_transactions where operation_id=$1', [gatherId]), { code: '42501' });
});

test('pearl mint and pickup commit with clock, immutable replay, and no duplicate legacy receipt promotion', async t => {
  const f = await fixture(t);
  const mintId = id(20), uid = 'wrapped-pearl-20';
  const mint = { operationId: mintId, uid, kind: 'brasa', from: null, to: null, expectedVersion: 0,
    world: f.world, ground: { x: 2, z: 3, availableAt: 500, returnAt: 700 }, profiles: [] };
  const mintRequest = groundOperation(mint).request;
  const mintTx = transaction({ operationId: mintId, world: f.world, expectedWorldVersion: 1, worldData: f.data,
    family: 'ground', operation: mintRequest,
    clock: { operationId: id(1), expectedVersion: 1, expectedTick: 500, tick: 500 } });
  const minted = await f.store.commitGroundTransaction(mintTx);
  assert.equal(minted.ok, true); assert.equal(minted.effect.location.uid, uid);

  const before = (await f.store.loadProfile(f.account)).data;
  const pickedProfile = clone(before); pickedProfile.pearls.bag.push({ uid, kind: 'brasa' });
  const pickupId = id(21), pickup = { operationId: pickupId, uid, kind: 'brasa', from: null, to: f.account,
    expectedVersion: 1, world: f.world, ground: null,
    profiles: [{ id: f.account, expectedVersion: 1, data: pickedProfile }] };
  const pickupRequest = groundOperation(pickup).request;
  const pickupTx = transaction({ operationId: pickupId, world: f.world, expectedWorldVersion: 2, worldData: f.data,
    family: 'ground', operation: pickupRequest,
    clock: { operationId: id(1), expectedVersion: 1, expectedTick: 500, tick: 500 } });
  const picked = await f.store.commitGroundTransaction(pickupTx);
  assert.equal(picked.ok, true); assert.equal(picked.effect.unique.holder, f.account);
  const afterFirstPick = { profile: await f.store.loadProfile(f.account), world: await storedWorld(f), clock: await storedClock(f) };
  const replay = await f.store.commitGroundTransaction(pickupTx);
  assert.equal(replay.replay, true); assert.equal(replay.effect.replay, false);
  assert.deepEqual({ profile: await f.store.loadProfile(f.account), world: await storedWorld(f), clock: await storedClock(f) }, afterFirstPick);
  assert.deepEqual(await f.store.loadGroundTransaction(pickupId), { request: pickupTx.request,
    result: { ...replay, replay: false } });

  const legacyId = id(22), rawMint = { operationId: legacyId, uid: 'unwrapped-pearl-22', kind: 'brasa',
    from: null, to: null, expectedVersion: 0, world: f.world,
    ground: { x: 6, z: 7, availableAt: 500, returnAt: 700 }, profiles: [] };
  const legacy = groundOperation(rawMint).request;
  const legacyResult = (await f.db.query('select public.mn_commit_pearl_ground($1::uuid,$2::jsonb) as data',
    [legacyId, legacy])).rows[0].data;
  assert.equal(legacyResult.ok, true, 'the standalone pearl receipt must exist before wrapper rejection');
  const state = { world: await storedWorld(f), clock: await storedClock(f) };
  const rejected = (await f.db.query('select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data',
    [legacyId, { world: f.world, expectedWorldVersion: state.world.version, worldData: state.world.data,
      family: 'ground', operation: legacy,
      clock: { operationId: id(23), expectedVersion: 1, expectedTick: 500, tick: 520 } }])).rows[0].data;
  assert.deepEqual(rejected, { ok: false, why: 'operation' });
  assert.deepEqual({ world: await storedWorld(f), clock: await storedClock(f) }, state);
});

test('world CAS, clock CAS and a post-effect SQL failure roll every family write back', async t => {
  const f = await fixture(t);
  const seedProfile = (await f.store.loadProfile(f.account)).data;
  const uid = 'wrapped-pearl-rollback';
  const mintId = id(30), mint = { operationId: mintId, uid, kind: 'tinta', from: null, to: null,
    expectedVersion: 0, world: f.world, ground: { x: 1, z: 1, availableAt: 500, returnAt: 800 }, profiles: [] };
  const request = groundOperation(mint).request;
  const make = (changes = {}) => transaction({ operationId: changes.id ?? mintId, world: f.world,
    expectedWorldVersion: changes.worldVersion ?? 1, worldData: { ...f.data, resources: { ...f.data.resources, tick: 520 } }, family: 'ground', operation: request,
    clock: changes.clock ?? { operationId: id(31), expectedVersion: 1, expectedTick: 500, tick: 520 } });
  const before = { profile: await f.store.loadProfile(f.account), world: await storedWorld(f), clock: await storedClock(f),
    unique: await f.store.loadUnique(uid), location: await f.store.loadPearlLocation(uid) };
  assert.deepEqual(await f.store.commitGroundTransaction(make({ worldVersion: 99 })), { ok: false, why: 'conflict' });
  assert.deepEqual(await f.store.commitGroundTransaction(make({ id: id(32), clock: {
    operationId: id(33), expectedVersion: 99, expectedTick: 500, tick: 520,
  } })), { ok: false, why: 'conflict' });
  const staleGeneration = { ...mint, operationId: id(35), expectedVersion: 1 };
  const staleRequest = groundOperation(staleGeneration).request;
  assert.deepEqual(await f.store.commitGroundTransaction(transaction({ operationId: staleGeneration.operationId,
    world: f.world, expectedWorldVersion: 1, worldData: { ...f.data, resources: { ...f.data.resources, tick: 520 } }, family: 'ground', operation: staleRequest,
    clock: { operationId: id(36), expectedVersion: 1, expectedTick: 500, tick: 520 } })),
  { ok: false, why: 'conflict' }, 'a stale pearl UID generation cannot advance clock or world');
  assert.deepEqual({ profile: await f.store.loadProfile(f.account), world: await storedWorld(f), clock: await storedClock(f),
    unique: await f.store.loadUnique(uid), location: await f.store.loadPearlLocation(uid) }, before);

  await f.db.exec('RESET ROLE');
  await f.db.exec(`CREATE FUNCTION public.mn_test_abort_ground_transaction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected post-effect failure'; END $$`);
  await f.db.exec('CREATE TRIGGER mn_test_abort_ground_transaction AFTER UPDATE ON public.mn_worlds FOR EACH ROW EXECUTE FUNCTION public.mn_test_abort_ground_transaction()');
  await f.db.exec('SET ROLE service_role');
  assert.deepEqual(await f.store.commitGroundTransaction(make({ id: id(34) })), { ok: false, why: 'operation' },
    'the RPC reports a contained database failure after rolling the subtransaction back');
  await f.db.exec('RESET ROLE');
  await f.db.exec('DROP TRIGGER mn_test_abort_ground_transaction ON public.mn_worlds; DROP FUNCTION public.mn_test_abort_ground_transaction()');
  await f.db.exec('SET ROLE service_role');
  assert.deepEqual({ profile: await f.store.loadProfile(f.account), world: await storedWorld(f), clock: await storedClock(f),
    unique: await f.store.loadUnique(uid), location: await f.store.loadPearlLocation(uid) }, before,
    'a SQL exception after wrapper effects must rollback pearl ownership, world, clock and receipt');
  assert.deepEqual(seedProfile, before.profile.data);
});

test('whole death and death-drop pickup share one transaction family with the same world clock', async t => {
  const f = await fixture(t, { world: DEATH_WORLD, account: VICTIM, tick: 550, seedProfile: false });
  const scene = makeDeath({ lawless: true, killer: true, loot: true, seed: 73 });
  scene.world.tick = 550;
  const planned = planRequest(scene, deathOp(40));
  await seedDeathStore(f.store, scene, planned.request);
  const deathId = planned.request.operationId;
  const normalizedDeath = deathOperation(planned.request).request;
  const deathWorld = clone(f.data); deathWorld.resources.tick = 550;
  const deathTx = transaction({ operationId: deathId, world: f.world, expectedWorldVersion: 1,
    worldData: deathWorld, family: 'death', operation: normalizedDeath,
    clock: { operationId: id(1), expectedVersion: 1, expectedTick: 550, tick: 550 } });
  const dead = await f.store.commitGroundTransaction(deathTx);
  assert.equal(dead.ok, true); assert.ok(dead.effect.drops.length > 0);
  const currentDrops = await f.store.listCurrentDeathDrops(f.world);
  const item = currentDrops.find(row => row.kind === 'item'); assert.ok(item);
  const receiver = await f.store.loadProfile(KILLER);
  const dropRaw = { operationId: id(41), world: f.world, mode: 'pickup', at: item.ground.availableAt,
    drop: { operationId: item.operationId, ordinal: item.ordinal, world: item.world, victim: item.victim,
      kind: item.kind, item: item.item, ground: item.ground, expectedVersion: item.version },
    profile: { id: KILLER, expectedVersion: receiver.version, before: receiver.data,
      data: expectedPickupProfile(item, receiver.data) } };
  const normalizedDrop = deathDropOperation(dropRaw).request;
  const currentWorld = await storedWorld(f);
  const dropTx = transaction({ operationId: dropRaw.operationId, world: f.world,
    expectedWorldVersion: currentWorld.version, worldData: currentWorld.data,
    family: 'drop', operation: normalizedDrop,
    clock: { operationId: id(1), expectedVersion: 1, expectedTick: 550, tick: 550 } });
  const picked = await f.store.commitGroundTransaction(dropTx);
  assert.equal(picked.ok, true); assert.equal(picked.effect.drop.state, 'picked');
  assert.deepEqual(await f.store.commitGroundTransaction(dropTx), { ...picked, replay: true,
    effect: { ...picked.effect, replay: false } });
  assert.equal((await f.store.loadDeathDrop(item.operationId, item.ordinal)).state, 'picked');
});

test('SQL018 reapply, v1/v2 resource and logging snapshots, and lost response survive reopen', async t => {
  const path = join(await mkdtemp(join(tmpdir(), 'mn-ground-tx-')), 'db');
  let f = await fixture(t, { path, autoClose: false });
  const base = upgradeLoggingState(clone(f.data.resources));
  const upgraded = { ...f.data, resources: base };
  upgraded.resources.tick = 520;
  const ckId = id(50), ck = transaction({ operationId: ckId, world: f.world, expectedWorldVersion: 1,
    worldData: upgraded, family: 'checkpoint', operation: {},
    clock: { operationId: id(51), expectedVersion: 1, expectedTick: 500, tick: 520 } });
  f.loseNextReply();
  await assert.rejects(f.store.commitGroundTransaction(ck), { code: 'unavailable' });
  const receipt = await f.store.loadGroundTransaction(ckId);
  assert.ok(receipt, JSON.stringify(f.calls.map(({ name, result }) => ({ name, result })))); assert.equal(receipt.result.clock.tick, 520);
  const retried = await f.store.commitGroundTransaction(ck);
  assert.equal(retried.replay, true); assert.equal(retried.clock.tick, 520);
  assert.deepEqual((await storedWorld(f)).data.resources, base);
  assert.deepEqual((await storedWorld(f)).data.community, f.data.community,
    'checkpoint snapshots preserve community state beside the resource schema upgrade');
  const profileRow = await f.store.loadProfile(f.account), postCheckpoint = await storedWorld(f);
  const directFamily = economicRequest({ operationId: ckId, account: f.account, world: f.world,
    expectedProfileVersion: profileRow.version, expectedWorldVersion: postCheckpoint.version,
    profile: profileRow.data, worldData: postCheckpoint.data,
    command: { type: 'commerce', op: 'buy', opId: 'checkpoint-collision', town: 'aldea',
      g: 'madera', n: 1, expectedTotal: 0 },
    ack: { type: 'commerce', op: 'buy', opId: 'checkpoint-collision', ok: false, why: 'funds', rev: 0 } });
  const collision = (await f.db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data',
    [ckId, directFamily])).rows[0].data;
  assert.deepEqual(collision, { ok: false, why: 'operation' },
    'an outer checkpoint UUID also blocks a direct legacy family receipt');
  assert.deepEqual(await f.store.loadProfile(f.account), profileRow);
  assert.deepEqual(await storedWorld(f), postCheckpoint);
  const ownerId = 'ac170000-0000-4000-8000-000000000002', budgetId = id(89);
  await f.db.query('select public.mn_create_agent_goods_budget($1,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)',
    [f.world, ownerId, f.account, budgetId, { buyGold: 100, buyGoldPerTrade: 100,
      sellUnits: {}, sellUnitsPerTrade: 100 }]);
  const agentCollision = (await f.db.query(
    'select public.mn_commit_agent_trade($1::uuid,$2::jsonb,$3::uuid,$4::uuid) as data',
    [ckId, directFamily, ownerId, budgetId])).rows[0].data;
  assert.deepEqual(agentCollision, { ok: false, why: 'operation' },
    'an outer checkpoint UUID blocks SQL017 agent trade from creating its linked economic receipt');
  assert.deepEqual(await f.store.loadProfile(f.account), profileRow);
  assert.deepEqual(await storedWorld(f), postCheckpoint);
  assert.equal((await f.db.query('select public.mn_load_agent_trade_operation($1::uuid) as data', [ckId])).rows[0].data, null);

  await f.db.exec('RESET ROLE'); await f.db.exec(migration014); await f.db.exec(migration015);
  await f.db.exec(migration016); await f.db.exec(migration017Agent); await f.db.exec('SET ROLE service_role');
  assert.deepEqual(await f.store.loadGroundTransaction(ckId), receipt,
    'reapplying prior migrations leaves the unified immutable receipt untouched');
  const old = await f.store.loadGroundTransaction(ckId);
  await f.close();
  f = await reopenDatabase(path);
  t.after(() => f.close());
  assert.deepEqual(await f.store.loadGroundTransaction(ckId), old);
  assert.deepEqual((await storedWorld(f, WORLD)).data.resources, base);
});

test('SQL018 rejects NULL payloads and refuses to overwrite a corrupt current world snapshot', async t => {
  const f = await fixture(t);
  const nullId = id(60);
  const empty = await f.db.query('select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data', [nullId, null]);
  assert.deepEqual(empty.rows[0].data, { ok: false, why: 'operation' });
  assert.equal(await f.store.loadGroundTransaction(nullId), null);
  const unknownSnapshot = transaction({ operationId: id(60), world: f.world, expectedWorldVersion: 1,
    worldData: { ...f.data, unsupported: true }, family: 'checkpoint', operation: {},
    clock: { operationId: id(70), expectedVersion: 1, expectedTick: 500, tick: 500 } });
  await assert.rejects(f.store.commitGroundTransaction(unknownSnapshot), { code: 'operation' });

  const state = { world: await storedWorld(f), clock: await storedClock(f) };
  const collisionId = id(69);
  const collision = { world: f.world, expectedWorldVersion: state.world.version, worldData: state.world.data,
    family: 'checkpoint', operation: {},
    clock: { operationId: collisionId, expectedVersion: state.clock.version, expectedTick: state.clock.tick,
      tick: state.clock.tick + 1 } };
  assert.deepEqual((await f.db.query('select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data',
    [collisionId, collision])).rows[0].data, { ok: false, why: 'operation' });
  assert.deepEqual({ world: await storedWorld(f), clock: await storedClock(f) }, state,
    'clock and outer receipt namespaces cannot alias, even for checkpoint transactions');

  const profileRow = await f.store.loadProfile(f.account);
  for (const [operationId, candidate] of [
    [id(63), (() => { const { community, ...rest } = f.data; return rest; })()],
    [id(64), { ...f.data, community: { ...f.data.community, project: { ...f.data.community.project,
      contributed: { madera: 1, piedra: 0 } } } }],
  ]) {
    const operation = economicRequest({ operationId, account: f.account, world: f.world,
      expectedProfileVersion: profileRow.version, expectedWorldVersion: 1, profile: profileRow.data,
      worldData: candidate, command: { type: 'commerce', op: 'buy', opId: `denied-${operationId}`,
        town: 'aldea', g: 'madera', n: 1, expectedTotal: 0 },
      ack: { type: 'commerce', op: 'buy', opId: `denied-${operationId}`,
        ok: false, why: 'funds', rev: 0 } });
    const result = await f.store.commitGroundTransaction(transaction({ operationId, world: f.world,
      expectedWorldVersion: 1, worldData: candidate, family: 'economic', operation,
      clock: { operationId: id(1), expectedVersion: 1, expectedTick: 500, tick: 500 } }));
    assert.deepEqual(result, { ok: false, why: 'conflict' },
      'economic commerce may not omit or alter an existing community snapshot, even with a denied ACK');
    assert.deepEqual(await f.store.loadProfile(f.account), profileRow);
    assert.deepEqual(await storedWorld(f), state.world);
    assert.deepEqual(await storedClock(f), state.clock);
    assert.equal(await f.store.loadGroundTransaction(operationId), null);
  }

  const omittedResources = { ...f.data };
  delete omittedResources.resources;
  const omitted = transaction({ operationId: id(65), world: f.world, expectedWorldVersion: 1,
    worldData: omittedResources, family: 'checkpoint', operation: {},
    clock: { operationId: id(1), expectedVersion: 1, expectedTick: 500, tick: 500 } });
  assert.deepEqual(await f.store.commitGroundTransaction(omitted), { ok: false, why: 'conflict' },
    'checkpoint cannot erase resources protected by SQL016');
  assert.deepEqual(await f.store.loadProfile(f.account), profileRow);
  assert.deepEqual(await storedWorld(f), state.world);
  assert.deepEqual(await storedClock(f), state.clock);
  assert.equal(await f.store.loadGroundTransaction(id(65)), null);

  const corruptions = [
    { ...f.data, resources: initialResources(f.tick + 1) },
    { ...f.data, unsupported: { retained: true } },
  ];
  for (const [index, corrupt] of corruptions.entries()) {
    await f.db.exec('RESET ROLE');
    await f.db.query('update public.mn_worlds set economy=$1::jsonb where world=$2', [corrupt, f.world]);
    await f.db.exec('SET ROLE service_role');
    const before = { world: await storedWorld(f), clock: await storedClock(f) };
    const operationId = id(61 + index), request = { world: f.world, expectedWorldVersion: before.world.version,
      worldData: f.data, family: 'checkpoint', operation: {},
      clock: { operationId: id(70 + index), expectedVersion: before.clock.version,
        expectedTick: before.clock.tick, tick: before.clock.tick } };
    const reply = await f.db.query('select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data', [operationId, request]);
    assert.deepEqual(reply.rows[0].data, { ok: false, why: 'conflict' });
    assert.deepEqual({ world: await storedWorld(f), clock: await storedClock(f) }, before);
    assert.equal(await f.store.loadGroundTransaction(operationId), null);
  }
});
