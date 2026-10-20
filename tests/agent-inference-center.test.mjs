import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInferenceCenter } from '../tools/agent/inference-center.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'mn-inference-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const center = await createInferenceCenter({ inferenceHome: home });
  return { center, home };
}
async function fake(t, handler) {
  const server = createServer(handler);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function endpoint(baseUrl = 'https://example.invalid/v1', extra = {}) {
  return { id: null, label: 'Prueba', baseUrl, apiKey: 'secret-1234', defaultModel: 'test-model', ...extra };
}
const send = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

test('registry round-trip returns keyHint and never apiKey', async t => {
  const { center, home } = await fixture(t);
  const result = await center.save(endpoint()); assert.equal(result.ok, true); assert.match(result.id, /^[a-f0-9]{16}$/);
  const reopened = await createInferenceCenter({ inferenceHome: home });
  const view = reopened.view(), saved = view.endpoints[0];
  assert.equal(saved.keyHint, '1234'); assert.equal(saved.baseUrl, 'https://example.invalid/v1');
  assert.ok(!JSON.stringify(view).includes('apiKey')); assert.ok(!JSON.stringify(view).includes('secret-1234'));
  assert.ok(Number.isFinite(Date.parse(saved.createdAt))); assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
});

test("omitted apiKey keeps the key and '' clears it", async t => {
  const { center, home } = await fixture(t);
  const { id } = await center.save(endpoint());
  const update = endpoint(undefined, { id, label: 'Editado' }); delete update.apiKey;
  assert.equal((await center.save(update)).ok, true);
  assert.equal(JSON.parse(await readFile(join(home, 'inference.json'))).endpoints[0].apiKey, 'secret-1234');
  assert.equal((await center.save({ ...update, apiKey: '' })).ok, true);
  assert.equal(center.view().endpoints[0].keyHint, null);
});

test('probe against a local fake HTTP server serves GET /models with bounded auth headers', async t => {
  const { center } = await fixture(t); let calls = 0;
  const base = await fake(t, (req, res) => {
    calls++; assert.equal(req.method, 'GET'); assert.equal(req.url, '/models');
    assert.equal(req.headers.authorization, 'Bearer secret-1234'); assert.equal(req.headers.accept, 'application/json');
    assert.equal(req.headers['user-agent'], 'marea-negra-inference/1');
    send(res, { data: [{ id: 'z' }, { id: 'a' }, { id: 'z' }] });
  });
  const { id } = await center.save(endpoint(base));
  assert.deepEqual(await center.probe(id), { ok: true, models: ['a', 'z'] }); assert.equal(calls, 1);
});

test('probe fallback returns 404 on /models and data on /v1/models exactly once', async t => {
  const { center } = await fixture(t); const paths = [];
  const base = await fake(t, (req, res) => {
    paths.push(req.url);
    if (req.url === '/models') { res.writeHead(404); res.end(); } else send(res, { data: [{ id: 'test-model' }] });
  });
  const { id } = await center.save(endpoint(base));
  assert.equal((await center.probe(id)).ok, true); assert.deepEqual(paths, ['/models', '/v1/models']);
});

test('catalog updatedAt is set and models are capped at 2500', async t => {
  const { center } = await fixture(t);
  const base = await fake(t, (_req, res) => send(res, { data: Array.from({ length: 2600 }, (_, n) => ({ id: `m${String(n).padStart(4, '0')}` })) }));
  const { id } = await center.save(endpoint(base + '/v1/'));
  await center.probe(id);
  const saved = center.view().endpoints[0]; assert.equal(saved.models.length, 2500);
  assert.equal(saved.models.at(-1), 'm2499'); assert.ok(Number.isFinite(Date.parse(saved.catalogUpdatedAt))); assert.equal(saved.catalogError, null); assert.equal(saved.catalogCheckedAt, saved.catalogUpdatedAt);
});

test('probe failure keeps previous models and sets error without a second /v1 fallback', async t => {
  const { center } = await fixture(t); let broken = false, calls = 0;
  const base = await fake(t, (_req, res) => { calls++; if (broken) { res.writeHead(503); res.end('secret-1234'); } else send(res, { data: [{ id: 'm' }] }); });
  const { id } = await center.save(endpoint(base + '/v1'));
  await center.probe(id); const before = center.view().endpoints[0];
  await new Promise(done => setTimeout(done, 5)); broken = true;
  assert.deepEqual(await center.probe(id), { ok: false, why: 'http_status' });
  assert.equal(center.view().endpoints[0].catalogUpdatedAt, before.catalogUpdatedAt);
  assert.ok(center.view().endpoints[0].catalogCheckedAt > before.catalogCheckedAt);
  assert.deepEqual(center.view().endpoints[0].models, ['m']); assert.equal(center.view().endpoints[0].catalogError, 'http_status'); assert.equal(calls, 2);
});

test('test completion returns usage and accumulates store counters with one outbound request per call', async t => {
  const { center } = await fixture(t); let calls = 0, fail = false;
  const base = await fake(t, async (req, res) => {
    calls++; assert.equal(req.url, '/v1/chat/completions');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { model: 'test-model', messages: [{ role: 'user', content: 'Hola' }], stream: false, temperature: 0, max_tokens: 256 });
    if (fail) { res.writeHead(500); res.end(); return; }
    send(res, { model: 'test-model-2024-01-01', choices: [{ index: 0, message: { role: 'assistant', content: 'Hola capitán' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4 } });
  });
  const { id } = await center.save(endpoint(base));
  const result = await center.test(id, 'test-model', 'Hola');
  assert.equal(result.ok, true); assert.equal(result.status, 200); assert.equal(result.text, 'Hola capitán');
  assert.equal(result.servedModel, 'test-model-2024-01-01'); assert.equal(result.modelMismatch, false);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 }); assert.ok(result.latencyMs >= 0);
  await center.test(id, 'test-model', 'Hola'); fail = true;
  assert.equal((await center.test(id, 'test-model', 'Hola')).why, 'http_status'); assert.equal(calls, 3);
  const usage = center.view().endpoints[0].usage;
  assert.equal(usage.requests, 3); assert.equal(usage.failures, 1); assert.equal(usage.promptTokens, 24); assert.equal(usage.completionTokens, 8);
  assert.ok(usage.latencyMsTotal >= result.latencyMs); assert.ok(Number.isFinite(Date.parse(usage.lastAt))); assert.equal(usage.lastError, 'http_status');
});

