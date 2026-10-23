import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryEpisode, buildMemoryTurn, createMemorySummary, parseMemoryJournal } from '../tools/agent/memory-journal.mjs';
import { inspectMemoryArchive, proposeMemoryRemoval } from '../tools/agent/memory-management.mjs';

const scope = { ownerId: 'owner-memory', characterId: 'agent-memory', worldId: 'world-memory' };
const jsonl = (...entries) => `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
const episode = (time, { pending = [] } = {}) => createMemoryEpisode({ scope,
  grant: { scope: { ...scope, sessionId: 'session-archive' }, controlRevision: 1 },
  observation: { source: 'server', receivedAtMs: time, revision: time, tick: time,
    confirmed: { self: { position: { x: 0, y: 0, z: 0 }, hp: 100, maxHp: 100, dead: false } } },
  required: { goals: { revision: 1, goals: [] }, pending }, goalFeedback: [], chat: { messages: [] } });
const legacy = (id, revision, createdAtMs, validUntilMs = null) => ({ id, revision, scope, text: `owner note ${id} ${revision}`,
  certainty: 'uncertain', createdAtMs, validUntilMs, tags: ['Dock'], sources: [] });
const journal = (...entries) => parseMemoryJournal(jsonl(...entries), scope);

test('removing an episode also removes every summary that depends on it', () => {
  const e = episode(100);
  const turn = buildMemoryTurn({ memoryJournal: journal(e) }, [e.id], 100).turn;
  const summary = createMemorySummary({ type: 'summarize_memory', args: { text: 'At the dock.', tags: [], basis: [e.id] } }, turn, scope, 110).entry;
  const result = proposeMemoryRemoval({ journal: journal(e, summary), scope, ids: [e.id], nowMs: 120 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.removeIds, [e.id, summary.id].sort());
  assert.deepEqual(result.plan.derivedIds, [summary.id]);
  assert.equal(result.plan.retainedRecords, 0);
});

test('an id removes every legacy revision and duplicate row without resurrection', () => {
  const result = proposeMemoryRemoval({ journal: journal(legacy('claim', 1, 1), legacy('claim', 2, 2)), scope, ids: ['claim'], nowMs: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.plan.affectedRecords, 2);
  assert.equal(result.plan.retainedRecords, 0);
});

test('deleting duplicate identical legacy rows selects the entire duplicate family', () => {
  const row = legacy('duplicate', 1, 5);
  const result = proposeMemoryRemoval({ journal: journal(row, row), scope, ids: ['duplicate'], nowMs: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.plan.affectedRecords, 2);
});

test('legacy source references cascade through id and exact id@revision references', () => {
  const first = legacy('episode-claim', 2, 1);
  const child = { ...legacy('summary-claim', 4, 2), sources: [{ id: 'episode-claim@2', tick: null }] };
  const grandchild = { ...legacy('later-claim', 1, 3), sources: [{ id: 'summary-claim@4', tick: null }] };
  const sibling = { ...legacy('quoted-claim', 1, 4), sources: [{ id: 'episode-claim', tick: null }] };
  const result = proposeMemoryRemoval({ journal: journal(first, child, grandchild, sibling), scope, ids: ['episode-claim'], nowMs: 5 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.removeIds, ['episode-claim', 'later-claim', 'quoted-claim', 'summary-claim']);
  assert.deepEqual(result.plan.derivedIds, ['later-claim', 'quoted-claim', 'summary-claim']);
});

test('retention removes expired records and records older than the exclusive cutoff', () => {
  const result = proposeMemoryRemoval({ journal: journal(legacy('expired', 1, 5, 10), legacy('old', 1, 2), legacy('keep', 1, 5)),
    scope, retention: { expired: true, beforeMs: 5 }, nowMs: 10 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.requestedIds, ['expired', 'old']);
  assert.deepEqual(result.plan.removeIds, ['expired', 'old']);
});

test('retention removes all revisions of an id when one revision qualifies', () => {
  const result = proposeMemoryRemoval({ journal: journal(legacy('family', 1, 1), legacy('family', 2, 10, 20)), scope,
    retention: { expired: true, beforeMs: null }, nowMs: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.plan.affectedRecords, 2);
  assert.deepEqual(result.plan.requestedIds, ['family']);
});

test('scope mismatch fails and deletion cannot remove a terminal resolution that protects pending evidence', () => {
  const unresolved = episode(1, { pending: [{ actionId: 'move-1', state: 'uncertain' }] });
  const resolved = createMemoryEpisode({ scope, grant: { scope: { ...scope, sessionId: 'session-archive' }, controlRevision: 1 },
    observation: { source: 'server', receivedAtMs: 2, revision: 2, tick: 2,
      confirmed: { self: { position: { x: 0, y: 0, z: 0 }, hp: 100, maxHp: 100, dead: false } } },
    required: { goals: { revision: 1, goals: [] }, pending: [] },
    goalFeedback: [{ actionId: 'move-1', type: 'move', state: 'confirmed', inputAck: true, effects: [], result: null }], chat: { messages: [] } });
  assert.equal(proposeMemoryRemoval({ journal: journal(unresolved), scope: { ...scope, worldId: 'other' }, ids: [unresolved.id], nowMs: 3 }).ok, false);
  assert.equal(proposeMemoryRemoval({ journal: journal(unresolved, resolved), scope, ids: [resolved.id], nowMs: 3 }).why, 'memory_pending_evidence');
  assert.equal(proposeMemoryRemoval({ journal: journal(unresolved, resolved), scope, ids: [unresolved.id], nowMs: 3 }).ok, true);
  assert.equal(proposeMemoryRemoval({ journal: journal(unresolved), scope, ids: [unresolved.id], nowMs: 3 }).why, 'memory_pending_evidence');
});

test('empty selector result is a no-op; malformed selectors fail', () => {
  const parsed = journal(legacy('keep', 1, 10));
  const noOp = proposeMemoryRemoval({ journal: parsed, scope, retention: { expired: true, beforeMs: null }, nowMs: 10 });
  assert.equal(noOp.ok, true);
  assert.deepEqual(noOp.plan.removeIds, []);
  assert.equal(noOp.plan.afterRevision, noOp.plan.beforeRevision);
  assert.equal(proposeMemoryRemoval({ journal: parsed, scope, ids: ['keep'], retention: { expired: true, beforeMs: null }, nowMs: 10 }).why, 'invalid_selector');
  assert.equal(proposeMemoryRemoval({ journal: parsed, scope, ids: ['missing'], nowMs: 10 }).why, 'memory_id_not_found');
  assert.equal(proposeMemoryRemoval({ journal: parsed, scope, retention: { expired: false, beforeMs: null }, nowMs: 10 }).why, 'invalid_retention');
  assert.equal(proposeMemoryRemoval({ journal: parsed, scope, ids: ['keep', 'keep'], nowMs: 10 }).why, 'invalid_ids');
  assert.equal(proposeMemoryRemoval({ journal: parsed, scope, ids: [], nowMs: 10 }).why, 'invalid_ids');
});

test('inspection filters text and tags, reports freshness and provenance, paginates, and detaches output', () => {
  const parsed = journal(legacy('old', 1, 1, 5), legacy('future', 1, 20), legacy('fresh', 1, 4));
  const first = inspectMemoryArchive({ journal: parsed, scope, nowMs: 5, query: 'dock', limit: 2, offset: 0 });
  assert.equal(first.total, 3);
  assert.deepEqual(first.records.map((record) => record.freshness), ['expired', 'future']);
  assert.ok(first.records.every((record) => record.provenance === 'legacy_owner_authored'));
  first.records[0].tags.push('mutated');
  assert.equal(parsed.records[0].tags.includes('mutated'), false);
  const second = inspectMemoryArchive({ journal: parsed, scope, nowMs: 5, query: 'Dock', limit: 2, offset: 2 });
  assert.deepEqual(second.records.map((record) => record.id), ['fresh']);
  assert.throws(() => inspectMemoryArchive({ journal: parsed, scope, nowMs: 5, limit: 0 }), /invalid_memory_inspection/);
});

test('archive selectors reject accessor input and preserve legacy read compatibility policy', () => {
  const parsed = journal(legacy('x', 1, 1));
  const ids = ['x']; Object.defineProperty(ids, '0', { get() { throw new Error('called'); } });
  assert.equal(proposeMemoryRemoval({ journal: parsed, scope, ids, nowMs: 1 }).why, 'invalid_request');
  const result = proposeMemoryRemoval({ journal: parsed, scope, ids: ['x'], nowMs: 1 });
  assert.equal(result.plan.migrationPolicy, 'v1_read_compatibility_no_semantic_upgrade');
  assert.equal(JSON.stringify(result).match(/owner-memory/g).length, 1);
});

test('forged projections, strange prototypes, and sparse selector arrays are rejected', () => {
  const parsed = journal(legacy('claim', 1, 1));
  const forged = structuredClone(parsed); forged.records[0].text = 'rewritten owner memory';
  assert.equal(proposeMemoryRemoval({ journal: forged, scope, ids: ['claim'], nowMs: 1 }).why, 'invalid_journal');
  const strangeScope = Object.assign(Object.create({ inherited: true }), scope);
  assert.equal(proposeMemoryRemoval({ journal: parsed, scope: strangeScope, ids: ['claim'], nowMs: 1 }).why, 'invalid_request');
  const sparseIds = []; sparseIds.length = 1;
  assert.equal(proposeMemoryRemoval({ journal: parsed, scope, ids: sparseIds, nowMs: 1 }).why, 'invalid_request');
  assert.throws(() => inspectMemoryArchive({ journal: parsed, scope, nowMs: 1, query: 'claim', limit: 1, offset: 0,
    tags: Object.assign([], { extra: true }) }), /invalid_memory_inspection/);
});
