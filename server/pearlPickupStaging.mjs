// Dormant persistent pearl pickup. Hold the completed tick until settle + synchronous drain.
// The clock is an explicit trusted domain assertion; no legacy timestamp adoption or host mounting.
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { C, KIND } from '../src/sim/ecs.js';
import { DROPS } from '../src/data/loot.js';
import { sanitizePearl } from '../src/data/pearls.js';
import { pickPearl } from '../src/sim/systems/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { StoreError, playerKey } from './store.mjs';
import { canonicalText, pearlKind, profilePearls } from './pearlOperations.mjs';
import { groundKey, checkedLocation, groundOperation, checkedGroundResult } from './pearlGround.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';

const clone = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const record = (raw, keys) => {
  const value = snapshotDropData(raw);
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys) throw new StoreError('operation');
  return value;
};
const columns = (ecs, entity) => Object.entries(ecs)
  .filter(([, column]) => ArrayBuffer.isView(column) && !(column instanceof DataView))
  .map(([key, column]) => ({ key, column, value: column[entity] }));
const codeOf = error => error instanceof StoreError ? error.code : 'unavailable';

export class PearlPickupStaging {
  #clock; #records = new WeakMap(); #entering = false; #violation = false;

  constructor(sessions, world, scope, { limit = 64, deadlineClock } = {}) {
    Object.defineProperty(this, 'scope', { value: groundKey(scope), enumerable: true });
    this.#clock = assertGroundDeadlineClock(deadlineClock, this.scope);
    if (!Number.isInteger(limit) || limit < 1 || limit > 256 ||
        (sessions.pearls.journal && sessions.pearls.journal.scope !== this.scope)) throw new StoreError('configuration');
    this.sessions = sessions; this.world = world; this.limit = limit;
    this.gate = pearlMutationGate(sessions);
    this.operations = new Map(); this.accounts = new Map(); this.tasks = new Set(); this.completed = []; this.sequence = 0;
  }

