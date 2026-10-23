// The authoritative simulation must stop at the tick boundary while pearl/profile storage owns a lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { givePearl, dropPearl } from '../src/sim/systems/pearls.js';
import { LocalServer } from '../src/net/localServer.js';
import { DT, SNAPSHOT_EVERY } from '../src/data/tuning.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { BTN } from '../src/sim/systems/movement.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID = 'tick-access-pearl';
const WORLD = 'tick-access-contract';
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

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

function client(h) {
  const ws = new Socket();
  h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = h.nextId - 1;
  const hello = () => ws.emit('message', Buffer.from(JSON.stringify({
    t: MSG.HELLO, v: PROTOCOL_VERSION, name: `P${id}`, weapon: 0,
  })), false);
  return { id, ws, hello, of: (type) => ws.messages.filter((m) => m.t === type) };
}

function makeHost(t, options = {}) {
  const h = new GameHost({ seed: 42, bots: 0, log: () => {}, ...options });
  t.after(async () => {
    try { await h.releasePending?.(); await h.close(); }
    catch (error) { if (error.code !== 'flush') throw error; }
  });
  return h;
}

async function join(h, c) { c.hello(); await Promise.all([...h.joins]); return h.server.clients.get(c.id); }
function addPearl(p, uid = UID) { p.pearls.bag.push({ uid, kind: 'brasa' }); }

test('tick hook is synchronous and step/applyFiller fail before consuming queued simulation state', () => {
  assert.throws(() => new LocalServer({ tickAccess: true, send() {} }), /tick hook/);
  const sent = [], server = new LocalServer({ seed: 7, bots: 0, fill: true, send: (_id, msg) => sent.push(msg), tickAccess: () => false });
  server.connect(1);
  const live = server.clients.get(1), entity = server.world.spawnPlayer({ name: 'A', clientId: 1 });
  live.entity = entity; live.queue.push({ seq: 4, pt: 2, mx: 1, mz: 0, ax: 1, az: 0, btn: 0, prs: 8, w: 1 });
  live.carry = 2; live.ack = 3; live.starve = 11; live.fillPt = 5; live.lastPt = 4;
  const before = { tick: server.world.tick, stats: structuredClone(server.stats), queue: structuredClone(live.queue),
    carry: live.carry, ack: live.ack, starve: live.starve, fillPt: live.fillPt, lastPt: live.lastPt,
    x: server.world.ecs.x[entity], rng: server.world.rng.state() };
  assert.equal(server.step(), false);
  assert.equal(server.applyFiller(live), false);
  assert.equal(server.tickBlocked, true);
  assert.deepEqual({ tick: server.world.tick, stats: server.stats, queue: live.queue, carry: live.carry,
    ack: live.ack, starve: live.starve, fillPt: live.fillPt, lastPt: live.lastPt,
    x: server.world.ecs.x[entity], rng: server.world.rng.state() }, before);

  const asyncServer = new LocalServer({ seed: 7, bots: 0, send() {}, tickAccess: () => Promise.resolve(true) });
  assert.throws(() => asyncServer.step(), /synchronous boolean/);
  assert.equal(asyncServer.world.tick, 0, 'an accidental asynchronous approval fails before simulation');
  assert.equal(asyncServer.tickBlocked, true);
  asyncServer.tickAccess = () => { throw new Error('authority failed'); };
  assert.throws(() => asyncServer.step(), /authority failed/);
  assert.equal(asyncServer.world.tick, 0);
  assert.equal(asyncServer.tickBlocked, true);
  const worker = new LocalServer({ seed: 7, bots: 0, send() {} });
  assert.equal(worker.step(), true, 'Worker LocalServer without a host hook keeps its ordinary behavior');
});

