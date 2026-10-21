import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { DEFAULT_COMPANION_DRAFT } from '../src/net/companionTemplates.js';
import { companionPreset, companionCreationConfig } from '../src/net/companionCreation.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { claimPairCode, PairedCompanion } from '../tools/agent/paired-companion.mjs';
import { argumentsOf, privateLine, statusMessage } from '../tools/agent/pair-companion.mjs';

const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const WORLD = 'pair-world-1';
const CODE = 'a'.repeat(64);
const TOKEN = `mncp_${'b'.repeat(64)}`;
const CONTENT = { generation: 3, revisionId: 'c'.repeat(64) };
const OWNER_PEER = '55555555-5555-4555-8555-555555555555';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(10); }
  assert.fail(`${label} timeout`);
}
function bootstrap(overrides = {}) {
  const record = { characterKey: CHARACTER, creationId: '44444444-4444-4444-8444-444444444444',
    preset: companionPreset({ ...DEFAULT_COMPANION_DRAFT, name: 'Brisa' }), createdAt: new Date().toISOString(),
    configuration: { revision: 1, config: companionCreationConfig(companionPreset({ ...DEFAULT_COMPANION_DRAFT, name: 'Brisa' })), savedAt: new Date().toISOString() },
    control: { revision: 1, stopped: false, savedAt: new Date().toISOString() } };
  return { scope: { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD }, record, token: TOKEN,
    expiresAtMs: Date.now() + 60 * 60 * 1000, content: CONTENT, ownerPeer: OWNER_PEER, ...overrides };
}

class Wire {
  constructor(url, name, token) {
    this.name = name; this.ws = new WebSocket(url); this.messages = []; this.waiters = [];
    this.opened = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.ws.on('message', raw => {
      let message; try { message = JSON.parse(raw.toString()); } catch { return; }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
      }
    });
    this.token = token;
  }
  async connect() {
    await this.opened;
    this.ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, ...(this.token ? { token: this.token } : {}), name: this.name, skin: 0, weapon: 0 }));
    const welcome = await this.waitFor(message => message.t === MSG.WELCOME || message.t === MSG.ERROR);
    assert.equal(welcome.t, MSG.WELCOME, JSON.stringify(welcome));
    await this.waitFor(message => message.t === MSG.CHAT_STATE);
  }
  waitFor(predicate, timeoutMs = 8000) {
    const found = this.messages.find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error(`wire_timeout:${this.name}:${this.messages.map(message => message.t + ':' + (message.code ?? message.requestId ?? '')).join(',')}`));
      }, timeoutMs) };
      this.waiters.push(waiter);
    });
  }
  get self() { return this.messages.filter(message => message.t === MSG.CHAT_STATE).at(-1)?.self; }
  sendChat(id, text) { this.ws.send(JSON.stringify({ t: MSG.CHAT_SEND, id, channel: 'world', text })); }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

async function livePairFixture(t, { holdModel = false, httpFailure = false } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'paired-live-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  let releaseModel;
  const modelPending = new Promise(resolve => { releaseModel = resolve; });
  let modelCalls = 0, seenModel = null;
  const model = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    modelCalls++; seenModel = body.model;
    if (holdModel) await modelPending;
    if (!response.destroyed) {
      if (httpFailure) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_SECRET_DO_NOT_ECHO' } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: `reply-${modelCalls}`, object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: 'Brisa te responde.' } } }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }));
    }
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  t.after(() => { model.closeAllConnections(); return new Promise(resolve => model.close(resolve)); });
  const host = createGameServer({ port: 0, host: '127.0.0.1', seed: 17, bots: 0, maxPlayers: 8, dev: false,
    worldId: WORLD, saveSecret: 'paired-local-network-test', store: createMemoryStore(), log() {},
    chat: { localRadius: 200, burst: 20, refillPerSecond: 10 },
  });
  const port = await host.listen(), url = `ws://127.0.0.1:${port}/ws`;
  t.after(() => host.close());
  const owner = new Wire(url, 'Owner'); await owner.connect(); t.after(() => owner.close());
  const other = new Wire(url, 'Other'); await other.connect(); t.after(() => other.close());
  const statuses = [];
  const pair = new PairedCompanion({ directory: join(parent, 'companion'), url: 'wss://paired.example/ws',
    baseUrl: `http://127.0.0.1:${model.address().port}/v1`, maxCalls: 4, maxTokens: 64000,
    claim: async () => bootstrap({ ownerPeer: owner.self }),
    onStatus: status => statuses.push(status),
    // The pairing protocol/token is covered by the claim test; this fixture isolates C01/model behavior.
    runnerFactory: options => new AgentNetworkRunner({ ...options, url, authorization: null }),
  });
  t.after(() => pair.close());
  const connected = await pair.start(CODE);
  assert.equal(connected.ok, true, JSON.stringify(connected));
  return { owner, other, pair, parent, statuses, model: { get calls() { return modelCalls; }, get modelId() { return seenModel; }, release: () => releaseModel() } };
}

