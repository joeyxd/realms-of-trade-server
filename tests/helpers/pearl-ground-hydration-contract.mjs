import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, StoreError } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { PearlGroundHydration } from '../../server/pearlGroundHydration.mjs';
import { pearlMutationGate } from '../../server/pearlMutationGate.mjs';
import { createSupabasePearlJournal } from '../../server/pearlJournal.mjs';
import { World } from '../../src/sim/world.js';
import { newProfile, installInventory, attachProfile } from '../../src/sim/systems/inventory.js';
import { WORLD, op } from './pearl-batch.mjs';
import { map, A as arena } from '../helpers.mjs';

export { WORLD };
export const clockMap = (ground) => ({ availableAt: ground.availableAt, returnAt: ground.returnAt });
export const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const types = ['brasa', 'escarcha', 'tormenta', 'tinta'];
const copy = (value) => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

export async function seedGround(store, journal, { count = 5, uidPrefix = 'hydration', worldId = WORLD,
  operationStart = 300 } = {}) {
  const seeded = [];
  for (let i = 0; i < count; i++) {
    const raw = { operationId: op(operationStart + i), uid: `${uidPrefix}-${String(i).padStart(3, '0')}`,
      kind: types[i % types.length], from: null, to: null, expectedVersion: 0, world: worldId,
      ground: { x: i + 0.25, z: -i - 0.75, availableAt: i < 2 ? 2 : 600 + i, returnAt: i < 2 ? 15 : 2700 + i },
      profiles: [] };
    await journal.prepare('ground', raw);
    assert.equal((await store.commitPearlGround(raw)).ok, true);
    await journal.resolve('ground', raw, 'committed');
    seeded.push(raw);
  }
  return seeded;
}

export async function fixture({ backend, count = 5, uidPrefix = 'hydration', wrapStore = (base) => base,
  worldTick = 100, seed = true, foreignCount = 0 } = {}) {
  const database = backend ? await backend() : {};
  const base = database.store ?? createMemoryStore();
  const journal = database.journal ?? createMemoryPearlJournals(base)(WORLD);
  const seeded = seed ? await seedGround(base, journal, { count, uidPrefix }) : [];
  const foreignWorld = 'other:world';
  if (foreignCount) {
    const foreignJournal = database.client ? createSupabasePearlJournal(database.client, foreignWorld) :
      createMemoryPearlJournals(base)(foreignWorld);
    await seedGround(base, foreignJournal, { count: foreignCount, uidPrefix: 'foreign-ground', worldId: foreignWorld,
      operationStart: 700 });
  }
  const store = wrapStore(base);
  const errors = [], sessions = new ProfileSessions(store, (_id, code) => errors.push(code), { journal });
  await sessions.recoverPearls();
  const world = new World(42, { map, server: true }); installInventory(world, WORLD);
  world.tick = worldTick;
  world.events.length = 0;
  const hydrator = (options = {}) => new PearlGroundHydration({ sessions, world, worldId: WORLD,
    mapClock: options.mapClock ?? clockMap, pageSize: options.pageSize ?? 2, maxRows: options.maxRows ?? 64 });
  return { database, base, store, journal, sessions, world, errors, seeded, foreignWorld, hydrator,
    close: () => database.close?.() };
}

export const runtimeState = (world) => copy({ profiles: [...world.profiles], drops: [...world.drops],
  ledger: [...world.pearlLedger], nextDrop: world.nextDrop, tick: world.tick, events: world.events,
  rng: world.rng.state(), lootRng: world.lootRng.state() });

