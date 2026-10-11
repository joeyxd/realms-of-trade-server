// Host command guards share pearl account/UID lanes while leaving simulation commands synchronous.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { givePearl } from '../src/sim/systems/pearls.js';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { Rewards } from '../src/ui/rewards.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { QST, QUESTS } from '../src/data/quests.js';
import { TOWNS } from '../src/data/towns.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UID = 'command-access-pearl';
const WORLD = 'command-access-world';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
function makeProfile() { return newProfile(); }

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

function makeHost(t, options = {}) {
  const h = new GameHost({ seed: 42, bots: 0, log: () => {}, ...options });
  t.after(async () => {
    try { await h.releasePending?.(); await h.close(); }
    catch (error) { if (error.code !== 'flush') throw error; }
  });
  return h;
}

function connect(h, extra = {}) {
  const ws = new Socket();
  h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = h.nextId - 1;
  const hello = () => ws.emit('message', Buffer.from(JSON.stringify({
    t: MSG.HELLO, v: PROTOCOL_VERSION, name: `P${id}`, weapon: 0, ...extra,
  })), false);
  const c = { id, ws, hello, of: (type) => ws.messages.filter((m) => m.t === type) };
  return c;
}

async function join(h, c) { c.hello(); await Promise.all([...h.joins]); return h.server.clients.get(c.id); }
function wire(c, message) { c.ws.emit('message', Buffer.from(JSON.stringify(message)), false); }
function command(c, type, fields = {}) { wire(c, { t: MSG.CMD, type, ...fields }); }
function denied(c) { return c.of(MSG.EVENT).filter((m) => m.ev?.type === 'commandDenied'); }
function accountHost(t, options = {}) {
  const store = options.store ?? createMemoryStore();
  const h = makeHost(t, { store, resolvePlayer: async (_req, msg) => msg.name === 'B' ? B : A, ...options });
  return { h, store };
}
async function joinPair(h, { guestB = false } = {}) {
  const a = connect(h, { name: 'A' }), b = connect(h, { name: 'B' });
  await join(h, a);
  if (guestB) {
    const original = h.resolvePlayer;
    h.resolvePlayer = async (_req, msg) => msg.name === 'B' ? null : original(_req, msg);
  }
  await join(h, b);
  return { a, b, ca: h.server.clients.get(a.id), cb: h.server.clients.get(b.id),
    pa: h.server.world.profiles.get(h.server.clients.get(a.id).entity),
    pb: h.server.world.profiles.get(h.server.clients.get(b.id).entity) };
}

function addPearl(h, entity) {
  const p = h.server.world.profiles.get(entity), pearl = givePearl(h.server.world, entity, 'brasa');
  assert.ok(pearl);
  h.server.world.events.length = 0;
  h.server.world.profileDirty.delete(entity);
  return { pearl, profile: p };
}

test('command hook receives frozen trusted plans and valid commands report dispatch, not helper success', async (t) => {
  const { h } = accountHost(t, { dev: true });
  const c = connect(h, { name: 'A' }), live = await join(h, c), plans = [];
  h.server.commandAccess = (id, entity, plan) => { plans.push({ id, entity, plan }); return true; };

  assert.equal(h.server.playerCommand(live, { type: 'tut', i: 2 }), true);
  assert.equal(h.server.playerCommand(live, { type: 'talk', npc: -99 }), true, 'recognized call is dispatched even when helper cannot act');
  assert.equal(h.server.playerCommand(live, { type: 'pearl', op: 'spit' }), true);
  assert.equal(h.server.playerCommand(live, { type: 'pearl', op: 'give', uid: 'x', target: 23 }), true);
  assert.equal(h.server.devCommand(live, { op: 'gold', n: 0 }), true);
  assert.equal(h.server.devCommand(live, { op: 'spawn', kind: 'enemy', ang: 0, dist: 4 }), true);

  assert.deepEqual(plans.map(({ plan }) => plan), [
    { world: false, target: null }, { world: true, target: null },
    { world: true, target: null }, { world: false, target: 23 },
    { world: false, target: null }, { world: true, target: null },
  ]);
  assert.ok(plans.every(({ plan }) => Object.isFrozen(plan)));
  assert.ok(plans.every(({ id, entity }) => id === c.id && entity === live.entity));
});

