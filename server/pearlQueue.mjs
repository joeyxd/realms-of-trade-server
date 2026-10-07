// Server-only coordination. The simulation must stage an intent before publishing its effects;
// this queue never mutates a live profile or accepts a client-selected price/ownership request.
import { deathOperation, checkedDeathResult, checkedDeathReceipt } from './deathOperation.mjs';
import { PEARL } from '../src/data/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { StoreError, playerKey } from './store.mjs';
import { pearlIntent, pearlOperation, canonicalText, profilePearls, pearlKind, validPearlMove,
  checkedPearlResult, checkedPearlReceipt } from './pearlOperations.mjs';
import { groundIntent, groundOperation, checkedGroundResult, checkedGroundReceipt, checkedLocation } from './pearlGround.mjs';
import { checkedJournalEntry, journalEntry } from './pearlJournal.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';
import { batchIntent, batchOperation, validBatchDelta, checkedBatchResult, checkedBatchReceipt } from './pearlBatch.mjs';

// All families share reservations; a second queue would let an unresolved single-UID operation
// overlap one item of a batch, its account, or its operation UUID.
const families = {
  death: { intent: (raw) => { const { operationId, request } = deathOperation(raw); return { operationId, ...request }; },
    operation: deathOperation, check: (raw, request, id) => checkedDeathResult(raw, request, id),
    receipt: checkedDeathReceipt, commit: 'commitDeath', read: 'loadDeathOperation' },
  pearl: { intent: pearlIntent, operation: pearlOperation, check: checkedPearlResult,
    receipt: checkedPearlReceipt, commit: 'commitPearl', read: 'loadPearlOperation' },
  ground: { intent: groundIntent, operation: groundOperation, check: checkedGroundResult,
    receipt: checkedGroundReceipt, commit: 'commitPearlGround', read: 'loadPearlGroundOperation' },
  batch: { intent: batchIntent, operation: batchOperation, check: checkedBatchResult,
    receipt: checkedBatchReceipt, commit: 'commitPearlBatch', read: 'loadPearlBatchOperation' },
};

const clone = (v) => structuredClone(v);
const accountKeys = (intent) => intent.victim ? intent.profiles.map((p) => p.id) : intent.items ? [intent.actor ?? intent.profile.id] :
  [...new Set([intent.from, intent.to].filter(Boolean))].sort();
const uidKeys = (intent) => intent.victim ? [...new Set(intent.profiles.flatMap((p) =>
  [...profilePearls(p.before), ...profilePearls(p.data)].map((q) => q.uid)))].sort() : intent.items ? intent.items.map((q) => q.uid) : [intent.uid];
const requestProfiles = (request) => request.items ? [request.profile] : request.profiles;
const recoveredIntent = (family, concrete) => family === 'batch' ? batchIntent({
  operationId: concrete.operationId, actor: concrete.profile.id, world: concrete.world,
  mode: concrete.mode, items: concrete.items,
}) : families[family].intent(concrete);
const snapshot = (data) => ({ data: clone(data), text: JSON.stringify(data) });
const frozen = (v) => {
  if (v && typeof v === 'object') { Object.values(v).forEach(frozen); Object.freeze(v); }
  return v;
};
const storageError = (err) => err instanceof StoreError ? err : new StoreError('unavailable');
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const currentVersion = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 2147483647;
const checkedCurrentProfile = (row) => {
  if (row === null) return null;
  if (!object(row) || Object.keys(row).sort().join(',') !== 'data,version' || !currentVersion(row.version) ||
    !object(row.data) || canonicalText(sanitizeProfile(row.data)) !== canonicalText(row.data)) throw new StoreError('response');
  return row;
};
const checkedCurrentUnique = (row) => {
  if (row === null) return null;
  if (!object(row) || Object.keys(row).sort().join(',') !== 'holder,kind,version' || !currentVersion(row.version) ||
    typeof row.kind !== 'string' || !row.kind.trim() || row.kind.length > 100 || row.kind.includes('\0')) throw new StoreError('response');
  try { if (row.holder !== null && playerKey(row.holder) !== row.holder) throw new Error('holder'); }
  catch { throw new StoreError('response'); }
  return row;
};
const stripped = (data, uid) => {
  const p = clone(data); delete p.gold;
  p.pearls.bag = p.pearls.bag.filter((q) => q.uid !== uid);
  if (p.pearls.swallowed?.uid === uid) p.pearls.swallowed = null;
  return canonicalText(p);
};
const location = (p, uid) => p.pearls.swallowed?.uid === uid ? 'swallowed' :
  p.pearls.bag.some((q) => q.uid === uid) ? 'bag' : null;

