// One gameplay reservation authority per ProfileSessions instance. Trusted adapters declare every
// affected account/UID before mutation; this does not make their writes durable or provide a lease.
import { StoreError, playerKey } from './store.mjs';
import { groundKey } from './pearlGround.mjs';

const gates = new WeakMap();
const MAX_LANES = 256, MAX_RESERVATIONS = 256;
const resources = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some((key) => key !== 'accounts' && key !== 'uids')) throw new StoreError('operation');
  const { accounts: accountList = [], uids: uidList = [] } = raw;
  const lists = [accountList, uidList];
  if (lists.some((list) => !Array.isArray(list) || list.length > MAX_LANES)) throw new StoreError('operation');
  // Array.from visits holes as undefined: a malformed list cannot silently omit a lane.
  const accounts = [...new Set(Array.from(lists[0], playerKey))], uids = [...new Set(Array.from(lists[1], groundKey))];
  return { accounts, uids };
};

class PearlMutationGate {
  #sessions; #accounts = new Map(); #uids = new Map(); #held = new Set(); #handles = new WeakMap();

  constructor(sessions) { this.#sessions = sessions; }

  #checkGameplay({ accounts, uids }, allowed = null) {
    for (const key of accounts) if (this.#accounts.has(key) && this.#accounts.get(key) !== allowed) throw new StoreError('busy');
    for (const uid of uids) if (this.#uids.has(uid) && this.#uids.get(uid) !== allowed) throw new StoreError('busy');
  }

  #check(lanes, allowed = null) {
    const sessions = this.#sessions, { accounts, uids } = lanes;
    sessions.pearls.requireReady(); this.#checkGameplay(lanes, allowed);
    for (const key of accounts) {
      sessions.pearls.assertOpen(key);
      const session = sessions.accounts.get(key);
      if (session?.pearlBusy) throw new StoreError('busy');
      if (session?.closed || session?.failed) throw new StoreError('session');
    }
    for (const uid of uids) if (sessions.pearls.uids.has(uid)) throw new StoreError('busy');
  }

  assertAvailable(raw) { this.#check(resources(raw)); }

  #authorization(lanes, handle) {
    if (handle === null) return null;
    const entry = this.#entry(handle);
    if (entry.state !== 'held' || entry.invalid) throw new StoreError('cancelled');
    for (const kind of ['accounts', 'uids']) if (lanes[kind].length !== entry[kind].length ||
        lanes[kind].some((key) => !entry[kind].includes(key))) throw new StoreError('operation');
    return entry;
  }

  // Storage may enter its caller's exact gameplay reservation. Other session commit callers cannot
  // bypass that reservation. The token never enters an RPC DTO or journal row.
  assertStorageAvailable(raw, handle = null) {
    const lanes = resources(raw); this.#check(lanes, this.#authorization(lanes, handle));
  }

  // Once the queue owns its storage lanes, check only gameplay authorization. Read-only reconcile
  // remains independent; an explicit resume must pass this check before another mutation is sent.
  assertStorageAuthorized(raw, handle = null) {
    const lanes = resources(raw); this.#checkGameplay(lanes, this.#authorization(lanes, handle));
  }

  // Snapshots may retain other unreserved UIDs in this account. Internal pre-command/apply saves
  // carry the owner's token; an ordinary save cannot write the old live UID through an apply gap.
  assertSnapshotAvailable(raw, handle = null) {
    const lanes = resources(raw);
    let allowed = null;
    if (handle !== null) {
      allowed = this.#entry(handle);
      if (allowed.state !== 'held' || allowed.invalid) throw new StoreError('cancelled');
      if (lanes.accounts.length !== 1 || !allowed.accounts.includes(lanes.accounts[0])) throw new StoreError('operation');
    }
    this.#checkGameplay(lanes, allowed);
  }

  reserve(raw) {
    const lanes = resources(raw);
    if (!lanes.accounts.length && !lanes.uids.length) throw new StoreError('operation');
    this.#check(lanes);
    if (this.#held.size >= MAX_RESERVATIONS) throw new StoreError('busy');
    // Validate/check the entire set before installing anything. Opaque capabilities prevent a
    // copied or stale handle from releasing another operation, including one with the same lanes.
    const handle = Object.freeze({}), entry = { ...lanes, state: 'held', invalid: false };
    this.#handles.set(handle, entry); this.#held.add(entry);
    for (const key of lanes.accounts) this.#accounts.set(key, entry);
    for (const uid of lanes.uids) this.#uids.set(uid, entry);
    return handle;
  }

  #entry(handle) {
    const entry = handle && typeof handle === 'object' && this.#handles.get(handle);
    if (!entry || entry.state === 'released') throw new StoreError('operation');
    return entry;
  }

  active(handle) {
    const entry = this.#entry(handle);
    return entry.state === 'held' && !entry.invalid;
  }

  release(handle) {
    const entry = this.#entry(handle);
    if (entry.state !== 'held' || entry.invalid) throw new StoreError('busy');
    entry.state = 'released'; this.#held.delete(entry);
    for (const key of entry.accounts) this.#accounts.delete(key);
    for (const uid of entry.uids) this.#uids.delete(uid);
  }

  // Sticky across death -> revival or detach -> reattach. Invalid/fenced reservations never become
  // available through receipt reconciliation; only rebuilding authority can clear them.
  invalidate(raw) {
    const lanes = resources(raw), entries = new Set();
    for (const key of lanes.accounts) { const entry = this.#accounts.get(key); if (entry) entries.add(entry); }
    for (const uid of lanes.uids) { const entry = this.#uids.get(uid); if (entry) entries.add(entry); }
    for (const entry of entries) entry.invalid = true;
  }

  fence(handle) { const entry = this.#entry(handle); entry.state = 'fenced'; entry.invalid = true; }
}

// Every coordinator for the same profile authority gets this exact gate. No independent constructor
// is exported: creating a second staging instance cannot create a second gameplay lane map.
export function pearlMutationGate(sessions) {
  if (!sessions || typeof sessions !== 'object' || !(sessions.accounts instanceof Map) ||
      !(sessions.pearls?.uids instanceof Map) || typeof sessions.pearls.requireReady !== 'function' ||
      typeof sessions.pearls.assertOpen !== 'function') throw new StoreError('configuration');
  let gate = gates.get(sessions);
  if (!gate) { gate = new PearlMutationGate(sessions); gates.set(sessions, gate); }
  return gate;
}
