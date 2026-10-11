import test from 'node:test';
import assert from 'node:assert/strict';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', uid = 'gate:first';
const sessions = () => new ProfileSessions(createMemoryStore());
const denied = (fn, code) => assert.throws(fn, { code });

test('all coordinators for one profile authority share one gate; other authorities remain isolated', () => {
  const first = sessions(), second = sessions(), gate = pearlMutationGate(first);
  assert.equal(pearlMutationGate(first), gate);
  assert.notEqual(pearlMutationGate(second), gate);
  const handle = gate.reserve({ accounts: [a], uids: [uid] });
  denied(() => pearlMutationGate(first).assertAvailable({ accounts: [a] }), 'busy');
  pearlMutationGate(second).assertAvailable({ accounts: [a], uids: [uid] });
  gate.release(handle); gate.assertAvailable({ accounts: [a], uids: [uid] });
  for (const raw of [null, {}, { accounts: new Map(), pearls: {} }]) denied(() => pearlMutationGate(raw), 'configuration');
});

test('multi-account and multi-UID reservations validate the whole set before taking any lane', () => {
  const gate = pearlMutationGate(sessions()), held = gate.reserve({ accounts: [b], uids: ['gate:held'] });
  for (const raw of [
    { accounts: [a, b], uids: [uid] }, { accounts: [a], uids: [uid, 'gate:held'] },
  ]) {
    denied(() => gate.reserve(raw), 'busy'); gate.assertAvailable({ accounts: [a], uids: [uid] });
  }
  for (const raw of [{ accounts: [a, 'guest'] }, { accounts: [a], uids: [uid, 'bad uid'] }]) {
    denied(() => gate.reserve(raw), raw.uids ? 'operation' : 'identity');
    gate.assertAvailable({ accounts: [a], uids: [uid] });
  }
  gate.release(held);
  const all = gate.reserve({ accounts: [a, b], uids: [uid, 'gate:held'] });
  for (const key of [a, b]) denied(() => gate.assertAvailable({ accounts: [key] }), 'busy');
  for (const key of [uid, 'gate:held']) denied(() => gate.assertAvailable({ uids: [key] }), 'busy');
  gate.release(all); gate.assertAvailable({ accounts: [a, b], uids: [uid, 'gate:held'] });
});

test('canonical account aliases and duplicate lanes cannot form competing reservations; UIDs keep case', () => {
  const gate = pearlMutationGate(sessions()), raw = { accounts: [a.toUpperCase(), a], uids: [uid, uid] };
  const handle = gate.reserve(raw); raw.accounts[0] = b; raw.uids[0] = 'changed';
  denied(() => gate.reserve({ accounts: [a] }), 'busy'); denied(() => gate.assertAvailable({ uids: [uid] }), 'busy');
  gate.assertAvailable({ accounts: [b], uids: ['GATE:first', 'changed'] });
  gate.release(handle); gate.assertAvailable({ accounts: [a], uids: [uid] });
});

test('opaque, foreign and released handles cannot unlock a newer operation with the same lanes', () => {
  const gate = pearlMutationGate(sessions()), other = pearlMutationGate(sessions());
  const old = gate.reserve({ accounts: [a], uids: [uid] });
  assert.equal(Object.isFrozen(old), true); assert.deepEqual(Object.keys(old), []);
  for (const fake of [{ ...old }, null, 'handle']) denied(() => gate.release(fake), 'operation');
  denied(() => other.release(old), 'operation'); gate.release(old);
  const next = gate.reserve({ accounts: [a], uids: [uid] });
  denied(() => gate.release(old), 'operation'); denied(() => gate.fence(old), 'operation');
  denied(() => gate.assertAvailable({ accounts: [a] }), 'busy'); gate.release(next);
});

