// Apply completion must progress before the reservation it releases is checked by the tick guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LocalServer } from '../src/net/localServer.js';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { PearlStartup } from '../server/pearlStartup.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { DT, SNAPSHOT_EVERY, tuning } from '../src/data/tuning.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID = 'tick-apply-pearl', WORLD = 'tick-apply-contract';
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function local(options = {}) {
  const messages = [], server = new LocalServer({ seed: 42, bots: 0, enemies: false,
    send: (id, msg) => messages.push({ id, msg: structuredClone(msg) }), ...options });
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Apply', weapon: 0 });
  const live = server.clients.get(1);
  server.world.events.length = 0; server.world.profileDirty.clear(); messages.length = 0;
  live.queue.push({ seq: 1, pt: 0, mx: 1, mz: 0, ax: 1, az: 0, btn: 0, prs: 0, w: 0 });
  return { server, live, messages };
}

function simulation(server, live) {
  const w = server.world;
  return structuredClone({ tick: w.tick, rng: w.rng.state(), lootRng: w.lootRng.state(),
    profiles: [...w.profiles], events: w.events, dirty: [...w.profileDirty], queue: live.queue,
    ack: live.ack, carry: live.carry, starve: live.starve, lastPt: live.lastPt, fillPt: live.fillPt,
    stats: server.stats, freeze: server.freeze, slowT: server.slowT, x: w.ecs.x[live.entity] });
}

test('apply preflight precedes permission and dequeue; false waits without consuming simulation or time debt', () => {
  assert.throws(() => new LocalServer({ beforeTick: true, send() {} }), /tick apply hook/);
  let ready = false, now = 0;
  const order = [], f = local({ now: () => now,
    beforeTick: () => { order.push('apply'); return ready; },
    tickAccess: () => { order.push('access'); return true; } });
  const { server, live, messages } = f;
  server.freeze = 0.1; server.slowT = 0.2; server.acc = DT * 2;
  const before = simulation(server, live);
  assert.equal(server.step(), false);
  assert.deepEqual(order, ['apply']);
  now = 1000; server.pump();
  assert.deepEqual(order, ['apply', 'apply']);
  assert.deepEqual(simulation(server, live), before);
  assert.equal(server.last, now); assert.equal(server.acc, 0); assert.equal(server.tickBlocked, true);
  assert.equal(messages.filter(({ msg }) => msg.t === MSG.SNAPSHOT).length, 1);
  assert.equal(messages.at(-1).msg.ack, 0);
  ready = true; server.freeze = 0; server.slowT = 0; now += DT * 1.1 * 1000;
  server.pump();
  assert.equal(server.world.tick, 1); assert.equal(live.ack, 1);
  assert.deepEqual(order.slice(-3), ['apply', 'access', 'access']);
});

for (const [name, hook, pattern] of [
  ['throw', () => { throw new Error('broken apply'); }, /broken apply/],
  ['resolved Promise', () => Promise.resolve(true), /synchronous boolean/],
  ['rejected Promise', () => Promise.reject(new Error('async apply')), /synchronous boolean/],
  ['drain array', () => [], /synchronous boolean/],
]) {
  test(`faulty ${name} apply becomes sticky and cannot publish through later pump heartbeats`, async () => {
    let calls = 0, accesses = 0, now = 0;
    const { server, live, messages } = local({ now: () => now,
      beforeTick: () => { calls++; return hook(); }, tickAccess: () => { accesses++; return true; } });
    const before = simulation(server, live);
    assert.throws(() => server.step(), pattern);
    server.beforeTick = () => { calls++; return true; };
    assert.equal(server.step(), false); assert.equal(server.applyFiller(live), false);
    now = 1000; server.pump(); now = 2000; server.pump();
    assert.equal(calls, 1); assert.equal(accesses, 0); assert.equal(server.tickBlocked, true);
    assert.deepEqual(simulation(server, live), before); assert.deepEqual(messages, []);
    await new Promise((done) => setImmediate(done)); // A rejected accidental Promise is consumed.
  });
}

test('caught reentry during apply still fails closed before clock, input, filler or publication changes', () => {
  for (const entry of ['pump', 'step', 'applyFiller']) {
    let calls = 0, accesses = 0;
    const { server, live, messages } = local({ now: () => 500,
      tickAccess: () => { accesses++; return true; } });
    const before = simulation(server, live), last = server.last;
    server.beforeTick = () => {
      calls++;
      assert.throws(() => entry === 'applyFiller' ? server.applyFiller(live) : server[entry](), /reentrant/);
      return true;
    };
    assert.equal(server.step(), false);
    assert.equal(server.step(), false);
    assert.equal(calls, 1); assert.equal(accesses, 0); assert.equal(server.last, last);
    assert.deepEqual(simulation(server, live), before); assert.deepEqual(messages, []);
  }
});

