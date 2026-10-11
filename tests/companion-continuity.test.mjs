import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '../tools/agent/contract.mjs';
import { createMemoryEpisode, createMemorySummary, parseMemoryJournal } from '../tools/agent/memory-journal.mjs';
import { automaticSummaryRemaining, automaticSummarySources, continuationCue, LOCAL_CONTEXT_LIMITS,
  measuredContinuityContext, sameCapture, summaryCandidates } from '../tools/agent/companion-continuity.mjs';

const scope = { ownerId: 'continuity-owner', characterId: 'continuity-agent', worldId: 'continuity-world' };
const sessionId = 'continuity-session';
const makeEpisode = (n, { chatText = `Message ${n}`, pending = [], goalRevision = n, session = sessionId, largeFeedback = false } = {}) =>
  createMemoryEpisode({ scope, grant: { scope: { ...scope, sessionId: session }, controlRevision: 1 },
    observation: { source: 'server', receivedAtMs: 1000 + n, revision: n, tick: n,
      confirmed: { self: { position: { x: n, y: 0, z: 0 }, hp: 90, maxHp: 100, dead: false } } },
    required: { goals: { revision: goalRevision, goals: [{ id: 'goal-home', status: 'active', text: 'Return home' }] }, pending },
    goalFeedback: largeFeedback ? Array.from({ length: 8 }, (_, i) => ({ actionId: `action-${n}-${i}`, type: 'move', state: 'confirmed',
      inputAck: true, effects: Array.from({ length: 3 }, (_, j) => ({ evidenceId: `evidence-${n}-${i}-${j}`, tick: n,
        source: 'server', outcome: 'confirmed', code: 'move', effect: 'z'.repeat(1050) })), result: null })) : [],
    chat: { messages: [{ id: `chat-${n}`, channel: 'world', sender: { id: 'peer-1' }, text: chatText, tick: n }] } });
const redate = (entry, createdAtMs, validUntilMs) => {
  const { id, sha256, ...unsigned } = { ...entry, createdAtMs, validUntilMs };
  const digest = createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  return { ...unsigned, id: `${entry.kind}:${digest}`, sha256: digest };
};
const journalOf = (...entries) => parseMemoryJournal(entries.length ? `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n` : '', scope);
const snapshotOf = (journal, overrides = {}) => ({ scope, grant: { scope: { ...scope, sessionId }, controlRevision: 1 },
  memoryJournal: journal, ...overrides });
const captureSnapshot = (episode, overrides = {}) => ({ grant: { scope: { ...scope, sessionId }, controlRevision: 1 },
  observation: { confirmed: { self: { ...episode.payload.observation.self,
    position: { ...episode.payload.observation.self.position } } } },
  chat: { messages: episode.payload.chat.map(message => ({ ...message })) }, required: { goals: { revision: episode.payload.goals.revision,
    goals: episode.payload.goals.items.map(goal => ({ ...goal })) }, pending: episode.payload.pending.map(row => ({ ...row })) },
  goalFeedback: [], ...overrides });

test('summary candidates use valid episodes, mark covered sources, and choose a source-byte-bounded recent suffix', () => {
  const largeText = 'Dock report '.repeat(75);
  const episodes = Array.from({ length: 8 }, (_, i) => makeEpisode(i + 1, { chatText: largeText }));
  const expired = redate(makeEpisode(20), 1020, 1021);
  const summaryTurn = { sources: [episodes[0]] };
  const summary = createMemorySummary({ type: 'summarize_memory', args: { text: 'A dock report was recorded.', tags: [], basis: [episodes[0].id] } },
    summaryTurn, scope, 1030).entry;
  const journal = journalOf(...episodes, expired, summary);
  const candidates = summaryCandidates(journal, 1030);
  assert.equal(candidates.some(candidate => candidate.id === expired.id), false);
  assert.equal(candidates.find(candidate => candidate.id === episodes[0].id).summarized, true);
  const snapshot = snapshotOf(journal);
  const chosen = automaticSummarySources(snapshot, 1030);
  assert.ok(chosen.length >= 2 && chosen.length <= 8);
  assert.deepEqual(chosen, episodes.filter(e => !summary.payload.sources.some(source => source.id === e.id))
    .map(e => e.id).slice(-chosen.length));
  assert.ok(Buffer.byteLength(JSON.stringify({ sources: chosen.map(id => journal.entries.find(e => e.id === id)) }), 'utf8') < 16000);
  assert.equal(automaticSummarySources(snapshot, 1021).includes(expired.id), false);
});

test('automatic summary declines a single candidate and any pair exceeding the hard source-turn cap', () => {
  const one = makeEpisode(1, { chatText: 'x'.repeat(900) });
  assert.deepEqual(automaticSummarySources(snapshotOf(journalOf(one)), 1010), []);
  const huge = Array.from({ length: 2 }, (_, i) => makeEpisode(i + 2, { largeFeedback: true }));
  const journal = journalOf(...huge);
  assert.deepEqual(automaticSummarySources(snapshotOf(journal), 1010), []);
});

