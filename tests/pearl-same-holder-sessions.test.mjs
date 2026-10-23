import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { A, B, UID, WORLD, op, pearl, seed, meta, request, swallow, state } from './helpers/pearl-same-holder.mjs';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise((r) => setImmediate(r));
const build = (rows) => rows.map(({ id, data }) => ({ id, data: swallow(data) }));
async function fixture(wrap = (base) => base, wrapJournal = (j) => j) {
  const base = createMemoryStore(); await seed(base, true);
  const journals = createMemoryPearlJournals(), journal = wrapJournal(journals(WORLD));
  const store = wrap(base), failures = [];
  const sessions = new ProfileSessions(store, (id, code) => failures.push({ id, code }), { journal });
  await sessions.recoverPearls(); const p = await sessions.open(1, A); await sessions.open(2, B);
  return { base, store, journals, journal, sessions, p, failures };
}

test('one same-holder lane drains prior save then rebases later progress without changing other bag order', async () => {
  const saving = deferred(), saved = deferred(), sent = deferred(), reply = deferred(); let concrete, calls = 0;
  const f = await fixture((base) => ({ ...base,
    async saveProfile(...args) { if (args[2] === 2) { saving.resolve(); await saved.promise; } return base.saveProfile(...args); },
    async commitPearlGround(raw) { concrete = structuredClone(raw); calls++; const result = await base.commitPearlGround(raw); sent.resolve(); await reply.promise; return result; },
  }));
  f.p.xp = 7; f.sessions.save(1, f.p); await saving.promise;
  let rowsSeen, builds = 0;
  const operation = f.sessions.commitPearlGround(meta(), (rows) => { rowsSeen = structuredClone(rows); builds++; return build(rows); });
  await turn(); assert.equal(rowsSeen, undefined);
  saved.resolve(); await sent.promise;
  assert.equal(rowsSeen.length, 1); assert.equal(rowsSeen[0].version, 3); assert.equal(rowsSeen[0].data.xp, 7);
  assert.equal(f.sessions.pearls.accountIds.size, 1); assert.equal(f.sessions.clients.get(1).pearlBusy.lanes.length, 1);
  f.p.xp = 11; f.p.gold += 4; f.sessions.save(1, f.p);
  const busy = f.sessions.commitPearlGround(meta({ operationId: op(9), to: B }), () => { throw new Error('cannot build'); });
  await assert.rejects(busy, { code: 'busy' });
  reply.resolve(); const result = await operation; await f.sessions.flush();
  assert.equal(calls, 1); assert.equal(builds, 1); assert.equal(concrete.profiles.length, 1);
  const row = await f.base.loadProfile(A);
  assert.equal(row.version, 5); assert.equal(row.data.xp, 11); assert.equal(row.data.gold, 31);
  assert.deepEqual(row.data.pearls, swallow(f.p).pearls);
  assert.equal(result.receipt.profiles.length, 1); assert.equal(f.sessions.pearls.accountIds.size, 0);
  assert.deepEqual(f.failures, []); assert.deepEqual(await f.journal.list(), []);
});

test('same-holder builders cannot edit gold, progress, unrelated slots or replace a swallowed UID', async (t) => {
  for (const [name, edit] of [
    ['gold', (p) => { p.gold++; }], ['xp', (p) => { p.xp++; }],
    ['bag order', (p) => { p.pearls.bag.reverse(); }],
    ['other slot', (p) => { p.pearls.bag.pop(); }],
  ]) await t.test(name, async () => {
    let sends = 0; const f = await fixture((base) => ({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }));
    const before = await state(f.base);
    await assert.rejects(f.sessions.commitPearlGround(meta(), (rows) => { const result = build(rows); edit(result[0].data); return result; }), { code: 'ownership' });
    assert.equal(sends, 0); assert.deepEqual(await state(f.base), before); assert.deepEqual(await f.journal.list(), []);
    assert.equal(f.failures.length, 1, 'one account is failed once');
  });
  const f = await fixture();
  f.p.pearls.swallowed = f.p.pearls.bag.pop(); f.sessions.save(1, f.p); await f.sessions.flush();
  await assert.rejects(f.sessions.commitPearlGround(meta(), build), { code: 'ownership' });
  assert.equal((await f.base.loadUnique(UID)).version, 1);
});

test('lost replies resend identical same-holder request twice and validate receipt without repeated effects', async () => {
  const sent = [];
  const f = await fixture((base) => ({ ...base, async commitPearlGround(raw) {
    sent.push(structuredClone(raw)); await base.commitPearlGround(raw); throw new StoreError('unavailable');
  } }));
  let builds = 0;
  const result = await f.sessions.commitPearlGround(meta(), (rows) => { builds++; return build(rows); });
  assert.equal(result.receipt.replay, true); assert.equal(builds, 1); assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]); assert.equal((await f.base.loadProfile(A)).version, 3);
  assert.equal((await f.base.loadUnique(UID)).version, 2); assert.equal((await f.base.loadProfile(A)).data.gold, 27);
  assert.deepEqual(await f.journal.list(), []); await f.sessions.flush();
});

