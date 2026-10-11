import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createBudgetAdministration } from '../tools/agent/persistent-budget.mjs';
import { createOwnerPanel } from '../tools/agent/owner-panel-server.mjs';

const scope = { ownerId: '22222222-2222-4222-8222-222222222222', characterId: '33333333-3333-4333-8333-333333333333', worldId: '11111111-1111-4111-8111-111111111111' };
const limits = { maxCalls: 4, maxTokens: 1200, maxCostUnits: 2400, maxEntries: 8 };
const names = ['personality.md', 'objectives.json', 'memory.jsonl'];

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'marea-owner-panel-'));
  const directory = join(root, 'owner'); const budgetDirectory = join(root, 'budget');
  await mkdir(directory); await mkdir(budgetDirectory);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory, budgetDirectory };
}

async function writeOwner(directory, { personality = '# Brisa\r\nHabla con calma.\r\n', memory = '' } = {}) {
  await writeFile(join(directory, 'personality.md'), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from(personality)]));
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 7, scope,
    goals: [{ id: 'keep-safe', status: 'active', text: 'Keep the crew safe.', constraints: ['No purchases'] }] }));
  await writeFile(join(directory, 'memory.jsonl'), memory);
}

async function budget(budgetDirectory, forScope = scope, configuredLimits = limits) {
  const admin = createBudgetAdministration({ directory: budgetDirectory, scope: forScope });
  const now = Date.now();
  const initialized = await admin.initialize({ allowanceId: 'panel-allowance',
    period: { startsAtMs: now - 60000, endsAtMs: now + 3600000 }, limits: configuredLimits });
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  return admin;
}

async function setup(t, options = {}) {
  const paths = await tempRoot(t); await writeOwner(paths.directory, options.owner);
  const admin = options.initializeBudget === false ? null : await budget(paths.budgetDirectory, options.budgetScope ?? scope);
  const panel = await createOwnerPanel({ ...paths, scope, ...(options.runner ? { runner: options.runner } : {}) });
  const listening = await panel.listen();
  t.after(() => panel.close());
  return { ...paths, admin, panel, ...listening };
}

