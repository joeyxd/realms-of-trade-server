import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionPairingClient } from '../src/client/companionPairing.js';
import { MSG } from '../src/net/protocol.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CODE = 'a'.repeat(64);
function fixture({ timeoutMs = 40, now = () => Date.now(), failSend = false } = {}) {
  let authListener; let joined = true; let shouldFailSend = failSend; const sent = []; const messages = []; const closes = [];
  const auth = { subscribe(callback) { authListener = callback; callback({ signedIn: true, accountId: ACCOUNT }); return () => {}; } };
  const transport = { onMessage(callback) { messages.push(callback); }, onClose(callback) { closes.push(callback); }, send(message) {
    if (shouldFailSend) { shouldFailSend = false; throw new Error('transport_send_failed'); }
    sent.push(structuredClone(message));
  } };
  const client = new CompanionPairingClient({ transport, auth, joined: () => joined, timeoutMs, now,
    controllerUrl: 'wss://game.example/ws', makeRequestId: (() => { let n = 0; return () => `pair-${++n}`; })() });
  client.setSession(ACCOUNT);
  const receive = message => messages.forEach(callback => callback(message));
  const reply = (request, fields = {}) => receive({ t: MSG.AGENT_COMPANION_PAIR_RESULT, requestId: request.requestId,
    ok: true, why: null, enabled: true, code: null, expiresAtMs: null, bootstrap: null, ...fields });
  return { client, authListener: value => authListener(value), sent, receive, reply, setFailSend: () => { shouldFailSend = true; },
    close: () => closes.forEach(callback => callback()), setJoined: value => { joined = value; } };
}

test('load, issue, and revoke use the authenticated pairing contract and private one-use code', () => {
  const f = fixture();
  assert.equal(f.client.load(), true);
  const load = f.sent.at(-1); assert.deepEqual(load, { t: MSG.AGENT_COMPANION_PAIR, requestId: 'pair-1', op: 'load' });
  f.reply(load); assert.deepEqual(f.client.snapshot(), { status: 'ready', enabled: true, code: null, expiresAtMs: null, message: '' });
  assert.equal(f.client.issue(), true);
  const issue = f.sent.at(-1); assert.deepEqual(issue, { t: MSG.AGENT_COMPANION_PAIR, requestId: 'pair-2', op: 'issue' });
  assert.equal(f.client.issue(), false, 'only one pairing operation can be pending');
  const expiresAtMs = Date.now() + 60_000;
  f.reply(issue, { code: CODE, expiresAtMs });
  assert.deepEqual(f.client.snapshot(), { status: 'ready', enabled: true, code: CODE, expiresAtMs, message: '' });
  assert.equal(f.client.revoke(), true);
  const revoke = f.sent.at(-1); assert.deepEqual(revoke, { t: MSG.AGENT_COMPANION_PAIR, requestId: 'pair-3', op: 'revoke' });
  f.reply(revoke); assert.equal(f.client.snapshot().code, null); assert.equal(f.client.snapshot().expiresAtMs, null);
  assert.equal(f.client.revoke(), true, 'an owner can revoke an active connection even without a visible code');
  const revokeAgain = f.sent.at(-1); assert.deepEqual(revokeAgain, { t: MSG.AGENT_COMPANION_PAIR, requestId: 'pair-4', op: 'revoke' });
  f.reply(revokeAgain);
  f.client.destroy();
});

test('malformed, overlong, or wrong-operation codes are rejected without ending the pending request', () => {
  const f = fixture(); f.client.load(); f.reply(f.sent.at(-1)); f.client.issue(); const issue = f.sent.at(-1);
  f.reply(issue, { code: 'unsafe', expiresAtMs: Date.now() + 10_000 });
  assert.equal(f.client.snapshot().status, 'loading');
  f.reply(issue, { code: CODE, expiresAtMs: Date.now() + 5 * 60_000 + 1 });
  assert.equal(f.client.snapshot().code, null);
  f.reply(issue, { code: CODE, expiresAtMs: Date.now() + 60_000, bootstrap: { grant: 'must-not-arrive' } });
  assert.equal(f.client.snapshot().code, null);
  f.reply(issue, { code: CODE, expiresAtMs: Date.now() + 60_000 });
  assert.equal(f.client.snapshot().code, CODE);
  f.client.destroy();
});

