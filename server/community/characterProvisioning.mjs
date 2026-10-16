// Optional fresh-character bootstrap into the existing scoped identity. It does not admit
// gameplay, import M5/browser profiles, own mutations, or lease a character across hosts.
import { randomUUID } from 'node:crypto';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { ContributionError, canonical } from './contributionContract.mjs';
import { accountScope, characterAllocation, identityRecord } from './identityContract.mjs';

const fail = code => { throw new ContributionError(code); };
const freshProfile = binding => {
  const data = newProfile(); data.pirateId = `character:${binding.characterId}`;
  return data;
};
function authIdentity(raw) {
  try {
    canonical(raw);
    if (!raw || !Object.isFrozen(raw) || Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'accountId')) fail('identity');
    accountScope({ accountId: raw.accountId, worldId: 'validation', worldEpoch: '00000000-0000-4000-8000-000000000001' });
    return raw;
  } catch { fail('identity'); }
}

export class CharacterProvisioning {
  #scope;
  #resolveIdentity;
  #store;
  #uuid;
  #initialize;
  #clients = new Map();
  #accounts = new Map();

  constructor(identityStore, { worldId, worldEpoch, resolveIdentity,
    uuid = randomUUID, initializeProfile = freshProfile } = {}) {
    try {
      accountScope({ worldId, worldEpoch, accountId: '00000000-0000-4000-8000-000000000001' });
      if (typeof resolveIdentity !== 'function' || typeof uuid !== 'function' || typeof initializeProfile !== 'function'
        || ['loadIdentity', 'allocateIdentity'].some(k => typeof identityStore?.[k] !== 'function')) fail('configuration');
    } catch { fail('configuration'); }
    this.#scope = Object.freeze({ worldId, worldEpoch }); this.#resolveIdentity = resolveIdentity;
    this.#store = identityStore; this.#uuid = uuid; this.#initialize = initializeProfile;
  }
  #live(s) {
    if (s.closed || s.revoked || this.#clients.get(s.clientId) !== s) return false;
    try { if (authIdentity(this.#resolveIdentity(s.clientId)) === s.auth) return true; }
    catch { /* An observed invalid context revokes this attempt permanently. */ }
    s.revoked = true;
    return false;
  }
  #release(s) {
    if (this.#clients.get(s.clientId) === s) this.#clients.delete(s.clientId);
    if (this.#accounts.get(s.auth.accountId) === s) this.#accounts.delete(s.auth.accountId);
  }
  #scopeOf(s) { return { ...this.#scope, accountId: s.auth.accountId }; }
  #record(raw, s) { return identityRecord(raw, this.#scopeOf(s)); }
  #allocationResult(raw, s) {
    if (raw?.ok === false && raw.why === 'occupied' && Object.keys(raw).length === 2) fail('occupied');
    if (raw?.ok !== true || Object.keys(raw).length !== 3) fail('response');
    return this.#record({ binding: raw.binding, character: raw.character }, s);
  }
  #confirmed(s, record, recovery) {
    s.uncertain = false;
    const live = this.#live(s);
    this.#release(s);
    if (s.closed && recovery) return { ok: true, identity: record };
    if (!live) fail('identity');
    return recovery ? { ok: true, identity: record } : record;
  }

  // Host-created authenticated connection identity is the only source of account claims.
  // Initial data comes from a trusted synchronous server factory, never a joining profile.
  async provision(clientId) {
    if (typeof clientId !== 'string' || !clientId.length || clientId.length > 100 || this.#clients.has(clientId)) fail('session');
    const auth = authIdentity(this.#resolveIdentity(clientId));
    if (this.#accounts.has(auth.accountId)) fail('session');
    const s = { clientId, auth, phase: 'loading', running: true, closed: false, revoked: false,
      uncertain: false, request: null, reason: null };
    this.#clients.set(clientId, s); this.#accounts.set(auth.accountId, s);
    try {
      let record = await this.#store.loadIdentity(this.#scopeOf(s));
      if (!this.#live(s)) fail('identity');
      if (record !== null) record = this.#record(record, s);
      else {
        const binding = { ...this.#scopeOf(s), characterId: this.#uuid() };
        s.request = characterAllocation({ binding, data: this.#initialize(structuredClone(binding)) });
        if (!this.#live(s)) fail('identity');
        s.uncertain = true; s.phase = 'allocating';
        record = this.#allocationResult(await this.#store.allocateIdentity(structuredClone(s.request)), s);
      }
      return this.#confirmed(s, record, false);
    } catch (err) {
      const code = err instanceof ContributionError ? err.code : 'unavailable';
      if (code === 'occupied') s.uncertain = false;
      s.phase = 'fenced'; s.reason = code;
      if (!s.uncertain) this.#release(s);
      fail(code);
    } finally { s.running = false; }
  }
  inspect(clientId) {
    const s = this.#clients.get(clientId);
    return s ? { phase: s.closed ? 'closed' : s.phase, uncertain: s.uncertain, reason: s.reason,
      pending: s.request ? { binding: structuredClone(s.request.binding) } : null } : null;
  }
  close(clientId) {
    const s = this.#clients.get(clientId);
    if (!s) return;
    s.closed = true;
    if (!s.running && !s.uncertain) this.#release(s);
  }
  // Missing ownership after an ambiguous allocation is not a rejection. Retry, when
  // explicitly requested, resends the exact original binding/data, never a new UUID.
  async recover(clientId, { retry = false } = {}) {
    const s = this.#clients.get(clientId);
    if (!s || typeof retry !== 'boolean' || s.running || !s.uncertain || s.phase !== 'fenced') fail('session');
    if (!s.closed && !this.#live(s)) fail('identity');
    s.running = true;
    try {
      let record = await this.#store.loadIdentity(this.#scopeOf(s));
      if (record !== null) record = this.#record(record, s);
      else if (retry) record = this.#allocationResult(await this.#store.allocateIdentity(structuredClone(s.request)), s);
      else return { ok: false, why: 'pending' };
      return this.#confirmed(s, record, true);
    } catch (err) {
      const code = err instanceof ContributionError ? err.code : 'unavailable';
      if (code === 'occupied') { s.uncertain = false; this.#release(s); }
      s.reason = code;
      return { ok: false, why: code };
    } finally { s.running = false; }
  }
}