test('lifecycle invalidation by either lane invalidates the whole operation and never releases it', () => {
  for (const affected of [{ accounts: [a.toUpperCase()] }, { uids: ['gate:second'] }]) {
    const gate = pearlMutationGate(sessions()), handle = gate.reserve({ accounts: [a, b], uids: [uid, 'gate:second'] });
    gate.invalidate({ accounts: [c], uids: ['unrelated'] }); assert.equal(gate.active(handle), true);
    gate.invalidate(affected); assert.equal(gate.active(handle), false);
    denied(() => gate.release(handle), 'busy'); gate.fence(handle); gate.fence(handle);
    gate.invalidate({}); assert.equal(gate.active(handle), false);
    for (const key of [a, b]) denied(() => gate.assertAvailable({ accounts: [key] }), 'busy');
    for (const key of [uid, 'gate:second']) denied(() => gate.assertAvailable({ uids: [key] }), 'busy');
    gate.assertAvailable({ accounts: [c], uids: ['unrelated'] });
  }
});

test('malformed and oversized descriptors cannot leak lanes or silently omit holes', async (t) => {
  const bad = [null, [], { accounts: null }, { uids: 'uid' }, { uid }, { accounts: [a], uids: new Array(1) },
    { accounts: new Array(1) }, { uids: [undefined] }, { uids: Array(257).fill(uid) }, { accounts: Array(257).fill(a) }];
  for (const [index, raw] of bad.entries()) await t.test(String(index), () => {
    const gate = pearlMutationGate(sessions());
    assert.throws(() => gate.reserve(raw)); gate.assertAvailable({ accounts: [a], uids: [uid] });
  });
  const gate = pearlMutationGate(sessions());
  denied(() => gate.reserve({}), 'operation'); gate.assertAvailable();
  const held = gate.reserve({ accounts: [a] });
  denied(() => gate.invalidate({ accounts: [a], uids: ['bad uid'] }), 'operation');
  assert.equal(gate.active(held), true); gate.release(held);
});

test('UID-only and account-only operations block their full domain while disjoint work proceeds', () => {
  const gate = pearlMutationGate(sessions()), ground = gate.reserve({ uids: [uid] }), profile = gate.reserve({ accounts: [a] });
  denied(() => gate.reserve({ accounts: [b], uids: [uid] }), 'busy');
  denied(() => gate.reserve({ accounts: [a], uids: ['gate:second'] }), 'busy');
  const next = gate.reserve({ accounts: [b], uids: ['gate:second'] });
  gate.release(next); gate.release(profile); gate.release(ground);
});

test('closed, failed and storage-busy account authorities cannot start ordinary mutations', () => {
  for (const [flag, code] of [['closed', 'session'], ['failed', 'session'], ['pearlBusy', 'busy']]) {
    const authority = sessions(), gate = pearlMutationGate(authority);
    authority.accounts.set(a, { [flag]: true });
    denied(() => gate.reserve({ accounts: [a], uids: [uid] }), code);
    authority.accounts.delete(a); gate.assertAvailable({ accounts: [a], uids: [uid] });
  }
});

test('recovery blocks admission, then recovered storage lanes are visible without live sessions', async () => {
  const store = createMemoryStore(), journal = createMemoryPearlJournals()('gate:world');
  const before = newProfile(); before.pirateId = `account:${a}`;
  await store.saveProfile(a, before, 0);
  const after = structuredClone(before); after.pearls.bag.push({ uid, kind: 'brasa' });
  await journal.prepare('ground', { operationId: '40000000-0000-4000-8000-000000000001', uid, kind: 'brasa',
    from: null, to: a, expectedVersion: 0, world: 'gate:world', ground: null,
    profiles: [{ id: a, expectedVersion: 1, data: after }] });
  const authority = new ProfileSessions(store, null, { journal }), gate = pearlMutationGate(authority);
  denied(() => gate.reserve({ accounts: [b], uids: ['disjoint'] }), 'recovery');
  await authority.recoverPearls(); assert.equal(authority.clients.size, 0);
  denied(() => gate.reserve({ accounts: [a] }), 'busy'); denied(() => gate.reserve({ uids: [uid] }), 'busy');
  const handle = gate.reserve({ accounts: [b], uids: ['disjoint'] }); gate.release(handle);
  assert.equal((await store.loadUnique(uid)), null);
});

