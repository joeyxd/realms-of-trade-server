import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { createSimulatedMind } from '../tools/agent/simulated-mind.mjs';
import { runnerMindSnapshot } from '../tools/agent/mind-snapshot.mjs';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';

const WORLD = 'conversation-network-lab';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const AGENT_TOKEN = 'agent-conversation-network-local-token';
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function until(check, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await sleep(10);
  }
  assert.fail(`${label} timeout`);
}

async function room(t, { managed = false, localRadius = 200 } = {}) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 17, bots: 0, maxPlayers: 8,
    dev: false, worldId: WORLD, saveSecret: 'conversation-network-test-secret', store: createMemoryStore(), log() {},
    chat: { localRadius, burst: 20, refillPerSecond: 10 },
    ...(managed ? {
      resolvePlayer: async (_request, message) => message.token === 'owner-token' ? OWNER :
        message.token === AGENT_TOKEN ? CHARACTER : null,
      agentControl: { worldId: WORLD, ttlMs: 60000, bindings: [{ ownerId: OWNER, characterId: CHARACTER,
        capabilities: ['chat'] }] },
    } : {}),
  });
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

class Wire {
  constructor(url, name, token = null) {
    this.name = name; this.ws = new WebSocket(url); this.messages = []; this.waiters = [];
    this.opened = new Promise((resolvePromise, reject) => {
      this.ws.once('open', resolvePromise); this.ws.once('error', reject);
    });
    this.ws.on('message', (data) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
      }
    });
    this.token = token;
  }
  async connect() {
    await this.opened;
    this.ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION,
      ...(this.token ? { token: this.token } : {}), name: this.name, skin: 0, weapon: 0 }));
    const welcome = await this.waitFor((message) => message.t === MSG.WELCOME || message.t === MSG.ERROR);
    assert.equal(welcome.t, MSG.WELCOME, JSON.stringify(welcome));
    await this.waitFor((message) => message.t === MSG.CHAT_STATE);
  }
  waitFor(predicate, timeoutMs = 5000) {
    const found = this.messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error(`${this.name} wire wait timeout`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
  get chatState() { return this.messages.filter((message) => message.t === MSG.CHAT_STATE).at(-1); }
  sendChat({ id, channel, text, target }) {
    this.ws.send(JSON.stringify({ t: MSG.CHAT_SEND, id, channel, text, ...(target ? { target } : {}) }));
  }
  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

function grant({ managed = false, capabilities = ['chat'] } = {}) {
  return { v: 1, scope: { ownerId: managed ? OWNER : 'conversation-owner',
    characterId: managed ? CHARACTER : 'conversation-agent', worldId: WORLD, sessionId: `conversation-${Date.now()}` },
    controlRevision: 1, expiresAtMs: Date.now() + 60000, capabilities };
}

async function ownerFiles(directory, scope, personality = 'Brisa habla con calidez y menciona el viento de popa.') {
  await writeFile(join(directory, 'personality.md'), `${personality}\n`);
  await writeFile(join(directory, 'objectives.json'), JSON.stringify({ v: 1, revision: 1,
    scope: { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId }, goals: [] }));
  await writeFile(join(directory, 'memory.jsonl'), '');
  return loadOwnerFiles({ directory, scope: { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId } });
}

function budget(scope, maxCalls = 12) {
  return new InferenceBudget({ scope, limits: { maxCalls, maxTokens: 50000, maxCostUnits: 50000, maxEntries: 32 } });
}

function captureAdapter(decision, packets, { delayComplete = null } = {}) {
  const simulated = createSimulatedMind({ decision });
  return { ...simulated,
    prepare(request) { packets.push(structuredClone(request)); return simulated.prepare(request); },
    ...(delayComplete ? { complete: delayComplete(simulated.complete.bind(simulated)) } : {}),
  };
}

function makeMind(runner, files, adapter, { policy = {}, budgetOverride = null, onOrder = () => {} } = {}) {
  const scope = { ownerId: runner.grant.scope.ownerId, characterId: runner.grant.scope.characterId, worldId: runner.grant.scope.worldId };
  return new AgentMind({ adapter, budget: budgetOverride ?? budget(scope),
    readSnapshot: async () => runnerMindSnapshot(runner, await loadOwnerFiles({ directory: files.directory, scope })),
    submitOrder: onOrder, sendChat: (order) => runner.sendChat(order), conversationPolicy: policy,
    limits: { timeoutMs: 5000 },
  });
}

async function makeAgent(t, url, options = {}) {
  const g = grant(options);
  const runner = new AgentNetworkRunner({ url, grant: g,
    ...(options.managed ? { authorization: { token: AGENT_TOKEN } } : {}), name: 'Brisa IA' });
  t.after(() => runner.close());
  await runner.connect();
  await until(() => runner.chat?.available && runner.chat?.self, 'agent C01 session');
  return runner;
}

test('conversation uses delivered local/whisper messages, fixes audience, and ignores echoes and duplicates', { timeout: 25000 }, async (t) => {
  const { url } = await room(t);
  const owner = new Wire(url, 'Observador'); await owner.connect(); t.after(() => owner.close());
  const witness = new Wire(url, 'Tercero'); await witness.connect(); t.after(() => witness.close());
  const runner = await makeAgent(t, url);
  const senderPeer = owner.chatState.self;
  const witnessPeer = owner.chatState.peers.find((peer) => peer.name === 'Tercero').id;
  const agentPeer = owner.chatState.peers.find((peer) => peer.name === 'Brisa IA').id;
  assert.equal(agentPeer, runner.chat.self);

  owner.sendChat({ id: 'private-owner-witness', channel: 'whisper', text: 'Solo para el testigo.', target: witnessPeer });
  await owner.waitFor((message) => message.t === MSG.CHAT_RESULT && message.requestId === 'private-owner-witness');
  await until(() => witness.messages.some((message) => message.t === MSG.CHAT_MESSAGE && message.requestId === 'private-owner-witness'),
    'private owner-to-witness message');
  assert.equal(runner.chat.messages.some((message) => message.requestId === 'private-owner-witness'), false);

  const directory = await mkdtemp(join(tmpdir(), 'agent-conversation-network-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = { ownerId: runner.grant.scope.ownerId, characterId: runner.grant.scope.characterId, worldId: runner.grant.scope.worldId };
  await ownerFiles(directory, scope);
  const names = ['personality.md', 'objectives.json', 'memory.jsonl'];
  const before = new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name), 'utf8')])));
  const packets = [];
  const mind = makeMind(runner, { directory }, captureAdapter({ type: 'reply', args: { text: 'Brisa responde desde la cubierta.' } }, packets), {
    policy: { channels: ['local', 'whisper'], maxRepliesPerPeer: 8, cooldownMs: 0 },
  });
  const settledLocally = await until(() => runner.observation?.revision > 0 && runner.chat?.peers?.some((peer) => peer.id === senderPeer),
    'current agent observation and peer');
  assert.ok(settledLocally);

  owner.sendChat({ id: 'owner-local-inbound', channel: 'local', text: '¿Puedes ayudarme con la vela?' });
  await owner.waitFor((message) => message.t === MSG.CHAT_RESULT && message.requestId === 'owner-local-inbound');
  const localInput = await until(() => runner.chat.messages.find((message) => message.requestId === 'owner-local-inbound'),
    'delivered local message to agent');
  await until(() => runner.observation?.tick >= localInput.tick && runner.observation?.chat?.some((message) => message.id === localInput.id),
    'local message enters current normalized observation');
  const localResult = await mind.converse({ messageId: localInput.id });
  assert.equal(localResult.ok, true, JSON.stringify(localResult));
  const localReply = await owner.waitFor((message) => message.t === MSG.CHAT_MESSAGE && message.sender.name === 'Brisa IA' &&
    message.text === 'Brisa responde desde la cubierta.');
  assert.equal(localReply.channel, 'local');
  await until(() => runner.chat.requests.some((request) => request.payload.text === localReply.text && request.state === 'routed'),
    'local reply routed');
  const previousMessageCount = runner.chat.messages.length;
  const duplicateResult = await mind.converse({ messageId: localInput.id });
  assert.equal(duplicateResult.ok, false);
  assert.equal(runner.chat.messages.length, previousMessageCount);
  const ownEcho = runner.chat.messages.find((message) => message.id === localReply.id);
  assert.ok(ownEcho);
  const echoResult = await mind.converse({ messageId: ownEcho.id });
  assert.equal(echoResult.ok, false);
  assert.equal(runner.chat.messages.length, previousMessageCount);

  owner.sendChat({ id: 'owner-whisper-inbound', channel: 'whisper', text: 'Esto solo lo recibe Brisa.', target: agentPeer });
  await owner.waitFor((message) => message.t === MSG.CHAT_RESULT && message.requestId === 'owner-whisper-inbound');
  const whisperInput = await until(() => runner.chat.messages.find((message) => message.requestId === 'owner-whisper-inbound'),
    'delivered private message to agent');
  await until(() => runner.observation?.tick >= whisperInput.tick && runner.observation?.chat?.some((message) => message.id === whisperInput.id),
    'whisper enters current normalized observation');
  assert.equal(whisperInput.target?.id, runner.chat.self);
  const whisperResult = await mind.converse({ messageId: whisperInput.id });
  assert.equal(whisperResult.ok, true, JSON.stringify(whisperResult));
  const privateReply = await owner.waitFor((message) => message.t === MSG.CHAT_MESSAGE && message.text === 'Brisa responde desde la cubierta.' &&
    message.channel === 'whisper' && message.sender.name === 'Brisa IA');
  assert.equal(privateReply.target.id, senderPeer, 'whisper response preserves the delivered sender connection token');
  await until(() => runner.chat.requests.filter((request) => request.payload.channel === 'whisper' && request.state === 'routed').length === 1,
    'private response routed');
  assert.equal(witness.messages.some((message) => message.t === MSG.CHAT_MESSAGE &&
    ['owner-whisper-inbound', privateReply.requestId].includes(message.requestId)), false,
  'third connection receives neither private input nor reply');

  const prompt = JSON.stringify(packets);
  assert.match(prompt, /Brisa habla con calidez/);
  assert.match(prompt, /¿Puedes ayudarme con la vela\?/);
  assert.match(prompt, /Esto solo lo recibe Brisa\./);
  assert.doesNotMatch(prompt, /Solo para el testigo\./, 'a whisper not delivered to the agent stays out of its prompt');
  assert.equal(prompt.includes('token'), false, 'chat context contains no account token');
  for (const name of names) assert.equal(await readFile(join(directory, name), 'utf8'), before.get(name));
  mind.close();
});