test('unknown player, pearl and dev operations return false without consulting the hook', async (t) => {
  const { h } = accountHost(t, { dev: true });
  const c = connect(h, { name: 'A' }), live = await join(h, c);
  let calls = 0;
  h.server.commandAccess = () => { calls++; return false; };
  const events = structuredClone(h.server.world.events), dirty = [...h.server.world.profileDirty];

  assert.equal(h.server.playerCommand(live, { type: 'unrecognized' }), false);
  assert.equal(h.server.playerCommand(live, { type: 'pearl', op: 'clone', uid: UID }), false);
  assert.equal(h.server.devCommand(live, { op: 'clone' }), false);
  assert.equal(calls, 0);
  assert.deepEqual(h.server.world.events, events);
  assert.deepEqual([...h.server.world.profileDirty], dirty);
  assert.equal(denied(c).length, 0);
});

test('actor account reservation blocks a real tutorial helper with only private denial feedback', async (t) => {
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c);
  const gate = pearlMutationGate(h.profiles), handle = gate.reserve({ accounts: [A] });
  const p = h.server.world.profiles.get(live.entity), before = structuredClone(p), rng = h.server.world.rng.state();
  const events = structuredClone(h.server.world.events), saveAt = live.saveAt;
  try {
    command(c, 'tut', { i: 9 });
    assert.deepEqual(p, before);
    assert.equal(h.server.world.rng.state(), rng);
    assert.deepEqual(h.server.world.events, events, 'denial did not enter the world event queue');
    assert.equal(live.saveAt, saveAt);
    assert.equal(denied(c).length, 1);
    assert.deepEqual(denied(c)[0].ev, { type: 'commandDenied', to: live.entity, e: live.entity, why: 'busy' });
    assert.equal(denied(c)[0].ev.to, live.entity, 'only the actor gets a response');
  } finally { gate.release(handle); }
});

test('actor profile UID and ledger-only UID lanes block scoped commands', async (t) => {
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c);
  const gate = pearlMutationGate(h.profiles), { pearl, profile: p } = addPearl(h, live.entity);

  let handle = gate.reserve({ uids: [pearl.uid] });
  try {
    assert.equal(h.server.playerCommand(live, { type: 'tut', i: 3 }), false);
    assert.equal(p.flags.tut, 0);
  } finally { gate.release(handle); }

  p.pearls.bag = p.pearls.bag.filter((item) => item.uid !== pearl.uid);
  assert.equal(h.server.world.pearlLedger.get(pearl.uid).entity, live.entity);
  handle = gate.reserve({ uids: [pearl.uid] });
  try {
    assert.equal(h.server.playerCommand(live, { type: 'tut', i: 4 }), false,
      'the host derives ledger-held UIDs even when absent from the bag snapshot');
    assert.equal(p.flags.tut, 0);
  } finally { gate.release(handle); }
  assert.equal(denied(c).length, 2);
});

test('target account, target UID and forged target profile identity block pearl give before its helper', async (t) => {
  const { h } = accountHost(t), { a, b, ca, cb, pa, pb } = await joinPair(h);
  const gate = pearlMutationGate(h.profiles), source = addPearl(h, ca.entity).pearl;
  const target = addPearl(h, cb.entity).pearl;
  const beforeA = structuredClone(pa.pearls), beforeB = structuredClone(pb.pearls);
  pb.pirateId = `account:${A}`; // An untrusted profile identifier cannot replace authenticated session B.
  assert.equal(h.profiles.clients.get(b.id).key, B);

  const accountHandle = gate.reserve({ accounts: [B] });
  try { command(a, 'pearl', { op: 'give', uid: source.uid, target: cb.entity, account: A }); }
  finally { gate.release(accountHandle); }
  assert.deepEqual(pa.pearls, beforeA);
  assert.deepEqual(pb.pearls, beforeB);
  assert.equal(denied(a).length, 1);
  assert.equal(denied(b).length, 0);

  const uidHandle = gate.reserve({ uids: [target.uid] });
  try { command(a, 'pearl', { op: 'give', uid: source.uid, target: cb.entity }); }
  finally { gate.release(uidHandle); }
  assert.deepEqual(pa.pearls, beforeA);
  assert.deepEqual(pb.pearls, beforeB);
  assert.equal(denied(a).length, 2);

  command(a, 'pearl', { op: 'give', uid: source.uid, target: 999999 });
  assert.deepEqual(pa.pearls, beforeA);
  assert.deepEqual(pb.pearls, beforeB);
  assert.equal(denied(a).length, 3, 'a missing target is denied before transferPearl can emit its own result');
  assert.equal(h.server.world.events.some((event) => event.type === 'pearlDenied'), false);
});

