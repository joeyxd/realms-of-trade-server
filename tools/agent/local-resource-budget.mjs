import path from 'node:path';
import { InferenceBudget } from './inference-budget.mjs';
import { createBudgetFile } from './budget-file.mjs';

const SCHEMA = 'agent-local-resource-budget/v1';
const MAX_EVENTS = 2048;
const safe = (value) => Number.isSafeInteger(value) && value >= 0;
const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);
const clone = (value) => structuredClone(value);
const exact = (value, keys) => {
  try { return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')); }
  catch { return false; }
};
const scopeValid = (value) => exact(value, ['ownerId', 'characterId', 'worldId']) &&
  Object.values(value).every((item) => typeof item === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(item));
const sameScope = (a, b) => scopeValid(a) && scopeValid(b) &&
  ['ownerId', 'characterId', 'worldId'].every((key) => a[key] === b[key]);
const limitsValid = (value) => exact(value, ['maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries']) &&
  Object.values(value).every((item) => Number.isSafeInteger(item) && item > 0) && value.maxEntries <= 256;
const policyValid = (value) => exact(value, ['baseUrl', 'modelId', 'thinkingMode']) &&
  typeof value.baseUrl === 'string' && /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/v1\/?$/.test(value.baseUrl) &&
  typeof value.modelId === 'string' && /^[A-Za-z0-9._:/-]{1,160}$/.test(value.modelId) &&
  ['server_default', 'disabled'].includes(value.thinkingMode) && (() => {
    try {
      const url = new URL(value.baseUrl);
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port || 80) <= 65535 &&
        !url.username && !url.password && !url.search && !url.hash && ['/v1', '/v1/'].includes(url.pathname);
    } catch { return false; }
  })();
const samePolicy = (a, b) => policyValid(a) && policyValid(b) &&
  a.baseUrl === b.baseUrl && a.modelId === b.modelId && a.thinkingMode === b.thinkingMode;
const inputValid = (value) => exact(value, ['requestId', 'kind', 'inputTokens', 'outputTokens', 'maxCostUnits', 'countMode']) &&
  id(value.requestId) && ['decision', 'compaction', 'embedding', 'retry'].includes(value.kind) &&
  safe(value.inputTokens) && value.inputTokens > 0 && safe(value.outputTokens) && value.outputTokens > 0 &&
  Number.isSafeInteger(value.inputTokens + value.outputTokens) && value.countMode === 'estimated_tokens' &&
  value.maxCostUnits === value.inputTokens + value.outputTokens;
const usageValid = (value) => exact(value, ['inputTokens', 'outputTokens', 'costUnits']) &&
  safe(value.inputTokens) && value.inputTokens > 0 && safe(value.outputTokens) && value.outputTokens >= 0 &&
  Number.isSafeInteger(value.inputTokens + value.outputTokens) && value.costUnits === value.inputTokens + value.outputTokens;
const fail = (why) => ({ ok: false, why });
const copyLimits = (value) => ({ maxCalls: value.maxCalls, maxTokens: value.maxTokens,
  maxCostUnits: value.maxCostUnits, maxEntries: value.maxEntries });
const activeWhy = (state, nowMs) => !safe(nowMs) ? 'invalid_clock' : nowMs >= state.expiresAtMs ? 'local_resource_budget_expired' : null;

function validateOptions(options, { needsLimits = false } = {}) {
  if (!exact(options, ['directory', 'scope', ...(needsLimits ? ['limits'] : []), 'expiresAtMs', 'baseUrl', 'modelId', 'thinkingMode', ...(Object.hasOwn(options ?? {}, 'now') ? ['now'] : [])]) ||
      typeof options.directory !== 'string' || !path.isAbsolute(options.directory) || !scopeValid(options.scope) ||
      !safe(options.expiresAtMs) || !policyValid({ baseUrl: options.baseUrl, modelId: options.modelId, thinkingMode: options.thinkingMode }) ||
      (needsLimits && !limitsValid(options.limits)) || (options.now !== undefined && typeof options.now !== 'function')) {
    throw new TypeError('invalid local resource budget options');
  }
  return { ...options, directory: path.resolve(options.directory), scope: clone(options.scope),
    policy: { baseUrl: options.baseUrl, modelId: options.modelId, thinkingMode: options.thinkingMode },
    ...(needsLimits ? { limits: copyLimits(options.limits) } : {}), now: options.now ?? Date.now };
}

