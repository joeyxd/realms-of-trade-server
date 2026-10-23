import assert from 'node:assert/strict';
import { createMemoryStore, StoreError } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { pearlMutationGate } from '../../server/pearlMutationGate.mjs';
import { seedDeathDropScenario, pickupRequest, expiryRequest, deathOp, KILLER, VICTIM, WORLD } from './death-drop-storage.mjs';

export const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
export const memoryDropQueueSetup = async () => {
  const store = createMemoryStore();
  const journal = createMemoryPearlJournals(store)(WORLD);
  return { store, journal };
};

async function fixture(setup, mode = 'pickup') {
  const f = await setup(), source = await seedDeathDropScenario(f.store, { sourceOperation: 730 });
  const raw = mode === 'expire' ? await expiryRequest(source, { operation: 1030 }) : await pickupRequest(f.store, source, { operation: 1030 });
  return { ...f, source, raw };
}
async function seedManagedPearl(store) {
  const pearls = [{ uid: 'drop-queue-retained-pearl', kind: 'brasa' }, { uid: 'drop-queue-swallowed-pearl', kind: 'escarcha' }];
  for (const [index, pearl] of pearls.entries()) {
    const row = await store.loadProfile(KILLER), data = structuredClone(row.data); data.pearls.bag.push(pearl);
    const result = await store.commitPearl({ operationId: deathOp(1031 + index), ...pearl, from: null, to: KILLER,
      expectedVersion: 0, profiles: [{ id: KILLER, expectedVersion: row.version, data }] });
    assert.equal(result.ok, true);
  }
  const row = await store.loadProfile(KILLER), data = structuredClone(row.data);
  data.pearls.bag = data.pearls.bag.filter((pearl) => pearl.uid !== 'drop-queue-swallowed-pearl');
  data.pearls.swallowed = { uid: 'drop-queue-swallowed-pearl', kind: 'escarcha' };
  assert.equal((await store.saveProfile(KILLER, data, row.version)).ok, true);
  return pearls;
}
async function sessions(f, store = f.store, journal = f.journal) {
  const s = new ProfileSessions(store, null, { journal });
  await s.recoverPearls();
  await s.open(1, VICTIM); await s.open(2, KILLER);
  return s;
}
function lanes(raw) {
  const accounts = raw.profile ? [raw.profile.id] : [];
  const uids = raw.profile ? [...new Set([
    ...raw.profile.before.pearls.bag,
    ...(raw.profile.before.pearls.swallowed ? [raw.profile.before.pearls.swallowed] : []),
    ...raw.profile.data.pearls.bag,
    ...(raw.profile.data.pearls.swallowed ? [raw.profile.data.pearls.swallowed] : []),
  ].map((p) => p.uid))].sort() : [];
  return { accounts, uids, drops: [`${raw.drop.operationId}:${raw.drop.ordinal}`] };
}
function assertBlocked(s, raw) {
  const all = lanes(raw), gate = pearlMutationGate(s);
  for (const id of all.accounts) assert.throws(() => gate.assertAvailable({ accounts: [id] }),
    (error) => ['busy', 'session'].includes(error.code));
  for (const uid of all.uids) assert.throws(() => gate.assertAvailable({ uids: [uid] }), { code: 'busy' });
  for (const drop of all.drops) assert.throws(() => gate.assertAvailable({ drops: [drop] }), { code: 'busy' });
}