test('retained fences consume the bounded reservation budget; available capacity is reclaimed only after success', () => {
  const gate = pearlMutationGate(sessions()), handles = [];
  for (let i = 0; i < 256; i++) handles.push(gate.reserve({ uids: [`gate:${i}`] }));
  denied(() => gate.reserve({ uids: ['gate:overflow'] }), 'busy');
  gate.release(handles.pop()); const next = gate.reserve({ uids: ['gate:overflow'] }); gate.fence(next);
  denied(() => gate.release(next), 'busy'); denied(() => gate.reserve({ uids: ['gate:after'] }), 'busy');
  for (const handle of handles) gate.release(handle);
  const after = gate.reserve({ uids: ['gate:after'] }); gate.release(after);
  denied(() => gate.assertAvailable({ uids: ['gate:overflow'] }), 'busy');
});

async function storageFixture() {
  const base = createMemoryStore(); let sends = 0;
  const authority = new ProfileSessions({ ...base,
    async commitPearl(raw) { sends++; return base.commitPearl(raw); },
    async commitPearlGround(raw) { sends++; return base.commitPearlGround(raw); },
  });
  const before = newProfile(); before.pirateId = `account:${a}`;
  await base.saveProfile(a, before, 0); await authority.open(1, a);
  const meta = { operationId: '40000000-0000-4000-8000-000000000002', uid, kind: 'brasa',
    from: null, to: a, expectedVersion: 0, world: 'gate:world', ground: null };
  let builds = 0;
  const build = (rows) => { builds++; rows[0].data.pearls.bag.push({ uid, kind: 'brasa' }); return rows; };
  return { base, authority, gate: pearlMutationGate(authority), meta, build, counts: () => ({ sends, builds }) };
}

test('direct storage commits in both families cannot bypass an ordinary gameplay reservation', async (t) => {
  for (const family of ['commitPearl', 'commitPearlGround']) for (const lanes of [{ accounts: [a] }, { uids: [uid] }]) {
    await t.test(`${family} ${Object.keys(lanes)[0]}`, async () => {
      const f = await storageFixture(), handle = f.gate.reserve(lanes);
      await assert.rejects(f.authority[family](f.meta, f.build), { code: 'busy' });
      assert.deepEqual(f.counts(), { sends: 0, builds: 0 });
      assert.equal(f.authority.pearls.operationIds.size, 0); assert.equal(f.authority.accounts.get(a).pearlBusy, null);
      assert.equal((await f.base.loadProfile(a)).version, 1); assert.equal(await f.base.loadUnique(uid), null);
      f.gate.release(handle); await f.authority.flush();
    });
  }
});

test('storage authorization requires the exact live capability; success retains gameplay lanes until its caller releases them', async (t) => {
  for (const family of ['commitPearl', 'commitPearlGround']) await t.test(family, async () => {
    const f = await storageFixture(), handle = f.gate.reserve({ accounts: [a], uids: [uid] });
    const foreign = pearlMutationGate(sessions()).reserve({ accounts: [a], uids: [uid] });
    for (const fake of [{ ...handle }, foreign]) await assert.rejects(f.authority[family](f.meta, f.build, fake), { code: 'operation' });
    await assert.rejects(f.authority[family]({ ...f.meta, uid: 'different' }, f.build, handle), { code: 'operation' });
    await assert.rejects(f.authority[family]({ ...f.meta, to: b }, f.build, handle), { code: 'operation' });
    assert.deepEqual(f.counts(), { sends: 0, builds: 0 }); assert.equal(f.authority.pearls.operationIds.size, 0);
    assert.equal((await f.authority[family](f.meta, f.build, handle)).receipt.ok, true);
    assert.deepEqual(f.counts(), { sends: 1, builds: 1 }); assert.equal(f.authority.pearls.accountIds.size, 0);
    assert.equal(f.gate.active(handle), true); denied(() => f.gate.assertAvailable({ accounts: [a] }), 'busy');
    f.gate.release(handle); f.gate.assertAvailable({ accounts: [a], uids: [uid] }); await f.authority.flush();
  });
});

test('invalidated capabilities cannot authorize new storage work or release any part of their lanes', async () => {
  const f = await storageFixture(), handle = f.gate.reserve({ accounts: [a], uids: [uid] });
  f.gate.invalidate({ uids: [uid] });
  await assert.rejects(f.authority.commitPearlGround(f.meta, f.build, handle), { code: 'cancelled' });
  assert.deepEqual(f.counts(), { sends: 0, builds: 0 }); assert.equal(f.authority.pearls.operationIds.size, 0);
  denied(() => f.gate.release(handle), 'busy'); denied(() => f.gate.assertAvailable({ accounts: [a] }), 'busy');
});