class FakeRunner {
  constructor(options) { this.options = options; this.state = 'idle'; this.connectCalls = 0; this.grant = options.grant; this.authority = null; this.chat = { self: CHARACTER, messages: [] }; }
  async connect() { this.connectCalls++; this.state = 'ready'; return { ok: true }; }
  sendChat() { return { ok: true }; }
  stop() { this.state = 'stopped'; this.options.onFeedback({ type: 'stopped', data: {} }); return { ok: true }; }
  close() { this.state = 'stopped'; }
}

async function make(t, { modelId = 'qwen3.8-flash-next-coder-iq1_m', limits = {} } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'paired-companion-'));
  const directory = join(parent, 'Brisa');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const captures = { claims: [], runners: [] };
  const companion = new PairedCompanion({ directory, url: 'wss://world.example/ws', modelId,
    maxCalls: limits.maxCalls ?? 3, maxTokens: limits.maxTokens ?? 64000,
    claim: async input => { captures.claims.push(input); return bootstrap(); },
    runnerFactory: options => { const runner = new FakeRunner(options); captures.runners.push(runner); return runner; },
  });
  t.after(() => companion.close());
  return { companion, directory, captures };
}

test('pairing keeps the one-use credential in memory and reuses the scoped durable journal and allowance', async t => {
  const { companion, directory, captures } = await make(t);
  const first = await companion.start(CODE);
  assert.equal(first.ok, true);
  assert.equal(captures.claims[0].code, CODE);
  assert.equal(captures.runners[0].options.authorization.token, TOKEN);
  assert.deepEqual(captures.runners[0].options.content, CONTENT);
  assert.equal(captures.runners[0].options.grant.capabilities.join(','), 'chat,presence');
  const before = companion.budget;
  const memoryBefore = await readFile(join(directory, 'memory.jsonl'), 'utf8');
  await companion.stop();
  assert.equal((await companion.start(CODE)).ok, true);
  assert.equal(companion.budget.totals.calls, before.totals.calls);
  assert.equal(await readFile(join(directory, 'memory.jsonl'), 'utf8'), memoryBefore);
  const files = await readdir(directory, { recursive: true });
  for (const file of files) {
    const filePath = join(directory, file), info = await lstat(filePath);
    if (!info.isFile()) continue;
    const contents = await readFile(filePath, 'utf8');
    assert.equal(contents.includes(TOKEN), false, `${file} must not persist the admission token`);
    assert.equal(contents.includes(CODE), false, `${file} must not persist the one-use pairing code`);
  }
});

test('remote stop settles the runner and permits the same controller to pair again', async t => {
  const { companion, captures } = await make(t);
  assert.equal((await companion.start(CODE)).ok, true);
  const stopped = companion.waitForStop();
  captures.runners[0].options.onFeedback({ type: 'stopped', data: { reason: 'owner_disconnected' } });
  await stopped;
  assert.equal(companion.state, 'stopped');
  assert.equal(companion.diagnostics.sessionId, null);
  assert.equal((await companion.start(CODE)).ok, true);
  assert.equal(captures.runners.length, 2);
});

test('stop during asynchronous document loading cancels setup before runner connect', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'paired-cancel-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  let companion, runner;
  companion = new PairedCompanion({ directory: join(parent, 'Brisa'), url: 'wss://world.example/ws',
    claim: async () => bootstrap(), runnerFactory: options => {
      runner = new FakeRunner(options);
      queueMicrotask(() => companion.stop());
      return runner;
    } });
  t.after(() => companion.close());
  assert.deepEqual(await companion.start(CODE), { ok: false, why: 'pair_cancelled' });
  assert.equal(runner.connectCalls, 0);
  assert.equal(runner.state, 'stopped');
  assert.equal(companion.state, 'stopped');
  assert.equal(companion.diagnostics.sessionId, null);
});

test('pairing fails closed for reused companion files with a different model policy', async t => {
  const first = await make(t);
  assert.equal((await first.companion.start(CODE)).ok, true);
  await first.companion.stop();
  const second = new PairedCompanion({ directory: first.directory, url: 'wss://world.example/ws',
    modelId: 'different-local-model', claim: async () => bootstrap(), runnerFactory: options => new FakeRunner(options),
    adapterFactory: () => ({}) });
  t.after(() => second.close());
  assert.deepEqual(await second.start(CODE), { ok: false, why: 'pair_start_failed' });
});

