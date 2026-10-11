// Explicit common-authority pilot: hydrate current rows, then select receipted pearl transitions.
// Whole-death and ordinary-drop composition is an additional explicit mount; new mint remains separate.
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
import { prepareGroundDeathDrop } from './groundDeathDrop.mjs';
import { settleGroundProfile } from './groundProfileBaseline.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { deathDropOperation, checkedCurrentDeathDrop } from './deathDropOperation.mjs';

const fail = code => { throw new StoreError(code); };
export class GroundPearlLifecycle {
  #host; #server; #world; #authority; #hydration = null; #clock = null; #rows = new Map();
  #task = null; #active = null; #failed = false; #stopping = false; #notified = new Map();
  #dropRows = new Map();
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
      if (!counts || (counts.deathDrops !== 0 && !this.#host.groundDeaths)) {
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
      this.#dropRows = new Map(this.#hydration.deathDrops.map(({ dropId, ...row }) => [dropId, row]));
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
  // Source installation is paired reversibly with a checked death's synchronous ECS apply.
  prepareDeathSources(receipt, drops) {
    this.#server.assertDropApplyBoundary(); this.#owner();
    if (!this.#host.groundDeaths || !this.ready || this.pending || this.#stopping || this.#host.closing) fail('configuration');
    const oldPearls = this.#rows, oldDrops = this.#dropRows;
    const pearls = new Map(oldPearls), ordinary = new Map(oldDrops);
    for (const drop of drops) {
      if (pearls.has(drop.id) || ordinary.has(drop.id)) fail('ownership');
      if (drop.kind === 'pearl') {
        const location = receipt.locations.find(r => r.uid === drop.pearl.uid);
        if (!location) fail('response');
        this.#clock.assertDrop(drop, 'pearl', location.ground);
        pearls.set(drop.id, { uid: drop.pearl.uid, kind: drop.pearl.kind, ...structuredClone(location) });
      } else {
        const creation = receipt.drops.find(r => r.operationId === drop.operationId && r.ordinal === drop.ordinal);
        if (!creation) fail('response');
        this.#clock.assertDrop(drop, 'drop', creation.ground);
        ordinary.set(drop.id, checkedCurrentDeathDrop({ ...structuredClone(creation), state: 'ground',
          version: 1, holder: null, transitionOperationId: null }));
      }
    }
    let installed = false;
    return { apply: () => {
      if (this.#rows !== oldPearls || this.#dropRows !== oldDrops || installed) fail('cancelled');
      this.#rows = pearls; this.#dropRows = ordinary; installed = true;
    }, rollback: () => {
      if (installed) { this.#rows = oldPearls; this.#dropRows = oldDrops; installed = false; }
    } };
  }
  pickupDrop(raw) {
    this.#server.assertTickIdle();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'dropId,receiver') fail('operation');
    return this.#drop(value.dropId, 'pickup', value.receiver);
  }
  expireDrop(raw) {
    this.#server.assertTickIdle();
    const value = snapshotDropData(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'dropId') fail('operation');
    return this.#drop(value.dropId, 'expire', null);
  }
  #drop(dropId, mode, receiver) {
    this.#available();
    if (!this.#host.groundDeaths) fail('configuration');
    const row = this.#dropRows.get(dropId);
    if (!row) fail('ownership');
    const create = () => prepareGroundDeathDrop({ host: this.#host, deadlineClock: this.#clock, dropId, mode,
      receiver, row: structuredClone(row) });
    let plan = create();
    const operationId = randomUUID(), active = { operationId, result: null };
    const apply = effect => {
      this.#owner();
      if (this.#failed || this.#stopping || this.#host.closing || this.#active !== active) fail('cancelled');
      if (plan.apply(effect, operationId) !== true) fail('effect');
      this.#dropRows.delete(dropId); this.#active = null; return true;
    };
    this.#active = active;
    try {
      if (mode === 'expire') active.result = this.#authority.stageFamily({ operationId, family: 'drop',
        operation: deathDropOperation({ ...plan.operation, operationId }).request }, apply);
      else {
        const before = structuredClone(plan.operation.profile.before), w = this.#world;
        const session = this.#host.profiles.clients.get(receiver.clientId), profile = w.profiles.get(receiver.entity);
        const live = snapshotDropData(profile), tick = w.tick, source = snapshotDropData(w.drops.get(dropId));
        const client = this.#server.clients.get(receiver.clientId), ecs = w.ecs, names = ecs.names, name = names[receiver.entity];
        const columns = Object.entries(ecs).filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
          .map(([key, column]) => ({ key, column, value: column[receiver.entity] }));
        const state = { drops: w.drops, profiles: w.profiles, ledger: w.pearlLedger, events: w.events,
          dirty: w.profileDirty, nextDrop: w.nextDrop, rng: w.lootRng, rngState: w.lootRng.state(),
          dropData: snapshotDropData([...w.drops]), ledgerData: snapshotDropData([...w.pearlLedger]),
          eventData: snapshotDropData(w.events), dirtyData: [...w.profileDirty] };
        const endpoint = { session, clientId: receiver.clientId };
        const assertCurrent = () => {
          this.#owner();
          assertDropContainers(w);
          if (this.#active !== active || this.#failed || this.#stopping || this.#host.closing || w.tick !== tick ||
              this.#host.profiles.clients.get(receiver.clientId) !== session || session.closed || session.failed ||
              this.#host.profiles.accounts.get(session.key) !== session || this.#server.clients.get(receiver.clientId) !== client ||
              client.entity !== receiver.entity || !client.serverProfile || w.ecs !== ecs || ecs.names !== names || names[receiver.entity] !== name ||
              columns.some(q => ecs[q.key] !== q.column || !Object.is(q.column[receiver.entity], q.value)) ||
              w.drops !== state.drops || w.profiles !== state.profiles || w.pearlLedger !== state.ledger ||
              w.events !== state.events || w.profileDirty !== state.dirty || w.nextDrop !== state.nextDrop ||
              w.lootRng !== state.rng || w.lootRng.state() !== state.rngState ||
              canonicalText(snapshotDropData([...w.drops])) !== canonicalText(state.dropData) ||
              canonicalText(snapshotDropData([...w.pearlLedger])) !== canonicalText(state.ledgerData) ||
              canonicalText(snapshotDropData(w.events)) !== canonicalText(state.eventData) ||
              canonicalText([...w.profileDirty]) !== canonicalText(state.dirtyData) ||
              w.profiles.get(receiver.entity) !== profile || canonicalText(snapshotDropData(profile)) !== canonicalText(live) ||
              canonicalText(capturePearlProfile(w, receiver.entity)) !== canonicalText(before) ||
              canonicalText(snapshotDropData(w.drops.get(dropId))) !== canonicalText(source)) fail('cancelled');
        };
        active.result = this.#authority.stagePreparedFamily({ operationId, family: 'drop', lanes: {
          accounts: [session.key], uids: profilePearls(before).map(q => q.uid), drops: [`${row.operationId}:${row.ordinal}`],
        } }, async reservation => {
          await settleGroundProfile(this.#host.profiles, endpoint, before, reservation, assertCurrent);
          assertCurrent(); plan = create(); return plan.operation;
        }, apply);
      }
      active.result.catch(() => { this.#failed = true; });
      return Object.freeze({ operationId, result: active.result });
    } catch (error) { this.#active = null; throw error; }
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
      if (!managedPearlDrop(raw) && managedDeathDrop(raw)) {
        if (!this.#host.groundDeaths) fail('configuration');
        const drop = snapshotDropData(raw), ground = this.#clock.assertDrop(drop, 'drop'), at = this.#clock.at(w.tick);
        if (at > ground.expiresAt) { this.#server.holdDropPublication(); this.#drop(dropId, 'expire', null); return false; }
        if (at < ground.availableAt) continue;
        for (const entity of w.profiles.keys()) {
          if (!ecs.alive[entity] || ecs.dead[entity] > 0 ||
              Math.hypot(ecs.x[entity] - drop.x, ecs.z[entity] - drop.z) > DROPS.pickR) continue;
          const p = w.profiles.get(entity);
          if (drop.kind === 'item' ? p.bag.length >= 24 : p.pot >= 5) continue;
          const clientId = this.#server.clientOf(entity);
          this.#server.holdDropPublication(); this.#drop(dropId, 'pickup', { clientId, entity }); return false;
        }
        continue;
      }
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
