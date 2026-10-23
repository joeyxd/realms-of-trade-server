import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UID1 = 'session-pearl-1';
const UID2 = 'session-pearl-2';
const op = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const profile = (gold = 0) => { const p = newProfile(); p.gold = gold; return p; };
const pearl = (uid, kind = 'brasa') => ({ uid, kind });
const meta = (uid, from, to, expectedVersion, operationId) => ({ operationId, uid, kind: 'brasa', from, to, expectedVersion });
const move = (rows, uid, from, to, credit = 0) => rows.map(({ id, data }) => {
  const next = structuredClone(data);
  const bag = next.pearls.bag;
  if (id === from) next.pearls.bag = bag.filter((q) => q.uid !== uid);
  if (id === to) next.pearls.bag.push(pearl(uid));
  next.gold += credit;
  return { id, data: next };
});

async function account(store, id, data = profile()) {
  assert.equal((await store.saveProfile(id, data, 0)).ok, true);
}

async function grant(store, id, uid, operationId, otherPearls = []) {
  const row = await store.loadProfile(id);
  const data = structuredClone(row.data);
  data.pearls.bag.push(pearl(uid), ...otherPearls);
  return store.commitPearl({
    operationId, uid, kind: 'brasa', from: null, to: id, expectedVersion: 0,
    profiles: [{ id, expectedVersion: row.version, data }],
  });
}

function sessionsFor(store, errors = []) {
  return new ProfileSessions(store, (id, code) => errors.push({ id, code }));
}

test('a prior save drains before the builder and a later save uses the operation version', async () => {
  const base = createMemoryStore();
  await account(base, A);
  const saveStarted = deferred(), releaseSave = deferred(), order = [];
  const store = {
    ...base,
    async saveProfile(...args) {
      order.push(['save-start', args[2]]);
      if (args[2] === 1) { saveStarted.resolve(); await releaseSave.promise; }
      const result = await base.saveProfile(...args);
      order.push(['save-done', result.version]);
      return result;
    },
    async commitPearl(request) { order.push(['operation', request.profiles[0].expectedVersion]); return base.commitPearl(request); },
  };
  const sessions = sessionsFor(store);
  await sessions.open(1, A);
  const prior = profile(12);
  prior.xp = 4;
  sessions.save(1, prior);
  await saveStarted.promise;
  let built;
  const operation = sessions.commitPearl(meta(UID1, null, A, 0, op(1)), (rows) => {
    built = rows[0];
    return move(rows, UID1, null, A);
  });
  await turn();
  assert.equal(built, undefined, 'builder waits until the preceding snapshot is persisted');
  releaseSave.resolve();
  const committed = await operation;
  assert.equal(built.version, 2);
  assert.equal(built.data.gold, 12);
  assert.equal(committed.profiles[0].data.pearls.bag[0].uid, UID1);
  const later = structuredClone(committed.profiles[0].data);
  later.flags.tier = 3;
  later.xp = 9;
  sessions.save(1, later);
  await sessions.flush();
  const saved = await base.loadProfile(A);
  assert.equal(saved.version, 4);
  assert.equal(saved.data.gold, 12);
  assert.equal(saved.data.xp, 9);
  assert.deepEqual(order.map((x) => x[0]), ['save-start', 'save-done', 'operation', 'save-start', 'save-done']);
});

test('progress saved during a slow release is rebased with the gold credit exactly once', async () => {
  const base = createMemoryStore();
  await account(base, A, profile(25));
  await grant(base, A, UID1, op(2));
  const rpcEntered = deferred(), reply = deferred();
  let calls = 0;
  const store = {
    ...base,
    async commitPearl(request) {
      calls++;
      const result = await base.commitPearl(request);
      rpcEntered.resolve();
      await reply.promise;
      return result;
    },
  };
  const sessions = sessionsFor(store);
  const opened = await sessions.open(1, A);
  const initial = await base.loadProfile(A);
  const operation = sessions.commitPearl(meta(UID1, A, null, 1, op(3)), (rows) => {
    const next = structuredClone(rows[0].data);
    next.pearls.bag = next.pearls.bag.filter((q) => q.uid !== UID1);
    next.gold += 600;
    return [{ id: A, data: next }];
  });
  await rpcEntered.promise;
  const later = structuredClone(opened);
  later.gold += 17;
  later.xp += 13;
  later.flags.tier = 4;
  later.pearls.bag.push(pearl('kept-other', 'tinta'));
  sessions.save(1, later);
  reply.resolve();
  await operation;
  await sessions.flush();
  const saved = await base.loadProfile(A);
  assert.equal(calls, 1);
  assert.equal(saved.data.gold, initial.data.gold + 17 + 600);
  assert.equal(saved.data.xp, 13);
  assert.equal(saved.data.flags.tier, 4);
  assert.deepEqual(saved.data.pearls.bag, [pearl('kept-other', 'tinta')]);
  assert.deepEqual(await base.loadUnique(UID1), { kind: 'pearl:brasa', holder: null, version: 2 });
  assert.equal(saved.version, initial.version + 2);
});

