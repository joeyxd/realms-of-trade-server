import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationPolicy } from '../tools/agent/conversation.mjs';

const scope = { ownerId: 'owner-1', characterId: 'self-1', worldId: 'world-1', sessionId: 'session-1' };
const peer = { id: 'peer-1', entity: 7, name: 'Sailor' };
const SELF_CHAT = 'chat:self-token';

function snapshot({ channel = 'local', id = 'server:1', text = 'Hola tripulación', tick = 40,
  senderId = peer.id, targetId = null, peers = [
    { id: 'self-1', entity: 2, name: 'Brisa' }, peer,
  ], requests = [], capabilities = ['move', 'chat'], enabled = true, available = true,
  observationChat = null, observationTick = 42, sessionId = scope.sessionId } = {}) {
  const activeScope = { ...scope, sessionId };
  const sender = senderId === SELF_CHAT ? scope.characterId : `chat:${senderId}`;
  const recipient = targetId === null ? null : targetId === SELF_CHAT ? scope.characterId : `chat:${targetId}`;
  const message = { id, channel, requestId: 'incoming-1', sender: { id: senderId, entity: 7, name: 'Sailor' }, text, tick,
    ...(targetId === null ? {} : { target: { id: targetId, entity: targetId === SELF_CHAT ? 2 : 9, name: 'Recipient' } }) };
  const projected = { id, channel, sender, recipient, text, tick };
  return {
    state: 'ready', scope: activeScope,
    grant: { v: 1, scope: activeScope, controlRevision: 3, expiresAtMs: 100000, capabilities },
    observation: { scope: activeScope, controlRevision: 3, revision: 12, tick: observationTick,
      receivedAtMs: 2000, chat: observationChat ?? [projected] },
    chat: { available, self: SELF_CHAT, config: { enabled, maxLength: 300 }, peers: [
      { id: SELF_CHAT, entity: 2, name: 'Brisa' }, ...peers.filter((p) => p.id !== SELF_CHAT),
    ], messages: [message], requests,
      pendingId: null, historyGap: 0, durability: 'session_only' },
  };
}

test('defaults accept delivered local messages and return immutable, detached admitted turns', () => {
  const policy = new ConversationPolicy();
  const world = snapshot({ channel: 'world' });
  assert.equal(policy.begin(world, 'server:1', 3000).why, 'channel_disabled');
  const view = snapshot();
  const result = policy.begin(view, 'server:1', 3000);
  assert.equal(result.ok, true);
  assert.deepEqual(result.turn, { v: 1, messageId: 'server:1', channel: 'local',
    source: { id: 'server:1', channel: 'local', sender: 'chat:peer-1', recipient: null, text: 'Hola tripulación', tick: 40 },
    target: null, scope, controlRevision: 3 });
  result.turn.source.text = 'tampered';
  const state = policy.state;
  state.entries[0].source.text = 'also tampered';
  state.policy.channels.push('world');
  assert.equal(policy.state.entries[0].source.text, 'Hola tripulación');
  assert.equal(policy.state.policy.channels.includes('world'), false);
  assert.equal(policy.begin(view, 'server:1', 3001).why, 'reply_already_attempted');
  assert.equal(policy.revalidate(policy.state.entries[0], view, 3000).why, 'invalid_turn');
  assert.equal(policy.revalidate({ ...result.turn, source: { ...result.turn.source, text: 'forged' } }, view, 3000).why,
    'turn_not_admitted');
});

test('world replies require explicit channel opt-in and whisper replies target the current sender', () => {
  const worldPolicy = new ConversationPolicy({ policy: { channels: ['local', 'whisper', 'world'] } });
  assert.equal(worldPolicy.begin(snapshot({ channel: 'world' }), 'server:1', 3000).ok, true);
  const whisper = snapshot({ channel: 'whisper', id: 'server:2', targetId: SELF_CHAT });
  const turn = new ConversationPolicy().begin(whisper, 'server:2', 3000);
  assert.equal(turn.ok, true);
  assert.equal(turn.turn.target, 'peer-1');
  assert.equal(turn.turn.source.recipient, scope.characterId);
  assert.equal(new ConversationPolicy().begin(snapshot({ channel: 'whisper', targetId: 'peer-1' }), 'server:1', 3000).why,
    'whisper_not_addressed_to_self');
});

test('fails closed for unavailable chat, disabled capability, pending requests, or a blocked peer', () => {
  const policy = new ConversationPolicy({ policy: { blockedPeers: ['peer-1'] } });
  assert.equal(policy.begin(snapshot({ available: false }), 'server:1', 3000).why, 'chat_not_ready');
  assert.equal(policy.begin(snapshot({ enabled: false }), 'server:1', 3000).why, 'chat_not_ready');
  assert.equal(policy.begin(snapshot({ capabilities: ['move'] }), 'server:1', 3000).why, 'chat_forbidden');
  assert.equal(policy.begin(snapshot({ requests: [{ state: 'uncertain' }] }), 'server:1', 3000).why, 'chat_pending');
  assert.equal(policy.begin(snapshot(), 'server:1', 3000).why, 'peer_blocked');
  assert.equal(policy.state.counts.turns, 0);
});

