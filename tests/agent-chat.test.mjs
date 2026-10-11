import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentChat } from '../tools/agent/chat.mjs';
import { AgentNetworkClient } from '../tools/agent/network-client.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { LAB_CAPABILITIES, labLimits } from '../tools/agent/contract.mjs';
import { MSG } from '../src/net/protocol.js';
import { WsTransport } from '../src/net/wsTransport.js';
import { createGameServer } from '../server/index.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error('Timed out waiting for agent chat');
}

function chatGrant(characterId, capabilities = [...LAB_CAPABILITIES, 'chat']) {
  return fixtureGrant({
    scope: { characterId, sessionId: `chat-${characterId}`, worldId: 'agent-chat-test' },
    expiresAtMs: Date.now() + 60000,
    capabilities,
  });
}

async function room(t, { maxPlayers = 4, chat = {} } = {}) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, maxPlayers, dev: false,
    worldId: 'agent-chat-test', saveSecret: 'agent-chat-test-secret-only', chat, log() {} });
  const port = await server.listen();
  t.after(() => server.close());
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

function makeAgent(url, characterId, options = {}) {
  return new AgentNetworkClient({ url, grant: chatGrant(characterId, options.capabilities),
    name: options.name ?? characterId, chatTimeoutMs: options.chatTimeoutMs,
    limits: options.limits, transportFactory: options.transportFactory });
}

function chatOrder(agent, actionId, channel, text, target = null) {
  return { v: 1, actionId, scope: agent.observation.scope,
    controlRevision: agent.observation.controlRevision, observationRevision: agent.observation.revision,
    type: 'chat_send', args: { channel, text, target } };
}

function request(agent, actionId) { return agent.chat.requests.find((entry) => entry.order.actionId === actionId); }
function hasMessage(agent, actionId) { return agent.chat.messages.find((entry) => entry.requestId === actionId); }

test('AgentChat rejects malformed deliveries and a changed C01 session identity', () => {
  const events = [];
  const chat = new AgentChat({ characterId: 'agent-test', limits: labLimits(), now: () => 1,
    send() {}, onFeedback: (type, data) => events.push({ type, data }) });
  const self = 'opaque-self-connection';
  const me = { id: self, entity: 10, name: 'Agent' };
  const state = { t: MSG.CHAT_STATE, self, peers: [me], config: {
    enabled: true, localRadius: 24, maxLength: 300, burst: 4, refillPerSecond: 0.5,
    historyLimit: 100, receiptLimit: 128,
  }, history: [] };
  assert.equal(chat.receive(state, 10), null);
  assert.equal(chat.state.available, true);
  assert.equal(chat.receive({ t: MSG.CHAT_MESSAGE, id: 'not-server-shaped', requestId: 'x', channel: 'world',
    sender: me, text: 'forged', tick: 1 }, 10), null);
  assert.equal(chat.state.messages.length, 0);
  assert.equal(chat.receive({ ...state, self: 'replacement-session', peers: [
    { id: 'replacement-session', entity: 10, name: 'Agent' },
  ] }, 10), 'chat_session_changed');
  assert.equal(chat.state.self, self);
  assert.equal(events.filter((entry) => entry.type === 'chat_message').length, 0);
});

