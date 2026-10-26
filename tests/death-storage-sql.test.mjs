import test from 'node:test';
import assert from 'node:assert/strict';
import { deathContract, makeDeath, planRequest, seedDeathStore, deathOp, WORLD, VICTIM, KILLER } from './helpers/death-storage.mjs';
import { database } from './helpers/death-storage-sql.mjs';
import { createSupabasePearlJournal } from '../server/pearlJournal.mjs';

test('SQL009 implements the same whole-death CAS, pearl and ordinary-drop contract as memory', (t) =>
  deathContract(t, async () => database()));

test('SQL baseline drift of either endpoint conflicts without partial mutation', async (t) => {
  for (const [n, endpoint] of [[71, VICTIM], [72, KILLER]]) await t.test(endpoint, async () => {
    const db = await database(), f = makeDeath({ lawless: true, killer: true, pearlCount: 1, loot: true });
    const { request } = planRequest(f, deathOp(n));
    try {
      await seedDeathStore(db.store, f, request);
      const row = await db.store.loadProfile(endpoint), changed = structuredClone(row.data); changed.gold++;
      assert.equal((await db.store.saveProfile(endpoint, changed, row.version)).ok, true);
      const before = await db.store.loadProfile(VICTIM);
      assert.deepEqual(await db.store.commitDeath(request), { ok: false, why: 'conflict' });
      assert.deepEqual(await db.store.loadProfile(VICTIM), before);
      assert.deepEqual(await db.store.listDeathDrops(WORLD), []);
      assert.equal(await db.store.loadDeathOperation(request.operationId), null);
    } finally { await db.close(); }
  });
  for (const [n, endpoint] of [[73, VICTIM], [74, KILLER]]) await t.test(`${endpoint}: same-version JSON mismatch`, async () => {
    const db = await database(), f = makeDeath({ lawless: true, killer: true });
    const { request } = planRequest(f, deathOp(n));
    try {
      await seedDeathStore(db.store, f, request);
      const p = request.profiles.find((q) => q.id === endpoint); p.before.gold++; p.data.gold++;
      const beforeVictim = await db.store.loadProfile(VICTIM), beforeKiller = await db.store.loadProfile(KILLER);
      assert.deepEqual(await db.store.commitDeath(request), { ok: false, why: 'conflict' });
      assert.deepEqual(await db.store.loadProfile(VICTIM), beforeVictim);
      assert.deepEqual(await db.store.loadProfile(KILLER), beforeKiller);
      assert.equal(await db.store.loadDeathOperation(request.operationId), null);
    } finally { await db.close(); }
  });
});