test('source must match the canonical delivered observation and a current non-self peer', () => {
  const policy = new ConversationPolicy({ policy: { cooldownMs: 0 } });
  assert.equal(policy.begin(snapshot({ observationChat: [] }), 'server:1', 3000).why, 'source_projection_mismatch');
  assert.equal(policy.begin(snapshot({ peers: [{ id: 'self-1', entity: 2, name: 'Brisa' }] }), 'server:1', 3000).why,
    'peer_unavailable');
  assert.equal(policy.begin(snapshot({ senderId: SELF_CHAT }), 'server:1', 3000).why, 'self_message');
  assert.equal(policy.begin(snapshot({ targetId: 'peer-1', channel: 'local' }), 'server:1', 3000).why,
    'invalid_recipient');
});

test('message age rejects future and stale ticks', () => {
  const policy = new ConversationPolicy({ policy: { maxMessageAgeTicks: 2 } });
  assert.equal(policy.begin(snapshot({ tick: 39, observationTick: 42 }), 'server:1', 3000).why, 'source_too_old');
  assert.equal(policy.begin(snapshot({ tick: 43, observationTick: 42 }), 'server:1', 3000).why, 'source_from_future');
  assert.equal(policy.state.counts.turns, 0);
});

test('revalidation catches delivered source changes, disappearance, and lost current peer', () => {
  const policy = new ConversationPolicy({ policy: { cooldownMs: 0 } });
  const original = snapshot();
  const { turn } = policy.begin(original, 'server:1', 3000);
  const revalidated = policy.revalidate(turn, original, 3001);
  assert.equal(revalidated.ok, true, JSON.stringify({ revalidated, admitted: policy.state.entries[0], turn }));
  assert.equal(policy.revalidate(turn, snapshot({ text: 'texto editado' }), 3001).why, 'source_changed');
  assert.equal(policy.revalidate(turn, snapshot({ peers: [{ id: 'self-1', entity: 2, name: 'Brisa' }] }), 3001).why,
    'peer_unavailable');
  assert.equal(policy.revalidate(turn, snapshot({ id: 'server:2' }), 3001).why, 'source_missing');
  assert.equal(policy.revalidate(turn, snapshot({ sessionId: 'session-2' }), 3001).why, 'scope_or_epoch_changed');
});

test('attempt, total, per-peer, and cooldown bounds persist across changed session snapshots', () => {
  const policy = new ConversationPolicy({ policy: { maxTurns: 2, maxRepliesPerPeer: 2, cooldownMs: 100 } });
  assert.equal(policy.begin(snapshot(), 'server:1', 3000).ok, true);
  assert.equal(policy.begin(snapshot({ id: 'server:2', sessionId: 'session-2' }), 'server:2', 3050).why, 'cooldown');
  assert.equal(policy.begin(snapshot({ id: 'server:2', sessionId: 'session-2' }), 'server:2', 3100).ok, true);
  assert.equal(policy.begin(snapshot({ id: 'server:3', sessionId: 'session-3' }), 'server:3', 3200).why, 'conversation_capacity');
  assert.equal(policy.state.counts.turns, 2);

  const peerLimited = new ConversationPolicy({ policy: { maxRepliesPerPeer: 1, cooldownMs: 0 } });
  peerLimited.begin(snapshot(), 'server:1', 3000);
  assert.equal(peerLimited.begin(snapshot({ id: 'server:2', sessionId: 'session-2' }), 'server:2', 3001).why,
    'peer_reply_limit');
});

test('policy and request validation reject unsafe or unbounded inputs', () => {
  assert.throws(() => new ConversationPolicy({ policy: Object.assign(Object.create(null), { channels: ['local'] }) }));
  assert.throws(() => new ConversationPolicy({ policy: { channels: ['world', 'world'] } }));
  assert.throws(() => new ConversationPolicy({ policy: { maxTurns: 257 } }));
  assert.throws(() => new ConversationPolicy({ policy: { blockedPeers: ['x'.repeat(101)] } }));
  const policy = new ConversationPolicy();
  assert.equal(policy.begin(null, 'server:1', 3000).why, 'invalid_snapshot');
  assert.equal(policy.begin(snapshot(), 'bad/id', 3000).why, 'invalid_request');
  assert.equal(policy.begin(snapshot(), 'server:1', -1).why, 'invalid_request');
});

