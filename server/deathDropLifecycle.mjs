// Optional completed-tick pickup/expiry owner. Storage waits never advance the world.
import { StoreError } from './store.mjs';
import { types } from 'node:util';
import { DROPS } from '../src/data/loot.js';
import { ITEMS, CONSUMABLES } from '../src/data/items.js';
import { C, KIND } from '../src/sim/ecs.js';
import { deathDropKey } from './deathDropOperation.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';

// Presence of source or clock provenance claims authority, including malformed metadata.
// The mounted owner validates it; legacy pickup/expiry must never silently consume it instead.
export function managedDeathDrop(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (types.isProxy(raw)) throw new StoreError('effect');
  const proto=Object.getPrototypeOf(raw);
  if (proto!==Object.prototype && proto!==null) throw new StoreError('effect');
  return 'operationId' in raw || 'ordinal' in raw || 'groundClock' in raw;
}

export class DeathDropLifecycle {
  #current = null; #failed = false; #notified = new Map();
  constructor(server, staging) {
    // SQL011's capacity contract must be extended together with catalog changes.
    if (ITEMS.bag!==24 || CONSUMABLES.potion.max!==5) throw new StoreError('configuration');
    this.server = server; this.world = server.world; this.staging = staging;
    this.sessions = staging.sessions;
  }
  get pending() { return this.#current !== null; }
  get failed() { return this.#failed; }
  get count() { return this.pending ? 1 : 0; }
  fail() {
    this.#failed = true;
    for (const ctx of this.staging.operations.values()) {
      this.staging.invalidateDrop(ctx.source.operationId, ctx.source.ordinal);
      if (ctx.endpoint) this.staging.invalidate(ctx.endpoint.key);
    }
  }
  invalidate() { if (!this.pending) return false; this.fail(); return true; }
  #binding(entity) {
    const s=this.server,w=this.world,ecs=w.ecs,id=s.clientOf(entity),c=s.clients.get(id),session=this.sessions.clients.get(id);
    if (!c?.serverProfile || c.entity!==entity || !session || session.closed || session.failed ||
        this.sessions.accounts.get(session.key)!==session || ecs.clientId[entity]!==id ||
        ecs.kind[entity]!==KIND.PLAYER || !(ecs.mask[entity]&C.PLAYER) ||
        w.profiles.get(entity)?.pirateId!=='account:'+session.key) throw new StoreError('session');
    return {clientId:id,entity};
  }
  #full(id,entity,what) {
    const source=this.world.drops.get(id),key=this.sessions.clients.get(this.server.clientOf(entity))?.key;
    let entry=this.#notified.get(id);
    if (!entry || entry.source!==source) this.#notified.set(id,entry={source,told:new Set()});
    if (entry.told.has(key)) return;
    entry.told.add(key);
    // Ordinary items/potions have no quest callback. Publish the established notice only at
    // this synchronous boundary; leave the source JSON untouched for exact storage matching.
    Array.prototype.push.call(this.world.events,{type:'full',to:entity,e:entity,what});
  }
  drain(allowStart=true) {
    this.server.assertDropApplyBoundary();
    if (this.#failed || this.server.world!==this.world || this.staging.world!==this.world) throw new StoreError('cancelled');
    const w=this.world;
    assertDropContainers(w);
    if (this.#current) {
      const ctx=this.staging.operations.get(this.#current.operationId);
      if (!ctx) throw new StoreError('effect');
      this.staging.assertBaseline(ctx);
      const result=this.staging.drain().find(q=>q.operationId===this.#current.operationId);
      if (!result) return false;
      if (result.state!=='applied') throw new StoreError('effect');
      this.#current=null;
    }
    if (this.staging.operations.size) throw new StoreError('effect');
    if (!allowStart || w.tick%3) return true;
    try { this.staging.gate.assertWorldAvailable(); }
    catch (error) { if (error instanceof StoreError && error.code==='busy') return true; throw error; }
    for (const id of this.#notified.keys()) if (!w.drops.has(id)) this.#notified.delete(id);
    for (const [id,raw] of w.drops) {
      if (!managedDeathDrop(raw)) continue;
      const d=snapshotDropData(raw);
      deathDropKey(d.operationId,d.ordinal);
      if (!['item','potion'].includes(d.kind) || d.id!==id || d.to!==0 || !Number.isSafeInteger(id) || id<1 ||
          !Number.isSafeInteger(d.t) || !Number.isFinite(d.x) || !Number.isFinite(d.z)) throw new StoreError('operation');
      this.staging.assertDeadline(d);
      if (w.tick>d.t) {
        this.server.holdDropPublication();
        this.#current=this.staging.expire({dropId:id});
        return false;
      }
      if (d.pickAt!==undefined && w.tick<d.pickAt) continue;
      for (const entity of w.profiles.keys()) {
        const ecs=w.ecs,p=w.profiles.get(entity);
        if (!ecs.alive[entity] || ecs.dead[entity]>0 || Math.hypot(ecs.x[entity]-d.x,ecs.z[entity]-d.z)>DROPS.pickR) continue;
        const receiver=this.#binding(entity);
        if (d.kind==='item' && p.bag.length>=ITEMS.bag) { this.#full(id,entity,'bag'); continue; }
        if (d.kind==='potion' && ecs.potions[entity]>=CONSUMABLES.potion.max) { this.#full(id,entity,'potion'); continue; }
        this.server.holdDropPublication();
        this.#current=this.staging.pickup({dropId:id,receiver});
        return false;
      }
    }
    return true;
  }
}
