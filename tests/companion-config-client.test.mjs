import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionConfigClient } from '../src/client/companionConfig.js';
import { MSG } from '../src/net/protocol.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CHARACTER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const config = (personality = 'Brisa, calmada.') => ({ v: 1, personality, goals: [
  { id: 'stay-safe', status: 'active', text: 'Proteger a la tripulación.', constraints: ['No atacar humanos.'] },
] });
const head = (revision, value = config(), savedAt = '2026-10-10T12:00:00.000Z') => revision === 0
  ? { revision: 0, config: null, savedAt: null } : { revision, config: value, savedAt };

function fixture({ timeoutMs = 40 } = {}) {
  let authListener; let joined = true; const sent = []; const messageListeners = []; const closeListeners = [];
  const auth = { subscribe(callback) { authListener = callback; callback({ signedIn: true, accountId: ACCOUNT }); return () => {}; } };
  const transport = { onMessage(callback) { messageListeners.push(callback); }, onClose(callback) { closeListeners.push(callback); },
    send(message) { sent.push(message); } };
  const client = new CompanionConfigClient({ transport, auth, joined: () => joined, timeoutMs,
    makeRequestId: (() => { let n = 0; return () => `cfg-${++n}`; })() });
  client.setSession(ACCOUNT);
  const receive = (message) => messageListeners.forEach((callback) => callback(message));
  const result = (request, fields = {}) => receive({ t: MSG.AGENT_COMPANION_CONFIG_RESULT,
    requestId: request.requestId, characterKey: request.characterKey, ok: true, why: null,
    durable: true, head: head(1), ...fields });
  return { client, authListener: (value) => authListener(value), sent, receive, result,
    close: () => closeListeners.forEach((callback) => callback()), setJoined: (value) => { joined = value; } };
}

test('load and save use private character scope and the displayed head revision for CAS', () => {
  const f = fixture();
  assert.equal(f.client.load(CHARACTER), true);
  const load = f.sent.at(-1);
  assert.deepEqual(load, { t: MSG.AGENT_COMPANION_CONFIG, requestId: 'cfg-1', op: 'load', characterKey: CHARACTER });
  f.result(load, { head: head(3) });
  assert.equal(f.client.snapshot().status, 'ready');
  assert.equal(f.client.snapshot().head.revision, 3);
  assert.equal(f.client.save(config('Brisa actualizada.')), true);
  const save = f.sent.at(-1);
  assert.deepEqual(save, { t: MSG.AGENT_COMPANION_CONFIG, requestId: 'cfg-2', op: 'save', characterKey: CHARACTER,
    expectedRevision: 3, config: config('Brisa actualizada.') });
  assert.equal(f.client.save(config()), false, 'one mutation at a time');
  f.result(save, { head: head(4, config('Brisa actualizada.')) });
  assert.equal(f.client.snapshot().status, 'ready');
  assert.equal(f.client.snapshot().head.revision, 4);
});

test('CAS conflict publishes the remote head and does not retry the write', () => {
  const f = fixture(); f.client.load(CHARACTER); f.result(f.sent.at(-1), { head: head(5) });
  f.client.save(config('mi borrador')); const save = f.sent.at(-1);
  f.result(save, { ok: false, why: 'conflict', head: head(6, config('otra sesión')) });
  assert.equal(f.client.snapshot().status, 'conflict');
  assert.equal(f.client.snapshot().head.revision, 6);
  assert.equal(f.sent.filter((item) => item.op === 'save').length, 1);
});

test('server authorization errors with a null head finish immediately instead of timing out', () => {
  const f = fixture(); f.client.load(CHARACTER); const request = f.sent.at(-1);
  f.receive({ t: MSG.AGENT_COMPANION_CONFIG_RESULT, requestId: request.requestId, characterKey: CHARACTER,
    ok: false, why: 'forbidden', durable: false, head: null });
  assert.equal(f.client.snapshot().status, 'error');
  assert.equal(f.client.snapshot().message, 'forbidden');
  assert.equal(f.client.snapshot().head, null);
  assert.equal(f.client.load(CHARACTER), true, 'the response released the pending request');
});