test('outer pump drains once across catch-up ticks and internal fillers; direct filler drains before mutation', () => {
  let calls = 0, now = 0;
  const { server, live } = local({ fill: true, now: () => now, beforeTick: () => { calls++; return true; } });
  live.queue.length = 0; live.starve = tuning.combat.starveTicks + 1;
  now = DT * 3.1 * 1000; server.pump();
  assert.equal(calls, 1); assert.equal(server.world.tick, 3); assert.equal(server.stats.fill, 3);
  assert.equal(live.ack, 0);
  const tick = server.world.tick, lastPt = live.lastPt;
  assert.equal(server.applyFiller(live), true);
  assert.equal(calls, 2); assert.equal(server.world.tick, tick); assert.equal(live.lastPt, lastPt + 1);
  assert.equal(server.stats.fill, 4); assert.equal(live.ack, 0);
  server.beforeTick = () => false;
  const before = simulation(server, live);
  assert.equal(server.applyFiller(live), false); assert.deepEqual(simulation(server, live), before);
});

test('caught reentry from permission cannot consume input or restore a failed boundary', () => {
  const { server, live, messages } = local({ beforeTick: () => true });
  let accesses = 0;
  server.tickAccess = () => { accesses++; assert.throws(() => server.step(), /reentrant/); return true; };
  const before = simulation(server, live);
  assert.equal(server.step(), false); assert.equal(server.step(), false);
  assert.equal(accesses, 1); assert.equal(server.tickBlocked, true);
  assert.deepEqual(simulation(server, live), before); assert.deepEqual(messages, []);
});

test('partial writes from a faulty trusted adapter are retained privately without replay or automatic publication', () => {
  let calls = 0, now = 0;
  const { server, live, messages } = local({ now: () => now });
  const p = server.world.profiles.get(live.entity), gold = p.gold;
  server.beforeTick = () => {
    calls++; p.gold++;
    server.world.events.push({ type: 'pearlChanged', to: live.entity, e: live.entity, op: 'swallow' });
    server.world.profileDirty.add(live.entity);
    throw new Error('partial adapter failure');
  };
  assert.throws(() => server.step(), /partial adapter failure/);
  server.beforeTick = null;
  server.flushEvents();
  for (let i = 1; i <= 4; i++) { now = i * 1000; server.pump(); }
  assert.equal(calls, 1); assert.equal(p.gold, gold + 1, 'generic hooks have no invented rollback of owner state');
  assert.equal(server.world.tick, 0); assert.equal(live.ack, 0); assert.equal(live.queue.length, 1);
  assert.equal(server.world.events.length, 1); assert.equal(server.world.profileDirty.has(live.entity), true);
  assert.deepEqual(messages, [], 'unknown partial state cannot leak via heartbeat, event, profile or save');
});

test('HELLO, disconnect and explicit flush cannot publish apply events retained outside an admitted tick', () => {
  const { server, live, messages } = local();
  let prepared = false, allowed = false;
  server.beforeTick = () => {
    if (!prepared) {
      prepared = true;
      server.world.events.push({ type: 'pearlChanged', to: live.entity, e: live.entity, op: 'swallow' });
      server.world.profileDirty.add(live.entity);
    }
    return allowed;
  };
  assert.equal(server.step(), false);
  server.connect(2);
  server.receive(2, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Lifecycle', weapon: 0 });
  assert.equal(messages.some(({ msg }) => msg.t === MSG.EVENT && msg.ev.type === 'pearlChanged'), false);
  server.disconnect(2); server.flushEvents();
  assert.equal(messages.some(({ msg }) => msg.t === MSG.EVENT && msg.ev.type === 'pearlChanged'), false);
  assert.equal(server.world.events.filter((ev) => ev.type === 'pearlChanged').length, 1);
  assert.equal(server.world.profileDirty.has(live.entity), true);
  allowed = true;
  assert.equal(server.step(), true); assert.equal(live.ack, 1);
  assert.equal(messages.filter(({ id, msg }) => id === 1 && msg.t === MSG.EVENT && msg.ev.type === 'pearlChanged').length, 1);
  assert.equal(server.world.events.length, 0);
});

test('caught reentry inside an admitted command stops subsequent tick publication and ACK without inventing rollback', () => {
  const { server, live, messages } = local({ beforeTick: () => true });
  const apply = server.world.applyCommand.bind(server.world);
  server.world.applyCommand = (entity, cmd) => {
    apply(entity, cmd);
    assert.throws(() => server.step(), /reentrant/);
  };
  assert.throws(() => server.step(), /failed tick boundary/);
  assert.equal(server.world.tick, 0); assert.equal(live.ack, 0);
  assert.equal(live.queue.length, 0, 'the command already entered simulation; generic callbacks cannot rewind its effects');
  assert.equal(server.step(), false); server.flushEvents();
  assert.deepEqual(messages, []); assert.equal(server.tickBlocked, true);
});

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState === 1) { this.readyState = 3; this.emit('close'); } }
  ping() {}
}

