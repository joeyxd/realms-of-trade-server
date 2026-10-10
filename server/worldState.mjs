// A single world's economy authority. Database work stays outside the simulation pump; immutable
// snapshots are serialized and coalesced. A failed/ambiguous write fences this authority until restart.
import { Economy, ECON } from '../src/sim/economy/economy.js';
import { TOWN_IDS } from '../src/data/towns.js';
import { BUILDINGS, RECIPES } from '../src/data/buildings.js';
import { GOOD_IDS } from '../src/data/goods.js';
import { StoreError } from './store.mjs';
import { validateCommunityState } from './communityProject.mjs';
import { checkedResourceState } from './resourceState.mjs';

const MAX_VERSION = 2147483647;
const object = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const nonnegative = (n) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;

export class WorldState {
  constructor(store, { id, seed, onFailure = () => {} }) {
    if (typeof id !== 'string' || !id.trim() || id.length > 100 || id.includes('\0') ||
      !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      typeof store?.loadWorld !== 'function' || typeof store?.saveWorld !== 'function') throw new StoreError('configuration');
    this.store = store; this.id = id; this.seed = seed; this.onFailure = onFailure;
    this.version = 0; this.ready = false; this.failed = false; this.errors = 0;
    this.pending = null; this.running = null; this.last = null;
    this.community = null; this.operationBusy = false;
    this.resources = null; this.resourceTick = null;
    this.loadAbort = new AbortController();
  }

  async open(fresh) {
    if (this.openPromise) return this.openPromise;
    this.openPromise = this.load(fresh);
    return this.openPromise;
  }

  async load(fresh) {
    try {
      const row = await abortable(this.store.loadWorld(this.id), this.loadAbort.signal);
      if (row !== null) {
        if (!object(row) || !Number.isSafeInteger(row.version) || row.version < 1 || row.version > MAX_VERSION ||
          !object(row.data) || row.data.v !== 1 || row.data.seed !== this.seed) throw new StoreError('world_format');
        validateEconomy(row.data.economy, this.seed);
        this.community = validateCommunityState(row.data.community, this.id);
        this.resources = Object.hasOwn(row.data, 'resources') ? checkedResourceState(row.data.resources) : null;
        const economy = Economy.from(row.data.economy, this.seed);
        this.version = row.version;
        this.last = JSON.stringify(this.snapshot(economy));
        this.ready = true;
        return economy;
      }
      // Publish a new world's first generation before accepting any gameplay. Competing creation fails CAS.
      const data = this.snapshot(fresh);
      const result = await this.store.saveWorld(this.id, data, 0);
      this.accept(result);
      this.last = JSON.stringify(data); this.ready = true;
      return fresh;
    } catch (err) {
      if (this.loadAbort.signal.aborted && err?.code === 'cancelled') throw new StoreError('cancelled');
      const code = err instanceof StoreError && ['world_format', 'conflict', 'response'].includes(err.code) ? err.code : 'unavailable';
      this.fail(code);
      throw new StoreError(code);
    }
  }

  snapshot(economy) {
    const data = structuredClone({ v: 1, seed: this.seed, economy: economy.serialize(),
      ...(this.community ? { community: this.community } : {}),
      ...(this.resources ? { resources: checkedResourceState({ ...this.resources,
        tick: this.resourceTick ? this.resourceTick() : this.resources.tick }) } : {}) });
    validateEconomy(data.economy, this.seed);
    return data;
  }

  save(economy) {
    if (!this.ready || this.failed || this.operationBusy) return;
    try {
      const data = this.snapshot(economy);
      this.pending = { data, text: JSON.stringify(data) };
    } catch { this.fail('world_format'); return; }
    if (this.running) return;
    this.schedule();
  }

  schedule() {
    this.running = Promise.resolve().then(() => this.write()).finally(() => {
      this.running = null;
      // A caller can queue another snapshot in the microtask between the writer finishing and this cleanup.
      if (this.pending && !this.failed) this.schedule();
    });
  }

