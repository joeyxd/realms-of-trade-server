import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionCreationClient } from '../src/client/companionCreation.js';
import { DEFAULT_COMPANION_PRESET, companionCreationConfig } from '../src/net/companionCreation.js';
import { MSG } from '../src/net/protocol.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CREATION_NEXT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const savedAt = '2026-10-11T12:00:00.000Z';
const record = (preset = DEFAULT_COMPANION_PRESET, creationId = CREATION) => ({ characterKey: CHARACTER, creationId,
  preset: structuredClone(preset), createdAt: savedAt,
  configuration: { revision: 1, config: companionCreationConfig(preset), savedAt },
  control: { revision: 1, stopped: true, savedAt } });

function fixture({ timeoutMs = 35 } = {}) {
  let authListener; let joined = true; const sent = []; const messages = []; const closes = [];
  const auth = { subscribe(callback) { authListener = callback; callback({ signedIn: true, accountId: ACCOUNT }); return () => {}; } };
  const transport = { onMessage(callback) { messages.push(callback); }, onClose(callback) { closes.push(callback); }, send(message) { sent.push(structuredClone(message)); } };
  const client = new CompanionCreationClient({ transport, auth, joined: () => joined, timeoutMs,
    makeRequestId: (() => { let i = 0; return () => `create-${++i}`; })(),
    makeCreationId: (() => { let i = 0; return () => [CREATION, CREATION_NEXT][i++]; })() });
  client.setSession(ACCOUNT);
  const receive = message => messages.forEach(callback => callback(message));
  const reply = (request, fields = {}) => receive({ t: MSG.AGENT_COMPANION_CREATE_RESULT, requestId: request.requestId,
    ok: true, why: null, durable: true, available: true, record: null, ...fields });
  return { client, authListener: value => authListener(value), sent, receive, reply,
    close: () => closes.forEach(callback => callback()), setJoined: value => { joined = value; } };
}

test('load and create use the authenticated owner session and exact creation contract', () => {
  const f = fixture();
  assert.equal(f.client.load(), true);
  const load = f.sent.at(-1);
  assert.deepEqual(load, { t: MSG.AGENT_COMPANION_CREATE, requestId: 'create-1', op: 'load' });
  f.reply(load);
  assert.deepEqual(f.client.snapshot(), { status: 'ready', available: true, durable: true, record: null, message: '' });
  assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), true);
  const create = f.sent.at(-1);
  assert.deepEqual(create, { t: MSG.AGENT_COMPANION_CREATE, requestId: 'create-2', op: 'create', creationId: CREATION,
    preset: DEFAULT_COMPANION_PRESET });
  assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), false, 'only one creation can be pending');
  f.reply(create, { record: record() });
  assert.equal(f.client.snapshot().record.characterKey, CHARACTER);
  assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), false, 'existing identity prevents a second creation');
  const exposed = f.client.snapshot(); exposed.record.preset.name = 'changed outside';
  assert.equal(f.client.snapshot().record.preset.name, DEFAULT_COMPANION_PRESET.name);
});

test('creation is gated until the durable service is available and no record exists', () => {
  const f = fixture();
  assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), false);
  assert.equal(f.client.load(), true); f.reply(f.sent.at(-1), { available: false, durable: false });
  assert.equal(f.client.snapshot().status, 'ready');
  assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), false);
});

test('a pending load is reused and a definitive denial releases its idempotency intent', () => {
  const f = fixture();
  assert.equal(f.client.load(), true); const originalLoad = f.sent.at(-1);
  assert.equal(f.client.load(), true); assert.equal(f.sent.length, 1, 'do not duplicate a load on the same session');
  f.reply(originalLoad); assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), true);
  const denied = f.sent.at(-1);
  f.receive({ t: MSG.AGENT_COMPANION_CREATE_RESULT, requestId: denied.requestId, ok: false, why: 'invalid_request',
    durable: true, available: true, record: null });
  assert.equal(f.client.snapshot().status, 'error'); assert.equal(f.client.retry(), false);
  assert.equal(f.client.load(), true); f.reply(f.sent.at(-1));
  assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), true);
  assert.equal(f.sent.at(-1).creationId, CREATION_NEXT, 'a revised request gets a fresh id after a known denial');
});

test('uncertain creation retries the same creation id and preset; successful load recovers it', async () => {
  const f = fixture({ timeoutMs: 8 }); f.client.load(); f.reply(f.sent.at(-1));
  assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), true); const first = f.sent.at(-1);
  await new Promise(resolve => setTimeout(resolve, 18));
  assert.equal(f.client.snapshot().status, 'uncertain');
  assert.equal(f.client.create(DEFAULT_COMPANION_PRESET), false);
  assert.equal(f.client.retry(), true); const retry = f.sent.at(-1);
  assert.equal(retry.requestId, 'create-3'); assert.equal(retry.creationId, first.creationId);
  assert.deepEqual(retry.preset, first.preset);
  f.reply(retry, { record: record() }); assert.equal(f.client.snapshot().record.creationId, CREATION);

  const g = fixture({ timeoutMs: 8 }); g.client.load(); g.reply(g.sent.at(-1)); g.client.create(DEFAULT_COMPANION_PRESET);
  await new Promise(resolve => setTimeout(resolve, 18));
  assert.equal(g.client.load(), true, 'load is the recovery path for an uncertain result');
  g.reply(g.sent.at(-1), { record: record() });
  assert.equal(g.client.snapshot().status, 'ready'); assert.equal(g.client.snapshot().record.creationId, CREATION);
  assert.equal(g.client.retry(), false);
});

test('failure without durable readiness cannot create and malformed receipts stay pending', () => {
  const f = fixture(); f.client.load(); const load = f.sent.at(-1);
  f.receive({ t: MSG.AGENT_COMPANION_CREATE_RESULT, requestId: load.requestId, ok: false, why: 'unavailable',
    durable: false, available: false, record: null });
  assert.equal(f.client.snapshot().status, 'error'); assert.equal(f.client.snapshot().available, false);
  f.client.load(); f.reply(f.sent.at(-1)); f.client.create(DEFAULT_COMPANION_PRESET); const request = f.sent.at(-1);
  f.reply(request, { record: { ...record(), creationId: 'invalid' } });
  assert.equal(f.client.snapshot().status, 'creating', 'malformed record is not accepted as a receipt');
});

test('account changes clear the private record and late responses cannot restore it', () => {
  const f = fixture(); f.client.load(); f.reply(f.sent.at(-1), { record: record() });
  assert.ok(f.client.snapshot().record);
  f.client.load(); const old = f.sent.at(-1);
  f.authListener({ signedIn: false, accountId: '' });
  assert.equal(f.client.snapshot().status, 'signed_out'); assert.equal(f.client.snapshot().record, null);
  f.reply(old, { record: record() }); assert.equal(f.client.snapshot().record, null);
  f.authListener({ signedIn: true, accountId: ACCOUNT });
  assert.equal(f.client.load(), false, 'reauthentication requires a fresh gameplay session');
  f.client.setSession(ACCOUNT); assert.equal(f.client.load(), true);
});

