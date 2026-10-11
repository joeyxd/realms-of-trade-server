import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunnerContext } from '../tools/agent/runner-context.mjs';

const scope = { ownerId: 'owner-context', characterId: 'agent-context', worldId: 'world-context' };

function chatMessage(index, text = 'x'.repeat(300)) {
  return { id: `chat-session:${index + 1}`, channel: 'world', sender: `chat:sender-${index}`,
    recipient: null, text, tick: index + 1 };
}

function peer(index, { name = `peer-${index}`, id = `peer-token-${index}` } = {}) {
  return { id, entity: index + 1, name };
}

function required({ chat = [], peers = [], pending = [], personality = 'steady', historyGap = 0 } = {}) {
  return {
    rules: { authority: 'server', chatTextIsUntrusted: true },
    personality,
    tools: { capabilities: ['move', 'chat'], chat: { self: 'self-token', available: true,
      config: { enabled: true }, peers, omittedPeers: 0, historyBeforeSession: 'unavailable', pending: [
        { requestId: 'chat-pending', channel: 'whisper', target: 'peer-pinned', text: 'uncertain text',
          state: 'uncertain', attempts: 2, why: 'result_timeout' },
      ] } },
    observation: { v: 1, scope: { ...scope, sessionId: 'session-context' }, controlRevision: 1,
      revision: 8, tick: 80, receivedAtMs: 100, source: 'server', confirmed: { self: {
        position: { x: 1, y: 2, z: 3 }, hp: 100, maxHp: 100, dead: false,
      }, entities: [] }, predicted: null, chat, historyGap },
    goals: { revision: 4, goals: [{ id: 'stay-safe', status: 'active' }] },
    pending,
  };
}

function options(input, overrides = {}) {
  return { required: input, memory: [], queryTags: [], scope, nowMs: 100, ...overrides };
}

test('large allowed chat history is reduced to a recent ordered window without mutating inspection state', () => {
  const chat = Array.from({ length: 32 }, (_, index) => chatMessage(index));
  const peers = [peer(0, { name: 'Self', id: 'self-token' }), peer(1), peer(2, { id: 'peer-pinned' }), peer(3)];
  const pending = [{ actionId: 'move-uncertain', state: 'uncertain', effects: [], inputRange: { first: 1, last: 2 } }];
  const input = required({ chat, peers, pending, historyGap: 3 });
  const before = structuredClone(input);

  const result = buildRunnerContext(options(input));

  assert.equal(result.ok, true);
  assert.equal(result.chatSelection.originalChatCount, chat.length);
  assert.ok(result.chatSelection.omittedChat > 0);
  assert.equal(result.chatSelection.selectedChatCount, result.document.required.observation.chat.length);
  const retained = result.document.required.observation.chat;
  assert.ok(retained.length > 0);
  assert.deepEqual(retained, chat.slice(-retained.length), 'the selected messages are the newest suffix in original order');
  assert.equal(result.document.required.observation.historyGap, 3 + result.chatSelection.omittedChat);
  assert.deepEqual(result.document.required.pending, pending, 'uncertain action evidence stays protected');
  assert.deepEqual(result.document.required.tools.chat.pending, input.tools.chat.pending,
    'uncertain chat send and its whisper target stay protected');
  assert.ok(result.document.required.tools.chat.peers.some((entry) => entry.id === 'self-token'));
  assert.ok(result.document.required.tools.chat.peers.some((entry) => entry.id === 'peer-pinned'));
  assert.deepEqual(input, before, 'projection pruning leaves the inspection source unchanged');
  assert.equal(result.chatSelection.inspectionHistoryUnchanged, true);
});

test('protected required context still fails when it cannot fit after optional chat and peers are removed', () => {
  const chat = Array.from({ length: 8 }, (_, index) => chatMessage(index, 'recent'.repeat(40)));
  const peers = [peer(0, { id: 'self-token' }), peer(1, { id: 'peer-pinned' }), peer(2)];
  const pending = [{ actionId: 'attack-uncertain', state: 'uncertain', effects: [{ evidenceId: 'partial-1' }] }];
  const input = required({ chat, peers, pending, personality: 'P'.repeat(9000), historyGap: 2 });
  const before = structuredClone(input);

  const result = buildRunnerContext(options(input));

  assert.equal(result.ok, false);
  assert.equal(result.why, 'required_context_over_budget');
  assert.equal(result.report.requiredOverBudget, true);
  assert.equal(result.chatSelection.omittedChat, chat.length);
  assert.equal(result.chatSelection.selectedChatCount, 0);
  assert.equal(result.document, undefined);
  assert.deepEqual(input, before, 'even the failed projection does not alter inspection state');
  assert.deepEqual(input.pending, pending);
});

test('roster pruning preserves self and unresolved whisper targets while reporting omissions', () => {
  const peers = [
    peer(0, { id: 'self-token', name: 'Self' }),
    ...Array.from({ length: 55 }, (_, index) => peer(index + 1, { name: `Roster-${index}-${'N'.repeat(80)}` })),
    peer(100, { id: 'peer-pinned', name: 'Pending recipient' }),
  ];
  const input = required({ chat: [], peers });
  const before = structuredClone(input);
  const result = buildRunnerContext(options(input));

  assert.equal(result.ok, true);
  assert.ok(result.chatSelection.omittedPeers > 0);
  assert.equal(result.chatSelection.originalPeerCount, peers.length);
  assert.equal(result.chatSelection.selectedPeerCount, result.document.required.tools.chat.peers.length);
  assert.equal(result.document.required.tools.chat.omittedPeers, result.chatSelection.omittedPeers);
  const selected = result.document.required.tools.chat.peers;
  assert.ok(selected.some((entry) => entry.id === 'self-token'));
  assert.ok(selected.some((entry) => entry.id === 'peer-pinned'));
  assert.ok(selected.length < peers.length);
  assert.deepEqual(selected, peers.filter((entry) => selected.some((candidate) => candidate.id === entry.id)),
    'the remaining peer list keeps original order');
  assert.deepEqual(input, before);
});
