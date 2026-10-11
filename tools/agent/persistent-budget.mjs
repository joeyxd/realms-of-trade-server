import { InferenceBudget } from './inference-budget.mjs';
import { createBudgetFile } from './budget-file.mjs';
import { validMetering, meteringHash, meteredCost } from './inference-metering.mjs';

const SCHEMA = 'agent-inference-budget/v1';
const NATIVE_SCHEMA = 'agent-inference-budget/v2';
const MAX_EVENTS = 2048;
const safe = (v) => Number.isSafeInteger(v) && v >= 0;
const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(v);
const clone = (v) => structuredClone(v);
const exact = (v, keys) => {
  try { return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype &&
    Reflect.ownKeys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k) && 'value' in Object.getOwnPropertyDescriptor(v, k)); }
  catch { return false; }
};
const scopeValid = (v) => exact(v, ['ownerId', 'characterId', 'worldId']) && Object.values(v).every(id);
const sameScope = (a, b) => scopeValid(a) && scopeValid(b) && Object.keys(a).every((k) => a[k] === b[k]);
const limitsValid = (v) => exact(v, ['maxCalls', 'maxTokens', 'maxCostUnits', 'maxEntries']) &&
  Object.values(v).every((n) => safe(n) && n > 0) && v.maxEntries <= 256;
const reasonValid = (v) => ['inference_error', 'inference_timeout', 'inference_cancelled', 'usage_unknown', 'owner_reconciliation'].includes(v);
const fail = (why) => ({ ok: false, why });
const inputShapeValid = (v) => exact(v, ['requestId', 'kind', 'inputTokens', 'outputTokens', 'maxCostUnits', 'countMode']) &&
  id(v.requestId) && ['decision', 'compaction', 'embedding', 'retry'].includes(v.kind) &&
  [v.inputTokens, v.outputTokens, v.maxCostUnits].every(safe) && safe(v.inputTokens + v.outputTokens) &&
  v.inputTokens + v.outputTokens > 0;
const inputValid = (v, metering = null) => inputShapeValid(v) && (metering === null ? v.countMode === 'simulated_tokens' :
  ['measured_tokens', 'estimated_tokens'].includes(v.countMode) && meteredCost(metering, v.inputTokens, v.outputTokens) === v.maxCostUnits);
const usageValid = (v) => exact(v, ['inputTokens', 'outputTokens', 'costUnits']) && Object.values(v).every(safe);
const nativeUsageValid = (v, metering) => usageValid(v) && meteredCost(metering, v.inputTokens, v.outputTokens) === v.costUnits;
const activeWhy = (state, enabled, nowMs) => !safe(nowMs) ? 'invalid_clock' : !enabled ? 'budget_revoked' :
  nowMs < state.period.startsAtMs ? 'budget_not_started' : nowMs >= state.period.endsAtMs ? 'budget_expired' : null;
const dispatchWhy = (budget) => {
  const { totals: t, limits: l } = budget.snapshot;
  if (t.overrun) return 'budget_overrun';
  if (t.calls > l.maxCalls) return 'max_calls';
  if (l.maxTokens - t.confirmedTokens - t.heldTokens - t.unresolvedTokens < 0) return 'max_tokens';
  if (l.maxCostUnits - t.confirmedCostUnits - t.heldCostUnits - t.unresolvedCostUnits < 0) return 'max_cost_units';
  return null;
};
const terminalHeadroom = (budget) => budget.snapshot.entries.reduce((sum, entry) =>
  sum + ({ reserved: 3, inflight: 2, unknown: 1 }[entry.state] ?? 0), 0);