test('a live guest client can be resolved as a pearl target without client-supplied account identity', async (t) => {
  const { h } = accountHost(t);
  const { a, b, ca, cb, pa, pb } = await joinPair(h, { guestB: true });
  const pearl = addPearl(h, ca.entity).pearl;
  const s = h.server.world.ecs;
  s.x[cb.entity] = s.x[ca.entity] + 1; s.z[cb.entity] = s.z[ca.entity];
  for (const e of [ca.entity, cb.entity]) { s.regenT[e] = 100; s.dashT[e] = -1; s.castK[e] = 0; s.atkStage[e] = 0; }
  assert.equal(h.profiles.clients.has(b.id), false);
  command(a, 'pearl', { op: 'give', uid: pearl.uid, target: cb.entity, account: A });
  assert.equal(pa.pearls.bag.some((item) => item.uid === pearl.uid), false);
  assert.equal(pb.pearls.bag.some((item) => item.uid === pearl.uid), true);
  assert.equal(h.server.world.pearlLedger.get(pearl.uid).entity, cb.entity);
  assert.equal(denied(a).length, 0);
});

test('world commands stop on another account or unknown UID while actor scoped commands remain disjoint', async (t) => {
  const { h } = accountHost(t), { a, ca } = await joinPair(h);
  const gate = pearlMutationGate(h.profiles), handle = gate.reserve({ accounts: [B] });
  try {
    command(a, 'tut', { i: 2 });
    assert.equal(h.server.world.profiles.get(ca.entity).flags.tut, 2);
    command(a, 'talk', { npc: 0 });
    assert.equal(denied(a).length, 1);
  } finally { gate.release(handle); }

  const uidHandle = gate.reserve({ uids: ['not-yet-discovered-uid'] });
  try {
    for (const [type, fields] of [
      ['open', { drop: 999999 }], ['quest', { op: 'accept', id: 'unknown' }],
      ['buy', { what: 'potion' }], ['market', { op: 'list', town: 'aldea' }],
      ['commerce', { op: 'list', opId: 'denied-list', town: 'aldea' }],
      ['raft', { op: 'quote', id: 'missing', expectedRev: 0 }],
      ['pearl', { op: 'swallow', uid: 'unknown-pearl' }],
      ['pearl', { op: 'spit' }], ['pearl', { op: 'leave', uid: 'unknown-pearl' }],
      ['pearl', { op: 'sell', uid: 'unknown-pearl' }],
    ]) command(a, type, fields);
    assert.equal(denied(a).length, 11);
    assert.equal(h.server.world.commerceReceipts, undefined, 'blocked commerce did not create a receipt cache');
    assert.equal(h.server.world.raftEditReceipts, undefined, 'blocked raft command did not create a receipt cache');
  } finally { gate.release(uidHandle); }
});

test('world gate allows ordinary connected profiles and an in-flight account save task', async (t) => {
  const base = createMemoryStore(), started = deferred(), release = deferred();
  const store = { ...base, async saveProfile(...args) { started.resolve(); await release.promise; return base.saveProfile(...args); } };
  const { h } = accountHost(t, { store });
  h.releasePending = () => release.resolve();
  const { a, b, ca, cb } = await joinPair(h);
  const liveB = h.server.clients.get(b.id);
  assert.equal(h.server.sendSave(b.id, liveB), true);
  await started.promise;
  assert.ok(h.profiles.tasks.size > 0);
  assert.equal(h.server.playerCommand(ca, { type: 'talk', npc: -1 }), true,
    'a normal account write task does not reserve world lanes');
  assert.equal(denied(a).length, 0);
  release.resolve(); h.releasePending = null;
  await h.profiles.flush();
  assert.equal(h.server.world.profiles.has(cb.entity), true);
});

