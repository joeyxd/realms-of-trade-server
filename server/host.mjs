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
import { profilePearls } from './pearlOperations.mjs';
import { syncProfile } from '../src/sim/systems/inventory.js';

const LIMITS = {
  msgsPerSec: 120, msgsBurst: 240,   // a client flushes inputs once per frame (≤ 60/s) plus pings
  bytesPerSec: 48 * 1024, bytesBurst: 96 * 1024,
  maxPayload: 64 * 1024,
  maxCmds: 32,                       // commands per inputs message
  strikes: 5,                        // malformed messages per second before the socket is closed
  heartbeat: 15000,                  // ms between pings; a socket that missed one is dropped
};

export class GameHost {
  constructor({ seed, bots = 3, maxPlayers = 4, dev = false, lagMs = 0, jitterMs = 0, origins = [], log = console.log, saves,
    store = createMemoryStore(), resolvePlayer = null, joinTimeoutMs = 15000, initializeAccounts = false,
    worldId = null, worldSaveMs = 60000 } = {}) {
    if (resolvePlayer !== null && typeof resolvePlayer !== 'function') throw new StoreError('configuration');
    if (!Number.isFinite(joinTimeoutMs) || joinTimeoutMs <= 0 || joinTimeoutMs > 60000) throw new StoreError('configuration');
    if (initializeAccounts && (!resolvePlayer || !saves || typeof store.initializeProfile !== 'function' || typeof store.legacyClaimed !== 'function')) throw new StoreError('configuration');
    if (!Number.isFinite(worldSaveMs) || worldSaveMs <= 0 || worldSaveMs > 2147483647) throw new StoreError('configuration');
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
      const sock = this.sockets.get(id);
      if (sock) { try { sock.ws.close(1011, 'storage'); } catch { /* gone */ } this.onClose(sock); }
    });
    // A blocked final snapshot is evidence of an incomplete shutdown, never a retryable save blob.
    // Keep its detached data private for explicit reconciliation; it may contain pre-commit UIDs.
    this.unsavedProfiles = new Map();
    this.stats = { bytesOut: 0, bytesIn: 0, msgsOut: 0, msgsIn: 0, dropped: 0, stepMs: 0, steps: 0 };
    this.server = new LocalServer({
      seed, bots, dev, debug: dev, maxPlayers, pausable: false, fill: true, ...(saves ? { saves } : {}),
      send: (id, msg) => this.sendTo(id, msg),
      profileAccess: (id, entity) => this.profileAvailable(id, entity),
      beforeDetach: (id, entity) => this.beforeProfileDetach(id, entity),
      onSave: (id, p) => this.saveProfile(id, p),
    });
    this.worldSaveMs = worldSaveMs;
    this.worldState = worldId === null ? null : new WorldState(store, { id: worldId, seed: this.server.world.seed,
      onFailure: (code) => this.fenceWorld(code) });
    this.started = performance.now();
  }

  // Attach to an http.Server: WebSocket upgrades on `path`.
  attach(http, path = '/ws') {
    this.wss = new WebSocketServer({
      server: http, path, maxPayload: LIMITS.maxPayload, clientTracking: false,
      perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 6 }, concurrencyLimit: 4 },
      verifyClient: (info, cb) => {
        if (this.closing) return cb(false, 503, 'closing');
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
    if (this.closing || (this.worldState && !this.worldState.ready)) throw new StoreError('world_not_ready');
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

  async prepare() {
    if (!this.worldState) return;
    const economy = await this.worldState.open(this.server.world.economy);
    if (this.closing) throw new StoreError('cancelled');
    // The database stores plain state; keep the server's owner-profile and production callbacks attached.
    economy.payUpkeep = this.server.world.economy.payUpkeep;
    economy.onAdvance = this.server.world.economy.onAdvance;
    this.server.world.economy = economy;
  }

  healthy() { return !this.closing && !this.unsavedProfiles.size && (!this.worldState || this.worldState.ready); }

  fenceWorld(code) {
    this.log(`[store] world failed: ${code}`);
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
        world: this.worldState?.status() ?? null },
      net: { ...s.stats, kbOut: +(this.stats.bytesOut / 1024).toFixed(1), kbIn: +(this.stats.bytesIn / 1024).toFixed(1), dropped: this.stats.dropped },
    };
  }

  onConnection(ws, req) {
    if (!this.healthy()) { try { ws.close(1013, 'storage'); } catch { /* gone */ } return; }
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
    if (this.closing || !this.sockets.has(sock.id)) return;
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

  async join(sock, msg, signal) {
    try {
      const identity = await untilAbort(Promise.resolve().then(() => this.resolvePlayer(sock.req, msg, { signal })), signal);
      if (!this.sockets.has(sock.id) || signal.aborted) return;
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
      this.server.receive(sock.id, msg, profile);
      if (!this.server.clients.get(sock.id)?.entity) {
        this.profiles.close(sock.id);
        this.releaseLegacy(sock.id);
      }
    } catch (err) {
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

  retainFinalProfile(id, entity, raw = null) {
    const w = this.server.world, p = raw ?? w.profiles.get(entity);
    const s = this.profiles.clients.get(id);
    // syncProfile on a detached profile captures final ECS progress without changing live state.
    const data = p ? syncProfile({ profiles: new Map([[entity, structuredClone(p)]]), ecs: w.ecs, map: w.map }, entity) : null;
    this.unsavedProfiles.set(id, { key: s?.key ?? null, data });
  }

  beforeProfileDetach(id, entity) {
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

  onClose(sock) {
    if (!this.sockets.has(sock.id)) return;
    this.sockets.delete(sock.id);
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
    this.worldState?.cancelLoad();
    for (const sock of [...this.sockets.values()]) { try { sock.ws.close(1001, 'server restart'); } catch { /* gone */ } this.onClose(sock); }
    if (this.wss) this.wss.close();
    this.worldState?.save(this.server.world.economy);
    this.closePromise = (async () => {
      await Promise.all([...this.joins]);
      // Drain both authorities even if one reports failure; never abandon an in-flight profile write.
      const results = await Promise.allSettled([this.profiles.flush(), this.worldState?.flush()]);
      if (results.some((r) => r.status === 'rejected') || this.unsavedProfiles.size) throw new StoreError('flush');
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
