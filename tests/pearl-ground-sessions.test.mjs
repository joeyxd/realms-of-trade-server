import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UID = 'ground-pearl-1';
const WORLD = 'overworld:harbor';
const op = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const profile = (gold = 0) => { const p = newProfile(); p.gold = gold; return p; };
const pearl = (uid = UID) => ({ uid, kind: 'brasa' });
const spot = (x = 4, z = 9, availableAt = 10, returnAt = 20) => ({ x, z, availableAt, returnAt });
const meta = (overrides = {}) => ({ operationId: op(1), uid: UID, kind: 'brasa', from: null, to: null,
  expectedVersion: 0, world: WORLD, ground: spot(), ...overrides });
const sessionsFor = (store, errors = []) => new ProfileSessions(store, (id, code) => errors.push({ id, code }));
async function account(store, id, data = profile()) { assert.equal((await store.saveProfile(id, data, 0)).ok, true); }
async function grant(store, id, operationId = op(80)) {
  const row = await store.loadProfile(id), data = structuredClone(row.data); data.pearls.bag.push(pearl());
  assert.equal((await store.commitPearl({ operationId, uid: UID, kind: 'brasa', from: null, to: id,
    expectedVersion: 0, profiles: [{ id, expectedVersion: row.version, data }] })).ok, true);
}
const edit = (rows, fn) => rows.map(({ id, data }) => ({ id, data: fn(structuredClone(data), id) }));
const move = (rows, from, to, credit = 0) => edit(rows, (data, id) => {
  if (id === from) data.pearls.bag = data.pearls.bag.filter((q) => q.uid !== UID);
  if (id === to) data.pearls.bag.push(pearl());
  if (id === from) data.gold += credit; return data;
});
const mint = (sessions, extra = {}, build = () => []) => sessions.commitPearlGround(meta(extra), build);

test('ground mint, pickup, transfer, sale, and relocation preserve one authoritative UID location', async () => {
  const store = createMemoryStore(); await account(store, A); await account(store, B);
  const sessions = sessionsFor(store); await sessions.open(1, A); await sessions.open(2, B);
  const created = await mint(sessions);
  assert.equal(created.receipt.location.world, WORLD);
  assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: spot(), version: 1 });
  await sessions.commitPearlGround(meta({ operationId: op(2), expectedVersion: 1, ground: null, to: A }),
    (rows) => move(rows, null, A));
  assert.deepEqual((await store.loadProfile(A)).data.pearls.bag, [pearl()]);
  await sessions.commitPearlGround(meta({ operationId: op(3), expectedVersion: 2, ground: null, from: A, to: B }),
    (rows) => move(rows, A, B));
  assert.deepEqual((await store.loadProfile(A)).data.pearls.bag, []);
  assert.deepEqual((await store.loadProfile(B)).data.pearls.bag, [pearl()]);
  await sessions.commitPearlGround(meta({ operationId: op(4), expectedVersion: 3, ground: spot(4, 9, 20, 35), from: B }),
    (rows) => move(rows, B, null, 600));
  assert.equal((await store.loadProfile(B)).data.gold, 600);
  assert.deepEqual(await store.loadPearlLocation(UID).then((x) => x.ground), spot(4, 9, 20, 35));
  const relocated = spot(11, -3, 30, 45);
  await sessions.commitPearlGround(meta({ operationId: op(5), expectedVersion: 4, ground: relocated }), () => []);
  assert.deepEqual(await store.loadPearlLocation(UID), { world: WORLD, ground: relocated, version: 5 });
});

