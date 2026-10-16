// Optional A1b2b1 admission over pre-provisioned immutable character ownership.
// Auth contexts belong to verified host connections, never to HELLO/client claims.
// An optional journal gates this owner's sessions; this is not a GameHost mount or cross-host lease.
import { ContributionError, canonical, contributionCharacter } from './contributionContract.mjs';
import { characterBinding } from './characterBindingContract.mjs';
import { ScopedProfileSessions } from './scopedProfileSessions.mjs';
import { CommunityOperationRecovery } from './operationRecovery.mjs';
import { operationEntry } from './operationJournalContract.mjs';

const fail = code => { throw new ContributionError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL = '00000000-0000-0000-0000-000000000000';
function identity(raw) {
  // A stable frozen reference distinguishes a replaced connection even when its account
  // string is unchanged. The host creates this object only after authentication succeeds.
  try {
    canonical(raw);
    if (!raw || Array.isArray(raw) || typeof raw !== 'object' || !Object.isFrozen(raw)
      || Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'accountId')
      || typeof raw.accountId !== 'string' || !UUID.test(raw.accountId) || raw.accountId === NIL) fail('identity');
    return raw;
  } catch { fail('identity'); }
}

export class BoundProfileSessions {
  #sessions;
  #clients = new Map();
  #accounts = new Map();
  #resolveIdentity;
  #scope;
  #loadBinding;
  #draining = false;
  #deferredCloses = new Set();
  #recovery = null;
  #active = 0;