  async write() {
    while (this.pending && !this.failed) {
      const next = this.pending; this.pending = null;
      if (next.text === this.last) continue;
      try {
        this.accept(await this.store.saveWorld(this.id, next.data, this.version));
        if (next.data.resources) this.resources = structuredClone(next.data.resources);
        this.last = next.text;
      } catch (err) {
        this.fail(err instanceof StoreError && ['conflict', 'response'].includes(err.code) ? err.code : 'unavailable');
      }
    }
  }

  accept(result) {
    if (result?.ok === false && result.why === 'conflict') throw new StoreError('conflict');
    if (result?.ok !== true || result.version !== this.version + 1 || result.version > MAX_VERSION) throw new StoreError('response');
    this.version = result.version;
  }

  fail(code) {
    if (this.failed) return;
    this.failed = true; this.ready = false; this.pending = null; this.errors++;
    this.onFailure(code);
  }

  async flush() {
    if (this.openPromise) {
      try { await this.openPromise; }
      catch (err) { if (err?.code !== 'cancelled') throw err; }
    }
    while (this.running) await this.running;
    if (this.failed) throw new StoreError('flush');
  }

  status() { return { id: this.id, ready: this.ready, failed: this.failed, version: this.version, errors: this.errors }; }
  cancelLoad() { this.loadAbort.abort(); }
}

export function worldConfigFromEnv(env = process.env) {
  const id = env.WORLD_ID === undefined ? 'marea-negra' : env.WORLD_ID;
  const seconds = env.WORLD_SAVE_SECONDS === undefined ? 60 : Number(env.WORLD_SAVE_SECONDS);
  if (typeof id !== 'string' || !id.trim() || id.length > 100 || id.includes('\0') ||
    !Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > 2147483647) throw new StoreError('configuration');
  return { worldId: id, worldSaveMs: seconds * 1000 };
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new StoreError('cancelled'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new StoreError('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// Persisted corruption must fail startup, rather than silently manufacture default markets or clear ownership.
function validateEconomy(data, seed) {
  if (!object(data) || data.v !== 2 || !nonnegative(data.hours) || !nonnegative(data.acc) || data.acc >= ECON.tickSec ||
    !Number.isInteger(data.rng) || data.rng < 0 || data.rng > 0xffffffff ||
    !object(data.markets) || !object(data.plots) || Object.keys(data.markets).length !== TOWN_IDS.length ||
    Object.keys(data.plots).length !== TOWN_IDS.length) throw new StoreError('world_format');
  const template = new Economy(seed);
  for (const town of TOWN_IDS) {
    const market = data.markets[town], plots = data.plots[town];
    const goods = Object.keys(template.markets[town].stock);
    if (market?.id !== town || !object(market.stock) || !object(market.last) || Object.keys(market.stock).length !== goods.length ||
      !Array.isArray(plots) || plots.length !== template.plots[town].length) throw new StoreError('world_format');
    for (const g of goods) if (!nonnegative(market.stock[g])) throw new StoreError('world_format');
    for (const [g, trend] of Object.entries(market.last)) if (!goods.includes(g) || ![-1, 0, 1].includes(trend)) throw new StoreError('world_format');
    for (const [i, p] of plots.entries()) {
      if (!object(p) || p.town !== town || p.i !== i || typeof p.owner !== 'string' || (p.owner && !/^[a-z0-9]{1,24}$/.test(p.owner)) ||
        typeof p.b !== 'string' || (p.b && !Object.hasOwn(BUILDINGS, p.b)) || !['empty', 'building', 'ready'].includes(p.state) ||
        (p.state !== 'empty' && (!p.b || !p.owner)) || (p.state === 'empty' && (p.b || p.recipe)) || typeof p.recipe !== 'string' ||
        (p.recipe && !(BUILDINGS[p.b]?.recipes || []).includes(p.recipe)) || !object(p.store)) throw new StoreError('world_format');
      for (const field of ['done', 'batchT', 'debt', 'owed']) if (!nonnegative(p[field])) throw new StoreError('world_format');
      if (p.batchT && (!p.recipe || p.batchT >= RECIPES[p.recipe].hours)) throw new StoreError('world_format');
      for (const [g, n] of Object.entries(p.store)) if (!GOOD_IDS.includes(g) || !nonnegative(n)) throw new StoreError('world_format');
    }
  }
}
