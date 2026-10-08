import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { PearlGroundHydration } from '../../server/pearlGroundHydration.mjs';
import { World } from '../../src/sim/world.js';
import { installInventory } from '../../src/sim/systems/inventory.js';
import { map } from '../helpers.mjs';
import { seedGround } from './pearl-ground-hydration-contract.mjs';
import { seedDeathDropScenario, pickupRequest, expiryRequest, WORLD, deathOp } from './death-drop-storage.mjs';

export { WORLD };
const PEARL_WORLD = WORLD;
const copy = structuredClone;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
export const clockMap = (ground) => ({ availableAt: ground.availableAt, returnAt: ground.returnAt });

export async function fixture({ backend, pearls = 2, sources = 1, pageSize = 2, maxRows = 128,
  wrapStore = (base) => base, worldTick = 10 } = {}) {
  const db = backend ? await backend() : {};
  const base = db.store ?? createMemoryStore();
  const memoryJournals = db.journal ? null : createMemoryPearlJournals(base);
  const journal = db.journal ? (typeof db.journal === 'function' ? db.journal(PEARL_WORLD) : db.journal) : memoryJournals(PEARL_WORLD);
  if (pearls) await seedGround(base, journal, { count: pearls, uidPrefix: 'mixed-hydration', operationStart: 330, worldId: PEARL_WORLD });
  const scenarios = sources ? [await seedDeathDropScenario(base, { sourceOperation: 570, seed: 90 })] : [];
  const store = wrapStore(base);
  const errors = [], sessions = new ProfileSessions(store, (_id, code) => errors.push(code), { journal });
  await sessions.recoverPearls();
  const world = new World(42, { map, server: true }); installInventory(world, PEARL_WORLD);
  world.tick = worldTick; world.events.length = 0;
  const hydrator = (options = {}) => new PearlGroundHydration({ sessions, world, worldId: PEARL_WORLD,
    deathDrops: true, pageSize: options.pageSize ?? pageSize, maxRows: options.maxRows ?? maxRows,
    mapClock: options.mapClock ?? clockMap });
  const dropJournal = db.journal && typeof db.journal === 'function' ? db.journal(WORLD) : memoryJournals(WORLD);
  return { db, base, store, journal, dropJournal, sessions, world, errors, scenarios, hydrator,
    close: () => db.close?.() };
}

export const runtimeState = (w) => copy({ profiles: [...w.profiles], drops: [...w.drops], ledger: [...w.pearlLedger],
  nextDrop: w.nextDrop, tick: w.tick, events: w.events, rng: w.rng.state(), lootRng: w.lootRng.state() });

function sourceDeathId(source) { return source.request.operationId; }
function dropRows(source) { return source.death.drops.filter((d) => ['item', 'potion'].includes(d.kind)); }