test('raw SQL rejects malformed metadata and invalid deltas without receipts', async (t) => {
  const db = await database(), f = makeDeath({ lawless: true, killer: true, pearlCount: 2, loot: true });
  const { request } = planRequest(f, deathOp(80));
  try {
    await seedDeathStore(db.store, f, request);
    const cases = [
      ['SQL null request', 'operation', (r) => { r.__null = true; }],
      ['extra request field', 'operation', (r) => { r.extra = 1; }],
      ['null rules', 'operation', (r) => { r.rules = null; }],
      ['null profiles', 'operation', (r) => { r.profiles = null; }],
      ['null pearls', 'operation', (r) => { r.pearls = null; }],
      ['null drops', 'operation', (r) => { r.drops = null; }],
      ['fractional profile generation', 'operation', (r) => { r.profiles[0].expectedVersion = 1.5; }],
      ['XP source baseline mismatch', 'ownership', (r) => { r.rules.xpBefore += 0.01; }],
      ['noncanonical victim UUID', 'operation', (r) => { r.victim = r.victim.toUpperCase(); }],
      ['killer outside lawless zone', 'operation', (r) => { r.rules.lawless = false; }],
      ['null pearl location', 'operation', (r) => { r.pearls[0].ground = null; }],
      ['bad pearl return metadata', 'operation', (r) => { r.pearls[0].ground.returnAt = r.pearls[0].ground.availableAt; }],
      ['duplicate pearl UID', 'operation', (r) => { r.pearls[1].uid = r.pearls[0].uid; }],
      ['duplicate drop ordinal', 'operation', (r) => { r.drops[0].ordinal = 2; }],
      ['invalid ordinary drop ground', 'operation', (r) => { r.drops[0].ground.expiresAt = r.drops[0].ground.availableAt; }],
      ['potion with item object', 'operation', (r) => { const p = r.drops.find((d) => d.kind === 'potion'); p.item = {}; }],
      ['profile gold mutation', 'ownership', (r) => { r.profiles.find((p) => p.id === VICTIM).data.gold++; }],
      ['killer PK delta mutation', 'ownership', (r) => { r.profiles.find((p) => p.id === KILLER).data.stats.pk++; }],
      ['omitted pearl', 'ownership', (r) => { r.pearls.pop(); }],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [name, why, mutate] = cases[i], bad = structuredClone(request), id = deathOp(800 + i);
      mutate(bad);
      delete bad.operationId;
      if (name === 'SQL null request') {
        const result = (await db.db.query('select public.mn_commit_death($1::uuid,null::jsonb) as data', [id])).rows[0].data;
        assert.deepEqual(result, { ok: false, why }, name);
        assert.equal(await db.store.loadDeathOperation(id), null, `${name}: no receipt`);
        continue;
      }
      const result = (await db.db.query('select public.mn_commit_death($1::uuid,$2::jsonb) as data', [id, bad])).rows[0].data;
      assert.deepEqual(result, { ok: false, why }, name);
      assert.equal(await db.store.loadDeathOperation(id), null, `${name}: provisional receipt rolled back`);
    }
  } finally { await db.close(); }
});

test('raw SQL preserves future profile JSON fields while applying the canonical death delta', async () => {
  const db = await database(), f = makeDeath({ pearlCount: 0 });
  const { request } = planRequest(f, deathOp(90));
  try {
    await seedDeathStore(db.store, f, request);
    const row = await db.store.loadProfile(VICTIM), baseline = { ...row.data, futureFeature: { tier: 7, notes: ['keep'] } };
    await db.db.query('update public.mn_profiles set data=$1::jsonb where player_id=$2::uuid', [baseline, VICTIM]);
    const sqlRequest = structuredClone(request), profile = sqlRequest.profiles[0];
    profile.before = baseline; profile.data = { ...profile.data, futureFeature: structuredClone(baseline.futureFeature) };
    const raw = { ...sqlRequest }; delete raw.operationId;
    const result = (await db.db.query('select public.mn_commit_death($1::uuid,$2::jsonb) as data', [request.operationId, raw])).rows[0].data;
    assert.equal(result.ok, true);
    const after = (await db.db.query('select data from public.mn_profiles where player_id=$1::uuid', [VICTIM])).rows[0].data;
    assert.deepEqual(after.futureFeature, baseline.futureFeature);
  } finally { await db.close(); }
});

test('lost commit reply resolves from the durable exact receipt', async () => {
  const db = await database(), f = makeDeath({ lawless: true, pearlCount: 2, loot: true });
  const { request } = planRequest(f, deathOp(91));
  try {
    await seedDeathStore(db.store, f, request); db.loseNextReply();
    await assert.rejects(db.store.commitDeath(request), { code: 'unavailable' });
    const receipt = await db.store.loadDeathOperation(request.operationId);
    assert.ok(receipt); assert.deepEqual((await db.store.commitDeath(request)).replay, true);
    const changed = structuredClone(request); changed.drops[0].ground.x++;
    assert.deepEqual(await db.store.commitDeath(changed), { ok: false, why: 'operation' });
  } finally { await db.close(); }
});

