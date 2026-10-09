import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, compactMemory, DEFAULT_CONTEXT_LIMITS } from '../tools/agent/context.mjs';

const scope = { ownerId: 'owner-1', characterId: 'agent-1', worldId: 'world-1' };

function required(overrides = {}) {
  return {
    rules: ['permissions are authoritative'],
    personality: { version: 2, text: 'steady' },
    tools: ['observe', 'act', 'stop'],
    observation: { tick: 100, freshness: 'current' },
    goals: { current: 'stay safe', restrictions: ['no purchases'] },
    pending: [{ actionId: 'a-17', status: 'uncertain', text: 'outcome not confirmed' }],
    ...overrides,
  };
}

function record(id, overrides = {}) {
  return {
    id,
    revision: 1,
    scope: { ...scope },
    text: `memory ${id}`,
    certainty: 'confirmed',
    createdAtMs: 10,
    validUntilMs: null,
    tags: [],
    sources: [{ id: `event-${id}`, tick: 10 }],
    ...overrides,
  };
}

test('required blocks are preserved and exact fit succeeds while one unit over fails', () => {
  const input = required();
  const base = buildContext({ required: input, scope, nowMs: 100 });
  assert.equal(base.ok, true);
  assert.deepEqual(base.document.required, input);
  assert.equal(base.text, JSON.stringify(base.document));

  const exactLimits = {
    maxContextUnits: base.report.requiredUnits + 8,
    outputReserveUnits: 5,
    marginUnits: 3,
    maxInputBytes: base.report.requiredBytes,
  };
  const exact = buildContext({ required: input, scope, nowMs: 100, limits: exactLimits });
  assert.equal(exact.ok, true);
  assert.deepEqual(exact.document.required.pending, input.pending);
  const over = buildContext({
    required: input,
    scope,
    nowMs: 100,
    limits: { ...exactLimits, maxContextUnits: exactLimits.maxContextUnits - 1 },
  });
  assert.equal(over.ok, false);
  assert.equal(over.why, 'required_context_over_budget');
  assert.equal(over.report.requiredOverBudget, true);
});

test('large repeated history is bounded, deduplicated, deterministic, and reports omitted history', () => {
  const history = Array.from({ length: 60 }, (_, index) => record(`r-${index}`, {
    text: index % 2 ? 'the harbor was seen' : 'the harbor was seen',
    certainty: 'confirmed',
    createdAtMs: index,
    tags: ['harbor'],
  }));
  const options = {
    required: required(),
    memory: history,
    queryTags: ['harbor'],
    scope,
    nowMs: 100,
    limits: { maxCandidates: 45, maxSelected: 20, maxMemoryUnits: 10000 },
  };
  const first = buildContext(options);
  const second = buildContext(options);
  assert.equal(first.ok, true);
  assert.equal(first.text, second.text);
  assert.equal(first.report.truncatedCandidates, 15);
  assert.equal(first.report.missingHistory, true);
  assert.equal(first.report.duplicateContentCount, 44);
  assert.equal(first.report.selectedInputBytes <= DEFAULT_CONTEXT_LIMITS.maxInputBytes, true);
  assert.deepEqual(first.document.required.pending, options.required.pending);
  assert.equal(first.report.countMode, 'estimated_utf8_bytes');
});

