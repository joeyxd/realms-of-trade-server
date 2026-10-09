// Dormant ground-only pearl return. The caller must hold the completed tick through settle/drain.
// Choose the destination once on a detached RNG; publish the source, target, RNG and events together.
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { mulberry32 } from '../src/core/rng.js';
import { sanitizePearl } from '../src/data/pearls.js';
import { tuning } from '../src/data/tuning.js';
import { canStand } from '../src/sim/systems/movement.js';
import { returnPearl } from '../src/sim/systems/pearls.js';
import { StoreError } from './store.mjs';
import { canonicalText, pearlKind, profilePearls } from './pearlOperations.mjs';
import { groundKey, checkedLocation, groundOperation, checkedGroundResult } from './pearlGround.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';
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
const writable = (object, key) => {
  const d = Object.getOwnPropertyDescriptor(object, key);
  if (!d || !Object.hasOwn(d, 'value') || !d.writable) throw new StoreError('effect');
  return d.value;
};
const codeOf = error => error instanceof StoreError ? error.code : 'unavailable';
// Ground-only queue capabilities are UID-only. This separate local claim serializes the shared RNG
// and allocator across return coordinators, without pretending to lock the whole simulation.
const worldClaims = new WeakMap();

export class PearlReturnStaging {
  #clock; #records = new WeakMap(); #entering = false; #violation = false;

  constructor(sessions, world, scope, { deadlineClock } = {}) {
    Object.defineProperties(this, {
      scope: { value: groundKey(scope), enumerable: true },
      sessions: { value: sessions }, world: { value: world },
      gate: { value: pearlMutationGate(sessions) },
    });
    this.#clock = assertGroundDeadlineClock(deadlineClock, this.scope);
    if (sessions.pearls.journal && sessions.pearls.journal.scope !== this.scope) throw new StoreError('configuration');
    this.operations = new Map(); this.tasks = new Set(); this.completed = [];
  }

