// Profile publication and signed-save IO wait on the shared pearl account/UID gate.
// These tests exercise the host with real LocalServer messages and a fake WebSocket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UID = 'profile-io-pearl';

function profile() { return newProfile(); }

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close(code = 1000) {
    if (this.readyState !== 1) return;
    this.readyState = 3; this.code = code; this.emit('close');
  }
  ping() {}
}

function client(host, extra = {}) {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  const hello = () => ws.emit('message', Buffer.from(JSON.stringify({
    t: MSG.HELLO, v: PROTOCOL_VERSION, name: `P${id}`, weapon: 0, ...extra,
  })), false);
  return { id, ws, hello, of: (type) => ws.messages.filter((m) => m.t === type) };
}

function makeHost(t, options = {}) {
  const h = new GameHost({ seed: 42, bots: 0, log: () => {}, ...options });
  t.after(async () => {
    try { await h.close(); }
    catch (error) { if (error.code !== 'flush') throw error; }
  });
  return h;
}

async function joined(h) { await Promise.all([...h.joins]); }

async function account(t, { key = A, store = createMemoryStore(), saves = hmacSaves('profile-io-test'), ...options } = {}) {
  const h = makeHost(t, { store, saves, resolvePlayer: async () => key, ...options });
  const c = client(h);
  c.hello(); await joined(h);
  assert.equal(c.of(MSG.WELCOME).length, 1);
  return { h, c, gate: pearlMutationGate(h.profiles), live: h.server.clients.get(c.id),
    profile: h.server.world.profiles.get(h.server.clients.get(c.id).entity), store, saves };
}

function putPearl(p, uid = UID) { p.pearls.bag.push({ uid, kind: 'brasa' }); }

async function managedStore() {
  const base = createMemoryStore(), initial = profile();
  initial.pirateId = `account:${A}`;
  assert.equal((await base.saveProfile(A, initial, 0)).ok, true);
  const row = await base.loadProfile(A), data = structuredClone(row.data);
  putPearl(data);
  assert.equal((await base.commitPearl({ operationId: '61000000-0000-4000-8000-000000000021',
    uid: UID, kind: 'brasa', from: null, to: A, expectedVersion: 0,
    profiles: [{ id: A, expectedVersion: row.version, data }] })).ok, true);
  return base;
}

test('account reservation blocks PROFILE before syncing and release retries the dirty profile', async (t) => {
  const f = await account(t), { h, c, gate, live, profile: p } = f;
  const entity = live.entity, handle = gate.reserve({ accounts: [A] });
  const initialProfiles = c.of(MSG.PROFILE).length;
  h.server.world.ecs.xp[entity] = 19;
  p.xp = 3;
  h.server.world.profileDirty.add(entity);
  const priorProfT = live.profT;

  assert.equal(h.server.sendProfile(c.id, live), false);
  assert.equal(p.xp, 3, 'blocked publication did not sync profile data from ECS');
  assert.equal(live.profT, priorProfT);
  assert.equal(h.server.world.profileDirty.has(entity), true);
  assert.equal(c.of(MSG.PROFILE).length, initialProfiles, 'no profile was sent while reserved');

  gate.release(handle);
  assert.equal(h.server.sendProfile(c.id, live), true);
  assert.equal(p.xp, 19);
  assert.equal(c.of(MSG.PROFILE).at(-1).p.xp, 19);
  assert.equal(h.server.world.profileDirty.has(entity), false);
});

test('UID-only reservation blocks publication for a UID currently held in the profile', async (t) => {
  const f = await account(t), { h, c, gate, live, profile: p } = f;
  putPearl(p);
  const initialProfiles = c.of(MSG.PROFILE).length;
  const handle = gate.reserve({ uids: [UID] });
  p.gold = 7; h.server.world.profileDirty.add(live.entity);

  assert.equal(h.server.sendProfile(c.id, live), false);
  assert.equal(c.of(MSG.PROFILE).length, initialProfiles);
  assert.equal(h.server.world.profileDirty.has(live.entity), true);
  gate.release(handle);
  assert.equal(h.server.sendProfile(c.id, live), true);
  assert.equal(c.of(MSG.PROFILE).at(-1).p.gold, 7);
});

