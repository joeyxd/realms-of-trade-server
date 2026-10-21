// IC03b: the paired runner accepts the presence grant and drives the owner's presence body
// through follow, wait and return, one paced CAS order per owner chat turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { WsTransport } from '../src/net/wsTransport.js';
import { DEFAULT_COMPANION_PRESET } from '../src/net/companionCreation.js';
import { AgentNetworkRunner } from '../tools/agent/network-runner.mjs';
import { PairedCompanion, claimPairCode } from '../tools/agent/paired-companion.mjs';
import { PresenceDriver, PRESENCE_PACING } from '../tools/agent/presence-driver.mjs';
import { NETWORK_CAPABILITIES, validGrant } from '../tools/agent/contract.mjs';
import { presenceAnchor, presenceWorkPoint, pointOnRouteReason } from '../server/companionPresencePolicy.mjs';
import { RESOURCE_KINDS } from '../src/data/resources.js';
import { CONVERSATION_BODY_INSTRUCTION, CONVERSATION_RESPONSE_SCHEMA, CONVERSATION_BODY_RESPONSE_SCHEMA,
  parseDecision } from '../tools/agent/mind-contract.mjs';

const OWNER = '22222222-2222-4222-8222-222222222222';
const WORLD = 'paired-presence';
const PRESENCE = MSG.AGENT_COMPANION_PRESENCE;
const PRESENCE_RESULT = MSG.AGENT_COMPANION_PRESENCE_RESULT;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let serial = 0;

async function until(predicate, label = 'condition', timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = predicate(); if (value) return value; await pause(5); }
  throw new Error(`${label} timeout`);
}

class Wire {
  constructor(url) {
    this.messages = []; this.ws = new WebSocket(url);
    this.open = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.closed = new Promise(resolve => this.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    // Snapshots are dropped: the game timer runs, and only messages matter to these tests.
    this.ws.on('message', bytes => { const message = JSON.parse(bytes.toString()); if (message.t !== MSG.SNAPSHOT) this.messages.push(message); });
  }
  async send(message) { await this.open; this.ws.send(JSON.stringify(message)); }
  async next(predicate, after = 0) { return until(() => this.messages.slice(after).find(predicate), 'wire message'); }
  async close() {
    if (this.ws.readyState >= WebSocket.CLOSING) return;
    this.ws.close(); await this.closed;
  }
}

// The room of tests/companion-body-mind-network.test.mjs, with the game timer left running:
// the runner needs fresh snapshots to become ready and to answer chat.
async function room(t, { presence = true } = {}) {
  const store = createMemoryStore();
  const createCompanion = store.createCompanion.bind(store);
  const loadCompanionCreation = store.loadCompanionCreation.bind(store);
  store.loadCompanionCreation = async scope => {
    const record = await loadCompanionCreation(scope);
    if (!record) return record;
    const control = await store.loadCompanionControl({ ...scope, character: record.characterKey });
    return { ...record, control };
  };
  store.createCompanion = async input => {
    const result = await createCompanion(input);
    if (result?.ok && !result.replay) await store.saveCompanionControl({ world: input.world, owner: input.owner,
      character: result.record.characterKey, expectedRevision: 0, stopped: true });
    return result;
  };
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, maxPlayers: 8,
    worldId: WORLD, saveSecret: 'paired-presence-fixture', log() {}, store,
    companionCreation: true, companionCreationAllowMemory: true,
    companionConfigAllowMemory: true, companionControlAllowMemory: true,
    companionPairing: true, companionPairingAllowMemory: true,
    companionPresence: presence, companionPresenceAllowMemory: true,
    agentControl: { worldId: WORLD, bindings: [] },
    chat: { localRadius: 200, burst: 20, refillPerSecond: 10 },
    resolvePlayer: async (_req, { token }) => ({ owner: OWNER }[token] ?? null),
  });
  const port = await app.listen(), url = `ws://127.0.0.1:${port}/ws`, clients = [];
  t.after(async () => { await Promise.all(clients.map(client => client.close().catch(() => {}))); await app.close(); });
  // Every presence request a paired socket sends, as the server dispatches it.
  const service = app.game.companionPresence, log = [];
  const dispatch = service.dispatch.bind(service);
  service.dispatch = (sock, message) => {
    if (sock.companionMind || sock.pairedCompanion) log.push(structuredClone(message));
    return dispatch(sock, message);
  };
  return { app, url, log, async owner() {
    const client = new Wire(url); clients.push(client);
    const after = client.messages.length;
    await client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Owner QA', skin: 0, weapon: 0, token: 'owner' });
    const welcome = await client.next(m => [MSG.WELCOME, MSG.ERROR, MSG.FULL].includes(m.t), after);
    assert.equal(welcome.t, MSG.WELCOME);
    await client.next(m => m.t === MSG.CHAT_STATE);
    return client;
  } };
}

