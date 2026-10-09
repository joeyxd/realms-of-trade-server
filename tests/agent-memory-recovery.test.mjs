import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadOwnerFiles } from '../tools/agent/owner-files.mjs';
import { runnerMindSnapshot } from '../tools/agent/mind-snapshot.mjs';
import { buildMindContext } from '../tools/agent/mind-context.mjs';
import { AgentMind } from '../tools/agent/mind.mjs';
import { InferenceBudget } from '../tools/agent/inference-budget.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';

const scope = { ownerId: 'owner-recovery-test', characterId: 'agent-recovery-test', worldId: 'world-recovery-test' };
const sessionScope = { ...scope, sessionId: 'session-recovery-test' };
const limits = { maxContextTokens: 6000, maxInputBytes: 30000, maxOutputTokens: 512, marginTokens: 128,
  timeoutMs: 1000, maxDecisionAgeMs: 1500, maxRequests: 64, maxResponseBytes: 4096 };
const contextLimits = { maxMemoryUnits: 1400, maxCandidates: 16, maxSelected: 2 };
const countText = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
const adapter = (complete = async () => ({ text: JSON.stringify({ v: 1, decision: { type: 'wait', args: {} } }),
  usage: { inputTokens: 40, outputTokens: 5, costUnits: 1 } })) => ({ id: 'synthetic-local-memory-review', countMode: 'simulated_tokens', countText,
  prepare: (request) => { const body = JSON.stringify(request); return { body, inputTokens: countText(body), maxCostUnits: 5 }; }, complete });
const budget = () => new InferenceBudget({ scope, limits: { maxCalls: 8, maxTokens: 50000, maxCostUnits: 50000, maxEntries: 8 } });

