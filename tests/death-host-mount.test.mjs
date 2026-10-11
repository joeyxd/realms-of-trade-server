import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION, sanitizeCmd } from '../src/net/protocol.js';
import { DT, tuning } from '../src/data/tuning.js';
import { C } from '../src/sim/ecs.js';
import { database as sql } from './helpers/death-journal-sql.mjs';
import { makeDeath, planRequest, seedDeathStore, VICTIM, KILLER, WORLD as scope } from './helpers/death-storage.mjs';

const turn = () => new Promise((r) => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const command = (seq) => sanitizeCmd({ seq, pt: seq, mx: 1, mz: 1, ax: 10, az: 10, btn: 0x3ff, prs: 0x3ff, w: 1 });
class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { if (this.readyState !== 1) return; this.onClosing?.(); this.readyState = 3; this.emit('close'); }
  ping() {}
}
async function fixture({ backend, wrap = (s) => s, lawless = false, journal = false, pearlCount = 2 } = {}) {
  const db = backend ? await backend() : { store: createMemoryStore(), close: async () => {} };
  const f = makeDeath({ lawless, killer: true, loot: true, pearlCount }), { request } = planRequest(f);
  await seedDeathStore(db.store, f, request);
  if (!request.killer) { const p = newProfile(); p.pirateId = 'account:' + KILLER; await db.store.saveProfile(KILLER, p, 0); }
  const j = journal ? createMemoryPearlJournals(db.store)(scope) : null;
  const h = new GameHost({ seed: 42, bots: 0, store: wrap(db.store), resolvePlayer: async (_req, msg) => msg.token === 'v' ? VICTIM : KILLER,
    ...(j ? { worldId: scope, pearlJournal: j } : {}), log() {} });
  h.mountPearlStaging({ scope }); h.mountDeathStaging({ scope });
  if (j) h.mountPearlStartup({ accountPolicy: 'accounts-only', mapClock: (g) => ({ availableAt: g.availableAt, returnAt: g.returnAt }) });
  await h.prepare();
  const sockets = [];
  for (const token of ['v','k']) {
    const ws = new Socket(); sockets.push(ws);
    h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'death-test' } });
    ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
    await Promise.all([...h.joins]);
  }
  const w = h.server.world, c = h.server.clients.get(1), e = c.entity, k = h.server.clients.get(2).entity;
  assert.ok(e && k);
  const point = lawless ? w.map.cala : w.map.landmarks.arena;
  w.ecs.x[e] = point.x; w.ecs.z[e] = point.z; w.ecs.x[k] = point.x + 8; w.ecs.z[k] = point.z;
  for (let id = 1; id < w.ecs.cap; id++) if (w.ecs.mask[id] & C.ENEMY) { w.ecs.alive[id] = 0; w.ecs.mask[id] = 0; }
  w.events.length = 0; w.profileDirty.clear(); sockets.forEach((ws) => { ws.messages.length = 0; });
  return { db, h, w, c, e, k, sockets, p: w.profiles.get(e), j,
    request: () => h.requestDeath({ victim: { clientId: 1, entity: e }, killer: { clientId: 2, entity: k }, seq: 9 }),
    async close() { await h.deathStaging.settle(); await h.close().catch(() => {}); await db.close(); } };
}
const snapshot = (f) => structuredClone({ tick: f.w.tick, ecs: Object.fromEntries(Object.entries(f.w.ecs).map(([key,v]) =>
  [key, ArrayBuffer.isView(v) ? Array.from(v) : v])), profiles: [...f.w.profiles], drops: [...f.w.drops], ledger: [...f.w.pearlLedger],
  events: f.w.events, dirty: [...f.w.profileDirty], nextDrop: f.w.nextDrop, rng: f.w.lootRng.state() });
const events = (f, type) => f.sockets[0].messages.filter((m) => m.t === MSG.EVENT && m.ev.type === type);