test('world gate denies representative real helpers before changing profile, economy or receipt caches', async (t) => {
  const { h } = accountHost(t), { a, ca, pa } = await joinPair(h);
  const gate = pearlMutationGate(h.profiles), handle = gate.reserve({ accounts: [A] });
  const before = structuredClone(pa), worldEvents = structuredClone(h.server.world.events);
  try {
    for (const [type, fields] of [
      ['equip', { uid: 999999, slot: 'weapon' }],
      ['quest', { op: 'turnin', id: 'not-ready' }],
      ['tut', { i: 7 }],
      ['commerce', { op: 'list', opId: 'blocked-valid-list', town: 'aldea' }],
      ['raft', { op: 'quote', id: 'missing', expectedRev: 0 }],
    ]) command(a, type, fields);
    assert.deepEqual(pa, before);
    assert.deepEqual(h.server.world.events, worldEvents);
    assert.equal(denied(a).length, 5);
    assert.equal(h.server.world.commerceReceipts, undefined);
    assert.equal(h.server.world.raftEditReceipts, undefined);
    assert.equal(h.server.world.profiles.has(ca.entity), true);
  } finally { gate.release(handle); }
});

test('global pearl gate rejects every queued lane map, held and fenced handles', () => {
  for (const lane of ['uids', 'operationIds', 'unresolved', 'accountIds']) {
    const sessions = new ProfileSessions(createMemoryStore(), () => {});
    const gate = pearlMutationGate(sessions);
    sessions.pearls[lane].set(lane === 'accountIds' ? A : UID, {});
    assert.throws(() => gate.assertWorldAvailable(), { code: 'busy' }, `${lane} blocks global commands`);
  }

  for (const fenced of [false, true]) {
    const sessions = new ProfileSessions(createMemoryStore(), () => {});
    const gate = pearlMutationGate(sessions), handle = gate.reserve({ uids: [UID] });
    if (fenced) gate.fence(handle);
    assert.throws(() => gate.assertWorldAvailable(), { code: 'busy' }, fenced ? 'fenced lane' : 'held lane');
    if (!fenced) gate.release(handle);
  }
});

test('recovery and hydration barriers deny world commands before and after the queue becomes ready', () => {
  const sessions = new ProfileSessions(createMemoryStore(), () => {}), gate = pearlMutationGate(sessions);
  sessions.pearls.admitting = false;
  const recovery = gate.beginRecovery();
  assert.throws(() => gate.assertWorldAvailable(), { code: 'recovery' });
  sessions.pearls.admitting = true;
  assert.throws(() => gate.assertWorldAvailable(), { code: 'busy' }, 'queue readiness cannot open a recovery-to-hydration gap');
  gate.beginHydration(recovery);
  assert.throws(() => gate.assertWorldAvailable(), { code: 'busy' });
  gate.assertHydration(recovery);
  gate.releaseHydration(recovery);
  assert.equal(gate.assertWorldAvailable(), undefined);
});

test('global gate also rejects a pearl queue UID, and closed or failed sessions fail closed', async (t) => {
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c);
  const session = h.profiles.clients.get(c.id), gate = pearlMutationGate(h.profiles);
  session.pearlBusy = { inQueue: true };
  assert.throws(() => gate.assertWorldAvailable(), { code: 'busy' });
  session.pearlBusy = null;
  session.closed = true;
  assert.throws(() => gate.assertWorldAvailable(), { code: 'session' });
  session.closed = false; session.failed = true;
  assert.throws(() => gate.assertWorldAvailable(), { code: 'session' });
  session.failed = false;
  assert.equal(gate.assertWorldAvailable(), undefined, 'ordinary live account sessions remain available');
  assert.equal(h.server.world.profiles.has(live.entity), true);
});

