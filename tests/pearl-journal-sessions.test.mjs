import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { pearlOperation } from '../server/pearlOperations.mjs';
import { groundResult } from '../server/pearlGround.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORLD = 'overworld:harbor';
const op = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UID = (n = 1) => `journal-pearl-${n}`;
const spot = { x: 4, z: 9, availableAt: 10, returnAt: 20 };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const profile = () => newProfile();
const account = async (store, id) => assert.equal((await store.saveProfile(id, profile(), 0)).ok, true);
const pearlReq = (id, uid, from, to, expectedVersion, data) => ({ operationId: op(id), uid, kind: 'brasa', from, to,
  expectedVersion, world: WORLD, ground: to ? null : spot, profiles: data ? [{ id: from ?? to, expectedVersion: 1, data }] : [] });
const make = (store, journals, scope = WORLD) => new ProfileSessions(store, null, { journal: journals(scope) });
const seed = (journals, req, family = 'ground') => journals(WORLD).prepare(family, req);

test('restart before dispatch is read-only, fences account UID and UUID, then exact resume sends once', async () => {
  const base = createMemoryStore(), journals = createMemoryPearlJournals(), req = pearlReq(1, UID(), null, null, 0);
  await seed(journals, req);
  let reads = 0, sends = 0, builds = 0;
  const store = { ...base, async loadPearlGroundOperation(id) { reads++; return base.loadPearlGroundOperation(id); },
    async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } };
  const sessions = make(store, journals);
  assert.deepEqual(await sessions.recoverPearls(), [{ operationId: op(1), outcome: 'pending' }]);
  assert.equal(reads, 1); assert.equal(sends, 0);
  await sessions.open(1, A); // Ground-only work has no account endpoint to reserve.
  await assert.rejects(sessions.resumePearl(op(1)), { code: 'operation' });
  await assert.rejects(sessions.commitPearlGround({ ...req, operationId: op(2) }, () => { builds++; return []; }), { code: 'busy' });
  await assert.rejects(sessions.commitPearlGround({ ...req, operationId: op(1), uid: UID(9) }, () => { builds++; return []; }), { code: 'busy' });
  const result = await sessions.resumePearlGround(op(1));
  assert.equal(result.receipt.location.version, 1); assert.equal(sends, 1); assert.equal(builds, 0);
});

test('receipt after SQL commit is recovered without mutation and credits only through authoritative state', async () => {
  const base = createMemoryStore(), journals = createMemoryPearlJournals(), req = pearlReq(2, UID(2), null, null, 0);
  await base.commitPearlGround({ ...req }); await seed(journals, req);
  let sends = 0, builds = 0;
  const sessions = make({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }, journals);
  assert.deepEqual(await sessions.recoverPearls(), [{ operationId: op(2), outcome: 'committed' }]);
  assert.equal(sends, 0); assert.equal(builds, 0);
  assert.equal((await base.loadPearlLocation(UID(2))).version, 1);
});

test('committed sale receipt reconstructs once without another send or a second gold credit', async () => {
  const base = createMemoryStore(), journals = createMemoryPearlJournals(); await account(base, A);
  const initial = await base.loadProfile(A), owned = structuredClone(initial.data); owned.pearls.bag.push({ uid: UID(22), kind: 'brasa' });
  await base.commitPearl({ operationId: op(122), uid: UID(22), kind: 'brasa', from: null, to: A,
    expectedVersion: 0, profiles: [{ id: A, expectedVersion: initial.version, data: owned }] });
  const row = await base.loadProfile(A), sold = structuredClone(row.data); sold.pearls.bag = []; sold.gold += 600;
  const request = { operationId: op(22), uid: UID(22), kind: 'brasa', from: A, to: null, expectedVersion: 1,
    world: WORLD, ground: spot, profiles: [{ id: A, expectedVersion: row.version, data: sold }] };
  await base.commitPearlGround(request); await seed(journals, request);
  let sends = 0;
  const store = { ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } };
  const sessions = make(store, journals);
  assert.deepEqual(await sessions.recoverPearls(), [{ operationId: op(22), outcome: 'committed' }]);
  assert.equal(sends, 0); assert.equal((await base.loadProfile(A)).data.gold, 600);
  assert.equal((await sessions.open(1, A)).gold, 600);
});

