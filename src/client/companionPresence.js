// Owner-scoped safe-zone companion presence over the authenticated game transport.
import { MSG } from '../net/protocol.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHY = new Set(['forbidden', 'invalid_request', 'unavailable', 'busy', 'conflict', 'no_companion',
  'outside_anchor', 'outside_zone', 'danger', 'hurt', 'dead', 'full', 'paired', 'recovery_required', 'blocked']);
const OPS = new Set(['join', 'follow', 'wait', 'return', 'retire']);
const PRESENCE = new Set(['resting', 'present', 'recovery', 'unavailable']);
const empty = (status = 'offline', message = '') => ({ status, enabled: false, presence: null, message });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validPresence(value) {
  if (value === null) return null;
  if (!exactKeys(value, ['characterKey', 'name', 'status', 'order', 'revision', 'entity', 'reason'])
      || typeof value.characterKey !== 'string' || !UUID.test(value.characterKey)
      || typeof value.name !== 'string' || value.name.length > 64
      || !PRESENCE.has(value.status) || !['wait', 'follow', 'return', 'gather'].includes(value.order)
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !(value.entity === null || (Number.isSafeInteger(value.entity) && value.entity > 0))
      || !(value.reason === null || typeof value.reason === 'string')) return undefined;
  return { ...value };
}

/** Presence controls are account-bound and carry no character selector or coordinates. */
export class CompanionPresenceClient {
  constructor({ transport, auth, joined = () => false, timeoutMs = 8000,
    makeRequestId = () => crypto.randomUUID() } = {}) {
    if (!transport?.onMessage || !transport?.send || !auth?.subscribe) {
      throw new TypeError('CompanionPresenceClient requiere transport y auth.');
    }
    Object.assign(this, { transport, auth, joined, timeoutMs, makeRequestId });
    this.listeners = new Set(); this.authAccount = null; this.sessionAccount = null;
    this.generation = 0; this.pending = null; this.destroyed = false;
    this.mind = null; // L03g-b: whether a paired mind is online for this companion, or null when unknown.
    this.state = empty('signed_out');
    this.unsubscribeAuth = auth.subscribe(value => this.authChanged(value));
    transport.onMessage(message => this.onMessage(message));
    transport.onClose?.(() => this.disconnect());
  }

  subscribe(callback) { this.listeners.add(callback); callback(this.snapshot()); return () => this.listeners.delete(callback); }
  snapshot() { return { ...this.state, presence: this.state.presence ? { ...this.state.presence } : null }; }
  publish(next) {
    if (this.destroyed) return;
    this.state = { ...next, presence: next.presence ? { ...next.presence } : null };
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
    this.authAccount = account; this.sessionAccount = null; this.mind = null; this.invalidate();
    this.publish(empty(account ? 'offline' : 'signed_out'));
  }
  setSession(accountId) {
    const account = typeof accountId === 'string' && UUID.test(accountId) ? accountId : null;
    if (account === this.sessionAccount) return;
    this.sessionAccount = account; this.mind = null; this.invalidate();
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  invalidate() { this.generation++; if (this.pending) { clearTimeout(this.pending.timer); this.pending = null; } }
  disconnect() {
    this.sessionAccount = null; this.mind = null; this.invalidate();
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  // The owner list on this same transport says whether the companion's paired mind is online.
  mindConnected() { return this.mind; }
  observeOwners(message) {
    if (!this.online() || message.ok !== true || !Array.isArray(message.companions)) return;
    const key = this.state.presence?.characterKey;
    const row = key ? message.companions.find(item => item?.characterKey === key) : null;
    const next = typeof row?.online === 'boolean' ? row.online : null;
    if (next === this.mind) return;
    this.mind = next; this.publish({ ...this.state });
  }
  current(generation, account, session) {
    return !this.destroyed && generation === this.generation && account === this.authAccount
      && session === this.sessionAccount && this.online();
  }

  load({ refresh = false } = {}) {
    if (!this.authAccount) { this.publish(empty('signed_out')); return false; }
    if (!this.online()) { this.invalidate(); this.publish(empty('offline')); return false; }
    if (this.pending?.op === 'load' && this.current(this.pending.generation, this.pending.account, this.pending.session)) {
      if (refresh) this.pending.refreshAfter = true;
      return true;
    }
    if (this.pending?.op !== undefined) {
      if (refresh) { this.pending.refreshAfter = true; return true; }
      return false;
    }
    return this.request('load');
  }
  command(op) {
    if (!OPS.has(op) || !this.authAccount || !this.online() || this.pending
        || this.state.status !== 'ready' || !this.state.enabled || !this.state.presence
        || ['recovery', 'unavailable'].includes(this.state.presence.status)) return false;
    return this.request(op, this.state.presence.revision);
  }
  request(op, expectedRevision) {
    const requestId = this.makeRequestId();
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) return false;
    const generation = this.generation, account = this.authAccount, session = this.sessionAccount;
    const pending = { requestId, op, generation, account, session, refreshAfter: false, timer: null };
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      if (!this.current(generation, account, session)) { this.disconnect(); return; }
      this.pending = null;
      if (pending.refreshAfter) { this.request('load'); return; }
      this.publish({ ...this.state, status: op === 'load' ? 'error' : 'uncertain', message: 'timeout' });
    }, this.timeoutMs);
    this.pending = pending;
    this.publish({ ...this.state, status: op === 'load' ? 'loading' : 'mutating', message: '' });
    const message = op === 'load'
      ? { t: MSG.AGENT_COMPANION_PRESENCE, requestId, op }
      : { t: MSG.AGENT_COMPANION_PRESENCE, requestId, op, expectedRevision };
    try { this.transport.send(message); }
    catch {
      clearTimeout(pending.timer); this.pending = null;
      if (pending.refreshAfter) this.request('load');
      else this.publish({ ...this.state, status: op === 'load' ? 'error' : 'uncertain', message: 'unavailable' });
      return false;
    }
    return true;
  }
  onMessage(message) {
    if (message?.t === MSG.AGENT_OWNER_RESULT) { this.observeOwners(message); return; }
    const pending = this.pending;
    if (!pending || message?.t !== MSG.AGENT_COMPANION_PRESENCE_RESULT || message.requestId !== pending.requestId) return;
    if (!this.current(pending.generation, pending.account, pending.session)) { this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return; }
    if (!exactKeys(message, ['t', 'requestId', 'ok', 'why', 'enabled', 'presence'])
        || typeof message.ok !== 'boolean' || typeof message.enabled !== 'boolean'
        || !(message.why === null || WHY.has(message.why))) return;
    const presence = validPresence(message.presence);
    if (presence === undefined || (message.ok && message.why !== null) || (!message.ok && message.why === null)) return;
    clearTimeout(pending.timer); this.pending = null;
    if (pending.refreshAfter) { this.request('load'); return; }
    if (message.ok) this.publish({ status: 'ready', enabled: message.enabled, presence, message: '' });
    else this.publish({ status: 'error', enabled: message.enabled, presence, message: message.why });
  }
  destroy() {
    this.destroyed = true; this.invalidate(); this.unsubscribeAuth?.(); this.listeners.clear();
    this.state = empty('signed_out');
  }
}
