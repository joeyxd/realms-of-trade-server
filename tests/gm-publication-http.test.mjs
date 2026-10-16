import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGmDraftHandler } from '../server/gmDraftHttp.mjs';
import { createDocument } from '../src/editor/document.js';

const GM = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const worldId = 'published-world';
const seed = 42;
const baseRevision = 'terrain-s21-v1';
const savedAt = '2026-10-10T12:00:00.000Z';
const document = createDocument({ seed, baseRevision });
const response = { report: { valid: true, issues: [] }, revision: { id: 'map-r2', hash: 'abc123' } };
const auth = (token = 'gm') => ({ authorization: `Bearer ${token}` });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ timeoutMs = 1000, publicationOverrides = {}, storeOverrides = {}, resolver = null } = {}) {
  let head = { revision: 1, document, savedAt };
  let loads = 0;
  const loadInputs = [], saveCalls = [];
  const store = {
    durable: true,
    async checkGmDrafts() { return { version: 1 }; },
    async loadGmDraft(input) {
      loads++; loadInputs.push(structuredClone(input));
      if (storeOverrides.loadGmDraft) return storeOverrides.loadGmDraft({ input, loads, head });
      return head;
    },
    async saveGmDraft(input) { saveCalls.push(input); throw new Error('draft storage must remain read-only during preparation'); },
  };
  const publication = {
    async prepare() { return true; },
    async build(input) { return { ...response, input }; },
    ...publicationOverrides,
  };
  const handler = createGmDraftHandler({ store, resolvePlayer: resolver || (async (_req, { token }) =>
    token === 'gm' ? GM : token === 'other' ? OTHER : null), accountIds: [GM], worldId, seed, baseRevision,
    validateReferences: (value) => value, publication, timeoutMs });
  return { handler, store, publication, get head() { return head; }, set head(value) { head = value; },
    get loads() { return loads; }, loadInputs, saveCalls };
}

