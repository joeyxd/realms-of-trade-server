// Owner-scoped durable companion creation over the authenticated game transport.
import { MSG } from '../net/protocol.js';
import { companionId } from '../net/companionConfig.js';
import { validateCompanionPreset, validateCompanionRecord } from '../net/companionCreation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHY = new Set(['forbidden', 'invalid_request', 'unavailable', 'conflict', 'limit', 'busy']);
const empty = (status = 'offline', message = '') => ({ status, available: false, durable: false, record: null, message });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const clone = value => structuredClone(value);

function presetOrNull(value) { try { return validateCompanionPreset(value); } catch { return null; } }
function recordOrNull(value) { try { return validateCompanionRecord(value); } catch { return null; } }

/** Creation client. Account identity is always taken from auth, never from request fields. */
export class CompanionCreationClient {
  constructor({ transport, auth, joined = () => false, timeoutMs = 8000,
    makeRequestId = () => crypto.randomUUID(), makeCreationId = () => crypto.randomUUID() } = {}) {
    if (!transport?.onMessage || !transport?.send || !auth?.subscribe) {
      throw new TypeError('CompanionCreationClient requiere transport y auth.');
    }
    Object.assign(this, { transport, auth, joined, timeoutMs, makeRequestId, makeCreationId });
    this.listeners = new Set(); this.authAccount = null; this.sessionAccount = null;
    this.generation = 0; this.pending = null; this.destroyed = false; this.creationIntent = null;
    this.state = empty('signed_out');
    this.unsubscribeAuth = auth.subscribe(value => this.authChanged(value));
    transport.onMessage(message => this.onMessage(message));
    transport.onClose?.(() => this.disconnect());
  }

