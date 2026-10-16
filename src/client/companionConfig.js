// Private, owner-scoped companion configuration over the authenticated game transport.
import { MSG } from '../net/protocol.js';
import { MAX_CONFIG_REVISION, companionId, validateCompanionConfig, validateCompanionConfigHead } from '../net/companionConfig.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHY = new Set(['forbidden', 'invalid_request', 'unavailable', 'conflict', 'busy']);
const empty = (status = 'offline', characterKey = null, message = '') => ({
  status, characterKey, head: null, message, durable: false,
});
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const clone = (value) => structuredClone(value);
const canonicalConfig = (value) => {
  try { return validateCompanionConfig(value); } catch { return null; }
};

function projectHead(value) {
  try { return validateCompanionConfigHead(value); } catch { return null; }
}

/**
 * Durable configuration client. Account identity comes only from auth; the server binds
 * character ownership to the authenticated gameplay session.
 */
export class CompanionConfigClient {
  constructor({ transport, auth, joined = () => false, timeoutMs = 8000,
    makeRequestId = () => crypto.randomUUID() } = {}) {
    if (!transport?.onMessage || !transport?.send || !auth?.subscribe) {
      throw new TypeError('CompanionConfigClient requiere transport y auth.');
    }
    Object.assign(this, { transport, auth, joined, timeoutMs, makeRequestId });
    this.listeners = new Set(); this.authAccount = null; this.sessionAccount = null;
    this.generation = 0; this.pending = null; this.destroyed = false;
    this.state = empty('signed_out');
    this.unsubscribeAuth = auth.subscribe((value) => this.authChanged(value));
    transport.onMessage((message) => this.onMessage(message));
    transport.onClose?.(() => this.disconnect());
  }

  subscribe(callback) {
    this.listeners.add(callback); callback(this.snapshot());
    return () => this.listeners.delete(callback);
  }
  snapshot() { return { ...this.state, head: this.state.head ? clone(this.state.head) : null }; }
  publish(next) {
    if (this.destroyed) return;
    this.state = { ...next, head: next.head ? clone(next.head) : null };
    for (const callback of this.listeners) callback(this.snapshot());
  }
  validAuth(value) {
    return value?.signedIn === true && value.guestChoice !== true
      && typeof value.accountId === 'string' && UUID.test(value.accountId) ? value.accountId : null;
  }
  online() {
    try { return Boolean(this.sessionAccount && this.sessionAccount === this.authAccount && this.joined()); }
    catch { return false; }
  }
  authChanged(value) {
    const account = this.validAuth(value);
    if (account === this.authAccount) return;
    this.authAccount = account; this.sessionAccount = null; this.invalidate();
    this.publish(empty(account ? 'offline' : 'signed_out'));
  }
  setSession(accountId) {
    const account = typeof accountId === 'string' && UUID.test(accountId) ? accountId : null;
    if (account === this.sessionAccount) return;
    this.sessionAccount = account; this.invalidate();
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  invalidate() {
    this.generation++;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending = null; }
  }
  disconnect() {
    this.sessionAccount = null; this.invalidate();
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  current(generation, account, session) {
    return !this.destroyed && generation === this.generation && account === this.authAccount
      && session === this.sessionAccount && this.online();
  }

  load(characterKey) {
    if (!companionId(characterKey)) return false;
    if (!this.authAccount) { this.publish(empty('signed_out', characterKey)); return false; }
    if (!this.online()) { this.invalidate(); this.publish(empty('offline', characterKey)); return false; }
    if (this.pending?.op === 'load') this.invalidate();
    else if (this.pending) return false;
    return this.request('load', characterKey, null);
  }

  save(config) {
    const characterKey = this.state.characterKey;
    if (!companionId(characterKey) || !this.authAccount || !this.online() || this.pending
        || this.state.status !== 'ready' || !this.state.head || !this.state.durable) return false;
    const canonical = canonicalConfig(config);
    if (!canonical || this.state.head.revision >= MAX_CONFIG_REVISION) return false;
    return this.request('save', characterKey, { expectedRevision: this.state.head.revision, config: clone(canonical) });
  }

  request(op, characterKey, fields) {
    const requestId = this.makeRequestId();
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) return false;
    const generation = this.generation, account = this.authAccount, session = this.sessionAccount;
    const pending = { requestId, op, characterKey, generation, account, session,
      ...(fields || {}), timer: null };
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      if (!this.current(generation, account, session)) {
        this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return;
      }
      this.pending = null;
      if (op === 'save') this.publish({ ...this.state, status: 'uncertain', message: 'uncertain' });
      else this.publish({ ...this.state, status: 'error', message: 'timeout' });
    }, this.timeoutMs);
    this.pending = pending;
    this.publish({ ...this.state, ...(op === 'load' ? { head: null, durable: false } : {}),
      characterKey, status: op === 'load' ? 'loading' : 'saving', message: '' });
    const message = { t: MSG.AGENT_COMPANION_CONFIG, requestId, op, characterKey, ...(fields || {}) };
    try {
      this.transport.send(message);
    } catch {
      clearTimeout(pending.timer); this.pending = null;
      this.publish({ ...this.state, status: op === 'save' ? 'uncertain' : 'error', message: op === 'save' ? 'uncertain' : 'error' });
      return false;
    }
    return true;
  }

  onMessage(message) {
    const pending = this.pending;
    if (!pending || message?.t !== MSG.AGENT_COMPANION_CONFIG_RESULT || message.requestId !== pending.requestId) return;
    if (!this.current(pending.generation, pending.account, pending.session)) {
      this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return;
    }
    if (!exactKeys(message, ['t', 'requestId', 'characterKey', 'ok', 'why', 'durable', 'head'])
        || message.characterKey !== pending.characterKey || typeof message.ok !== 'boolean'
        || typeof message.durable !== 'boolean' || !(message.why === null || WHY.has(message.why))) return;
    const head = message.head === null ? null : projectHead(message.head);
    if ((message.head !== null && !head) || (message.ok && (!head || message.why !== null))
        || (!message.ok && message.why === null) || (message.why === 'conflict' && !head)) return;
    if (pending.op === 'save' && message.ok) {
      const expectedRevision = pending.expectedRevision;
      if (!Number.isSafeInteger(expectedRevision) || head.revision !== expectedRevision + 1
          || JSON.stringify(head.config) !== JSON.stringify(pending.config)) return;
    }
    clearTimeout(pending.timer); this.pending = null;
    if (message.ok) {
      this.publish({ status: 'ready', characterKey: pending.characterKey, head, durable: message.durable, message: '' });
      return;
    }
    if (message.why === 'conflict') {
      this.publish({ status: 'conflict', characterKey: pending.characterKey, head, durable: message.durable, message: 'conflict' });
      return;
    }
    if (pending.op === 'save' && message.why === 'unavailable') {
      this.publish({ ...this.state, status: 'uncertain', message: 'uncertain' });
      return;
    }
    this.publish({ ...this.state, status: 'error', head: head || (pending.op === 'save' ? this.state.head : null),
      durable: message.durable, message: message.why });
  }

  destroy() {
    this.destroyed = true; this.invalidate(); this.unsubscribeAuth?.(); this.listeners.clear();
  }
}