async function serve(handler, run) {
  const server = http.createServer((req, res) => {
    void handler.handle(req, res, { prepareRevision: new URL(req.url, 'http://localhost').pathname === '/api/gm/prepare' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function post(url, body = { expectedRevision: 1 }, headers = auth()) {
  return fetch(`${url}/api/gm/prepare`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('preparation authenticates GM users and enforces method, content type, and exact body shape', async () => {
  const f = fixture(); assert.equal(await f.handler.prepare(), true);
  await serve(f.handler, async (url) => {
    assert.equal((await post(url, { expectedRevision: 1 }, {})).status, 401);
    const other = await post(url, { expectedRevision: 1 }, auth('other'));
    assert.equal(other.status, 403);
    const get = await fetch(`${url}/api/gm/prepare`, { headers: auth() });
    assert.equal(get.status, 405); assert.equal(get.headers.get('allow'), 'POST');
    const wrongType = await fetch(`${url}/api/gm/prepare`, { method: 'POST', headers: { ...auth(), 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(wrongType.status, 415);
    const extra = await post(url, { expectedRevision: 1, document });
    assert.equal(extra.status, 400); assert.deepEqual(await extra.json(), { ok: false, code: 'operation' });
    const valid = await post(url);
    assert.equal(valid.status, 200);
  });
});

test('preparation derives owner and world, reloads the same saved head before and after build, and never saves', async () => {
  const f = fixture(); let built;
  f.publication.build = async (input) => { built = input; return response; };
  assert.equal(await f.handler.prepare(), true);
  await serve(f.handler, async (url) => {
    const result = await post(url);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { ok: true, durable: true,
      scope: { worldId, seed, baseRevision }, headRevision: 1, preparation: response });
  });
  assert.equal(f.loads, 2);
  assert.deepEqual(f.loadInputs, [{ world: worldId, owner: GM }, { world: worldId, owner: GM }]);
  assert.deepEqual(built, { document, draftRevision: 1 });
  assert.equal(f.saveCalls.length, 0);
});

test('expected revision conflict skips build and releases exclusion for the next valid request', async () => {
  const f = fixture(); let builds = 0;
  f.publication.build = async () => { builds++; return response; };
  await f.handler.prepare();
  await serve(f.handler, async (url) => {
    const conflict = await post(url, { expectedRevision: 8 });
    assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { ok: false, code: 'gm_draft_conflict', revision: 1 });
    assert.equal((await post(url)).status, 200);
  });
  assert.equal(builds, 1); assert.equal(f.saveCalls.length, 0);
});

test('head changing during build returns conflict and does not publish a stale result', async () => {
  const f = fixture(); const started = deferred(), finish = deferred();
  f.publication.build = async () => { started.resolve(); return finish.promise; };
  await f.handler.prepare();
  await serve(f.handler, async (url) => {
    const pending = post(url);
    await started.promise;
    f.head = { revision: 2, document, savedAt: '2026-10-10T12:01:00.000Z' };
    finish.resolve(response);
    const result = await pending;
    assert.equal(result.status, 409);
    assert.deepEqual(await result.json(), { ok: false, code: 'gm_draft_conflict', revision: 2 });
  });
  assert.equal(f.saveCalls.length, 0);
});

test('build errors are sanitized and draft GET remains available', async () => {
  const f = fixture({ publicationOverrides: { async build() { throw new Error('secret compiler credentials'); } } });
  await f.handler.prepare();
  await serve(f.handler, async (url) => {
    const failed = await post(url);
    assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { ok: false, code: 'gm_preparation_unavailable' });
    const get = await fetch(`${url}/api/gm/draft`, { headers: auth() });
    assert.equal(get.status, 200); assert.equal((await get.json()).head.revision, 1);
  });
  assert.equal(f.saveCalls.length, 0);
});

test('only one build runs at once and concurrent preparation returns gm_preparation_busy', async () => {
  const f = fixture(); const started = deferred(), finish = deferred(); let builds = 0;
  f.publication.build = async () => { builds++; started.resolve(); return finish.promise; };
  await f.handler.prepare();
  await serve(f.handler, async (url) => {
    const first = post(url); await started.promise;
    const second = await post(url);
    assert.equal(second.status, 503); assert.deepEqual(await second.json(), { ok: false, code: 'gm_preparation_busy' });
    finish.resolve(response);
    assert.equal((await first).status, 200);
  });
  assert.equal(builds, 1); assert.equal(f.saveCalls.length, 0);
});

test('timeout retains the build lock until underlying work settles, then permits a new build', async () => {
  const f = fixture({ timeoutMs: 30 }); const started = deferred(), finish = deferred(); let builds = 0;
  f.publication.build = async () => {
    builds++;
    if (builds === 1) { started.resolve(); return finish.promise; }
    return response;
  };
  await f.handler.prepare();
  await serve(f.handler, async (url) => {
    const timed = post(url); await started.promise;
    const firstResult = await timed;
    assert.equal(firstResult.status, 503); assert.deepEqual(await firstResult.json(), { ok: false, code: 'gm_preparation_unavailable' });
    const busy = await post(url);
    assert.equal(busy.status, 503); assert.deepEqual(await busy.json(), { ok: false, code: 'gm_preparation_busy' });
    finish.resolve(response);
    while (builds !== 1) await new Promise((resolve) => setTimeout(resolve, 1));
    // The build promise's finally callback releases exclusion after resolution.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const recovered = await post(url);
    assert.equal(recovered.status, 200);
  });
  assert.equal(builds, 2); assert.equal(f.saveCalls.length, 0);
});

test('publication readiness failure blocks only prepare while draft reads remain available', async () => {
  const f = fixture({ publicationOverrides: { async prepare() { throw new Error('private readiness error'); } } });
  assert.equal(await f.handler.prepare(), true);
  await serve(f.handler, async (url) => {
    const blocked = await post(url);
    assert.equal(blocked.status, 503); assert.deepEqual(await blocked.json(), { ok: false, code: 'gm_preparation_unavailable' });
    const get = await fetch(`${url}/api/gm/draft`, { headers: auth() });
    assert.equal(get.status, 200); assert.equal((await get.json()).head.revision, 1);
  });
});

test('abort after loading the head prevents compilation', async () => {
  const loaded = deferred(), continueLoad = deferred(); let builds = 0;
  const f = fixture({ storeOverrides: { loadGmDraft: async ({ loads, head }) => {
    if (loads === 1) { loaded.resolve(); await continueLoad.promise; }
    return head;
  } }, publicationOverrides: { async build() { builds++; return response; } } });
  await f.handler.prepare();
  const server = http.createServer((req, res) => { void f.handler.handle(req, res, { prepareRevision: true }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = http.request(`http://127.0.0.1:${server.address().port}/api/gm/prepare`, {
    method: 'POST', headers: { ...auth(), 'content-type': 'application/json', 'content-length': Buffer.byteLength('{"expectedRevision":1}') },
  });
  request.on('error', () => {}); request.end('{"expectedRevision":1}');
  await loaded.promise; request.destroy();
  // Let Node deliver the request/response close event before releasing the storage read.
  await new Promise((resolve) => setTimeout(resolve, 20));
  continueLoad.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => server.close(resolve));
  assert.equal(builds, 0); assert.equal(f.saveCalls.length, 0);
});
