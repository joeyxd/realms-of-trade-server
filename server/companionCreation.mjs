import { MSG } from '../src/net/protocol.js';
import { companionId } from '../src/net/companionConfig.js';
import { exactCreationKeys, validateCompanionPreset, companionCreationConfig, validateCompanionRecord } from '../src/net/companionCreation.js';

// The existing M5 store owns creation; no profile, controller, or provider is activated here.
export class CompanionCreationService {
  constructor(host, { enabled = false, allowMemory = false, timeoutMs = 8000 } = {}) {
    if (typeof enabled !== 'boolean' || typeof allowMemory !== 'boolean' || !Number.isInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('configuration');
    Object.assign(this, { host, enabled, allowMemory, timeoutMs });
    this.ready = false; this.busy = new Set(); this.rates = new Map();
  }
  async bounded(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  async prepare() {
    const store = this.host.store;
    if (!this.enabled || !this.host.resolvePlayer || (!store.durable && !this.allowMemory)
      || !['checkCompanionCreation', 'loadCompanionCreation', 'createCompanion'].every(key => typeof store[key] === 'function')) return;
    try { this.ready = (await this.bounded(store.checkCompanionCreation()))?.version === 1; }
    catch { this.ready = false; }
  }
  principal(sock) { return this.host.companionConfig.principal(sock); }
  quota(owner) {
    const now = Date.now();
    for (const [key, rate] of this.rates) if (now - rate.at >= 60000) this.rates.delete(key);
    const rate = this.rates.get(owner);
    if ((!rate && this.rates.size >= 64) || rate?.count >= 20) return false;
    this.rates.set(owner, { at: rate?.at ?? now, count: (rate?.count ?? 0) + 1 }); return true;
  }
  handle(sock, message) {
    if (message?.t !== MSG.AGENT_COMPANION_CREATE) return false;
    void this.dispatch(sock, message); return true;
  }
  async dispatch(sock, message) {
    const h = this.host, session = this.principal(sock);
    const requestId = typeof message.requestId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(message.requestId) ? message.requestId : null;
    const reply = (why, record = null) => {
      if (h.sockets.get(sock.id) !== sock || sock.ws.readyState !== 1 || (session && this.principal(sock) !== session)) return;
      h.sendTo(sock.id, { t: MSG.AGENT_COMPANION_CREATE_RESULT, requestId, ok: why === null, why,
        durable: h.store.durable === true, available: this.ready, record });
    };
    if (!session) { reply('forbidden'); return; }
    const keys = ['t', 'requestId', 'op', ...(message.op === 'create' ? ['creationId', 'preset'] : [])];
    if (!requestId || !['load', 'create'].includes(message.op) || !exactCreationKeys(message, keys)) {
      reply('invalid_request'); return;
    }
    let preset, config;
    if (message.op === 'create') {
      try {
        if (!companionId(message.creationId)) throw new Error();
        preset = validateCompanionPreset(message.preset); config = companionCreationConfig(preset);
      } catch { reply('invalid_request'); return; }
    }
    if (!this.ready || !h.worldState?.id) { reply('unavailable'); return; }
    if (this.busy.has(session.key) || this.busy.size >= 32 || !this.quota(session.key)) { reply('busy'); return; }
    // This first slot cannot duplicate a character already assigned by private host configuration.
    if (h.agentControl?.listOwned(session.key).length) { reply('conflict'); return; }
    const scope = { world: h.worldState.id, owner: session.key };
    this.busy.add(session.key);
    let operation;
    try {
      operation = Promise.resolve().then(() => {
        if (this.principal(sock) !== session) throw new Error('session');
        return message.op === 'load' ? h.store.loadCompanionCreation(scope)
          : h.store.createCompanion({ ...scope, creationId: message.creationId, preset, config });
      });
      operation.finally(() => this.busy.delete(session.key)).catch(() => {});
      const result = await this.bounded(operation);
      const raw = message.op === 'load' ? result : result?.record;
      const record = raw === null ? null : validateCompanionRecord(raw);
      if (record && (record.characterKey === session.key || h.agentControl?.binding(record.characterKey))) throw new Error('collision');
      if (message.op === 'load') { reply(null, record); return; }
      if (result?.ok === false && ['conflict', 'limit'].includes(result.why)) { reply(result.why, record); return; }
      if (result?.ok !== true || typeof result.replay !== 'boolean' || !record || record.creationId !== message.creationId
        || JSON.stringify(record.preset) !== JSON.stringify(preset)) throw new Error('response');
      reply(null, record);
    } catch { reply('unavailable'); }
    finally { if (!operation) this.busy.delete(session.key); }
  }
}
