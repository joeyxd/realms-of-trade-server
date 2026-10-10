import { MARKET_QUERY_LIMIT, MARKET_READ_CAPABILITY, validMarketResult, validMarketProjection } from '../../src/net/agentMarket.js';
import { GOODS } from '../../src/data/goods.js';
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
const queryKeys = (op) => op === 'list' ? ['v', 'requestId', 'scope', 'controlRevision', 'op'] :
  op === 'quote' ? ['v', 'requestId', 'scope', 'controlRevision', 'op', 'g', 'n', 'side'] : [];
const validLocalQuery = (query) => {
  if (!plain(query)) return false;
  const op = Object.getOwnPropertyDescriptors(query).op?.value;
  const keys = queryKeys(op);
  if (!keys.length || !exact(query, keys) || query.v !== 1 || !requestId(query.requestId) ||
      !validScope(query.scope) || !integer(query.controlRevision)) return false;
  return op === 'list' || (typeof query.g === 'string' && Object.hasOwn(GOODS, query.g) &&
    Number.isSafeInteger(query.n) && query.n >= 1 && query.n <= 500 && ['buy', 'sell'].includes(query.side));
};

// Session-only private read ledger. Market results are observations and never commands.
export class AgentMarket {
  #requests = new Map(); #pending = null; #latest = null; #now; #send; #feedback; #limits; #timeout;
  #context = null; #stopped = false;
  constructor({ now, send, onFeedback, limits, timeoutMs = 3000 }) {
    if (typeof now !== 'function' || typeof send !== 'function' || typeof onFeedback !== 'function' ||
        !integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('invalid market configuration');
    this.#now = now; this.#send = send; this.#feedback = onFeedback; this.#limits = limits; this.#timeout = timeoutMs;
  }
  #emit(type, data) { this.#feedback(type, copy(data)); }
  get requests() { this.expire(); return copy([...this.#requests.values()]); }
  get state() {
    this.expire();
    const current = this.#currentContext(false);
    if (!current || (this.#latest && (!sameScope(this.#latest.scope, current.grant.scope) ||
        this.#latest.epoch !== current.grant.controlRevision))) this.#latest = null;
    const latest = this.#latest;
    const now = this.#now();
    const observationFresh = !!current && now >= current.observation.receivedAtMs &&
      now - current.observation.receivedAtMs <= this.#limits.maxObservationAgeMs;
    // Requery after movement: only the server can prove current service presence.
    const samePosition = !!latest && !!current && !latest.moved && latest.position.x === current.observation.confirmed.self.position.x &&
      latest.position.z === current.observation.confirmed.self.position.z;
    const latestFresh = !!latest && now >= latest.receivedAtMs &&
      now - latest.receivedAtMs <= this.#limits.maxObservationAgeMs && samePosition;
    const available = !!current && observationFresh &&
      current.grant.capabilities.includes(MARKET_READ_CAPABILITY) && !this.#stopped;
    const fresh = available && observationFresh && latestFresh;
    return copy({ available, fresh, scope: latest?.scope ?? current?.grant?.scope ?? null,
      controlRevision: latest?.epoch ?? current?.grant?.controlRevision ?? null,
      market: fresh ? latest.market : null, tick: latest?.tick ?? null,
      receivedAtMs: latest?.receivedAtMs ?? null,
      staleWhy: latest && !fresh ? (!samePosition ? 'actor_moved' : 'stale_observation') : null, pendingId: this.#pending,
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
    if (!c || !c.grant.capabilities.includes(MARKET_READ_CAPABILITY) || (this.#latest && (!sameScope(this.#latest.scope, c.grant.scope) ||
        this.#latest.epoch !== c.grant.controlRevision))) this.#latest = null;
    if (this.#latest && c && (this.#latest.position.x !== c.observation.confirmed.self.position.x ||
        this.#latest.position.z !== c.observation.confirmed.self.position.z)) this.#latest.moved = true;
    const pending = this.#requests.get(this.#pending);
    if (pending && (!c || !c.grant.capabilities.includes(MARKET_READ_CAPABILITY) || pending.epoch !== c.grant.controlRevision ||
        pending.sessionId !== c.grant.scope.sessionId)) this.#uncertain(pending, 'control_changed');
  }
  read(query) {
    this.expire();
    if (!validLocalQuery(query)) return { ok: false, why: 'invalid_request' };
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
    if (!c.grant.capabilities.includes(MARKET_READ_CAPABILITY)) return { ok: false, why: 'forbidden' };
    if (this.#requests.size >= MARKET_QUERY_LIMIT) return { ok: false, why: 'query_limit' };
    if (this.#pending) return { ok: false, why: 'request_pending' };
    const request = { requestId: query.requestId, query: copy(query), epoch: c.grant.controlRevision,
      sessionId: c.grant.scope.sessionId, observedTick: c.observation.tick, sentAtMs: this.#now(),
      state: 'sent', result: null, why: null };
    this.#requests.set(query.requestId, request); this.#pending = request.requestId;
    this.#emit('market_request', request);
    const message = { t: MSG.AGENT_MARKET, requestId: request.requestId, epoch: request.epoch,
      sessionId: request.sessionId, op: query.op };
    if (query.op === 'quote') Object.assign(message, { g: query.g, n: query.n, side: query.side });
    try { this.#send(message); }
    catch { this.#uncertain(request, 'transport_error'); }
    return { ok: true, replay: false, request: copy(request) };
  }
  receive(message) {
    this.expire();
    if (!validMarketResult(message)) return false;
    const request = this.#requests.get(message.requestId), c = this.#currentContext();
    if (!request || request.state !== 'sent' || this.#pending !== request.requestId || !c ||
        message.epoch !== request.epoch || message.sessionId !== request.sessionId ||
        message.epoch !== c.grant.controlRevision || message.sessionId !== c.grant.scope.sessionId ||
        !c.grant.capabilities.includes(MARKET_READ_CAPABILITY) ||
        message.tick < request.observedTick || message.tick < c.observation.tick) return false;
    if (message.ok && (!validMarketProjection(message.market) || message.market.op !== request.query.op ||
        (request.query.op === 'quote' && (message.market.g !== request.query.g || message.market.n !== request.query.n ||
          message.market.side !== request.query.side)))) return false;
    request.state = message.ok ? 'completed' : 'rejected'; request.why = message.why;
    request.result = copy({ ok: message.ok, why: message.why, tick: message.tick, replay: message.replay,
      stale: false, market: message.market });
    this.#pending = null;
    // A server replay is cached data, so it must not renew the observation timestamp.
    if (!message.ok) this.#latest = null;
    else if (!message.replay) this.#latest = { scope: copy(c.grant.scope), epoch: message.epoch,
      tick: message.tick, receivedAtMs: this.#now(), market: copy(message.market),
      position: copy(c.observation.confirmed.self.position) };
    this.#emit('market_result', request);
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
    this.#emit('market_uncertain', request);
  }
  stop(reason = 'stop') {
    this.#stopped = true; this.#latest = null;
    if (this.#pending) this.#uncertain(this.#requests.get(this.#pending), reason);
  }
}
