import assert from 'node:assert/strict';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { pearlMutationGate } from '../../server/pearlMutationGate.mjs';
import { batchIntent } from '../../server/pearlBatch.mjs';
import { journalEntry } from '../../server/pearlJournal.mjs';
import { StoreError } from '../../server/store.mjs';
import { A, B, WORLD, pearls, op, seed, request, state } from './pearl-batch.mjs';

export const intent = (raw) => batchIntent({ operationId: raw.operationId, world: raw.world, mode: raw.mode,
  actor: raw.profile.id, items: raw.items });
const build = (mode = 'death') => (rows) => [{ id: A, data: request(rows[0], mode).profile.data }];
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const sessionsFor = async (f, store = f.store, journal = f.journal) => {
  const sessions = new ProfileSessions(store, null, { journal });
  await sessions.recoverPearls();
  await sessions.open(1, A); await sessions.open(2, B);
  return sessions;
};
const blocked = (s, raw) => {
  assert.equal(s.pearls.uids.size, raw.items.length);
  for (const q of raw.items) assert.throws(() => pearlMutationGate(s).assertAvailable({ uids: [q.uid] }), { code: 'busy' });
  assert.throws(() => pearlMutationGate(s).assertAvailable({ accounts: [A] }), { code: 'busy' });
};
const single = (q, id = op(80)) => ({ operationId: id, ...q, from: null, to: null, expectedVersion: 1,
  world: WORLD, profiles: [], ground: { x: 0, z: 0, availableAt: 10, returnAt: 100 } });

