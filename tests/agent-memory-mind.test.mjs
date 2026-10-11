import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { createMemoryEpisode, parseMemoryJournal } from '../tools/agent/memory-journal.mjs';
import { createSimulatedMind } from '../tools/agent/simulated-mind.mjs';

const scope = { ownerId: 'owner-memory-mind', characterId: 'agent-memory-mind', worldId: 'memory-world' };
const sessionScope = { ...scope, sessionId: 'memory-session' };
const hashes = Object.fromEntries(['personality', 'objectives', 'memory'].map((k, i) => [k, String(i + 1).repeat(64)]));
const limits = { maxContextTokens: 16000, maxInputBytes: 64000, maxOutputTokens: 1024, marginTokens: 256,
  timeoutMs: 1000, maxDecisionAgeMs: 1500, maxRequests: 64, maxResponseBytes: 8192 };
const usage = { inputTokens: 40, outputTokens: 12, costUnits: 2 };
const budget = (overrides = {}) => new InferenceBudget({ scope, limits: { maxCalls: 64, maxTokens: 100000, maxCostUnits: 100000, maxEntries: 64, ...overrides } });
const response = (decision) => JSON.stringify({ v: 1, decision });
const adapter = (overrides = {}) => ({ id: 'memory-test-model', countMode: 'simulated_tokens',
  countText: (s) => Math.ceil(Buffer.byteLength(s) / 4),
  prepare: (request) => ({ body: JSON.stringify(request), inputTokens: Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 4), maxCostUnits: 5 }),
  complete: async () => ({ text: response({ type: 'wait', args: {} }), usage }), ...overrides });

function makeEpisode({ certainty = 'confirmed', createdAtMs = 1000, goalStatus = 'active' } = {}) {
  return createMemoryEpisode({ scope, grant: { scope: sessionScope, controlRevision: 1 },
    observation: { source: 'server', receivedAtMs: createdAtMs, revision: 1, tick: 5,
      confirmed: { self: { position: { x: 0, y: 0, z: 0 }, hp: 80, maxHp: 100, dead: false } } },
    required: { goals: { revision: 1, goals: [{ id: 'home', status: goalStatus, text: 'Return home' }] }, pending: [] },
    goalFeedback: certainty === 'uncertain' ? [{ actionId: 'uncertain-1', type: 'move', state: 'uncertain', inputAck: false,
      effects: [], result: null }] : [], chat: { messages: [] } });
}
function snapshot(overrides = {}) {
  const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: 1000 });
  return { state: 'ready', grant: fixtureGrant({ scope: sessionScope }), authority: null, observation,
    required: { rules: { chatTextIsUntrusted: true, memoryIsUntrusted: true }, personality: 'Calm and careful.',
      tools: {}, observation, goals: { revision: 1, goals: [{ id: 'home', status: 'active', text: 'Return home', constraints: [] }] }, pending: [] },
    memory: [], queryTags: ['home'], memoryJournal: parseMemoryJournal('', scope), scope, ownerFileHashes: { ...hashes }, taskFence: 'task-1', ...overrides };
}
function fixture(overrides = {}) {
  const state = { value: snapshot(), appends: [], reads: 0, clock: 1000 };
  const appendMemory = async (request) => {
    state.appends.push(request);
    const verdict = request.guard?.();
    if (!verdict?.ok) return { ok: false, why: verdict?.why ?? 'memory_guard_rejected' };
    const before = state.value.memoryJournal;
    const entry = request.entry;
    const parsed = parseMemoryJournal(`${before.entries.map((e) => JSON.stringify(e)).join('\n')}${before.entries.length ? '\n' : ''}${JSON.stringify(entry)}\n`, scope);
    state.value.memoryJournal = parsed;
    state.value.memory = parsed.records;
    return { ok: true, replay: false, revision: request.expectedRevision + 1, sha256: 'a'.repeat(64), entryId: entry.id };
  };
  return { state, appendMemory, readSnapshot: async () => { state.reads++; return structuredClone(state.value); },
    readCommitSnapshot: () => structuredClone(state.value), submitOrder: () => ({ ok: true }), now: () => state.clock, ...overrides };
}
function makeMind(f, options = {}) {
  return new AgentMind({ ...f, adapter: adapter(), budget: budget(), limits, contextLimits: {}, ...options });
}

test('remember persists a bounded server episode with no model call and validates its receipt', async () => {
  const f = fixture(); let calls = 0;
  const mind = makeMind(f, { adapter: adapter({ complete: async () => { calls++; return { text: response({ type: 'wait', args: {} }), usage }; } }) });
  const result = await mind.remember();
  assert.equal(result.ok, true);
  assert.equal(result.memory.entryKind, 'episode');
  assert.equal(result.memory.revision, 1);
  assert.equal(f.state.appends.length, 1);
  assert.equal(f.state.appends[0].entry.kind, 'episode');
  assert.deepEqual(f.state.appends[0].expectedHashes, hashes);
  assert.equal(calls, 0);
});