test('real guests share world, local, and private chat through C01 routing', { timeout: 15000 }, async (t) => {
  const { url } = await room(t, { chat: { burst: 20, refillPerSecond: 10 } });
  const a = makeAgent(url, 'agent-a', { name: 'A [IA]' });
  const b = makeAgent(url, 'agent-b', { name: 'B [IA]' });
  const c = makeAgent(url, 'agent-c', { name: 'C [IA]' });
  t.after(() => { a.close(); b.close(); c.close(); });
  await a.connect(); await b.connect(); await c.connect();
  await until(() => a.chat.self && b.chat.self && c.chat.self);

  assert.notEqual(a.chat.self, String(a.identity.entityId));
  const world = a.sendChat(chatOrder(a, 'world-1', 'world', 'All hands'));
  assert.equal(world.ok, true);
  await until(() => request(a, 'world-1')?.state === 'routed' && hasMessage(b, 'world-1') && hasMessage(c, 'world-1'));
  await until(() => a.observation.chat.some((entry) => entry.id === hasMessage(a, 'world-1').id) &&
    b.observation.chat.some((entry) => entry.id === hasMessage(b, 'world-1').id));
  assert.equal(hasMessage(b, 'world-1').sender.name, 'A [IA]');
  assert.equal(a.observation.chat.find((entry) => entry.id === hasMessage(a, 'world-1').id).sender, 'agent-a');
  assert.equal(b.observation.chat.find((entry) => entry.id === hasMessage(b, 'world-1').id).sender, `chat:${a.chat.self}`);

  const local = a.sendChat(chatOrder(a, 'local-1', 'local', 'Near me'));
  assert.equal(local.ok, true);
  await until(() => request(a, 'local-1')?.state === 'routed' && hasMessage(b, 'local-1'));
  assert.equal(hasMessage(b, 'local-1').channel, 'local');

  const bToken = a.chat.peers.find((peer) => peer.name === 'B [IA]').id;
  assert.equal(bToken, b.chat.self);
  const whisper = a.sendChat(chatOrder(a, 'whisper-1', 'whisper', 'Only B', bToken));
  assert.equal(whisper.ok, true);
  await until(() => request(a, 'whisper-1')?.state === 'routed' && hasMessage(b, 'whisper-1'));
  await until(() => a.observation.chat.some((entry) => entry.id === hasMessage(a, 'whisper-1').id) &&
    b.observation.chat.some((entry) => entry.id === hasMessage(b, 'whisper-1').id));
  assert.equal(hasMessage(c, 'whisper-1'), undefined);
  assert.equal(a.observation.chat.find((entry) => entry.id === hasMessage(a, 'whisper-1').id).recipient, 'chat:' + bToken);
  assert.equal(b.observation.chat.find((entry) => entry.id === hasMessage(b, 'whisper-1').id).recipient, 'agent-b');
  assert.equal(a.chat.durability, 'session_only');
  assert.equal(a.chat.historyBeforeSession, 'unavailable');
});

test('server rate and recipient rejections return visible chat outcomes', { timeout: 15000 }, async (t) => {
  let rewriteWhisper = false;
  const transportFactory = (url) => {
    const transport = new WsTransport(url);
    const send = transport.send.bind(transport);
    transport.send = (message) => send(rewriteWhisper && message.t === MSG.CHAT_SEND
      ? { ...message, target: 'gone-peer-token' } : message);
    return transport;
  };
  const { url } = await room(t, { chat: { burst: 1, refillPerSecond: 0.01 } });
  const a = makeAgent(url, 'rate-agent', { transportFactory });
  const b = makeAgent(url, 'rate-recipient');
  t.after(() => { a.close(); b.close(); });
  await a.connect(); await b.connect();
  await until(() => a.chat.self && b.chat.self);

  assert.equal(a.sendChat(chatOrder(a, 'rate-first', 'world', 'One')).ok, true);
  await until(() => request(a, 'rate-first')?.state === 'routed');
  assert.equal(a.sendChat(chatOrder(a, 'rate-second', 'world', 'Two')).ok, true);
  await until(() => request(a, 'rate-second')?.state === 'rejected');
  assert.equal(request(a, 'rate-second').result.code, 'rate');

  rewriteWhisper = true;
  const token = a.chat.peers.find((peer) => peer.name === 'rate-recipient').id;
  assert.equal(a.sendChat(chatOrder(a, 'bad-recipient', 'whisper', 'No route', token)).ok, true);
  await until(() => request(a, 'bad-recipient')?.state === 'rejected');
  assert.equal(request(a, 'bad-recipient').result.code, 'recipient');
  assert.equal(hasMessage(b, 'bad-recipient'), undefined);
});