test('a transfer updates both account lanes while preserving unrelated pearl placement', async () => {
  const base = createMemoryStore();
  const unrelatedA = pearl('unrelated-a', 'tinta'), unrelatedB = pearl('unrelated-b', 'escarcha');
  const a = profile(31), b = profile(44);
  a.pearls.swallowed = unrelatedA;
  b.pearls.bag.push(unrelatedB);
  await account(base, A, a); await account(base, B, b);
  await grant(base, A, UID1, op(4));
  const sessions = sessionsFor(base);
  await sessions.open(1, A); await sessions.open(2, B);
  const result = await sessions.commitPearl(meta(UID1, A, B, 1, op(5)), (rows) => move(rows, UID1, A, B));
  assert.deepEqual(result.profiles.map((p) => p.id).sort(), [A, B]);
  const pa = await base.loadProfile(A), pb = await base.loadProfile(B);
  assert.deepEqual(pa.data.pearls, { swallowed: unrelatedA, bag: [] });
  assert.deepEqual(pb.data.pearls, { swallowed: null, bag: [unrelatedB, pearl(UID1)] });
  assert.equal((await base.loadUnique(UID1)).holder, B);
});

test('a full rebased destination bag fences both lanes without overwriting the committed transfer', async () => {
  const base = createMemoryStore(); await account(base, A); await account(base, B); await grant(base, A, UID1, op(40));
  const sent = deferred(), reply = deferred();
  const store = { ...base, async commitPearl(request) {
    const result = await base.commitPearl(request); sent.resolve(); await reply.promise; return result;
  } };
  const failures = [], sessions = sessionsFor(store, failures);
  await sessions.open(1, A); await sessions.open(2, B);
  const pending = sessions.commitPearl(meta(UID1, A, B, 1, op(41)), (rows) => move(rows, UID1, A, B));
  await sent.promise;
  const full = profile(80);
  full.pearls.bag = Array.from({ length: 8 }, (_, index) => pearl(`queued-${index}`, 'tinta'));
  sessions.save(2, full);
  reply.resolve();
  await assert.rejects(pending, { code: 'ownership' });
  await assert.rejects(sessions.flush(), { code: 'flush' });
  assert.equal(failures.length, 2);
  assert.deepEqual((await base.loadProfile(B)).data.pearls.bag, [pearl(UID1)]);
  assert.equal((await base.loadProfile(B)).version, 2);
  assert.equal((await base.loadUnique(UID1)).holder, B);
});

test('a stale ledger generation fences the operation and flush reports the CAS failure once per lane', async () => {
  const base = createMemoryStore(); await account(base, A); await account(base, B); await grant(base, A, UID1, op(42));
  const failures = [], sessions = sessionsFor(base, failures);
  await sessions.open(1, A); await sessions.open(2, B);
  const from = await base.loadProfile(A), to = await base.loadProfile(B);
  const nextFrom = structuredClone(from.data); nextFrom.pearls.bag = [];
  const nextTo = structuredClone(to.data); nextTo.pearls.bag.push(pearl(UID1));
  assert.equal((await base.commitPearl({
    operationId: op(43), uid: UID1, kind: 'brasa', from: A, to: B, expectedVersion: 1,
    profiles: [
      { id: A, expectedVersion: from.version, data: nextFrom },
      { id: B, expectedVersion: to.version, data: nextTo },
    ],
  })).ok, true);
  let builds = 0;
  await assert.rejects(sessions.commitPearl(meta(UID1, A, B, 1, op(44)), () => { builds++; return []; }), { code: 'conflict' });
  await assert.rejects(sessions.flush(), { code: 'flush' });
  assert.equal(builds, 0);
  assert.deepEqual(failures, [{ id: 1, code: 'conflict' }, { id: 2, code: 'conflict' }]);
  assert.equal((await base.loadUnique(UID1)).holder, B);
  assert.equal((await base.loadProfile(B)).version, 2);
});

