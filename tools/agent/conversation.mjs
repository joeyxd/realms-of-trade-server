import { validGrant } from './contract.mjs';
import { validReplyText } from './mind-contract.mjs';

const DEFAULTS = Object.freeze({ channels: ['local', 'whisper'], maxTurns: 32,
  maxRepliesPerPeer: 1, cooldownMs: 5000, maxMessageAgeTicks: 120, blockedPeers: [] });
const POLICY_KEYS = Object.keys(DEFAULTS);
const CHANNELS = new Set(['world', 'local', 'whisper']);
const copy = (value) => structuredClone(value);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const id = (value, max = 100) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  /^[a-zA-Z0-9:_-]+$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const messageIdPattern = /^([a-zA-Z0-9_-]{1,64}):([1-9][0-9]*)$/;
const validMessageId = (value) => {
  const match = typeof value === 'string' && messageIdPattern.exec(value);
  return !!match && Number.isSafeInteger(Number(match[2]));
};
const scopeKeys = ['ownerId', 'characterId', 'worldId', 'sessionId'];
const validScope = (scope) => exact(scope, scopeKeys) && scopeKeys.every((key) => id(scope[key]));
const validPeer = (peer) => exact(peer, ['id', 'entity', 'name']) && id(peer.id, 95) && integer(peer.entity) &&
  typeof peer.name === 'string' && peer.name.length <= 80;
const validDelivered = (message) => {
  const keys = ['id', 'requestId', 'channel', 'sender', 'text', 'tick'];
  if (!plain(message) || ![keys, [...keys, 'target']].some((expected) => Reflect.ownKeys(message).length === expected.length &&
      expected.every((key) => Object.hasOwn(message, key)))) return false;
  return validMessageId(message.id) && typeof message.requestId === 'string' &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(message.requestId) && CHANNELS.has(message.channel) && validPeer(message.sender) &&
    typeof message.text === 'string' && [...message.text].length > 0 && [...message.text].length <= 1000 && integer(message.tick) &&
    (!Object.hasOwn(message, 'target') || validPeer(message.target));
};
const scopeCopy = (scope) => Object.fromEntries(scopeKeys.map((key) => [key, scope[key]]));
const sameScope = (a, b) => scopeKeys.every((key) => a?.[key] === b?.[key]);
const sameSource = (a, b) => a.id === b.id && a.channel === b.channel && a.sender === b.sender &&
  a.recipient === b.recipient && a.text === b.text && a.tick === b.tick;
const pending = (requests) => Array.isArray(requests) && requests.some((request) =>
  request && ['sent', 'uncertain'].includes(request.state));

function validatePolicy(input) {
  if (!plain(input)) return null;
  if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !POLICY_KEYS.includes(key))) return null;
  const policy = { ...DEFAULTS, ...input };
  if (!Array.isArray(policy.channels) || policy.channels.length > CHANNELS.size ||
      new Set(policy.channels).size !== policy.channels.length || policy.channels.some((channel) => !CHANNELS.has(channel)) ||
      !Number.isSafeInteger(policy.maxTurns) || policy.maxTurns < 1 || policy.maxTurns > 256 ||
      !Number.isSafeInteger(policy.maxRepliesPerPeer) || policy.maxRepliesPerPeer < 1 || policy.maxRepliesPerPeer > 32 ||
      !Number.isSafeInteger(policy.cooldownMs) || policy.cooldownMs < 0 || policy.cooldownMs > 3600000 ||
      !Number.isSafeInteger(policy.maxMessageAgeTicks) || policy.maxMessageAgeTicks < 0 || policy.maxMessageAgeTicks > 1000000 ||
      !Array.isArray(policy.blockedPeers) || policy.blockedPeers.length > 256 ||
      new Set(policy.blockedPeers).size !== policy.blockedPeers.length || policy.blockedPeers.some((peer) => !id(peer, 95))) return null;
  return { ...policy, channels: [...policy.channels], blockedPeers: [...policy.blockedPeers] };
}

/** Trusted, process-local policy for one explicit response to a delivered C01 message. */
export class ConversationPolicy {
  #policy;
  #turns = new Map();

  constructor({ policy = {} } = {}) {
    const normalized = validatePolicy(policy);
    if (!normalized) throw new TypeError('invalid conversation policy');
    this.#policy = normalized;
  }

