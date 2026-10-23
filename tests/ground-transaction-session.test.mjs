import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/sim/economy/economy.js';
import { groundClockOperation, groundClockResult } from '../server/groundClockOperation.mjs';
import { groundResult } from '../server/pearlGround.mjs';
import { GroundTransactionSession } from '../server/groundTransactionSession.mjs';
import { StoreError } from '../server/store.mjs';

const WORLD = 'world:transaction-session';
const id = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const worldData = tick => ({ v: 1, seed: 91, economy: new Economy(91).serialize(),
  resources: { v: 1, tick, nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} } });
const pearlRequest = (tick = 0) => ({ uid: 'session-ground-pearl', kind: 'brasa', from: null, to: null,
  expectedVersion: 0, profiles: [], world: WORLD,
  ground: { x: 4, z: 8, availableAt: tick, returnAt: tick + 100 } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const copy = value => structuredClone(value);

function fixture({ missingClock = false, unstableWorld = false } = {}) {
  const initialClockId = id(2);
  const clockRaw = groundClockOperation({ operationId: initialClockId, world: WORLD,
    expectedVersion: 0, expectedTick: 0, tick: 0 });
  let clock = missingClock ? null : { world: WORLD, tick: 0, version: 1, operationId: initialClockId };
  const clockReceipts = new Map();
  if (clock) clockReceipts.set(initialClockId, { request: clockRaw.request,
    result: groundClockResult(clockRaw.request, initialClockId) });
  let worldRow = { data: worldData(0), version: 1 }, readCount = 0;
  const transactionReceipts = new Map(), calls = [];
  const f = {
    calls, transactionReceipts, clockReceipts,
    commitGate: null, gateEntered: null, loadGate: null, loadEntered: null,
    throwAfterCommit: false, throwBeforeCommit: false, returnConflict: false, receiptError: null,
    async checkGroundTransactions() {
      if (this.loadGate) { this.loadEntered?.resolve(); await this.loadGate.promise; }
      return { version: 1 };
    },
    async loadGroundClock() { return copy(clock); },
    async loadGroundClockOperation(operationId) { return copy(clockReceipts.get(operationId) ?? null); },
    async commitGroundClock() { throw new Error('the session must never checkpoint the clock independently'); },
    async loadWorld() {
      readCount++;
      const row = copy(worldRow);
      if (unstableWorld && readCount === 2) row.data.economy.hours++;
      return row;
    },
    async loadGroundTransaction(operationId) {
      if (this.receiptError) throw this.receiptError;
      return copy(transactionReceipts.get(operationId) ?? null);
    },
    async commitGroundTransaction(raw) {
      calls.push(copy(raw));
      if (this.commitGate) { this.gateEntered?.resolve(); await this.commitGate.promise; }
      if (this.throwBeforeCommit) throw new Error('transport unavailable');
      if (this.returnConflict) return { ok: false, why: 'conflict' };
      const { operationId, request } = copy(raw);
      const effect = request.family === 'checkpoint' ? { ok: true, replay: false } : groundResult(request.operation);
      const result = { ok: true, replay: false, worldVersion: request.expectedWorldVersion + 1,
        clock: { world: request.world, tick: request.clock.tick,
          version: request.clock.expectedVersion + Number(request.clock.tick > request.clock.expectedTick),
          operationId: request.clock.operationId }, effect };
      worldRow = { data: copy(request.worldData), version: result.worldVersion };
      clock = copy(result.clock);
      transactionReceipts.set(operationId, { request: copy(request), result: copy(result) });
      if (this.throwAfterCommit) { this.throwAfterCommit = false; throw new Error('reply lost after commit'); }
      return copy(result);
    },
  };
  return f;
}
async function ready(f = fixture(), localTick = 100) {
  const session = new GroundTransactionSession({ store: f, worldId: WORLD });
  assert.deepEqual(await session.load(localTick), { state: 'prepared' });
  assert.equal(session.state, 'prepared');
  assert.equal(session.drain(localTick).state, 'ready');
  return { f, session, localTick };
}
function pearlBegin(session, localTick = 100, changes = {}) {
  return session.begin({ operationId: id(10), clockOperationId: id(2), family: 'ground',
    operation: pearlRequest(0), worldData: worldData(0), localTick, ...changes });
}

test('load prepares a stable existing world and adopts its verified clock only at drain', async () => {
  const f = fixture(), session = new GroundTransactionSession({ store: f, worldId: WORLD });
  assert.deepEqual(await session.load(100), { state: 'prepared' });
  assert.equal(session.ready, false);
  assert.equal(session.worldVersion, null);
  assert.throws(() => session.drain(101));
  assert.equal(session.state, 'fenced');
});

test('load rejects unstable worlds and missing durable clocks without adopting defaults', async () => {
  for (const options of [{ unstableWorld: true }, { missingClock: true }]) {
    const f = fixture(options), session = new GroundTransactionSession({ store: f, worldId: WORLD });
    if (options.missingClock) {
      assert.deepEqual(await session.load(100), { state: 'prepared' });
      assert.throws(() => session.drain(100));
      assert.equal(session.worldVersion, null);
      assert.equal(session.worldData, null);
      assert.equal(f.calls.length, 0);
    } else {
      await assert.rejects(session.load(100));
    }
    assert.equal(session.state, 'fenced');
  }
});

test('cancel during load fences late preparation and settle waits for the load I/O', async () => {
  const f = fixture(), session = new GroundTransactionSession({ store: f, worldId: WORLD });
  f.loadGate = deferred(); f.loadEntered = deferred();
  const loading = session.load(100); await f.loadEntered.promise;
  let settled = false;
  const settling = session.settle().then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  session.cancel(); f.loadGate.resolve();
  await assert.rejects(loading, { code: 'cancelled' });
  await settling;
  assert.equal(session.state, 'fenced');
  assert.equal(settled, true);
  assert.equal(session.worldVersion, null);
});

test('durable tick mapping pauses across a large offline gap and advances only with local ticks', async () => {
  const { session } = await ready();
  assert.equal(session.logicalTick(100), 0);
  assert.equal(session.logicalTick(100 + 0x100000000), 0x100000000);
  assert.throws(() => session.logicalTick(99));
});

test('checkpoint can advance a safe integer tick above 32 bits and updates clock only at drain', async () => {
  const { session, localTick } = await ready();
  const nextLocal = localTick + 0x100000000, durable = session.logicalTick(nextLocal);
  const prepared = await session.begin({ operationId: id(20), clockOperationId: id(21), family: 'checkpoint',
    operation: {}, worldData: worldData(durable), localTick: nextLocal });
  assert.equal(prepared.state, 'prepared');
  assert.equal(session.clock.tick, 0);
  assert.equal(session.drain(nextLocal).state, 'ready');
  assert.equal(session.clock.tick, 0x100000000);
  assert.equal(session.clock.version, 2);
});

test('one owner is retained for a store and world for the entire session lifetime', async () => {
  const f = fixture(), first = new GroundTransactionSession({ store: f, worldId: WORLD });
  assert.throws(() => new GroundTransactionSession({ store: f, worldId: WORLD }));
  first.cancel();
  assert.throws(() => new GroundTransactionSession({ store: f, worldId: WORLD }));
  new GroundTransactionSession({ store: f, worldId: 'world:another' });
});

test('operation input is captured, no gameplay apply occurs before synchronous drain, and same-tick ID is retained', async () => {
  const { f, session, localTick } = await ready();
  const gate = deferred(); f.commitGate = gate;
  const operation = pearlRequest(0), data = worldData(0);
  const pending = session.begin({ operationId: id(10), clockOperationId: id(2), family: 'ground', operation,
    worldData: data, localTick });
  operation.uid = 'mutated-after-begin'; data.seed = 777;
  assert.equal(session.state, 'pending');
  assert.equal(f.calls[0].request.operation.uid, 'session-ground-pearl');
  assert.equal(f.calls[0].request.worldData.seed, 91);
  assert.equal(session.drain(localTick, () => true).state, 'pending');
  gate.resolve(); await pending;
  assert.equal(session.state, 'prepared');
  let applies = 0;
  assert.equal(session.drain(localTick, (result, request) => {
    applies++; assert.equal(result.effect.location.uid, 'session-ground-pearl'); assert.equal(request.world, WORLD); return true;
  }).state, 'ready');
  assert.equal(applies, 1);
  assert.equal(session.drain(localTick, () => { applies++; return true; }).state, 'ready');
  assert.equal(applies, 1);
});

test('same durable tick requires the current clock operation UUID', async () => {
  const { session, localTick } = await ready();
  assert.throws(() => session.begin({ operationId: id(11), clockOperationId: id(99), family: 'ground',
    operation: pearlRequest(0), worldData: worldData(0), localTick }));
  assert.equal(session.state, 'ready');
});

test('begin snapshots the exact top-level input without invoking getters or accepting extras', async () => {
  const { f, session, localTick } = await ready();
  let callbacks = 0;
  const getter = { clockOperationId: id(2), family: 'ground', localTick, operation: pearlRequest(0),
    operationId: id(11), worldData: worldData(0) };
  Object.defineProperty(getter, 'operationId', { enumerable: true, get() { callbacks++; return id(11); } });
  assert.throws(() => session.begin(getter));
  assert.equal(callbacks, 0);
  assert.equal(f.calls.length, 0);
  assert.throws(() => session.begin({ clockOperationId: id(2), family: 'ground', localTick,
    operation: pearlRequest(0), operationId: id(11), worldData: worldData(0), ignored: true }));
  assert.equal(f.calls.length, 0);
  assert.equal(session.state, 'ready');
});

test('lost response recovers from an exact receipt and never repeats the commit', async () => {
  const { f, session, localTick } = await ready(); f.throwAfterCommit = true;
  const result = await pearlBegin(session, localTick);
  assert.equal(result.state, 'prepared');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].request, f.transactionReceipts.get(id(10)).request);
  assert.equal(session.drain(localTick, () => true).state, 'ready');
});

