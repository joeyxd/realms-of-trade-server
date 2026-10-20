import { randomBytes } from 'node:crypto';
import { MSG } from '../src/net/protocol.js';
import { companionId } from '../src/net/companionConfig.js';
import { exactCreationKeys, validateCompanionRecord } from '../src/net/companionCreation.js';

const PAIR = MSG.AGENT_COMPANION_PAIR ?? 'agent_companion_pair';
const PAIR_RESULT = MSG.AGENT_COMPANION_PAIR_RESULT ?? 'agent_companion_pair_result';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[0-9a-f]{64}$/;
const TOKEN = /^mncp_[0-9a-f]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9:_-]{1,100}$/;
const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_OWNERS = 64;
const MAX_REQUESTS_PER_MINUTE = 30;
const MAX_IN_FLIGHT = 32;
// The host mode fixes the grant: chat only, or (L03g-b, body presence on) chat plus the safe presence orders.
const CHAT_GRANT = Object.freeze(['chat']);
const BODY_GRANT = Object.freeze(['chat', 'presence']);
const copy = value => structuredClone(value);
const sessionOwner = session => session.ownerKey ?? session.key;
const ownerKey = owner => owner;
const pairKey = (owner, character) => `${owner}:${character}`;

function validSession(session, host) {
  return !!session && UUID.test(sessionOwner(session)) && !session.closed && !session.failed &&
    host.profiles.accounts.get(session.key) === session;
}

function sameContent(a, b) {
  return !!a && !!b && a.generation === b.generation && a.revisionId === b.revisionId;
}

function exact(value, keys) {
  return exactCreationKeys(value, keys);
}

// Pairing credentials are intentionally ephemeral. Restarting the host invalidates every code
// and bootstrap token, while the durable creation and stop records remain authoritative.
export class CompanionPairingService {
  constructor(host, { enabled = false, allowMemory = false, timeoutMs = 8000, now = Date.now } = {}) {
    if (typeof enabled !== 'boolean' || typeof allowMemory !== 'boolean' ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || typeof now !== 'function') {
      throw new TypeError('configuration');
    }
    Object.assign(this, { host, enabled, allowMemory, timeoutMs, now });
    this.ready = false;
    this.codes = new Map();
    this.tokens = new Map();
    this.owners = new Map();
    this.admitted = new Map();
    this.busy = new Set();
    this.rates = new Map();
  }

