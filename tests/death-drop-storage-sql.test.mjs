import test from 'node:test';
import assert from 'node:assert/strict';
import { deathDropContract, seedDeathDropScenario, pickupRequest, expiryRequest, deathOp, KILLER, WORLD } from './helpers/death-drop-storage.mjs';
import { database, databaseWithHistoricalDeath, deathDropSql } from './helpers/death-drop-sql.mjs';
import { makeDeath, planRequest } from './helpers/death-storage.mjs';

test('SQL011 implements the shared death-drop contract through the local SDK adapter', (t) =>
  deathDropContract(t, async () => database()));

test('raw SQL rejects invalid requests and rolls back invalid windows, deltas, and source metadata', async (t) => {
  const sql = await database(), source = await seedDeathDropScenario(sql.store, { sourceOperation: 650 });
  try {
    const base = await pickupRequest(sql.store, source, { operation: 950 });
    const before = { profile: await sql.store.loadProfile(KILLER), drop: await sql.store.loadDeathDrop(base.drop.operationId, base.drop.ordinal) };
    const cases = [
      ['missing request field', 'operation', (r) => { delete r.mode; }],
      ['extra request field', 'operation', (r) => { r.extra = true; }],
      ['bad receiver delta', 'operation', (r) => { r.profile.data.gold++; }],
      ['same-version invented baseline', 'conflict', (r) => { r.profile.before.gold++; r.profile.data.gold++; }],
      ['early pickup window', 'ownership', (r) => { r.at = r.drop.ground.availableAt - 1; }],
      ['wrong source metadata', 'ownership', (r) => {
        r.drop.item.u++;
        const moved = structuredClone(r.profile.before), item = structuredClone(r.drop.item);
        item.u = moved.uid; moved.bag.push(item); moved.uid++; moved.stats.items++;
        r.profile.data = moved;
      }],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [label, why, mutate] = cases[i], raw = structuredClone(base), operationId = deathOp(960 + i);
      raw.operationId = operationId; mutate(raw);
      const { operationId: _operationId, ...request } = raw;
      const result = (await sql.db.query('select public.mn_commit_death_drop($1::uuid,$2::jsonb) as data', [operationId, request])).rows[0].data;
      assert.deepEqual(result, { ok: false, why }, label);
      assert.equal(await sql.store.loadDeathDropOperation(operationId), null, `${label}: no provisional receipt`);
      assert.deepEqual({ profile: await sql.store.loadProfile(KILLER), drop: await sql.store.loadDeathDrop(base.drop.operationId, base.drop.ordinal) }, before,
        `${label}: no partial state`);
    }

    const expires = await expiryRequest(source, { operation: 970, at: source.itemDrop.ground.expiresAt });
    const { operationId, ...request } = expires;
    assert.deepEqual((await sql.db.query('select public.mn_commit_death_drop($1::uuid,$2::jsonb) as data', [operationId, request])).rows[0].data,
      { ok: false, why: 'ownership' }, 'expiry at the exact boundary is too early');
    assert.deepEqual(await sql.store.loadDeathDropOperation(operationId), null);

    const missing = structuredClone(base); missing.operationId = deathOp(975); missing.drop.operationId = deathOp(954);
    assert.deepEqual(await sql.store.commitDeathDrop(missing), { ok: false, why: 'conflict' }, 'missing current-state row is a CAS conflict');
    assert.equal(await sql.store.loadDeathDropOperation(missing.operationId), null);
  } finally { await sql.close(); }
});

test('a provisional receipt cannot commit incomplete or out-of-window expiration state', async (t) => {
  await t.test('incomplete pending receipt is rolled back at commit', async () => {
    const sql = await database(), source = await seedDeathDropScenario(sql.store, { sourceOperation: 651 });
    try {
      const raw = await expiryRequest(source, { operation: 971 });
      const { operationId, ...request } = raw;
      await assert.rejects(sql.db.query('insert into public.mn_death_drop_operations(operation_id,request) values($1::uuid,$2::jsonb)',
        [operationId, request]));
      assert.equal(await sql.store.loadDeathDropOperation(operationId), null);
      assert.equal((await sql.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal)).state, 'ground');
    } finally { await sql.close(); }
  });

  await t.test('matching provisional expiry at expiresAt cannot bypass the RPC window', async () => {
    const sql = await database(), source = await seedDeathDropScenario(sql.store, { sourceOperation: 652 });
    try {
      const raw = await expiryRequest(source, { operation: 972, at: source.itemDrop.ground.expiresAt });
      const { operationId, ...request } = raw;
      const { expectedVersion, ...creation } = raw.drop;
      const forged = { ok: true, replay: false, profiles: [], drop: { ...creation, state: 'expired', version: 2, holder: null, transitionOperationId: operationId } };
      await assert.rejects(sql.db.transaction(async tx => {
        await tx.query('insert into public.mn_death_drop_operations(operation_id,request) values($1::uuid,$2::jsonb)', [operationId, request]);
        await tx.query(`update public.mn_death_drop_states set state='expired',version=2,transition_operation_id=$1::uuid
          where operation_id=$2::uuid and ordinal=$3`, [operationId, raw.drop.operationId, raw.drop.ordinal]);
        await tx.query('update public.mn_death_drop_operations set result=$1::jsonb where operation_id=$2::uuid', [forged, operationId]);
      }), { code: 'MNP01' }, 'a fully shaped forged success still fails the deferred time check');
      assert.equal(await sql.store.loadDeathDropOperation(operationId), null);
      assert.equal((await sql.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal)).state, 'ground');
    } finally { await sql.close(); }
  });
});

