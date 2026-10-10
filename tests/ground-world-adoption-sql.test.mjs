import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseGroundWorldAdoption } from '../server/groundWorldAdoption.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { adoptionId, database, worldSnapshot } from './helpers/ground-world-adoption-sql.mjs';
import { groundTransactionOperation } from '../server/groundTransaction.mjs';
import { groundOperation } from '../server/pearlGround.mjs';
import { economicOperation } from '../server/economicOperation.mjs';

const world = 'adoption-sql-world';
const id = adoptionId;

async function fixture(t) {
  const f = await database();
  t.after(() => f.close());
  return f;
}

async function adopt(f, op, name = world, version = 4, data = worldSnapshot()) {
  const request = { world: name, expectedWorldVersion: version, worldData: data };
  const result = (await f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data', [op, request])).rows[0].data;
  return { request, result };
}

async function seed(f, name = world, opts = {}) {
  return f.seedWorld(name, { version: 4, ...opts });
}

async function clock(f, name = world) {
  return (await f.db.query('select public.mn_load_ground_clock($1) as data', [name])).rows[0].data;
}

async function adoption(f, name = world) {
  return (await f.db.query('select public.mn_load_ground_world_adoption($1) as data', [name])).rows[0].data;
}

test('SQL023 readiness, exact legacy adoption, immutable replay, and checkpoint continuation', async t => {
  const f = await fixture(t), data = await seed(f), operationId = id(1);
  const authority = createSupabaseGroundWorldAdoption(f.adoptionClient);
  assert.deepEqual(await authority.ready(), { version: 1 });
  const request = { world, expectedWorldVersion: 4, worldData: data };
  const first = await authority.adopt({ operationId, request });
  assert.deepEqual(first, { ok: true, replay: false, worldVersion: 4,
    clock: { world, tick: 500, version: 1, operationId } });
  assert.deepEqual(await authority.load(world), { operationId, request,
    result: { ...first, replay: false } });
  assert.deepEqual(await f.store.loadWorld(world), { data, version: 4 }, 'adoption leaves the exact legacy row and version intact');
  assert.deepEqual(await clock(f), first.clock);

  const checkpointId = id(2), checkpointClockId = id(3), nextData = structuredClone(data);
  nextData.resources.tick = 520;
  const checkpoint = { world, expectedWorldVersion: 4, worldData: nextData,
    family: 'checkpoint', operation: {},
    clock: { operationId: checkpointClockId, expectedVersion: 1, expectedTick: 500, tick: 520 } };
  const normalizedCheckpoint = groundTransactionOperation({ operationId: checkpointId, request: checkpoint }).request;
  await f.db.query('select public.mn_prepare_ground_transaction_intent($1::uuid,$2::jsonb)', [checkpointId, normalizedCheckpoint]);
  const committed = (await f.db.query('select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data',
    [checkpointId, normalizedCheckpoint])).rows[0].data;
  assert.equal(committed.ok, true, `the normal SQL018/019 wrapper should continue from the adopted clock: ${JSON.stringify(committed)}`);
  assert.equal(committed.worldVersion, 5);
  assert.equal(committed.clock.tick, 520);
  assert.equal((await f.db.query('select state from public.mn_ground_transaction_intents where operation_id=$1::uuid',
    [checkpointId])).rows[0].state, 'committed', 'the SQL019 journal remains usable after adoption');
  assert.deepEqual(await clock(f), committed.clock);
  const postCheckpointWorld = await f.store.loadWorld(world), forbiddenLegacyWrite = structuredClone(postCheckpointWorld.data);
  forbiddenLegacyWrite.economy.markets.aldea.stock.madera++;
  await assert.rejects(f.store.saveWorld(world, forbiddenLegacyWrite, postCheckpointWorld.version),
    error => error.code === 'operation', 'the common wrapper removes its DB-only write context before returning');
  assert.deepEqual(await f.store.loadWorld(world), postCheckpointWorld);

  const savedAdoption = await authority.load(world), savedCheckpoint = await f.store.loadGroundTransaction(checkpointId);
  await f.reapplyAdoptionMigration();
  assert.deepEqual(await authority.load(world), savedAdoption, 'reapplying SQL023 preserves the immutable adoption marker');
  assert.deepEqual(await f.store.loadGroundTransaction(checkpointId), savedCheckpoint,
    'reapplying SQL023 preserves the common checkpoint receipt and its journal state');

  const replay = (await f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data',
    [operationId, request])).rows[0].data;
  assert.deepEqual(replay, { ...first, replay: true }, 'exact adoption replay survives later world and clock advances');
  const changed = structuredClone(request); changed.worldData.resources.tick++;
  assert.deepEqual((await f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data',
    [operationId, changed])).rows[0].data, { ok: false, why: 'operation' }, 'the adopted UUID cannot be rebound');
  assert.deepEqual(await authority.load(world), { operationId, request, result: first });
});