export class PearlQueue {
  constructor(sessions, journal = null) {
    this.sessions = sessions; this.uids = new Map(); this.operationIds = new Map(); this.unresolved = new Map();
    this.journal = journal; this.accountIds = new Map(); this.admitting = !journal; this.startup = null;
    if (journal && (!journal.scope || ['prepare', 'resolve', 'list'].some((key) => typeof journal[key] !== 'function'))) {
      throw new StoreError('configuration');
    }
  }

  requireReady() { if (!this.admitting) throw new StoreError('recovery'); }
  assertOpen(key) {
    this.requireReady();
    if (this.accountIds.has(key)) throw new StoreError('busy');
  }

  recover() {
    if (!this.journal) return Promise.resolve([]);
    if (this.startup) return this.startup;
    const task = (async () => {
      const entries = [], uids = new Set(), accounts = new Set(), ids = new Set();
      let afterId = null;
      // Validate the entire paginated backlog before installing any fence or attempting settlement.
      for (;;) {
        const raw = await this.journal.list({ afterId, limit: 64 });
        if (!Array.isArray(raw) || raw.length > 64) throw new StoreError('response');
        for (const value of raw) {
          const entry = checkedJournalEntry(value, this.journal.scope);
          const keys = accountKeys(entry.request), itemKeys = uidKeys(entry.request);
          if (entry.state !== 'pending' || (afterId !== null && entry.operationId <= afterId) ||
            ids.has(entry.operationId) || itemKeys.some((uid) => uids.has(uid)) || keys.some((id) => accounts.has(id))) {
            throw new StoreError('response');
          }
          ids.add(entry.operationId); itemKeys.forEach((uid) => uids.add(uid)); keys.forEach((id) => accounts.add(id));
          entries.push(entry); afterId = entry.operationId;
        }
        if (raw.length < 64) break;
      }
      for (const entry of entries) {
        const concrete = frozen({ operationId: entry.operationId, ...entry.request });
        const ctx = { intent: frozen(recoveredIntent(entry.family, concrete)), concrete, family: entry.family,
          lanes: [], before: new Map(), prior: [], uncertain: true, receiptSeen: false,
          journalStarted: true, prepared: true, recovered: true };
        this.reserve(ctx);
        this.unresolved.set(entry.operationId, ctx);
      }
      const outcomes = [];
      for (const entry of entries) {
        const ctx = this.unresolved.get(entry.operationId);
        try {
          await this.reconcile(entry.operationId, entry.family);
          outcomes.push({ operationId: entry.operationId, outcome: ctx.settledOutcome });
        } catch {
          outcomes.push({ operationId: entry.operationId, outcome: ctx.uncertain ? 'pending' : ctx.settledOutcome });
        }
      }
      this.admitting = true;
      return outcomes;
    })().catch((err) => { this.startup = null; throw storageError(err); });
    this.startup = task; this.sessions.tasks.add(task);
    task.then(() => this.sessions.tasks.delete(task), () => this.sessions.tasks.delete(task));
    return task;
  }

  reserve(ctx) {
    for (const uid of uidKeys(ctx.intent)) this.uids.set(uid, ctx);
    this.operationIds.set(ctx.intent.operationId, ctx);
    for (const id of accountKeys(ctx.intent)) this.accountIds.set(id, ctx);
  }

