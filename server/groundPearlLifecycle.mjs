// Explicit common-authority pilot: hydrate current rows, then select receipted pearl transitions.
// Whole-death capture, ordinary-drop consumption and new loot minting remain separate composition.
import { randomUUID } from 'node:crypto';
import { StoreError } from './store.mjs';
import { GroundCurrentHydration } from './groundCurrentHydration.mjs';
import { prepareGroundPearlPickup } from './groundPearlPickup.mjs';
import { prepareGroundPearlReturn } from './groundPearlReturn.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';
import { managedPearlDrop } from './pearlLifecycle.mjs';
import { managedDeathDrop } from './deathDropLifecycle.mjs';
import { groundOperation } from './pearlGround.mjs';
import { DROPS } from '../src/data/loot.js';
import { PEARL } from '../src/data/pearls.js';

const fail = code => { throw new StoreError(code); };
export class GroundPearlLifecycle {
  #host; #server; #world; #authority; #hydration = null; #clock = null; #rows = new Map();
  #task = null; #active = null; #failed = false; #stopping = false; #notified = new Map();
  constructor(host) {
    this.#host = host; this.#server = host.server; this.#world = host.server.world;
    this.#authority = host.groundAuthority;
  }
  get ready() { return !this.#failed && this.#hydration?.status().state === 'applied'; }
  get pending() { return this.#active !== null; }
  status() { return { enabled: true, ready: this.ready, pending: this.pending ? 1 : 0,
    failed: this.#failed, hydration: this.#hydration?.status() ?? null }; }
  #owner() {
    const h = this.#host, w = this.#world;
    if (h.groundPearls !== this || h.server !== this.#server || this.#server.world !== w ||
        h.groundAuthority !== this.#authority || this.#server.beforeTick !== this.#authority.boundary ||
        w.isDeathDropManaged !== managedDeathDrop) fail('configuration');
  }
  prepare() {
    if (this.#task) return this.#task;
    this.#owner();
    this.#clock = this.#authority.deadlineClock();
    this.#hydration = new GroundCurrentHydration({ host: this.#host, deadlineClock: this.#clock });
    this.#task = this.#hydration.prepare().then(() => {
      this.#owner();
      if (this.#stopping || this.#host.closing) fail('cancelled');
      const counts = this.#hydration.preparedCounts;
      if (!counts || counts.deathDrops !== 0) {
        this.#hydration.cancel();
        fail('configuration');
      }
      const result = this.#hydration.drain();
      if (result.state !== 'applied') fail('recovery');
      for (const [id, drop] of this.#world.drops) if (managedPearlDrop(drop)) {
        const row = this.#hydration.pearl(id);
        if (!row) fail('ownership');
        const { dropId, ...source } = row;
        this.#rows.set(id, source);
      }
      return result;
    }).catch(error => { this.#failed = true; throw error; });
    return this.#task;
  }
  #available() {
    this.#owner();
    if (!this.ready || this.#failed || this.#stopping || this.#host.closing) fail('unavailable');
    if (this.pending || !this.#authority.canMutate()) fail('busy');
  }
  #row(dropId) {
    const row = this.#rows.get(dropId);
    if (!row) fail('ownership');
    return structuredClone(row);
  }
  pickup(raw) {
    this.#server.assertTickIdle();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'dropId,receiver') fail('operation');
    return this.#pickup(value);
  }
  #pickup({ dropId, receiver }) {
    this.#available();
    const plan = prepareGroundPearlPickup({ host: this.#host, deadlineClock: this.#clock,
      dropId, receiver, row: this.#row(dropId) });
    return this.#stage(dropId, plan, null);
  }
  return(raw) {
    this.#server.assertTickIdle();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'dropId') fail('operation');
    return this.#return(value.dropId);
  }
  #return(dropId) {
    this.#available();
    const plan = prepareGroundPearlReturn({ world: this.#world, deadlineClock: this.#clock,
      dropId, row: this.#row(dropId) });
    return this.#stage(dropId, plan, plan.targetDrop.id);
  }
  #stage(dropId, plan, nextDropId) {
    const operationId = randomUUID();
    const operation = groundOperation({ ...plan.operation, operationId }).request;
    const active = { operationId, result: null };
    this.#active = active;
    try {
      const result = this.#authority.stageFamily({ operationId, family: 'ground', operation }, effect => {
        this.#owner();
        if (this.#failed || this.#stopping || this.#host.closing || this.#active !== active) fail('cancelled');
        if (plan.apply(effect) !== true) fail('effect');
        this.#rows.delete(dropId); this.#notified.delete(dropId);
        if (nextDropId !== null) this.#rows.set(nextDropId, { uid: operation.uid, kind: operation.kind,
          world: operation.world, ground: structuredClone(effect.location.ground), version: effect.location.version });
        this.#active = null;
        return true;
      });
      active.result = result;
      // Observe rejection without resolving the caller early or applying any gameplay here.
      result.catch(() => { this.#failed = true; });
      return Object.freeze({ operationId, result });
    } catch (error) { this.#active = null; throw error; }
  }
  drain() {
    this.#server.assertDropApplyBoundary();
    this.#owner();
    if (!this.ready || this.#stopping || this.#host.closing || this.#failed) return false;
    if (this.pending) return false;
    if (!this.#authority.canMutate() || this.#world.tick % 3) return true;
    if (this.#host.pendingJoins || this.#host.profiles.tasks.size ||
        [...this.#host.profiles.accounts.values()].some(s => s.pending || s.running)) return true;
    const w = this.#world, ecs = w.ecs;
    assertDropContainers(w);
    for (const id of this.#notified.keys()) if (!w.drops.has(id)) this.#notified.delete(id);
    for (const [dropId, raw] of w.drops) {
      if (!managedPearlDrop(raw)) continue;
      const drop = snapshotDropData(raw), ground = this.#clock.assertDrop(drop, 'pearl'), at = this.#clock.at(w.tick);
      if (at > ground.returnAt) {
        this.#server.holdDropPublication(); this.#return(dropId); return false;
      }
      if (at < ground.availableAt) continue;
      for (const entity of w.profiles.keys()) {
        if (!ecs.alive[entity] || ecs.dead[entity] > 0 ||
            Math.hypot(ecs.x[entity] - drop.x, ecs.z[entity] - drop.z) > DROPS.pickR) continue;
        const clientId = this.#server.clientOf(entity), session = this.#host.profiles.clients.get(clientId);
        if (!session) fail('session');
        if (w.profiles.get(entity).pearls.bag.length >= PEARL.bag) {
          let told = this.#notified.get(dropId);
          if (!told) this.#notified.set(dropId, told = new Set());
          if (!told.has(session.key)) {
            told.add(session.key); w.emit({ type: 'pearlDenied', to: entity, e: entity, why: 'full' });
          }
          continue;
        }
        this.#server.holdDropPublication(); this.#pickup({ dropId, receiver: { clientId, entity } }); return false;
      }
    }
    return true;
  }
  invalidate() { if (!this.pending) return false; this.#failed = true; return true; }
  stop() { this.#stopping = true; this.#hydration?.cancel(); }
  async settle() {
    if (this.#task) await this.#task.catch(() => {});
    if (this.#active?.result) await this.#active.result.catch(() => {});
  }
}
