import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { DEFAULT_COMPANION_DRAFT } from '../src/net/companionTemplates.js';
import { createCompanionStudio } from '../tools/agent/companion-studio-server.mjs';
import { createLocalOpenAIMind } from '../tools/agent/local-openai-mind.mjs';

const limits = { maxCalls: 8, maxTokens: 200000 };
const draft = { ...DEFAULT_COMPANION_DRAFT, name: 'Brisa', modelId: 'qwen3.8-flash-next-coder-iq1_m',
  baseUrl: 'http://127.0.0.1:8080/v1', thinkingMode: 'disabled' };

async function studioFixture(t, options = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'mn-companion-studio-test-'));
  const directory = join(parent, 'companion');
  let studio;
  t.after(async () => {
    await studio?.close().catch(() => {});
    await rm(parent, { recursive: true, force: true });
  });
  studio = await createCompanionStudio({ directory, inferenceHome: join(parent, 'inference'), baseUrl: draft.baseUrl, modelId: draft.modelId,
    ...(options.adapterFactory ? { adapterFactory: options.adapterFactory } : {}) });
  const access = await studio.listen();
  return { parent, directory, studio, replaceStudio: next => { studio = next; }, ...access };
}

function headers(access, extra = {}) {
  return { Authorization: `Bearer ${access.key}`, Origin: access.origin, 'Content-Type': 'application/json', ...extra };
}
async function post(access, route, body, extraHeaders = {}) {
  return fetch(`${access.origin}${route}`, { method: 'POST', headers: headers(access, extraHeaders), body: JSON.stringify(body) });
}
async function json(response) { return response.json(); }
function continuityAdapterFactory(metrics) {
  return () => ({
    id: 'continuity-test-adapter', countMode: 'estimated_tokens',
    localResourcePolicy: { baseUrl: draft.baseUrl, modelId: draft.modelId, thinkingMode: draft.thinkingMode },
    countText: text => Buffer.byteLength(text, 'utf8'),
    prepare(request) {
      const body = JSON.stringify(request), inputTokens = Buffer.byteLength(body, 'utf8') + 1024;
      return { body, inputTokens, maxCostUnits: inputTokens + request.maxOutputTokens };
    },
    async complete({ body }) {
      metrics.calls++;
      const packet = JSON.parse(body), sources = packet.context?.required?.tools?.memoryCompaction?.sources;
      let response;
      if (Array.isArray(sources)) {
        metrics.compactionSources = sources.map(source => source.id);
        response = { v: 1, decision: { type: 'summarize_memory', args: {
          text: 'Plan comunicado de balsa', tags: [], basis: sources.map(source => source.id) } } };
      } else {
        response = { v: 1, decision: { type: 'reply', args: { text: '¡Afirmativo, capitana!' } } };
      }
      const text = JSON.stringify(response);
      return { text, usage: { inputTokens: 1200, outputTokens: 80, costUnits: 1280 } };
    },
  });
}
async function rawRequest(origin, path, { method = 'GET', headers: requestHeaders = {}, body = '' } = {}) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: Number(url.port), path, method, headers: requestHeaders }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'), json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('studio serves only declared static paths and requires local owner auth for state and mutations', async (t) => {
  const access = await studioFixture(t);
  for (const [route, type] of [['/', 'text/html'], ['/main.js', 'text/javascript'], ['/style.css', 'text/css'], ['/companionTemplates.js', 'text/javascript']]) {
    const response = await fetch(`${access.origin}${route}`);
    assert.equal(response.status, 200, `${route} is a public static asset`);
    assert.match(response.headers.get('content-type'), new RegExp(type));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const state = await fetch(`${access.origin}/api/state`);
  assert.equal(state.status, 401);
  assert.equal((await json(state)).why, 'unauthorized');
  const authorized = await fetch(`${access.origin}/api/state`, { headers: { Authorization: `Bearer ${access.key}` } });
  const snapshot = await json(authorized);
  assert.equal(authorized.status, 200);
  assert.equal(snapshot.created, false);
  assert.equal(snapshot.status.state, 'not_created');
  assert.equal(snapshot.status.public, false);
  assert.equal(snapshot.models[0], draft.modelId);

  const privateAsset = await fetch(`${access.origin}/main.js?cache=1`, { headers: { Authorization: `Bearer ${access.key}` } });
  assert.equal(privateAsset.status, 404, 'query variants are not static-file aliases');
  const unknown = await fetch(`${access.origin}/api/unknown`, { headers: { Authorization: `Bearer ${access.key}` } });
  assert.equal(unknown.status, 404);
  assert.equal((await json(unknown)).why, 'route_unavailable');
});

