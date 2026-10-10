import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';

const GM = 'a1b2c3d4-e5f6-4789-8abc-1234567890ab';
const PLAYER = 'b1b2c3d4-e5f6-4789-8abc-1234567890ab';

async function start(t, options = {}) {
  const server = createGameServer({
    port: 0,
    host: '127.0.0.1',
    bots: 0,
    log: () => {},
    saveSecret: 'gm-http-test-secret',
    store: createMemoryStore(),
    ...options,
  });
  const port = await server.listen();
  t.after(() => {
    server.server.closeAllConnections?.();
    return server.close();
  });
  return { base: `http://127.0.0.1:${port}`, server };
}

test('mounted HTTP GM session checks authenticated identity and ignores caller-supplied query grants', async (t) => {
  const resolverCalls = [];
  const started = await start(t, {
    gmAccountIds: [GM.toUpperCase()],
    resolvePlayer: async (_request, hello) => {
      resolverCalls.push(hello.token);
      if (hello.token === 'gm-access') return GM;
      if (hello.token === 'player-access') return PLAYER;
      return null;
    },
  });
  const { base } = started;
  assert.equal(started.server.game.server.dev, false);

  const allowed = await fetch(`${base}/api/gm/session?accountId=${PLAYER}`, {
    headers: { authorization: 'Bearer gm-access' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await allowed.json(), {
    ok: true, accountId: GM, capabilities: ['gm-editor'], expiresIn: 60,
  });

  const forbidden = await fetch(`${base}/api/gm/session?gm=1&accountId=${GM}`, {
    headers: { authorization: 'Bearer player-access' },
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { ok: false, code: 'forbidden' });

  const guestGrant = await fetch(`${base}/api/gm/session?gm=1&accountId=${GM}`);
  assert.equal(guestGrant.status, 401);

  const method = await fetch(`${base}/api/gm/session?accountId=${GM}`, {
    method: 'POST', headers: { authorization: 'Bearer gm-access' },
  });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await method.json(), { ok: false, code: 'method' });

  assert.deepEqual(resolverCalls, ['gm-access', 'player-access']);
});

test('mounted HTTP GM session is unavailable when the server has no allowlist', async (t) => {
  const { base } = await start(t, { resolvePlayer: async () => GM });
  const response = await fetch(`${base}/api/gm/session`, {
    headers: { authorization: 'Bearer valid-account-token' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: 'gm_unavailable' });
});

test('real HTTP client disconnect aborts a delayed account resolver without a late response', async (t) => {
  let markStarted;
  let markAborted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const aborted = new Promise((resolve) => { markAborted = resolve; });
  const { base } = await start(t, {
    gmAccountIds: [GM],
    resolvePlayer: async (_request, _hello, { signal }) => {
      markStarted();
      return new Promise((resolve) => signal.addEventListener('abort', () => {
        markAborted(); resolve(null);
      }, { once: true }));
    },
  });
  const controller = new AbortController();
  const response = fetch(`${base}/api/gm/session`, {
    headers: { authorization: 'Bearer slow-access-token' },
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(response, { name: 'AbortError' });
  await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error('resolver signal not aborted')), 250))]);
});