  time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('clock');
    return value;
  }

  async bounded(operation) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  async prepare() {
    const h = this.host, store = h.store, control = h.companionControl;
    if (!this.enabled || !h.resolvePlayer || !h.worldState?.id || !h.agentControl ||
        !h.companionCreation?.ready || !control?.managed || control.ready !== true ||
        !h.companionConfig?.ready ||
        (store.durable !== true && !this.allowMemory)) return;
    this.ready = true;
  }

  principal(sock) { return this.host.companionConfig.principal(sock); }

  // Never chosen by the record or the runner; each check accepts exactly the current mode's shape.
  grant() { return this.host.companionPresence?.enabled === true ? BODY_GRANT : CHAT_GRANT; }

  exactGrant(capabilities) {
    const grant = this.grant();
    return Array.isArray(capabilities) && capabilities.length === grant.length &&
      grant.every((capability, index) => capabilities[index] === capability);
  }

  owns(ownerId, characterId) {
    const owner = this.owners.get(ownerKey(ownerId));
    return owner?.binding.characterId === characterId && owner.binding.ownerId === ownerId;
  }

  quota(owner) {
    const now = this.time();
    for (const [key, row] of this.rates) if (now - row.at >= 60000) this.rates.delete(key);
    const row = this.rates.get(owner);
    if ((!row && this.rates.size >= MAX_OWNERS) || row?.count >= MAX_REQUESTS_PER_MINUTE) return false;
    this.rates.set(owner, { at: row?.at ?? now, count: (row?.count ?? 0) + 1 });
    return true;
  }

  handle(sock, message) {
    if (message?.t !== PAIR) return false;
    if (message.op === 'claim') this.claim(sock, message);
    else void this.dispatchOwner(sock, message);
    return true;
  }

  response(sock, requestId, values, session = null) {
    const h = this.host;
    if (h.sockets.get(sock.id) !== sock || sock.ws.readyState !== 1) return;
    if (session && this.principal(sock) !== session) return;
    h.sendTo(sock.id, { t: PAIR_RESULT, requestId, ok: values.why === null, why: values.why,
      enabled: this.ready, code: null, expiresAtMs: null, bootstrap: null, ...values });
  }

  async loadOwned(session, sock, current = () => true) {
    const h = this.host;
    const raw = await h.store.loadCompanionCreation({ world: h.worldState.id, owner: sessionOwner(session) });
    if (!current() || this.principal(sock) !== session || !validSession(session, h)) throw new Error('session');
    if (raw === null) return null;
    const record = validateCompanionRecord(raw);
    if (record.characterKey === sessionOwner(session) ||
        (h.agentControl.binding(record.characterKey) && !this.owns(sessionOwner(session), record.characterKey))) throw new Error('collision');
    const key = ownerKey(sessionOwner(session)), prior = this.owners.get(key);
    if (prior && prior.record.characterKey !== record.characterKey) throw new Error('collision');
    if (!prior && this.owners.size >= MAX_OWNERS) throw new Error('limit');
    const binding = h.agentControl.registerCreated({ ownerId: sessionOwner(session), characterId: record.characterKey,
      capabilities: [...this.grant()] });
    if (!binding || binding.ownerId !== sessionOwner(session) || binding.characterId !== record.characterKey ||
        !this.exactGrant(binding.capabilities) ||
        !h.companionControl.registerCreated(binding, record.control)) throw new Error('registration');
    const owner = prior ?? { binding, record, ownerSession: session, ownerSock: sock };
    owner.binding = binding; owner.record = record;
    owner.ownerSession = session; owner.ownerSock = sock;
    this.owners.set(key, owner);
    return owner;
  }

  async dispatchOwner(sock, message) {
    const h = this.host, session = this.principal(sock);
    const requestId = typeof message.requestId === 'string' && REQUEST_ID.test(message.requestId) ? message.requestId : null;
    const reply = (why, extra = {}) => this.response(sock, requestId, { why, ...extra }, session);
    if (!session) { reply('forbidden'); return; }
    if (!requestId || !['load', 'issue', 'revoke'].includes(message.op) || !exact(message, ['t', 'requestId', 'op'])) {
      reply('invalid_request'); return;
    }
    if (!this.ready) { reply('unavailable'); return; }
    if (this.busy.has(sock) || this.busy.size >= MAX_IN_FLIGHT || !this.quota(sessionOwner(session))) { reply('busy'); return; }
    this.busy.add(sock);
    let operation, abandoned = false;
    try {
      operation = Promise.resolve().then(async () => {
        if (this.principal(sock) !== session) throw new Error('session');
        const owner = await this.loadOwned(session, sock, () => !abandoned);
        if (this.principal(sock) !== session || abandoned) throw new Error('session');
        if (!owner) return { why: message.op === 'issue' ? 'not_created' : null };
        if (message.op === 'load') return { why: null };
        if (message.op === 'revoke') {
          this.revokeOwner(sessionOwner(session), 'revoked');
          return { why: null };
        }
        // With body presence on this answers "presence_body_required" unless the owner's body is live.
        const blocked = await h.companionPresence?.pairingBlocked(sessionOwner(session), owner.record.characterKey);
        if (blocked) return { why: typeof blocked === 'string' ? blocked : 'busy' };
        if (this.principal(sock) !== session || abandoned) throw new Error('session');
        if (!h.companionControl.allowed(owner.record.characterKey)) return { why: 'stopped' };
        // Replacing a code also invalidates any earlier admission and active socket.
        this.revokeOwner(sessionOwner(session), 'repaired');
        if (!h.companionControl.allowed(owner.record.characterKey) ||
            !h.agentControl.resume(sessionOwner(session), owner.record.characterKey)) return { why: 'stopped' };
        const refreshed = validateCompanionRecord(await h.store.loadCompanionCreation({
          world: h.worldState.id, owner: sessionOwner(session),
        }));
        if (!refreshed || refreshed.characterKey !== owner.record.characterKey ||
            this.principal(sock) !== session || !validSession(session, h) || abandoned ||
            !h.companionControl.allowed(refreshed.characterKey)) return { why: 'forbidden' };
        owner.record = refreshed;
        // L03g-b: the body may have left while the record reloaded; a code never outlives it.
        if (h.companionPresence?.enabled &&
            !h.companionPresence.liveBody(sessionOwner(session), refreshed.characterKey)) return { why: 'presence_body_required' };
        const ownerPeer = h.server.chat?.sessions?.get(owner.ownerSock.id)?.id;
        if (typeof ownerPeer !== 'string' || !UUID.test(ownerPeer)) return { why: 'unavailable' };
        const now = this.time(), code = randomBytes(32).toString('hex');
        for (const [oldCode, pending] of this.codes) if (pending.ownerId === sessionOwner(session)) this.codes.delete(oldCode);
        this.codes.set(code, { ownerId: sessionOwner(session), characterId: refreshed.characterKey, worldId: h.worldState.id,
          ownerSession: session, ownerSock: sock, record: refreshed, content: copy(h.contentIdentity ?? { generation: 0, revisionId: null }),
          ownerPeer, expiresAtMs: now + CODE_TTL_MS });
        return { why: null, code, expiresAtMs: now + CODE_TTL_MS };
      });
      operation.finally(() => this.busy.delete(sock)).catch(() => {});
      const result = await this.bounded(operation);
      reply(result.why, { ...(result.code ? { code: result.code, expiresAtMs: result.expiresAtMs } : {}) });
    } catch {
      abandoned = true;
      reply('unavailable');
    } finally {
      if (!operation) this.busy.delete(sock);
    }
  }

  claim(sock, message) {
    const requestId = typeof message.requestId === 'string' && REQUEST_ID.test(message.requestId) ? message.requestId : null;
    if (!requestId || !exact(message, ['t', 'requestId', 'op', 'code']) || message.op !== 'claim' ||
        typeof message.code !== 'string' || !CODE.test(message.code)) {
      this.response(sock, requestId, { why: 'invalid_request' }); return;
    }
    if (!this.ready) { this.response(sock, requestId, { why: 'unavailable' }); return; }
    const client = this.host.server.clients.get(sock.id);
    if (sock.joining || sock.agentIdentity || sock.worldAdmitted || client?.entity || client?.serverProfile) {
      this.response(sock, requestId, { why: 'forbidden' }); return;
    }
    if (!this.quota(`socket:${sock.id}`)) { this.response(sock, requestId, { why: 'busy' }); return; }
    const entry = this.codes.get(message.code);
    // Consume synchronously before any checks that could yield or any response is sent.
    this.codes.delete(message.code);
    if (!entry) { this.response(sock, requestId, { why: 'invalid_code' }); return; }
    const h = this.host, now = this.time(), owner = this.owners.get(entry.ownerId);
    if (now >= entry.expiresAtMs || entry.worldId !== h.worldState?.id || !owner ||
        owner.ownerSession !== entry.ownerSession || owner.ownerSock !== entry.ownerSock ||
        this.principal(entry.ownerSock) !== entry.ownerSession || !validSession(entry.ownerSession, h) ||
        h.server.chat?.sessions?.get(entry.ownerSock.id)?.id !== entry.ownerPeer ||
        !h.companionControl.allowed(entry.characterId) ||
        !sameContent(entry.content, h.contentIdentity ?? { generation: 0, revisionId: null })) {
      this.revokeOwner(entry.ownerId, 'revoked');
      this.response(sock, requestId, { why: 'expired' }); return;
    }
    const token = `mncp_${randomBytes(32).toString('hex')}`;
    const expiresAtMs = now + TOKEN_TTL_MS;
    const content = copy(entry.content);
    const refreshed = copy(entry.record);
    this.tokens.set(token, { ownerId: entry.ownerId, characterId: entry.characterId, worldId: entry.worldId,
      ownerSession: entry.ownerSession, ownerSock: entry.ownerSock, record: refreshed, content, expiresAtMs });
    this.response(sock, requestId, { why: null, bootstrap: { scope: { ownerId: entry.ownerId,
      characterId: entry.characterId, worldId: entry.worldId }, record: refreshed, token, expiresAtMs,
      content, ownerPeer: entry.ownerPeer } });
  }

  isCredential(value) { return typeof value === 'string' && value.startsWith('mncp_'); }

  resolveAuthorization(token, sock) {
    if (!this.ready || !this.isCredential(token) || !sock || this.admitted.has(sock.id)) return null;
    const entry = this.tokens.get(token);
    this.tokens.delete(token);
    if (!entry) return null;
    const h = this.host, owner = this.owners.get(entry.ownerId), now = this.time();
    if (now >= entry.expiresAtMs || entry.worldId !== h.worldState?.id || !owner ||
        owner.ownerSession !== entry.ownerSession || owner.ownerSock !== entry.ownerSock ||
        this.principal(entry.ownerSock) !== entry.ownerSession || !validSession(entry.ownerSession, h) ||
        !h.companionControl.allowed(entry.characterId) ||
        !sameContent(entry.content, h.contentIdentity ?? { generation: 0, revisionId: null })) {
      this.revokeOwner(entry.ownerId, 'revoked'); return null;
    }
    const registered = h.agentControl.ownedBinding(entry.ownerId, entry.characterId);
    if (!registered || !this.exactGrant(registered.capabilities)) return null;
    const record = validateCompanionRecord(entry.record);
    if (record.characterKey !== entry.characterId) return null;
    this.admitted.set(sock.id, { ownerId: entry.ownerId, characterId: entry.characterId, worldId: entry.worldId,
      ownerSession: entry.ownerSession, ownerSock: entry.ownerSock, content: copy(entry.content),
      expiresAtMs: entry.expiresAtMs });
    sock.companionPairOwner = entry.ownerId;
    sock.companionPairCharacter = entry.characterId;
    sock.companionPairExpiresAtMs = entry.expiresAtMs;
    return { identity: entry.characterId, record, ownerSession: entry.ownerSession, content: copy(entry.content) };
  }

  admissionCurrent(sock) {
    const entry = sock && this.admitted.get(sock.id);
    if (!entry) return false;
    const h = this.host, now = this.time();
    const current = now < entry.expiresAtMs && entry.worldId === h.worldState?.id &&
      this.principal(entry.ownerSock) === entry.ownerSession && validSession(entry.ownerSession, h) &&
      sameContent(entry.content, h.contentIdentity ?? { generation: 0, revisionId: null }) &&
      h.companionControl.allowed(entry.characterId) && this.admitted.get(sock.id) === entry;
    if (!current) this.revokeOwner(entry.ownerId, 'revoked');
    return current;
  }

  // L03g-b: a mind refused at HELLO keeps no admission, so closing its socket never revokes
  // the owner's pairing or the mind already attached to the body.
  forget(sock) { if (sock) this.admitted.delete(sock.id); }

  revokeOwner(ownerId, why = 'revoked') {
    if (!UUID.test(ownerId)) return false;
    for (const [code, entry] of this.codes) if (entry.ownerId === ownerId) this.codes.delete(code);
    for (const [token, entry] of this.tokens) if (entry.ownerId === ownerId) this.tokens.delete(token);
    const owner = this.owners.get(ownerKey(ownerId));
    if (!owner) return true;
    const state = this.host.agentControl.revoke(ownerId, owner.record.characterKey, why);
    if (state) this.host.publishAgentState({ ok: true, state }, null, true);
    for (const [id, admission] of this.admitted) if (admission.ownerId === ownerId) {
      const sock = this.host.sockets.get(id);
      this.admitted.delete(id);
      if (sock) {
        // Marked before the close handshake: the socket stays refused and uncounted until it leaves.
        sock.pairingRevoked = true;
        try { sock.ws.close(1008, 'pairing revoked'); } catch { /* gone */ }
      }
    }
    return true;
  }

  onClose(sock) {
    if (!sock) return;
    const admission = this.admitted.get(sock.id);
    this.admitted.delete(sock.id);
    if (admission) {
      const owner = this.owners.get(admission.ownerId);
      if (owner && owner.record.characterKey === admission.characterId) this.revokeOwner(admission.ownerId, 'disconnect');
      return;
    }
    for (const owner of this.owners.values()) if (owner.ownerSock === sock) {
      this.revokeOwner(owner.binding.ownerId, 'owner_disconnect');
      return;
    }
  }

  sweep() {
    const now = this.time();
    for (const [code, entry] of this.codes) {
      if (now >= entry.expiresAtMs || this.principal(entry.ownerSock) !== entry.ownerSession ||
          !validSession(entry.ownerSession, this.host) || !this.host.companionControl.allowed(entry.characterId) ||
          !sameContent(entry.content, this.host.contentIdentity ?? { generation: 0, revisionId: null })) {
        this.codes.delete(code);
        if (this.principal(entry.ownerSock) !== entry.ownerSession || !validSession(entry.ownerSession, this.host) ||
            !this.host.companionControl.allowed(entry.characterId) ||
            !sameContent(entry.content, this.host.contentIdentity ?? { generation: 0, revisionId: null })) this.revokeOwner(entry.ownerId, 'revoked');
      }
    }
    for (const [token, entry] of this.tokens) {
      if (now >= entry.expiresAtMs || this.principal(entry.ownerSock) !== entry.ownerSession ||
          !validSession(entry.ownerSession, this.host) || !this.host.companionControl.allowed(entry.characterId) ||
          !sameContent(entry.content, this.host.contentIdentity ?? { generation: 0, revisionId: null })) {
        this.tokens.delete(token);
        this.revokeOwner(entry.ownerId, 'revoked');
      }
    }
    for (const [id, entry] of this.admitted) {
      const sock = this.host.sockets.get(id);
      if (now >= entry.expiresAtMs || !sock || this.principal(entry.ownerSock) !== entry.ownerSession ||
          !validSession(entry.ownerSession, this.host) || !this.host.companionControl.allowed(entry.characterId) ||
          !sameContent(entry.content, this.host.contentIdentity ?? { generation: 0, revisionId: null })) {
        if (sock) { try { sock.ws.close(1008, 'pairing expired'); } catch { /* gone */ } }
        this.revokeOwner(entry.ownerId, 'revoked');
      }
    }
  }
}
