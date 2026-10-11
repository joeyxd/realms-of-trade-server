import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database, reopenDatabase } from './helpers/ground-clock-sql.mjs';
import { GroundClockSession, GroundClockEpoch } from '../server/groundClockSession.mjs';
import { createMemoryStore } from '../server/store.mjs';

const worldId = 'clock-session-sql';
const id = n => 'd0320000-0000-4000-8000-' + String(n).padStart(12,'0');

test('session resolves a lost SQL013 reply by read and reopens with a fresh local epoch', async t => {
  const path = join(await mkdtemp(join(tmpdir(), 'clock-session-')), 'db');
  t.diagnostic('Retained file-backed SQL fixture: ' + path);
  const first = await database(path);
  let saved;
  try {
    const session = new GroundClockSession({ store: first.store, worldId });
    await session.load(0); assert.equal(session.state, 'prepared'); assert.equal(session.epoch, null);
    assert.equal(session.drain(0).state, 'missing');
    await session.initialize({ operationId: id(1), localTick: 0, tick: 10000 });
    session.drain(0);
    await session.checkpoint({ operationId: id(2), localTick: 60 }); session.drain(60);
    first.loseNextReply();
    await assert.rejects(session.checkpoint({ operationId: id(3), localTick: 90 }));
    assert.equal(session.state, 'unresolved'); assert.equal(session.clock.tick, 10060);
    const sends = first.calls.filter(q => q.name === 'mn_commit_ground_clock').length;
    await session.reconcile(); assert.equal(session.clock.tick, 10060);
    saved = session.drain(90).clock;
    assert.equal(saved.tick, 10090);
    assert.equal(first.calls.filter(q => q.name === 'mn_commit_ground_clock').length, sends);
    assert.deepEqual(session.epoch.anchor, { localTick: 0, durableTick: 10000 });
  } finally { await first.close(); }
  const second = await reopenDatabase(path);
  try {
    const session = new GroundClockSession({ store: second.store, worldId });
    await session.load(0); assert.equal(session.clock, null);
    assert.deepEqual(session.drain(0).clock, saved);
    assert.equal(session.logicalTick(60), 10150);
    assert.equal(session.epoch.toLocal(10080), -10);
    assert.equal(session.epoch.toLocal(10100), 10);
    assert.equal(second.calls.some(q => q.name === 'mn_commit_ground_clock'), false);
  } finally { await second.close(); }
});

test('SQL absent receipt stays unresolved until explicit exact resume', async () => {
  const f = await database();
  try {
    let request, first = true;
    const store = { ...f.store, commitGroundClock: async raw => {
      if (first) { first = false; request = structuredClone(raw); throw Error('before transport'); }
      assert.deepEqual(raw, request); return f.store.commitGroundClock(raw);
    } };
    const session = new GroundClockSession({ store, worldId });
    await session.load(4); session.drain(4);
    await assert.rejects(session.initialize({ operationId: id(4), localTick: 4, tick: 25 }));
    assert.deepEqual(await session.reconcile(), { state: 'unresolved' });
    assert.equal(f.calls.filter(q => q.name === 'mn_commit_ground_clock').length, 0);
    await session.resume(); assert.equal(session.clock, null);
    assert.equal(session.drain(4).clock.tick, 25);
    assert.equal(f.calls.filter(q => q.name === 'mn_commit_ground_clock').length, 1);
  } finally { await f.close(); }
});

test('foreign SQL writer between startup reads fences instead of adopting an uncertain epoch', async () => {
  const f = await database();
  try {
    await f.store.commitGroundClock({ operationId: id(5), world: worldId, expectedVersion: 0, expectedTick: 0, tick: 100 });
    let reads = 0;
    const store = { ...f.store, loadGroundClock: async world => {
      if (++reads === 2) await f.store.commitGroundClock({ operationId: id(6), world, expectedVersion: 1, expectedTick: 100, tick: 200 });
      return f.store.loadGroundClock(world);
    } };
    const session = new GroundClockSession({ store, worldId });
    await assert.rejects(session.load(0), { code: 'conflict' });
    assert.equal(session.state, 'fenced'); assert.equal(session.epoch, null); assert.equal(session.clock, null);
  } finally { await f.close(); }
});