test('prior CAS save drains before pickup builder and a slow sale rebases later progress once', async () => {
  const base = createMemoryStore(); await account(base, A, profile(25));
  await base.commitPearlGround({ ...meta({ operationId: op(5), uid: UID }), profiles: [] });
  const startedSave = deferred(), releaseSave = deferred(), rpc = deferred(), reply = deferred();
  const store = { ...base,
    async saveProfile(...args) { if (args[2] === 1) { startedSave.resolve(); await releaseSave.promise; } return base.saveProfile(...args); },
    async commitPearlGround(request) { const result = await base.commitPearlGround(request); rpc.resolve(); await reply.promise; return result; },
  };
  const sessions = sessionsFor(store); const opened = await sessions.open(1, A);
  const prior = structuredClone(opened); prior.xp = 7; sessions.save(1, prior); await startedSave.promise;
  let versionSeen;
  const pickup = sessions.commitPearlGround(meta({ operationId: op(6), expectedVersion: 1, ground: null, to: A }), (rows) => {
    versionSeen = rows[0].version; return move(rows, null, A);
  });
  await turn(); assert.equal(versionSeen, undefined); releaseSave.resolve(); await rpc.promise; reply.resolve(); await pickup; assert.equal(versionSeen, 2);
  const saleBaseline = (await base.loadProfile(A)).data;
  const saleReply = deferred(), saleSent = deferred();
  // The first gated reply has already been consumed; gate the sale independently.
  store.commitPearlGround = async (request) => { const result = await base.commitPearlGround(request); saleSent.resolve(); await saleReply.promise; return result; };
  const sale = sessions.commitPearlGround(meta({ operationId: op(7), expectedVersion: 2, ground: spot(4, 9, 20, 35), from: A }),
    (rows) => move(rows, A, null, 600));
  await saleSent.promise;
  const later = structuredClone(saleBaseline); later.gold += 13; later.xp = 9; sessions.save(1, later);
  saleReply.resolve(); await sale; await sessions.flush();
  const saved = await base.loadProfile(A);
  assert.equal(saved.data.gold, 638); assert.equal(saved.data.xp, 9);
  assert.equal(saved.version, 5); assert.equal((await base.loadUnique(UID)).version, 3);
});

test('ground and legacy families share UID, operation ID, and account reservations while disjoint ground work proceeds', async () => {
  const base = createMemoryStore(); for (const id of [A, B, C]) await account(base, id);
  const gate = deferred(), sent = new Set();
  const store = { ...base, async commitPearlGround(request) {
    const result = await base.commitPearlGround(request); sent.add(request.uid);
    if (request.uid === UID) await gate.promise;
    return result;
  } };
  const sessions = sessionsFor(store); await sessions.open(1, A); await sessions.open(2, B); await sessions.open(3, C);
  const p1 = mint(sessions); while (!sent.has(UID)) await turn();
  let calls = 0;
  await assert.rejects(sessions.commitPearl(meta({ operationId: op(2), uid: UID, to: A }), () => { calls++; return []; }), { code: 'busy' });
  await assert.rejects(sessions.commitPearl(meta({ operationId: op(1), uid: 'legacy-other', to: A }), () => { calls++; return []; }), { code: 'busy' });
  await assert.rejects(mint(sessions, { operationId: op(1), uid: 'ground-pearl-2' }), { code: 'busy' });
  const p2 = mint(sessions, { operationId: op(91), uid: 'ground-pearl-2' }); await p2;
  gate.resolve(); await p1;
  const legacySent = deferred(), legacyReply = deferred();
  store.commitPearl = async (request) => { const result = await base.commitPearl(request); legacySent.resolve(); await legacyReply.promise; return result; };
  const legacyUid = 'legacy-account-lane';
  const legacy = sessions.commitPearl({ operationId: op(92), uid: legacyUid, kind: 'brasa', from: null, to: A, expectedVersion: 0 },
    (rows) => rows.map(({ id, data }) => { const next = structuredClone(data); next.pearls.bag.push(pearl(legacyUid)); return { id, data: next }; }));
  await legacySent.promise;
  await assert.rejects(sessions.commitPearlGround(meta({ operationId: op(93), uid: 'ground-pearl-2', expectedVersion: 1, ground: null, to: A }),
    (rows) => rows.map(({ id, data }) => { const next = structuredClone(data); next.pearls.bag.push(pearl('ground-pearl-2')); return { id, data: next }; })), { code: 'busy' });
  legacyReply.resolve(); await legacy;
  assert.equal(calls, 0);
  assert.equal((await base.loadPearlLocation('ground-pearl-2')).version, 1);
});

