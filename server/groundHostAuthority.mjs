// Trusted GameHost composition for gameplay receipts and world/clock checkpoints.
// Existing coherent worlds only: initialization and legacy ground adoption are separate operations.
import { randomUUID } from 'node:crypto';
import { StoreError } from './store.mjs';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { GroundClockEpoch } from './groundClockSession.mjs';
import { GroundTransactionSession } from './groundTransactionSession.mjs';
import { groundTransactionOperation } from './groundTransaction.mjs';
import { snapshotDropData } from './deathDropApply.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';

const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };

function familyLanes(family, operationId, operation) {
  const profiles = operation.profiles ?? (operation.profile ? [operation.profile] : []);
  return {
    accounts: profiles.map(p => p.id),
    uids: [...new Set([
      ...(operation.uid ? [operation.uid] : []),
      ...(operation.items ?? operation.pearls ?? []).map(q => q.uid),
      ...profiles.flatMap(p => [p.before, p.data].filter(Boolean).flatMap(profilePearls)).map(q => q.uid),
    ])],
    drops: family === 'drop' ? [`${operation.drop.operationId}:${operation.drop.ordinal}`]
      : family === 'death' ? operation.drops.map(d => `${operationId}:${d.ordinal}`) : [],
  };
}

export class GroundHostAuthority {
  #host; #server; #world; #worldState; #economic; #store; #session; #epoch = null;
  #boundary; #active = null; #loaded = false; #verified = false; #failed = false; #stopping = false; #loadTask = null;
  #completed = 0;
  #draining = false;
  constructor(host, journal) {
    this.#host = host; this.#server = host.server; this.#world = host.server.world;
    this.#worldState = host.worldState; this.#economic = host.economicAuthority; this.#store = host.store;
    if (!journal || !this.#economic || !this.#worldState || this.#store.durable !== true) fail('configuration');
    this.#session = new GroundTransactionSession({ store: this.#store, worldId: this.#worldState.id, journal });
    this.#boundary = () => this.#beforeTick();
  }
  get boundary() { return this.#boundary; }
  get ready() { return this.#loaded && this.#verified && !this.#failed && !this.#stopping; }
  get busy() { return this.#active !== null; }
  status() {
    return { enabled: true, ready: this.ready, pending: this.busy ? 1 : 0, failed: this.#failed,
      clock: this.#session.clock, recovery: this.#session.recovery, completed: this.#completed };
  }
  #owner() {
    const h = this.#host;
    if (h.groundAuthority !== this || h.server !== this.#server || this.#server.world !== this.#world ||
        h.store !== this.#store || h.worldState !== this.#worldState || h.economicAuthority !== this.#economic ||
        this.#server.beforeTick !== this.#boundary) fail('configuration');
  }
  logicalTick() {
    this.#owner();
    if (!this.#epoch || this.#failed) fail('unavailable');
    return this.#epoch.toDurable(this.#world.tick);
  }
  prepare() {
    if (this.#loadTask) return this.#loadTask;
    this.#loadTask = this.#prepare();
    return this.#loadTask;
  }
  async #prepare() {
    try {
      this.#owner();
      const tick = this.#world.tick;
      if (tick !== 0 || this.#stopping || this.#server.clients.size) fail('configuration');
      await this.#session.load(tick);
      this.#owner();
      if (this.#stopping || this.#host.closing || this.#world.tick !== tick) fail('cancelled');
      this.#session.drain(tick);
      const clock = this.#session.clock, data = this.#session.worldData;
      if (!clock || !data.resources || data.resources.tick !== clock.tick || data.seed !== this.#world.seed) fail('configuration');
      this.#epoch = new GroundClockEpoch({ localTick: tick, durableTick: clock.tick });
      this.#loaded = true;
    } catch (error) { this.#fence(); throw error; }
  }
  verifyWorld() {
    this.#owner();
    const ws = this.#worldState;
    if (!this.#loaded || this.#failed || this.#stopping || !ws.ready || ws.version !== this.#session.worldVersion ||
        !same(ws.snapshot(this.#world.economy), this.#session.worldData)) fail('conflict');
    this.#verified = true;
  }
  canMutate() {
    try {
      this.#owner();
      return this.ready && !this.busy && !this.#worldState.running && !this.#worldState.pending;
    } catch { this.#fence(); return false; }
  }
  #input(operationId, family, operation, worldData) {
    this.#owner();
    if (!this.#loaded || !this.#verified || this.#failed || !this.#session.ready || this.busy) fail('busy');
    const localTick = this.#world.tick, tick = this.logicalTick(), clock = this.#session.clock;
    if (this.#worldState.version !== this.#session.worldVersion || worldData.resources?.tick !== tick) fail('conflict');
    return { operationId, family, operation, worldData, localTick,
      clockOperationId: tick === clock.tick ? clock.operationId : randomUUID() };
  }
  async commitEconomic(operationId, request) {
    const input = this.#input(operationId, 'economic', request, request.worldData);
    const a = { kind: 'economic', operationId, localTick: input.localTick };
    this.#active = a;
    try {
      a.task = this.#session.begin(input);
      const prepared = await a.task;
      this.#owner();
      if (this.#active !== a || this.#world.tick !== a.localTick || prepared.state !== 'prepared') fail('conflict');
      return prepared.result.effect;
    } catch (error) { this.#fence(); throw error; }
  }
  applyEconomic(operationId, apply) {
    this.#owner();
    if (!this.#draining && !(this.#stopping && this.#host.closing)) fail('configuration');
    const a = this.#active;
    if (this.#failed || a?.kind !== 'economic' || a.operationId !== operationId || this.#world.tick !== a.localTick) fail('conflict');
    try {
      if (this.#session.drain(a.localTick, () => { apply(); return true; }).state !== 'ready') fail('operation');
      this.#active = null; this.#completed++;
    } catch (error) { this.#fence(); throw error; }
  }
  // Trusted assembly API, not a command dispatcher. The caller still owns eligibility and a
  // reversible synchronous profile/ECS adapter. A prepared SQL reply cannot call that adapter.
  stageFamily(raw, apply) {
    let value;
    try { value = snapshotDropData(raw); } catch { fail('operation'); }
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'family,operation,operationId' ||
        !['ground', 'batch', 'death', 'drop'].includes(value.family) || typeof apply !== 'function') fail('operation');
    this.#owner();
    const ws = this.#worldState, h = this.#host;
    if (!this.canMutate() || h.closing || h.pendingJoins || this.#economic.busy || ws.operationBusy ||
        h.profiles.tasks.size || [...h.profiles.accounts.values()].some(s => s.pending || s.running)) fail('busy');
    const data = ws.snapshot(this.#world.economy);
    const input = this.#input(value.operationId, value.family, value.operation, data);
    const clock = this.#session.clock;
    // Validate and detach before taking any reservation or creating a journal intention.
    const checked = groundTransactionOperation({ operationId: input.operationId, request: {
      world: ws.id, expectedWorldVersion: ws.version, worldData: input.worldData, family: input.family,
      operation: input.operation, clock: { operationId: input.clockOperationId,
        expectedVersion: clock.version, expectedTick: clock.tick, tick: this.logicalTick() },
    } });
    input.operation = checked.request.operation;
    input.worldData = checked.request.worldData;
    const gate = pearlMutationGate(h.profiles);
    gate.assertWorldAvailable();
    const lanes = familyLanes(input.family, input.operationId, input.operation);
    const reservation = gate.reserve(lanes);
    let resolve, reject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    const a = { kind: 'family', localTick: input.localTick, input, apply, gate, reservation, lanes,
      expectedVersion: ws.version, resolve, reject, prepared: false };
    this.#active = a; ws.operationBusy = true;
    a.task = Promise.resolve().then(() => {
      this.#owner();
      if (this.#stopping || !gate.active(reservation)) fail('cancelled');
      return this.#session.begin(input);
    }).then(prepared => {
      this.#owner();
      if (this.#active !== a || this.#world.tick !== a.localTick || this.#stopping ||
          prepared.state !== 'prepared') fail('conflict');
      a.prepared = true;
    }).catch(error => { this.#fence(error); });
    return result;
  }
  #drainFamily() {
    const a = this.#active;
    if (a?.kind !== 'family') return true;
    if (!a.prepared) return false;
    try {
      this.#owner();
      const ws = this.#worldState;
      if (this.#stopping || !this.#draining || !a.gate.active(a.reservation) ||
          this.#world.tick !== a.localTick || ws.version !== a.expectedVersion ||
          ws.running || ws.pending || !ws.operationBusy ||
          !same(ws.snapshot(this.#world.economy), a.input.worldData)) fail('conflict');
      let effect;
      const drained = this.#session.drain(a.localTick, result => {
        const accepted = a.apply(structuredClone(result.effect), { reservation: a.reservation });
        if (accepted && typeof accepted.then === 'function') {
          Promise.resolve(accepted).catch(() => {}); fail('effect');
        }
        if (accepted !== true || !a.gate.active(a.reservation) ||
            !same(ws.snapshot(this.#world.economy), a.input.worldData)) fail('effect');
        ws.accept({ ok: true, version: result.worldVersion });
        ws.resources = structuredClone(a.input.worldData.resources);
        ws.last = JSON.stringify(a.input.worldData);
        effect = structuredClone(result.effect);
        return true;
      });
      if (drained.state !== 'ready') fail('operation');
      a.gate.release(a.reservation);
      ws.operationBusy = false; this.#active = null; this.#completed++;
      a.resolve(effect);
      return true;
    } catch (error) { this.#fence(error); return false; }
  }
  commitWorld(world, data, expectedVersion) {
    if (world !== this.#worldState.id || expectedVersion !== this.#session.worldVersion) fail('conflict');
    const input = this.#input(randomUUID(), 'checkpoint', {}, data);
    let resolve, reject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    const a = { kind: 'checkpoint', localTick: input.localTick, resolve, reject, prepared: false };
    this.#active = a;
    a.task = Promise.resolve().then(() => this.#session.begin(input)).then(() => {
      this.#owner();
      if (this.#active !== a || this.#world.tick !== a.localTick) fail('conflict');
      a.prepared = true;
      // Shutdown has already stopped the pump. It may finish persistence metadata, never gameplay.
      if (this.#stopping) this.#drainCheckpoint();
    }).catch(error => { this.#fence(); reject(error); });
    return result;
  }
  #drainCheckpoint() {
    const a = this.#active;
    if (a?.kind !== 'checkpoint') return true;
    if (!a.prepared) return false;
    try {
      this.#owner();
      if (this.#session.drain(a.localTick).state !== 'ready') fail('operation');
      this.#active = null; this.#completed++;
      a.resolve({ ok: true, version: this.#session.worldVersion });
      return true;
    } catch (error) { this.#fence(); a.reject(error); return false; }
  }
  #beforeTick() {
    try {
      this.#owner();
      if (!this.ready || !this.#drainCheckpoint()) return false;
      this.#draining = true;
      if (!this.#drainFamily()) return false;
      return this.#economic.drain() && this.canMutate();
    } catch { this.#fence(); return false; }
    finally { this.#draining = false; }
  }
  #fence(error = new StoreError('operation')) {
    if (this.#failed) return;
    this.#failed = true;
    const a = this.#active;
    if (a?.kind === 'family') {
      const failure = error instanceof StoreError ? error : new StoreError('effect');
      // A faulty trusted adapter may already have released its capability. Cleanup must still
      // reject and fence the world, and must not save its obsolete connected profile on detach.
      try { a.gate.fence(a.reservation); } catch { /* The global owner remains failed. */ }
      a.reject(failure);
      for (const key of a.lanes.accounts) {
        const session = this.#host.profiles.accounts.get(key);
        if (session) {
          try { this.#host.profiles.fail(session, failure.code); } catch { /* Finish the world fence. */ }
        }
      }
    }
    this.#worldState.fail('ground_transaction');
  }
  stop() {
    this.#stopping = true;
    if (!this.#loaded) this.#session.cancel();
    else if (this.#active?.kind === 'checkpoint') this.#drainCheckpoint();
    else if (this.#active?.kind === 'family') this.#fence(new StoreError('cancelled'));
  }
  async settle() {
    await this.#session.settle();
    if (this.#loadTask) await this.#loadTask.catch(() => {});
    if (this.#active?.task) await this.#active.task.catch(() => {});
    if (this.#stopping && this.#active?.kind === 'checkpoint') this.#drainCheckpoint();
  }
}
