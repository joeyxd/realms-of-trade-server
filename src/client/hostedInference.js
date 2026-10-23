import { MSG } from '../net/protocol.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const empty = (status = 'offline') => ({ status, available: false, reason: null, endpoints: [],
  companions: [], limits: { maxEndpoints: 0, maxRunning: 0 }, pendingOps: [], message: '', test: null });
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, structuredClone(value?.[key] ?? null)]));
// Project only public wire fields; never retain endpoint credentials, including unexpected server fields.
function project(value) {
  if (!value || typeof value.available !== 'boolean' || !Array.isArray(value.endpoints) || !Array.isArray(value.companions)) return null;
  return { available: value.available, reason: value.reason,
    endpoints: value.endpoints.map(row => ({ ...pick(row, ['id', 'label', 'baseUrl', 'keyHint', 'defaultModel', 'catalogUpdatedAt', 'catalogError']),
      models: Array.isArray(row.models) ? row.models.filter(id => typeof id === 'string') : [],
      usage: pick(row.usage, ['requests', 'failures', 'promptTokens', 'completionTokens']) })),
    companions: value.companions.map(row => pick(row, ['character', 'name', 'status', 'endpointId', 'modelId', 'error'])),
    limits: pick(value.limits, ['maxEndpoints', 'maxRunning']) };
}

/** Authenticated owner client. Pending records contain correlation data, never the API key. */
export class HostedInferenceClient {
  constructor({ transport, auth, joined = () => false, timeoutMs = 8000, makeRequestId = () => crypto.randomUUID() } = {}) {
    Object.assign(this, { transport, joined, timeoutMs, makeRequestId });
    this.listeners = new Set(); this.pending = new Map(); this.state = empty('signed_out');
    this.authAccount = null; this.sessionAccount = null; this.destroyed = false;
    this.unsubscribeAuth = auth.subscribe(value => {
      const account = value?.signedIn === true && value.guestChoice !== true && UUID.test(value.accountId) ? value.accountId : null;
      if (account !== this.authAccount) { this.authAccount = account; this.disconnect(); }
    });
    transport.onMessage(message => this.onMessage(message));
    transport.onClose?.(() => this.disconnect());
  }
  snapshot() { return structuredClone(this.state); }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  publish(next) {
    if (this.destroyed) return;
    this.state = { ...next, pendingOps: [...this.pending.keys()] };
    for (const fn of this.listeners) fn(this.snapshot());
  }
  invalidate() { for (const row of this.pending.values()) clearTimeout(row.timer); this.pending.clear(); }
  disconnect() { this.sessionAccount = null; this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); }
  setSession(account) {
    if (account === this.sessionAccount) return;
    this.invalidate(); this.sessionAccount = typeof account === 'string' && UUID.test(account) ? account : null;
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  online() { try { return !!this.authAccount && this.authAccount === this.sessionAccount && !!this.joined(); } catch { return false; } }
  load() { return this.request('load'); }
  save(endpoint) {
    const fields = pick(endpoint, ['id', 'label', 'baseUrl', 'defaultModel']);
    if (typeof endpoint.apiKey === 'string') fields.apiKey = endpoint.apiKey;
    return this.request('save', { endpoint: fields });
  }
  remove(id) { return this.request('delete', { id }); }
  probe(id) { return this.request('probe', { id }); }
  test(id, modelId, prompt) { return this.request('test', { id, modelId, prompt }); }
  start(character, endpointId, modelId) { return this.request('start', { character, endpointId, modelId }); }
  stop(character) { return this.request('stop', { character }); }
  request(op, fields = {}) {
    if (!this.online()) { this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return false; }
    if (this.pending.has(op) || this.destroyed) return false;
    const requestId = this.makeRequestId();
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)
      || [...this.pending.values()].some(row => row.requestId === requestId)) return false;
    const pending = { requestId, timer: null };
    pending.timer = setTimeout(() => {
      if (this.pending.get(op) !== pending) return;
      this.pending.delete(op);
      if (!this.online()) { this.disconnect(); return; }
      this.publish({ ...this.state, status: 'uncertain', message: 'uncertain' });
    }, this.timeoutMs);
    this.pending.set(op, pending);
    this.publish({ ...this.state, status: op === 'load' ? 'loading' : this.state.status, message: 'pending' });
    try { this.transport.send({ t: MSG.HOSTED_INFERENCE, requestId, op, ...fields }); }
    catch {
      clearTimeout(pending.timer); this.pending.delete(op);
      this.publish({ ...this.state, status: 'uncertain', message: 'uncertain' }); return false;
    }
    return true;
  }
  onMessage(message) {
    if (this.destroyed || message?.t !== MSG.HOSTED_INFERENCE_RESULT || !this.online()) return;
    const push = message.requestId === null && message.op === 'status', pending = this.pending.get(message.op);
    if (!push && (!pending || pending.requestId !== message.requestId)) return;
    const state = project(message.state);
    if (!state || typeof message.ok !== 'boolean') return;
    if (!push) { clearTimeout(pending.timer); this.pending.delete(message.op); }
    const test = !push && message.op === 'test' && message.ok && message.test
      ? { ...pick(message.test, ['text', 'latencyMs', 'servedModel', 'modelMismatch']),
        usage: message.test.usage ? pick(message.test.usage, ['inputTokens', 'outputTokens']) : null } : null;
    this.publish({ ...empty('ready'), ...state, message: message.why || (push ? '' : 'success'), test });
  }
  destroy() { this.invalidate(); this.unsubscribeAuth?.(); this.listeners.clear(); this.destroyed = true; }
}