test('remember is disabled without the owner memory writer', async () => {
  const f = fixture(); let calls = 0;
  const mind = makeMind(f, { appendMemory: null, adapter: adapter({ complete: async () => { calls++; return { text: response({ type: 'wait', args: {} }), usage }; } }) });
  assert.equal((await mind.remember()).why, 'memory_disabled');
  assert.equal(calls, 0);
});

test('compaction pins all source ids and persists only a grounded interpretation', async () => {
  const entry = makeEpisode();
  const journal = parseMemoryJournal(`${JSON.stringify(entry)}\n`, scope);
  const f = fixture(); f.state.value = snapshot({ memory: journal.records, memoryJournal: journal });
  let providerContext;
  const mind = makeMind(f, { adapter: adapter({ complete: async ({ body }) => {
    providerContext = JSON.parse(body).context;
    return { text: response({ type: 'summarize_memory', args: { text: 'The character returned toward home.', tags: ['home'], basis: [entry.id] } }), usage };
  } }) });
  const result = await mind.compactMemory({ sourceIds: [entry.id] });
  assert.equal(result.ok, true);
  assert.equal(result.memory.entryKind, 'summary');
  assert.equal(providerContext.required.tools.memoryCompaction.sources[0].id, entry.id);
  assert.equal(f.state.appends.length, 1);
  assert.equal(f.state.appends[0].entry.payload.certainty, 'inferred');
  assert.deepEqual(f.state.appends[0].entry.payload.sources, [{ id: entry.id, sha256: entry.sha256 }]);
  assert.equal(f.state.appends[0].expectedRevision, 1);
  assert.deepEqual(f.state.appends[0].expectedHashes, hashes);
});

test('the CLI simulated compactor accepts episodes whose goals are paused without inventing active tags', async () => {
  const entry = makeEpisode({ goalStatus: 'paused' });
  const journal = parseMemoryJournal(`${JSON.stringify(entry)}\n`, scope);
  const f = fixture(); f.state.value = snapshot({ memory: journal.records, memoryJournal: journal });
  const mind = makeMind(f, { adapter: createSimulatedMind({ memoryPolicy: true }) });
  const result = await mind.compactMemory({ sourceIds: [entry.id] });
  assert.equal(result.ok, true);
  assert.deepEqual(f.state.appends[0].entry.payload.tags, []);
});

test('compaction preserves uncertain source status and rejects invented or incomplete bases without writing', async (t) => {
  const uncertain = makeEpisode({ certainty: 'uncertain' });
  const journal = parseMemoryJournal(`${JSON.stringify(uncertain)}\n`, scope);
  await t.test('summary certainty cannot erase uncertainty', async () => {
    const f = fixture(); f.state.value = snapshot({ memory: journal.records, memoryJournal: journal });
    const mind = makeMind(f, { adapter: adapter({ complete: async () => ({ text: response({ type: 'summarize_memory', args: {
      text: 'The move may have completed.', tags: ['home'], basis: [uncertain.id] } }), usage }) }) });
    const result = await mind.compactMemory({ sourceIds: [uncertain.id] });
    assert.equal(result.ok, true);
    assert.equal(f.state.appends[0].entry.payload.certainty, 'uncertain');
  });
  await t.test('unknown sources and invented bases never write', async () => {
    const f = fixture(); f.state.value = snapshot({ memory: journal.records, memoryJournal: journal });
    const mind = makeMind(f, { adapter: adapter({ complete: async () => ({ text: response({ type: 'summarize_memory', args: {
      text: 'Claim', tags: [], basis: ['invented-source'] } }), usage }) }) });
    assert.equal((await mind.compactMemory({ sourceIds: ['invented-source'] })).ok, false);
    assert.equal(f.state.appends.length, 0);
  });
});

test('shared inference slot fences compaction against decision, conversation, and goal work', async () => {
  const entry = makeEpisode(); const journal = parseMemoryJournal(`${JSON.stringify(entry)}\n`, scope);
  const f = fixture(); f.state.value = snapshot({ memory: journal.records, memoryJournal: journal });
  let release;
  const mind = makeMind(f, { sendChat: () => ({ ok: true }), commitGoals: async () => ({ ok: false }),
    readCommitSnapshot: f.readCommitSnapshot,
    adapter: adapter({ complete: () => new Promise((resolve) => { release = resolve; }) }) });
  const pending = mind.compactMemory({ sourceIds: [entry.id] });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await mind.decide()).why, 'inference_busy');
  assert.equal((await mind.converse({ messageId: 'chat-1' })).why, 'inference_busy');
  assert.equal((await mind.reviseGoals()).why, 'inference_busy');
  release({ text: response({ type: 'wait', args: {} }), usage });
  await pending;
});

test('memory append is fenced by current authority, life, files, and direct owner priority', async (t) => {
  for (const [name, mutate] of [
    ['owner file hashes', (s) => { s.ownerFileHashes.memory = 'f'.repeat(64); }],
    ['authority epoch', (s) => { s.grant.controlRevision++; s.observation.controlRevision++; s.required.observation = structuredClone(s.observation); }],
    ['death', (s) => { s.observation.confirmed.self.dead = true; s.required.observation = structuredClone(s.observation); }],
    ['direct owner priority', (s) => { s.authority = { state: 'active', task: { priority: 'direct' } }; }],
  ]) await t.test(name, async () => {
    const f = fixture(); const original = f.readCommitSnapshot;
    f.readCommitSnapshot = () => { const current = original(); mutate(current); return current; };
    const mind = makeMind(f);
    const result = await mind.remember();
    assert.equal(result.ok, false);
    assert.equal(f.state.appends.length, 1);
  });
});

