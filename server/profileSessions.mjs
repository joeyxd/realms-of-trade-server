// One profile authority per account within this host. Snapshot writes are serialized and coalesced;
// optimistic conflicts fence the session rather than reloading and overwriting a newer owner's state.
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { playerKey, StoreError } from './store.mjs';
import { pearlKind, profilePearls, canonicalText } from './pearlOperations.mjs';
import { PearlQueue } from './pearlQueue.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';

export class ProfileSessions {
  constructor(store, onFailure, { journal = null } = {}) {
    this.store = store;
    this.onFailure = onFailure;
    this.accounts = new Map();
    this.clients = new Map();
    this.tasks = new Set();
    this.errors = 0;
    this.pearls = new PearlQueue(this, journal);
  }

  async open(id, key, weapon = 0, initialize = null) {
    key = playerKey(key);
    if (this.accounts.has(key)) throw new StoreError('session');
    pearlMutationGate(this).assertAvailable({ accounts: [key] });
    const s = { id, key, version: 0, confirmed: null, pending: null, running: null, pearlBusy: null,
      last: null, failed: false, closed: false };
    this.accounts.set(key, s); this.clients.set(id, s);
    try {
      let row = await this.store.loadProfile(key);
      if (s.closed) throw new StoreError('cancelled');
      if (!row && initialize) {
        const fresh = newProfile({ weapon });
        fresh.pirateId = `account:${key}`;
        row = await initialize(key, fresh);
        if (s.closed) throw new StoreError('cancelled');
        if (!row) throw new StoreError('response');
      }
      const p = row ? sanitizeProfile(row.data) : newProfile({ weapon });
      if (!p) throw new StoreError('profile');
      if (row && (!Number.isSafeInteger(row.version) || row.version < 1 || row.version > 2147483647)) throw new StoreError('response');
      pearlMutationGate(this).assertAvailable({ uids: profilePearls(p).map((q) => q.uid) });
      await Promise.all(profilePearls(p).map(async (q) => {
        const registered = await this.store.loadUnique(q.uid);
        if (registered && (registered.kind !== pearlKind(q.kind) || registered.holder !== key ||
          !Number.isSafeInteger(registered.version) || registered.version < 1 || registered.version > 2147483647)) {
          throw new StoreError('ownership');
        }
      }));
      if (s.closed) throw new StoreError('cancelled');
      pearlMutationGate(this).assertAvailable({ accounts: [key], uids: profilePearls(p).map((q) => q.uid) });
      s.version = row?.version ?? 0;
      s.confirmed = structuredClone(p); s.last = row ? JSON.stringify(p) : null;
      return p;
    } catch (err) {
      this.release(s);
      throw err;
    }
  }

  save(id, raw, reservation = null) {
    const s = this.clients.get(id);
    if (!s || s.closed || s.failed) return;
    // LocalServer profiles are mutable; no reference to their later state crosses an await.
    const p = sanitizeProfile(raw);
    if (!p) { this.fail(s, 'profile'); return; }
    pearlMutationGate(this).assertSnapshotAvailable({ accounts: [s.key], uids: profilePearls(p).map((q) => q.uid) }, reservation);
    if (s.pearlBusy && canonicalText(raw.pearls) !== canonicalText(p.pearls)) { this.fail(s, 'ownership'); return; }
    s.pending = { data: p, text: JSON.stringify(p) };
    this.kick(s);
  }

  kick(s) {
    if (!s.pending || s.running || s.pearlBusy || s.failed) { this.maybeRelease(s); return; }
    const task = Promise.resolve().then(() => this.write(s));
    s.running = task; this.tasks.add(task);
    const done = () => {
      s.running = null; this.tasks.delete(task);
      this.kick(s);
    };
    task.then(done, done);
  }

  async write(s) {
    while (s.pending && !s.failed && !s.pearlBusy) {
      const next = s.pending; s.pending = null;
      if (next.text === s.last) continue;
      try {
        await this.writeOne(s, next);
      } catch (err) { this.fail(s, err instanceof StoreError ? err.code : 'unavailable'); return; }
    }
  }

  async writeOne(s, next) {
    if (next.text === s.last) return;
    const result = await this.store.saveProfile(s.key, next.data, s.version);
    if (result?.ok === false) throw new StoreError('conflict');
    if (result?.ok !== true || result.version !== s.version + 1) throw new StoreError('response');
    s.version = result.version; s.last = next.text; s.confirmed = structuredClone(next.data);
  }

  commitPearl(meta, build, reservation = null) { return this.pearls.commit(meta, build, 'pearl', reservation); }
  reconcilePearl(operationId) { return this.pearls.reconcile(operationId); }
  commitPearlGround(meta, build, reservation = null) { return this.pearls.commit(meta, build, 'ground', reservation); }
  reconcilePearlGround(operationId) { return this.pearls.reconcile(operationId, 'ground'); }
  commitPearlBatch(meta, build, reservation = null) { return this.pearls.commit(meta, build, 'batch', reservation); }
  reconcilePearlBatch(operationId) { return this.pearls.reconcile(operationId, 'batch'); }
  // Exact whole-death payload: baseline progress must be settled before its capture.
  commitDeath(concrete, reservation = null) { return this.pearls.commit(concrete, null, 'death', reservation); }
  reconcileDeath(operationId) { return this.pearls.reconcile(operationId, 'death'); }
  resumeDeath(operationId) { return this.pearls.reconcile(operationId, 'death', true); }
  recoverPearls() { return this.pearls.recover(); }
  resumePearl(operationId) { return this.pearls.reconcile(operationId, 'pearl', true); }
  resumePearlGround(operationId) { return this.pearls.reconcile(operationId, 'ground', true); }
  resumePearlBatch(operationId) { return this.pearls.reconcile(operationId, 'batch', true); }

  fail(s, code) {
    if (s.failed) return;
    pearlMutationGate(this).invalidate({ accounts: [s.key] });
    s.failed = true; s.pending = null; this.errors++;
    this.onFailure?.(s.id, code);
  }

  close(id) {
    const s = this.clients.get(id);
    if (!s) return;
    pearlMutationGate(this).invalidate({ accounts: [s.key] });
    s.closed = true;
    // Keep the account reserved until the final write ends, including a previous in-flight save.
    this.maybeRelease(s);
  }

  maybeRelease(s) { if (s.closed && !s.running && !s.pearlBusy && !s.pending) this.release(s); }

  release(s) {
    if (this.accounts.get(s.key) === s) {
      pearlMutationGate(this).invalidate({ accounts: [s.key] });
      this.accounts.delete(s.key);
    }
    if (this.clients.get(s.id) === s) this.clients.delete(s.id);
  }

  async flush() {
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
    if (this.errors || !this.pearls.admitting || (this.pearls.journal && this.pearls.unresolved.size)) throw new StoreError('flush');
  }
}