  async prepare(ctx) {
    if (!this.journal) return;
    journalEntry(this.journal.scope, ctx.family, ctx.concrete);
    ctx.journalStarted = true; ctx.uncertain = true;
    let raw;
    try { raw = await this.journal.prepare(ctx.family, ctx.concrete); }
    catch (err) {
      if (err instanceof StoreError && err.code === 'operation') { ctx.journalStarted = false; ctx.uncertain = false; }
      throw err;
    }
    const row = checkedJournalEntry(raw, this.journal.scope);
    const expected = journalEntry(this.journal.scope, ctx.family, ctx.concrete, row.state);
    if (canonicalText(row) !== canonicalText(expected)) throw new StoreError('response');
    if (row.state !== 'pending') {
      ctx.journalStarted = false; ctx.uncertain = false;
      throw new StoreError('operation');
    }
    ctx.prepared = true; ctx.uncertain = false;
  }

  async finish(ctx, outcome) {
    ctx.settledOutcome = outcome;
    if (!this.journal || !ctx.journalStarted) return;
    ctx.uncertain = true;
    let row;
    try { row = checkedJournalEntry(await this.journal.resolve(ctx.family, ctx.concrete, outcome), this.journal.scope); }
    catch (err) {
      // A committed terminal write can outlive its lost reply. If authoritative reads subsequently
      // prove advancement, preserve that audit outcome and retire this stale local context as conflict.
      if (outcome !== 'conflict' || !ctx.receiptSeen || !(err instanceof StoreError) || err.code !== 'operation') throw err;
      row = checkedJournalEntry(await this.journal.prepare(ctx.family, ctx.concrete), this.journal.scope);
      if (canonicalText(row) !== canonicalText(journalEntry(this.journal.scope, ctx.family, ctx.concrete, 'committed'))) throw err;
      ctx.uncertain = false;
      return;
    }
    if (canonicalText(row) !== canonicalText(journalEntry(this.journal.scope, ctx.family, ctx.concrete, outcome))) {
      throw new StoreError('response');
    }
    ctx.uncertain = false;
  }

  commit(raw, build, family = 'pearl', reservation = null) {
    let intent, lanes;
    try {
      this.requireReady();
      intent = frozen(families[family].intent(raw));
      if (family !== 'death' && typeof build !== 'function') throw new StoreError('operation');
      pearlMutationGate(this.sessions).assertStorageAvailable({
        accounts: accountKeys(intent), uids: uidKeys(intent),
      }, reservation);
      if (uidKeys(intent).some((uid) => this.uids.has(uid)) || this.operationIds.has(intent.operationId)) throw new StoreError('busy');
      lanes = accountKeys(intent).map((id) => {
        if (this.accountIds.has(id)) throw new StoreError('busy');
        const s = this.sessions.accounts.get(id);
        if (!s || s.closed || s.failed) throw new StoreError('session');
        if (s.pearlBusy) throw new StoreError('busy');
        return s;
      });
    } catch (err) { return Promise.reject(storageError(err)); }
    const ctx = { intent, family, lanes, reservation, before: new Map(), prior: [], uncertain: false, receiptSeen: false, concrete: null };
    // Reserve every lane before the first await. Capture pending pre-intent saves separately from
    // snapshots that arrive during the RPC, including LocalServer's final disconnect snapshot.
    for (const s of lanes) {
      ctx.before.set(s, s.pending); s.pending = null; s.pearlBusy = ctx;
      if (s.running) ctx.prior.push(s.running);
    }
    this.reserve(ctx);
    const task = Promise.resolve().then(() => this.run(ctx, build));
    this.sessions.tasks.add(task);
    const done = () => {
      this.sessions.tasks.delete(task);
      if (ctx.uncertain) this.unresolved.set(intent.operationId, ctx);
      else this.release(ctx);
    };
    task.then(done, done);
    return task;
  }

