// IC08: a hosted controller in an in-process host room. The server issues the pairing code on the owner's
// socket, the PairedCompanion (hosted mode) dials ws://127.0.0.1:<port>/ws with the first ORIGINS entry,
// claims it and answers the owner's chat through the owner's endpoint (a fake on 127.0.0.1, fence permissive).
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
import { hostedInferenceFromEnv } from '../server/hostedInference.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';

const OWNER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'https://game.example';
const WORLD = 'hosted-room';
const SECRET = 'sk-room-secret-abcdef987654';
const REPLY = 'Aquí estoy, capitán.';
const permissive = { vet: async url => ({ ok: true, hostname: new URL(url).hostname, address: '127.0.0.1', family: 4 }) };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let serial = 0;

async function until(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await pause(5); }
  throw new Error('condition timeout');
}

class Wire {
  constructor(url) {
    this.messages = []; this.ws = new WebSocket(url, { origin: ORIGIN });
    this.open = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.ws.on('message', bytes => { const message = JSON.parse(bytes.toString()); if (message.t !== MSG.SNAPSHOT) this.messages.push(message); });
  }
  async send(message) { await this.open; this.ws.send(JSON.stringify(message)); }
  next(predicate, after = 0) { return until(() => this.messages.slice(after).find(predicate)); }
  close() { try { this.ws.close(); } catch { /* gone */ } }
}

async function request(client, t, result, fields) {
  const requestId = `${t}-${++serial}`, after = client.messages.length;
  await client.send({ t, requestId, ...fields });
  return client.next(m => m.t === result && m.requestId === requestId, after);
}
const hosted = (client, op, fields = {}) => request(client, MSG.HOSTED_INFERENCE, MSG.HOSTED_INFERENCE_RESULT, { op, ...fields });
const presence = (client, op, expectedRevision) => request(client, MSG.AGENT_COMPANION_PRESENCE, MSG.AGENT_COMPANION_PRESENCE_RESULT,
  { op, ...(op === 'load' ? {} : { expectedRevision }) });

async function room(t, dir, maxPlayers = 8) {
  const store = createMemoryStore();
  const createCompanion = store.createCompanion.bind(store), loadCompanionCreation = store.loadCompanionCreation.bind(store);
  store.loadCompanionCreation = async scope => {
    const record = await loadCompanionCreation(scope);
    if (!record) return record;
    return { ...record, control: await store.loadCompanionControl({ ...scope, character: record.characterKey }) };
  };
  store.createCompanion = async input => {
    const result = await createCompanion(input);
    if (result?.ok && !result.replay) await store.saveCompanionControl({ world: input.world, owner: input.owner,
      character: result.record.characterKey, expectedRevision: 0, stopped: true });
    return result;
  };
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers, origins: [ORIGIN],
    worldId: WORLD, saveSecret: 'hosted-room-fixture', log() {}, store,
    companionCreation: true, companionCreationAllowMemory: true, companionConfigAllowMemory: true, companionControlAllowMemory: true,
    companionPairing: true, companionPairingAllowMemory: true, companionPresence: true, companionPresenceAllowMemory: true,
    agentControl: { worldId: WORLD, bindings: [] }, chat: { localRadius: 200, burst: 20, refillPerSecond: 10 },
    hostedInference: { ...hostedInferenceFromEnv({ MN_HOSTED_INFERENCE: '1', MN_HOSTED_INFERENCE_KEY: randomBytes(32).toString('base64'),
      MN_HOSTED_INFERENCE_ACCOUNTS: `${OWNER},${OTHER}`, MN_HOSTED_INFERENCE_MAX: '1', MN_HOSTED_INFERENCE_DIR: dir }), egress: permissive },
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER, other: OTHER }[token] ?? null) });
  const port = await app.listen(), clients = [];
  t.after(async () => { clients.forEach(client => client.close()); await app.close(); });
  return { app, async connect(token) {
    const client = new Wire(`ws://127.0.0.1:${port}/ws`); clients.push(client);
    await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Owner QA', skin: 0, weapon: 0, token });
    assert.equal((await client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t))).t, MSG.WELCOME);
    await client.next(m => m.t === MSG.CHAT_STATE);
    return client;
  }, async bare() {
    const client = new Wire(`ws://127.0.0.1:${port}/ws`); clients.push(client);
    return client.open.then(() => true, () => false);
  } };
}

