import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { createMemoryPearlJournals, createSupabasePearlJournal } from '../server/pearlJournal.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { fixture, accounts, scope, uid, deferred, state } from './helpers/pearl-swallow-staging.mjs';
import { database as sql } from './helpers/pearl-batch-journal-sql.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const source = (f, i = 0) => ({ clientId: i + 1, entity: f.entities[i] });
const request = (f, action = 'swallow') => ({ action, uid, source: source(f),
  ...(action === 'give' ? { target: source(f, 1) } : {}) });
async function apply(f, raw) {
  const handle = f.staging.request(raw);
  assert.deepEqual(Object.keys(handle), ['operationId']); assert.equal(Object.isFrozen(handle), true);
  await f.staging.settle();
  assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
  await f.sessions.flush(); return handle;
}
const held = (f, itemKeys = [uid], ids = accounts) => {
  const gate = pearlMutationGate(f.sessions);
  for (const id of ids) assert.throws(() => gate.assertAvailable({ accounts: [id] }), { code: 'busy' });
  for (const key of itemKeys) assert.throws(() => gate.assertAvailable({ uids: [key] }), { code: 'busy' });
  assert.throws(() => gate.assertWorldAvailable(), { code: 'busy' });
};

for (const [name, backend] of [['memory', undefined], ['SDK/SQL008 local', sql]]) {
  const swallowBackend = backend && (async () => {
    const db = await backend(); return { ...db, journal: createSupabasePearlJournal(db.client, scope) };
  });
  test(`${name}: give, give back and swallow select advancing generations from storage`, { timeout: 15000 }, async () => {
    const commits = [], reads = [];
    const f = await fixture({ backend: swallowBackend, wrapStore: (base) => ({ ...base,
      async loadUnique(key) { reads.push(key); return base.loadUnique(key); },
      async commitPearlGround(raw) { commits.push(structuredClone(raw)); return base.commitPearlGround(raw); },
    }) });
    try {
      reads.length = 0; const before = state(f.w);
      const first = f.staging.request(request(f, 'give')); held(f);
      assert.deepEqual(state(f.w), before); assert.equal(reads.length, 0, 'reservation/capture precede the read microtask');
      const ctx = f.staging.operations.get(first.operationId);
      assert.equal(ctx.plan.meta.expectedVersion, null);
      await f.staging.settle(); assert.equal(ctx.plan.meta.expectedVersion, 1);
      assert.deepEqual(state(f.w), before, 'receipt does not mutate the live world'); held(f);
      assert.deepEqual(f.staging.drain(), [{ operationId: first.operationId, state: 'applied' }]); await f.sessions.flush();
      await apply(f, { action: 'give', uid, source: source(f, 1), target: source(f) });
      await apply(f, request(f));
      assert.deepEqual(commits.map((q) => q.expectedVersion), [1, 2, 3]);
      assert.equal(new Set(commits.map((q) => q.operationId)).size, 3);
      assert.equal(reads.filter((key) => key === uid).length, 6, 'one managed read plus queue verification per move');
      assert.equal((await f.base.loadUnique(uid)).version, 4);
      assert.deepEqual((await f.base.loadProfile(accounts[0])).data.pearls, f.w.profiles.get(f.entities[0]).pearls);
      assert.equal(f.w.profiles.get(f.entities[0]).pearls.swallowed.uid, uid);
      assert.equal(f.staging.operations.size, 0); pearlMutationGate(f.sessions).assertWorldAvailable();
    } finally { await f.close(); }
  });

  test(`${name}: replacement selectors are denied without property reads, IO, or reservations`, async () => {
    let reads = 0, saves = 0, ground = 0, batches = 0, prepares = 0;
    const f = await fixture({ backend: swallowBackend, wrapStore: (base) => ({ ...base,
      async loadUnique(...args) { reads++; return base.loadUnique(...args); },
      async saveProfile(...args) { saves++; return base.saveProfile(...args); },
      async commitPearlGround(...args) { ground++; return base.commitPearlGround(...args); },
      async commitPearlBatch(...args) { batches++; return base.commitPearlBatch(...args); },
    }), wrapJournal: (base) => ({ ...base, async prepare(...args) { prepares++; return base.prepare(...args); } }) });
    try {
      reads = saves = ground = batches = prepares = 0;
      const before = state(f.w), raw = { action: 'replace', uid: 'replace-incoming', replaceUid: 'replace-outgoing', source: source(f) };
      assert.throws(() => f.staging.request(raw), { code: 'bound' });
      let getterReads = 0;
      const getter = { action: 'replace', source: source(f), get uid() { getterReads++; return raw.uid; },
        get replaceUid() { getterReads++; return raw.replaceUid; }, get expectedVersion() { getterReads++; return 1; } };
      assert.throws(() => f.staging.request(getter), { code: 'operation' });
      await f.staging.settle();
      assert.equal(getterReads, 0); assert.deepEqual([reads, saves, ground, batches, prepares], [0, 0, 0, 0, 0]);
      assert.deepEqual(state(f.w), before); assert.equal(f.staging.operations.size, 0); assert.equal(f.staging.tasks.size, 0);
      pearlMutationGate(f.sessions).assertWorldAvailable();
      for (const key of ['replace-incoming', 'replace-outgoing']) pearlMutationGate(f.sessions).assertAvailable({ uids: [key] });
    } finally { await f.close(); }
  });

  test(`${name}: a deferred managed read keeps limits, saves and all lanes closed through apply`, { timeout: 15000 }, async () => {
    const entered = deferred(), reply = deferred(); let armed = false, reads = 0, saves = 0, commits = 0, prepares = 0;
    const f = await fixture({ backend: swallowBackend, limit: 1, wrapStore: (base) => ({ ...base,
      async loadUnique(key) { if (armed && key === uid && ++reads === 1) { entered.resolve(); await reply.promise; } return base.loadUnique(key); },
      async saveProfile(...args) { if (armed) saves++; return base.saveProfile(...args); },
      async commitPearlGround(...args) { commits++; return base.commitPearlGround(...args); },
    }), wrapJournal: (base) => ({ ...base, async prepare(...args) { prepares++; return base.prepare(...args); } }) });
    try {
      await apply(f, { action: 'give', uid: 'swallow-first', source: source(f), target: source(f, 1) });
      saves = 0; commits = 0; prepares = 0;
      armed = true; const before = state(f.w), h = f.staging.request(request(f));
      held(f, [uid], [accounts[0]]); await entered.promise;
      assert.equal(f.staging.tasks.size, 1); assert.equal(f.staging.operations.size, 1);
      assert.throws(() => f.staging.request(request(f)), { code: 'busy' });
      assert.throws(() => f.staging.request({ action: 'swallow', uid: 'swallow-first', source: source(f) }), { code: 'busy' });
      assert.throws(() => f.staging.request({ action: 'swallow', uid: 'swallow-first', source: source(f, 1) }), { code: 'busy' },
        'independent account and UID still count against the shared operation limit');
      assert.throws(() => f.sessions.save(1, f.w.profiles.get(f.entities[0])), { code: 'busy' });
      assert.deepEqual([saves, commits, prepares], [0, 0, 0]); assert.deepEqual(state(f.w), before);
      let settled = false; const waiting = f.staging.settle().then(() => { settled = true; }); await turn(); assert.equal(settled, false);
      reply.resolve(); await waiting; held(f, [uid], [accounts[0]]); assert.deepEqual(state(f.w), before);
      assert.equal(prepares, 1); assert.equal(commits, 1);
      assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'applied' }]); await f.sessions.flush();
      pearlMutationGate(f.sessions).assertWorldAvailable();
    } finally { reply.resolve(); await f.close(); }
  });

  test(`${name}: atomic CAS still rejects a generation shift after queue verification`, { timeout: 15000 }, async () => {
    let commits = 0;
    const f = await fixture({ backend: swallowBackend, wrapStore: (base) => ({ ...base,
      async commitPearlGround(raw) {
        commits++;
        const row = await base.loadProfile(accounts[0]), data = structuredClone(row.data), pearl = data.pearls.bag.find((q) => q.uid === uid);
        data.pearls.bag = data.pearls.bag.filter((q) => q.uid !== uid); data.pearls.swallowed = pearl;
        assert.equal((await base.commitPearlGround({ operationId: '61000000-0000-4000-8000-000000009020',
          ...pearl, from: accounts[0], to: accounts[0], expectedVersion: 1, world: scope, ground: null,
          profiles: [{ id: accounts[0], expectedVersion: row.version, data }] })).ok, true);
        return base.commitPearlGround(raw);
      },
    }) });
    try {
      const before = state(f.w), h = f.staging.request(request(f)); await f.staging.settle();
      assert.equal(commits, 1); assert.equal((await f.base.loadUnique(uid)).version, 2);
      assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'fenced', code: 'conflict' }]);
      assert.deepEqual(state(f.w), before); assert.deepEqual(await f.journal.list(), []);
      assert.equal(f.staging.operations.get(h.operationId).plan.meta.expectedVersion, 1);
      held(f, [uid], [accounts[0]]);
    } finally { await f.close(); }
  });
}

