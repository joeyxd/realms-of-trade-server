import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION, sanitizeCmd } from '../src/net/protocol.js';
import { BTN } from '../src/sim/systems/movement.js';
import { PEARL_ACTION_BITS, PEARL_ACTION_BUFFERS } from '../src/net/pearlInputBoundary.js';
import { database as sql } from './helpers/pearl-batch-journal-sql.mjs';
import { WORLD as scope } from './helpers/pearl-batch.mjs';

const accounts = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const pearls = [{ uid: 'host-mount-first', kind: 'escarcha' }, { uid: 'host-mount-target', kind: 'brasa' },
  { uid: 'host-mount-last', kind: 'tormenta' }];
const uid = pearls[1].uid;
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const command = (seq, pt = seq) => sanitizeCmd({ seq, pt, mx: 1, mz: 0, ax: 1, az: 0,
  btn: PEARL_ACTION_BITS | BTN.AIM, prs: PEARL_ACTION_BITS });
const progress = (p) => ({ lvl: p.lvl, xp: p.xp, pot: p.pot, cp: p.cp });
const ecsState = (ecs) => Object.fromEntries(Object.entries(ecs).map(([key, value]) =>
  [key, ArrayBuffer.isView(value) ? Array.from(value) : structuredClone(value)]));
const output = (f, type) => f.sockets.flatMap((ws) => ws.messages).filter((m) => m.t === MSG.EVENT && m.ev.type === type);

class Socket extends EventEmitter {
  readyState = 1; messages = []; closes = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close(code, reason) {
    if (this.readyState !== 1) return;
    this.onClosing?.(); this.closes.push({ code, reason }); this.readyState = 3; this.emit('close');
  }
  ping() {}
}