test('same UID or account reservations return busy while disjoint operations proceed together', async () => {
  const base = createMemoryStore();
  for (const id of [A, B, C, D]) await account(base, id);
  await grant(base, A, UID1, op(6)); await grant(base, C, UID2, op(7));
  const started = new Map(), gates = new Map([[UID1, deferred()], [UID2, deferred()]]);
  const store = {
    ...base,
    async commitPearl(request) {
      const result = await base.commitPearl(request);
      started.set(request.uid, result);
      await gates.get(request.uid).promise;
      return result;
    },
  };
  const sessions = sessionsFor(store);
  await sessions.open(1, A); await sessions.open(2, B); await sessions.open(3, C); await sessions.open(4, D);
  const p1 = sessions.commitPearl(meta(UID1, A, B, 1, op(8)), (rows) => move(rows, UID1, A, B));
  while (!started.has(UID1)) await turn();
  let rejectedBuilderCalls = 0;
  await assert.rejects(sessions.commitPearl(meta(UID2, C, D, 1, op(8)), () => { rejectedBuilderCalls++; return []; }), { code: 'busy' });
  const p2 = sessions.commitPearl(meta(UID2, C, D, 1, op(9)), (rows) => move(rows, UID2, C, D));
  while (!started.has(UID1) || !started.has(UID2)) await turn();
  await assert.rejects(
    sessions.commitPearl(meta(UID1, A, B, 1, op(10)), () => { rejectedBuilderCalls++; return []; }),
    { code: 'busy' },
  );
  await assert.rejects(sessions.commitPearl(meta(UID2, C, A, 1, op(11)), () => []), { code: 'busy' });
  assert.equal(rejectedBuilderCalls, 0);
  gates.get(UID1).resolve(); gates.get(UID2).resolve();
  await Promise.all([p1, p2]);
  assert.equal((await base.loadUnique(UID1)).holder, B);
  assert.equal((await base.loadUnique(UID2)).holder, D);
});

test('receipt reads validate the UUID and stored result, and return detached records through the adapter', async () => {
  const base = createMemoryStore();
  await account(base, A); await grant(base, A, UID1, op(30));
  const request = {
    operationId: op(31), uid: UID1, kind: 'brasa', from: A, to: null, expectedVersion: 1,
    profiles: [{ id: A, expectedVersion: 2, data: (() => { const p = profile(); return p; })() }],
  };
  request.profiles[0].data.pearls.bag = [];
  assert.equal((await base.commitPearl(request)).ok, true);
  const first = await base.loadPearlOperation(op(31));
  assert.equal((await base.loadPearlOperation(op(32))), null);
  first.result.unique.holder = B;
  assert.equal((await base.loadPearlOperation(op(31))).result.unique.holder, null);
  await assert.rejects(base.loadPearlOperation('invalid'), { code: 'identity' });

  const calls = [];
  let row = await base.loadPearlOperation(op(31));
  const adapter = createSupabaseStore({ rpc() { throw new Error('unused RPC'); }, from(table) {
    calls.push(['from', table]);
    return {
      select(columns) { calls.push(['select', columns]); return this; },
      eq(column, value) { calls.push(['eq', column, value]); return this; },
      async maybeSingle() { return { data: row, error: null }; },
    };
  } });
  const loaded = await adapter.loadPearlOperation(op(31));
  assert.deepEqual(calls, [
    ['from', 'mn_pearl_operations'], ['select', 'request,result'], ['eq', 'operation_id', op(31)],
  ]);
  loaded.result.unique.version = 999;
  assert.equal((await adapter.loadPearlOperation(op(31))).result.unique.version, 2);
  row = { request: { uid: UID1 }, result: { ok: true } };
  await assert.rejects(adapter.loadPearlOperation(op(31)), { code: 'response' });
  const unavailable = createSupabaseStore({ rpc() { throw new Error('unused RPC'); }, from() { throw new Error('provider secret'); } });
  await assert.rejects(unavailable.loadPearlOperation(op(31)), (error) => error.code === 'unavailable' && !error.message.includes('secret'));
});