for (const [name, backend] of [['memory',undefined],['SDK/SQL010 local',sql]]) test(name + ': real host holds complete ticks, applies once and respawns with durable loss', async () => {
  const entered = deferred(), reply = deferred(); let raw, commits = 0;
  const f = await fixture({ backend, lawless: true, wrap: (s) => ({ ...s, async commitDeath(r) {
    commits++; raw = structuredClone(r); const result = await s.commitDeath(r); entered.resolve(); await reply.promise; return result;
  } }) });
  try {
    const s = f.h.server;
    f.c.queue.push(command(1), command(2)); f.c.last = command(0); f.c.carry = 0x3ff;
    for (const key of ['atkBuf','rBuf','qBuf','eBuf','gBuf']) f.w.ecs[key][f.e] = 0.1;
    const before = snapshot(f), input = structuredClone({ queue: f.c.queue, last: f.c.last, carry: f.c.carry });
    const handle = f.request(); await entered.promise;
    assert.equal(f.w.ecs.dead[f.e], 0); assert.equal(s.step(), false); assert.equal(s.step(), false);
    assert.deepEqual(snapshot(f), before); assert.equal(f.c.ack, 0);
    assert.deepEqual({ queue: f.c.queue, last: f.c.last, carry: f.c.carry }, input);
    assert.equal(events(f,'death').length, 0); assert.equal(f.h.status().storage.deathStaging.pending, 1);
    assert.equal(f.sockets[0].messages.filter((m) => m.t === MSG.PROFILE || m.t === MSG.SAVE).length, 0);
    s.pump(1000); assert.deepEqual(snapshot(f), before);
    reply.resolve(); await f.h.deathStaging.settle();
    assert.equal(f.w.ecs.dead[f.e], 0, 'async receipt does not apply');
    s.pausable = true; for (const c of s.clients.values()) c.paused = true; s.pump();
    assert.equal(f.w.tick, before.tick); assert.equal(f.c.ack, 0); assert.equal(f.w.ecs.dead[f.e], 1);
    assert.equal(f.h.deathStaging.operations.has(handle.operationId), false);
    assert.equal(f.p.xp, 72); assert.equal(f.p.gold, 73); assert.deepEqual(f.p.mast[0], [3,123]);
    assert.deepEqual(f.p.pearls, { bag: [], swallowed: null }); assert.equal(f.p.bag.length, 0);
    assert.equal(f.p.pot, 0); assert.equal(f.p.stats.deaths, 1); assert.equal(f.w.profiles.get(f.k).stats.pk, 1);
    for (const cmd of [...f.c.queue, f.c.last]) assert.deepEqual([cmd.mx,cmd.mz,cmd.btn,cmd.prs,cmd.w], [0,0,0,0,0]);
    assert.deepEqual(f.c.queue.map((c) => [c.seq,c.pt]), [[1,1],[2,2]]); assert.equal(f.c.carry, 0);
    assert.equal(events(f,'death').length, 0, 'paused boundary applies but does not publish');
    for (const p of raw.profiles) assert.deepEqual((await f.db.store.loadProfile(p.id)).data, p.data);
    for (const p of raw.pearls) assert.equal((await f.db.store.loadUnique(p.uid)).holder, null);
    const drops = [...f.w.drops.values()].filter((d) => d.kind !== 'pearl');
    assert.equal(drops.length, raw.drops.length); assert.equal(new Set(drops.map((d) => d.operationId + ':' + d.ordinal)).size, drops.length);
    for (const c of s.clients.values()) c.paused = false;
    assert.equal(s.step(), true); assert.equal(f.c.ack, 1); assert.equal(events(f,'death').length, 1);
    assert.equal(s.step(), true); assert.equal(f.c.ack, 2);
    for (let i = 0; i < Math.ceil(tuning.combat.respawnTime / DT) + 2; i++) {
      f.c.queue.push(sanitizeCmd({ seq: i + 3, pt: f.w.tick + 1, mx: 0, mz: 0, ax: 10, az: 10, btn: 0, prs: 0 })); s.step();
    }
    assert.equal(f.w.ecs.dead[f.e], 0); assert.equal(events(f,'respawn').filter((m) => m.ev.id === f.e).length, 1);
    assert.equal(events(f,'death').length, 1); assert.equal(events(f,'swing').length, 0); assert.equal(events(f,'cast').length, 0);
    for (const key of ['atkBuf','rBuf','qBuf','eBuf','gBuf']) assert.equal(f.w.ecs[key][f.e], 0);
    assert.equal(f.p.stats.deaths, 1); assert.equal(f.p.xp, 72); assert.equal(commits, 1);
    assert.deepEqual(f.h.status().storage.deathStaging, { enabled: true, failed: false, pending: 0, completed: 0, reserved: 0 });
  } finally { reply.resolve(); await f.close(); }
});

