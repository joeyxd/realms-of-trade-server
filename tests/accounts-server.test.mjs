import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { accountAuthFromEnv, createAccountResolver, publicAuthConfig } from '../server/auth.mjs';
import { createGameServer } from '../server/index.mjs';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { legacyKey } from '../server/legacy.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const turn = () => new Promise((r) => setImmediate(r));
const signed = hmacSaves('test-secret');
function profile(gold = 40, pirateId = 'old-world:p12') {
  return { ...newProfile(), gold, pirateId };
}
class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit('close'); }
}
function client(h, extra = {}) {
  const ws = new Socket();
  h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const hello = () => ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P', ...extra })), false);
  return { ws, hello, of: (t) => ws.messages.filter((m) => m.t === t) };
}
const resolver = createAccountResolver({ auth: { async getUser(token) {
  if (token === 'account-a') return { data: { user: { id: A } } };
  if (token === 'account-b') return { data: { user: { id: B } } };
  throw new Error('PRIVATE-TOKEN-DETAIL');
} } });
function host(t, opts = {}) {
  const h = new GameHost({ seed: 42, bots: 0, log: () => {}, saves: signed, store: createMemoryStore(), resolvePlayer: resolver, initializeAccounts: true, ...opts });
  t.after(async () => { await h.close(); }); return h;
}
async function join(h, c) { c.hello(); await Promise.all([...h.joins]); }

