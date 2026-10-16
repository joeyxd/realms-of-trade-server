import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetRegistryError } from '../server/web3/assetRegistry.mjs';
import { adapters, database, assetRegistrySql } from './helpers/web3-asset-registry-sql.mjs';

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:coral', GENERATION = id(1), OWNER = id(2), BUYER = id(3), OTHER = id(4);
const hash = (digit) => digit.repeat(64);
const register = (n, assetClass = 'equipment', sourceKey = `sql-source:${n}`) => ({
  operationId: id(100 + n), action: 'register', assetId: id(200 + n), worldId: WORLD,
  worldGeneration: GENERATION, assetClass, sourceKey, contentId: `content:${n}`,
  contentHash: hash('c'), rightsHash: hash('d'), to: OWNER,
});
const transfer = (n, assetId, from = OWNER, to = BUYER, expectedVersion = 1) => ({
  operationId: id(300 + n), action: 'transfer', assetId, worldId: WORLD,
  worldGeneration: GENERATION, from, to, expectedVersion,
});

test('Supabase SDK calls the service-role RPCs against PGlite for equipment and plot ownership', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const { registry, calls } = sql;
  assert.equal(registry.kind, 'supabase'); assert.equal(registry.durable, true);
  for (const [n, assetClass] of [[1, 'equipment'], [2, 'plot']]) await t.test(assetClass, async () => {
    const request = register(n, assetClass);
    const prepared = await registry.prepare(request);
    assert.equal(prepared.ok, true); assert.equal(prepared.replay, false);
    assert.deepEqual(prepared.operation.request, request);
    assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: OWNER, version: 1 }),
      { ok: false, why: 'busy' });
    const committed = await registry.commit(request.operationId);
    assert.equal(committed.asset.ownerId, OWNER); assert.equal(committed.asset.version, 1);
    const moved = transfer(n, request.assetId);
    assert.equal((await registry.prepare(moved)).ok, true);
    const receipt = await registry.commit(moved.operationId);
    assert.equal(receipt.asset.ownerId, BUYER); assert.equal(receipt.asset.version, 2);
    assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: OWNER, version: 1 }),
      { ok: false, why: 'ownership' });
    assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: BUYER, version: 2 }), { ok: true });
    assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: BUYER, version: 1 }),
      { ok: false, why: 'conflict' });
  });
  assert.ok(calls.some((call) => call.name === 'mn_web3_prepare'));
  for (const call of calls) {
    assert.equal(call.headers.apikey, 'service-role-test-key');
    assert.equal(call.headers.authorization, 'Bearer service-role-test-key');
  }
});

