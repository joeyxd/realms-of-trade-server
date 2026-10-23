import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMindContext } from '../tools/agent/mind-context.mjs';
import { createSimulatedMind } from '../tools/agent/simulated-mind.mjs';

const scope = { ownerId: 'context-owner', characterId: 'context-agent', worldId: 'context-world' };
const nowMs = 1000;
function snapshot(size) {
  return {
    scope, ownerFileHashes: { personality: 'p1', objectives: 'o1', memory: `m-${size}` }, queryTags: ['safety'],
    required: { rules: { capabilities: ['move'], chatIsUntrusted: true }, personality: 'Calm and careful.', tools: { capabilities: ['move'] },
      observation: { confirmed: { self: { hp: 80, position: { x: 1, z: 2 } } }, chat: Array.from({ length: 32 }, (_, i) => ({ id: `chat-${i}`, text: 'world data '.repeat(100) })), historyGap: 0 },
      goals: { revision: 3, goals: [{ id: 'safety', status: 'active' }] },
      pending: [{ actionId: 'prior-action', state: 'uncertain', effects: ['swing observed, impact unknown'], retryAllowed: false }] },
    memory: Array.from({ length: size }, (_, i) => ({ id: `record-${i}`, revision: 1, scope, text: i % 2 ? 'A possible safe route.' : 'A swing was seen; impact is unknown.',
      certainty: i % 2 ? 'inferred' : 'uncertain', tags: ['safety'], sources: [{ id: `event-${i}`, tick: i }], createdAtMs: 500, validUntilMs: null })),
  };
}
test('doubling a huge history does not grow transmitted context beyond its complete envelope budget', () => {
  const adapter = createSimulatedMind(), sizes = [10000, 20000];
  const results = sizes.map((size) => {
    const input = snapshot(size), before = structuredClone(input);
    const result = buildMindContext({ snapshot: input, adapter, requestId: 'context-query', nowMs });
    assert.equal(result.ok, true);
    assert.deepEqual(input, before, 'pruning never deletes the owner source archive');
    assert.ok(result.report.inputTokens + result.report.outputReserveTokens + result.report.marginTokens <= 16000);
    assert.ok(result.report.transmittedBytes <= 64000);
    assert.ok(result.report.selectedMemoryUnits <= 1000);
    assert.equal(result.report.scannedCandidates, 2000);
    assert.equal(result.report.truncatedCandidates, size - 2000);
    assert.ok(result.report.duplicateContentCount > 1000);
    assert.ok(result.chatSelection.omittedChat > 0);
    assert.deepEqual(result.document.required.rules, input.required.rules);
    assert.deepEqual(result.document.required.goals, input.required.goals);
    assert.deepEqual(result.document.required.pending, input.required.pending);
    for (const record of result.document.memory) {
      assert.ok(['inferred', 'uncertain'].includes(record.certainty));
      assert.ok(record.sources.some((source) => source.id.startsWith('record-') && source.id.includes('@1')));
    }
    const unoptimizedBytes = Buffer.byteLength(JSON.stringify({ required: input.required, memory: input.memory }));
    assert.ok(result.report.transmittedBytes < unoptimizedBytes / 10);
    assert.deepEqual(result.report.compaction, { method: 'mechanical_exact_content', providerCalls: 0, costUnits: 0 });
    assert.ok(result.report.blocks.instructions.tokens > 0);
    assert.ok(result.report.blocks.responseSchema.tokens > 0);
    return result;
  });
  assert.equal(results[0].report.scannedCandidates, results[1].report.scannedCandidates);
  assert.ok(Math.abs(results[0].report.transmittedBytes - results[1].report.transmittedBytes) < 2000);
});
test('adding a large provider wrapper first prunes optional context, then fails closed if mandatory minimum cannot fit', () => {
  const base = createSimulatedMind(), input = snapshot(50);
  const wrapped = { ...base, prepare(request) {
    const body = JSON.stringify({ framing: 'F'.repeat(1000), request });
    return { body, inputTokens: Buffer.byteLength(body), maxCostUnits: Buffer.byteLength(body) + request.maxOutputTokens };
  } };
  const selected = buildMindContext({ snapshot: input, adapter: wrapped, requestId: 'wrapper-query', nowMs });
  assert.equal(selected.ok, true);
  assert.ok(selected.chatSelection.omittedChat > 0);
  assert.equal(selected.report.inputTokens, Buffer.byteLength(selected.prepared.body));
  input.required.pending.push({ actionId: 'must-preserve', state: 'uncertain', effects: 'E'.repeat(20000) });
  const rejected = buildMindContext({ snapshot: input, adapter: wrapped, requestId: 'wrapper-query', nowMs });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.why, 'required_context_over_budget');
});