test('raw current-state writes need a matching provisional receipt and terminal rows are immutable', async (t) => {
  const sql = await database(), source = await seedDeathDropScenario(sql.store, { sourceOperation: 653 });
  try {
    const ground = source.itemDrop;
    await assert.rejects(sql.db.query(`update public.mn_death_drop_states set state='expired',version=2,
      transition_operation_id=$1::uuid where operation_id=$2::uuid and ordinal=$3`,
    [deathOp(973), ground.operationId, ground.ordinal]));
    assert.equal((await sql.store.loadDeathDrop(ground.operationId, ground.ordinal)).state, 'ground');

    const request = await pickupRequest(sql.store, source, { operation: 974 });
    assert.equal((await sql.store.commitDeathDrop(request)).ok, true);
    const terminal = await sql.store.loadDeathDrop(ground.operationId, ground.ordinal);
    assert.equal(terminal.state, 'picked');
    await assert.rejects(sql.db.query(`update public.mn_death_drop_states set state='ground',version=1,holder=NULL,
      transition_operation_id=NULL where operation_id=$1::uuid and ordinal=$2`, [ground.operationId, ground.ordinal]));
    assert.deepEqual(await sql.store.loadDeathDrop(ground.operationId, ground.ordinal), terminal);
    await sql.db.exec('RESET ROLE'); await sql.db.exec(deathDropSql); await sql.db.exec('SET ROLE service_role');
    assert.deepEqual(await sql.store.loadDeathDrop(ground.operationId, ground.ordinal), terminal, 'reapplying migration never reopens picked loot');
    assert.equal((await sql.store.listCurrentDeathDrops(WORLD)).length, source.death.drops.length - 1);
  } finally { await sql.close(); }
});

test('pre-011 death drops remain history only while later deaths seed current state', async () => {
  const old = await databaseWithHistoricalDeath();
  try {
    const historical = old.historical.result.drops[0];
    assert.ok(historical);
    assert.equal(await old.store.loadDeathDrop(historical.operationId, historical.ordinal), null);
    await assert.rejects(old.db.query(
      `insert into public.mn_death_drop_states(operation_id,ordinal,world,victim,kind,item,ground,state,version)
       select operation_id,ordinal,world,victim,kind,item,ground,'ground',1 from public.mn_death_drops where operation_id=$1::uuid and ordinal=$2`,
      [historical.operationId, historical.ordinal]), { code: 'MNP02' }, 'service cannot adopt completed historical loot');
    assert.deepEqual(await old.store.listCurrentDeathDrops(WORLD), []);
    assert.equal((await old.store.listDeathDrops(WORLD)).length, old.historical.result.drops.length);
    const replay = await old.store.commitDeath(old.historical.request);
    assert.equal(replay.ok, true); assert.equal(replay.replay, true);
    assert.equal(await old.store.loadDeathDrop(historical.operationId, historical.ordinal), null);

    const later = await commitIsolatedDropDeath(old.store, 655);
    const current = await old.store.listCurrentDeathDrops(WORLD, { limit: 256 });
    assert.equal(current.length, later.result.drops.length);
    assert.ok(current.every((row) => row.operationId === later.operationId && row.state === 'ground' && row.version === 1));
    assert.equal((await old.store.listDeathDrops(WORLD)).length, old.historical.result.drops.length + later.result.drops.length);
    assert.equal(await old.store.loadDeathDrop(historical.operationId, historical.ordinal), null);
  } finally { await old.close(); }
});