test('ordinary session saves cannot bypass gameplay account or UID lanes, and copied writer tokens cannot authorize them', async (t) => {
  for (const lane of ['accounts', 'uids']) await t.test(lane, async () => {
    const base = createMemoryStore(); let writes = 0;
    const p = newProfile(); p.pirateId = `account:${a}`; p.pearls.bag.push({ uid, kind: 'brasa' });
    await base.saveProfile(a, p, 0);
    const authority = new ProfileSessions({ ...base, async saveProfile(...args) { writes++; return base.saveProfile(...args); } });
    const live = await authority.open(1, a), gate = pearlMutationGate(authority);
    const handle = gate.reserve({ [lane]: [lane === 'accounts' ? a : uid] }); live.xp = 7;
    denied(() => authority.save(1, live), 'busy'); denied(() => authority.save(1, live, { ...handle }), 'operation');
    await authority.flush(); assert.equal(writes, 0); assert.equal(authority.accounts.get(a).failed, false);
    assert.equal((await base.loadProfile(a)).data.xp, 0);
    gate.release(handle); authority.save(1, live); await authority.flush();
    assert.equal(writes, 1); assert.equal((await base.loadProfile(a)).data.xp, 7);
  });
});

test('an internal snapshot writer token belongs to its account and cannot bypass another UID reservation', async () => {
  const f = await storageFixture(), peer = newProfile(); peer.pirateId = `account:${b}`;
  await f.base.saveProfile(b, peer, 0); const peerLive = await f.authority.open(2, b);
  const handle = f.gate.reserve({ accounts: [a], uids: [uid] });
  denied(() => f.authority.save(2, peerLive, handle), 'operation');
  const p = structuredClone(f.authority.accounts.get(a).confirmed); p.xp = 9;
  const blocked = f.gate.reserve({ uids: ['different'] }); p.pearls.bag.push({ uid: 'different', kind: 'tinta' });
  denied(() => f.authority.save(1, p, handle), 'busy'); f.gate.release(blocked); p.pearls.bag = [];
  f.authority.save(1, p, handle); await f.authority.flush();
  assert.equal((await f.base.loadProfile(a)).data.xp, 9); assert.equal(f.gate.active(handle), true);
  f.gate.release(handle);
});

test('profile admission rechecks gameplay lanes after async loading; a reservation cannot appear unnoticed mid-open', async () => {
  const base = createMemoryStore(); let release, started;
  const waiting = new Promise((resolve) => { release = resolve; }), loading = new Promise((resolve) => { started = resolve; });
  const p = newProfile(); p.pirateId = `account:${a}`; await base.saveProfile(a, p, 0);
  const authority = new ProfileSessions({ ...base, async loadProfile(key) { started(); await waiting; return base.loadProfile(key); } });
  const gate = pearlMutationGate(authority), opening = authority.open(1, a); await loading;
  const handle = gate.reserve({ accounts: [a] }); release();
  await assert.rejects(opening, { code: 'busy' }); assert.equal(authority.clients.size, 0); assert.equal(authority.accounts.size, 0);
  denied(() => gate.assertAvailable({ accounts: [a] }), 'busy'); assert.equal(gate.active(handle), false);
  denied(() => gate.release(handle), 'busy'); await assert.rejects(authority.open(2, a), { code: 'busy' });
  const restored = new ProfileSessions(base); assert.equal((await restored.open(2, a)).pirateId, `account:${a}`);
});

test('session close invalidates all gameplay lanes before releasing identity and prevents reopening stale authority', async () => {
  const f = await storageFixture(), handle = f.gate.reserve({ accounts: [a], uids: [uid, 'second'] });
  f.authority.close(1); assert.equal(f.authority.clients.size, 0); assert.equal(f.gate.active(handle), false);
  denied(() => f.gate.release(handle), 'busy'); denied(() => f.gate.assertAvailable({ uids: ['second'] }), 'busy');
  await assert.rejects(f.authority.open(2, a), { code: 'busy' }); assert.equal(f.counts().sends, 0);
});
