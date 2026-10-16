import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { GameHost } from '../server/host.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { database as sql } from './helpers/pearl-batch-journal-sql.mjs';
import { WORLD as scope, A as account, op } from './helpers/pearl-batch.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const clock = (g) => ({ availableAt: g.availableAt, returnAt: g.returnAt });
const ground = (i = 0) => ({ operationId: op(1800 + i), uid: `host-startup-${i}`, kind: 'escarcha',
  from: null, to: null, expectedVersion: 0, profiles: [], world: scope,
  ground: { x: 0.5 + i, z: -1.5, availableAt: 7000 + i, returnAt: 15000 + i } });
const state = (w) => structuredClone({ tick: w.tick, drops: [...w.drops], ledger: [...w.pearlLedger],
  nextDrop: w.nextDrop, profiles: [...w.profiles], events: w.events, rng: w.rng.state(), lootRng: w.lootRng.state() });

class Socket extends EventEmitter {
  readyState = 1; messages = []; closes = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close(code, reason) { if (this.readyState !== 1) return; this.closes.push({ code, reason }); this.readyState = 3; this.emit('close'); }
  ping() {}
}

async function fixture({ backend, seed = true, wrapStore = (s) => s, wrapJournal = (j) => j,
  mapClock = clock, api = false, startupOptions = {}, resolvePlayer = async () => account } = {}) {
  const db = backend ? await backend() : { store: createMemoryStore(), close: async () => {} };
  const base = db.store, journal = db.journal ?? createMemoryPearlJournals(base)(scope);
  // The real economic authority creates and saves a non-default clock before reconstruction.
  const prime = new GameHost({ seed: 42, bots: 0, store: base, worldId: scope, log: () => {} });
  await prime.prepare(); prime.server.world.economy.advance(13); await prime.close();
  const economic = await base.loadWorld(scope);
  const rows = [];
  if (seed) for (let i = 0; i < 2; i++) {
    const raw = ground(i); await journal.prepare('ground', raw);
    assert.equal((await base.commitPearlGround(raw)).ok, true);
    await journal.resolve('ground', raw, 'committed'); rows.push(raw);
  }
  const store = wrapStore(base), mountedJournal = wrapJournal(journal);
  let host, gs;
  if (api) {
    gs = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, store, worldId: scope,
      resolvePlayer, saveSecret: 'host-startup-test', log: () => {},
      pearlStaging: { scope }, pearlStartup: { journal: mountedJournal, accountPolicy: 'accounts-only', mapClock, ...startupOptions } });
    host = gs.game;
  } else {
    host = new GameHost({ seed: 42, bots: 0, store, worldId: scope, resolvePlayer,
      pearlJournal: mountedJournal, saves: hmacSaves('host-startup-test'), log: () => {} });
    host.mountPearlStaging({ scope }); host.mountPearlStartup({ accountPolicy: 'accounts-only', mapClock, ...startupOptions });
  }
  return { db, base, journal, store, host, gs, w: host.server.world, rows, economic,
    async close() { await (gs ? gs.close() : host.close()).catch(() => {}); await db.close(); } };
}

function denied(f) {
  assert.equal(f.host.healthy(), false); assert.equal(f.host.tickAvailable(), false);
  assert.equal(f.host.profileAvailable(1, 1), false);
  assert.equal(f.host.commandAvailable(1, 1, {}), false);
  assert.throws(() => f.host.start(), { code: 'world_not_ready' });
  const ws = new Socket(); f.host.onConnection(ws, { headers: {}, socket: {} });
  assert.deepEqual(ws.closes, [{ code: 1013, reason: 'storage' }]);
  assert.equal(f.host.nextId, 1); assert.equal(f.host.sockets.size, 0);
  f.host.server.step(); assert.equal(f.w.tick, 0);
}