test('unknown outcome remains unresolved and reconcile resends the same request ID and payload', async () => {
  const { f, session, localTick } = await ready(); f.throwBeforeCommit = true;
  await assert.rejects(pearlBegin(session, localTick));
  assert.equal(session.state, 'unresolved');
  const captured = copy(f.calls[0]); f.throwBeforeCommit = false;
  assert.equal((await session.reconcile()).state, 'prepared');
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls[2], captured);
});

test('reconcile keeps unknown retry failures unresolved and fences a definite conflict', async () => {
  const first = await ready(); first.f.throwBeforeCommit = true;
  await assert.rejects(pearlBegin(first.session, first.localTick));
  await assert.rejects(first.session.reconcile(), { code: 'unavailable' });
  assert.equal(first.session.state, 'unresolved', 'retry transport failure must not be mistaken for cancellation');

  const second = await ready(); second.f.throwBeforeCommit = true;
  await assert.rejects(pearlBegin(second.session, second.localTick));
  second.f.throwBeforeCommit = false; second.f.returnConflict = true;
  await assert.rejects(second.session.reconcile(), { code: 'conflict' });
  assert.equal(second.session.state, 'fenced');
});

test('reconcile fences a malformed receipt and cancel keeps settle waiting for in-flight reconciliation', async () => {
  const invalid = await ready(); invalid.f.throwBeforeCommit = true;
  await assert.rejects(pearlBegin(invalid.session, invalid.localTick));
  invalid.f.receiptError = new StoreError('response');
  await assert.rejects(invalid.session.reconcile(), { code: 'response' });
  assert.equal(invalid.session.state, 'fenced');

  const { f, session, localTick } = await ready(); f.throwBeforeCommit = true;
  await assert.rejects(pearlBegin(session, localTick));
  f.throwBeforeCommit = false; f.commitGate = deferred(); f.gateEntered = deferred();
  const reconciling = session.reconcile(); await f.gateEntered.promise;
  session.cancel();
  let settled = false;
  const settling = session.settle().then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  f.commitGate.resolve(); await assert.rejects(reconciling);
  await settling;
  assert.equal(settled, true);
  assert.equal(session.state, 'fenced');
});

test('cancel fences late I/O and apply failures fence the session', async () => {
  const { f, session, localTick } = await ready(), gate = deferred(); f.commitGate = gate;
  const pending = pearlBegin(session, localTick);
  session.cancel(); gate.resolve(); await assert.rejects(pending);
  assert.equal(session.state, 'fenced');

  const next = await ready(fixture(), localTick);
  await pearlBegin(next.session, localTick);
  assert.throws(() => next.session.drain(localTick, () => { throw new Error('apply failed'); }));
  assert.equal(next.session.state, 'fenced');
});

test('async apply callback is rejected and fences after exactly one callback invocation', async () => {
  const { session, localTick } = await ready(); await pearlBegin(session, localTick);
  let count = 0;
  assert.throws(() => session.drain(localTick, () => { count++; return Promise.resolve(true); }));
  assert.equal(count, 1);
  assert.equal(session.state, 'fenced');
});
