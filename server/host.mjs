// GameHost: one LocalServer (the same authoritative server the Web Worker runs for solo play) behind
// WebSockets. Gameplay stays in LocalServer; transport and optional account persistence live here,
// outside the fixed-step simulation.
import { WebSocketServer } from 'ws';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { LagLink } from '../src/net/lagLink.js';
import { C } from '../src/sim/ecs.js';
import { createMemoryStore, StoreError } from './store.mjs';
import { ProfileSessions } from './profileSessions.mjs';
import { legacyKey } from './legacy.mjs';
import { WorldState } from './worldState.mjs';
import { pearlMutationGate } from './pearlMutationGate.mjs';
import { profilePearls, canonicalText } from './pearlOperations.mjs';
import { syncProfile } from '../src/sim/systems/inventory.js';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { PearlStaging } from './pearlStaging.mjs';
import { DeathStaging } from './deathStaging.mjs';
import { CombatDeath } from './combatDeath.mjs';
import { DeathDropStaging } from './deathDropStaging.mjs';
import { DeathDropLifecycle, managedDeathDrop } from './deathDropLifecycle.mjs';
import { PearlStartup } from './pearlStartup.mjs';
import { PearlLifecycle } from './pearlLifecycle.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { groundKey } from './pearlGround.mjs';
import { AgentControl } from './agentControl.mjs';
import { EconomicAuthority } from './economicAuthority.mjs';
import { newCommunityState } from './communityProject.mjs';
import { BTN } from '../src/sim/systems/movement.js';
import { types } from 'node:util';

function assemblyOptions(raw, keys) {
  if (!raw || types.isProxy(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new StoreError('configuration');
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).some(key => !keys.includes(key) || !fields[key].enumerable ||
      !Object.hasOwn(fields[key], 'value'))) throw new StoreError('configuration');
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
}

const LIMITS = {
  msgsPerSec: 120, msgsBurst: 240,   // a client flushes inputs once per frame (≤ 60/s) plus pings
  bytesPerSec: 48 * 1024, bytesBurst: 96 * 1024,
  maxPayload: 64 * 1024,
  maxCmds: 32,                       // commands per inputs message
  strikes: 5,                        // malformed messages per second before the socket is closed
  heartbeat: 15000,                  // ms between pings; a socket that missed one is dropped
};

export class GameHost {
  #pearlStaging = null; #deathStaging = null; #drainingPearls = false; #pearlFailed = false;
  #stagingBoundary = null;
  #combatDeaths = null; #combatBoundary = null; #fatalHook = null; #pendingDeathHook = null;
  #deathDropStaging = null; #deathDrops = null; #managedDropHook = null;
  #pearlStartup = null; #prepareTask = null; #requiresPearlStartup = false;
  #deadlineClock = null; #pearlGround = null;