test('selector-only requests reject injected authority and malformed data before IO/reservation', async (t) => {
  let reads = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async loadUnique(key) { reads++; return base.loadUnique(key); } }) });
  try {
    reads = 0; const before = state(f.w), valid = request(f);
    const cases = [null, [], {}, { ...valid, action: 'death' }, { ...valid, action: 'constructor' },
      ...['expectedVersion', 'replaceExpectedVersion', 'holder', 'kind', 'world', 'operationId', 'profiles', 'target', 'replaceUid'].map((key) => ({ ...valid, [key]: 1 })),
      { ...valid, source: { ...source(f), key: accounts[1] } }, { ...valid, source: {} },
      { ...request(f, 'give'), target: source(f) }, { ...valid, source: source(f, 1) }];
    for (const [i, raw] of cases.entries()) await t.test(`invalid selector ${i}`, () => assert.throws(() => f.staging.request(raw)));
    let getters = 0; const withGetter = { ...valid }; Object.defineProperty(withGetter, 'uid', { get() { getters++; return uid; } });
    assert.throws(() => f.staging.request(withGetter), { code: 'operation' });
    const sourceGetter = { ...source(f) }; Object.defineProperty(sourceGetter, 'entity', { get() { getters++; return f.entities[0]; } });
    assert.throws(() => f.staging.request({ ...valid, source: sourceGetter }), { code: 'operation' }); assert.equal(getters, 0);
    await f.staging.settle(); assert.equal(reads, 0); assert.equal(f.staging.operations.size, 0);
    assert.deepEqual(state(f.w), before); pearlMutationGate(f.sessions).assertWorldAvailable();
    assert.throws(() => f.staging.swallow({ uid, source: source(f) }), { code: 'operation' });
    assert.throws(() => f.staging.give({ uid, source: source(f), target: source(f, 1) }), { code: 'operation' });
  } finally { await f.close(); }
});