test('host tick guard sees account, current UID, and ledger-only UID reservations while ordinary saves may run', async (t) => {
  const base = createMemoryStore(), started = deferred(), release = deferred();
  const store = { ...base, async saveProfile(...args) { started.resolve(); await release.promise; return base.saveProfile(...args); } };
  t.after(() => release.resolve());
  const h = makeHost(t, { store, resolvePlayer: async () => A });
  const c = client(h), live = await join(h, c), p = h.server.world.profiles.get(live.entity), gate = pearlMutationGate(h.profiles);
  assert.equal(h.tickAvailable(), true);

  let held = gate.reserve({ accounts: [A] });
  assert.equal(h.tickAvailable(), false, 'a connected account lane holds the world before tick effects');
  assert.equal(h.server.step(), false);
  gate.release(held);
  assert.equal(h.tickAvailable(), true);

  const pearl = givePearl(h.server.world, live.entity, 'brasa');
  assert.ok(pearl);
  held = gate.reserve({ uids: [pearl.uid] });
  assert.equal(h.tickAvailable(), false, 'an inventoried UID reserves the tick too');
  gate.release(held);
  p.pearls.bag = p.pearls.bag.filter((q) => q.uid !== pearl.uid);
  assert.equal(h.server.world.pearlLedger.get(pearl.uid).entity, live.entity);
  held = gate.reserve({ uids: [pearl.uid] });
  assert.equal(h.tickAvailable(), false, 'the host includes UID claims from the live ledger even when absent from profile arrays');
  gate.release(held);

  p.gold++;
  h.profiles.save(c.id, p);
  await started.promise;
  assert.equal(h.tickAvailable(), true, 'ordinary account save tasks are not pearl mutation reservations');
  release.resolve();
  await h.profiles.flush();
});

test('blocked step preserves due pickup, pearl expiry, input queue and ACK until a real tick is allowed', async (t) => {
  const h = makeHost(t, { resolvePlayer: async () => A });
  const c = client(h), live = await join(h, c), entity = live.entity, w = h.server.world;
  const p = w.profiles.get(entity), s = w.ecs, gate = pearlMutationGate(h.profiles);
  s.regenT[entity] = 99; s.dashT[entity] = -1; s.castK[entity] = 0; s.atkStage[entity] = 0;
  const gold = { id: w.nextDrop++, to: entity, kind: 'gold', n: 7, x: s.x[entity], z: s.z[entity], t: 100 };
  w.drops.set(gold.id, gold);
  const expiredPearl = { uid: 'expired-field-pearl', kind: 'brasa' };
  const pearlDrop = dropPearl(w, expiredPearl, s.x[entity], s.z[entity]);
  pearlDrop.t = 2;
  w.tick = 3; // stepDrops runs on every third tick; pickup and expiry are both due here.
  const held = gate.reserve({ uids: ['expired-field-pearl'] });
  h.server.receive(c.id, { t: MSG.INPUTS, cmds: [{ seq: 1, pt: 3, mx: 1, mz: 0, ax: 1, az: 0, btn: 0, prs: 4, w: 0 }] });
  h.server.receive(c.id, { t: MSG.PING, t0: 22 });
  const before = { tick: w.tick, gold: p.gold, drops: structuredClone([...w.drops]), ledger: structuredClone(w.pearlLedger.get(expiredPearl.uid)),
    queue: structuredClone(live.queue), ack: live.ack, rng: w.rng.state(), events: structuredClone(w.events) };
  assert.equal(h.server.step(), false);
  assert.deepEqual({ tick: w.tick, gold: p.gold, drops: [...w.drops], ledger: w.pearlLedger.get(expiredPearl.uid),
    queue: live.queue, ack: live.ack, rng: w.rng.state(), events: w.events }, before);
  assert.equal(c.of(MSG.PONG).length, 1, 'PING remains responsive during the storage hold');

  gate.release(held);
  assert.equal(h.server.step(), true);
  assert.equal(p.gold, before.gold + 7, 'the same due pickup is applied after release');
  assert.equal(w.drops.has(gold.id), false);
  assert.equal(w.pearlLedger.get(expiredPearl.uid).place, 'ground');
  assert.equal(w.drops.has(pearlDrop.id), false);
  assert.equal(live.ack, 1, 'queued input is consumed and acknowledged only after release');
});

