import { MSG } from '../src/net/protocol.js';
import { companionId, MAX_CONFIG_REVISION } from '../src/net/companionConfig.js';
import { inferenceExact, validateInferenceConfig, validateInferenceHead, validateInferenceCatalog } from '../src/net/inferenceConfig.js';

// Only safe metadata enters this catalog. Endpoints, credentials and provider calls have no API here.
export function inferenceCatalogFromEnv(env) {
  if (!env.MN_INFERENCE_CATALOG) return [];
  try { return JSON.parse(env.MN_INFERENCE_CATALOG); }
  catch { throw new TypeError('invalid inference catalog'); }
}
export class InferenceConfigService {
  constructor(host, { catalog = [], allowMemory = false, timeoutMs = 8000 } = {}) {
    if (!Array.isArray(catalog) || catalog.length > 64 || typeof allowMemory !== 'boolean'
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('invalid inference catalog');
    this.catalogs = new Map();
    for (const row of catalog) {
      if (!inferenceExact(row, ['owner', 'connections']) || !companionId(row.owner) || this.catalogs.has(row.owner)) throw new TypeError('invalid inference catalog');
      this.catalogs.set(row.owner, validateInferenceCatalog(row.connections));
    }
    Object.assign(this, { host, allowMemory, timeoutMs });
    this.ready = false; this.busy = new Set(); this.rates = new Map();
  }
  async bounded(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  async prepare() {
    const store = this.host.store;
    if (store.durable !== true && !this.allowMemory) return;
    if (!['checkInferenceConfig', 'loadInferenceConfig', 'saveInferenceConfig'].every(k => typeof store[k] === 'function')) return;
    try { this.ready = (await this.bounded(store.checkInferenceConfig()))?.version === 1; } catch { this.ready = false; }
  }
  principal(sock) { return this.host.companionControl.principal(sock); }
  owned(owner) { return this.host.agentControl?.listOwned(owner) ?? []; }
  catalog(owner) { return structuredClone(this.catalogs.get(owner) ?? []); }
  eligible(config, owner) {
    const owned = this.owned(owner), catalog = this.catalog(owner);
    return config.connections.every(c => catalog.some(r => r.id === c.id && c.ceilingNanoUsd <= r.maxCeilingNanoUsd))
      && config.companions.every(c => owned.some(r => r.characterKey === c.character)
        && catalog.some(r => r.id === c.connectionId && r.models.includes(c.modelId)));
  }
  quota(owner) {
    const now = Date.now();
    for (const [key, row] of this.rates) if (now - row.at >= 60000) this.rates.delete(key);
    const row = this.rates.get(owner);
    if ((!row && this.rates.size >= 64) || row?.count >= 30) return false;
    this.rates.set(owner, { at: row?.at ?? now, count: (row?.count ?? 0) + 1 }); return true;
  }
  handle(sock, message) {
    if (message?.t !== MSG.INFERENCE_CONFIG) return false;
    void this.dispatch(sock, message); return true;
  }
  async dispatch(sock, message) {
    const h = this.host, session = this.principal(sock);
    const requestId = typeof message.requestId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(message.requestId) ? message.requestId : null;
    const reply = (why, head = null) => {
      if (h.sockets.get(sock.id) !== sock || sock.ws.readyState !== 1 || h.closing || session && this.principal(sock) !== session) return;
      h.sendTo(sock.id, { t: MSG.INFERENCE_CONFIG_RESULT, requestId, ok: why === null, why,
        durable: h.store.durable === true, head,
        catalog: session ? this.catalog(session.key) : [],
        characters: session ? this.owned(session.key).map(r => r.characterKey).sort().slice(0, 16) : [] });
    };
    if (!session) { reply('forbidden'); return; }
    if (!requestId || !['load', 'save'].includes(message.op) || !inferenceExact(message,
      ['t', 'requestId', 'op', ...(message.op === 'save' ? ['expectedRevision', 'config'] : [])])) { reply('invalid_request'); return; }
    if (!this.ready || !h.worldState?.id || this.owned(session.key).length > 16) { reply('unavailable'); return; }
    let config;
    if (message.op === 'save') {
      try {
        if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0 || message.expectedRevision >= MAX_CONFIG_REVISION) throw new Error('revision');
        config = validateInferenceConfig(message.config);
      } catch { reply('invalid_request'); return; }
      if (!this.eligible(config, session.key)) { reply('ineligible'); return; }
      if (this.owned(session.key).some(r => !r.stopped || r.active)) { reply('must_stop'); return; }
    }
    if (this.busy.has(session.key) || this.busy.size >= 32 || !this.quota(session.key)) { reply('busy'); return; }
    this.busy.add(session.key);
    let operation;
    try {
      operation = Promise.resolve().then(() => {
        if (this.principal(sock) !== session) throw new Error('session');
        if (message.op === 'save' && (!this.eligible(config, session.key) || this.owned(session.key).some(r => !r.stopped || r.active))) throw new Error('eligibility');
        const scope = { world: h.worldState.id, owner: session.key };
        return message.op === 'load' ? h.store.loadInferenceConfig(scope)
          : h.store.saveInferenceConfig({ ...scope, expectedRevision: message.expectedRevision, config });
      });
      operation.finally(() => this.busy.delete(session.key)).catch(() => {});
      const result = await this.bounded(operation);
      if (message.op === 'load') { reply(null, validateInferenceHead(result)); return; }
      if (result?.ok === false && result.why === 'conflict') { reply('conflict', validateInferenceHead(result.head)); return; }
      if (result?.ok !== true || typeof result.replay !== 'boolean') throw new Error('response');
      const head = validateInferenceHead(result.head);
      if (head.revision !== message.expectedRevision + 1 || JSON.stringify(head.config) !== JSON.stringify(config)) throw new Error('response');
      reply(null, head);
    } catch { reply('unavailable'); }
    finally { if (!operation) this.busy.delete(session.key); }
  }
}