test('all dev world operations use the global plan; character operations stay actor scoped', async (t) => {
  const { h } = accountHost(t, { dev: true }), c = connect(h, { name: 'A' }), live = await join(h, c), plans = [];
  h.server.commandAccess = (_id, _entity, plan) => { plans.push(plan); return false; };
  for (const op of ['tune', 'spawn', 'clear', 'enc', 'clock', 'pearl', 'drop', 'item']) {
    assert.equal(h.server.devCommand(live, { op, kind: 'brasa', hours: 12 }), false);
  }
  for (const op of ['god', 'weapon', 'heal', 'riposte', 'level', 'mastery', 'tattoos', 'tattoo', 'loadout', 'tier', 'gold', 'potions']) {
    assert.equal(h.server.devCommand(live, { op }), false);
  }
  assert.deepEqual(plans.map((plan) => plan.world), [
    true, true, true, true, true, true, true, true,
    false, false, false, false, false, false, false, false, false, false, false, false,
  ]);
  assert.ok(plans.every((plan) => Object.isFrozen(plan) && plan.target === null));
  const n = plans.length;
  assert.equal(h.server.devCommand(live, { op: 'unknown-dev-op' }), false);
  assert.equal(plans.length, n);
});

test('direct command calls cannot bypass guards through a stale or forged client object', async (t) => {
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c), calls = [];
  h.server.commandAccess = (...args) => { calls.push(args); return true; };
  const fake = { ...live };
  assert.equal(h.server.playerCommand(fake, { type: 'tut', i: 5 }), false);
  assert.equal(calls.length, 0);
  c.ws.close();
  assert.equal(h.server.playerCommand(live, { type: 'tut', i: 5 }), false);
  assert.equal(calls.length, 0);
});

test('async command hooks and invalid hook configuration fail closed before helper mutation', async (t) => {
  assert.throws(() => new LocalServer({ seed: 1, send: () => {}, commandAccess: true }), TypeError);
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c);
  const p = h.server.world.profiles.get(live.entity), before = structuredClone(p);
  h.server.commandAccess = async () => true;
  assert.throws(() => h.server.playerCommand(live, { type: 'tut', i: 12 }), /command hook must return a synchronous boolean/);
  h.server.commandAccess = () => { throw new Error('hook failure'); };
  assert.throws(() => h.server.playerCommand(live, { type: 'tut', i: 12 }), /hook failure/);
  assert.deepEqual(p, before);
  assert.equal(denied(c).length, 0);
});

test('commandDenied reaches only the player as the fixed Rewards toast without profile or UID data', () => {
  const delivered = (youServer) => {
    const events = [], client = Object.create(GameClient.prototype);
    Object.assign(client, { youServer, pred: { hazards: {} }, predicted: new Set(),
      bus: { emit: (type, event) => { if (type === 'combat') events.push(event); } } });
    client.onMessage({ t: MSG.EVENT, ev: { type: 'commandDenied', to: 41, e: 41, why: 'busy' } });
    return events;
  };
  const own = delivered(41), remote = delivered(99), toasts = [];
  const rewards = { hud: { toast: (html, ms) => toasts.push({ html, ms }) } };
  assert.equal(own.length, 1);
  assert.equal(own[0].me, true);
  assert.equal(remote.length, 1);
  assert.equal(remote[0].me, false);
  Rewards.prototype.handle.call(rewards, own[0]);
  Rewards.prototype.handle.call(rewards, remote[0]);
  assert.deepEqual(toasts, [{ html: '<b>Acción no disponible.</b> Espera un momento y vuelve a intentarlo.', ms: 5000 }]);
  assert.equal(JSON.stringify({ own, remote, toasts }).includes(UID), false);
  assert.equal('profile' in own[0], false);
  assert.equal('receipt' in own[0], false);
});