test('C01 raw request, normalized text, permissions, expiry, and self-token mapping are verified', () => {
  const policy = new ConversationPolicy({ policy: { cooldownMs: 0 } });
  const badRequest = snapshot();
  badRequest.chat.messages[0].requestId = 'unsafe/id';
  assert.equal(policy.begin(badRequest, 'server:1', 3000).why, 'invalid_source');
  const badText = snapshot({ text: 'Hola  tripulación' });
  assert.equal(policy.begin(badText, 'server:1', 3000).why, 'invalid_source_text');
  assert.equal(policy.begin(snapshot({ capabilities: ['move'], }), 'server:1', 3000).why, 'chat_forbidden');
  const expired = snapshot(); expired.grant.expiresAtMs = 3000;
  assert.equal(policy.begin(expired, 'server:1', 3000).why, 'authorization_expired');
  const refMismatch = snapshot();
  refMismatch.observation.confirmed = { self: { ref: { entityId: 99 } } };
  assert.equal(policy.begin(refMismatch, 'server:1', 3000).why, 'self_peer_mismatch');
  const duplicate = snapshot(); duplicate.chat.messages.push({ ...duplicate.chat.messages[0] });
  assert.equal(policy.begin(duplicate, 'server:1', 3000).why, 'chat_not_ready');
  const duplicateProjection = snapshot(); duplicateProjection.observation.chat.push({ ...duplicateProjection.observation.chat[0] });
  assert.equal(policy.begin(duplicateProjection, 'server:1', 3000).why, 'invalid_observation_chat');
});

test('revalidation preserves raw request and peer entity identity without exposing them in the turn', () => {
  const policy = new ConversationPolicy({ policy: { cooldownMs: 0 } });
  const initial = snapshot();
  const result = policy.begin(initial, 'server:1', 3000);
  assert.deepEqual(Object.keys(result.turn), ['v', 'messageId', 'channel', 'source', 'target', 'scope', 'controlRevision']);
  assert.deepEqual(Object.keys(result.turn.source), ['id', 'channel', 'sender', 'recipient', 'text', 'tick']);
  const changedRequestId = snapshot(); changedRequestId.chat.messages[0].requestId = 'new-request-id';
  assert.equal(policy.revalidate(result.turn, changedRequestId, 3001).why, 'source_changed');
  const changedPeerIdentity = snapshot({ peers: [
    { id: SELF_CHAT, entity: 2, name: 'Brisa' }, { ...peer, entity: 8 },
  ] });
  changedPeerIdentity.chat.messages[0].sender.entity = 8;
  assert.equal(policy.revalidate(result.turn, changedPeerIdentity, 3001).why, 'source_changed');
});

test('two policies may reply to one another once each; per-instance reply limits survive reentry', () => {
  const alphaPolicy = new ConversationPolicy({ policy: { cooldownMs: 0 } });
  const betaPolicy = new ConversationPolicy({ policy: { cooldownMs: 0 } });
  const alphaView = snapshot({ id: 'alpha:1', senderId: 'beta-token', peers: [
    { id: SELF_CHAT, entity: 2, name: 'Alpha' }, { id: 'beta-token', entity: 8, name: 'Beta' },
  ] });
  alphaView.chat.messages[0].sender.entity = 8;
  const betaView = snapshot({ id: 'beta:1', senderId: 'alpha-token', peers: [
    { id: SELF_CHAT, entity: 2, name: 'Beta' }, { id: 'alpha-token', entity: 7, name: 'Alpha' },
  ] });
  betaView.scope.characterId = 'beta-character';
  betaView.grant.scope.characterId = 'beta-character';
  betaView.observation.scope.characterId = 'beta-character';
  betaView.chat.self = 'chat:beta-token';
  betaView.chat.peers = [{ id: 'chat:beta-token', entity: 2, name: 'Beta' }, { id: 'alpha-token', entity: 7, name: 'Alpha' }];

  assert.equal(alphaPolicy.begin(alphaView, 'alpha:1', 3000).ok, true);
  assert.equal(betaPolicy.begin(betaView, 'beta:1', 3000).ok, true);
  const alphaAgain = snapshot({ id: 'alpha:2', senderId: 'beta-token', peers: alphaView.chat.peers,
    sessionId: 'alpha-reentered' });
  alphaAgain.chat.messages[0].sender.entity = 8;
  const betaAgain = snapshot({ id: 'beta:2', senderId: 'alpha-token', peers: betaView.chat.peers,
    sessionId: 'beta-reentered' });
  betaAgain.scope.characterId = 'beta-character';
  betaAgain.grant.scope.characterId = 'beta-character';
  betaAgain.observation.scope.characterId = 'beta-character';
  betaAgain.chat.self = 'chat:beta-token';
  betaAgain.chat.peers = betaView.chat.peers;
  assert.equal(alphaPolicy.begin(alphaAgain, 'alpha:2', 3100).why, 'peer_reply_limit');
  assert.equal(betaPolicy.begin(betaAgain, 'beta:2', 3100).why, 'peer_reply_limit');
  assert.equal(alphaPolicy.state.counts.turns, 1);
  assert.equal(betaPolicy.state.counts.turns, 1);
});