test('https baseUrl accepted; ftp and URL query rejected by validation', async t => {
  const { center } = await fixture(t);
  assert.equal((await center.save(endpoint('https://example.invalid/api/v1/'))).ok, true);
  for (const url of ['ftp://example.invalid', 'https://example.invalid/v1?query=1', 'https://example.invalid/#hash', 'https://key@example.invalid/v1', 'https://example.invalid/?', 'https://example.invalid/#']) {
    assert.equal((await center.save(endpoint(url))).why, 'invalid_request', url);
  }
});

test('unknown id gets endpoint_unknown', async t => {
  const { center } = await fixture(t);
  for (const result of [await center.delete('absent'), await center.probe('absent'), await center.select('absent', 'm'), await center.test('absent', 'm', 'Hello'), await center.save(endpoint(undefined, { id: 'absent' }))]) assert.equal(result.why, 'endpoint_unknown');
});

test('select rejects a model not in the cache and accepts the default model', async t => {
  const { center } = await fixture(t); const { id } = await center.save(endpoint());
  assert.equal((await center.select(id, 'unknown')).why, 'invalid_request');
  assert.equal((await center.select(id, 'test-model')).ok, true);
  assert.deepEqual(center.view().active, { endpointId: id, modelId: 'test-model' });
  await center.delete(id); assert.deepEqual(center.view(), { endpoints: [], active: null });
});