export function groundHydrationContract(setup) {
  test('paged scan validates both authorities, maps the caller clock, and installs ground only at drain', async () => {
    const mapped = [], f = await setup({ count: 5, worldTick: 100 });
    try {
      const before = runtimeState(f.world), hydrate = f.hydrator({ mapClock(ground, clock) {
        assert.equal(Object.isFrozen(ground), true); assert.equal(Object.isFrozen(clock), true);
        assert.equal(clock.worldId, WORLD); assert.equal(clock.tick, 100);
        mapped.push(copy(ground)); return { availableAt: ground.availableAt + 1000, returnAt: ground.returnAt + 1000 };
      } });
      const ready = await hydrate.start();
      assert.deepEqual(ready, { state: 'ready', count: 5 }); assert.equal(hydrate.state, 'ready');
      assert.deepEqual(runtimeState(f.world), before, 'all asynchronous preparation leaves World untouched');
      assert.deepEqual(mapped, f.seeded.map((row) => row.ground));
      await assert.rejects(f.sessions.open(1, account), { code: 'busy' });
      const applied = hydrate.drain(); assert.deepEqual(applied, { state: 'applied', count: 5 });
      assert.equal(f.world.profiles.size, 0); assert.equal(f.world.events.length, 0);
      assert.equal(f.world.drops.size, 5); assert.equal(f.world.pearlLedger.size, 5);
      f.seeded.forEach((row, i) => {
        const id = i + 1, drop = f.world.drops.get(id);
        assert.deepEqual(drop, { id, to: 0, kind: 'pearl', pearl: { uid: row.uid, kind: row.kind },
          x: row.ground.x, z: row.ground.z, pickAt: row.ground.availableAt + 1000, t: row.ground.returnAt + 1000 });
        assert.deepEqual(f.world.pearlLedger.get(row.uid), { owner: '', entity: 0, place: 'ground', drop: id });
      });
      assert.equal(f.world.nextDrop, 6);
      const after = runtimeState(f.world);
      assert.deepEqual(hydrate.drain(), applied); assert.deepEqual(runtimeState(f.world), after, 'drain is idempotent');
      assert.deepEqual(await f.journal.list(), []);
    } finally { await f.close(); }
  });

  test('expired persisted ground is retained; the supplied mapper alone controls runtime tick deadlines', async () => {
    const f = await setup({ count: 1, worldTick: 500 });
    try {
      const h = f.hydrator(); assert.deepEqual(await h.start(), { state: 'ready', count: 1 });
      assert.equal(h.drain().state, 'applied');
      const drop = [...f.world.drops.values()][0];
      assert.equal(drop.pickAt, f.seeded[0].ground.availableAt);
      assert.equal(drop.t, f.seeded[0].ground.returnAt);
      assert.ok(drop.t < f.world.tick); assert.equal(f.world.drops.size, 1);
      assert.deepEqual(await f.base.loadPearlLocation(f.seeded[0].uid), {
        world: WORLD, ground: f.seeded[0].ground, version: 1,
      }, 'hydration does not delete, expire, or rewrite durable location');
    } finally { await f.close(); }
  });

  test('a slow first page holds the global gate before any await and publishes nothing', async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ wrapStore: (base) => ({ ...base, async listPearlGround(world, options) {
      entered.resolve(); await release.promise; return base.listPearlGround(world, options);
    } }) });
    try {
      const before = runtimeState(f.world), h = f.hydrator(), work = h.start();
      await entered.promise; assert.equal(h.state, 'pending'); assert.deepEqual(h.drain(), { state: 'pending' });
      assert.deepEqual(runtimeState(f.world), before);
      assert.throws(() => f.hydrator().start(), { code: 'busy' });
      await assert.rejects(f.sessions.open(1, account), { code: 'busy' });
      release.resolve(); assert.deepEqual(await work, { state: 'ready', count: 5 });
      assert.deepEqual(runtimeState(f.world), before); assert.equal(h.drain().state, 'applied');
    } finally { release.resolve(); await f.close(); }
  });

  test('startup barrier blocks profile snapshots and every storage commit family without building or dispatching', async () => {
    const entered = deferred(), release = deferred(); let builds = 0, sends = 0;
    const f = await setup({ wrapStore: (base) => ({ ...base,
      async listPearlGround(world, options) { entered.resolve(); await release.promise; return base.listPearlGround(world, options); },
      async commitPearl(...args) { sends++; return base.commitPearl(...args); },
      async commitPearlGround(...args) { sends++; return base.commitPearlGround(...args); },
      async commitPearlBatch(...args) { sends++; return base.commitPearlBatch(...args); },
    }) });
    try {
      const h = f.hydrator(), work = h.start(); await entered.promise;
      const gate = pearlMutationGate(f.sessions);
      assert.throws(() => gate.reserve({ accounts: [account], uids: ['barrier-reserve'] }), { code: 'busy' });
      assert.throws(() => gate.assertStorageAuthorized({ accounts: [account], uids: ['barrier-storage'] }), { code: 'busy' });
      assert.throws(() => gate.assertSnapshotAvailable({ accounts: [account], uids: ['barrier-snapshot'] }), { code: 'busy' });
      const ground = { operationId: op(800), uid: 'barrier-ground', kind: 'brasa', from: null, to: null,
        expectedVersion: 0, world: WORLD, ground: { x: 0, z: 0, availableAt: 1, returnAt: 2 } };
      const move = { operationId: op(801), uid: 'barrier-move', kind: 'brasa', from: account,
        to: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expectedVersion: 1 };
      const batch = { operationId: op(802), actor: account, world: WORLD, mode: 'death', items: [
        { uid: 'barrier-batch', kind: 'brasa', expectedVersion: 1,
          ground: { x: 0, z: 0, availableAt: 1, returnAt: 2 } },
      ] };
      await assert.rejects(f.sessions.commitPearlGround(ground, () => { builds++; return []; }), { code: 'busy' });
      await assert.rejects(f.sessions.commitPearl(move, () => { builds++; return []; }), { code: 'busy' });
      await assert.rejects(f.sessions.commitPearlBatch(batch, () => { builds++; return []; }), { code: 'busy' });
      assert.equal(builds, 0); assert.equal(sends, 0);
      release.resolve(); assert.deepEqual(await work, { state: 'ready', count: 5 });
      assert.equal(h.drain().state, 'applied');
    } finally { release.resolve(); await f.close(); }
  });

  test('a second coordinator on the same recovered sessions cannot acquire a parallel hydration capability', async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ wrapStore: (base) => ({ ...base, async listPearlGround(world, options) {
      entered.resolve(); await release.promise; return base.listPearlGround(world, options);
    } }) });
    try {
      const h = f.hydrator(), work = h.start(); await entered.promise;
      const otherWorld = new World(99, { map, server: true }); installInventory(otherWorld, WORLD);
      assert.throws(() => new PearlGroundHydration({ sessions: f.sessions, world: otherWorld, worldId: WORLD,
        mapClock: clockMap }).start(), { code: 'busy' });
      release.resolve(); assert.deepEqual(await work, { state: 'ready', count: 5 });
      assert.equal(h.drain().state, 'applied');
    } finally { release.resolve(); await f.close(); }
  });

  test('hydration requires completed journal recovery with no unresolved intent or live session', async (t) => {
    await t.test('not recovered', async () => {
      const f = await setup();
      try {
        const sessions = new ProfileSessions(f.store, () => {}, { journal: f.journal });
        const h = new (f.hydrator().constructor)({ sessions, world: f.world, worldId: WORLD, mapClock: clockMap });
        assert.throws(() => h.start()); assert.equal(h.state, 'idle'); assert.equal(f.world.drops.size, 0);
      } finally { await f.close(); }
    });
    await t.test('pending recovered journal', async () => {
      const f = await setup();
      try {
        const pending = { operationId: op(390), uid: 'pending-ground', kind: 'brasa', from: null, to: null,
          expectedVersion: 0, world: WORLD, ground: { x: 1, z: 2, availableAt: 3, returnAt: 4 }, profiles: [] };
        await f.journal.prepare('ground', pending);
        const sessions = new ProfileSessions(f.store, () => {}, { journal: f.journal });
        await sessions.recoverPearls();
        const h = new PearlGroundHydration({ sessions, world: f.world, worldId: WORLD, mapClock: clockMap });
        assert.throws(() => h.start(), { code: 'busy' }); assert.equal(h.state, 'idle');
      } finally { await f.close(); }
    });
    await t.test('live session', async () => {
      const f = await setup();
      try {
        await f.sessions.open(90, account);
        assert.throws(() => f.hydrator().start(), { code: 'busy' });
      } finally { await f.close(); }
    });
  });

  test('malformed page, unique mismatch, location mismatch, or changed second scan fences without truncation/apply', async (t) => {
    const cases = [
      ['unsorted page', (base) => ({ ...base, async listPearlGround(world, options) {
        const rows = await base.listPearlGround(world, options); return rows.length > 1 ? rows.reverse() : rows;
      } })],
      ['over-limit page', (base) => ({ ...base, async listPearlGround(world, options) {
        const rows = await base.listPearlGround(world, options); return rows.length === options.limit ? [...rows, rows[0]] : rows;
      } })],
      ['invalid location generation in page', (base) => ({ ...base, async listPearlGround(world, options) {
        const rows = await base.listPearlGround(world, options); if (rows.length) rows[0].version = 0; return rows;
      } })],
      ['unique holder/version mismatch', (base) => ({ ...base, async loadUnique(uid) {
        const row = await base.loadUnique(uid); return { ...row, holder: account, version: row.version + 1 };
      } })],
      ['location changed since scan', (base) => ({ ...base, async loadPearlLocation(uid) {
        const row = await base.loadPearlLocation(uid); return { ...row, ground: { ...row.ground, x: row.ground.x + 1 } };
      } })],
      ['second exact scan changed', (base) => {
        let calls = 0;
        return { ...base, async listPearlGround(world, options) {
          const rows = await base.listPearlGround(world, options);
          if (++calls > 3 && rows.length) rows[0].ground.x++;
          return rows;
        } };
      }],
      ['store list rejection', (base) => ({ ...base, async listPearlGround() { throw new StoreError('unavailable'); } })],
      ['unique read rejection', (base) => ({ ...base, async loadUnique() { throw new StoreError('unavailable'); } })],
    ];
    for (const [name, wrapStore] of cases) await t.test(name, async () => {
      const f = await setup({ wrapStore });
      try {
        const before = runtimeState(f.world), h = f.hydrator();
        await assert.rejects(h.start()); assert.equal(h.state, 'fenced');
        assert.deepEqual(runtimeState(f.world), before); assert.deepEqual(h.drain(), { state: 'fenced' });
        await assert.rejects(f.sessions.open(1, account), { code: 'busy' });
      } finally { await f.close(); }
    });
  });

  test('a rejected unique read waits for its paired location read before fencing', async () => {
    const entered = deferred(), release = deferred();
    const f = await setup({ wrapStore: (base) => ({ ...base,
      async loadUnique() { throw new StoreError('unavailable'); },
      async loadPearlLocation(uid) { entered.resolve(); await release.promise; return base.loadPearlLocation(uid); },
    }) });
    let work;
    try {
      const before = runtimeState(f.world), h = f.hydrator();
      work = h.start();
      await entered.promise;
      let settled = false;
      work.then(() => { settled = true; }, () => { settled = true; });
      await new Promise(setImmediate);
      assert.equal(settled, false);
      assert.equal(h.state, 'pending');
      assert.throws(() => pearlMutationGate(f.sessions).assertSnapshotAvailable({ accounts: [account] }), { code: 'busy' });
      assert.deepEqual(runtimeState(f.world), before);

      release.resolve();
      await assert.rejects(work, { code: 'unavailable' });
      assert.equal(h.state, 'fenced');
      assert.deepEqual(runtimeState(f.world), before);
      assert.throws(() => pearlMutationGate(f.sessions).assertSnapshotAvailable({ accounts: [account] }), { code: 'busy' });
    } finally {
      release.resolve();
      if (work) await work.catch(() => {});
      await f.close();
    }
  });

  test('read bounds and mapClock failures fence instead of installing a partial prefix', async (t) => {
    await t.test('maxRows overflow', async () => {
      const f = await setup({ count: 5 });
      try {
        const before = runtimeState(f.world), h = f.hydrator({ pageSize: 2, maxRows: 3 });
        await assert.rejects(h.start(), { code: 'capacity' }); assert.equal(h.state, 'fenced');
        assert.deepEqual(runtimeState(f.world), before);
      } finally { await f.close(); }
    });
    for (const [name, mapClock] of [
      ['extra metadata key', (g) => ({ availableAt: g.availableAt, returnAt: g.returnAt, policy: 'implicit' })],
      ['invalid interval', (g) => ({ availableAt: g.returnAt, returnAt: g.availableAt })],
      ['asynchronous mapper', async (g) => ({ availableAt: g.availableAt, returnAt: g.returnAt })],
      ['asynchronous mapper rejects', async () => { throw new Error('mapper failed'); }],
      ['mapper throws', () => { throw new StoreError('operation'); }],
    ]) await t.test(name, async () => {
      const f = await setup({ count: 1 });
      try {
        const before = runtimeState(f.world), h = f.hydrator({ mapClock });
        await assert.rejects(h.start()); assert.equal(h.state, 'fenced'); assert.deepEqual(runtimeState(f.world), before);
      } finally { await f.close(); }
    });
  });

  test('world mutation while reading or after ready fences before writing any drop', async (t) => {
    await t.test('movement/tick during await', async () => {
      const entered = deferred(), release = deferred();
      const f = await setup({ wrapStore: (base) => ({ ...base, async listPearlGround(world, options) {
        entered.resolve(); await release.promise; return base.listPearlGround(world, options);
      } }) });
      try {
        const h = f.hydrator(), work = h.start(); await entered.promise; f.world.tick++;
        release.resolve(); await assert.rejects(work, { code: 'conflict' });
        assert.equal(h.state, 'fenced'); assert.equal(f.world.drops.size, 0); assert.equal(f.world.pearlLedger.size, 0);
      } finally { release.resolve(); await f.close(); }
    });
    await t.test('ledger/profile mutation after ready', async () => {
      const f = await setup();
      try {
        const h = f.hydrator(); await h.start(); f.world.profiles.set(1, newProfile());
        f.world.pearlLedger.set('unrelated', { owner: '', entity: 0, place: 'ground', drop: 55 });
        const before = runtimeState(f.world), result = h.drain();
        assert.equal(result.state, 'fenced'); assert.equal(result.why, 'conflict'); assert.deepEqual(runtimeState(f.world), before);
      } finally { await f.close(); }
    });
  });

  test('captured World identities and drop counter cannot be replaced during a page read', async (t) => {
    const changes = [
      ['profile Map identity', (w) => { w.profiles = new Map(); }],
      ['drop Map identity', (w) => { w.drops = new Map(); }],
      ['ledger Map identity', (w) => { w.pearlLedger = new Map(); }],
      ['drop counter', (w) => { w.nextDrop++; }],
    ];
    for (const [name, mutate] of changes) await t.test(name, async () => {
      const entered = deferred(), release = deferred();
      const f = await setup({ wrapStore: (base) => ({ ...base, async listPearlGround(world, options) {
        entered.resolve(); await release.promise; return base.listPearlGround(world, options);
      } }) });
      try {
        const h = f.hydrator(), work = h.start(); await entered.promise; mutate(f.world);
        release.resolve(); await assert.rejects(work, { code: 'conflict' });
        assert.equal(h.state, 'fenced'); assert.equal(f.world.drops.size, 0);
      } finally { release.resolve(); await f.close(); }
    });
  });

  test('partial Map writes and aliased ledger callbacks roll back all installed rows and keep the fence', async (t) => {
    const faults = [
      ['drop insertion then throw', (f, called) => {
        const drops = f.world.drops;
        drops.set = (id, value) => { called(); Map.prototype.set.call(drops, id, value); throw new StoreError('unavailable'); };
      }],
      ['second ledger insertion then throw', (f, called) => {
        const ledger = f.world.pearlLedger; let calls = 0;
        ledger.set = (uid, value) => {
          called();
          Map.prototype.set.call(ledger, uid, value);
          if (++calls === 2) throw new StoreError('unavailable');
          return ledger;
        };
      }],
      ['ledger row mutation during set callback', (f, called) => {
        const ledger = f.world.pearlLedger;
        ledger.set = (uid, value) => { called(); Map.prototype.set.call(ledger, uid, value); value.owner = 'mutated'; return ledger; };
      }],
    ];
    for (const [name, inject] of faults) await t.test(name, async () => {
      const f = await setup({ count: 2 });
      try {
        const h = f.hydrator(); await h.start(); let invoked = 0; inject(f, () => invoked++); const before = runtimeState(f.world);
        const result = h.drain(); assert.equal(result.state, 'fenced'); assert.ok(invoked > 0, `${name} reached its injected callback`);
        assert.equal(result.why, name === 'ledger row mutation during set callback' ? 'conflict' : 'unavailable');
        assert.deepEqual(runtimeState(f.world), before);
        await assert.rejects(f.sessions.open(1, account), { code: 'busy' });
      } finally { await f.close(); }
    });
  });

  test('unrelated drops/ledger survive, but duplicate live UID or occupied local ID fences safely', async (t) => {
    await t.test('preserve unrelated state', async () => {
      const f = await setup({ count: 2 });
      try {
        const retainedDrop = { id: 40, to: 0, kind: 'gold', x: 2, z: 3, t: 999 };
        f.world.drops.set(40, retainedDrop); f.world.pearlLedger.set('other-ledger', { owner: 'x', entity: 0, place: 'other' });
        f.world.nextDrop = 41;
        const h = f.hydrator(); await h.start(); assert.deepEqual(h.drain(), { state: 'applied', count: 2 });
        assert.deepEqual(f.world.drops.get(40), retainedDrop); assert.equal(f.world.pearlLedger.has('other-ledger'), true);
        assert.equal(f.world.drops.has(41), true); assert.equal(f.world.drops.has(42), true); assert.equal(f.world.nextDrop, 43);
      } finally { await f.close(); }
    });
    for (const [name, prepare] of [
      ['duplicate live ledger UID', (f) => { f.world.pearlLedger.set(f.seeded[0].uid, { owner: '', entity: 0, place: 'ground', drop: 99 }); }],
      ['occupied nextDrop id', (f) => { f.world.drops.set(f.world.nextDrop, { id: f.world.nextDrop, kind: 'other' }); }],
      ['duplicate UID already in another drop', (f) => { f.world.drops.set(70, { id: 70, kind: 'pearl', pearl: { uid: f.seeded[0].uid, kind: f.seeded[0].kind } }); }],
    ]) await t.test(name, async () => {
      const f = await setup({ count: 2 });
      try {
        prepare(f); const h = f.hydrator(); await h.start(); const before = runtimeState(f.world);
        const result = h.drain(); assert.equal(result.state, 'fenced'); assert.equal(result.why, 'ownership');
        assert.deepEqual(runtimeState(f.world), before);
      } finally { await f.close(); }
    });
  });

  test('empty current world hydrates zero rows; foreign-world rows stay durable but are not spawned', async () => {
    const f = await setup({ count: 0, foreignCount: 2 });
    try {
      const before = runtimeState(f.world), h = f.hydrator();
      assert.deepEqual(await h.start(), { state: 'ready', count: 0 });
      assert.deepEqual(runtimeState(f.world), before); assert.deepEqual(h.drain(), { state: 'applied', count: 0 });
      assert.equal(f.world.drops.size, 0); assert.equal(f.world.pearlLedger.size, 0); assert.equal(f.world.nextDrop, 1);
      const foreign = await f.base.listPearlGround(f.foreignWorld, { limit: 10 });
      assert.equal(foreign.length, 2); assert.ok(foreign.every((row) => row.world === f.foreignWorld));
    } finally { await f.close(); }
  });

  test('drop counter overflow fences before any insertion', async () => {
    const f = await setup({ count: 1 });
    try {
      f.world.nextDrop = Number.MAX_SAFE_INTEGER - 1;
      const before = runtimeState(f.world), h = f.hydrator(); await h.start();
      const result = h.drain(); assert.deepEqual(result, { state: 'fenced', why: 'capacity' });
      assert.deepEqual(runtimeState(f.world), before);
    } finally { await f.close(); }
  });

  test('world profile attachment is excluded from startup hydration and picked-up tombstones are not spawned', async () => {
    const f = await setup({ count: 1 });
    try {
      const profile = newProfile(); profile.pirateId = `account:${account}`;
      const initialized = await f.base.saveProfile(account, profile, 0); assert.equal(initialized.ok, true);
      const row = { ...f.seeded[0], operationId: op(350), from: null, to: account, expectedVersion: 1,
        ground: null, profiles: [{ id: account, expectedVersion: initialized.version,
          data: { ...profile, pearls: { swallowed: null, bag: [{ uid: f.seeded[0].uid, kind: f.seeded[0].kind }] } } }] };
      await f.journal.prepare('ground', row); assert.equal((await f.base.commitPearlGround(row)).ok, true);
      await f.journal.resolve('ground', row, 'committed');
      const h = f.hydrator(); await h.start(); assert.equal(h.drain().count, 0);
      const hydrated = await f.sessions.open(1, account);
      const entity = f.world.spawnPlayer({ x: arena.x, z: arena.z, clientId: 1 }); attachProfile(f.world, entity, hydrated);
      assert.equal(f.world.drops.size, 0); assert.equal(f.world.pearlLedger.get(f.seeded[0].uid).place, 'profile');
      assert.equal(f.world.events.some((event) => event.type === 'loot' || event.type === 'pearlChanged'), false);
    } finally { await f.close(); }
  });
}
