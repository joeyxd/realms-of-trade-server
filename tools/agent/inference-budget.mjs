const KINDS = new Set(['decision', 'compaction', 'embedding', 'retry']);
const MODES = new Set(['measured_tokens', 'estimated_tokens', 'simulated_tokens']);
const MAX_ID_LENGTH = 100;

const isSafeInt = (value) => Number.isSafeInteger(value) && value >= 0;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const hasExactOwnKeys = (value, keys) => isPlainObject(value) &&
  Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const validScope = (scope) => hasExactOwnKeys(scope, ['ownerId', 'characterId', 'worldId']) &&
  ['ownerId', 'characterId', 'worldId'].every((key) =>
    typeof scope[key] === 'string' && scope[key].length > 0 && scope[key].length <= MAX_ID_LENGTH);
const checkedAdd = (a, b) => Number.isSafeInteger(a + b) ? a + b : null;

/** Process-local admission ledger. This does not perform inference or persist state. */
export class InferenceBudget {
  #scope;
  #limits;
  #entries = new Map();
  #confirmedTokens = 0;
  #confirmedCost = 0;
  #overrun = false;

  constructor({ scope, limits } = {}) {
    if (!validScope(scope)) throw new TypeError('scope must be a plain object containing exactly ownerId, characterId, and worldId');
    if (!hasExactOwnKeys(limits, ['maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries']) ||
        !['maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries'].every((key) =>
          Number.isSafeInteger(limits[key]) && limits[key] > 0) || limits.maxEntries > 256) {
      throw new TypeError('limits must contain positive safe integers; maxEntries must be at most 256');
    }
    this.#scope = { ownerId: scope.ownerId, characterId: scope.characterId, worldId: scope.worldId };
    this.#limits = { maxCalls: limits.maxCalls, maxTokens: limits.maxTokens,
      maxCostUnits: limits.maxCostUnits, maxEntries: limits.maxEntries };
  }

  reserve(input = {}) {
    if (!hasExactOwnKeys(input, ['requestId', 'kind', 'inputTokens', 'outputTokens', 'maxCostUnits', 'countMode'])) {
      return { ok: false, why: 'invalid_reservation' };
    }
    const { requestId, kind, inputTokens, outputTokens, maxCostUnits, countMode } = input;
    if (!this.#validId(requestId) || !KINDS.has(kind) || !isSafeInt(inputTokens) ||
        !isSafeInt(outputTokens) || !isSafeInt(maxCostUnits) ||
        !MODES.has(countMode) || checkedAdd(inputTokens, outputTokens) === null || inputTokens + outputTokens === 0) {
      return { ok: false, why: 'invalid_reservation' };
    }
    const prior = this.#entries.get(requestId);
    const requested = { requestId, kind, inputTokens, outputTokens, tokens: inputTokens + outputTokens,
      maxCostUnits, countMode };
    if (prior) return this.#sameReservation(prior, requested)
      ? { ok: true, entry: this.#copyEntry(prior), replay: true }
      : { ok: false, why: 'request_id_conflict' };
    if (this.#overrun) return { ok: false, why: 'budget_overrun' };
    if (this.#entries.size >= this.#limits.maxEntries) return { ok: false, why: 'entry_capacity' };
    const calls = this.#callCount();
    const heldTokens = this.#held('tokens');
    const heldCost = this.#held('cost');
    const tokens = checkedAdd(this.#confirmedTokens, heldTokens);
    const cost = checkedAdd(this.#confirmedCost, heldCost);
    if (calls === null || tokens === null || cost === null) return { ok: false, why: 'totals_overflow' };
    if (calls >= this.#limits.maxCalls) return { ok: false, why: 'max_calls' };
    if (tokens > this.#limits.maxTokens - requested.tokens) return { ok: false, why: 'max_tokens' };
    if (cost > this.#limits.maxCostUnits - maxCostUnits) return { ok: false, why: 'max_cost_units' };
    const entry = { ...requested, state: 'reserved', usage: null, unknownReason: null, overrun: false };
    this.#entries.set(requestId, entry);
    return { ok: true, entry: this.#copyEntry(entry), replay: false };
  }

  cancelBeforeDispatch(requestId) {
    const entry = this.#entries.get(requestId);
    if (!entry || entry.state !== 'reserved') return { ok: false, why: 'not_reserved' };
    entry.state = 'cancelled';
    return { ok: true, entry: this.#copyEntry(entry) };
  }

  markDispatched(requestId) {
    const entry = this.#entries.get(requestId);
    if (!entry || entry.state !== 'reserved') return { ok: false, why: 'not_reserved' };
    entry.state = 'inflight';
    return { ok: true, entry: this.#copyEntry(entry) };
  }

  settle(requestId, usage) {
    const entry = this.#entries.get(requestId);
    if (!entry || !['inflight', 'unknown', 'settled'].includes(entry.state)) return { ok: false, why: 'not_settleable' };
    if (!hasExactOwnKeys(usage, ['inputTokens', 'outputTokens', 'costUnits']) ||
        !isSafeInt(usage.inputTokens) || !isSafeInt(usage.outputTokens) || !isSafeInt(usage.costUnits)) {
      return { ok: false, why: 'invalid_usage' };
    }
    const normalized = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUnits: usage.costUnits };
    if (entry.state === 'settled') return this.#sameUsage(entry.usage, normalized)
      ? { ok: true, entry: this.#copyEntry(entry), replay: true }
      : { ok: false, why: 'usage_conflict' };
    const tokens = checkedAdd(normalized.inputTokens, normalized.outputTokens);
    const totalTokens = tokens === null ? null : checkedAdd(this.#confirmedTokens, tokens);
    const totalCost = checkedAdd(this.#confirmedCost, normalized.costUnits);
    if (totalTokens === null || totalCost === null) {
      this.#overrun = true;
      return { ok: false, why: 'totals_overflow' };
    }
    entry.state = 'settled';
    entry.usage = normalized;
    this.#confirmedTokens = totalTokens;
    this.#confirmedCost = totalCost;
    entry.overrun = normalized.inputTokens > entry.inputTokens || normalized.outputTokens > entry.outputTokens ||
      normalized.costUnits > entry.maxCostUnits;
    const heldTokens = this.#held('tokens');
    const heldCost = this.#held('cost');
    this.#overrun = this.#overrun || entry.overrun || heldTokens === null || heldCost === null ||
      this.#confirmedTokens > this.#limits.maxTokens - heldTokens ||
      this.#confirmedCost > this.#limits.maxCostUnits - heldCost;
    return { ok: true, entry: this.#copyEntry(entry), replay: false, overrun: this.#overrun };
  }

  markUnknown(requestId, why) {
    const entry = this.#entries.get(requestId);
    if (!entry || !['inflight', 'unknown'].includes(entry.state)) return { ok: false, why: 'not_inflight' };
    if (typeof why !== 'string' || why.length === 0 || why.length > 500) return { ok: false, why: 'invalid_reason' };
    if (entry.state === 'unknown') return entry.unknownReason === why
      ? { ok: true, entry: this.#copyEntry(entry), replay: true }
      : { ok: false, why: 'unknown_reason_conflict' };
    entry.state = 'unknown';
    entry.unknownReason = why;
    return { ok: true, entry: this.#copyEntry(entry), replay: false };
  }

  get snapshot() {
    const heldTokens = this.#visibleHeld('tokens');
    const heldCost = this.#visibleHeld('cost');
    const unresolvedHeldTokens = this.#unresolvedHeld('tokens');
    const unresolvedHeldCost = this.#unresolvedHeld('cost');
    const unresolved = [...this.#entries.values()].filter((entry) => entry.state === 'unknown');
    const unresolvedTokens = unresolved.reduce((sum, entry) => sum + entry.tokens, 0);
    const unresolvedCostUnits = unresolved.reduce((sum, entry) => sum + entry.maxCostUnits, 0);
    const calls = this.#callCount();
    return {
      scope: { ...this.#scope }, limits: { ...this.#limits },
      totals: { calls, confirmedTokens: this.#confirmedTokens, confirmedCostUnits: this.#confirmedCost,
        heldTokens, heldCostUnits: heldCost, unresolvedTokens, unresolvedCostUnits,
        availableTokens: Math.max(0, this.#limits.maxTokens - this.#confirmedTokens - heldTokens - unresolvedHeldTokens),
        availableCostUnits: Math.max(0, this.#limits.maxCostUnits - this.#confirmedCost - heldCost - unresolvedHeldCost),
        entries: this.#entries.size, reservedEntries: this.#count('reserved'), inflightEntries: this.#count('inflight'),
        unknownEntries: unresolved.length, settledEntries: this.#count('settled'), cancelledEntries: this.#count('cancelled'),
        overrun: this.#overrun,
      },
      entries: [...this.#entries.values()].map((entry) => this.#copyEntry(entry)),
    };
  }

  #validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(id); }
  #count(state) { return [...this.#entries.values()].filter((e) => e.state === state).length; }
  #callCount() { return [...this.#entries.values()].filter((e) => e.state !== 'cancelled').length; }
  #held(which) {
    let total = 0;
    for (const e of this.#entries.values()) if (['reserved', 'inflight', 'unknown'].includes(e.state)) {
      const value = which === 'tokens' ? e.tokens : e.maxCostUnits;
      const next = checkedAdd(total, value);
      if (next === null) return null;
      total = next;
    }
    return total;
  }
  #visibleHeld(which) {
    let total = 0;
    for (const e of this.#entries.values()) if (['reserved', 'inflight'].includes(e.state)) {
      const next = checkedAdd(total, which === 'tokens' ? e.tokens : e.maxCostUnits);
      if (next === null) return null;
      total = next;
    }
    return total;
  }
  #unresolvedHeld(which) {
    let total = 0;
    for (const e of this.#entries.values()) if (e.state === 'unknown') {
      const next = checkedAdd(total, which === 'tokens' ? e.tokens : e.maxCostUnits);
      if (next === null) return null;
      total = next;
    }
    return total;
  }
  #sameReservation(entry, requested) {
    return ['requestId', 'kind', 'inputTokens', 'outputTokens', 'tokens', 'maxCostUnits', 'countMode']
      .every((key) => entry[key] === requested[key]);
  }
  #sameUsage(a, b) { return a && a.inputTokens === b.inputTokens && a.outputTokens === b.outputTokens && a.costUnits === b.costUnits; }
  #copyEntry(entry) { return { ...entry, usage: entry.usage ? { ...entry.usage } : null }; }
}