  constructor({ seed, bots = 3, maxPlayers = 4, dev = false, lagMs = 0, jitterMs = 0, origins = [], log = console.log, saves,
    store = createMemoryStore(), resolvePlayer = null, joinTimeoutMs = 15000, initializeAccounts = false,
    worldId = null, worldSaveMs = 60000, pearlJournal = null, chat = {}, agentControl = null,
    economicOperations = false, communityRequirements = null } = {}) {
    if (typeof economicOperations !== 'boolean' || economicOperations && pearlJournal !== null ||
        !economicOperations && communityRequirements !== null) throw new StoreError('configuration');
    if (resolvePlayer !== null && typeof resolvePlayer !== 'function') throw new StoreError('configuration');
    if (agentControl !== null && !resolvePlayer) throw new StoreError('configuration');
    if (agentControl !== null && worldId !== null && agentControl.worldId !== worldId) throw new StoreError('configuration');
    this.agentControl = agentControl === null ? null : new AgentControl(agentControl);
    if (!Number.isFinite(joinTimeoutMs) || joinTimeoutMs <= 0 || joinTimeoutMs > 60000) throw new StoreError('configuration');
    if (initializeAccounts && (!resolvePlayer || !saves || typeof store.initializeProfile !== 'function' || typeof store.legacyClaimed !== 'function')) throw new StoreError('configuration');
    if (!Number.isFinite(worldSaveMs) || worldSaveMs <= 0 || worldSaveMs > 2147483647) throw new StoreError('configuration');
    // Recovery owns an empty player authority. Bots and guest adoption need their own later policy.
    if (pearlJournal !== null && (!resolvePlayer || bots !== 0 || worldId === null ||
        groundKey(worldId) !== pearlJournal.scope)) throw new StoreError('configuration');
    this.#requiresPearlStartup = pearlJournal !== null;
    this.log = log;
    this.maxPlayers = maxPlayers;
    this.origins = origins;
    this.lag = { ms: lagMs, jitter: jitterMs };
    this.sockets = new Map(); // id -> {ws, out, in, bucket}
    this.nextId = 1;
    this.errors = 0;
    this.store = store;
    this.resolvePlayer = resolvePlayer; // Optional server-owned identity verifier; the title/login is P2.
    this.initializeAccounts = initializeAccounts;
    this.legacyReservations = new Map();
    this.joinTimeoutMs = joinTimeoutMs;
    this.joins = new Set(); this.pendingJoins = 0; this.closing = false;
    this.profiles = new ProfileSessions(store, (id, code) => {
      this.log(`[store] #${id} save failed: ${code}`);
      // Staging can fail sessions while a reversible apply is still unwinding. Stop immediately,
      // but let that boundary finish rollback before disconnect mutates profiles/entities.
      if (this.#drainingPearls) { this.#stopPearls(); return; }
      const sock = this.sockets.get(id);
      if (sock) { try { sock.ws.close(1011, 'storage'); } catch { /* gone */ } this.onClose(sock); }
    }, { journal: pearlJournal });
    // A blocked final snapshot is evidence of an incomplete shutdown, never a retryable save blob.
    // Keep its detached data private for explicit reconciliation; it may contain pre-commit UIDs.
    this.unsavedProfiles = new Map();
    this.stats = { bytesOut: 0, bytesIn: 0, msgsOut: 0, msgsIn: 0, dropped: 0, stepMs: 0, steps: 0 };
    this.server = new LocalServer({
      seed, bots, dev, debug: dev, maxPlayers, pausable: false, fill: true, chat, ...(saves ? { saves } : {}),
      send: (id, msg) => this.sendTo(id, msg),
      profileAccess: (id, entity) => this.profileAvailable(id, entity),
      commandAccess: (id, entity, plan) => this.commandAvailable(id, entity, plan),
      tickAccess: () => this.tickAvailable(),
      beforeDetach: (id, entity) => this.beforeProfileDetach(id, entity),
      onSave: (id, p) => this.saveProfile(id, p),
    });
    if (this.agentControl) this.server.inputAccess = (...args) => this.agentInputAllowed(...args);
    this.worldSaveMs = worldSaveMs;
    this.worldState = worldId === null ? null : new WorldState(store, { id: worldId, seed: this.server.world.seed,
      onFailure: (code) => this.fenceWorld(code) });
    this.economicAuthority = economicOperations ? new EconomicAuthority(this) : null;
    this.communityRequirements = communityRequirements === null ? null : structuredClone(communityRequirements);
    if (this.economicAuthority) this.server.beforeTick = () => this.economicAuthority.drain();
    this.started = performance.now();
  }

  get pearlStaging() { return this.#pearlStaging; }
  get deathStaging() { return this.#deathStaging; }
  get pearlStartup() { return this.#pearlStartup; }
  get combatDeaths() { return this.#combatDeaths; }
  get deathDropStaging() { return this.#deathDropStaging; }
  get deathDrops() { return this.#deathDrops; }
  get pearlGround() { return this.#pearlGround; }

  // Explicit, server-owned assembly only. It does not dispatch player commands or recover startup.
  // Install before transport/admission; no caller callbacks may replace the three trusted adapters.
  mountPearlStaging(options = {}) {
    options = assemblyOptions(options, ['scope', 'limit', 'deadlineClock']);
    if (!this.resolvePlayer || this.economicAuthority || this.#pearlStaging || this.closing || this.wss || this.timer ||
        this.nextId !== 1 || this.sockets.size || this.joins.size || this.pendingJoins || this.server.clients.size ||
        this.profiles.accounts.size || this.profiles.clients.size || this.profiles.tasks.size ||
        this.server.world.tick !== 0 || this.server.beforeTick !== null ||
        (this.worldState && options.scope !== this.worldState.id)) throw new StoreError('configuration');
    const clock = options.deadlineClock === undefined ? null : assertGroundDeadlineClock(options.deadlineClock, options.scope);
    const staging = new PearlStaging(this.profiles, this.server.world, options.scope, {
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      deadlineClock: clock,
      captureProfile: (id, entity) => this.capturePearlProfile(id, entity),
      prepareInputs: (id, entity) => this.server.preparePearlInputs(id, entity),
    });
    this.#pearlStaging = staging;
    this.#deadlineClock = clock;
    this.#stagingBoundary = () => this.#drainPearls();
    this.server.beforeTick = this.#stagingBoundary;
    return staging;
  }

  // Optional trusted assembly on the same gate/beforeTick owner. No transport death dispatch.
  mountDeathStaging(options = {}) {
    const fields = options && typeof options === 'object' && !Array.isArray(options)
      ? Object.getOwnPropertyDescriptors(options) : null;
    if (!fields || Reflect.ownKeys(fields).some((key) => !['scope','limit'].includes(key) || !Object.hasOwn(fields[key], 'value')) ||
        !this.resolvePlayer || !this.#pearlStaging || this.#deathStaging || this.#prepareTask || this.closing || this.wss || this.timer ||
        this.nextId !== 1 || this.sockets.size || this.joins.size || this.pendingJoins || this.server.clients.size ||
        this.profiles.accounts.size || this.profiles.clients.size || this.profiles.tasks.size ||
        this.server.beforeTick !== this.#stagingBoundary ||
        this.server.world.profiles.size || this.server.world.tick !== 0 || countBots(this.server.world) !== 0 ||
        fields.scope?.value !== this.#pearlStaging.scope) throw new StoreError('configuration');
    const staging = new DeathStaging(this.profiles, this.server.world, fields.scope.value, {
      ...(fields.limit === undefined ? {} : { limit: fields.limit.value }),
      deadlineClock: this.#deadlineClock,
      prepareInputs: (id, entity) => this.server.prepareDeathInputs(id, entity),
    });
    this.#deathStaging = staging;
    return staging;
  }

  // Explicit pilot assembly. CLI/default hosts retain their existing immediate death behavior.
  // A terminal tick finishes once; publication and the next tick wait for every ordered receipt.
  mountCombatDeaths() {
    const s = this.server, w = s.world;
    if (arguments.length || !this.#deathStaging || this.#combatDeaths || this.#prepareTask || this.closing || this.wss || this.timer ||
        this.nextId !== 1 || this.sockets.size || this.joins.size || this.pendingJoins || s.clients.size ||
        this.profiles.accounts.size || this.profiles.clients.size || this.profiles.tasks.size ||
        s.beforeTick !== this.#stagingBoundary || s.afterTick !== null ||
        w.deferPlayerDeath != null || w.isPlayerDeathPending != null || w.profiles.size ||
        w.tick !== 0 || countBots(w) !== 0) throw new StoreError('configuration');
    const combat = new CombatDeath(s, this.#deathStaging);
    this.#fatalHook = (e, seq, by) => combat.intercept(e, seq, by);
    this.#pendingDeathHook = (e) => combat.has(e);
    this.#combatBoundary = (complete) => {
      this.#drainingPearls = true;
      try {
        if (!complete) throw new StoreError('effect');
        this.#assertCombatOwner();
        this.#assertDropOwner();
        this.#assertPearlGroundOwner();
        combat.completeTick();
        return !combat.pending;
      } catch {
        this.errors++; combat.fail(); this.#stopPearls(); return false;
      } finally { this.#drainingPearls = false; }
    };
    this.#combatDeaths = combat;
    w.deferPlayerDeath = this.#fatalHook; w.isPlayerDeathPending = this.#pendingDeathHook;
    s.afterTick = this.#combatBoundary;
    return combat;
  }

  // Trusted pilot assembly only; ordinary drops use the completed tick before the next step.
  mountDeathDrops() {
    const s=this.server,w=s.world;
    if (arguments.length || !this.#combatDeaths || this.#deathDrops || this.#prepareTask || this.closing || this.wss || this.timer ||
        this.nextId!==1 || this.sockets.size || this.joins.size || this.pendingJoins || s.clients.size ||
        this.profiles.accounts.size || this.profiles.clients.size || this.profiles.tasks.size ||
        w.tick!==0 || w.profiles.size || countBots(w)!==0 || w.isDeathDropManaged!=null) throw new StoreError('configuration');
    this.#assertCombatOwner();
    const staging=new DeathDropStaging(this.profiles,w,this.#pearlStaging.scope,{deadlineClock:this.#deadlineClock});
    const lifecycle=new DeathDropLifecycle(s,staging);
    this.#deathDropStaging=staging;
    this.#deathDrops=lifecycle;
    this.#managedDropHook=managedDeathDrop;
    w.isDeathDropManaged=this.#managedDropHook;
    return this.#deathDrops;
  }

  // Explicit clock-domain pilot. The caller loads/checks the epoch before assembly; no CLI activation.
  mountPearlGround() {
    const s = this.server, w = s.world;
    if (arguments.length || !this.#deadlineClock || !this.#combatDeaths || !this.#deathDrops || !this.profiles.pearls.journal ||
        !this.worldState || this.worldState.id !== this.#pearlStaging.scope || this.#pearlGround || this.#pearlStartup ||
        this.#prepareTask || this.closing || this.wss || this.timer || this.nextId !== 1 ||
        this.sockets.size || this.joins.size || this.pendingJoins || s.clients.size ||
        this.profiles.accounts.size || this.profiles.clients.size || this.profiles.tasks.size ||
        w.tick !== 0 || w.profiles.size || countBots(w) !== 0) throw new StoreError('configuration');
    this.#assertCombatOwner();
    this.#pearlGround = new PearlLifecycle(s, this.profiles, this.#pearlStaging.scope, { deadlineClock: this.#deadlineClock });
    return this.#pearlGround;
  }

  #groundBusy() { return this.#pearlGround?.pending || this.#pearlGround?.failed; }

  #assertPearlGroundOwner() {
    if (this.#pearlGround && (this.server.world !== this.#pearlGround.world ||
        this.server.beforeTick !== this.#stagingBoundary || this.#pearlGround.failed)) {
      this.#pearlGround.fail(); this.#stopPearls(); throw new StoreError('effect');
    }
  }

  #assertDropOwner() {
    if (this.#deathDrops && (this.server.world!==this.#deathDrops.world ||
        this.server.world.isDeathDropManaged!==this.#managedDropHook || this.#deathDrops.failed)) {
      this.#deathDrops.fail(); this.#stopPearls(); throw new StoreError('effect');
    }
  }

  #assertCombatOwner() {
    if (this.#combatDeaths && (this.server.beforeTick !== this.#stagingBoundary ||
        this.server.afterTick !== this.#combatBoundary || this.server.world.deferPlayerDeath !== this.#fatalHook ||
        this.server.world.isPlayerDeathPending !== this.#pendingDeathHook || this.#combatDeaths.failed)) {
      this.#combatDeaths.fail(); this.#stopPearls(); throw new StoreError('effect');
    }
  }

  // Only server-owned selectors, between ticks. The returned handle means pending work.
  requestDeath(raw) {
    if (!this.#deathStaging || this.closing || this.#pearlFailed || !this.#pearlsReady() || this.#combatDeaths?.pending || this.#deathDrops?.pending || this.#groundBusy()) throw new StoreError('unavailable');
    try { this.server.assertTickIdle(); } catch { throw new StoreError('busy'); }
    const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value));
    if (!plain(raw)) throw new StoreError('operation');
    const fields = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(fields).some((key) => !['victim','killer','seq'].includes(key) || !Object.hasOwn(fields[key], 'value'))) throw new StoreError('operation');
    for (const key of ['victim','killer']) {
      const selector = fields[key]?.value;
      if (key === 'killer' && (selector === undefined || selector === null)) continue;
      if (!plain(selector)) throw new StoreError('session');
      const endpoint = Object.getOwnPropertyDescriptors(selector);
      if (Reflect.ownKeys(endpoint).some((key) => typeof key !== 'string') || Reflect.ownKeys(endpoint).sort().join(',') !== 'clientId,entity' ||
          Object.values(endpoint).some((d) => !Object.hasOwn(d, 'value'))) throw new StoreError('session');
      const c = this.server.clients.get(endpoint.clientId.value);
      if (!c?.serverProfile || c.entity !== endpoint.entity.value) throw new StoreError('session');
    }
    return this.#deathStaging.request(raw);
  }

  // Journal identity belongs to ProfileSessions from construction; never replace its live queue.
  // mapClock is explicit and synchronous. This seam chooses no offline ageing or guest adoption.
  mountPearlStartup(options = {}) {
    options = assemblyOptions(options, ['accountPolicy', 'mapClock', 'pageSize', 'maxRows', 'deathDrops']);
    if (options.accountPolicy !== 'accounts-only' ||
        (options.deathDrops !== undefined && typeof options.deathDrops !== 'boolean') ||
        (options.deathDrops === true && (!this.#deathDrops || !this.#deadlineClock)) ||
        (this.#deadlineClock !== null && Object.hasOwn(options, 'mapClock')) ||
        !this.#pearlStaging || !this.profiles.pearls.journal || !this.worldState ||
        this.profiles.pearls.journal.scope !== this.worldState.id || this.#pearlStaging.scope !== this.worldState.id ||
        this.#pearlStartup || this.#prepareTask || this.closing || this.wss || this.timer || this.nextId !== 1 ||
        this.sockets.size || this.joins.size || this.pendingJoins || this.server.clients.size ||
        this.profiles.accounts.size || this.profiles.clients.size || this.profiles.tasks.size ||
        this.server.world.profiles.size || this.server.world.tick !== 0) throw new StoreError('configuration');
    this.#pearlStartup = new PearlStartup({ ...options, sessions: this.profiles,
      world: this.server.world, worldId: this.worldState.id,
      ...(this.#deadlineClock === null ? {} : { deadlineClock: this.#deadlineClock }) });
    return this.#pearlStartup;
  }

  #pearlsReady() {
    return !this.#requiresPearlStartup || this.#pearlStartup?.ready === true;
  }

  #stopPearls() {
    if (this.#pearlFailed) return;
    this.#pearlFailed = true; this.closing = true;
    clearInterval(this.timer); clearInterval(this.beat); clearInterval(this.worldTimer);
    // No detach or flush inside beforeTick, even when a session-failure callback notified us first.
    // The rejected close remains available to callers; consuming it here prevents an unhandled rejection.
    queueMicrotask(() => { this.close().catch(() => {}); });
  }

  #drainPearls() {
    if (this.closing || this.#pearlFailed || !this.#pearlsReady()) return false;
    this.#drainingPearls = true;
    try {
      // Death and pearl effects share reservations and the same deferred-teardown window.
      this.#assertCombatOwner();
      this.#assertDropOwner();
      this.#assertPearlGroundOwner();
      // A return captures global drop order, events, RNG and allocator. Finish its held operation
      // before any other coordinator can apply, emit or start work at this same boundary.
      if (this.#pearlGround?.pending && !this.#pearlGround.drain(false)) return false;
      this.#combatDeaths?.assertWaiting();
      const deaths = this.#deathStaging?.drain() ?? [];
      if (deaths.some((result) => result.state === 'fenced')) this.#stopPearls();
      if (!this.closing && !this.#pearlFailed) {
        this.#combatDeaths?.advance(deaths);
        if (this.#pearlStaging?.drain().some((result) => result.state === 'fenced')) this.#stopPearls();
        if (!this.closing && this.#deathDrops && !this.#deathDrops.drain(!this.#combatDeaths?.pending)) return false;
        if (!this.closing && this.#pearlGround && !this.#pearlGround.drain(!this.#combatDeaths?.pending)) return false;
      }
      return !this.closing && !this.#pearlFailed;
    } catch {
      this.errors++; this.#combatDeaths?.fail(); this.#deathDrops?.fail(); this.#pearlGround?.fail(); this.#stopPearls(); return false;
    } finally { this.#drainingPearls = false; }
  }

  // Attach to an http.Server: WebSocket upgrades on `path`.
  attach(http, path = '/ws') {
    this.wss = new WebSocketServer({
      server: http, path, maxPayload: LIMITS.maxPayload, clientTracking: false,
      perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 6 }, concurrencyLimit: 4 },
      verifyClient: (info, cb) => {
        if (!this.healthy() || this.economicAuthority?.busy || this.#combatDeaths?.pending || this.#deathDrops?.pending || this.#groundBusy()) return cb(false, 503, 'storage');
        if (this.origins.length && !this.origins.includes(info.origin)) return cb(false, 403, 'origin');
        if (this.sockets.size >= this.maxPlayers + 4) return cb(false, 503, 'busy'); // players + a few spectators
        cb(true);
      },
    });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.wss.on('error', (err) => this.log('[ws] error', err.message));
    this.beat = setInterval(() => this.heartbeat(), LIMITS.heartbeat);
    return this;
  }

  start() {
    if (this.closing || !this.#pearlsReady() || (this.worldState && !this.worldState.ready)) throw new StoreError('world_not_ready');
    if (this.unsavedProfiles.size) throw new StoreError('flush');
    if (this.timer) return this;
    // Drive the server's fixed-step pump ourselves: one bad tick is logged, it never takes the process down.
    this.server.last = performance.now();
    this.timer = setInterval(() => {
      const t0 = performance.now(), tick0 = this.server.world.tick;
      try { this.server.pump(); } catch (err) {
        this.errors++;
        if (this.errors < 20 || this.errors % 100 === 0) this.log('[sim] error', err && err.stack ? err.stack : err);
      }
      const n = this.server.world.tick - tick0;
      if (n > 0) { this.stats.steps += n; this.stats.stepMs += (performance.now() - t0 - this.stats.stepMs) * 0.05; }
    }, 4);
    if (this.worldState) this.worldTimer = setInterval(() => this.worldState.save(this.server.world.economy), this.worldSaveMs);
    return this;
  }

  prepare() {
    if (this.#prepareTask) return this.#prepareTask;
    this.#prepareTask = this.#prepare().catch((err) => {
      if (this.#requiresPearlStartup) this.#stopPearls();
      throw err;
    });
    return this.#prepareTask;
  }

  async #prepare() {
    if (this.closing) throw new StoreError('cancelled');
    if (!this.#pearlsReady() && !this.#pearlStartup) throw new StoreError('configuration');
    // Acquire recovery's global barrier synchronously, before either storage authority awaits.
    // Mapping consumes only its explicit frozen inputs; it must not read a loading World by closure.
    const recovery = this.#pearlStartup?.start();
    let failure = null;
    const observe = (task) => Promise.resolve(task).catch((error) => {
      failure ??= { error };
      // Stop on the first rejection, but still settle both authorities before teardown/flush.
      if (this.#requiresPearlStartup) this.#stopPearls();
      throw error;
    });
    await Promise.allSettled([observe(this.#prepareEconomy()), observe(recovery)]);
    if (failure) throw failure.error;
    if (this.closing) throw new StoreError('cancelled');
    if (!this.#pearlStartup) return;
    // No player or simulation exists yet. Install current ground once before opening transport.
    const result = this.#pearlStartup.drain();
    if (result.state !== 'ready' || !this.#pearlStartup.ready) throw new StoreError('recovery');
  }

  async #prepareEconomy() {
    if (this.worldState) {
      const economy = await this.worldState.open(this.server.world.economy);
      if (this.closing) throw new StoreError('cancelled');
      // Preserve the current authority's callbacks while restoring its economic clock/RNG first.
      economy.payUpkeep = this.server.world.economy.payUpkeep;
      economy.onAdvance = this.server.world.economy.onAdvance;
      this.server.world.economy = economy;
      if (this.economicAuthority) {
        // Missing SQL014 must fail before admitting players, never silently fall back to snapshots.
        await this.store.loadEconomicOperation('00000000-0000-4000-8000-000000000014');
        if (this.communityRequirements !== null) {
          if (this.worldState.community) {
            if (canonicalText(this.communityRequirements) !== canonicalText(this.worldState.community.project.requirements)) throw new StoreError('configuration');
          } else {
            this.worldState.community = newCommunityState(this.worldState.id, this.communityRequirements);
            this.worldState.save(economy); await this.worldState.flush();
          }
        }
      }
    }
  }

  healthy() { return !this.closing && this.#pearlsReady() && !this.unsavedProfiles.size && (!this.worldState || this.worldState.ready); }

  fenceWorld(code) {
    this.log(`[store] world failed: ${code}`);
    if (this.#requiresPearlStartup) { this.#stopPearls(); return; }
    this.closing = true;
    clearInterval(this.timer); clearInterval(this.worldTimer);
    for (const sock of [...this.sockets.values()]) {
      try { sock.ws.close(1011, 'storage'); } catch { /* gone */ }
      this.onClose(sock);
    }
  }

  // Bytes actually written to the sockets (after permessage-deflate), per open socket.
  wireOut() { const out = {}; for (const [id, k] of this.sockets) out[id] = k.ws._socket ? k.ws._socket.bytesWritten : 0; return out; }

  status() {
    const s = this.server;
    return {
      players: s.humans, max: this.maxPlayers, sockets: this.sockets.size, tick: s.world.tick,
      uptime: Math.round((performance.now() - this.started) / 1000), stepMs: +this.stats.stepMs.toFixed(3),
      bots: countBots(s.world), names: playerNames(s), errors: this.errors,
      storage: { kind: this.store.kind, durable: this.store.durable === true, accounts: !!this.resolvePlayer,
        errors: this.profiles.errors + (this.worldState?.errors || 0), unsaved: this.unsavedProfiles.size,
        profileWrites: this.profiles.tasks.size, worldWriting: !!this.worldState?.running,
        economic: this.economicAuthority?.status() ?? null,
        tickBlocked: s.tickBlocked,
        staging: this.#pearlStaging ? { enabled: true, failed: this.#pearlFailed,
          pending: this.#pearlStaging.tasks.size, completed: this.#pearlStaging.completed.length,
          reserved: this.#pearlStaging.operations.size } : null,
        deathStaging: this.#deathStaging ? { enabled: true, failed: this.#pearlFailed,
          pending: this.#deathStaging.tasks.size, completed: this.#deathStaging.completed.length,
          reserved: this.#deathStaging.operations.size } : null,
        deathDrops: this.#deathDrops ? { enabled: true, failed: this.#deathDrops.failed,
          pending: this.#deathDrops.count, reserved: this.#deathDropStaging.operations.size } : null,
        pearlGround: this.#pearlGround ? { enabled: true, failed: this.#pearlGround.failed,
          pending: this.#pearlGround.count, reserved: this.#pearlGround.reserved } : null,
        combatDeaths: this.#combatDeaths ? { enabled: true, failed: this.#combatDeaths.failed,
          pending: this.#combatDeaths.count } : null,
        startup: this.#pearlStartup ? { state: this.#pearlStartup.state, ready: this.#pearlStartup.ready } : null,
        world: this.worldState?.status() ?? null },
      net: { ...s.stats, kbOut: +(this.stats.bytesOut / 1024).toFixed(1), kbIn: +(this.stats.bytesIn / 1024).toFixed(1), dropped: this.stats.dropped },
    };
  }

  onConnection(ws, req) {
    if (!this.healthy() || this.economicAuthority?.busy || this.#combatDeaths?.pending || this.#deathDrops?.pending || this.#groundBusy()) { try { ws.close(1013, 'storage'); } catch { /* gone */ } return; }
    const id = this.nextId++;
    const now = performance.now();
    const sock = {
      // P2's token belongs in HELLO. Retain only non-credential request context for the verifier.
      ws, req: { headers: { origin: req.headers.origin }, socket: { remoteAddress: req.socket.remoteAddress } },
      id, alive: true, strikes: 0, strikeT: now, joining: false,
      bucket: { msgs: LIMITS.msgsBurst, bytes: LIMITS.bytesBurst, t: now },
      out: new LagLink((data) => { if (ws.readyState === 1) ws.send(data); }, this.lag.ms, this.lag.jitter),
      in: new LagLink((msg) => this.receive(sock, msg), this.lag.ms, this.lag.jitter),
    };
    this.sockets.set(id, sock);
    ws.on('pong', () => { sock.alive = true; });
    ws.on('message', (data, isBinary) => this.onMessage(sock, data, isBinary));
    ws.on('close', () => this.onClose(sock));
    ws.on('error', () => {});
    this.server.connect(id);
    const addr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    this.log(`[net] #${id} connected (${addr}) · sockets ${this.sockets.size}`);
  }

  receive(sock, msg) {
    if (this.closing || sock.economicClosing || !this.sockets.has(sock.id)) return;
    this.sweepAgentControl();
    if ([MSG.AGENT_CONTROL, MSG.AGENT_TASK, MSG.AGENT_CANCEL, MSG.AGENT_RELEASE].includes(msg.t)) {
      this.agentMessage(sock, msg); return;
    }
    if (sock.agentIdentity) {
      const state = this.agentControl?.byClient(sock.id);
      if (msg.t === MSG.INPUTS) {
        if (!this.agentInputAllowed(sock.id, msg.control, null)) {
          this.sendTo(sock.id, { t: MSG.AGENT_STATE, ok: false, why: 'control_mismatch', state: state ?? null }); return;
        }
      } else if (msg.t === MSG.CHAT_SEND) {
        if (!state?.grant.capabilities.includes('chat') || !this.agentControl.authorize(sock.id, msg.control?.epoch) ||
            Object.keys(msg.control ?? {}).length !== 1) return;
        const { control, ...chat } = msg; this.server.receive(sock.id, chat); return;
      } else if (![MSG.PING, MSG.HELLO].includes(msg.t)) return;
    }
    if (this.economicAuthority?.handle(sock, msg)) return;
    if (msg.t === MSG.CMD && msg.type === 'community') {
      this.sendTo(sock.id, { t: MSG.EVENT, ev: { type: 'community', to: this.server.clients.get(sock.id)?.entity,
        op: msg.op, opId: msg.opId, ok: false, why: 'disabled', rev: 0, project: null, durable: false } });
      return;
    }
    if (msg.t === MSG.HELLO && this.economicAuthority?.busy) { this.sendTo(sock.id, { t: MSG.ERROR, code: 'storage' }); return; }
    if (msg.t === MSG.HELLO && Object.hasOwn(msg, 'agent') &&
        (msg.agent !== true || !this.agentControl || !this.resolvePlayer)) {
      this.sendTo(sock.id, { t: MSG.ERROR, code: 'auth' }); return;
    }
    if (msg.t === MSG.HELLO && !this.resolvePlayer && Object.hasOwn(msg, 'token')) {
      this.sendTo(sock.id, { t: MSG.ERROR, code: 'auth_disabled' }); return;
    }
    if (msg.t !== MSG.HELLO || !this.resolvePlayer || this.server.clients.get(sock.id)?.entity || msg.v !== PROTOCOL_VERSION) {
      this.server.receive(sock.id, msg); return;
    }
    if (sock.joining) return;
    if (this.server.humans + this.pendingJoins >= this.maxPlayers) {
      this.sendTo(sock.id, { t: MSG.FULL, max: this.maxPlayers }); return;
    }
    sock.joining = true; this.pendingJoins++;
    sock.joinAbort = new AbortController();
    const timer = setTimeout(() => sock.joinAbort.abort(), this.joinTimeoutMs);
    const task = this.join(sock, msg, sock.joinAbort.signal).finally(() => {
      clearTimeout(timer); sock.joining = false; this.pendingJoins--; this.joins.delete(task);
    });
    this.joins.add(task);
  }

  clearAgentInputs(id) {
    const c = this.server.clients.get(id);
    const count = c?.queue.length ?? 0;
    if (c) {
      c.queue.length = 0; c.carry = 0; c.last = null;
      c.starve = c.fillPt = c.lastPt = 0;
      if (c.entity) c.controlNeutral = true;
    }
    return { tick: this.server.world.tick, queueCleared: count, neutralPending: !!c?.controlNeutral, ack: c?.ack ?? 0 };
  }

  publishAgentState(result, requester = null, invalidate = false) {
    const state = result.state ?? null;
    const controller = state && [...this.sockets.values()].find((sock) => sock.agentIdentity === state.grant.scope.characterId &&
      sock.agentSessionId === state.grant.scope.sessionId);
    const receipt = invalidate && controller ? this.clearAgentInputs(controller.id) :
      { tick: this.server.world.tick, queueCleared: 0, neutralPending: false, ack: 0 };
    const message = { t: MSG.AGENT_STATE, ...result, state, receipt };
    if (controller) this.sendTo(controller.id, message);
    if (requester !== null && requester !== controller?.id) this.sendTo(requester, message);
    return message;
  }

  sweepAgentControl() {
    if (!this.agentControl) return;
    for (const state of this.agentControl.sweep()) this.publishAgentState({ ok: true, state }, null, true);
    for (const sock of this.sockets.values()) {
      if (!sock.agentIdentity) continue;
      const c = this.server.clients.get(sock.id), ecs = this.server.world.ecs;
      if (c?.entity && (!ecs.alive[c.entity] || ecs.hp[c.entity] <= 0) && this.agentControl.byClient(sock.id)) {
        const state = this.agentControl.retire(sock.id, 'death');
        this.publishAgentState({ ok: true, state }, null, true);
      }
    }
  }

  agentMessage(sock, msg) {
    const fail = (why) => this.sendTo(sock.id, { t: MSG.AGENT_STATE, ok: false, why, state: null });
    if (!this.agentControl) { fail('disabled'); return; }
    const exact = (keys) => Object.keys(msg).length === keys.length && keys.every((key) => Object.hasOwn(msg, key));
    if (msg.t === MSG.AGENT_CONTROL) {
      const s = this.profiles.clients.get(sock.id), c = this.server.clients.get(sock.id);
      // An account session is the principal; local owner labels and payload owner IDs grant nothing.
      if (sock.agentIdentity || !c?.entity || !s || s.closed || s.failed || this.profiles.accounts.get(s.key) !== s) { fail('forbidden'); return; }
      if (!exact(['direct', 'cancel'].includes(msg.op) ? ['t', 'op', 'characterId', 'task'] : ['t', 'op', 'characterId']) ||
          !['stop', 'revoke', 'resume', 'direct', 'cancel'].includes(msg.op)) { fail('invalid_control'); return; }
      if (msg.op === 'resume') {
        if (!this.agentControl.resume(s.key, msg.characterId)) { fail('forbidden'); return; }
        this.sendTo(sock.id, { t: MSG.AGENT_STATE, ok: true, state: this.agentControl.byCharacter(msg.characterId), resumed: true }); return;
      }
      if (['direct', 'cancel'].includes(msg.op)) {
        const result = msg.op === 'direct' ? this.agentControl.direct(s.key, msg.characterId, msg.task) :
          this.agentControl.cancelOwner(s.key, msg.characterId, msg.task);
        if (!result.ok) { fail(result.why); return; }
        this.publishAgentState(result, sock.id, true); return;
      }
      const state = this.agentControl.revoke(s.key, msg.characterId, msg.op === 'stop' ? 'stop' : 'revoked');
      if (!state) { fail('forbidden'); return; }
      this.publishAgentState({ ok: true, state }, sock.id, true); return;
    }
    if (!sock.agentIdentity) { fail('forbidden'); return; }
    if (msg.t === MSG.AGENT_RELEASE) {
      if (!exact(['t', 'epoch']) || !this.agentControl.authorize(sock.id, msg.epoch)) { fail('control_mismatch'); return; }
      this.publishAgentState({ ok: true, state: this.agentControl.retire(sock.id, 'stop') }, sock.id, true); return;
    }
    const keys = msg.t === MSG.AGENT_TASK ? ['t', 'epoch', 'expectedTaskRevision', 'actionId', 'type', 'args', 'priority'] :
      ['t', 'epoch', 'expectedTaskRevision'];
    if (!exact(keys)) { fail('invalid_task'); return; }
    const { t, ...request } = msg;
    const result = t === MSG.AGENT_TASK ? this.agentControl.task(sock.id, request) : this.agentControl.cancel(sock.id, request);
    this.publishAgentState(result, sock.id, result.ok);
  }

  agentInputAllowed(id, control, cmd, phase = 'input') {
    const sock = this.sockets.get(id);
    if (!sock?.agentIdentity && !this.server.clients.get(id)?.agentManaged) return true;
    if (!sock?.agentIdentity) return false;
    const state = this.agentControl.byClient(id);
    if (phase === 'active') return !!state && this.agentControl.authorize(id, state.grant.controlRevision);
    if (!control || Object.keys(control).length !== 2 || !Object.hasOwn(control, 'epoch') ||
        !Object.hasOwn(control, 'taskRevision') || !Number.isSafeInteger(control.epoch) || control.epoch < 1 ||
        !Number.isSafeInteger(control.taskRevision) || control.taskRevision < 1 ||
        !this.agentControl.authorize(id, control.epoch, control.taskRevision)) return false;
    if (!cmd) return true;
    const caps = state.grant.capabilities, type = state.task.type;
    const moving = ['move', 'go_to', 'follow', 'keep_distance', 'body_pve'].includes(type);
    if ((cmd.mx || cmd.mz) && (!moving || !caps.includes('move'))) return false;
    const attacking = ['attack_pve', 'body_pve'].includes(type) && caps.includes('attack_pve');
    const guarding = type === 'body_pve' && caps.includes('body_pve');
    const aiming = ['aim', 'attack_pve', 'body_pve'].includes(type) && caps.includes('aim');
    const allowed = (aiming ? BTN.AIM : 0) | (attacking ? BTN.ATTACK : 0) |
      (guarding ? BTN.GUARD | (state.task.args.allowPotion ? BTN.POTION : 0) : 0);
    if (cmd.w || ((cmd.btn | cmd.prs) & ~allowed)) return false;
    // This is a server check over live ECS players, independent of the runner's perception/cap.
    if ((cmd.btn | cmd.prs) & BTN.ATTACK) {
      const e = this.server.clients.get(id)?.entity, ecs = this.server.world.ecs;
      if (!e || ecs.weapon[e] !== 0) return false;
      for (let other = 1; other < ecs.cap; other++) if (other !== e && ecs.alive[other] && ecs.kind[other] === 1 &&
          Math.hypot(ecs.x[other] - ecs.x[e], ecs.z[other] - ecs.z[e]) < 8) return false;
    }
    return true;
  }

  async join(sock, msg, signal) {
    try {
      const identity = await untilAbort(Promise.resolve().then(() => this.resolvePlayer(sock.req, msg, { signal })), signal);
      if (!this.sockets.has(sock.id) || signal.aborted) return;
      if (msg.agent === true) {
        const admitted = this.agentControl?.admit(identity, sock.id, 0);
        if (!admitted?.ok) throw new StoreError('auth');
        sock.agentIdentity = identity;
        sock.agentSessionId = admitted.state.grant.scope.sessionId;
        this.server.clients.get(sock.id).agentManaged = true;
      } else if (this.agentControl?.binding(identity)) throw new StoreError('auth');
      // This explicitly mounted recovery pilot has no guest/backfill authority.
      if ((this.#requiresPearlStartup || this.#combatDeaths) && identity === null) throw new StoreError('auth');
      if (this.#requiresPearlStartup && msg.importSave === true) throw new StoreError('legacy');
      let profile;
      if (identity !== null) {
        const initialize = this.initializeAccounts ? (key, fresh) => this.initializeProfile(sock, msg, key, fresh) : null;
        profile = await untilAbort(this.profiles.open(sock.id, identity, msg.weapon === 1 ? 1 : 0, initialize), signal);
      } else if (this.initializeAccounts && msg.save) {
        // A converted legacy character may no longer continue through the guest route.
        const saved = this.server.saves.load(msg.save);
        if (saved?.pirateId) {
          const key = legacyKey(saved);
          await untilAbort(this.withLegacy(sock, key, async () => {
            if (await this.store.legacyClaimed(key)) throw new StoreError('legacy_used');
          }, () => !signal.aborted), signal);
        }
      }
      if (!this.sockets.has(sock.id) || signal.aborted) { this.profiles.close(sock.id); return; }
      if (sock.agentIdentity && !this.agentControl.authorize(sock.id, this.agentControl.byClient(sock.id)?.grant.controlRevision)) throw new StoreError('auth');
      if (this.closing || this.economicAuthority?.busy || this.#combatDeaths?.pending || this.#deathDrops?.pending || this.#groundBusy()) throw new StoreError('busy');
      this.server.receive(sock.id, msg, profile);
      if (!this.server.clients.get(sock.id)?.entity) {
        this.profiles.close(sock.id);
        this.releaseLegacy(sock.id);
        if (sock.agentIdentity) throw new StoreError('auth');
      }
    } catch (err) {
      if (sock.agentIdentity) {
        this.agentControl.retire(sock.id, 'disconnect');
        // A partial spawn must never become a human lane after an admission error.
        // Preserve the managed marker until normal detachment finishes.
        try { sock.ws.close(1008, 'auth'); } catch { /* gone */ }
        this.onClose(sock);
      }
      this.profiles.close(sock.id);
      if (this.sockets.has(sock.id)) {
        const allowed = ['session', 'auth', 'legacy', 'legacy_used', 'legacy_active'];
        const code = err instanceof StoreError && allowed.includes(err.code) ? err.code : 'storage';
        this.sendTo(sock.id, { t: MSG.ERROR, code });
        // Resolver/provider errors may contain tokens: only a fixed code enters the log.
        this.log(`[store] #${sock.id} join failed: ${code}`);
      }
    }
  }

  async initializeProfile(sock, msg, id, fresh) {
    if (msg.importSave !== true) return this.store.initializeProfile(id, fresh);
    const saved = this.server.saves.load(msg.save);
    const key = legacyKey(saved); // Rejects invalid signatures and id-less blobs explicitly.
    return this.withLegacy(sock, key, () => {
      saved.pirateId = `account:${id}`;
      return this.store.initializeProfile(id, saved, key);
    });
  }

  async withLegacy(sock, key, run, keep = false) {
    if (this.legacyReservations.has(key)) throw new StoreError('legacy_active');
    // A fresh guest gets its identity at spawn, before its first signed save exists.
    for (const p of this.server.world.profiles.values()) {
      if (p.pirateId && !p.pirateId.startsWith('account:') && legacyKey(p) === key) throw new StoreError('legacy_active');
    }
    const reservation = { id: sock.id, pending: true };
    this.legacyReservations.set(key, reservation);
    let succeeded = false;
    try { const result = await run(); succeeded = true; return result; }
    finally {
      reservation.pending = false;
      const retain = typeof keep === 'function' ? keep() : keep;
      if ((!succeeded || !retain || !this.sockets.has(sock.id)) && this.legacyReservations.get(key) === reservation) this.legacyReservations.delete(key);
    }
  }

  releaseLegacy(id) {
    for (const [key, r] of this.legacyReservations) if (r.id === id && !r.pending) this.legacyReservations.delete(key);
  }

  profileLanes(id, entity) {
    const c = this.server.clients.get(id), p = this.server.world.profiles.get(entity), s = this.profiles.clients.get(id);
    // The authenticated session owns the account lane. Older stored profiles may still carry a
    // legacy pirateId; this output guard does not adopt/rewrite that gameplay identity.
    if (!c || c.entity !== entity || !p || (c.serverProfile && (!s || s.closed || s.failed))) throw new StoreError('session');
    const uids = new Set(profilePearls(p).map((q) => q.uid));
    for (const [uid, at] of this.server.world.pearlLedger) if (at.entity === entity) uids.add(uid);
    return { accounts: s ? [s.key] : [], uids: [...uids] };
  }

  profileAvailable(id, entity) {
    if (this.#pearlFailed || !this.#pearlsReady() || this.#combatDeaths?.pending || this.#combatDeaths?.failed || this.#deathDrops?.pending || this.#deathDrops?.failed || this.#groundBusy()) return false;
    try {
      pearlMutationGate(this.profiles).assertAvailable(this.profileLanes(id, entity));
      return true;
    } catch (error) {
      // Busy is expected while SQL/receipt/tick apply owns a lane. Invalid authority also denies
      // output; neither outcome may sync the old inventory, clear scheduling or crash the pump.
      if (error instanceof StoreError) return false;
      throw error;
    }
  }

  // Trusted staging may read a reserved account without publishing or writing its old inventory.
  // Explicit mount uses this bridge; the default host does not dispatch durable commands.
  capturePearlProfile(id, entity) {
    if (this.#pearlFailed) throw new StoreError('cancelled');
    this.profileLanes(id, entity);
    const c = this.server.clients.get(id), s = this.profiles.clients.get(id), w = this.server.world;
    if (!c.serverProfile || !s || this.profiles.accounts.get(s.key) !== s ||
        w.ecs.clientId[entity] !== id || w.profiles.get(entity).pirateId !== `account:${s.key}`) {
      throw new StoreError('session');
    }
    return capturePearlProfile(w, entity);
  }

  commandAvailable(id, entity, plan) {
    if (this.closing || this.economicAuthority?.busy || this.economicAuthority?.failed || !this.#pearlsReady() || this.#combatDeaths?.pending || this.#combatDeaths?.failed || this.#deathDrops?.pending || this.#deathDrops?.failed || this.#groundBusy()) return false;
    try {
      const gate = pearlMutationGate(this.profiles), lanes = this.profileLanes(id, entity);
      if (plan.target !== null) {
        // The target is an entity selector, never an account identity. Resolve the current client
        // and authenticated session, including all its inventory/ledger lanes, before transfer.
        const targetId = this.server.clientOf(plan.target);
        if (!this.server.world.ecs.alive[plan.target]) throw new StoreError('session');
        const target = this.profileLanes(targetId, plan.target);
        lanes.accounts.push(...target.accounts); lanes.uids.push(...target.uids);
      }
      gate.assertAvailable(lanes);
      if (plan.world) gate.assertWorldAvailable();
      return true;
    } catch (error) {
      if (error instanceof StoreError) return false;
      throw error;
    }
  }

  tickAvailable() {
    this.sweepAgentControl();
    this.#assertCombatOwner();
    this.#assertDropOwner();
    this.#assertPearlGroundOwner();
    if (this.closing || !this.#pearlsReady() || this.#combatDeaths?.pending || this.#combatDeaths?.failed || this.#deathDrops?.pending || this.#deathDrops?.failed || this.#groundBusy()) return false;
    try {
      const gate = pearlMutationGate(this.profiles);
      // Autonomous effects can mint unknown UIDs and touch any connected owner or shared RNG.
      // The global check also covers reservations for disconnected owners and ground-only items.
      gate.assertWorldAvailable();
      for (const [id, c] of this.server.clients) {
        if (!c.entity) continue;
        if (!this.server.world.ecs.alive[c.entity]) throw new StoreError('session');
        gate.assertAvailable(this.profileLanes(id, c.entity));
      }
      return true;
    } catch (error) {
      if (error instanceof StoreError) return false;
      throw error;
    }
  }

  retainFinalProfile(id, entity, raw = null) {
    const w = this.server.world, p = raw ?? w.profiles.get(entity);
    const s = this.profiles.clients.get(id);
    // syncProfile on a detached profile captures final ECS progress without changing live state.
    const data = p ? syncProfile({ profiles: new Map([[entity, structuredClone(p)]]), ecs: w.ecs, map: w.map }, entity) : null;
    this.unsavedProfiles.set(id, { key: s?.key ?? null, data });
  }

  beforeProfileDetach(id, entity) {
    if (this.#combatDeaths?.invalidate(id, entity)) this.#stopPearls();
    if (this.#deathDrops?.invalidate()) this.#stopPearls();
    if (this.#pearlGround?.invalidate()) this.#stopPearls();
    const gate = pearlMutationGate(this.profiles), s = this.profiles.clients.get(id);
    // Account invalidation is independent of malformed UID metadata: pending effects must not
    // survive close -> entity recycle even when the final profile cannot be validated.
    if (s) gate.invalidate({ accounts: [s.key] });
    try { gate.invalidate(this.profileLanes(id, entity)); }
    catch (error) { if (!(error instanceof StoreError)) throw error; }
    if (this.profileAvailable(id, entity)) return true;
    this.retainFinalProfile(id, entity);
    return false;
  }

  saveProfile(id, p) {
    if (this.#combatDeaths?.pending || this.#combatDeaths?.failed || this.#deathDrops?.pending || this.#deathDrops?.failed || this.#groundBusy()) return false;
    const s = this.profiles.clients.get(id);
    if (!s) return true; // Guests keep their existing signed-save route.
    try {
      pearlMutationGate(this.profiles).assertAvailable({ accounts: [s.key], uids: profilePearls(p).map((q) => q.uid) });
      this.profiles.save(id, p);
      if (!s.failed && !s.closed) return true;
    } catch (error) { if (!(error instanceof StoreError)) throw error; }
    // This also protects the final onSave callback after the profile was detached. Never silently
    // acknowledge that final snapshot or retry its old UID inventory across a committed receipt.
    if (!this.server.world.profiles.has(this.server.clients.get(id)?.entity)) {
      this.retainFinalProfile(id, this.server.clients.get(id)?.entity, p);
    }
    return false;
  }

  onMessage(sock, data, isBinary) {
    const now = performance.now(), b = sock.bucket, len = data.length || data.byteLength || 0;
    const el = (now - b.t) / 1000;
    b.t = now;
    b.msgs = Math.min(LIMITS.msgsBurst, b.msgs + el * LIMITS.msgsPerSec) - 1;
    b.bytes = Math.min(LIMITS.bytesBurst, b.bytes + el * LIMITS.bytesPerSec) - len;
    this.stats.bytesIn += len; this.stats.msgsIn++;
    if (b.msgs < 0 || b.bytes < 0) { this.stats.dropped++; return; } // over budget: dropped (the sim fills gaps)
    let msg = null;
    if (!isBinary) { try { msg = JSON.parse(data.toString()); } catch { msg = null; } }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') { this.strike(sock, now); return; }
    if (msg.t === MSG.INPUTS && Array.isArray(msg.cmds) && msg.cmds.length > LIMITS.maxCmds) msg.cmds = msg.cmds.slice(-LIMITS.maxCmds);
    sock.in.push(msg);
  }

  strike(sock, now) {
    if (now - sock.strikeT > 1000) { sock.strikeT = now; sock.strikes = 0; }
    if (++sock.strikes >= LIMITS.strikes) { this.log(`[net] #${sock.id} closed: malformed messages`); sock.ws.close(1008, 'malformed'); }
  }

  onClose(sock, force = false) {
    if (!this.sockets.has(sock.id)) return;
    if (!force && this.economicAuthority?.busy && !this.economicAuthority.failed) {
      // Keep the exact actor/profile alive until a confirmed operation is applied or fenced.
      sock.economicClosing = true; sock.in.close(); sock.out.close();
      this.economicAuthority.deferredCloses.add(sock); return;
    }
    this.sockets.delete(sock.id);
    if (sock.agentIdentity) this.agentControl?.retire(sock.id, 'disconnect');
    sock.joinAbort?.abort();
    sock.in.close(); sock.out.close();
    this.server.disconnect(sock.id);
    this.profiles.close(sock.id);
    this.releaseLegacy(sock.id);
    this.log(`[net] #${sock.id} left · players ${this.server.humans} · sockets ${this.sockets.size}`);
    // A denied final snapshot has no safe automatic merge with a durable receipt. Stop this host
    // after detachment rather than admitting a new authority around the retained recovery evidence.
    if (this.unsavedProfiles.has(sock.id) && !this.closing) this.fenceWorld('profile_unflushed');
  }

  sendTo(id, msg) {
    const sock = this.sockets.get(id);
    if (!sock) return;
    if (msg.t === MSG.WELCOME && sock.agentIdentity) msg = { ...msg, control: this.agentControl.byClient(id) };
    // A broadcast hands every client the same object: serialize it once.
    let data;
    if (msg === this.lastMsg) data = this.lastData;
    else { data = JSON.stringify(msg); this.lastMsg = msg; this.lastData = data; }
    this.stats.bytesOut += data.length; this.stats.msgsOut++;
    sock.out.push(data);
  }

  heartbeat() {
    for (const sock of this.sockets.values()) {
      if (!sock.alive) { sock.ws.terminate(); this.onClose(sock); continue; }
      sock.alive = false;
      try { sock.ws.ping(); } catch { /* closing */ }
    }
  }

  // Close everyone politely (deploys, Ctrl+C).
  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    clearInterval(this.timer); clearInterval(this.beat); clearInterval(this.worldTimer);
    if (this.#pearlStartup && !['idle', 'ready', 'fenced'].includes(this.#pearlStartup.state)) this.#pearlStartup.cancel();
    this.worldState?.cancelLoad();
    if (this.#deathDrops?.pending) this.#deathDrops.fail();
    if (this.#pearlGround?.pending) this.#pearlGround.fail();
    for (const sock of [...this.sockets.values()]) { try { sock.ws.close(1001, 'server restart'); } catch { /* gone */ } this.onClose(sock); }
    if (this.wss) this.wss.close();
    this.worldState?.save(this.server.world.economy);
    this.closePromise = (async () => {
      if (this.economicAuthority) {
        await this.economicAuthority.settle();
        if (!this.economicAuthority.failed) this.economicAuthority.drain();
        this.economicAuthority.closeDeferred();
        this.worldState?.save(this.server.world.economy);
      }
      await Promise.all([...this.joins]);
      // Cancelled reads may reconcile receipts, but never install ground or admit after close.
      if (this.#prepareTask) await this.#prepareTask.catch(() => {});
      // Storage continuations may finish after close invalidated and detached their actor. Wait for
      // them, but never drain/apply from shutdown or release an unresolved staging reservation.
      await Promise.all([this.#pearlStaging?.settle(), this.#deathStaging?.settle(), this.#deathDropStaging?.settle(), this.#pearlGround?.settle()]);
      // Drain both authorities even if one reports failure; never abandon an in-flight profile write.
      const results = await Promise.allSettled([this.profiles.flush(), this.worldState?.flush()]);
      if (results.some((r) => r.status === 'rejected') || this.unsavedProfiles.size || this.economicAuthority?.failed ||
          this.#pearlFailed || !this.#pearlsReady() || this.#pearlStaging?.operations.size || this.#deathStaging?.operations.size ||
          this.#combatDeaths?.pending || this.#combatDeaths?.failed || this.#deathDrops?.pending || this.#deathDrops?.failed || this.#deathDropStaging?.operations.size ||
          this.#groundBusy() || this.#pearlGround?.reserved) throw new StoreError('flush');
    })();
    return this.closePromise;
  }
}

function untilAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(new StoreError('cancelled'));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new StoreError('cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function countBots(world) {
  const ecs = world.ecs;
  let n = 0;
  for (let e = 1; e < ecs.cap; e++) if (ecs.alive[e] && (ecs.mask[e] & C.BOT)) n++;
  return n;
}

function playerNames(server) {
  const out = [], ecs = server.world.ecs;
  for (const c of server.clients.values()) if (c.entity && ecs.alive[c.entity]) out.push(String(ecs.names[c.entity]));
  return out;
}

export { LIMITS };
