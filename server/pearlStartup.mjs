// Dormant composition boundary: recover exact intents, then prepare current ground under one gate.
// The host must keep simulation/listening stopped, supply a pure clock mapper, and drain synchronously.
// deathDrops:true is dormant composition only; it does not persist or choose the logical ground clock.
import { isDeepStrictEqual } from 'node:util';
import { StoreError } from './store.mjs';
import { PearlGroundHydration } from './pearlGroundHydration.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';

const error = (e) => e instanceof StoreError ? e : new StoreError('unavailable');
const sameMap = (a, b) => isDeepStrictEqual([...Map.prototype.entries.call(a)], [...Map.prototype.entries.call(b)]);

export class PearlStartup {
  #sessions; #world; #gate; #hydration; #handle; #before; #task = null; #result = null;
  #state = 'idle'; #deathDrops = false;

  constructor(options = {}) {
    const { sessions, world } = options;
    // A configured journal is required even for memory fixtures: absence is not recovered startup.
    if (typeof sessions?.recoverPearls !== 'function' || !sessions.pearls?.journal) throw new StoreError('configuration');
    this.#hydration = new PearlGroundHydration(options);
    this.#deathDrops = options.deathDrops === true;
    this.#sessions = sessions; this.#world = world; this.#gate = pearlMutationGate(sessions);
  }

  get state() { return this.#state; }
  get ready() { return this.#state === 'ready'; }

  #capture() {
    const w = this.#world;
    if (this.#deathDrops) assertDropContainers(w);
    if (!Number.isSafeInteger(w.tick) || w.tick < 0 || !(w.profiles instanceof Map) || w.profiles.size ||
        !(w.drops instanceof Map) || !(w.pearlLedger instanceof Map) ||
        !Number.isSafeInteger(w.nextDrop) || w.nextDrop < 1 || w.nextDrop >= Number.MAX_SAFE_INTEGER) {
      throw new StoreError('operation');
    }
    return { tick: w.tick, profiles: w.profiles, drops: w.drops, ledger: w.pearlLedger,
      dropData: this.#deathDrops ? new Map(snapshotDropData([...Map.prototype.entries.call(w.drops)])) : structuredClone(w.drops),
      ledgerData: structuredClone(w.pearlLedger), nextDrop: w.nextDrop };
  }

  #assertCurrent() {
    this.#gate.assertRecovery(this.#handle);
    const w = this.#world, b = this.#before;
    if (this.#deathDrops) assertDropContainers(w);
    if (w.tick !== b.tick || w.profiles !== b.profiles || w.profiles.size || w.drops !== b.drops ||
        w.pearlLedger !== b.ledger || w.nextDrop !== b.nextDrop ||
        !sameMap(w.drops, b.dropData) || !sameMap(w.pearlLedger, b.ledgerData)) throw new StoreError('conflict');
  }

  start() {
    if (this.#task) return this.#task;
    this.#before = this.#capture();
    this.#handle = this.#gate.beginRecovery(); // Holds all unknown/account/UID lanes before any await.
    this.#state = 'recovering';
    this.#task = this.#prepare().catch((e) => {
      this.#state = 'fenced'; this.#gate.fenceHydration(this.#handle);
      throw error(e);
    });
    return this.#task;
  }

  async #prepare() {
    await this.#sessions.recoverPearls(); // Reconciliation only; never resume a request with no receipt.
    this.#assertCurrent();
    // beginHydration also requires zero pending queue/account/task resources. Missing receipts keep
    // their exact reservations and fence startup instead of silently admitting around them.
    this.#state = 'loading';
    const result = await this.#hydration.start(this.#handle);
    if (this.#state !== 'loading') throw new StoreError('cancelled');
    this.#state = 'prepared';
    return { state: 'prepared', count: result.count };
  }

  drain() {
    if (this.ready) return structuredClone(this.#result);
    if (this.#state !== 'prepared') return { state: this.#state };
    const result = this.#hydration.drain();
    if (result.state !== 'applied') {
      this.#state = 'fenced'; return result;
    }
    this.#state = 'ready'; this.#result = { state: 'ready', count: result.count };
    return structuredClone(this.#result);
  }

  // Cancellation is sticky before apply. A ready runtime belongs to the host's shutdown lifecycle.
  cancel() {
    if (this.#state === 'idle' || this.ready) throw new StoreError('operation');
    if (this.#state === 'loading' || this.#state === 'prepared') this.#hydration.cancel();
    this.#gate.fenceHydration(this.#handle); this.#state = 'fenced';
    return { state: 'fenced' };
  }
}
