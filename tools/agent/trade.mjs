import { GOODS } from '../../src/data/goods.js';
import { AGENT_TRADE_CAPABILITIES, AGENT_TRADE_LIMIT, agentTradeId, validAgentTradeRequest, validAgentTradeResult } from '../../src/net/agentTrade.js';
import { MSG } from '../../src/net/protocol.js';
import { canonicalJson, sameScope, validGrant, validObservation, validScope, integer } from './contract.mjs';

const copy = (value) => structuredClone(value);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const tradeBody = (value) => exact(value, ['opId', 'op', 'g', 'n', 'expectedTotal']) && agentTradeId(value.opId) &&
  ['buy', 'sell'].includes(value.op) && typeof value.g === 'string' && Object.hasOwn(GOODS, value.g) &&
  Number.isSafeInteger(value.n) && value.n >= 1 && value.n <= 500 && Number.isSafeInteger(value.expectedTotal) &&
  value.expectedTotal >= 0 && value.expectedTotal <= 1e9;

// Durable operation identity is intentionally separate from session-bound reads/actions.
export class AgentTrade {
  #operations; #pending = null; #budget = null; #context = null; #now; #send; #feedback; #timeout; #stopped = false;
  constructor({ now, send, onFeedback, timeoutMs = 5000, operations = new Map() }) {
    if (typeof now !== 'function' || typeof send !== 'function' || typeof onFeedback !== 'function' ||
        !integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !(operations instanceof Map))
      throw new TypeError('invalid trade configuration');
    this.#now = now; this.#send = send; this.#feedback = onFeedback; this.#timeout = timeoutMs; this.#operations = operations;
  }
  #emit(type, data) { this.#feedback(type, copy(data)); }
  get operations() { this.expire(); return copy([...this.#operations.values()]); }
  get state() {
    this.expire();
    const c = this.#currentContext(false), budget = this.#budget;
    const current = !!c && !this.#stopped && c.observation.receivedAtMs <= this.#now() &&
      this.#now() - c.observation.receivedAtMs <= c.limits.maxObservationAgeMs;
    const buyAvailable = current && c.grant.capabilities.includes(AGENT_TRADE_CAPABILITIES.buy);
    const sellAvailable = current && c.grant.capabilities.includes(AGENT_TRADE_CAPABILITIES.sell);
    const fresh = current && !!budget && sameScope(budget.scope, c.grant.scope) &&
      budget.epoch === c.grant.controlRevision && this.#now() >= budget.receivedAtMs && this.#now() - budget.receivedAtMs <= c.limits.maxObservationAgeMs;
    const projection = fresh ? budget.projection : null;
    const disabled = !!c && this.#knownDisabled(c);
    const available = (buyAvailable || sellAvailable) && !disabled;
    return copy({ available, buyAvailable: buyAvailable && !disabled,
      sellAvailable: sellAvailable && !disabled, fresh, budget: projection,
      budgetRequired: true, tick: budget?.tick ?? null,
      receivedAtMs: budget?.receivedAtMs ?? null, pendingId: this.#pending, operations: [...this.#operations.values()],
      durability: 'economic_authority_receipt' });
  }
  #currentContext(requireFresh = true) {
    const c = this.#context, now = this.#now();
    if (this.#stopped || !c?.ready || !c.authenticated || !validGrant(c.grant) || now >= c.grant.expiresAtMs ||
        !c.authority || c.authority.state !== 'active' || c.authority.grant?.controlRevision !== c.grant.controlRevision ||
        !sameScope(c.authority.grant?.scope, c.grant.scope) || !validObservation(c.observation, c.limits, 'server') ||
        !sameScope(c.observation.scope, c.grant.scope) || c.observation.controlRevision !== c.grant.controlRevision ||
        c.observation.confirmed.self.dead || (requireFresh && (c.observation.receivedAtMs > now ||
          now - c.observation.receivedAtMs > c.limits.maxObservationAgeMs))) return null;
    return c;
  }
  updateContext(context) {
    this.#context = context ? { ...context, grant: copy(context.grant), observation: copy(context.observation),
      authority: copy(context.authority) } : null;
    const c = this.#currentContext(false);
    if (!c || !c.grant.capabilities.some((capability) => Object.values(AGENT_TRADE_CAPABILITIES).includes(capability)) ||
        (this.#budget && (!sameScope(this.#budget.scope, c.grant.scope) || this.#budget.epoch !== c.grant.controlRevision))) this.#budget = null;
    const pending = this.#pending && this.#operations.get(this.#pending);
    if (pending && (!c || pending.epoch !== c.grant.controlRevision || pending.sessionId !== c.grant.scope.sessionId))
      this.#uncertain(pending, 'control_changed');
  }
  trade(input) {
    this.expire();
    if (!tradeBody(input)) return { ok: false, why: 'invalid_request' };
    let fingerprint;
    try { fingerprint = canonicalJson(input); } catch { return { ok: false, why: 'invalid_request' }; }
    const prior = this.#operations.get(input.opId);
    if (prior && prior.fingerprint !== fingerprint) return { ok: false, why: 'op_id_conflict' };
    const c = this.#currentContext();
    if (!c) return { ok: false, why: this.#context?.observation?.confirmed?.self?.dead ? 'dead' : 'unavailable' };
    const capability = AGENT_TRADE_CAPABILITIES[input.op];
    if (!c.grant.capabilities.includes(capability)) return { ok: false, why: 'forbidden' };
    // Revocation is monotonic. A known-disabled projection blocks new spending, but an
    // uncertain durable opId may still be explicitly resent to reconcile its old receipt.
    if (!prior && this.#knownDisabled(c)) return { ok: false, why: 'budget_disabled' };
    if (prior?.state === 'sent' && this.#pending === input.opId) return { ok: false, why: 'request_pending' };
    if (prior && !['uncertain'].includes(prior.state) && prior.sessionId === c.grant.scope.sessionId)
      return { ok: true, replay: true, operation: copy(prior) };
    if (!prior && this.#operations.size >= AGENT_TRADE_LIMIT) return { ok: false, why: 'operation_limit' };
    if (this.#pending) return { ok: false, why: 'request_pending' };
    const operation = prior ?? { opId: input.opId, body: copy(input), fingerprint, state: 'sent', attempts: 0,
      sessions: [], result: null, why: null, epoch: c.grant.controlRevision, sessionId: c.grant.scope.sessionId };
    if (!operation.sessions.includes(c.grant.scope.sessionId)) operation.sessions.push(c.grant.scope.sessionId);
    Object.assign(operation, { state: 'sent', why: null, epoch: c.grant.controlRevision,
      sessionId: c.grant.scope.sessionId, sentAtMs: this.#now(), observedTick: c.observation.tick, attempts: operation.attempts + 1 });
    this.#operations.set(input.opId, operation); this.#pending = input.opId; this.#emit('trade_request', operation);
    const message = { t: MSG.AGENT_TRADE, ...copy(input), epoch: operation.epoch, sessionId: operation.sessionId };
    if (!validAgentTradeRequest(message)) { this.#uncertain(operation, 'invalid_request'); return { ok: false, why: 'invalid_request' }; }
    try { this.#send(message); } catch { this.#uncertain(operation, 'transport_error'); }
    return { ok: true, replay: false, operation: copy(operation) };
  }
  receive(message) {
    this.expire();
    if (!validAgentTradeResult(message)) return false;
    // A durable trade receipt can arrive after the local observation ages; identity and epoch
    // still fence it, while freshness is required only when initiating a new operation.
    const operation = this.#operations.get(message.opId), c = this.#currentContext(false);
    if (!operation || operation.state !== 'sent' || this.#pending !== message.opId || !c ||
        message.epoch !== operation.epoch || message.sessionId !== operation.sessionId ||
        message.epoch !== c.grant.controlRevision || message.sessionId !== c.grant.scope.sessionId ||
        message.tick < operation.observedTick) return false;
    const body = operation.body, receipt = message.receipt;
    if (receipt && (receipt.op !== body.op || receipt.g !== body.g || receipt.n !== body.n)) return false;
    operation.state = message.ok ? 'completed' : 'rejected'; operation.why = message.why;
    operation.result = copy({ ok: message.ok, why: message.why, tick: message.tick, replay: message.replay,
      historical: message.historical, receipt, budget: message.budget });
    this.#pending = null;
    if (!message.replay && !message.historical) {
      this.#budget = message.budget ? { scope: copy(c.grant.scope), epoch: message.epoch,
        tick: message.tick, receivedAtMs: this.#now(), projection: copy(message.budget) } : null;
    }
    this.#emit('trade_result', operation);
    return true;
  }
  expire() {
    const operation = this.#pending && this.#operations.get(this.#pending);
    if (operation?.state === 'sent' && this.#now() - operation.sentAtMs >= this.#timeout)
      this.#uncertain(operation, 'result_timeout');
  }
  #uncertain(operation, why) {
    if (operation.state !== 'sent') return;
    operation.state = 'uncertain'; operation.why = why; this.#pending = null;
    this.#emit('trade_uncertain', operation);
  }
  #knownDisabled(c) {
    return this.#budget?.projection?.enabled === false && sameScope(this.#budget.scope, c.grant.scope) &&
      this.#budget.epoch === c.grant.controlRevision;
  }
  stop(reason = 'stop') {
    this.#stopped = true; this.#budget = null;
    if (this.#pending) this.#uncertain(this.#operations.get(this.#pending), reason);
  }
}