test('SQL reservations, exact operation identity, replay, and cancellation survive rereads', async (t) => {
  const sql = await database(); t.after(() => sql.close()); const { registry } = sql;
  const pendingRegistration = register(12); await registry.prepare(pendingRegistration);
  assert.deepEqual(await registry.checkClaim({ assetId: pendingRegistration.assetId, ownerId: OWNER, version: 1 }),
    { ok: false, why: 'busy' });
  assert.deepEqual(await registry.prepare({ ...register(13), assetId: pendingRegistration.assetId }),
    { ok: false, replay: false, why: 'busy' });
  assert.deepEqual(await registry.prepare({ ...register(14), sourceKey: pendingRegistration.sourceKey }),
    { ok: false, replay: false, why: 'busy' });
  assert.deepEqual(await registry.cancel(pendingRegistration.operationId),
    { ok: false, why: 'cancelled', replay: false });
  const original = register(10); await registry.prepare(original); await registry.commit(original.operationId);
  const first = transfer(10, original.assetId), second = transfer(11, original.assetId, OWNER, OTHER);
  assert.equal((await registry.prepare(first)).ok, true);
  assert.deepEqual(await registry.prepare(second), { ok: false, replay: false, why: 'busy' });
  assert.deepEqual(await registry.checkClaim({ assetId: original.assetId, ownerId: OWNER, version: 1 }),
    { ok: false, why: 'busy' });
  assert.deepEqual(await registry.checkClaim({ assetId: original.assetId, ownerId: OTHER, version: 1 }),
    { ok: false, why: 'busy' });
  assert.deepEqual(await registry.prepare({ ...register(15), sourceKey: original.sourceKey }),
    { ok: false, replay: false, why: 'busy' });
  assert.deepEqual(await registry.loadAsset(original.assetId), {
    assetId: original.assetId, worldId: WORLD, worldGeneration: GENERATION, assetClass: 'equipment',
    sourceKey: original.sourceKey, contentId: original.contentId, contentHash: hash('c'),
    rightsHash: hash('d'), ownerId: OWNER, version: 1,
  });
  const cancelled = await registry.cancel(first.operationId);
  assert.deepEqual(cancelled, { ok: false, why: 'cancelled', replay: false });
  assert.equal((await registry.loadOperation(first.operationId)).state, 'cancelled');
  assert.deepEqual(await registry.commit(first.operationId), { ok: false, replay: true, why: 'cancelled' });
  assert.equal((await registry.prepare(second)).ok, true);
  const result = await registry.commit(second.operationId);
  assert.equal(result.asset.ownerId, OTHER); assert.equal(result.asset.version, 2);
  const later = transfer(15, original.assetId, OTHER, BUYER, 2);
  assert.equal((await registry.prepare(later)).ok, true);
  const laterReceipt = await registry.commit(later.operationId);
  assert.equal(laterReceipt.asset.ownerId, BUYER); assert.equal(laterReceipt.asset.version, 3);
  assert.deepEqual(await registry.prepare(second), { ok: true, replay: true, operation: {
    operationId: second.operationId, request: second, state: 'committed', result: { ok: true, asset: result.asset },
  } });
  assert.deepEqual(await registry.commit(second.operationId), { ok: true, replay: true, asset: result.asset });
  assert.deepEqual(await registry.loadAsset(original.assetId), laterReceipt.asset);
  const pending = await registry.listPending(WORLD, GENERATION);
  assert.deepEqual(pending, []);
});

test('SQL rejects conflicting asset/source identities and stale, foreign-owner, and wrong-world transfers', async (t) => {
  const sql = await database(); t.after(() => sql.close()); const { registry } = sql;
  const original = register(20); await registry.prepare(original); await registry.commit(original.operationId);
  assert.deepEqual(await registry.prepare({ ...register(21), assetId: original.assetId }),
    { ok: false, replay: false, why: 'conflict' });
  assert.deepEqual(await registry.prepare({ ...register(22), sourceKey: original.sourceKey }),
    { ok: false, replay: false, why: 'identity' });
  const rejected = [
    transfer(23, original.assetId, OTHER, BUYER, 1), transfer(24, original.assetId, OWNER, BUYER, 2),
    { ...transfer(25, original.assetId), worldId: 'other:world' },
    { ...transfer(26, original.assetId), worldGeneration: id(99) },
  ];
  for (const request of rejected) assert.equal((await registry.prepare(request)).ok, false);
  assert.equal((await registry.loadAsset(original.assetId)).ownerId, OWNER);
  assert.equal((await registry.loadAsset(original.assetId)).version, 1);
});

test('SQL validation and pending pagination reject malformed input without writes', async (t) => {
  const sql = await database(); t.after(() => sql.close()); const { registry } = sql;
  const valid = register(30);
  for (const request of [
    { ...valid, extra: true }, { ...valid, contentHash: hash('C') }, { ...valid, sourceKey: 'x'.repeat(161) },
    { ...valid, worldId: 'world with spaces' }, { ...valid, to: '00000000-0000-0000-0000-000000000000' },
    { ...valid, worldGeneration: 0 }, { ...transfer(31, valid.assetId), expectedVersion: 0 },
    { ...transfer(35, valid.assetId), expectedVersion: 1.5 },
    { ...transfer(36, valid.assetId), expectedVersion: 2147483647 },
  ]) await assert.rejects(registry.prepare(request), (error) => error instanceof AssetRegistryError && error.code === 'input');
  assert.equal(await registry.loadAsset(valid.assetId), null);
  await assert.rejects(registry.listPending(WORLD, GENERATION, { limit: 0 }),
    (error) => error instanceof AssetRegistryError && error.code === 'input');
  const first = register(32), second = register(33), elsewhere = { ...register(34), worldId: 'world:other' };
  await registry.prepare(second); await registry.prepare(elsewhere); await registry.prepare(first);
  const page = await registry.listPending(WORLD, GENERATION, { limit: 1 });
  assert.deepEqual(page.map((operation) => operation.operationId), [first.operationId]);
  const next = await registry.listPending(WORLD, GENERATION, { afterId: page[0].operationId, limit: 2 });
  assert.deepEqual(next.map((operation) => operation.operationId), [second.operationId]);
});

