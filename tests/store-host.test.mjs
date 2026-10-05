// Host lifecycle tests use actual LocalServer messages and deterministic ticks. Only the socket and
// identity verifier are test doubles; no account identity is accepted from an unverified HELLO field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function profile(gold = 0) { const p = newProfile(); p.gold = gold; return p; }
class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close(code = 1000) { if (this.readyState !== 1) return; this.readyState = 3; this.code = code; this.emit('close'); }
  ping() {}
}
function client(host, extra = {}) {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  const hello = () => ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: `P${id}`, weapon: 0, ...extra })), false);
  return { id, ws, hello, of: (t) => ws.messages.filter((m) => m.t === t) };
}
function host(t, options = {}) {
  const h = new GameHost({ seed: 42, bots: 0, log: () => {}, ...options });
  t.after(async () => { try { await h.close(); } catch (e) { if (e.code !== 'flush') throw e; } });
  return h;
}
const joined = async (h) => { await Promise.all([...h.joins]); };

test('default signed saves restore and spoofed account fields never create stored profiles', async (t) => {
  const store = createMemoryStore(), saves = hmacSaves('test-secret');
  const h = host(t, { store, saves });
  const c = client(h, { playerId: A, profile: profile(999), save: saves.store(profile(55)) });
  c.hello();
  assert.equal(c.of(MSG.PROFILE)[0].p.gold, 55);
  h.server.step(); c.ws.close(); await h.close();
  assert.equal(await store.loadProfile(A), null);
});

test('trusted account profile loads before WELCOME and overrides an older signed save', async (t) => {
  const store = createMemoryStore(), load = deferred(), saves = hmacSaves('k');
  await store.saveProfile(A, profile(77), 0);
  const h = host(t, { store: { ...store, async loadProfile(id) { await load.promise; return store.loadProfile(id); } }, saves, resolvePlayer: async () => A });
  const c = client(h, { save: saves.store(profile(999)), playerId: B });
  c.hello(); await turn();
  assert.equal(c.of(MSG.WELCOME).length, 0);
  assert.equal(h.server.humans, 0);
  load.resolve(); await joined(h);
  assert.equal(c.of(MSG.WELCOME).length, 1);
  assert.equal(c.of(MSG.PROFILE)[0].p.gold, 77);
  assert.equal(c.of(MSG.PROFILE)[0].p.v, 1);
  h.server.step(); await h.profiles.flush();
  assert.equal(c.of(MSG.SAVE).length, 0, 'an account cannot export an anonymous HMAC clone');
});

test('null identity keeps signed anonymous saves; resolver errors fail closed without secrets', async (t) => {
  const saves = hmacSaves('k');
  const h = host(t, { saves, resolvePlayer: async () => null });
  const c = client(h, { save: saves.store(profile(12)) }); c.hello(); await joined(h);
  assert.equal(c.of(MSG.PROFILE)[0].p.gold, 12);
  h.server.step();
  assert.equal(c.of(MSG.SAVE).length, 1, 'anonymous signed-save behavior remains available');
  const logs = [];
  const bad = host(t, { log: (s) => logs.push(s), resolvePlayer: async () => { throw new Error('TOKEN-SECRET'); } });
  const b = client(bad); b.hello(); await joined(bad);
  assert.equal(bad.server.humans, 0);
  assert.equal(b.of(MSG.ERROR).length, 1);
  assert.ok(!JSON.stringify([...logs, ...b.ws.messages]).includes('TOKEN-SECRET'));
  assert.equal(bad.pendingJoins, 0);
});

test('identity verifier gets request context without retained credential headers', async (t) => {
  let context;
  const h = host(t, { resolvePlayer: async (req) => { context = req; return A; } });
  const ws = new Socket();
  h.onConnection(ws, { headers: { origin: 'https://game.test', authorization: 'Bearer secret', cookie: 'secret-cookie' }, socket: { remoteAddress: '127.0.0.1' } });
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION })), false);
  await joined(h);
  assert.deepEqual(context, { headers: { origin: 'https://game.test' }, socket: { remoteAddress: '127.0.0.1' } });
  assert.ok(!JSON.stringify(context).includes('secret'));
});

test('duplicate HELLO and pending admission respect capacity, then release it on close', async (t) => {
  const gate = deferred(); let calls = 0;
  const h = host(t, { maxPlayers: 1, resolvePlayer: async () => { calls++; return gate.promise; } });
  const a = client(h), b = client(h);
  a.hello(); a.hello(); b.hello(); await turn();
  assert.equal(calls, 1); assert.equal(b.of(MSG.FULL).length, 1);
  a.ws.close(); await joined(h);
  assert.equal(h.pendingJoins, 0);
  gate.resolve(A); await turn();
  assert.equal(h.server.humans, 0, 'a closed pending socket cannot spawn');
  b.hello(); await joined(h);
  assert.equal(h.server.humans, 1);
});

test('same account has one authority and remains reserved through its final write', async (t) => {
  const store = createMemoryStore(), gate = deferred(); let writing = false;
  const slow = { ...store, async saveProfile(...args) { writing = true; await gate.promise; return store.saveProfile(...args); } };
  const h = host(t, { store: slow, resolvePlayer: async () => A });
  const a = client(h), b = client(h);
  a.hello(); b.hello(); await joined(h);
  assert.equal(h.server.humans, 1);
  assert.equal(b.of(MSG.ERROR)[0].code, 'session');
  a.ws.close(); await turn(); assert.equal(writing, true);
  b.hello(); await joined(h);
  assert.equal(b.of(MSG.WELCOME).length, 0, 'no load of stale state during final save');
  gate.resolve(); await h.profiles.flush(); await turn();
  b.hello(); await joined(h);
  assert.equal(b.of(MSG.WELCOME).length, 1);
});

