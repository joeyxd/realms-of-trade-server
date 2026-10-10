import test from 'node:test';
import assert from 'node:assert/strict';
import { CompanionsClient } from '../src/client/companions.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = (overrides = {}) => ({ characterKey: C, name: 'Brisa', online: true, active: true, stopped: false, epoch: 4, capabilities: ['move'], ...overrides });

function fixture({ timeoutMs = 30 } = {}) {
  let authListener; const sent = []; const messageListeners = []; const closeListeners = [];
  const auth = { subscribe(callback) { authListener = callback; callback({ signedIn: true, accountId: A }); return () => {}; } };
  const transport = { onMessage(callback) { messageListeners.push(callback); }, onClose(callback) { closeListeners.push(callback); }, send(message) { sent.push(message); } };
  let joined = true;
  const client = new CompanionsClient({ transport, auth, joined: () => joined, timeoutMs, makeRequestId: (() => { let i = 0; return () => `req-${++i}`; })() });
  client.setSession(A);
  const receive = (message) => messageListeners.forEach((callback) => callback(message));
  const result = (request, overrides = {}) => receive({ t: 'agent_owner_result', requestId: request.requestId, ok: true, why: null, enabled: true, companions: [row()], ...overrides });
  return { client, authListener: (state) => authListener(state), sent, receive, result, close: () => closeListeners.forEach((callback) => callback()), setJoined: (value) => { joined = value; } };
}

test('refresh projects a validated owner response and stop uses the displayed epoch', () => {
  const f = fixture(); const updates = []; f.client.subscribe((state) => updates.push(state));
  assert.equal(f.client.refresh(), true);
  const list = f.sent.at(-1); assert.deepEqual(list, { t: 'agent_owner', requestId: 'req-1', op: 'list' });
  f.result(list);
  assert.equal(f.client.snapshot().status, 'ready'); assert.equal(f.client.snapshot().companions[0].characterKey, C);
  assert.equal(f.client.stop(C), true);
  assert.deepEqual(f.sent.at(-1), { t: 'agent_owner', requestId: 'req-2', op: 'stop', characterKey: C, epoch: 4 });
  assert.equal(f.client.stop(C), false, 'second stop cannot race the pending one');
  f.result(f.sent.at(-1), { companions: [row({ active: false, online: false, stopped: true })] });
  assert.equal(f.client.snapshot().companions[0].stopped, true);
  assert.ok(updates.length >= 4);
});

test('logout/account switch clears rows and late response cannot restore them', () => {
  const f = fixture(); f.client.refresh(); const old = f.sent.at(-1);
  f.authListener({ signedIn: false, accountId: '' });
  assert.equal(f.client.snapshot().status, 'signed_out');
  f.result(old);
  assert.deepEqual(f.client.snapshot().companions, []);
  f.authListener({ signedIn: true, accountId: B });
  assert.equal(f.client.refresh(), false, 'auth changes require a new gameplay HELLO binding');
  f.client.setSession(B);
  assert.equal(f.client.refresh(), true);
  assert.equal(f.client.snapshot().companions.length, 0);
});

test('logout and relogin to the same account cannot reuse the old gameplay binding', () => {
  const f = fixture(); f.client.refresh(); const old = f.sent.at(-1);
  f.authListener({ signedIn: false, accountId: '' });
  f.authListener({ signedIn: true, accountId: A });
  f.result(old);
  assert.equal(f.client.refresh(), false, 'fresh auth alone does not reauthorize the old gameplay session');
  f.client.setSession(A);
  assert.equal(f.client.refresh(), true);
  assert.equal(f.sent.length, 2);
});

test('timeout is bounded and does not retry; transport close clears projection', async () => {
  const f = fixture({ timeoutMs: 5 }); f.client.refresh();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(f.sent.length, 1); assert.equal(f.client.snapshot().status, 'error');
  f.close(); assert.equal(f.client.snapshot().status, 'offline'); assert.deepEqual(f.client.snapshot().companions, []);
});

test('account session mismatch and loss of joined state reject requests and late results', () => {
  const f = fixture(); f.client.refresh(); const request = f.sent.at(-1);
  f.setJoined(false); f.result(request);
  assert.deepEqual(f.client.snapshot().companions, []);
  f.client.setSession(B); assert.equal(f.client.refresh(), false);
  assert.equal(f.sent.length, 1);
});

test('server errors use fixed safe copy and malformed projections are ignored', () => {
  const f = fixture(); f.client.refresh(); const request = f.sent.at(-1);
  f.result(request, { ok: false, why: 'forbidden', companions: [] });
  assert.equal(f.client.snapshot().message, 'forbidden');
  assert.equal(f.client.snapshot().status, 'error');
  f.client.refresh(); const next = f.sent.at(-1);
  f.result(next, { companions: [{ ...row(), characterKey: '<img>' }] });
  assert.equal(f.client.snapshot().status, 'loading', 'unsafe server projection cannot be installed');
});

test('stale stop retains a valid safe projection then deliberately refreshes', async () => {
  const f = fixture(); f.client.refresh(); f.result(f.sent.at(-1));
  f.client.stop(C); const stop = f.sent.at(-1);
  f.result(stop, { ok: false, why: 'stale_control', companions: [row({ epoch: 5 })] });
  assert.equal(f.client.snapshot().companions[0].epoch, 5);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.deepEqual(f.sent.at(-1), { t: 'agent_owner', requestId: 'req-3', op: 'list' });
});

test('stale-control refresh queued before logout cannot target a later session', async () => {
  const f = fixture(); f.client.refresh(); f.result(f.sent.at(-1));
  f.client.stop(C);
  f.result(f.sent.at(-1), { ok: false, why: 'stale_control', companions: [row({ epoch: 5 })] });
  f.authListener({ signedIn: false, accountId: '' });
  f.authListener({ signedIn: true, accountId: A });
  f.client.setSession(A);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(f.sent.length, 2, 'the queued refresh stays bound to the old auth/session generation');
});

test('offline provisioned companion can still be stopped with nullable baseline epoch', () => {
  const f = fixture(); f.client.refresh();
  f.result(f.sent.at(-1), { companions: [row({ online: false, active: false, epoch: null })] });
  assert.equal(f.client.stop(C), true);
  assert.deepEqual(f.sent.at(-1), { t: 'agent_owner', requestId: 'req-2', op: 'stop', characterKey: C, epoch: null });
});