test('world replies are opt-in and a simulated model cannot change the selected channel or recipient', { timeout: 20000 }, async (t) => {
  const { url } = await room(t);
  const owner = new Wire(url, 'Observador'); await owner.connect(); t.after(() => owner.close());
  const witness = new Wire(url, 'Tercero'); await witness.connect(); t.after(() => witness.close());
  const runner = await makeAgent(t, url);
  const directory = await mkdtemp(join(tmpdir(), 'agent-conversation-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = { ownerId: runner.grant.scope.ownerId, characterId: runner.grant.scope.characterId, worldId: runner.grant.scope.worldId };
  await ownerFiles(directory, scope);
  const worldMessage = async (id) => {
    owner.sendChat({ id, channel: 'world', text: 'Mensaje de mundo.' });
    await owner.waitFor((message) => message.t === MSG.CHAT_RESULT && message.requestId === id);
    return until(() => runner.chat.messages.find((message) => message.requestId === id), `world message ${id} delivered`);
  };

  const deniedInput = await worldMessage('world-default-denied');
  await until(() => runner.observation?.tick >= deniedInput.tick && runner.observation?.chat?.some((message) => message.id === deniedInput.id),
    'world input enters current normalized observation');
  const defaultMind = makeMind(runner, { directory }, createSimulatedMind({ decision: { type: 'reply', args: { text: 'No debe responder.' } } }));
  const denied = await defaultMind.converse({ messageId: deniedInput.id });
  assert.equal(denied.ok, false);
  assert.equal(denied.why, 'channel_disabled');
  assert.equal(runner.chat.requests.length, 0);
  defaultMind.close();

  const worldPackets = [];
  const worldMind = makeMind(runner, { directory }, captureAdapter({ type: 'reply', args: { text: 'Saludos a todos en Mundo.' } }, worldPackets), {
    policy: { channels: ['world'], maxRepliesPerPeer: 8, cooldownMs: 0 },
  });
  const worldResult = await worldMind.converse({ messageId: deniedInput.id });
  assert.equal(worldResult.ok, true, JSON.stringify(worldResult));
  await owner.waitFor((message) => message.t === MSG.CHAT_MESSAGE && message.text === 'Saludos a todos en Mundo.');
  await until(() => witness.messages.some((message) => message.t === MSG.CHAT_MESSAGE && message.text === 'Saludos a todos en Mundo.'),
    'opt-in world reply reaches the third participant');
  await until(() => runner.chat.messages.some((message) => message.text === 'Saludos a todos en Mundo.'),
    'the agent receives its own earlier world reply before measuring the next turn');

  const beforeCount = runner.chat.messages.length;
  const beforeRequests = runner.chat.requests.length;
  const maliciousMind = makeMind(runner, { directory }, createSimulatedMind({ decision: {
    type: 'reply', args: { text: 'Attempted channel switch.', channel: 'whisper', target: runner.chat.self },
  } }), { policy: { channels: ['world'], maxRepliesPerPeer: 8, cooldownMs: 0 } });
  const malicious = await maliciousMind.converse({ messageId: deniedInput.id });
  assert.equal(malicious.ok, false);
  assert.equal(malicious.why, 'invalid_decision');
  assert.equal(runner.chat.requests.length, beforeRequests, 'invalid generated fields cannot create a chat request');
  assert.equal(runner.chat.messages.length, beforeCount);
  assert.equal(witness.messages.some((message) => message.t === MSG.CHAT_MESSAGE && message.text === 'Attempted channel switch.'), false);
  worldMind.close(); maliciousMind.close();
});

test('owner stop cancels a held conversation; late simulated usage settles without a late chat send', { timeout: 25000 }, async (t) => {
  const { url } = await room(t, { managed: true });
  const owner = new Wire(url, 'Owner', 'owner-token'); await owner.connect(); t.after(() => owner.close());
  const witness = new Wire(url, 'Tercero'); await witness.connect(); t.after(() => witness.close());
  let mind;
  const runner = new AgentNetworkRunner({ url, grant: grant({ managed: true }), authorization: { token: AGENT_TOKEN },
    name: 'Brisa IA', onFeedback: (event) => { if (event.type === 'stopped') mind?.cancel(); } });
  t.after(() => runner.close());
  await runner.connect();
  await until(() => runner.chat?.available && runner.chat.self, 'managed agent chat session');
  const ownerPeer = runner.chat.peers.find((peer) => peer.name === 'Owner');
  assert.ok(ownerPeer);
  owner.sendChat({ id: 'owner-held-whisper', channel: 'whisper', text: 'Solo Brisa, responde cuando puedas.', target: runner.chat.self });
  await owner.waitFor((message) => message.t === MSG.CHAT_RESULT && message.requestId === 'owner-held-whisper');
  const source = await until(() => runner.chat.messages.find((message) => message.requestId === 'owner-held-whisper'), 'agent private input');
  await until(() => runner.observation?.tick >= source.tick && runner.observation?.chat?.some((message) => message.id === source.id),
    'held whisper enters current normalized observation');

  const directory = await mkdtemp(join(tmpdir(), 'agent-conversation-stop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD };
  await ownerFiles(directory, scope);
  const simulated = createSimulatedMind({ decision: { type: 'reply', args: { text: 'Late simulated reply.' } } });
  let release, completeStarted;
  const deferred = new Promise((resolvePromise) => { release = resolvePromise; });
  const started = new Promise((resolvePromise) => { completeStarted = resolvePromise; });
  const adapter = { ...simulated, async complete(args) {
    completeStarted(); await deferred;
    return simulated.complete({ ...args, signal: new AbortController().signal });
  } };
  const packets = [];
  const captured = { ...adapter, prepare(request) { packets.push(structuredClone(request)); return simulated.prepare(request); } };
  mind = makeMind(runner, { directory }, captured, {
    policy: { channels: ['whisper'], maxRepliesPerPeer: 8, cooldownMs: 0 },
  });
  const pending = mind.converse({ messageId: source.id });
  await started;
  owner.ws.send(JSON.stringify({ t: MSG.AGENT_CONTROL, op: 'stop', characterId: CHARACTER }));
  await until(() => runner.state === 'stopped' && mind.state.conversation?.submissionUncertain === false,
    'owner stop and local inference cancellation');
  const cancelled = await pending;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.why, 'inference_cancelled');
  assert.equal(mind.state.ledger.totals.unknownEntries, 1);
  release();
  await until(() => mind.state.ledger.totals.settledEntries === 1, 'late native usage settlement');
  assert.equal(owner.messages.some((message) => message.t === MSG.CHAT_MESSAGE && message.text === 'Late simulated reply.'), false);
  assert.equal(witness.messages.some((message) => message.t === MSG.CHAT_MESSAGE && message.text === 'Late simulated reply.'), false);
  assert.equal(mind.state.conversation.counts.turns, 1, 'cancelled source remains consumed and cannot be retried as a second turn');
  assert.ok(packets.length > 0);
  mind.close();
});

function cli({ url, files, args = [] }) {
  const child = spawn(process.execPath, ['tools/agent/run.mjs', '--url', url, '--files', files,
    '--owner', 'cli-owner', '--character', 'cli-agent', '--world', WORLD, '--capabilities', 'chat', ...args],
  { cwd: resolve('.'), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return { child, text: () => stdout, stderr: () => stderr,
    events: () => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
  };
}

test('CLI scripted reply is inspectable with personality context, stops cleanly, and leaves owner files unchanged', { timeout: 30000 }, async (t) => {
  const { url } = await room(t);
  const directory = await mkdtemp(join(tmpdir(), 'agent-conversation-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = { ownerId: 'cli-owner', characterId: 'cli-agent', worldId: WORLD };
  const personality = 'Brisa es una capitana amable; al saludar, menciona el viento de popa.';
  await ownerFiles(directory, scope, personality);
  const names = ['personality.md', 'objectives.json', 'memory.jsonl'];
  const before = new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name), 'utf8')])));
  const p = cli({ url, files: directory, args: ['--mind', 'simulated'] });
  t.after(async () => { if (p.child.exitCode === null) { p.child.kill(); await once(p.child, 'exit').catch(() => {}); } });
  await until(() => p.events().some((event) => event.type === 'ready'), 'simulated conversation CLI ready');
  const owner = new Wire(url, 'Observador'); await owner.connect(); t.after(() => owner.close());
  const witness = new Wire(url, 'Tercero'); await witness.connect(); t.after(() => witness.close());
  await until(() => owner.chatState.peers.some((peer) => peer.name === 'Brisa [IA]'), 'CLI agent appears in chat peers');
  const witnessPeer = owner.chatState.peers.find((peer) => peer.name === 'Tercero').id;
  owner.sendChat({ id: 'cli-unrelated-whisper', channel: 'whisper', text: 'Este mensaje es solo para el testigo.', target: witnessPeer });
  await owner.waitFor((message) => message.t === MSG.CHAT_RESULT && message.requestId === 'cli-unrelated-whisper');
  await witness.waitFor((message) => message.t === MSG.CHAT_MESSAGE && message.requestId === 'cli-unrelated-whisper');
  owner.sendChat({ id: 'cli-conversation-input', channel: 'local', text: 'Hola Brisa, ¿cómo está el viento?' });
  await owner.waitFor((message) => message.t === MSG.CHAT_RESULT && message.requestId === 'cli-conversation-input');
  const incoming = await until(() => p.events().find((event) => event.type === 'chat_message' &&
    event.data.message?.requestId === 'cli-conversation-input')?.data.message, 'CLI receives delivered chat event');
  await until(() => p.events().some((event) => event.type === 'observation' && event.data?.observation?.tick >= incoming.tick &&
    event.data.observation.chat?.some((message) => message.id === incoming.id)), 'CLI normalized observation includes delivered message');
  p.send({ type: 'respond', messageId: incoming.id });
  const greeting = await owner.waitFor((message) => message.t === MSG.CHAT_MESSAGE && message.sender.name === 'Brisa [IA]' &&
    message.channel === 'local');
  assert.equal(greeting.text, 'Con calma, compañero. Te escucho.');
  const result = await until(() => p.events().find((event) => event.type === 'conversation_result' && event.data?.ok)?.data,
    'CLI conversation result is inspectable');
  assert.equal(result.providerContext.required.personality, `${personality}\n`);
  assert.doesNotMatch(JSON.stringify(result.providerContext), /Este mensaje es solo para el testigo\./);
  const outputCount = owner.messages.filter((message) => message.t === MSG.CHAT_MESSAGE && message.sender.name === 'Brisa [IA]').length;
  p.send({ type: 'respond', messageId: incoming.id });
  await until(() => p.events().some((event) => event.type === 'conversation_result' && event.data?.why === 'reply_already_attempted'),
    'repeated CLI response is blocked');
  assert.equal(owner.messages.filter((message) => message.t === MSG.CHAT_MESSAGE && message.sender.name === 'Brisa [IA]').length, outputCount);
  assert.doesNotMatch(p.text(), /agent-conversation-network-local-token|owner-token/);
  assert.equal(p.stderr(), '');
  p.send({ type: 'stop' });
  assert.equal((await once(p.child, 'exit'))[0], 0);
  assert.ok(p.events().some((event) => event.type === 'stop_response'));
  for (const name of names) assert.equal(await readFile(join(directory, name), 'utf8'), before.get(name));
});