test('common gameplay capability admits its single lane and remains held after storage completion', async () => {
  let sends = 0; const f = await fixture((base) => ({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }));
  const gate = pearlMutationGate(f.sessions), handle = gate.reserve({ accounts: [A], uids: [UID] });
  await assert.rejects(f.sessions.commitPearlGround(meta(), build), { code: 'busy' });
  await assert.rejects(f.sessions.commitPearlGround(meta(), build, Object.freeze({})), { code: 'operation' });
  assert.equal(sends, 0);
  await f.sessions.commitPearlGround(meta(), build, handle); assert.equal(sends, 1);
  assert.throws(() => gate.assertAvailable({ accounts: [A] }), { code: 'busy' });
  assert.throws(() => f.sessions.save(1, f.p), { code: 'busy' });
  assert.equal(gate.active(handle), true); gate.release(handle);
  gate.assertAvailable({ accounts: [A], uids: [UID] }); await f.sessions.flush();
});

test('close during same-holder journal prepare cancels before RPC and retains sticky gameplay capability', async () => {
  const prepared = deferred(), release = deferred(); let sends = 0;
  const f = await fixture((base) => ({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }),
    (journal) => ({ ...journal, async prepare(...args) { const row = await journal.prepare(...args); prepared.resolve(); await release.promise; return row; } }));
  const before = await state(f.base), gate = pearlMutationGate(f.sessions), handle = gate.reserve({ accounts: [A], uids: [UID] });
  const operation = f.sessions.commitPearlGround(meta(), build, handle);
  const rejected = assert.rejects(operation, { code: 'cancelled' });
  await prepared.promise; f.sessions.close(1); release.resolve(); await rejected;
  assert.equal(sends, 0); assert.deepEqual(await state(f.base), before);
  assert.deepEqual(await f.journal.list(), []);
  assert.equal((await f.journals(WORLD).prepare('ground', request(f.p))).state, 'rejected');
  assert.equal(gate.active(handle), false); assert.throws(() => gate.release(handle), { code: 'busy' });
});

test('fresh authority resumes a prepared same-holder request once without a builder or live session', async () => {
  const f = await fixture(), concrete = request(f.p);
  await f.journal.prepare('ground', concrete); let sends = 0, transmitted;
  const recovered = new ProfileSessions({ ...f.base, async commitPearlGround(raw) {
    sends++; transmitted = structuredClone(raw); return f.base.commitPearlGround(raw);
  } }, null, { journal: f.journals(WORLD) });
  assert.deepEqual(await recovered.recoverPearls(), [{ operationId: op(2), outcome: 'pending' }]);
  assert.equal(sends, 0); assert.equal(recovered.pearls.accountIds.size, 1);
  await assert.rejects(recovered.open(8, A), { code: 'busy' });
  await recovered.resumePearlGround(op(2)); assert.equal(sends, 1); assert.deepEqual(transmitted, concrete);
  assert.equal((await recovered.open(8, A)).pearls.swallowed.uid, UID);
  assert.equal((await f.base.loadUnique(UID)).version, 2); assert.deepEqual(await f.journal.list(), []);
  await recovered.flush();
});

test('advanced profile after lost same-holder receipt becomes conflict, retaining no historical apply', async () => {
  const f = await fixture(), concrete = request(f.p);
  await f.journal.prepare('ground', concrete); await f.base.commitPearlGround(concrete);
  const advanced = swallow(f.p); advanced.xp = 77; await f.base.saveProfile(A, advanced, 3);
  let sends = 0;
  const recovered = new ProfileSessions({ ...f.base, async commitPearlGround() { sends++; throw new Error('no send'); } }, null, { journal: f.journals(WORLD) });
  assert.deepEqual(await recovered.recoverPearls(), [{ operationId: op(2), outcome: 'conflict' }]);
  assert.equal(sends, 0); assert.equal((await recovered.open(8, A)).xp, 77);
  assert.equal((await f.journals(WORLD).prepare('ground', concrete)).state, 'conflict');
  assert.equal(recovered.pearls.accountIds.size, 0);
});

test('terminal journal reply loss keeps same-holder reservations until read-only reconciliation', async () => {
  let lost = true, sends = 0;
  const f = await fixture((base) => ({ ...base, async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); } }),
    (journal) => ({ ...journal, async resolve(...args) {
      const row = await journal.resolve(...args); if (lost) throw new StoreError('unavailable'); return row;
    } }));
  await assert.rejects(f.sessions.commitPearlGround(meta(), build), { code: 'unavailable' });
  assert.equal(sends, 1); assert.equal(f.failures.length, 1); assert.equal(f.sessions.pearls.accountIds.size, 1);
  lost = false; await f.sessions.reconcilePearlGround(op(2));
  assert.equal(sends, 1); assert.equal(f.sessions.pearls.accountIds.size, 0);
  assert.equal(f.sessions.clients.get(1).failed, true); await assert.rejects(f.sessions.flush(), { code: 'flush' });
  assert.equal((await f.base.loadProfile(A)).data.pearls.swallowed.uid, UID);
});