for (const [name, backend] of [['memory', undefined], ['SDK/SQL008 local', sql]]) {
  test(`${name}: host waits for economic load, journal and ground before listening or admitting`, { timeout: 15000 }, async () => {
    const worldEntered = deferred(), worldRelease = deferred(), journalEntered = deferred(), journalRelease = deferred();
    const groundEntered = deferred(), groundRelease = deferred(); let loads = 0, scans = 0, lists = 0;
    const f = await fixture({ backend, api: true,
      wrapStore: (base) => ({ ...base,
        async loadWorld(id) { loads++; worldEntered.resolve(); await worldRelease.promise; return base.loadWorld(id); },
        async listPearlGround(...args) { scans++; groundEntered.resolve(); await groundRelease.promise; return base.listPearlGround(...args); },
      }), wrapJournal: (j) => ({ ...j, async list(...args) { lists++; journalEntered.resolve(); await journalRelease.promise; return j.list(...args); } }),
    });
    try {
      const before = state(f.w), listening = f.gs.listen();
      listening.catch(() => {});
      assert.equal(f.gs.listen(), listening); const preparation = f.host.prepare(); assert.equal(f.host.prepare(), preparation);
      preparation.catch(() => {});
      await worldEntered.promise; denied(f); assert.equal(lists, 1); assert.equal(f.gs.server.listening, false);
      assert.equal(f.host.pearlStartup.state, 'recovering'); assert.deepEqual(state(f.w), before);
      assert.throws(() => pearlMutationGate(f.host.profiles).assertSnapshotAvailable({ accounts: [account] }), { code: 'busy' });
      worldRelease.resolve(); await journalEntered.promise;
      await f.host.worldState.open(f.w.economy); await turn(); denied(f);
      assert.deepEqual(f.w.economy.serialize(), f.economic.data.economy);
      assert.equal(f.host.pearlStartup.state, 'recovering'); assert.equal(scans, 0);
      journalRelease.resolve(); await groundEntered.promise; denied(f);
      assert.equal(f.host.profiles.pearls.admitting, true); assert.equal(f.host.pearlStartup.state, 'loading');
      await assert.rejects(f.host.profiles.open(1, account), { code: 'busy' });
      assert.throws(() => pearlMutationGate(f.host.profiles).reserve({ uids: ['unknown-startup-uid'] }), { code: 'busy' });
      assert.deepEqual(state(f.w), before); assert.equal(f.gs.server.listening, false); assert.equal(f.host.timer, undefined);
      groundRelease.resolve(); const port = await listening; await preparation;
      // Stop scheduling without shutting down, so the assertions see the first installed state.
      clearInterval(f.host.timer); clearInterval(f.host.worldTimer);
      assert.equal(f.host.pearlStartup.ready, true); assert.equal(f.host.healthy(), true);
      assert.equal(f.w.drops.size, 2); assert.equal(f.w.pearlLedger.size, 2); assert.equal(loads, 1); assert.equal(lists, 1);
      assert.equal(scans, 2); assert.deepEqual(f.w.events, []); assert.equal(f.w.rng.state(), before.rng);
      const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json();
      assert.deepEqual(status.storage.startup, { state: 'ready', ready: true });
      assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
      assert.equal(JSON.stringify(status).includes(f.rows[0].uid), false);
      assert.equal(JSON.stringify(status).includes(account), false);
      const after = state(f.w); await f.host.prepare(); assert.deepEqual(state(f.w), after);
    } finally { worldRelease.resolve(); journalRelease.resolve(); groundRelease.resolve(); await f.close(); }
  });

  test(`${name}: historical receipt reconciles and only latest current ground is restored`, async () => {
    let commits = 0;
    const f = await fixture({ backend, seed: false, wrapStore: (s) => ({ ...s,
      async commitPearlGround(...a) { commits++; return s.commitPearlGround(...a); },
    }) });
    try {
      const old = ground(3); await f.journal.prepare('ground', old); await f.base.commitPearlGround(old);
      const current = { ...old, operationId: op(1804), expectedVersion: 1,
        ground: { x: 7, z: 8, availableAt: 9000, returnAt: 19000 } };
      await f.base.commitPearlGround(current);
      await f.host.prepare(); assert.equal(commits, 0); assert.equal(f.w.drops.size, 1);
      const drop = [...f.w.drops.values()][0];
      assert.deepEqual([drop.x, drop.z, drop.pickAt, drop.t], [7, 8, 9000, 19000]);
      assert.equal((await f.journal.prepare('ground', old)).state, 'conflict');
      assert.deepEqual(await f.journal.list(), []); assert.equal(f.host.healthy(), true);
    } finally { await f.close(); }
  });

  test(`${name}: unreceipted request fences host and retains exact reservations without dispatch`, async () => {
    let commits = 0;
    const f = await fixture({ backend, seed: false, api: true, wrapStore: (s) => ({ ...s,
      async commitPearl(...a) { commits++; return s.commitPearl(...a); },
      async commitPearlGround(...a) { commits++; return s.commitPearlGround(...a); },
      async commitPearlBatch(...a) { commits++; return s.commitPearlBatch(...a); },
    }) });
    try {
      const raw = ground(5); await f.journal.prepare('ground', raw); const before = state(f.w);
      await assert.rejects(f.gs.listen(), { code: 'busy' });
      denied(f); assert.equal(f.host.closing, true); assert.equal(f.host.pearlStartup.state, 'fenced');
      assert.equal(f.gs.server.listening, false); assert.equal(commits, 0); assert.deepEqual(state(f.w), before);
      assert.equal(f.host.profiles.pearls.uids.has(raw.uid), true);
      assert.equal(f.host.profiles.pearls.operationIds.has(raw.operationId), true);
      const pending = await f.journal.list(); assert.equal(pending.length, 1);
      assert.deepEqual(pending[0].request, Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'operationId')));
      await assert.rejects(f.host.close(), { code: 'flush' });
    } finally { await f.close(); }
  });

  for (const phase of ['journal', 'ground']) test(`${name}: close during ${phase} read waits and never applies`, async () => {
    const entered = deferred(), release = deferred();
    const f = await fixture({ backend,
      wrapStore: (s) => phase === 'ground' ? { ...s, async listPearlGround(...a) { entered.resolve(); await release.promise; return s.listPearlGround(...a); } } : s,
      wrapJournal: (j) => phase === 'journal' ? { ...j, async list(...a) { entered.resolve(); await release.promise; return j.list(...a); } } : j,
    });
    try {
      const before = state(f.w), preparing = f.host.prepare(); preparing.catch(() => {}); await entered.promise;
      let closed = false; const closing = f.host.close().finally(() => { closed = true; }); closing.catch(() => {});
      await turn(); assert.equal(closed, false); assert.equal(f.host.pearlStartup.state, 'fenced');
      denied(f); release.resolve(); await assert.rejects(preparing, { code: 'cancelled' });
      await assert.rejects(closing, { code: 'flush' }); assert.equal(closed, true); assert.deepEqual(state(f.w), before);
      assert.throws(() => pearlMutationGate(f.host.profiles).assertWorldAvailable());
    } finally { release.resolve(); await f.close(); }
  });

  test(`${name}: restored host admits an account and its staging uses the same recovered journal`, async () => {
    const f = await fixture({ backend });
    try {
      const p = newProfile(), pearl = { uid: 'host-startup-held', kind: 'brasa' }; p.pirateId = `account:${account}`;
      assert.equal((await f.base.saveProfile(account, p, 0)).ok, true); p.pearls.bag.push(pearl);
      assert.equal((await f.base.commitPearl({ operationId: op(1810), ...pearl, from: null, to: account,
        expectedVersion: 0, profiles: [{ id: account, expectedVersion: 1, data: p }] })).ok, true);
      await f.host.prepare(); const ws = new Socket();
      f.host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'startup-test' } });
      ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Perlero', token: 'test' })), false);
      await Promise.all([...f.host.joins]); const c = f.host.server.clients.get(1); assert.ok(c.entity);
      f.w.ecs.regenT[c.entity] = 99; f.w.ecs.dashT[c.entity] = -1;
      f.w.ecs.castK[c.entity] = 0; f.w.ecs.atkStage[c.entity] = 0;
      const result = f.host.pearlStaging.swallow({ source: { clientId: 1, entity: c.entity }, uid: pearl.uid, expectedVersion: 1 });
      await f.host.pearlStaging.settle();
      assert.equal(f.host.pearlStaging.operations.get(result.operationId).state, 'ready'); f.host.server.step();
      assert.deepEqual(f.w.profiles.get(c.entity).pearls.swallowed, pearl);
      assert.deepEqual(await f.journal.list(), []); assert.equal(f.host.pearlStaging.operations.size, 0);
      await f.host.pearlStaging.settle(); await f.host.profiles.flush();
      assert.deepEqual((await f.base.loadProfile(account)).data.pearls.swallowed, pearl);
    } finally { await f.close(); }
  });
}