function view(state, replay, nowMs, { cached = false, lastError = null, restartBlocked = replay.unresolvedOnOpen === true } = {}) {
  const snapshot = replay.budget.snapshot;
  const { totals, limits } = snapshot;
  const admissionWhy = activeWhy(state, nowMs) ?? (restartBlocked ? 'local_resource_outcome_unresolved' :
    totals.overrun ? 'budget_overrun' : totals.calls >= limits.maxCalls ? 'max_calls' :
      totals.availableTokens === 0 ? 'max_tokens' : totals.availableCostUnits === 0 ? 'max_cost_units' : null);
  return { ...snapshot,
    costNanoUsd: null,
    persistence: { schema: SCHEMA, revision: state.events.length, unit: 'local_compute_tokens',
      costNanoUsd: null, policy: clone(state.policy), expiresAtMs: state.expiresAtMs,
      unresolvedOnOpen: restartBlocked, admissionWhy,
      automaticReset: false, automaticReconciliation: false, coordinatedWriters: 'local_cooperative', cached, lastError },
  };
}

function replay(state, scope, policy, expiresAtMs = state?.expiresAtMs) {
  if (!exact(state, ['schema', 'scope', 'limits', 'expiresAtMs', 'policy', 'events']) || state.schema !== SCHEMA ||
      !sameScope(state.scope, scope) || !limitsValid(state.limits) || !safe(state.expiresAtMs) ||
      state.expiresAtMs !== expiresAtMs || !policyValid(state.policy) || !samePolicy(state.policy, policy) ||
      !Array.isArray(state.events) || state.events.length > MAX_EVENTS || Reflect.ownKeys(state.events).length !== state.events.length + 1) throw new Error('local_resource_budget_invalid_state');
  const budget = new InferenceBudget({ scope, limits: copyLimits(state.limits) });
  let lastAtMs = 0;
  for (let index = 0; index < state.events.length; index++) {
    const d = Object.getOwnPropertyDescriptor(state.events, String(index));
    if (!d || !Object.hasOwn(d, 'value')) throw new Error('local_resource_budget_invalid_state');
    const event = d.value;
    const fields = { reserve: ['input', 'expiresAtMs'], dispatch: ['requestId', 'expiresAtMs'],
      cancel: ['requestId'], unknown: ['requestId', 'reason'], settle: ['requestId', 'usage'] };
    if (!event || !Object.hasOwn(fields, event.type) || !exact(event, ['type', 'atMs', ...fields[event.type]]) ||
        !safe(event.atMs) || event.atMs < lastAtMs) throw new Error('local_resource_budget_invalid_state');
    if (['reserve', 'dispatch'].includes(event.type) &&
        (event.expiresAtMs !== state.expiresAtMs || activeWhy(state, event.atMs))) throw new Error('local_resource_budget_invalid_state');
    lastAtMs = event.atMs;
    let result;
    if (event.type === 'reserve') {
      if (!inputValid(event.input)) throw new Error('local_resource_budget_invalid_state');
      result = budget.reserve(event.input);
    } else {
      if (!id(event.requestId)) throw new Error('local_resource_budget_invalid_state');
      if (event.type === 'dispatch') result = budget.markDispatched(event.requestId);
      else if (event.type === 'cancel') result = budget.cancelBeforeDispatch(event.requestId);
      else if (event.type === 'unknown') {
        if (!['inference_error', 'inference_timeout', 'inference_cancelled', 'usage_unknown'].includes(event.reason)) throw new Error('local_resource_budget_invalid_state');
        result = budget.markUnknown(event.requestId, event.reason);
      } else {
        if (!usageValid(event.usage)) throw new Error('local_resource_budget_invalid_state');
        result = budget.settle(event.requestId, event.usage);
      }
    }
    if (!result.ok || result.replay) throw new Error('local_resource_budget_invalid_state');
  }
  const hasUnresolved = budget.snapshot.entries.some((entry) => ['inflight', 'unknown'].includes(entry.state));
  return { budget, lastAtMs, hasUnresolved };
}

