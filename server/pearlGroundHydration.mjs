// Dormant startup adapter. Async reads prepare current ground authority; only a synchronous drain
// installs drops. The caller must provide the clock mapping and keep simulation/admission stopped.
import { isDeepStrictEqual } from 'node:util';
import { StoreError } from './store.mjs';
import { groundKey, groundData, groundPage, checkedGroundPage, checkedLocation } from './pearlGround.mjs';
import { canonicalText, pearlKind } from './pearlOperations.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';

const clone = (v) => structuredClone(v);
const error = (e) => e instanceof StoreError ? e : new StoreError('unavailable');
const tick = (v) => Number.isSafeInteger(v) && v >= 0;
const sameMap = (a, b) => isDeepStrictEqual([...Map.prototype.entries.call(a)], [...Map.prototype.entries.call(b)]);

export class PearlGroundHydration {
  #sessions; #world; #worldId; #clock; #pageSize; #maxRows; #gate; #handle; #before; #rows;
  #state = 'idle'; #task = null; #result = null;

  constructor({ sessions, world, worldId, mapClock, pageSize = 64, maxRows = 4096 } = {}) {
    if (!sessions || !world || typeof mapClock !== 'function' ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 256 ||
        !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 65536 ||
        ['listPearlGround', 'loadUnique', 'loadPearlLocation'].some((k) => typeof sessions.store?.[k] !== 'function')) {
      throw new StoreError('configuration');
    }
    this.#worldId = groundKey(worldId);
    if (sessions.pearls?.journal && sessions.pearls.journal.scope !== this.#worldId) throw new StoreError('configuration');
    this.#sessions = sessions; this.#world = world; this.#clock = mapClock;
    this.#pageSize = pageSize; this.#maxRows = maxRows; this.#gate = pearlMutationGate(sessions);
  }

  get state() { return this.#state; }

  #capture() {
    const w = this.#world;
    if (!tick(w.tick) || !(w.profiles instanceof Map) || w.profiles.size ||
        !(w.drops instanceof Map) || !(w.pearlLedger instanceof Map) ||
        !Number.isSafeInteger(w.nextDrop) || w.nextDrop < 1 || w.nextDrop >= Number.MAX_SAFE_INTEGER) {
      throw new StoreError('operation');
    }
    return { tick: w.tick, profiles: w.profiles, drops: w.drops, ledger: w.pearlLedger,
      dropData: clone(w.drops), ledgerData: clone(w.pearlLedger), nextDrop: w.nextDrop };
  }

  #assertCurrent() {
    this.#gate.assertHydration(this.#handle);
    const w = this.#world, b = this.#before;
    if (w.tick !== b.tick || w.profiles !== b.profiles || w.profiles.size ||
        w.drops !== b.drops || w.pearlLedger !== b.ledger || w.nextDrop !== b.nextDrop ||
        !sameMap(w.drops, b.dropData) || !sameMap(w.pearlLedger, b.ledgerData)) {
      throw new StoreError('conflict');
    }
  }