test('SQL RPC boundary rejects malformed JSON DTOs and accepts only whole numeric versions', async (t) => {
  const sql = await database(); t.after(() => sql.close()); const { db, registry } = sql;
  const original = register(37); await registry.prepare(original); await registry.commit(original.operationId);
  const base = transfer(37, original.assetId);
  const whole = JSON.stringify({ ...base, expectedVersion: 1 }).replace('"expectedVersion":1', '"expectedVersion":1.0');
  const accepted = (await db.query('select public.mn_web3_prepare($1::jsonb) as data', [whole])).rows[0].data;
  assert.equal(accepted.ok, true);
  await registry.cancel(base.operationId);

  const badValues = [true, null, '1', 1.5];
  for (let i = 0; i < badValues.length; i++) {
    const request = { ...transfer(38 + i, original.assetId), expectedVersion: badValues[i] };
    await assert.rejects(db.query('select public.mn_web3_prepare($1::jsonb)', [JSON.stringify(request)]),
      (error) => error.code === 'MNW01');
  }
  const invalidStrings = [
    { ...register(42), operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\n' },
    { ...register(43), worldId: 'world:coral\n' },
    { ...register(44), sourceKey: 'sql-source:44\n' },
    { ...register(45), contentHash: `${hash('c')}\n` },
  ];
  for (const request of invalidStrings) await assert.rejects(
    db.query('select public.mn_web3_prepare($1::jsonb)', [JSON.stringify(request)]),
    (error) => error.code === 'MNW01');
});

test('SQL transaction rollback removes both a prepared intent and its committed asset', async (t) => {
  const sql = await database(); t.after(() => sql.close()); const { db, registry } = sql;
  const request = register(46);
  await db.exec('BEGIN');
  assert.equal((await registry.prepare(request)).ok, true);
  assert.equal((await registry.commit(request.operationId)).ok, true);
  await db.exec('ROLLBACK');
  assert.equal(await registry.loadOperation(request.operationId), null);
  assert.equal(await registry.loadAsset(request.assetId), null);
});

test('SQL RPCs deny public roles and direct DML; migration reapply retains records', async (t) => {
  const sql = await database(undefined, { reapply: true }); t.after(() => sql.close()); const { db, registry } = sql;
  const item = register(40); await registry.prepare(item); const created = await registry.commit(item.operationId);
  await db.exec('RESET ROLE'); await db.exec(assetRegistrySql);
  await db.exec('SET ROLE service_role');
  assert.deepEqual(await registry.loadAsset(item.assetId), created.asset);
  assert.deepEqual(await registry.commit(item.operationId), { ok: true, replay: true, asset: created.asset });
  await db.exec('RESET ROLE');
  const privilegeRows = (await db.query(`
    select table_name,
      (select column_name from information_schema.columns c where c.table_schema=t.table_schema
        and c.table_name=t.table_name order by ordinal_position limit 1) as first_column,
      has_table_privilege('service_role', format('%I.%I','mn_web3_private',table_name), 'SELECT') as can_select,
      has_table_privilege('service_role', format('%I.%I','mn_web3_private',table_name), 'INSERT,UPDATE,DELETE,TRUNCATE') as can_write,
      has_table_privilege('anon', format('%I.%I','mn_web3_private',table_name), 'SELECT') as anon_select,
      has_table_privilege('authenticated', format('%I.%I','mn_web3_private',table_name), 'SELECT') as auth_select
    from information_schema.tables t where table_schema='mn_web3_private' and table_type='BASE TABLE'
  `)).rows;
  assert.ok(privilegeRows.length > 0, 'migration should create ledger tables');
  for (const row of privilegeRows) {
    assert.equal(row.can_select, true, `${row.table_name}: service_role SELECT`);
    assert.equal(row.can_write, false, `${row.table_name}: service_role direct DML`);
    assert.equal(row.anon_select, false, `${row.table_name}: anon SELECT`);
    assert.equal(row.auth_select, false, `${row.table_name}: authenticated SELECT`);
  }
  await db.exec('SET ROLE service_role');
  for (const table of privilegeRows.map((row) => row.table_name)) {
    await assert.rejects(db.exec(`INSERT INTO mn_web3_private."${table}" DEFAULT VALUES`),
      (error) => error.code === '42501');
    const column = privilegeRows.find((row) => row.table_name === table).first_column;
    await assert.rejects(db.exec(`UPDATE mn_web3_private."${table}" SET "${column}" = "${column}"`),
      (error) => error.code === '42501');
    await assert.rejects(db.exec(`DELETE FROM mn_web3_private."${table}"`),
      (error) => error.code === '42501');
    await assert.rejects(db.exec(`TRUNCATE mn_web3_private."${table}"`),
      (error) => error.code === '42501');
  }
  await db.exec('RESET ROLE');
  const functionRows = (await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
    has_function_privilege('service_role', p.oid, 'EXECUTE') service_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'mn_web3_%'`)).rows;
  assert.equal(functionRows.length, 7);
  for (const row of functionRows) {
    assert.equal(row.anon_exec, false, `${row.proname}: anon EXECUTE`);
    assert.equal(row.auth_exec, false, `${row.proname}: authenticated EXECUTE`);
    assert.equal(row.service_exec, true, `${row.proname}: service_role EXECUTE`);
  }
});

test('lost prepare and commit replies are recovered by exact UUID and terminal receipt', async (t) => {
  const sql = await database(); t.after(() => sql.close()); await sql.db.exec('RESET ROLE');
  let losePrepare = true, loseCommit = true;
  const { registry } = adapters(sql.db, [], { loseReply: (name) => {
    if (name === 'mn_web3_prepare' && losePrepare) { losePrepare = false; return true; }
    if (name === 'mn_web3_commit' && loseCommit) { loseCommit = false; return true; }
    return false;
  } });
  await sql.db.exec('SET ROLE service_role');
  const request = register(50);
  await assert.rejects(registry.prepare(request), (error) => error instanceof AssetRegistryError && error.code === 'unavailable');
  const pending = await registry.loadOperation(request.operationId);
  assert.deepEqual(pending.request, request); assert.equal(pending.state, 'pending');
  assert.equal((await registry.prepare(request)).replay, true);
  await assert.rejects(registry.commit(request.operationId), (error) => error instanceof AssetRegistryError && error.code === 'unavailable');
  const committed = await registry.loadOperation(request.operationId);
  assert.equal(committed.state, 'committed');
  const receipt = await registry.commit(request.operationId);
  assert.equal(receipt.replay, true); assert.equal(receipt.asset.ownerId, OWNER);
  assert.equal((await registry.loadAsset(request.assetId)).version, 1);
});

test('SQL reports a malformed RPC response as response instead of accepting it', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const { registry } = adapters(sql.db, [], { transformReply: (name, data) =>
    name === 'mn_web3_prepare' ? { ...data, contradictory: true } : data });
  const request = register(60);
  await assert.rejects(registry.prepare(request), (error) => error instanceof AssetRegistryError && error.code === 'response');
  assert.equal((await sql.registry.loadOperation(request.operationId)).state, 'pending');

  const next = register(62);
  await sql.registry.prepare(next);
  const { registry: incorrectCommit } = adapters(sql.db, [], { transformReply: (name, data) => {
    if (name !== 'mn_web3_commit' || !data?.asset) return data;
    return { ...data, asset: { ...data.asset, ownerId: OTHER } };
  } });
  await assert.rejects(incorrectCommit.commit(next.operationId),
    (error) => error instanceof AssetRegistryError && error.code === 'response');
  assert.equal((await sql.registry.loadAsset(next.assetId)).ownerId, OWNER);
});

test('SQL RPC error replies map input and unknown database failures to strict registry errors', async (t) => {
  const sql = await database(); t.after(() => sql.close());
  const { registry: inputRegistry } = adapters(sql.db, [], { rejectReply: (name) => name === 'mn_web3_prepare' ? 'MNW01' : null });
  await assert.rejects(inputRegistry.prepare(register(61)),
    (error) => error instanceof AssetRegistryError && error.code === 'input');
  const { registry: unavailableRegistry } = adapters(sql.db, [], { rejectReply: (name) => name === 'mn_web3_load_asset' ? 'XX000' : null });
  await assert.rejects(unavailableRegistry.loadAsset(id(999)),
    (error) => error instanceof AssetRegistryError && error.code === 'unavailable');
});