async function stagingFixture(t, delayed = false) {
  const base = createMemoryStore(), p = newProfile(); p.pirateId = `account:${A}`;
  assert.equal((await base.saveProfile(A, p, 0)).ok, true);
  const row = await base.loadProfile(A), seeded = structuredClone(row.data);
  seeded.pearls.bag.push({ uid: UID, kind: 'brasa' });
  assert.equal((await base.commitPearl({ operationId: '73000000-0000-4000-8000-000000000001',
    uid: UID, kind: 'brasa', from: null, to: A, expectedVersion: 0,
    profiles: [{ id: A, expectedVersion: row.version, data: seeded }] })).ok, true);
  const committed = deferred(), release = deferred();
  let commits = 0;
  const store = { ...base, async commitPearlGround(request) {
    commits++; const receipt = await base.commitPearlGround(request);
    committed.resolve(); if (delayed) await release.promise; return receipt;
  } };
  const h = new GameHost({ seed: 42, bots: 0, store, resolvePlayer: async () => A, log() {} });
  const ws = new Socket(); h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = h.nextId - 1;
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Apply', weapon: 0 })), false);
  await Promise.all([...h.joins]);
  const live = h.server.clients.get(id), world = h.server.world;
  world.ecs.regenT[live.entity] = 99; world.ecs.dashT[live.entity] = -1;
  world.ecs.castK[live.entity] = 0; world.ecs.atkStage[live.entity] = 0;
  const staging = new PearlStaging(h.profiles, world, WORLD), outcomes = [];
  h.server.beforeTick = () => { outcomes.push(...staging.drain()); return true; };
  world.events.length = 0; world.profileDirty.clear(); ws.messages.length = 0;
  t.after(async () => {
    release.resolve(); await staging.settle();
    try { await h.close(); } catch (e) { if (e.code !== 'flush') throw e; }
  });
  const swallow = () => staging.swallow({ uid: UID, expectedVersion: 1, source: { clientId: id, entity: live.entity } });
  return { h, ws, id, live, world, staging, outcomes, committed, release, swallow,
    commits: () => commits, profile: world.profiles.get(live.entity) };
}

test('real delayed staging releases its own reservation from pump while paused; events wait for admitted tick', async (t) => {
  const f = await stagingFixture(t, true), { h, world, live, profile, outcomes, ws } = f;
  let now = 0; h.server.now = () => now; h.server.pausable = true; live.paused = true;
  h.server.freeze = 0.1; h.server.slowT = 0.2;
  h.server.receive(f.id, { t: MSG.INPUTS, cmds: [{ seq: 1, pt: world.tick, mx: 1, mz: 0 }] });
  const before = simulation(h.server, live);
  f.swallow(); await f.committed.promise;
  now = 1000; h.server.pump();
  assert.deepEqual(simulation(h.server, live), before);
  assert.equal(outcomes.length, 0); assert.equal(h.server.tickBlocked, true);
  f.release.resolve(); await f.staging.settle();
  assert.equal(h.tickAvailable(), false, 'the completed receipt still retains staging authority');
  ws.messages.length = 0; now = 2000; h.server.pump();
  assert.equal(outcomes.length, 1); assert.equal(outcomes[0].state, 'applied');
  assert.equal(profile.pearls.swallowed?.uid, UID); assert.equal(h.tickAvailable(), true);
  assert.equal(h.server.tickBlocked, false, 'paused pump refreshes the current preflight');
  assert.equal(world.tick, before.tick); assert.equal(live.ack, 0); assert.deepEqual(live.queue, before.queue);
  assert.equal(h.server.freeze, 0.1); assert.equal(h.server.slowT, 0.2);
  assert.equal(world.events.filter((ev) => ev.type === 'pearlChanged').length, 1);
  assert.equal(ws.messages.length, 0, 'pause retains the applied event until normal publication');
  now = 3000; h.server.pump(); assert.equal(outcomes.length, 1);
  live.paused = false; h.server.freeze = 0; h.server.slowT = 0;
  now += DT * 1.1 * 1000; h.server.pump();
  assert.equal(world.tick, before.tick + 1); assert.equal(live.ack, 1);
  assert.equal(ws.messages.filter((m) => m.t === MSG.EVENT && m.ev.type === 'pearlChanged').length, 1);
  assert.equal(f.commits(), 1); assert.equal(f.staging.drain().length, 0);
});