test('epoch preserves deadline boundaries without changing a simulation object', () => {
  const world = { tick: 0, clock: { hours: 17 }, profiles: new Map(), drops: new Map() };
  const before = structuredClone(world), epoch = new GroundClockEpoch({ localTick: 0, durableTick: 5000 });
  const availableAt = 5004, expiresAt = 5008;
  for (const tick of [3,4,5,7,8,9]) {
    const durable = epoch.toDurable(tick);
    assert.equal(tick >= epoch.toLocal(availableAt), durable >= availableAt);
    assert.equal(tick > epoch.toLocal(expiresAt), durable > expiresAt);
  }
  assert.equal(epoch.toLocal(4999), -1);
  assert.deepEqual(world, before);
});

test('session rejects a current receipt with changed expected tick despite an identical result', async () => {
  const actual = createMemoryStore();
  let altered = false;
  const store = { ...actual, loadGroundClockOperation: async operationId => {
    const receipt = await actual.loadGroundClockOperation(operationId);
    if (altered && receipt?.request.expectedVersion === 1) receipt.request.expectedTick -= 1;
    return receipt;
  } };
  const session = new GroundClockSession({ store, worldId });
  await session.load(0); session.drain(0);
  await session.initialize({ operationId: id(7), localTick: 0, tick: 100 }); session.drain(0);
  altered = true;
  await assert.rejects(session.checkpoint({ operationId: id(8), localTick: 10 }), { code: 'response' });
  assert.equal(session.state, 'fenced'); assert.equal(session.clock.tick, 100);
});

test('session invalid DTO descriptors are rejected before callbacks or I/O', async () => {
  const store = createMemoryStore(); let reads = 0, callbacks = 0;
  const session = new GroundClockSession({ store: { ...store, commitGroundClock: async () => { reads++; throw Error(); } }, worldId });
  await session.load(0); session.drain(0);
  const accessor = { localTick: 0, tick: 1, get operationId() { callbacks++; return id(9); } };
  assert.throws(() => session.initialize(accessor), { code: 'operation' });
  const hidden = { localTick: 0, tick: 1, operationId: id(9) };
  Object.defineProperty(hidden, 'extra', { value: 1 });
  assert.throws(() => session.initialize(hidden), { code: 'operation' });
  const proxy = new Proxy(hidden, { ownKeys() { callbacks++; return []; } });
  assert.throws(() => session.initialize(proxy), { code: 'operation' });
  assert.equal(reads, 0); assert.equal(callbacks, 0); assert.equal(session.state, 'missing');
});


test('malformed write response stays ambiguous and is recovered from the exact durable receipt', async () => {
  const actual = createMemoryStore(); let sends = 0;
  const store = { ...actual, commitGroundClock: async raw => { sends++; await actual.commitGroundClock(raw); return { ok: true }; } };
  const session = new GroundClockSession({ store, worldId });
  await session.load(0); session.drain(0);
  await assert.rejects(session.initialize({ operationId: id(10), localTick: 0, tick: 10 }), { code: 'response' });
  assert.equal(session.state, 'unresolved');
  await session.reconcile(); assert.equal(sends, 1);
  assert.equal(session.drain(0).clock.tick, 10);
});

test('missing attempted receipt with a competing clock fences before a resume can dispatch', async () => {
  const actual = createMemoryStore(); let sends = 0;
  const store = { ...actual, commitGroundClock: async () => { sends++; throw Error('no dispatch'); } };
  const session = new GroundClockSession({ store, worldId });
  await session.load(0); session.drain(0);
  await assert.rejects(session.initialize({ operationId: id(11), localTick: 0, tick: 10 }));
  await actual.commitGroundClock({ operationId: id(12), world: worldId, expectedVersion: 0, expectedTick: 0, tick: 20 });
  await assert.rejects(session.reconcile(), { code: 'conflict' });
  assert.equal(session.state, 'fenced');
  assert.throws(() => session.resume(), { code: 'busy' }); assert.equal(sends, 1);
});

test('cancelled in-flight creation may commit storage but never publishes a local epoch', async () => {
  const actual = createMemoryStore(); let finish;
  const wait = new Promise(resolve => { finish = resolve; });
  const store = { ...actual, commitGroundClock: async raw => { await wait; return actual.commitGroundClock(raw); } };
  const session = new GroundClockSession({ store, worldId });
  await session.load(0); session.drain(0);
  const task = session.initialize({ operationId: id(13), localTick: 0, tick: 30 });
  session.cancel(); finish();
  await assert.rejects(task, { code: 'cancelled' });
  assert.equal((await actual.loadGroundClock(worldId)).tick, 30);
  assert.equal(session.state, 'fenced'); assert.equal(session.clock, null); assert.equal(session.epoch, null);
  assert.equal(session.drain(0).state, 'fenced');
});
