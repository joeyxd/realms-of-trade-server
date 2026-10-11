import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { GroundClockEpoch, GroundClockSession } from '../server/groundClockSession.mjs';

const WORLD = 'island:clock-session-test';
const op = (n) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const seed = async (store, tick = 40, operation = 1) => {
  const result = await store.commitGroundClock({ operationId: op(operation), world: WORLD,
    expectedVersion: 0, expectedTick: 0, tick });
  assert.equal(result.ok, true);
  return result.clock;
};
const readySession = async (store, durableTick = 40, localTick = 7) => {
  const clock = await seed(store, durableTick);
  const session = new GroundClockSession({ store, worldId: WORLD });
  await session.load(localTick);
  assert.equal(session.drain(localTick).state, 'ready');
  return { session, clock };
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

test('epoch maps coordinates both ways, preserves overdue negative values, and detaches its anchor', () => {
  const epoch = new GroundClockEpoch({ localTick: 10, durableTick: 100 });
  assert.deepEqual(epoch.anchor, { localTick: 10, durableTick: 100 });
  assert.equal(epoch.toDurable(16), 106);
  assert.equal(epoch.toLocal(94), 4);
  assert.equal(epoch.toLocal(90), 0);
  const anchor = epoch.anchor; anchor.localTick = 999;
  assert.equal(epoch.anchor.localTick, 10);
});

test('epoch rejects backwards input, unsafe coordinates, and mapped overflow as operation errors', () => {
  const max = Number.MAX_SAFE_INTEGER;
  for (const make of [
    () => new GroundClockEpoch({ localTick: -1, durableTick: 0 }),
    () => new GroundClockEpoch({ localTick: 0, durableTick: max + 1 }),
    () => new GroundClockEpoch({ localTick: 0, durableTick: max }).toDurable(1),
    () => new GroundClockEpoch({ localTick: max, durableTick: 0 }).toLocal(1),
    () => new GroundClockEpoch({ localTick: 0, durableTick: 0 }).toLocal(-1),
  ]) assert.throws(make, { code: 'operation' });
  const epoch = new GroundClockEpoch({ localTick: 3, durableTick: 5 });
  assert.throws(() => epoch.toDurable(2), { code: 'operation' });
});

test('stable explicit absence becomes missing and only then can initialize', async () => {
  const store = createMemoryStore(), session = new GroundClockSession({ store, worldId: WORLD });
  await session.load(5);
  assert.equal(session.state, 'prepared');
  assert.equal(session.drain(5).state, 'missing');
  assert.equal(session.ready, false);
  const initializing = session.initialize({ operationId: op(2), localTick: 5, tick: 12 });
  assert.equal(session.state, 'pending');
  await initializing;
  assert.equal(session.state, 'prepared');
  assert.equal(session.drain(5).state, 'ready');
  assert.equal(session.clock.tick, 12);
  assert.equal(session.logicalTick(8), 15);
});

test('load requires the captured local tick at drain and publishes a stable loaded anchor', async () => {
  const store = createMemoryStore(), clock = await seed(store, 70);
  const session = new GroundClockSession({ store, worldId: WORLD });
  await session.load(20);
  assert.deepEqual(session.clock, null);
  assert.throws(() => session.drain(21), { code: 'conflict' });
  assert.equal(session.state, 'fenced');
  assert.equal(session.epoch, null);
  const second = new GroundClockSession({ store, worldId: WORLD });
  await second.load(20); second.drain(20);
  assert.deepEqual(second.clock, clock);
  assert.deepEqual(second.epoch.anchor, { localTick: 20, durableTick: 70 });
  const exposed = second.clock; exposed.tick = 1000;
  assert.equal(second.clock.tick, 70);
});

test('logical tick maps from the anchor and cannot move backwards', async () => {
  const { session } = await readySession(createMemoryStore(), 90, 15);
  assert.equal(session.logicalTick(15), 90);
  assert.equal(session.logicalTick(18), 93);
  assert.throws(() => session.logicalTick(17), { code: 'operation' });
  assert.throws(() => session.logicalTick(Number.MAX_SAFE_INTEGER), { code: 'operation' });
});

test('unloaded, unresolved, and pending sessions do not expose a logical tick', async () => {
  const store = createMemoryStore(), session = new GroundClockSession({ store, worldId: WORLD });
  assert.throws(() => session.logicalTick(0), { code: 'unavailable' });
  await session.load(0);
  assert.equal(session.drain(0).state, 'missing');
  const init = session.initialize({ operationId: op(3), localTick: 0, tick: 1 });
  assert.throws(() => session.logicalTick(0), { code: 'busy' });
  await init;
  session.drain(0);
  const checkpoint = session.checkpoint({ operationId: op(4), localTick: 2 });
  assert.throws(() => session.logicalTick(2), { code: 'busy' });
  await checkpoint;
  session.drain(2);
  assert.equal(session.logicalTick(2), 3);
});

test('async checkpoint prepares only; the synchronous same-tick drain applies its clock', async () => {
  const { session, clock } = await readySession(createMemoryStore(), 22, 4);
  const pending = session.checkpoint({ operationId: op(5), localTick: 9 });
  await pending;
  assert.deepEqual(session.clock, clock);
  assert.equal(session.drain(9).state, 'ready');
  assert.equal(session.clock.tick, 27);
  assert.equal(session.logicalTick(9), 27);
});

test('checkpoint requires a strictly advancing durable target derived from local time', async () => {
  const { session } = await readySession(createMemoryStore(), 22, 4);
  assert.throws(() => session.checkpoint({ operationId: op(6), localTick: 4 }), { code: 'operation' });
  assert.throws(() => session.checkpoint({ operationId: op(7), localTick: 3 }), { code: 'operation' });
  await session.checkpoint({ operationId: op(8), localTick: 5 });
  assert.equal(session.drain(5).clock.tick, 23);
});

test('load preparation does not publish before drain and rejects local-tick drift', async () => {
  const store = createMemoryStore(); await seed(store, 11);
  const gate = deferred(), loadClock = store.loadGroundClock.bind(store);
  store.loadGroundClock = async (world) => { await gate.promise; return loadClock(world); };
  const session = new GroundClockSession({ store, worldId: WORLD });
  const pending = session.load(2);
  assert.throws(() => session.logicalTick(2), { code: 'busy' });
  gate.resolve(); await pending;
  assert.equal(session.state, 'prepared');
  assert.throws(() => session.drain(3), { code: 'conflict' });
  assert.equal(session.state, 'fenced');
  const second = new GroundClockSession({ store, worldId: WORLD });
  store.loadGroundClock = loadClock;
  await second.load(2);
  assert.equal(second.drain(2).state, 'ready');
});

test('lost commit reply enters unresolved and reconcile reads the receipt without resending', async () => {
  const store = createMemoryStore(), { session } = await readySession(store, 30, 5);
  const commit = store.commitGroundClock.bind(store); let writes = 0;
  store.commitGroundClock = async (request) => { writes++; const reply = await commit(request); if (writes === 1) throw Error('reply dropped'); return reply; };
  await assert.rejects(session.checkpoint({ operationId: op(9), localTick: 8 }));
  assert.equal(session.state, 'unresolved');
  assert.equal(session.clock.tick, 30);
  await session.reconcile();
  assert.equal(writes, 1);
  assert.equal(session.state, 'prepared');
  assert.equal(session.ready, false);
  assert.equal(writes, 1);
  assert.equal(session.drain(8).state, 'ready');
  assert.equal(session.clock.tick, 33);
  assert.equal(writes, 1);
});

test('missing receipt preserves unresolved; resume resends the identical UUID request', async () => {
  const store = createMemoryStore(), { session } = await readySession(store, 8, 1);
  const commit = store.commitGroundClock.bind(store), sent = [];
  store.commitGroundClock = async (request) => { sent.push(structuredClone(request)); if (sent.length === 1) throw Error('before durable write'); return commit(request); };
  await assert.rejects(session.checkpoint({ operationId: op(10), localTick: 4 }));
  await session.reconcile();
  assert.equal(session.state, 'unresolved');
  await session.resume();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(session.drain(4).clock.tick, 11);
});

test('a receipt whose current row moved is fenced instead of installing a stale anchor', async () => {
  const store = createMemoryStore(), { session } = await readySession(store, 10, 0);
  const commit = store.commitGroundClock.bind(store); let dropReply = true;
  store.commitGroundClock = async (request) => { const reply = await commit(request); if (dropReply) { dropReply = false; throw Error('lost'); } return reply; };
  await assert.rejects(session.checkpoint({ operationId: op(11), localTick: 3 }));
  await store.commitGroundClock({ operationId: op(12), world: WORLD, expectedVersion: 2, expectedTick: 13, tick: 14 });
  await assert.rejects(session.reconcile(), { code: 'response' });
  assert.equal(session.state, 'fenced');
  assert.equal(session.ready, false);
});

test('external CAS advance fences a fresh checkpoint attempt', async () => {
  const store = createMemoryStore(), { session } = await readySession(store, 10, 0);
  await store.commitGroundClock({ operationId: op(13), world: WORLD, expectedVersion: 1, expectedTick: 10, tick: 12 });
  await assert.rejects(session.checkpoint({ operationId: op(14), localTick: 2 }), { code: 'conflict' });
  assert.equal(session.state, 'fenced');
});

test('receipt corruption and operation identity mismatch fence the session', async () => {
  for (const mode of ['corrupt', 'mismatch']) {
    const store = createMemoryStore(), { session } = await readySession(store, 4, 0);
    const receipt = store.loadGroundClockOperation.bind(store);
    store.loadGroundClockOperation = async (id) => {
      const row = await receipt(id);
      if (mode === 'corrupt') return {};
      return row ? { ...row, request: { ...row.request, tick: row.request.tick + 1 } } : null;
    };
    const commit = store.commitGroundClock.bind(store);
    store.commitGroundClock = async (request) => { await commit(request); throw Error('lost'); };
    await assert.rejects(session.checkpoint({ operationId: op(mode === 'corrupt' ? 15 : 16), localTick: 2 }));
    await assert.rejects(session.reconcile(), { code: 'response' });
    assert.equal(session.state, 'fenced');
  }
});

test('cancel during load is sticky and ignores late preparation', async () => {
  const store = createMemoryStore(), gate = deferred(), load = store.loadGroundClock.bind(store);
  store.loadGroundClock = async (world) => { await gate.promise; return load(world); };
  const session = new GroundClockSession({ store, worldId: WORLD });
  const pending = session.load(0);
  assert.deepEqual(session.cancel(), { state: 'fenced' });
  gate.resolve(); await assert.rejects(pending, { code: 'cancelled' });
  assert.equal(session.drain(0).state, 'fenced');
  assert.throws(() => session.cancel(), { code: 'operation' });
  assert.equal(session.ready, false);
});

test('ready sessions cannot be cancelled and continue to map logical time', async () => {
  const { session } = await readySession(createMemoryStore(), 6, 1);
  assert.throws(() => session.cancel(), { code: 'operation' });
  assert.equal(session.state, 'ready');
  assert.equal(session.drain(1).state, 'ready');
  assert.equal(session.logicalTick(1), 6);
});
