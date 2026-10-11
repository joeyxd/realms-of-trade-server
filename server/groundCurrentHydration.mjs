// Startup composition for current pearl and ordinary death-drop rows under the common
// GroundHostAuthority. Reads prepare only; one stopped synchronous drain installs both families.
import { StoreError } from './store.mjs';
import { PearlGroundHydration } from './pearlGroundHydration.mjs';

const fail = code => { throw new StoreError(code); };
const integer = value => Number.isSafeInteger(value) && value >= 0;

export class GroundCurrentHydration {
  #host; #server; #world; #worldState; #worldId; #profiles; #authority; #boundary; #hydration;
  #hydrationClockAnchor;
  #state = 'idle'; #task = null; #result = null; #pearlRows = new Map();

  constructor({ host, deadlineClock, pageSize = 64, maxRows = 4096 } = {}) {
    if (!host || !host.server || !host.worldState || !host.groundAuthority || !host.profiles ||
        typeof host.groundAuthority.status !== 'function' || typeof host.groundAuthority.canMutate !== 'function' ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 256 ||
        !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 65536) fail('configuration');
    this.#host = host; this.#server = host.server; this.#world = host.server.world;
    this.#worldState = host.worldState; this.#worldId = host.worldState.id;
    this.#profiles = host.profiles; this.#authority = host.groundAuthority;
    this.#boundary = this.#authority.boundary;
    if (typeof this.#boundary !== 'function' || this.#server.beforeTick !== this.#boundary ||
        !this.#worldId || !deadlineClock || deadlineClock.worldId !== this.#worldId) fail('configuration');
    this.#hydrationClockAnchor = structuredClone(deadlineClock.anchor);
    this.#hydration = new PearlGroundHydration({ sessions: host.profiles, world: this.#world,
      worldId: this.#worldId, deadlineClock, pageSize, maxRows, deathDrops: true });
  }

  get ready() { return this.#state === 'ready' || this.#state === 'applied'; }
  get preparedCounts() {
    const counts = this.#hydration.preparedCounts;
    return counts ? structuredClone(counts) : null;
  }
  status() { return { state: this.#state, ready: this.ready, result: this.#result && structuredClone(this.#result),
    pearls: this.#pearlRows.size }; }

  #assertOwner(requireReady = false) {
    const h = this.#host, s = this.#server, w = this.#world, ws = this.#worldState, a = this.#authority;
    if (h.server !== s || h.worldState !== ws || ws.id !== this.#worldId || h.profiles !== this.#profiles ||
        h.groundAuthority !== a || s.world !== w ||
        a.boundary !== this.#boundary || s.beforeTick !== this.#boundary || w.tick !== 0 ||
        h.closing || h.wss || h.timer || h.beat || h.worldTimer || h.pendingJoins !== 0 ||
        !(h.joins instanceof Set) || h.joins.size !== 0 || !(h.sockets instanceof Map) || h.sockets.size !== 0 ||
        !(s.clients instanceof Map) || s.clients.size !== 0 || !(w.profiles instanceof Map) || w.profiles.size !== 0 ||
        h.profiles.accounts.size !== 0 || h.profiles.clients.size !== 0 || h.profiles.tasks.size !== 0 ||
        h.nextId !== 1 || ws.ready !== true || (requireReady && (!a.ready || !a.canMutate()))) fail('configuration');
    const status = a.status(), clock = status?.clock;
    if (!clock || !integer(clock.tick) || this.#hydrationClockAnchor?.localTick !== 0 ||
        this.#hydrationClockAnchor?.durableTick !== clock.tick) fail('configuration');
    // Runtime `world.resources` is the simulation's node layout; the durable clock lives in
    // WorldState.resources and is checked against the same restored GHA clock.
    if (ws.resources && ws.resources.tick !== clock.tick) fail('conflict');
  }

  // `prepare()` is called after GroundHostAuthority has recovered its journal and WorldState
  // has opened. It starts verified reads while keeping the shared mutation barrier held.
  prepare() {
    if (this.#task) return this.#task;
    if (this.#state !== 'idle') fail('operation');
    try {
      this.#assertOwner();
    } catch (error) { this.#state = 'fenced'; throw error; }
    this.#state = 'pending';
    let task;
    try { task = this.#hydration.start(); }
    catch (error) { this.#state = 'fenced'; throw error instanceof StoreError ? error : new StoreError('unavailable'); }
    this.#task = task.then(result => {
      this.#assertOwner();
      if (this.#state !== 'pending' || result.state !== 'ready') fail('cancelled');
      this.#state = 'ready'; this.#result = result;
      return structuredClone(result);
    }).catch(error => {
      if (this.#hydration.state === 'pending' || this.#hydration.state === 'ready') {
        try { this.#hydration.cancel(); } catch { /* Keep startup fenced. */ }
      }
      this.#state = 'fenced';
      throw error instanceof StoreError ? error : new StoreError('unavailable');
    });
    return this.#task;
  }

  drain() {
    if (this.#state === 'applied') return structuredClone(this.#result);
    if (this.#state !== 'ready') return { state: this.#state };
    try { this.#assertOwner(true); }
    catch (error) {
      try { this.#hydration.cancel(); } catch { /* Preserve the owner fence. */ }
      this.#state = 'fenced'; return { state: 'fenced', why: error instanceof StoreError ? error.code : 'configuration' };
    }
    const result = this.#hydration.drain();
    if (result.state === 'applied') {
      this.#result = result;
      this.#pearlRows = new Map(this.#hydration.currentPearls.map(row => [row.dropId, row]));
      this.#state = 'applied';
    } else if (result.state === 'fenced') this.#state = 'fenced';
    return structuredClone(result);
  }

  cancel() {
    if (this.#state === 'applied' || this.#state === 'fenced') return { state: this.#state };
    if (this.#state === 'idle') { this.#state = 'fenced'; return { state: 'fenced' }; }
    const result = this.#hydration.cancel();
    this.#state = 'fenced';
    return result;
  }

  pearl(dropId) {
    if (this.#state !== 'applied' || !Number.isSafeInteger(dropId)) return null;
    const row = this.#pearlRows.get(dropId);
    return row ? structuredClone(row) : null;
  }
}