async function request(client, t, result, fields) {
  const requestId = `${t}-${++serial}`, after = client.messages.length;
  await client.send({ t, requestId, ...fields });
  return client.next(m => m.t === result && m.requestId === requestId, after);
}
const presenceOp = (client, op, expectedRevision) =>
  request(client, PRESENCE, PRESENCE_RESULT, { op, ...(op === 'load' ? {} : { expectedRevision }) });
const pairing = (client, op) => request(client, MSG.AGENT_COMPANION_PAIR, MSG.AGENT_COMPANION_PAIR_RESULT, { op });

// Created, allowed to connect and (with presence on) summoned into the world as the owner's body.
async function ownerCompanion(r, { presence = true } = {}) {
  const owner = await r.owner();
  const created = await request(owner, MSG.AGENT_COMPANION_CREATE, MSG.AGENT_COMPANION_CREATE_RESULT, { op: 'create',
    creationId: `30000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`, preset: structuredClone(DEFAULT_COMPANION_PRESET) });
  assert.equal(created.ok, true);
  const characterKey = created.record.characterKey;
  let loaded = null;
  if (presence) { loaded = await presenceOp(owner, 'load'); assert.equal(loaded.ok, true); }
  else assert.equal((await pairing(owner, 'load')).ok, true);
  const listed = await request(owner, MSG.AGENT_OWNER, MSG.AGENT_OWNER_RESULT, { op: 'list' });
  const row = listed.companions.find(item => item.characterKey === characterKey);
  assert.equal((await request(owner, MSG.AGENT_OWNER, MSG.AGENT_OWNER_RESULT, { op: 'resume', characterKey,
    epoch: row.epoch, expectedRevision: row.control.revision })).ok, true);
  if (presence) assert.equal((await presenceOp(owner, 'join', loaded.presence.revision)).ok, true);
  return { owner, characterKey };
}

