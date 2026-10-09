import test from 'node:test';
import assert from 'node:assert/strict';
import { retrievePersistentMemory } from '../tools/agent/memory-retrieval.mjs';

const scope = { ownerId: 'owner', characterId: 'agent', worldId: 'world' };
function record(id, overrides = {}) {
  return { id, revision: 1, scope: { ...scope }, text: id, certainty: 'confirmed', createdAtMs: 10,
    validUntilMs: null, tags: [], sources: [{ id: `source-${id}`, tick: 10 }], ...overrides };
}
const journal = (records, entries = []) => ({ records, entries });

test('retrieves a relevant old record beyond the former append-window while ranking it first', () => {
  const records = [record('old', { text: 'The captain hid the silver compass', createdAtMs: 1 })];
  for (let index = 0; index < 2105; index++) records.push(record(`recent-${index}`, { text: `unrelated recent note ${index}`, createdAtMs: 1000 + index }));
  const result = retrievePersistentMemory({ journal: journal(records), scope, nowMs: 5000, queryText: 'silver compass', maxCandidates: 4 });
  assert.equal(result.report.scanned, 2106);
  assert.equal(result.report.historyTruncated, false);
  assert.equal(result.records[0].id, 'old');
  assert.equal(result.report.selectedIds.length, 4);
});

test('matches query text and exact tags, with Unicode accent folding for Spanish', () => {
  const records = [
    record('goal', { text: 'Defender el puerto', tags: ['objetivo:puerto'] }),
    record('other', { text: 'El capitan encontro informacion en la bahia' }),
    record('unrelated', { text: 'madera y piedra' }),
  ];
  const tagged = retrievePersistentMemory({ journal: journal(records), scope, nowMs: 100, queryTags: ['objetivo:puerto'], maxCandidates: 3 });
  assert.equal(tagged.records[0].id, 'goal');
  const accented = retrievePersistentMemory({ journal: journal(records), scope, nowMs: 100, queryText: 'capitán información bahía', maxCandidates: 2 });
  assert.equal(accented.records[0].id, 'other');
  assert.deepEqual(accented.report.queryTerms, ['capitan', 'informacion', 'bahia']);
});

test('keeps conflicting facts and uncertain variants as separate source records', () => {
  const records = [
    record('fact-a', { text: 'El cofre está en la playa', certainty: 'confirmed' }),
    record('fact-b', { text: 'El cofre está en la cueva', certainty: 'confirmed' }),
    record('uncertain', { text: 'El cofre podría estar en la playa', certainty: 'uncertain' }),
  ];
  const result = retrievePersistentMemory({ journal: journal(records), scope, nowMs: 100, queryText: 'cofre playa cueva', maxCandidates: 8 });
  assert.deepEqual(new Set(result.records.map((entry) => entry.id)), new Set(['fact-a', 'fact-b', 'uncertain']));
  result.records[0].sources[0].id = 'changed';
  assert.equal(records[0].sources[0].id, 'source-fact-a', 'outputs are detached');
});

test('when exact duplicate facts are capped, retains the earliest-expiring copy first', () => {
  const records = [
    record('later-expiry', { text: 'The island has a lighthouse', validUntilMs: 900, createdAtMs: 90 }),
    record('earlier-expiry', { text: 'The island has a lighthouse', validUntilMs: 400, createdAtMs: 20 }),
  ];
  const result = retrievePersistentMemory({ journal: journal(records), scope, nowMs: 100, queryText: 'lighthouse', maxCandidates: 1 });
  assert.equal(result.records[0].id, 'earlier-expiry');
});

test('an expired highest revision cannot resurrect an older valid revision', () => {
  const records = [
    record('stable-id', { revision: 1, text: 'The old warehouse is north', createdAtMs: 10, validUntilMs: null }),
    record('stable-id', { revision: 2, text: 'The warehouse is permanently closed', createdAtMs: 20, validUntilMs: 50 }),
  ];
  const result = retrievePersistentMemory({ journal: journal(records), scope, nowMs: 50, queryText: 'warehouse north', maxCandidates: 4 });
  assert.deepEqual(result.records, []);
  assert.equal(result.report.expired, 1);
  assert.equal(result.report.eligible, 0);
});

test('a burst of identical uncertain notes is capped and cannot crowd distinct relevant facts', () => {
  const records = Array.from({ length: 40 }, (_, index) => record(`uncertain-${index}`, {
    text: 'The reef may hide a cave', certainty: 'uncertain', createdAtMs: 100 + index,
  }));
  records.push(record('distinct', { text: 'The reef may hide a treasure', certainty: 'uncertain', createdAtMs: 50 }));
  const result = retrievePersistentMemory({ journal: journal(records), scope, nowMs: 200, queryText: 'reef may hide', maxCandidates: 8 });
  assert.ok(result.records.some((item) => item.id === 'distinct'));
  assert.ok(result.records.filter((item) => item.text === 'The reef may hide a cave').length <= 2);
});

test('excludes expired, future and foreign-scope records', () => {
  const foreign = record('foreign', { scope: { ...scope, worldId: 'other' } });
  const input = [record('expired', { validUntilMs: 10 }), record('future', { createdAtMs: 101 }), foreign, record('valid')];
  const result = retrievePersistentMemory({ journal: journal(input), scope, nowMs: 10, queryText: 'valid', maxCandidates: 4 });
  assert.deepEqual(result.records.map((entry) => entry.id), ['valid']);
  assert.equal(result.report.expired, 1);
  assert.equal(result.report.future, 1);
  assert.equal(result.report.scopeMismatch, 1);
});

test('a matching summary may stand in for covered episodes but never removes journal originals', () => {
  const episode = record('episode:one', { text: 'Episode source: hidden pearl at north cove', createdAtMs: 20, sources: [{ id: 'episode:one', tick: 8 }] });
  const summary = record('summary:one', { text: 'The hidden pearl is at north cove', tags: ['pearl'], createdAtMs: 30, sources: [{ id: 'episode:one', tick: null }] });
  const entries = [{ id: 'summary:one', kind: 'summary', payload: { sources: [{ id: 'episode:one' }] } }];
  const result = retrievePersistentMemory({ journal: journal([episode, summary], entries), scope, nowMs: 50, queryText: 'hidden pearl north cove', maxCandidates: 4 });
  assert.deepEqual(result.records.map((entry) => entry.id), ['summary:one']);
  assert.deepEqual(result.report.suppressedBySummary, ['episode:one']);
  assert.equal(journal([episode, summary], entries).records.length, 2);
});

test('bounded output remains stable as append history grows and validates limits', () => {
  const records = Array.from({ length: 500 }, (_, index) => record(`r-${index}`, { text: index < 20 ? `shared word unique${index}` : 'routine note', createdAtMs: index }));
  const run = () => retrievePersistentMemory({ journal: journal(records), scope, nowMs: 1000, queryText: 'shared word', maxCandidates: 12 });
  const first = run(), second = run();
  assert.deepEqual(first.report.selectedIds, second.report.selectedIds);
  assert.equal(first.records.length, 12);
  assert.throws(() => retrievePersistentMemory({ journal: journal(records), scope, nowMs: 1, maxCandidates: 129 }), RangeError);
  assert.throws(() => retrievePersistentMemory({ journal: journal(records), scope: { ...scope, extra: 'x' }, nowMs: 1 }), TypeError);
  assert.throws(() => retrievePersistentMemory({ journal: journal(records), scope, nowMs: 1, queryText: 'x'.repeat(8001) }), TypeError);
});