test('context pressure measures full reserved total including output and margin, while mandatory overflow suppresses automation', () => {
  const limit = LOCAL_CONTEXT_LIMITS.maxContextTokens;
  const below = measuredContinuityContext({ inputTokens: limit - 700, totalReservedContextTokens: Math.floor(limit * 0.79),
    transmittedBytes: 1000, countMode: 'measured_tokens' });
  assert.equal(below.pressure, false);
  const above = measuredContinuityContext({ inputTokens: 51000, totalReservedContextTokens: Math.ceil(limit * 0.81),
    transmittedBytes: 1000, countMode: 'measured_tokens' });
  assert.equal(above.pressure, true);
  assert.equal(above.outputReserveTokens, 512);
  assert.equal(above.marginTokens, 256);
  assert.equal(measuredContinuityContext({ inputTokens: 100, totalReservedContextTokens: 100,
    transmittedBytes: Math.ceil(LOCAL_CONTEXT_LIMITS.maxInputBytes * 0.81), countMode: 'measured_tokens' }).pressure, true);
  assert.equal(measuredContinuityContext({ inputTokens: 100, totalReservedContextTokens: 100, transmittedBytes: 100,
    countMode: 'measured_tokens', skipped: { optional_over_budget: 1 } }).pressure, true);
  const mandatory = measuredContinuityContext({ inputTokens: limit, totalReservedContextTokens: limit + 768,
    transmittedBytes: 65536, countMode: 'measured_tokens', requiredOverBudget: true });
  assert.equal(mandatory.pressure, false);
  assert.equal(mandatory.requiredOverBudget, true);
  assert.equal(measuredContinuityContext({ inputTokens: null, totalReservedContextTokens: null, transmittedBytes: null }).measurement, 'unavailable');
});

test('sameCapture deduplicates only identical session, chat, goals, and pending state', () => {
  const episode = makeEpisode(1);
  const journal = journalOf(episode);
  const original = captureSnapshot(episode);
  assert.equal(sameCapture(journal, original).id, episode.id);
  assert.equal(sameCapture(journal, captureSnapshot(episode, { grant: { scope: { ...scope, sessionId: 'new-session' } } })), null);
  assert.equal(sameCapture(journal, captureSnapshot(episode, { chat: { messages: [{ id: 'changed-chat' }] } })), null);
  assert.equal(sameCapture(journal, captureSnapshot(episode, { required: { goals: { revision: 99,
    goals: episode.payload.goals.items.map(goal => ({ ...goal })) }, pending: [] } })), null);
  assert.equal(sameCapture(journal, captureSnapshot(episode, { required: { goals: { revision: episode.payload.goals.revision,
    goals: [{ ...episode.payload.goals.items[0], text: 'Owner edited this goal without changing its revision' }] }, pending: [] } })), null);
  assert.equal(sameCapture(journal, captureSnapshot(episode, { observation: { confirmed: { self: { ...episode.payload.observation.self,
    position: { ...episode.payload.observation.self.position, x: 77 } } } } })), null);
  assert.equal(sameCapture(journal, captureSnapshot(episode, { observation: { confirmed: { self: { ...episode.payload.observation.self, hp: 1 } } } })), null);
  assert.equal(sameCapture(journal, captureSnapshot(episode, { required: { goals: { revision: 1,
    goals: episode.payload.goals.items.map(goal => ({ ...goal })) }, pending: [{ actionId: 'pending-1', state: 'uncertain' }] } })), null);
  assert.equal(sameCapture(journal, captureSnapshot(episode, { goalFeedback: [{ actionId: 'resolved-later' }] })), null);
  assert.equal(sameCapture(journalOf(), original), null);
});

test('one compaction admission is retained across restart states and cancellation releases it', () => {
  assert.equal(automaticSummaryRemaining({ entries: [] }), 1);
  for (const state of ['reserved', 'inflight', 'unknown', 'settled']) {
    assert.equal(automaticSummaryRemaining({ entries: [{ kind: 'compaction', state }] }), 0, state);
  }
  assert.equal(automaticSummaryRemaining({ entries: [{ kind: 'decision', state: 'settled' }, { kind: 'compaction', state: 'cancelled' }] }), 1);
  assert.equal(automaticSummaryRemaining({ entries: [{ kind: 'compaction', state: 'cancelled' }, { kind: 'compaction', state: 'unknown' }] }), 0);
});

test('continuation cue exposes only unexpired historical sources and explicitly forbids reusing old orders', () => {
  const older = redate(makeEpisode(1), 1001, 1099);
  const current = redate(makeEpisode(2), 1002, 1500);
  const expiring = redate(makeEpisode(3), 1003, 1100);
  const summary = createMemorySummary({ type: 'summarize_memory', args: { text: 'A home goal was active.', tags: ['goal-home'], basis: [current.id] } },
    { sources: [current] }, scope, 1010).entry;
  const journal = journalOf(older, current, expiring, summary);
  const cue = continuationCue(journal, 1100);
  assert.equal(cue.source, 'local_historical_memory');
  assert.equal(cue.untrusted, true);
  assert.equal(cue.revalidateCurrentState, true);
  assert.equal(cue.resumeOrders, false);
  assert.equal(cue.latestEpisode.id, current.id);
  assert.equal(cue.latestSummary.id, summary.id);
  assert.equal(continuationCue(journal, 2000).latestEpisode, null);
  assert.equal(continuationCue(journal, 2000).latestSummary, null);
});