test('a denied save hook preserves its schedule and does not call onSave', async (t) => {
  let savesSeen = 0;
  const h = makeHost(t, { saves: hmacSaves('guest-test'), resolvePlayer: async () => null });
  const c = client(h); c.hello(); await joined(h);
  const live = h.server.clients.get(c.id), beforeBlob = live.lastBlob;
  h.server.onSave = () => { savesSeen++; return true; };
  live.saveAt = 777;
  const original = h.server.profileAccess;
  // The host's real gate is exercised on accounts in the account-path cases; here hold the
  // anonymous profile through the same synchronous LocalServer guard seam.
  h.server.profileAccess = (id, entity, purpose) => purpose === 'save' ? false : original(id, entity, purpose);
  assert.equal(h.server.sendSave(c.id, live), false);
  assert.equal(live.saveAt, 777);
  assert.equal(live.lastBlob, beforeBlob);
  assert.equal(savesSeen, 0);
  assert.equal(c.of(MSG.SAVE).length, 0);
  h.server.profileAccess = original;
  assert.equal(h.server.sendSave(c.id, live), true);
  assert.equal(live.saveAt, null);
  assert.equal(savesSeen, 1);
});

test('onSave rejection defers a guest snapshot without consuming its schedule or signed blob', async (t) => {
  const h = makeHost(t, { saves: hmacSaves('guest-on-save'), resolvePlayer: async () => null });
  const c = client(h); c.hello(); await joined(h);
  const live = h.server.clients.get(c.id), oldBlob = live.lastBlob;
  let allowed = false;
  h.server.onSave = () => allowed;
  live.saveAt = 888;

  assert.equal(h.server.sendSave(c.id, live), false);
  assert.equal(live.saveAt, 888);
  assert.equal(live.lastBlob, oldBlob);
  assert.equal(c.of(MSG.SAVE).length, 0);
  allowed = true;
  assert.equal(h.server.sendSave(c.id, live), true);
  assert.equal(live.saveAt, null);
  assert.equal(c.of(MSG.SAVE).length, 1);
  live.saveAt = 999;
  const sentBlobs = c.of(MSG.SAVE).length, sentBlob = live.lastBlob;
  h.server.onSave = () => { throw new Error('save deferred'); };
  assert.throws(() => h.server.sendSave(c.id, live), /save deferred/);
  assert.equal(live.saveAt, 999);
  assert.equal(live.lastBlob, sentBlob);
  assert.equal(c.of(MSG.SAVE).length, sentBlobs);
  h.server.onSave = () => true;
});

test('the shared lane also blocks profile writes while the pearl queue owns the account session', async (t) => {
  const f = await account(t), { h, c, live, profile: p } = f;
  const session = h.profiles.clients.get(c.id), entity = live.entity;
  session.pearlBusy = { queued: true };
  h.server.world.ecs.xp[entity] = 8; p.xp = 2;
  h.server.world.profileDirty.add(entity);
  assert.equal(h.server.sendProfile(c.id, live), false);
  assert.equal(p.xp, 2);
  assert.equal(h.server.world.profileDirty.has(entity), true);
  session.pearlBusy = null;
  assert.equal(h.server.sendProfile(c.id, live), true);
  assert.equal(p.xp, 8);
});