test('intent metadata is detached and frozen across retries, and invalid source/world never invokes builder', async () => {
  const base = createMemoryStore(); const requests = []; await account(base, A);
  let attempts = 0;
  const store = { ...base, async commitPearlGround(request) { requests.push(request); attempts++; if (attempts === 1) throw new Error('lost reply'); return base.commitPearlGround(request); } };
  const sessions = sessionsFor(store);
  const supplied = meta({ operationId: op(10) });
  const pending = sessions.commitPearlGround(supplied, () => []);
  supplied.world = 'mutated'; supplied.ground.x = -500;
  await pending;
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0], requests[1]); assert.equal(Object.isFrozen(requests[0].ground), true);
  assert.equal(requests[0].world, WORLD); assert.equal(requests[0].ground.x, 4);

  const foreignId = 'foreign-ground';
  await base.commitPearlGround({ ...meta({ operationId: op(9), uid: foreignId, world: 'elsewhere' }), profiles: [] });
  const foreign = meta({ operationId: op(11), uid: foreignId, expectedVersion: 1, world: WORLD });
  let builds = 0;
  await assert.rejects(sessions.commitPearlGround(foreign, () => { builds++; return []; }), { code: 'ownership' });
  const historicalId = 'historical-missing';
  await base.commitPearl({ operationId: op(8), uid: historicalId, kind: 'brasa', from: null, to: A,
    expectedVersion: 0, profiles: [{ id: A, expectedVersion: 1, data: (() => { const p = profile(); p.pearls.bag.push(pearl(historicalId)); return p; })() }] });
  const row = await base.loadProfile(A), released = structuredClone(row.data); released.pearls.bag = released.pearls.bag.filter((q) => q.uid !== historicalId);
  await base.commitPearl({ operationId: op(7), uid: historicalId, kind: 'brasa', from: A, to: null,
    expectedVersion: 1, profiles: [{ id: A, expectedVersion: row.version, data: released }] });
  const historical = meta({ operationId: op(12), uid: historicalId, from: null, expectedVersion: 2 });
  await assert.rejects(sessions.commitPearlGround(historical, () => { builds++; return []; }), { code: 'ownership' });
  assert.equal(builds, 0);
});

test('bad builders and malformed ground DTOs do not dispatch a mutation', async () => {
  const builders = [() => null, () => [{ id: B, data: profile() }],
    (rows) => move(rows, A, null).map((p) => ({ ...p, data: { ...p.data, xp: 4 } })),
    (rows) => move(rows, A, null).map((p) => ({ ...p, data: { ...p.data, gold: -1 } })),
  ];
  for (const build of builders) {
    const base = createMemoryStore(); await account(base, A); await grant(base, A, op(13));
    let writes = 0, built = 0;
    const store = { ...base, async commitPearlGround(...args) { writes++; return base.commitPearlGround(...args); } };
    const sessions = sessionsFor(store); await sessions.open(1, A);
    await assert.rejects(sessions.commitPearlGround(meta({ operationId: op(14), expectedVersion: 1, from: A }),
      (rows) => { built++; return build(rows); }), { code: 'operation' });
    assert.equal(built, 1); assert.equal(writes, 0);
    assert.deepEqual((await base.loadProfile(A)).data.pearls.bag, [pearl()]);
    assert.equal((await base.loadProfile(A)).version, 2); assert.equal(await base.loadPearlLocation(UID), null);
  }
  const base = createMemoryStore(); let writes = 0;
  const sessions = sessionsFor({ ...base, async commitPearlGround(...args) { writes++; return base.commitPearlGround(...args); } });
  for (const ground of [{ ...spot(), extra: 1 }, { ...spot(), returnAt: 10 }, { ...spot(), x: Infinity }]) {
    await assert.rejects(mint(sessions, { operationId: op(20 + writes), uid: `bad-${writes}`, ground }), { code: 'operation' });
  }
  assert.equal(writes, 0);
});