async function request(base, path, { method = 'GET', body, key, origin, host, headers = {} } = {}) {
  const target = new URL(path, base.origin);
  return fetch(target, { method, headers: {
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...(method !== 'GET' ? { 'content-type': 'application/json', origin: origin ?? base.origin } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(host ? { host } : {}), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function foreignHost(base, key) {
  return new Promise((resolve, reject) => {
    const target = new URL(base.origin);
    const req = httpRequest({ hostname: target.hostname, port: Number(target.port), path: '/api/view', method: 'GET',
      headers: { host: 'evil.example', authorization: `Bearer ${key}` } }, (response) => {
      response.resume(); response.once('end', () => resolve(response));
    });
    req.once('error', reject); req.end();
  });
}

function api(base, route, options = {}) {
  return request(base, `/api/${route}`, { key: base.key, ...options });
}

function stubRunner(overrides = {}) {
  const calls = [];
  return { calls, runner: {
    async inspect() { calls.push(['inspect']); return { state: 'stopped', session: null }; },
    async start() { calls.push(['start']); return { ok: true, state: 'running' }; },
    async stop() { calls.push(['stop']); return { ok: true, state: 'stopped' }; },
    async think() { calls.push(['think']); return { ok: true, result: { text: 'safe response' } }; },
    async close() { calls.push(['close']); }, ...overrides,
  } };
}

test('owner API requires the bearer key and rejects foreign origins and hosts', async (t) => {
  const { origin, key } = await setup(t);
  const missing = await fetch(`${origin}/api/view`);
  assert.equal(missing.status, 401);
  const wrong = await fetch(`${origin}/api/view`, { headers: { authorization: `Bearer ${'0'.repeat(64)}` } });
  assert.equal(wrong.status, 401);
  const foreign = await request({ origin }, '/api/start', { method: 'POST', body: {}, key, origin: 'https://evil.example' });
  assert.ok(foreign.status >= 400 && foreign.status < 500);
  const badHost = await foreignHost({ origin }, key);
  assert.ok(badHost.statusCode >= 400 && badHost.statusCode < 500);
  assert.match(key, /^[a-f0-9]{64}$/);
});

test('view is fresh, reports exact file byte hashes, and never serializes filesystem or secret data', async (t) => {
  const memory = JSON.stringify({ id: 'note-1', revision: 1, scope, text: 'note', certainty: 'confirmed', createdAtMs: 1,
    validUntilMs: null, tags: [], sources: [] }) + '\r\n';
  const { directory, origin, key, admin } = await setup(t, { owner: { memory } });
  const first = await api({ origin, key }, 'view');
  assert.equal(first.status, 200);
  const data = await first.json();
  assert.equal(data.ok, true);
  assert.deepEqual(data.scope, scope);
  assert.equal(data.budget.snapshot.persistence.cached, false);
  assert.equal(data.files.files.personality.sha256, (await import('node:crypto')).createHash('sha256').update(await readFile(join(directory, names[0]))).digest('hex'));
  assert.equal(data.files.files.memory.content, memory);
  const beforeRevision = data.budget.snapshot.persistence.revision;
  const changed = await admin.configure({ expectedRevision: beforeRevision, enabled: true, limits: { ...limits, maxCalls: 3 } });
  assert.equal(changed.ok, true);
  const second = await api({ origin, key }, 'view');
  assert.equal((await second.json()).budget.snapshot.limits.maxCalls, 3);
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes(directory), false);
  assert.equal(serialized.includes(key), false);
  assert.equal(serialized.includes('process.env'), false);
});

test('fixed downloads preserve BOM, CRLF, UTF-8 bytes, and reject traversal names', async (t) => {
  const { directory, origin, key } = await setup(t);
  for (const name of names) {
    const response = await api({ origin, key }, `download/${name === 'personality.md' ? 'personality' : name === 'objectives.json' ? 'objectives' : 'memory'}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(directory, name)));
  }
  for (const suffix of ['..%2f..%2f.env', '%2e%2e', 'personality%2f..%2f.env']) {
    const response = await api({ origin, key }, `download/${suffix}`);
    assert.notEqual(response.status, 200);
  }
});

test('personality and objective content stays inert while static app serves only its three assets', async (t) => {
  const payload = '<img src=x onerror=alert(1)>\n<script>alert(2)</script>';
  const { directory, origin, key } = await setup(t, { owner: { personality: payload } });
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 8, scope,
    goals: [{ id: 'hostile', status: 'active', text: payload, constraints: [] }] }));
  const view = await api({ origin, key }, 'view');
  assert.equal((await view.json()).files.files.personality.content, payload);
  for (const file of ['/', '/index.html', '/style.css', '/main.js']) {
    const response = await fetch(`${origin}${file}`);
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const script = await fetch(`${origin}/main.js`).then((response) => response.text());
  assert.match(script, /\$\('file-content'\)\.textContent\s*=\s*file\.content/);
  assert.equal(/\.innerHTML\s*=/.test(script), false);
  for (const file of ['/package.json', '/.env', '/tools/agent/owner-panel-server.mjs', '/missing.js']) {
    const response = await fetch(`${origin}${file}`);
    assert.notEqual(response.status, 200, file);
  }
});

test('scope mismatch and unavailable budget fail closed without exposing paths or becoming zero', async (t) => {
  const mismatch = await setup(t, { budgetScope: { ...scope, worldId: 'foreign-world' } });
  const response = await api(mismatch, 'view');
  assert.equal(response.status, 200);
  const body = JSON.stringify(await response.json());
  assert.equal(body.includes(mismatch.budgetDirectory), false);
  assert.equal(JSON.parse(body).budget.ok, false);
  const unavailable = await setup(t, { initializeBudget: false, runner: stubRunner().runner });
  const noBudget = await api(unavailable, 'view');
  assert.equal(noBudget.status, 200);
  const unavailableBody = JSON.stringify(await noBudget.json());
  assert.equal(unavailableBody.includes(unavailable.budgetDirectory), false);
  assert.equal(JSON.parse(unavailableBody).budget.ok, false);
  assert.equal(unavailableBody.includes('"confirmedTokens":0'), false);
});

test('configuration uses exact JSON contracts, CAS, and durable serialized concurrent writes', async (t) => {
  const base = await setup(t);
  const current = await api(base, 'view').then((r) => r.json());
  const expectedRevision = current.budget.snapshot.persistence.revision;
  const requestOptions = (maxCalls) => ({ method: 'POST', body: { expectedRevision, enabled: true, limits: { ...limits, maxCalls } } });
  const [one, two] = await Promise.all([api(base, 'configure', requestOptions(2)), api(base, 'configure', requestOptions(3))]);
  const results = await Promise.all([one.json(), two.json()]);
  assert.equal(results.filter((item) => item.ok).length, 1);
  assert.equal(results.filter((item) => item.why === 'budget_revision_conflict').length, 1);
  const final = await api(base, 'view').then((r) => r.json());
  assert.equal(final.budget.snapshot.persistence.revision, expectedRevision + 1);
  assert.ok([2, 3].includes(final.budget.snapshot.limits.maxCalls));
  const extra = await api(base, 'configure', { method: 'POST', body: { ...requestOptions(2).body, unexpected: true } });
  assert.ok(extra.status >= 400);
});

test('revocation preserves unknown usage and held reservations through owner configure', async (t) => {
  const base = await setup(t);
  const reserved = await base.admin.reserve({ requestId: 'held-request', kind: 'decision', inputTokens: 10,
    outputTokens: 20, maxCostUnits: 40, countMode: 'simulated_tokens' });
  assert.equal(reserved.ok, true);
  await base.admin.markDispatched('held-request');
  await base.admin.markUnknown('held-request', 'inference_timeout');
  const view = await api(base, 'view').then((r) => r.json());
  const response = await api(base, 'configure', { method: 'POST', body: { expectedRevision: view.budget.snapshot.persistence.revision,
    enabled: false, limits } });
  assert.equal(response.status, 200);
  const after = await api(base, 'view').then((r) => r.json());
  const snapshot = after.budget.snapshot;
  assert.equal(snapshot.persistence.enabled, false);
  assert.equal(snapshot.totals.unresolvedTokens, 30);
  assert.equal(snapshot.totals.heldTokens, 0);
  assert.equal(snapshot.entries.find((entry) => entry.requestId === 'held-request').state, 'unknown');
});

test('control endpoints forward only exact empty bodies and do not enable CORS or query authentication', async (t) => {
  const { origin, key } = await setup(t, { runner: stubRunner().runner });
  for (const route of ['start', 'stop', 'think']) {
    const response = await api({ origin, key }, route, { method: 'POST', body: {} });
    assert.equal(response.status, 200);
  }
  for (const route of ['start', 'stop', 'think']) {
    const response = await api({ origin, key }, route, { method: 'POST', body: { extra: true } });
    assert.ok(response.status >= 400);
  }
  const queryKey = await fetch(`${origin}/api/view?key=${key}`);
  assert.equal(queryKey.status, 401);
  const oversized = await fetch(`${origin}/api/start`, { method: 'POST', headers: { authorization: `Bearer ${key}`,
    origin, 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(17 * 1024) }) });
  assert.ok(oversized.status >= 400);
});

test('runner errors and private connection details are sanitized at the HTTP boundary', async (t) => {
  const secretUrl = 'wss://private.example/secret-path?token=do-not-leak';
  const { origin, key } = await setup(t, { runner: stubRunner({ async inspect() {
    throw new Error(`failed ${secretUrl} using ACCOUNT_TOKEN=top-secret`);
  } }).runner });
  const response = await api({ origin, key }, 'view');
  assert.ok(response.status >= 400);
  const text = await response.text();
  assert.equal(text.includes(secretUrl), false);
  assert.equal(text.includes('top-secret'), false);
  assert.equal(text.includes('ACCOUNT_TOKEN'), false);
});

test('view never starts or thinks, and an unconfirmed stop remains explicitly unproven', async (t) => {
  const calls = [];
  const { origin, key } = await setup(t, { runner: stubRunner({
    async inspect() { calls.push('inspect'); return { state: 'ready', processRunning: true }; },
    async start() { calls.push('start'); return { ok: true }; },
    async think() { calls.push('think'); return { ok: true }; },
    async stop() { calls.push('stop'); return { ok: false, confirmed: false, pending: true,
      confirmation: 'unproven', why: 'server_stop_unproven', runner: { state: 'stopping' } }; },
  }).runner });
  const view = await api({ origin, key }, 'view');
  assert.equal(view.status, 200);
  assert.deepEqual(calls, ['inspect']);
  const response = await api({ origin, key }, 'stop', { method: 'POST', body: {} });
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.confirmed, false);
  assert.equal(result.confirmation, 'unproven');
  assert.deepEqual(calls, ['inspect', 'stop']);
});

test('POST requires Origin and streamed bodies over 16 KiB are rejected without Content-Length', async (t) => {
  const { origin, key } = await setup(t, { runner: stubRunner().runner });
  const missingOrigin = await fetch(`${origin}/api/start`, { method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(missingOrigin.status, 403);
  const text = JSON.stringify({ pad: 'x'.repeat(17 * 1024) });
  const chunks = [text.slice(0, 100), text.slice(100)];
  const stream = new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); },
  });
  const oversized = await fetch(`${origin}/api/start`, { method: 'POST', duplex: 'half', body: stream,
    headers: { authorization: `Bearer ${key}`, origin, 'content-type': 'application/json' } });
  assert.equal(oversized.status, 413);
});

test('invalid or likely-secret owner files clear the files section and never echo content or paths', async (t) => {
  const { directory, budgetDirectory, origin, key } = await setup(t);
  for (const value of ['api_key=sk_test_12345678901234567890', '{malformed json']) {
    if (value.startsWith('api_key=')) await writeFile(join(directory, 'personality.md'), value);
    else await writeFile(join(directory, 'objectives.json'), value);
    const response = await api({ origin, key }, 'view');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.files.ok, false);
    assert.equal(Object.hasOwn(data.files, 'files'), false);
    const serialized = JSON.stringify(data);
    assert.equal(serialized.includes(value), false);
    assert.equal(serialized.includes(directory), false);
    assert.equal(serialized.includes(budgetDirectory), false);
  }
});

test('production owned runner starts, thinks, stops, and revokes its game control grant', { timeout: 30000 }, async (t) => {
  const paths = await tempRoot(t); await writeOwner(paths.directory);
  await budget(paths.budgetDirectory, scope, { maxCalls: 4, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 8 });
  const tokenEnv = 'MN_OWNER_PANEL_CHILD_TEST_TOKEN';
  const agentToken = `panel-child-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const previousToken = process.env[tokenEnv]; process.env[tokenEnv] = agentToken;
  const game = createGameServer({ port: 0, host: '127.0.0.1', seed: 29, bots: 0, maxPlayers: 6, dev: false,
    worldId: scope.worldId, saveSecret: 'owner-panel-test-game-secret', store: createMemoryStore(), log() {},
    resolvePlayer: async (_request, message) => message.token === agentToken ? scope.characterId : null,
    agentControl: { worldId: scope.worldId, ttlMs: 60000, bindings: [{ ownerId: scope.ownerId,
      characterId: scope.characterId, capabilities: ['move', 'aim'] }] },
  });
  const gamePort = await game.listen();
  const panel = await createOwnerPanel({ ...paths, scope, runnerOptions: { url: `ws://127.0.0.1:${gamePort}/ws`,
    accountTokenEnv: tokenEnv, capabilities: ['move', 'aim'] } });
  const base = await panel.listen();
  t.after(async () => {
    await panel.close(); await game.close();
    if (previousToken === undefined) delete process.env[tokenEnv]; else process.env[tokenEnv] = previousToken;
    await rm(paths.root, { recursive: true, force: true });
  });
  const beforeFiles = await Promise.all(names.map((name) => readFile(join(paths.directory, name))));
  const start = await api(base, 'start', { method: 'POST', body: {} });
  assert.equal(start.status, 200);
  const started = await start.json();
  assert.equal(started.ok, true);
  assert.equal(started.runner.state, 'ready');
  const think = await api(base, 'think', { method: 'POST', body: {} });
  const thought = await think.json();
  assert.equal(think.status, 200, JSON.stringify(thought));
  const stopResponse = await api(base, 'stop', { method: 'POST', body: {} });
  assert.equal(stopResponse.status, 200);
  const stopped = await stopResponse.json();
  assert.equal(stopped.ok, true);
  assert.equal(stopped.runner.state, 'stopped');
  assert.equal(stopped.confirmation, 'server_queue');
  const revoked = game.game.agentControl.byCharacter(scope.characterId);
  assert.equal(revoked.state, 'revoked');
  assert.equal(revoked.task, null);
  assert.deepEqual(await Promise.all(names.map((name) => readFile(join(paths.directory, name)))), beforeFiles);
});
