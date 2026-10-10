import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newResourceState } from '../server/resourceState.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const WORLD = 'island:ground-host-authority';
const CLOCK_ID = 'c4100000-0000-4000-8000-000000000001';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const turn = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function memoryJournal(scope) {
  const rows = new Map();
  const copy = value => value === null ? null : structuredClone(value);
  return {
    scope, durable: true,
    async check() { return { version: 1 }; },
    async prepare(raw) {
      let row = rows.get(raw.operationId);
      if (row && JSON.stringify(row.request) !== JSON.stringify(raw.request)) throw new Error('operation');
      if (!row) {
        row = { operationId: raw.operationId, request: copy(raw.request), state: 'pending', result: null };
        rows.set(raw.operationId, row);
      }
      return copy(row);
    },
    async load(id) { return copy(rows.get(id) ?? null); },
    async list({ limit = 64 } = {}) {
      return [...rows.values()].filter(row => row.state === 'pending')
        .sort((a, b) => a.operationId.localeCompare(b.operationId)).slice(0, limit).map(copy);
    },
    finish(id, result) {
      const row = rows.get(id);
      if (!row) return;
      row.state = result.ok ? 'committed' : result.why === 'conflict' ? 'conflict' : 'rejected';
      row.result = copy(result);
    },
    rows,
  };
}

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(value); }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.closed = { code, reason };
    this.emit('close');
  }
  ping() {}
}

async function fixture({ clockTick = 0, resourcesTick = clockTick, prepare = true, checkpointGate = null, resolvePlayer = async () => ACCOUNT } = {}) {
  const base = createMemoryStore();
  const journal = memoryJournal(WORLD);
  const store = { ...base, durable: true };
  const receipts = new Map();
  store.checkGroundTransactions = async () => ({ version: 1 });
  store.loadGroundTransaction = async id => structuredClone(receipts.get(id) ?? null);
  store.commitGroundTransaction = async raw => {
    if (checkpointGate && raw.request.family === 'checkpoint') {
      const gate = Array.isArray(checkpointGate) ? checkpointGate.shift() : checkpointGate;
      gate.entered.resolve();
      await gate.release.promise;
    }
    const prior = receipts.get(raw.operationId);
    if (prior) return { ...structuredClone(prior.result), replay: true };
    const request = raw.request;
    let worldVersion, effect;
    if (request.family === 'economic') {
      effect = await base.commitEconomicOperation({ operationId: raw.operationId, request: request.operation });
      if (!effect.ok) return effect;
      worldVersion = effect.worldVersion;
    } else {
      const saved = await base.saveWorld(request.world, request.worldData, request.expectedWorldVersion);
      if (!saved.ok) return { ok: false, why: saved.why };
      worldVersion = saved.version;
      effect = { ok: true, replay: false };
    }
    let clock;
    if (request.clock.tick === request.clock.expectedTick) {
      clock = await base.loadGroundClock(request.world);
    } else {
      const next = await base.commitGroundClock({ operationId: request.clock.operationId, world: request.world,
        expectedVersion: request.clock.expectedVersion, expectedTick: request.clock.expectedTick, tick: request.clock.tick });
      if (!next.ok) return next;
      clock = next.clock;
    }
    const result = { ok: true, replay: false, worldVersion, clock, effect };
    receipts.set(raw.operationId, { request: structuredClone(request), result: structuredClone(result) });
    journal.finish(raw.operationId, result);
    return result;
  };
  const host = new GameHost({ seed: 713, bots: 0, maxPlayers: 4, log: () => {}, store,
    saves: hmacSaves('ground-host-authority-test-key'), resolvePlayer,
    initializeAccounts: true, worldId: WORLD, economicOperations: true, resourceOperations: true,
    groundTransactions: { journal } });
  const resources = newResourceState(host.server.world);
  resources.tick = resourcesTick;
  await store.saveWorld(WORLD, { v: 1, seed: host.server.world.seed,
    economy: host.server.world.economy.serialize(), resources }, 0);
  if (clockTick !== null) {
    const result = await base.commitGroundClock({ operationId: CLOCK_ID, world: WORLD,
      expectedVersion: 0, expectedTick: 0, tick: clockTick });
    assert.equal(result.ok, true);
  }
  if (prepare) await host.prepare();
  return { base, journal, store, host };
}

function cleanup(t, host) {
  t.after(async () => {
    try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
  });
}

test('the opt-in composes one ready ground owner while defaults keep the legacy host', async t => {
  const f = await fixture(); cleanup(t, f.host);
  assert.equal(f.host.groundAuthority.ready, true);
  assert.equal(f.host.server.beforeTick, f.host.groundAuthority.boundary);
  assert.equal(f.host.healthy(), true);
  assert.equal(f.host.groundAuthority.status().clock.tick, 0);

  const legacy = new GameHost({ seed: 3, bots: 0, log: () => {} });
  t.after(() => legacy.close().catch(() => {}));
  assert.equal(legacy.groundAuthority, null);
  assert.equal(legacy.server.beforeTick, null);
  assert.equal(legacy.status().storage.groundTransactions, null);
});

test('opt-in fails closed for an absent clock or a resource tick outside that clock', async t => {
  const absent = await fixture({ clockTick: null, prepare: false }); cleanup(t, absent.host);
  await assert.rejects(absent.host.prepare());
  assert.equal(absent.host.healthy(), false);
  assert.equal(absent.host.nextId, 1);
  assert.equal(absent.host.server.world.tick, 0);

  const mismatch = await fixture({ clockTick: 41, resourcesTick: 40, prepare: false }); cleanup(t, mismatch.host);
  await assert.rejects(mismatch.host.prepare());
  assert.equal(mismatch.host.healthy(), false);
  assert.equal(mismatch.host.nextId, 1);
  assert.equal(mismatch.host.server.world.tick, 0);
});