test('debug teleport obeys actor lanes while pause, ping and input messages remain available', async (t) => {
  const { h } = accountHost(t, { dev: true }), c = connect(h, { name: 'A' }), live = await join(h, c);
  const gate = pearlMutationGate(h.profiles), handle = gate.reserve({ accounts: [A] });
  const ecs = h.server.world.ecs, before = { x: ecs.x[live.entity], z: ecs.z[live.entity] };
  try {
    assert.equal(h.server.debugTeleport(live, { x: 88, z: 77 }), false);
    assert.deepEqual({ x: ecs.x[live.entity], z: ecs.z[live.entity] }, before);
    h.server.pausable = true;
    command(c, 'pause', { on: true });
    wire(c, { t: MSG.PING, t0: 17 });
    wire(c, { t: MSG.INPUTS, cmds: [{ seq: 1, prs: 0, btn: 0, mx: 0, mz: 0 }] });
    assert.equal(live.paused, true);
    assert.equal(c.of(MSG.PONG).length, 1);
    assert.equal(live.queue.length, 1);
    assert.equal(denied(c).length, 1);
  } finally { gate.release(handle); }
  assert.equal(h.server.debugTeleport(live, { x: 88, z: 77 }), true);
  assert.equal(ecs.x[live.entity], 88);
  assert.equal(ecs.z[live.entity], 77);
});

test('real staging keeps local commands blocked after durable confirmation until manual drain', async (t) => {
  const base = createMemoryStore(), stored = makeProfile();
  stored.pirateId = `account:${A}`;
  assert.equal((await base.saveProfile(A, stored, 0)).ok, true);
  const row = await base.loadProfile(A), data = structuredClone(row.data);
  data.pearls.bag.push({ uid: UID, kind: 'brasa' });
  assert.equal((await base.commitPearl({ operationId: '61000000-0000-4000-8000-000000000031',
    uid: UID, kind: 'brasa', from: null, to: A, expectedVersion: 0,
    profiles: [{ id: A, expectedVersion: row.version, data }] })).ok, true);

  const committed = deferred(), release = deferred();
  let pause = true, staging = null;
  const store = { ...base, async commitPearlGround(request) {
    const receipt = await base.commitPearlGround(request);
    if (pause) { committed.resolve(); await release.promise; }
    return receipt;
  } };
  const { h } = accountHost(t, { store });
  h.releasePending = () => release.resolve();
  const c = connect(h, { name: 'A' }), live = await join(h, c), entity = live.entity;
  staging = new PearlStaging(h.profiles, h.server.world, WORLD);
  h.releasePending = async () => { release.resolve(); await staging.settle(); };
  h.server.world.ecs.regenT[entity] = 100; h.server.world.ecs.dashT[entity] = -1;
  const p = h.server.world.profiles.get(entity);
  const operation = staging.swallow({ uid: UID, expectedVersion: 1, source: { clientId: c.id, entity } });
  // A failed preflight must fail the test instead of hanging forever before its first RPC.
  await Promise.race([committed.promise, staging.settle().then(() => {
    throw new Error('staging settled before a durable receipt');
  })]);

  command(c, 'tut', { i: 8 });
  command(c, 'talk', { npc: 0 });
  assert.equal(p.flags.tut, 0);
  assert.equal(denied(c).length, 2);
  pause = false; release.resolve(); await staging.settle(); await operation;
  command(c, 'tut', { i: 9 });
  command(c, 'talk', { npc: 0 });
  assert.equal(p.flags.tut, 0, 'receipt confirmation alone does not apply the queued pearl or release lanes');
  assert.equal(denied(c).length, 4);
  assert.equal(staging.drain()[0].state, 'applied');

  command(c, 'tut', { i: 9 });
  assert.equal(p.flags.tut, 9, 'a fresh command proceeds only after manual local apply');
  assert.equal(denied(c).length, 4, 'previously denied commands are not retried automatically');
  assert.deepEqual(staging.drain(), []);
  await h.profiles.flush();
});

function calmAt(w, e, x, z, y = w.map.groundAt(x, z)) {
  const s = w.ecs;
  s.x[e] = x; s.z[e] = z; s.y[e] = y; s.regenT[e] = 100;
  s.dashT[e] = -1; s.dashBuffer[e] = s.castK[e] = s.castLock[e] = s.moveMag[e] = s.vx[e] = s.vz[e] = 0;
}