test('ambiguous ground-only failure pins UID through flush and read-only late receipt reconciliation', async () => {
  const base = createMemoryStore(); let receiptMode = 'absent', sends = 0, reads = 0; const requests = [];
  const store = { ...base,
    async commitPearlGround(request) { sends++; requests.push(structuredClone(request)); throw new Error('outcome unknown'); },
    async loadPearlGroundOperation(id) {
      reads++;
      if (receiptMode === 'absent') return null;
      if (receiptMode === 'malformed') return { request: { uid: UID }, result: { ok: true } };
      if (receiptMode === 'changed') {
        const row = await base.loadPearlGroundOperation(id);
        row.request.world = 'different-world'; row.result.location.world = 'different-world'; return row;
      }
      return base.loadPearlGroundOperation(id);
    },
  };
  const sessions = sessionsFor(store);
  await assert.rejects(mint(sessions, { operationId: op(30) }), { code: 'unavailable' });
  await assert.rejects(sessions.flush(), { code: 'flush' }); assert.equal(sends, 2); assert.equal(reads, 1);
  await turn();
  await assert.rejects(mint(sessions, { operationId: op(31) }), { code: 'busy' });
  receiptMode = 'malformed';
  await assert.rejects(sessions.reconcilePearlGround(op(30)), { code: 'response' });
  await turn();
  await assert.rejects(mint(sessions, { operationId: op(31) }), { code: 'busy' });
  assert.equal((await base.commitPearlGround(requests[0])).ok, true);
  receiptMode = 'changed';
  await assert.rejects(sessions.reconcilePearlGround(op(30)), { code: 'operation' });
  await assert.rejects(sessions.reconcilePearl(op(30)), { code: 'operation' });
  await assert.rejects(mint(sessions, { operationId: op(31) }), { code: 'busy' });
  receiptMode = 'valid';
  const recovered = await sessions.reconcilePearlGround(op(30));
  assert.equal(recovered.receipt.replay, true); assert.equal(sends, 2);
  assert.deepEqual(await base.loadPearlLocation(UID), { world: WORLD, ground: spot(), version: 1 });
  await assert.rejects(sessions.flush(), { code: 'flush' });
  assert.equal(sessions.errors, 1, 'one ground-only failure remains counted after read-only recovery');
});

test('replay location read failure retains its reservation until location verification succeeds', async () => {
  const base = createMemoryStore();
  let commits = 0, locationMode = 'fail';
  const store = { ...base, async commitPearlGround(raw) {
    commits++; const result = await base.commitPearlGround(raw);
    if (commits === 1) throw new Error('lost reply'); return result;
  },
    async loadPearlLocation(uid) {
      if (commits && locationMode === 'fail') throw new Error('location unavailable');
      const row = await base.loadPearlLocation(uid);
      return locationMode === 'malformed' ? { ...row, extra: true } : row;
    } };
  const sessions = sessionsFor(store);
  await assert.rejects(mint(sessions, { operationId: op(40) }), { code: 'unavailable' });
  await turn();
  await assert.rejects(mint(sessions, { operationId: op(41) }), { code: 'busy' });
  locationMode = 'malformed';
  await assert.rejects(sessions.reconcilePearlGround(op(40)), { code: 'response' });
  await turn();
  await assert.rejects(mint(sessions, { operationId: op(41) }), { code: 'busy' });
  locationMode = 'valid';
  const result = await sessions.reconcilePearlGround(op(40));
  assert.equal(result.receipt.location.version, 1); assert.equal(commits, 2);
});

test('advanced ground location rejects a recovered receipt even when the ledger read matches its historical result', async () => {
  const base = createMemoryStore();
  let commits = 0, failRead = true, lost = true, historicUnique;
  const store = { ...base,
    async commitPearlGround(request) {
      commits++; const result = await base.commitPearlGround(request);
      if (lost) { historicUnique = await base.loadUnique(UID); throw new Error('lost reply'); }
      return result;
    },
    async loadUnique(uid) { return historicUnique ?? base.loadUnique(uid); },
    async loadPearlLocation(uid) {
      if (commits && failRead) throw new Error('location unavailable'); return base.loadPearlLocation(uid);
    },
  };
  const sessions = sessionsFor(store);
  await assert.rejects(mint(sessions, { operationId: op(50) }), { code: 'unavailable' });
  await assert.rejects(sessions.reconcilePearl(op(50)), { code: 'operation' });
  await assert.rejects(mint(sessions, { operationId: op(52) }), { code: 'busy' });
  const later = spot(5, 9, 21, 40);
  await base.commitPearlGround({ ...meta({ operationId: op(51), expectedVersion: 1, ground: later }), profiles: [] });
  failRead = false;
  await assert.rejects(sessions.reconcilePearlGround(op(50)), { code: 'conflict' });
  assert.equal((await base.loadPearlLocation(UID)).version, 2);
  assert.deepEqual((await base.loadPearlLocation(UID)).ground, later);
  await assert.rejects(sessions.reconcilePearlGround(op(50)), { code: 'operation' });
  assert.equal(commits, 2);
  // Completed authoritative conflict resolves the reservation; it never publishes the old position.
  historicUnique = null; lost = false;
  await mint(sessions, { operationId: op(53), expectedVersion: 2, ground: spot(8, 9, 22, 41) });
});