async function seed(base) {
  for (const id of accounts) {
    const p = newProfile(); p.pirateId = `account:${id}`; p.gold = 47; p.mast[0] = [2, 31];
    assert.equal((await base.saveProfile(id, p, 0)).ok, true);
  }
  for (const [i, pearl] of pearls.entries()) {
    const row = await base.loadProfile(accounts[0]), data = structuredClone(row.data); data.pearls.bag.push(pearl);
    assert.equal((await base.commitPearl({ operationId: `76000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ...pearl, from: null, to: accounts[0], expectedVersion: 0,
      profiles: [{ id: accounts[0], expectedVersion: row.version, data }] })).ok, true);
  }
}

async function fixture({ backend = async () => ({ store: createMemoryStore(), close: async () => {} }), wrap = (base) => base,
  mounted = true } = {}) {
  const database = await backend(), base = database.store; await seed(base);
  const store = wrap(base), logs = [], host = new GameHost({ seed: 42, bots: 0, store,
    resolvePlayer: async (_req, msg) => accounts[Number(msg.token)], log: (text) => logs.push(text) });
  if (mounted) host.mountPearlStaging({ scope });
  const sockets = [], entities = [];
  for (let i = 0; i < accounts.length; i++) {
    const ws = new Socket(); sockets.push(ws);
    host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'host-mount' } });
    ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION,
      name: `Host${i}`, weapon: 0, token: String(i) })), false);
    await Promise.all([...host.joins]);
    const c = host.server.clients.get(i + 1); assert.ok(c.entity); entities.push(c.entity);
  }
  const w = host.server.world, [e, other] = entities;
  w.ecs.x[other] = w.ecs.x[e] + 0.2; w.ecs.z[other] = w.ecs.z[e];
  for (const entity of entities) { w.ecs.regenT[entity] = 99; w.ecs.dashT[entity] = -1;
    w.ecs.castK[entity] = 0; w.ecs.atkStage[entity] = 0; }
  w.events.length = 0; w.profileDirty.clear(); for (const ws of sockets) ws.messages.length = 0;
  return { database, base, host, w, sockets, entities, logs, staging: host.pearlStaging,
    source: { clientId: 1, entity: e }, target: { clientId: 2, entity: other },
    c: host.server.clients.get(1), p: w.profiles.get(e),
    async close() { await host.pearlStaging?.settle(); await host.close().catch(() => {}); await database.close(); } };
}

for (const [name, backend] of [['memory', undefined], ['SDK/SQL008 local', sql]]) {
  test(`${name}: mounted GameHost applies a slow swallow on its real tick, preserving canonical progress and inputs`, async () => {
    const entered = deferred(), reply = deferred(); let request;
    const f = await fixture({ backend, wrap: (base) => ({ ...base, async commitPearlGround(raw) {
      request = structuredClone(raw); const result = await base.commitPearlGround(raw);
      entered.resolve(); await reply.promise; return result;
    } }) });
    try {
      const [e] = f.entities, s = f.host.server;
      f.w.ecs.level[e] = 3; f.w.ecs.xp[e] = 31.126; f.w.ecs.potions[e] = 3;
      f.c.queue.push(command(1), command(2)); f.c.carry = PEARL_ACTION_BITS; f.c.last = command(0);
      for (const column of PEARL_ACTION_BUFFERS) f.w.ecs[column][e] = 0.1;
      const before = structuredClone({ queue: f.c.queue, carry: f.c.carry, last: f.c.last }), x = f.w.ecs.x[e];
      const h = f.staging.swallow({ uid, expectedVersion: 1, source: f.source });
      await entered.promise;
      assert.deepEqual(progress(request.profiles[0].data), { lvl: 3, xp: 31.13, pot: 3, cp: f.p.cp });
      assert.equal(s.step(), false); assert.equal(f.w.tick, 0); assert.equal(f.c.ack, 0);
      assert.deepEqual({ queue: f.c.queue, carry: f.c.carry, last: f.c.last }, before);
      assert.equal(f.p.pearls.swallowed, null); assert.equal(output(f, 'pearlChanged').length, 0);
      f.w.ecs.level[e] = 4; f.w.ecs.xp[e] = 49.126; f.w.ecs.potions[e] = 4;
      reply.resolve(); await f.staging.settle();
      assert.equal(f.p.pearls.swallowed, null, 'a storage continuation cannot apply to live World');
      // beforeTick must also run when the server's ordinary simulation is paused.
      s.pausable = true; for (const c of s.clients.values()) c.paused = true; s.pump();
      assert.equal(f.w.tick, 0); assert.equal(f.c.ack, 0); assert.equal(f.w.ecs.x[e], x);
      assert.equal(f.staging.operations.has(h.operationId), false); assert.equal(f.p.pearls.swallowed.uid, uid);
      assert.deepEqual(progress(f.p), { lvl: 4, xp: 49.13, pot: 4, cp: f.p.cp });
      assert.equal(f.p.gold, 47); assert.deepEqual(f.p.mast[0], [2, 31]);
      for (const cmd of f.c.queue) assert.equal((cmd.btn | cmd.prs) & PEARL_ACTION_BITS, 0);
      assert.equal(f.c.carry, 0); assert.equal((f.c.last.btn | f.c.last.prs) & PEARL_ACTION_BITS, 0);
      for (const column of PEARL_ACTION_BUFFERS) assert.equal(f.w.ecs[column][e], 0);
      assert.equal(output(f, 'pearlChanged').length, 0);
      await f.host.profiles.flush(); assert.deepEqual((await f.base.loadProfile(accounts[0])).data, f.p);
      for (const c of s.clients.values()) c.paused = false;
      assert.equal(s.step(), true); assert.equal(f.c.ack, 1); assert.ok(f.w.ecs.x[e] > x);
      assert.equal(output(f, 'cast').length, 0); assert.equal(output(f, 'swing').length, 0);
      assert.equal(output(f, 'pearlChanged').length, 1, 'one event for the owner');
      assert.equal(s.step(), true); assert.equal(f.c.ack, 2); assert.equal(output(f, 'pearlChanged').length, 1);
      assert.equal((await f.base.loadUnique(uid)).version, 2);
      assert.deepEqual(f.host.status().storage.staging, { enabled: true, failed: false, pending: 0, completed: 0, reserved: 0 });
    } finally { reply.resolve(); await f.close(); }
  });
}

test('mounted give drains through the host without filtering either endpoint or changing active powers', async () => {
  const f = await fixture();
  try {
    for (const c of f.host.server.clients.values()) { c.queue.push(command(1)); c.carry = PEARL_ACTION_BITS; }
    const before = [...f.host.server.clients].map(([id, c]) => [id, structuredClone({ queue: c.queue, carry: c.carry })]);
    f.staging.give({ uid, expectedVersion: 1, source: f.source, target: f.target }); await f.staging.settle();
    f.host.server.pausable = true; for (const c of f.host.server.clients.values()) c.paused = true; f.host.server.pump();
    assert.deepEqual([...f.host.server.clients].map(([id, c]) => [id, { queue: c.queue, carry: c.carry }]), before);
    assert.equal(f.p.pearls.bag.some((p) => p.uid === uid), false);
    assert.equal(f.w.profiles.get(f.entities[1]).pearls.bag.at(-1).uid, uid);
    assert.equal(f.w.ecs.elem[f.entities[0]], 0); assert.equal(f.w.ecs.elem[f.entities[1]], 0);
    await f.host.profiles.flush(); assert.equal((await f.base.loadUnique(uid)).holder, accounts[1]);
  } finally { await f.close(); }
});

for (const [name, backend] of [['memory', undefined], ['SDK/SQL008 local', sql]]) {
  test(`${name}: mounted host rejects replacement before storage or input changes`, async () => {
    let reads = 0, saves = 0, batches = 0;
    const f = await fixture({ backend, wrap: (base) => ({ ...base,
      async loadUnique(...args) { reads++; return base.loadUnique(...args); },
      async saveProfile(...args) { saves++; return base.saveProfile(...args); },
      async commitPearlBatch(...args) { batches++; return base.commitPearlBatch(...args); },
    }) });
    try {
      f.staging.swallow({ uid, source: f.source, expectedVersion: 1 }); await f.staging.settle();
      f.host.server.pausable = true; for (const c of f.host.server.clients.values()) c.paused = true;
      f.host.server.pump(); await f.host.profiles.flush();
      reads = saves = batches = 0;
      f.c.queue.push(command(7)); f.c.carry = PEARL_ACTION_BITS;
      const queued = structuredClone(f.c.queue), carry = f.c.carry, before = structuredClone({ profiles: [...f.w.profiles],
        ecs: ecsState(f.w.ecs), drops: [...f.w.drops], events: f.w.events, ledger: [...f.w.pearlLedger], nextDrop: f.w.nextDrop });
      assert.throws(() => f.staging.replace({ uid: pearls[0].uid, replaceUid: uid, source: f.source,
        expectedVersion: 1, replaceExpectedVersion: 2 }), { code: 'bound' });
      await f.staging.settle();
      assert.deepEqual([reads, saves, batches], [0, 0, 0]);
      assert.deepEqual(f.c.queue, queued); assert.equal(f.c.carry, carry);
      assert.deepEqual({ profiles: [...f.w.profiles], ecs: ecsState(f.w.ecs), drops: [...f.w.drops], events: f.w.events,
        ledger: [...f.w.pearlLedger], nextDrop: f.w.nextDrop }, before);
      assert.equal(f.p.pearls.swallowed.uid, uid); assert.equal(f.w.drops.size, 0);
      assert.equal(f.staging.operations.size, 0); pearlMutationGate(f.host.profiles).assertWorldAvailable();
    } finally { await f.close(); }
  });
}

test('close waits for an in-flight mounted receipt, without applying, publishing, replaying or hiding incomplete progress', async () => {
  const entered = deferred(), reply = deferred(); let commits = 0;
  const f = await fixture({ wrap: (base) => ({ ...base, async commitPearlGround(raw) {
    commits++; const result = await base.commitPearlGround(raw); entered.resolve(); await reply.promise; return result;
  } }) });
  try {
    f.staging.swallow({ uid, source: f.source, expectedVersion: 1 }); await entered.promise;
    let settled = false; const closing = f.host.close().then(() => { settled = true; }, (error) => { settled = true; throw error; });
    const rejected = assert.rejects(closing, { code: 'flush' });
    await turn(); assert.equal(settled, false); assert.equal(f.host.closing, true); assert.equal(f.host.server.clients.size, 0);
    assert.equal(f.host.unsavedProfiles.size, 1); assert.equal(f.host.server.step(), false);
    assert.equal(f.host.status().storage.staging.pending, 1);
    reply.resolve(); await rejected;
    assert.equal(f.staging.tasks.size, 0); assert.equal(f.staging.operations.size, 1);
    assert.equal(f.p.pearls.swallowed, null); assert.equal(f.w.events.length, 0); assert.equal(output(f, 'pearlChanged').length, 0);
    assert.equal((await f.base.loadUnique(uid)).version, 2); assert.equal(commits, 1);
    assert.equal(f.host.server.step(), false); assert.equal(f.staging.completed.length, 1);
    assert.equal(f.host.healthy(), false); assert.equal(f.host.close(), f.host.closePromise);
  } finally { reply.resolve(); await f.close(); }
});

test('apply failure rolls back before socket detach, stops admission/timers and retains the committed SQL authority', async () => {
  const f = await fixture();
  try {
    const first = command(1); f.c.queue.push(first); f.c.carry = PEARL_ACTION_BITS;
    f.w.ecs.qBuf[f.entities[0]] = 0.2;
    f.staging.swallow({ uid, source: f.source, expectedVersion: 1 }); await f.staging.settle();
    const before = structuredClone(f.p.pearls), e = f.entities[0];
    // Fail after input filtering and profile writes, inside the same actual host apply callback.
    f.host.profiles.save = (id) => { f.host.profiles.fail(f.host.profiles.clients.get(id), 'unavailable'); };
    const closes = [];
    f.sockets[0].onClosing = () => closes.push({ pearls: structuredClone(f.p.pearls), first: f.c.queue[0],
      carry: f.c.carry, qBuf: f.w.ecs.qBuf[e], events: f.w.events.length });
    f.host.start(); assert.ok(f.host.timer);
    assert.equal(f.host.server.step(), false);
    assert.equal(f.host.closing, true); assert.equal(f.host.healthy(), false);
    assert.equal(f.sockets[0].readyState, 1, 'disconnect waits until beforeTick has unwound');
    assert.deepEqual(f.p.pearls, before); assert.equal(f.c.queue[0], first); assert.equal(f.c.carry, PEARL_ACTION_BITS);
    assert.equal(f.w.ecs.qBuf[e], 0.2); assert.equal(f.w.events.length, 0);
    await turn(); assert.equal(f.sockets[0].readyState, 3); assert.equal(closes.length, 1);
    assert.deepEqual(closes[0], { pearls: before, first, carry: PEARL_ACTION_BITS, qBuf: 0.2, events: 0 });
    assert.equal(f.host.server.clients.size, 0); assert.equal(f.host.timer._destroyed, true);
    await assert.rejects(f.host.close(), { code: 'flush' });
    assert.equal((await f.base.loadUnique(uid)).version, 2); assert.equal(output(f, 'pearlChanged').length, 0);
    assert.equal(f.host.status().storage.staging.failed, true); assert.equal(f.host.server.step(), false);
    const late = new Socket(); f.host.onConnection(late, { headers: {}, socket: { remoteAddress: 'late' } });
    assert.equal(late.readyState, 3); assert.equal(f.host.sockets.size, 0);
  } finally { await f.close(); }
});

test('unexpected drain exceptions stop the pump once and keep the rejected close observable', async () => {
  const f = await fixture();
  try {
    let calls = 0; f.staging.drain = () => { calls++; throw new Error('broken local container'); };
    f.host.start(); assert.equal(f.host.server.step(), false); assert.equal(f.host.errors, 1);
    const before = structuredClone(f.p), dirty = [...f.w.profileDirty];
    f.host.server.receive(1, { t: MSG.CMD, type: 'tut', i: 4 });
    assert.deepEqual(f.p, before); assert.deepEqual([...f.w.profileDirty], dirty);
    assert.equal(f.w.events.length, 0, 'direct LocalServer commands cannot mutate a stopped authority');
    await turn(); assert.equal(f.host.server.step(), false); assert.equal(calls, 1);
    assert.equal(f.host.healthy(), false); await assert.rejects(f.host.close(), { code: 'flush' });
    assert.equal(f.host.timer._destroyed, true);
  } finally { await f.close(); }
});

test('explicit mount rejects replacement, late admission, foreign scope and callback configuration without side effects', async (t) => {
  const cases = [
    ['missing scope', {}, () => {}], ['callback override', { scope, captureProfile() {} }, () => {}],
    ['invalid limit', { scope, limit: 0 }, () => {}], ['wrong world', { scope: 'foreign' }, () => {}],
    ['without identity verifier', { scope }, (h) => { h.resolvePlayer = null; }],
    ['connection exists', { scope }, (h) => { h.server.connect(1); }],
    ['prior connection closed', { scope }, async (h) => {
      await h.prepare();
      const ws = new Socket(); h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'prior' } }); ws.close();
    }],
    ['sim advanced', { scope }, (h) => { h.server.step(); }],
    ['existing beforeTick', { scope }, (h) => { h.server.beforeTick = () => true; }],
  ];
  for (const [name, config, setup] of cases) await t.test(name, async () => {
    const h = new GameHost({ seed: 42, bots: 0, worldId: scope, resolvePlayer: async () => accounts[0], log() {} });
    await setup(h); const hook = h.server.beforeTick;
    assert.throws(() => h.mountPearlStaging(config), StoreError); assert.equal(h.pearlStaging, null); assert.equal(h.server.beforeTick, hook);
    await h.close();
  });
  const h = new GameHost({ seed: 42, bots: 0, resolvePlayer: async () => accounts[0], log() {} });
  try {
    const config = { scope, limit: 7 }, staging = h.mountPearlStaging(config); config.scope = 'changed'; config.limit = 1;
    assert.equal(staging.scope, scope); assert.equal(staging.limit, 7); assert.equal(h.pearlStaging, staging);
    assert.throws(() => h.mountPearlStaging({ scope }), { code: 'configuration' });
    assert.throws(() => { h.pearlStaging = null; }, TypeError);
  } finally { await h.close(); }
});

test('default host leaves beforeTick and ordinary pearl commands unchanged', async () => {
  const f = await fixture({ mounted: false });
  try {
    assert.equal(f.host.pearlStaging, null); assert.equal(f.host.server.beforeTick, null);
    assert.equal(f.host.status().storage.staging, null);
    f.host.server.receive(1, { t: MSG.CMD, type: 'pearl', op: 'swallow', uid });
    assert.equal(f.p.pearls.swallowed.uid, uid, 'legacy in-memory helper remains immediate');
    assert.equal((await f.base.loadUnique(uid)).version, 1, 'no new durable dispatch');
    // Avoid persisting the intentionally old managed ledger through the ordinary account path.
    f.p.pearls = structuredClone((await f.base.loadProfile(accounts[0])).data.pearls);
  } finally { await f.close(); }
});

test('default createGameServer preserves signed guest saves and refuses mounting after attachment', async () => {
  const gs = createGameServer({ seed: 42, bots: 0, worldId: null, saveSecret: 'guest-mount-test-secret', log() {} });
  try {
    assert.equal(gs.game.pearlStaging, null); assert.equal(gs.game.server.beforeTick, null);
    // Even a verifier added by a trusted caller cannot make a post-attach mount valid.
    gs.game.resolvePlayer = async () => null;
    assert.throws(() => gs.game.mountPearlStaging({ scope }), { code: 'configuration' });
    const ws = new Socket(); gs.game.onConnection(ws, { headers: {}, socket: { remoteAddress: 'guest' } });
    ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Guest' })), false);
    await Promise.all([...gs.game.joins]);
    const c = gs.game.server.clients.get(1); assert.ok(c.entity); assert.equal(c.serverProfile, false);
    const p = gs.game.server.world.profiles.get(c.entity); p.gold = 73;
    assert.equal(gs.game.server.sendSave(1, c), true);
    const blob = ws.messages.findLast((m) => m.t === MSG.SAVE).blob;
    assert.equal(gs.game.server.saves.load(blob).gold, 73);
    assert.equal(gs.game.server.beforeTick, null); assert.equal(gs.game.pearlStaging, null);
  } finally { await gs.close(); }
});

test('createGameServer explicitly mounts before attach and reports only public staging counts', async () => {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, worldId: scope,
    resolvePlayer: async () => accounts[0], saveSecret: 'host-mount-test-secret', log() {}, pearlStaging: { scope } });
  try {
    assert.ok(gs.game.pearlStaging); assert.equal(typeof gs.game.server.beforeTick, 'function');
    assert.throws(() => gs.game.mountPearlStaging({ scope }), { code: 'configuration' });
    const port = await gs.listen(), health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json();
    assert.deepEqual(status.storage.staging, { enabled: true, failed: false, pending: 0, completed: 0, reserved: 0 });
    assert.equal(JSON.stringify(status).includes(accounts[0]), false);
  } finally { await gs.close(); }
});