test('invalid, out-of-scope, expired and superseded revisions are excluded with reasons', () => {
  const memory = [
    record('same', { revision: 1, text: 'old fact' }),
    record('same', { revision: 2, text: 'new fact' }),
    record('expired', { validUntilMs: 50 }),
    record('future', { createdAtMs: 101 }),
    record('foreign', { scope: { ...scope, ownerId: 'other' } }),
    { id: 'invalid' },
  ];
  const result = buildContext({ required: required(), memory, scope, nowMs: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.document.memory.length, 1);
  assert.match(result.document.memory[0].text, /new fact/);
  assert.equal(result.report.duplicateIdCount, 1);
  assert.equal(result.report.expiredCount, 1);
  assert.equal(result.report.futureCount, 1);
  assert.equal(result.report.scopeMismatchCount, 1);
  assert.equal(result.report.invalidCount, 1);
});

test('uncertainty and source provenance survive exact compaction without mutating input', () => {
  const a = record('note-a', { text: 'target outcome unknown', certainty: 'uncertain', tags: ['combat'] });
  const b = record('note-b', { text: 'target outcome unknown', certainty: 'uncertain', tags: ['combat'] });
  const confirmed = record('note-c', { text: 'target defeated', certainty: 'confirmed', tags: ['combat'] });
  const before = structuredClone([a, b, confirmed]);
  const compacted = compactMemory([a, b, confirmed], { scope, maxSources: 1 });
  assert.deepEqual([a, b, confirmed], before);
  assert.equal(compacted.length, 6); // source references split into bounded chunks without loss
  const uncertain = compacted.filter((item) => item.certainty === 'uncertain');
  assert.equal(uncertain.length, 4);
  assert.ok(uncertain.every((item) => item.text === 'target outcome unknown'));
  const sourceIds = uncertain.flatMap((item) => item.sources.map((source) => source.id));
  assert.ok(sourceIds.some((id) => id.startsWith('note-a@1')));
  assert.ok(sourceIds.some((id) => id.startsWith('note-b@1')));
  assert.ok(compacted.some((item) => item.certainty === 'confirmed'));
  const reused = buildContext({ required: required(), memory: compacted, scope, nowMs: 100 });
  assert.equal(reused.ok, true);
  assert.equal(reused.report.invalidCount, 0);
});

test('context pruning omits optional records only and preserves pending uncertainty', () => {
  const pending = required().pending;
  const result = buildContext({
    required: required(),
    memory: [record('optional', { text: 'extra detail '.repeat(100), tags: ['extra'] })],
    scope,
    nowMs: 100,
    limits: { maxInputBytes: 900, maxMemoryUnits: 100, maxContextUnits: 4096 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.document.memory, []);
  assert.deepEqual(result.document.required.pending, pending);
  assert.equal(result.report.skipped.optional_over_budget, 1);
});

test('selected-memory cap reports omitted candidates and relevance is deterministic', () => {
  const memory = [
    record('least-recent', { text: 'unrelated old fact', createdAtMs: 1, tags: [] }),
    record('relevant-old', { text: 'relevant old fact', createdAtMs: 2, tags: ['goal'] }),
    record('relevant-new', { text: 'relevant recent fact', createdAtMs: 3, tags: ['goal'] }),
  ];
  const result = buildContext({
    required: required(), memory, queryTags: ['goal'], scope, nowMs: 10,
    limits: { maxSelected: 1 },
  });
  assert.equal(result.ok, true);
  assert.match(result.document.memory[0].text, /relevant recent fact/);
  assert.equal(result.report.skipped.selected_limit, 2);
});

test('injected counter and configuration are validated and reported', () => {
  const injected = buildContext({
    required: required(), scope, nowMs: 1, countUnits: (text) => Math.ceil(new TextEncoder().encode(text).length / 2),
  });
  assert.equal(injected.report.countMode, 'injected_units');
  assert.throws(() => buildContext({ required: required(), scope, nowMs: 1, countUnits: () => -1 }), /non-negative safe integer/);
  assert.throws(() => buildContext({ required: required(), scope, nowMs: 1, countUnits: () => 1.5 }), /non-negative safe integer/);
  assert.throws(() => buildContext({ required: required(), scope, nowMs: 1, limits: { maxCandidates: -1 } }), /maxCandidates/);
  assert.throws(() => buildContext({ required: required(), scope, nowMs: 1, limits: { madeUp: 1 } }), /unknown context limit/);
  assert.throws(() => buildContext({ required: required({ rules: undefined }), scope, nowMs: 1 }), /JSON-safe/);
});

test('scope, revision and source shapes are exact; integer revisions sort numerically', () => {
  const candidates = [
    record('revision-10', { id: 'versioned', revision: 10, text: 'newest revision' }),
    record('revision-2', { id: 'versioned', revision: 2, text: 'older revision' }),
    record('invalid-revision', { revision: '11', text: 'invalid string revision' }),
    record('invalid-scope', { scope: { ...scope, extra: true }, text: 'invalid scope shape' }),
    record('invalid-source', { sources: [{ id: '', tick: null }], text: 'empty provenance' }),
    record('missing-source-tick', { sources: [{ id: 'source' }], text: 'missing tick' }),
  ];
  const result = buildContext({ required: required(), memory: candidates, scope, nowMs: 100 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.document.memory.map((entry) => entry.text), ['newest revision']);
  assert.equal(result.report.duplicateIdCount, 1);
  assert.equal(result.report.invalidCount, 4);
});

test('required blocks are snapshotted so later source mutation cannot desync text', () => {
  const source = required();
  const result = buildContext({ required: source, scope, nowMs: 100 });
  source.rules.push('mutated after build');
  source.pending[0].status = 'completed';
  assert.equal(result.text, JSON.stringify(result.document));
  assert.deepEqual(result.document.required.pending, [{ actionId: 'a-17', status: 'uncertain', text: 'outcome not confirmed' }]);
  assert.deepEqual(result.document.required.rules, ['permissions are authoritative']);
});

test('scope with extra keys is rejected instead of widening access', () => {
  assert.throws(() => compactMemory([], { scope: { ...scope, ownerId: 'other', extra: 'ignored?' } }), /scope/);
});

test('compactMemory rejects invalid bounds and never crosses owner scope', () => {
  assert.throws(() => compactMemory([], { scope, maxSources: 0 }), /positive safe integer/);
  assert.throws(() => compactMemory([], { scope, maxSources: 65 }), /at most 64/);
  const result = compactMemory([
    record('mine'),
    record('theirs', { scope: { ...scope, worldId: 'other-world' } }),
  ], { scope });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].scope, scope);
});

test('long original ids compact into bounded reusable records with full provenance', () => {
  const originalId = 'x'.repeat(160);
  const compacted = compactMemory([record(originalId)], { scope });
  assert.ok(compacted[0].id.length <= 160);
  assert.ok(compacted[0].sources.some((s) => s.id === `${originalId}@1`));
  const result = buildContext({ required: required(), memory: compacted, scope, nowMs: 100 });
  assert.equal(result.report.invalidCount, 0);
  assert.equal(result.document.memory.length, 1);
});

test('candidate bound reads the latest append-ordered entries and zero candidates scans none', () => {
  const result = buildContext({ required: required(), memory: [record('old'), record('new')], scope, nowMs: 100, limits: { maxCandidates: 1 } });
  assert.equal(result.document.memory[0].text, 'memory new');
  assert.equal(result.report.truncatedCandidates, 1);
  assert.equal(result.report.missingHistory, true);
  const empty = buildContext({ required: required(), memory: [record('new')], scope, nowMs: 100, limits: { maxCandidates: 0 } });
  assert.equal(empty.document.memory.length, 0);
  assert.equal(empty.report.scannedCandidates, 0);
});

test('zero optional memory budget keeps required blocks and reports zero selected memory units', () => {
  const result = buildContext({ required: required(), memory: [record('optional')], scope, nowMs: 100, limits: { maxMemoryUnits: 0 } });
  assert.equal(result.ok, true);
  assert.equal(result.report.selectedMemoryUnits, 0);
  assert.deepEqual(result.document.memory, []);
  assert.deepEqual(result.document.required, required());
});
