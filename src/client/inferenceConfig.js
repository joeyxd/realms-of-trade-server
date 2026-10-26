// Private, owner-scoped inference configuration over the authenticated gameplay transport.
import { MSG } from '../net/protocol.js';
import { MAX_CONFIG_REVISION } from '../net/companionConfig.js';
import { validateInferenceCatalog, validateInferenceConfig, validateInferenceHead } from '../net/inferenceConfig.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHY = new Set(['forbidden', 'invalid_request', 'unavailable', 'conflict', 'busy', 'must_stop', 'ineligible']);
const empty = (status = 'offline', message = '') => ({
  status, head: null, catalog: [], characters: [], durable: false, message,
});
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const clone = (value) => structuredClone(value);
const projectHead = (value) => {
  try { return validateInferenceHead(value); } catch { return null; }
};
const projectCatalog = (value) => {
  try { return validateInferenceCatalog(value); } catch { return null; }
};
function projectCharacters(value) {
  if (!Array.isArray(value) || value.length > 16 || value.some((id) => typeof id !== 'string' || !UUID.test(id))) return null;
  const sorted = [...value].sort();
  return new Set(sorted).size === sorted.length ? sorted : null;
}

/** Owner/world inference configuration client. Identity and world are derived by the server. */
export class InferenceConfigClient {
  constructor({ transport, auth, joined = () => false, timeoutMs = 8000,
    makeRequestId = () => crypto.randomUUID() } = {}) {
    if (!transport?.onMessage || !transport?.send || !auth?.subscribe || !MSG.INFERENCE_CONFIG || !MSG.INFERENCE_CONFIG_RESULT) {
      throw new TypeError('InferenceConfigClient requiere transport, auth y protocolo de configuración.');
    }
    Object.assign(this, { transport, auth, joined, timeoutMs, makeRequestId });
    this.listeners = new Set(); this.authAccount = null; this.sessionAccount = null;
    this.generation = 0; this.pending = null; this.destroyed = false; this.state = empty('signed_out');
    this.unsubscribeAuth = auth.subscribe((value) => this.authChanged(value));
    transport.onMessage((message) => this.onMessage(message));
    transport.onClose?.(() => this.disconnect());
  }

  subscribe(callback) { this.listeners.add(callback); callback(this.snapshot()); return () => this.listeners.delete(callback); }
  snapshot() { return { ...this.state, head: this.state.head ? clone(this.state.head) : null,
    catalog: clone(this.state.catalog), characters: [...this.state.characters] }; }
  publish(next) {
    if (this.destroyed) return;
    this.state = { ...next, head: next.head ? clone(next.head) : null,
      catalog: clone(next.catalog || []), characters: [...(next.characters || [])] };
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
  invalidate() { this.generation++; if (this.pending) { clearTimeout(this.pending.timer); this.pending = null; } }
  disconnect() {
    this.sessionAccount = null; this.invalidate();
    this.publish(empty(this.authAccount ? 'offline' : 'signed_out'));
  }
  current(generation, account, session) {
    return !this.destroyed && generation === this.generation && account === this.authAccount
      && session === this.sessionAccount && this.online();
  }

  load() {
    if (!this.authAccount) { this.publish(empty('signed_out')); return false; }
    if (!this.online()) { this.invalidate(); this.publish(empty('offline')); return false; }
    if (this.pending?.op === 'load') this.invalidate();
    else if (this.pending) return false;
    return this.request('load', null);
  }

  save(config) {
    if (!this.authAccount || !this.online() || this.pending || this.state.status !== 'ready'
        || !this.state.head || !this.state.durable || this.state.head.revision >= MAX_CONFIG_REVISION) return false;
    let canonical;
    try { canonical = validateInferenceConfig(config); } catch { return false; }
    const catalogById = new Map(this.state.catalog.map((row) => [row.id, row]));
    if (canonical.connections.some((row) => {
      const admitted = catalogById.get(row.id);
      return !admitted || row.ceilingNanoUsd > admitted.maxCeilingNanoUsd;
    }) || canonical.companions.some((row) => {
      const admitted = catalogById.get(row.connectionId);
      return !this.state.characters.includes(row.character) || !admitted?.models.includes(row.modelId);
    })) return false;
    return this.request('save', { expectedRevision: this.state.head.revision, config: clone(canonical) });
  }

  request(op, fields) {
    const requestId = this.makeRequestId();
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) return false;
    const generation = this.generation, account = this.authAccount, session = this.sessionAccount;
    const pending = { requestId, op, generation, account, session, ...(fields || {}), timer: null };
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      if (!this.current(generation, account, session)) {
        this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return;
      }
      this.pending = null;
      this.publish({ ...this.state, status: op === 'save' ? 'uncertain' : 'error', message: 'timeout' });
    }, this.timeoutMs);
    this.pending = pending;
    this.publish({ ...this.state, ...(op === 'load' ? { head: null, durable: false } : {}),
      status: op === 'load' ? 'loading' : 'saving', message: '' });
    const message = { t: MSG.INFERENCE_CONFIG, requestId, op, ...(fields || {}) };
    try { this.transport.send(message); }
    catch {
      clearTimeout(pending.timer); this.pending = null;
      this.publish({ ...this.state, status: op === 'save' ? 'uncertain' : 'error', message: op === 'save' ? 'timeout' : 'error' });
      return false;
    }
    return true;
  }

  onMessage(message) {
    const pending = this.pending;
    if (!pending || message?.t !== MSG.INFERENCE_CONFIG_RESULT || message.requestId !== pending.requestId) return;
    if (!this.current(pending.generation, pending.account, pending.session)) {
      this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return;
    }
    if (!exactKeys(message, ['t', 'requestId', 'ok', 'why', 'durable', 'head', 'catalog', 'characters'])
        || typeof message.ok !== 'boolean' || typeof message.durable !== 'boolean'
        || !(message.why === null || WHY.has(message.why))) return;
    const head = message.head === null ? null : projectHead(message.head);
    const catalog = projectCatalog(message.catalog), characters = projectCharacters(message.characters);
    if ((message.head !== null && !head) || !catalog || !characters
        || (message.ok && (!head || message.why !== null))
        || (!message.ok && message.why === null)
        || (message.why === 'conflict' && !head)) return;
    if (pending.op === 'save' && message.ok) {
      if (!message.durable || !head || head.revision !== pending.expectedRevision + 1
          || JSON.stringify(head.config) !== JSON.stringify(pending.config)) return;
    }
    clearTimeout(pending.timer); this.pending = null;
    if (message.ok) {
      this.publish({ status: 'ready', head, catalog, characters, durable: message.durable, message: '' });
      return;
    }
    if (message.why === 'conflict') {
      this.publish({ status: 'conflict', head, catalog, characters, durable: message.durable, message: 'conflict' });
      return;
    }
    if (pending.op === 'save' && message.why === 'unavailable') {
      this.publish({ ...this.state, status: 'uncertain', message: 'uncertain' }); return;
    }
    this.publish({ ...this.state, status: 'error', head: head || (pending.op === 'save' ? this.state.head : null),
      catalog, characters, durable: message.durable, message: message.why });
  }

  destroy() { this.destroyed = true; this.invalidate(); this.unsubscribeAuth?.(); this.listeners.clear(); }
}
