// A stopped host adopts prepared SQL transactions through one synchronous drain.
import { StoreError } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { snapshotDropData } from './deathDropApply.mjs';
import { checkedWorldData } from './economicOperation.mjs';
import { groundTransactionOperation, checkedGroundTransactionResult, checkedGroundTransactionReceipt } from './groundTransaction.mjs';
import { GroundClockSession } from './groundClockSession.mjs';
import { assertGroundTransactionJournal, prepareGroundTransactionIntent, confirmGroundTransactionIntent,
  recoverGroundTransactionIntents } from './groundTransactionJournal.mjs';
import { appendGmResourceRoster } from './gmResourceRoster.mjs';

const MAX_VERSION = 2147483647;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const clone = value => structuredClone(value);
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
const owners = new WeakMap();

function copyInput(value) {
  try { return snapshotDropData(value); } catch { fail('operation'); }
}
function checkedRow(raw) {
  const value = copyInput(raw);
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'data,version' ||
      !Number.isSafeInteger(value.version) || value.version < 1 || value.version > MAX_VERSION) fail('response');
  const data = checkedWorldData(value.data);
  if (!same(data, value.data)) fail('response');
  return { data, version: value.version };
}
// The SQL036 append contract, independent of key order (a journaled request returns as jsonb).
function gmAppendOf(before, after) {
  try {
    if (!Array.isArray(after?.nodes) || after.nodes.length <= before.nodes.length) return false;
    const added = after.nodes.slice(before.nodes.length).map(node => ({ id: node?.id, kind: node?.kind }));
    return same(appendGmResourceRoster(before, added), after);
  } catch { return false; }
}
function required(store) {
  const names = ['checkGroundTransactions', 'loadWorld', 'loadGroundClock', 'loadGroundClockOperation',
    'commitGroundClock', 'commitGroundTransaction', 'loadGroundTransaction'];
  if (!store || typeof store !== 'object' || names.some(name => typeof store[name] !== 'function')) fail('configuration');
}

