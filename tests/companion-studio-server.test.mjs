import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
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
  studio = await createCompanionStudio({ directory, baseUrl: draft.baseUrl, modelId: draft.modelId,
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
  const reopened = await createCompanionStudio({ directory: access.directory, baseUrl: draft.baseUrl, modelId: draft.modelId,
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