test('managed responses fail closed without adopting or dispatching invalid unique records', async (t) => {
  const valid = { kind: 'pearl:brasa', holder: accounts[0], version: 1 };
  const cases = [
    ['absent', null, 'ownership'], ['undefined', undefined, 'response'], ['array', [], 'response'],
    ['extra field', { ...valid, uid }, 'response'], ['missing generation', { kind: valid.kind, holder: valid.holder }, 'response'],
    ['fractional', { ...valid, version: 1.2 }, 'response'], ['zero', { ...valid, version: 0 }, 'response'],
    ['too large', { ...valid, version: 2147483648 }, 'response'], ['terminal', { ...valid, version: 2147483647 }, 'operation'],
    ['wrong kind', { ...valid, kind: 'pearl:tinta' }, 'kind'], ['null holder', { ...valid, holder: null }, 'ownership'],
    ['other holder', { ...valid, holder: accounts[1] }, 'ownership'], ['noncanonical holder', { ...valid, holder: accounts[0].toUpperCase() }, 'response'],
    ['invalid holder', { ...valid, holder: 'stranger' }, 'response'], ['rejected IO', new StoreError('unavailable'), 'unavailable'],
    ['throwing provider', new Error('provider failed'), 'unavailable'],
  ];
  for (const [name, response, code] of cases) await t.test(name, async () => {
    let armed = false, saves = 0, commits = 0, prepares = 0;
    const f = await fixture({ wrapStore: (base) => ({ ...base,
      loadUnique(key) { if (armed && key === uid) { if (response instanceof Error) throw response; return response; } return base.loadUnique(key); },
      async saveProfile(...args) { if (armed) saves++; return base.saveProfile(...args); },
      async commitPearlGround(...args) { commits++; return base.commitPearlGround(...args); },
    }), wrapJournal: (base) => ({ ...base, async prepare(...args) { prepares++; return base.prepare(...args); } }) });
    try {
      armed = true; const before = state(f.w), h = f.staging.request(request(f));
      await f.staging.settle(); assert.deepEqual([saves, commits, prepares], [0, 0, 0]); assert.deepEqual(state(f.w), before);
      assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'fenced', code }]);
      assert.deepEqual(state(f.w), before); held(f, [uid], [accounts[0]]);
      assert.equal(f.staging.operations.get(h.operationId).request, undefined);
      await assert.rejects(f.sessions.flush(), { code: 'flush' });
    } finally { await f.close(); }
  });
});

