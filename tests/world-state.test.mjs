import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/sim/economy/economy.js';
import { WorldState, worldConfigFromEnv } from '../server/worldState.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { GameHost } from '../server/host.mjs';

const seed = 42;
const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function richEconomy() {
  const economy = new Economy(seed, { startHour: 0 });
  economy.hours = 0;
  economy.acc = 3.25;
  economy.markets.aldea.stock.ron = 17;
  economy.markets.aldea.last.ron = 1;
  const plot = economy.plots.aldea[0];
  Object.assign(plot, { owner: 'captain7', b: 'panaderia', state: 'ready', done: 0, recipe: 'galleta', batchT: 0.75,
    store: { harina: 8, galleta: 2 }, debt: 1.5, owed: 2.25 });
  return economy;
}

test('creation is persisted before readiness and restores zero-hour economy state and its next deterministic advance', async () => {
  const store = createMemoryStore(), gate = deferred(), writes = [];
  const delayed = { ...store,
    async saveWorld(id, data, expected) { writes.push({ data: structuredClone(data), expected }); await gate.promise; return store.saveWorld(id, data, expected); },
  };
  const original = richEconomy(), world = new WorldState(delayed, { id: 'test-world', seed });
  const opening = world.open(original); await turn();
  assert.equal(world.status().ready, false);
  assert.equal(writes.length, 1); assert.equal(writes[0].expected, 0);
  gate.resolve(); await opening;
  assert.equal(world.status().ready, true);
  assert.equal((await store.loadWorld('test-world')).version, 1);

  const freshProcess = new WorldState(store, { id: 'test-world', seed });
  const restored = await freshProcess.open(new Economy(seed));
  assert.equal(restored.hours, 0);
  assert.equal(restored.acc, 3.25);
  assert.equal(restored.markets.aldea.stock.ron, 17);
  assert.equal(restored.markets.aldea.last.ron, 1);
  assert.deepEqual(restored.plots.aldea[0], original.plots.aldea[0]);
  assert.equal(restored.rng.state(), original.rng.state());
  original.advance(15); restored.advance(15);
  assert.deepEqual(restored.serialize(), original.serialize());
});

test('save snapshots are detached before provider awaits and slow writes coalesce to the latest state', async () => {
  const memory = createMemoryStore(), first = deferred(), entered = deferred(), writes = [];
  const store = { ...memory, async saveWorld(id, data, expected) {
    writes.push({ hours: data.economy.hours, expected, data });
    if (writes.length === 2) { entered.resolve(); await first.promise; }
    return memory.saveWorld(id, data, expected);
  } };
  const world = new WorldState(store, { id: 'serial', seed });
  const economy = new Economy(seed); await world.open(economy);
  economy.advance(5); world.save(economy); await entered.promise;
  economy.advance(5); world.save(economy);
  economy.advance(5); world.save(economy);
  // Neither caller mutation nor later coalesced snapshots may reach the current provider argument.
  assert.equal(writes[1].data.economy.hours, 8.125);
  await turn(); assert.equal(writes.length, 2);
  first.resolve(); await world.flush();
  assert.deepEqual(writes.map(({ hours, expected }) => ({ hours, expected })), [
    { hours: 8, expected: 0 }, { hours: 8.125, expected: 1 }, { hours: 8.375, expected: 2 },
  ]);
  assert.equal((await memory.loadWorld('serial')).data.economy.hours, 8.375);
});

test('GameHost.prepare preserves the live owner-profile upkeep callback after restore', async () => {
  const store = createMemoryStore(), source = richEconomy();
  await store.saveWorld('upkeep', { v: 1, seed, economy: source.serialize() }, 0);
  const host = new GameHost({ seed, bots: 0, log: () => {}, store, worldId: 'upkeep' });
  try {
    await host.prepare();
    const profile = { eco: { id: 'captain7' }, gold: 10 };
    host.server.world.profiles.set(999, profile);
    host.server.world.economy.advance(40); // Persisted owed upkeep plus one game hour reaches two coins.
    assert.equal(profile.gold, 8);
    assert.ok(host.server.world.economy.plots.aldea[0].owed > 0 && host.server.world.economy.plots.aldea[0].owed < 1);
  } finally { await host.close(); }
});