test('close cancels an unresolved load and shutdown does not wait for a stuck resolver', async (t) => {
  const load = deferred(), store = createMemoryStore();
  const h = host(t, { store: { ...store, async loadProfile() { return load.promise; } }, resolvePlayer: async () => A });
  const a = client(h); a.hello(); await turn();
  a.ws.close(); await joined(h); await h.close();
  load.resolve({ data: profile(80), version: 1 }); await turn();
  assert.equal(h.server.humans, 0); assert.equal(h.profiles.accounts.size, 0);
  const stuck = host(t, { resolvePlayer: () => new Promise(() => {}) });
  const b = client(stuck); b.hello(); await turn();
  await stuck.close(); assert.equal(stuck.pendingJoins, 0);
});

test('write snapshots are isolated and serialized; shutdown awaits the final ECS/profile state', async (t) => {
  const store = createMemoryStore(), first = deferred(), writes = []; let inFlight = 0, maxFlight = 0;
  const slow = { ...store, async saveProfile(id, data, expected) {
    maxFlight = Math.max(maxFlight, ++inFlight); writes.push({ gold: data.gold, xp: data.xp, expected });
    if (writes.length === 1) await first.promise;
    try { return await store.saveProfile(id, data, expected); } finally { inFlight--; }
  } };
  const h = host(t, { store: slow, resolvePlayer: async () => A });
  const a = client(h); a.hello(); await joined(h);
  const c = h.server.clients.get(a.id), p = h.server.world.profiles.get(c.entity);
  p.gold = 10; h.server.sendSave(a.id, c); await turn();
  p.gold = 20; h.server.sendSave(a.id, c);
  p.gold = 30; h.server.world.ecs.xp[c.entity] = 14.5;
  let closed = false; const closing = h.close().then(() => { closed = true; });
  await turn(); assert.equal(closed, false);
  assert.deepEqual(writes, [{ gold: 10, xp: 0, expected: 0 }]);
  first.resolve(); await closing;
  assert.equal(maxFlight, 1);
  assert.deepEqual(writes[1], { gold: 30, xp: 14.5, expected: 1 });
  const saved = await store.loadProfile(A);
  assert.equal(saved.data.gold, 30); assert.equal(saved.data.xp, 14.5); assert.equal(saved.version, 2);
});

test('CAS conflict fences the session and reports failed shutdown without overwriting newer state', async (t) => {
  const store = createMemoryStore(); await store.saveProfile(A, profile(5), 0);
  const h = host(t, { store, resolvePlayer: async () => A });
  const a = client(h); a.hello(); await joined(h);
  await store.saveProfile(A, profile(99), 1); // A different writer won after this host loaded version 1.
  const c = h.server.clients.get(a.id);
  h.server.world.profiles.get(c.entity).gold = 12;
  h.server.sendSave(a.id, c);
  await assert.rejects(h.profiles.flush(), { code: 'flush' });
  assert.equal(a.ws.code, 1011); assert.equal(h.server.humans, 0);
  assert.equal((await store.loadProfile(A)).data.gold, 99);
  await assert.rejects(h.close(), { code: 'flush' });
});

test('join timeout releases capacity and unavailable stores never admit an empty replacement', async (t) => {
  const h = host(t, { maxPlayers: 1, joinTimeoutMs: 10, resolvePlayer: () => new Promise(() => {}) });
  const a = client(h); a.hello(); await joined(h);
  assert.equal(h.pendingJoins, 0); assert.equal(h.server.humans, 0); assert.equal(a.of(MSG.ERROR).length, 1);
  const broken = host(t, { store: { ...createMemoryStore(), async loadProfile() { throw new Error('db unavailable'); } }, resolvePlayer: async () => A });
  const b = client(broken); b.hello(); await joined(broken);
  assert.equal(broken.server.humans, 0); assert.equal(b.of(MSG.PROFILE).length, 0); assert.equal(broken.profiles.accounts.size, 0);
});

test('real WebSocket account path saves on shutdown and loads across two host instances', { timeout: 15000 }, async (t) => {
  const store = createMemoryStore(), servers = [];
  t.after(async () => { for (const gs of servers) await gs.close(); });
  const boot = async () => {
    const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: true, log: () => {}, saveSecret: 'k', store, resolvePlayer: async () => A });
    servers.push(gs); const port = await gs.listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [];
    ws.onmessage = (ev) => messages.push(JSON.parse(ev.data));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Ana' }));
    const wait = async (predicate) => {
      const deadline = performance.now() + 3000;
      while (performance.now() < deadline) {
        const found = messages.find(predicate); if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail('protocol message timed out');
    };
    return { gs, ws, wait };
  };
  const one = await boot();
  await one.wait((m) => m.t === MSG.PROFILE);
  one.ws.send(JSON.stringify({ t: MSG.CMD, type: 'dev', op: 'gold', n: 67 }));
  await one.wait((m) => m.t === MSG.PROFILE && m.p.gold === 67);
  await one.gs.close();
  assert.equal((await store.loadProfile(A)).data.gold, 67);
  const two = await boot();
  assert.equal((await two.wait((m) => m.t === MSG.PROFILE)).p.gold, 67);
  await two.gs.close();
});
