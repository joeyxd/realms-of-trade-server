// IC08: the hosted inference socket service on a booted host: gating, request shapes, the endpoint
// registry against a fake OpenAI-compatible endpoint (fence injected permissive), rates and sealing at rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { HostedInferenceService, hostedInferenceFromEnv } from '../server/hostedInference.mjs';
import { PairedCompanion } from '../server/agent/paired-companion.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const STRANGER = '44444444-4444-4444-8444-444444444444';
const KEY = randomBytes(32).toString('base64');
const SECRET = 'sk-hosted-secret-0123456789';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const permissive = { vet: async url => ({ ok: true, hostname: new URL(url).hostname, address: '127.0.0.1', family: 4 }) };
let serial = 0;

async function until(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await pause(5); }
  throw new Error('condition timeout');
}

class Wire {
  constructor(url) {
    this.messages = []; this.ws = new WebSocket(url);
    this.open = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.ws.on('message', bytes => { const message = JSON.parse(bytes.toString()); if (message.t !== MSG.SNAPSHOT) this.messages.push(message); });
  }
  async send(message) { await this.open; this.ws.send(JSON.stringify(message)); }
  next(predicate, after = 0) { return until(() => this.messages.slice(after).find(predicate)); }
  close() { try { this.ws.close(); } catch { /* gone */ } }
}

async function boot(t, hosted) {
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8, worldId: 'hosted-service',
    saveSecret: 'hosted-service-fixture', log() {}, store: createMemoryStore(), hostedInference: hosted,
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER, other: OTHER, stranger: STRANGER }[token] ?? null) });
  const port = await app.listen(), clients = [];
  t.after(async () => { clients.forEach(client => client.close()); await app.close(); });
  return { app, async connect(token) {
    const client = new Wire(`ws://127.0.0.1:${port}/ws`); clients.push(client);
    await client.open;
    if (token !== null) {
      await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Hosted QA', skin: 0, weapon: 0, token });
      assert.equal((await client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t))).t, MSG.WELCOME);
    }
    return client;
  } };
}

async function hosted(client, op, fields = {}, raw = null) {
  const requestId = `hosted-${++serial}`, after = client.messages.length;
  await client.send(raw ?? { t: MSG.HOSTED_INFERENCE, requestId, op, ...fields });
  return client.next(m => m.t === MSG.HOSTED_INFERENCE_RESULT && m.requestId === (raw ? (/^[A-Za-z0-9_-]{1,100}$/.test(raw.requestId) ? raw.requestId : null) : requestId), after);
}

