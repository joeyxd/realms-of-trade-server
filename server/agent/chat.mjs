import { MSG } from '../../src/net/protocol.js';
import { chatConfig } from '../../src/data/chat.js';
import { canonicalJson, id, integer, sameScope, validScope, validGrant, validObservation } from './contract.mjs';

const copy = (v) => structuredClone(v);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const requestId = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
const messageId = (v) => {
  const parts = typeof v === 'string' && /^([a-zA-Z0-9_-]{1,64}):([1-9][0-9]*)$/.exec(v);
  return parts && integer(Number(parts[2])) ? { namespace: parts[1], serial: Number(parts[2]) } : null;
};
const peer = (v) => exact(v, ['id', 'entity', 'name']) && id(v.id) && v.id.length <= 95 && integer(v.entity) &&
  typeof v.name === 'string' && v.name.length <= 80;
const channels = new Set(['world', 'local', 'whisper']);
const failures = new Set(['session', 'disabled', 'invalid', 'channel', 'recipient', 'rate', 'conflict']);
// Match C01 normalization, including code-point counting. No player text becomes an instruction.
const clean = (v, max) => {
  if (typeof v !== 'string' || v.length > max * 4) return null;
  const text = v.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text && [...text].length <= max ? text : null;
};

// Trusted adapter component. One unresolved send and no ledger eviction make a same-session,
// explicit same-ID retry safe from C01 receipt pressure caused by this private sender.
export class AgentChat {
  #self = null; #peers = []; #config = null; #messages = []; #requests = new Map();
  #namespace = null; #serial = 0; #gap = 0; #pending = null; #stopped = false;
  #now; #send; #feedback; #limits; #timeout; #maxMessages; #maxRequests; #character;
  constructor({ characterId, limits, now, send, onFeedback, timeoutMs = 6000 }) {
    if (!id(characterId) || !integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('invalid chat configuration');
    this.#character = characterId; this.#limits = limits; this.#now = now; this.#send = send;
    this.#feedback = onFeedback; this.#timeout = timeoutMs;
    this.#maxMessages = Math.min(limits.maxChat, 200); this.#maxRequests = Math.min(limits.maxActions, 256);
  }
  #emit(type, data) { this.#feedback(type, copy(data)); }
  get state() {
    this.expire();
    return copy({ available: !!this.#self && !this.#stopped, self: this.#self, peers: this.#peers, config: this.#config,
      messages: this.#messages, requests: [...this.#requests.values()], pendingId: this.#pending,
      historyGap: this.#gap, historyBeforeSession: 'unavailable', durability: 'session_only' });
  }
  get observation() {
    return this.#messages.map((m) => ({ id: m.id, channel: m.channel,
      sender: m.sender.id === this.#self ? this.#character : `chat:${m.sender.id}`,
      recipient: m.target ? (m.target.id === this.#self ? this.#character : `chat:${m.target.id}`) : null,
      text: m.text, tick: m.tick }));
  }
  get historyGap() { return this.#gap; }
  receive(m, entityId) {
    if (this.#stopped) return null;
    if (m.t === MSG.CHAT_STATE) {
      let config;
      try { config = chatConfig(m.config); } catch { return null; }
      if (!id(m.self) || !Array.isArray(m.peers) || m.peers.length > 4096 || !m.peers.every(peer) ||
          new Set(m.peers.map((p) => p.id)).size !== m.peers.length ||
          !m.peers.some((p) => p.id === m.self && p.entity === entityId) ||
          !Array.isArray(m.history) || m.history.length > config.historyLimit) return null;
      if (this.#self && this.#self !== m.self) return 'chat_session_changed';
      this.#self = m.self; this.#peers = copy(m.peers); this.#config = config;
      for (const message of m.history) this.#message(message, true);
      this.#emit('chat_state', { self: this.#self, peers: this.#peers, config, historyGap: this.#gap });
    } else if (m.t === MSG.CHAT_MESSAGE) this.#message(m, false);
    else if (m.t === MSG.CHAT_RESULT) this.#result(m);
    return null;
  }
  #message(m, fromHistory) {
    if (!this.#self || !this.#config || m?.t !== MSG.CHAT_MESSAGE || !id(m.id) || !requestId(m.requestId) ||
        !channels.has(m.channel) || !peer(m.sender) || !integer(m.tick) || clean(m.text, this.#config.maxLength) !== m.text ||
        (m.channel === 'whisper' ? !peer(m.target) || m.target.id === m.sender.id ||
          (m.sender.id !== this.#self && m.target.id !== this.#self) : m.target !== undefined)) return;
    const key = messageId(m.id);
    if (!key || (this.#namespace && this.#namespace !== key.namespace)) return;
    const current = this.#requests.get(m.requestId);
    if (m.sender.id === this.#self && current && current.payload.channel === m.channel && current.payload.text === m.text &&
        (current.payload.target ?? null) === (m.target?.id ?? null)) this.#resolve(current, { messageId: m.id, basis: 'sender_echo', duplicate: false });
    // Namespace + monotonic serial avoids replaying old state-history even after local pruning.
    // Gaps in this global serial belong to other audiences; they are not counted as missed chat.
    if (key.serial <= this.#serial) return;
    this.#namespace = key.namespace; this.#serial = key.serial;
    const message = { id: m.id, requestId: m.requestId, channel: m.channel, sender: copy(m.sender),
      ...(m.target ? { target: copy(m.target) } : {}), text: m.text, tick: m.tick };
    this.#messages.push(message);
    if (this.#messages.length > this.#maxMessages) { this.#messages.shift(); this.#gap++; }
    this.#emit('chat_message', { message, fromHistory, historyGap: this.#gap, trust: 'player_text' });
  }
  #resolve(request, result) {
    if (request.state === 'routed' || request.state === 'rejected') return;
    request.state = 'routed'; request.result = { ok: true, ...result, read: 'unknown', durability: 'session_only' };
    if (this.#pending === request.order.actionId) this.#pending = null;
    this.#emit('chat_result', request);
  }
  #result(m) {
    const request = this.#requests.get(m.requestId);
    if (!request || typeof m.ok !== 'boolean' || ['routed', 'rejected'].includes(request.state)) return;
    if (m.ok) {
      const key = messageId(m.messageId);
      if (!key || (this.#namespace && this.#namespace !== key.namespace) ||
          (m.duplicate !== undefined && typeof m.duplicate !== 'boolean')) return;
      this.#resolve(request, { messageId: m.messageId, basis: 'chat_result', duplicate: m.duplicate === true });
    } else if (failures.has(m.code)) {
      request.state = 'rejected'; request.result = { ok: false, code: m.code, durability: 'session_only' };
      this.#pending = null; this.#emit('chat_result', request);
    }
  }
  expire() {
    const request = this.#requests.get(this.#pending);
    if (request?.state === 'sent' && this.#now() - request.sentAtMs >= this.#timeout) {
      request.state = 'uncertain'; request.why = 'result_timeout'; this.#emit('chat_uncertain', request);
    }
  }
  #gate({ grant, observation, ready }) {
    if (this.#stopped || !ready || !this.#self) return 'chat_not_ready';
    if (!validGrant(grant) || !grant.capabilities.includes('chat')) return 'forbidden';
    const now = this.#now();
    if (now >= grant.expiresAtMs) return 'authorization_expired';
    if (!validObservation(observation, this.#limits, 'server') || !sameScope(observation.scope, grant.scope) ||
        observation.controlRevision !== grant.controlRevision || observation.receivedAtMs > now ||
        now - observation.receivedAtMs > this.#limits.maxObservationAgeMs) return 'stale_observation';
    if (observation.confirmed.self.dead) return 'dead';
    if (!this.#config.enabled) return 'disabled';
    return null;
  }
  send(order, context) {
    this.expire();
    const previous = this.#requests.get(order?.actionId);
    if (previous) {
      try { if (canonicalJson(previous.order) !== canonicalJson(order)) return { ok: false, why: 'action_id_conflict' }; }
      catch { return { ok: false, why: 'invalid_order' }; }
      return { ok: true, replay: true, request: copy(previous) };
    }
    const why = this.#gate(context);
    if (why) return { ok: false, why };
    if (!exact(order, ['v', 'actionId', 'scope', 'controlRevision', 'observationRevision', 'type', 'args']) || order.v !== 1 ||
        !requestId(order.actionId) || !validScope(order.scope) || !integer(order.controlRevision) || !integer(order.observationRevision) ||
        order.type !== 'chat_send' || !exact(order.args, ['channel', 'text', 'target'])) return { ok: false, why: 'invalid_order' };
    if (!sameScope(order.scope, context.grant.scope) || order.controlRevision !== context.grant.controlRevision) return { ok: false, why: 'control_mismatch' };
    if (order.observationRevision !== context.observation.revision) return { ok: false, why: 'stale_observation' };
    if (!channels.has(order.args.channel)) return { ok: false, why: 'channel' };
    const text = clean(order.args.text, this.#config.maxLength);
    if (!text) return { ok: false, why: 'invalid_text' };
    if (order.args.channel === 'whisper' ? !this.#peers.some((p) => p.id === order.args.target && p.id !== this.#self) : order.args.target !== null) return { ok: false, why: 'recipient' };
    if (this.#pending) return { ok: false, why: 'chat_pending' };
    if (this.#requests.size >= this.#maxRequests) return { ok: false, why: 'chat_capacity' };
    const payload = { t: MSG.CHAT_SEND, id: order.actionId, channel: order.args.channel, text,
      ...(order.args.channel === 'whisper' ? { target: order.args.target } : {}) };
    const request = { order: copy(order), payload, state: 'sent', attempts: 0, sentAtMs: this.#now(), result: null, why: null };
    this.#requests.set(order.actionId, request); this.#pending = order.actionId;
    this.#transmit(request);
    return { ok: true, replay: false, request: copy(request) };
  }
  #transmit(request) {
    request.attempts++; request.state = 'sent'; request.why = null; request.sentAtMs = this.#now();
    this.#emit('chat_sent', request);
    try { this.#send(copy(request.payload)); }
    catch {
      if (request.state === 'sent') { request.state = 'uncertain'; request.why = 'transport_error'; this.#emit('chat_uncertain', request); }
    }
  }
  retry(requestId, context) {
    this.expire();
    const why = this.#gate(context);
    if (why) return { ok: false, why };
    const request = this.#requests.get(requestId);
    if (!request || request.state !== 'uncertain' || requestId !== this.#pending) return { ok: false, why: 'retry_unavailable' };
    if (request.attempts >= 3) return { ok: false, why: 'retry_limit' };
    if (request.payload.target && !this.#peers.some((p) => p.id === request.payload.target)) return { ok: false, why: 'recipient' };
    this.#transmit(request);
    return { ok: true, request: copy(request) };
  }
  stop(reason) {
    this.#stopped = true;
    const request = this.#requests.get(this.#pending);
    if (request && !['routed', 'rejected'].includes(request.state)) {
      request.state = 'uncertain'; request.why = reason; this.#emit('chat_uncertain', request);
    }
  }
}
