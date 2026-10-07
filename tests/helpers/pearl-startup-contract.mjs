import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { createMemoryStore, StoreError } from '../../server/store.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { PearlStartup } from '../../server/pearlStartup.mjs';
import { PearlGroundHydration } from '../../server/pearlGroundHydration.mjs';
import { pearlMutationGate } from '../../server/pearlMutationGate.mjs';
import { batchOperation } from '../../server/pearlBatch.mjs';
import { World } from '../../src/sim/world.js';
import { installInventory } from '../../src/sim/systems/inventory.js';
import { WORLD, A, op, seed as seedBatch, request as batchRequest } from './pearl-batch.mjs';
import { map } from '../helpers.mjs';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clone = (value) => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
export const startupClock = (ground) => ({ availableAt: ground.availableAt, returnAt: ground.returnAt });

async function seedGround(store, journal, { count = 2, prefix = 'startup' } = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const raw = { operationId: op(900 + i), uid: `${prefix}-${String(i).padStart(3, '0')}`,
      kind: ['brasa', 'tinta'][i % 2], from: null, to: null, expectedVersion: 0, world: WORLD,
      ground: { x: i + 0.5, z: -i - 0.75, availableAt: 50 + i, returnAt: 500 + i }, profiles: [] };
    await journal.prepare('ground', raw);
    assert.equal((await store.commitPearlGround(raw)).ok, true);
    await journal.resolve('ground', raw, 'committed');
    rows.push(raw);
  }
  return rows;
}

export async function startupFixture({ backend, seed = true, count = 2, prefix = 'startup', wrapStore = (value) => value,
  worldTick = 100, scope = WORLD, mapClock = startupClock } = {}) {
  const database = backend ? await backend() : {};
  const base = database.store ?? createMemoryStore();
  const journal = database.journal ?? createMemoryPearlJournals(base)(scope);
  const rows = seed ? await seedGround(base, journal, { count, prefix }) : [];
  const store = wrapStore(base);
  const sessions = new ProfileSessions(store, () => {}, { journal });
  const world = new World(42, { map, server: true }); installInventory(world, WORLD);
  world.tick = worldTick; world.events.length = 0;
  const startup = (options = {}) => new PearlStartup({ sessions, world, worldId: options.worldId ?? WORLD,
    mapClock: options.mapClock ?? mapClock, pageSize: options.pageSize ?? 2, maxRows: options.maxRows ?? 64 });
  return { database, base, store, journal, sessions, world, rows, startup,
    close: () => database.close?.() };
}

export const runtimeState = (world) => clone({ profiles: [...world.profiles], drops: [...world.drops],
  ledger: [...world.pearlLedger], nextDrop: world.nextDrop, tick: world.tick, events: world.events,
  rng: world.rng.state(), lootRng: world.lootRng.state() });

function pendingGround(uid, operationId = op(990), ground = { x: 3, z: -4, availableAt: 7, returnAt: 70 }) {
  return { operationId, uid, kind: 'escarcha', from: null, to: null, expectedVersion: 0, world: WORLD,
    ground, profiles: [] };
}