test('Host and Origin fences reject cross-site reads and writes', async (t) => {
  const access = await studioFixture(t);
  const badHost = await rawRequest(access.origin, '/api/state', { headers: { Authorization: `Bearer ${access.key}`, Host: 'attacker.example' } });
  assert.equal(badHost.status, 403);
  assert.equal(badHost.json().why, 'origin_rejected');
  const badOriginRead = await fetch(`${access.origin}/api/state`, { headers: { Authorization: `Bearer ${access.key}`, Origin: 'http://attacker.example' } });
  assert.equal(badOriginRead.status, 403);
  assert.equal((await json(badOriginRead)).why, 'origin_rejected');
  const badOriginWrite = await post(access, '/api/create', { draft, limits }, { Origin: 'http://attacker.example' });
  assert.equal(badOriginWrite.status, 403);
  assert.equal((await json(badOriginWrite)).why, 'origin_rejected');
  const missingOrigin = await fetch(`${access.origin}/api/create`, { method: 'POST',
    headers: { Authorization: `Bearer ${access.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ draft, limits }) });
  assert.equal(missingOrigin.status, 403);
  assert.equal((await json(missingOrigin)).why, 'origin_required');
});

test('continuity routes enforce exact bodies and the local owner fences', async (t) => {
  const access = await studioFixture(t);
  const routes = [
    ['/api/context/refresh', {}, { extra: true }],
    ['/api/memory/compact', { sourceIds: ['episode:' + 'a'.repeat(64)] }, { sourceIds: ['episode:' + 'a'.repeat(64)], extra: true }],
    ['/api/continuity', { autoCompact: false }, { autoCompact: false, extra: true }],
  ];
  for (const [route, valid, extra] of routes) {
    const missingAuth = await fetch(`${access.origin}${route}`, { method: 'POST', headers: {
      Origin: access.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(valid) });
    assert.equal(missingAuth.status, 401, `${route} requires owner authentication`);
    assert.equal((await json(missingAuth)).why, 'unauthorized');
    const missingOrigin = await fetch(`${access.origin}${route}`, { method: 'POST', headers: {
      Authorization: `Bearer ${access.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(valid) });
    assert.equal(missingOrigin.status, 403, `${route} requires the local Origin`);
    assert.equal((await json(missingOrigin)).why, 'origin_required');
    const wrongOrigin = await post(access, route, valid, { Origin: 'http://attacker.example' });
    assert.equal(wrongOrigin.status, 403, `${route} rejects cross-origin access`);
    assert.equal((await json(wrongOrigin)).why, 'origin_rejected');
    const extraResponse = await post(access, route, extra);
    assert.equal(extraResponse.status, 400, `${route} rejects extra fields`);
    assert.equal((await json(extraResponse)).why, 'invalid_request');
  }
  for (const [route, body] of [
    ['/api/context/refresh', { unexpected: true }],
    ['/api/memory/compact', {}], ['/api/memory/compact', { sourceIds: [] }],
    ['/api/memory/compact', { sourceIds: ['not-an-episode'] }],
    ['/api/memory/compact', { sourceIds: [42] }],
    ['/api/memory/compact', { sourceIds: ['episode:' + 'a'.repeat(64), 'episode:' + 'a'.repeat(64)] }],
    ['/api/memory/compact', { sourceIds: Array.from({ length: 9 }, (_, i) => `episode:${i.toString(16).padStart(64, '0')}`) }],
    ['/api/continuity', {}], ['/api/continuity', { autoCompact: 'true' }],
  ]) {
    const response = await post(access, route, body);
    assert.equal(response.status, 400, `${route} rejects ${JSON.stringify(body)}`);
    assert.equal((await json(response)).why, 'invalid_request');
  }
});

test('context refresh works while stopped without starting a session, inferring, or resetting budget', { timeout: 30000 }, async (t) => {
  const metrics = { calls: 0, compactionSources: [] };
  const access = await studioFixture(t, { adapterFactory: continuityAdapterFactory(metrics) });
  assert.equal((await (await post(access, '/api/create', { draft, limits })).json()).created, true);
  assert.equal((await post(access, '/api/start', {})).status, 200);
  const chat = await post(access, '/api/chat', { text: '¿Qué acordamos en el muelle?' });
  assert.equal(chat.status, 200, JSON.stringify(await json(chat)));
  assert.equal(metrics.calls, 1, 'the fixture performs one simulated chat inference');
  assert.equal((await post(access, '/api/stop', {})).status, 200);

  const before = await fetch(`${access.origin}/api/state`, { headers: { Authorization: `Bearer ${access.key}` } }).then(json);
  assert.equal(before.status.state, 'stopped');
  assert.ok(before.budget.totals.confirmedTokens > 0);
  const refresh = await post(access, '/api/context/refresh', {});
  const result = await json(refresh);
  assert.equal(refresh.status, 200, JSON.stringify(result));
  assert.equal(result.state, 'stopped');
  assert.equal(result.budgetReset, false);
  assert.equal(metrics.calls, 1, 'context refresh does not call the provider');
  const after = await fetch(`${access.origin}/api/state`, { headers: { Authorization: `Bearer ${access.key}` } }).then(json);
  assert.equal(after.status.state, 'stopped');
  assert.equal(after.status.sessionId, before.status.sessionId);
  assert.deepEqual(after.budget.totals, before.budget.totals, 'the existing allowance is preserved');
  assert.equal(after.continuity.lastRefresh.reason, 'manual_refresh');
});

test('opt-in is local policy only and a simulated chat episode can be summarized with its original retained', { timeout: 30000 }, async (t) => {
  const metrics = { calls: 0, compactionSources: [] };
  const access = await studioFixture(t, { adapterFactory: continuityAdapterFactory(metrics) });
  await post(access, '/api/create', { draft, limits });
  const optIn = await post(access, '/api/continuity', { autoCompact: true });
  assert.equal(optIn.status, 200);
  assert.equal((await json(optIn)).autoCompact, true);
  assert.equal(metrics.calls, 0, 'changing the opt-in does not call the adapter');
  const stateAfterOptIn = await fetch(`${access.origin}/api/state`, { headers: { Authorization: `Bearer ${access.key}` } }).then(json);
  assert.equal(stateAfterOptIn.continuity.autoCompact, true);
  assert.equal(stateAfterOptIn.continuity.automaticSummaryLimit, 1);

  await post(access, '/api/continuity', { autoCompact: false });
  assert.equal((await post(access, '/api/start', {})).status, 200);
  const chat = await post(access, '/api/chat', { text: 'Dejamos la balsa junto al almacén.' });
  const chatResult = await json(chat);
  assert.equal(chat.status, 200, JSON.stringify(chatResult));
  const chatCalls = metrics.calls;
  assert.equal(chatCalls, 1, 'the delivered chat uses exactly one simulated inference, without retries');
  const before = await fetch(`${access.origin}/api/state`, { headers: { Authorization: `Bearer ${access.key}` } }).then(json);
  const episode = before.continuity.sources.find(source => source.id.startsWith('episode:'));
  assert.ok(episode, 'the delivered chat produces a saved episode');
  const originalJournal = before.files.memory.content;
  assert.ok(originalJournal.includes(episode.id));

  const compact = await post(access, '/api/memory/compact', { sourceIds: [episode.id] });
  const compactResult = await json(compact);
  assert.equal(compact.status, 200, JSON.stringify(compactResult));
  assert.deepEqual(metrics.compactionSources, [episode.id], 'the adapter receives the requested pinned source');
  assert.equal(metrics.calls, chatCalls + 1, 'summary uses exactly one separate simulated inference');
  const after = await fetch(`${access.origin}/api/state`, { headers: { Authorization: `Bearer ${access.key}` } }).then(json);
  assert.equal(after.continuity.journal.episodes, 1);
  assert.equal(after.continuity.journal.summaries, 1);
  assert.ok(after.files.memory.content.includes(episode.id), 'the original episode remains in the journal');
  const entries = after.files.memory.content.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const summary = entries.find(entry => entry.kind === 'summary');
  assert.ok(summary, 'a summary entry is persisted');
  assert.equal(summary.payload.text, 'Plan comunicado de balsa');
  assert.deepEqual(summary.payload.sources.map(source => source.id), [episode.id]);
  assert.equal(after.continuity.lastSummary.ok, true);
  assert.deepEqual(after.continuity.lastSummary.sourceIds, [episode.id]);
});

test('create requires the exact schema and does not infer until explicit start', { timeout: 30000 }, async (t) => {
  let adapterConstructions = 0, inferenceCalls = 0;
  const access = await studioFixture(t, { adapterFactory: () => {
    adapterConstructions++;
    const adapter = createLocalOpenAIMind({ baseUrl: draft.baseUrl, modelId: draft.modelId, thinkingMode: draft.thinkingMode,
      maxCalls: 8, maxOutputTokens: 512, timeoutMs: 30000 });
    return { ...adapter, async complete(request) { inferenceCalls++; return adapter.complete(request); } };
  } });
  const extra = await post(access, '/api/create', { draft, limits, extra: true });
  assert.equal(extra.status, 400);
  assert.equal((await json(extra)).why, 'invalid_request');
  assert.equal(adapterConstructions, 0);

  const tooLarge = await fetch(`${access.origin}/api/create`, { method: 'POST', headers: headers(access),
    body: JSON.stringify({ draft, limits, padding: 'x'.repeat(17000) }) });
  assert.equal(tooLarge.status, 400);
  assert.equal((await json(tooLarge)).why, 'invalid_request');

  const createdResponse = await post(access, '/api/create', { draft, limits });
  assert.equal(createdResponse.status, 200);
  const created = await json(createdResponse);
  assert.equal(created.created, true);
  assert.equal(created.draft.name, 'Brisa');
  assert.equal(created.status.state, 'stopped');
  assert.equal(created.status.connected, false);
  assert.equal(created.status.public, false);
  assert.equal(created.files.memory.content, '', 'new companion starts with deliberately empty memory');
  assert.equal(created.budget.costNanoUsd, null);
  assert.equal(created.budget.totals.confirmedTokens, 0);
  assert.equal(adapterConstructions, 0, 'create does not construct a model adapter');
  assert.equal(inferenceCalls, 0);

  const invalidStart = await post(access, '/api/start', { unexpected: true });
  assert.equal(invalidStart.status, 400);
  const started = await post(access, '/api/start', {});
  const startedBody = await json(started);
  assert.equal(started.status, 200, `${JSON.stringify(startedBody)} (adapter constructions: ${adapterConstructions})`);
  assert.equal(adapterConstructions, 1, 'adapter is created only after explicit start');
  assert.equal(inferenceCalls, 0, 'start connects to the local game but does not make an inference call');
  const running = await fetch(`${access.origin}/api/state`, { headers: { Authorization: `Bearer ${access.key}` } }).then(json);
  assert.equal(running.status.state, 'ready');
  assert.equal(running.status.connected, true);

  const stopped = await post(access, '/api/stop', {});
  const stoppedBody = await json(stopped);
  assert.equal(stopped.status, 200, JSON.stringify(stoppedBody));
  assert.equal(stoppedBody.state, 'stopped');
  await access.studio.close();
  const reopened = await createCompanionStudio({ directory: access.directory, inferenceHome: join(access.parent, 'inference'), baseUrl: draft.baseUrl, modelId: draft.modelId,
    adapterFactory: () => { adapterConstructions++; const adapter = createLocalOpenAIMind({ baseUrl: draft.baseUrl,
      modelId: draft.modelId, thinkingMode: draft.thinkingMode, maxCalls: 8, maxOutputTokens: 512, timeoutMs: 30000 });
      return { ...adapter, async complete(request) { inferenceCalls++; return adapter.complete(request); } }; } });
  access.replaceStudio(reopened);
  const newAccess = await reopened.listen();
  const restored = await fetch(`${newAccess.origin}/api/state`, { headers: { Authorization: `Bearer ${newAccess.key}` } }).then(json);
  assert.equal(restored.created, true);
  assert.equal(restored.status.state, 'stopped', 'existing local runtime is restored stopped');
  assert.equal(restored.status.connected, false);
  assert.equal(adapterConstructions, 1, 'opening a saved runtime does not instantiate an adapter');
  assert.equal(inferenceCalls, 0);
});


test('inference routes enforce exact schemas, bearer and Origin before companion creation', async t => {
  const access = await studioFixture(t);
  const routes = [
    ['/api/inference/endpoint', { endpoint: { id: null, label: 'Local', baseUrl: 'https://example.invalid/v1', apiKey: 'secret-abcd', defaultModel: 'm' } }],
    ['/api/inference/endpoint/delete', { id: 'missing' }], ['/api/inference/probe', { id: 'missing' }],
    ['/api/inference/test', { id: 'missing', modelId: 'm', prompt: 'Hola' }], ['/api/inference/select', { id: 'missing', modelId: 'm' }],
  ];
  for (const [route, body] of routes) {
    assert.equal((await fetch(`${access.origin}${route}`, { method: 'POST', headers: { Origin: access.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(`${access.origin}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${access.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
    assert.equal((await post(access, route, body, { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await post(access, route, { ...body, extra: 1 })).status, 400);
  }
  assert.equal((await post(access, routes[0][0], routes[0][1])).status, 200);
  for (const [route, body] of routes.slice(1)) {
    const response = await post(access, route, body); assert.equal(response.status, 404); assert.equal((await response.json()).why, 'endpoint_unknown');
  }
  for (const body of [{ endpoint: {} }, { endpoint: { ...routes[0][1].endpoint, extra: true } }, { endpoint: { ...routes[0][1].endpoint, baseUrl: 'ftp://invalid' } }]) {
    const response = await post(access, '/api/inference/endpoint', body); assert.equal(response.status, 400); assert.equal((await response.json()).why, 'invalid_request');
  }
  const state = await access.studio.view(); assert.equal(state.inference.endpoints[0].keyHint, 'abcd');
  assert.doesNotMatch(JSON.stringify(state), /secret-abcd|apiKey/);
});

test('inference routes probe, select, test usage, persist and delete with correct status codes', async t => {
  let broken = false, calls = 0;
  const provider = createServer(async (req, res) => {
    calls++; assert.equal(req.headers.authorization, 'Bearer key-1234');
    if (broken) { res.writeHead(502); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }] })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const packet = JSON.parse(Buffer.concat(chunks)); assert.equal(packet.model, 'model-b');
    res.end(JSON.stringify({ model: 'model-b', choices: [{ index: 0, message: { role: 'assistant', content: 'x'.repeat(2100) }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
  });
  await new Promise(done => provider.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { provider.closeAllConnections(); provider.close(done); }));
  const access = await studioFixture(t);
  const endpoint = { id: null, label: 'Prueba', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'key-1234', defaultModel: 'model-b' };
  const { id } = await (await post(access, '/api/inference/endpoint', { endpoint })).json();
  assert.equal((await post(access, '/api/inference/probe', { id })).status, 200);
  assert.equal((await post(access, '/api/inference/select', { id, modelId: 'unknown' })).status, 400);
  assert.equal((await post(access, '/api/inference/select', { id, modelId: 'model-b' })).status, 200);
  const state = await access.studio.view(); assert.deepEqual(state.models, [draft.modelId]); assert.deepEqual(state.inference.active, { endpointId: id, modelId: 'model-b' });
  for (const body of [{ id, modelId: '', prompt: 'Hi' }, { id, modelId: 'model-b', prompt: '' }, { id, modelId: 'model-b', prompt: 'x'.repeat(2001) }, { id, modelId: 'm'.repeat(201), prompt: 'Hi' }, { id: 4, modelId: 'm', prompt: 'Hi' }]) assert.equal((await post(access, '/api/inference/test', body)).status, 400);
  const response = await post(access, '/api/inference/test', { id, modelId: 'model-b', prompt: 'Hola' });
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.text.length, 2000); assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 3 }); assert.equal(result.status, 200);
  broken = true;
  assert.equal((await post(access, '/api/inference/probe', { id })).status, 409);
  assert.equal((await post(access, '/api/inference/test', { id, modelId: 'model-b', prompt: 'Hola' })).status, 409);
  assert.equal(calls, 4);
  assert.deepEqual((await access.studio.view()).inference.endpoints[0].models, ['model-a', 'model-b']);
  assert.equal((await access.studio.view()).inference.endpoints[0].usage.failures, 1);
  assert.equal((await post(access, '/api/inference/endpoint/delete', { id })).status, 200);
  assert.equal((await access.studio.view()).inference.active, null); assert.deepEqual((await access.studio.view()).models, [draft.modelId]);
});

for (const [kind, bytes] of [
  ['corrupt', Buffer.from('{broken JSON')],
  ['schema-invalid', Buffer.from(JSON.stringify({ v: 1, endpoints: [{ id: 'a'.repeat(16) }], active: null, catalog: {}, usage: {} }))],
  ['invalid catalog', Buffer.from(JSON.stringify({ v: 1, endpoints: [], active: null, catalog: [], usage: {} }))],
  ['missing active', Buffer.from(JSON.stringify({ v: 1, endpoints: [], catalog: {}, usage: {} }))],
]) {
  test(`Studio starts read-only over ${kind} inference.json, mutations return invalid_store and file bytes remain unchanged`, async t => {
    const home = await mkdtemp(join(tmpdir(), 'mn-invalid-inference-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const file = join(home, 'inference.json'); await writeFile(file, bytes);
    const studio = await createCompanionStudio({ directory: join(home, 'companion'), inferenceHome: home,
      baseUrl: draft.baseUrl, modelId: draft.modelId });
    t.after(() => studio.close());
    const access = await studio.listen();
    const response = await fetch(`${access.origin}/api/state`, { headers: headers(access) });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.deepEqual(state.inference, { endpoints: [], active: null, error: 'invalid_store' });
    assert.deepEqual(state.models, [draft.modelId]);
    for (const [route, body] of [
      ['endpoint', { endpoint: { id: null, label: 'Local', baseUrl: draft.baseUrl, defaultModel: 'm' } }],
      ['endpoint/delete', { id: 'x' }], ['probe', { id: 'x' }],
      ['test', { id: 'x', modelId: 'm', prompt: 'Hola' }], ['select', { id: 'x', modelId: 'm' }],
    ]) {
      const result = await post(access, `/api/inference/${route}`, body);
      assert.equal(result.status, 409); assert.deepEqual(await result.json(), { ok: false, why: 'invalid_store' });
    }
    assert.deepEqual(await readFile(file), bytes);
    const companion = await post(access, '/api/create', { draft, limits });
    assert.equal(companion.status, 200); assert.equal((await companion.json()).created, true);
    assert.deepEqual(await readFile(file), bytes);
  });
}


test('api/create with inference creates a bound companion and snapshot.binding survives a Studio reopen', async t => {
  const access = await studioFixture(t);
  const endpoint = { id: null, label: 'Bound', baseUrl: 'https://example.invalid/v1', apiKey: 'studio-bound-secret', defaultModel: 'bound-model' };
  const saved = await (await post(access, '/api/inference/endpoint', { endpoint })).json();
  const inference = { endpointId: saved.id, modelId: 'bound-model' };
  const created = await post(access, '/api/create', { draft, limits, inference });
  assert.equal(created.status, 200); const snapshot = await created.json();
  assert.deepEqual(snapshot.binding, inference); assert.deepEqual(snapshot.models, [draft.modelId]);
  assert.equal(snapshot.draft.baseUrl, draft.baseUrl); assert.equal(snapshot.draft.modelId, draft.modelId);
  assert.ok(!JSON.stringify(snapshot).includes(endpoint.apiKey));
  assert.deepEqual((await json(await fetch(`${access.origin}/api/state`, { headers: headers(access) }))).binding, inference);
  await access.studio.close();
  const reopened = await createCompanionStudio({ directory: access.directory, inferenceHome: join(access.parent, 'inference'),
    baseUrl: draft.baseUrl, modelId: draft.modelId }); access.replaceStudio(reopened);
  const next = await reopened.listen(); assert.deepEqual((await reopened.view()).binding, inference);
  assert.equal((await post(next, '/api/inference/endpoint/delete', { id: saved.id })).status, 200);
  const start = await post(next, '/api/start', {});
  assert.equal(start.status, 409); assert.deepEqual(await start.json(), { ok: false, why: 'endpoint_unknown' });
  assert.equal(reopened.companion.diagnostics.sessions, 0);
});

test('api/create with an unknown endpoint refuses before creating any companion files', async t => {
  const access = await studioFixture(t);
  const response = await post(access, '/api/create', { draft, limits,
    inference: { endpointId: '0000000000000000', modelId: 'm' } });
  assert.equal(response.status, 404); assert.deepEqual(await response.json(), { ok: false, why: 'endpoint_unknown' });
  await assert.rejects(readdir(access.directory), { code: 'ENOENT' });
  assert.equal((await access.studio.view()).binding, null);
});

test('api/create without inference keeps the loopback draft and runtime unchanged', async t => {
  const access = await studioFixture(t); const response = await post(access, '/api/create', { draft, limits });
  assert.equal(response.status, 200); const snapshot = await response.json();
  assert.equal(snapshot.binding, null); assert.deepEqual(snapshot.models, [draft.modelId]);
  assert.deepEqual(snapshot.draft, draft);
  assert.equal(Object.hasOwn(JSON.parse(await readFile(join(access.directory, 'local-runtime.json'))), 'inference'), false);
  assert.deepEqual(snapshot.budget.persistence.policy, { baseUrl: draft.baseUrl, modelId: draft.modelId, thinkingMode: draft.thinkingMode });
});

test('api/create rejects malformed bindings, unknown models and corrupt stores with no files', async t => {
  const access = await studioFixture(t);
  const { id } = await (await post(access, '/api/inference/endpoint', { endpoint: {
    id: null, label: 'Bound', baseUrl: 'https://example.invalid/v1', defaultModel: 'm' } })).json();
  for (const inference of [null, { endpointId: id, modelId: 'm', extra: true }, { endpointId: id, modelId: 2 },
    { endpointId: 'bad', modelId: 'm' }, { endpointId: id, modelId: 'm'.repeat(201) }]) {
    const response = await post(access, '/api/create', { draft, limits, inference });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, why: 'invalid_request' });
  }
  const missing = await post(access, '/api/create', { draft, limits, inference: { endpointId: id, modelId: 'missing' } });
  assert.equal(missing.status, 409); assert.deepEqual(await missing.json(), { ok: false, why: 'model_unknown' });
  await writeFile(join(access.parent, 'inference', 'inference.json'), '{corrupt');
  const corrupt = await post(access, '/api/create', { draft, limits, inference: { endpointId: id, modelId: 'm' } });
  assert.equal(corrupt.status, 409); assert.deepEqual(await corrupt.json(), { ok: false, why: 'invalid_store' });
  await assert.rejects(readdir(access.directory), { code: 'ENOENT' });
});