export async function deathDropQueueContract(t, setup) {
  for (const mode of ['pickup', 'expire']) await t.test(`${mode} dispatch freezes the exact request and holds every declared lane`, async () => {
    const f = await fixture(setup, mode), started = deferred(), release = deferred(); let sends = 0;
    try {
      const wanted = structuredClone(f.raw);
      const s = await sessions(f, { ...f.store, async commitDeathDrop(raw) {
        sends++; assert.deepEqual(raw, wanted); started.resolve(); await release.promise;
        return f.store.commitDeathDrop(raw);
      } });
      const resultPromise = s.commitDeathDrop(f.raw);
      assertBlocked(s, wanted); await started.promise; assertBlocked(s, wanted);
      f.raw.at++; if (f.raw.profile) f.raw.profile.data.gold++;
      await assert.rejects(s.commitDeathDrop(wanted), { code: 'busy' });
      release.resolve(); const result = await resultPromise; await s.flush();
      assert.equal(sends, 1); assert.equal(result.receipt.ok, true);
      assert.equal(result.receipt.drop.transitionOperationId, wanted.operationId);
      assert.equal((await f.store.loadDeathDrop(wanted.drop.operationId, wanted.drop.ordinal)).state,
        wanted.mode === 'pickup' ? 'picked' : 'expired');
      assert.equal((await f.journal.prepare('drop', wanted)).state, 'committed');
    } finally { release.resolve(); await f.close?.(); }
  });

  await t.test('pickup capability must include the exact receiver, pearl set, and source ordinal', async () => {
    const f = await fixture(setup); try {
      const s = await sessions(f), gate = pearlMutationGate(s), raw = f.raw, full = lanes(raw);
      const subsets = [
        { accounts: full.accounts, uids: full.uids, drops: [] },
        { accounts: full.accounts, uids: ['not-in-receiver-pearl-set'], drops: full.drops },
        { accounts: [], uids: full.uids, drops: full.drops },
      ];
      for (const subset of subsets) {
        const token = gate.reserve(subset);
        assert.throws(() => gate.assertStorageAvailable(lanes(raw), token), { code: 'operation' }, JSON.stringify(subset));
        gate.release(token);
      }
      const token = gate.reserve(full); await s.commitDeathDrop(raw, token); await s.flush();
      assertBlocked(s, raw); gate.release(token); gate.assertAvailable(full);
    } finally { await f.close?.(); }
  });

  await t.test('a pending account save must settle onto the new raw baseline before journal preparation', async () => {
    const f = await fixture(setup); let prepares = 0, sends = 0;
    try {
      const journal = { ...f.journal, async prepare(...args) { prepares++; return f.journal.prepare(...args); } };
      const s = await sessions(f, { ...f.store, async commitDeathDrop(raw) { sends++; return f.store.commitDeathDrop(raw); } }, journal);
      const changed = structuredClone(f.raw.profile.before); changed.gold++;
      s.save(2, changed); await s.flush();
      await assert.rejects(s.commitDeathDrop(f.raw), { code: 'conflict' });
      assert.equal(prepares, 0); assert.equal(sends, 0);
      assert.equal(await f.store.loadDeathDropOperation(f.raw.operationId), null);
      assert.equal((await f.store.loadProfile(KILLER)).data.gold, changed.gold);
    } finally { await f.close?.(); }
  });

  await t.test('a changed late receiver snapshot cannot be rebased over a committed pickup', async () => {
    const f = await fixture(setup), started = deferred(), release = deferred();
    try {
      const s = await sessions(f, { ...f.store, async commitDeathDrop(raw) {
        started.resolve(); await release.promise; return f.store.commitDeathDrop(raw);
      } });
      const pending = s.commitDeathDrop(f.raw); await started.promise;
      const late = structuredClone(f.raw.profile.data); late.xp++;
      s.save(2, late); release.resolve();
      await assert.rejects(pending, { code: 'conflict' });
      await assert.rejects(s.flush(), { code: 'flush' });
      assert.deepEqual((await f.store.loadProfile(KILLER)).data, f.raw.profile.data);
      assert.equal((await f.store.loadDeathDrop(f.raw.drop.operationId, f.raw.drop.ordinal)).state, 'picked');
    } finally { release.resolve(); await f.close?.(); }
  });

  await t.test('an unchanged late pre-pickup snapshot resolves to the exact committed profile', async () => {
    const f = await fixture(setup), started = deferred(), release = deferred();
    try {
      const s = await sessions(f, { ...f.store, async commitDeathDrop(raw) {
        started.resolve(); await release.promise; return f.store.commitDeathDrop(raw);
      } });
      const pending = s.commitDeathDrop(f.raw); await started.promise;
      s.save(2, structuredClone(f.raw.profile.before)); release.resolve();
      const result = await pending; await s.flush();
      assert.deepEqual(result.profiles, [{ id: KILLER, data: f.raw.profile.data }]);
      assert.deepEqual((await f.store.loadProfile(KILLER)).data, f.raw.profile.data);
    } finally { release.resolve(); await f.close?.(); }
  });

  await t.test('closing during journal prepare invalidates the exact drop capability before dispatch', async () => {
    const f = await fixture(setup), prepared = deferred(), release = deferred(); let sends = 0;
    try {
      const journal = { ...f.journal, async prepare(...args) {
        const row = await f.journal.prepare(...args); prepared.resolve(); await release.promise; return row;
      } };
      const s = await sessions(f, { ...f.store, async commitDeathDrop(raw) { sends++; return f.store.commitDeathDrop(raw); } }, journal);
      const gate = pearlMutationGate(s), token = gate.reserve(lanes(f.raw));
      const pending = assert.rejects(s.commitDeathDrop(f.raw, token), { code: 'cancelled' });
      await prepared.promise; s.close(2); release.resolve(); await pending;
      assert.equal(sends, 0); assert.equal(gate.active(token), false);
      assert.throws(() => gate.release(token), { code: 'busy' });
      assert.equal((await f.journal.prepare('drop', f.raw)).state, 'rejected');
      assert.throws(() => gate.assertAvailable({ drops: [`${f.raw.drop.operationId}:${f.raw.drop.ordinal}`] }), { code: 'busy' });
    } finally { release.resolve(); await f.close?.(); }
  });

  await t.test('managed receiver pearls stay excluded through the pickup reservation', async () => {
    const f = await fixture(setup); await seedManagedPearl(f.store);
    f.raw = await pickupRequest(f.store, f.source, { operation: 1030 });
    try {
      assert.ok(f.raw.profile.before.pearls.bag.some((pearl) => pearl.uid === 'drop-queue-retained-pearl'));
      assert.equal(f.raw.profile.before.pearls.swallowed.uid, 'drop-queue-swallowed-pearl');
      const s = await sessions(f), all = lanes(f.raw);
      assert.ok(all.uids.includes('drop-queue-retained-pearl') && all.uids.includes('drop-queue-swallowed-pearl'));
      const gate = pearlMutationGate(s), token = gate.reserve(all);
      assert.throws(() => gate.assertAvailable({ accounts: [KILLER] }), { code: 'busy' });
      assert.throws(() => gate.assertAvailable({ uids: ['drop-queue-retained-pearl'] }), { code: 'busy' });
      await s.commitDeathDrop(f.raw, token); gate.release(token); await s.flush();
      assert.deepEqual((await f.store.loadUnique('drop-queue-retained-pearl')),
        { holder: KILLER, kind: 'pearl:brasa', version: 1 });
      assert.deepEqual((await f.store.loadUnique('drop-queue-swallowed-pearl')),
        { holder: KILLER, kind: 'pearl:escarcha', version: 1 });
    } finally { await f.close?.(); }
  });

  await t.test('journal prepare timeout leaves a recoverable pending intent; restart inspection never resends', async () => {
    const f = await fixture(setup); let sends = 0;
    try {
      const store = { ...f.store, async commitDeathDrop(raw) {
        sends++; assert.deepEqual(raw, f.raw); return f.store.commitDeathDrop(raw);
      } };
      const first = await sessions(f, store, { ...f.journal, async prepare(...args) {
        await f.journal.prepare(...args); throw new StoreError('unavailable');
      } });
      await assert.rejects(first.commitDeathDrop(f.raw), { code: 'unavailable' });
      assertBlocked(first, f.raw); assert.equal(sends, 0);
      const next = new ProfileSessions(store, null, { journal: f.journal });
      assert.deepEqual(await next.recoverPearls(), [{ operationId: f.raw.operationId, outcome: 'pending' }]);
      assertBlocked(next, f.raw);
      await assert.rejects(next.reconcileDeathDrop(f.raw.operationId), { code: 'unavailable' });
      await next.resumeDeathDrop(f.raw.operationId); await next.flush();
      assert.equal(sends, 1); assert.equal((await f.journal.prepare('drop', f.raw)).state, 'committed');
    } finally { await f.close?.(); }
  });

  await t.test('lost commit response is reconciled by current receipt and exact current drop without replay send', async () => {
    const f = await fixture(setup); let sends = 0;
    try {
      const store = { ...f.store, async commitDeathDrop(raw) {
        sends++; await f.store.commitDeathDrop(raw); throw new StoreError('unavailable');
      } };
      const first = await sessions(f, store);
      const result = await first.commitDeathDrop(f.raw); await first.flush();
      assert.equal(result.receipt.replay, true); assert.equal(sends, 2);
      assert.equal((await f.journal.prepare('drop', f.raw)).state, 'committed');
      assert.equal((await f.store.loadDeathDrop(f.raw.drop.operationId, f.raw.drop.ordinal)).state, 'picked');
    } finally { await f.close?.(); }
  });

  await t.test('receipt with an advanced receiver profile closes as conflict with no historical apply', async () => {
    const f = await fixture(setup); try {
      await f.journal.prepare('drop', f.raw); await f.store.commitDeathDrop(f.raw);
      const current = await f.store.loadDeathDrop(f.raw.drop.operationId, f.raw.drop.ordinal);
      const nextRow = await f.store.loadProfile(KILLER), progress = structuredClone(nextRow.data); progress.gold++;
      await f.store.saveProfile(KILLER, progress, nextRow.version);
      // The profile no longer matches the receipt's post-state, so recovery must not restore it.
      const next = new ProfileSessions(f.store, null, { journal: f.journal });
      assert.deepEqual(await next.recoverPearls(), [{ operationId: f.raw.operationId, outcome: 'conflict' }]);
      await next.flush(); assert.deepEqual((await f.store.loadProfile(KILLER)).data, progress);
      assert.deepEqual(await f.store.loadDeathDrop(f.raw.drop.operationId, f.raw.drop.ordinal), current);
      assert.equal((await f.journal.prepare('drop', f.raw)).state, 'conflict');
    } finally { await f.close?.(); }
  });

  await t.test('unavailable receiver reads preserve pending lanes during receipt reconciliation', async () => {
    const f = await fixture(setup); let sends = 0;
    try {
      await f.journal.prepare('drop', f.raw); await f.store.commitDeathDrop(f.raw);
      const blockedStore = { ...f.store, async loadProfile() { throw new StoreError('unavailable'); },
        async commitDeathDrop(raw) { sends++; assert.deepEqual(raw, f.raw); return f.store.commitDeathDrop(raw); } };
      const s = new ProfileSessions(blockedStore, null, { journal: f.journal });
      assert.deepEqual(await s.recoverPearls(), [{ operationId: f.raw.operationId, outcome: 'pending' }]);
      assertBlocked(s, f.raw); assert.equal(sends, 0);
      await assert.rejects(s.flush(), { code: 'flush' });
      await assert.rejects(s.reconcileDeathDrop(f.raw.operationId), { code: 'unavailable' });
      assert.equal(sends, 0);
    } finally { await f.close?.(); }
  });

  for (const failure of ['unavailable', 'malformed']) await t.test(`current drop ${failure} during receipt inspection remains pending`, async () => {
    const f = await fixture(setup); let sends = 0;
    try {
      await f.journal.prepare('drop', f.raw); await f.store.commitDeathDrop(f.raw);
      const store = { ...f.store,
        async loadDeathDrop(operationId, ordinal) {
          const row = await f.store.loadDeathDrop(operationId, ordinal);
          if (failure === 'unavailable') throw new StoreError('unavailable');
          return { ...row, injectedMetadata: true };
        },
        async commitDeathDrop() { sends++; assert.fail('startup receipt inspection cannot replay'); },
      };
      const next = new ProfileSessions(store, null, { journal: f.journal });
      assert.deepEqual(await next.recoverPearls(), [{ operationId: f.raw.operationId, outcome: 'pending' }]);
      assertBlocked(next, f.raw); assert.equal(sends, 0);
      await assert.rejects(next.flush(), { code: 'flush' });
    } finally { await f.close?.(); }
  });

  await t.test('resume uses the journaled tick and baseline after authority returns, and rejects stale CAS', async () => {
    const f = await fixture(setup); let sends = 0, unavailable = true;
    try {
      await f.journal.prepare('drop', f.raw);
      const store = { ...f.store,
        async loadProfile(id) { if (unavailable) throw new StoreError('unavailable'); return f.store.loadProfile(id); },
        async commitDeathDrop(raw) { sends++; assert.deepEqual(raw, f.raw); return f.store.commitDeathDrop(raw); } };
      const s = new ProfileSessions(store, null, { journal: f.journal });
      assert.deepEqual(await s.recoverPearls(), [{ operationId: f.raw.operationId, outcome: 'pending' }]);
      assert.equal(sends, 0); unavailable = false;
      const row = await f.store.loadProfile(KILLER), progress = structuredClone(row.data); progress.xp++;
      await f.store.saveProfile(KILLER, progress, row.version);
      await assert.rejects(s.resumeDeathDrop(f.raw.operationId), { code: 'conflict' });
      assert.equal(sends, 1); assert.deepEqual((await f.store.loadProfile(KILLER)).data, progress);
      assert.equal((await f.journal.prepare('drop', f.raw)).state, 'rejected');
    } finally { await f.close?.(); }
  });

  await t.test('terminal journal reply loss retains the caller fence after account progress', async () => {
    const f = await fixture(setup); let lose = true;
    try {
      const journal = { ...f.journal, async resolve(...args) {
        const row = await f.journal.resolve(...args);
        if (lose) { lose = false; throw new StoreError('unavailable'); }
        return row;
      } };
      const s = await sessions(f, f.store, journal);
      await assert.rejects(s.commitDeathDrop(f.raw), { code: 'unavailable' }); assertBlocked(s, f.raw);
      const row = await f.store.loadProfile(KILLER), progress = structuredClone(row.data); progress.gold++;
      await f.store.saveProfile(KILLER, progress, row.version);
      await assert.rejects(s.reconcileDeathDrop(f.raw.operationId), { code: 'conflict' });
      assert.throws(() => pearlMutationGate(s).assertAvailable({ accounts: [KILLER] }), { code: 'session' });
      assert.deepEqual((await f.store.loadProfile(KILLER)).data, progress);
      assert.equal((await f.journal.prepare('drop', f.raw)).state, 'committed');
    } finally { await f.close?.(); }
  });

  await t.test('startup rejects two pending drop intents that claim the same source ordinal before installing either', async () => {
    const f = await fixture(setup); try {
      const second = structuredClone(f.raw); second.operationId = '80000000-0000-4000-8000-000000001031';
      await f.journal.prepare('drop', f.raw); await f.journal.prepare('drop', second);
      const next = new ProfileSessions(f.store, null, { journal: f.journal });
      await assert.rejects(next.recoverPearls(), { code: 'response' });
      assert.equal(next.pearls.drops.size, 0); assert.equal(next.pearls.accountIds.size, 0);
      assert.equal(next.pearls.unresolved.size, 0);
    } finally { await f.close?.(); }
  });

  await t.test('zero-account expiry still owns its drop lane and cannot overlap a pickup for the same source', async () => {
    const f = await fixture(setup, 'expire'); try {
      assert.deepEqual(lanes(f.raw).accounts, []);
      await f.journal.prepare('drop', f.raw);
      const next = new ProfileSessions(f.store, null, { journal: f.journal });
      assert.deepEqual(await next.recoverPearls(), [{ operationId: f.raw.operationId, outcome: 'pending' }]);
      assertBlocked(next, f.raw);
      const pickup = structuredClone(f.raw); pickup.operationId = '80000000-0000-4000-8000-000000001032'; pickup.mode = 'pickup';
      assert.throws(() => pearlMutationGate(next).assertAvailable({ drops: [`${pickup.drop.operationId}:${pickup.drop.ordinal}`] }), { code: 'busy' });
    } finally { await f.close?.(); }
  });

  await t.test('expiry reserves the source drop lane without claiming an account lane', async () => {
    const f = await fixture(setup, 'expire'); try {
      const s = await sessions(f), gate = pearlMutationGate(s), full = lanes(f.raw), token = gate.reserve(full);
      assert.deepEqual(full.accounts, []); assertBlocked(s, f.raw);
      const result = await s.commitDeathDrop(f.raw, token); assert.equal(result.receipt.drop.state, 'expired');
      gate.release(token); await s.flush();
      assert.equal((await f.store.loadDeathDrop(f.raw.drop.operationId, f.raw.drop.ordinal)).state, 'expired');
    } finally { await f.close?.(); }
  });

  await t.test('zero-account expiry is resumed from its original tick after restart', async () => {
    const f = await fixture(setup, 'expire'); let sends = 0;
    try {
      await f.journal.prepare('drop', f.raw);
      const store = { ...f.store, async commitDeathDrop(raw) {
        sends++; assert.deepEqual(raw, f.raw); return f.store.commitDeathDrop(raw);
      } };
      const next = new ProfileSessions(store, null, { journal: f.journal });
      assert.deepEqual(await next.recoverPearls(), [{ operationId: f.raw.operationId, outcome: 'pending' }]);
      assert.equal(sends, 0);
      const result = await next.resumeDeathDrop(f.raw.operationId); await next.flush();
      assert.equal(sends, 1); assert.equal(result.receipt.drop.state, 'expired');
      assert.equal(result.receipt.drop.transitionOperationId, f.raw.operationId);
    } finally { await f.close?.(); }
  });
}