test('load corruption, seed mismatch and provider failure never create an empty replacement', async (t) => {
  const malformed = new Economy(seed).serialize(); malformed.plots.aldea.pop();
  const wrongPlotId = new Economy(seed).serialize(); wrongPlotId.plots.aldea[0].i = 3;
  for (const [label, row, wantedSeed] of [
    ['malformed plot schema', { version: 1, data: { v: 1, seed, economy: malformed } }, seed],
    ['wrong plot identity', { version: 1, data: { v: 1, seed, economy: wrongPlotId } }, seed],
    ['seed mismatch', { version: 1, data: { v: 1, seed: seed + 1, economy: new Economy(seed).serialize() } }, seed],
    ['legacy economy payload', { version: 1, data: { v: 1, seed, economy: { ...new Economy(seed).serialize(), v: 1 } } }, seed],
    ['missing RNG state', { version: 1, data: { v: 1, seed, economy: (() => { const x = new Economy(seed).serialize(); delete x.rng; return x; })() } }, seed],
    ['invalid market trend', { version: 1, data: { v: 1, seed, economy: (() => { const x = new Economy(seed).serialize(); x.markets.aldea.last.ron = 9; return x; })() } }, seed],
  ]) {
    let writes = 0;
    const store = { async loadWorld() { return row; }, async saveWorld() { writes++; return { ok: true, version: 2 }; } };
    const world = new WorldState(store, { id: label, seed: wantedSeed });
    await assert.rejects(world.open(new Economy(wantedSeed)), StoreError);
    assert.equal(writes, 0, label);
    assert.equal(world.status().ready, false);
  }
  let writes = 0;
  const broken = new WorldState({ async loadWorld() { throw new Error('private provider detail'); }, async saveWorld() { writes++; } }, { id: 'unavailable', seed });
  await assert.rejects(broken.open(new Economy(seed)), (error) => error.code === 'unavailable' && !error.message.includes('private'));
  assert.equal(writes, 0);
});

test('world ID and autosave interval defaults are stable and invalid configuration is rejected', () => {
  assert.deepEqual(worldConfigFromEnv({}), { worldId: 'marea-negra', worldSaveMs: 60000 });
  assert.deepEqual(worldConfigFromEnv({ WORLD_ID: 'isolated-canary', WORLD_SAVE_SECONDS: '2.5' }), { worldId: 'isolated-canary', worldSaveMs: 2500 });
  for (const env of [
    { WORLD_ID: '  ' }, { WORLD_ID: 'x'.repeat(101) }, { WORLD_ID: 'bad\0id' },
    { WORLD_SAVE_SECONDS: '0' }, { WORLD_SAVE_SECONDS: '-1' }, { WORLD_SAVE_SECONDS: 'NaN' },
    { WORLD_SAVE_SECONDS: '2147484' },
  ]) assert.throws(() => worldConfigFromEnv(env), { code: 'configuration' });
});

test('first-write conflict and ambiguous provider result fence the world without retrying over newer state', async () => {
  for (const failure of [
    async () => ({ ok: false, why: 'conflict' }),
    async () => { throw new Error('write response lost'); },
  ]) {
    let writes = 0, fenced = 0;
    const store = { async loadWorld() { return null; }, async saveWorld() { writes++; return failure(); } };
    const world = new WorldState(store, { id: `failed-${writes}`, seed, onFailure: () => fenced++ });
    await assert.rejects(world.open(new Economy(seed)));
    world.save(new Economy(seed)); await world.flush().catch(() => {});
    assert.equal(writes, 1); assert.equal(fenced, 1);
    assert.equal(world.status().ready, false); assert.equal(world.status().failed, true);
  }
});

test('a provider error after its CAS commit fences future writes and leaves the committed generation intact', async () => {
  const memory = createMemoryStore(); let calls = 0;
  const store = { ...memory, async saveWorld(...args) {
    calls++;
    const result = await memory.saveWorld(...args);
    if (calls === 2) throw new Error('response lost after commit');
    return result;
  } };
  const world = new WorldState(store, { id: 'commit-ambiguous', seed });
  const economy = new Economy(seed); await world.open(economy);
  economy.advance(5); world.save(economy);
  await assert.rejects(world.flush(), { code: 'flush' });
  const committed = await memory.loadWorld('commit-ambiguous');
  assert.equal(committed.version, 2);
  assert.equal(committed.data.economy.hours, 8.125);
  world.save(economy); await world.flush().catch(() => {});
  assert.equal(calls, 2);
  assert.equal((await memory.loadWorld('commit-ambiguous')).version, 2);
});
