import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPresentationStore } from '../server/presentationStore.mjs';
import { createPresentationHandler } from '../server/presentationHttp.mjs';
import { emptyPresentationBindings } from '../src/data/presentationBindings.js';
const GM = '77777777-7777-4777-8777-777777777777', OTHER = '88888888-8888-4888-8888-888888888888';
async function fixture(t, configured = true) {
  const store = createPresentationStore();
  const handler = createPresentationHandler({ store, accountIds: configured ? [GM] : null,
    resolvePlayer: async (_req, hello) => hello.token === 'gm' ? GM : hello.token === 'other' ? OTHER : null });
  const server = http.createServer((req, res) => void handler(req, res, req.url.startsWith('/api/gm/')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, store, get: headers => fetch(origin + '/api/world/presentation', { headers }),
    put: (token, body) => fetch(origin + '/api/gm/presentation', { method: 'PUT', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }) };
}
test('public GET 200/304 and authenticated PUT 401/403/400/409/413/200', async t => {
  const f = await fixture(t), body = { expectedRevision: 0, document: emptyPresentationBindings() };
  let response = await f.get(); assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), '"p0"'); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { revision: 0, document: body.document });
  response = await f.get({ 'if-none-match': '"p0"' }); assert.equal(response.status, 304); assert.equal(await response.text(), '');
  assert.equal((await f.put(null, body)).status, 401); assert.equal((await f.put('bad', body)).status, 401);
  assert.equal((await f.put('other', body)).status, 403);
  for (const invalid of ['{', { ...body, document: {} }, { ...body, expectedRevision: -1 }, { ...body, updatedBy: OTHER }]) {
    response = await f.put('gm', invalid); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'invalid');
  }
  assert.equal((await f.put('gm', ' '.repeat(8193))).status, 413);
  const chunked = await new Promise((resolve, reject) => {
    const request = http.request(f.origin + '/api/gm/presentation', { method: 'PUT', headers: { authorization: 'Bearer gm' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.write(' '.repeat(5000)); request.end(' '.repeat(5000));
  });
  assert.equal(chunked, 413);
  response = await f.put('gm', body); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { revision: 1 });
  response = await f.put('gm', body); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'stale', revision: 1 });
  assert.equal((await f.store.get()).updatedBy, GM);
  response = await f.get(); assert.equal(response.headers.get('etag'), '"p1"'); assert.equal((await response.json()).revision, 1);
});
test('unconfigured GM publishing is forbidden; public read stays available', async t => {
  const f = await fixture(t, false);
  assert.equal((await f.get()).status, 200);
  assert.equal((await f.put('gm', {})).status, 403);
});