test('recovered account transfer fences both endpoint accounts until its receipt is reconciled', async () => {
  const base = createMemoryStore(), journals = createMemoryPearlJournals(); await account(base, A); await account(base, B);
  const beforeA = await base.loadProfile(A), owned = structuredClone(beforeA.data); owned.pearls.bag.push({ uid: UID(8), kind: 'brasa' });
  assert.equal((await base.commitPearl({ operationId: op(80), uid: UID(8), kind: 'brasa', from: null, to: A,
    expectedVersion: 0, profiles: [{ id: A, expectedVersion: beforeA.version, data: owned }] })).ok, true);
  const rowA = await base.loadProfile(A), rowB = await base.loadProfile(B), received = structuredClone(rowB.data);
  received.pearls.bag.push({ uid: UID(8), kind: 'brasa' });
  const { request } = pearlOperation({ operationId: op(8), uid: UID(8), kind: 'brasa', from: A, to: B,
    expectedVersion: 1, profiles: [{ id: A, expectedVersion: rowA.version, data: (() => { const d = structuredClone(rowA.data); d.pearls.bag = []; return d; })() },
      { id: B, expectedVersion: rowB.version, data: received }] });
  await seed(journals, { operationId: op(8), ...request }, 'pearl');
  const sessions = make(base, journals); await sessions.recoverPearls();
  await assert.rejects(sessions.open(1, A), { code: 'busy' });
  await assert.rejects(sessions.open(2, B), { code: 'busy' });
  await sessions.open(3, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
});

test('advanced authoritative location settles conflict and never returns the historical receipt', async () => {
  const base = createMemoryStore(), journals = createMemoryPearlJournals();
  const old = pearlReq(3, UID(3), null, null, 0); await base.commitPearlGround(old);
  const newer = { ...old, operationId: op(4), expectedVersion: 1, ground: { ...spot, x: 8 } };
  await base.commitPearlGround(newer); await seed(journals, old);
  const sessions = make(base, journals);
  assert.deepEqual(await sessions.recoverPearls(), [{ operationId: op(3), outcome: 'conflict' }]);
  assert.equal((await base.loadPearlLocation(UID(3))).version, 2);
  await assert.rejects(sessions.resumePearlGround(op(3)), { code: 'operation' });
});

test('profile, ledger or location read failure leaves a committed receipt pending and fenced', async (t) => {
  for (const failingRead of ['profile', 'unique', 'location']) await t.test(failingRead, async () => {
    const base = createMemoryStore(), journals = createMemoryPearlJournals(); await account(base, A);
    const initial = await base.loadProfile(A), owned = structuredClone(initial.data); owned.pearls.bag.push({ uid: UID(9), kind: 'brasa' });
    await base.commitPearl({ operationId: op(89), uid: UID(9), kind: 'brasa', from: null, to: A,
      expectedVersion: 0, profiles: [{ id: A, expectedVersion: initial.version, data: owned }] });
    const row = await base.loadProfile(A), sold = structuredClone(row.data); sold.pearls.bag = []; sold.gold += 600;
    const req = { operationId: op(9), uid: UID(9), kind: 'brasa', from: A, to: null, expectedVersion: 1,
      world: WORLD, ground: spot, profiles: [{ id: A, expectedVersion: row.version, data: sold }] };
    await base.commitPearlGround(req); await seed(journals, req);
    const store = { ...base,
      async loadProfile(id) { if (failingRead === 'profile') throw new Error('profile read failed'); return base.loadProfile(id); },
      async loadUnique(uid) { if (failingRead === 'unique') throw new Error('ledger read failed'); return base.loadUnique(uid); },
      async loadPearlLocation(uid) { if (failingRead === 'location') throw new Error('location read failed'); return base.loadPearlLocation(uid); },
    };
    const sessions = make(store, journals);
    assert.deepEqual(await sessions.recoverPearls(), [{ operationId: op(9), outcome: 'pending' }]);
    await assert.rejects(sessions.resumePearlGround(op(9)));
    await assert.rejects(sessions.open(1, A), { code: 'busy' });
  });
});

test('lost prepare reply leaves no dispatch and explicit resume reprepares exact request once', async () => {
  const base = createMemoryStore(), backing = createMemoryPearlJournals(); let prepares = 0, sends = 0;
  const journal = (scope) => { const real = backing(scope); return { ...real, async prepare(...args) {
    prepares++; const row = await real.prepare(...args); if (prepares === 1) throw new Error('reply lost'); return row;
  } }; };
  const sessions = new ProfileSessions({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }, null, { journal: journal(WORLD) });
  await sessions.recoverPearls();
  await assert.rejects(sessions.commitPearlGround(pearlReq(5, UID(5), null, null, 0), () => []));
  assert.equal(sends, 0); assert.equal(prepares, 1);
  const result = await sessions.resumePearlGround(op(5));
  assert.equal(result.receipt.location.version, 1); assert.equal(prepares, 2); assert.equal(sends, 1);
});

test('resolve write failure retains all fences; read-only retry closes journal without another mutation', async () => {
  const base = createMemoryStore(), backing = createMemoryPearlJournals(); let resolveCalls = 0, sends = 0;
  const journal = (scope) => { const real = backing(scope); return { ...real, async resolve(...args) {
    resolveCalls++; if (resolveCalls === 1) throw new Error('lost resolve'); return real.resolve(...args);
  } }; };
  const sessions = new ProfileSessions({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }, null, { journal: journal(WORLD) });
  await sessions.recoverPearls();
  await assert.rejects(sessions.commitPearlGround(pearlReq(6, UID(6), null, null, 0), () => []));
  await assert.rejects(sessions.commitPearlGround(pearlReq(7, UID(6), null, null, 0), () => []), { code: 'busy' });
  assert.equal(sends, 1);
  const reconciled = await sessions.reconcilePearlGround(op(6));
  assert.equal(reconciled.receipt.location.version, 1);
  assert.equal(sends, 1);
});

test('corrupt, failed or overlapping backlog fails closed before opening or dispatch', async (t) => {
  for (const mode of ['throw', 'corrupt', 'duplicate', 'same-uid', 'account-overlap']) await t.test(mode, async () => {
    const backing = createMemoryPearlJournals(), req = pearlReq(10, UID(10), null, null, 0);
    await seed(backing, req);
    if (mode === 'same-uid') await seed(backing, { ...req, operationId: op(11) });
    if (mode === 'account-overlap') {
      const dataA = profile(), dataB = profile(); dataA.pearls.bag.push({ uid: UID(11), kind: 'brasa' });
      dataB.pearls.bag.push({ uid: UID(12), kind: 'brasa' });
      for (const n of [11, 12]) {
        const a = structuredClone(dataA), b = structuredClone(dataB);
        a.pearls.bag[0].uid = UID(n); b.pearls.bag[0].uid = UID(n);
        const built = pearlOperation({ operationId: op(n), uid: UID(n), kind: 'brasa', from: A, to: B,
          expectedVersion: 1, profiles: [{ id: A, expectedVersion: 1, data: a }, { id: B, expectedVersion: 1, data: b }] });
        await seed(backing, { operationId: op(n), ...built.request }, 'pearl');
      }
    }
    const journal = (scope) => { const real = backing(scope); return { ...real, async list(options) {
      if (mode === 'throw') throw new Error('offline');
      const rows = await real.list(options);
      if (mode === 'corrupt' && rows.length) rows[0].request.uid = 'invalid changed identity';
      if (mode === 'duplicate' && rows.length && !options.afterId) return [rows[0], { ...rows[0] }];
      return rows;
    } }; };
    const sessions = new ProfileSessions(createMemoryStore(), null, { journal: journal(WORLD) });
    await assert.rejects(sessions.recoverPearls());
    await assert.rejects(sessions.open(1, A), { code: 'recovery' });
  });
});

test('65 distinct ground-only pendings are completely paged and reserved before admission', async () => {
  const backing = createMemoryPearlJournals();
  for (let i = 1; i <= 65; i++) await seed(backing, pearlReq(i, UID(i), null, null, 0));
  let pages = 0;
  const journal = (scope) => { const real = backing(scope); return { ...real, async list(opts) { pages++; return real.list(opts); } }; };
  const sessions = new ProfileSessions(createMemoryStore(), null, { journal: journal(WORLD) });
  const outcomes = await sessions.recoverPearls();
  assert.equal(outcomes.length, 65); assert.equal(pages, 2);
  await assert.rejects(sessions.commitPearlGround(pearlReq(66, UID(65), null, null, 0), () => []), { code: 'busy' });
});

test('wrong family resume and unavailable/malformed/changed receipts never authorize a send', async (t) => {
  for (const mode of ['missing', 'malformed', 'changed', 'read-failure']) await t.test(mode, async () => {
    const backing = createMemoryPearlJournals(), req = pearlReq(20, UID(20), null, null, 0);
    await seed(backing, req); let sends = 0;
    const base = createMemoryStore();
    const store = { ...base, async loadPearlGroundOperation() {
      if (mode === 'read-failure') throw new Error('read failure');
      if (mode === 'malformed') return { request: {}, result: {} };
      if (mode === 'changed') {
        const changed = { ...req, uid: UID(21), ground: { ...spot, x: 99 } };
        const { operationId: _id, ...request } = changed;
        return { request, result: groundResult(request) };
      }
      return null;
    }, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } };
    const sessions = make(store, backing); await sessions.recoverPearls();
    await assert.rejects(sessions.resumePearl(op(20)), { code: 'operation' });
    if (mode === 'missing') {
      const result = await sessions.resumePearlGround(op(20));
      assert.equal(result.receipt.location.version, 1);
    } else await assert.rejects(sessions.resumePearlGround(op(20)));
    assert.equal(sends, mode === 'missing' ? 1 : 0);
  });
});