async function fakeProvider(t) {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization ?? null,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null });
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }] })); return; }
    response.end(JSON.stringify({ id: 'r1', model: 'model-a', choices: [{ index: 0, message: { role: 'assistant', content: 'Pong.' },
      finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 2 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { seen, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath ?? entry.path, entry.name));
  }
  return out;
}

const tempDir = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hosted-inference-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
const STATE_KEYS = ['available', 'reason', 'endpoints', 'companions', 'limits'];

test('load answers the contract state shape with the flag off and with it on', async t => {
  const off = await boot(t, hostedInferenceFromEnv({}));
  const loadedOff = await hosted(await off.connect('owner'), 'load');
  assert.deepEqual(Object.keys(loadedOff).sort(), ['ok', 'op', 'requestId', 'state', 't', 'why']);
  assert.equal(loadedOff.ok, false); assert.equal(loadedOff.why, 'disabled'); assert.equal(loadedOff.op, 'load');
  assert.deepEqual(loadedOff.state, { available: false, reason: 'disabled', endpoints: [], companions: [], limits: { maxEndpoints: 8, maxRunning: 2 } });

  const dir = await tempDir(t);
  const on = await boot(t, hostedInferenceFromEnv({ MN_HOSTED_INFERENCE: '1', MN_HOSTED_INFERENCE_KEY: KEY,
    MN_HOSTED_INFERENCE_ACCOUNTS: `${OWNER},${OTHER}`, MN_HOSTED_INFERENCE_MAX: '3', MN_HOSTED_INFERENCE_DIR: dir }));
  const loadedOn = await hosted(await on.connect('owner'), 'load');
  assert.equal(loadedOn.ok, true); assert.equal(loadedOn.why, null);
  assert.deepEqual(Object.keys(loadedOn.state), STATE_KEYS);
  assert.deepEqual(loadedOn.state, { available: true, reason: null, endpoints: [], companions: [], limits: { maxEndpoints: 8, maxRunning: 3 } });
});

test('gating: misconfigured switches, allowlist, session and exact request shapes', async t => {
  const dir = await tempDir(t);
  const host = { log() {} };
  const reason = env => new HostedInferenceService(host, hostedInferenceFromEnv(env)).reason;
  const base = { MN_HOSTED_INFERENCE: '1', MN_HOSTED_INFERENCE_KEY: KEY, MN_HOSTED_INFERENCE_ACCOUNTS: OWNER, MN_HOSTED_INFERENCE_DIR: dir };
  assert.equal(reason(base), null);
  assert.equal(reason({ ...base, MN_HOSTED_INFERENCE: 'true' }), 'disabled');
  assert.equal(reason({ ...base, MN_HOSTED_INFERENCE_KEY: undefined }), 'misconfigured');
  assert.equal(reason({ ...base, MN_HOSTED_INFERENCE_KEY: randomBytes(31).toString('base64') }), 'misconfigured');
  assert.equal(reason({ ...base, MN_HOSTED_INFERENCE_ACCOUNTS: 'not-a-uuid' }), 'misconfigured');
  assert.equal(reason({ ...base, MN_HOSTED_INFERENCE_MAX: '9' }), 'misconfigured');
  assert.equal(reason({ ...base, MN_HOSTED_INFERENCE_DIR: 'relative/dir' }), 'misconfigured');
  const logged = [];
  new HostedInferenceService({ log: line => logged.push(line) }, hostedInferenceFromEnv({ ...base, MN_HOSTED_INFERENCE_KEY: 'c2hvcnQ=' }));
  assert.deepEqual(logged, ['[hosted] misconfigured: key'], 'one line, no value');

  const broken = await boot(t, hostedInferenceFromEnv({ ...base, MN_HOSTED_INFERENCE_KEY: randomBytes(31).toString('base64') }));
  const misconfigured = await hosted(await broken.connect('owner'), 'load');
  assert.equal(misconfigured.why, 'misconfigured'); assert.equal(misconfigured.state.reason, 'misconfigured');

  const r = await boot(t, { ...hostedInferenceFromEnv(base), egress: permissive });
  assert.equal((await hosted(await r.connect('stranger'), 'load')).why, 'not_allowed');
  const guest = await r.connect(null);
  const forbidden = await hosted(guest, 'load');
  assert.equal(forbidden.why, 'forbidden'); assert.deepEqual(forbidden.state.endpoints, []);
  const owner = await r.connect('owner');
  const endpoint = { id: null, label: 'Proveedor', baseUrl: 'https://api.example/v1', defaultModel: null };
  const invalid = [
    { t: MSG.HOSTED_INFERENCE, requestId: 'x1', op: 'load', extra: 1 },
    { t: MSG.HOSTED_INFERENCE, requestId: 'x2', op: 'launch' },
    { t: MSG.HOSTED_INFERENCE, requestId: 'bad id', op: 'load' },
    { t: MSG.HOSTED_INFERENCE, requestId: 'x3', op: 'save', endpoint: { ...endpoint, label: 'x'.repeat(49) } },
    { t: MSG.HOSTED_INFERENCE, requestId: 'x4', op: 'save', endpoint: { ...endpoint, apiKey: 'k'.repeat(401) } },
    { t: MSG.HOSTED_INFERENCE, requestId: 'x5', op: 'save', endpoint: { ...endpoint, secret: 'x' } },
    { t: MSG.HOSTED_INFERENCE, requestId: 'x6', op: 'test', id: '0123456789abcdef', modelId: 'm', prompt: '' },
    { t: MSG.HOSTED_INFERENCE, requestId: 'x7', op: 'start', character: 'nope', endpointId: '0123456789abcdef', modelId: 'm' },
    { t: MSG.HOSTED_INFERENCE, requestId: 'x8', op: 'probe', id: 'ZZ' },
  ];
  for (const message of invalid) {
    const result = await hosted(owner, null, {}, message);
    assert.equal(result.why, 'invalid_request', JSON.stringify(message));
    assert.equal(result.ok, false);
  }
});

test('registry: save, edit keeping and clearing the key, probe, test, delete, 9th endpoint and the call rate', async t => {
  const dir = await tempDir(t), provider = await fakeProvider(t);
  const r = await boot(t, { ...hostedInferenceFromEnv({ MN_HOSTED_INFERENCE: '1', MN_HOSTED_INFERENCE_KEY: KEY,
    MN_HOSTED_INFERENCE_ACCOUNTS: `${OWNER},${OTHER}`, MN_HOSTED_INFERENCE_DIR: dir }), egress: permissive });
  const owner = await r.connect('owner');
  const created = await hosted(owner, 'save', { endpoint: { id: null, label: ' Mi proveedor ', baseUrl: provider.baseUrl,
    apiKey: SECRET, defaultModel: 'model-a' } });
  assert.equal(created.ok, true, created.why);
  const [row] = created.state.endpoints;
  assert.deepEqual(Object.keys(row), ['id', 'label', 'baseUrl', 'keyHint', 'defaultModel', 'models', 'catalogUpdatedAt', 'catalogError', 'usage']);
  assert.equal(row.label, 'Mi proveedor'); assert.equal(row.keyHint, SECRET.slice(-4));
  const kept = await hosted(owner, 'save', { endpoint: { id: row.id, label: 'Renombrado', baseUrl: provider.baseUrl, defaultModel: 'model-a' } });
  assert.equal(kept.ok, true); assert.equal(kept.state.endpoints[0].keyHint, SECRET.slice(-4));

  const probed = await hosted(owner, 'probe', { id: row.id });
  assert.equal(probed.ok, true, probed.why);
  assert.deepEqual(probed.state.endpoints[0].models, ['model-a', 'model-b']);
  assert.equal(provider.seen.at(-1).authorization, `Bearer ${SECRET}`, 'the sealed key opens for the provider');
  const tested = await hosted(owner, 'test', { id: row.id, modelId: 'model-a', prompt: 'Ping' });
  assert.equal(tested.ok, true, tested.why);
  assert.deepEqual(Object.keys(tested.test).sort(), ['latencyMs', 'modelMismatch', 'servedModel', 'text', 'usage']);
  assert.equal(tested.test.text, 'Pong.'); assert.deepEqual(tested.test.usage, { inputTokens: 7, outputTokens: 2 });
  assert.equal(tested.test.servedModel, 'model-a'); assert.equal(tested.test.modelMismatch, false);
  assert.deepEqual(tested.state.endpoints[0].usage, { requests: 1, failures: 0, promptTokens: 7, completionTokens: 2 });
  assert.equal(provider.seen.at(-1).body.chat_template_kwargs, undefined);

  for (const file of await files(dir)) assert.equal((await readFile(file, 'utf8')).includes(SECRET), false, file);
  const store = JSON.parse(await readFile((await files(dir)).find(file => file.endsWith('inference.json')), 'utf8'));
  assert.match(store.endpoints[0].apiKey, /^v1\./);
  assert.equal(owner.messages.some(message => JSON.stringify(message).includes(SECRET)), false);

  const cleared = await hosted(owner, 'save', { endpoint: { id: row.id, label: 'Sin clave', baseUrl: provider.baseUrl, apiKey: '', defaultModel: null } });
  assert.equal(cleared.ok, true); assert.equal(cleared.state.endpoints[0].keyHint, null);
  assert.equal((await hosted(owner, 'probe', { id: 'ffffffffffffffff' })).why, 'endpoint_unknown');
  assert.equal((await hosted(owner, 'delete', { id: row.id })).state.endpoints.length, 0);

  for (let n = 0; n < 8; n++) {
    const saved = await hosted(owner, 'save', { endpoint: { id: null, label: `E${n}`, baseUrl: provider.baseUrl, defaultModel: null } });
    assert.equal(saved.ok, true, saved.why);
  }
  const ninth = await hosted(owner, 'save', { endpoint: { id: null, label: 'E9', baseUrl: provider.baseUrl, defaultModel: null } });
  assert.equal(ninth.why, 'limit'); assert.equal(ninth.state.endpoints.length, 8);

  const other = await r.connect('other');
  const saved = await hosted(other, 'save', { endpoint: { id: null, label: 'Otra', baseUrl: provider.baseUrl, defaultModel: null } });
  const id = saved.state.endpoints[0].id;
  assert.equal(owner.messages.some(message => message.state?.endpoints?.some(item => item.id === id)), false, 'owners never share a registry');
  const outcomes = [];
  for (let n = 0; n < 7; n++) outcomes.push((await hosted(other, n % 2 ? 'test' : 'probe', n % 2 ? { id, modelId: 'model-a', prompt: 'Ping' } : { id })).why);
  assert.deepEqual(outcomes, [null, null, null, null, null, null, 'busy']);
});

test('follow-ups: the /status flag, the hosted socket token, 200-character model ids, start revokes only a code it issued', async t => {
  const dir = await tempDir(t), provider = await fakeProvider(t);
  const base = { MN_HOSTED_INFERENCE: '1', MN_HOSTED_INFERENCE_KEY: KEY, MN_HOSTED_INFERENCE_ACCOUNTS: OWNER, MN_HOSTED_INFERENCE_DIR: dir };
  const off = new HostedInferenceService({ log() {} }, hostedInferenceFromEnv({}));
  assert.deepEqual(off.status(), { enabled: false, ready: false });
  assert.deepEqual(new HostedInferenceService({ log() {} }, hostedInferenceFromEnv({ ...base, MN_HOSTED_INFERENCE_DIR: 'relative' })).status(),
    { enabled: true, ready: false });
  const r = await boot(t, { ...hostedInferenceFromEnv(base), egress: permissive }), service = r.app.game.hostedInference;
  assert.deepEqual(r.app.game.status().storage.hostedInference, { enabled: true, ready: true, running: 0, max: 2 });

  const token = service.socketToken, wrong = token.replace(/.$/, c => c === '0' ? '1' : '0');
  const upgrade = (value, remoteAddress = '127.0.0.1') => ({ headers: { 'x-marea-hosted': value }, socket: { remoteAddress } });
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(service.admits(upgrade(token)), true);
  assert.equal(service.admits(upgrade(token, '::ffff:127.0.0.1')), true);
  assert.equal(service.admits(upgrade(token, '203.0.113.9')), false, 'never off loopback');
  assert.equal(service.admits(upgrade(wrong)), false);
  assert.equal(service.admits(upgrade(undefined)), false);
  assert.equal(off.admits(upgrade(token)), false, 'a disabled service admits nothing');

  const owner = await r.connect('owner'), long = `m-${'x'.repeat(198)}`;
  const saved = await hosted(owner, 'save', { endpoint: { id: null, label: 'Largo', baseUrl: provider.baseUrl, apiKey: SECRET, defaultModel: long } });
  assert.equal(saved.ok, true, saved.why);
  const id = saved.state.endpoints[0].id;
  assert.equal(saved.state.endpoints[0].defaultModel, long);
  const tested = await hosted(owner, 'test', { id, modelId: long, prompt: 'Ping' });
  assert.equal(tested.ok, true, tested.why);
  assert.equal(provider.seen.at(-1).body.model, long);
  assert.equal((await (await service.center(OWNER)).resolve(id, long)).ok, true);
  const companion = modelId => new PairedCompanion({ directory: join(dir, 'pc'), url: 'ws://127.0.0.1:9/ws', modelId,
    hosted: { origin: 'https://game.example', endpointId: id, endpoint: { baseUrl: provider.baseUrl, apiKey: SECRET }, egress: permissive, socketToken: token } });
  assert.doesNotThrow(() => companion(long));
  assert.throws(() => companion(`${long}x`), /invalid_paired_companion_options/);

  const revoked = [];
  const lone = new HostedInferenceService({ log() {}, origins: [], sockets: new Map(), closing: false,
    wss: { options: { server: { address: () => ({ port: 9 }) } } },
    companionPairing: { revokeOwner: who => revoked.push(who), issueHosted: async () => ({ why: null, code: 'c'.repeat(64) }) } },
  { ...hostedInferenceFromEnv(base), egress: permissive });
  lone.center = async () => { throw new Error('store'); };
  assert.deepEqual(await lone.start({}, OWNER, { character: 'c', endpointId: id, modelId: 'model-a' }), { why: 'unavailable' });
  assert.deepEqual(revoked, [], 'no code was issued: the owner keeps a live PC pairing');
  assert.equal(lone.entries.size, 0);
  lone.center = async () => ({ resolve: async () => ({ ok: true, endpoint: { baseUrl: provider.baseUrl, apiKey: SECRET } }) });
  assert.deepEqual(await lone.start({}, OWNER, { character: 'c', endpointId: id, modelId: `${long}x` }), { why: 'unavailable' });
  assert.deepEqual(revoked, [OWNER], 'a code this start issued is revoked');
  assert.equal(lone.entries.size, 0);
});


test('state exposes memory loop only on the running controller and null on stopped rows', async t => {
  const dir = await tempDir(t), host = { log() {}, agentControl: { listOwned: () => [{ characterKey: 'c1' }, { characterKey: 'c2' }] } };
  const service = new HostedInferenceService(host, { enabled: true, key: KEY, accounts: OWNER, dir });
  const loop = { usage: { calls: 2, maxCalls: 8, inputTokens: 200, outputTokens: 40, summaries: 1, expiresAtMs: 1900000000000 },
    memory: { episodes: 6, summaries: 1, bytes: 4096, maxBytes: 1048576 },
    lastSummary: { ok: true, atMs: 1800000000000, reason: 'context_size' }, autoSummary: 'ready' };
  const entry = { character: 'c1', status: 'running', name: 'Brisa', endpointId: 'e1', modelId: 'm1', error: null, controller: { memoryLoop: loop } };
  service.entries.set(OWNER, entry);
  const rows = (await service.state(OWNER)).companions;
  for (const key of Object.keys(loop)) { assert.deepEqual(rows[0][key], loop[key]); assert.equal(rows[1][key], null); }
  entry.status = 'stopped';
  for (const key of Object.keys(loop)) assert.equal((await service.state(OWNER)).companions[0][key], null);
  entry.status = 'running'; entry.controller = null;
  for (const key of Object.keys(loop)) assert.equal((await service.state(OWNER)).companions[0][key], null);
});
