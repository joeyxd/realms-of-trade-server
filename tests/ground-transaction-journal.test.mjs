import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/sim/economy/economy.js';
import { GroundTransactionSession } from '../server/groundTransactionSession.mjs';
import { groundClockOperation, groundClockResult } from '../server/groundClockOperation.mjs';
import { StoreError } from '../server/store.mjs';
import { createSupabaseGroundTransactionJournal, checkedGroundTransactionIntent,
  recoverGroundTransactionIntents } from '../server/groundTransactionJournal.mjs';

const WORLD = 'journal-session';
const id = n => `c0190000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const copy = structuredClone;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const data = tick => ({ v: 1, seed: 91, economy: new Economy(91).serialize(), resources: {
  v: 1, tick, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 800 }], cooldowns: {},
} });
const raw = () => ({ operationId: id(10), request: { world: WORLD, expectedWorldVersion: 1,
  worldData: data(510), family: 'checkpoint', operation: {}, clock: {
    operationId: id(11), expectedVersion: 1, expectedTick: 500, tick: 510,
  } } });
const row = () => ({ ...raw(), state: 'pending', result: null });

function fixture() {
  const clockOp = groundClockOperation({ operationId: id(1), world: WORLD, expectedVersion: 0, expectedTick: 0, tick: 500 });
  let clock = groundClockResult(clockOp.request, id(1)).clock;
  let world = { data: data(500), version: 1 };
  const intents = new Map(), receipts = new Map(), clocks = new Map([[id(1), { request: clockOp.request,
    result: groundClockResult(clockOp.request, id(1)) }]]), calls = [];
  const f = {
    intents, receipts, calls, prepareGate: null, prepareEntered: null, commitGate: null, commitEntered: null,
    losePrepareReply: false, loseCommitReply: false, prepareDown: false, commitDown: false, malformedFinal: false,
    journalLoadDown: false, forcedFailure: null,
    async checkGroundTransactions() { return { version: 1 }; },
    async loadGroundClock() { calls.push('clock-read'); return copy(clock); },
    async loadGroundClockOperation(key) { return copy(clocks.get(key) ?? null); },
    async commitGroundClock() { throw new Error('independent clock writes are forbidden'); },
    async loadWorld() { calls.push('world-read'); return copy(world); },
    async loadGroundTransaction(key) { return copy(receipts.get(key) ?? null); },
    async commitGroundTransaction(input) {
      calls.push('commit');
      if (f.commitGate) { f.commitEntered?.resolve(); await f.commitGate.promise; }
      if (f.commitDown) throw new StoreError('unavailable');
      const pending = intents.get(input.operationId);
      assert.ok(pending, 'the exact durable intent must exist before dispatch');
      assert.deepEqual(pending.request, input.request);
      if (pending.state !== 'pending') return pending.result.ok ? { ...copy(pending.result), replay: true } : copy(pending.result);
      if (f.forcedFailure) {
        const result = { ok: false, why: f.forcedFailure };
        intents.set(input.operationId, { ...copy(input), state: result.why === 'conflict' ? 'conflict' : 'rejected', result });
        return copy(result);
      }
      const { request: q } = input;
      const result = { ok: true, replay: false, worldVersion: q.expectedWorldVersion + 1,
        clock: { world: WORLD, tick: q.clock.tick, version: q.clock.expectedVersion + Number(q.clock.tick > q.clock.expectedTick),
          operationId: q.clock.operationId }, effect: { ok: true, replay: false } };
      world = { data: copy(q.worldData), version: result.worldVersion }; clock = copy(result.clock);
      if (q.clock.tick > q.clock.expectedTick) clocks.set(q.clock.operationId, { request: {
        world: WORLD, expectedVersion: q.clock.expectedVersion, expectedTick: q.clock.expectedTick, tick: q.clock.tick,
      }, result: { ok: true, replay: false, clock: copy(clock) } });
      receipts.set(input.operationId, { request: copy(q), result: copy(result) });
      intents.set(input.operationId, { ...copy(input), state: 'committed', result: copy(result) });
      if (f.loseCommitReply) { f.loseCommitReply = false; throw new StoreError('unavailable'); }
      return result;
    },
  };
  f.journal = {
    scope: WORLD, durable: true,
    async check() { return { version: 1 }; },
    async prepare(input) {
      calls.push('prepare');
      if (f.prepareGate) { f.prepareEntered?.resolve(); await f.prepareGate.promise; }
      if (f.prepareDown) throw new StoreError('unavailable');
      if (!intents.has(input.operationId)) intents.set(input.operationId, { ...copy(input), state: 'pending', result: null });
      if (f.losePrepareReply) { f.losePrepareReply = false; throw new StoreError('unavailable'); }
      return copy(intents.get(input.operationId));
    },
    async load(key) {
      if (f.journalLoadDown) throw new StoreError('unavailable');
      const value = copy(intents.get(key) ?? null);
      if (value && f.malformedFinal && value.state === 'committed') value.result.worldVersion++;
      return value;
    },
    async list({ limit = 64 } = {}) { return [...intents.values()].filter(x => x.state === 'pending').slice(0, limit).map(x => copy(x)); },
  };
  return f;
}
async function ready(f = fixture()) {
  const session = new GroundTransactionSession({ store: f, worldId: WORLD, journal: f.journal });
  await session.load(0); assert.equal(session.recovery, null); session.drain(0);
  return { f, session };
}
function begin(session) {
  return session.begin({ operationId: id(10), clockOperationId: id(11), family: 'checkpoint', operation: {},
    worldData: data(510), localTick: 10 });
}

test('journal DTO rejects unknown fields, getters, interim states and mismatched terminal results', () => {
  assert.deepEqual(checkedGroundTransactionIntent(row(), WORLD), row());
  const mutations = [x => { x.extra = 1; }, x => { x.state = 'committing'; }, x => { x.result = {}; },
    x => { x.state = 'conflict'; x.result = { ok: false, why: 'operation' }; }, x => { x.request.world = 'wrong'; }];
  for (const mutate of mutations) { const x = row(); mutate(x); assert.throws(() => checkedGroundTransactionIntent(x, WORLD), { code: 'response' }); }
  let ran = false; const x = row(); Object.defineProperty(x, 'state', { get() { ran = true; return 'pending'; } });
  assert.throws(() => checkedGroundTransactionIntent(x, WORLD), { code: 'response' }); assert.equal(ran, false);
});

test('Supabase adapter validates exact identity, scoped ordered pages and scrubs provider errors', async () => {
  let reply = row(); const calls = [];
  const journal = createSupabaseGroundTransactionJournal({ async rpc(name, args) { calls.push({ name, args }); return { data: reply }; } }, WORLD);
  assert.deepEqual(await journal.prepare(raw()), row()); assert.equal(calls[0].name, 'mn_prepare_ground_transaction_intent');
  reply = [row(), row()]; await assert.rejects(journal.list(), { code: 'response' });
  reply = { version: 1, extra: true }; await assert.rejects(journal.check(), { code: 'response' });
  await assert.rejects(journal.prepare({ ...raw(), request: { ...raw().request, world: 'wrong' } }), { code: 'operation' });
  const down = createSupabaseGroundTransactionJournal({ async rpc() { throw new Error('provider credential detail'); } }, WORLD);
  await assert.rejects(down.load(id(10)), e => e.code === 'unavailable' && !e.message.includes('credential'));
});

test('begin persists intent before dispatch and adopts committed metadata only at the captured drain', async () => {
  const { f, session } = await ready();
  f.prepareGate = deferred(); f.prepareEntered = deferred();
  const pending = begin(session); await f.prepareEntered.promise;
  assert.equal(f.calls.includes('commit'), false); assert.equal(session.worldVersion, 1);
  f.prepareGate.resolve(); await pending;
  assert.equal(f.intents.get(id(10)).state, 'committed');
  assert.equal(session.worldVersion, 1); assert.equal(session.clock.tick, 500);
  assert.equal(session.drain(10).state, 'ready'); assert.equal(session.worldVersion, 2); assert.equal(session.clock.tick, 510);
});

test('lost prepare and commit replies recover exact identity with one gameplay commit', async () => {
  const { f, session } = await ready(); f.losePrepareReply = true; f.loseCommitReply = true;
  await begin(session); assert.equal(f.calls.filter(x => x === 'commit').length, 1);
  assert.equal(f.calls.filter(x => x === 'prepare').length, 1); assert.equal(session.drain(10).state, 'ready');
});

test('unavailable preparation never dispatches gameplay and reconcile retains the original request', async () => {
  const { f, session } = await ready(); f.prepareDown = true;
  await assert.rejects(begin(session), { code: 'unavailable' }); assert.equal(session.state, 'unresolved');
  assert.equal(f.calls.includes('commit'), false);
  f.prepareDown = false; await session.reconcile();
  assert.deepEqual(f.intents.get(id(10)).request, raw().request); assert.equal(session.drain(10).state, 'ready');
});

test('cancel during preparation prevents dispatch, retains recovery evidence and settle waits for I/O', async () => {
  const { f, session } = await ready(); f.prepareGate = deferred(); f.prepareEntered = deferred();
  const pending = begin(session); await f.prepareEntered.promise;
  let settled = false; const settling = session.settle().then(() => { settled = true; });
  session.cancel(); await Promise.resolve(); assert.equal(settled, false);
  f.prepareGate.resolve(); await assert.rejects(pending, { code: 'cancelled' }); await settling;
  assert.equal(f.calls.includes('commit'), false); assert.equal(f.intents.get(id(10)).state, 'pending'); assert.equal(session.state, 'fenced');
});

test('startup resolves pre-commit intent then loads current rows without applying historical effects', async () => {
  const f = fixture(); await f.journal.prepare(raw());
  const session = new GroundTransactionSession({ store: f, worldId: WORLD, journal: f.journal });
  await session.load(0); assert.equal(session.worldVersion, null); assert.equal(session.recovery, null);
  assert.equal(f.calls.filter(x => x === 'commit').length, 1);
  assert.ok(f.calls.indexOf('commit') < f.calls.indexOf('world-read'));
  session.drain(0); assert.equal(session.worldVersion, 2); assert.equal(session.clock.tick, 510);
  assert.deepEqual(session.recovery, { committed: 1, conflicts: 0, rejected: 0 });
  assert.equal(session.logicalTick(0), 510); assert.equal(session.logicalTick(30), 540);
});

test('startup after committed intent loads current rows and never resends the historical transaction', async () => {
  const f = fixture(); await f.journal.prepare(raw()); await f.commitGroundTransaction(raw()); f.calls.length = 0;
  const { session } = await ready(f);
  assert.equal(f.calls.includes('commit'), false); assert.equal(session.worldVersion, 2);
  assert.deepEqual(session.recovery, { committed: 0, conflicts: 0, rejected: 0 });
});

test('unknown recovery holds startup closed; cancelling its in-flight commit cannot adopt late state', async () => {
  const f = fixture(); await f.journal.prepare(raw()); f.commitDown = true;
  await assert.rejects(recoverGroundTransactionIntents({ store: f, journal: f.journal, worldId: WORLD }), { code: 'unavailable' });
  assert.equal(f.intents.get(id(10)).state, 'pending');
  f.commitDown = false; f.commitGate = deferred(); f.commitEntered = deferred();
  const session = new GroundTransactionSession({ store: f, worldId: WORLD, journal: f.journal });
  const loading = session.load(0); await f.commitEntered.promise; session.cancel(); f.commitGate.resolve();
  await assert.rejects(loading, { code: 'cancelled' }); await session.settle();
  assert.equal(session.worldData, null); assert.equal(session.state, 'fenced'); assert.equal(f.intents.get(id(10)).state, 'committed');
});

test('an incompatible final journal result cannot reach the synchronous apply boundary', async () => {
  const { f, session } = await ready(); f.malformedFinal = true;
  await assert.rejects(begin(session), { code: 'response' });
  assert.notEqual(session.state, 'prepared'); assert.equal(session.worldVersion, 1);
});

test('reconcile retains unresolved state if verifying a committed receipt loses the journal reply', async () => {
  const { f, session } = await ready(); f.journalLoadDown = true;
  await assert.rejects(begin(session), { code: 'unavailable' }); assert.equal(session.state, 'unresolved');
  assert.equal(f.intents.get(id(10)).state, 'committed');
  await assert.rejects(session.reconcile(), { code: 'unavailable' }); assert.equal(session.state, 'unresolved');
  f.journalLoadDown = false; await session.reconcile(); assert.equal(session.drain(10).state, 'ready');
  assert.equal(f.intents.size, 1); assert.equal(session.worldVersion, 2);
});

test('startup records terminal conflicts without effects and reloads current rows; live conflicts fence', async () => {
  const f = fixture(); await f.journal.prepare(raw()); f.forcedFailure = 'conflict';
  const { session } = await ready(f);
  assert.deepEqual(session.recovery, { committed: 0, conflicts: 1, rejected: 0 });
  assert.equal(session.worldVersion, 1); assert.equal(session.clock.tick, 500); assert.equal(f.receipts.size, 0);
  const second = fixture(), live = (await ready(second)).session; second.forcedFailure = 'conflict';
  await assert.rejects(begin(live), { code: 'conflict' }); assert.equal(live.state, 'fenced');
  assert.equal(second.intents.get(id(10)).state, 'conflict'); assert.equal(second.receipts.size, 0);
});