export async function queueContract(t, setup) {
  for (const mode of ['death', 'replace']) for (const tracked of [true, false]) await t.test(`${mode}/${tracked}: one build, one batch, all resources reserved`, async () => {
    const f = await setup();
    try {
      const p = await seed(f.store, tracked), raw = request(p, mode), started = deferred(), finish = deferred();
      let builds = 0, sends = 0;
      const sessions = await sessionsFor(f, { ...f.store, async commitPearlBatch(r) {
        sends++; started.resolve(); await finish.promise; return f.store.commitPearlBatch(r);
      } });
      const pending = sessions.commitPearlBatch(intent(raw), (rows) => { builds++; return build(mode)(rows); });
      blocked(sessions, raw); await started.promise;
      for (const q of raw.items) {
        await assert.rejects(sessions.commitPearlGround(single(q), () => { builds++; return []; }), { code: 'busy' });
        await assert.rejects(sessions.commitPearl({ ...q, operationId: op(81), from: null, to: B, expectedVersion: 1 },
          () => { builds++; return []; }), { code: 'busy' });
      }
      await assert.rejects(sessions.commitPearlBatch({ ...intent(raw), operationId: op(82) }, build(mode)), { code: 'busy' });
      finish.resolve(); const result = await pending; await sessions.flush();
      assert.equal(builds, 1); assert.equal(sends, 1); assert.equal(result.receipt.uniques.length, raw.items.length);
      assert.deepEqual(result.profiles, [{ id: A, data: raw.profile.data }]);
      assert.equal(sessions.pearls.uids.size, 0); assert.equal((await f.journal.prepare('batch', raw)).state, 'committed');
      for (const q of raw.items) assert.equal((await f.store.loadUnique(q.uid)).version, 2);
    } finally { await f.close?.(); }
  });

  await t.test('earlier ordinary CAS writes drain before the profile builds; late progress rebases once', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), saved = deferred(), releaseSave = deferred(), sent = deferred(), releaseSend = deferred();
      let writes = 0, builds = 0, concrete;
      const sessions = await sessionsFor(f, { ...f.store,
        async saveProfile(...args) { if (++writes === 1) { saved.resolve(); await releaseSave.promise; } return f.store.saveProfile(...args); },
        async commitPearlBatch(r) { concrete = structuredClone(r); sent.resolve(); await releaseSend.promise; return f.store.commitPearlBatch(r); },
      });
      const earlier = structuredClone(p.data); earlier.xp += 7;
      sessions.save(1, earlier); await saved.promise;
      const coalesced = structuredClone(earlier); coalesced.gold += 13; sessions.save(1, coalesced);
      const pending = sessions.commitPearlBatch(intent(request(p)), (rows) => {
        builds++; assert.equal(rows[0].version, p.version + 2); assert.deepEqual(rows[0].data, coalesced);
        return build()(rows);
      });
      releaseSave.resolve(); await sent.promise;
      const later = structuredClone(coalesced); later.xp += 19; later.gold += 23; later.mast[0][1] += 31;
      sessions.save(1, later); later.gold = 9999; // The queue must detach snapshots.
      releaseSend.resolve(); const result = await pending; await sessions.flush();
      const final = await f.store.loadProfile(A);
      assert.equal(builds, 1); assert.equal(concrete.profile.expectedVersion, p.version + 2);
      assert.equal(final.version, p.version + 4); assert.equal(final.data.xp, coalesced.xp + 19);
      assert.equal(final.data.gold, coalesced.gold + 23); assert.equal(final.data.mast[0][1], coalesced.mast[0][1] + 31);
      assert.deepEqual(final.data.pearls, { bag: [], swallowed: null });
      assert.deepEqual(result.profiles[0].data, final.data);
    } finally { await f.close?.(); }
  });

  await t.test('single-UID reservation blocks a batch before builder, leaving other UID lanes untouched', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), sessions = await sessionsFor(f), gate = pearlMutationGate(sessions);
      const held = gate.reserve({ uids: [pearls[1].uid] }); let builds = 0;
      await assert.rejects(sessions.commitPearlBatch(intent(request(p)), () => { builds++; return []; }), { code: 'busy' });
      assert.equal(builds, 0); assert.equal(sessions.pearls.uids.size, 0);
      gate.assertAvailable({ uids: [pearls[0].uid, pearls[2].uid] }); gate.release(held);
    } finally { await f.close?.(); }
  });

  await t.test('old ground queue holds an overlapping middle UID before any batch builder runs', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), heldRead = deferred(), releaseRead = deferred(); let pause = false, builds = 0;
      const store = { ...f.store, async loadUnique(uid) {
        if (pause && uid === pearls[1].uid) { heldRead.resolve(); await releaseRead.promise; }
        return f.store.loadUnique(uid);
      } };
      const sessions = await sessionsFor(f, store); pause = true;
      // The old intent is later rejected by ownership; its unresolved preflight still owns the UID lane.
      const old = sessions.commitPearlGround(single(pearls[1]), () => []);
      const rejected = assert.rejects(old, { code: 'conflict' }); await heldRead.promise;
      await assert.rejects(sessions.commitPearlBatch(intent(request(p)), () => { builds++; return []; }), { code: 'busy' });
      assert.equal(builds, 0); assert.equal(sessions.pearls.uids.size, 1);
      pearlMutationGate(sessions).assertAvailable({ uids: [pearls[0].uid, pearls[2].uid] });
      releaseRead.resolve(); await rejected; assert.equal(sessions.pearls.uids.size, 0);
    } finally { await f.close?.(); }
  });

  await t.test('caller gameplay reservation survives storage completion and rejects a missing middle UID', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), sessions = await sessionsFor(f), gate = pearlMutationGate(sessions), raw = request(p);
      const incomplete = gate.reserve({ accounts: [A], uids: raw.items.filter((_q, i) => i !== 1).map((q) => q.uid) });
      await assert.rejects(sessions.commitPearlBatch(intent(raw), build(), incomplete), { code: 'operation' });
      gate.release(incomplete);
      const held = gate.reserve({ accounts: [A], uids: raw.items.map((q) => q.uid) });
      await sessions.commitPearlBatch(intent(raw), build(), held); await sessions.flush();
      assert.equal(sessions.pearls.uids.size, 0);
      for (const q of raw.items) assert.throws(() => gate.assertAvailable({ uids: [q.uid] }), { code: 'busy' });
      gate.release(held); gate.assertAvailable({ accounts: [A], uids: raw.items.map((q) => q.uid) });
    } finally { await f.close?.(); }
  });

  for (const mode of ['death', 'replace']) await t.test(`${mode}: incompatible pending slot mixture fences the whole batch`, async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p, mode), started = deferred(), finish = deferred();
      const sessions = await sessionsFor(f, { ...f.store, async commitPearlBatch(r) {
        started.resolve(); await finish.promise; return f.store.commitPearlBatch(r);
      } });
      const pending = sessions.commitPearlBatch(intent(raw), build(mode)); await started.promise;
      const mixed = structuredClone(p.data); mixed.pearls.bag.pop(); sessions.save(1, mixed);
      finish.resolve(); await assert.rejects(pending, { code: 'ownership' });
      const row = await f.store.loadProfile(A);
      assert.deepEqual(row, { version: p.version + 1, data: raw.profile.data });
      assert.equal(sessions.clients.get(1).version, p.version, 'local authority did not partly advance');
      assert.equal(sessions.clients.get(1).failed, true); await assert.rejects(sessions.flush(), { code: 'flush' });
    } finally { await f.close?.(); }
  });

  for (const bad of ['middle generation', 'middle kind', 'middle world', 'builder progress', 'partial death']) await t.test(`${bad}: preflight never prepares or sends a partial batch`, async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p), meta = intent(raw); let prepares = 0, sends = 0;
      const journal = { ...f.journal, async prepare(...args) { prepares++; return f.journal.prepare(...args); } };
      const store = { ...f.store, async commitPearlBatch(r) { sends++; return f.store.commitPearlBatch(r); },
        async loadPearlLocation(uid) { const row = await f.store.loadPearlLocation(uid);
          return bad === 'middle world' && uid === pearls[1].uid ? { ...row, world: 'other' } : row; } };
      const sessions = await sessionsFor(f, store, journal);
      if (bad === 'middle generation') meta.items[1].expectedVersion++;
      if (bad === 'middle kind') meta.items[1].kind = 'tinta';
      if (bad === 'partial death') meta.items.pop();
      const before = await state(f.store);
      await assert.rejects(sessions.commitPearlBatch(meta, (rows) => {
        const built = build()(rows); if (bad === 'builder progress') built[0].data.gold++; return built;
      }));
      assert.equal(prepares, 0); assert.equal(sends, 0); assert.deepEqual(await state(f.store), before);
    } finally { await f.close?.(); }
  });

  await t.test('ambiguous preparation holds every UID; fresh recovery reads then explicit resume sends the frozen request once', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p), before = await state(f.store); let sends = 0, builds = 0;
      const lost = { ...f.journal, async prepare(...args) { await f.journal.prepare(...args); throw new StoreError('unavailable'); } };
      const store = { ...f.store, async commitPearlBatch(r) { sends++; assert.deepEqual(r, raw); return f.store.commitPearlBatch(r); } };
      const first = await sessionsFor(f, store, lost);
      await assert.rejects(first.commitPearlBatch(intent(raw), (rows) => { builds++; return build()(rows); }), { code: 'unavailable' });
      blocked(first, raw); assert.equal(sends, 0); assert.deepEqual(await state(f.store), before);
      const second = new ProfileSessions(store, null, { journal: f.journal });
      assert.deepEqual(await second.recoverPearls(), [{ operationId: raw.operationId, outcome: 'pending' }]);
      blocked(second, raw); await assert.rejects(second.open(3, A), { code: 'busy' });
      await assert.rejects(second.resumePearlGround(raw.operationId), { code: 'operation' });
      await second.resumePearlBatch(raw.operationId); await second.flush();
      assert.equal(sends, 1); assert.equal(builds, 1); assert.equal(second.pearls.uids.size, 0);
      await assert.rejects(second.resumePearlBatch(raw.operationId), { code: 'operation' });
    } finally { await f.close?.(); }
  });

  await t.test('lost commit replies and unavailable receipt retain all lanes; exact fresh recovery performs no send', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p); let sends = 0;
      const store = { ...f.store, async commitPearlBatch(r) { sends++; await f.store.commitPearlBatch(r); throw new StoreError('unavailable'); },
        async loadPearlBatchOperation() { throw new StoreError('unavailable'); } };
      const first = await sessionsFor(f, store);
      await assert.rejects(first.commitPearlBatch(intent(raw), build()), { code: 'unavailable' });
      assert.equal(sends, 2); blocked(first, raw); first.close(1); await assert.rejects(first.flush(), { code: 'flush' });
      const second = new ProfileSessions({ ...f.store, async commitPearlBatch() { sends++; throw new Error('unexpected dispatch'); } }, null,
        { journal: f.journal });
      assert.deepEqual(await second.recoverPearls(), [{ operationId: raw.operationId, outcome: 'committed' }]);
      assert.equal(sends, 2); await second.flush(); assert.deepEqual((await second.open(3, A)).pearls, raw.profile.data.pearls);
    } finally { await f.close?.(); }
  });

  for (const missing of ['unique read', 'location read', 'invalid receipt']) await t.test(`${missing}: one uncertain item preserves the entire recovered reservation`, async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p); await f.journal.prepare('batch', raw); await f.store.commitPearlBatch(raw);
      let restored = false, sends = 0;
      const store = { ...f.store, async commitPearlBatch() { sends++; throw new Error('must be read-only'); },
        async loadUnique(uid) { if (!restored && missing === 'unique read' && uid === pearls[1].uid) throw new StoreError('unavailable'); return f.store.loadUnique(uid); },
        async loadPearlLocation(uid) { if (!restored && missing === 'location read' && uid === pearls[1].uid) throw new StoreError('unavailable'); return f.store.loadPearlLocation(uid); },
        async loadPearlBatchOperation(id) { const row = await f.store.loadPearlBatchOperation(id);
          if (!restored && missing === 'invalid receipt') row.result.uniques[1].version++; return row; },
      };
      const sessions = new ProfileSessions(store, null, { journal: f.journal });
      assert.deepEqual(await sessions.recoverPearls(), [{ operationId: raw.operationId, outcome: 'pending' }]);
      blocked(sessions, raw); await assert.rejects(sessions.resumePearlBatch(raw.operationId)); assert.equal(sends, 0);
      restored = true; await sessions.reconcilePearlBatch(raw.operationId); await sessions.flush();
      assert.equal(sends, 0); assert.equal(sessions.pearls.uids.size, 0);
    } finally { await f.close?.(); }
  });

  for (const drift of ['unique', 'location', 'profile']) await t.test(`${drift}: one authoritative advancement conflicts the entire batch without dispatch`, async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p); await f.journal.prepare('batch', raw); await f.store.commitPearlBatch(raw);
      const before = await state(f.store); let sends = 0;
      const store = { ...f.store, async commitPearlBatch() { sends++; throw new Error('must be read-only'); },
        async loadUnique(uid) { const row = await f.store.loadUnique(uid); if (drift === 'unique' && uid === pearls[1].uid) row.version++; return row; },
        async loadPearlLocation(uid) { const row = await f.store.loadPearlLocation(uid); if (drift === 'location' && uid === pearls[1].uid) row.version++; return row; },
        async loadProfile(id) { const row = await f.store.loadProfile(id); if (drift === 'profile' && id === A) row.version++; return row; },
      };
      const sessions = new ProfileSessions(store, null, { journal: f.journal });
      assert.deepEqual(await sessions.recoverPearls(), [{ operationId: raw.operationId, outcome: 'conflict' }]);
      assert.equal((await f.journal.prepare('batch', raw)).state, 'conflict'); assert.equal(sends, 0);
      assert.deepEqual(await state(f.store), before); assert.equal(sessions.pearls.uids.size, 0);
    } finally { await f.close?.(); }
  });

  await t.test('terminal response loss remains recoverable without replaying the batch', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p); let lose = true, sends = 0;
      const journal = { ...f.journal, async resolve(...args) { const result = await f.journal.resolve(...args);
        if (lose) { lose = false; throw new StoreError('unavailable'); } return result; } };
      const sessions = await sessionsFor(f, { ...f.store, async commitPearlBatch(r) { sends++; return f.store.commitPearlBatch(r); } }, journal);
      await assert.rejects(sessions.commitPearlBatch(intent(raw), build()), { code: 'unavailable' }); blocked(sessions, raw);
      await sessions.reconcilePearlBatch(raw.operationId); assert.equal(sends, 1); assert.equal(sessions.pearls.uids.size, 0);
      assert.equal((await f.journal.prepare('batch', raw)).state, 'committed');
      await assert.rejects(sessions.flush(), { code: 'flush' }); // Failed authority stays sticky.
    } finally { await f.close?.(); }
  });

  await t.test('definitive CAS rejection plus lost terminal write recovers without dispatch', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p), before = await state(f.store); let sends = 0, lose = true;
      const journal = { ...f.journal, async resolve(...args) {
        if (lose) { lose = false; throw new StoreError('unavailable'); } return f.journal.resolve(...args);
      } };
      const sessions = await sessionsFor(f, { ...f.store, async commitPearlBatch() { sends++; return { ok: false, why: 'conflict' }; } }, journal);
      await assert.rejects(sessions.commitPearlBatch(intent(raw), build()), { code: 'unavailable' }); blocked(sessions, raw);
      assert.deepEqual(await sessions.reconcilePearlBatch(raw.operationId), { outcome: 'rejected' });
      assert.equal(sends, 1); assert.deepEqual(await state(f.store), before); assert.equal(sessions.pearls.uids.size, 0);
      assert.equal((await f.journal.prepare('batch', raw)).state, 'rejected');
    } finally { await f.close?.(); }
  });

  await t.test('lost committed terminal reply followed by one advanced UID retains committed audit and retires stale apply', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p); let lose = true, advanced = false, sends = 0;
      const journal = { ...f.journal, async resolve(...args) { const result = await f.journal.resolve(...args);
        if (lose) { lose = false; throw new StoreError('unavailable'); } return result; } };
      const store = { ...f.store, async commitPearlBatch(r) { sends++; return f.store.commitPearlBatch(r); },
        async loadUnique(uid) { const row = await f.store.loadUnique(uid); if (advanced && uid === pearls[1].uid) row.version++; return row; } };
      const sessions = await sessionsFor(f, store, journal);
      await assert.rejects(sessions.commitPearlBatch(intent(raw), build()), { code: 'unavailable' }); blocked(sessions, raw);
      advanced = true; await assert.rejects(sessions.reconcilePearlBatch(raw.operationId), { code: 'conflict' });
      assert.equal(sends, 1); assert.equal(sessions.pearls.uids.size, 0);
      assert.equal((await f.journal.prepare('batch', raw)).state, 'committed');
    } finally { await f.close?.(); }
  });

  await t.test('close during preparation rejects the exact journal intent without dispatch', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p), prepared = deferred(), finish = deferred(); let sends = 0;
      const journal = { ...f.journal, async prepare(...args) { const row = await f.journal.prepare(...args);
        prepared.resolve(); await finish.promise; return row; } };
      const sessions = await sessionsFor(f, { ...f.store, async commitPearlBatch(r) { sends++; return f.store.commitPearlBatch(r); } }, journal);
      const pending = sessions.commitPearlBatch(intent(raw), build()); await prepared.promise;
      sessions.close(1); blocked(sessions, raw); finish.resolve(); await assert.rejects(pending, { code: 'cancelled' });
      assert.equal(sends, 0); assert.equal((await f.journal.prepare('batch', raw)).state, 'rejected');
      assert.equal(sessions.pearls.uids.size, 0); await sessions.flush();
    } finally { await f.close?.(); }
  });

  await t.test('overlap on a middle batch UID on page two prevents all admission and settlement', async () => {
    const f = await setup();
    try {
      const p = await seed(f.store), raw = request(p, 'death', op(100));
      const page = Array.from({ length: 63 }, (_, i) => journalEntry(WORLD, 'ground', single({ uid: `page-${i}`, kind: 'brasa' }, op(i + 30))));
      page.push(journalEntry(WORLD, 'batch', raw));
      let pages = 0, reads = 0;
      const journal = { ...f.journal, async list() { return pages++ === 0 ? page :
        [journalEntry(WORLD, 'ground', single(pearls[1], op(101)))]; } };
      const sessions = new ProfileSessions({ ...f.store, async loadPearlBatchOperation() { reads++; return null; } }, null, { journal });
      await assert.rejects(sessions.recoverPearls(), { code: 'response' }); assert.equal(reads, 0);
      assert.equal(sessions.pearls.uids.size, 0); await assert.rejects(sessions.open(1, A), { code: 'recovery' });
    } finally { await f.close?.(); }
  });
}