test('operation family collision guards cover RPCs and direct service inserts/updates in both directions', async () => {
  const sql = await database(), source = await seedDeathDropScenario(sql.store, { sourceOperation: 656 });
  try {
    const raw = await pickupRequest(sql.store, source, { operation: 976 });
    assert.equal((await sql.store.commitDeathDrop(raw)).ok, true);
    const newId = raw.operationId;
    const oldFamilies = ['mn_pearl_operations','mn_pearl_ground_operations','mn_pearl_batch_operations'];
    for (let i = 0; i < oldFamilies.length; i++) {
      const table = oldFamilies[i], oldId = deathOp(980 + i);
      await assert.rejects(sql.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`, [newId]), undefined,
        `${table}: a new receipt ID blocks direct insert`);
      await sql.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`, [oldId]);
      await assert.rejects(sql.db.query(`update public.${table} set operation_id=$1::uuid where operation_id=$2::uuid`, [newId, oldId]), undefined,
        `${table}: a new receipt ID blocks direct update`);
      const candidate = structuredClone(raw); candidate.operationId = oldId;
      assert.deepEqual(await sql.store.commitDeathDrop(candidate), { ok: false, why: 'operation' }, `${table}: old receipt blocks new RPC`);
    }

    const journal = sql.journal(WORLD);
    const current = await sql.store.loadProfile(KILLER), pearls = structuredClone(current.data);
    pearls.pearls.bag.push({ uid: 'drop-journal-collision', kind: 'brasa' });
    const intent = { operationId: deathOp(985), uid: 'drop-journal-collision', kind: 'brasa', from: null, to: KILLER,
      expectedVersion: 0, profiles: [{ id: KILLER, expectedVersion: current.version, data: pearls }] };
    await assert.rejects(journal.prepare('pearl', { ...intent, operationId: newId }), { code: 'operation' },
      'a new receipt ID blocks direct journal intent creation');
    await journal.prepare('pearl', intent);
    await assert.rejects(sql.db.query(`update public.mn_pearl_intents set operation_id=$1::uuid where operation_id=$2::uuid`,
      [newId, intent.operationId]), undefined, 'a new receipt ID blocks direct journal update');
    const journalCollision = structuredClone(raw); journalCollision.operationId = intent.operationId;
    assert.deepEqual(await sql.store.commitDeathDrop(journalCollision), { ok: false, why: 'operation' }, 'journal intent blocks new RPC');

    const deathOld = await commitBareDeath(sql.store, sql.db, 987);
    await assert.rejects(sql.db.query(`insert into public.mn_death_operations(operation_id,request) values($1::uuid,$2::jsonb)`,
      [newId, deathOld.request]), undefined, 'new receipt blocks direct old-death insert');
    await assert.rejects(sql.db.query(`update public.mn_death_operations set operation_id=$1::uuid where operation_id=$2::uuid`,
      [newId, deathOld.operationId]), undefined, 'new receipt blocks direct old-death update');
    const deathCollision = structuredClone(raw); deathCollision.operationId = deathOld.operationId;
    assert.deepEqual(await sql.store.commitDeathDrop(deathCollision), { ok: false, why: 'operation' }, 'old death receipt blocks new RPC');
  } finally { await sql.close(); }
});

test('a lost local reply resolves from the exact receipt after later profile progress', async () => {
  const sql = await database(), source = await seedDeathDropScenario(sql.store, { sourceOperation: 657 });
  try {
    const raw = await pickupRequest(sql.store, source, { operation: 977 });
    const expected = structuredClone(raw.profile.data);
    sql.loseNextReply();
    await assert.rejects(sql.store.commitDeathDrop(raw), { code: 'unavailable' });
    const receipt = await sql.store.loadDeathDropOperation(raw.operationId);
    assert.ok(receipt); assert.equal(receipt.result.replay, false);
    assert.deepEqual(receipt.request, (({ operationId: _id, ...request }) => request)(raw));
    const profile = await sql.store.loadProfile(KILLER), progress = structuredClone(profile.data); progress.gold++;
    assert.equal((await sql.store.saveProfile(KILLER, progress, profile.version)).ok, true);
    const after = { profile: await sql.store.loadProfile(KILLER), drop: await sql.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) };
    assert.deepEqual(await sql.store.commitDeathDrop(raw), { ...receipt.result, replay: true });
    assert.deepEqual({ profile: await sql.store.loadProfile(KILLER), drop: await sql.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) }, after);
    assert.deepEqual(expected, receipt.request.profile.data);
  } finally { await sql.close(); }
});

