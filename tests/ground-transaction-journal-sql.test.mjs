import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { GroundTransactionSession } from '../server/groundTransactionSession.mjs';
import { createSupabaseGroundTransactionJournal } from '../server/groundTransactionJournal.mjs';
import { groundOperation } from '../server/pearlGround.mjs';
import { database, reopenDatabase, groundTransactionJournalSql } from './helpers/ground-transaction-journal-sql.mjs';

const id = n => `91900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WORLD = 'journal-world';
const worldData = (tick = 100) => ({ v: 1, seed: 91, economy: new Economy(91).serialize(),
  resources: { v: 1, tick, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} } });

async function fixture(t, { path, world = WORLD } = {}) {
  const f = await database(path);
  t.after(() => f.close());
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [world, worldData()]);
  assert.equal((await f.store.commitGroundClock({ operationId: id(1), world,
    expectedVersion: 0, expectedTick: 0, tick: 100 })).ok, true);
  return f;
}

function rawIntent({ operationId = id(2), clockId = id(3), world = WORLD, expectedWorldVersion = 1,
  expectedTick = 100, expectedClockVersion = 1, tick = 110 } = {}) {
  const data = worldData(tick);
  return { operationId, request: { world, expectedWorldVersion, worldData: data, family: 'checkpoint', operation: {},
    clock: { operationId: clockId, expectedVersion: expectedClockVersion, expectedTick, tick } } };
}

async function rpc(f, name, args = {}) {
  const result = await f.journalClient.rpc(name, args);
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data;
}

const prepare = (f, raw) => rpc(f, 'mn_prepare_ground_transaction_intent', {
  p_operation_id: raw.operationId, p_request: raw.request,
});
const load = (f, operationId) => rpc(f, 'mn_load_ground_transaction_intent', { p_operation_id: operationId });
const list = (f, world, afterId = null, limit = 64) => rpc(f, 'mn_list_ground_transaction_intents', {
  p_world: world, p_after_id: afterId, p_limit: limit,
});
const commit = (f, raw) => rpc(f, 'mn_commit_ground_transaction', {
  p_operation_id: raw.operationId, p_request: raw.request,
});

test('SQL019 keeps a pending exact envelope across reopen and lists pending rows in UUID order', async t => {
  const path = join(await mkdtemp(join(tmpdir(), 'mn-ground-intent-')), 'db');
  const first = await fixture(t, { path });
  assert.deepEqual(await rpc(first, 'mn_ground_transaction_journal_ready'), { version: 1 });
  const second = rawIntent({ operationId: id(20), clockId: id(21) });
  const firstRaw = rawIntent();
  const pending = await prepare(first, firstRaw);
  assert.deepEqual(pending, { operationId: firstRaw.operationId, request: firstRaw.request, state: 'pending', result: null });
  await assert.rejects(prepare(first, second), error => error.code === '23505' || error.code === 'MNP02');
  await first.close();
  const reopened = await reopenDatabase(path);
  try {
    assert.deepEqual(await load(reopened, firstRaw.operationId), pending);
    assert.deepEqual(await list(reopened, WORLD), [pending]);
    const committed = await commit(reopened, firstRaw);
    assert.equal(committed.ok, true);
    assert.deepEqual(await load(reopened, firstRaw.operationId), { ...pending, state: 'committed', result: committed });
    assert.deepEqual(await commit(reopened, firstRaw), { ...committed, replay: true });
  } finally { await reopened.close(); }
});

test('SQL019 persists a commit when the response is lost, and retry returns its canonical receipt', async t => {
  const f = await fixture(t);
  const raw = rawIntent();
  await prepare(f, raw);
  f.loseNextCommitReply();
  const lost = await f.journalClient.rpc('mn_commit_ground_transaction', {
    p_operation_id: raw.operationId, p_request: raw.request,
  });
  assert.ok(lost.error, 'the SDK sees a transport failure after SQL committed');
  const durable = await load(f, raw.operationId);
  assert.equal(durable.state, 'committed');
  assert.equal(durable.result.ok, true);
  assert.deepEqual(await commit(f, raw), { ...durable.result, replay: true });
  assert.deepEqual(await f.store.loadGroundTransaction(raw.operationId), {
    request: raw.request, result: durable.result,
  });
});

test('SQL019 terminalizes a stale CAS without effects, releases the world, and admits the next intent', async t => {
  const f = await fixture(t);
  const stale = rawIntent();
  await prepare(f, stale);
  const competing = rawIntent({ operationId: id(10), clockId: id(11), expectedTick: 100, tick: 105 });
  assert.equal((await f.store.commitGroundTransaction(competing)).ok, true,
    'a separate SQL018 writer may advance the world after intent preparation');
  const conflict = await commit(f, stale);
  assert.deepEqual(conflict, { ok: false, why: 'conflict' });
  const terminal = await load(f, stale.operationId);
  assert.equal(terminal.state, 'conflict');
  assert.deepEqual(terminal.result, conflict);
  assert.deepEqual(await list(f, WORLD), [], 'recovery paging includes pending work only');
  assert.equal(await f.store.loadGroundClockOperation(id(3)), null);
  assert.equal(await f.store.loadGroundTransaction(stale.operationId), null);

  const next = rawIntent({ operationId: id(12), clockId: id(13), expectedWorldVersion: 2,
    expectedClockVersion: 2, expectedTick: 105, tick: 110 });
  assert.equal((await prepare(f, next)).state, 'pending');
  assert.equal((await commit(f, next)).ok, true);
});

test('SQL019 rolls every effect and receipt back if finalization fails, leaving the intent recoverable', async t => {
  const f = await fixture(t);
  const raw = rawIntent();
  await prepare(f, raw);
  await f.db.exec('RESET ROLE');
  await f.db.exec("CREATE FUNCTION public.mn_test_abort_ground_intent_finalize() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='committed' THEN RAISE EXCEPTION 'injected finalization failure'; END IF; RETURN NEW; END $$");
  await f.db.exec('CREATE TRIGGER mn_test_abort_ground_intent_finalize BEFORE UPDATE ON public.mn_ground_transaction_intents FOR EACH ROW EXECUTE FUNCTION public.mn_test_abort_ground_intent_finalize()');
  await f.db.exec('SET ROLE service_role');
  const failed = await f.journalClient.rpc('mn_commit_ground_transaction', {
    p_operation_id: raw.operationId, p_request: raw.request,
  });
  assert.ok(failed.error);
  await f.db.exec('RESET ROLE');
  await f.db.exec('DROP TRIGGER mn_test_abort_ground_intent_finalize ON public.mn_ground_transaction_intents; DROP FUNCTION public.mn_test_abort_ground_intent_finalize()');
  await f.db.exec('SET ROLE service_role');
  assert.equal((await load(f, raw.operationId)).state, 'pending');
  assert.equal((await f.db.query('select version from public.mn_worlds where world=$1', [WORLD])).rows[0].version, 1);
  assert.equal(await f.store.loadGroundTransaction(raw.operationId), null);
  assert.equal(await f.store.loadGroundClockOperation(id(3)), null);
  const retry = await commit(f, raw);
  assert.equal(retry.ok, true);
  assert.equal((await load(f, raw.operationId)).state, 'committed');
});

test('SQL019 immutable identities, terminal results, namespace reservation, and world-scoped pending limit', async t => {
  const f = await fixture(t);
  const raw = rawIntent();
  await prepare(f, raw);
  await assert.rejects(prepare(f, { ...raw, request: { ...raw.request, expectedWorldVersion: 2 } }), { code: 'MNP02' });
  await assert.rejects(prepare(f, { ...raw, operationId: id(9) }), error => error.code === 'MNP02' || error.code === '23505');

  const otherWorld = 'journal-world-two';
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [otherWorld, worldData()]);
  await f.store.commitGroundClock({ operationId: id(30), world: otherWorld, expectedVersion: 0, expectedTick: 0, tick: 100 });
  const cross = rawIntent({ operationId: id(31), clockId: id(3), world: otherWorld });
  await assert.rejects(prepare(f, cross), error => error.code === 'MNP02' || error.code === '23505',
    'a clock UUID reserved by another world cannot be reused');
  const independent = rawIntent({ operationId: id(32), clockId: id(33), world: otherWorld });
  await prepare(f, independent);
  await assert.rejects(prepare(f, rawIntent({ operationId: id(34), clockId: id(35) })),
    error => error.code === '23505' || error.code === 'MNP02');

  await f.db.exec('RESET ROLE; SET ROLE service_role');
  await assert.rejects(f.db.query("update public.mn_ground_transaction_intents set state='committed',result='{}' where operation_id=$1::uuid", [independent.operationId]),
    { code: '42501' });
  await assert.rejects(f.db.query('delete from public.mn_ground_transaction_intents where operation_id=$1::uuid', [independent.operationId]),
    { code: '42501' });
  await f.db.exec('SET ROLE service_role');
  await assert.rejects(f.db.query("update public.mn_ground_transaction_intents set state='committed',result='{}' where operation_id=$1::uuid", [independent.operationId]), { code: '42501' });
  await assert.rejects(f.db.query('delete from public.mn_ground_transaction_intents where operation_id=$1::uuid', [independent.operationId]), { code: '42501' });
  await f.db.exec('RESET ROLE');
  await assert.rejects(f.db.query("update public.mn_ground_transaction_intents set state='committed',result='{}' where operation_id=$1::uuid", [independent.operationId]), { code: 'MNP02' });
  await assert.rejects(f.db.query('delete from public.mn_ground_transaction_intents where operation_id=$1::uuid', [independent.operationId]), { code: 'MNP02' });
});

test('SQL019 reapply is safe and all intent RPCs and tables remain service-only', async t => {
  const f = await fixture(t);
  const raw = rawIntent();
  await prepare(f, raw);
  await f.db.exec('RESET ROLE');
  await f.db.exec(groundTransactionJournalSql);
  await f.db.exec('SET ROLE service_role');
  assert.deepEqual(await load(f, raw.operationId), { operationId: raw.operationId,
    request: raw.request, state: 'pending', result: null });
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(f.db.query('select public.mn_ground_transaction_journal_ready()'), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_prepare_ground_transaction_intent($1::uuid,$2::jsonb)', [id(80), raw.request]), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_load_ground_transaction_intent($1::uuid)', [raw.operationId]), { code: '42501' });
    await assert.rejects(f.db.query('select public.mn_list_ground_transaction_intents($1,null,64)', [WORLD]), { code: '42501' });
    await assert.rejects(f.db.query('select * from public.mn_ground_transaction_intents'), { code: '42501' });
  }
  await f.db.exec('RESET ROLE; SET ROLE service_role');
  await assert.rejects(f.db.query("insert into public.mn_ground_transaction_intents(operation_id,world,request,state) values($1,$2,$3,'pending')",
    [id(81), WORLD, raw.request]), { code: '42501' });
  await assert.rejects(f.db.query('select public.mn_commit_ground_transaction_base($1::uuid,$2::jsonb)',
    [id(82), raw.request]), { code: '42501' }, 'the renamed SQL018 base is internal to the wrapper');
  await assert.rejects(f.db.query('update public.mn_ground_transaction_intents set request=$2 where operation_id=$1::uuid',
    [raw.operationId, raw.request]), { code: '42501' });
  await assert.rejects(f.db.query('delete from public.mn_ground_transaction_intents where operation_id=$1::uuid',
    [raw.operationId]), { code: '42501' });
});

test('SQL019 permits sequential same-tick intents to reuse the current clock receipt', async t => {
  const f = await fixture(t);
  const first = rawIntent({ operationId: id(50), clockId: id(1), expectedWorldVersion: 1,
    expectedClockVersion: 1, expectedTick: 100, tick: 100 });
  await prepare(f, first);
  assert.equal((await commit(f, first)).ok, true);
  const second = rawIntent({ operationId: id(51), clockId: id(1), expectedWorldVersion: 2,
    expectedClockVersion: 1, expectedTick: 100, tick: 100 });
  assert.equal((await prepare(f, second)).state, 'pending');
  assert.equal((await commit(f, second)).ok, true);
  assert.equal((await f.store.loadGroundClock(WORLD)).version, 1,
    'same-tick transactions reuse the existing clock generation');
  assert.equal((await f.db.query('select version from public.mn_worlds where world=$1', [WORLD])).rows[0].version, 3);
});

test('SQL019 allows the current receipt from a prior advancing intent as the next same-tick clock', async t => {
  const f = await fixture(t);
  const advancing = rawIntent({ operationId: id(60), clockId: id(61), expectedWorldVersion: 1,
    expectedClockVersion: 1, expectedTick: 100, tick: 110 });
  await prepare(f, advancing);
  assert.equal((await commit(f, advancing)).ok, true);
  const sameTick = rawIntent({ operationId: id(62), clockId: id(61), expectedWorldVersion: 2,
    expectedClockVersion: 2, expectedTick: 110, tick: 110 });
  assert.equal((await prepare(f, sameTick)).state, 'pending');
  assert.equal((await commit(f, sameTick)).ok, true);
  assert.equal((await f.store.loadGroundClock(WORLD)).tick, 110);
  assert.equal((await f.store.loadGroundClock(WORLD)).version, 2);
});

test('SQL019 retains SQL018 legacy collision guards for old transaction and clock identities', async t => {
  const f = await fixture(t);
  const legacy = rawIntent({ operationId: id(70), clockId: id(71), expectedWorldVersion: 1,
    expectedClockVersion: 1, expectedTick: 100, tick: 110 });
  assert.equal((await f.store.commitGroundTransaction(legacy)).ok, true);
  const reusedAsClock = await f.store.commitGroundClock({ operationId: legacy.operationId, world: WORLD,
    expectedVersion: 2, expectedTick: 110, tick: 120 });
  assert.equal(reusedAsClock.ok, false, 'a no-intent SQL018 transaction UUID cannot become a legacy clock receipt');
  assert.equal(reusedAsClock.why, 'operation');

  const seededClock = rawIntent({ operationId: id(72), clockId: id(73), expectedWorldVersion: 2,
    expectedClockVersion: 2, expectedTick: 110, tick: 120 });
  await prepare(f, seededClock);
  const reverse = rawIntent({ operationId: id(73), clockId: id(74), expectedWorldVersion: 2,
    expectedClockVersion: 2, expectedTick: 110, tick: 120 });
  await assert.rejects(prepare(f, reverse), error => error.code === 'MNP02' || error.code === '23505',
    'an intent outer UUID cannot reuse another intent clock UUID');
});

test('SQL019 recovers an exact pending envelope before session world load, then accepts same-tick begin after lost reply', async t => {
  const f = await fixture(t);
  const journal = createSupabaseGroundTransactionJournal(f.journalClient, WORLD);
  assert.deepEqual(await journal.check(), { version: 1 });
  const pending = rawIntent({ operationId: id(90), clockId: id(91), expectedWorldVersion: 1,
    expectedClockVersion: 1, expectedTick: 100, tick: 110 });
  assert.equal((await journal.prepare(pending)).state, 'pending');

  const session = new GroundTransactionSession({ store: f.store, worldId: WORLD, journal });
  assert.deepEqual(await session.load(100), { state: 'prepared' });
  assert.deepEqual(session.drain(100), { state: 'ready', clock: {
    world: WORLD, tick: 110, version: 2, operationId: id(91),
  } });
  assert.deepEqual(session.recovery, { committed: 1, conflicts: 0, rejected: 0 });
  assert.equal(session.worldVersion, 2);
  assert.equal(session.worldData.resources.tick, 110);
  assert.equal((await journal.load(pending.operationId)).state, 'committed');

  const beginSameTick = operationId => session.begin({ operationId, clockOperationId: id(91),
    family: 'checkpoint', operation: {}, worldData: worldData(110), localTick: 100 });
  f.loseNextReply();
  const afterLostReply = await beginSameTick(id(92));
  assert.equal(afterLostReply.state, 'prepared');
  assert.equal(afterLostReply.result.ok, true);
  assert.equal((await journal.load(id(92))).state, 'committed');
  assert.deepEqual(session.drain(100), { state: 'ready', clock: {
    world: WORLD, tick: 110, version: 2, operationId: id(91),
  } });

  const secondSameTick = await beginSameTick(id(93));
  assert.equal(secondSameTick.state, 'prepared');
  assert.equal(secondSameTick.result.ok, true);
  assert.deepEqual(session.drain(100), { state: 'ready', clock: {
    world: WORLD, tick: 110, version: 2, operationId: id(91),
  } });
  assert.equal(session.worldVersion, 4);
  assert.deepEqual(await journal.list(), []);
});

test('SQL019 preserves standalone legacy pearl writes and blocks both UUIDs reserved by a pending intent', async t => {
  const f = await fixture(t);
  const legacy = { operationId: id(100), uid: 'journal-legacy-before-intent', kind: 'brasa', from: null, to: null,
    expectedVersion: 0, world: WORLD, ground: { x: 1, z: 2, availableAt: 100, returnAt: 180 }, profiles: [] };
  assert.equal((await f.store.commitPearlGround(legacy)).ok, true,
    'ordinary SECURITY INVOKER legacy inserts continue before any UUID is reserved');
  const raw = rawIntent({ operationId: id(101), clockId: id(102) });
  await prepare(f, raw);
  const beforeProfile = await f.store.loadProfile(id(103));
  for (const [operationId, uid] of [[raw.operationId, 'journal-legacy-use-outer'],
    [raw.request.clock.operationId, 'journal-legacy-use-clock']]) {
    const attempt = { operationId, uid, kind: 'brasa', from: null, to: null, expectedVersion: 0, world: WORLD,
      ground: { x: 5, z: 6, availableAt: 100, returnAt: 180 }, profiles: [] };
    assert.deepEqual(await f.store.commitPearlGround(attempt), { ok: false, why: 'operation' });
    assert.equal(await f.store.loadUnique(uid), null);
    assert.equal(await f.store.loadPearlLocation(uid), null);
    assert.equal(await f.store.loadPearlGroundOperation(operationId), null);
  }
  assert.deepEqual(await f.store.loadProfile(id(103)), beforeProfile);
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_pearl_ground_operations where operation_id in ($1::uuid,$2::uuid)',
    [raw.operationId, raw.request.clock.operationId])).rows[0].n, 0);
  assert.equal((await f.store.loadPearlLocation(legacy.uid)).world, WORLD,
    'the preexisting unrelated legacy write remains intact');
  assert.equal((await load(f, raw.operationId)).state, 'pending');
});

test('SQL019 admits exact nested pearl mint and pickup receipts and commits each final journal row atomically', async t => {
  const f = await fixture(t);
  const account = id(110), profile = newProfile(); profile.pirateId = `account:${account}`;
  assert.equal((await f.store.saveProfile(account, profile, 0)).ok, true);
  const journal = createSupabaseGroundTransactionJournal(f.journalClient, WORLD);
  const session = new GroundTransactionSession({ store: f.store, worldId: WORLD, journal });
  assert.deepEqual(await session.load(100), { state: 'prepared' });
  assert.equal(session.drain(100).state, 'ready');

  const uid = 'journal-nested-pearl';
  const mint = groundOperation({ operationId: id(111), uid, kind: 'brasa', from: null, to: null,
    expectedVersion: 0, world: WORLD, ground: { x: 2, z: 3, availableAt: 100, returnAt: 220 }, profiles: [] }).request;
  const minted = await session.begin({ operationId: id(111), clockOperationId: id(1), family: 'ground',
    operation: mint, worldData: worldData(100), localTick: 100 });
  assert.equal(minted.result.ok, true);
  assert.equal(minted.result.effect.location.uid, uid);
  assert.equal((await load(f, id(111))).state, 'committed');
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_pearl_ground_operations where operation_id=$1::uuid',
    [id(111)])).rows[0].n, 1);
  assert.equal(session.drain(100, () => true).state, 'ready');

  const currentProfile = await f.store.loadProfile(account), pickedProfile = structuredClone(currentProfile.data);
  pickedProfile.pearls.bag.push({ uid, kind: 'brasa' });
  const pickup = groundOperation({ operationId: id(112), uid, kind: 'brasa', from: null, to: account,
    expectedVersion: 1, world: WORLD, ground: null,
    profiles: [{ id: account, expectedVersion: currentProfile.version, data: pickedProfile }] }).request;
  const picked = await session.begin({ operationId: id(112), clockOperationId: id(1), family: 'ground',
    operation: pickup, worldData: worldData(100), localTick: 100 });
  assert.equal(picked.result.ok, true);
  assert.equal(picked.result.effect.unique.holder, account);
  assert.equal((await load(f, id(112))).state, 'committed');
  assert.equal(session.drain(100, () => true).state, 'ready');

  assert.equal((await f.store.loadProfile(account)).version, currentProfile.version + 1);
  assert.deepEqual((await f.store.loadProfile(account)).data.pearls.bag, [{ uid, kind: 'brasa' }]);
  assert.equal((await f.store.loadUnique(uid)).holder, account);
  assert.equal((await f.store.loadPearlLocation(uid)).ground, null);
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_pearl_ground_operations where operation_id in ($1::uuid,$2::uuid)',
    [id(111), id(112)])).rows[0].n, 2);
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_pearl_operations where operation_id=$1::uuid',
    [id(112)])).rows[0].n, 1, 'the exact nested pickup receipt is committed beside the outer transaction');
  assert.deepEqual(await journal.list(), []);
});