  start(recovery = null) {
    if (this.#state !== 'idle') throw new StoreError('operation');
    this.#before = this.#capture();
    this.#handle = this.#gate.beginHydration(recovery); // Transfer startup's barrier without releasing it.
    this.#state = 'pending';
    this.#task = this.#read().catch((e) => {
      this.#state = 'fenced'; this.#gate.fenceHydration(this.#handle);
      throw error(e);
    });
    return this.#task;
  }

  // Stop preparation immediately; already-issued storage reads settle without installing World.
  cancel() {
    if (this.#state === 'idle' || this.#state === 'applied') throw new StoreError('operation');
    this.#gate.fenceHydration(this.#handle); this.#state = 'fenced';
    return { state: 'fenced' };
  }

  async #scan() {
    const rows = []; let afterUid = null;
    for (;;) {
      this.#assertCurrent();
      const page = groundPage(this.#worldId, { afterUid, limit: this.#pageSize });
      const raw = await this.#sessions.store.listPearlGround(page.world, { afterUid, limit: page.limit });
      this.#assertCurrent();
      const next = checkedGroundPage(raw, page);
      if (rows.length + next.length > this.#maxRows) throw new StoreError('capacity');
      rows.push(...clone(next));
      if (next.length < page.limit) return rows;
      afterUid = next.at(-1).uid;
    }
  }

  async #read() {
    const rows = await this.#scan();
    for (const row of rows) {
      const reads = await Promise.allSettled([
        this.#sessions.store.loadUnique(row.uid), this.#sessions.store.loadPearlLocation(row.uid),
      ]);
      this.#assertCurrent();
      // Settle both reads before exposing failure; the owner may tear down storage on rejection.
      const failed = reads.find((read) => read.status === 'rejected');
      if (failed) throw failed.reason;
      const [unique, rawLocation] = reads.map((read) => read.value);
      const location = checkedLocation(rawLocation);
      if (!unique || canonicalText(unique) !== canonicalText({ kind: pearlKind(row.kind), holder: null, version: row.version }) ||
          canonicalText(location) !== canonicalText({ world: row.world, ground: row.ground, version: row.version })) {
        throw new StoreError('ownership');
      }
    }
    // The barrier protects this authority. A second scan also detects persistent changes behind a
    // pagination cursor from a service bypass. This is deliberately not a cross-process lease.
    if (canonicalText(await this.#scan()) !== canonicalText(rows)) throw new StoreError('conflict');
    this.#assertCurrent();
    this.#rows = rows.map((row) => {
      const mapped = this.#clock(Object.freeze(clone(row.ground)), Object.freeze({ worldId: this.#worldId, tick: this.#before.tick }));
      if (mapped && typeof mapped.then === 'function') {
        // Decline async mapping without leaving a rejected promise able to terminate startup.
        Promise.resolve(mapped).catch(() => {});
        throw new StoreError('operation');
      }
      if (!mapped || typeof mapped !== 'object' || Array.isArray(mapped) ||
          Object.keys(mapped).sort().join(',') !== 'availableAt,returnAt') throw new StoreError('operation');
      const ground = groundData({ x: row.ground.x, z: row.ground.z, availableAt: mapped.availableAt, returnAt: mapped.returnAt });
      return { ...row, ground };
    });
    this.#assertCurrent();
    this.#state = 'ready';
    return { state: 'ready', count: rows.length };
  }

  // No awaits, emit, RNG, expiry, terrain search, mint or profile save occurs during installation.
  // Past deadlines remain current ground records until a separately authorized gameplay operation.
  drain() {
    if (this.#state === 'applied') return clone(this.#result);
    if (this.#state !== 'ready') return { state: this.#state };
    const w = this.#world, b = this.#before, installed = [];
    try {
      this.#assertCurrent();
      if (!Number.isSafeInteger(b.nextDrop + this.#rows.length) || b.nextDrop + this.#rows.length >= Number.MAX_SAFE_INTEGER) {
        throw new StoreError('capacity');
      }
      const existingUids = new Set([...w.drops.values()].map((d) => d?.pearl?.uid));
      const plan = this.#rows.map((row, i) => {
        const id = b.nextDrop + i;
        if (w.drops.has(id) || w.pearlLedger.has(row.uid) || existingUids.has(row.uid)) {
          throw new StoreError('ownership');
        }
        return { uid: row.uid, drop: { id, to: 0, kind: 'pearl', pearl: { uid: row.uid, kind: row.kind },
          x: row.ground.x, z: row.ground.z, pickAt: row.ground.availableAt, t: row.ground.returnAt },
        ledger: { owner: '', entity: 0, place: 'ground', drop: id } };
      });
      const expectedDrops = new Map(b.dropData), expectedLedger = new Map(b.ledgerData);
      for (const entry of plan) { expectedDrops.set(entry.drop.id, clone(entry.drop)); expectedLedger.set(entry.uid, clone(entry.ledger)); }
      this.#assertCurrent();
      for (const entry of plan) {
        // Record first so rollback also covers a Map implementation that inserts and then throws.
        installed.push(entry);
        w.drops.set(entry.drop.id, entry.drop); w.pearlLedger.set(entry.uid, entry.ledger);
      }
      w.nextDrop = b.nextDrop + plan.length;
      this.#gate.assertHydration(this.#handle);
      if (w.tick !== b.tick || w.profiles !== b.profiles || w.profiles.size || w.drops !== b.drops ||
          w.pearlLedger !== b.ledger || w.nextDrop !== b.nextDrop + plan.length ||
          !sameMap(w.drops, expectedDrops) || !sameMap(w.pearlLedger, expectedLedger)) throw new StoreError('conflict');
      this.#gate.releaseHydration(this.#handle);
      this.#result = { state: 'applied', count: plan.length }; this.#state = 'applied';
      return clone(this.#result);
    } catch (e) {
      for (const entry of installed.reverse()) {
        if (b.drops.get(entry.drop.id) === entry.drop) Map.prototype.delete.call(b.drops, entry.drop.id);
        if (b.ledger.get(entry.uid) === entry.ledger) Map.prototype.delete.call(b.ledger, entry.uid);
      }
      if (w.nextDrop === b.nextDrop + installed.length) w.nextDrop = b.nextDrop;
      this.#state = 'fenced'; this.#gate.fenceHydration(this.#handle);
      return { state: 'fenced', why: error(e).code };
    }
  }
}
