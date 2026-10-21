import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionPresenceClient } from '../src/client/companionPresence.js';
import { MSG } from '../src/net/protocol.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const present = (revision = 0, status = 'present') => ({ characterKey: CHARACTER, name: 'Brisa', status,
  order: 'wait', revision, entity: 42, reason: null });

function fixture({ timeoutMs = 50 } = {}) {
  let authListener; let joined = true; const sent = []; const messages = []; const closes = [];
  const auth = { subscribe(callback) { authListener = callback; callback({ signedIn: true, accountId: ACCOUNT }); return () => {}; } };
  const transport = { onMessage(callback) { messages.push(callback); }, onClose(callback) { closes.push(callback); }, send(message) { sent.push(structuredClone(message)); } };
  const client = new CompanionPresenceClient({ transport, auth, joined: () => joined, timeoutMs,
    makeRequestId: (() => { let n = 0; return () => `presence-${++n}`; })() });
  client.setSession(ACCOUNT);
  const receive = message => messages.forEach(callback => callback(message));
  const reply = (request, fields = {}) => receive({ t: MSG.AGENT_COMPANION_PRESENCE_RESULT,
    requestId: request.requestId, ok: true, why: null, enabled: true, presence: present(), ...fields });
  return { client, sent, receive, reply, auth: value => authListener(value), close: () => closes.forEach(fn => fn()), setJoined: value => { joined = value; } };
}

test('load and owner commands use minimal payloads and revision from current presence', () => {
  const f = fixture();
  assert.equal(f.client.load(), true);
  const load = f.sent.at(-1);
  assert.deepEqual(load, { t: MSG.AGENT_COMPANION_PRESENCE, requestId: 'presence-1', op: 'load' });
  f.reply(load, { presence: present(7) });
  assert.deepEqual(f.client.snapshot(), { status: 'ready', enabled: true, presence: present(7), message: '' });
  assert.equal(f.client.command('follow'), true);
  const command = f.sent.at(-1);
  assert.deepEqual(command, { t: MSG.AGENT_COMPANION_PRESENCE, requestId: 'presence-2', op: 'follow', expectedRevision: 7 });
  assert.equal(Object.hasOwn(command, 'characterKey'), false);
  assert.equal(Object.hasOwn(command, 'x'), false);
  assert.equal(f.client.command('wait'), false, 'only one command can be in flight');
  f.reply(command, { presence: present(8) });
  assert.equal(f.client.snapshot().presence.revision, 8);
  f.client.destroy();
});

test('refresh coalesces behind mutations and sends one authoritative read afterward', () => {
  const f = fixture(); f.client.load(); const load = f.sent.at(-1); f.reply(load);
  f.client.command('join'); const mutation = f.sent.at(-1);
  assert.equal(f.client.load({ refresh: true }), true);
  assert.equal(f.client.load({ refresh: true }), true);
  assert.equal(f.sent.length, 2);
  f.reply(mutation, { presence: present(2) });
  assert.equal(f.sent.length, 3);
  assert.deepEqual(f.sent.at(-1), { t: MSG.AGENT_COMPANION_PRESENCE, requestId: 'presence-3', op: 'load' });
  f.reply(f.sent.at(-1), { presence: present(2) });
  assert.equal(f.client.snapshot().status, 'ready');
  f.client.destroy();
});

test('strict result validation ignores stale or malformed receipts; recovery and unavailable cannot be commanded', () => {
  const f = fixture(); f.client.load(); const request = f.sent.at(-1);
  f.reply({ ...request, requestId: 'old' }); assert.equal(f.client.snapshot().status, 'loading');
  f.receive({ t: MSG.AGENT_COMPANION_PRESENCE_RESULT, requestId: request.requestId, ok: true, why: null,
    enabled: true, presence: { ...present(), ownerId: ACCOUNT } });
  assert.equal(f.client.snapshot().status, 'loading');
  f.reply(request, { presence: present(0, 'recovery') });
  assert.equal(f.client.snapshot().presence.status, 'recovery');
  assert.equal(f.client.command('join'), false);
  f.client.load(); const next = f.sent.at(-1); f.reply(next, { presence: present(2, 'unavailable') });
  assert.equal(f.client.command('return'), false);
  f.client.destroy();
});

test('account changes, disconnects and timeout discard stale replies and keep actions closed', async () => {
  const f = fixture({ timeoutMs: 10 });
  f.client.load(); const initial = f.sent.at(-1); f.reply(initial);
  f.client.command('follow'); const mutation = f.sent.at(-1);
  f.auth({ signedIn: false, accountId: '' }); f.reply(mutation);
  assert.equal(f.client.snapshot().status, 'signed_out');
  f.auth({ signedIn: true, accountId: ACCOUNT }); f.client.setSession(ACCOUNT); f.client.load();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.client.snapshot().status, 'error');
  assert.equal(f.client.snapshot().message, 'timeout');
  f.close(); assert.equal(f.client.snapshot().status, 'offline');
  f.client.destroy();
});

test('IC05a a receipt whose presence order is gather is adopted; unknown orders stay ignored', () => {
  const f = fixture(); f.client.load(); const load = f.sent.at(-1);
  f.reply(load, { presence: { ...present(3), order: 'gather' } });
  assert.equal(f.client.snapshot().status, 'ready');
  assert.equal(f.client.snapshot().presence.order, 'gather');
  f.client.load({ refresh: true }); const again = f.sent.at(-1);
  f.reply(again, { presence: { ...present(4), order: 'harvest' } });
  assert.equal(f.client.snapshot().status, 'loading', 'an unknown order value is not adopted');
  assert.equal(f.client.command('gather'), false, 'the web panel has no gather command');
  f.client.destroy();
});