export function deathDropHydrationContract(setup) {
  test('mixed paginated current scan checks source and live state, then atomically installs pearl, item, potion', async () => {
    const f = await setup({ pearls: 3, sources: 1, pageSize: 2 });
    try {
      const before = runtimeState(f.world), h = f.hydrator(), ready = await h.start();
      assert.deepEqual(ready, { state: 'ready', count: 3 + f.scenarios.reduce((n, s) => n + dropRows(s).length, 0) });
      assert.deepEqual(runtimeState(f.world), before);
      const installed = h.drain(); assert.deepEqual(installed, { state: 'applied', count: ready.count });
      const rows = [...f.world.drops.values()];
      assert.ok(rows.some((d) => d.kind === 'pearl'));
      assert.ok(rows.some((d) => d.kind === 'item'));
      assert.ok(rows.some((d) => d.kind === 'potion'));
      for (const source of f.scenarios) for (const raw of dropRows(source)) {
        const drop = rows.find((d) => d.operationId === sourceDeathId(source) && d.ordinal === raw.ordinal);
        assert.ok(drop, 'ordinary drop has a fresh local entity');
        assert.equal(drop.to, 0); assert.equal(drop.kind, raw.kind); assert.equal(drop.x, raw.ground.x); assert.equal(drop.z, raw.ground.z);
        assert.equal(drop.t, raw.ground.expiresAt); assert.equal(drop.pickAt, raw.ground.availableAt);
        assert.ok(Number.isSafeInteger(drop.id));
        assert.ok(drop.id >= 1);
      }
      assert.equal(f.world.events.length, 0); assert.deepEqual(h.drain(), installed);
    } finally { await f.close(); }
  });

  test('cursor crosses death UUIDs without skipping ordinal pages or repeating a source receipt', async () => {
    const f = await setup({ pearls: 0, sources: 1, pageSize: 2 });
    try {
      const next = copy(f.scenarios[0].request); next.operationId = deathOp(571);
      for (const p of next.profiles) {
        const current = await f.base.loadProfile(p.id);
        const saved = await f.base.saveProfile(p.id, p.before, current.version);
        assert.equal(saved.ok, true); p.expectedVersion = saved.version;
      }
      assert.equal((await f.base.commitDeath(next)).ok, true);
      let loads = 0; const store = { ...f.base, async loadDeathOperation(id) { loads++; return f.base.loadDeathOperation(id); } };
      f.sessions.store = store;
      const h = f.hydrator(); await h.start(); assert.equal(h.drain().state, 'applied');
      const ordinary = [...f.world.drops.values()];
      assert.equal(ordinary.length, f.scenarios[0].death.drops.length + next.drops.length);
      assert.deepEqual([...new Set(ordinary.map(d => d.operationId))], [f.scenarios[0].request.operationId, next.operationId]);
      assert.equal(new Set(ordinary.map(d => d.operationId + ':' + d.ordinal)).size, ordinary.length);
      assert.equal(loads, 2, 'one immutable source receipt per death across all ordinal pages');
    } finally { await f.close(); }
  });

  test('terminal picked and expired rows are omitted while expired current drops keep original deadlines', async () => {
    const f = await setup({ pearls: 0, sources: 1 });
    try {
      const [source] = f.scenarios;
      const picked = await pickupRequest(f.base, source, { operation: 851 });
      await f.dropJournal.prepare('drop', picked);
      assert.equal((await f.base.commitDeathDrop(picked)).ok, true);
      await f.dropJournal.resolve('drop', picked, 'committed');
      source.itemDrop = source.potionDrop;
      const expired = await expiryRequest(source, { operation: 852 });
      await f.dropJournal.prepare('drop', expired);
      assert.equal((await f.base.commitDeathDrop(expired)).ok, true);
      await f.dropJournal.resolve('drop', expired, 'committed');
      f.world.tick = Math.max(...dropRows(source).map(d => d.ground.expiresAt)) + 1;
      const h = f.hydrator(); await h.start(); const result = h.drain();
      assert.equal(result.count, dropRows(source).length - 2);
      assert.equal(f.world.drops.size, result.count);
      for (const d of f.world.drops.values()) {
        const sourceDrop = dropRows(source).find((row) => row.ordinal === d.ordinal);
        assert.ok(sourceDrop); assert.equal(d.t, sourceDrop.ground.expiresAt);
      }
    } finally { await f.close(); }
  });

  test('recovery reconciles a committed pickup with a lost response before hydration and never resurrects it', async () => {
    const f = await setup({ pearls: 0, sources: 1 });
    try {
      const source = f.scenarios[0], pickup = await pickupRequest(f.base, source, { operation: 853 });
      await f.dropJournal.prepare('drop', pickup);
      const receipt = await f.base.commitDeathDrop(pickup); assert.equal(receipt.ok, true);
      const recovered = new ProfileSessions(f.store, () => {}, { journal: f.journal });
      await recovered.recoverPearls();
      assert.equal((await f.journal.list()).length, 0);
      const w = new World(125, { map, server: true }); installInventory(w, PEARL_WORLD);
      const h = new PearlGroundHydration({ sessions: recovered, world: w, worldId: PEARL_WORLD,
        deathDrops: true, pageSize: 2, mapClock: clockMap });
      await h.start(); const result = h.drain();
      assert.equal(result.count, dropRows(source).length - 1);
      assert.equal([...w.drops.values()].some((d) => d.operationId === pickup.drop.operationId && d.ordinal === pickup.drop.ordinal), false);
    } finally { await f.close(); }
  });

  test('unreceipted exact drop intent remains fenced and prevents startup hydration', async () => {
    const f = await setup({ pearls: 0, sources: 1 });
    try {
      const pending = await expiryRequest(f.scenarios[0], { operation: 854 });
      await f.dropJournal.prepare('drop', pending);
      const recovered = new ProfileSessions(f.store, () => {}, { journal: f.journal });
      await recovered.recoverPearls();
      const w = new World(126, { map, server: true }); installInventory(w, PEARL_WORLD);
      const h = new PearlGroundHydration({ sessions: recovered, world: w, worldId: PEARL_WORLD,
        deathDrops: true, mapClock: clockMap });
      assert.throws(() => h.start(), { code: 'busy' }); assert.equal(h.state, 'idle');
      assert.equal((await f.base.loadDeathDrop(pending.drop.operationId, pending.drop.ordinal)).state, 'ground');
    } finally { await f.close(); }
  });

  test('new World on the same store keeps durable absolute deadlines before, within, and after the window', async () => {
    const f = await setup({ pearls: 0, sources: 1 });
    try {
      const source = f.scenarios[0], expected = dropRows(source);
      for (const tick of [0, expected[0].ground.availableAt, expected[0].ground.expiresAt + 100]) {
        const w = new World(101 + tick, { map, server: true }); installInventory(w, PEARL_WORLD); w.tick = tick;
        const h = new PearlGroundHydration({ sessions: f.sessions, world: w, worldId: PEARL_WORLD,
          deathDrops: true, pageSize: 2, mapClock: clockMap });
        const ready = await h.start(); assert.equal(ready.count, expected.length);
        const result = h.drain(); assert.equal(result.count, expected.length);
        for (const row of expected) {
          const d = [...w.drops.values()].find((q) => q.operationId === sourceDeathId(source) && q.ordinal === row.ordinal);
          assert.equal(d.t, row.ground.expiresAt); assert.equal(d.pickAt, row.ground.availableAt);
        }
      }
    } finally { await f.close(); }
  });

  test('barrier is held from the first read and a single drain installs both families', async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ wrapStore: (base) => ({ ...base, async listCurrentDeathDrops(...args) {
      entered.resolve(); await release.promise; return base.listCurrentDeathDrops(...args);
    } }) });
    try {
      const before = runtimeState(f.world), h = f.hydrator(), work = h.start(); await entered.promise;
      assert.deepEqual(h.drain(), { state: 'pending' }); assert.deepEqual(runtimeState(f.world), before);
      assert.throws(() => f.hydrator().start(), { code: 'busy' });
      release.resolve(); await work; assert.deepEqual(runtimeState(f.world), before);
      const first = h.drain(); assert.equal(first.state, 'applied'); assert.deepEqual(h.drain(), first);
    } finally { release.resolve(); await f.close(); }
  });

  test('bad source receipt, current row, duplicate source marker, or changed second scan fences with no apply', async (t) => {
    const mutations = [
      ['missing source receipt', (base) => ({ store: { ...base, async loadDeathOperation() { return null; } } })],
      ['current state disagrees with listed row', (base) => ({ store: { ...base, async loadDeathDrop(...args) {
        const row = await base.loadDeathDrop(...args); return row && { ...row, state: 'picked', version: 2 };
      } } })],
      ['source receipt does not contain the listed drop', (base) => ({ store: { ...base, async loadDeathOperation(...args) {
        const receipt = await base.loadDeathOperation(...args);
        if (!receipt) return null;
        const changed = copy(receipt); changed.result.drops[0].ground.x++;
        return changed;
      } } })],
      ['duplicate source marker already installed', (_base) => ({ prepare: (f) => { f.world.drops.set(70, { id: 70, to: 0, kind: 'item',
        operationId: f.scenarios[0].death.drops[0].operationId, ordinal: f.scenarios[0].death.drops[0].ordinal }); } })],
      ['second current scan drifts', (base) => { let calls = 0; return { store: { ...base, async listCurrentDeathDrops(...args) {
        const rows = await base.listCurrentDeathDrops(...args); if (++calls === 4 && rows.length) rows[0].ground.x++;
        return rows;
      } } }; }],
    ];
    for (const [name, change] of mutations) await t.test(name, async () => {
      const f = await setup({ pearls: 1, sources: 1 });
      const action = change(f.base);
      if (action.store) f.sessions.store = action.store;
      action.prepare?.(f);
      try {
        const h = f.hydrator(), before = runtimeState(f.world);
        if (action.prepare) {
          await h.start(); assert.equal(h.drain().state, 'fenced');
        } else { await assert.rejects(h.start()); assert.equal(h.state, 'fenced'); }
        assert.deepEqual(runtimeState(f.world), before);
      }
      finally { await f.close(); }
    });
  });

  test('source scans are bounded and malformed/rejected reads fail closed', async (t) => {
    const f = await setup({ pearls: 1, sources: 1 });
    try {
      const h = f.hydrator({ maxRows: 1 }); await assert.rejects(h.start(), { code: 'capacity' });
      assert.equal(h.state, 'fenced');
    } finally { await f.close(); }
    const f2 = await setup({ pearls: 0, sources: 1, wrapStore: (base) => ({ ...base,
      async listCurrentDeathDrops() { throw new Error('offline'); } }) });
    try { const h = f2.hydrator(); await assert.rejects(h.start()); assert.equal(h.state, 'fenced'); }
    finally { await f2.close(); }
  });

  test('cancel during a source page read is sticky and installs neither family', async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ wrapStore: (base) => ({ ...base, async listCurrentDeathDrops(...args) {
      entered.resolve(); await release.promise; return base.listCurrentDeathDrops(...args);
    } }) });
    try {
      const before = runtimeState(f.world), h = f.hydrator(), work = h.start(); await entered.promise;
      assert.deepEqual(h.cancel(), { state: 'fenced' }); release.resolve(); await assert.rejects(work);
      assert.deepEqual(h.drain(), { state: 'fenced' }); assert.deepEqual(runtimeState(f.world), before);
    } finally { release.resolve(); await f.close(); }
  });

  test('drop capacity or a second-family insert failure rolls back every family', async (t) => {
    await t.test('counter capacity', async () => {
      const f = await setup({ pearls: 1, sources: 1 }); try {
        f.world.nextDrop = Number.MAX_SAFE_INTEGER - 2; const h = f.hydrator(); await h.start();
        const result = h.drain(); assert.equal(result.why, 'capacity'); assert.equal(f.world.drops.size, 0);
      } finally { await f.close(); }
    });
    await t.test('late counter assignment throws', async () => {
      const f = await setup({ pearls: 1, sources: 1 }); try {
        const h = f.hydrator(); await h.start();
        Object.defineProperty(f.world, 'nextDrop', { value: f.world.nextDrop, writable: false, configurable: true, enumerable: true });
        const before = runtimeState(f.world), result = h.drain(); assert.equal(result.state, 'fenced');
        assert.deepEqual(runtimeState(f.world), before);
      } finally { await f.close(); }
    });
  });
}