test('progress earned during managed IO is captured again before the CAS baseline save', async () => {
  const entered = deferred(), reply = deferred(), saves = [], commits = []; let armed = false, reads = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base,
    async loadUnique(key) { if (armed && key === uid && ++reads === 1) { entered.resolve(); await reply.promise; } return base.loadUnique(key); },
    async saveProfile(...args) { if (armed) saves.push(structuredClone(args[1])); return base.saveProfile(...args); },
    async commitPearlGround(raw) { commits.push(structuredClone(raw)); return base.commitPearlGround(raw); },
  }) });
  try {
    f.staging = new PearlStaging(f.sessions, f.w, scope, { captureProfile: (_id, e) => capturePearlProfile(f.w, e) });
    armed = true; const h = f.staging.request(request(f)); await entered.promise;
    const e = f.entities[0], p = f.w.profiles.get(e);
    p.gold = 73; p.mast[0] = [3, 123]; p.stats.kills = 14;
    f.w.ecs.level[e] = 4; f.w.ecs.xp[e] = 33.17; f.w.ecs.potions[e] = 3;
    reply.resolve(); await f.staging.settle();
    const committed = commits[0].profiles[0].data;
    for (const data of [saves[0], committed]) {
      assert.deepEqual([data.lvl, data.xp, data.pot, data.gold, data.stats.kills], [4, 33.17, 3, 73, 14]);
      assert.deepEqual(data.mast[0], [3, 123]);
    }
    assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'applied' }]); await f.sessions.flush();
    assert.deepEqual((await f.base.loadProfile(accounts[0])).data, f.w.profiles.get(e));
  } finally { reply.resolve(); await f.close(); }
});

test('capture reentry after managed IO fences before a baseline save or commit', async () => {
  let captures = 0, saves = 0, commits = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base,
    async saveProfile(...args) { saves++; return base.saveProfile(...args); },
    async commitPearlGround(...args) { commits++; return base.commitPearlGround(...args); },
  }) });
  try {
    f.staging = new PearlStaging(f.sessions, f.w, scope, { captureProfile: (_id, e) => {
      if (++captures === 2) assert.throws(() => f.staging.request(request(f)), { code: 'effect' });
      return capturePearlProfile(f.w, e);
    } });
    const before = state(f.w), h = f.staging.request(request(f)); await f.staging.settle();
    assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'fenced', code: 'profile' }]);
    assert.deepEqual([saves, commits], [0, 0]); assert.deepEqual(state(f.w), before);
  } finally { await f.close(); }
});

