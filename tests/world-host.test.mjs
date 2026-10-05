import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { Economy } from '../src/sim/economy/economy.js';

const seed = 42;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

test('HTTP listener and simulation wait for initial world load and creation CAS', { timeout: 10000 }, async (t) => {
  const base = createMemoryStore(), read = deferred(), write = deferred(), calls = [];
  const store = { ...base,
    async loadWorld(id) { calls.push(['load', id]); await read.promise; return base.loadWorld(id); },
    async saveWorld(id, data, expected) { calls.push(['save', expected]); await write.promise; return base.saveWorld(id, data, expected); },
  };
  const gs = createGameServer({ port: 0, host: '127.0.0.1', seed, bots: 0, log: () => {}, saveSecret: 'world-host-test', store, worldId: 'boot-gate' });
  t.after(async () => { try { await gs.close(); } catch { /* startup storage failure is asserted below */ } });
  const starting = gs.listen(); await tick();
  assert.equal(gs.server.listening, false);
  assert.equal(gs.game.timer, undefined);
  assert.deepEqual(calls, [['load', 'boot-gate']]);
  read.resolve(); await tick();
  assert.deepEqual(calls, [['load', 'boot-gate'], ['save', 0]]);
  assert.equal(gs.server.listening, false);
  write.resolve();
  const port = await starting;
  assert.equal(gs.server.listening, true);
  assert.equal((await base.loadWorld('boot-gate')).version, 1);
  assert.ok(port > 0);
});

test('world write conflict fences ticks and admissions, returns HTTP health 503, and close reports failure', { timeout: 10000 }, async (t) => {
  const store = createMemoryStore();
  const gs = createGameServer({ port: 0, host: '127.0.0.1', seed, bots: 0, log: () => {}, saveSecret: 'world-host-test', store, worldId: 'fence' });
  const port = await gs.listen();
  t.after(async () => { try { await gs.close(); } catch { /* expected once fenced */ } });
  const world = gs.game.server.world.economy;
  // Advance a persistable field, then simulate a competing process winning CAS.
  world.advance(5);
  const current = await store.loadWorld('fence');
  await store.saveWorld('fence', { v: 1, seed, economy: new Economy(seed).serialize() }, current.version);
  gs.game.worldState.save(world);
  await assert.rejects(gs.game.worldState.flush(), { code: 'flush' });
  assert.equal(gs.game.healthy(), false);
  const tickAtFence = gs.game.server.world.tick;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(gs.game.server.world.tick, tickAtFence);
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 503);

  class Probe extends EventEmitter {
    readyState = 1;
    close(code) { this.code = code; this.readyState = 3; }
  }
  const probe = new Probe();
  gs.game.onConnection(probe, { headers: {}, socket: { remoteAddress: 'local-test' } });
  assert.equal(probe.code, 1013);
  assert.equal(gs.game.server.humans, 0);
  await assert.rejects(gs.close(), { code: 'flush' });
});

test('ambiguous save failure fences the host and preserves the last confirmed world generation', { timeout: 10000 }, async (t) => {
  const memory = createMemoryStore(); let failWrite = false, attempts = 0;
  const store = { ...memory, async saveWorld(...args) {
    attempts++;
    if (failWrite) throw new Error('provider response lost');
    return memory.saveWorld(...args);
  } };
  const gs = createGameServer({ port: 0, host: '127.0.0.1', seed, bots: 0, log: () => {}, saveSecret: 'world-host-test', store, worldId: 'ambiguous' });
  const port = await gs.listen();
  t.after(async () => { try { await gs.close(); } catch { /* expected after the simulated ambiguous write */ } });
  const confirmed = await memory.loadWorld('ambiguous');
  gs.game.server.world.economy.advance(5);
  failWrite = true;
  gs.game.worldState.save(gs.game.server.world.economy);
  await assert.rejects(gs.game.worldState.flush(), { code: 'flush' });
  assert.equal(attempts, 2);
  assert.equal(gs.game.healthy(), false);
  assert.equal((await memory.loadWorld('ambiguous')).version, confirmed.version);
  assert.deepEqual((await memory.loadWorld('ambiguous')).data, confirmed.data);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 503);
  await assert.rejects(gs.close(), { code: 'flush' });
});