test('SQL023 stale, malformed, tick-mismatched, and pre-clocked worlds fail without partial adoption', async t => {
  const f = await fixture(t), valid = await seed(f);
  const invalid = [
    ['stale version', 'adoption-sql-stale', { expectedWorldVersion: 3, data: valid }, { ok: false, why: 'conflict' }],
    ['missing resources', 'adoption-sql-no-resources', { data: (() => { const x = structuredClone(valid); delete x.resources; return x; })() }, { ok: false, why: 'operation' }],
    ['invalid resource payload', 'adoption-sql-bad-resources', { data: { ...valid, resources: { ...valid.resources, nodes: [] } } }, { ok: false, why: 'operation' }],
    ['tick mismatch to stored row', 'adoption-sql-tick-mismatch', { data: { ...valid, resources: { ...valid.resources, tick: 501 } } }, { ok: false, why: 'conflict' }],
  ];
  for (const [label, name, change, expected] of invalid) {
    const data = change.data ?? valid;
    const stored = await seed(f, name);
    const before = await f.store.loadWorld(name);
    const input = { world: name, expectedWorldVersion: change.expectedWorldVersion ?? 4, worldData: data };
    const reply = (await f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data',
      [id(10 + invalid.findIndex(row => row[0] === label)), input])).rows[0].data;
    assert.deepEqual(reply, expected, label);
    assert.equal(await clock(f, name), null, `${label} must not leave an initialized clock`);
    assert.equal(await adoption(f, name), null, `${label} must not leave a durable adoption marker`);
    assert.deepEqual(before, { data: stored, version: 4 });
    assert.deepEqual(await f.store.loadWorld(name), before);
  }

  const clocked = 'adoption-sql-clocked';
  const clockedData = await seed(f, clocked);
  const legacyClock = id(50);
  await f.store.commitGroundClock({ operationId: legacyClock, world: clocked, expectedVersion: 0, expectedTick: 0, tick: 500 });
  assert.deepEqual((await adopt(f, id(51), clocked, 4, clockedData)).result, { ok: false, why: 'conflict' },
    'a prior standalone clock cannot be relabelled as an adoption baseline');
  assert.equal(await adoption(f, clocked), null);
  assert.deepEqual(await clock(f, clocked), { world: clocked, tick: 500, version: 1, operationId: legacyClock });

  const injected = 'adoption-sql-failure-after-clock', injectedData = await seed(f, injected);
  await f.db.exec('RESET ROLE');
  await f.db.exec("create function public.mn_test_fail_ground_adoption() returns trigger language plpgsql as $$ begin raise exception 'injected marker failure' using errcode='MNP02'; end $$");
  await f.db.exec('create trigger mn_test_fail_ground_adoption after insert on public.mn_ground_world_adoptions for each row execute function public.mn_test_fail_ground_adoption()');
  await f.db.exec('SET ROLE service_role');
  assert.deepEqual((await adopt(f, id(52), injected, 4, injectedData)).result, { ok: false, why: 'operation' });
  assert.equal(await clock(f, injected), null, 'a failure after clock creation rolls the clock write back');
  assert.equal(await adoption(f, injected), null, 'the marker failure leaves no partial adoption');
  await f.db.exec('RESET ROLE; drop trigger mn_test_fail_ground_adoption on public.mn_ground_world_adoptions; drop function public.mn_test_fail_ground_adoption(); SET ROLE service_role');
});