test('startup requires explicit matching journal, empty authority, staging, clock and bounded options', async (t) => {
  const cases = [
    ['missing verifier', { resolvePlayer: null }], ['bots', { bots: 1 }],
    ['missing world', { worldId: null }], ['mismatched journal', { pearlJournal: { scope: 'other' } }],
  ];
  const store = createMemoryStore(), journal = createMemoryPearlJournals(store)(scope);
  for (const [name, options] of cases) await t.test(name, () => {
    assert.throws(() => new GameHost({ seed: 42, bots: 0, store, worldId: scope, pearlJournal: journal,
      resolvePlayer: async () => account, ...options }), { code: 'configuration' });
  });
  for (const [name, options] of [['missing clock', {}], ['invalid clock type', { mapClock: null }],
    ['missing account policy', { mapClock: clock, accountPolicy: undefined }],
    ['extra callbacks', { mapClock: clock, beforeTick() {} }], ['zero page', { mapClock: clock, pageSize: 0 }],
    ['unbounded rows', { mapClock: clock, maxRows: 65537 }]]) await t.test(name, async () => {
    const h = new GameHost({ seed: 42, bots: 0, store, worldId: scope, pearlJournal: journal, resolvePlayer: async () => account, log: () => {} });
    try { h.mountPearlStaging({ scope }); assert.throws(() => h.mountPearlStartup({ accountPolicy: 'accounts-only', ...options }), { code: 'configuration' }); }
    finally { await h.close().catch(() => {}); }
  });
  const f = await fixture({ seed: false });
  try {
    assert.throws(() => { f.host.pearlStartup = null; }, TypeError);
    assert.throws(() => f.host.mountPearlStartup({ mapClock: clock }), { code: 'configuration' });
  } finally { await f.close(); }
});

