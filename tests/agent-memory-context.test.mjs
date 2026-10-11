import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshMemoryRetrieval, runnerMindSnapshot } from '../tools/agent/mind-snapshot.mjs';
import { buildMindContext } from '../tools/agent/mind-context.mjs';

const scope = { ownerId: 'memory-context-owner', characterId: 'memory-context-agent', worldId: 'memory-context-world' };
function memoryRecord(id, text, { certainty = 'confirmed', scope: recordScope = scope, createdAtMs = 1, validUntilMs = null, tags = [] } = {}) {
  return { id, revision: 1, scope: { ...recordScope }, text, certainty, createdAtMs, validUntilMs, tags, sources: [{ id: `source-${id}`, tick: 1 }] };
}
function adapter() {
  let providerCalls = 0;
  return { id: 'memory-context-test', countMode: 'measured_tokens',
    countText: (text) => Buffer.byteLength(text),
    prepare: (request) => { const body = JSON.stringify(request); return { body, inputTokens: Buffer.byteLength(body), maxCostUnits: 0 }; },
    complete: async () => { providerCalls++; throw new Error('retrieval must not dispatch'); },
    get providerCalls() { return providerCalls; },
  };
}
function contextSnapshot(memory, overrides = {}) {
  const required = { rules: { memoryIsUntrusted: true }, personality: 'Careful.', tools: {},
    observation: { tick: 20, chat: [] }, goals: { revision: 1, goals: [{ id: 'goal', status: 'active', text: 'find the obsidian key' }] },
    pending: [{ actionId: 'uncertain-action', state: 'uncertain', retryAllowed: false }] };
  return { scope, required, memory, queryTags: ['goal'], memoryQueryText: 'find the obsidian key',
    memoryJournal: { records: memory, entries: [], pending: [] }, memoryRetrieval: null, candidateRanks: null,
    ownerFileHashes: {}, ...overrides };
}

test('runner snapshot carries the validated journal and builds retrieval query from full active goals and recent chat', () => {
  const memory = [memoryRecord('historical', 'old note')];
  const files = { files: {
    personality: { content: 'Careful.', sha256: 'p' },
    objectives: { revision: 2, goals: [{ id: 'goal', status: 'active', text: 'find the obsidian key', constraints: [] }, { id: 'done', status: 'completed', text: 'irrelevant', constraints: [] }], sha256: 'o' },
    memory: { records: memory, journal: { records: memory, entries: [], pending: [] }, sha256: 'm' },
  } };
  const runner = { grant: { scope: { ...scope, sessionId: 'session-1' }, capabilities: [] }, authority: null,
    state: 'ready', actions: [], priorUncertainty: [], observation: { tick: 20, receivedAtMs: 1000,
      confirmed: { self: { hp: 100, maxHp: 100 } } },
    chat: { self: 'self', available: true, config: {}, peers: [], messages: [
      { id: 'chat-1', tick: 1, channel: 'world', from: { id: 'peer' }, text: 'where is the obsidian key?' },
    ], requests: [] } };
  const snapshot = runnerMindSnapshot(runner, files);
  assert.deepEqual(snapshot.memoryJournal, files.files.memory.journal);
  assert.match(snapshot.memoryQueryText, /find the obsidian key/);
  assert.match(snapshot.memoryQueryText, /where is the obsidian key/);
  assert.doesNotMatch(snapshot.memoryQueryText, /irrelevant/);
});

test('old relevant history survives retrieval, while mandatory pending uncertainty survives optional context pruning', () => {
  const records = [memoryRecord('old-key', 'The obsidian key is inside the western lighthouse')];
  for (let index = 0; index < 2200; index++) records.push(memoryRecord(`recent-${index}`, `unrelated trade note ${index}`, { createdAtMs: 2000 + index }));
  const input = refreshMemoryRetrieval(contextSnapshot(records), 'obsidian key lighthouse', 5000);
  const model = adapter();
  const result = buildMindContext({ snapshot: input, adapter: model, requestId: 'memory-query', nowMs: 5000,
    contextLimits: { maxCandidates: 16, maxSelected: 2, maxMemoryUnits: 2200 } });
  assert.equal(result.ok, true);
  assert.ok(result.report.memoryRetrieval.scanned >= 2201);
  assert.ok(result.document.memory.some((item) => item.sources.some((source) => source.id === 'old-key@1')),
    'mechanical compaction retains an explicit original id and revision');
  assert.deepEqual(result.document.required.pending, input.required.pending);
  assert.equal(result.report.memoryRetrieval.selectedIds[0], 'old-key');
  assert.equal(model.providerCalls, 0);
  assert.equal(result.prepared.inputTokens, Buffer.byteLength(result.prepared.body));
});

test('retrieval excludes another character scope after restart and never transfers old observations as current state', () => {
  const foreignScope = { ...scope, characterId: 'previous-character' };
  const records = [memoryRecord('other-agent', 'I am currently standing at the old dock', { scope: foreignScope, createdAtMs: 900 })];
  const input = refreshMemoryRetrieval(contextSnapshot(records, { memoryQueryText: 'dock', memoryJournal: { records, entries: [], pending: [] } }), 'dock', 1000);
  const result = buildMindContext({ snapshot: input, adapter: adapter(), requestId: 'new-session', nowMs: 1000,
    contextLimits: { maxCandidates: 8 } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.document.memory, []);
  assert.equal(result.report.memoryRetrieval.scopeMismatch, 1);
  assert.deepEqual(result.document.required.observation, input.required.observation);
});