export class GroundTransactionSession {
  #store; #world; #clockSession; #state = 'idle'; #generation = 0; #pending = null;
  #prepared = null; #clock = null; #epoch = null; #worldVersion = null; #worldData = null; #lastLocal = null; #inflight = null;
  #journal; #recovery = null;
  constructor({ store, worldId, journal = null } = {}) {
    required(store);
    if (typeof worldId !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(worldId)) fail('configuration');
    this.#journal = journal === null ? null : assertGroundTransactionJournal(journal, worldId);
    let worlds = owners.get(store);
    if (!worlds) { worlds = new Set(); owners.set(store, worlds); }
    if (worlds.has(worldId)) fail('configuration');
    worlds.add(worldId);
    this.#store = store; this.#world = worldId;
    this.#clockSession = new GroundClockSession({ store, worldId });
  }
  get state() { return this.#state; }
  get clock() { return clone(this.#clock); }
  get worldVersion() { return this.#worldVersion; }
  get worldData() { return clone(this.#worldData); }
  get ready() { return this.#state === 'ready'; }
  get recovery() { return clone(this.#recovery); }
  #live(generation) { if (generation !== this.#generation || this.#state === 'fenced') fail('cancelled'); }
  #local(tick) {
    if (!integer(tick) || (this.#lastLocal !== null && tick < this.#lastLocal)) fail('operation');
    return tick;
  }
  logicalTick(localTick) {
    if (!this.ready || !this.#epoch) fail(this.#state === 'idle' ? 'unavailable' : 'busy');
    const tick = this.#local(localTick), value = this.#epoch.toDurable(tick);
    this.#lastLocal = tick;
    return value;
  }
  load(localTick) {
    if (this.#state !== 'idle') fail('busy');
    this.#local(localTick); this.#lastLocal = localTick;
    const generation = ++this.#generation; this.#state = 'loading';
    const promise = this.#runLoad(localTick, generation);
    this.#inflight = promise;
    return promise;
  }
  async #runLoad(localTick, generation) {
    try {
      const capability = await this.#store.checkGroundTransactions(); this.#live(generation);
      if (!capability || capability.version !== 1 || Object.keys(capability).length !== 1) fail('response');
      const recovery = this.#journal === null ? null : await recoverGroundTransactionIntents({
        store: this.#store, journal: this.#journal, worldId: this.#world, assertActive: () => this.#live(generation),
      });
      this.#live(generation);
      const clockLoad = await this.#clockSession.load(localTick); this.#live(generation);
      const first = checkedRow(await this.#store.loadWorld(this.#world)); this.#live(generation);
      const second = checkedRow(await this.#store.loadWorld(this.#world)); this.#live(generation);
      if (!same(first, second)) fail('conflict');
      const clock = clockLoad.clock;
      if (clock && first.data.resources && first.data.resources.tick !== clock.tick) fail('operation');
      this.#prepared = { kind: 'load', localTick, clock: clone(clock), worldVersion: first.version, worldData: clone(first.data), recovery };
      this.#state = 'prepared';
      return { state: 'prepared' };
    } catch (error) {
      if (generation === this.#generation && this.#state !== 'fenced') this.#state = 'fenced';
      throw error instanceof StoreError ? error : new StoreError('unavailable');
    }
  }
  begin(rawInput = {}) {
    if (!this.ready) fail('busy');
    const input = copyInput(rawInput);
    if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !==
        'clockOperationId,family,localTick,operation,operationId,worldData') fail('operation');
    const { operationId, clockOperationId, family, operation, worldData, localTick } = input;
    const tick = this.logicalTick(localTick);
    if (tick < this.#clock.tick) fail('operation');
    if (tick === this.#clock.tick && clockOperationId !== this.#clock.operationId) fail('operation');
    if (tick > this.#clock.tick && clockOperationId === this.#clock.operationId) fail('operation');
    const raw = groundTransactionOperation({ operationId, request: { world: this.#world,
      expectedWorldVersion: this.#worldVersion, worldData: copyInput(worldData), family, operation: copyInput(operation),
      clock: { operationId: clockOperationId, expectedVersion: this.#clock.version,
        expectedTick: this.#clock.tick, tick } } });
    this.#pending = { raw: clone(raw), localTick, sent: false };
    this.#prepared = null; this.#state = 'pending';
    const generation = ++this.#generation;
    const promise = this.#transact(generation);
    this.#pending.promise = promise; this.#inflight = promise;
    return promise;
  }
  async #receipt() {
    const receipt = checkedGroundTransactionReceipt(await this.#store.loadGroundTransaction(this.#pending.raw.operationId),
      this.#pending.raw.operationId);
    if (!receipt) return null;
    if (!same(receipt.request, this.#pending.raw.request) || !receipt.result.ok || receipt.result.replay) fail('response');
    return receipt.result;
  }
  async #prepareResult(result, generation) {
    this.#live(generation);
    if (this.#journal !== null) {
      await confirmGroundTransactionIntent(this.#store, this.#journal, this.#pending.raw, result,
        () => this.#live(generation));
      this.#live(generation);
    }
    if (!result.ok) { this.#state = 'fenced'; fail(result.why); }
    this.#prepared = { kind: 'transaction', result: clone(result), raw: clone(this.#pending.raw), localTick: this.#pending.localTick };
    this.#state = 'prepared';
    return { state: 'prepared', result: clone(result) };
  }
  async #transact(generation) {
    const pending = this.#pending;
    if (this.#journal !== null && !pending.intentPrepared) {
      try {
        await prepareGroundTransactionIntent(this.#journal, pending.raw, () => this.#live(generation));
        this.#live(generation); pending.intentPrepared = true;
      } catch (error) {
        if (generation !== this.#generation) throw new StoreError('cancelled');
        this.#state = error instanceof StoreError && ['operation', 'response'].includes(error.code) ? 'fenced' : 'unresolved';
        throw error instanceof StoreError ? error : new StoreError('unavailable');
      }
    }
    try {
      pending.sent = true;
      const result = checkedGroundTransactionResult(await this.#store.commitGroundTransaction(clone(pending.raw)),
        pending.raw.request, pending.raw.operationId);
      this.#live(generation);
      return await this.#prepareResult(result, generation);
    } catch (error) {
      if (generation !== this.#generation) throw new StoreError('cancelled');
      if (this.#state === 'fenced') throw error instanceof StoreError ? error : new StoreError('operation');
      try {
        const receipt = await this.#receipt(); this.#live(generation);
        if (receipt) return await this.#prepareResult(receipt, generation);
      } catch (receiptError) {
        if (generation !== this.#generation) throw new StoreError('cancelled');
        if (this.#state === 'fenced') throw receiptError instanceof StoreError ? receiptError : new StoreError('response');
        if (receiptError instanceof StoreError && receiptError.code === 'response') {
          this.#state = 'fenced'; throw receiptError;
        }
      }
      try {
        const result = checkedGroundTransactionResult(await this.#store.commitGroundTransaction(clone(pending.raw)),
          pending.raw.request, pending.raw.operationId);
        this.#live(generation);
        return await this.#prepareResult(result, generation);
      } catch (retryError) {
        if (generation !== this.#generation) throw new StoreError('cancelled');
        if (this.#state === 'fenced') throw retryError instanceof StoreError ? retryError : new StoreError('operation');
        this.#state = retryError instanceof StoreError && retryError.code === 'response' ? 'fenced' : 'unresolved';
        throw retryError instanceof StoreError ? retryError : new StoreError('unavailable');
      }
    }
  }
  reconcile() {
    if (this.#state !== 'unresolved') fail('busy');
    const generation = ++this.#generation; this.#state = 'pending';
    const promise = this.#runReconcile(generation);
    this.#pending.promise = promise; this.#inflight = promise;
    return promise;
  }
  async #runReconcile(generation) {
    if (this.#journal !== null && !this.#pending.intentPrepared) return this.#transact(generation);
    let receipt;
    try {
      receipt = await this.#receipt(); this.#live(generation);
    } catch (error) {
      if (generation !== this.#generation) throw new StoreError('cancelled');
      if (error instanceof StoreError && error.code === 'response') this.#state = 'fenced';
      else this.#state = 'unresolved';
      throw error instanceof StoreError ? error : new StoreError('unavailable');
    }
    if (receipt) {
      try { return await this.#prepareResult(receipt, generation); }
      catch (error) {
        if (generation !== this.#generation) throw new StoreError('cancelled');
        if (this.#state !== 'fenced') this.#state = error instanceof StoreError && error.code === 'response' ? 'fenced' : 'unresolved';
        throw error instanceof StoreError ? error : new StoreError('unavailable');
      }
    }
    try {
      const value = checkedGroundTransactionResult(await this.#store.commitGroundTransaction(clone(this.#pending.raw)),
        this.#pending.raw.request, this.#pending.raw.operationId);
      this.#live(generation);
      return await this.#prepareResult(value, generation);
    } catch (error) {
      if (generation !== this.#generation) throw new StoreError('cancelled');
      if (this.#state === 'fenced') throw error instanceof StoreError ? error : new StoreError('operation');
      if (error instanceof StoreError && error.code === 'response') this.#state = 'fenced';
      else this.#state = 'unresolved';
      throw error instanceof StoreError ? error : new StoreError('unavailable');
    }
  }
  drain(localTick, apply = null) {
    if (this.#state !== 'prepared' || !this.#prepared) return { state: this.#state };
    try {
      this.#local(localTick);
      if (localTick !== this.#prepared.localTick) fail('conflict');
      if (this.#prepared.kind === 'load') {
        const adopted = this.#clockSession.drain(localTick);
        if (adopted.state !== 'ready') fail('operation');
        this.#clock = clone(this.#prepared.clock); this.#worldVersion = this.#prepared.worldVersion;
        this.#worldData = clone(this.#prepared.worldData);
        this.#recovery = clone(this.#prepared.recovery);
        this.#epoch = this.#clockSession.epoch;
        this.#lastLocal = localTick; this.#prepared = null; this.#state = 'ready';
        return { state: 'ready', clock: clone(this.#clock) };
      }
      const { raw, result } = this.#prepared;
      if (raw.request.family !== 'checkpoint') {
        if (typeof apply !== 'function') fail('operation');
        const accepted = apply(clone(result), clone(raw.request));
        if (accepted && typeof accepted.then === 'function') fail('operation');
        if (accepted !== true) fail('operation');
      } else if (apply !== null) fail('operation');
      this.#clock = clone(result.clock); this.#worldVersion = result.worldVersion;
      this.#worldData = clone(raw.request.worldData); this.#lastLocal = localTick;
      this.#pending = null; this.#prepared = null; this.#state = 'ready';
      return { state: 'ready', clock: clone(this.#clock) };
    } catch (error) {
      this.#state = 'fenced'; this.#prepared = null;
      throw error instanceof StoreError ? error : new StoreError('operation');
    }
  }
  // SQL040 family: append authored GM identities to the confirmed roster. The request pins this
  // session's world version and clock (the clock does not move); its intent is journaled before
  // the commit RPC, and the confirmed rows are adopted here, before any content pointer moves.
  // A pending intent left by a stopped host is resolved first, on the same pin, exactly once.
  admitGmResources(rawInput = {}) {
    if (!this.ready || !this.#worldData?.resources) fail('busy');
    const input = copyInput(rawInput);
    if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'nodes,operationId' ||
        typeof input.operationId !== 'string' || !Array.isArray(input.nodes)) fail('operation');
    if (['loadPendingGroundGmAdmission', 'prepareGroundGmAdmission', 'commitGroundGmAdmission']
      .some(name => typeof this.#store[name] !== 'function')) fail('configuration');
    // Invalid authored nodes fail here, before any journal I/O.
    appendGmResourceRoster(this.#worldData.resources, input.nodes);
    this.#prepared = null; this.#state = 'pending';
    const generation = ++this.#generation;
    const promise = this.#admitGm(generation, input.operationId, input.nodes);
    this.#inflight = promise;
    return promise;
  }
  #gmRequest(resources) {
    return { world: this.#world, expectedWorldVersion: this.#worldVersion,
      clock: { operationId: this.#clock.operationId, version: this.#clock.version, tick: this.#clock.tick }, resources };
  }
  #adoptGm(request, result) {
    if (!result.ok || !same(request, this.#gmRequest(request.resources)) || result.worldVersion !== this.#worldVersion + 1 ||
        !gmAppendOf(this.#worldData.resources, request.resources)) fail('response');
    // SQL036 replaced only the resources of the confirmed world row and bumped its version.
    this.#worldVersion = result.worldVersion;
    this.#worldData = { ...this.#worldData, resources: clone(request.resources) };
  }
  async #admitGm(generation, operationId, nodes) {
    try {
      let admitted = 0;
      const stale = await this.#store.loadPendingGroundGmAdmission(this.#world); this.#live(generation);
      if (stale) {
        if (stale.operationId === operationId || stale.request.world !== this.#world) fail('response');
        const result = await this.#store.commitGroundGmAdmission({ operationId: stale.operationId, request: stale.request });
        this.#live(generation);
        // A conflict or rejection is terminal and wrote nothing; a commit is adopted like our own.
        if (result.ok) { this.#adoptGm(stale.request, result); admitted += result.added; }
      }
      const resources = appendGmResourceRoster(this.#worldData.resources, nodes);
      if (resources.nodes.length > this.#worldData.resources.nodes.length) {
        const raw = { operationId, request: this.#gmRequest(resources) };
        const intent = await this.#store.prepareGroundGmAdmission(clone(raw)); this.#live(generation);
        if (intent.state !== 'pending' || intent.operationId !== operationId || !same(intent.request, raw.request)) fail('response');
        const result = await this.#store.commitGroundGmAdmission(clone(raw)); this.#live(generation);
        if (!result.ok) fail(result.why === 'conflict' ? 'conflict' : 'operation');
        this.#adoptGm(raw.request, result); admitted += result.added;
      }
      this.#state = 'ready';
      return { state: 'ready', admitted, worldVersion: this.#worldVersion };
    } catch (error) {
      if (generation !== this.#generation) throw new StoreError('cancelled');
      // Every outcome after the first read is fenced: an unknown commit must be recovered by a restart.
      this.#state = 'fenced';
      throw error instanceof StoreError ? error : new StoreError('unavailable');
    }
  }
  async settle() {
    const promise = this.#inflight;
    if (promise) await Promise.allSettled([promise]);
    return { state: this.#state };
  }
  fail() { ++this.#generation; this.#state = 'fenced'; this.#prepared = null; this.#pending = null; return { state: 'fenced' }; }
  cancel() {
    if (this.#state === 'fenced') return { state: 'fenced' };
    ++this.#generation; this.#state = 'fenced'; this.#prepared = null; this.#pending = null;
    if (this.#clockSession.state === 'loading' || this.#clockSession.state === 'prepared') {
      try { this.#clockSession.cancel(); } catch { /* The outer fence remains authoritative. */ }
    }
    return { state: 'fenced' };
  }
}