async function fakeModel(t, decision) {
  const requests = [];
  const server = createServer(async (incoming, response) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(body);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: `reply-${requests.length}`, object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ v: 1, decision }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

// Driver time that never waits: a pause advances the clock instead.
function fakeTiming() {
  let now = 5_000_000;
  return { now: () => now, setTimer: (fn, ms) => { now += ms; return setImmediate(fn); }, clearTimer: timer => clearImmediate(timer),
    advance(ms) { now += ms; }, get at() { return now; } };
}

// The real PairedCompanion, claim and runner against the local host. The transport records every presence
// request the client puts on the wire and can hold some of them back (they then never reach the server).
async function paired(t, r, owner, { decision = { type: 'wait', args: {} }, timing = fakeTiming(), hold = () => false, afterPresence = null } = {}) {
  const model = await fakeModel(t, decision);
  const parent = await mkdtemp(join(tmpdir(), 'paired-presence-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const issued = await pairing(owner, 'issue');
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const local = r.url;
  class LocalSocket extends WebSocket { constructor() { super(local); } }
  const captured = { runner: null, driver: null, driverCalls: 0, sent: [], held: [], closes: [], types: new Set() };
  const events = [], statuses = [];
  const pair = new PairedCompanion({ directory: join(parent, 'companion'), url: 'wss://paired.example/ws',
    baseUrl: model.baseUrl, maxCalls: 4, maxTokens: 64000,
    claim: ({ code }) => claimPairCode({ url: 'wss://paired.example/ws', code, WebSocketClass: LocalSocket }),
    onStatus: status => statuses.push(status), onFeedback: event => events.push(event),
    runnerFactory: options => {
      const runner = new AgentNetworkRunner({ ...options, url: local, transportFactory: address => {
        const transport = new WsTransport(address, { WebSocketImpl: WebSocket });
        const send = transport.send.bind(transport);
        transport.send = message => {
          captured.types.add(message?.t);
          if (message?.t === PRESENCE) {
            captured.sent.push(structuredClone(message));
            if (hold(message)) { captured.held.push(structuredClone(message)); return; }
          }
          send(message);
        };
        transport.onClose(event => captured.closes.push(event));
        return transport;
      } });
      if (afterPresence) {
        const original = runner.presence.bind(runner);
        runner.presence = async (op, options) => { const receipt = await original(op, options); await afterPresence(op, receipt); return receipt; };
      }
      return (captured.runner = runner);
    },
    presenceDriverFactory: options => { captured.driverCalls++; return (captured.driver = new PresenceDriver({ ...options, ...timing })); },
  });
  t.after(() => pair.close());
  const started = await pair.start(issued.code);
  assert.equal(started.ok, true, JSON.stringify(started));
  return { pair, model, events, statuses, captured, started, timing };
}
const presenceEvents = (events, type = 'presence') => events.filter(event => event.type === type).map(event => event.data);
const ownerSay = (owner, id, text) => owner.send({ t: MSG.CHAT_SEND, id, channel: 'world', text });

test('the contract knows presence and the body-mode reply shape; other modes reject a body key', () => {
  assert.equal(NETWORK_CAPABILITIES.at(-1), 'presence');
  assert.ok(validGrant({ v: 1, scope: { ownerId: 'o', characterId: 'c', worldId: 'w', sessionId: 's' }, controlRevision: 1,
    expiresAtMs: 1, capabilities: ['chat', 'presence'] }));
  const reply = (args) => JSON.stringify({ v: 1, decision: { type: 'reply', args } });
  assert.deepEqual(parseDecision(reply({ text: 'Voy.', body: 'follow' }), 8192, 'conversation', { body: true }),
    { type: 'reply', args: { text: 'Voy.', body: 'follow' } });
  assert.deepEqual(parseDecision(reply({ text: 'Hola.' }), 8192, 'conversation', { body: true }), { type: 'reply', args: { text: 'Hola.' } });
  assert.equal(parseDecision(reply({ text: 'Voy.', body: 'attack' }), 8192, 'conversation', { body: true }), null);
  assert.equal(parseDecision(reply({ text: 'Voy.', body: 'follow', target: 3 }), 8192, 'conversation', { body: true }), null);
  assert.equal(parseDecision(reply({ text: 'Voy.', body: 'follow' }), 8192, 'conversation'), null, 'chat-only mode is unchanged');
  assert.equal(parseDecision(reply({ text: 'Voy.', body: 'follow' }), 8192, 'goals', { body: true }), null);
  assert.equal(parseDecision(JSON.stringify({ v: 1, decision: { type: 'wait', args: { body: 'wait' } } }), 8192, 'conversation', { body: true }), null);
  assert.deepEqual(parseDecision(JSON.stringify({ v: 1, decision: { type: 'wait', args: {} } }), 8192, 'conversation', { body: true }),
    { type: 'wait', args: {} }, 'the wait decision stays');
  assert.notDeepEqual(CONVERSATION_BODY_RESPONSE_SCHEMA, CONVERSATION_RESPONSE_SCHEMA);
  assert.match(CONVERSATION_BODY_INSTRUCTION, /untrusted data/); assert.match(CONVERSATION_BODY_INSTRUCTION, /server validates/);
});

test('driver: at least 1000 ms between sends, 20 per rolling minute, then paced without a send', async () => {
  const timing = fakeTiming(), calls = [];
  const driver = new PresenceDriver({ ...timing, request: async (op, options) => {
    calls.push({ op, options, at: timing.at });
    return { ok: true, why: null, enabled: true, presence: { status: 'present', order: op === 'load' ? 'wait' : op, revision: calls.length, reason: null } };
  } });
  const start = timing.at;
  assert.equal((await driver.load()).ok, true);
  for (let i = 0; i < 9; i++) assert.equal((await driver.order('wait')).ok, true);
  assert.equal((await driver.load()).ok, true);
  assert.equal(calls.length, 20);
  assert.ok(calls.every((call, i) => i === 0 || call.at - calls[i - 1].at >= PRESENCE_PACING.minGapMs), 'paced sends');
  assert.ok(timing.at - start < PRESENCE_PACING.windowMs, 'all twenty inside one minute');
  assert.deepEqual(calls[1], { op: 'load', options: {}, at: calls[1].at });
  assert.deepEqual(calls[2].options, { expectedRevision: 2 }, 'the op carries the revision of its own load');
  assert.deepEqual(await driver.load(), { ok: false, why: 'paced' });
  assert.deepEqual(await driver.order('follow'), { ok: false, why: 'paced' });
  assert.equal(calls.length, 20, 'a paced request sends nothing');
  timing.advance(PRESENCE_PACING.windowMs);
  assert.equal((await driver.order('follow')).ok, true, 'the window rolls');
  assert.equal(calls.length, 22);
  assert.deepEqual(await driver.order('attack'), { ok: false, why: 'invalid_request' });
});

test('driver: latest order wins after the current send, never two sends in flight, close settles waits', async () => {
  const timing = fakeTiming(), calls = [], outcomes = [];
  let inFlight = 0, maxInFlight = 0, revision = 3;
  const gates = [];
  const driver = new PresenceDriver({ ...timing, onEvent: outcome => outcomes.push(outcome), request: (op, options) => {
    calls.push({ op, options }); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise(resolve => gates.push(() => {
      inFlight--;
      if (op !== 'load') revision++;
      resolve({ ok: true, why: null, enabled: true, presence: { status: 'present', order: op === 'load' ? 'wait' : op, revision, reason: null } });
    }));
  } });
  const first = driver.order('follow');
  await until(() => calls.length === 1, 'first load');
  const second = driver.order('wait');
  const third = driver.order('return');
  assert.deepEqual(await second, { ok: false, why: 'superseded' }, 'a waiting order leaves at once');
  assert.equal(calls.length, 1, 'still one send in flight');
  gates.shift()();
  assert.deepEqual(await first, { ok: false, why: 'superseded' }, 'the running order stops after its current send');
  await until(() => calls.length === 2, 'latest load');
  gates.shift()();
  await until(() => calls.length === 3, 'latest op');
  assert.deepEqual(calls[2], { op: 'return', options: { expectedRevision: 3 } });
  gates.shift()();
  assert.equal((await third).presence.order, 'return');
  assert.equal(maxInFlight, 1);
  assert.deepEqual(outcomes.map(o => [o.op, o.ok, o.why]), [['wait', false, 'superseded'], ['follow', false, 'superseded'], ['return', true, null]]);
  assert.deepEqual(driver.presence, { status: 'present', order: 'return', revision: 4, reason: null });

  // A conflict is retried once with the receipt revision; a second conflict is final.
  const conflicts = [];
  const strict = new PresenceDriver({ ...fakeTiming(), request: async (op, options) => {
    conflicts.push({ op, options });
    if (op === 'load') return { ok: true, why: null, enabled: true, presence: { status: 'present', order: 'wait', revision: 10, reason: null } };
    return { ok: false, why: 'conflict', enabled: true, presence: { status: 'present', order: 'wait', revision: 10 + conflicts.length, reason: null } };
  } });
  assert.equal((await strict.order('follow')).why, 'conflict');
  assert.deepEqual(conflicts.map(c => c.options), [{}, { expectedRevision: 10 }, { expectedRevision: 12 }]);

  const blocked = new PresenceDriver({ request: () => new Promise(() => {}) });
  const waiting = blocked.load(), queued = blocked.order('follow');
  await pause(10);
  blocked.close();
  assert.deepEqual(await queued, { ok: false, why: 'closed' });
  assert.deepEqual(await blocked.order('wait'), { ok: false, why: 'closed' });
  void waiting;
});

test('(a) presence on: the runner adopts chat and presence and its first load reaches the server', { timeout: 30000 }, async t => {
  const r = await room(t), { owner, characterKey } = await ownerCompanion(r);
  const { pair, captured, events, started } = await paired(t, r, owner);
  assert.deepEqual(started.capabilities, ['chat', 'presence']);
  assert.equal(started.authority, 'server_controller');
  assert.deepEqual(captured.runner.grant.capabilities, ['chat', 'presence']);
  assert.deepEqual(captured.runner.authority.grant.capabilities, ['chat', 'presence']);
  assert.equal(captured.driverCalls, 1, 'body mode built one driver');
  const loaded = await until(() => presenceEvents(events).find(event => event.op === 'load'), 'first load receipt');
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.equal(loaded.presence.status, 'present');
  assert.equal(loaded.presence.characterKey, characterKey);
  assert.equal(r.log.length, 1, 'exactly one request on connect');
  assert.deepEqual(Object.keys(r.log[0]).sort(), ['op', 'requestId', 't']);
  assert.equal(r.log[0].op, 'load');
  assert.deepEqual(captured.runner.presenceState, { status: 'present', order: loaded.presence.order,
    revision: loaded.presence.revision, reason: loaded.presence.reason });
  const outcome = await until(() => presenceEvents(events, 'presence_order')[0], 'driver outcome');
  assert.deepEqual([outcome.op, outcome.ok], ['load', true]);

  // Stopping closes the socket: no lease release, task or input ever leaves an attached mind, and the body stays.
  const entry = r.app.game.companionPresence.entries.get(OWNER);
  const order = entry.order;
  assert.deepEqual(pair.stop(), { ok: true, state: 'stopped' });
  await until(() => entry.mind === null, 'mind released');
  for (const type of [MSG.INPUTS, MSG.AGENT_TASK, MSG.AGENT_CANCEL, MSG.AGENT_RELEASE]) assert.equal(captured.types.has(type), false, type);
  assert.ok(entry.body, 'the body stays in the world');
  assert.equal(entry.order, order, 'with its current order');
});

test('(b) an owner chat answered with reply text and body follow orders the body to follow', { timeout: 30000 }, async t => {
  const r = await room(t), { owner } = await ownerCompanion(r);
  const { model, events } = await paired(t, r, owner, { decision: { type: 'reply', args: { text: 'Te sigo, capitán.', body: 'follow' } } });
  const loaded = await until(() => presenceEvents(events).find(event => event.op === 'load' && event.ok), 'first load');
  const before = loaded.presence.revision;
  await ownerSay(owner, 'owner-follow-1', 'Brisa, sígueme.');
  const reply = await owner.next(m => m.t === MSG.CHAT_MESSAGE && m.text === 'Te sigo, capitán.');
  assert.match(reply.sender.name, /\[IA\]$/, 'the body says the reply');
  const order = await until(() => presenceEvents(events, 'presence_order').find(event => event.op === 'follow'), 'follow outcome');
  assert.equal(order.ok, true, JSON.stringify(order));
  assert.equal(order.presence.order, 'follow');
  assert.ok(order.presence.revision > before, 'the server revision moved');
  const follow = r.log.find(message => message.op === 'follow');
  assert.deepEqual(Object.keys(follow).sort(), ['expectedRevision', 'op', 'requestId', 't']);
  assert.deepEqual(r.log.map(message => message.op), ['load', 'load', 'follow'], 'load before the order, nothing else');
  assert.equal(model.requests.length, 1, 'one model request for one owner message');
  const system = model.requests[0].messages[0].content;
  assert.ok(system.includes(CONVERSATION_BODY_INSTRUCTION), 'body mode adds its instruction sentence');
  assert.ok(system.includes('"enum":["follow","wait","return","gather"]'), 'body mode selects the body schema');
  const context = JSON.parse(model.requests[0].messages[1].content).context;
  assert.deepEqual(context.required.tools.capabilities, ['chat', 'presence']);
  assert.deepEqual(Object.keys(context.required.tools.presence).sort(), ['order', 'reason', 'revision', 'status']);
  assert.equal(context.required.tools.presence.revision, before);
});

test('(c) a stale revision: the order answers conflict, the retry uses the receipt revision and succeeds', { timeout: 30000 }, async t => {
  const r = await room(t), { owner } = await ownerCompanion(r);
  let armed = false;
  const { captured, events } = await paired(t, r, owner, { afterPresence: async (op, receipt) => {
    if (!armed || op !== 'load' || !receipt.ok) return;
    armed = false;
    // The owner panel changes the order between the load and the op.
    assert.equal((await presenceOp(owner, 'wait', receipt.presence.revision)).ok, true);
  } });
  await until(() => presenceEvents(events).find(event => event.op === 'load' && event.ok), 'first load');
  armed = true;
  const result = await captured.driver.order('follow');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.presence.order, 'follow');
  const receipts = presenceEvents(events).slice(1);
  assert.deepEqual(receipts.map(event => [event.op, event.ok, event.why]), [['load', true, null], ['follow', false, 'conflict'], ['follow', true, null]]);
  assert.equal(receipts[1].expectedRevision, receipts[0].presence.revision, 'the first send used the loaded revision');
  assert.equal(receipts[2].expectedRevision, receipts[1].presence.revision, 'the retry used the conflict receipt revision');
  assert.ok(receipts[2].expectedRevision > receipts[1].expectedRevision);
  assert.deepEqual(r.log.slice(1).map(message => message.op), ['load', 'follow', 'follow']);
});

test('(d) the 21st send inside 60 s resolves paced and sends nothing on the wire', { timeout: 30000 }, async t => {
  const r = await room(t), { owner } = await ownerCompanion(r);
  const { captured, timing } = await paired(t, r, owner);
  const start = timing.at;
  await until(() => captured.sent.length === 1 && r.log.length === 1, 'first load');
  for (let i = 0; i < 9; i++) assert.equal((await captured.driver.order('wait')).ok, true, `order ${i}`);
  assert.equal((await captured.driver.load()).ok, true);
  assert.equal(captured.sent.length, 20); assert.equal(r.log.length, 20);
  assert.ok(timing.at - start < 60000, 'twenty sends inside one minute');
  assert.deepEqual(await captured.driver.load(), { ok: false, why: 'paced' }, 'the 21st send');
  assert.deepEqual(await captured.driver.order('follow'), { ok: false, why: 'paced' });
  await pause(50);
  assert.equal(captured.sent.length, 20, 'nothing more left the client');
  assert.equal(r.log.length, 20, 'nothing more reached the server');
});

test('(e) flag off: adopted chat only, a body key in the reply is rejected and no presence request is sent', { timeout: 30000 }, async t => {
  const r = await room(t, { presence: false }), { owner } = await ownerCompanion(r, { presence: false });
  const { model, captured, statuses, started } = await paired(t, r, owner, { decision: { type: 'reply', args: { text: 'Te sigo.', body: 'follow' } } });
  assert.deepEqual(started.capabilities, ['chat']);
  assert.deepEqual(captured.runner.grant.capabilities, ['chat']);
  assert.deepEqual(captured.runner.authority.grant.capabilities, ['chat']);
  assert.equal(captured.driverCalls, 0, 'no driver without the presence grant');
  await ownerSay(owner, 'owner-follow-off', 'Sígueme.');
  await until(() => statuses.length === 1, 'inference status');
  assert.deepEqual(statuses, [{ phase: 'inference', result: 'failed' }], 'the body key makes the decision invalid');
  assert.equal(model.requests.length, 1);
  const system = model.requests[0].messages[0].content;
  assert.equal(system.includes(CONVERSATION_BODY_INSTRUCTION), false);
  assert.equal(system.includes('"enum":["follow","wait","return","gather"]'), false);
  assert.equal(JSON.parse(model.requests[0].messages[1].content).context.required.tools.presence, undefined);
  await pause(100);
  assert.equal(owner.messages.some(m => m.t === MSG.CHAT_MESSAGE && m.text === 'Te sigo.'), false);
  assert.equal(captured.sent.length, 0, 'no agent_companion_presence on the wire');
  assert.equal(r.log.length, 0);
});

test('(f) pairing revoked while an order is pending: the order resolves closed and the runner stops as today', { timeout: 30000 }, async t => {
  const r = await room(t), { owner } = await ownerCompanion(r);
  const { pair, captured, events } = await paired(t, r, owner, { hold: message => message.op === 'follow' });
  await until(() => presenceEvents(events).find(event => event.op === 'load' && event.ok), 'first load');
  const stopped = pair.waitForStop();
  const pending = captured.driver.order('follow');
  await until(() => captured.held.length === 1, 'follow held on the wire');
  const loaded = await presenceOp(owner, 'load');
  const retired = await presenceOp(owner, 'retire', loaded.presence.revision);
  assert.equal(retired.ok, true, JSON.stringify(retired));
  assert.deepEqual(await pending, { ok: false, why: 'closed' });
  await stopped;
  assert.equal(pair.state, 'stopped');
  assert.deepEqual(captured.closes, [{ code: 1008, reason: 'pairing revoked' }]);
  assert.equal(captured.runner.state, 'stopped');
  // As today: the server publishes the revoked control state, then closes the socket with 1008.
  assert.equal(captured.runner.lifecycle.current.termination.reason, 'revoked');
  const closed = presenceEvents(events).find(event => event.op === 'follow');
  assert.deepEqual([closed.ok, closed.why], [false, 'closed']);
  const outcome = presenceEvents(events, 'presence_order').find(event => event.op === 'follow');
  assert.deepEqual([outcome.ok, outcome.why], [false, 'closed']);
  assert.equal(r.log.some(message => message.op === 'follow'), false, 'the held order never reached the server');
});

// IC05a: a gather body order names a wood or stone node of the observed world; the server stays the authority.
const worldWith = (...nodes) => ({ hours: 12, truncated: false, water: null, bench: null,
  nodes: nodes.map(([nodeId, kind]) => ({ ref: { nodeId }, kind, position: { x: 1, y: 0, z: 1 }, ready: true, wait: 0 })) });
test('IC05a parse: gather keeps a wood or stone node of confirmed.world and drops any other node, keeping the reply', () => {
  const reply = (args) => JSON.stringify({ v: 1, decision: { type: 'reply', args } });
  const world = worldWith(['coast-4', 'wood'], ['stone-1030', 'stone'], ['palm-121', 'palm']);
  const body = { body: true, world };
  assert.deepEqual(parseDecision(reply({ text: 'Voy.', body: 'gather', node: 'coast-4' }), 8192, 'conversation', body),
    { type: 'reply', args: { text: 'Voy.', body: 'gather', node: 'coast-4' } });
  assert.deepEqual(parseDecision(reply({ text: 'Voy.', body: 'gather', node: 'stone-1030' }), 8192, 'conversation', body).args.node, 'stone-1030');
  for (const node of ['palm-121', 'coast-99', 'bad id'])
    assert.deepEqual(parseDecision(reply({ text: 'Voy.', body: 'gather', node }), 8192, 'conversation', body),
      { type: 'reply', args: { text: 'Voy.' } }, `${node}: the body proposal is dropped, the reply survives`);
  assert.deepEqual(parseDecision(reply({ text: 'Voy.', body: 'gather', node: 'coast-4' }), 8192, 'conversation', { body: true }),
    { type: 'reply', args: { text: 'Voy.' } }, 'no observed world, no gather');
  assert.equal(parseDecision(reply({ text: 'Voy.', body: 'gather' }), 8192, 'conversation', body), null, 'gather requires args.node');
  assert.equal(parseDecision(reply({ text: 'Voy.', body: 'follow', node: 'coast-4' }), 8192, 'conversation', body), null, 'only gather takes a node');
  assert.equal(parseDecision(reply({ text: 'Voy.', node: 'coast-4' }), 8192, 'conversation', body), null);
  assert.equal(parseDecision(reply({ text: 'Voy.', body: 'gather', node: 'coast-4' }), 8192, 'conversation', { world }), null, 'chat-only mode is unchanged');
  const args = CONVERSATION_BODY_RESPONSE_SCHEMA.properties.decision.oneOf[1].properties.args;
  assert.deepEqual(args.properties.body.enum, ['follow', 'wait', 'return', 'gather']);
  assert.deepEqual(args.required, ['text']);
  assert.equal(args.properties.node.type, 'string');
  assert.match(CONVERSATION_BODY_INSTRUCTION, /confirmed\.world/); assert.match(CONVERSATION_BODY_INSTRUCTION, /args\.node/);
});

test('IC05a driver: gather sends its node with the revision of its own load; malformed gathers send nothing', async () => {
  const calls = [];
  const driver = new PresenceDriver({ ...fakeTiming(), request: async (op, options) => {
    calls.push({ op, options });
    return { ok: true, why: null, enabled: true, presence: { status: 'present', order: op === 'load' ? 'wait' : op, revision: 5, reason: null } };
  } });
  for (const [op, node] of [['gather', undefined], ['gather', 'bad id'], ['gather', 7], ['follow', 'coast-4']])
    assert.deepEqual(await driver.order(op, node), { ok: false, why: 'invalid_request' }, `${op} ${node}`);
  assert.equal(calls.length, 0);
  assert.equal((await driver.order('gather', 'coast-4')).presence.order, 'gather');
  assert.deepEqual(calls, [{ op: 'load', options: {} }, { op: 'gather', options: { expectedRevision: 5, node: 'coast-4' } }]);
  assert.deepEqual((await driver.order('follow')).ok, true);
  assert.deepEqual(calls.at(-1), { op: 'follow', options: { expectedRevision: 5 } });
});

test('IC05a an owner chat answered with body gather walks the body to the node and gathers; the runner stays healthy', { timeout: 60000 }, async t => {
  const r = await room(t), { owner } = await ownerCompanion(r);
  const w = r.app.game.server.world, anchor = presenceAnchor(w);
  // Found by script: the nearest ready wood or stone node beyond the old 12 zone that the body perceives (24),
  // with a clear straight route inside the 30 zone.
  const far = n => Math.hypot(n.x - anchor.x, n.z - anchor.z);
  const node = [...w.resources.nodes.values()].filter(n => ['wood', 'stone'].includes(n.kind) && n.readyTick <= w.tick &&
    far(n) > 12 && far(n) <= 22 && presenceWorkPoint(w, n, anchor) &&
    pointOnRouteReason(w, anchor.x, anchor.z, presenceWorkPoint(w, n, anchor).x, presenceWorkPoint(w, n, anchor).z) === null)
    .sort((a, b) => far(a) - far(b))[0];
  assert.ok(node, 'a perceivable wood or stone node');
  const entry = r.app.game.companionPresence.entries.get(OWNER), good = RESOURCE_KINDS[node.kind].good;
  const before = w.profiles.get(entry.body.entity).eco.pack.goods[good] ?? 0;
  const { model, events, captured } = await paired(t, r, owner, { decision: { type: 'reply', args: { text: 'Voy por ello.', body: 'gather', node: node.id } } });
  await until(() => presenceEvents(events).find(event => event.op === 'load' && event.ok), 'first load');
  await until(() => captured.runner.observation?.confirmed?.world?.nodes.some(n => n.ref.nodeId === node.id), 'the node in the observed world');
  await ownerSay(owner, 'owner-gather-1', 'Brisa, recoge madera.');
  await owner.next(m => m.t === MSG.CHAT_MESSAGE && m.text === 'Voy por ello.');
  const order = await until(() => presenceEvents(events, 'presence_order').find(event => event.op === 'gather'), 'gather outcome');
  assert.equal(order.ok, true, JSON.stringify(order));
  assert.equal(order.presence.order, 'gather');
  const sent = r.log.find(message => message.op === 'gather');
  assert.deepEqual(Object.keys(sent).sort(), ['expectedRevision', 'node', 'op', 'requestId', 't']);
  assert.equal(sent.node, node.id);
  const system = model.requests[0].messages[0].content;
  assert.ok(system.includes(CONVERSATION_BODY_INSTRUCTION) && system.includes('"gather"') && system.includes('recojas o juntes madera o piedra'));
  await until(() => entry.order === 'wait', 'the body finished', 30000);
  assert.equal(entry.reason, 'gathered');
  assert.equal(w.profiles.get(entry.body.entity).eco.pack.goods[good], before + 1);
  assert.equal(captured.runner.state, 'ready', 'the runner stays connected after the body gather');
  assert.deepEqual(captured.closes, []);
  const loaded = await captured.driver.load();
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.deepEqual([loaded.presence.order, loaded.presence.reason], ['wait', 'gathered']);
});
