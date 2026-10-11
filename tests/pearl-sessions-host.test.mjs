import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UID = 'join-pearl';
function profileWithPearl(kind = 'brasa') {
  const p = newProfile();
  p.pearls.bag = [{ uid: UID, kind }];
  return p;
}

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close(code = 1000) { if (this.readyState !== 1) return; this.readyState = 3; this.code = code; this.emit('close'); }
  ping() {}
}

function host(t, options = {}) {
  const h = new GameHost({ seed: 42, bots: 0, log: () => {}, ...options });
  t.after(async () => { try { await h.close(); } catch (error) { if (error.code !== 'flush') throw error; } });
  return h;
}

function client(h) {
  const ws = new Socket();
  h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = h.nextId - 1;
  return {
    id, ws,
    hello() { ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'PearlHolder' })), false); },
    of(type) { return ws.messages.filter((message) => message.t === type); },
  };
}

const joined = async (h) => { await Promise.all([...h.joins]); };

test('managed ownership mismatch blocks WELCOME and removes the pending session', async (t) => {
  const base = createMemoryStore();
  await base.saveProfile(A, profileWithPearl(), 0);
  const store = { ...base, async loadUnique() { return { kind: 'pearl:brasa', holder: B, version: 1 }; } };
  const h = host(t, { store, resolvePlayer: async () => A });
  const c = client(h); c.hello(); await joined(h);
  assert.equal(c.of(MSG.WELCOME).length, 0);
  assert.equal(c.of(MSG.PROFILE).length, 0);
  assert.equal(c.of(MSG.ERROR).length, 1);
  assert.equal(c.of(MSG.ERROR)[0].code, 'storage');
  assert.equal(h.server.humans, 0);
  assert.equal(h.profiles.accounts.size, 0);
});

test('ledger read failure blocks WELCOME without admitting an empty fallback', async (t) => {
  const base = createMemoryStore();
  await base.saveProfile(A, profileWithPearl(), 0);
  const store = { ...base, async loadUnique() { throw new StoreError('unavailable'); } };
  const h = host(t, { store, resolvePlayer: async () => A });
  const c = client(h); c.hello(); await joined(h);
  assert.equal(c.of(MSG.WELCOME).length, 0);
  assert.equal(c.of(MSG.PROFILE).length, 0);
  assert.equal(c.of(MSG.ERROR).length, 1);
  assert.equal(c.of(MSG.ERROR)[0].code, 'storage');
  assert.equal(h.server.humans, 0);
  assert.equal(h.pendingJoins, 0);
  assert.equal(h.profiles.accounts.size, 0);
});

test('a pearl absent from the ledger remains explicitly unadopted and does not block WELCOME', async (t) => {
  const store = createMemoryStore();
  await store.saveProfile(A, profileWithPearl(), 0);
  const h = host(t, { store, resolvePlayer: async () => A });
  const c = client(h); c.hello(); await joined(h);
  assert.equal(c.of(MSG.WELCOME).length, 1);
  assert.ok(c.of(MSG.PROFILE).length >= 1);
  assert.ok(c.of(MSG.PROFILE).some((message) => message.p.pearls.bag.some((item) => item.uid === UID && item.kind === 'brasa')));
  assert.equal(await store.loadUnique(UID), null);
  assert.equal(h.server.humans, 1);
});