test('011 revokes client table/function access and retains RLS with no delete privilege', async () => {
  const sql = await database();
  try {
    for (const table of ['mn_death_drop_states','mn_death_drop_operations']) {
      for (const role of ['anon','authenticated']) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
        const result = (await sql.db.query('select has_table_privilege($1,$2,$3) as allowed', [role, `public.${table}`, privilege])).rows[0].allowed;
        assert.equal(result, false, `${role} must not have ${privilege} on ${table}`);
      }
      assert.equal((await sql.db.query('select relrowsecurity from pg_class where oid=$1::regclass', [`public.${table}`])).rows[0].relrowsecurity, true);
      assert.equal((await sql.db.query('select has_table_privilege($1,$2,$3) as allowed', ['service_role', `public.${table}`, 'DELETE'])).rows[0].allowed, false,
        `service_role cannot delete ${table}`);
    }
    for (const signature of ['public.mn_commit_death_drop(uuid,jsonb)','public.mn_load_death_drop_operation(uuid)',
      'public.mn_load_death_drop(uuid,integer)','public.mn_list_current_death_drops(text,uuid,integer,integer)']) {
      for (const role of ['anon','authenticated']) assert.equal((await sql.db.query(
        'select has_function_privilege($1,$2,$3) as allowed', [role, signature, 'EXECUTE'])).rows[0].allowed, false,
      `${role} cannot execute ${signature}`);
      assert.equal((await sql.db.query('select has_function_privilege($1,$2,$3) as allowed', ['service_role', signature, 'EXECUTE'])).rows[0].allowed, true);
    }
    await sql.db.exec('SET ROLE anon');
    await assert.rejects(sql.db.query('select * from public.mn_death_drop_states'));
    await assert.rejects(sql.db.query("select public.mn_load_death_drop_operation('90000000-0000-4000-8000-000000000001'::uuid)"));
    await sql.db.exec('RESET ROLE; SET ROLE authenticated');
    await assert.rejects(sql.db.query('select * from public.mn_death_drop_operations'));
    await assert.rejects(sql.db.query("select public.mn_list_current_death_drops('death:island',null,null,1)"));
  } finally { await sql.close(); }
});

async function commitBareDeath(store, db, n) {
  const identity = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const fixture = makeDeath({ lawless: false, killer: false, pearlCount: 0, loot: false, seed: n });
  fixture.world.tick = 10;
  const { request } = planRequest(fixture, deathOp(n));
  const profile = request.profiles[0];
  request.victim = identity;
  profile.id = identity;
  profile.before.pirateId = `account:${identity}`;
  profile.data.pirateId = `account:${identity}`;
  assert.equal((await store.saveProfile(identity, profile.before, 0)).ok, true);
  const result = await store.commitDeath(request);
  assert.equal(result.ok, true);
  assert.equal(result.drops.length, 0);
  return { operationId: request.operationId, request, result };
}

async function commitIsolatedDropDeath(store, n) {
  const victim = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const killer = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const fixture = makeDeath({ lawless: true, killer: true, pearlCount: 0, loot: true, seed: n });
  fixture.world.tick = 10;
  const { request } = planRequest(fixture, deathOp(n));
  request.victim = victim; request.killer = killer;
  for (const profile of request.profiles) {
    profile.id = profile.id === KILLER ? killer : victim;
    profile.before.pirateId = `account:${profile.id}`;
    profile.data.pirateId = `account:${profile.id}`;
    assert.equal((await store.saveProfile(profile.id, profile.before, 0)).ok, true);
  }
  request.profiles.sort((a, b) => a.id.localeCompare(b.id));
  const result = await store.commitDeath(request);
  assert.equal(result.ok, true);
  return { operationId: request.operationId, request, result };
}


test('a failure after the receiver update rolls back profile, state and provisional receipt together', async () => {
  const sql = await database(), source = await seedDeathDropScenario(sql.store, { sourceOperation: 659 });
  try {
    const raw = await pickupRequest(sql.store, source, { operation: 979 });
    const before = { profile: await sql.store.loadProfile(KILLER), drop: await sql.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) };
    await sql.db.exec(`RESET ROLE;
      CREATE FUNCTION public.test_reject_death_drop_state() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $test$
      BEGIN RAISE EXCEPTION 'forced state write failure' USING ERRCODE='MNP02'; END $test$;
      CREATE TRIGGER test_reject_death_drop_state BEFORE UPDATE ON public.mn_death_drop_states
        FOR EACH ROW EXECUTE FUNCTION public.test_reject_death_drop_state(); SET ROLE service_role;`);
    assert.deepEqual(await sql.store.commitDeathDrop(raw), { ok: false, why: 'operation' });
    assert.deepEqual({ profile: await sql.store.loadProfile(KILLER), drop: await sql.store.loadDeathDrop(raw.drop.operationId, raw.drop.ordinal) }, before);
    assert.equal(await sql.store.loadDeathDropOperation(raw.operationId), null);
  } finally { await sql.close(); }
});
