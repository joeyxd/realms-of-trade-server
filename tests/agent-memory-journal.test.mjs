import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryEpisode, buildMemoryTurn, createMemorySummary, parseMemoryJournal } from '../tools/agent/memory-journal.mjs';

const scope = { ownerId: 'owner-memory', characterId: 'agent-memory', worldId: 'world-memory' };
const grant = { scope: { ...scope, sessionId: 'session-memory' }, controlRevision: 3 };
const goals = { revision: 2, goals: [{ id: 'goal-home', status: 'active', text: 'Reach home' }] };
const observation = (overrides = {}) => ({ receivedAtMs: 1000, revision: 4, tick: 20,
  confirmed: { self: { position: { x: 1, y: 2, z: 3 }, hp: 80, maxHp: 100, dead: false } }, ...overrides });
const snapshot = (overrides = {}) => ({ scope, grant, observation: observation(), required: { goals, pending: [] },
  goalFeedback: [], chat: { messages: [] }, ...overrides });
const jsonl = (...entries) => `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
const feedback = (state = 'confirmed') => ({ id: 'action:move-1', kind: 'action', actionId: 'move-1', type: 'move', state,
  inputAck: true, effects: [], result: null, body: null, navigation: null,
  interpretation: 'ACK is receipt only; partial effects and absent targets do not prove an encounter completed' });

test('episodes preserve uncertainty and actual delivered chat shape across reentry', () => {
  const entry = createMemoryEpisode(snapshot({ observation: observation({ source: 'server' }), goalFeedback: [feedback('uncertain')],
    chat: { messages: [{ id: 'chat:1', requestId: 'req-1', channel: 'whisper', sender: { id: 'player-7', name: 'Player' },
      target: { id: 'agent-memory', name: 'Agent' }, text: 'Meet at the dock', tick: 20 }] } }));
  const loaded = parseMemoryJournal(jsonl(entry), scope);
  assert.equal(loaded.records[0].certainty, 'uncertain');
  assert.match(loaded.entries[0].payload.chat[0].speaker, /^peer:[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(loaded).includes('player-7'), false);
  assert.equal(JSON.stringify(loaded), JSON.stringify(parseMemoryJournal(jsonl(entry), scope)));
  assert.equal(JSON.stringify(loaded.entries[0].payload.chat).includes('target'), false);
});

test('fixture observations and unresolved feedback cannot become confirmed memories', () => {
  assert.throws(() => createMemoryEpisode(snapshot({ observation: observation({ source: 'fixture' }) })), /memory_requires_server_observation/);
  const entry = createMemoryEpisode(snapshot({ observation: observation({ source: 'server' }), goalFeedback: [feedback('uncertain')] }));
  assert.equal(parseMemoryJournal(jsonl(entry), scope).records[0].certainty, 'uncertain');
});

test('legacy owner records are scope checked and never promoted to authenticated receipts', () => {
  const legacy = { id: 'owner-claim', revision: 1, scope, text: 'I defeated the captain', certainty: 'confirmed',
    createdAtMs: 10, validUntilMs: null, tags: [], sources: [{ id: 'invented-server-receipt', tick: 9 }] };
  const loaded = parseMemoryJournal(jsonl(legacy), scope);
  assert.equal(loaded.records[0].certainty, 'uncertain');
  assert.throws(() => parseMemoryJournal(jsonl({ ...legacy, scope: { ...scope, worldId: 'other-world' } }), scope), /scope_mismatch|invalid_memory_record/);
});

test('journal rejects duplicate episode ids, duplicate legacy revision collisions, and content tampering', () => {
  const episode = createMemoryEpisode(snapshot({ observation: observation({ source: 'server' }) }));
  assert.throws(() => parseMemoryJournal(jsonl(episode, episode), scope), /invalid_memory_provenance/);
  const legacy = { id: 'claim', revision: 1, scope, text: 'First claim', certainty: 'uncertain', createdAtMs: 1,
    validUntilMs: null, tags: [], sources: [] };
  assert.throws(() => parseMemoryJournal(jsonl(legacy, { ...legacy, text: 'Second claim' }), scope), /memory_revision_collision/);
  assert.throws(() => parseMemoryJournal(jsonl({ ...episode, payload: { ...episode.payload, sessionId: 'tampered' } }), scope), /invalid_memory_provenance/);
});

test('summary creation and parsing enforce source refs, hashes, scope, and time', () => {
  const episode = createMemoryEpisode(snapshot({ observation: observation({ source: 'server' }) }));
  const parsed = parseMemoryJournal(jsonl(episode), scope);
  const turn = buildMemoryTurn({ memoryJournal: parsed }, [episode.id], 1000);
  assert.equal(turn.ok, true);
  const result = createMemorySummary({ type: 'summarize_memory', args: { text: 'The agent reached the dock.', tags: ['goal-home'], basis: [episode.id] } }, turn.turn, scope, 1100);
  assert.equal(result.ok, true);
  assert.equal(parseMemoryJournal(jsonl(episode, result.entry), scope).report.summaries, 1);
  assert.throws(() => parseMemoryJournal(jsonl(episode, { ...result.entry, payload: { ...result.entry.payload, text: 'Forged summary' } }), scope), /invalid_memory_provenance/);
  assert.equal(buildMemoryTurn({ memoryJournal: parsed }, [episode.id], 900).why, 'memory_source_unavailable');
  assert.equal(createMemorySummary({ type: 'summarize_memory', args: { text: 'Too early', tags: [], basis: [episode.id] } }, turn.turn, scope, 900).ok, false);
  assert.equal(createMemorySummary({ type: 'summarize_memory', args: { text: 'Wrong scope', tags: [], basis: [episode.id] } }, turn.turn,
    { ...scope, worldId: 'other-world' }, 1100).ok, false);
});

test('summary cannot invent retrieval tags and pending capture fails explicitly without dropping uncertainty', () => {
  const episode = createMemoryEpisode(snapshot({ observation: observation({ source: 'server' }) }));
  const turn = buildMemoryTurn({ memoryJournal: parseMemoryJournal(jsonl(episode), scope) }, [episode.id], 1100).turn;
  assert.equal(createMemorySummary({ type: 'summarize_memory', args: { text: 'Unrelated claim', tags: ['invented-goal'], basis: [episode.id] } }, turn, scope, 1100).ok, false);
  const pending = Array.from({ length: 65 }, (_, i) => ({ actionId: `pending-${i}`, state: 'uncertain' }));
  assert.throws(() => createMemoryEpisode(snapshot({ observation: observation({ source: 'server' }), required: { goals, pending } })), /memory_pending_capacity/);
});

test('episode projection is bounded and reports omitted history', () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({ id: `chat:${i}`, requestId: `request:${i}`, channel: 'world',
    sender: { id: `player-${i}`, name: `Player ${i}` }, text: `Hello ${i}`, tick: 20 + i }));
  const actions = Array.from({ length: 20 }, (_, i) => ({ ...feedback('confirmed'), actionId: `move-${i}` }));
  const entry = createMemoryEpisode(snapshot({ observation: observation({ source: 'server' }), goalFeedback: actions,
    chat: { messages } }));
  assert.equal(entry.payload.feedback.length, 8);
  assert.equal(entry.payload.chat.length, 4);
  assert.deepEqual(entry.payload.omitted, { goals: 0, feedback: 12, chat: 6 });
  assert.ok(Buffer.byteLength(JSON.stringify(entry), 'utf8') <= 32000);
});
