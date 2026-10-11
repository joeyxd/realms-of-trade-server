import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceConfigClient } from '../src/client/inferenceConfig.js';
import { MSG } from '../src/net/protocol.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const catalog = [{ id: 'local-1', label: 'Local', providerId: 'local', maxCeilingNanoUsd: 1000000000, models: ['small-v1', 'large-v1'] }];
const config = (ceilingNanoUsd = 500000000) => ({ v: 1, ceilingNanoUsd,
  connections: [{ id: 'local-1', ceilingNanoUsd: 300000000 }],
  companions: [{ character: CHARACTER, connectionId: 'local-1', modelId: 'small-v1' }],
});
const head = (revision = 0, value = null) => ({ revision, config: value, savedAt: revision ? '2026-10-10T12:00:00.000Z' : null });

function fixture({ timeoutMs = 500, signedIn = true, joined = true, makeRequestId } = {}) {
  let authValue = signedIn ? { signedIn: true, guestChoice: false, accountId: ACCOUNT } : { signedIn: false };
  let authListener; let messageListener; let closeListener; let joinedValue = joined;
  const sent = [];
  const transport = { send: message => sent.push(structuredClone(message)), onMessage: fn => { messageListener = fn; }, onClose: fn => { closeListener = fn; } };
  const auth = { subscribe(fn) { authListener = fn; fn(authValue); return () => {}; } };
  const client = new InferenceConfigClient({ transport, auth, joined: () => joinedValue, timeoutMs,
    makeRequestId: makeRequestId || (() => `req-${sent.length + 1}`) });
  const result = (request, extra = {}) => messageListener({ t: MSG.INFERENCE_CONFIG_RESULT, requestId: request.requestId,
    ok: true, why: null, durable: true, head: head(0), catalog, characters: [CHARACTER], ...extra });
  return { client, sent, result, setAuth(value) { authValue = value; authListener(value); }, setJoined(value) { joinedValue = value; }, close() { closeListener?.(); } };
}

test('load is owner-scoped, sends no account/character selector and projects the exact catalog DTO', () => {
  const f = fixture();
  assert.equal(f.client.load(), false, 'session account must be admitted before a request');
  f.client.setSession(ACCOUNT);
  assert.equal(f.client.load(), true);
  const request = f.sent[0];
  assert.deepEqual(request, { t: MSG.INFERENCE_CONFIG, requestId: 'req-1', op: 'load' });
  f.result(request, { head: head(), characters: [CHARACTER, OTHER] });
  assert.deepEqual(f.client.snapshot(), { status: 'ready', head: head(), catalog, characters: [CHARACTER, OTHER], durable: true, message: '' });
  f.client.destroy();
});

test('save emits whole-config CAS and accepts only exact durable next revision', () => {
  const f = fixture(); f.client.setSession(ACCOUNT); f.client.load(); f.result(f.sent.at(-1), { catalog, characters: [CHARACTER] });
  assert.equal(f.client.save(config()), true);
  const request = f.sent.at(-1);
  assert.deepEqual(request, { t: MSG.INFERENCE_CONFIG, requestId: 'req-2', op: 'save', expectedRevision: 0, config: config() });
  f.result(request, { head: head(1, config()) });
  assert.equal(f.client.snapshot().status, 'ready'); assert.equal(f.client.snapshot().head.revision, 1);
  assert.deepEqual(f.client.snapshot().head.config, config());
  f.client.destroy();
});

test('client rejects configuration outside current owner characters, eligible catalog or ceilings', () => {
  const f = fixture(); f.client.setSession(ACCOUNT); f.client.load(); f.result(f.sent.at(-1), { catalog, characters: [CHARACTER] });
  assert.equal(f.client.save({ ...config(), companions: [{ character: OTHER, connectionId: 'local-1', modelId: 'small-v1' }] }), false);
  assert.equal(f.client.save({ ...config(), companions: [{ character: CHARACTER, connectionId: 'local-1', modelId: 'unknown' }] }), false);
  assert.equal(f.client.save({ ...config(1500000000), connections: [{ id: 'local-1', ceilingNanoUsd: 1100000000 }] }), false);
  assert.equal(f.sent.length, 1);
  f.client.destroy();
});

test('malformed catalog, character projection and extra response fields are ignored until timeout', async () => {
  const f = fixture({ timeoutMs: 15 }); f.client.setSession(ACCOUNT); f.client.load(); const request = f.sent.at(-1);
  f.result(request, { catalog: [{ ...catalog[0], secret: 'must-not-project' }] });
  assert.equal(f.client.snapshot().status, 'loading');
  f.result(request, { characters: [CHARACTER, CHARACTER] });
  assert.equal(f.client.snapshot().status, 'loading');
  f.result(request, { extra: true });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(f.client.snapshot().status, 'error'); assert.equal(f.client.snapshot().message, 'timeout');
  assert.equal(JSON.stringify(f.client.snapshot()).includes('must-not-project'), false);
  f.client.destroy();
});

test('wrong but well-shaped save ACK remains pending and times out as uncertain', async () => {
  const f = fixture({ timeoutMs: 15 }); f.client.setSession(ACCOUNT); f.client.load(); f.result(f.sent.at(-1), { catalog, characters: [CHARACTER] });
  f.client.save(config()); const request = f.sent.at(-1);
  f.result(request, { head: head(1, { ...config(), ceilingNanoUsd: 400000000 }) });
  assert.equal(f.client.snapshot().status, 'saving');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(f.client.snapshot().status, 'uncertain');
  f.client.load(); const reload = f.sent.at(-1); f.result(reload, { head: head(1, config()), catalog, characters: [CHARACTER] });
  assert.equal(f.client.snapshot().status, 'ready'); assert.equal(f.client.snapshot().head.revision, 1);
  f.client.destroy();
});

test('auth change and transport close fence late responses and clear private state', () => {
  const f = fixture(); f.client.setSession(ACCOUNT); f.client.load(); const request = f.sent.at(-1);
  f.setAuth({ signedIn: false }); f.result(request, { head: head(1, config()) });
  assert.equal(f.client.snapshot().status, 'signed_out'); assert.deepEqual(f.client.snapshot().characters, []);
  f.setAuth({ signedIn: true, guestChoice: false, accountId: ACCOUNT }); f.client.setSession(ACCOUNT); f.client.load();
  f.close(); assert.equal(f.client.snapshot().status, 'offline'); assert.equal(f.client.snapshot().head, null);
  f.client.destroy();
});

test('conflict preserves the server head and unavailable does not claim a saved result', () => {
  const f = fixture(); f.client.setSession(ACCOUNT); f.client.load(); f.result(f.sent.at(-1), { catalog, characters: [CHARACTER] });
  f.client.save(config()); let request = f.sent.at(-1);
  f.result(request, { ok: false, why: 'conflict', head: head(2, config()), catalog, characters: [CHARACTER] });
  assert.equal(f.client.snapshot().status, 'conflict'); assert.equal(f.client.snapshot().head.revision, 2);
  assert.equal(f.client.load(), true); f.result(f.sent.at(-1), { catalog, characters: [CHARACTER] });
  f.client.save(config()); request = f.sent.at(-1);
  f.result(request, { ok: false, why: 'unavailable', head: null });
  assert.equal(f.client.snapshot().status, 'uncertain');
  f.client.destroy();
});