test('pump holds time and RNG, emits at most one unchanged heartbeat, and releases without wall-clock catch-up', () => {
  let now = 0, allowed = false;
  const sent = [], server = new LocalServer({ seed: 9, bots: 0, send: (id, msg) => sent.push({ id, msg }),
    tickAccess: () => allowed, now: () => now });
  server.connect(8);
  const snapshots = () => sent.filter(({ msg }) => msg.t === MSG.SNAPSHOT);
  server.last = now;
  server.freeze = 0.1; server.slowT = 0.2; server.slowScale = 0.5;
  const tick = server.world.tick, rng = server.world.rng.state(), economy = server.world.economy.hours;
  now += DT * SNAPSHOT_EVERY * 20 * 1000;
  server.pump();
  assert.equal(server.tickBlocked, true);
  assert.equal(server.world.tick, tick);
  assert.equal(server.world.rng.state(), rng);
  assert.equal(server.world.economy.hours, economy);
  assert.equal(server.freeze, 0.1); assert.equal(server.slowT, 0.2);
  assert.equal(server.acc, 0);
  assert.equal(snapshots().length, 1, 'a stalled host sends one heartbeat instead of a catch-up burst');
  assert.equal(snapshots()[0].msg.tick, tick);
  assert.equal(server.holdAcc < DT * SNAPSHOT_EVERY, true, 'extra stall time is discarded after the heartbeat');

  allowed = true;
  now += DT * 1.1 * 1000;
  server.pump();
  assert.equal(server.tickBlocked, false);
  assert.equal(server.world.tick, tick, 'remaining hitstop consumes the newly elapsed frame without catch-up');
  assert.equal(server.freeze < 0.1, true);
  server.freeze = 0; server.slowT = 0;
  now += DT * 1.1 * 1000;
  server.pump();
  assert.equal(server.world.tick, tick + 1, 'release simulates only fresh elapsed time after time effects');
});

test('real staging blocks the durable-confirmed to pre-drain window, then permits simulation after explicit drain', async (t) => {
  const base = createMemoryStore(), initial = newProfile(); initial.pirateId = `account:${A}`;
  assert.equal((await base.saveProfile(A, initial, 0)).ok, true);
  const row = await base.loadProfile(A);
  const seeded = structuredClone(row.data); addPearl(seeded);
  assert.equal((await base.commitPearl({ operationId: '62000000-0000-4000-8000-000000000021', uid: UID,
    kind: 'brasa', from: null, to: A, expectedVersion: 0,
    profiles: [{ id: A, expectedVersion: row.version, data: seeded }] })).ok, true);
  const committed = deferred(), release = deferred();
  const store = { ...base, async commitPearlGround(request) {
    const receipt = await base.commitPearlGround(request);
    committed.resolve(); await release.promise; return receipt;
  } };
  t.after(() => release.resolve());
  const h = makeHost(t, { store, resolvePlayer: async () => A });
  const c = client(h), live = await join(h, c), entity = live.entity, p = h.server.world.profiles.get(entity), w = h.server.world;
  const staging = new PearlStaging(h.profiles, w, WORLD), gate = pearlMutationGate(h.profiles);
  t.after(async () => { release.resolve(); await staging.settle(); });
  w.ecs.regenT[entity] = 99; w.ecs.dashT[entity] = -1; w.ecs.castK[entity] = 0; w.ecs.atkStage[entity] = 0;
  const beforeTick = w.tick, beforeEvents = structuredClone(w.events);
  staging.swallow({ uid: UID, expectedVersion: 1, source: { clientId: c.id, entity } });
  await Promise.race([committed.promise, staging.settle().then(() => { throw new Error('storage was not held open'); })]);
  h.server.receive(c.id, { t: MSG.INPUTS, cmds: [{ seq: 1, pt: w.tick, mx: 1, mz: 0, btn: 0, prs: BTN.DASH }] });
  const beforeProfile = structuredClone(p), beforeQueue = structuredClone(live.queue), beforeAck = live.ack;
  assert.equal(h.tickAvailable(), false);
  assert.equal(h.server.step(), false);
  release.resolve();
  await staging.settle();
  assert.equal(h.profiles.clients.get(c.id).pearlBusy, null, 'storage returned its response and released the queue lane');
  assert.equal(h.tickAvailable(), false, 'durable confirmation remains fenced until manual ECS staging apply');
  assert.equal(h.server.step(), false);
  assert.equal(w.tick, beforeTick);
  assert.deepEqual(p, beforeProfile);
  assert.deepEqual(live.queue, beforeQueue); assert.equal(live.ack, beforeAck);
  assert.deepEqual(w.events, beforeEvents);

  assert.equal(staging.drain()[0].state, 'applied');
  assert.equal(h.tickAvailable(), true);
  assert.equal(h.server.step(), true);
  assert.equal(w.tick, beforeTick + 1);
  assert.equal(live.ack, 1);
  assert.equal(p.pearls.swallowed?.uid, UID);
  assert.equal(staging.drain().length, 0, 'the receipt effect applies once');
});