/** Durable, non-monetary allowance for one loopback model policy and scope. */
export class LocalResourceBudget extends InferenceBudget {
  #file; #scope; #policy; #expiresAtMs; #now; #queue = Promise.resolve(); #snapshot; #restartBlocked = false;

  static async initialize(options) {
    const config = validateOptions(options, { needsLimits: true });
    const file = createBudgetFile({ directory: config.directory });
    const state = { schema: SCHEMA, scope: config.scope, limits: config.limits,
      expiresAtMs: config.expiresAtMs, policy: config.policy, events: [] };
    const transaction = await file.transact(({ value }) => value === null
      ? { value: state, result: { ok: true } } : { value: null, result: fail('local_resource_budget_exists') });
    if (!transaction.ok) throw new Error(transaction.why);
    if (!transaction.result.ok) throw new Error(transaction.result.why);
    return LocalResourceBudget.#from(config, file, state);
  }

  static async open(options) {
    const config = validateOptions(options);
    const file = createBudgetFile({ directory: config.directory });
    const loaded = await file.read();
    if (!loaded.ok) throw new Error(loaded.why);
    if (loaded.value === null) throw new Error('local_resource_budget_uninitialized');
    const parsed = replay(loaded.value, config.scope, config.policy, config.expiresAtMs);
    return LocalResourceBudget.#from(config, file, loaded.value, parsed);
  }