test('close while prepare is delayed cancels before dispatch and releases only after terminal rejection', async () => {
  const base = createMemoryStore(), backing = createMemoryPearlJournals(), entered = deferred(), release = deferred();
  let sends = 0; const terminal = [];
  const journal = (scope) => { const real = backing(scope); return { ...real,
    async prepare(...args) { entered.resolve(); await release.promise; return real.prepare(...args); },
    async resolve(...args) { terminal.push(args[2]); return real.resolve(...args); },
  }; };
  const sessions = new ProfileSessions({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }, null, { journal: journal(WORLD) });
  await sessions.recoverPearls();
  await account(base, A);
  const live = await sessions.open(1, A);
  const data = structuredClone(live); data.pearls.bag.push({ uid: UID(30), kind: 'brasa' });
  const request = { ...pearlReq(30, UID(30), null, A, 0, data), ground: null };
  const task = sessions.commitPearlGround(request, () => [{ id: A, data }]);
  await entered.promise; sessions.close(1); release.resolve(); await assert.rejects(task, { code: 'cancelled' });
  assert.equal(sends, 0);
  assert.deepEqual(terminal, ['rejected']);
  assert.deepEqual(await backing(WORLD).list(), []);
  assert.equal(sessions.pearls.unresolved.size, 0);
  assert.equal(sessions.accounts.has(A), false);
  await sessions.open(2, A);
});