test('an equip that can succeed leaves gear and dirty scheduling intact until its account releases', async (t) => {
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c), w = h.server.world;
  const p = w.profiles.get(live.entity), item = { u: 80, b: 'tricornio', r: 0, l: 1, a: [] };
  p.bag.push(item); calmAt(w, live.entity, w.ecs.x[live.entity], w.ecs.z[live.entity]);
  const before = structuredClone(p), events = structuredClone(w.events), dirty = [...w.profileDirty], saveAt = live.saveAt;
  const gate = pearlMutationGate(h.profiles), held = gate.reserve({ accounts: [A] });
  try {
    command(c, 'equip', { uid: item.u, slot: 'head' });
    assert.deepEqual(p, before); assert.deepEqual(w.events, events);
    assert.deepEqual([...w.profileDirty], dirty); assert.equal(live.saveAt, saveAt);
  } finally { gate.release(held); }
  command(c, 'equip', { uid: item.u, slot: 'head' });
  assert.deepEqual(p.eq.head, item); assert.equal(p.bag.some(q => q.u === item.u), false);
  assert.ok(w.events.some(ev => ev.type === 'gear')); assert.equal(denied(c).length, 1);
});

test('a ready quest retains its reward, RNG and progress while blocked then grants once on a fresh command', async (t) => {
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c), w = h.server.world;
  const p = w.profiles.get(live.entity), vendor = w.npcs.get('vendor'), s = w.ecs;
  p.quests.coral = [QST.READY, 6]; calmAt(w, live.entity, s.x[vendor] + 1, s.z[vendor]);
  const before = structuredClone(p), rng = w.lootRng.state(), events = structuredClone(w.events);
  const gate = pearlMutationGate(h.profiles), held = gate.reserve({ uids: ['unrelated:reward'] });
  try {
    command(c, 'quest', { op: 'turnin', id: 'coral' });
    assert.deepEqual(p, before); assert.equal(w.lootRng.state(), rng); assert.deepEqual(w.events, events);
  } finally { gate.release(held); }
  command(c, 'quest', { op: 'turnin', id: 'coral' });
  assert.equal(p.quests.coral[0], QST.DONE); assert.equal(p.gold, before.gold + QUESTS.coral.reward.gold);
  assert.equal(p.bag.length, before.bag.length + 1); assert.notEqual(w.lootRng.state(), rng);
  command(c, 'quest', { op: 'turnin', id: 'coral' });
  assert.equal(p.gold, before.gold + QUESTS.coral.reward.gold);
  assert.equal(w.events.filter(ev => ev.type === 'quest' && ev.id === 'coral' && ev.st === 'done').length, 1);
});

test('a real chest cannot consume drops, RNG or an unknown mint lane while another UID is reserved', async (t) => {
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c), w = h.server.world;
  const e = live.entity, id = w.nextDrop++;
  w.drops.set(id, { id, to: e, kind: 'chest', x: w.ecs.x[e], z: w.ecs.z[e],
    contents: [{ kind: 'gold', n: 17 }], rarity: 2, tide: 1, t: w.tick + 1000 });
  const before = { drops: structuredClone([...w.drops]), ledger: structuredClone([...w.pearlLedger]),
    nextDrop: w.nextDrop, nextPearl: w.nextPearl, rng: w.lootRng.state(), events: structuredClone(w.events) };
  const gate = pearlMutationGate(h.profiles), held = gate.reserve({ uids: ['unrelated:mint'] });
  try {
    command(c, 'open', { drop: id });
    assert.deepEqual([...w.drops], before.drops); assert.deepEqual([...w.pearlLedger], before.ledger);
    assert.equal(w.nextDrop, before.nextDrop); assert.equal(w.nextPearl, before.nextPearl);
    assert.equal(w.lootRng.state(), before.rng); assert.deepEqual(w.events, before.events);
  } finally { gate.release(held); }
  command(c, 'open', { drop: id });
  assert.equal(w.drops.has(id), false); assert.ok(w.nextDrop > before.nextDrop);
  assert.notEqual(w.lootRng.state(), before.rng); assert.ok(w.events.some(ev => ev.type === 'chest' && ev.id === id));
  assert.equal(denied(c).length, 1);
});