test('builder receives detached snapshots and returned data cannot mutate committed state', async () => {
  const base = createMemoryStore();
  await account(base, A); await grant(base, A, UID1, op(12));
  const sessions = sessionsFor(base);
  await sessions.open(1, A);
  let builderInput;
  const result = await sessions.commitPearl(meta(UID1, A, null, 1, op(13)), (rows) => {
    builderInput = rows;
    const next = structuredClone(rows[0].data);
    next.pearls.bag = [];
    next.gold += 9;
    return [{ id: A, data: next }];
  });
  builderInput[0].data.gold = 999;
  result.profiles[0].data.gold = 777;
  assert.equal((await base.loadProfile(A)).data.gold, 9);
  assert.equal((await base.loadUnique(UID1)).holder, null);
});

test('invalid builders are rejected before the storage operation is called', async () => {
  for (const mutate of [
    (p) => { p.xp += 1; },
    (p) => { p.pearls.bag.push(pearl('forged-other', 'tinta')); },
    (p) => { p.gold -= 1; },
    (p) => { p.gold += 1.5; },
    (p) => { p.gold += 1_000_000_001; },
  ]) {
    const base = createMemoryStore();
    await account(base, A); await grant(base, A, UID1, op(14));
    let calls = 0;
    const store = { ...base, async commitPearl(...args) { calls++; return base.commitPearl(...args); } };
    const sessions = sessionsFor(store);
    await sessions.open(1, A);
    await assert.rejects(sessions.commitPearl(meta(UID1, A, null, 1, op(15)), (rows) => {
      const next = structuredClone(rows[0].data);
      next.pearls.bag = [];
      mutate(next);
      return [{ id: A, data: next }];
    }));
    assert.equal(calls, 0);
    assert.equal((await base.loadProfile(A)).version, 2);
  }

  const base = createMemoryStore();
  await account(base, A); await account(base, B); await grant(base, A, UID1, op(140));
  let writes = 0;
  const sessions = sessionsFor({ ...base, async commitPearl(...args) { writes++; return base.commitPearl(...args); } });
  await sessions.open(1, A); await sessions.open(2, B);
  await assert.rejects(sessions.commitPearl(meta(UID1, A, B, 1, op(141)), (rows) => {
    const next = move(rows, UID1, A, B);
    next.find((row) => row.id === B).data.gold++;
    return next;
  }));
  assert.equal(writes, 0, 'gold credits belong only to release operations');
});