test('PROFILE waits while public snapshots and another player profile keep flowing', async (t) => {
  const h = makeHost(t, { resolvePlayer: async (_req, msg) => msg.name === 'A' ? A : B });
  const a = client(h, { name: 'A' }), b = client(h, { name: 'B' });
  a.hello(); b.hello(); await joined(h);
  const gate = pearlMutationGate(h.profiles), handle = gate.reserve({ accounts: [A] });
  const ca = h.server.clients.get(a.id), cb = h.server.clients.get(b.id);
  const initialAProfiles = a.of(MSG.PROFILE).length, initialBProfiles = b.of(MSG.PROFILE).length;
  h.server.world.profileDirty.add(ca.entity); h.server.world.profileDirty.add(cb.entity);

  assert.equal(h.server.sendProfile(a.id, ca), false);
  assert.equal(h.server.sendProfile(b.id, cb), true);
  h.server.broadcastSnapshot();
  assert.equal(a.of(MSG.SNAPSHOT).length, 1);
  assert.equal(b.of(MSG.SNAPSHOT).length, 1);
  assert.equal(a.of(MSG.SNAPSHOT)[0].ack, ca.ack);
  assert.equal(JSON.stringify(a.of(MSG.SNAPSHOT)[0]).includes(UID), false);
  assert.equal(a.of(MSG.PROFILE).length, initialAProfiles);
  assert.equal(b.of(MSG.PROFILE).length, initialBProfiles + 1);
  gate.release(handle);
  assert.equal(h.server.sendProfile(a.id, ca), true);
});

test('a guest signed save containing a reserved UID cannot publish a replacement blob', async (t) => {
  const saves = hmacSaves('guest-key'), guest = profile();
  putPearl(guest);
  const h = makeHost(t, { saves, resolvePlayer: async () => null });
  const gate = pearlMutationGate(h.profiles), handle = gate.reserve({ uids: [UID] });
  const c = client(h, { save: saves.store(guest) });
  c.hello(); await joined(h);
  const live = h.server.clients.get(c.id), oldBlob = live.lastBlob;
  live.saveAt = 900;
  assert.equal(h.server.sendSave(c.id, live), false);
  assert.equal(live.saveAt, 900);
  assert.equal(live.lastBlob, oldBlob);
  assert.equal(c.of(MSG.SAVE).length, 0);
  gate.release(handle);
  assert.equal(h.server.sendSave(c.id, live), true);
  assert.equal(c.of(MSG.SAVE).length, 1);
});

test('client supplied account/profile fields cannot bypass the resolved account lane', async (t) => {
  const h = makeHost(t, { resolvePlayer: async () => A });
  const c = client(h, { playerId: B, account: B, profile: { gold: 999, xp: 999 } });
  c.hello(); await joined(h);
  const gate = pearlMutationGate(h.profiles), handle = gate.reserve({ accounts: [A] });
  const live = h.server.clients.get(c.id), p = h.server.world.profiles.get(live.entity);
  const initialProfiles = c.of(MSG.PROFILE).length;
  p.pirateId = `account:${B}`;
  h.server.world.ecs.xp[live.entity] = 41; p.xp = 6;
  assert.equal(h.server.sendProfile(c.id, live), false);
  assert.equal(p.xp, 6);
  assert.equal(c.of(MSG.PROFILE).length, initialProfiles);
  assert.equal(h.profiles.clients.get(c.id).key, A);
  gate.release(handle);
});

test('disconnect invalidates account and profile UIDs before detach', async (t) => {
  const f = await account(t), { h, c, gate, profile: p } = f;
  putPearl(p);
  let invalidated = null, detached = false;
  const invalidate = gate.invalidate.bind(gate);
  gate.invalidate = (lanes) => { invalidated = structuredClone(lanes); return invalidate(lanes); };
  const profiles = h.server.world.profiles;
  const remove = profiles.delete.bind(profiles);
  profiles.delete = (entity) => {
    assert.deepEqual(invalidated?.accounts, [A], 'host invalidated the account before detach');
    assert.ok(invalidated?.uids?.includes(UID), 'host invalidated live pearl UIDs before detach');
    detached = true;
    return remove(entity);
  };

  c.ws.close();
  assert.equal(detached, true);
  assert.equal(h.server.world.profiles.has(f.live.entity), false);
});