export function pearlStartupContract(setup) {
  test('configuration rejects missing journal, mismatched scope, invalid world, clock and limits', async () => {
    const f = await setup({ seed: false });
    try {
      const sessionsWithoutJournal = new ProfileSessions(f.store, () => {});
      assert.throws(() => new PearlStartup({ sessions: sessionsWithoutJournal, world: f.world, worldId: WORLD, mapClock: startupClock }), { code: 'configuration' });
      assert.throws(() => f.startup({ worldId: 'other:world' }), { code: 'configuration' });
      assert.throws(() => f.startup({ worldId: 'bad world' }), { code: 'operation' });
      assert.throws(() => new PearlStartup({ sessions: f.sessions, world: f.world, worldId: WORLD, mapClock: null }), { code: 'configuration' });
      assert.throws(() => new PearlStartup({ sessions: f.sessions, world: f.world, worldId: WORLD, mapClock: startupClock, pageSize: 0 }), { code: 'configuration' });
    } finally { await f.close(); }
  });

  test('global gate is held before first recovery I/O and through the admitting-to-hydration microtask gap', async () => {
    const entered = deferred(), releaseList = deferred(), afterRecovery = deferred(), releaseRecovery = deferred();
    const f = await setup({ seed: false });
    const realList = f.journal.list.bind(f.journal);
    f.sessions.pearls.journal = { ...f.journal, async list(options) { entered.resolve(); await releaseList.promise; return realList(options); } };
    const recover = f.sessions.recoverPearls.bind(f.sessions);
    f.sessions.recoverPearls = async () => { const out = await recover(); afterRecovery.resolve(); await releaseRecovery.promise; return out; };
    try {
      const before = runtimeState(f.world), h = f.startup(), work = h.start();
      assert.equal(h.state, 'recovering');
      await entered.promise;
      assert.deepEqual(runtimeState(f.world), before);
      await assert.rejects(f.sessions.open(1, ACCOUNT), { code: 'recovery' });
      assert.throws(() => pearlMutationGate(f.sessions).reserve({ uids: ['never-seen-uid'] }), { code: 'recovery' });
      assert.equal(h.start(), work, 'concurrent callers share one recovery task');
      releaseList.resolve(); await afterRecovery.promise;
      assert.equal(f.sessions.pearls.admitting, true);
      await assert.rejects(f.sessions.open(2, ACCOUNT), { code: 'busy' });
      assert.throws(() => pearlMutationGate(f.sessions).assertSnapshotAvailable({ accounts: [ACCOUNT] }), { code: 'busy' });
      releaseRecovery.resolve();
      assert.deepEqual(await work, { state: 'prepared', count: 0 });
      assert.equal(h.state, 'prepared');
      assert.deepEqual(h.drain(), { state: 'ready', count: 0 });
    } finally { releaseList.resolve(); releaseRecovery.resolve(); await f.close(); }
  });

  test('startup blocks every unknown lane while preparing, then only synchronous drain exposes hydrated ground', async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ wrapStore: (base) => ({ ...base, async listPearlGround(world, options) {
      entered.resolve(); await release.promise; return base.listPearlGround(world, options);
    } }) });
    try {
      const before = runtimeState(f.world), h = f.startup(), first = h.start(), second = h.start();
      assert.equal(first, second); await entered.promise;
      assert.equal(h.state, 'loading'); assert.deepEqual(h.drain(), { state: 'loading' });
      assert.deepEqual(runtimeState(f.world), before);
      await assert.rejects(f.sessions.open(3, ACCOUNT), { code: 'busy' });
      assert.throws(() => pearlMutationGate(f.sessions).reserve({ uids: ['unknown-ground-lane'] }), { code: 'busy' });
      release.resolve(); assert.deepEqual(await first, { state: 'prepared', count: 2 });
      assert.deepEqual(runtimeState(f.world), before); assert.equal(h.state, 'prepared');
      assert.deepEqual(h.drain(), { state: 'ready', count: 2 });
      assert.equal(h.ready, true); assert.equal(f.world.drops.size, 2); assert.equal(f.world.pearlLedger.size, 2);
      const afterApply = runtimeState(f.world);
      assert.deepEqual(h.drain(), { state: 'ready', count: 2 });
      assert.deepEqual(runtimeState(f.world), afterApply);
      assert.deepEqual(await f.journal.list(), []);
    } finally { release.resolve(); await f.close(); }
  });

  test('unreceipted pending journal fences startup and retains exact queue reservations without dispatch', async () => {
    let commits = 0;
    const f = await setup({ seed: false, wrapStore: (base) => ({ ...base,
      async commitPearl(...args) { commits++; return base.commitPearl(...args); },
      async commitPearlGround(...args) { commits++; return base.commitPearlGround(...args); },
      async commitPearlBatch(...args) { commits++; return base.commitPearlBatch(...args); },
    }) });
    try {
      const intent = pendingGround('no-receipt-ground'); await f.journal.prepare('ground', intent);
      const before = runtimeState(f.world), h = f.startup();
      await assert.rejects(h.start(), { code: 'busy' });
      assert.equal(h.state, 'fenced'); assert.deepEqual(runtimeState(f.world), before); assert.equal(commits, 0);
      assert.equal(f.sessions.pearls.unresolved.has(intent.operationId), true);
      assert.equal(f.sessions.pearls.uids.has(intent.uid), true);
      assert.equal(f.sessions.pearls.operationIds.has(intent.operationId), true);
      assert.deepEqual(await f.journal.list(), [{ operationId: intent.operationId, scope: WORLD,
        family: 'ground', request: { uid: intent.uid, kind: intent.kind, from: null, to: null,
          expectedVersion: 0, world: WORLD, ground: intent.ground, profiles: [] }, state: 'pending' }]);
      await assert.rejects(f.sessions.open(4, ACCOUNT), { code: 'busy' });
    } finally { await f.close(); }
  });

  test('pending committed ground receipt is reconciled before hydration', async () => {
    const f = await setup({ seed: false });
    try {
      const raw = pendingGround('receipt-ground');
      await f.journal.prepare('ground', raw); assert.equal((await f.base.commitPearlGround(raw)).ok, true);
      const h = f.startup(); assert.deepEqual(await h.start(), { state: 'prepared', count: 1 });
      assert.equal(h.state, 'prepared'); assert.equal(f.world.drops.size, 0);
      assert.deepEqual(await f.journal.list(), []);
      assert.deepEqual(h.drain(), { state: 'ready', count: 1 });
      assert.deepEqual([...f.world.drops.values()][0].pearl, { uid: raw.uid, kind: raw.kind });
    } finally { await f.close(); }
  });

  test('advanced durable ground closes historical intent as conflict and hydrates the current location', async () => {
    const f = await setup({ seed: false });
    try {
      const historical = pendingGround('advanced-ground', op(991));
      await f.journal.prepare('ground', historical); assert.equal((await f.base.commitPearlGround(historical)).ok, true);
      const current = { ...pendingGround(historical.uid, op(992), { x: 19, z: -21, availableAt: 23, returnAt: 230 }), expectedVersion: 1 };
      assert.equal((await f.base.commitPearlGround(current)).ok, true);
      const h = f.startup(); assert.deepEqual(await h.start(), { state: 'prepared', count: 1 });
      assert.deepEqual(await f.journal.list(), []);
      assert.equal((await f.journal.prepare('ground', historical)).state, 'conflict');
      assert.deepEqual(h.drain(), { state: 'ready', count: 1 });
      const drop = [...f.world.drops.values()][0];
      assert.deepEqual({ x: drop.x, z: drop.z, pickAt: drop.pickAt, t: drop.t },
        { x: current.ground.x, z: current.ground.z, pickAt: current.ground.availableAt, t: current.ground.returnAt });
      assert.equal((await f.base.loadPearlLocation(historical.uid)).version, 2);
    } finally { await f.close(); }
  });

  test('recovery failure fences globally without changing the empty World', async () => {
    const f = await setup({ seed: false });
    try {
      const before = runtimeState(f.world), real = f.sessions.recoverPearls.bind(f.sessions);
      f.sessions.recoverPearls = async () => { await real(); throw new StoreError('unavailable'); };
      const h = f.startup(); await assert.rejects(h.start(), { code: 'unavailable' });
      assert.equal(h.state, 'fenced'); assert.deepEqual(runtimeState(f.world), before);
      await assert.rejects(f.sessions.open(5, ACCOUNT), { code: 'busy' });
    } finally { await f.close(); }
  });

  test('World tick, map identities, drop counter and map contents are captured across journal recovery', async (t) => {
    for (const [name, mutate] of [['tick', (w) => { w.tick++; }], ['drops Map', (w) => { w.drops = new Map(); }],
      ['ledger Map', (w) => { w.pearlLedger = new Map(); }], ['profiles Map', (w) => { w.profiles = new Map(); }],
      ['nextDrop', (w) => { w.nextDrop++; }],
      ['in-place drops', (w) => { w.drops.set(77, { id: 77, to: 0, kind: 'pearl', pearl: { uid: 'external', kind: 'brasa' }, x: 1, z: 2, pickAt: 3, t: 4 }); }],
      ['in-place ledger', (w) => { w.pearlLedger.set('external', { owner: '', entity: 0, place: 'ground', drop: 77 }); }]]) {
      await t.test(name, async () => {
        const entered = deferred(), release = deferred(), f = await setup({ seed: false });
        const real = f.sessions.recoverPearls.bind(f.sessions);
        f.sessions.recoverPearls = async () => { entered.resolve(); await release.promise; return real(); };
        try {
          const h = f.startup(), work = h.start(); await entered.promise; mutate(f.world);
          const afterExternalMutation = runtimeState(f.world); release.resolve();
          await assert.rejects(work, { code: 'conflict' }); assert.equal(h.state, 'fenced');
          assert.deepEqual(runtimeState(f.world), afterExternalMutation, 'the startup barrier installs no owned records after drift');
        } finally { release.resolve(); await f.close(); }
      });
    }
  });

  test('competing coordinator and direct hydrator cannot take startup recovery capability', async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ seed: false });
    const real = f.sessions.recoverPearls.bind(f.sessions);
    f.sessions.recoverPearls = async () => { entered.resolve(); await release.promise; return real(); };
    try {
      const h = f.startup(), work = h.start(); await entered.promise;
      assert.throws(() => f.startup().start(), { code: 'busy' });
      assert.throws(() => new PearlGroundHydration({ sessions: f.sessions, world: f.world, worldId: WORLD,
        mapClock: startupClock }).start(), { code: 'busy' });
      release.resolve(); assert.deepEqual(await work, { state: 'prepared', count: 0 }); h.drain();
    } finally { release.resolve(); await f.close(); }
  });

  test('cancel during recovery is sticky after reads settle and never installs World state', async () => {
    const entered = deferred(), release = deferred(), f = await setup({ seed: false });
    const real = f.sessions.recoverPearls.bind(f.sessions);
    f.sessions.recoverPearls = async () => { entered.resolve(); await release.promise; return real(); };
    try {
      const before = runtimeState(f.world), h = f.startup(), work = h.start(); await entered.promise;
      assert.deepEqual(h.cancel(), { state: 'fenced' }); release.resolve();
      await assert.rejects(work, { code: 'cancelled' }); assert.equal(h.state, 'fenced');
      assert.deepEqual(runtimeState(f.world), before); assert.deepEqual(h.drain(), { state: 'fenced' });
    } finally { release.resolve(); await f.close(); }
  });

  test('cancel during hydration keeps late page result out of World', async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ wrapStore: (base) => ({ ...base, async listPearlGround(world, options) {
      entered.resolve(); await release.promise; return base.listPearlGround(world, options);
    } }) });
    try {
      const before = runtimeState(f.world), h = f.startup(), work = h.start(); await entered.promise;
      assert.equal(h.state, 'loading'); assert.deepEqual(h.cancel(), { state: 'fenced' });
      release.resolve(); await assert.rejects(work, { code: 'cancelled' });
      assert.deepEqual(runtimeState(f.world), before); assert.equal(h.state, 'fenced');
    } finally { release.resolve(); await f.close(); }
  });

  test('synchronous cancellation from the first page read remains sticky', async () => {
    const entered = deferred(), release = deferred();
    let h;
    const f = await setup({ wrapStore: (base) => ({ ...base, async listPearlGround(world, options) {
      h.cancel(); entered.resolve(); await release.promise; return base.listPearlGround(world, options);
    } }) });
    try {
      const before = runtimeState(f.world); h = f.startup(); const work = h.start();
      await entered.promise; assert.equal(h.state, 'fenced');
      release.resolve(); await assert.rejects(work, { code: 'cancelled' });
      assert.equal(h.state, 'fenced'); assert.deepEqual(runtimeState(f.world), before);
    } finally { release.resolve(); await f.close(); }
  });

  test('cancel while prepared is sticky and ready coordinator rejects cancellation', async () => {
    const f = await setup(), fresh = await setup();
    try {
      const before = runtimeState(f.world), h = f.startup(); await h.start();
      assert.equal(h.state, 'prepared'); assert.deepEqual(h.cancel(), { state: 'fenced' });
      assert.deepEqual(runtimeState(f.world), before); assert.deepEqual(h.drain(), { state: 'fenced' });
      const ready = fresh.startup(); await ready.start(); ready.drain();
      assert.throws(() => ready.cancel(), { code: 'operation' });
    } finally { await f.close(); await fresh.close(); }
  });

  test('async mapper is rejected and fences startup without installation', async () => {
    const f = await setup();
    try {
      const before = runtimeState(f.world), h = f.startup({ mapClock: async (ground) => startupClock(ground) });
      await assert.rejects(h.start(), { code: 'operation' });
      assert.equal(h.state, 'fenced'); assert.deepEqual(runtimeState(f.world), before);
    } finally { await f.close(); }
  });

  test('hydration conflict rolls back only its own partial installs and leaves startup fenced', async () => {
    const f = await setup();
    try {
      const external = { owner: 'external', entity: 8, place: 'bag', drop: 0 };
      f.world.pearlLedger.set('external-owner', external);
      const ownedUid = f.rows[0].uid;
      let injected = 0;
      const nativeSet = f.world.pearlLedger.set.bind(f.world.pearlLedger);
      f.world.pearlLedger.set = function (key, value) {
        if (key === ownedUid && injected++ === 0) { Map.prototype.set.call(this, key, value); throw new StoreError('unavailable'); }
        return nativeSet(key, value);
      };
      const h = f.startup(); await h.start();
      assert.deepEqual(h.drain(), { state: 'fenced', why: 'unavailable' });
      assert.equal(injected, 1, 'the failure occurs after World installation begins');
      assert.equal(h.state, 'fenced'); assert.equal(f.world.drops.size, 0);
      assert.deepEqual([...f.world.pearlLedger], [['external-owner', external]]);
      assert.equal(f.world.nextDrop, 1);
      await assert.rejects(f.sessions.open(6, ACCOUNT), { code: 'busy' });
    } finally { await f.close(); }
  });

  test('pending batch replace receipt conflict hydrates current outgoing ground and preserves newer character progress', async () => {
    const calls = { batchDispatch: 0 };
    const f = await setup({ seed: false, wrapStore: (base) => ({ ...base,
      async commitPearlBatch(...args) { calls.batchDispatch++; return base.commitPearlBatch(...args); },
    }) });
    try {
      const seeded = await seedBatch(f.base), replace = batchRequest(seeded, 'replace', op(993));
      const { request: payload } = batchOperation(replace);
      await f.journal.prepare('batch', { operationId: replace.operationId, ...payload });
      assert.equal((await f.base.commitPearlBatch(replace)).ok, true);
      const committed = await f.base.loadProfile(A), current = committed.data;
      current.gold += 13; current.xp += 29; current.mast[0][1] += 17;
      assert.equal((await f.base.saveProfile(A, current, committed.version)).ok, true);
      const latest = await f.base.loadProfile(A), before = clone(latest.data);
      const h = f.startup(); assert.deepEqual(await h.start(), { state: 'prepared', count: 1 });
      assert.deepEqual(await f.journal.list(), []);
      assert.equal((await f.journal.prepare('batch', { operationId: replace.operationId, ...payload })).state, 'conflict');
      assert.equal(calls.batchDispatch, 0, 'recovery reads the receipt without resending the request');
      assert.deepEqual(h.drain(), { state: 'ready', count: 1 });
      const dropped = replace.items.find((item) => item.ground !== null), retained = replace.items.find((item) => item.ground === null);
      assert.equal(f.world.pearlLedger.has(dropped.uid), true);
      assert.equal(f.world.pearlLedger.has(retained.uid), false, 'the historically incoming pearl remains owned');
      const opened = await f.sessions.open(40, A);
      assert.equal(opened.gold, before.gold); assert.equal(opened.xp, before.xp);
      assert.deepEqual(opened.mast, before.mast); assert.equal(opened.pearls.swallowed.uid, retained.uid);
      assert.equal(opened.pearls.bag.some((item) => item.uid === dropped.uid), false);
    } finally { await f.close(); }
  });
}