test('SQL023 rejects existing legacy pearl locations and death-drop rows, including held pearls', async t => {
  const f = await fixture(t);
  for (const [name, op, held] of [
    ['adoption-sql-ground-pearl', id(61), false],
    ['adoption-sql-held-pearl', id(62), true],
  ]) {
    const data = await seed(f, name);
    const uid = `adopt-${held ? 'held' : 'ground'}-pearl`;
    const holder = id(90);
    if (held) {
      const profile = newProfile(); profile.pearls.bag.push({ uid, kind: 'brasa' });
      assert.equal((await f.store.saveProfile(holder, profile, 0)).ok, true);
    }
    await f.db.query('insert into public.mn_unique_items(uid,kind,holder,version) values($1,$2,$3::uuid,1)',
      [uid, 'pearl:brasa', held ? holder : null]);
    await f.db.query('insert into public.mn_pearl_locations(uid,world,ground,version) values($1,$2,$3::jsonb,1)',
      [uid, name, held ? null : { x: 2, z: 3, availableAt: 500, returnAt: 900 }]);
    const reply = (await f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data',
      [op, { world: name, expectedWorldVersion: 4, worldData: data }])).rows[0].data;
    assert.deepEqual(reply, { ok: false, why: 'conflict' }, held
      ? 'even a held pearl location is a legacy pearl row and blocks adoption'
      : 'ground pearl rows cannot be silently retimed');
    assert.equal(await clock(f, name), null);
    assert.equal(await adoption(f, name), null);
  }

  const dropWorld = 'adoption-sql-death-drop', dropData = await seed(f, dropWorld);
  const dropId = id(70), victim = id(71), ground = { x: 1, z: 2, availableAt: 500, expiresAt: 900 };
  await f.db.exec('RESET ROLE');
  await f.db.exec('alter table public.mn_death_operations disable trigger all; alter table public.mn_death_drops disable trigger all');
  await f.db.query('insert into public.mn_death_operations(operation_id,request) values($1::uuid,$2::jsonb)', [dropId, {}]);
  await f.db.query('insert into public.mn_death_drops(operation_id,ordinal,world,victim,kind,item,ground) '
    + 'values($1::uuid,1,$2,$3::uuid,\'item\',$4::jsonb,$5::jsonb)',
  [dropId, dropWorld, victim, { id: 'legacy-drop' }, ground]);
  await f.db.exec('alter table public.mn_death_operations enable trigger all; alter table public.mn_death_drops enable trigger all; SET ROLE service_role');
  assert.deepEqual((await adopt(f, id(72), dropWorld, 4, dropData)).result, { ok: false, why: 'conflict' },
    'existing death_drops are retained as legacy evidence even if no current state row is read');
  assert.equal(await clock(f, dropWorld), null);
});

test('SQL023 refuses pending and committed pre-adoption identities, including UUID collision from another world', async t => {
  const f = await fixture(t);
  const cases = [
    ['adoption-sql-common-intent', 'common intent'],
    ['adoption-sql-common-receipt', 'common receipt'],
    ['adoption-sql-legacy-intent', 'legacy pearl intent'],
  ];
  for (const [name, label] of cases) {
    const data = await seed(f, name), op = id(110 + cases.findIndex(row => row[0] === name));
    if (label === 'common intent') {
      const intent = groundTransactionOperation({ operationId: op, request: { world: name,
        expectedWorldVersion: 4, worldData: { ...data, resources: { ...data.resources, tick: 510 } },
        family: 'checkpoint', operation: {},
        clock: { operationId: id(120), expectedVersion: 1, expectedTick: 500, tick: 510 } } }).request;
      await f.db.query('select public.mn_prepare_ground_transaction_intent($1::uuid,$2::jsonb)', [op, intent]);
    } else if (label === 'common receipt') {
      const receiptRequest = groundTransactionOperation({ operationId: op, request: { world: name,
        expectedWorldVersion: 4, worldData: data, family: 'checkpoint', operation: {},
        clock: { operationId: id(121), expectedVersion: 1, expectedTick: 500, tick: 500 } } }).request;
      const result = { ok: true, replay: false, worldVersion: 5,
        clock: { world: name, tick: 500, version: 1, operationId: id(121) }, effect: { ok: true, replay: false } };
      await f.db.exec('RESET ROLE');
      await f.db.query('insert into public.mn_ground_transactions(operation_id,request,result) values($1::uuid,$2::jsonb,$3::jsonb)',
        [op, receiptRequest, result]);
      await f.db.exec('SET ROLE service_role');
    } else {
      const intent = { uid: `legacy-intent-${name}`, kind: 'brasa', from: null, to: null, expectedVersion: 0,
        profiles: [], world: name, ground: { x: 0, z: 0, availableAt: 500, returnAt: 900 } };
      await f.db.query('select public.mn_prepare_pearl_intent($2,$3,$1::uuid,$4::jsonb)', [op, name, 'ground', intent]);
    }
    const reply = (await f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data',
      [id(130 + cases.findIndex(row => row[0] === name)), { world: name, expectedWorldVersion: 4, worldData: data }])).rows[0].data;
    assert.deepEqual(reply, { ok: false, why: 'conflict' }, `${label} cannot be adopted or retimed implicitly`);
    assert.equal(await clock(f, name), null);
    assert.equal(await adoption(f, name), null);
  }

  const collisionWorld = 'adoption-sql-collision-source', collisionTarget = 'adoption-sql-collision-target';
  await seed(f, collisionWorld); const target = await seed(f, collisionTarget);
  const reused = id(140);
  await f.store.commitGroundClock({ operationId: reused, world: collisionWorld, expectedVersion: 0, expectedTick: 0, tick: 500 });
  assert.deepEqual((await adopt(f, reused, collisionTarget, 4, target)).result, { ok: false, why: 'operation' },
    'an adoption UUID already owned by another common receipt family is rejected');
  assert.equal(await clock(f, collisionTarget), null);
  assert.equal(await adoption(f, collisionTarget), null);
});