test('unavailable save with null head is uncertain and preserves its base for explicit reload', () => {
  const f = fixture(); f.client.load(CHARACTER); f.result(f.sent.at(-1), { head: head(4) });
  f.client.save(config('write might have committed')); const request = f.sent.at(-1);
  f.receive({ t: MSG.AGENT_COMPANION_CONFIG_RESULT, requestId: request.requestId, characterKey: CHARACTER,
    ok: false, why: 'unavailable', durable: true, head: null });
  assert.equal(f.client.snapshot().status, 'uncertain');
  assert.equal(f.client.snapshot().head.revision, 4);
  assert.equal(f.client.save(config()), false);
  assert.equal(f.client.load(CHARACTER), true);
});

test('false save acknowledgements remain pending until the write becomes uncertain', async () => {
  const f = fixture({ timeoutMs: 5 }); f.client.load(CHARACTER); f.result(f.sent.at(-1), { head: head(2) });
  f.client.save(config('intended')); const request = f.sent.at(-1);
  f.result(request, { head: head(3, config('different canonical write')) });
  assert.equal(f.client.snapshot().status, 'saving');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(f.client.snapshot().status, 'uncertain');

  const g = fixture({ timeoutMs: 5 }); g.client.load(CHARACTER); g.result(g.sent.at(-1), { head: head(2) });
  g.client.save(config('intended')); const wrongRevision = g.sent.at(-1);
  g.result(wrongRevision, { head: head(4, config('intended')) });
  assert.equal(g.client.snapshot().status, 'saving');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(g.client.snapshot().status, 'uncertain');
});

test('save timeout is uncertain, blocks more writes, and explicit load clears uncertainty', async () => {
  const f = fixture({ timeoutMs: 5 }); f.client.load(CHARACTER); f.result(f.sent.at(-1), { head: head(7) });
  f.client.save(config('borrador')); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(f.client.snapshot().status, 'uncertain');
  assert.equal(f.client.save(config()), false);
  assert.equal(f.client.load(CHARACTER), true);
  const reload = f.sent.at(-1); f.result(reload, { head: head(8, config('resultado real')) });
  assert.equal(f.client.snapshot().status, 'ready');
  assert.equal(f.client.snapshot().head.revision, 8);
  assert.equal(f.client.save(config()), true);
});

test('account/session changes clear private config and late responses cannot restore it', () => {
  const f = fixture(); f.client.load(CHARACTER); const old = f.sent.at(-1);
  f.authListener({ signedIn: false, accountId: '' });
  assert.equal(f.client.snapshot().status, 'signed_out');
  assert.equal(f.client.snapshot().head, null);
  f.result(old);
  assert.equal(f.client.snapshot().head, null);
  f.authListener({ signedIn: true, accountId: ACCOUNT });
  assert.equal(f.client.load(CHARACTER), false, 'fresh auth needs a fresh gameplay session');
  f.client.setSession(ACCOUNT); assert.equal(f.client.load(CHARACTER), true);
});

test('switching the selected character fences its old load and clears the previous head', () => {
  const f = fixture();
  f.client.load(CHARACTER); const first = f.sent.at(-1);
  f.client.load(OTHER_CHARACTER); const second = f.sent.at(-1);
  assert.equal(f.client.snapshot().characterKey, OTHER_CHARACTER);
  assert.equal(f.client.snapshot().head, null);
  f.result(first, { head: head(9, config('private first character')) });
  assert.equal(f.client.snapshot().status, 'loading');
  assert.equal(f.client.snapshot().characterKey, OTHER_CHARACTER);
  assert.equal(f.client.snapshot().head, null);
  f.result(second, { head: head(2, config('second character')) });
  assert.equal(f.client.snapshot().head.config.personality, 'second character');
});

test('malformed heads are ignored and disconnect clears the projection', () => {
  const f = fixture(); f.client.load(CHARACTER); const request = f.sent.at(-1);
  f.result(request, { head: { revision: 2, config: null, savedAt: null } });
  assert.equal(f.client.snapshot().status, 'loading');
  f.close(); assert.equal(f.client.snapshot().status, 'offline');
  assert.equal(f.client.snapshot().head, null);
});

test('saving without a durable loaded head or with an invalid config is rejected locally', () => {
  const f = fixture();
  assert.equal(f.client.load(CHARACTER), true);
  f.result(f.sent.at(-1), { durable: false, head: head(0) });
  assert.equal(f.client.save(config()), false);
  assert.equal(f.client.snapshot().durable, false);
});