test('shared recovered memory journal commits exterior death with zero pearls and no killer credit', async () => {
  const f = await fixture({ journal: true, pearlCount: 0 });
  try {
    f.request(); await f.h.deathStaging.settle(); assert.deepEqual(await f.j.list(), []);
    assert.equal(f.h.server.step(), true); assert.equal(f.p.stats.deaths, 1); assert.equal(f.w.profiles.get(f.k).stats.pk, 0);
    assert.equal(f.p.eq.head.b, (await f.db.store.loadProfile(VICTIM)).data.eq.head.b);
    assert.equal(f.p.bag.length, 0); assert.equal(f.h.healthy(), true);
  } finally { await f.close(); }
});

test('close waits for whole-death receipt, never applies or hides incomplete shutdown', async () => {
  const entered = deferred(), reply = deferred();
  const f = await fixture({ wrap: (s) => ({ ...s, async commitDeath(r) { const v = await s.commitDeath(r); entered.resolve(); await reply.promise; return v; } }) });
  try {
    f.request(); await entered.promise; let done = false;
    const closing = f.h.close().finally(() => { done = true; }); const rejected = assert.rejects(closing, { code: 'flush' });
    await turn(); assert.equal(done, false); assert.equal(f.w.ecs.dead[f.e], 0); assert.equal(f.h.server.step(), false);
    assert.ok(f.h.unsavedProfiles.size); reply.resolve(); await rejected;
    assert.equal(f.h.deathStaging.tasks.size, 0); assert.equal(f.h.deathStaging.operations.size, 1);
    assert.equal(f.p.stats.deaths, 0); assert.equal(events(f,'death').length, 0);
    assert.equal((await f.db.store.loadProfile(VICTIM)).data.stats.deaths, 1); assert.equal(f.h.healthy(), false);
  } finally { reply.resolve(); await f.close(); }
});

test('input apply fault rolls back death and inputs before deferred socket teardown, preserving receipt', async () => {
  const f = await fixture();
  try {
    const s = f.h.server, first = command(1); f.c.queue.push(first); f.c.carry = 0x3ff;
    const before = snapshot(f); f.request(); await f.h.deathStaging.settle();
    const prepare = s.prepareDeathInputs.bind(s);
    s.prepareDeathInputs = (...args) => { const effect = prepare(...args); return { ...effect, apply() {
      effect.apply(); f.h.profiles.fail(f.h.profiles.clients.get(1), 'unavailable'); throw Error('after input apply');
    } }; };
    let closedState;
    f.sockets[0].onClosing = () => { closedState = { dead: f.w.ecs.dead[f.e], pearl: structuredClone(f.p.pearls), first: f.c.queue[0], carry: f.c.carry }; };
    f.h.start(); assert.equal(s.step(), false); assert.equal(f.h.closing, true);
    assert.equal(f.sockets[0].readyState, 1); assert.deepEqual(snapshot(f), before);
    assert.equal(f.c.queue[0], first); assert.equal(f.c.carry, 0x3ff);
    await turn(); assert.deepEqual(closedState, { dead: 0, pearl: before.profiles.find(([e]) => e === f.e)[1].pearls, first, carry: 0x3ff });
    assert.equal(f.h.timer._destroyed, true); await assert.rejects(f.h.close(), { code: 'flush' });
    assert.equal((await f.db.store.loadProfile(VICTIM)).data.stats.deaths, 1); assert.equal(events(f,'death').length, 0);
  } finally { await f.close(); }
});

