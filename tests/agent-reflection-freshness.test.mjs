import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { LAB_CAPABILITIES } from '../tools/agent/contract.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { createMemoryEpisode, parseMemoryJournal } from '../tools/agent/memory-journal.mjs';

const scope = { ownerId: 'owner-reflection', characterId: 'agent-reflection', worldId: 'reflection-world' };
const sessionScope = { ...scope, sessionId: 'reflection-session' };
const hashes = Object.fromEntries(['personality', 'objectives', 'memory'].map((key, index) => [key, `${index + 1}`.repeat(64)]));
const maxLimits = { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 1024, marginTokens: 256,
  maxResponseBytes: 8192, timeoutMs: 10000, maxDecisionAgeMs: 1500, maxReflectionAgeMs: 30000, maxRequests: 64 };
const gameBudget = () => new InferenceBudget({ scope, limits: { maxCalls: 64, maxTokens: 100000,
  maxCostUnits: 100000, maxEntries: 64 } });
const reply = JSON.stringify({ v: 1, decision: { type: 'reply', args: { text: 'Sigo aquí; te escucho.' } } });
const bodyWait = JSON.stringify({ v: 1, decision: { type: 'wait', args: {} } });
const compact = (sourceId) => JSON.stringify({ v: 1, decision: { type: 'summarize_memory', args: {
  text: 'El episodio registra una observación histórica del puerto.', tags: ['home'], basis: [sourceId] } } });
const inbound = { id: 'server:1', requestId: 'human-request-1', channel: 'local',
  sender: { id: 'peer-token-1', entity: 8, name: 'Marina' }, text: '¿Sigues en el puerto?', tick: 10 };
const selfPeer = { id: 'self-token', entity: 1, name: 'Compañera' };
const peer = inbound.sender;

function episode() {
  return createMemoryEpisode({ scope, grant: { scope: sessionScope, controlRevision: 1 },
    observation: { source: 'server', receivedAtMs: 1000, revision: 1, tick: 10,
      confirmed: { self: { position: { x: 0, y: 0, z: 0 }, hp: 80, maxHp: 100, dead: false } } },
    required: { goals: { revision: 1, goals: [{ id: 'home', status: 'active', text: 'Return home' }] }, pending: [] },
    chat: { messages: [] } });
}

function baseSnapshot(nowMs, overrides = {}) {
  const projection = [{ id: inbound.id, channel: inbound.channel, sender: `chat:${peer.id}`,
    recipient: null, text: inbound.text, tick: inbound.tick }];
  const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: nowMs,
    revision: 1, tick: 10, chat: projection });
  const snapshot = { state: 'ready', grant: fixtureGrant({ scope: sessionScope,
    expiresAtMs: 100000, capabilities: [...LAB_CAPABILITIES, 'chat'] }), authority: null, observation,
    required: { rules: { chatTextIsUntrusted: true, memoryIsUntrusted: true }, personality: 'Calm and careful.',
      tools: {}, observation, goals: { revision: 1, goals: [{ id: 'home', status: 'active', text: 'Return home', constraints: [] }] }, pending: [] },
    chat: { available: true, self: selfPeer.id,
      config: { enabled: true, localRadius: 24, maxLength: 300, burst: 4, refillPerSecond: 0.5, historyLimit: 100, receiptLimit: 128 },
      peers: [selfPeer, peer], messages: [inbound], requests: [] },
    goalFeedback: [], memory: [], queryTags: ['home'], memoryJournal: parseMemoryJournal('', scope),
    scope, ownerFileHashes: { ...hashes }, taskFence: 'same-task', ...overrides };
  snapshot.required.observation = snapshot.observation;
  return snapshot;
}