test('save arriving during delayed journal resolve rebases gold and progress after commit', async () => {
  const base = createMemoryStore(); await account(base, A);
  const initial = await base.loadProfile(A), owned = structuredClone(initial.data); owned.pearls.bag.push({ uid: UID(40), kind: 'brasa' });
  assert.equal((await base.commitPearl({ operationId: op(39), uid: UID(40), kind: 'brasa', from: null, to: A,
    expectedVersion: 0, profiles: [{ id: A, expectedVersion: initial.version, data: owned }] })).ok, true);
  const backing = createMemoryPearlJournals(), entered = deferred(), release = deferred();
  let sends = 0;
  const journal = (scope) => { const real = backing(scope); return { ...real, async resolve(...args) { entered.resolve(); await release.promise; return real.resolve(...args); } }; };
  const sessions = new ProfileSessions({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }, null, { journal: journal(WORLD) });
  await sessions.recoverPearls(); const live = await sessions.open(1, A);
  const req = pearlReq(40, UID(40), A, null, 1);
  const task = sessions.commitPearlGround(req, (rows) => [{ id: A, data: (() => {
    const p = structuredClone(rows[0].data); p.pearls.bag = []; p.gold += 600; return p;
  })() }]);
  await entered.promise; const later = structuredClone(live); later.gold = 9; later.xp = 4; sessions.save(1, later);
  release.resolve(); await task; await sessions.flush();
  const saved = await base.loadProfile(A); assert.equal(saved.data.gold, 609); assert.equal(saved.data.xp, 4);
  assert.deepEqual(saved.data.pearls.bag, []); assert.equal(saved.version, 4); assert.equal(sends, 1);
});
