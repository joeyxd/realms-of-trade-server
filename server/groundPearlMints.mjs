// Newly rolled public pearls join the existing completed-tick owner, never a second pump.
import { randomUUID } from 'node:crypto';
import { StoreError } from './store.mjs';
import { snapshotDropData } from './deathDropApply.mjs';
import { sanitizePearl } from '../src/data/pearls.js';
import { prepareGroundPearlMint } from './groundPearlMint.mjs';

const fail = code => { throw new StoreError(code); };
export class GroundPearlMints {
  #host; #server; #world; #authority; #deaths; #completion; #fatal; #pendingDeath; #hook; #queue = []; #active = null;
  #failed = false; #stopping = false; #completed = 0;
  constructor(host) {
    this.#host = host; this.#server = host.server; this.#world = host.server.world;
    this.#authority = host.groundAuthority; this.#deaths = host.groundDeaths;
    this.#completion = this.#server.afterTick; this.#fatal = this.#world.deferPlayerDeath;
    this.#pendingDeath = this.#world.isPlayerDeathPending; this.#hook = raw => this.#capture(raw);
  }
  get hook() { return this.#hook; }
  get failed() { return this.#failed; }
  get pending() { return this.#queue.length > 0; }
  get ready() { return !this.#failed && !this.#stopping && this.#host.groundPearls?.ready === true; }
  status() { return { enabled: true, ready: this.ready, pending: this.#queue.length,
    failed: this.#failed, completed: this.#completed }; }
  assertOwner() {
    const h = this.#host;
    if (h.groundPearlMints !== this || h.server !== this.#server || this.#server.world !== this.#world ||
        h.groundAuthority !== this.#authority || this.#server.beforeTick !== this.#authority.boundary ||
        this.#server.afterTick !== this.#completion || this.#world.deferPlayerDeath !== this.#fatal ||
        this.#world.isPlayerDeathPending !== this.#pendingDeath || h.groundDeaths !== this.#deaths ||
        this.#world.deferPearlMint !== this.#hook || this.#failed || this.#stopping || h.closing) fail('cancelled');
  }
  #capture(raw) {
    this.#server.assertCombatTick(); this.assertOwner();
    if (!this.ready || this.#active || this.#queue.length >= 64) fail('busy');
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'kind,x,z' ||
        ![value.x, value.z].every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)) fail('operation');
    const operationId = randomUUID(), pearl = sanitizePearl({ uid: `mint:${operationId}`, kind: value.kind });
    if (!pearl || pearl.kind !== value.kind) fail('operation');
    this.#server.holdCombatPublication();
    this.#queue.push(Object.freeze({ operationId, pearl: Object.freeze(pearl), x: value.x, z: value.z, tick: this.#world.tick }));
    return true;
  }
  completeTick() {
    this.#server.assertDeathCaptureBoundary(); this.assertOwner();
    if (this.#queue.some(c => c.tick > this.#world.tick || c.tick < this.#world.tick - 1)) fail('cancelled');
    return !this.pending;
  }
  drain() {
    this.#server.assertDropApplyBoundary(); this.assertOwner();
    if (!this.pending) return true;
    if (this.#active || !this.#authority.canMutate()) return false;
    const h = this.#host;
    // An older save may already be in flight. Wait without publishing or planning against its metadata.
    if (h.pendingJoins || h.profiles.tasks.size || [...h.profiles.accounts.values()].some(s => s.pending || s.running)) return false;
    const candidate = this.#queue[0];
    const plan = prepareGroundPearlMint({ host: h, deadlineClock: this.#authority.deadlineClock(), candidate });
    const active = { result: null }; this.#active = active;
    try {
      active.result = this.#authority.stageFamily({ operationId: candidate.operationId, family: 'ground', operation: plan.operation }, effect => {
        this.assertOwner();
        if (this.#active !== active || this.#queue[0] !== candidate) fail('cancelled');
        const source = h.groundPearls.prepareMintSource(effect, plan.targetDrop);
        try {
          source.apply();
          if (plan.apply(effect) !== true) fail('effect');
        } catch (error) { source.rollback(); throw error; }
        this.#queue.shift(); this.#active = null; this.#completed++;
        return true;
      });
      active.result.catch(() => { this.#failed = true; });
      return false;
    } catch (error) { this.#failed = true; throw error; }
  }
  invalidate() { if (!this.pending) return false; this.#failed = true; return true; }
  stop() { this.#stopping = true; }
  async settle() { if (this.#active?.result) await this.#active.result.catch(() => {}); }
}
