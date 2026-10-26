import test from 'node:test';
import assert from 'node:assert/strict';
import { batchOperation } from '../server/pearlBatch.mjs';
import { database } from './helpers/pearl-batch-journal-sql.mjs';
import { seed, request, A, B, WORLD, op, ground } from './helpers/pearl-batch.mjs';

const legacyPearl = () => ({ uid: 'journal-old-pearl', kind: 'brasa', from: A, to: B, expectedVersion: 1,
  profiles: [{ id: A, expectedVersion: 2, data: { v: 1, gold: 0 } }, { id: B, expectedVersion: 3, data: { v: 1, gold: 5 } }] });
const legacyGround = () => ({ uid: 'journal-old-ground', kind: 'tinta', from: null, to: null, expectedVersion: 0,
  profiles: [], world: WORLD, ground: { x: 1.5, z: -4, availableAt: 10, returnAt: 20 } });
const concrete = (raw) => {
  const { request: payload } = batchOperation(raw);
  return payload;
};
const prepare = (client, id, payload, scope = WORLD, family = 'batch') => client.rpc('mn_prepare_pearl_intent', {
  p_scope: scope, p_family: family, p_operation_id: id, p_request: payload,
});
const resolve = (client, id, payload, stateName, scope = WORLD, family = 'batch') => client.rpc('mn_resolve_pearl_intent', {
  p_scope: scope, p_family: family, p_operation_id: id, p_request: payload, p_state: stateName,
});
const rpcRejected = async (promise, code = 'MNP02') => assert.equal((await promise).error?.code, code);
const allState = async (db) => {
  const tables = ['mn_profiles','mn_unique_items','mn_pearl_locations','mn_pearl_operations',
    'mn_pearl_ground_operations','mn_pearl_batch_operations','mn_pearl_intents'];
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table,
    (await db.query(`select * from public.${table} order by 1`)).rows])));
};
const rejected = async (promise, code = 'MNP02') => assert.rejects(promise, (error) => error.code === code);
const rawCommit = async (db, raw) => {
  const { operationId, ...payload } = raw;
  return (await db.query('select public.mn_commit_pearl_batch($1::uuid,$2::jsonb) as data', [operationId, payload])).rows[0].data;
};

test('SQL008 SDK journals an exact batch before commit and closes it terminally', async () => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p), payload = concrete(raw);
    const pending = await f.journal.prepare('batch', { operationId: raw.operationId, ...payload });
    assert.deepEqual(pending, { operationId: raw.operationId, scope: WORLD, family: 'batch', request: payload, state: 'pending' });
    const result = await f.store.commitPearlBatch(raw);
    assert.equal(result.ok, true);
    const closed = await f.journal.resolve('batch', { operationId: raw.operationId, ...payload }, 'committed');
    assert.equal(closed.state, 'committed');
    assert.deepEqual(await f.journal.list(), []);
    assert.equal((await f.store.loadPearlBatchOperation(raw.operationId)).request.profile.expectedVersion, p.version);
    assert.deepEqual(f.calls.filter((call) => ['mn_prepare_pearl_intent','mn_commit_pearl_batch','mn_resolve_pearl_intent']
      .includes(call.name)).map((call) => call.name),
      ['mn_prepare_pearl_intent','mn_commit_pearl_batch','mn_resolve_pearl_intent']);
  } finally { await f.close(); }
});

test('SQL008 allows exact prepare after a batch receipt and binds both UUID directions', async () => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p), payload = concrete(raw);
    assert.equal((await f.store.commitPearlBatch(raw)).ok, true);
    const afterReceipt = await prepare(f.client, raw.operationId, payload);
    assert.ifError(afterReceipt.error);
    assert.equal(afterReceipt.data.state, 'pending');
    const before = await allState(f.db);
    for (const [name, scope, changed] of [
      ['changed geometry', WORLD, { ...payload, items: payload.items.map((q, i) => i ? q : { ...q, ground: ground(40) }) }],
      ['changed world and scope', 'other:world', { ...payload, world: 'other:world' }],
      ['changed mode', WORLD, { ...payload, mode: 'replace' }],
    ]) {
      await tassertNoMutation(name, () => prepare(f.client, raw.operationId, changed, scope), before, f.db);
    }
    const another = structuredClone(raw); another.items[0].ground.x += 1;
    assert.deepEqual(await rawCommit(f.db, another), { ok: false, why: 'operation' });
    assert.deepEqual(await allState(f.db), before);
    const exact = await f.journal.resolve('batch', { operationId: raw.operationId, ...payload }, 'committed');
    assert.equal(exact.state, 'committed');
  } finally { await f.close(); }
});

async function tassertNoMutation(label, run, before, db) {
  const result = await run();
  assert.equal(result.error?.code, 'MNP02', `${label} was accepted`);
  assert.deepEqual(await allState(db), before, `${label} changed storage`);
}

