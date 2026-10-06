// Server-only coordination. The simulation must stage an intent before publishing its effects;
// this queue never mutates a live profile or accepts a client-selected price/ownership request.
import { PEARL } from '../src/data/pearls.js';
import { StoreError, playerKey } from './store.mjs';
import { pearlIntent, pearlOperation, canonicalText, profilePearls, pearlKind, validPearlMove,
  checkedPearlResult, checkedPearlReceipt } from './pearlOperations.mjs';
import { groundIntent, groundOperation, checkedGroundResult, checkedGroundReceipt, checkedLocation } from './pearlGround.mjs';

// Both families share all reservations. A separate ground queue would allow an unresolved legacy
// request to race a new ground intent for the same UID, account or operation UUID.
const families = {
  pearl: { intent: pearlIntent, operation: pearlOperation, check: checkedPearlResult,
    receipt: checkedPearlReceipt, commit: 'commitPearl', read: 'loadPearlOperation' },
  ground: { intent: groundIntent, operation: groundOperation, check: checkedGroundResult,
    receipt: checkedGroundReceipt, commit: 'commitPearlGround', read: 'loadPearlGroundOperation' },
};

const clone = (v) => structuredClone(v);
const snapshot = (data) => ({ data: clone(data), text: JSON.stringify(data) });
const frozen = (v) => {
  if (v && typeof v === 'object') { Object.values(v).forEach(frozen); Object.freeze(v); }
  return v;
};
const storageError = (err) => err instanceof StoreError ? err : new StoreError('unavailable');
const stripped = (data, uid) => {
  const p = clone(data); delete p.gold;
  p.pearls.bag = p.pearls.bag.filter((q) => q.uid !== uid);
  if (p.pearls.swallowed?.uid === uid) p.pearls.swallowed = null;
  return canonicalText(p);
};
const location = (p, uid) => p.pearls.swallowed?.uid === uid ? 'swallowed' :
  p.pearls.bag.some((q) => q.uid === uid) ? 'bag' : null;

export class PearlQueue {
  constructor(sessions) {
    this.sessions = sessions; this.uids = new Map(); this.operationIds = new Map(); this.unresolved = new Map();
  }