test('closing with a reserved account retains an isolated unsaved final snapshot and fails flush', async (t) => {
  const f = await account(t), { h, c, gate, live, profile: p, store } = f;
  const entity = live.entity, handle = gate.reserve({ accounts: [A] });
  p.gold = 44; h.server.world.ecs.xp[entity] = 17;
  c.ws.close();

  assert.equal(h.unsavedProfiles instanceof Map, true);
  const retained = h.unsavedProfiles.get(c.id);
  assert.equal(retained.key, A);
  assert.equal(retained.data.gold, 44);
  assert.equal(retained.data.xp, 17);
  assert.equal(p.gold, 44);
  p.gold = 0;
  assert.equal(retained.data.gold, 44, 'later mutations of the detached live object cannot change the retained copy');
  assert.equal(h.healthy(), false);
  assert.equal(h.closing, true);
  assert.equal(h.status().storage.unsaved, 1);
  const later = new Socket();
  h.onConnection(later, { headers: {}, socket: { remoteAddress: 'test' } });
  assert.equal(later.code, 1013, 'the fenced host rejects new connections');
  assert.equal(later.messages.length, 0);
  assert.equal(h.server.world.profiles.has(entity), false);
  await assert.rejects(h.close(), { code: 'flush' });
  assert.equal((await store.loadProfile(A)), null, 'the contradictory final profile was not written');
  assert.equal(h.unsavedProfiles.get(c.id).data.gold, 44);
  assert.throws(() => gate.release(handle), { code: 'busy' }, 'disconnect invalidates the held reservation');
});

test('closing with a reserved profile UID also blocks the final save', async (t) => {
  const f = await account(t), { h, c, gate, live, profile: p, store } = f;
  putPearl(p);
  const handle = gate.reserve({ uids: [UID] });
  p.gold = 31;
  c.ws.close();
  assert.equal(h.unsavedProfiles.get(c.id).data.gold, 31);
  await assert.rejects(h.close(), { code: 'flush' });
  assert.equal(await store.loadProfile(A), null);
  assert.throws(() => gate.release(handle), { code: 'busy' });
});