  #entry(callback, report = false) {
    if (this.#entering) { this.#violation = true; throw new StoreError('busy'); }
    this.#entering = true; this.#violation = false;
    try { const result = callback(); if (this.#violation && !report) throw new StoreError('effect'); return result; }
    finally { this.#entering = false; }
  }

  return(raw) { return this.#entry(() => this.#return(raw)); }

  #return(raw) {
    const selector = record(raw, 'dropId'), w = this.world;
    if (worldClaims.has(w)) throw new StoreError('busy');
    const claim = Object.freeze({}); worldClaims.set(w, claim);
    try { return this.#capture(selector); }
    catch (error) { if (worldClaims.get(w) === claim) worldClaims.delete(w); throw error; }
  }

  #capture({ dropId }) {
    const w = this.world;
    assertDropContainers(w);
    if (!Number.isSafeInteger(w.tick) || w.tick < 0 || !Number.isSafeInteger(dropId) || dropId < 1) throw new StoreError('operation');
    const nextDrop = writable(w, 'nextDrop'), rng = writable(w, 'lootRng');
    if (!Number.isSafeInteger(nextDrop) || nextDrop < 1 || nextDrop >= Number.MAX_SAFE_INTEGER || w.drops.has(nextDrop) ||
        typeof rng !== 'function' || types.isProxy(rng) || typeof rng.state !== 'function') throw new StoreError('effect');
    const rngBefore = rng.state();
    if (!Number.isInteger(rngBefore) || rngBefore < 0 || rngBefore > 4294967295) throw new StoreError('effect');
    const drop = w.drops.get(dropId), source = freeze(snapshotDropData(drop)), pearl = sanitizePearl(source.pearl);
    if (source.id !== dropId || source.to !== 0 || source.kind !== 'pearl' || !pearl || !same(pearl, source.pearl)) throw new StoreError('operation');
    const sourceGround = freeze(this.#clock.assertDrop(source, 'pearl')), durableAt = this.#clock.at(w.tick);
    if (durableAt <= sourceGround.returnAt) throw new StoreError('ownership');
    const ledger = w.pearlLedger.get(pearl.uid), ledgerBefore = freeze(snapshotDropData(ledger));
    if (!same(ledgerBefore, { owner: '', entity: 0, place: 'ground', drop: dropId })) throw new StoreError('ownership');
    this.gate.assertAvailable({ uids: [pearl.uid] });
    const captured = { at: w.tick, map: w.map, raftDeck: w.raftDeck, ecs: w.ecs,
      geometry: [w.map.groundAt, w.map.onDock, w.map.queryColliders, w.map.zoneAt, w.map.half, w.map.colliders, w.map.landmarks],
      worldTuning: freeze(snapshotDropData(tuning.world)), profiles: w.profiles, drops: w.drops, ledgerMap: w.pearlLedger,
      dirty: w.profileDirty, eventBuffer: w.events, eventCount: w.events.length, dropEntries: [...w.drops] };
    const localDrop = clone(source); delete localDrop.groundClock;
    const view = { tick: w.tick, map: w.map, raftDeck: w.raftDeck, ecs: w.ecs, nextDrop,
      lootRng: mulberry32(rngBefore), drops: new Map([[dropId, localDrop]]), pearlLedger: new Map([[pearl.uid, clone(ledgerBefore)]]),
      events: [], emit(event) { this.events.push(clone(event)); } };
    const target = returnPearl(view, localDrop);
    if (!target || target.id !== nextDrop || view.nextDrop !== nextDrop + 1 || !same(target.pearl, pearl)) throw new StoreError('effect');
    const targetGround = freeze({ x: target.x, z: target.z, availableAt: this.#clock.at(target.pickAt), returnAt: this.#clock.at(target.t) });
    const targetDrop = freeze({ ...snapshotDropData(target), ...this.#clock.project(targetGround, 'pearl') });
    this.#clock.assertDrop(targetDrop, 'pearl', targetGround);
    const events = freeze(snapshotDropData(view.events)), rngAfter = view.lootRng.state();
    const footprint = freeze(this.#footprint(targetDrop));
    const reservation = this.gate.reserve({ uids: [pearl.uid] }), operationId = randomUUID();
    const ctx = { operationId, state: 'pending', request: null, receipt: null };
    const bound = { operationId, reservation, dropId, drop, source, sourceGround, ledger, ledgerBefore,
      ...captured, durableAt, nextDrop, rng, rngBefore, rngAfter, targetGround, targetDrop, events, footprint,
      request: null, receipt: null };
    this.#records.set(ctx, bound); worldClaims.set(w, ctx);
    try { this.#baseline(ctx); }
    catch (error) { worldClaims.delete(w); if (this.gate.active(reservation)) this.gate.release(reservation); else this.gate.fence(reservation); throw error; }
    this.operations.set(operationId, ctx);
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
        if (unique.holder !== null || !Number.isInteger(unique.version) || unique.version < 1 || unique.version >= 2147483647 ||
            !location || location.world !== this.scope || location.version !== unique.version || !same(location.ground, sourceGround)) throw new StoreError('ownership');
        const meta = freeze({ operationId, ...pearl, from: null, to: null, expectedVersion: unique.version, world: this.scope, ground: targetGround });
        const result = await this.sessions.commitPearlGround(meta, rows => {
          this.#baseline(ctx);
          if (rows.length !== 0) throw new StoreError('operation');
          bound.request = ctx.request = freeze(groundOperation({ ...meta, profiles: [] }).request);
          return [];
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
    const b = this.#records.get(ctx), w = this.world;
    if (!b || ctx.operationId !== b.operationId || worldClaims.get(w) !== ctx || !this.gate.active(b.reservation) ||
        w.ecs !== b.ecs || w.map !== b.map || w.raftDeck !== b.raftDeck || w.profiles !== b.profiles || w.drops !== b.drops ||
        w.pearlLedger !== b.ledgerMap || w.profileDirty !== b.dirty || w.events !== b.eventBuffer) throw new StoreError('cancelled');
    return b;
  }

  #footprint(target) {
    const w = this.world, { x, z } = target;
    return { standable: canStand(w, x, z, 0.2), height: w.map.groundAt(x, z), dock: !!w.map.onDock(x, z),
      zone: w.map.zoneAt?.(x, z)?.name || 'la playa' };
  }

  #baseline(ctx) {
    const b = this.#identity(ctx), w = this.world;
    assertDropContainers(w);
    if (this.#violation || w.tick !== b.at || this.#clock.at(w.tick) !== b.durableAt ||
        writable(w, 'nextDrop') !== b.nextDrop || writable(w, 'lootRng') !== b.rng || b.rng.state() !== b.rngBefore ||
        w.events.length !== b.eventCount || w.drops.get(b.dropId) !== b.drop || !same(snapshotDropData(b.drop), b.source) ||
        !same(this.#clock.assertDrop(b.drop, 'pearl'), b.sourceGround) || w.pearlLedger.get(b.source.pearl.uid) !== b.ledger ||
        !same(snapshotDropData(b.ledger), b.ledgerBefore) || w.drops.has(b.nextDrop) ||
        !same(snapshotDropData(tuning.world), b.worldTuning)) throw new StoreError('cancelled');
    const entries = [...w.drops];
    if (entries.length !== b.dropEntries.length || entries.some(([id, d], i) => id !== b.dropEntries[i][0] || d !== b.dropEntries[i][1])) throw new StoreError('cancelled');
    const geometry = [w.map.groundAt, w.map.onDock, w.map.queryColliders, w.map.zoneAt, w.map.half, w.map.colliders, w.map.landmarks];
    if (geometry.some((q, i) => q !== b.geometry[i])) throw new StoreError('cancelled');
    for (const profile of w.profiles.values()) if (profilePearls(snapshotDropData(profile)).some(q => q.uid === b.source.pearl.uid)) throw new StoreError('ownership');
    for (const [id, d] of w.drops) {
      if (id === b.dropId) continue;
      if (types.isProxy(d)) throw new StoreError('effect');
      const other = d && typeof d === 'object' ? Object.getOwnPropertyDescriptor(d, 'pearl')?.value : null;
      if (types.isProxy(other)) throw new StoreError('effect');
      if (other && Object.getOwnPropertyDescriptor(other, 'uid')?.value === b.source.pearl.uid) throw new StoreError('ownership');
    }
    if (!same(this.#footprint(b.targetDrop), b.footprint) || w.tick !== b.at || w.lootRng !== b.rng ||
        b.rng.state() !== b.rngBefore || w.nextDrop !== b.nextDrop || w.events.length !== b.eventCount || this.#violation) throw new StoreError('cancelled');
    return b;
  }

  #assertReceipt(ctx) {
    const b = this.#records.get(ctx);
    if (!b.request || ctx.request !== b.request || !b.receipt || !same(snapshotDropData(ctx.receipt), b.receipt) ||
        !checkedGroundResult(ctx.receipt, b.request).ok || b.receipt.profiles.length !== 0 ||
        !same(b.receipt.location.ground, b.targetGround)) throw new StoreError('response');
    return b;
  }

  invalidatePearl(uid) { this.gate.invalidate({ uids: [groundKey(uid)] }); }
  assertPublishable() { if (worldClaims.has(this.world)) throw new StoreError('busy'); }
  #fence(ctx, code) {
    const b = this.#records.get(ctx);
    this.gate.fence(b.reservation); ctx.state = 'fenced'; ctx.code = code;
    return { operationId: b.operationId, state: 'fenced', code };
  }

  drain() { return this.#entry(() => {
    const outcomes = [];
    for (const ctx of this.completed.splice(0)) {
      if (ctx.state !== 'ready') { outcomes.push(this.#fence(ctx, ctx.code ?? 'cancelled')); continue; }
      let b, fresh, nextRng, started = false;
      try {
        b = this.#baseline(ctx); this.#assertReceipt(ctx);
        const w = this.world, publication = { ecs: w.ecs, events: [] };
        for (const event of b.events) w.emit.call(publication, clone(event));
        const published = snapshotDropData(publication.events);
        this.#baseline(ctx); this.#assertReceipt(ctx);
        if (b.eventCount + published.length > 4294967295) throw new StoreError('effect');
        fresh = clone(b.targetDrop); nextRng = mulberry32(b.rngAfter);
        started = true;
        Map.prototype.delete.call(w.drops, b.dropId); Map.prototype.set.call(w.drops, fresh.id, fresh);
        Map.prototype.set.call(w.pearlLedger, b.source.pearl.uid, { owner: '', entity: 0, place: 'ground', drop: fresh.id });
        w.nextDrop = b.nextDrop + 1; w.lootRng = nextRng;
        this.#identity(ctx); assertDropContainers(w);
        if (this.#violation || w.tick !== b.at || w.drops.has(b.dropId) || w.drops.get(fresh.id) !== fresh ||
            !same(snapshotDropData(fresh), b.targetDrop) || !same(this.#clock.assertDrop(fresh, 'pearl'), b.targetGround) ||
            !same(w.pearlLedger.get(b.source.pearl.uid), { owner: '', entity: 0, place: 'ground', drop: fresh.id }) ||
            w.nextDrop !== b.nextDrop + 1 || w.lootRng !== nextRng || nextRng.state() !== b.rngAfter ||
            w.events.length !== b.eventCount) throw new StoreError('effect');
        Array.prototype.push.call(w.events, ...published);
        this.gate.release(b.reservation);
      } catch (error) {
        if (started) {
          try {
            b.eventBuffer.length = b.eventCount;
            // Reinsert the captured order too: drop iteration determines future RNG consumption.
            const ownRows = b.dropEntries.filter(([id]) => id !== b.dropId);
            const current = [...b.drops];
            const ownApplied = current.length === ownRows.length + 1 && current.slice(0, -1).every(([id, d], i) =>
              id === ownRows[i][0] && d === ownRows[i][1]) && current.at(-1)?.[1] === fresh;
            if (ownApplied) { Map.prototype.clear.call(b.drops); for (const [id, d] of b.dropEntries) Map.prototype.set.call(b.drops, id, d); }
            else { if (b.drops.get(fresh.id) === fresh) Map.prototype.delete.call(b.drops, fresh.id);
              if (!b.drops.has(b.dropId)) Map.prototype.set.call(b.drops, b.dropId, b.drop); }
            Map.prototype.set.call(b.ledgerMap, b.source.pearl.uid, b.ledger);
            if (this.world.nextDrop === b.nextDrop + 1) this.world.nextDrop = b.nextDrop;
            if (this.world.lootRng === nextRng) this.world.lootRng = b.rng;
          } catch { /* Preserve the fence and durable target even when local containers are damaged. */ }
        }
        outcomes.push(this.#fence(ctx, codeOf(error))); continue;
      }
      ctx.state = 'applied'; this.operations.delete(b.operationId); worldClaims.delete(this.world);
      outcomes.push({ operationId: b.operationId, state: 'applied' });
    }
    return outcomes;
  }, true); }

  async settle() { while (this.tasks.size) await Promise.all([...this.tasks]); }
}