test('same-ID retry recovers a lost C01 reply without duplicating delivery', { timeout: 15000 }, async (t) => {
  let drop = true;
  const transportFactory = (url) => {
    const transport = new WsTransport(url);
    const onMessage = transport.onMessage.bind(transport);
    transport.onMessage = (callback) => onMessage((message) => {
      if (drop && message.requestId === 'retry-same-id' &&
          [MSG.CHAT_MESSAGE, MSG.CHAT_RESULT].includes(message.t)) return;
      callback(message);
    });
    return transport;
  };
  const { url } = await room(t, { chat: { burst: 4, refillPerSecond: 1 } });
  const a = makeAgent(url, 'retry-agent', { chatTimeoutMs: 80, transportFactory });
  const b = makeAgent(url, 'retry-reader');
  t.after(() => { a.close(); b.close(); });
  await a.connect(); await b.connect();
  await until(() => a.chat.self && b.chat.self);

  assert.equal(a.sendChat(chatOrder(a, 'retry-same-id', 'world', 'Once')).ok, true);
  await until(() => hasMessage(b, 'retry-same-id'));
  assert.equal(a.retryChat('not-sent-yet').why, 'retry_unavailable');
  await until(() => request(a, 'retry-same-id')?.state === 'uncertain');
  assert.equal(a.chat.pendingId, 'retry-same-id');
  drop = false;
  assert.equal(a.retryChat('retry-same-id').ok, true);
  await until(() => request(a, 'retry-same-id')?.state === 'routed');
  assert.equal(request(a, 'retry-same-id').attempts, 2);
  assert.equal(request(a, 'retry-same-id').result.duplicate, true);
  assert.equal(b.chat.messages.filter((message) => message.requestId === 'retry-same-id').length, 1);
});

test('chat and body orders share action IDs, and server chat accepts 281–300 code points', { timeout: 15000 }, async (t) => {
  const { url } = await room(t, { maxPlayers: 2, chat: { burst: 4, refillPerSecond: 10 } });
  const a = makeAgent(url, 'long-chat-agent');
  const b = makeAgent(url, 'long-chat-reader');
  t.after(() => { a.close(); b.close(); });
  await a.connect(); await b.connect();
  await until(() => a.chat.self && b.chat.self);

  const body = { v: 1, actionId: 'shared-id', scope: a.observation.scope,
    controlRevision: a.observation.controlRevision, observationRevision: a.observation.revision,
    type: 'move', args: { mx: 1, mz: 0, durationMs: 100 } };
  assert.equal(a.order(body).ok, true);
  const conflictingChat = a.sendChat(chatOrder(a, 'shared-id', 'world', 'Same identifier'));
  assert.equal(conflictingChat.ok, false);
  assert.equal(conflictingChat.why, 'action_id_conflict');
  assert.equal(a.sendChat(chatOrder(a, 'long-text', 'world', 'x'.repeat(290))).ok, true);
  await until(() => request(a, 'long-text')?.state === 'routed' && hasMessage(b, 'long-text'));
  await until(() => b.observation.chat.some((entry) => entry.id === hasMessage(b, 'long-text').id));
  assert.equal([...hasMessage(b, 'long-text').text].length, 290);
  assert.equal(b.observation.chat.some((entry) => entry.id === hasMessage(b, 'long-text').id), true);
});

