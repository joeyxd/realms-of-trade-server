import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { GroundCurrentHydration } from '../server/groundCurrentHydration.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { groundOperation } from '../server/pearlGround.mjs';
import { World } from '../src/sim/world.js';
import { installInventory } from '../src/sim/systems/inventory.js';
import { seedDeathDropScenario, WORLD as DEATH_WORLD } from './helpers/death-drop-storage.mjs';
import { map } from './helpers.mjs';

const WORLD = DEATH_WORLD;
const DURABLE_TICK = 500;
const ID = n => `a1500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const clockFor = (worldId = WORLD, durableTick = DURABLE_TICK) => new GroundDeadlineClock({ worldId,
  sourceDomain: 'durable-ground-v1', epoch: new GroundClockEpoch({ localTick: 0, durableTick }) });

async function seedPearl(store, uid = 'current-pearl') {
  const raw = { operationId: ID(1), uid, kind: 'brasa', from: null, to: null,
    expectedVersion: 0, world: WORLD, ground: { x: 2, z: 3, availableAt: 400, returnAt: 490 }, profiles: [] };
  groundOperation(raw);
  assert.equal((await store.commitPearlGround(raw)).ok, true);
  return raw;
}

async function fixture({ wrapStore = value => value, seed = true, deaths = false, deadlineClock = clockFor() } = {}) {
  const base = createMemoryStore(), store = wrapStore(base);
  if (seed) await seedPearl(base);
  let scene = null;
  if (deaths) scene = await seedDeathDropScenario(base, { sourceOperation: 501 });
  const profiles = new ProfileSessions(store, () => {}); // Deliberately no legacy pearl journal.
  const world = new World(91, { map, server: true }); installInventory(world, WORLD);
  world.tick = 0;
  const boundary = () => true;
  const authority = { boundary, ready: true, status: () => ({ clock: { tick: DURABLE_TICK } }), canMutate: () => true };
  const host = { server: { world, beforeTick: boundary, clients: new Map() }, worldState: { id: WORLD, ready: true },
    groundAuthority: authority, profiles, joins: new Set(), sockets: new Map(), pendingJoins: 0, nextId: 1, closing: false };
  const hydration = new GroundCurrentHydration({ host, deadlineClock, pageSize: 2, maxRows: 64 });
  return { base, store, profiles, world, host, authority, boundary, hydration, scene };
}

function state(world) {
  return structuredClone({ drops: [...world.drops], ledger: [...world.pearlLedger], nextDrop: world.nextDrop,
    events: world.events, profiles: [...world.profiles], tick: world.tick });
}

test('common startup wrapper hydrates pearls and current death drops atomically without a legacy journal', async () => {
  const f = await fixture({ deaths: true });
  const before = state(f.world);
  assert.deepEqual(await f.hydration.prepare(), { state: 'ready', count: 1 + f.scene.death.drops.length });
  assert.equal(f.hydration.ready, true);
  assert.deepEqual(state(f.world), before, 'async preparation does not install rows');
  assert.deepEqual(f.hydration.drain(), { state: 'applied', count: 1 + f.scene.death.drops.length });
  assert.equal(f.world.drops.size, 1 + f.scene.death.drops.length);
  assert.equal(f.world.events.length, 0, 'hydration does not replay death/pickup/expiry events');
  assert.equal(f.world.nextDrop, 2 + f.scene.death.drops.length);
  const pearl = f.hydration.pearl(1);
  assert.deepEqual(pearl, { dropId: 1, uid: 'current-pearl', kind: 'brasa', world: WORLD,
    ground: { x: 2, z: 3, availableAt: 400, returnAt: 490 }, version: 1 });
  pearl.ground.x = -99;
  assert.equal(f.hydration.pearl(1).ground.x, 2, 'lookup returns detached durable row data');
  assert.equal(f.hydration.pearl(2), null);
  const projected = [...f.world.drops.values()].filter(row => row.kind !== 'pearl');
  assert.ok(projected.length > 0);
  assert.ok(f.world.drops.get(1).t < f.world.tick, 'a past pearl deadline stays current at startup');
  assert.deepEqual(f.hydration.drain(), { state: 'applied', count: 1 + f.scene.death.drops.length });
});

test('a pending read can be cancelled and a late reply cannot install either family', async () => {
  const entered = deferred(), release = deferred();
  const f = await fixture({ deaths: true, wrapStore: base => ({ ...base, async listPearlGround(world, options) {
    entered.resolve(); await release.promise; return base.listPearlGround(world, options);
  } }) });
  const before = state(f.world), task = f.hydration.prepare();
  await entered.promise;
  assert.deepEqual(f.hydration.drain(), { state: 'pending' });
  assert.deepEqual(f.hydration.cancel(), { state: 'fenced' });
  release.resolve();
  await assert.rejects(task, error => ['cancelled', 'unavailable'].includes(error.code));
  assert.deepEqual(state(f.world), before);
  assert.equal(f.hydration.status().state, 'fenced');
});

test('drain fences if the sole beforeTick owner changes after reads are ready', async () => {
  const f = await fixture(); await f.hydration.prepare();
  f.host.server.beforeTick = () => true;
  const before = state(f.world), result = f.hydration.drain();
  assert.deepEqual(result, { state: 'fenced', why: 'configuration' });
  assert.deepEqual(state(f.world), before);
});

test('drain fences if the host world is replaced after reads are ready', async () => {
  const f = await fixture(); await f.hydration.prepare();
  const before = state(f.world); f.host.server.world = new World(92, { map, server: true });
  assert.deepEqual(f.hydration.drain(), { state: 'fenced', why: 'configuration' });
  assert.deepEqual(state(f.world), before);
});

test('drain fences if transport or account admission starts before hydration applies', async () => {
  for (const mutate of [h => { h.wss = {}; }, h => { h.server.clients.set(1, {}); }, h => { h.pendingJoins = 1; }]) {
    const f = await fixture(); await f.hydration.prepare(); mutate(f.host);
    const before = state(f.world);
    assert.deepEqual(f.hydration.drain(), { state: 'fenced', why: 'configuration' });
    assert.deepEqual(state(f.world), before);
  }
});

test('supplied deadline epoch must be the recovered world clock', async () => {
  const f = await fixture({ deadlineClock: clockFor(WORLD, DURABLE_TICK - 1) });
  assert.throws(() => f.hydration.prepare(), { code: 'configuration' });
  assert.deepEqual(state(f.world), { drops: [], ledger: [], nextDrop: 1, events: [], profiles: [], tick: 0 });
});

test('invalid current rows fence preparation without publishing a prefix', async () => {
  const f = await fixture({ wrapStore: base => ({ ...base, async listCurrentDeathDrops() {
    throw new StoreError('unavailable');
  } }), deaths: true });
  const before = state(f.world);
  await assert.rejects(f.hydration.prepare(), { code: 'unavailable' });
  assert.deepEqual(state(f.world), before);
  assert.equal(f.hydration.status().state, 'fenced');
});