test('journal without host startup stays closed and failed prepare is shared rather than retried', async () => {
  const store = createMemoryStore(), journal = createMemoryPearlJournals(store)(scope);
  const h = new GameHost({ seed: 42, bots: 0, store, worldId: scope, pearlJournal: journal, resolvePlayer: async () => account, log: () => {} });
  try {
    assert.equal(h.healthy(), false); const work = h.prepare(); assert.equal(h.prepare(), work);
    await assert.rejects(work, { code: 'configuration' }); assert.equal(h.closing, true);
    assert.throws(() => h.mountPearlStaging({ scope }), { code: 'configuration' });
    await assert.rejects(h.close(), { code: 'flush' });
  } finally { await h.close().catch(() => {}); }
});

test('async or mutating clock mapping fences preparation without installing ground', async (t) => {
  for (const kind of ['async', 'mutating']) await t.test(kind, async () => {
    let f;
    f = await fixture({ mapClock: (g) => {
      if (kind === 'async') return Promise.reject(new Error('async clock'));
      f.w.tick++; return clock(g);
    } });
    try {
      await assert.rejects(f.host.prepare(), { code: kind === 'async' ? 'operation' : 'conflict' });
      assert.equal(f.host.healthy(), false); assert.equal(f.w.drops.size, 0); assert.equal(f.w.pearlLedger.size, 0);
      assert.equal(f.host.pearlStartup.state, 'fenced'); await assert.rejects(f.host.close(), { code: 'flush' });
    } finally { await f.close(); }
  });
});

test('close during initial world read cancels and waits for recovery without installing ground', async () => {
  const entered = deferred(), release = deferred(); let lists = 0;
  const f = await fixture({ wrapStore: (s) => ({ ...s, async loadWorld(id) { entered.resolve(); await release.promise; return s.loadWorld(id); } }),
    wrapJournal: (j) => ({ ...j, async list(...a) { lists++; await release.promise; return j.list(...a); } }) });
  try {
    const before = state(f.w), work = f.host.prepare(); work.catch(() => {}); await entered.promise;
    let closed = false; const closing = f.host.close().finally(() => { closed = true; }); closing.catch(() => {});
    await turn(); assert.equal(closed, false); assert.equal(lists, 1);
    release.resolve(); await assert.rejects(work, { code: 'cancelled' }); await assert.rejects(closing, { code: 'flush' });
    assert.equal(f.host.pearlStartup.state, 'fenced');
    assert.deepEqual(state(f.w), before); assert.equal(f.host.healthy(), false);
  } finally { release.resolve(); await f.close(); }
});

test('API rejects incomplete startup configuration before attaching transport', () => {
  for (const options of [null, {}, { journal: {} }, { journal: {}, mapClock: clock, extra: true }]) {
    if (options === null) continue;
    assert.throws(() => createGameServer({ pearlStartup: options, saveSecret: 'startup-test', log: () => {} }), { code: 'configuration' });
  }
});

test('prepared ground remains unpublished until the slower economy is ready', async () => {
  const entered = deferred(), release = deferred(), mapped = deferred(); let count = 0;
  const f = await fixture({ wrapStore: (s) => ({ ...s, async loadWorld(id) { entered.resolve(); await release.promise; return s.loadWorld(id); } }),
    mapClock: (g) => { if (++count === 2) mapped.resolve(); return clock(g); } });
  try {
    const before = state(f.w), work = f.host.prepare(); await entered.promise; await mapped.promise; await turn();
    assert.equal(f.host.pearlStartup.state, 'prepared'); denied(f); assert.deepEqual(state(f.w), before);
    release.resolve(); await work; assert.equal(f.host.pearlStartup.ready, true); assert.equal(f.w.drops.size, 2);
  } finally { release.resolve(); await f.close(); }
});