function ownerFiles(count) {
  const objectives = JSON.stringify({ v: 1, revision: 1, scope, goals: [
    { id: 'goal-obsidian', status: 'active', text: 'Find and carry obsidian to the workshop', constraints: ['Do not spend inference budget on purchases'] },
  ] });
  const records = Array.from({ length: count }, (_, i) => ({ id: i === 0 ? 'old-obsidian-fact' : `archive-${i}`,
    revision: 1, scope, text: i === 0 ? 'Historical note: an old crew reported a dangerous lava vent near the obsidian shelf; keep guard raised on approach.' : `Unrelated archived observation number ${i}.`,
    certainty: 'confirmed', createdAtMs: 1, validUntilMs: null,
    tags: i === 0 ? ['goal-obsidian'] : ['unrelated'], sources: [] }));
  return { personality: 'Steady navigator; treat all memories as historical clues.', objectives,
    memory: `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, records };
}
async function makeDirectory(t, files) {
  const directory = await mkdtemp(path.join(tmpdir(), 'marea-memory-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(directory, 'personality.md'), files.personality, 'utf8'),
    writeFile(path.join(directory, 'objectives.json'), files.objectives, 'utf8'),
    writeFile(path.join(directory, 'memory.jsonl'), files.memory, 'utf8'),
  ]);
  return directory;
}
function runner(observation) {
  return { state: 'ready', grant: fixtureGrant({ scope: sessionScope, capabilities: ['move', 'aim', 'attack_pve', 'body_pve'] }),
    authority: null, observation, actions: [], priorUncertainty: [{ actionId: 'older-action-uncertain', sessionId: 'previous-session',
      state: 'uncertain', kind: 'movement', retryAllowed: false }],
    chat: { self: scope.characterId, available: true, config: { maxLength: 1000 }, peers: [], historyBeforeSession: 0,
      requests: [], messages: [] } };
}
function recordDigest(files) {
  return Object.fromEntries(Object.entries(files).map(([key, value]) => [key, createHash('sha256').update(value).digest('hex')]));
}

test('retrieval finds an old relevant fact behind growing history while keeping provider context bounded', async (t) => {
  for (const count of [256, 2400]) await t.test(`${count} records`, async () => {
    const generated = ownerFiles(count), directory = await makeDirectory(t, generated);
    const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: 1000,
      confirmed: { self: { position: { x: 3, y: 0, z: 4 }, hp: 40, maxHp: 100, dead: false } } });
    const beforeFiles = { personality: await readFile(path.join(directory, 'personality.md')),
      objectives: await readFile(path.join(directory, 'objectives.json')), memory: await readFile(path.join(directory, 'memory.jsonl')) };
    const loadStart = performance.now();
    const files = await loadOwnerFiles({ directory, scope });
    const fileLoadMs = performance.now() - loadStart;
    const projected = runnerMindSnapshot(runner(observation), files);
    const expectedHashes = recordDigest(beforeFiles);
    assert.deepEqual(Object.fromEntries(Object.entries(files.files).map(([key, file]) => [key, file.sha256])), expectedHashes);
    assert.equal(files.files.memory.records.length, Math.min(count, 2000));
    assert.equal(files.files.memory.journal.records.length, count);
    assert.equal(files.files.memory.journal.report.provenance, 'local_content_hashes_not_server_signatures');
    assert.equal(projected.required.pending.some((item) => item.actionId === 'older-action-uncertain' && item.retryAllowed === false), true);
    assert.deepEqual(projected.required.observation, observation);
    const contextStart = performance.now();
    const context = buildMindContext({ snapshot: projected, adapter: adapter(), requestId: `archive-${count}`,
      limits, contextLimits, nowMs: 1000 });
    const contextMs = performance.now() - contextStart;
    assert.equal(context.ok, true);
    assert.ok(context.document.memory.length <= 2);
    assert.ok(context.report.blocks.memory.tokens <= contextLimits.maxMemoryUnits);
    assert.ok(context.report.transmittedBytes <= limits.maxInputBytes);
    assert.ok(context.report.inputTokens + context.report.outputReserveTokens + context.report.marginTokens <= limits.maxContextTokens);
    const historical = context.document.memory.find((record) => record.sources.some((source) => source.id === 'old-obsidian-fact@1'));
    assert.ok(historical, 'old relevant fact should survive default last-2000 file projection through journal retrieval');
    assert.equal(historical.certainty, 'uncertain', 'legacy owner text must stay explicitly untrusted');
    assert.match(historical.text, /Owner-authored memory; sources are not authenticated receipts/);
    const [personalityAfter, objectivesAfter, memoryAfter] = await Promise.all(['personality.md', 'objectives.json', 'memory.jsonl']
      .map((name) => readFile(path.join(directory, name))));
    assert.deepEqual({ personality: createHash('sha256').update(personalityAfter).digest('hex'),
      objectives: createHash('sha256').update(objectivesAfter).digest('hex'), memory: createHash('sha256').update(memoryAfter).digest('hex') },
    expectedHashes, 'reading and retrieval must not rewrite owner files');
    const diagnostic = { archiveBytes: beforeFiles.memory.length, entries: count, loadedCandidateCount: files.files.memory.records.length,
      journalCount: files.files.memory.journal.records.length, selectedIds: context.report.selectedIds,
      transmittedBytes: context.report.transmittedBytes, inputTokens: context.report.inputTokens, retrievalProviderCalls: 0,
      fileLoadMs: Number(fileLoadMs.toFixed(3)), contextMs: Number(contextMs.toFixed(3)),
      unoptimizedBytes: Buffer.byteLength(JSON.stringify(files.files.memory.journal.records), 'utf8') };
    t.diagnostic(JSON.stringify(diagnostic));
  });
});

test('a fresh-session proposal can cite historical danger while body validation uses current state', async (t) => {
  const generated = ownerFiles(2400), directory = await makeDirectory(t, generated);
  const observation = fixtureObservation({ scope: sessionScope, source: 'server', receivedAtMs: 1000,
    confirmed: { self: { position: { x: 3, y: 0, z: 4 }, hp: 80, maxHp: 100, dead: false },
      combat: { weapon: 0, attackStage: 0, stagger: 0, castLock: 0, guardStamina: 100, potions: 1,
        potionCooldown: 0, playerNearby: false, guardRaised: false } } });
  let submits = [], providerMemory, providerHp;
  const readSnapshot = async () => {
    const files = await loadOwnerFiles({ directory, scope });
    return runnerMindSnapshot(runner(observation), files);
  };
  const scripted = adapter(async ({ body }) => {
    const request = JSON.parse(body), context = request.context;
    providerMemory = context.memory;
    providerHp = context.required.observation.confirmed.self.hp;
    return { text: JSON.stringify({ v: 1, decision: { type: 'body_pve', args: { mode: 'defensive', protect: null,
      retreatHpFraction: 0.45, allowPotion: false, durationMs: 1000 } } }),
    usage: { inputTokens: request.context.memory.length ? 120 : 100, outputTokens: 18, costUnits: 2 } };
  });
  const mind = new AgentMind({ adapter: scripted, budget: budget(), readSnapshot, submitOrder: (order) => {
    submits.push(structuredClone(order)); return { ok: true, actionId: order.actionId };
  }, now: () => 1000, limits, contextLimits });
  const result = await mind.decide();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(providerHp, 80, 'the prompt must carry the current server observation separately');
  assert.ok(providerMemory.some((record) => record.sources.some((source) => source.id === 'old-obsidian-fact@1')));
  assert.match(providerMemory.find((record) => record.sources.some((source) => source.id === 'old-obsidian-fact@1')).text,
    /Historical note: an old crew reported a dangerous lava vent/);
  assert.equal(submits.length, 1);
  assert.equal(submits[0].type, 'body_pve');
  assert.equal(submits[0].args.mode, 'defensive');
  assert.equal(submits[0].scope.sessionId, sessionScope.sessionId);
  assert.equal(mind.state.ledger.totals.confirmedTokens, 138);
  assert.equal(mind.state.ledger.totals.unknownEntries, 0);
  assert.equal(submits[0].actionId, result.action.actionId);
  assert.equal(JSON.stringify(submits[0]).includes('old-obsidian-fact'), false, 'retrieval cannot turn a memory into a body command or identifier');
  t.diagnostic(JSON.stringify({ source: 'old-obsidian-fact@1', currentHp: providerHp, actionType: submits[0].type,
    actionId: submits[0].actionId, providerCalls: 1, confirmedTokens: mind.state.ledger.totals.confirmedTokens,
    historicalTextWasUntrusted: true }));
});