  constructor(store, { worldId, worldEpoch, resolveIdentity, operationStore = null,
    allowVolatile = false, pageSize = 128, maxPending = 8192, uuid } = {}) {
    if (typeof store?.loadBinding !== 'function' || typeof resolveIdentity !== 'function') fail('configuration');
    try {
      contributionCharacter({ worldId, worldEpoch, characterId: '00000000-0000-4000-8000-000000000001',
        version: 1, data: { v: 1, eco: { pack: { goods: {} } } } });
    } catch { fail('configuration'); }
    this.#scope = Object.freeze({ worldId, worldEpoch });
    this.#resolveIdentity = resolveIdentity;
    let journal = null;
    if (operationStore !== null) {
      this.#recovery = new CommunityOperationRecovery(operationStore,
        { worldId, worldEpoch, allowVolatile, pageSize, maxPending });
      journal = {
        canAdmit: () => this.#recovery.canAdmit(),
        execute: (raw, canContinue) => this.#recovery.execute(raw, { canContinue }),
        invalidate: (reason, intent) => this.#recovery.invalidate(reason, intent),
        loadOperation: async id => {
          try {
            const raw = await operationStore.loadOperation(id);
            if (raw === null) return null;
            const entry = operationEntry(raw);
            if (entry.intent.operationId !== id) fail('response');
            return entry;
          } catch (err) {
            this.#recovery.invalidate(err?.code === 'response' ? 'response' : 'unavailable');
            throw err;
          }
        },
      };
    }
    this.#sessions = new ScopedProfileSessions(store, { journal, uuid, resolveBinding: clientId => {
      const entry = this.#clients.get(clientId);
      if (!this.#live(entry) || !entry.binding) fail('identity');
      return entry.binding;
    } });
    // Retain the store only in the admission closure; callers cannot bypass the inner
    // resolver or replace a validated binding through exposed session maps.
    this.#loadBinding = (accountId) => store.loadBinding(accountId, worldId, worldEpoch);
  }

  // Private authority is checked at every forward and again by the inner tick drain.
  #live(entry) {
    if (!entry || entry.closed || entry.revoked || this.#clients.get(entry.clientId) !== entry) return false;
    try {
      if (identity(this.#resolveIdentity(entry.clientId)) === entry.auth) return true;
    } catch { /* Invalid or missing auth is revocation, never a temporary permission. */ }
    entry.revoked = true;
    return false;
  }
  #entry(clientId) {
    const entry = this.#clients.get(clientId);
    if (!entry) fail('session');
    return entry;
  }
  #authorize(entry) {
    if (!this.#live(entry)) fail('identity');
    this.#ready();
    if (entry.opening || !entry.binding) fail('busy');
  }
  #release(entry) {
    if (this.#clients.get(entry.clientId) === entry) this.#clients.delete(entry.clientId);
    if (this.#accounts.get(entry.auth.accountId) === entry) this.#accounts.delete(entry.auth.accountId);
  }
  #reap(entry) {
    // An uncertain inner write owns both reservations until its exact recovery settles.
    if (!entry.opening && !this.#sessions.clients.has(entry.clientId)) this.#release(entry);
  }
  #ready() { if (this.#recovery && !this.#recovery.canAdmit()) fail('startup'); }
  #work(entry, work, closedRecovery = false) {
    this.#active++;
    let pending;
    try { pending = work(); }
    catch (err) { this.#active--; throw err; }
    return pending.then(result => {
      // Results belong to the original authenticated incarnation. Closed administrative
      // recovery may inspect evidence, but a late gameplay reply cannot revive a peer.
      if (this.#recovery && !closedRecovery && !this.#live(entry))
        return { ok: false, why: entry.closed ? 'closed' : 'identity' };
      return result;
    }).finally(() => { this.#active--; this.#reap(entry); });
  }

  recoveryView() { return this.#recovery?.view() ?? null; }
  recoverWorld(options = {}) {
    if (!this.#recovery) fail('configuration');
    if (this.#active || this.#draining) fail('busy');
    return this.#recovery.recover(options);
  }

  async open(clientId) {
    this.#ready();
    if (typeof clientId !== 'string' || !clientId.length || clientId.length > 100
      || this.#clients.has(clientId)) fail('session');
    let auth;
    try { auth = identity(this.#resolveIdentity(clientId)); } catch { fail('identity'); }
    if (this.#accounts.has(auth.accountId)) fail('session');
    const entry = { clientId, auth, closed: false, revoked: false, opening: true, binding: null };
    this.#clients.set(clientId, entry); this.#accounts.set(auth.accountId, entry);
    this.#active++;
    try {
      // Provisioning/import is a different trusted operation. Admission never creates
      // a character or accepts an account/world/character supplied by the joining client.
      const raw = await this.#loadBinding(auth.accountId);
      if (!this.#live(entry) || raw === null) fail('identity');
      this.#ready();
      let binding;
      try { binding = characterBinding(raw); } catch { fail('response'); }
      if (binding.accountId !== auth.accountId || binding.worldId !== this.#scope.worldId
        || binding.worldEpoch !== this.#scope.worldEpoch) fail('response');
      entry.binding = Object.freeze(binding);
      const opened = await this.#sessions.open(clientId);
      if (!this.#live(entry)) fail('identity');
      return opened;
    } catch (err) {
      this.#sessions.close(clientId);
      throw err;
    } finally { this.#active--; entry.opening = false; this.#reap(entry); }
  }

  view(clientId) {
    const entry = this.#entry(clientId);
    if (!this.#live(entry)) return { phase: entry.closed ? 'closed' : 'fenced', binding: null,
      character: null, token: null, reason: 'identity', pending: null };
    if (entry.opening) return { phase: entry.closed ? 'closed' : 'loading', binding: null,
      character: null, token: null, reason: null, pending: null };
    return this.#sessions.view(clientId);
  }
  canMutate(clientId) {
    const entry = this.#clients.get(clientId);
    return this.#live(entry) && (!this.#recovery || this.#recovery.canAdmit())
      && !entry.opening && this.#sessions.canMutate(clientId);
  }
  save(clientId, token, data) {
    const entry = this.#entry(clientId); this.#authorize(entry);
    return this.#work(entry, () => this.#sessions.save(clientId, token, data));
  }
  contribute(clientId, token, intent) {
    const entry = this.#entry(clientId); this.#authorize(entry);
    return this.#work(entry, () => this.#sessions.contribute(clientId, token, intent));
  }
  recover(clientId, options = {}) {
    const entry = this.#entry(clientId);
    if (!entry.closed) this.#authorize(entry);
    this.#ready();
    return this.#work(entry, () => this.#sessions.recover(clientId, options), entry.closed);
  }
  drain(publish) {
    if (typeof publish !== 'function' || publish.constructor?.name === 'AsyncFunction') fail('configuration');
    if (this.#draining) fail('busy');
    if (this.#recovery && !this.#recovery.canAdmit()) return [];
    this.#draining = true;
    try {
      return this.#sessions.drain(event => {
        const entry = this.#entry(event.clientId); this.#authorize(entry);
        return publish(event);
      });
    } finally {
      this.#draining = false;
      // Reentrant close cannot invalidate an otherwise atomic publication halfway through.
      // The trusted publisher must likewise leave its auth resolver unchanged during drain.
      const closes = [...this.#deferredCloses]; this.#deferredCloses.clear();
      for (const clientId of closes) this.close(clientId);
      for (const entry of this.#clients.values()) this.#reap(entry);
    }
  }
  close(clientId) {
    const entry = this.#clients.get(clientId);
    if (!entry) return;
    if (this.#draining) { this.#deferredCloses.add(clientId); return; }
    entry.closed = true;
    this.#sessions.close(clientId);
    this.#reap(entry);
  }
}
