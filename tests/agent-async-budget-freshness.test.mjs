import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { LAB_CAPABILITIES } from '../tools/agent/contract.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';

const scope = { ownerId: 'owner-async-freshness', characterId: 'agent-async-freshness', worldId: 'async-freshness-world' };
const sessionScope = { ...scope, sessionId: 'async-freshness-session' };
const hashes = Object.fromEntries(['personality', 'objectives', 'memory'].map((key, index) => [key, `${index + 1}`.repeat(64)]));
const limits = { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 1024, marginTokens: 256,
  maxResponseBytes: 8192, timeoutMs: 10000, maxDecisionAgeMs: 1500, maxReflectionAgeMs: 30000, maxRequests: 64 };
const inbound = { id: 'server:1', requestId: 'human-request-1', channel: 'local',
  sender: { id: 'peer-token-1', entity: 8, name: 'Marina' }, text: '¿Sigues en el puerto?', tick: 10 };
const selfPeer = { id: 'self-token', entity: 1, name: 'Compañera' };
const conversationReply = JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: 'Sigo aquí; te escucho.' } } });
const bodyReply = JSON.stringify({ v: 1, decision: { type: 'move', args: { mx: 1, mz: 0, durationMs: 500 } } });

function harness({ mode = 'conversation', onMark = () => {}, onActive = () => {} } = {}) {
  const state = { now: 1000, receivedAt: 1000, revision: 1, valueState: 'ready', hashes: { ...hashes },
    activeCalls: 0, markCalls: 0, completeCalls: 0, chatOrders: [], bodyOrders: [] };
  const read = () => {
    const chat = [{ id: inbound.id, channel: inbound.channel, sender: `chat:${inbound.sender.id}`,
      recipient: null, text: inbound.text, tick: inbound.tick }];
    const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: state.receivedAt,
      revision: state.revision, tick: 10, chat });
    return { state: state.valueState, grant: fixtureGrant({ scope: sessionScope, expiresAtMs: 100000,
      capabilities: [...LAB_CAPABILITIES, 'chat'] }), authority: null, observation,
      required: { rules: { chatTextIsUntrusted: true, memoryIsUntrusted: true }, personality: 'Calm and careful.',
        tools: {}, observation, goals: { revision: 1, goals: [{ id: 'home', status: 'active', text: 'Return home', constraints: [] }] }, pending: [] },
      chat: { available: true, self: selfPeer.id,
        config: { enabled: true, localRadius: 24, maxLength: 300, burst: 4, refillPerSecond: 0.5, historyLimit: 100, receiptLimit: 128 },
        peers: [selfPeer, inbound.sender], messages: [inbound], requests: [] },
      goalFeedback: [], memory: [], queryTags: ['home'], scope, ownerFileHashes: { ...state.hashes }, taskFence: 'same-task' };
  };
  const budget = new InferenceBudget({ scope, limits: { maxCalls: 64, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 64 } });
  const mark = budget.markDispatched.bind(budget);
  budget.markDispatched = async (requestId) => { state.markCalls++; await onMark(state); return mark(requestId); };
  budget.checkActive = async (requestId) => { state.activeCalls++; await onActive(state, requestId); return { ok: true }; };
  const adapter = { id: 'async-budget-freshness-test-model', countMode: 'simulated_tokens',
    countText: (text) => Math.ceil(Buffer.byteLength(text) / 4),
    prepare: (request) => ({ body: JSON.stringify(request), inputTokens: Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 4), maxCostUnits: 10 }),
    complete: async () => { state.completeCalls++; return { text: mode === 'conversation' ? conversationReply : bodyReply,
      usage: { inputTokens: 20, outputTokens: 10, costUnits: 10 } }; } };
  const mind = new AgentMind({ adapter, budget, readSnapshot: async () => read(), now: () => state.now, limits,
    submitOrder: (order) => { state.bodyOrders.push(order); return { ok: true, state: 'accepted' }; },
    sendChat: (order) => { state.chatOrders.push(order); return { ok: true, state: 'sent' }; },
    conversationPolicy: { channels: ['world', 'local', 'whisper'], maxRepliesPerPeer: 8, maxTurns: 8, cooldownMs: 0, maxMessageAgeTicks: 1800 } });
  state.advanceFresh = () => { state.now += 2000; state.receivedAt = state.now; state.revision++; };
  return { mind, state, budget };
}

test('conversation uses a fresh snapshot after asynchronous dispatch admission without repeating inference', async () => {
  const f = harness({ onMark: async (state) => state.advanceFresh() });
  const result = await f.mind.converse({ messageId: inbound.id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.state.markCalls, 1);
  assert.equal(f.state.completeCalls, 1);
  assert.equal(f.state.chatOrders.length, 1);
  assert.equal(f.state.chatOrders[0].observationRevision, 2);
  assert.equal(f.state.bodyOrders.length, 0);
});

test('the same asynchronous delay still rejects a body decision whose original observation aged out', async () => {
  const f = harness({ mode: 'decision', onMark: async (state) => state.advanceFresh() });
  const result = await f.mind.decide();
  assert.equal(result.ok, false);
  assert.equal(result.why, 'stale_decision');
  assert.equal(f.state.markCalls, 1);
  assert.equal(f.state.completeCalls, 0);
  assert.equal(f.state.bodyOrders.length, 0);
  assert.equal(f.state.chatOrders.length, 0);
});

test('a stop or owner-file edit during async budget admission blocks provider dispatch', async (t) => {
  for (const [name, change, expected] of [
    ['stop', (state) => { state.valueState = 'stopped'; }, 'not_ready'],
    ['owner-file edit', (state) => { state.hashes.personality = 'f'.repeat(64); }, 'owner_files_changed'],
  ]) await t.test(name, async () => {
    const f = harness({ onActive: async (state) => change(state) });
    const result = await f.mind.converse({ messageId: inbound.id });
    assert.equal(result.ok, false);
    assert.equal(result.why, expected);
    assert.equal(f.state.completeCalls, 0);
    assert.equal(f.state.chatOrders.length, 0);
    assert.equal(f.state.bodyOrders.length, 0);
  });
});

test('a stop during post-settlement budget check blocks the chat send', async () => {
  const f = harness({ onActive: async (state) => {
    if (state.activeCalls === 2) state.valueState = 'stopped';
  } });
  const result = await f.mind.converse({ messageId: inbound.id });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'not_ready');
  assert.equal(f.state.completeCalls, 1);
  assert.equal(f.state.chatOrders.length, 0);
});

test('conversation sends against the latest observation after post-settlement budget I/O', async () => {
  const f = harness({ onActive: async (state) => {
    if (state.activeCalls === 2) state.advanceFresh();
  } });
  const result = await f.mind.converse({ messageId: inbound.id });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.state.activeCalls, 2);
  assert.equal(f.state.completeCalls, 1);
  assert.equal(f.state.chatOrders.length, 1);
  assert.equal(f.state.chatOrders[0].observationRevision, 2);
});