  subscribe(callback) { this.listeners.add(callback); callback(this.snapshot()); return () => this.listeners.delete(callback); }
  snapshot() { return { ...this.state, record: this.state.record ? clone(this.state.record) : null }; }
  publish(next) {
    if (this.destroyed) return;
    this.state = { ...next, record: next.record ? clone(next.record) : null };
    for (const callback of this.listeners) callback(this.snapshot());
  }
  validAuth(value) {
    return value?.signedIn === true && value.guestChoice !== true
      && typeof value.accountId === 'string' && UUID.test(value.accountId) ? value.accountId : null;
  }
  online() { try { return Boolean(this.sessionAccount && this.sessionAccount === this.authAccount && this.joined()); } catch { return false; } }
  authChanged(value) {
    const account = this.validAuth(value);
    if (account === this.authAccount) return;
    this.authAccount = account; this.sessionAccount = null; this.creationIntent = null; this.invalidate();
    this.publish(empty(account ? 'offline' : 'signed_out'));
  }
  setSession(accountId) {
    const account = typeof accountId === 'string' && UUID.test(accountId) ? accountId : null;
    if (account === this.sessionAccount) return;
    this.sessionAccount = account; this.invalidate();
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  invalidate() { this.generation++; if (this.pending) { clearTimeout(this.pending.timer); this.pending = null; } }
  disconnect() {
    const uncertainCreate = this.pending?.op === 'create';
    if (uncertainCreate) this.creationIntent = { account: this.pending.account, creationId: this.pending.creationId,
      preset: clone(this.pending.preset) };
    this.sessionAccount = null; this.invalidate();
    this.publish({ ...empty(this.authAccount ? (uncertainCreate ? 'uncertain' : 'offline') : 'signed_out',
      uncertainCreate ? 'uncertain' : ''), available: false, durable: false });
  }
  current(generation, account, session) {
    return !this.destroyed && generation === this.generation && account === this.authAccount
      && session === this.sessionAccount && this.online();
  }

  load() {
    if (!this.authAccount) { this.creationIntent = null; this.publish(empty('signed_out')); return false; }
    if (!this.online()) { this.invalidate(); this.publish(empty('offline')); return false; }
    if (this.pending?.op === 'load' && this.current(this.pending.generation, this.pending.account, this.pending.session)) return true;
    if (this.pending?.op === 'load') this.invalidate();
    else if (this.pending) return false;
    return this.request('load');
  }
  create(preset) {
    const checked = presetOrNull(preset);
    if (!checked || !this.authAccount || !this.online() || this.pending || this.state.status !== 'ready'
        || !this.state.available || !this.state.durable || this.state.record || this.creationIntent) return false;
    const creationId = this.makeCreationId();
    if (!companionId(creationId)) return false;
    this.creationIntent = { account: this.authAccount, creationId, preset: clone(checked) };
    return this.request('create', this.creationIntent);
  }
  retry() {
    const intent = this.creationIntent;
    if (!intent || intent.account !== this.authAccount || !this.online() || this.pending || this.state.status !== 'uncertain') return false;
    return this.request('create', intent);
  }
  request(op, intent = null) {
    const requestId = this.makeRequestId();
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) return false;
    const generation = this.generation, account = this.authAccount, session = this.sessionAccount;
    const pending = { requestId, op, generation, account, session,
      ...(intent ? { creationId: intent.creationId, preset: clone(intent.preset) } : {}), timer: null };
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      if (!this.current(generation, account, session)) { this.disconnect(); return; }
      this.pending = null;
      if (op === 'create') this.publish({ ...this.state, status: 'uncertain', message: 'uncertain' });
      else this.publish({ ...this.state, status: 'error', message: 'timeout' });
    }, this.timeoutMs);
    this.pending = pending;
    this.publish({ ...this.state, status: op === 'load' ? 'loading' : 'creating', message: '' });
    const message = op === 'load'
      ? { t: MSG.AGENT_COMPANION_CREATE, requestId, op }
      : { t: MSG.AGENT_COMPANION_CREATE, requestId, op, creationId: intent.creationId, preset: clone(intent.preset) };
    try { this.transport.send(message); }
    catch {
      clearTimeout(pending.timer); this.pending = null;
      if (op === 'create') this.publish({ ...this.state, status: 'uncertain', message: 'uncertain' });
      else this.publish({ ...this.state, status: 'error', message: 'error' });
      return false;
    }
    return true;
  }
  onMessage(message) {
    const pending = this.pending;
    if (!pending || message?.t !== MSG.AGENT_COMPANION_CREATE_RESULT || message.requestId !== pending.requestId) return;
    if (!this.current(pending.generation, pending.account, pending.session)) { this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return; }
    if (!exactKeys(message, ['t', 'requestId', 'ok', 'why', 'durable', 'available', 'record'])
        || typeof message.ok !== 'boolean' || typeof message.durable !== 'boolean' || typeof message.available !== 'boolean'
        || !(message.why === null || WHY.has(message.why))) return;
    const record = message.record === null ? null : recordOrNull(message.record);
    if ((message.record !== null && !record) || (message.ok && message.why !== null)
        || (!message.ok && message.why === null) || (message.ok && pending.op === 'create'
          && (!message.available || !message.durable || !record || record.creationId !== pending.creationId ||
            JSON.stringify(record.preset) !== JSON.stringify(pending.preset)))
        || (message.ok && pending.op === 'load' && record && !message.durable)) return;
    clearTimeout(pending.timer); this.pending = null;
    if (message.ok) {
      this.creationIntent = null;
      this.publish({ status: 'ready', available: message.available, durable: message.durable,
        record, message: '' });
      return;
    }
    if (pending.op === 'create' && ['unavailable', 'busy'].includes(message.why)) {
      this.publish({ ...this.state, status: 'uncertain', available: message.available, durable: message.durable,
        record: record || this.state.record, message: 'uncertain' });
      return;
    }
    if (pending.op === 'load' && this.creationIntent && ['unavailable', 'busy'].includes(message.why)) {
      this.publish({ ...this.state, status: 'uncertain', available: message.available, durable: message.durable,
        record: record || null, message: 'uncertain' });
      return;
    }
    if (pending.op === 'create' && ['forbidden', 'invalid_request', 'limit'].includes(message.why)) this.creationIntent = null;
    if (message.why === 'conflict' && record) this.creationIntent = null;
    this.publish({ ...this.state, status: message.why === 'unavailable' ? 'error' : 'error',
      available: message.available, durable: message.durable, record: record || this.state.record, message: message.why });
  }
  destroy() { this.destroyed = true; this.creationIntent = null; this.invalidate(); this.unsubscribeAuth?.(); this.listeners.clear(); }
}
