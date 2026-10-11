import { INVENTORY_QUERY_LIMIT, INVENTORY_READ_CAPABILITY, validInventoryResult } from '../../src/net/agentInventory.js';
import { MSG } from '../../src/net/protocol.js';
import { canonicalJson, sameScope, validGrant, validObservation, validScope, integer } from './contract.mjs';

const copy = (value) => structuredClone(value);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => {
  if (!plain(value)) return false;
  const fields = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(fields);
  return own.length === keys.length && own.every((key) => typeof key === 'string' && keys.includes(key) &&
    fields[key].enumerable && Object.hasOwn(fields[key], 'value')) && keys.every((key) => Object.hasOwn(fields, key));
};
const requestId = (value) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value);

// Session-only read ledger. Results are observations, never commands that mutate game state.
export class AgentInventory {
  #requests = new Map(); #pending = null; #latest = null; #now; #send; #feedback; #limits; #timeout;
  #context = null; #stopped = false;
  constructor({ now, send, onFeedback, limits, timeoutMs = 3000 }) {
    if (typeof now !== 'function' || typeof send !== 'function' || typeof onFeedback !== 'function' ||
        !integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('invalid inventory configuration');
    this.#now = now; this.#send = send; this.#feedback = onFeedback; this.#limits = limits; this.#timeout = timeoutMs;
  }
  #emit(type, data) { this.#feedback(type, copy(data)); }
  get requests() { this.expire(); return copy([...this.#requests.values()]); }
  get state() {
    this.expire();
    const current = this.#currentContext();
    const available = !!current && current.grant.capabilities.includes(INVENTORY_READ_CAPABILITY);
    const latest = this.#latest;
    const now = this.#now(), maxAgeMs = this.#limits.maxObservationAgeMs;
    const sameCurrent = !!current && !!latest && sameScope(latest.scope, current.grant.scope) &&
      latest.epoch === current.grant.controlRevision;
    const fresh = available && sameCurrent && now >= latest.receivedAtMs && now - latest.receivedAtMs <= maxAgeMs;
    const validUntilMs = latest ? latest.receivedAtMs + maxAgeMs : null;
    return copy({ available, fresh, inventory: fresh ? latest.inventory : null,
      scope: latest?.scope ?? current?.grant.scope ?? null,
      controlRevision: latest?.epoch ?? current?.grant.controlRevision ?? null,
      source: fresh ? 'server_private' : null, tick: latest?.tick ?? null, receivedAtMs: latest?.receivedAtMs ?? null,
      maxAgeMs, validUntilMs,
      staleWhy: latest && !fresh ? (available && sameCurrent ? 'stale_observation' : 'unavailable') : null, pendingId: this.#pending,
      requests: [...this.#requests.values()], durability: 'session_only' });
  }
  #currentContext(requireFreshObservation = true) {
    const c = this.#context, now = this.#now();
    if (this.#stopped || !c?.ready || !c.authenticated || !validGrant(c.grant) || now >= c.grant.expiresAtMs ||
        !c.authority || c.authority.state !== 'active' || c.authority.grant?.controlRevision !== c.grant.controlRevision ||
        !sameScope(c.authority.grant?.scope, c.grant.scope) ||
        !validObservation(c.observation, this.#limits, 'server') || !sameScope(c.observation.scope, c.grant.scope) ||
        c.observation.controlRevision !== c.grant.controlRevision || c.observation.confirmed.self.dead ||
        (requireFreshObservation && (c.observation.receivedAtMs > now ||
          now - c.observation.receivedAtMs > this.#limits.maxObservationAgeMs))) return null;
    return c;
  }
  updateContext(context) {
    this.#context = context ? { ...context, grant: copy(context.grant), observation: copy(context.observation),
      authority: copy(context.authority) } : null;
    const c = this.#currentContext(false);
    if (!c || (this.#latest && (!sameScope(this.#latest.scope, c.grant.scope) ||
        this.#latest.epoch !== c.grant.controlRevision ||
        !c.grant.capabilities.includes(INVENTORY_READ_CAPABILITY)))) this.#latest = null;
    const pending = this.#requests.get(this.#pending);
    if (pending && (!c || pending.epoch !== c.grant.controlRevision ||
        pending.sessionId !== c.grant.scope.sessionId ||
        !c.grant.capabilities.includes(INVENTORY_READ_CAPABILITY))) this.#uncertain(pending, 'control_changed');
  }
  read(query) {
    this.expire();
    if (!exact(query, ['v', 'requestId', 'scope', 'controlRevision']) || query.v !== 1 ||
        !requestId(query.requestId) || !validScope(query.scope) || !integer(query.controlRevision))
      return { ok: false, why: 'invalid_request' };
    const previous = this.#requests.get(query.requestId);
    if (previous) {
      try { if (canonicalJson(previous.query) !== canonicalJson(query)) return { ok: false, why: 'request_id_conflict' }; }
      catch { return { ok: false, why: 'invalid_request' }; }
      return { ok: true, replay: true, request: copy(previous) };
    }
    const c = this.#currentContext();
    if (!c) return { ok: false, why: this.#context?.observation?.confirmed?.self?.dead ? 'dead' : 'unavailable' };
    if (query.controlRevision !== c.grant.controlRevision || !sameScope(query.scope, c.grant.scope))
      return { ok: false, why: 'control_mismatch' };
    if (!c.grant.capabilities.includes(INVENTORY_READ_CAPABILITY)) return { ok: false, why: 'forbidden' };
    if (this.#requests.size >= INVENTORY_QUERY_LIMIT) return { ok: false, why: 'query_limit' };
    if (this.#pending) return { ok: false, why: 'request_pending' };
    const request = { requestId: query.requestId, query: copy(query), epoch: c.grant.controlRevision,
      sessionId: c.grant.scope.sessionId, observedTick: c.observation.tick, sentAtMs: this.#now(),
      state: 'sent', result: null, why: null };
    this.#requests.set(query.requestId, request); this.#pending = request.requestId;
    this.#emit('inventory_request', request);
    try { this.#send({ t: MSG.AGENT_INVENTORY, requestId: request.requestId, epoch: request.epoch, sessionId: request.sessionId }); }
    catch { this.#uncertain(request, 'transport_error'); }
    return { ok: true, replay: false, request: copy(request) };
  }
  receive(message) {
    this.expire();
    if (!validInventoryResult(message)) return false;
    const request = this.#requests.get(message.requestId), c = this.#currentContext();
    if (!request || request.state !== 'sent' || this.#pending !== request.requestId || !c ||
        !c.grant.capabilities.includes(INVENTORY_READ_CAPABILITY) ||
        message.epoch !== request.epoch || message.sessionId !== request.sessionId ||
        message.epoch !== c.grant.controlRevision || message.sessionId !== c.grant.scope.sessionId ||
        message.tick < request.observedTick) return false;
    const stale = message.tick < c.observation.tick;
    request.state = message.ok ? 'completed' : 'rejected'; request.why = message.why;
    request.result = copy({ ok: message.ok, why: message.why, tick: message.tick, replay: message.replay,
      stale, inventory: message.inventory });
    this.#pending = null;
    // A server replay is a cached snapshot. Report it, but never refresh the view's observation age.
    if (!message.ok) this.#latest = null;
    else if (!message.replay && !stale) this.#latest = { scope: copy(c.grant.scope), epoch: message.epoch,
      tick: message.tick, receivedAtMs: this.#now(), inventory: copy(message.inventory) };
    this.#emit('inventory_result', request);
    return true;
  }
  expire() {
    const request = this.#requests.get(this.#pending);
    if (request?.state === 'sent' && this.#now() - request.sentAtMs >= this.#timeout)
      this.#uncertain(request, 'result_timeout');
  }
  #uncertain(request, why) {
    if (request.state !== 'sent') return;
    request.state = 'uncertain'; request.why = why; this.#pending = null;
    this.#emit('inventory_uncertain', request);
  }
  stop(reason = 'stop') {
    this.#stopped = true; this.#latest = null;
    if (this.#pending) this.#uncertain(this.#requests.get(this.#pending), reason);
  }
}
