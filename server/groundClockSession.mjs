// Server-owned ground-clock preparation. Async I/O never publishes an epoch; the stopped caller
// adopts it at drain. This authority supplies neither an offline policy nor a cross-process lease.
import { StoreError } from './store.mjs';
import { groundKey } from './pearlGround.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { snapshotDropData } from './deathDropApply.mjs';
import { groundClockOperation, checkedGroundClock, checkedGroundClockResult, checkedGroundClockReceipt } from './groundClockOperation.mjs';

const clone = v => structuredClone(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const equal = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
function data(raw, keys) {
  let value;
  try { value = snapshotDropData(raw); } catch { fail('operation'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys) fail('operation');
  return value;
}
function local(raw) { if (!integer(raw)) fail('operation'); return raw; }
const error = e => e instanceof StoreError ? e : new StoreError('unavailable');

export class GroundClockEpoch {
  #local; #durable;
  constructor(input) {
    const value = data(input, 'durableTick,localTick');
    this.#local = local(value.localTick); this.#durable = local(value.durableTick);
    Object.freeze(this);
  }
  get anchor() { return { localTick: this.#local, durableTick: this.#durable }; }
  toDurable(tick) {
    local(tick);
    if (tick < this.#local) fail('operation');
    const result = this.#durable + (tick - this.#local);
    if (!integer(result)) fail('operation');
    return result;
  }
  toLocal(tick) {
    local(tick);
    // A past deadline stays past, even if it precedes local zero. Do not clamp to zero.
    const result = this.#local + (tick - this.#durable);
    if (!Number.isSafeInteger(result)) fail('operation');
    return result;
  }
}

export class GroundClockSession {
  #store; #world; #state = 'idle'; #clock = null; #epoch = null; #lastLocal = null;
  #attempt = null; #prepared = null; #generation = 0;
  constructor({ store, worldId } = {}) {
    if (['loadGroundClock','loadGroundClockOperation','commitGroundClock'].some(k => typeof store?.[k] !== 'function')) fail('configuration');
    this.#store = store; this.#world = groundKey(worldId);
  }
  get state() { return this.#state; }
  get ready() { return this.#state === 'ready'; }
  get clock() { return clone(this.#clock); }
  get epoch() { return this.ready ? this.#epoch : null; }
  #live(generation) { if (generation !== this.#generation || this.#state === 'fenced') fail('cancelled'); }
  #monotonic(tick) {
    local(tick);
    if (this.#lastLocal !== null && tick < this.#lastLocal) fail('operation');
    return tick;
  }
  logicalTick(tick) {
    if (!this.ready) fail(this.#state === 'missing' || this.#state === 'idle' ? 'unavailable' : 'busy');
    this.#monotonic(tick);
    const result = this.#epoch.toDurable(tick);
    this.#lastLocal = tick;
    return result;
  }
  async #verified(generation, operation = null) {
    const raw = await this.#store.loadGroundClock(this.#world); this.#live(generation);
    const clock = raw === null ? null : checkedGroundClock(raw, this.#world);
    if (clock) {
      const receipt = checkedGroundClockReceipt(await this.#store.loadGroundClockOperation(clock.operationId), clock.operationId);
      this.#live(generation);
      if (!receipt || !equal(receipt.result.clock, clock) ||
          (operation && (clock.operationId !== operation.operationId || !equal(receipt.request, operation.request)))) fail('response');
    }
    const again = await this.#store.loadGroundClock(this.#world); this.#live(generation);
    const current = again === null ? null : checkedGroundClock(again, this.#world);
    if (!equal(clock, current)) fail('conflict');
    return clock;
  }
  #prepare(clock, tick, generation) {
    this.#live(generation);
    this.#prepared = { clock: clone(clock), localTick: tick };
    this.#state = 'prepared';
    return { state: 'prepared', clock: clone(clock) };
  }
  load(tick) {
    if (this.#state !== 'idle') fail('busy');
    local(tick); this.#lastLocal = tick;
    const generation = ++this.#generation; this.#state = 'loading';
    return this.#verified(generation).then(clock => this.#prepare(clock, tick, generation)).catch(e => {
      this.#state = 'fenced'; throw error(e);
    });
  }
  initialize(input) {
    if (this.#state !== 'missing') fail('busy');
    const value = data(input, 'localTick,operationId,tick'); this.#monotonic(value.localTick);
    const operation = groundClockOperation({ operationId: value.operationId, world: this.#world,
      expectedVersion: 0, expectedTick: 0, tick: value.tick });
    return this.#begin(operation, value.localTick);
  }
  checkpoint(input) {
    if (!this.ready) fail('busy');
    const value = data(input, 'localTick,operationId'); this.#monotonic(value.localTick);
    const operation = groundClockOperation({ operationId: value.operationId, world: this.#world,
      expectedVersion: this.#clock.version, expectedTick: this.#clock.tick, tick: this.#epoch.toDurable(value.localTick) });
    return this.#begin(operation, value.localTick);
  }
  #begin(operation, tick) {
    this.#attempt = { operation: clone(operation), localTick: tick };
    this.#lastLocal = tick; this.#prepared = null; this.#state = 'pending';
    return this.#send(++this.#generation);
  }
  #uncertain(e, generation) {
    if (generation === this.#generation && this.#state !== 'fenced') this.#state = 'unresolved';
    throw error(e);
  }
  #fence(e) { this.#state = 'fenced'; throw error(e); }
  async #send(generation) {
    const { operation, localTick } = this.#attempt;
    let result;
    try {
      const raw = await this.#store.commitGroundClock({ operationId: operation.operationId, ...clone(operation.request) });
      this.#live(generation);
      result = checkedGroundClockResult(raw, operation.request, operation.operationId);
    } catch (e) { return this.#uncertain(e, generation); }
    if (!result.ok) return this.#fence(new StoreError(result.why));
    return this.#confirm(result.clock, localTick, generation);
  }
  async #confirm(expected, tick, generation) {
    let current;
    try { current = await this.#verified(generation, this.#attempt.operation); }
    catch (e) {
      if (e instanceof StoreError && ['response','conflict','cancelled'].includes(e.code)) return this.#fence(e);
      return this.#uncertain(e, generation);
    }
    if (!equal(current, expected)) return this.#fence(new StoreError('conflict'));
    return this.#prepare(current, tick, generation);
  }
  reconcile() {
    if (this.#state !== 'unresolved') fail('busy');
    this.#state = 'reconciling';
    return this.#reconcile(++this.#generation);
  }
  async #reconcile(generation) {
    const { operation, localTick } = this.#attempt;
    let receipt;
    try {
      const raw = await this.#store.loadGroundClockOperation(operation.operationId); this.#live(generation);
      receipt = checkedGroundClockReceipt(raw, operation.operationId);
    } catch (e) {
      if (e instanceof StoreError && ['response','cancelled'].includes(e.code)) return this.#fence(e);
      return this.#uncertain(e, generation);
    }
    if (!receipt) {
      let current;
      try { current = await this.#verified(generation); }
      catch (e) {
        if (e instanceof StoreError && ['response','conflict','cancelled'].includes(e.code)) return this.#fence(e);
        return this.#uncertain(e, generation);
      }
      if (!equal(current, this.#clock)) return this.#fence(new StoreError('conflict'));
      this.#state = 'unresolved'; return { state: 'unresolved' };
    }
    if (!equal(receipt.request, operation.request)) return this.#fence(new StoreError('response'));
    return this.#confirm(receipt.result.clock, localTick, generation);
  }
  resume() {
    if (this.#state !== 'unresolved') fail('busy');
    this.#state = 'pending';
    return this.#send(++this.#generation); // Exact UUID and immutable request; no new clock observation.
  }
  drain(tick) {
    if (this.ready || this.#state === 'missing') return { state: this.#state, clock: clone(this.#clock) };
    if (this.#state !== 'prepared') return { state: this.#state };
    try {
      local(tick);
      if (tick !== this.#prepared.localTick) fail('conflict');
      const next = clone(this.#prepared.clock);
      const epoch = next && (this.#epoch ?? new GroundClockEpoch({ localTick: tick, durableTick: next.tick }));
      this.#clock = next; this.#epoch = epoch; this.#lastLocal = tick;
      this.#attempt = null; this.#prepared = null; this.#state = next ? 'ready' : 'missing';
      return { state: this.#state, clock: clone(next) };
    } catch (e) { return this.#fence(e); }
  }
  cancel() {
    if (['idle','ready','missing','fenced'].includes(this.#state)) fail('operation');
    ++this.#generation; this.#state = 'fenced'; this.#prepared = null;
    return { state: 'fenced' };
  }
}