  begin(snapshot, messageId, nowMs) {
    if (!validMessageId(messageId) || !integer(nowMs)) return { ok: false, why: 'invalid_request' };
    if (this.#turns.has(messageId)) return { ok: false, why: 'reply_already_attempted' };
    if (this.#turns.size >= this.#policy.maxTurns) return { ok: false, why: 'conversation_capacity' };
    const checked = this.#message(snapshot, messageId, nowMs);
    if (!checked.ok) return checked;
    const peer = checked.source.senderPeer;
    const entries = [...this.#turns.values()];
    const peerTurns = entries.filter((entry) => entry.source.senderPeer === peer).length;
    if (peerTurns >= this.#policy.maxRepliesPerPeer) return { ok: false, why: 'peer_reply_limit' };
    const last = entries.at(-1);
    if (last && nowMs - last.startedAtMs < this.#policy.cooldownMs) return { ok: false, why: 'cooldown' };
    const turn = {
      v: 1, messageId, channel: checked.source.channel,
      source: { id: checked.source.id, channel: checked.source.channel, sender: checked.source.sender,
        recipient: checked.source.recipient, text: checked.source.text, tick: checked.source.tick },
      target: checked.source.channel === 'whisper' ? checked.source.senderPeer : null,
      scope: scopeCopy(checked.scope), controlRevision: checked.controlRevision,
    };
    this.#turns.set(messageId, { ...copy(turn), source: { ...turn.source, senderPeer: peer },
      rawRequestId: checked.source.requestId, senderEntity: checked.source.senderEntity, startedAtMs: nowMs });
    return { ok: true, turn: copy(turn) };
  }

  revalidate(turn, snapshot, nowMs) {
    if (!exact(turn, ['v', 'messageId', 'channel', 'source', 'target', 'scope', 'controlRevision']) ||
        turn.v !== 1 || !validMessageId(turn.messageId) || !integer(nowMs)) return { ok: false, why: 'invalid_turn' };
    const accepted = this.#turns.get(turn.messageId);
    if (!accepted || !this.#sameTurn(accepted, turn)) return { ok: false, why: 'turn_not_admitted' };
    const checked = this.#message(snapshot, turn.messageId, nowMs);
    if (!checked.ok) return checked;
    if (!sameScope(accepted.scope, checked.scope) || accepted.controlRevision !== checked.controlRevision) {
      return { ok: false, why: 'scope_or_epoch_changed' };
    }
    if (!sameSource(accepted.source, checked.source) || accepted.source.senderPeer !== checked.source.senderPeer ||
        accepted.rawRequestId !== checked.source.requestId || accepted.senderEntity !== checked.source.senderEntity) {
      return { ok: false, why: 'source_changed' };
    }
    return { ok: true, turn: copy(turn) };
  }

  get state() {
    const entries = [...this.#turns.values()].map((entry) => ({
      v: entry.v, messageId: entry.messageId, channel: entry.channel,
      source: { ...entry.source }, target: entry.target, scope: { ...entry.scope },
      controlRevision: entry.controlRevision, startedAtMs: entry.startedAtMs,
    }));
    const peerCounts = new Map();
    for (const entry of entries) peerCounts.set(entry.source.senderPeer, (peerCounts.get(entry.source.senderPeer) ?? 0) + 1);
    const perPeer = Object.fromEntries(peerCounts);
    return { policy: copy(this.#policy), counts: { turns: entries.length, perPeer }, entries };
  }

  #message(snapshot, messageId, nowMs) {
    if (!plain(snapshot)) return { ok: false, why: 'invalid_snapshot' };
    const grant = snapshot.grant;
    const observation = snapshot.observation;
    const chat = snapshot.chat;
    if (snapshot.state !== 'ready') return { ok: false, why: 'not_ready' };
    if (!validGrant(grant)) return { ok: false, why: 'invalid_grant' };
    if (nowMs >= grant.expiresAtMs) return { ok: false, why: 'authorization_expired' };
    if (!plain(observation) || !Array.isArray(observation.chat) || !integer(observation.tick) ||
        !integer(observation.receivedAtMs) || observation.receivedAtMs > nowMs || !validScope(observation.scope) ||
        observation.controlRevision !== grant.controlRevision || !sameScope(observation.scope, grant.scope)) {
      return { ok: false, why: 'invalid_observation' };
    }
    if (!plain(chat) || !['available', 'self', 'config', 'peers', 'messages', 'requests'].every((key) => Object.hasOwn(chat, key))) {
      return { ok: false, why: 'invalid_chat' };
    }
    if (chat.available !== true || !id(chat.self) ||
        !plain(chat.config) || chat.config.enabled !== true || !Number.isSafeInteger(chat.config.maxLength) ||
        chat.config.maxLength < 1 || chat.config.maxLength > 1000 || !Array.isArray(chat.peers) || chat.peers.length > 4096 ||
        !chat.peers.every(validPeer) || new Set(chat.peers.map((item) => item.id)).size !== chat.peers.length ||
        !Array.isArray(chat.messages) || chat.messages.length > 200 ||
        new Set(chat.messages.map((item) => item?.id)).size !== chat.messages.length ||
        !Array.isArray(chat.requests) || chat.requests.length > 256 || !chat.requests.every((request) =>
          plain(request) && typeof request.state === 'string' && ['sent', 'routed', 'rejected', 'uncertain'].includes(request.state))) {
      return { ok: false, why: 'chat_not_ready' };
    }
    if (!grant.capabilities.includes('chat')) return { ok: false, why: 'chat_forbidden' };
    if (pending(chat.requests)) return { ok: false, why: 'chat_pending' };
    const message = chat.messages.find((item) => item?.id === messageId);
    if (!message) return { ok: false, why: 'source_missing' };
    if (!validDelivered(message)) return { ok: false, why: 'invalid_source' };
    if (!chat.messages.every(validDelivered)) return { ok: false, why: 'invalid_chat' };
    if (!this.#policy.channels.includes(message.channel)) return { ok: false, why: 'channel_disabled' };
    if (!validMessageId(message.id)) return { ok: false, why: 'invalid_source' };
    const selfPeer = chat.peers.find((item) => item.id === chat.self);
    if (!selfPeer) return { ok: false, why: 'self_peer_unavailable' };
    if (observation.confirmed?.self?.ref && observation.confirmed.self.ref.entityId !== selfPeer.entity) {
      return { ok: false, why: 'self_peer_mismatch' };
    }
    if (!id(message.sender.id) || message.sender.id === chat.self) return { ok: false, why: 'self_message' };
    if (this.#policy.blockedPeers.includes(message.sender.id)) return { ok: false, why: 'peer_blocked' };
    const senderPeer = message.sender.id;
    const sender = senderPeer === chat.self ? grant.scope.characterId : `chat:${senderPeer}`;
    const targetId = message.target?.id ?? null;
    const recipient = targetId === null ? null : targetId === chat.self ? grant.scope.characterId : `chat:${targetId}`;
    if (message.channel === 'whisper' && (!message.target || targetId !== chat.self || senderPeer === chat.self ||
        message.target.entity !== selfPeer.entity)) {
      return { ok: false, why: 'whisper_not_addressed_to_self' };
    }
    if (message.channel !== 'whisper' && message.target !== undefined) return { ok: false, why: 'invalid_recipient' };
    const peer = chat.peers.find((item) => item?.id === senderPeer);
    if (!peer || peer.id === chat.self) return { ok: false, why: 'peer_unavailable' };
    if (message.sender.entity !== peer.entity) return { ok: false, why: 'source_peer_mismatch' };
    if (!validReplyText(message.text, chat.config.maxLength)) return { ok: false, why: 'invalid_source_text' };
    if (message.tick > observation.tick) return { ok: false, why: 'source_from_future' };
    if (observation.tick - message.tick > this.#policy.maxMessageAgeTicks) return { ok: false, why: 'source_too_old' };
    if (observation.chat.length > 32 || !observation.chat.every((item) =>
      exact(item, ['id', 'channel', 'sender', 'recipient', 'text', 'tick'])) ||
      new Set(observation.chat.map((item) => item.id)).size !== observation.chat.length) return { ok: false, why: 'invalid_observation_chat' };
    const projected = observation.chat.find((item) => item.id === messageId);
    if (!exact(projected, ['id', 'channel', 'sender', 'recipient', 'text', 'tick']) || projected.channel !== message.channel || projected.text !== message.text ||
        projected.tick !== message.tick || projected.sender !== sender || projected.recipient !== recipient) {
      return { ok: false, why: 'source_projection_mismatch' };
    }
    return { ok: true, scope: scopeCopy(grant.scope), controlRevision: grant.controlRevision,
      source: { id: message.id, requestId: message.requestId, channel: message.channel, sender, recipient,
        text: message.text, tick: message.tick, senderPeer, senderEntity: message.sender.entity } };
  }

  #sameTurn(accepted, turn) {
    return accepted.v === turn.v && accepted.messageId === turn.messageId && accepted.channel === turn.channel &&
      accepted.target === turn.target && accepted.controlRevision === turn.controlRevision &&
      sameScope(accepted.scope, turn.scope) && exact(turn.source, ['id', 'channel', 'sender', 'recipient', 'text', 'tick']) &&
      accepted.source.id === turn.source.id && accepted.source.channel === turn.source.channel && accepted.source.sender === turn.source.sender &&
      accepted.source.recipient === turn.source.recipient && accepted.source.text === turn.source.text &&
      accepted.source.tick === turn.source.tick;
  }
}
