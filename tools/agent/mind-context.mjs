import { createHash } from 'node:crypto';
import { buildRunnerContext } from './runner-context.mjs';
import { MIND_INSTRUCTIONS, MIND_RESPONSE_SCHEMA, CONVERSATION_INSTRUCTIONS, CONVERSATION_RESPONSE_SCHEMA, GOAL_INSTRUCTIONS, GOAL_RESPONSE_SCHEMA, MEMORY_INSTRUCTIONS, MEMORY_RESPONSE_SCHEMA, measuredRequest, bytes, mindLimits, validateAdapter, plain } from './mind-contract.mjs';

// Count the exact adapter body on every context candidate. Required instructions and schema
// remain outside the prunable document but inside the measured, transmitted request.
export function buildMindContext({ snapshot, adapter, requestId, limits = {}, contextLimits = {}, nowMs, mode = 'decision' }) {
  const config = mindLimits(limits); validateAdapter(adapter);
  if (!['decision', 'conversation', 'goals', 'compaction'].includes(mode)) throw new TypeError('invalid mind mode');
  const instructions = mode === 'conversation' ? CONVERSATION_INSTRUCTIONS : mode === 'goals' ? GOAL_INSTRUCTIONS : mode === 'compaction' ? MEMORY_INSTRUCTIONS : MIND_INSTRUCTIONS;
  const responseSchema = mode === 'conversation' ? CONVERSATION_RESPONSE_SCHEMA : mode === 'goals' ? GOAL_RESPONSE_SCHEMA : mode === 'compaction' ? MEMORY_RESPONSE_SCHEMA : MIND_RESPONSE_SCHEMA;
  if (!plain(contextLimits) || Object.keys(contextLimits).some((k) => !['maxMemoryUnits', 'maxCandidates', 'maxSelected'].includes(k)))
    throw new TypeError('invalid mind context limits');
  const packet = (context) => ({ v: 1, model: adapter.id, requestId, instructions,
    responseSchema, context, maxOutputTokens: config.maxOutputTokens });
  const measure = (context) => measuredRequest(adapter, packet(context), config.maxOutputTokens);
  const countText = (text) => {
    const count = adapter.countText(text);
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('invalid adapter text count');
    return count;
  };
  const countUnits = (text) => {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return countText(text);
    const prepared = measure(value);
    // Let the existing optional pruning loop account for provider wrapper bytes as well.
    return bytes(prepared.body) > config.maxInputBytes ? config.maxContextTokens : prepared.inputTokens;
  };
  const context = buildRunnerContext({ required: snapshot.required, memory: snapshot.memory, queryTags: snapshot.queryTags, candidateRanks: snapshot.candidateRanks ?? null,
    scope: snapshot.scope, nowMs, limits: { ...contextLimits, maxContextUnits: config.maxContextTokens,
      maxInputBytes: config.maxInputBytes, outputReserveUnits: config.maxOutputTokens, marginUnits: config.marginTokens }, countUnits });
  if (!context.ok) return context;
  const prepared = measure(context.document);
  const total = prepared.inputTokens + config.maxOutputTokens + config.marginTokens;
  if (total > config.maxContextTokens || bytes(prepared.body) > config.maxInputBytes) return { ok: false, why: 'required_context_over_budget', report: context.report };
  const blocks = Object.fromEntries(Object.entries(context.document.required).map(([key, value]) =>
    [key, { bytes: bytes(JSON.stringify(value)), tokens: countText(JSON.stringify(value)) }]));
  blocks.instructions = { bytes: bytes(instructions), tokens: countText(instructions) };
  blocks.responseSchema = { bytes: bytes(JSON.stringify(responseSchema)), tokens: countText(JSON.stringify(responseSchema)) };
  blocks.memory = { bytes: bytes(JSON.stringify(context.document.memory)), tokens: countText(JSON.stringify(context.document.memory)) };
  return { ...context, prepared, report: { ...context.report, countMode: adapter.countMode, model: adapter.id,
    inputTokens: prepared.inputTokens, outputReserveTokens: config.maxOutputTokens, marginTokens: config.marginTokens,
    totalReservedContextTokens: total, transmittedBytes: bytes(prepared.body), bodySha256: createHash('sha256').update(prepared.body).digest('hex'),
    blocks, compaction: { method: 'mechanical_exact_content', providerCalls: 0, costUnits: 0 },
    ...(snapshot.memoryRetrieval ? { memoryRetrieval: structuredClone(snapshot.memoryRetrieval) } : {}), ownerFileHashes: snapshot.ownerFileHashes } };
}