test('real staging holds profile and signed-save IO through durable confirmation until manual tick drain', async (t) => {
  const base = await managedStore();

  let pauseCommit = true;
  let committedResolve;
  const committed = new Promise((resolve) => { committedResolve = resolve; });
  let releaseResolve;
  const releaseCommit = new Promise((resolve) => { releaseResolve = resolve; });
  const store = { ...base, async commitPearlGround(request) {
    const receipt = await base.commitPearlGround(request);
    if (pauseCommit) { committedResolve(); await releaseCommit; }
    return receipt;
  } };
  t.after(() => { releaseResolve(); });
  const h = makeHost(t, { store, resolvePlayer: async () => A });
  const c = client(h); c.hello(); await joined(h);
  const live = h.server.clients.get(c.id), entity = live.entity;
  const p = h.server.world.profiles.get(entity), staging = new PearlStaging(h.profiles, h.server.world, 'profile-io-contract');
  h.server.world.ecs.regenT[entity] = 99;
  h.server.world.ecs.dashT[entity] = -1;
  h.server.world.ecs.xp[entity] = 4;
  const initialProfiles = c.of(MSG.PROFILE).length;
  live.saveAt = 1234;
  const oldBlob = live.lastBlob;

  staging.swallow({ uid: UID, expectedVersion: 1, source: { clientId: c.id, entity } });
  await Promise.race([committed, staging.settle().then(() => { throw new Error('staging ended before blocked commit'); })]);
  assert.throws(() => staging.assertPublishable(c.id), { code: 'busy' });
  assert.equal(h.server.sendProfile(c.id, live), false);
  assert.equal(p.xp, 0, 'guard leaves profile XP unsynced while ECS advances');
  assert.equal(h.server.world.ecs.xp[entity], 4);
  assert.equal(live.saveAt, 1234);
  assert.equal(live.lastBlob, oldBlob);
  assert.equal(c.of(MSG.PROFILE).length, initialProfiles);
  assert.equal(h.server.sendSave(c.id, live), false);
  assert.equal(live.saveAt, 1234);

  pauseCommit = false; releaseResolve();
  await staging.settle();
  assert.equal(h.profiles.clients.get(c.id).pearlBusy, null, 'storage has released its queue lane');
  assert.equal((await base.loadProfile(A)).data.pearls.swallowed?.uid, UID);
  assert.equal(p.pearls.swallowed, null, 'the live inventory still awaits tick apply');
  assert.equal(h.server.sendProfile(c.id, live), false, 'gameplay reservation covers the receipt-to-apply gap');
  assert.equal(h.server.sendSave(c.id, live), false);
  assert.equal(c.of(MSG.PROFILE).length, initialProfiles);
  assert.equal(live.saveAt, 1234);
  p.gold = 15;
  p.mast[0][0] = 2;
  h.server.world.ecs.xp[entity] = 16;
  assert.equal(staging.drain()[0].state, 'applied');
  assert.equal(p.gold, 15);
  assert.equal(p.pearls.swallowed?.uid, UID);
  assert.equal(h.server.sendProfile(c.id, live), true);
  assert.equal(p.xp, 16);
  assert.equal(h.server.sendSave(c.id, live), true);
  await h.profiles.flush();
  assert.deepEqual(staging.drain(), [], 'a completed receipt applies once');
  const saved = await base.loadProfile(A);
  assert.equal(saved.data.gold, 15);
  assert.equal(saved.data.mast[0][0], 2);
  assert.equal(saved.data.xp, 16);
  assert.equal(saved.data.pearls.swallowed?.uid, UID);
  assert.equal(await base.loadUnique(UID).then((value) => value.version), 2);
  assert.equal(h.server.world.events.filter((event) => event.type === 'pearlChanged' && event.op === 'swallow').length, 1);
});

test('closing after commit with a delayed receipt never applies late staging or overwrites committed inventory', async (t) => {
  const base = await managedStore();
  let committedResolve, releaseResolve;
  const committed = new Promise((done) => { committedResolve = done; });
  const released = new Promise((done) => { releaseResolve = done; });
  t.after(() => releaseResolve());
  const store = { ...base, async commitPearlGround(request) {
    const result = await base.commitPearlGround(request);
    committedResolve(); await released; return result;
  } };
  const { h, c, live, profile: p } = await account(t, { store });
  const staging = new PearlStaging(h.profiles, h.server.world, 'profile-io-contract');
  h.server.world.ecs.regenT[live.entity] = 99;
  staging.swallow({ uid: UID, expectedVersion: 1, source: { clientId: c.id, entity: live.entity } });
  await Promise.race([committed, staging.settle().then(() => { throw new Error('staging ended before delayed receipt'); })]);
  p.gold = 61;
  h.server.world.ecs.xp[live.entity] = 27;
  c.ws.close();
  const closed = assert.rejects(h.close(), { code: 'flush' });
  const retained = structuredClone(h.unsavedProfiles.get(c.id));
  const events = structuredClone(h.server.world.events);
  assert.equal(retained.data.gold, 61);
  assert.equal(retained.data.xp, 27);
  assert.equal(retained.data.pearls.swallowed, null, 'copy records the unapplied live inventory');
  releaseResolve();
  await staging.settle(); await closed;
  assert.equal(staging.drain()[0].state, 'fenced');
  assert.equal(h.server.world.profiles.has(live.entity), false);
  assert.deepEqual(h.server.world.events, events, 'late receipt publishes no pearl success');
  assert.deepEqual(h.unsavedProfiles.get(c.id), retained, 'copy is not automatically merged or replayed');
  const durable = await base.loadProfile(A);
  assert.equal(durable.data.pearls.swallowed?.uid, UID);
  assert.notEqual(durable.data.gold, 61, 'the latest unsaved progress is explicitly not guaranteed durable');
  assert.equal((await base.loadUnique(UID)).version, 2);
});