test('startup recovery and hydration barriers deny autonomous ticks until explicitly released', async () => {
  const profiles = new ProfileSessions(createMemoryStore()), gate = pearlMutationGate(profiles);
  const server = new LocalServer({ seed: 5, bots: 0, send() {}, tickAccess: () => {
    try { gate.assertWorldAvailable(); return true; } catch { return false; }
  } });
  profiles.pearls.admitting = false;
  const recovery = gate.beginRecovery();
  assert.equal(server.step(), false);
  profiles.pearls.admitting = true;
  assert.equal(server.step(), false, 'queue readiness alone cannot open the startup handoff');
  const hydration = gate.beginHydration(recovery);
  assert.equal(server.step(), false, 'the recovery-to-hydration handoff remains closed');
  gate.releaseHydration(hydration);
  assert.equal(server.step(), true);
});

test('every queue lane and a sticky fence close the actual host tick boundary', async (t) => {
  const h = makeHost(t), server = h.server, queue = h.profiles.pearls;
  for (const lane of ['uids', 'operationIds', 'unresolved', 'accountIds']) {
    const before = { tick: server.world.tick, rng: server.world.rng.state(), loot: server.world.lootRng.state() };
    queue[lane].set(lane === 'accountIds' ? A : UID, {});
    try {
      assert.equal(server.step(), false, lane);
      assert.deepEqual({ tick: server.world.tick, rng: server.world.rng.state(), loot: server.world.lootRng.state() }, before);
      assert.equal(h.status().storage.tickBlocked, true);
    } finally { queue[lane].clear(); }
    assert.equal(h.tickAvailable(), true, `${lane} release`);
  }
  const gate = pearlMutationGate(h.profiles), held = gate.reserve({ uids: [UID] });
  gate.fence(held);
  assert.equal(server.step(), false);
  assert.equal(server.step(), false, 'a fence is not cleared by a later poll');
});

test('trusted account and current entity failures deny ticks before dequeue rather than use payload identity', async (t) => {
  const h = makeHost(t, { resolvePlayer: async () => A }), c = client(h), live = await join(h, c);
  const session = h.profiles.clients.get(c.id), w = h.server.world;
  live.queue.push({ seq: 1, pt: 0, mx: 1, mz: 0, btn: 0, prs: 0 });
  const before = structuredClone(live.queue), tick = w.tick;
  for (const flag of ['closed', 'failed', 'pearlBusy']) {
    const old = session[flag]; session[flag] = true;
    try { assert.equal(h.server.step(), false, flag); assert.deepEqual(live.queue, before); }
    finally { session[flag] = old; }
  }
  h.profiles.clients.delete(c.id);
  try { assert.equal(h.server.step(), false, 'stored accounts require their actual client session'); }
  finally { h.profiles.clients.set(c.id, session); }
  w.ecs.alive[live.entity] = 0;
  try { assert.equal(h.server.step(), false, 'a stale entity cannot authorize the world tick'); }
  finally { w.ecs.alive[live.entity] = 1; }
  const profile = w.profiles.get(live.entity); w.profiles.delete(live.entity);
  try { assert.equal(h.server.step(), false, 'an absent profile cannot be replaced by message metadata'); }
  finally { w.profiles.set(live.entity, profile); }
  assert.equal(w.tick, tick); assert.equal(live.ack, 0);
  assert.equal(h.server.step(), true); assert.equal(live.ack, 1);
});