test('SQL008 excludes old receipts and intents in both directions, including raw service inserts', async () => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p), payload = concrete(raw);
    const beforeOldReceipt = await allState(f.db);
    await rpcRejected(prepare(f.client, op(1), payload)); // Seed created a 004 receipt with this UUID.
    assert.deepEqual(await allState(f.db), beforeOldReceipt);

    const pearlIntent = legacyPearl(), groundIntent = legacyGround();
    assert.ifError((await prepare(f.client, op(40), pearlIntent, WORLD, 'pearl')).error);
    assert.ifError((await prepare(f.client, op(41), groundIntent, WORLD, 'ground')).error);
    const withOldIntents = await allState(f.db);
    for (const id of [op(40), op(41)]) {
      const colliding = { ...raw, operationId: id };
      assert.deepEqual(await rawCommit(f.db, colliding), { ok: false, why: 'operation' });
    }
    assert.deepEqual(await allState(f.db), withOldIntents);

    assert.equal((await f.store.commitPearlBatch(raw)).ok, true);
    const afterBatchReceipt = await allState(f.db);
    await rpcRejected(prepare(f.client, raw.operationId, pearlIntent, WORLD, 'pearl'));
    await rpcRejected(prepare(f.client, raw.operationId, groundIntent, WORLD, 'ground'));
    for (const [table, requestValue] of [['mn_pearl_operations', pearlIntent], ['mn_pearl_ground_operations', groundIntent]]) {
      await rejected(f.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,$2::jsonb)`,
        [raw.operationId, requestValue]));
    }
    assert.deepEqual(await allState(f.db), afterBatchReceipt);

    // An older 003/004 receipt blocks a batch intent even when inserted by the service role.
    const newPayload = concrete({ ...raw, operationId: op(55) });
    const before = await allState(f.db);
    await rpcRejected(prepare(f.client, op(1), newPayload));
    assert.deepEqual(await allState(f.db), before);
    await rejected(f.db.query('insert into public.mn_pearl_batch_operations(operation_id,request) values($1::uuid,$2::jsonb)',
      [op(1), newPayload]));
    assert.deepEqual(await allState(f.db), before);

    const pendingId = op(42);
    assert.ifError((await prepare(f.client, pendingId, concrete({ ...raw, operationId: pendingId }))).error);
    const withBatchIntent = await allState(f.db);
    for (const [table, requestValue] of [['mn_pearl_operations', pearlIntent], ['mn_pearl_ground_operations', groundIntent]]) {
      await rejected(f.db.query(`insert into public.${table}(operation_id,request) values($1::uuid,$2::jsonb)`,
        [pendingId, requestValue]));
    }
    assert.deepEqual(await allState(f.db), withBatchIntent);
  } finally { await f.close(); }
});

test('SQL008 terminal journal states reject a later exact batch receipt', async (t) => {
  for (const terminal of ['committed','conflict','rejected']) await t.test(terminal, async () => {
    const f = await database();
    try {
      const p = await seed(f.store), raw = request(p), payload = concrete(raw);
      assert.ifError((await prepare(f.client, raw.operationId, payload)).error);
      assert.ifError((await resolve(f.client, raw.operationId, payload, terminal)).error);
      const before = await allState(f.db);
      assert.deepEqual(await rawCommit(f.db, raw), { ok: false, why: 'operation' });
      assert.deepEqual(await allState(f.db), before);
    } finally { await f.close(); }
  });
});

test('SQL008 validates exact batch metadata and world scope without side effects', async (t) => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p), payload = concrete(raw);
    const invalid = [
      ['wrong world', { ...payload, world: 'other:world' }, WORLD],
      ['extra request key', { ...payload, extra: true }, WORLD],
      ['missing item generation', { ...payload, items: payload.items.map(({ expectedVersion, ...q }) => q) }, WORLD],
      ['duplicate UID', { ...payload, items: [payload.items[0], payload.items[0]] }, WORLD],
      ['unsorted UIDs', { ...payload, items: [...payload.items].reverse() }, WORLD],
      ['invalid geometry', { ...payload, items: payload.items.map((q, i) => i ? q : { ...q, ground: { ...q.ground, returnAt: q.ground.availableAt } }) }, WORLD],
      ['wrong scope', payload, 'other:world'],
      ['unknown family', payload, WORLD, 'elsewhere'],
    ];
    const before = await allState(f.db);
    for (const [name, candidate, scope, family = 'batch'] of invalid) {
      await t.test(name, async () => {
        const result = await prepare(f.client, raw.operationId, candidate, scope, family);
        assert.equal(result.error?.code, 'MNP02');
        assert.deepEqual(await allState(f.db), before);
      });
    }
    for (const [scope, family, candidate] of [
      [WORLD, 'batch', { ...payload, mode: 'replace', items: payload.items }],
      [WORLD, 'batch', { ...payload, profile: { ...payload.profile, expectedVersion: 1.5 } }],
      [WORLD, 'batch', { ...payload, items: payload.items.map((q) => ({ ...q, expectedVersion: 0 })) }],
    ]) assert.equal((await f.client.rpc('mn_valid_pearl_intent', {
      p_scope: scope, p_family: family, p_request: candidate,
    })).data, false);
    assert.deepEqual(await allState(f.db), before);
  } finally { await f.close(); }
});

test('SQL008 keeps journal identity immutable and rejects terminal rewrites and deletion', async () => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p), payload = concrete(raw);
    assert.ifError((await prepare(f.client, raw.operationId, payload)).error);
    const immutable = await allState(f.db);
    const mutations = [
      ['scope', "update public.mn_pearl_intents set scope='other:world' where operation_id=$1::uuid"],
      ['family', "update public.mn_pearl_intents set family='pearl' where operation_id=$1::uuid"],
      ['request', "update public.mn_pearl_intents set request=request || '{\"x\":1}'::jsonb where operation_id=$1::uuid"],
      ['operation UUID', "update public.mn_pearl_intents set operation_id=$2::uuid where operation_id=$1::uuid"],
      ['delete', 'delete from public.mn_pearl_intents where operation_id=$1::uuid'],
    ];
    for (const [name, sql] of mutations) {
      await assert.rejects(f.db.query(sql, name === 'operation UUID' ? [raw.operationId, op(99)] : [raw.operationId]),
        (error) => ['MNP02','42501'].includes(error.code), name);
      assert.deepEqual(await allState(f.db), immutable, `${name} mutation changed journal`);
    }
    assert.ifError((await resolve(f.client, raw.operationId, payload, 'committed')).error);
    const committed = await allState(f.db);
    await assert.rejects(f.db.query("update public.mn_pearl_intents set state='conflict' where operation_id=$1::uuid", [raw.operationId]),
      (error) => error.code === 'MNP02');
    await assert.rejects(f.db.query('delete from public.mn_pearl_intents where operation_id=$1::uuid', [raw.operationId]),
      (error) => ['MNP02','42501'].includes(error.code));
    assert.deepEqual(await allState(f.db), committed);
  } finally { await f.close(); }
});

test('SQL008 journal rows and RPCs remain service-role only', async () => {
  const f = await database();
  try {
    const p = await seed(f.store), raw = request(p), payload = concrete(raw);
    assert.ifError((await prepare(f.client, raw.operationId, payload)).error);
    for (const role of ['anon','authenticated']) {
      await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(f.db.query('select * from public.mn_pearl_intents'), (error) => error.code === '42501');
      await assert.rejects(f.db.query('select public.mn_list_pearl_intents($1,null,10)', [WORLD]),
        (error) => error.code === '42501');
      await assert.rejects(f.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',
        [WORLD,'batch',op(88),payload]), (error) => error.code === '42501');
      await assert.rejects(f.db.query('select public.mn_resolve_pearl_intent($1,$2,$3::uuid,$4::jsonb,$5)',
        [WORLD,'batch',raw.operationId,payload,'committed']), (error) => error.code === '42501');
      await assert.rejects(f.db.query('select public.mn_valid_pearl_intent($1,$2,$3::jsonb)',
        [WORLD,'batch',payload]), (error) => error.code === '42501');
    }
    await f.db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await f.db.query('select count(*)::int as n from public.mn_pearl_intents')).rows[0].n, 1);
  } finally { await f.close(); }
});

test('SQL008 preserves the exact 004 child receipt overlap with its 003 parent', async () => {
  const f = await database();
  try {
    const p = await seed(f.store), batch = request(p), before = await allState(f.db);
    const parent = (await f.db.query('select count(*)::int as n from public.mn_pearl_operations where operation_id=$1::uuid', [op(1)])).rows[0].n;
    const child = (await f.db.query('select count(*)::int as n from public.mn_pearl_ground_operations where operation_id=$1::uuid', [op(1)])).rows[0].n;
    assert.equal(parent, 1); assert.equal(child, 1);
    const blocked = await prepare(f.client, op(1), concrete({ ...batch, operationId: op(1) }));
    assert.equal(blocked.error?.code, 'MNP02');
    assert.deepEqual(await allState(f.db), before);
  } finally { await f.close(); }
});

test('SQL008 retains the single-holder 006 journal and commit path unchanged', async () => {
  const f = await database();
  try {
    const p = await seed(f.store, true, 1), pearl = p.data.pearls.swallowed;
    p.data.pearls = { bag: [pearl], swallowed: null };
    assert.equal((await f.store.saveProfile(A, p.data, p.version)).ok, true);
    const after = structuredClone(p.data); after.pearls = { bag: [], swallowed: pearl };
    const raw = { operationId: op(90), ...pearl, from: A, to: A, expectedVersion: 1,
      world: WORLD, ground: null, profiles: [{ id: A, expectedVersion: p.version + 1, data: after }] };
    assert.equal((await f.journal.prepare('ground', raw)).state, 'pending');
    const result = await f.store.commitPearlGround(raw); assert.equal(result.ok, true);
    assert.deepEqual(await f.store.loadProfile(A), { data: after, version: p.version + 2 });
    assert.equal((await f.journal.resolve('ground', raw, 'committed')).state, 'committed');
    assert.equal((await f.store.commitPearlGround(raw)).replay, true); assert.deepEqual(await f.journal.list(), []);
  } finally { await f.close(); }
});