  ready(ctx) {
    pearlMutationGate(this.sessions).assertStorageAuthorized({
      accounts: accountKeys(ctx.intent), uids: uidKeys(ctx.intent),
    }, ctx.reservation);
    if (ctx.lanes.some((s) => s.failed)) throw new StoreError('conflict');
    if (ctx.lanes.some((s) => s.closed)) throw new StoreError('cancelled');
  }

  async run(ctx, build) {
    const owner = this.sessions, store = owner.store, api = families[ctx.family];
    try {
      this.ready(ctx);
      await Promise.all(ctx.prior);
      this.ready(ctx);
      for (const s of ctx.lanes) {
        const next = ctx.before.get(s);
        if (next) { await owner.writeOne(s, next); ctx.before.set(s, null); }
        this.ready(ctx);
      }
      const items = ctx.family === 'death' ? ctx.intent.pearls : ctx.family === 'batch' ? ctx.intent.items : [ctx.intent];
      const current = await Promise.all(items.map(async (q) => {
        const [registered, groundLocation] = await Promise.all([
          store.loadUnique(q.uid).then(checkedCurrentUnique),
          ctx.family !== 'pearl' ? store.loadPearlLocation(q.uid).then(checkedLocation) : null,
        ]);
        return { q, registered, groundLocation };
      }));
      this.ready(ctx);
      const { uid, kind, from, to, expectedVersion, operationId } = ctx.intent;
      for (const { q, registered, groundLocation } of current) {
        const source = ctx.family === 'death' ? ctx.intent.victim : ctx.family === 'batch' ? ctx.intent.actor : from;
        if (registered && registered.kind !== pearlKind(q.kind)) throw new StoreError('kind');
        if ((registered?.version ?? 0) !== q.expectedVersion || (registered?.holder ?? null) !== source) {
          throw new StoreError('conflict');
        }
        if (ctx.family !== 'pearl') {
          if (groundLocation) {
            if (!registered || groundLocation.world !== ctx.intent.world || groundLocation.version !== registered.version ||
              (registered.holder === null) !== (groundLocation.ground !== null)) throw new StoreError('ownership');
          } else if (source === null && q.expectedVersion > 0) throw new StoreError('ownership');
        }
      }
      const rows = ctx.lanes.map((s) => ({ id: s.key, version: s.version, data: clone(s.confirmed) }));
      const baseline = new Map(rows.map((p) => [p.id, clone(p)]));
      let request;
      if (ctx.family === 'death') {
        // Never recapture/rebase a death after waiting for saves. The authority must settle
        // progress before capture; every endpoint must still match the exact frozen baseline.
        for (const p of ctx.intent.profiles) {
          const row = baseline.get(p.id);
          if (row?.version !== p.expectedVersion || canonicalText(row.data) !== canonicalText(p.before)) {
            throw new StoreError('conflict');
          }
        }
        request = api.operation(ctx.intent).request;
        ctx.baseline = baseline;
      } else {
        const built = build(clone(rows));
        if (!Array.isArray(built) || (ctx.family === 'batch' && (built.length !== 1 || built[0]?.id !== ctx.intent.actor))) {
          throw new StoreError('operation');
        }
        const profiles = built.map((p) => ({ ...p, expectedVersion: baseline.get(p?.id)?.version }));
        ({ request } = api.operation(ctx.family === 'batch' ? {
          operationId, world: ctx.intent.world, mode: ctx.intent.mode, items: ctx.intent.items, profile: profiles[0],
        } : { ...ctx.intent, profiles }));
        if (ctx.family === 'batch' ? !validBatchDelta(request, baseline.get(ctx.intent.actor).data) :
          !validPearlMove(request, baseline)) throw new StoreError('ownership');
        ctx.deltas = new Map(); ctx.baseline = baseline;
        for (const p of requestProfiles(request)) {
          if (ctx.family === 'batch') { ctx.deltas.set(p.id, 0); continue; }
          const rawProfile = built.find((b) => b.id === p.id)?.data, before = baseline.get(p.id).data;
          // Reject clamping, duplicate UIDs and truncated bags at this command boundary. Ordinary
          // legacy profile loading continues to use the existing sanitizer.
          if (rawProfile?.gold !== p.data.gold || canonicalText(rawProfile?.pearls) !== canonicalText(p.data.pearls) ||
            stripped(before, uid) !== stripped(p.data, uid)) throw new StoreError('operation');
          const delta = p.data.gold - before.gold;
          if (!Number.isSafeInteger(delta) || delta < 0 || delta > 1e9 ||
            (delta !== 0 && !(p.id === from && to === null))) throw new StoreError('operation');
          ctx.deltas.set(p.id, delta);
        }
      }
      ctx.concrete = frozen({ operationId, ...request });
      this.ready(ctx);
      await this.prepare(ctx);
      // A disconnect during preparation cancels before dispatch and retires the exact journal row.
      this.ready(ctx);
      let receipt;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (this.journal) ctx.uncertain = true;
          receipt = api.check(await store[api.commit](ctx.concrete), request, operationId);
          break;
        } catch (err) {
          const failure = storageError(err);
          if (!['unavailable', 'response'].includes(failure.code)) { ctx.uncertain = false; throw failure; }
          if (attempt === 1) {
            // A missing receipt is not proof of rollback: an earlier transaction may still be
            // running. Preserve both reservations until a subsequent authoritative read settles it.
            ctx.uncertain = true;
            receipt = await this.readReceipt(ctx);
          }
        }
      }
      if (!receipt?.ok) { ctx.uncertain = false; throw new StoreError(receipt?.why ?? 'response'); }
      ctx.receiptSeen = true;
      if (receipt.replay) {
        ctx.uncertain = true;
        await this.verifyCurrent(ctx, receipt);
      } else ctx.uncertain = false;
      if (ctx.lanes.some((s) => s.failed)) throw new StoreError('conflict');
      // Saves can arrive while the journal closes. Rebase only after this await so no pre-result
      // snapshot bypasses the UID/gold delta while the simulation still awaits its committed result.
      await this.finish(ctx, 'committed');
      // Validate every pending rebase before advancing any local session authority.
      const updates = requestProfiles(request).map((p) => {
        const s = ctx.lanes.find((s) => s.key === p.id);
        return { s, p, pending: s.pending ? snapshot(this.rebase(ctx, p, s.pending.data)) : null };
      });
      for (const { s, p, pending } of updates) {
        s.version = receipt.profiles.find((r) => r.id === p.id).version;
        s.confirmed = clone(p.data); s.last = JSON.stringify(p.data); s.pending = pending;
      }
      return { receipt: clone(receipt), profiles: requestProfiles(request).map((p) => ({ id: p.id,
        data: clone(ctx.lanes.find((s) => s.key === p.id).pending?.data ?? p.data) })) };
    } catch (err) {
      let failure = storageError(err);
      if (ctx.journalStarted && !ctx.uncertain) {
        try { await this.finish(ctx, ctx.settledOutcome ?? (ctx.receiptSeen ? 'committed' : 'rejected')); }
        catch (journalError) { failure = storageError(journalError); }
      }
      if (failure.code === 'cancelled') {
        for (const s of ctx.lanes) if (!s.pending && ctx.before.get(s)) s.pending = ctx.before.get(s);
      } else {
        // Notify once per affected account. A closed socket cannot release an uncertain lane.
        for (const s of ctx.lanes) owner.fail(s, failure.code);
        // Ground-only mint/relocation has no account lane to carry the failure into flush().
        if (!ctx.lanes.length) owner.errors++;
      }
      throw failure;
    }
  }

  rebase(ctx, after, pending) {
    if (ctx.family === 'death') {
      // A late snapshot cannot restore bag/XP or rewrite unrelated progress onto a historical
      // death. Only the unchanged pre-death snapshot can be replaced by its exact post-state.
      const before = ctx.baseline.get(after.id).data;
      if (canonicalText(pending) !== canonicalText(before)) throw new StoreError('conflict');
      return clone(after.data);
    }
    if (ctx.family === 'batch') {
      // Whole-slot equality prevents a mixed old/new death or replacement from being accepted.
      // Ordinary progress remains current; no per-item mutation is published during this check.
      if (canonicalText(pending.pearls) !== canonicalText(ctx.baseline.get(after.id).data.pearls)) {
        throw new StoreError('ownership');
      }
      return { ...clone(pending), pearls: clone(after.data.pearls) };
    }
    const { uid, kind } = ctx.intent, before = ctx.baseline.get(after.id).data;
    const oldLocation = location(before, uid), pendingLocation = location(pending, uid);
    const copies = profilePearls(pending).filter((q) => q.uid === uid);
    if (pendingLocation !== oldLocation || copies.length !== (oldLocation ? 1 : 0) || copies.some((q) => q.kind !== kind)) {
      throw new StoreError('ownership');
    }
    const p = clone(pending);
    p.pearls.bag = p.pearls.bag.filter((q) => q.uid !== uid);
    if (p.pearls.swallowed?.uid === uid) p.pearls.swallowed = null;
    const nextLocation = location(after.data, uid);
    if (nextLocation === 'bag') {
      if (p.pearls.bag.length >= PEARL.bag) throw new StoreError('ownership');
      p.pearls.bag.push({ uid, kind });
    } else if (nextLocation === 'swallowed') {
      if (p.pearls.swallowed) throw new StoreError('ownership');
      p.pearls.swallowed = { uid, kind };
    }
    p.gold += ctx.deltas.get(after.id);
    if (!Number.isSafeInteger(p.gold) || p.gold > 1e9) throw new StoreError('profile');
    return p;
  }

  async readReceipt(ctx) {
    const api = families[ctx.family];
    ctx.receiptAbsent = false;
    const raw = await this.sessions.store[api.read](ctx.intent.operationId);
    const stored = api.receipt(raw, ctx.intent.operationId);
    if (!stored) { ctx.receiptAbsent = true; throw new StoreError('unavailable'); }
    const { operationId: _id, ...request } = ctx.concrete;
    if (canonicalText(stored.request) !== canonicalText(request)) throw new StoreError('operation');
    ctx.receiptSeen = true;
    return { ...stored.result, replay: true };
  }

  async verifyCurrent(ctx, receipt) {
    const store = this.sessions.store;
    const [rows, items] = await Promise.all([
      Promise.all(requestProfiles(ctx.concrete).map(async (p) => ({ id: p.id, row: checkedCurrentProfile(await store.loadProfile(p.id)) }))),
      Promise.all((ctx.family === 'death' ? ctx.intent.pearls.map((q) => q.uid) : uidKeys(ctx.intent)).map(async (uid) => {
        const [unique, groundLocation] = await Promise.all([
          store.loadUnique(uid).then(checkedCurrentUnique),
          ctx.family !== 'pearl' ? store.loadPearlLocation(uid).then(checkedLocation) : null,
        ]);
        return { uid, unique, groundLocation };
      })),
    ]);
    // Only completed authoritative reads settle the fence. Advanced state is a definitive conflict;
    // a provider/read failure leaves recovery pending even when the matching receipt is visible.
    ctx.reconciled = true; ctx.uncertain = false;
    ctx.settledOutcome = 'conflict';
    for (const { uid, unique, groundLocation } of items) {
      const { uid: _uid, ...expectedUnique } = ['batch', 'death'].includes(ctx.family) ?
        receipt.uniques.find((q) => q.uid === uid) : receipt.unique;
      if (canonicalText(unique) !== canonicalText(expectedUnique)) throw new StoreError('conflict');
      if (ctx.family !== 'pearl') {
        const { uid: _locationUid, ...expectedLocation } = ['batch', 'death'].includes(ctx.family) ?
          receipt.locations.find((q) => q.uid === uid) : receipt.location;
        if (canonicalText(groundLocation) !== canonicalText(expectedLocation)) throw new StoreError('conflict');
      }
    }
    for (const { id, row } of rows) {
      if (row?.version !== receipt.profiles.find((p) => p.id === id)?.version ||
        canonicalText(row?.data) !== canonicalText(requestProfiles(ctx.concrete).find((p) => p.id === id).data)) {
        throw new StoreError('conflict');
      }
    }
    ctx.settledOutcome = 'committed';
  }

  reconcile(rawId, family = 'pearl', resume = false) {
    let ctx;
    try {
      ctx = this.unresolved.get(playerKey(rawId));
      if (!ctx || ctx.family !== family) throw new StoreError('operation');
      if (ctx.recovering) throw new StoreError('busy');
    } catch (err) { return Promise.reject(storageError(err)); }
    ctx.uncertain = true; ctx.reconciled = false;
    const task = (async () => {
      try {
        // A known rolled-back response whose terminal write failed can be retired without a send.
        if (ctx.settledOutcome === 'rejected') {
          await this.finish(ctx, 'rejected'); ctx.reconciled = true;
          return { outcome: 'rejected' };
        }
        let receipt;
        try { receipt = await this.readReceipt(ctx); }
        catch (err) {
          // Only an authoritative null receipt permits an explicit single exact-request retry.
          if (!resume || !this.journal || !ctx.receiptAbsent || ctx.receiptSeen || ctx.settledOutcome) throw err;
          pearlMutationGate(this.sessions).assertStorageAuthorized({
            accounts: accountKeys(ctx.intent), uids: uidKeys(ctx.intent),
          }, ctx.reservation ?? null);
          await this.prepare(ctx);
          pearlMutationGate(this.sessions).assertStorageAuthorized({
            accounts: accountKeys(ctx.intent), uids: uidKeys(ctx.intent),
          }, ctx.reservation ?? null);
          const api = families[ctx.family], { operationId: _id, ...request } = ctx.concrete;
          ctx.uncertain = true;
          try { receipt = api.check(await this.sessions.store[api.commit](ctx.concrete), request, ctx.intent.operationId); }
          catch (err) {
            if (err instanceof StoreError && !['unavailable', 'response'].includes(err.code)) {
              await this.finish(ctx, 'rejected'); ctx.reconciled = true;
            }
            throw err;
          }
          if (!receipt.ok) {
            await this.finish(ctx, 'rejected'); ctx.reconciled = true;
            throw new StoreError(receipt.why);
          }
          ctx.receiptSeen = true;
        }
        await this.verifyCurrent(ctx, receipt);
        await this.finish(ctx, 'committed');
        return { receipt: clone(receipt), profiles: requestProfiles(ctx.concrete).map(({ id, data }) => ({ id, data: clone(data) })) };
      } catch (err) {
        if (ctx.reconciled && !ctx.uncertain && ctx.settledOutcome === 'conflict') {
          try { await this.finish(ctx, 'conflict'); } catch (journalError) { throw storageError(journalError); }
        }
        throw storageError(err);
      }
    })();
    ctx.recovering = task; this.sessions.tasks.add(task);
    const done = () => {
      ctx.recovering = null; this.sessions.tasks.delete(task);
      // Error accounting and failed sessions remain fenced. Recovery permits a closed account to load authoritative
      // state on a new connection; discarded, unconfirmed snapshots are never replayed.
      if (ctx.reconciled && !ctx.uncertain) { this.unresolved.delete(ctx.intent.operationId); this.release(ctx); }
    };
    task.then(done, done);
    return task;
  }

  release(ctx) {
    for (const uid of uidKeys(ctx.intent)) if (this.uids.get(uid) === ctx) this.uids.delete(uid);
    if (this.operationIds.get(ctx.intent.operationId) === ctx) this.operationIds.delete(ctx.intent.operationId);
    for (const id of accountKeys(ctx.intent)) {
      if (this.accountIds.get(id) === ctx) this.accountIds.delete(id);
    }
    for (const s of ctx.lanes) {
      if (s.pearlBusy === ctx) s.pearlBusy = null;
      this.sessions.kick(s);
    }
  }
}