  #entry(callback, report = false) {
    if (this.#entering) { this.#violation = true; throw new StoreError('busy'); }
    this.#entering = true; this.#violation = false;
    try { const result = callback(); if (this.#violation && !report) throw new StoreError('effect'); return result; }
    finally { this.#entering = false; }
  }

  #endpoint(raw) {
    const { clientId, entity } = record(raw, 'clientId,entity'), w = this.world, ecs = w.ecs;
    const session = this.sessions.clients.get(clientId), profile = w.profiles.get(entity);
    if (!Number.isSafeInteger(clientId) || clientId < 0 || !Number.isInteger(entity) || entity < 1 || entity >= ecs.cap ||
        !session || session.closed || session.failed || session.id !== clientId ||
        ecs.clientId[entity] !== clientId || !ecs.alive[entity] || ecs.dead[entity] > 0 ||
        ecs.kind[entity] !== KIND.PLAYER || !(ecs.mask[entity] & C.PLAYER) ||
        !profile || profile.pirateId !== 'account:' + session.key) throw new StoreError('session');
    const live = snapshotDropData(profile);
    if (!same(live, sanitizeProfile(live))) throw new StoreError('profile');
    return { clientId, entity, session, profile, key: session.key, live: freeze(live),
      name: ecs.names[entity], columns: columns(ecs, entity) };
  }

  pickup(raw) { return this.#entry(() => this.#pickup(raw)); }

  #pickup(raw) {
    if (this.operations.size >= this.limit) throw new StoreError('busy');
    const { dropId, receiver } = record(raw, 'dropId,receiver'), w = this.world;
    assertDropContainers(w);
    if (!Number.isSafeInteger(w.tick) || w.tick < 0 || !Number.isSafeInteger(dropId) || dropId < 1) throw new StoreError('operation');
    const drop = w.drops.get(dropId), source = freeze(snapshotDropData(drop)), pearl = sanitizePearl(source.pearl);
    if (source.id !== dropId || source.to !== 0 || source.kind !== 'pearl' || !pearl || !same(pearl, source.pearl)) throw new StoreError('operation');
    const sourceGround = freeze(this.#clock.assertDrop(source, 'pearl')), at = this.#clock.at(w.tick);
    if (at < sourceGround.availableAt || at > sourceGround.returnAt) throw new StoreError('ownership');
    const endpoint = this.#endpoint(receiver);
    if (Math.hypot(w.ecs.x[endpoint.entity] - source.x, w.ecs.z[endpoint.entity] - source.z) > DROPS.pickR) throw new StoreError('ownership');
    const before = freeze(capturePearlProfile(w, endpoint.entity));
    const uids = [...new Set([...profilePearls(before).map(q => q.uid), pearl.uid])];
    this.gate.assertAvailable({ accounts: [endpoint.key], uids });
    const ledgers = new Map(uids.map(uid => [uid, freeze(snapshotDropData(w.pearlLedger.get(uid)))]));
    if (!same(ledgers.get(pearl.uid), { owner: '', entity: 0, place: 'ground', drop: dropId })) throw new StoreError('ownership');
    if (profilePearls(before).some(q => q.uid === pearl.uid)) throw new StoreError('ownership');
    // Only a verified projection is stripped for the detached gameplay helper. Live provenance stays intact.
    const localDrop = clone(source); delete localDrop.groundClock;
    const view = { tick: w.tick, profiles: new Map([[endpoint.entity, clone(before)]]),
      pearlLedger: clone(ledgers), drops: new Map([[dropId, localDrop]]), profileDirty: new Set(),
      events: [], emit(event) { this.events.push(clone(event)); } };
    if (!pickPearl(view, localDrop, endpoint.entity)) throw new StoreError(view.events.at(-1)?.why ?? 'ownership');
    const after = freeze(snapshotDropData(view.profiles.get(endpoint.entity))), events = freeze(view.events);
    if (!same(after, sanitizeProfile(after))) throw new StoreError('profile');
    // The queue requires an exact single-UID capability; the account lane guards every held pearl.
    const reservation = this.gate.reserve({ accounts: [endpoint.key], uids: [pearl.uid] }), operationId = randomUUID();
    const ctx = { operationId, state: 'pending', sequence: ++this.sequence, request: null, receipt: null };
    const bound = { operationId, reservation, endpoint, before, after, events, ledgers, uids, drop, dropId, source, sourceGround,
      at: w.tick, durableAt: at, request: null, meta: null, receipt: null, ecs: w.ecs, names: w.ecs.names,
      profiles: w.profiles, ledger: w.pearlLedger, drops: w.drops, dirty: w.profileDirty, eventBuffer: w.events };
    this.#records.set(ctx, bound);
    try { this.#baseline(ctx); }
    catch (error) { if (this.gate.active(reservation)) this.gate.release(reservation); else this.gate.fence(reservation); throw error; }
    this.operations.set(operationId, ctx); this.accounts.set(endpoint.key, ctx);
    const task = Promise.resolve().then(async () => {
      try {
        this.#baseline(ctx);
        const reads = await Promise.allSettled([
          Promise.resolve().then(() => this.sessions.store.loadUnique(pearl.uid)),
          Promise.resolve().then(() => this.sessions.store.loadPearlLocation(pearl.uid)),
        ]);
        this.#baseline(ctx);
        for (const read of reads) if (read.status === 'rejected') throw read.reason;
        const unique = record(reads[0].value, 'holder,kind,version'), location = checkedLocation(snapshotDropData(reads[1].value));
        if (unique.kind !== pearlKind(pearl.kind)) throw new StoreError('kind');
        if (unique.holder !== null || !Number.isSafeInteger(unique.version) || unique.version < 1 || unique.version >= 2147483647 ||
            !location || location.world !== this.scope || location.version !== unique.version || !same(location.ground, sourceGround)) throw new StoreError('ownership');
        bound.meta = freeze({ operationId, ...pearl, from: null, to: endpoint.key,
          expectedVersion: unique.version, world: this.scope, ground: null });
        this.sessions.save(endpoint.clientId, clone(before), reservation);
        const result = await this.sessions.commitPearlGround(bound.meta, rows => {
          this.#baseline(ctx);
          if (rows.length !== 1 || rows[0].id !== endpoint.key || !same(rows[0].data, before)) throw new StoreError('conflict');
          const profiles = [{ id: endpoint.key, expectedVersion: rows[0].version, data: clone(after) }];
          bound.request = ctx.request = freeze(groundOperation({ ...bound.meta, profiles }).request);
          return profiles.map(({ id, data }) => ({ id, data }));
        }, reservation);
        const receipt = checkedGroundResult(result?.receipt, bound.request);
        if (!receipt.ok) throw new StoreError('response');
        bound.receipt = freeze(clone(receipt)); ctx.receipt = clone(receipt); ctx.state = 'ready';
      } catch (error) { ctx.state = 'failed'; ctx.code = codeOf(error); }
      this.completed.push(ctx);
    });
    this.tasks.add(task); task.finally(() => this.tasks.delete(task));
    return Object.freeze({ operationId });
  }

  #identity(ctx) {
    const b = this.#records.get(ctx), w = this.world, e = b?.endpoint;
    if (!b || ctx.operationId !== b.operationId || !this.gate.active(b.reservation) ||
        w.ecs !== b.ecs || w.ecs.names !== b.names || w.profiles !== b.profiles || w.pearlLedger !== b.ledger ||
        w.drops !== b.drops || w.profileDirty !== b.dirty || w.events !== b.eventBuffer ||
        this.sessions.clients.get(e.clientId) !== e.session || this.sessions.accounts.get(e.key) !== e.session ||
        e.session.closed || e.session.failed || w.profiles.get(e.entity) !== e.profile ||
        e.profile.pirateId !== 'account:' + e.key || w.ecs.clientId[e.entity] !== e.clientId || w.ecs.names[e.entity] !== e.name) throw new StoreError('cancelled');
    return b;
  }

  #baseline(ctx) {
    const b = this.#identity(ctx), w = this.world, e = b.endpoint;
    assertDropContainers(w);
    if (this.#entering && this.#violation) throw new StoreError('effect');
    if (w.tick !== b.at || this.#clock.at(w.tick) !== b.durableAt || w.drops.get(b.dropId) !== b.drop ||
        !same(snapshotDropData(b.drop), b.source) || !same(this.#clock.assertDrop(b.drop, 'pearl'), b.sourceGround) ||
        !same(snapshotDropData(e.profile), e.live) || !same(capturePearlProfile(w, e.entity), b.before) ||
        columns(w.ecs, e.entity).length !== e.columns.length || e.columns.some(q => w.ecs[q.key] !== q.column || q.column[e.entity] !== q.value)) throw new StoreError('cancelled');
    for (const [uid, row] of b.ledgers) if (!same(snapshotDropData(w.pearlLedger.get(uid)), row)) throw new StoreError('ownership');
    for (const q of profilePearls(b.before)) if (!same(b.ledgers.get(q.uid), { owner: e.profile.pirateId, entity: e.entity, place: 'profile' })) throw new StoreError('ownership');
    for (const [uid, row] of w.pearlLedger) {
      const data = snapshotDropData(row);
      if (data?.place === 'profile' && (data.owner === e.profile.pirateId || data.entity === e.entity) && !b.ledgers.has(uid)) throw new StoreError('ownership');
    }
    for (const [id, d] of w.drops) {
      if (id === b.dropId) continue;
      if (types.isProxy(d)) throw new StoreError('effect');
      const fields = d && typeof d === 'object' ? Object.getOwnPropertyDescriptors(d) : {};
      const other = fields.pearl?.value;
      if (types.isProxy(other)) throw new StoreError('effect');
      if (other && Object.getOwnPropertyDescriptor(other, 'uid')?.value === b.source.pearl.uid) throw new StoreError('ownership');
    }
    return b;
  }

  #assertReceipt(ctx) {
    const b = this.#records.get(ctx), e = b.endpoint;
    if (!b.request || ctx.request !== b.request || !b.receipt || !same(ctx.receipt, b.receipt) ||
        !checkedGroundResult(ctx.receipt, b.request).ok || e.session.running || e.session.pending || e.session.pearlBusy ||
        e.session.version !== b.receipt.profiles[0].version || !same(e.session.confirmed, b.after)) throw new StoreError('response');
    return b;
  }

  assertWaiting() { for (const ctx of this.operations.values()) this.#baseline(ctx); }
  invalidate(account) { this.gate.invalidate({ accounts: [playerKey(account)] }); }
  invalidatePearl(uid) { this.gate.invalidate({ uids: [groundKey(uid)] }); }
  assertPublishable(clientId) {
    const s = this.sessions.clients.get(clientId);
    if (!s || s.closed || s.failed) throw new StoreError('session');
    this.gate.assertAvailable({ accounts: [s.key] });
  }
  save(clientId, raw) { return this.#entry(() => {
    const s = this.sessions.clients.get(clientId), ctx = s && this.accounts.get(s.key);
    if (!ctx) { this.assertPublishable(clientId); this.sessions.save(clientId, raw); return; }
    if (ctx.state === 'fenced') throw new StoreError('busy');
    const b = this.#baseline(ctx);
    if (!same(snapshotDropData(raw), b.before)) throw new StoreError('profile');
  }); }

  #fence(ctx, code) {
    const b = this.#records.get(ctx);
    this.gate.fence(b.reservation); ctx.state = 'fenced'; ctx.code = code;
    try { this.sessions.fail(b.endpoint.session, code); } catch { /* Preserve the reservation and durable evidence. */ }
    return { operationId: b.operationId, state: 'fenced', code };
  }

  drain() { return this.#entry(() => {
    const outcomes = [];
    for (const ctx of this.completed.splice(0).sort((a, b) => a.sequence - b.sequence)) {
      if (ctx.state !== 'ready') { outcomes.push(this.#fence(ctx, ctx.code ?? 'cancelled')); continue; }
      let b, fields, oldLedger, dirty, count, started = false;
      try {
        b = this.#baseline(ctx); this.#assertReceipt(ctx);
        const w = this.world, e = b.endpoint;
        // Resolve decoration on a detached event buffer, then revalidate before touching live containers.
        const publication = { ecs: w.ecs, events: [] };
        for (const event of b.events) w.emit.call(publication, clone(event));
        const published = snapshotDropData(publication.events);
        this.#baseline(ctx); this.#assertReceipt(ctx);
        fields = Object.keys(b.after).filter(key => !same(e.profile[key], b.after[key])).map(key => {
          const d = Object.getOwnPropertyDescriptor(e.profile, key);
          if (!d || !Object.hasOwn(d, 'value') || !d.writable) throw new StoreError('effect');
          return { key, before: d.value, after: clone(b.after[key]) };
        });
        oldLedger = w.pearlLedger.get(b.source.pearl.uid); dirty = w.profileDirty.has(e.entity); count = w.events.length;
        started = true;
        for (const q of fields) e.profile[q.key] = q.after;
        Map.prototype.set.call(w.pearlLedger, b.source.pearl.uid, { owner: e.profile.pirateId, entity: e.entity, place: 'profile' });
        Map.prototype.delete.call(w.drops, b.dropId); Set.prototype.add.call(w.profileDirty, e.entity);
        this.sessions.save(e.clientId, clone(b.after), b.reservation);
        this.#identity(ctx); assertDropContainers(w);
        if (this.#violation || w.tick !== b.at || columns(w.ecs, e.entity).length !== e.columns.length ||
            e.columns.some(q => w.ecs[q.key] !== q.column || q.column[e.entity] !== q.value) ||
            !same(snapshotDropData(e.profile), b.after) || w.drops.has(b.dropId) ||
            !same(w.pearlLedger.get(b.source.pearl.uid), { owner: e.profile.pirateId, entity: e.entity, place: 'profile' }) ||
            !w.profileDirty.has(e.entity) || w.events.length !== count) throw new StoreError('effect');
        Array.prototype.push.call(w.events, ...published);
        this.gate.release(b.reservation);
      } catch (error) {
        if (started) {
          const e = b.endpoint;
          try {
            b.eventBuffer.length = count;
            if (!b.drops.has(b.dropId)) Map.prototype.set.call(b.drops, b.dropId, b.drop);
            for (const q of fields) if (e.profile[q.key] === q.after) e.profile[q.key] = q.before;
            Map.prototype.set.call(b.ledger, b.source.pearl.uid, oldLedger);
            if (!dirty) Set.prototype.delete.call(b.dirty, e.entity);
          } catch { /* Damaged containers never authorize a replay or release. */ }
        }
        outcomes.push(this.#fence(ctx, codeOf(error))); continue;
      }
      ctx.state = 'applied'; this.operations.delete(b.operationId); this.accounts.delete(b.endpoint.key);
      outcomes.push({ operationId: b.operationId, state: 'applied' });
    }
    return outcomes;
  }, true); }

  async settle() { while (this.tasks.size) await Promise.all([...this.tasks]); }
}
