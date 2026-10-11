import { MSG } from '../src/net/protocol.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_REVISION = 2147483647;
const baseline = () => ({ revision: 0, stopped: true, savedAt: null });
function head(value) {
  if (!value || Object.keys(value).length !== 3 || !['revision', 'stopped', 'savedAt'].every(k => Object.hasOwn(value, k)) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision > MAX_REVISION ||
      typeof value.stopped !== 'boolean' || (value.revision === 0
        ? value.stopped !== true || value.savedAt !== null
        : typeof value.savedAt !== 'string' || value.savedAt.length > 64 || !Number.isFinite(Date.parse(value.savedAt)))) throw new Error('response');
  return { revision: value.revision, stopped: value.stopped,
    savedAt: value.savedAt === null ? null : new Date(value.savedAt).toISOString() };
}

// The host's static binding allowlist still owns identity/capabilities. This latch can only
// restrict admission. Provider work, inference and simulation state never enter this service.
export class CompanionControlService {
  constructor(host, { allowMemory = false, timeoutMs = 8000 } = {}) {
    if (typeof allowMemory !== 'boolean' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('configuration');
    Object.assign(this, { host, timeoutMs });
    this.managed = !!host.agentControl && (host.store.durable === true || allowMemory);
    this.ready = false; this.entries = new Map(); this.busy = new Set(); this.rates = new Map();
    if (this.managed) for (const binding of host.agentControl.configuredBindings()) {
      this.entries.set(binding.characterId, { binding, head: baseline(), status: 'unavailable', operation: null });
      this.stopLocal(binding);
    }
  }
  async bounded(operation) {
    let timer;
    try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  scope(entry) { return { world: this.host.worldState.id, owner: entry.binding.ownerId, character: entry.binding.characterId }; }
  stopLocal(binding) {
    const row = this.host.agentControl.listOwned(binding.ownerId).find(r => r.characterKey === binding.characterId);
    if (row?.stopped) return;
    const state = this.host.agentControl.revoke(binding.ownerId, binding.characterId, 'stop');
    this.host.publishAgentState({ ok: true, state }, null, true);
  }
  async prepare() {
    if (!this.managed) return;
    const store = this.host.store;
    if (!this.host.worldState?.id || !['checkCompanionControl', 'loadCompanionControl', 'saveCompanionControl'].every(k => typeof store[k] === 'function')) return;
    try {
      const entries = [...this.entries.values()];
      const loaded = await this.bounded((async () => {
        if ((await store.checkCompanionControl())?.version !== 1) throw new Error('readiness');
        return Promise.all(entries.map(async entry => head(await store.loadCompanionControl(this.scope(entry)))));
      })());
      if (this.host.closing) return;
      entries.forEach((entry, i) => {
        entry.head = loaded[i]; entry.status = 'ready';
        // Only initial hydration restores an already-confirmed permission to connect.
        if (!entry.head.stopped) this.host.agentControl.resume(entry.binding.ownerId, entry.binding.characterId);
      });
      this.ready = true;
    } catch { /* All configured characters remain stopped; ordinary gameplay stays available. */ }
  }
  allowed(character) {
    if (!this.managed) return true;
    const entry = this.entries.get(character);
    // Routine owner reads may be pending while an already-confirmed controller keeps running.
    // Mutations revoke locally before I/O; a resume still has a stopped head until commit.
    return this.ready && entry && entry.status !== 'unavailable' && entry.head.stopped === false;
  }
  projection(character) {
    if (!this.managed) return {};
    const entry = this.entries.get(character);
    return { control: { status: entry?.status ?? 'unavailable', ...(entry?.head ?? baseline()) } };
  }
  principal(sock) {
    const h = this.host, session = h.profiles.clients.get(sock.id), client = h.server.clients.get(sock.id);
    return h.sockets.get(sock.id) === sock && sock.ws.readyState === 1 && !h.closing &&
      (!h.agentPilot || sock.worldAdmitted) && !sock.agentIdentity && client?.entity && client.serverProfile &&
      session && !session.closed && !session.failed && h.profiles.accounts.get(session.key) === session ? session : null;
  }
  quota(owner) {
    const now = Date.now();
    for (const [key, row] of this.rates) if (now - row.at >= 60000) this.rates.delete(key);
    const row = this.rates.get(owner);
    if ((!row && this.rates.size >= 64) || row?.count >= 30) return false;
    this.rates.set(owner, { at: row?.at ?? now, count: (row?.count ?? 0) + 1 }); return true;
  }
  async refresh(owner) {
    const entries = [...this.entries.values()].filter(e => e.binding.ownerId === owner);
    if (!this.host.worldState?.id || entries.some(e => e.operation)) return entries.some(e => e.operation) ? 'busy' : 'unavailable';
    let operation;
    try {
      // Retain per-character slots until actual work settles, including after a response timeout.
      operation = (async () => {
        if ((await this.host.store.checkCompanionControl())?.version !== 1) throw new Error('readiness');
        return Promise.all(entries.map(async e => head(await this.host.store.loadCompanionControl(this.scope(e)))));
      })();
      for (const entry of entries) { entry.operation = operation; entry.status = 'pending'; }
      const values = await this.bounded(operation);
      entries.forEach((entry, i) => {
        entry.head = values[i]; entry.status = 'ready';
        if (entry.head.stopped) this.stopLocal(entry.binding);
        // A read never resumes a locally stopped character after an uncertain mutation.
      });
      this.ready = true; return null;
    } catch {
      for (const entry of entries) { entry.status = 'unavailable'; this.stopLocal(entry.binding); }
      return 'unavailable';
    } finally {
      operation?.finally(() => { for (const entry of entries) if (entry.operation === operation) entry.operation = null; }).catch(() => {});
    }
  }
  async mutate(entry, message, current = () => true) {
    const h = this.host, stopped = message.op === 'stop';
    const row = h.agentControl.listOwned(entry.binding.ownerId).find(r => r.characterKey === entry.binding.characterId);
    if (entry.operation) return 'busy';
    if (row.epoch !== message.epoch) return 'stale_control';
    if (message.expectedRevision !== entry.head.revision) return 'conflict';
    if (stopped) this.stopLocal(entry.binding);
    if (!this.ready || entry.status !== 'ready') return 'unavailable';
    // Resume permits a fresh authenticated connection only. It cannot renew an old grant.
    if (!stopped && !row.stopped) return 'stale_control';
    let operation;
    try {
      entry.status = 'pending';
      operation = Promise.resolve().then(() => {
        if (!current()) throw new Error('session');
        return h.store.saveCompanionControl({ ...this.scope(entry), expectedRevision: message.expectedRevision, stopped });
      });
      entry.operation = operation;
      const result = await this.bounded(operation);
      const next = head(result?.head);
      if (result?.ok === false && result.why === 'conflict') {
        entry.head = next; entry.status = 'ready';
        if (next.stopped) this.stopLocal(entry.binding);
        return 'conflict';
      }
      if (result?.ok !== true || typeof result.replay !== 'boolean' || next.revision !== message.expectedRevision + 1 || next.stopped !== stopped) throw new Error('response');
      entry.head = next; entry.status = 'ready';
      if (!stopped && !h.closing && current()) h.agentControl.resume(entry.binding.ownerId, entry.binding.characterId);
      return null;
    } catch {
      entry.status = 'unavailable'; this.stopLocal(entry.binding); return 'unavailable';
    } finally {
      operation?.finally(() => { if (entry.operation === operation) entry.operation = null; }).catch(() => {});
    }
  }
  handle(sock, message) {
    if (!this.managed || message?.t !== MSG.AGENT_OWNER) return false;
    void this.dispatch(sock, message); return true;
  }
  async dispatch(sock, message) {
    const h = this.host, session = this.principal(sock);
    const requestId = typeof message.requestId === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(message.requestId) ? message.requestId : null;
    const reply = why => {
      if (h.sockets.get(sock.id) !== sock || sock.ws.readyState !== 1 || (session && this.principal(sock) !== session)) return;
      h.sendTo(sock.id, { t: MSG.AGENT_OWNER_RESULT, requestId, ok: why === null, why,
        enabled: !!session, companions: session ? h.agentOwnerProjection(session.key) : [] });
    };
    if (!session) { reply('forbidden'); return; }
    const keys = message.op === 'list' ? ['t', 'requestId', 'op'] : ['t', 'requestId', 'op', 'characterKey', 'epoch', 'expectedRevision'];
    if (!requestId || !['list', 'stop', 'resume'].includes(message.op) || Object.keys(message).length !== keys.length ||
        keys.some(k => !Object.hasOwn(message, k)) || (message.op !== 'list' &&
        (typeof message.characterKey !== 'string' || !UUID.test(message.characterKey) ||
         (message.epoch !== null && (!Number.isSafeInteger(message.epoch) || message.epoch < 1)) ||
         !Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0 || message.expectedRevision >= MAX_REVISION))) {
      reply('invalid_request'); return;
    }
    const entry = this.entries.get(message.characterKey);
    if (message.op !== 'list' && entry?.binding.ownerId !== session.key) { reply('forbidden'); return; }
    if (this.busy.has(sock) || this.busy.size >= 32 || !this.quota(session.key)) { reply('busy'); return; }
    this.busy.add(sock);
    try {
      const why = message.op === 'list' ? await this.refresh(session.key)
        : await this.mutate(entry, message, () => this.principal(sock) === session);
      reply(why);
    } catch { reply('unavailable'); }
    finally { this.busy.delete(sock); }
  }
}