test('failed issue and revoke mutations clear the displayed secret before acknowledgement and keep it cleared on denial', () => {
  const f = fixture(); f.client.load(); f.reply(f.sent.at(-1)); f.client.issue();
  f.reply(f.sent.at(-1), { code: CODE, expiresAtMs: Date.now() + 30_000 });
  assert.equal(f.client.revoke(), true);
  const revoke = f.sent.at(-1);
  assert.equal(f.client.snapshot().code, null, 'revoke clears the secret immediately, before its receipt');
  f.receive({ t: MSG.AGENT_COMPANION_PAIR_RESULT, requestId: revoke.requestId, ok: false, why: 'unavailable',
    enabled: true, code: null, expiresAtMs: null, bootstrap: null });
  assert.equal(f.client.snapshot().code, null, 'a failed mutation never restores its former secret');
  f.client.destroy();

  const g = fixture(); g.client.load(); g.reply(g.sent.at(-1)); g.client.issue();
  g.reply(g.sent.at(-1), { code: CODE, expiresAtMs: Date.now() + 30_000 });
  g.setFailSend();
  assert.equal(g.client.revoke(), false);
  assert.equal(g.client.snapshot().code, null, 'send failure keeps the code cleared');
  g.client.destroy();
});

test('account changes, disconnects, revoke, expiry, and destroy clear private pairing state', async () => {
  const f = fixture(); f.client.load(); f.reply(f.sent.at(-1)); f.client.issue();
  f.reply(f.sent.at(-1), { code: CODE, expiresAtMs: Date.now() + 12 });
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(f.client.snapshot().code, null);
  f.client.issue(); f.reply(f.sent.at(-1), { code: CODE, expiresAtMs: Date.now() + 30_000 });
  const oldLoad = f.client.load(); assert.equal(oldLoad, true); assert.equal(f.client.snapshot().code, null, 'reload drops an old code while status is checked');
  const old = f.sent.at(-1); f.authListener({ signedIn: false, accountId: '' });
  assert.equal(f.client.snapshot().status, 'signed_out');
  f.reply(old); assert.equal(f.client.snapshot().code, null, 'late receipt cannot restore signed-out data');
  f.authListener({ signedIn: true, accountId: ACCOUNT }); f.client.setSession(ACCOUNT); f.client.load(); f.reply(f.sent.at(-1));
  f.client.issue(); f.reply(f.sent.at(-1), { code: CODE, expiresAtMs: Date.now() + 30_000 });
  f.close(); assert.equal(f.client.snapshot().code, null); assert.equal(f.client.snapshot().status, 'offline');
  f.client.setSession(ACCOUNT); f.client.load(); f.reply(f.sent.at(-1)); f.client.issue(); f.reply(f.sent.at(-1), { code: CODE, expiresAtMs: Date.now() + 30_000 });
  f.client.destroy(); assert.equal(f.client.snapshot().code, null);
});

test('stale correlation is ignored and unsafe controller URLs are not retained', () => {
  const f = fixture(); f.client.load(); const request = f.sent.at(-1);
  f.reply({ ...request, requestId: 'old-request' }); assert.equal(f.client.snapshot().status, 'loading');
  f.reply(request); assert.equal(f.client.snapshot().status, 'ready');
  const unsafe = new CompanionPairingClient({ transport: { onMessage() {}, send() {} },
    auth: { subscribe(callback) { callback({ signedIn: true, accountId: ACCOUNT }); return () => {}; } }, controllerUrl: 'wss://user:secret@example/ws?code=abc' });
  assert.equal(unsafe.controllerUrl, ''); unsafe.destroy(); f.client.destroy();
});