  static #from(config, file, state, parsed = replay(state, config.scope, config.policy, config.expiresAtMs)) {
    const instance = new LocalResourceBudget(config, file, parsed);
    instance.#restartBlocked = parsed.hasUnresolved;
    instance.#snapshot = view(state, parsed, config.now(), { restartBlocked: instance.#restartBlocked });
    return instance;
  }

  constructor(config, file, parsed) {
    super({ scope: config.scope, limits: config.limits ?? parsed.budget.snapshot.limits });
    this.#file = file; this.#scope = config.scope; this.#policy = config.policy;
    this.#expiresAtMs = config.expiresAtMs; this.#now = config.now;
  }

  get snapshot() {
    const snapshot = clone(this.#snapshot);
    const nowMs = this.#now();
    const active = activeWhy({ expiresAtMs: this.#expiresAtMs }, nowMs);
    const { totals, limits } = snapshot;
    snapshot.persistence.cached = true;
    snapshot.persistence.admissionWhy = active ?? (this.#restartBlocked ? 'local_resource_outcome_unresolved' :
      totals.overrun ? 'budget_overrun' : totals.calls >= limits.maxCalls ? 'max_calls' :
        totals.availableTokens === 0 ? 'max_tokens' : totals.availableCostUnits === 0 ? 'max_cost_units' : null);
    return snapshot;
  }

  assertAdapter(adapter) {
    const expected = this.#policy;
    const actual = adapter?.localResourcePolicy;
    if (adapter?.metering !== undefined || adapter?.countMode !== 'estimated_tokens' || !policyValid(actual) ||
        !samePolicy(actual, expected)) throw new TypeError('local_resource_adapter_mismatch');
  }

  #call(type, payload = {}) {
    const pending = this.#queue.then(async () => {
      let receipt;
      const nowMs = this.#now();
      if (!safe(nowMs)) return fail('invalid_clock');
      const transaction = await this.#file.transact(({ value }) => {
        if (value === null) return { value: null, result: fail('local_resource_budget_uninitialized') };
        let parsed;
        try { parsed = replay(value, this.#scope, this.#policy, this.#expiresAtMs); }
        catch { return { value: null, result: fail('local_resource_budget_invalid_state') }; }
        if (nowMs < parsed.lastAtMs) return { value: null, result: fail('local_resource_budget_clock_rewind') };
        const base = view(value, parsed, nowMs, { restartBlocked: this.#restartBlocked });
        const unchanged = (result) => ({ value: null, result: { ...result, snapshot: clone(base) } });
        const active = activeWhy(value, nowMs);
        if (active && ['reserve', 'dispatch'].includes(type)) return unchanged(fail(active));
        if (type === 'reserve') {
          if (this.#restartBlocked || parsed.hasUnresolved)
            return unchanged(fail('local_resource_outcome_unresolved'));
          if (!inputValid(payload.input)) return unchanged(fail('invalid_reservation'));
          if (payload.input.maxCostUnits > value.limits.maxCostUnits) return unchanged(fail('max_cost_units'));
          receipt = parsed.budget.reserve(payload.input);
        } else if (type === 'dispatch') {
          if (this.#restartBlocked || parsed.hasUnresolved)
            return unchanged(fail('local_resource_outcome_unresolved'));
          if (parsed.budget.snapshot.totals.overrun) return unchanged(fail('budget_overrun'));
          receipt = parsed.budget.markDispatched(payload.requestId);
        } else if (type === 'cancel') receipt = parsed.budget.cancelBeforeDispatch(payload.requestId);
        else if (type === 'unknown') receipt = parsed.budget.markUnknown(payload.requestId, payload.reason);
        else receipt = parsed.budget.settle(payload.requestId, payload.usage);
        if (!receipt.ok || receipt.replay) return unchanged(receipt);
        if (value.events.length >= MAX_EVENTS) return unchanged(fail('local_resource_event_capacity'));
        const next = clone(value);
        next.events.push({ type, atMs: nowMs,
          ...(['reserve', 'dispatch'].includes(type) ? { ...clone(payload), expiresAtMs: this.#expiresAtMs } : clone(payload)) });
        let checked;
        try { checked = replay(next, this.#scope, this.#policy, this.#expiresAtMs); }
        catch { return unchanged(fail('local_resource_budget_invalid_state')); }
        const updated = view(next, checked, nowMs, { restartBlocked: this.#restartBlocked || type === 'unknown' });
        return { value: next, result: { ...receipt, snapshot: updated } };
      });
      if (!transaction.ok) {
        if (this.#snapshot?.persistence) this.#snapshot.persistence.lastError = transaction.why;
        return fail(transaction.why);
      }
      receipt = transaction.result;
      if (type === 'unknown' && receipt.ok) this.#restartBlocked = true;
      if (receipt.snapshot) this.#snapshot = receipt.snapshot;
      return receipt;
    });
    this.#queue = pending.catch(() => {});
    return pending;
  }

  reserve(input) { return this.#call('reserve', { input: clone(input) }); }
  markDispatched(requestId) { return this.#call('dispatch', { requestId }); }
  cancelBeforeDispatch(requestId) { return this.#call('cancel', { requestId }); }
  markUnknown(requestId, reason) { return this.#call('unknown', { requestId, reason }); }
  settle(requestId, usage) { return this.#call('settle', { requestId, usage: clone(usage) }); }

  async checkActive(requestId) {
    const pending = this.#queue.then(async () => {
      const loaded = await this.#file.read();
      if (!loaded.ok) {
        if (this.#snapshot?.persistence) this.#snapshot.persistence.lastError = loaded.why;
        return fail(loaded.why);
      }
      try {
        const parsed = replay(loaded.value, this.#scope, this.#policy, this.#expiresAtMs), nowMs = this.#now();
        const entry = parsed.budget.snapshot.entries.find((item) => item.requestId === requestId);
        const why = activeWhy(loaded.value, nowMs);
        if (why) return fail(why);
        if (!entry || !['inflight', 'unknown', 'settled'].includes(entry.state)) return fail('local_resource_request_inactive');
        if (this.#restartBlocked) return fail('local_resource_outcome_unresolved');
        this.#snapshot = view(loaded.value, parsed, nowMs, { restartBlocked: this.#restartBlocked });
        return { ok: true, snapshot: this.snapshot };
      } catch {
        if (this.#snapshot?.persistence) this.#snapshot.persistence.lastError = 'local_resource_budget_invalid_state';
        return fail('local_resource_budget_invalid_state');
      }
    });
    this.#queue = pending.catch(() => {});
    return pending;
  }

  setLimits() { throw new Error('local_resource_policy_immutable'); }
}