// Replay the bounded evidence, never trust cached totals supplied by an owner file.
export function replayPersistentBudget(state, scope) {
  const native = exact(state, ['schema', 'scope', 'allowanceId', 'period', 'initialLimits', 'events', 'metering']) && state.schema === NATIVE_SCHEMA;
  if (!(native ? validMetering(state.metering) : exact(state, ['schema', 'scope', 'allowanceId', 'period', 'initialLimits', 'events']) && state.schema === SCHEMA) ||
      !sameScope(state.scope, scope) || !id(state.allowanceId) || !limitsValid(state.initialLimits) ||
      !exact(state.period, ['startsAtMs', 'endsAtMs']) || !Object.values(state.period).every(safe) ||
      state.period.startsAtMs >= state.period.endsAtMs || !Array.isArray(state.events) || state.events.length > MAX_EVENTS ||
      Object.getPrototypeOf(state.events) !== Array.prototype || Reflect.ownKeys(state.events).length !== state.events.length + 1)
    throw new Error('budget_invalid_state');
  const budget = new InferenceBudget({ scope, limits: state.initialLimits });
  const metering = native ? state.metering : null;
  const policyHash = native ? meteringHash(metering) : null;
  let enabled = true, policyRevision = 1, lastAtMs = 0;
  const dispatchedPolicies = new Map(), usageSources = new Map();
  for (let index = 0; index < state.events.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(state.events, String(index));
    if (!descriptor || !('value' in descriptor)) throw new Error('budget_invalid_state');
    const event = descriptor.value;
    const keys = { reserve: ['input', ...(native ? ['meteringSha256'] : [])], dispatch: ['requestId'], cancel: ['requestId'],
      unknown: ['requestId', 'reason'], settle: ['requestId', 'usage', 'usageSource', ...(native ? ['meteringSha256'] : [])], configure: ['enabled', 'limits'] };
    const typeDescriptor = event && Object.getOwnPropertyDescriptor(event, 'type');
    if (!typeDescriptor || !('value' in typeDescriptor) || !Object.hasOwn(keys, typeDescriptor.value) || !exact(event, ['type', 'atMs', ...keys[typeDescriptor.value]]) ||
        !safe(event.atMs) || event.atMs < lastAtMs) throw new Error('budget_invalid_state');
    lastAtMs = event.atMs;
    if (native && ['reserve', 'settle'].includes(event.type) && event.meteringSha256 !== policyHash) throw new Error('budget_invalid_state');
    let result;
    if (event.type === 'configure') {
      if (typeof event.enabled !== 'boolean' || !limitsValid(event.limits)) throw new Error('budget_invalid_state');
      result = budget.setLimits(event.limits); enabled = event.enabled; policyRevision++;
    } else if (event.type === 'reserve') {
      if (activeWhy(state, enabled, event.atMs) || !inputValid(event.input, metering)) throw new Error('budget_invalid_state');
      result = budget.reserve(event.input);
    } else {
      if (!id(event.requestId)) throw new Error('budget_invalid_state');
      if (event.type === 'dispatch') {
        if (activeWhy(state, enabled, event.atMs) || dispatchWhy(budget)) throw new Error('budget_invalid_state');
        result = budget.markDispatched(event.requestId); dispatchedPolicies.set(event.requestId, policyRevision);
      } else if (event.type === 'cancel') result = budget.cancelBeforeDispatch(event.requestId);
      else if (event.type === 'unknown') {
        if (!reasonValid(event.reason)) throw new Error('budget_invalid_state');
        result = budget.markUnknown(event.requestId, event.reason);
      } else {
        if (!(native ? nativeUsageValid(event.usage, metering) : usageValid(event.usage)) ||
            ![native ? 'adapter_native' : 'adapter_simulated', 'owner_supplied'].includes(event.usageSource)) throw new Error('budget_invalid_state');
        if (native && event.usageSource === 'owner_supplied' &&
            budget.snapshot.entries.some((entry) => entry.requestId === event.requestId && entry.state === 'inflight'))
          throw new Error('budget_invalid_state');
        result = budget.settle(event.requestId, event.usage);
        if (result.ok) usageSources.set(event.requestId, event.usageSource);
        // Arithmetic overflow latches the admission gate and remains durable evidence.
        if (!result.ok && result.why === 'totals_overflow') continue;
      }
    }
    if (!result.ok || result.replay) throw new Error('budget_invalid_state');
  }
  return { budget, enabled, policyRevision, dispatchedPolicies, usageSources, lastAtMs };
}

function view(state, replay, nowMs) {
  const snapshot = replay.budget.snapshot;
  const native = state.schema === NATIVE_SCHEMA;
  snapshot.entries = snapshot.entries.map((entry) => ({ ...entry, usageSource: replay.usageSources.get(entry.requestId) ?? null,
    ...(native ? { meteringSha256: meteringHash(state.metering), chargeSource: entry.usage ? 'pinned_rate_calculation' : null,
      invoiceCostUnits: null } : {}) }));
  return { ...snapshot, ...(native ? { metering: clone(state.metering), meteringSha256: meteringHash(state.metering) } : {}),
    persistence: { schema: state.schema, allowanceId: state.allowanceId, revision: state.events.length,
    policyRevision: replay.policyRevision, enabled: replay.enabled, period: clone(state.period),
    unit: native ? state.metering.unit : 'simulated_cost_units', admissionWhy: activeWhy(state, replay.enabled, nowMs),
    ...(native ? { chargeBasis: 'owner_pinned_uncached_rates', invoiceConfirmed: false, automaticProviderReconciliation: false } : {}),
    automaticReset: false, coordinatedWriters: 'local_cooperative', cached: false, lastError: null } };
}