test('a UID still attached in the ledger blocks output and close even when absent from the inventory', async (t) => {
  const { h, c, gate, live, profile: p } = await account(t);
  h.server.world.pearlLedger.set(UID, { owner: p.pirateId, entity: live.entity, place: 'profile' });
  const held = gate.reserve({ uids: [UID] });
  assert.equal(p.pearls.bag.length, 0);
  assert.equal(h.server.sendProfile(c.id, live), false);
  assert.equal(h.server.sendSave(c.id, live), false);
  c.ws.close();
  assert.equal(gate.active(held), false, 'ledger-only lane was invalidated before entity detach');
  assert.equal(h.unsavedProfiles.has(c.id), true);
  await assert.rejects(h.close(), { code: 'flush' });
});

test('a socket send error does not consume PROFILE or SAVE retry state', async (t) => {
  const h = makeHost(t, { saves: hmacSaves('send-throw'), resolvePlayer: async () => null });
  const c = client(h); c.hello(); await joined(h);
  const live = h.server.clients.get(c.id), entity = live.entity, p = h.server.world.profiles.get(entity);
  const priorProfT = live.profT;
  h.server.world.ecs.xp[entity] = 29; p.xp = 2;
  h.server.world.profileDirty.add(entity);
  const send = h.server.send;
  h.server.send = (_id, message) => { if (message.t === MSG.PROFILE) throw new Error('profile send'); };
  assert.throws(() => h.server.sendProfile(c.id, live), /profile send/);
  assert.equal(p.xp, 29, 'sync occurred before the attempted wire publication');
  assert.equal(live.profT, priorProfT);
  assert.equal(h.server.world.profileDirty.has(entity), true);

  const oldBlob = live.lastBlob;
  live.saveAt = 456;
  h.server.onSave = () => true;
  h.server.send = (_id, message) => { if (message.t === MSG.SAVE) throw new Error('save send'); };
  assert.throws(() => h.server.sendSave(c.id, live), /save send/);
  assert.equal(live.saveAt, 456);
  assert.equal(live.lastBlob, oldBlob);
  assert.equal(c.of(MSG.SAVE).length, 0);
  h.server.send = send;
});

test('normal account disconnect accepts the final ECS/profile snapshot', async (t) => {
  const f = await account(t), { h, c, live, profile: p, store } = f;
  p.gold = 12; h.server.world.ecs.xp[live.entity] = 23;
  c.ws.close();
  await h.close();
  const row = await store.loadProfile(A);
  assert.equal(row.data.gold, 12);
  assert.equal(row.data.xp, 23);
  assert.equal(h.unsavedProfiles?.size ?? 0, 0);
});

test('LocalServer rejects asynchronous access and detach hooks without mutating profile state', async (t) => {
  const f = await account(t), { h, c, live, profile: p } = f;
  const entity = live.entity, priorProfT = live.profT;
  h.server.profileAccess = async () => true;
  h.server.world.profileDirty.add(entity);
  assert.throws(() => h.server.sendProfile(c.id, live), /synchronous boolean/);
  assert.equal(p.xp, 0);
  assert.equal(live.profT, priorProfT);
  assert.equal(h.server.world.profileDirty.has(entity), true);

  h.server.profileAccess = () => true;
  h.server.beforeDetach = async () => true;
  assert.throws(() => h.server.disconnect(c.id), /synchronous boolean/);
  assert.equal(h.server.world.profiles.has(entity), true);
  // Avoid repeating the intentionally-invalid hook during test cleanup.
  h.server.beforeDetach = () => true;
});