test('death operation UUID namespace conflicts with 004/007 receipts in both directions', async () => {
  const db = await database(), f = makeDeath({ pearlCount: 1 });
  const { request } = planRequest(f, deathOp(101));
  try {
    await seedDeathStore(db.store, f, request);
    assert.deepEqual(await db.store.commitDeath(request), { ok: false, why: 'operation' }, 'existing 004 receipt blocks death');
    const db2 = await database(), fresh = makeDeath({ pearlCount: 0 }), death = planRequest(fresh, deathOp(102)).request;
    try {
      await seedDeathStore(db2.store, fresh, death); assert.equal((await db2.store.commitDeath(death)).ok, true);
      for (const table of ['mn_pearl_operations', 'mn_pearl_ground_operations', 'mn_pearl_batch_operations']) {
        await assert.rejects(db2.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`, [death.operationId]),
          undefined, `${table} rejects UUID already owned by death`);
        const oldId = deathOp(200 + ['mn_pearl_operations','mn_pearl_ground_operations','mn_pearl_batch_operations'].indexOf(table));
        await db2.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`, [oldId]);
        await assert.rejects(db2.db.query(`update public.${table} set operation_id=$1::uuid where operation_id=$2::uuid`,
          [death.operationId, oldId]), undefined, `${table} cannot be moved into death UUID`);
      }
      const journal = createSupabasePearlJournal(db2.client, WORLD);
      await assert.rejects(journal.prepare('pearl', { operationId: death.operationId, uid: 'death-journal-uid', kind: 'brasa',
        from: null, to: VICTIM, expectedVersion: 0,
        profiles: [{ id: VICTIM, expectedVersion: death.profiles[0].expectedVersion + 1, data: death.profiles[0].data }] }),
      { code: 'operation' }, 'a bound SQL intent cannot reuse a death receipt UUID');
    } finally { await db2.close(); }
  } finally { await db.close(); }
});

test('003/004/007 prior receipt UUIDs all block a new death operation', async () => {
  const db = await database(), f = makeDeath(), base = planRequest(f, deathOp(120)).request;
  try {
    await seedDeathStore(db.store, f, base);
    for (const [n, table] of [[121, 'mn_pearl_operations'], [122, 'mn_pearl_ground_operations'], [123, 'mn_pearl_batch_operations']]) {
      const request = structuredClone(base), id = deathOp(n); request.operationId = id;
      await db.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,'{}'::jsonb)`, [id]);
      assert.deepEqual(await db.store.commitDeath(request), { ok: false, why: 'operation' }, `${table} owns the UUID`);
      assert.equal(await db.store.loadDeathOperation(id), null);
    }
  } finally { await db.close(); }
});

test('SQL late faults roll profiles, pearl ledger, locations, ordinary drops, and receipt back', async (t) => {
  for (const [index, table, event, condition] of [
    [1, 'mn_profiles', 'UPDATE', `to_jsonb(NEW)->>'player_id' = '${KILLER}'`],
    [2, 'mn_unique_items', 'UPDATE', `to_jsonb(NEW)->>'uid' = 'death-storage:2'`],
    [3, 'mn_pearl_locations', 'INSERT', `to_jsonb(NEW)->>'uid' = 'death-storage:2'`],
    [4, 'mn_death_drops', 'INSERT', `to_jsonb(NEW)->>'ordinal' = '2'`],
    [5, 'mn_death_operations', 'UPDATE', `to_jsonb(NEW)->>'result' IS NOT NULL`],
  ]) await t.test(table, async () => {
    const db = await database(), f = makeDeath({ lawless: true, killer: true, pearlCount: 2, loot: true });
    const { request } = planRequest(f, deathOp(110 + index));
    try {
      await seedDeathStore(db.store, f, request);
      const beforeVictim = await db.store.loadProfile(VICTIM), beforeKiller = await db.store.loadProfile(KILLER);
      await db.db.exec(`RESET ROLE; CREATE FUNCTION public.mn_test_death_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF ${condition} THEN RAISE EXCEPTION 'injected death write failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER mn_test_death_failure BEFORE ${event} ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.mn_test_death_failure();`);
      await db.db.exec('SET ROLE service_role');
      await assert.rejects(db.store.commitDeath(request), { code: 'unavailable' });
      await db.db.exec(`RESET ROLE; DROP TRIGGER mn_test_death_failure ON public.${table}; DROP FUNCTION public.mn_test_death_failure(); SET ROLE service_role;`);
      assert.deepEqual(await db.store.loadProfile(VICTIM), beforeVictim);
      assert.deepEqual(await db.store.loadProfile(KILLER), beforeKiller);
      assert.equal(await db.store.loadDeathOperation(request.operationId), null);
      assert.deepEqual(await db.store.listDeathDrops(WORLD), []);
      for (const q of request.pearls) {
        assert.equal((await db.store.loadUnique(q.uid)).holder, VICTIM);
        assert.equal((await db.store.loadPearlLocation(q.uid)).ground, null);
      }
      assert.equal((await db.store.commitDeath(request)).ok, true, 'same operation succeeds once the injected fault is removed');
    } finally { await db.close(); }
  });
});

