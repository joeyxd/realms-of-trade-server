// Owner-only companion controls over the authenticated gameplay transport.
import { MSG } from '../net/protocol.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHY = new Set(['forbidden', 'invalid_request', 'stale_control', 'disabled', 'conflict', 'unavailable', 'busy', 'durable_control_required']);
const CAPABILITIES = new Set(['move', 'aim', 'attack_pve', 'body_pve', 'chat', 'inventory_read', 'market_read', 'trade_buy', 'trade_sell']);
const MAX_REVISION = 2147483647;
const empty = (status = 'offline', message = '') => ({ status, enabled: false, companions: [], pendingStop: null, pendingOp: null, pendingCharacter: null, message });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function projectControl(value) {
  if (!exactKeys(value, ['status', 'revision', 'stopped', 'savedAt'])
    || !['ready', 'pending', 'unavailable'].includes(value.status)
    || !Number.isInteger(value.revision) || value.revision < 0 || value.revision > MAX_REVISION
    || typeof value.stopped !== 'boolean'
    || !(value.savedAt === null || (typeof value.savedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.savedAt)
      && Number.isFinite(Date.parse(value.savedAt)) && new Date(value.savedAt).toISOString() === value.savedAt))) return null;
  if (value.revision === 0 && (value.stopped !== true || value.savedAt !== null)) return null;
  if (value.revision > 0 && value.savedAt === null) return null;
  return { status: value.status, revision: value.revision, stopped: value.stopped, savedAt: value.savedAt };
}

function project(value) {
  if (!Array.isArray(value) || value.length > 64) return null;
  const rows = [];
  for (const row of value) {
    const hasControl = row && Object.hasOwn(row, 'control');
    if (!(hasControl
      ? exactKeys(row, ['characterKey', 'name', 'online', 'active', 'stopped', 'epoch', 'capabilities', 'control'])
      : exactKeys(row, ['characterKey', 'name', 'online', 'active', 'stopped', 'epoch', 'capabilities']))
      || typeof row.characterKey !== 'string' || !UUID.test(row.characterKey)
      || !(row.name === null || (typeof row.name === 'string' && row.name.length <= 64))
      || typeof row.online !== 'boolean' || typeof row.active !== 'boolean' || typeof row.stopped !== 'boolean'
      || !(row.epoch === null || (Number.isSafeInteger(row.epoch) && row.epoch > 0))
      || !Array.isArray(row.capabilities) || row.capabilities.length > CAPABILITIES.size
      || row.capabilities.some((capability) => typeof capability !== 'string' || !CAPABILITIES.has(capability))) return null;
    const control = hasControl ? projectControl(row.control) : undefined;
    if (hasControl && !control) return null;
    rows.push({ characterKey: row.characterKey, name: row.name, online: row.online, active: row.active, stopped: row.stopped,
      epoch: row.epoch, capabilities: [...new Set(row.capabilities)], ...(hasControl ? { control } : {}) });
  }
  if (new Set(rows.map((row) => row.characterKey)).size !== rows.length) return null;
  return rows;
}

export class CompanionsClient {
  constructor({ transport, auth, joined = () => false, timeoutMs = 8000, makeRequestId = () => crypto.randomUUID() } = {}) {
    if (!transport?.onMessage || !transport?.send || !auth?.subscribe) throw new TypeError('CompanionsClient requiere transport y auth.');
    Object.assign(this, { transport, auth, joined, timeoutMs, makeRequestId });
    this.listeners = new Set(); this.authAccount = null; this.sessionAccount = null; this.generation = 0;
    this.pending = null; this.destroyed = false; this.state = empty('signed_out');
    this.unsubscribeAuth = auth.subscribe((value) => this.authChanged(value));
    transport.onMessage((message) => this.onMessage(message));
    transport.onClose?.(() => this.disconnect());
  }