test('a pending checkpoint blocks ticks, commands, and new connections until its synchronous drain', async t => {
  const gate = { entered: deferred(), release: deferred() };
  const f = await fixture({ checkpointGate: gate }); cleanup(t, f.host);
  f.host.server.world.economy.acc += 0.5;
  f.host.worldState.save(f.host.server.world.economy);
  await gate.entered.promise;

  assert.equal(f.host.groundAuthority.busy, true);
  assert.equal(f.host.tickAvailable(), false);
  assert.equal(f.host.commandAvailable(0, 1, {}), false);
  assert.equal(f.host.server.step(), false);
  assert.equal(f.host.server.world.tick, 0);

  const socket = new Socket();
  f.host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-authority-test' } });
  if (!socket.closed) {
    socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'tester' })), false);
    await Promise.all([...f.host.joins]);
  }
  assert.ok(socket.closed, 'a checkpoint reservation rejects a new connection');

  gate.release.resolve();
  await f.host.groundAuthority.settle();
  assert.equal(f.host.groundAuthority.busy, true, 'settling I/O does not apply the prepared checkpoint');
  assert.equal(f.host.server.step(), false, 'the next boundary applies the checkpoint without stepping');
  await turn();
  assert.equal(f.host.groundAuthority.busy, false);
  assert.equal(f.host.groundAuthority.status().clock.tick, 0);
  assert.equal(f.host.tickAvailable(), true);
  const row = await f.store.loadWorld(WORLD);
  assert.equal(row.version, 2);
  assert.deepEqual(row.data.resources, f.host.worldState.resources);
});

test('coalesced world snapshots keep the common boundary reserved until every checkpoint drains', async t => {
  const first = { entered: deferred(), release: deferred() };
  const second = { entered: deferred(), release: deferred() };
  const f = await fixture({ checkpointGate: [first, second] }); cleanup(t, f.host);
  f.host.server.world.economy.acc += 0.25;
  f.host.worldState.save(f.host.server.world.economy);
  await first.entered.promise;
  f.host.server.world.economy.acc += 0.25;
  f.host.worldState.save(f.host.server.world.economy);
  first.release.resolve();
  await f.host.groundAuthority.settle();
  assert.equal(f.host.groundAuthority.busy, true);
  assert.equal(f.host.server.step(), false, 'first prepared checkpoint drains without advancing simulation');
  await second.entered.promise;
  assert.equal(f.host.groundAuthority.busy, true, 'queued snapshot immediately owns the next boundary');
  second.release.resolve();
  await f.host.groundAuthority.settle();
  assert.equal(f.host.server.step(), false, 'second prepared checkpoint also drains without advancing simulation');
  await turn();
  await f.host.worldState.flush();
  const row = await f.store.loadWorld(WORLD);
  assert.equal(row.version, 3);
  assert.equal(f.host.server.world.tick, 0);
  assert.equal(row.data.economy.acc, f.host.server.world.economy.acc);
});

test('shutdown settles and drains a pending checkpoint before the final world flush', async t => {
  const gate = { entered: deferred(), release: deferred() };
  const f = await fixture({ checkpointGate: gate });
  f.host.server.world.economy.acc += 0.5;
  f.host.worldState.save(f.host.server.world.economy);
  await gate.entered.promise;
  const closing = f.host.close();
  gate.release.resolve();
  await closing;
  const row = await f.store.loadWorld(WORLD);
  assert.equal(row.version, 2);
  assert.equal(row.data.economy.acc, f.host.server.world.economy.acc);
  assert.equal(f.host.groundAuthority.status().failed, false);
});

test('the trusted opt-in rejects accessors and the separate agent-trade lane', async () => {
  const store = { ...createMemoryStore(), durable: true };
  const journal = memoryJournal(WORLD);
  let reads = 0;
  const options = Object.defineProperty({}, 'journal', { enumerable: true, get() { reads++; return journal; } });
  const base = { seed: 2, bots: 0, store, worldId: WORLD, resolvePlayer: async () => ACCOUNT,
    economicOperations: true, resourceOperations: true, log: () => {} };
  assert.throws(() => new GameHost({ ...base, groundTransactions: options }), { code: 'configuration' });
  assert.equal(reads, 0);
  assert.throws(() => new GameHost({ ...base, agentTrade: true, groundTransactions: { journal } }), { code: 'configuration' });
});

test('accounts-only ground hosts reject guest admission', async t => {
  const f = await fixture({ resolvePlayer: async () => null }); cleanup(t, f.host);
  const socket = new Socket();
  f.host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'ground-authority-test' } });
  const id = f.host.nextId - 1;
  socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'guest' })), false);
  await Promise.all([...f.host.joins]);
  assert.equal(f.host.profiles.clients.has(id), false);
  assert.ok(socket.sent.map(value => JSON.parse(value)).some(value => value.code === 'auth'));
});
test('replacing the installed beforeTick owner fences the world', async t => {
  const f = await fixture(); cleanup(t, f.host);
  f.host.server.beforeTick = () => true;
  assert.equal(f.host.server.step(), false);
  assert.equal(f.host.worldState.failed, true);
  assert.equal(f.host.groundAuthority.status().failed, true);
});