test('long storage holds bound the input queue and preserve trimmed presses under the existing carry policy', async (t) => {
  const h = makeHost(t), c = client(h), live = await join(h, c), w = h.server.world, e = live.entity;
  const gate = pearlMutationGate(h.profiles), held = gate.reserve({ uids: ['unknown:input-world'] });
  w.ecs.hp[e] = w.ecs.maxHp[e] / 2;
  const hp = w.ecs.hp[e], potions = w.ecs.potions[e], seen = [], apply = w.applyCommand.bind(w);
  w.applyCommand = (entity, cmd) => { seen.push(structuredClone(cmd)); apply(entity, cmd); };
  try {
    h.server.receive(c.id, { t: MSG.INPUTS, cmds: Array.from({ length: 45 }, (_, i) => ({
      seq: i + 1, pt: 0, mx: 0, mz: 0, btn: 0, prs: i === 0 ? BTN.POTION : 0,
    })) });
    assert.equal(live.queue.length, 30); assert.equal(h.server.stats.trimmed, 15);
    assert.equal(live.carry, BTN.POTION);
    for (let i = 0; i < 20; i++) assert.equal(h.server.step(), false);
    assert.equal(seen.length, 0); assert.equal(live.ack, 0);
    assert.equal(live.queue.length, 30); assert.equal(live.carry, BTN.POTION);
    assert.equal(w.ecs.hp[e], hp); assert.equal(w.ecs.potions[e], potions);
  } finally { gate.release(held); }
  assert.equal(h.server.step(), true);
  assert.equal(seen.length, 4, 'normal bounded backlog processing resumes, without one tick per held attempt');
  assert.equal(seen[0].seq, 16); assert.equal(seen[0].prs, BTN.POTION);
  assert.equal(seen.slice(1).some(cmd => cmd.prs & BTN.POTION), false);
  assert.equal(live.ack, 19); assert.equal(live.queue.length, 26); assert.equal(live.carry, 0);
  assert.equal(w.ecs.potions[e], potions - 1); assert.ok(w.ecs.hp[e] > hp);
});

test('held pump snapshots use elapsed cadence, keep the last applied ACK and never flush private effects or saves', async (t) => {
  const h = makeHost(t), c = client(h), live = await join(h, c), s = h.server, w = s.world;
  const spectator = client(h), gate = pearlMutationGate(h.profiles), held = gate.reserve({ uids: ['unknown:heartbeat'] });
  let now = 0; s.now = () => now; s.last = 0; s.acc = DT * 9;
  live.queue.push({ seq: 9, pt: 0, mx: 0, mz: 0, btn: 0, prs: 0 });
  w.profileDirty.add(live.entity);
  w.emit({ type: 'note', to: live.entity, e: live.entity, code: 'pending-fixture' });
  const events = structuredClone(w.events), profile = structuredClone(w.profiles.get(live.entity)), saveAt = live.saveAt;
  const counts = { profile: c.of(MSG.PROFILE).length, save: c.of(MSG.SAVE).length, event: c.of(MSG.EVENT).length };
  try {
    for (let i = 0; i < 5; i++) { now += DT * SNAPSHOT_EVERY * 1000 / 4; s.pump(); }
    assert.equal(c.of(MSG.SNAPSHOT).length, 1); assert.equal(spectator.of(MSG.SNAPSHOT).length, 1);
    const snap = c.of(MSG.SNAPSHOT)[0];
    assert.equal(snap.tick, w.tick); assert.equal(snap.ack, 0); assert.equal(live.ack, 0);
    assert.equal(snap.you.length > 0, true);
    assert.equal(JSON.stringify(snap).includes('unknown:heartbeat'), false);
    assert.equal('profile' in snap, false); assert.equal('receipt' in snap, false);
    assert.deepEqual(w.events, events); assert.deepEqual(w.profiles.get(live.entity), profile);
    assert.equal(w.profileDirty.has(live.entity), true); assert.equal(live.saveAt, saveAt);
    assert.deepEqual({ profile: c.of(MSG.PROFILE).length, save: c.of(MSG.SAVE).length, event: c.of(MSG.EVENT).length }, counts);
    assert.equal(s.acc, 0);
  } finally { gate.release(held); }
  assert.equal(s.step(), true); assert.equal(live.ack, 9);
  assert.equal(c.of(MSG.EVENT).filter(m => m.ev.code === 'pending-fixture').length, 1);
});