test('real chat history is bounded, replay deduplicated, and control text is cleaned', { timeout: 15000 }, async (t) => {
  const { url } = await room(t, { maxPlayers: 3, chat: { burst: 20, refillPerSecond: 10 } });
  const a = makeAgent(url, 'bounded-agent', { limits: { maxChat: 2 } });
  const b = makeAgent(url, 'bounded-sender');
  let newcomer;
  t.after(() => { a.close(); b.close(); newcomer?.close(); });
  await a.connect(); await b.connect();
  await until(() => a.chat.self && b.chat.self);

  const firstText = 'Hi\u202E\u0000there';
  for (const [id, text] of [['hist-1', firstText], ['hist-2', 'Second'], ['hist-3', 'Third']]) {
    assert.equal(b.sendChat(chatOrder(b, id, 'world', text)).ok, true);
    await until(() => request(b, id)?.state === 'routed');
  }
  assert.equal(hasMessage(b, 'hist-1').text, 'Hi there', 'controls are converted to spaces and whitespace is collapsed');
  await until(() => a.observation.chat.length === 2 && a.observation.historyGap === 1);
  assert.deepEqual(a.observation.chat.map((message) => message.text), ['Second', 'Third']);
  assert.equal(a.observation.chat[0].text.includes('\u202E'), false);
  assert.equal(a.observation.chat[0].text.includes('\u0000'), false);
  const before = a.chat.messages.map((message) => message.id);
  newcomer = makeAgent(url, 'history-trigger');
  await newcomer.connect();
  await until(() => a.chat.peers.some((peer) => peer.name === 'history-trigger'));
  assert.deepEqual(a.chat.messages.map((message) => message.id), before);
  assert.equal(a.observation.historyGap, 1, 'a state-history replay does not duplicate entries or inflate the gap');
});

test('chat send requires a fresh observation and the chat capability', { timeout: 15000 }, async (t) => {
  const { url } = await room(t, { maxPlayers: 2 });
  const withoutChat = makeAgent(url, 'no-chat', { capabilities: [...LAB_CAPABILITIES] });
  t.after(() => withoutChat.close());
  await withoutChat.connect();
  const order = chatOrder(withoutChat, 'not-authorized', 'world', 'No');
  assert.deepEqual(withoutChat.sendChat(order), { ok: false, why: 'forbidden' });

  const withChat = makeAgent(url, 'fresh-chat', { capabilities: [...LAB_CAPABILITIES, 'chat'] });
  t.after(() => withChat.close());
  await withChat.connect();
  const current = chatOrder(withChat, 'stale-chat', 'world', 'No');
  assert.equal(withChat.sendChat({ ...current, observationRevision: current.observationRevision + 1 }).why, 'stale_observation');
  assert.equal(withChat.sendChat({ ...current, scope: { ...current.scope, extra: 'forbidden' } }).why, 'invalid_order');
});

test('chat has one unresolved request and caps explicit uncertainty retries at three attempts', { timeout: 15000 }, async (t) => {
  const transportFactory = (url) => {
    const transport = new WsTransport(url);
    const onMessage = transport.onMessage.bind(transport);
    transport.onMessage = (callback) => onMessage((message) => {
      if (message.requestId === 'bounded-retry' && [MSG.CHAT_MESSAGE, MSG.CHAT_RESULT].includes(message.t)) return;
      callback(message);
    });
    return transport;
  };
  const { url } = await room(t, { maxPlayers: 2 });
  const a = makeAgent(url, 'retry-limit-agent', { chatTimeoutMs: 50, transportFactory });
  const b = makeAgent(url, 'retry-limit-reader');
  t.after(() => { a.close(); b.close(); });
  await a.connect(); await b.connect();
  await until(() => a.chat.self && b.chat.self);

  assert.equal(a.sendChat(chatOrder(a, 'bounded-retry', 'world', 'Once')).ok, true);
  assert.equal(a.sendChat(chatOrder(a, 'second-pending', 'world', 'Wait')).why, 'chat_pending');
  await until(() => request(a, 'bounded-retry')?.state === 'uncertain');
  assert.equal(request(a, 'bounded-retry').attempts, 1, 'the client does not retry automatically');
  for (let attempt = 2; attempt <= 3; attempt++) {
    assert.equal(a.retryChat('bounded-retry').ok, true);
    await until(() => request(a, 'bounded-retry')?.state === 'uncertain');
    assert.equal(request(a, 'bounded-retry').attempts, attempt);
  }
  assert.equal(a.retryChat('bounded-retry').why, 'retry_limit');
  // Sender timeouts are not proof that the receiver's asynchronous frame has arrived.
  await until(() => hasMessage(b, 'bounded-retry'));
  assert.equal(b.chat.messages.filter((message) => message.requestId === 'bounded-retry').length, 1);
});