test('death receipt and drops remain service-only', async () => {
  const db = await database();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(db.db.query('select public.mn_commit_death($1::uuid,null::jsonb)', [deathOp(1)]));
      await assert.rejects(db.db.query('select public.mn_load_death_operation($1::uuid)', [deathOp(1)]));
      await assert.rejects(db.db.query('select public.mn_list_death_drops($1,null::uuid,null::integer,1)', [WORLD]));
      await assert.rejects(db.db.query('select public.mn_valid_death(null::jsonb)'));
      await assert.rejects(db.db.query('select * from public.mn_death_operations'));
      await assert.rejects(db.db.query('select * from public.mn_death_drops'));
    }
  } finally { await db.close(); }
});

test('direct service writes cannot append drops or commit provisional receipts', async () => {
  const db = await database(); let db2 = null;
  const f = makeDeath({ lawless: true, loot: true });
  const { request } = planRequest(f, deathOp(131));
  try {
    await seedDeathStore(db.store, f, request);
    assert.equal((await db.store.commitDeath(request)).ok, true);
    const first = request.drops[0];
    await assert.rejects(db.db.query(`insert into public.mn_death_drops(operation_id,ordinal,world,victim,kind,item,ground)
      values($1::uuid,$2,$3,$4::uuid,$5,$6::jsonb,$7::jsonb)`, [request.operationId, request.drops.length + 1,
      WORLD, VICTIM, first.kind, first.item, first.ground]), { code: 'MNP02' }, 'completed receipt prevents extra rows');

    db2 = await database(); const second = makeDeath({ lawless: true, loot: true }), raw = planRequest(second, deathOp(132)).request;
    await seedDeathStore(db2.store, second, raw);
    const { operationId, ...payload } = raw;
    await db2.db.exec('BEGIN');
    await db2.db.query('insert into public.mn_death_operations(operation_id,request) values($1::uuid,$2::jsonb)', [operationId, payload]);
    const drop = raw.drops[0];
    const altered = structuredClone(drop); altered.item.u++;
    await assert.rejects(db2.db.query(`insert into public.mn_death_drops(operation_id,ordinal,world,victim,kind,item,ground)
      values($1::uuid,$2,$3,$4::uuid,$5,$6::jsonb,$7::jsonb)`,
    [operationId, altered.ordinal, WORLD, VICTIM, altered.kind, altered.item, altered.ground]), { code: 'MNP02' },
    'provisional parent binds exact item payload');
    await db2.db.exec('ROLLBACK');
    await db2.db.exec('BEGIN');
    await db2.db.query('insert into public.mn_death_operations(operation_id,request) values($1::uuid,$2::jsonb)', [operationId, payload]);
    await db2.db.query(`insert into public.mn_death_drops(operation_id,ordinal,world,victim,kind,item,ground)
      values($1::uuid,$2,$3,$4::uuid,$5,$6::jsonb,$7::jsonb)`,
    [operationId, drop.ordinal, WORLD, VICTIM, drop.kind, drop.item, drop.ground]);
    await assert.rejects(db2.db.exec('COMMIT'), undefined, 'deferred completion guard rejects a receipt without result');
    await db2.db.exec('ROLLBACK');
    assert.equal(await db2.store.loadDeathOperation(operationId), null);
    assert.deepEqual(await db2.store.listDeathDrops(WORLD), []);
  } finally { await db2?.close(); await db.close(); }
});