test('SQL023 keeps economic family commits inside the common wrapper after adoption', async t => {
  const f = await fixture(t), data = await seed(f), operationId = id(150), account = id(151);
  assert.equal((await adopt(f, id(152))).result.ok, true);
  const profile = newProfile(); profile.gold = 1000;
  assert.equal((await f.store.saveProfile(account, profile, 0)).ok, true);
  const command = { type: 'commerce', op: 'buy', opId: 'adoption-economic', town: 'aldea', g: 'fruta', n: 1, expectedTotal: 999999 };
  const ack = { type: 'commerce', op: 'buy', opId: 'adoption-economic', ok: false, why: 'funds', rev: 0 };
  const economic = economicOperation({ operationId, request: { world, account, expectedProfileVersion: 1,
    expectedWorldVersion: 4, profile, worldData: data, command, ack } }).request;
  const tx = groundTransactionOperation({ operationId, request: { world, expectedWorldVersion: 4, worldData: data,
    family: 'economic', operation: economic,
    clock: { operationId: id(152), expectedVersion: 1, expectedTick: 500, tick: 500 } } }).request;
  await f.db.query('select public.mn_prepare_ground_transaction_intent($1::uuid,$2::jsonb)', [operationId, tx]);
  const committed = (await f.db.query('select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data',
    [operationId, tx])).rows[0].data;
  assert.equal(committed.ok, true, `economic receipt remains available through SQL018/019/022: ${JSON.stringify(committed)}`);
  assert.equal(committed.clock.tick, 500);
  assert.equal(committed.worldVersion, 5);
  assert.deepEqual(committed.effect.ack, ack);
  assert.equal((await f.db.query('select state from public.mn_ground_transaction_intents where operation_id=$1::uuid',
    [operationId])).rows[0].state, 'committed');
});

test('SQL023 persistent fence rejects legacy world, clock, and direct ground-row writes while unadopted worlds retain legacy behavior', async t => {
  const f = await fixture(t), data = await seed(f);
  assert.equal((await adopt(f, id(80))).result.ok, true);

  const changed = structuredClone(data); changed.economy.markets.aldea.stock.madera++;
  await assert.rejects(f.store.saveWorld(world, changed, 4), error => error.code === 'operation',
    'legacy save is explicitly fenced by the persistent DB guard');
  assert.deepEqual(await f.store.loadWorld(world), { data, version: 4 });
  const clockWrite = await f.store.commitGroundClock({ operationId: id(81), world,
    expectedVersion: 1, expectedTick: 500, tick: 510 });
  assert.deepEqual(clockWrite, { ok: false, why: 'operation' }, 'standalone checkpoint RPC is fenced after adoption');
  await assert.rejects(f.db.query('insert into public.mn_pearl_locations(uid,world,ground,version) values($1,$2,$3::jsonb,1)',
    ['direct-adopted-pearl', world, { x: 0, z: 0, availableAt: 500, returnAt: 900 }]),
  error => ['42501', 'MNP02'].includes(error.code), 'service_role direct writes cannot spoof wrapper authorization');

  const legacy = 'adoption-sql-still-legacy', legacyData = await seed(f, legacy);
  const next = structuredClone(legacyData); next.economy.markets.aldea.stock.madera++;
  assert.deepEqual(await f.store.saveWorld(legacy, next, 4), { ok: true, version: 5 },
    'worlds without an adoption marker keep the existing legacy save path');
  const legacyGround = groundOperation({ operationId: id(82), uid: 'unadopted-ground-pearl', kind: 'brasa',
    from: null, to: null, expectedVersion: 0, world: legacy,
    ground: { x: 0, z: 0, availableAt: 500, returnAt: 900 }, profiles: [] }).request;
  const pearl = (await f.db.query('select public.mn_commit_pearl_ground($1::uuid,$2::jsonb) as data',
    [id(82), legacyGround])).rows[0].data;
  assert.equal(pearl.ok, true, 'legacy pearl RPC remains available until this world is adopted');
});