test('public Auth config accepts publishable/anon keys and rejects private or partial configuration', () => {
  assert.deepEqual(accountAuthFromEnv({}), { publicConfig: { enabled: false }, resolvePlayer: null });
  assert.deepEqual(publicAuthConfig(), { enabled: false });
  const jwt = (role) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.signature';
  assert.equal(publicAuthConfig({ enabled: true, url: 'https://p.supabase.co', publicKey: jwt('anon') }).enabled, true);
  for (const key of ['sb_secret_PRIVATE', jwt('service_role'), '', 'random-key']) {
    assert.throws(() => publicAuthConfig({ enabled: true, url: 'https://p.supabase.co', publicKey: key }), { code: 'configuration' });
  }
  assert.throws(() => accountAuthFromEnv({ SUPABASE_PUBLIC_KEY: 'sb_publishable_test' }), { code: 'configuration' });
  let parameters;
  const auth = accountAuthFromEnv({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_PUBLIC_KEY: 'sb_publishable_test', SUPABASE_SERVICE_KEY: 'PRIVATE' }, (...args) => {
    parameters = args; return { auth: { getUser() {} } };
  });
  assert.equal(auth.publicConfig.enabled, true);
  assert.equal(parameters[1], 'sb_publishable_test');
  assert.deepEqual(parameters[2].auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  assert.ok(!JSON.stringify(auth.publicConfig).includes('PRIVATE'));
});

test('verifier uses SDK getUser HTTP response, rejects supplied invalid tokens, and never decodes client identity', async () => {
  const requests = [];
  const sdk = createClient('http://auth.test', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      requests.push({ url: String(input), method: init.method, headers: new Headers(init.headers) });
      return new Response(JSON.stringify({ id: A, email: 'test@example.test', is_anonymous: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  const verify = createAccountResolver(sdk);
  assert.equal(await verify({}, { token: 'opaque-access-token', playerId: B }), A);
  assert.equal(requests[0].url, 'http://auth.test/auth/v1/user');
  assert.equal(requests[0].headers.get('authorization'), 'Bearer opaque-access-token');
  assert.equal(requests[0].headers.get('apikey'), 'sb_publishable_test');
  assert.equal(await verify({}, { playerId: A }), null);
  for (const token of ['', null, {}, 'bad token', 'x'.repeat(8193)]) await assert.rejects(verify({}, { token }), { code: 'auth' });
  assert.equal(requests.length, 1);
  const bad = createAccountResolver({ auth: { getUser: async () => ({ data: { user: { id: A, is_anonymous: true } } }) } });
  await assert.rejects(bad({}, { token: 'anonymous' }), { code: 'auth' });
});

test('accounts persist before WELCOME; invalid token cannot fall back to a valid signed save', async (t) => {
  const logs = [], h = host(t, { log: (s) => logs.push(s) });
  const bad = client(h, { token: 'bad-token', save: signed.store(profile(999)), playerId: A });
  await join(h, bad);
  assert.equal(bad.of(MSG.ERROR)[0].code, 'auth');
  assert.equal(bad.of(MSG.WELCOME).length, 0);
  assert.ok(!JSON.stringify([...logs, ...bad.ws.messages]).includes('PRIVATE-TOKEN-DETAIL'));
  const a = client(h, { token: 'account-a', playerId: B }); await join(h, a);
  assert.equal(a.of(MSG.WELCOME).length, 1);
  const row = await h.store.loadProfile(A);
  assert.equal(row.version, 1);
  assert.equal(row.data.pirateId, `account:${A}`);
  assert.equal(await h.store.loadProfile(B), null);
  assert.equal(a.of(MSG.SAVE).length, 0);
});

test('one-time import consumes all signed versions of the pirate and retires guest restoration', async (t) => {
  const store = createMemoryStore(), h = host(t, { store });
  const old = profile(55), blob = signed.store(old);
  const a = client(h, { token: 'account-a', importSave: true, save: blob }); await join(h, a);
  assert.equal(a.of(MSG.PROFILE)[0].p.gold, 55);
  assert.equal((await store.loadProfile(A)).data.pirateId, `account:${A}`);
  a.ws.close(); await h.profiles.flush();
  const b = client(h, { token: 'account-b', importSave: true, save: signed.store({ ...old, gold: 70 }) }); await join(h, b);
  assert.equal(b.of(MSG.ERROR)[0].code, 'legacy_used');
  assert.equal(await store.loadProfile(B), null);
  const guest = client(h, { save: blob }); await join(h, guest);
  assert.equal(guest.of(MSG.ERROR)[0].code, 'legacy_used');
  assert.equal(guest.of(MSG.WELCOME).length, 0);
  assert.equal(h.legacyReservations.size, 0);
  assert.equal(await store.legacyClaimed(legacyKey(old)), true);
});

test('existing account wins; malformed/id-less/tampered imports fail without creating a new profile', async (t) => {
  const store = createMemoryStore(), h = host(t, { store });
  await store.saveProfile(A, profile(88, `account:${A}`), 0);
  const a = client(h, { token: 'account-a', importSave: true, save: 'tampered' }); await join(h, a);
  assert.equal(a.of(MSG.PROFILE)[0].p.gold, 88);
  for (const save of ['tampered', signed.store(profile(999, '')), 'x'.repeat(32769)]) {
    const b = client(h, { token: 'account-b', importSave: true, save }); await join(h, b);
    assert.equal(b.of(MSG.ERROR)[0].code, 'legacy');
    assert.equal(await store.loadProfile(B), null); b.ws.close();
  }
});

test('guest/import races reserve legacy identity before await, releasing failed and closed joins', async (t) => {
  const store = createMemoryStore();
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = host(t, { store: { ...store, async legacyClaimed(key) { await gate; return store.legacyClaimed(key); } } });
  const blob = signed.store(profile(77));
  const guest = client(h, { save: blob }); guest.hello(); await turn();
  const a = client(h, { token: 'account-a', importSave: true, save: blob });
  a.hello(); await turn();
  assert.equal(a.of(MSG.ERROR)[0].code, 'legacy_active');
  assert.equal(await store.loadProfile(A), null);
  guest.ws.close();
  assert.equal(h.legacyReservations.size, 1, 'pending DB result retains the reservation after socket close');
  release(); await Promise.all([...h.joins]); await turn();
  assert.equal(h.legacyReservations.size, 0);
  await join(h, a);
  assert.equal(a.of(MSG.WELCOME).length, 1);
});

test('real HTTP public config/SDK and WebSocket account admission expose no service credentials', async (t) => {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log: () => {}, saveSecret: 'test-secret', store: createMemoryStore(), resolvePlayer: resolver, initializeAccounts: true,
    publicAuth: { enabled: true, url: 'http://auth.test', publicKey: 'sb_publishable_test' } });
  const port = await gs.listen(); t.after(() => gs.close());
  const config = await fetch(`http://127.0.0.1:${port}/auth/config`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await config.json(), { enabled: true, url: 'http://auth.test', publicKey: 'sb_publishable_test' });
  const sdk = await fetch(`http://127.0.0.1:${port}/auth/sdk.js`);
  assert.equal(sdk.status, 200); assert.ok((await sdk.text()).includes('createClient'));
  assert.equal((await fetch(`http://127.0.0.1:${port}/node_modules/@supabase/supabase-js/dist/index.mjs`)).status, 404);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  t.after(() => ws.close());
  const welcome = new Promise((resolve, reject) => {
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.t === MSG.WELCOME) resolve(m); if (m.t === MSG.ERROR) reject(new Error(m.code)); };
  });
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Account', token: 'account-a' }));
  await welcome;
  assert.ok((await gs.game.store.loadProfile(A)).version >= 1);
});

test('timed-out guest DB checks cannot retain a reservation or spawn later', async (t) => {
  const store = createMemoryStore(); let release;
  const gate = new Promise((r) => { release = r; });
  const h = host(t, { joinTimeoutMs: 20, store: { ...store, async legacyClaimed(key) { await gate; return store.legacyClaimed(key); } } });
  const c = client(h, { save: signed.store(profile()) });
  await join(h, c);
  assert.equal(c.of(MSG.ERROR)[0].code, 'storage');
  assert.equal(h.legacyReservations.size, 1, 'pending check stays fenced until it ends');
  release(); await turn();
  assert.equal(h.legacyReservations.size, 0);
  assert.equal(c.of(MSG.WELCOME).length, 0);
  await join(h, c);
  assert.equal(c.of(MSG.WELCOME).length, 1);
});

test('a malformed initialization response does not admit an unpersisted default', async (t) => {
  const h = host(t, { store: { ...createMemoryStore(), async initializeProfile() { return null; } } });
  const c = client(h, { token: 'account-a' }); await join(h, c);
  assert.equal(c.of(MSG.ERROR)[0].code, 'storage');
  assert.equal(c.of(MSG.WELCOME).length, 0);
});