test('trusted requests reject tick reentry, wire commands, guest binding and extra/accessor metadata', async () => {
  const f = await fixture();
  try {
    const s = f.h.server, step = f.w.stepWorld.bind(f.w); let attempts = 0;
    f.w.stepWorld = () => { attempts++; assert.throws(f.request, { code: 'busy' }); step(); };
    assert.equal(s.step(), true); assert.equal(attempts, 1); assert.equal(f.h.deathStaging.operations.size, 0);
    assert.equal(f.w.ecs.dead[f.e], 0);
    s.receive(1, { t: MSG.CMD, type: 'death', seq: 5, victim: f.e }); assert.equal(f.w.ecs.dead[f.e], 0);
    f.c.serverProfile = false; assert.throws(f.request, { code: 'session' }); f.c.serverProfile = true;
    assert.throws(() => f.h.requestDeath({ victim: { clientId: 1, entity: f.e }, seq: 5, rules: {} }), { code: 'operation' });
    let gets = 0; assert.throws(() => f.h.requestDeath({ get victim() { gets++; return {}; }, seq: 5 }), StoreError); assert.equal(gets, 0);
    assert.throws(() => s.prepareDeathInputs(1, f.e), TypeError); assert.equal(f.h.healthy(), true);
  } finally { await f.close(); }
});

test('death mount requires empty authenticated bot-free authority and matching pearl scope; defaults stay unmounted', async (t) => {
  for (const [name, options, setup, mount] of [
    ['missing pearl mount', {}, () => {}, false], ['foreign scope', { scope: 'foreign' }, () => {}, true],
    ['bad limit', { limit: 0 }, () => {}, true], ['extra callback', { prepareInputs() {} }, () => {}, true],
    ['replaced boundary', {}, (h) => { h.server.beforeTick = () => true; }, true],
    ['live connection', {}, (h) => h.server.connect(1), true], ['advanced tick', {}, (h) => h.server.step(), true],
    ['bot present', {}, (h) => h.server.world.spawnPlayer({ x: 0, z: 0, bot: true }), true],
  ]) await t.test(name, async () => {
    const h = new GameHost({ seed: 42, bots: 0, resolvePlayer: async () => VICTIM, log() {} });
    try {
      assert.equal(h.deathStaging, null); assert.equal(h.status().storage.deathStaging, null);
      if (mount) h.mountPearlStaging({ scope }); setup(h);
      assert.throws(() => h.mountDeathStaging({ scope, ...options }), StoreError); assert.equal(h.deathStaging, null);
    } finally { await h.close(); }
  });
  const h = new GameHost({ seed: 42, bots: 0, resolvePlayer: async () => VICTIM, log() {} });
  try { h.mountPearlStaging({ scope }); const d = h.mountDeathStaging({ scope }); assert.equal(h.deathStaging,d);
    assert.throws(() => h.mountDeathStaging({ scope }), StoreError); assert.throws(() => { h.deathStaging = null; }, TypeError);
  } finally { await h.close(); }
});

for (const fault of ['async adapter','accessor method','caught staging reentry']) test('invalid death input adapter fences: ' + fault, async () => {
  const f = await fixture();
  try {
    const before = snapshot(f); f.request(); await f.h.deathStaging.settle(); let getters = 0;
    f.h.server.prepareDeathInputs = () => {
      if (fault === 'async adapter') return Promise.reject(Error('async preparation'));
      if (fault === 'caught staging reentry') {
        try { f.h.deathStaging.request({ victim: { clientId: 1, entity: f.e }, seq: 1 }); } catch {}
        return { assertCurrent() {}, apply() {}, assertApplied() {}, rollback() {} };
      }
      return { get apply() { getters++; return () => {}; }, assertCurrent() {}, assertApplied() {}, rollback() {} };
    };
    assert.equal(f.h.server.step(), false); assert.deepEqual(snapshot(f), before); assert.equal(getters, 0);
    assert.equal(f.h.status().storage.deathStaging.failed, true); await turn();
    await assert.rejects(f.h.close(), { code: 'flush' });
  } finally { await f.close(); }
});