test('two lost replies recover an exact receipt without a third mutation or duplicate credit', async () => {
  const base = createMemoryStore();
  await account(base, A, profile(20)); await grant(base, A, UID1, op(16));
  const requests = []; let receiptReads = 0;
  const store = { ...base, async commitPearl(request) {
    requests.push(structuredClone(request));
    const result = await base.commitPearl(request);
    throw new Error(`transport lost after attempt ${requests.length}: ${result.ok}`);
  }, async loadPearlOperation(operationId) {
    receiptReads++;
    return base.loadPearlOperation(operationId);
  } };
  const sessions = sessionsFor(store);
  await sessions.open(1, A);
  let builds = 0;
  const result = await sessions.commitPearl(meta(UID1, A, null, 1, op(17)), (rows) => {
    builds++;
    const next = structuredClone(rows[0].data);
    next.pearls.bag = [];
    next.gold += 600;
    return [{ id: A, data: next }];
  });
  assert.equal(builds, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(receiptReads, 1);
  assert.equal(result.receipt.unique.holder, null);
  assert.equal((await base.loadProfile(A)).data.gold, 620);
  assert.equal((await base.loadProfile(A)).version, 3);
});

test('a successful replay whose current-state read fails stays reserved until reconciliation verifies it', async () => {
  const base = createMemoryStore();
  await account(base, A, profile(40)); await grant(base, A, UID1, op(170));
  let calls = 0, failReads = false, builds = 0;
  const store = { ...base, async commitPearl(request) {
    calls++;
    const result = await base.commitPearl(request);
    if (calls === 1) throw new Error('response lost after first commit');
    failReads = true;
    return result;
  }, async loadProfile(id) {
    if (failReads) throw new Error('temporary profile read failure');
    return base.loadProfile(id);
  }, async loadUnique(uid) {
    if (failReads) throw new Error('temporary ledger read failure');
    return base.loadUnique(uid);
  } };
  const sessions = sessionsFor(store);
  await sessions.open(1, A);
  const pending = sessions.commitPearl(meta(UID1, A, null, 1, op(171)), (rows) => {
    builds++;
    const next = structuredClone(rows[0].data); next.pearls.bag = []; next.gold += 600;
    return [{ id: A, data: next }];
  });
  await assert.rejects(pending, { code: 'unavailable' });
  assert.equal(calls, 2);
  assert.equal(builds, 1);
  sessions.close(1);
  await assert.rejects(sessions.open(2, A), { code: 'session' });
  await assert.rejects(sessions.flush(), { code: 'flush' });
  failReads = false;
  const recovered = await sessions.reconcilePearl(op(171));
  assert.equal(recovered.receipt.replay, true);
  assert.equal(calls, 2, 'reconciliation reads the receipt and snapshots only');
  assert.equal((await base.loadProfile(A)).data.gold, 640);
  assert.equal((await base.loadProfile(A)).version, 3);
  await sessions.open(2, A);
});

test('absent receipt fences closed lanes until explicit read-only reconciliation sees the late commit', async () => {
  const base = createMemoryStore();
  await account(base, A, profile(20)); await grant(base, A, UID1, op(18));
  const requests = []; let visible = false, commits = 0, reads = 0;
  const store = { ...base, async commitPearl(request) {
    commits++; requests.push(structuredClone(request));
    throw new Error('transport unavailable before the outcome is known');
  }, async loadPearlOperation(operationId) {
    reads++;
    return visible ? base.loadPearlOperation(operationId) : null;
  } };
  const sessions = sessionsFor(store);
  await sessions.open(1, A);
  let builds = 0;
  await assert.rejects(sessions.commitPearl(meta(UID1, A, null, 1, op(19)), (rows) => {
    builds++;
    const next = structuredClone(rows[0].data); next.pearls.bag = []; next.gold += 600;
    return [{ id: A, data: next }];
  }));
  assert.equal(commits, 2);
  assert.equal(builds, 1);
  assert.equal(reads, 1);
  sessions.close(1);
  await assert.rejects(sessions.open(2, A), { code: 'session' });
  await assert.rejects(sessions.flush(), { code: 'flush' });

  // Model a late server commit after the receipt read returned absent; reconciliation only reads it.
  assert.equal((await base.commitPearl(requests[0])).ok, true);
  visible = true;
  const recovered = await sessions.reconcilePearl(op(19));
  assert.ok(recovered.receipt);
  assert.equal(commits, 2, 'reconciliation must not submit another mutation');
  assert.equal((await base.loadProfile(A)).data.gold, 620);
  assert.equal((await base.loadProfile(A)).version, 3);
  await sessions.open(2, A);
});

test('an exact receipt is not applied over profiles and UID advanced by another writer', async () => {
  const base = createMemoryStore();
  await account(base, A, profile(20)); await account(base, B);
  await grant(base, A, UID1, op(20));
  const first = deferred(), second = deferred(), allowFirst = deferred(), allowSecond = deferred();
  let calls = 0, reads = 0, failStateReads = false;
  const store = { ...base, async commitPearl(request) {
    calls++;
    const result = await base.commitPearl(request);
    if (calls === 1) { first.resolve(); await allowFirst.promise; }
    if (calls === 2) { second.resolve(); await allowSecond.promise; }
    throw new Error('response lost after both attempts');
  }, async loadPearlOperation(operationId) {
    reads++;
    const receipt = await base.loadPearlOperation(operationId);
    if (reads === 1) {
      const differentPayload = structuredClone(receipt);
      differentPayload.request.profiles[0].data.gold++;
      return differentPayload;
    }
    return receipt;
  }, async loadProfile(id) {
    if (failStateReads) throw new Error('profile read unavailable');
    return base.loadProfile(id);
  }, async loadUnique(uid) {
    if (failStateReads) throw new Error('unique read unavailable');
    return base.loadUnique(uid);
  } };
  const sessions = sessionsFor(store);
  await sessions.open(1, A); await sessions.open(2, B);
  const pending = sessions.commitPearl(meta(UID1, A, null, 1, op(21)), (rows) => {
    const next = structuredClone(rows[0].data); next.pearls.bag = []; next.gold += 600;
    return [{ id: A, data: next }];
  });
  await first.promise; allowFirst.resolve(); await second.promise;
  const b = await base.loadProfile(B);
  const data = structuredClone(b.data); data.pearls.bag.push(pearl(UID1));
  const external = await base.commitPearl({
    operationId: op(22), uid: UID1, kind: 'brasa', from: null, to: B, expectedVersion: 2,
    profiles: [{ id: B, expectedVersion: b.version, data }],
  });
  assert.equal(external.ok, true);
  allowSecond.resolve();
  await assert.rejects(pending, { code: 'operation' });
  sessions.close(1);
  await assert.rejects(sessions.open(3, A), { code: 'session' });
  await assert.rejects(sessions.flush(), { code: 'flush' });
  failStateReads = true;
  await assert.rejects(sessions.reconcilePearl(op(21)), { code: 'unavailable' });
  await assert.rejects(sessions.open(3, A), { code: 'session' });
  failStateReads = false;
  await assert.rejects(sessions.reconcilePearl(op(21)), { code: 'conflict' });
  assert.equal(calls, 2);
  assert.equal(reads, 3);
  assert.equal((await base.loadUnique(UID1)).holder, B);
  assert.equal((await base.loadProfile(A)).data.gold, 620);
  assert.equal((await base.loadProfile(A)).version, 3);
});

test('close before dispatch cancels the operation and retains the account through its final save', async () => {
  const base = createMemoryStore(); await account(base, A);
  const saveStarted = deferred(), releaseSave = deferred(); let operations = 0;
  const store = {
    ...base,
    async saveProfile(...args) { saveStarted.resolve(); await releaseSave.promise; return base.saveProfile(...args); },
    async commitPearl(...args) { operations++; return base.commitPearl(...args); },
  };
  const sessions = sessionsFor(store);
  await sessions.open(1, A);
  sessions.save(1, profile(8));
  await saveStarted.promise;
  const pending = sessions.commitPearl(meta(UID1, null, A, 0, op(21)), (rows) => move(rows, UID1, null, A));
  sessions.close(1);
  const canceled = assert.rejects(pending, { code: 'cancelled' });
  await assert.rejects(sessions.open(2, A), { code: 'session' });
  assert.equal(operations, 0);
  releaseSave.resolve(); await canceled; await sessions.flush();
  assert.equal((await base.loadProfile(A)).data.gold, 8);
  await sessions.open(2, A);
});

test('close after dispatch waits for the operation and rebased final write before releasing the account', async () => {
  const base = createMemoryStore(); await account(base, A, profile(5)); await grant(base, A, UID1, op(22));
  const sent = deferred(), reply = deferred();
  const store = { ...base, async commitPearl(request) {
    const result = await base.commitPearl(request); sent.resolve(); await reply.promise; return result;
  } };
  const sessions = sessionsFor(store);
  const p = await sessions.open(1, A);
  const pending = sessions.commitPearl(meta(UID1, A, null, 1, op(23)), (rows) => {
    const next = structuredClone(rows[0].data); next.pearls.bag = []; next.gold += 600;
    return [{ id: A, data: next }];
  });
  await sent.promise;
  const later = structuredClone(p); later.gold += 12; later.xp = 7;
  sessions.save(1, later);
  sessions.close(1);
  await assert.rejects(sessions.open(2, A), { code: 'session' });
  let flushed = false; const flushing = sessions.flush().then(() => { flushed = true; });
  await turn(); assert.equal(flushed, false);
  reply.resolve(); await pending; await flushing;
  const saved = await base.loadProfile(A);
  assert.equal(saved.data.gold, 617);
  assert.equal(saved.data.xp, 7);
  assert.deepEqual(saved.data.pearls.bag, []);
  assert.equal((await base.loadUnique(UID1)).holder, null);
  await sessions.open(2, A);
});
