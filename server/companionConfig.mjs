import { MSG } from '../src/net/protocol.js';
import { companionId, validateCompanionConfig, validateCompanionConfigHead, MAX_CONFIG_REVISION } from '../src/net/companionConfig.js';

// Async private metadata lives outside the simulation. No stored field activates a controller.
export class CompanionConfigService {
  constructor(host, { allowMemory = false, timeoutMs = 8000 } = {}) {
    if (typeof allowMemory !== 'boolean' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('configuration');
    Object.assign(this, { host, allowMemory, timeoutMs });
    this.ready = false; this.busy = new Set(); this.rates = new Map();
  }
  async prepare() {
    const store = this.host.store;
    if (store.durable !== true && !this.allowMemory) return;
    if (!['checkCompanionConfig', 'loadCompanionConfig', 'saveCompanionConfig'].every(k => typeof store[k] === 'function')) return;
    try { this.ready = (await this.bounded(store.checkCompanionConfig()))?.version === 1; } catch { this.ready = false; }
  }
  async bounded(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  principal(sock) {
    const h = this.host, s = h.profiles.clients.get(sock.id), c = h.server.clients.get(sock.id);
    if (h.sockets.get(sock.id) !== sock || sock.ws.readyState !== 1 || h.closing || (h.agentPilot && !sock.worldAdmitted)
        || sock.agentIdentity || !c?.entity || !c.serverProfile || !s || s.closed || s.failed || h.profiles.accounts.get(s.key) !== s) return null;
    return s;
  }
  owned(owner, character) { return this.host.agentControl?.listOwned(owner).some(row => row.characterKey === character) === true; }
  quota(owner) {
    const now = Date.now();
    for (const [key, rate] of this.rates) if (now - rate.at >= 60000) this.rates.delete(key);
    const rate = this.rates.get(owner);
    if (!rate && this.rates.size >= 64 || rate?.count >= 30) return false;
    this.rates.set(owner, { at: rate?.at ?? now, count: (rate?.count ?? 0) + 1 }); return true;
  }
  handle(sock, message) {
    if (message?.t !== MSG.AGENT_COMPANION_CONFIG) return false;
    void this.dispatch(sock, message); return true;
  }
  async dispatch(sock, message) {
    const h = this.host, requestId = typeof message.requestId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(message.requestId) ? message.requestId : null;
    const characterKey = companionId(message.characterKey) ? message.characterKey : null;
    const session = this.principal(sock);
    const reply = (why, head = null) => {
      if (!this.principal(sock) && session || h.sockets.get(sock.id) !== sock || sock.ws.readyState !== 1) return;
      if (session && this.principal(sock) !== session) return;
      h.sendTo(sock.id, { t: MSG.AGENT_COMPANION_CONFIG_RESULT, requestId, characterKey,
        ok: why === null, why, durable: h.store.durable === true, head });
    };
    if (!session) { reply('forbidden'); return; }
    const keys = ['t', 'requestId', 'op', 'characterKey', ...(message.op === 'save' ? ['expectedRevision', 'config'] : [])];
    if (!requestId || !characterKey || !['load', 'save'].includes(message.op) || Object.keys(message).length !== keys.length
        || keys.some(k => !Object.hasOwn(message, k))) { reply('invalid_request'); return; }
    if (!this.owned(session.key, characterKey)) { reply('forbidden'); return; }
    if (!this.ready || !h.worldState?.id) { reply('unavailable'); return; }
    let config;
    if (message.op === 'save') {
      try {
        if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0 || message.expectedRevision >= MAX_CONFIG_REVISION) throw new Error();
        config = validateCompanionConfig(message.config);
      } catch { reply('invalid_request'); return; }
    }
    if (this.busy.has(sock) || this.busy.size >= 32 || !this.quota(session.key)) { reply('busy'); return; }
    const scope = { world: h.worldState.id, owner: session.key, character: characterKey };
    this.busy.add(sock);
    let operation;
    try {
      // Keep actual work bounded even if the response times out. Never retry a write here.
      operation = Promise.resolve().then(() => {
        if (this.principal(sock) !== session || !this.owned(session.key, characterKey)) throw new Error('session');
        return message.op === 'load' ? h.store.loadCompanionConfig(scope)
          : h.store.saveCompanionConfig({ ...scope, expectedRevision: message.expectedRevision, config });
      });
      operation.finally(() => this.busy.delete(sock)).catch(() => {});
      const result = await this.bounded(operation);
      if (!this.owned(session.key, characterKey)) return;
      if (message.op === 'load') { reply(null, validateCompanionConfigHead(result)); return; }
      if (result?.ok === false && result.why === 'conflict') { reply('conflict', validateCompanionConfigHead(result.head)); return; }
      if (result?.ok !== true || typeof result.replay !== 'boolean') throw new Error('response');
      const head = validateCompanionConfigHead(result.head);
      if (head.revision !== message.expectedRevision + 1 || JSON.stringify(head.config) !== JSON.stringify(config)) throw new Error('response');
      reply(null, head);
    } catch { reply('unavailable'); }
    finally { if (!operation) this.busy.delete(sock); }
  }
}