test('world load failure cancels the parallel recovery and close waits for its read', async () => {
  const entered = deferred(), release = deferred();
  const f = await fixture({ wrapStore: (s) => ({ ...s, async loadWorld() { throw new StoreError('unavailable'); } }),
    wrapJournal: (j) => ({ ...j, async list(...a) { entered.resolve(); await release.promise; return j.list(...a); } }) });
  try {
    const before = state(f.w), work = f.host.prepare(); work.catch(() => {}); await entered.promise; await turn();
    assert.equal(f.host.closing, true); assert.equal(f.host.pearlStartup.state, 'fenced');
    let closed = false; const closing = f.host.close().finally(() => { closed = true; }); closing.catch(() => {});
    await turn(); assert.equal(closed, false); release.resolve();
    await assert.rejects(work, { code: 'unavailable' }); await assert.rejects(closing, { code: 'flush' });
    assert.deepEqual(state(f.w), before); assert.equal(f.host.healthy(), false);
  } finally { release.resolve(); await f.close(); }
});

test('restore pilot rejects fresh and signed guests plus legacy import without changing ground', async (t) => {
  for (const kind of ['fresh guest', 'signed guest', 'legacy import']) await t.test(kind, async () => {
    let loads = 0;
    const f = await fixture({ resolvePlayer: async () => kind === 'legacy import' ? account : null,
      wrapStore: (s) => ({ ...s, async loadProfile(...a) { loads++; return s.loadProfile(...a); } }) });
    try {
      await f.host.prepare(); const before = state(f.w), p = newProfile();
      p.pirateId = 'signed-old-character'; p.pearls.bag.push({ uid: f.rows[0].uid, kind: f.rows[0].kind });
      const signed = f.host.server.saves.store(p);
      assert.equal(f.host.server.saves.load(signed).pirateId, p.pirateId);
      const ws = new Socket(); f.host.onConnection(ws, { headers: {}, socket: {} });
      ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Invitado',
        ...(kind !== 'fresh guest' ? { save: signed } : {}),
        ...(kind === 'legacy import' ? { importSave: true, token: 'test' } : {}) })), false);
      await Promise.all([...f.host.joins]);
      assert.equal(ws.messages.find((m) => m.t === MSG.ERROR)?.code, kind === 'legacy import' ? 'legacy' : 'auth');
      assert.equal(f.host.server.clients.get(1).entity, 0); assert.equal(loads, 0);
      assert.deepEqual(state(f.w), before); assert.equal(f.host.healthy(), true);
    } finally { await f.close(); }
  });
});

test('HTTP health and WebSocket upgrade stay closed even if a caller listens before prepare', async () => {
  const f = await fixture({ api: true });
  try {
    await new Promise((resolve) => f.gs.server.listen(0, '127.0.0.1', resolve));
    const port = f.gs.server.address().port;
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 503);
    const code = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('error', () => {}); ws.on('open', () => { ws.close(); reject(new Error('premature upgrade')); });
      ws.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); ws.terminate(); });
    });
    assert.equal(code, 503); assert.equal(f.host.nextId, 1); assert.equal(f.host.sockets.size, 0);
    await f.host.prepare(); assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  } finally { await f.close(); }
});

test('startup API requires a chosen world ID rather than accepting the ordinary default', () => {
  const store = createMemoryStore(), journal = createMemoryPearlJournals(store)('marea-negra');
  assert.throws(() => createGameServer({ bots: 0, store, resolvePlayer: async () => account,
    saveSecret: 'startup-test', pearlStaging: { scope: 'marea-negra' },
    pearlStartup: { journal, accountPolicy: 'accounts-only', mapClock: clock } }), { code: 'configuration' });
});

test('journal failure aborts a slower economic load before its late response can install', async () => {
  const entered = deferred(), release = deferred();
  const f = await fixture({ wrapStore: (s) => ({ ...s, async loadWorld(id) { entered.resolve(); await release.promise; return s.loadWorld(id); } }),
    wrapJournal: (j) => ({ ...j, async list() { throw new StoreError('unavailable'); } }) });
  try {
    const before = state(f.w), economy = f.w.economy, work = f.host.prepare(); work.catch(() => {}); await entered.promise;
    await assert.rejects(work, { code: 'unavailable' });
    assert.equal(f.host.closing, true); assert.equal(f.host.pearlStartup.state, 'fenced');
    assert.equal(f.host.worldState.loadAbort.signal.aborted, true);
    await assert.rejects(f.host.close(), { code: 'flush' });
    release.resolve(); await turn(); assert.equal(f.w.economy, economy); assert.deepEqual(state(f.w), before);
    assert.equal(f.host.healthy(), false);
  } finally { release.resolve(); await f.close(); }
});