test('SQL023 RPCs and private adoption state obey service-only permissions', async t => {
  const f = await fixture(t), data = await seed(f);
  assert.deepEqual((await adopt(f, id(98), world, 4, data)).result.ok, true,
    'the immutable marker exists before its privileged mutation guard is checked');
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(f.db.query('select public.mn_ground_world_adoption_ready()'), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_load_ground_world_adoption($1)', [world]), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_adopt_ground_world($1::uuid,$2::jsonb)', [id(99),
      { world, expectedWorldVersion: 4, worldData: data }]), { code: '42501' });
    await assert.rejects(f.db.query('select * from public.mn_ground_world_adoptions'), { code: '42501' });
  }
  await f.db.exec('RESET ROLE; SET ROLE service_role');
  assert.deepEqual((await f.db.query('select public.mn_ground_world_adoption_ready() as data')).rows[0].data, { version: 1 });
  await assert.rejects(f.db.query('insert into public.mn_ground_world_adoptions(world,operation_id,request,result) '
    + 'values($1,$2::uuid,$3::jsonb,$4::jsonb)', [world, id(100), {}, {}]), { code: '42501' });
  await assert.rejects(f.db.query('select * from public.mn_ground_world_write_context'), { code: '42501' });
  await assert.rejects(f.db.query('insert into public.mn_ground_world_write_context(transaction_id,world) values(1,$1)', [world]),
    { code: '42501' });
  await assert.rejects(f.db.query('select public.mn_commit_ground_transaction_adoption_base($1::uuid,$2::jsonb)', [id(101), {}]),
    { code: '42501' }, 'the renamed base RPC is not an alternate service-role entry point');

  await f.db.exec('RESET ROLE');
  await assert.rejects(f.db.query('update public.mn_ground_world_adoptions set request=request where world=$1', [world]),
    error => error.code === 'MNP02', 'the durable adoption marker rejects even privileged in-place updates');
  await f.db.exec('SET ROLE service_role');
});

test('SQL023 write guards reject repeatable-read and serializable legacy saves for adopted and legacy worlds', async t => {
  const f = await fixture(t), legacyName = 'adoption-sql-isolation-legacy';
  const legacyData = await seed(f, legacyName), adoptedData = await seed(f, world);
  assert.equal((await adopt(f, id(170), world, 4, adoptedData)).result.ok, true);
  const snapshots = new Map([[legacyName, await f.store.loadWorld(legacyName)], [world, await f.store.loadWorld(world)]]);

  for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
    for (const name of [legacyName, world]) {
      const before = snapshots.get(name);
      await f.db.exec(`BEGIN ISOLATION LEVEL ${isolation}`);
      try {
        await assert.rejects(f.db.query('select public.mn_save_world($1,$2::jsonb,$3::integer)',
          [name, before.data, before.version]), error => error.code === 'MNP02',
        `${isolation} world saves are rejected even when the submitted snapshot exactly matches ${name}`);
      } finally {
        await f.db.exec('ROLLBACK');
      }
      assert.deepEqual(await f.store.loadWorld(name), before,
        `${isolation} rejection must not alter the ${name} snapshot or version`);
    }
  }
  assert.deepEqual(await f.store.loadWorld(legacyName), { data: legacyData, version: 4 });
});