  subscribe(callback) { this.listeners.add(callback); callback(this.snapshot()); return () => this.listeners.delete(callback); }
  snapshot() { return { ...this.state, companions: this.state.companions.map((row) => ({ ...row, capabilities: [...row.capabilities], ...(row.control ? { control: { ...row.control } } : {}) })) }; }
  publish(next) {
    if (this.destroyed) return;
    this.state = { ...next, companions: next.companions.map((row) => ({ ...row, capabilities: [...row.capabilities], ...(row.control ? { control: { ...row.control } } : {}) })) };
    for (const callback of this.listeners) callback(this.snapshot());
  }
  validAuth(value) { return value?.signedIn === true && value.guestChoice !== true && typeof value.accountId === 'string' && UUID.test(value.accountId) ? value.accountId : null; }
  online() { try { return Boolean(this.sessionAccount && this.sessionAccount === this.authAccount && this.joined()); } catch { return false; } }
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
  disconnect() { this.sessionAccount = null; this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); }
  current(generation, account, session) {
    return !this.destroyed && generation === this.generation && account === this.authAccount
      && session === this.sessionAccount && this.online();
  }
  refresh() {
    if (!this.authAccount) { this.publish(empty('signed_out')); return false; }
    if (!this.online()) { this.invalidate(); this.publish(empty('offline')); return false; }
    if (this.pending) return false;
    return this.request('list', null);
  }
  stop(characterKey) {
    if (!this.authAccount || !this.online() || this.pending || !this.state.enabled || this.state.status !== 'ready') return false;
    const row = this.state.companions.find((item) => item.characterKey === characterKey);
    if (!row || (row.control && row.control.status !== 'ready')
      || (row.stopped && (!row.control || row.control.stopped === true))) return false;
    return this.request('stop', row);
  }
  resume(characterKey) {
    if (!this.authAccount || !this.online() || this.pending || !this.state.enabled || this.state.status !== 'ready') return false;
    const row = this.state.companions.find((item) => item.characterKey === characterKey);
    if (!row?.control || row.control.status !== 'ready' || !row.stopped) return false;
    return this.request('resume', row);
  }
  request(op, row) {
    const requestId = this.makeRequestId();
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) return false;
    const generation = this.generation, account = this.authAccount, session = this.sessionAccount;
    const pending = { requestId, op, characterKey: row?.characterKey ?? null,
      expectedRevision: row?.control?.revision ?? null, expectedStopped: op === 'stop' ? true : op === 'resume' ? false : null,
      durable: Boolean(row?.control), generation, account, session, timer: null };
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      if (!this.current(generation, account, session)) {
        this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return;
      }
      this.pending = null;
      this.publish({ ...this.state, status: 'error', pendingStop: null, pendingOp: null, pendingCharacter: null, message: 'timeout' });
    }, this.timeoutMs);
    this.pending = pending;
    this.publish({ ...this.state, status: op === 'list' ? 'loading' : this.state.status,
      pendingStop: op === 'stop' ? row.characterKey : null, pendingOp: op === 'list' ? null : op,
      pendingCharacter: row?.characterKey ?? null, message: '' });
    try {
      this.transport.send({ t: MSG.AGENT_OWNER, requestId, op,
        ...(op === 'stop' || op === 'resume' ? { characterKey: row.characterKey, epoch: row.epoch,
          ...(row.control ? { expectedRevision: row.control.revision } : {}) } : {}) });
    } catch {
      clearTimeout(pending.timer); this.pending = null;
      this.publish({ ...this.state, status: 'error', pendingStop: null, pendingOp: null, pendingCharacter: null, message: 'error' });
      return false;
    }
    return true;
  }
  onMessage(message) {
    const pending = this.pending;
    if (!pending || message?.t !== MSG.AGENT_OWNER_RESULT || message.requestId !== pending.requestId) return;
    if (!this.current(pending.generation, pending.account, pending.session)) { this.invalidate(); this.publish(empty(this.authAccount ? 'offline' : 'signed_out')); return; }
    if (!exactKeys(message, ['t', 'requestId', 'ok', 'why', 'enabled', 'companions'])
      || typeof message.ok !== 'boolean' || !(message.why === null || WHY.has(message.why))
      || typeof message.enabled !== 'boolean') return;
    const companions = project(message.companions);
    if (!companions || (message.ok && message.why !== null) || (!message.ok && message.why === null)) return;
    if (message.ok && pending.durable && pending.op !== 'list') {
      const target = companions.find((row) => row.characterKey === pending.characterKey);
      if (!target?.control || target.control.status !== 'ready'
        || target.control.revision !== pending.expectedRevision + 1
        || target.control.stopped !== pending.expectedStopped || target.stopped !== pending.expectedStopped) return;
    }
    clearTimeout(pending.timer); this.pending = null;
    if (message.ok) {
      this.publish({ status: 'ready', enabled: message.enabled, companions: message.enabled ? companions : [], pendingStop: null, pendingOp: null, pendingCharacter: null, message: '' });
      return;
    }
    this.publish({ status: 'error', enabled: message.enabled, companions: message.enabled ? companions : [], pendingStop: null, pendingOp: null, pendingCharacter: null,
      message: message.why });
    if (message.why === 'stale_control' && pending.op === 'stop' && !this.state.companions.some((row) => row.control)) {
      const { generation, account, session } = pending;
      queueMicrotask(() => {
        if (this.current(generation, account, session) && !this.pending) this.refresh();
      });
    }
  }
  destroy() { this.destroyed = true; this.invalidate(); this.unsubscribeAuth?.(); this.listeners.clear(); }
}
