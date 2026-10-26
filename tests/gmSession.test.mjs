import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGmSessionHandler,
  GmConfigurationError,
  parseGmAccountIds,
  resolveGmSession,
} from '../server/gmSession.mjs';

const GM = 'a1b2c3d4-e5f6-4789-8abc-1234567890ab';
const PLAYER = 'b1b2c3d4-e5f6-4789-8abc-1234567890ab';

test('GM account allowlist is strict, normalized, and absent configuration stays disabled', () => {
  assert.equal(parseGmAccountIds(undefined), null);
  assert.deepEqual(parseGmAccountIds(` ${GM.toUpperCase()} `), [GM]);
  assert.throws(() => parseGmAccountIds(''), GmConfigurationError);
  assert.throws(() => parseGmAccountIds(`${GM},not-a-uuid`), GmConfigurationError);
  assert.throws(() => parseGmAccountIds(`${GM},${GM.toUpperCase()}`), GmConfigurationError);
  assert.throws(() => createGmSessionHandler({ accountIds: Array(33).fill(GM), resolvePlayer: async () => GM }), GmConfigurationError);
});

test('GM session fails closed when account allowlist or account resolver is missing', async () => {
  const noConfig = await resolveGmSession({ authorization: `Bearer token`, request: {}, resolvePlayer: async () => GM, accountIds: null });
  const noResolver = await resolveGmSession({ authorization: `Bearer token`, request: {}, resolvePlayer: null, accountIds: [GM] });
  assert.equal(noConfig.status, 503);
  assert.equal(noResolver.status, 503);
});

test('missing, forged, and malformed bearer credentials never grant GM session', async () => {
  let calls = 0;
  const resolvePlayer = async (_request, hello) => { calls++; return hello.token === 'valid' ? GM : null; };
  for (const authorization of [undefined, 'Basic token', 'Bearer', 'Bearer forged']) {
    const result = await resolveGmSession({ authorization, request: {}, resolvePlayer, accountIds: [GM] });
    assert.equal(result.status, 401);
  }
  assert.equal(calls, 1);
});

test('authenticated account outside the server allowlist is denied', async () => {
  const result = await resolveGmSession({
    authorization: 'Bearer player-token',
    request: {},
    resolvePlayer: async () => PLAYER,
    accountIds: [GM],
  });
  assert.deepEqual(result, { status: 403, body: { ok: false, code: 'forbidden' } });
});

test('allowlisted session is derived from resolver identity, ignores query grants, and is no-store', async () => {
  const handler = createGmSessionHandler({ accountIds: [GM.toUpperCase()], resolvePlayer: async (_request, hello) => {
    assert.equal(hello.token, 'supabase-access-token');
    return GM;
  } });
  const response = { headers: null, status: 0, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  const handled = await handler({ method: 'GET', url: '/api/gm/session?accountId=forged', headers: { authorization: 'Bearer supabase-access-token' } }, response);
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), { ok: true, accountId: GM, capabilities: ['gm-editor'], expiresIn: 60 });
});

test('GM session endpoint only accepts GET', async () => {
  const handler = createGmSessionHandler({ accountIds: [GM], resolvePlayer: async () => GM });
  const response = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await handler({ method: 'POST', headers: { authorization: `Bearer token` } }, response);
  assert.equal(response.status, 405);
  assert.deepEqual(JSON.parse(response.body), { ok: false, code: 'method' });
});

test('resolver is bounded and receives an abort signal', async () => {
  let observedSignal;
  const result = await resolveGmSession({
    authorization: 'Bearer slow-token',
    request: {},
    resolvePlayer: async (_request, _hello, options) => {
      observedSignal = options.signal;
      return new Promise(() => {});
    },
    accountIds: [GM],
    timeoutMs: 5,
  });
  assert.equal(observedSignal.aborted, true);
  assert.deepEqual(result, { status: 503, body: { ok: false, code: 'gm_auth_timeout' } });
});

test('closed request aborts resolution without writing a response', async () => {
  const { EventEmitter } = await import('node:events');
  const handler = createGmSessionHandler({
    accountIds: [GM],
    timeoutMs: 1000,
    resolvePlayer: async (_request, _hello, options) => new Promise((resolve) => {
      options.signal.addEventListener('abort', () => resolve(GM), { once: true });
    }),
  });
  const request = new EventEmitter();
  request.method = 'GET'; request.aborted = false; request.headers = { authorization: 'Bearer token' };
  const response = new EventEmitter();
  response.destroyed = false; response.writableEnded = false; response.wrote = false;
  response.writeHead = () => { response.wrote = true; };
  response.end = () => { response.wrote = true; response.writableEnded = true; };
  const pending = handler(request, response);
  request.aborted = true;
  request.emit('aborted');
  await pending;
  assert.equal(response.wrote, false);
});