async function fakeProvider(t) {
  const seen = [];
  const server = createServer(async (incoming, response) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    seen.push({ authorization: incoming.headers.authorization ?? null, body });
    response.writeHead(200, { 'content-type': 'application/json' });
    if (incoming.method === 'GET') { response.end(JSON.stringify({ data: [{ id: 'model-a' }] })); return; }
    response.end(JSON.stringify({ id: `reply-${seen.length}`, model: body.model, choices: [{ index: 0, message: { role: 'assistant',
      content: JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: REPLY } } }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 12 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { seen, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

const statuses = (client, character, after = 0) => client.messages.slice(after)
  .filter(m => m.t === MSG.HOSTED_INFERENCE_RESULT && m.op === 'status' && m.requestId === null)
  .map(m => m.state.companions.find(row => row.character === character)?.status);

test('hosted controller: body required, starting then running, a chat reply from the endpoint, stop revokes, MAX limits', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hosted-room-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const provider = await fakeProvider(t), r = await room(t, dir), game = r.app.game;
  const owner = await r.connect('owner');
  const created = await request(owner, MSG.AGENT_COMPANION_CREATE, MSG.AGENT_COMPANION_CREATE_RESULT, { op: 'create',
    creationId: '30000000-0000-4000-8000-000000000001', preset: structuredClone(DEFAULT_COMPANION_PRESET) });
  assert.equal(created.ok, true);
  const character = created.record.characterKey;
  const loaded = await presence(owner, 'load');
  const listed = await request(owner, MSG.AGENT_OWNER, MSG.AGENT_OWNER_RESULT, { op: 'list' });
  const row = listed.companions.find(item => item.characterKey === character);
  assert.equal((await request(owner, MSG.AGENT_OWNER, MSG.AGENT_OWNER_RESULT, { op: 'resume', characterKey: character,
    epoch: row.epoch, expectedRevision: row.control.revision })).ok, true, 'connection allowed');

  const saved = await hosted(owner, 'save', { endpoint: { id: null, label: 'Fake', baseUrl: provider.baseUrl, apiKey: SECRET, defaultModel: 'model-a' } });
  assert.equal(saved.ok, true, saved.why);
  const endpointId = saved.state.endpoints[0].id;
  assert.equal((await hosted(owner, 'probe', { id: endpointId })).ok, true);
  assert.equal((await hosted(owner, 'test', { id: endpointId, modelId: 'model-a', prompt: 'Hola' })).ok, true);
  assert.equal((await hosted(owner, 'start', { character, endpointId, modelId: 'model-unknown' })).why, 'model_unknown');

  const early = await hosted(owner, 'start', { character, endpointId, modelId: 'model-a' });
  assert.equal(early.why, 'presence_body_required', JSON.stringify(early));
  assert.equal(early.state.companions.find(item => item.character === character).status, 'stopped');

  assert.equal((await presence(owner, 'join', loaded.presence.revision)).ok, true, 'body summoned');
  const after = owner.messages.length;
  const started = await hosted(owner, 'start', { character, endpointId, modelId: 'model-a' });
  assert.equal(started.ok, true, started.why);
  await until(() => statuses(owner, character, after).includes('running'));
  const seenStatuses = statuses(owner, character, after);
  assert.deepEqual(seenStatuses.slice(seenStatuses.indexOf('starting')), ['starting', 'running']);
  assert.equal(game.companionPairing.admitted.size, 1, 'the hosted controller claimed and was admitted');

  const other = await r.connect('other');
  assert.equal((await hosted(other, 'start', { character: '55555555-5555-4555-8555-555555555555', endpointId, modelId: 'model-a' })).why,
    'limit', 'MN_HOSTED_INFERENCE_MAX=1 is taken');

  await owner.send({ t: MSG.CHAT_SEND, id: 'owner-hosted-1', channel: 'world', text: 'Hola, ¿estás ahí?' });
  const reply = await owner.next(m => m.t === MSG.CHAT_MESSAGE && m.text === REPLY);
  assert.ok(reply);
  const completion = provider.seen.filter(item => item.body?.messages).at(-1);
  assert.equal(completion.authorization, `Bearer ${SECRET}`);
  assert.equal(completion.body.model, 'model-a');
  assert.equal(Object.hasOwn(completion.body, 'chat_template_kwargs'), false, 'thinking mode server_default');

  const stopped = await hosted(owner, 'stop', { character });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.state.companions.find(item => item.character === character).status, 'stopped');
  await until(() => game.companionPairing.admitted.size === 0);
  assert.equal(game.companionPairing.codes.size, 0); assert.equal(game.companionPairing.tokens.size, 0);
  assert.equal(game.hostedInference.active(), 0);
  assert.equal(statuses(owner, character, after).at(-1), 'stopped');

  const written = (await readdir(dir, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath ?? entry.path, entry.name));
  assert.ok(written.some(file => file.endsWith('paired-runtime.json')), 'the hosted companion directory exists');
  for (const file of written) {
    const text = await readFile(file, 'utf8');
    assert.equal(text.includes(SECRET), false, file);
    assert.equal(text.includes(provider.baseUrl) && !file.endsWith('inference.json'), false, `no endpoint URL in ${file}`);
  }
  assert.equal([...owner.messages, ...other.messages].some(message => JSON.stringify(message).includes(SECRET)), false);
});

test('hosted sockets sit outside the player cap; deleting the connection stops the running companion', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hosted-room-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const provider = await fakeProvider(t), r = await room(t, dir, 2), game = r.app.game;
  const owner = await r.connect('owner');
  const created = await request(owner, MSG.AGENT_COMPANION_CREATE, MSG.AGENT_COMPANION_CREATE_RESULT, { op: 'create',
    creationId: '30000000-0000-4000-8000-000000000002', preset: structuredClone(DEFAULT_COMPANION_PRESET) });
  const character = created.record.characterKey;
  const loaded = await presence(owner, 'load');
  const row = (await request(owner, MSG.AGENT_OWNER, MSG.AGENT_OWNER_RESULT, { op: 'list' })).companions.find(item => item.characterKey === character);
  assert.equal((await request(owner, MSG.AGENT_OWNER, MSG.AGENT_OWNER_RESULT, { op: 'resume', characterKey: character,
    epoch: row.epoch, expectedRevision: row.control.revision })).ok, true);
  const saved = await hosted(owner, 'save', { endpoint: { id: null, label: 'Fake', baseUrl: provider.baseUrl, apiKey: SECRET, defaultModel: 'model-a' } });
  const endpointId = saved.state.endpoints[0].id;
  assert.equal((await presence(owner, 'join', loaded.presence.revision)).ok, true, 'body summoned');

  while (game.sockets.size < 2 + 4) assert.equal(await r.bare(), true, 'a spectator socket below the cap');
  assert.equal(await r.bare(), false, 'players + 4 sockets is full');
  const after = owner.messages.length;
  assert.equal((await hosted(owner, 'start', { character, endpointId, modelId: 'model-a' })).ok, true);
  await until(() => statuses(owner, character, after).includes('running'));
  assert.equal(game.companionPairing.admitted.size, 1, 'the hosted controller connected on a full server');
  assert.ok(game.hostedSocketCount() >= 1 && game.hostedSocketCount() <= game.hostedInference.maxSockets());
  assert.equal(await r.bare(), false, 'the hosted socket frees no player slot');
  assert.deepEqual(game.status().storage.hostedInference, { enabled: true, ready: true, running: 1, max: 1 });

  const deleted = await hosted(owner, 'delete', { id: endpointId });
  assert.equal(deleted.ok, true, deleted.why);
  assert.deepEqual(deleted.state.endpoints, []);
  assert.equal(deleted.state.companions.find(item => item.character === character).status, 'stopped');
  await until(() => game.companionPairing.admitted.size === 0);
  assert.equal(game.hostedInference.active(), 0);
  assert.deepEqual(game.status().storage.hostedInference, { enabled: true, ready: true, running: 0, max: 1 });
});