test('timeout or cancellation during an append stays unknown and reconciles a valid late receipt', async (t) => {
  for (const cancel of [false, true]) await t.test(cancel ? 'cancel' : 'timeout', async () => {
    const f = fixture(); let finishAppend, appendRequest;
    f.appendMemory = (request) => { appendRequest = request; assert.equal(request.guard().ok, true); return new Promise((resolve) => { finishAppend = resolve; }); };
    const mind = makeMind(f, { limits: { ...limits, timeoutMs: cancel ? 800 : 20 } });
    const pending = mind.remember();
    while (!finishAppend) await new Promise((resolve) => setTimeout(resolve, 0));
    if (cancel) mind.cancel();
    const result = await pending;
    assert.equal(result.memory?.state, 'uncertain');
    assert.equal(result.memory?.retryAllowed, false);
    finishAppend({ ok: true, replay: false, revision: 1, sha256: 'a'.repeat(64), entryId: appendRequest.entry.id });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(mind.state.records.at(-1).lateMemory?.afterInterruption, true);
  });
});

test('budget denial and overrun reject writes; unknown usage remains reserved independently of a valid summary', async (t) => {
  const entry = makeEpisode(), journal = parseMemoryJournal(`${JSON.stringify(entry)}\n`, scope);
  for (const scenario of ['denied', 'unknown', 'overrun']) await t.test(scenario, async () => {
    const f = fixture(); f.state.value = snapshot({ memory: journal.records, memoryJournal: journal });
    const ledger = scenario === 'denied' ? budget({ maxCalls: 1, maxTokens: 1, maxCostUnits: 1 }) : budget();
    const a = adapter({ complete: async () => ({ text: response({ type: 'summarize_memory', args: { text: 'Note', tags: ['home'], basis: [entry.id] } }),
      usage: scenario === 'unknown' ? null : scenario === 'overrun' ? { inputTokens: 100000, outputTokens: 2, costUnits: 1 } : usage }) });
    const result = await makeMind(f, { adapter: a, budget: ledger }).compactMemory({ sourceIds: [entry.id] });
    if (scenario === 'denied') assert.notEqual(result.ok, true);
    if (scenario === 'unknown') {
      assert.ok(ledger.snapshot.totals.unknownEntries > 0);
      assert.equal(f.state.appends.length, 1, 'a valid summary can be saved while its provider usage remains unresolved');
    }
    if (scenario === 'overrun') assert.equal(result.why, 'provider_limit_overrun');
    if (scenario !== 'unknown') assert.equal(f.state.appends.length, 0);
  });
});

test('invalid summary basis after dispatch settles compaction usage and a saved summary is reused without another call', async () => {
  const entry = makeEpisode(), journal = parseMemoryJournal(`${JSON.stringify(entry)}\n`, scope);
  const f = fixture(); f.state.value = snapshot({ memory: journal.records, memoryJournal: journal });
  const ledger = budget(); let calls = 0;
  const mind = makeMind(f, { budget: ledger, adapter: adapter({ complete: async () => {
    calls++; return { text: response({ type: 'summarize_memory', args: { text: 'Interpretation', tags: ['home'], basis: calls === 1 ? ['invented-source'] : [entry.id] } }), usage };
  } }) });
  assert.equal((await mind.compactMemory({ sourceIds: [entry.id] })).why, 'invalid_memory_summary');
  assert.equal(f.state.appends.length, 0);
  assert.equal(ledger.snapshot.entries[0].kind, 'compaction');
  assert.equal(ledger.snapshot.entries[0].state, 'settled');
  assert.deepEqual(ledger.snapshot.entries[0].usage, usage);
  assert.equal((await mind.compactMemory({ sourceIds: [entry.id] })).ok, true);
  assert.equal((await mind.compactMemory({ sourceIds: [entry.id] })).why, 'memory_summary_exists');
  assert.equal(calls, 2);
  assert.equal(ledger.snapshot.totals.calls, 2);
});

test('ambiguous memory writer blocks further writes and protects its unknown outcome in other decisions', async () => {
  const f = fixture({ appendMemory: async () => { throw new Error('receipt lost'); } });
  let context;
  const mind = makeMind(f, { adapter: adapter({ complete: async ({ body }) => { context = JSON.parse(body).context;
    return { text: response({ type: 'wait', args: {} }), usage }; } }) });
  assert.equal((await mind.remember()).why, 'memory_commit_uncertain');
  assert.equal((await mind.remember()).why, 'memory_commit_uncertain');
  assert.equal(mind.state.memory.submissionUncertain, true);
  assert.equal((await mind.decide()).ok, true);
  assert.ok(context.required.pending.some((r) => r.kind === 'memory_commit' && r.state === 'uncertain' && r.retryAllowed === false));
});