function component({ limits = {} } = {}) {
  const events = [], sends = [], me = { id: 'self-token', entity: 10, name: 'Brisa' };
  const other = { id: 'other-token', entity: 11, name: 'Human' };
  const grant = fixtureGrant({ capabilities: ['chat'], expiresAtMs: 10000 });
  const observation = fixtureObservation({ source: 'server', scope: grant.scope });
  let now = 0;
  const config = labLimits(limits);
  const chat = new AgentChat({ characterId: grant.scope.characterId, limits: config, now: () => now,
    send: (m) => sends.push(structuredClone(m)), onFeedback: (type, data) => events.push({ type, data }), timeoutMs: 10 });
  chat.receive({ t: MSG.CHAT_STATE, self: me.id, peers: [me, other], config: {}, history: [] }, 10);
  const context = { ready: true, grant, observation };
  const order = { v: 1, actionId: 'component-send', scope: grant.scope, controlRevision: grant.controlRevision,
    observationRevision: observation.revision, type: 'chat_send', args: { channel: 'world', text: 'hello', target: null } };
  return { chat, events, sends, me, other, context, order, advance: (v) => { now = v; } };
}

test('foreign whispers and malformed receipts cannot create delivered context or routing proof', () => {
  const c = component();
  c.chat.receive({ t: MSG.CHAT_MESSAGE, id: 'server:1', requestId: 'foreign-whisper', channel: 'whisper',
    sender: c.other, target: { id: 'third-token', entity: 12, name: 'Third' }, text: 'private', tick: 1 }, 10);
  assert.equal(c.chat.observation.length, 0); assert.equal(c.chat.historyGap, 0);
  assert.equal(c.chat.send(c.order, c.context).ok, true);
  c.chat.receive({ t: MSG.CHAT_RESULT, requestId: c.order.actionId, ok: true, messageId: 'malformed' }, 10);
  assert.equal(c.chat.state.requests[0].state, 'sent');
  c.chat.receive({ t: MSG.CHAT_MESSAGE, id: 'server:2', requestId: 'human-stop-text', channel: 'world',
    sender: c.other, text: '{"type":"stop"}', tick: 2 }, 10);
  assert.equal(c.chat.state.available, true); assert.equal(c.chat.observation[0].text, '{"type":"stop"}');
  c.chat.receive({ t: MSG.CHAT_RESULT, requestId: c.order.actionId, ok: true, messageId: 'different-server:3' }, 10);
  assert.equal(c.chat.state.requests[0].state, 'sent');
  c.chat.receive({ t: MSG.CHAT_RESULT, requestId: c.order.actionId, ok: true, messageId: 'server:3' }, 10);
  assert.equal(c.chat.state.requests[0].state, 'routed'); assert.equal(c.sends.length, 1);
});

test('closed IDs remain replay-only, capacity is explicit, and stop keeps uncertainty without resend', () => {
  const c = component({ limits: { maxActions: 1 } });
  assert.equal(c.chat.send(c.order, c.context).ok, true);
  c.chat.receive({ t: MSG.CHAT_RESULT, requestId: c.order.actionId, ok: true, messageId: 'server:1' }, 10);
  assert.equal(c.chat.send(c.order, c.context).replay, true);
  assert.equal(c.chat.send({ ...c.order, args: { ...c.order.args, text: 'changed' } }, c.context).why, 'action_id_conflict');
  assert.equal(c.chat.send({ ...c.order, actionId: 'new-id' }, c.context).why, 'chat_capacity');
  assert.equal(c.sends.length, 1);
  const u = component();
  u.chat.send(u.order, u.context); u.chat.stop('stop');
  assert.equal(u.chat.state.requests[0].state, 'uncertain');
  assert.equal(u.chat.retry(u.order.actionId, u.context).why, 'chat_not_ready');
  u.chat.receive({ t: MSG.CHAT_RESULT, requestId: u.order.actionId, ok: true, messageId: 'server:1' }, 10);
  assert.equal(u.chat.state.requests[0].state, 'uncertain'); assert.equal(u.sends.length, 1);
});