  commit(raw, build, family = 'pearl') {
    let intent, lanes;
    try {
      intent = frozen(families[family].intent(raw));
      if (typeof build !== 'function') throw new StoreError('operation');
      if (this.uids.has(intent.uid) || this.operationIds.has(intent.operationId)) throw new StoreError('busy');
      lanes = [intent.from, intent.to].filter(Boolean).sort().map((id) => {
        const s = this.sessions.accounts.get(id);
        if (!s || s.closed || s.failed) throw new StoreError('session');
        if (s.pearlBusy) throw new StoreError('busy');
        return s;
      });
    } catch (err) { return Promise.reject(storageError(err)); }
    const ctx = { intent, family, lanes, before: new Map(), prior: [], uncertain: false, receiptSeen: false, concrete: null };
    // Reserve every lane before the first await. Capture pending pre-intent saves separately from
    // snapshots that arrive during the RPC, including LocalServer's final disconnect snapshot.
    for (const s of lanes) {
      ctx.before.set(s, s.pending); s.pending = null; s.pearlBusy = ctx;
      if (s.running) ctx.prior.push(s.running);
    }
    this.uids.set(intent.uid, ctx);
    this.operationIds.set(intent.operationId, ctx);
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
      const [registered, groundLocation] = await Promise.all([
        store.loadUnique(ctx.intent.uid),
        ctx.family === 'ground' ? store.loadPearlLocation(ctx.intent.uid).then(checkedLocation) : null,
      ]);
      this.ready(ctx);
      const { uid, kind, from, to, expectedVersion, operationId } = ctx.intent;
      if (registered && registered.kind !== pearlKind(kind)) throw new StoreError('kind');
      if ((registered?.version ?? 0) !== expectedVersion || (registered?.holder ?? null) !== from) {
        throw new StoreError('conflict');
      }
      if (ctx.family === 'ground') {
        if (groundLocation) {
          if (!registered || groundLocation.world !== ctx.intent.world || groundLocation.version !== registered.version ||
            (registered.holder === null) !== (groundLocation.ground !== null)) throw new StoreError('ownership');
        } else if (from === null && expectedVersion > 0) throw new StoreError('ownership');
      }
      const rows = ctx.lanes.map((s) => ({ id: s.key, version: s.version, data: clone(s.confirmed) }));
      const baseline = new Map(rows.map((p) => [p.id, clone(p)]));
      const built = build(clone(rows));
      if (!Array.isArray(built)) throw new StoreError('operation');
      const { request } = api.operation({ ...ctx.intent, profiles: built.map((p) => ({ ...p,
        expectedVersion: baseline.get(p?.id)?.version })) });
      if (!validPearlMove(request, baseline)) throw new StoreError('ownership');
      ctx.deltas = new Map(); ctx.baseline = baseline;
      for (const p of request.profiles) {
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
      ctx.concrete = frozen({ operationId, ...request });
      this.ready(ctx);
      let receipt;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          receipt = api.check(await store[api.commit](ctx.concrete), request);
          break;
        } catch (err) {
          const failure = storageError(err);
          if (!['unavailable', 'response'].includes(failure.code)) throw failure;
          if (attempt === 1) {
            // A missing receipt is not proof of rollback: an earlier transaction may still be
            // running. Preserve both reservations until a subsequent authoritative read settles it.
            ctx.uncertain = true;
            receipt = await this.readReceipt(ctx);
          }
        }
      }
      if (!receipt?.ok) throw new StoreError(receipt?.why ?? 'response');
      ctx.receiptSeen = true;
      if (receipt.replay) {
        ctx.uncertain = true;
        await this.verifyCurrent(ctx, receipt);
      } else ctx.uncertain = false;
      if (ctx.lanes.some((s) => s.failed)) throw new StoreError('conflict');
      for (const p of request.profiles) {
        const s = ctx.lanes.find((s) => s.key === p.id);
        s.version = receipt.profiles.find((r) => r.id === p.id).version;
        s.confirmed = clone(p.data); s.last = JSON.stringify(p.data);
        if (s.pending) s.pending = snapshot(this.rebase(ctx, p, s.pending.data));
      }
      return { receipt: clone(receipt), profiles: request.profiles.map((p) => ({ id: p.id,
        data: clone(ctx.lanes.find((s) => s.key === p.id).pending?.data ?? p.data) })) };
    } catch (err) {
      const failure = storageError(err);
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
    const raw = await this.sessions.store[api.read](ctx.intent.operationId);
    const stored = api.receipt(raw, ctx.intent.operationId);
    if (!stored) throw new StoreError('unavailable');
    const { operationId: _id, ...request } = ctx.concrete;
    if (canonicalText(stored.request) !== canonicalText(request)) throw new StoreError('operation');
    ctx.receiptSeen = true;
    return { ...stored.result, replay: true };
  }

  async verifyCurrent(ctx, receipt) {
    const store = this.sessions.store;
    const [rows, unique, groundLocation] = await Promise.all([
      Promise.all(ctx.concrete.profiles.map(async (p) => ({ id: p.id, row: await store.loadProfile(p.id) }))),
      store.loadUnique(ctx.intent.uid),
      ctx.family === 'ground' ? store.loadPearlLocation(ctx.intent.uid).then(checkedLocation) : null,
    ]);
    // Only completed authoritative reads settle the fence. Advanced state is a definitive conflict;
    // a provider/read failure leaves recovery pending even when the matching receipt is visible.
    ctx.reconciled = true; ctx.uncertain = false;
    const { uid: _uid, ...expectedUnique } = receipt.unique;
    if (canonicalText(unique) !== canonicalText(expectedUnique)) throw new StoreError('conflict');
    if (ctx.family === 'ground') {
      const { uid: _locationUid, ...expectedLocation } = receipt.location;
      if (canonicalText(groundLocation) !== canonicalText(expectedLocation)) throw new StoreError('conflict');
    }
    for (const { id, row } of rows) {
      if (row?.version !== receipt.profiles.find((p) => p.id === id)?.version ||
        canonicalText(row?.data) !== canonicalText(ctx.concrete.profiles.find((p) => p.id === id).data)) {
        throw new StoreError('conflict');
      }
    }
  }

  reconcile(rawId, family = 'pearl') {
    let ctx;
    try {
      ctx = this.unresolved.get(playerKey(rawId));
      if (!ctx || ctx.family !== family) throw new StoreError('operation');
      if (ctx.recovering) throw new StoreError('busy');
    } catch (err) { return Promise.reject(storageError(err)); }
    const task = (async () => {
      try {
        const receipt = await this.readReceipt(ctx);
        await this.verifyCurrent(ctx, receipt);
        return { receipt: clone(receipt), profiles: ctx.concrete.profiles.map(({ id, data }) => ({ id, data: clone(data) })) };
      } catch (err) { throw storageError(err); }
    })();
    ctx.recovering = task; this.sessions.tasks.add(task);
    const done = () => {
      ctx.recovering = null; this.sessions.tasks.delete(task);
      // Error accounting and failed sessions remain fenced. Recovery permits a closed account to load authoritative
      // state on a new connection; discarded, unconfirmed snapshots are never replayed.
      if (ctx.reconciled) { this.unresolved.delete(ctx.intent.operationId); this.release(ctx); }
    };
    task.then(done, done);
    return task;
  }

  release(ctx) {
    if (this.uids.get(ctx.intent.uid) === ctx) this.uids.delete(ctx.intent.uid);
    if (this.operationIds.get(ctx.intent.operationId) === ctx) this.operationIds.delete(ctx.intent.operationId);
    for (const s of ctx.lanes) {
      if (s.pearlBusy === ctx) s.pearlBusy = null;
      this.sessions.kick(s);
    }
  }
}
