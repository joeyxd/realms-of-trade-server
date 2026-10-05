// One profile authority per account within this host. Snapshot writes are serialized and coalesced;
// optimistic conflicts fence the session rather than reloading and overwriting a newer owner's state.
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { playerKey, StoreError } from './store.mjs';

export class ProfileSessions {
  constructor(store, onFailure) {
    this.store = store;
    this.onFailure = onFailure;
    this.accounts = new Map();
    this.clients = new Map();
    this.tasks = new Set();
    this.errors = 0;
  }

  async open(id, key, weapon = 0) {
    key = playerKey(key);
    if (this.accounts.has(key)) throw new StoreError('session');
    const s = { id, key, version: 0, pending: null, running: null, last: null, failed: false, closed: false };
    this.accounts.set(key, s); this.clients.set(id, s);
    try {
      const row = await this.store.loadProfile(key);
      if (s.closed) throw new StoreError('cancelled');
      const p = row ? sanitizeProfile(row.data) : newProfile({ weapon });
      if (!p) throw new StoreError('profile');
      if (row && (!Number.isSafeInteger(row.version) || row.version < 1 || row.version > 2147483647)) throw new StoreError('response');
      s.version = row?.version ?? 0;
      return p;
    } catch (err) {
      this.release(s);
      throw err;
    }
  }

  save(id, raw) {
    const s = this.clients.get(id);
    if (!s || s.closed || s.failed) return;
    // LocalServer profiles are mutable; no reference to their later state crosses an await.
    const p = sanitizeProfile(raw);
    if (!p) { this.fail(s, 'profile'); return; }
    s.pending = { data: p, text: JSON.stringify(p) };
    if (s.running) return;
    const task = Promise.resolve().then(() => this.write(s));
    s.running = task; this.tasks.add(task);
    task.finally(() => {
      s.running = null; this.tasks.delete(task);
      if (s.closed) this.release(s);
    });
  }

  async write(s) {
    while (s.pending && !s.failed) {
      const next = s.pending; s.pending = null;
      if (next.text === s.last) continue;
      try {
        const result = await this.store.saveProfile(s.key, next.data, s.version);
        if (!result?.ok) { this.fail(s, 'conflict'); return; }
        s.version = result.version; s.last = next.text;
      } catch { this.fail(s, 'unavailable'); return; }
    }
  }

  fail(s, code) {
    s.failed = true; s.pending = null; this.errors++;
    this.onFailure(s.id, code);
  }

  close(id) {
    const s = this.clients.get(id);
    if (!s) return;
    s.closed = true;
    // Keep the account reserved until the final write ends, including a previous in-flight save.
    if (!s.running) this.release(s);
  }

  release(s) {
    if (this.accounts.get(s.key) === s) this.accounts.delete(s.key);
    if (this.clients.get(s.id) === s) this.clients.delete(s.id);
  }

  async flush() {
    while (this.tasks.size) await Promise.all([...this.tasks]);
    if (this.errors) throw new StoreError('flush');
  }
}