test('real applied effect remains unpublished while a separate reservation blocks the next tick', async (t) => {
  const f = await stagingFixture(t), { h, world, live, outcomes, ws } = f;
  f.swallow(); await f.staging.settle();
  const gate = pearlMutationGate(h.profiles), held = gate.reserve({ uids: ['unrelated:ground'] });
  let released = false;
  t.after(() => { if (!released) gate.release(held); });
  const tick = world.tick;
  assert.equal(h.server.step(), false);
  assert.equal(outcomes[0].state, 'applied'); assert.equal(world.tick, tick); assert.equal(live.ack, 0);
  assert.equal(f.profile.pearls.swallowed?.uid, UID);
  assert.equal(ws.messages.length, 0); assert.equal(world.profileDirty.has(live.entity), true);
  assert.equal(world.events.filter((ev) => ev.type === 'pearlChanged').length, 1);
  gate.release(held); released = true;
  assert.equal(h.server.step(), true);
  for (let i = 0; i < SNAPSHOT_EVERY; i++) assert.equal(h.server.step(), true);
  assert.equal(outcomes.length, 1); assert.equal(f.commits(), 1);
  assert.equal(ws.messages.filter((m) => m.t === MSG.EVENT && m.ev.type === 'pearlChanged').length, 1);
  const eventIndex = ws.messages.findIndex((m) => m.t === MSG.EVENT && m.ev.type === 'pearlChanged');
  const snapshotIndex = ws.messages.findIndex((m) => m.t === MSG.SNAPSHOT);
  assert.equal(eventIndex < snapshotIndex, true, 'the admitted publication emits success before its first snapshot');
});

test('startup preparation cannot simulate before the injected synchronous ready drain', async () => {
  const base = createMemoryStore(), journal = createMemoryPearlJournals(base)(WORLD);
  const raw = { operationId: '73000000-0000-4000-8000-000000000002', uid: 'startup:apply',
    kind: 'tinta', from: null, to: null, expectedVersion: 0, world: WORLD,
    ground: { x: 3, z: 4, availableAt: 10, returnAt: 500 }, profiles: [] };
  await journal.prepare('ground', raw);
  assert.equal((await base.commitPearlGround(raw)).ok, true);
  await journal.resolve('ground', raw, 'committed');
  const sessions = new ProfileSessions(base, null, { journal }), gate = pearlMutationGate(sessions);
  const server = new LocalServer({ seed: 42, bots: 0, enemies: false, send() {}, tickAccess: () => {
    try { gate.assertWorldAvailable(); return true; } catch { return false; }
  } });
  const startup = new PearlStartup({ sessions, world: server.world, worldId: WORLD,
    mapClock: (ground) => ({ availableAt: ground.availableAt, returnAt: ground.returnAt }) });
  const work = startup.start();
  assert.equal(server.step(), false);
  await work;
  assert.equal(startup.state, 'prepared'); assert.equal(server.step(), false);
  assert.equal(server.world.tick, 0); assert.equal(server.world.drops.size, 0);
  server.beforeTick = () => startup.drain().state === 'ready';
  assert.equal(server.step(), true); assert.equal(startup.ready, true);
  assert.equal(server.world.tick, 1); assert.equal(server.world.drops.size, 1);
  const drop = [...server.world.drops.values()][0], nextDrop = server.world.nextDrop;
  assert.equal(drop.pearl.uid, raw.uid); assert.equal(drop.pickAt, 10); assert.equal(drop.t, 500);
  assert.equal(server.step(), true); assert.equal(server.world.nextDrop, nextDrop);
  assert.equal(server.world.drops.size, 1, 'later drains never reconstruct or mint the same drop twice');
  await sessions.flush();
});

test('staging fence outcome never licenses simulation or success publication at the new apply boundary', async (t) => {
  const f = await stagingFixture(t), { h, world, live, ws, outcomes } = f;
  f.swallow(); await f.staging.settle();
  // Invalidate authority before a death/revival transition, even if the entity looks live again.
  f.staging.invalidate(A);
  const tick = world.tick;
  assert.equal(h.server.step(), false);
  assert.equal(outcomes.length, 1); assert.equal(outcomes[0].state, 'fenced');
  assert.equal(world.tick, tick); assert.equal(f.profile.pearls.swallowed, null);
  assert.equal(ws.messages.some((m) => m.t === MSG.EVENT && m.ev.type === 'pearlChanged'), false);
  assert.equal(h.server.step(), false); assert.equal(outcomes.length, 1); assert.equal(f.commits(), 1);
  assert.equal(live.ack, 0);
});
