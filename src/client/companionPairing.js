// Owner-scoped, one-use local-controller pairing over the authenticated game transport.
import { MSG } from '../net/protocol.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHY = new Set(['forbidden', 'invalid_request', 'unavailable', 'busy', 'stopped', 'not_created']);
const CODE = /^[0-9a-f]{64}$/i;
const MAX_TTL_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30_000;
const empty = (status = 'offline', message = '') => ({ status, enabled: false, code: null, expiresAtMs: null, message });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Account identity and lifecycle come from the authenticated gameplay session. */
export class CompanionPairingClient {
  constructor({ transport, auth, joined = () => false, timeoutMs = 8000,
    makeRequestId = () => crypto.randomUUID(), now = () => Date.now(), controllerUrl = '' } = {}) {
    if (!transport?.onMessage || !transport?.send || !auth?.subscribe) {
      throw new TypeError('CompanionPairingClient requiere transport y auth.');
    }
    Object.assign(this, { transport, auth, joined, timeoutMs, makeRequestId, now });
    this.controllerUrl = this.safeControllerUrl(controllerUrl);
    this.listeners = new Set(); this.authAccount = null; this.sessionAccount = null;
    this.generation = 0; this.pending = null; this.destroyed = false; this.expiryTimer = null;
    this.state = empty('signed_out');
    this.unsubscribeAuth = auth.subscribe(value => this.authChanged(value));
    transport.onMessage(message => this.onMessage(message));
    transport.onClose?.(() => this.disconnect());
  }

  safeControllerUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const parsed = new URL(value);
      if (!['wss:', 'ws:'].includes(parsed.protocol) || parsed.username || parsed.password
          || parsed.search || parsed.hash || !parsed.pathname.endsWith('/ws')) return '';
      return parsed.toString();
    } catch { return ''; }
  }
  subscribe(callback) { this.listeners.add(callback); callback(this.snapshot()); return () => this.listeners.delete(callback); }
  snapshot() { return { ...this.state }; }
  publish(next) {
    if (this.destroyed) return;
    this.state = { ...next };
    for (const callback of this.listeners) callback(this.snapshot());
  }
  validAuth(value) {
    return value?.signedIn === true && value.guestChoice !== true
      && typeof value.accountId === 'string' && UUID.test(value.accountId) ? value.accountId : null;
  }
  online() { try { return Boolean(this.sessionAccount && this.sessionAccount === this.authAccount && this.joined()); } catch { return false; } }
  clearExpiry() { if (this.expiryTimer) clearTimeout(this.expiryTimer); this.expiryTimer = null; }
  clearPrivate() {
    this.clearExpiry();
    this.state = { ...this.state, code: null, expiresAtMs: null };
  }
  authChanged(value) {
    const account = this.validAuth(value);
    if (account === this.authAccount) return;
    this.authAccount = account; this.sessionAccount = null; this.invalidate(); this.clearPrivate();
    this.publish(empty(account ? 'offline' : 'signed_out'));
  }
  setSession(accountId) {
    const account = typeof accountId === 'string' && UUID.test(accountId) ? accountId : null;
    if (account === this.sessionAccount) return;
    this.sessionAccount = account; this.invalidate(); this.clearPrivate();
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  invalidate() { this.generation++; if (this.pending) { clearTimeout(this.pending.timer); this.pending = null; } }
  disconnect() {
    this.sessionAccount = null; this.invalidate(); this.clearPrivate();
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  current(generation, account, session) {
    return !this.destroyed && generation === this.generation && account === this.authAccount
      && session === this.sessionAccount && this.online();
  }
  load({ refresh = false } = {}) {
    if (!this.authAccount) { this.clearPrivate(); this.publish(empty('signed_out')); return false; }
    if (!this.online()) { this.invalidate(); this.clearPrivate(); this.publish(empty('offline')); return false; }
    if (this.pending?.op === 'load' && this.current(this.pending.generation, this.pending.account, this.pending.session)) {
      // Creation may finish after the in-flight read took its snapshot. Queue one fresh
      // read after that receipt instead of overlapping the host's per-socket operation.
      if (refresh) this.pending.refreshAfter = true;
      return true;
    }
    if (this.pending?.op === 'load') this.invalidate(); else if (this.pending) return false;
    this.clearPrivate(); this.publish({ ...this.state });
    return this.request('load');
  }
  issue() {
    if (!this.authAccount || !this.online() || this.pending || this.state.status !== 'ready' || !this.state.enabled) return false;
    this.clearPrivate();
    this.publish({ ...this.state });
    return this.request('issue');
  }
  revoke() {
    if (!this.authAccount || !this.online() || this.pending || this.state.status !== 'ready' || !this.state.enabled) return false;
    this.clearPrivate();
    this.publish({ ...this.state });
    return this.request('revoke');
  }
  request(op) {
    const requestId = this.makeRequestId();
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) return false;
    const generation = this.generation, account = this.authAccount, session = this.sessionAccount;
    const pending = { requestId, op, generation, account, session, timer: null };
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      if (!this.current(generation, account, session)) { this.disconnect(); return; }
      this.pending = null; this.clearPrivate();
      if (pending.refreshAfter) { this.request('load'); return; }
      this.publish({ ...empty(op === 'load' ? 'error' : 'uncertain', op === 'load' ? 'timeout' : 'uncertain'), enabled: this.state.enabled });
    }, this.timeoutMs);
    this.pending = pending;
    this.publish({ ...this.state, status: op === 'load' ? 'loading' : 'loading', message: '' });
    try { this.transport.send({ t: MSG.AGENT_COMPANION_PAIR, requestId, op }); }
    catch {
      clearTimeout(pending.timer); this.pending = null; this.clearPrivate();
      this.publish({ ...this.state, status: op === 'load' ? 'error' : 'uncertain', code: null, expiresAtMs: null,
        message: op === 'load' ? 'error' : 'uncertain' });
      return false;
    }
    return true;
  }
  onMessage(message) {
    const pending = this.pending;
    if (!pending || message?.t !== MSG.AGENT_COMPANION_PAIR_RESULT || message.requestId !== pending.requestId) return;
    if (!this.current(pending.generation, pending.account, pending.session)) { this.disconnect(); return; }
    if (!exactKeys(message, ['t', 'requestId', 'ok', 'why', 'enabled', 'code', 'expiresAtMs', 'bootstrap'])
        || typeof message.ok !== 'boolean' || typeof message.enabled !== 'boolean'
        || message.bootstrap !== null || !(message.why === null || WHY.has(message.why))) return;
    const hasCode = message.code !== null;
    const now = this.now();
    // The host owns expiry. Small wall-clock skew must not reject a newly issued code.
    const validExpiry = Number.isSafeInteger(message.expiresAtMs) && message.expiresAtMs > now
      && message.expiresAtMs <= now + MAX_TTL_MS + MAX_CLOCK_SKEW_MS;
    if ((hasCode && (!CODE.test(message.code) || !validExpiry))
        || (!hasCode && message.expiresAtMs !== null)
        || (message.ok && message.why !== null) || (!message.ok && message.why === null)
        || (pending.op === 'issue' && message.ok && (!hasCode || !message.enabled))
        || (pending.op !== 'issue' && hasCode)) return;
    clearTimeout(pending.timer); this.pending = null;
    if (pending.refreshAfter) { this.request('load'); return; }
    if (message.ok) {
      this.publish({ status: 'ready', enabled: message.enabled, code: message.code,
        expiresAtMs: message.expiresAtMs, message: '' });
      if (hasCode) this.scheduleExpiry(message.expiresAtMs);
      return;
    }
    this.clearPrivate();
    this.publish({ status: message.why === 'unavailable' || message.why === 'busy' ? 'error' : 'error',
      enabled: message.enabled, code: null, expiresAtMs: null, message: message.why });
  }
  scheduleExpiry(expiresAtMs) {
    this.clearExpiry();
    const delay = Math.min(MAX_TTL_MS, Math.max(0, expiresAtMs - this.now()));
    this.expiryTimer = setTimeout(() => {
      if (this.state.code && this.state.expiresAtMs === expiresAtMs) this.publish({ ...this.state, code: null, expiresAtMs: null });
      this.expiryTimer = null;
    }, delay);
  }
  destroy() {
    this.destroyed = true; this.invalidate(); this.clearPrivate(); this.state = empty('signed_out');
    this.unsubscribeAuth?.(); this.listeners.clear();
  }
}
