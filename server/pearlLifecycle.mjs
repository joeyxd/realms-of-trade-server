// Optional completed-tick pearl owner. One receipt holds simulation and publication until drain.
import { types } from 'node:util';
import { StoreError } from './store.mjs';
import { PearlPickupStaging } from './pearlPickupStaging.mjs';
import { PearlReturnStaging } from './pearlReturnStaging.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';
import { sanitizePearl, PEARL } from '../src/data/pearls.js';
import { DROPS } from '../src/data/loot.js';
import { C, KIND } from '../src/sim/ecs.js';

// Read data descriptors only: a claimed projection must not fall back to native pearl mutation.
export function managedPearlDrop(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (types.isProxy(raw)) throw new StoreError('effect');
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) throw new StoreError('effect');
  const kind = Object.getOwnPropertyDescriptor(raw, 'kind');
  if (kind && !Object.hasOwn(kind, 'value')) throw new StoreError('effect');
  return kind?.value === 'pearl' && 'groundClock' in raw;
}

export class PearlLifecycle {
  #server; #world; #sessions; #clock; #pickup; #return;
  #current = null; #failed = false; #notified = new Map();
  constructor(server, sessions, scope, { deadlineClock } = {}) {
    if (PEARL.bag !== 8) throw new StoreError('configuration');
    this.#clock = assertGroundDeadlineClock(deadlineClock, scope);
    this.#server = server; this.#world = server.world; this.#sessions = sessions;
    this.#pickup = new PearlPickupStaging(sessions, server.world, scope, { deadlineClock });
    this.#return = new PearlReturnStaging(sessions, server.world, scope, { deadlineClock });
  }
  get world() { return this.#world; }
  get pickupStaging() { return this.#pickup; }
  get returnStaging() { return this.#return; }
  get pending() { return this.#current !== null; }
  get failed() { return this.#failed; }
  get count() { return this.pending ? 1 : 0; }
  get reserved() { return this.#pickup.operations.size + this.#return.operations.size; }
  async settle() { await Promise.all([this.#pickup.settle(), this.#return.settle()]); }
  fail() {
    this.#failed = true;
    if (this.#current) this.#current.staging.invalidatePearl(this.#current.uid);
  }
  invalidate() { if (!this.pending) return false; this.fail(); return true; }

  #binding(entity) {
    const s = this.#server, w = this.#world, ecs = w.ecs, id = s.clientOf(entity);
    const c = s.clients.get(id), session = this.#sessions.clients.get(id);
    if (!c?.serverProfile || c.entity !== entity || !session || session.closed || session.failed ||
        this.#sessions.accounts.get(session.key) !== session || ecs.clientId[entity] !== id ||
        ecs.kind[entity] !== KIND.PLAYER || !(ecs.mask[entity] & C.PLAYER) ||
        w.profiles.get(entity)?.pirateId !== 'account:' + session.key) throw new StoreError('session');
    return { clientId: id, entity };
  }
  #full(id, entity) {
    const source = this.#world.drops.get(id), key = this.#sessions.clients.get(this.#server.clientOf(entity)).key;
    let entry = this.#notified.get(id);
    if (!entry || entry.source !== source) this.#notified.set(id, entry = { source, told: new Set() });
    if (entry.told.has(key)) return;
    entry.told.add(key);
    Array.prototype.push.call(this.#world.events, { type: 'pearlDenied', to: entity, e: entity, why: 'full' });
  }
  drain(allowStart = true) {
    this.#server.assertDropApplyBoundary();
    const w = this.#world;
    if (this.#failed || this.#server.world !== w || this.#pickup.world !== w || this.#return.world !== w) throw new StoreError('cancelled');
    assertDropContainers(w);
    this.#clock.at(w.tick);
    if (this.#current) {
      const { staging, operationId, context } = this.#current;
      if (this.reserved !== 1 || staging.operations.get(operationId) !== context) throw new StoreError('effect');
      staging.assertWaiting();
      const result = staging.drain().find(q => q.operationId === operationId);
      if (!result) return false;
      if (result.state !== 'applied') throw new StoreError('effect');
      this.#current = null;
    }
    if (this.reserved) throw new StoreError('effect');
    if (!allowStart || w.tick % 3) return true;
    try { this.#pickup.gate.assertWorldAvailable(); }
    catch (error) { if (error instanceof StoreError && error.code === 'busy') return true; throw error; }
    for (const id of this.#notified.keys()) if (!w.drops.has(id)) this.#notified.delete(id);
    for (const [id, raw] of w.drops) {
      if (!managedPearlDrop(raw)) continue;
      const d = snapshotDropData(raw), pearl = sanitizePearl(d.pearl);
      if (!pearl || pearl.uid !== d.pearl.uid || pearl.kind !== d.pearl.kind ||
          Object.keys(d.pearl).length !== 2 || d.id !== id || d.to !== 0 ||
          Object.hasOwn(d, 'operationId') || Object.hasOwn(d, 'ordinal') ||
          !Number.isSafeInteger(id) || id < 1) throw new StoreError('operation');
      const ground = this.#clock.assertDrop(d, 'pearl'), at = this.#clock.at(w.tick);
      if (at > ground.returnAt) {
        this.#server.holdDropPublication();
        const handle = this.#return.return({ dropId: id });
        this.#current = { ...handle, uid: pearl.uid, staging: this.#return, context: this.#return.operations.get(handle.operationId) };
        return false;
      }
      if (at < ground.availableAt) continue;
      for (const entity of w.profiles.keys()) {
        const ecs = w.ecs, p = w.profiles.get(entity);
        if (!ecs.alive[entity] || ecs.dead[entity] > 0 || Math.hypot(ecs.x[entity] - d.x, ecs.z[entity] - d.z) > DROPS.pickR) continue;
        const receiver = this.#binding(entity);
        if (p.pearls.bag.length >= PEARL.bag) { this.#full(id, entity); continue; }
        this.#server.holdDropPublication();
        const handle = this.#pickup.pickup({ dropId: id, receiver });
        this.#current = { ...handle, uid: pearl.uid, staging: this.#pickup, context: this.#pickup.operations.get(handle.operationId) };
        return false;
      }
    }
    return true;
  }
}