export function createBudgetAdministration({ directory, scope, now = Date.now }) {
  if (!scopeValid(scope) || typeof now !== 'function') throw new TypeError('invalid budget configuration');
  scope = clone(scope);
  const file = createBudgetFile({ directory });
  async function initialize(request) {
    const native = exact(request, ['allowanceId', 'period', 'limits', 'metering']);
    if (!exact(request, ['allowanceId', 'period', 'limits', ...(native ? ['metering'] : [])]) ||
        (native && !validMetering(request.metering)) || !id(request.allowanceId) || !limitsValid(request.limits) ||
        !exact(request.period, ['startsAtMs', 'endsAtMs']) || !Object.values(request.period).every(safe) ||
        request.period.startsAtMs >= request.period.endsAtMs) return fail('invalid_policy');
    request = clone(request);
    const result = await file.transact(({ value }) => {
      if (value !== null) return { value: null, result: fail('budget_exists') };
      const state = { schema: native ? NATIVE_SCHEMA : SCHEMA, scope, allowanceId: request.allowanceId, period: request.period, initialLimits: request.limits,
        ...(native ? { metering: request.metering } : {}), events: [] };
      const replay = replayPersistentBudget(state, scope);
      return { value: state, result: { ok: true, snapshot: view(state, replay, now()) } };
    });
    return result.ok ? result.result : result;
  }
  async function inspect() {
    const result = await file.read();
    if (!result.ok) return result;
    if (result.value === null) return fail('budget_uninitialized');
    try { return { ok: true, snapshot: view(result.value, replayPersistentBudget(result.value, scope), now()) }; }
    catch { return fail('budget_invalid_state'); }
  }
  async function mutate(type, payload) {
    const atMs = now();
    if (!safe(atMs)) return fail('invalid_clock');
    const result = await file.transact(({ value }) => {
      if (value === null) return { value: null, result: fail('budget_uninitialized') };
      const replay = replayPersistentBudget(value, scope);
      if (atMs < replay.lastAtMs) return { value: null, result: fail('budget_clock_rewind') };
      const originalSnapshot = view(value, replay, atMs);
      const unchanged = (receipt) => ({ value: null, result: { ...receipt, snapshot: clone(originalSnapshot) } });
      const native = value.schema === NATIVE_SCHEMA;
      if (type === 'reserve' && !inputValid(payload.input, native ? value.metering : null)) return unchanged(fail('invalid_reservation'));
      if (type === 'settle' && (!(native ? nativeUsageValid(payload.usage, value.metering) : usageValid(payload.usage)) ||
          ![native ? 'adapter_native' : 'adapter_simulated', 'owner_supplied'].includes(payload.usageSource))) return unchanged(fail('invalid_usage'));
      if (native && type === 'settle' && payload.usageSource === 'owner_supplied' &&
          replay.budget.snapshot.entries.some((entry) => entry.requestId === payload.requestId && entry.state === 'inflight'))
        return unchanged(fail('manual_reconciliation_requires_unknown'));
      if (['reserve', 'dispatch'].includes(type)) {
        const why = activeWhy(value, replay.enabled, atMs);
        if (why) return unchanged(fail(why));
      }
      if (type === 'configure' && payload.expectedRevision !== value.events.length) return unchanged(fail('budget_revision_conflict'));
      if (type === 'dispatch') { const why = dispatchWhy(replay.budget); if (why) return unchanged(fail(why)); }
      if (value.events.length >= MAX_EVENTS) return unchanged(fail('budget_event_capacity'));
      let receipt;
      if (type === 'reserve') receipt = replay.budget.reserve(payload.input);
      else if (type === 'dispatch') receipt = replay.budget.markDispatched(payload.requestId);
      else if (type === 'cancel') receipt = replay.budget.cancelBeforeDispatch(payload.requestId);
      else if (type === 'unknown') receipt = replay.budget.markUnknown(payload.requestId, payload.reason);
      else if (type === 'settle') receipt = replay.budget.settle(payload.requestId, payload.usage);
      else receipt = replay.budget.setLimits(payload.limits);
      if (receipt.replay || !receipt.ok && receipt.why !== 'totals_overflow') return unchanged(receipt);
      const { expectedRevision, ...fields } = payload;
      if (native && ['reserve', 'settle'].includes(type)) fields.meteringSha256 = meteringHash(value.metering);
      const next = clone(value); next.events.push({ type, atMs, ...fields });
      const checked = replayPersistentBudget(next, scope);
      // Owner edits and fresh reservations cannot consume space needed for reconciliation.
      if (next.events.length + terminalHeadroom(checked.budget) > MAX_EVENTS) return unchanged(fail('budget_event_capacity'));
      return { value: next, result: { ...receipt, snapshot: view(next, checked, atMs) } };
    });
    return result.ok ? result.result : result;
  }
  return {
    initialize, inspect,
    configure: (request) => exact(request, ['expectedRevision', 'enabled', 'limits']) && safe(request.expectedRevision) &&
      typeof request.enabled === 'boolean' && limitsValid(request.limits) ? mutate('configure', clone(request)) : Promise.resolve(fail('invalid_policy')),
    reserve: (input) => inputShapeValid(input) ? mutate('reserve', { input: clone(input) }) : Promise.resolve(fail('invalid_reservation')),
    markDispatched: (requestId) => id(requestId) ? mutate('dispatch', { requestId }) : Promise.resolve(fail('invalid_request_id')),
    cancelBeforeDispatch: (requestId) => id(requestId) ? mutate('cancel', { requestId }) : Promise.resolve(fail('invalid_request_id')),
    markUnknown: (requestId, reason) => id(requestId) && reasonValid(reason) ? mutate('unknown', { requestId, reason }) : Promise.resolve(fail('invalid_reason')),
    settle: (requestId, usage, usageSource = 'owner_supplied') => id(requestId) && usageValid(usage) && ['adapter_simulated', 'adapter_native', 'owner_supplied'].includes(usageSource) ?
      mutate('settle', { requestId, usage: clone(usage), usageSource }) : Promise.resolve(fail('invalid_usage')),
    async checkActive(requestId) {
      const result = await file.read();
      if (!result.ok) return result;
      try {
        const replay = replayPersistentBudget(result.value, scope), why = activeWhy(result.value, replay.enabled, now());
        const entry = replay.budget.snapshot.entries.find((e) => e.requestId === requestId);
        if (why) return fail(why);
        if (!entry || !['inflight', 'unknown', 'settled'].includes(entry.state) || replay.dispatchedPolicies.get(requestId) !== replay.policyRevision)
          return fail('budget_policy_changed');
        return { ok: true, snapshot: view(result.value, replay, now()) };
      } catch { return fail('budget_invalid_state'); }
    },
  };
}