test("store file is written under the test's temp directory only", async t => {
  const { center, home } = await fixture(t); await center.save(endpoint());
  assert.deepEqual(await readdir(home), ['inference.json']);
  const stored = JSON.parse(await readFile(join(home, 'inference.json'), 'utf8'));
  assert.equal(stored.v, 1); assert.equal(stored.endpoints.length, 1); assert.deepEqual(stored.catalog, {}); assert.deepEqual(stored.usage, {});
});

test('registry rejects extra fields and limits endpoints, labels, keys and defaults', async t => {
  const { center } = await fixture(t);
  for (const extra of [{ label: '' }, { label: 'x'.repeat(65) }, { apiKey: 'x'.repeat(513) }, { apiKey: 'bad\nkey' }, { apiKey: '\u{1f30a}' }, { defaultModel: '' }, { unexpected: true }]) assert.equal((await center.save(endpoint(undefined, extra))).why, 'invalid_request');
  for (let n = 0; n < 32; n++) assert.equal((await center.save(endpoint())).ok, true);
  assert.equal((await center.save(endpoint())).why, 'invalid_request');
});

test('concurrent saves are serialized and endpoint changes invalidate cached selection', async t => {
  const { center } = await fixture(t);
  const [{ id }] = await Promise.all([center.save(endpoint()), center.save(endpoint())]);
  assert.equal(center.view().endpoints.length, 2);
  await center.select(id, 'test-model');
  await center.save(endpoint('https://new.invalid/v1', { id })); assert.equal(center.view().active, null);
});

test('probe bounds response bytes and does not follow redirects', async t => {
  const { center } = await fixture(t); let oversized = false, calls = 0;
  const base = await fake(t, (_req, res) => { calls++; if (oversized) res.end('x'.repeat(1_048_577)); else { res.writeHead(302, { location: 'https://example.invalid' }); res.end(); } });
  const { id } = await center.save(endpoint(base + '/v1'));
  assert.equal((await center.probe(id)).why, 'http_status'); assert.equal(calls, 1);
  oversized = true; assert.equal((await center.probe(id)).why, 'response_too_large'); assert.equal(calls, 2);
});

test('short keys never expose the full secret in keyHint', async t => {
  const { center } = await fixture(t);
  for (const apiKey of ['', 'abc', 'abcd', '1234567', '12345678']) {
    const { id } = await center.save(endpoint(undefined, { apiKey }));
    assert.equal(center.view().endpoints.find(endpoint => endpoint.id === id).keyHint, apiKey.length >= 8 ? '5678' : null);
  }
});

test('baseUrl length is checked after normalization and trailing slash removal', async t => {
  const { center } = await fixture(t);
  const prefix = 'https://example.invalid/';
  const normalized = prefix + 'a'.repeat(512 - prefix.length);
  assert.equal((await center.save(endpoint(normalized + '///'))).ok, true);
  assert.equal(center.view().endpoints[0].baseUrl, normalized);
  assert.equal((await center.save(endpoint(normalized + 'b'))).why, 'invalid_request');
  const unicode = prefix + 'é'.repeat(100);
  assert.ok(unicode.length < 512);
  assert.equal((await center.save(endpoint(unicode))).why, 'invalid_request');
});

test('first failed probe records checkedAt without inventing a successful catalog timestamp', async t => {
  const { center } = await fixture(t);
  const base = await fake(t, (_req, res) => { res.writeHead(503); res.end(); });
  const { id } = await center.save(endpoint(base + '/v1'));
  await center.probe(id);
  const saved = center.view().endpoints[0];
  assert.equal(saved.catalogUpdatedAt, null); assert.ok(Number.isFinite(Date.parse(saved.catalogCheckedAt)));
  assert.equal(saved.catalogError, 'http_status');
});