test('claim transport sends only the pairing envelope and rejects malformed bootstrap without exposing credentials', async () => {
  class Socket extends EventEmitter {
    constructor(url, options) {
      super(); assert.equal(url, 'wss://world.example:9443/ws');
      assert.deepEqual(options, { origin: 'https://world.example:9443' });
      this.close = () => {}; setImmediate(() => this.emit('open'));
    }
    send(raw) {
      const request = JSON.parse(raw);
      assert.deepEqual(Object.keys(request).sort(), ['code', 'op', 'requestId', 't']);
      assert.equal(request.code, CODE);
      const body = bootstrap();
      setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ t: 'agent_companion_pair_result', requestId: request.requestId,
        ok: true, why: null, enabled: true, code: null, expiresAtMs: null, bootstrap: body }))));
    }
  }
  const result = await claimPairCode({ url: 'wss://world.example:9443/ws', code: CODE, WebSocketClass: Socket });
  assert.equal(result.record.preset.name, 'Brisa');
  const fixedNow = 1_900_000_000_000;
  const expirySocket = expiresAtMs => class extends Socket {
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ t: 'agent_companion_pair_result', requestId: request.requestId,
        ok: true, why: null, enabled: true, code: null, expiresAtMs: null, bootstrap: bootstrap({ expiresAtMs }) }))));
    }
  };
  const skewedExpiry = fixedNow + 60 * 60_000 + 10_000;
  const skewed = await claimPairCode({ url: 'wss://world.example:9443/ws', code: CODE, now: () => fixedNow,
    WebSocketClass: expirySocket(skewedExpiry) });
  assert.equal(skewed.expiresAtMs, skewedExpiry, 'accepted server expiry must not be extended');
  await assert.rejects(claimPairCode({ url: 'wss://world.example:9443/ws', code: CODE, now: () => fixedNow,
    WebSocketClass: expirySocket(fixedNow + 60 * 60_000 + 30_001) }), /pair_unavailable/);
  await assert.rejects(claimPairCode({ url: 'wss://world.example:9443/ws', code: CODE, now: () => fixedNow,
    WebSocketClass: expirySocket(fixedNow) }), /pair_unavailable/);
  class UnpublishedContentSocket extends Socket {
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ t: 'agent_companion_pair_result', requestId: request.requestId,
        ok: true, why: null, enabled: true, code: null, expiresAtMs: null,
        bootstrap: { ...bootstrap(), content: { generation: 0, revisionId: null } } }))));
    }
  }
  assert.equal((await claimPairCode({ url: 'wss://world.example:9443/ws', code: CODE, WebSocketClass: UnpublishedContentSocket })).content.revisionId, null);
  class InvalidSocket extends Socket {
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ t: 'agent_companion_pair_result', requestId: request.requestId,
        ok: true, why: null, enabled: true, code: null, expiresAtMs: null,
        bootstrap: { ...bootstrap(), token: 'credential-must-not-escape' } }))));
    }
  }
  await assert.rejects(claimPairCode({ url: 'wss://world.example:9443/ws', code: CODE, WebSocketClass: InvalidSocket }), /pair_unavailable/);
  class InvalidOwnerSocket extends Socket {
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({ t: 'agent_companion_pair_result', requestId: request.requestId,
        ok: true, why: null, enabled: true, code: null, expiresAtMs: null,
        bootstrap: { ...bootstrap(), scope: { ...bootstrap().scope, ownerId: 'C01-owner' } } }))));
    }
  }
  await assert.rejects(claimPairCode({ url: 'wss://world.example:9443/ws', code: CODE, WebSocketClass: InvalidOwnerSocket }), /pair_unavailable/);
});