// Same mind interface, with awaited durable mutation boundaries and a cached display view.
export class PersistentInferenceBudget extends InferenceBudget {
  #admin; #view; #queue = Promise.resolve();
  static async open(options) {
    const admin = createBudgetAdministration(options), loaded = await admin.inspect();
    if (!loaded.ok) throw new Error(loaded.why);
    return new PersistentInferenceBudget(admin, loaded.snapshot);
  }
  constructor(admin, snapshot) { super({ scope: snapshot.scope, limits: snapshot.limits }); this.#admin = admin; this.#view = clone(snapshot); }
  get snapshot() { const snapshot = clone(this.#view); snapshot.persistence.cached = true; return snapshot; }
  #call(method, ...args) {
    const detached = clone(args);
    const pending = this.#queue.then(async () => {
      const result = await this.#admin[method](...detached);
      if (result.snapshot) this.#view = clone(result.snapshot);
      if (!result.ok) this.#view.persistence.lastError = result.why;
      return result;
    });
    this.#queue = pending.catch(() => {});
    return pending;
  }
  refresh() { return this.#call('inspect'); }
  assertAdapter(adapter) {
    const native = this.#view.persistence.schema === NATIVE_SCHEMA;
    if (native ? !validMetering(adapter?.metering) || meteringHash(adapter.metering) !== this.#view.meteringSha256 ||
        !['measured_tokens', 'estimated_tokens'].includes(adapter.countMode) : adapter?.metering !== undefined || adapter?.countMode !== 'simulated_tokens')
      throw new TypeError('budget_adapter_mismatch');
  }
  reserve(input) { return inputShapeValid(input) ? this.#call('reserve', input) : Promise.resolve(fail('invalid_reservation')); }
  markDispatched(id) { return this.#call('markDispatched', id); }
  cancelBeforeDispatch(id) { return this.#call('cancelBeforeDispatch', id); }
  markUnknown(id, reason) { return this.#call('markUnknown', id, reason); }
  settle(id, usage) { return usageValid(usage) ? this.#call('settle', id, usage,
    this.#view.persistence.schema === NATIVE_SCHEMA ? 'adapter_native' : 'adapter_simulated') : Promise.resolve(fail('invalid_usage')); }
  checkActive(id) { return this.#call('checkActive', id); }
  setLimits() { throw new Error('owner_configuration_required'); }
}