test('dev mint and drop do no work across a foreign UID reservation; fresh mint proceeds after release', async (t) => {
  const { h } = accountHost(t, { dev: true }), c = connect(h, { name: 'A' }), live = await join(h, c), w = h.server.world;
  const p = w.profiles.get(live.entity), gate = pearlMutationGate(h.profiles), held = gate.reserve({ uids: ['unrelated:dev'] });
  const before = { p: structuredClone(p), nextPearl: w.nextPearl, nextDrop: w.nextDrop,
    ledger: structuredClone([...w.pearlLedger]), drops: structuredClone([...w.drops]),
    rng: w.lootRng.state(), events: structuredClone(w.events) };
  try {
    command(c, 'dev', { op: 'pearl', kind: 'brasa' });
    command(c, 'dev', { op: 'drop', kind: 'item', rarity: 2 });
    assert.deepEqual(p, before.p); assert.equal(w.nextPearl, before.nextPearl); assert.equal(w.nextDrop, before.nextDrop);
    assert.deepEqual([...w.pearlLedger], before.ledger); assert.deepEqual([...w.drops], before.drops);
    assert.equal(w.lootRng.state(), before.rng); assert.deepEqual(w.events, before.events);
  } finally { gate.release(held); }
  command(c, 'dev', { op: 'pearl', kind: 'brasa' });
  assert.equal(p.pearls.bag.length, 1); assert.equal(w.nextPearl, before.nextPearl + 1);
  assert.equal(w.pearlLedger.get(p.pearls.bag[0].uid).entity, live.entity);
  assert.equal(denied(c).length, 2);
  h.server.dev = false;
  assert.equal(h.server.devCommand(live, { op: 'gold', n: 20 }), false);
  assert.equal(p.gold, before.p.gold, 'direct dev entry also respects dev:false');
});

test('valid commerce and raft reads wait before caches or acknowledgements and remain usable after release', async (t) => {
  const { h } = accountHost(t), c = connect(h, { name: 'A' }), live = await join(h, c), w = h.server.world;
  const e = live.entity, p = w.profiles.get(e), ship = p.eco.ships.find(q => q.kind === 'raft'), raft = w.rafts.get(ship.id);
  const town = w.map.landmarks[TOWNS.aldea.landmark] || w.map[TOWNS.aldea.landmark];
  const gate = pearlMutationGate(h.profiles), held = gate.reserve({ uids: ['unrelated:shared'] });
  const market = structuredClone(w.economy.markets.aldea), before = structuredClone(p), events = structuredClone(w.events);
  const placeOnRaft = () => {
    const s = w.ecs, angle = s.facing[raft.entity];
    calmAt(w, e, s.x[raft.entity] + Math.cos(angle) + Math.sin(angle),
      s.z[raft.entity] - Math.sin(angle) + Math.cos(angle), s.y[raft.entity]);
  };
  const list = { op: 'list', opId: 'valid-list', town: 'aldea' }, quote = { op: 'quote', id: ship.id, expectedRev: ship.rev };
  try {
    calmAt(w, e, town.x, town.z); command(c, 'commerce', list);
    placeOnRaft(); command(c, 'raft', quote);
    assert.equal(w.commerceReceipts, undefined); assert.equal(w.raftEditReceipts, undefined);
    assert.deepEqual(p, before); assert.deepEqual(w.economy.markets.aldea, market); assert.deepEqual(w.events, events);
  } finally { gate.release(held); }
  calmAt(w, e, town.x, town.z); command(c, 'commerce', list);
  assert.ok(w.commerceReceipts?.get(e)); assert.ok(w.events.some(ev => ev.type === 'commerce' && ev.ok));
  placeOnRaft(); command(c, 'raft', quote);
  assert.ok(w.raftEditReceipts?.get(e)); assert.ok(w.events.some(ev => ev.type === 'raftEdit' && ev.ok));
  assert.equal(denied(c).length, 2); assert.deepEqual(w.economy.markets.aldea, market);
});