test('authority changes during a read cannot turn its late answer into a mutation', async (t) => {
  for (const [name, mutate, code] of [
    ['close', (f) => f.sessions.close(1), 'cancelled'],
    ['death then revival', (f) => { pearlMutationGate(f.sessions).invalidate({ accounts: [accounts[0]] }); f.w.ecs.dead[f.entities[0]] = 0; }, 'cancelled'],
    ['entity recycled', (f) => { f.w.ecs.clientId[f.entities[0]] = 99; }, 'cancelled'],
    ['profile replaced', (f) => { f.w.profiles.set(f.entities[0], structuredClone(f.w.profiles.get(f.entities[0]))); }, 'cancelled'],
    ['ledger changed', (f) => { f.w.pearlLedger.get(uid).owner = 'changed'; }, 'ownership'],
    ['bag changed', (f) => { f.w.profiles.get(f.entities[0]).pearls.bag.reverse(); }, 'ownership'],
  ]) await t.test(name, async () => {
    const entered = deferred(), reply = deferred(); let armed = false, saves = 0, commits = 0;
    const f = await fixture({ wrapStore: (base) => ({ ...base,
      async loadUnique(key) { const value = await base.loadUnique(key); if (armed && key === uid) { entered.resolve(); await reply.promise; } return value; },
      async saveProfile(...args) { if (armed) saves++; return base.saveProfile(...args); },
      async commitPearlGround(...args) { commits++; return base.commitPearlGround(...args); },
    }) });
    try {
      armed = true; const h = f.staging.request(request(f)); await entered.promise; mutate(f); const changed = state(f.w);
      reply.resolve(); await f.staging.settle();
      assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'fenced', code }]);
      assert.deepEqual(state(f.w), changed); assert.deepEqual([saves, commits], [0, 0]);
      held(f, [uid], [accounts[0]]);
    } finally { reply.resolve(); await f.close(); }
  });
});

test('queue rechecks the resolved generation and never rebuilds a stale request', async () => {
  let armed = false, reads = 0, commits = 0;
  const f = await fixture({ wrapStore: (base) => ({ ...base,
    async loadUnique(key) {
      if (armed && key === uid && ++reads === 2) {
        const row = await base.loadProfile(accounts[0]), data = structuredClone(row.data), pearl = data.pearls.bag.find((q) => q.uid === uid);
        data.pearls.bag = data.pearls.bag.filter((q) => q.uid !== uid); data.pearls.swallowed = pearl;
        assert.equal((await base.commitPearlGround({ operationId: '61000000-0000-4000-8000-000000009019',
          ...pearl, from: accounts[0], to: accounts[0], expectedVersion: 1, world: scope, ground: null,
          profiles: [{ id: accounts[0], expectedVersion: row.version, data }] })).ok, true);
      }
      return base.loadUnique(key);
    },
    async commitPearlGround(...args) { commits++; return base.commitPearlGround(...args); },
  }) });
  try {
    armed = true; const before = state(f.w), h = f.staging.request(request(f)); await f.staging.settle();
    assert.equal(reads, 2); assert.equal(commits, 0);
    assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'fenced', code: 'conflict' }]);
    assert.deepEqual(state(f.w), before); assert.equal(f.staging.operations.size, 1);
    assert.equal(f.staging.operations.get(h.operationId).plan.meta.expectedVersion, 1);
  } finally { await f.close(); }
});

test('a lost commit response reuses the exact selected request and applies only once', async () => {
  const requests = []; let lost = false;
  const f = await fixture({ wrapStore: (base) => ({ ...base, async commitPearlGround(raw) {
    requests.push(structuredClone(raw)); const receipt = await base.commitPearlGround(raw);
    if (!lost) { lost = true; throw new StoreError('unavailable'); } return receipt;
  } }) });
  try {
    const before = state(f.w), h = f.staging.request(request(f)); await f.staging.settle();
    assert.deepEqual(state(f.w), before); assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0].operationId, h.operationId); assert.equal(requests[0].expectedVersion, 1);
    assert.deepEqual(f.staging.drain(), [{ operationId: h.operationId, state: 'applied' }]); await f.sessions.flush();
    const applied = state(f.w); assert.deepEqual(f.staging.drain(), []); assert.deepEqual(state(f.w), applied);
    assert.equal((await f.base.loadUnique(uid)).version, 2);
  } finally { await f.close(); }
});