test('two lost sale replies recover profile and ground together before draining a closed account final save', async () => {
  const base = createMemoryStore(); await account(base, A, profile(20)); await grant(base, A, op(60));
  const entered = deferred(), reply = deferred(), requests = [];
  const store = { ...base,
    async commitPearlGround(request) {
      requests.push(request); await base.commitPearlGround(request);
      entered.resolve(); await reply.promise; throw new Error('lost reply');
    },
    async loadPearlOperation() { throw new Error('ground recovery must use its own receipt family'); },
  };
  const sessions = sessionsFor(store), live = await sessions.open(1, A); let builds = 0;
  const pending = sessions.commitPearlGround(meta({ operationId: op(61), from: A, expectedVersion: 1 }), (rows) => {
    builds++; return move(rows, A, null, 600);
  });
  await entered.promise;
  const final = structuredClone(live); final.gold += 12; final.xp = 19;
  sessions.save(1, final); sessions.close(1);
  await assert.rejects(sessions.open(2, A), { code: 'session' });
  assert.equal((await base.loadProfile(A)).data.gold, 620);
  reply.resolve(); const result = await pending; await sessions.flush();
  assert.equal(builds, 1); assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]);
  assert.equal(Object.isFrozen(requests[0].profiles[0].data), true); assert.equal(Object.isFrozen(requests[0].ground), true);
  assert.equal(result.receipt.replay, true); assert.equal(result.profiles[0].data.gold, 632);
  const saved = await base.loadProfile(A);
  assert.equal(saved.data.gold, 632); assert.equal(saved.data.xp, 19); assert.equal(saved.version, 4);
  assert.deepEqual(saved.data.pearls.bag, []);
  assert.deepEqual(await base.loadPearlLocation(UID), { world: WORLD, ground: spot(), version: 2 });
  const reloaded = await sessions.open(2, A);
  assert.equal(reloaded.gold, 632); assert.deepEqual(reloaded.pearls.bag, []);
});

test('missing, stale, contradictory and malformed source locations reject pickup before its builder', async () => {
  for (const [override, code] of [
    [() => null, 'ownership'],
    [(row) => ({ ...row, version: 2 }), 'ownership'],
    [(row) => ({ ...row, ground: null }), 'ownership'],
    [(row) => ({ ...row, world: 'other-world' }), 'ownership'],
    [(row) => ({ ...row, extra: true }), 'response'],
  ]) {
    const base = createMemoryStore(); await account(base, A);
    await base.commitPearlGround({ ...meta({ operationId: op(70) }), profiles: [] });
    const before = await base.loadProfile(A), source = await base.loadPearlLocation(UID);
    let builds = 0, writes = 0;
    const store = { ...base,
      async loadPearlLocation() { return override(structuredClone(source)); },
      async commitPearlGround(request) { writes++; return base.commitPearlGround(request); },
    };
    const sessions = sessionsFor(store); await sessions.open(1, A);
    await assert.rejects(sessions.commitPearlGround(meta({ operationId: op(71), to: A, expectedVersion: 1, ground: null }),
      (rows) => { builds++; return move(rows, null, A); }), { code });
    assert.equal(builds, 0); assert.equal(writes, 0);
    assert.deepEqual(await base.loadProfile(A), before); assert.deepEqual(await base.loadPearlLocation(UID), source);
  }
});