test('live owner C01 delivery gets one local-model reply and a durable scoped memory episode', { timeout: 30000 }, async t => {
  const { owner, other, pair, parent, model } = await livePairFixture(t);
  await until(() => pair.state === 'ready', 'paired runner ready');
  assert.equal(pair.scope.ownerId, OWNER);
  assert.equal(pair.scope.characterId, CHARACTER);

  other.sendChat('other-not-owner', 'Este mensaje no debe activar a Brisa.');
  await other.waitFor(message => message.t === MSG.CHAT_RESULT && message.requestId === 'other-not-owner');
  await delay(100);
  assert.equal(model.calls, 0, 'a different random chat peer must not trigger local inference');

  owner.sendChat('owner-live-inbound', '¿Puedes acompañarme por la costa?');
  await owner.waitFor(message => message.t === MSG.CHAT_RESULT && message.requestId === 'owner-live-inbound');
  const reply = await owner.waitFor(message => message.t === MSG.CHAT_MESSAGE && message.sender.name === 'Brisa' &&
    message.text === 'Brisa te responde.');
  assert.equal(reply.channel, 'world');
  assert.equal(model.calls, 1);
  assert.equal(model.modelId, 'qwen3.8-flash-next-coder-iq1_m');
  const memoryPath = join(parent, 'companion', 'memory.jsonl');
  const contents = await until(async () => {
    const text = await readFile(memoryPath, 'utf8'); return text.trim() ? text : null;
  }, 'delivered exchange memory');
  const episode = JSON.parse(contents.trim().split(/\r?\n/)[0]);
  assert.equal(episode.scope.ownerId, OWNER);
  assert.equal(episode.scope.characterId, CHARACTER);
  assert.ok(episode.payload.chat.some(message => message.text === '¿Puedes acompañarme por la costa?'));
  assert.ok(episode.payload.chat.some(message => message.text === 'Brisa te responde.'));

  const beforeReopen = pair.budget;
  const savedPersonality = await readFile(join(parent, 'companion', 'personality.md'), 'utf8');
  const savedJournal = await readFile(memoryPath, 'utf8');
  pair.stop();
  assert.equal((await pair.start(CODE)).ok, true);
  assert.deepEqual(pair.budget.totals, beforeReopen.totals, 'reopening the same documents must retain the persisted allowance');
  assert.equal(await readFile(join(parent, 'companion', 'personality.md'), 'utf8'), savedPersonality);
  assert.equal(await readFile(memoryPath, 'utf8'), savedJournal);
  assert.equal(model.calls, 1);
});

test('local model HTTP failure reports only a safe diagnostic and saves no reply or journal entry', { timeout: 30000 }, async t => {
  const { owner, pair, parent, model, statuses } = await livePairFixture(t, { httpFailure: true });
  owner.sendChat('owner-model-failure', 'Este mensaje es privado y no debe salir en diagnósticos.');
  await owner.waitFor(message => message.t === MSG.CHAT_RESULT && message.requestId === 'owner-model-failure');
  await until(() => statuses.length === 1, 'safe model failure diagnostic');

  assert.equal(model.calls, 1);
  assert.deepEqual(statuses, [{ phase: 'inference', result: 'failed' }]);
  const diagnostic = statusMessage(statuses[0]);
  assert.equal(diagnostic, 'No pude responder: falló el modelo local. Comprueba que esté disponible.');
  assert.equal(diagnostic.includes('PRIVATE_PROVIDER_SECRET_DO_NOT_ECHO'), false);
  assert.equal(JSON.stringify(statuses).includes('PRIVATE_PROVIDER_SECRET_DO_NOT_ECHO'), false);
  assert.equal(owner.messages.some(message => message.t === MSG.CHAT_MESSAGE && message.sender.name === 'Brisa'), false);
  assert.equal(await readFile(join(parent, 'companion', 'memory.jsonl'), 'utf8'), '');
});

test('stop during a local model request fences its late response and does not capture an exchange', { timeout: 30000 }, async t => {
  const { owner, pair, parent, model } = await livePairFixture(t, { holdModel: true });
  owner.sendChat('owner-stop-inference', 'Brisa, responde cuando puedas.');
  await owner.waitFor(message => message.t === MSG.CHAT_RESULT && message.requestId === 'owner-stop-inference');
  await until(() => model.calls === 1, 'local model request');
  pair.stop();
  model.release();
  await delay(100);
  assert.equal(owner.messages.some(message => message.t === MSG.CHAT_MESSAGE && message.sender.name === 'Brisa'), false);
  assert.equal((await readFile(join(parent, 'companion', 'memory.jsonl'), 'utf8')), '');
  assert.equal(pair.state, 'stopped');
});

test('the CLI validates options before prompting and accepts a pasted multi-character hex code', async () => {
  assert.throws(() => new PairedCompanion(argumentsOf(['--url', 'http://world.example/ws', '--directory', 'companion'])), /invalid_paired_companion_options/);
  assert.throws(() => new PairedCompanion({ directory: 'C:\\companion', url: 'wss://world.example/ws', onStatus: 'log everything' }), /invalid_paired_companion_options/);
  assert.throws(() => argumentsOf(['--url', 'wss://world.example/ws', '--directory', 'companion', '--max-calls', '9']), /invalid_arguments/);
  const input = new EventEmitter();
  input.isTTY = true;
  input.setRawMode = value => { input.rawMode = value; };
  input.resume = () => {};
  const output = { text: '', write(chunk) { this.text += chunk; } };
  const pending = privateLine(input, output);
  input.emit('keypress', 'a'.repeat(64), {});
  input.emit('keypress', '', { name: 'return' });
  assert.equal(await pending, CODE);
  assert.equal(input.rawMode, false);
  assert.ok(output.text.includes('*'.repeat(64)));
});
