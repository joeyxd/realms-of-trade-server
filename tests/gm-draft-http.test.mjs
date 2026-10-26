import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGmDraftHandler } from '../server/gmDraftHttp.mjs';
import { createDecoration, createDocument } from '../src/editor/document.js';

const GM = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const OP = '20000000-0000-4000-8000-000000000001';
const scope = { world: 'marea-negra', owner: GM };
function fixture({ durable = true, check = true, validateReferences = () => true, resolver = null, timeoutMs = 10_000 } = {}) {
  let head = null;
  const operations = new Map();
  const store = {
    durable,
    async checkGmDrafts() { if (!check) throw new Error('private provider error'); return { version: 1 }; },
    async loadGmDraft(input) { assert.deepEqual(input, scope); if (store.loadError) throw new Error('secret provider detail'); return head ?? { revision: 0, document: null, savedAt: null }; },
    async saveGmDraft(input) {
      assert.deepEqual({ world: input.world, owner: input.owner }, scope);
      const prior = operations.get(input.operationId);
      if (prior) return JSON.stringify(prior.document) === JSON.stringify(input.document)
        ? { ok: true, head: prior.head, replay: true } : { ok: false, why: 'operation' };
      if ((head?.revision ?? 0) !== input.expectedRevision) return { ok: false, why: 'conflict', revision: head?.revision ?? 0 };
      head = { revision: input.expectedRevision + 1, document: input.document, savedAt: new Date().toISOString() };
      operations.set(input.operationId, { document: input.document, head });
      return { ok: true, head, replay: false };
    },
  };
  const handler = createGmDraftHandler({ store, resolvePlayer: resolver || (async (_req, { token }) => token === 'gm' ? GM : token === 'other' ? OTHER : null),
    accountIds: [GM], worldId: scope.world, seed: 42, validateReferences, timeoutMs });
  return { handler, store, document: createDocument({ seed: 42, baseRevision: 'terrain-s21-v1' }) };
}
async function serve(handler, run) {
  const server = http.createServer((req, res) => { void handler.handle(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const auth = (token = 'gm') => ({ authorization: `Bearer ${token}` });

test('GM draft HTTP requires readiness, authenticates every request and derives owner', async () => {
  const { handler } = fixture({ check: false });
  assert.equal(await handler.prepare(), false);
  await serve(handler, async (url) => {
    const unavailable = await fetch(`${url}/api/gm/draft`, { headers: auth() });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { ok: false, code: 'gm_drafts_unavailable' });
  });

  const f = fixture(); assert.equal(await f.handler.prepare(), true);
  await serve(f.handler, async (url) => {
    const guest = await fetch(`${url}/api/gm/draft`);
    assert.equal(guest.status, 401);
    const nonGm = await fetch(`${url}/api/gm/draft`, { headers: auth('other') });
    assert.equal(nonGm.status, 403);
    const response = await fetch(`${url}/api/gm/draft`, { headers: auth() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('vary'), 'authorization');
    assert.deepEqual(await response.json(), { ok: true, durable: true,
      scope: { worldId: 'marea-negra', seed: 42, baseRevision: 'terrain-s21-v1' }, head: { revision: 0, document: null, savedAt: null } });
  });
});

test('PUT accepts only the strict document contract and returns CAS conflict and replay results', async () => {
  const { handler, document } = fixture(); assert.equal(await handler.prepare(), true);
  await serve(handler, async (url) => {
    const put = (body) => fetch(`${url}/api/gm/draft`, { method: 'PUT', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const saved = await put({ operationId: OP, expectedRevision: 0, document });
    assert.equal(saved.status, 200); const body = await saved.json();
    assert.equal(body.head.revision, 1); assert.equal(body.replay, false);
    const replay = await put({ operationId: OP, expectedRevision: 0, document });
    assert.equal((await replay.json()).replay, true);
    const changed = createDocument({ seed: 42, baseRevision: 'terrain-s21-v1', objects: [createDecoration({ id: 'crate-1', assetId: 'prop:storage-crate', position: { x: 1, y: 0, z: 1 } })] });
    const reused = await put({ operationId: OP, expectedRevision: 0, document: changed });
    assert.equal(reused.status, 400); assert.deepEqual(await reused.json(), { ok: false, code: 'operation' });
    const conflict = await put({ operationId: '20000000-0000-4000-8000-000000000002', expectedRevision: 0, document });
    assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { ok: false, code: 'gm_draft_conflict', revision: 1 });
    const extra = await put({ operationId: OP, expectedRevision: 0, document, owner: OTHER });
    assert.equal(extra.status, 400); assert.equal((await extra.json()).code, 'operation');
    const zeroId = await put({ operationId: '00000000-0000-0000-0000-000000000000', expectedRevision: 0, document });
    assert.equal(zeroId.status, 400); assert.equal((await zeroId.json()).code, 'operation');
  });
});

test('rate limits the account, sanitizes provider errors, times out, and skips storage after an aborted auth request', async () => {
  const rate = fixture(); assert.equal(await rate.handler.prepare(), true);
  await serve(rate.handler, async (url) => {
    let last;
    for (let i = 0; i < 31; i++) last = await fetch(`${url}/api/gm/draft`, { headers: auth() });
    assert.equal(last.status, 429); assert.deepEqual(await last.json(), { ok: false, code: 'gm_draft_rate' });
  });

  const provider = fixture(); assert.equal(await provider.handler.prepare(), true); provider.store.loadError = true;
  await serve(provider.handler, async (url) => {
    const response = await fetch(`${url}/api/gm/draft`, { headers: auth() });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, code: 'gm_drafts_unavailable' });
  });

  const slow = fixture({ timeoutMs: 20 });
  slow.store.checkGmDrafts = async () => ({ version: 1 });
  // The timeout wraps provider operations after readiness as well as initial probing.
  assert.equal(await slow.handler.prepare(), true);
  slow.store.loadGmDraft = () => new Promise(() => {});
  await serve(slow.handler, async (url) => {
    const response = await fetch(`${url}/api/gm/draft`, { headers: auth() });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, code: 'gm_drafts_unavailable' });
  });

  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let loaded = false;
  const aborted = fixture({ resolver: (_req, _options, { signal }) => new Promise((resolve) => {
    startedResolve(); signal.addEventListener('abort', () => resolve(null), { once: true });
  }) });
  const originalLoad = aborted.store.loadGmDraft;
  aborted.store.loadGmDraft = (...args) => { loaded = true; return originalLoad(...args); };
  await aborted.handler.prepare();
  const server = http.createServer((req, res) => { void aborted.handler.handle(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = http.get(`http://127.0.0.1:${server.address().port}/api/gm/draft`, { headers: auth() });
  request.on('error', () => {});
  await started;
  request.destroy();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await new Promise((resolve) => server.close(resolve));
  assert.equal(loaded, false);
});

test('PUT rejects incompatible base and unavailable assets; methods, size, and memory mode are bounded', async () => {
  const f = fixture({ validateReferences: (doc) => doc.objects.length === 0 }); assert.equal(await f.handler.prepare(), true);
  await serve(f.handler, async (url) => {
    const put = (body, headers = {}) => fetch(`${url}/api/gm/draft`, { method: 'PUT', headers: { ...auth(), 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const wrongBase = { ...f.document, base: { ...f.document.base, revision: 'old' } };
    assert.equal((await put({ operationId: OP, expectedRevision: 0, document: wrongBase })).status, 400);
    const badRef = { ...f.document, objects: [{ id: 'x', assetId: 'missing', transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, collider: 'none' }] };
    assert.equal((await put({ operationId: OP, expectedRevision: 0, document: badRef })).status, 400);
    const method = await fetch(`${url}/api/gm/draft`, { method: 'POST', headers: auth() });
    assert.equal(method.status, 405);
    const oversized = await fetch(`${url}/api/gm/draft`, { method: 'PUT', headers: { ...auth(), 'content-type': 'application/json' }, body: ' '.repeat(5 * 1024 * 1024 + 2049) });
    assert.equal(oversized.status, 413);
  });
  const memory = fixture({ durable: false });
  assert.equal(await memory.handler.prepare(), false);
});