class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}

async function hostFixture(wrapStore = (store) => store) {
  const base = createMemoryStore(), journal = createMemoryPearlJournals(base)(scope);
  const p = newProfile(); p.pirateId = `account:${accounts[0]}`; await base.saveProfile(accounts[0], p, 0);
  p.pearls.bag.push({ uid, kind: 'brasa' });
  assert.equal((await base.commitPearlGround({ operationId: '61000000-0000-4000-8000-000000009018', uid, kind: 'brasa',
    from: null, to: accounts[0], expectedVersion: 0, world: scope, ground: null,
    profiles: [{ id: accounts[0], expectedVersion: 1, data: p }] })).ok, true);
  const host = new GameHost({ seed: 42, bots: 0, store: wrapStore(base), resolvePlayer: async () => accounts[0],
    worldId: scope, pearlJournal: journal, log: () => {} });
  host.mountPearlStaging({ scope }); host.mountPearlStartup({ accountPolicy: 'accounts-only',
    mapClock: (g) => ({ availableAt: g.availableAt, returnAt: g.returnAt }) });
  await host.prepare(); const ws = new Socket(); host.onConnection(ws, { headers: {}, socket: {} });
  ws.emit('message', JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Perlero', token: 'trusted-test' }));
  await Promise.all([...host.joins]); const w = host.server.world, entity = host.server.clients.get(1).entity;
  w.ecs.regenT[entity] = 99; w.ecs.dashT[entity] = -1; w.ecs.castK[entity] = 0; w.ecs.atkStage[entity] = 0;
  return { host, base, w, entity };
}

test('real prepared host drains a selector-only swallow at its owned tick boundary', async () => {
  const { host, base, w, entity } = await hostFixture();
  try {
    const tick = w.tick, h = host.pearlStaging.request({ action: 'swallow', uid, source: { clientId: 1, entity } });
    host.server.step(); assert.equal(w.tick, tick); await host.pearlStaging.settle();
    assert.equal(w.profiles.get(entity).pearls.swallowed, null); assert.equal(host.tickAvailable(), false);
    host.server.step(); assert.equal(w.tick, tick + 1); assert.equal(w.profiles.get(entity).pearls.swallowed.uid, uid);
    assert.equal(host.pearlStaging.operations.has(h.operationId), false); assert.equal(host.tickAvailable(), true);
    await host.profiles.flush(); assert.equal((await base.loadUnique(uid)).version, 2);
  } finally { await host.close(); }
});

test('host close waits for a managed read and conserves the unresolved reservation without apply', async () => {
  const entered = deferred(), reply = deferred(); let armed = false, commits = 0;
  const { host, base, entity } = await hostFixture((store) => ({ ...store,
    async loadUnique(key) { const row = await store.loadUnique(key); if (armed && key === uid) { entered.resolve(); await reply.promise; } return row; },
    async commitPearlGround(...args) { commits++; return store.commitPearlGround(...args); },
  }));
  let closing;
  try {
    armed = true; const before = await base.loadProfile(accounts[0]);
    const h = host.pearlStaging.request({ action: 'swallow', uid, source: { clientId: 1, entity } }); await entered.promise;
    let closed = false; closing = host.close().then(() => { closed = true; return 'ok'; }, (err) => { closed = true; return err.code; });
    await turn(); assert.equal(closed, false); assert.equal(host.healthy(), false); assert.equal(commits, 0);
    reply.resolve(); assert.equal(await closing, 'flush'); assert.equal(commits, 0);
    assert.deepEqual(await base.loadProfile(accounts[0]), before); assert.equal((await base.loadUnique(uid)).version, 1);
    assert.equal(host.pearlStaging.operations.get(h.operationId).state, 'failed');
    assert.equal(host.pearlStaging.operations.get(h.operationId).code, 'cancelled');
    assert.throws(() => pearlMutationGate(host.profiles).assertWorldAvailable());
  } finally { reply.resolve(); await (closing ?? host.close().catch(() => {})); }
});