function harness({ mode = 'conversation', ageMs = 2000, limits = {}, mutateOnComplete = () => {}, sourceEntry = null,
  appendMemory = null } = {}) {
  const state = { now: 1000, value: baseSnapshot(1000), chatOrders: [], bodyOrders: [], appends: [] };
  if (sourceEntry) {
    const journal = parseMemoryJournal(`${JSON.stringify(sourceEntry)}\n`, scope);
    state.value.memoryJournal = journal;
    state.value.memory = journal.records;
  }
  const read = () => {
    const current = structuredClone(state.value);
    current.observation.receivedAtMs = state.now;
    current.observation.revision = Math.max(1, Math.floor(state.now / 1000));
    current.required.observation = structuredClone(current.observation);
    return current;
  };
  const adapter = { id: 'reflection-test-model', countMode: 'simulated_tokens',
    countText: (text) => Math.ceil(Buffer.byteLength(text) / 4),
    prepare: (request) => ({ body: JSON.stringify(request), inputTokens: Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 4), maxCostUnits: 10 }),
    complete: async () => {
      state.now += ageMs;
      mutateOnComplete(state);
      const text = mode === 'conversation' ? reply : mode === 'decision' ? JSON.stringify({ v: 1, decision: {
        type: 'move', args: { mx: 1, mz: 0, durationMs: 500 } } }) : compact(sourceEntry.id);
      return { text, usage: { inputTokens: 20, outputTokens: 10, costUnits: 10 } };
    } };
  const commitMemory = appendMemory ?? (async (request) => {
    state.appends.push(request);
    const checked = request.guard();
    if (!checked.ok) return checked;
    return { ok: true, replay: false, revision: request.expectedRevision + 1,
      sha256: 'a'.repeat(64), entryId: request.entry.id };
  });
  const mind = new AgentMind({ adapter, budget: gameBudget(), readSnapshot: async () => read(),
    readCommitSnapshot: () => read(), submitOrder: (order) => { state.bodyOrders.push(order); return { ok: true, state: 'accepted' }; },
    sendChat: (order) => { state.chatOrders.push(order); return { ok: true, state: 'sent' }; }, appendMemory: commitMemory,
    now: () => state.now, limits: { ...maxLimits, ...limits } });
  return { mind, state };
}

test('a slow conversation may use its original observation only with explicit reflection-age opt-in', async (t) => {
  await t.test('explicit 30 second reflection allowance', async () => {
    const f = harness({ limits: { maxReflectionAgeMs: 30000 } });
    const result = await f.mind.converse({ messageId: inbound.id });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.state.chatOrders.length, 1);
    assert.equal(f.state.bodyOrders.length, 0);
  });
  await t.test('default reflection limit remains 1500 ms', async () => {
    const f = harness({ limits: { maxReflectionAgeMs: 1500 } });
    const result = await f.mind.converse({ messageId: inbound.id });
    assert.equal(result.ok, false);
    assert.match(result.why, /stale/);
    assert.equal(f.state.chatOrders.length, 0);
  });
});

test('the reflection opt-in never extends body decision freshness', async () => {
  const f = harness({ mode: 'decision', limits: { maxReflectionAgeMs: 30000 } });
  const result = await f.mind.decide();
  assert.equal(result.ok, false);
  assert.match(result.why, /stale/);
  assert.equal(f.state.bodyOrders.length, 0);
});

test('slow conversation still rejects stop and owner-file changes', async (t) => {
  for (const [name, mutate, expected] of [
    ['stop', (state) => { state.value.state = 'stopped'; }, 'not_ready'],
    ['owner file revision', (state) => { state.value.ownerFileHashes.personality = 'f'.repeat(64); }, 'owner_files_changed'],
  ]) await t.test(name, async () => {
    const f = harness({ limits: { maxReflectionAgeMs: 30000 }, mutateOnComplete: mutate });
    const result = await f.mind.converse({ messageId: inbound.id });
    assert.equal(result.ok, false);
    assert.equal(result.why, expected);
    assert.equal(f.state.chatOrders.length, 0);
  });
});

test('slow memory compaction keeps the final owner-file commit fence', async () => {
  const source = episode();
  const f = harness({ mode: 'compaction', sourceEntry: source, limits: { maxReflectionAgeMs: 30000 },
    appendMemory: async (request) => {
      f.state.appends.push(request);
      f.state.value.ownerFileHashes.memory = 'e'.repeat(64);
      return request.guard();
    } });
  const result = await f.mind.compactMemory({ sourceIds: [source.id] });
  assert.equal(result.ok, false);
  assert.equal(result.why, 'owner_files_changed');
  assert.equal(f.state.appends.length, 1);
  assert.equal(f.state.bodyOrders.length, 0);
});