test('autosave and shutdown serialize slow CAS writes and shutdown persists the final economy snapshot', { timeout: 10000 }, async (t) => {
  const memory = createMemoryStore(), firstAuto = deferred(), entered = deferred(), writes = [];
  let active = 0, maxActive = 0;
  const store = { ...memory, async saveWorld(id, data, expected) {
    const inFlight = ++active; maxActive = Math.max(maxActive, inFlight);
    writes.push({ hours: data.economy.hours, expected });
    try {
      if (expected === 1) { entered.resolve(); await firstAuto.promise; }
      return await memory.saveWorld(id, data, expected);
    } finally { active--; }
  } };
  const host = new GameHost({ seed, bots: 0, log: () => {}, store, worldId: 'autosave', worldSaveMs: 15 });
  t.after(async () => { firstAuto.resolve(); try { await host.close(); } catch { /* assertion path may already have fenced it */ } });
  await host.prepare(); host.start();
  host.server.world.economy.hours = 10;
  await entered.promise; // The recurring timer, rather than a direct save call, started this write.
  host.server.world.economy.hours = 11;
  await new Promise((resolve) => setTimeout(resolve, 25));
  host.server.world.economy.hours = 12;
  const closing = host.close();
  await tick(); assert.equal(writes.length, 2, 'pending snapshots coalesce behind the blocked CAS');
  firstAuto.resolve(); await closing;
  assert.equal(maxActive, 1);
  assert.deepEqual(writes, [
    { hours: 8, expected: 0 }, { hours: 10, expected: 1 }, { hours: 12, expected: 2 },
  ]);
  const row = await memory.loadWorld('autosave');
  assert.equal(row.version, 3); assert.equal(row.data.economy.hours, 12);
});

test('load failure never opens the HTTP listener or manufactures a replacement world', { timeout: 10000 }, async (t) => {
  let writes = 0;
  const store = { ...createMemoryStore(), async loadWorld() { throw new Error('provider detail'); }, async saveWorld() { writes++; return { ok: true, version: 1 }; } };
  const gs = createGameServer({ port: 0, host: '127.0.0.1', seed, bots: 0, log: () => {}, saveSecret: 'world-host-test', store, worldId: 'load-error' });
  t.after(async () => { try { await gs.close(); } catch { /* failed authority */ } });
  await assert.rejects(gs.listen(), { code: 'unavailable' });
  assert.equal(gs.server.listening, false);
  assert.equal(writes, 0);
  await assert.rejects(gs.game.close(), { code: 'flush' });
});

test('shutdown aborts a stuck startup load and late null result cannot write a world', async () => {
  const read = deferred(); let writes = 0;
  const host = new GameHost({ seed, bots: 0, log: () => {}, worldId: 'cancel-load', store: {
    async loadWorld() { return read.promise; },
    async saveWorld() { writes++; return { ok: true, version: 1 }; },
  } });
  const preparing = host.prepare(); await tick();
  await host.close();
  await assert.rejects(preparing, { code: 'cancelled' });
  read.resolve(null); await tick();
  assert.equal(writes, 0);
});

test('createGameServer.close during a blocked pre-listen load leaves no listener or late world write', { timeout: 10000 }, async () => {
  const read = deferred(); let writes = 0;
  const gs = createGameServer({ port: 0, host: '127.0.0.1', seed, bots: 0, log: () => {}, saveSecret: 'world-host-test', worldId: 'cancel-http',
    store: { async loadWorld() { return read.promise; }, async saveWorld() { writes++; return { ok: true, version: 1 }; } },
  });
  const starting = gs.listen(); await tick();
  await gs.close();
  await assert.rejects(starting, { code: 'cancelled' });
  read.resolve(null); await tick();
  assert.equal(gs.server.listening, false);
  assert.equal(writes, 0);
});

test('createGameServer can close cleanly before listen begins', { timeout: 10000 }, async () => {
  let writes = 0;
  const gs = createGameServer({ port: 0, host: '127.0.0.1', seed, bots: 0, log: () => {}, saveSecret: 'world-host-test', worldId: 'close-before-listen',
    store: { async loadWorld() { return null; }, async saveWorld() { writes++; return { ok: true, version: 1 }; } },
  });
  await gs.close();
  assert.equal(gs.server.listening, false);
  assert.equal(writes, 0);
});
