// Safe-port presence owns the body, independently of controller grants and provider work.
import { randomUUID } from 'node:crypto';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { attachProfile, detachProfile } from '../src/sim/systems/inventory.js';
import { presenceAnchor, presencePointAllowed, presenceSafety, advancePresence } from './companionPresencePolicy.mjs';

const REQUEST = /^[A-Za-z0-9:_-]{1,100}$/;
const OPS = ['load', 'join', 'follow', 'wait', 'return', 'retire'];
// L03g-b: an attached mind may read its body and give the safe orders; join and retire stay with the owner.
const MIND_OPS = ['load', 'follow', 'wait', 'return'];
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
// Companions belong to the account; a human session's key is its selected character.
const sessionOwner = session => session.ownerKey ?? session.key;

export class CompanionPresenceService {
  constructor(host, { enabled = false, allowMemory = false, timeoutMs = 8000 } = {}) {
    Object.assign(this, { host, enabled, allowMemory, timeoutMs });
    this.ready = false; this.entries = new Map(); this.busy = new Map();
    this.pendingSlots = 0; this.tasks = new Set(); this.rates = new Map(); this.detaching = new Map();
    this.minds = new Map(); // body client id -> the paired socket attached to that body (L03g-b)
  }
  async prepare() {
    const h = this.host;
    if (!h.companionPairing.ready || (!h.store.durable && !this.allowMemory)) return;
    let timer;
    try {
      this.gateReady = (await Promise.race([Promise.resolve().then(() => h.store.checkCompanionPresence()),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); })]))?.version === 1;
    } catch { /* Older hosts have no gate; timeout never installs a late readiness. */ }
    finally { clearTimeout(timer); }
    this.ready = this.enabled && this.gateReady === true;
  }
  principal(sock) { return sock ? this.host.companionConfig.principal(sock) : null; }
  hasClient(id) { return this.detaching.has(id) || [...this.entries.values()].some(e => e.body?.id === id); }
  profileFailure(id) {
    let snapshot = this.detaching.get(id);
    const e = [...this.entries.values()].find(e => e.body?.id === id);
    if (!snapshot) {
      if (!e) return false;
      snapshot = { key: e.record.characterKey, data: structuredClone(this.host.server.world.profiles.get(e.body.entity)) };
    }
    this.host.unsavedProfiles.set(id, structuredClone(snapshot));
    // A failed body write ends its pairing before the world fence closes everyone else.
    if (e) this.revokePairing(e, 'profile');
    this.host.fenceWorld('companion_profile'); return true;
  }
  trackDetach(e) {
    this.detaching.set(e.body.id, { key: e.record.characterKey,
      data: structuredClone(this.host.server.world.profiles.get(e.body.entity)) });
  }
  scope(e) { return { world: this.host.worldState.id, owner: e.owner, character: e.record.characterKey }; }
  fencedCharacter(character) {
    return [...this.entries.values()].some(e => e.record.characterKey === character && (e.body || e.head.active || e.operation || e.unavailable));
  }
  async pairingBlocked(owner, character) {
    // L03g-b: with presence on, a pairing code only ever authorises a mind for the owner's live body.
    if (this.enabled) return this.liveBody(owner, character) ? false : 'presence_body_required';
    if (this.fencedCharacter(character)) return true;
    if (!this.gateReady) return this.enabled; // Enabling presence without SQL cannot bypass its gate.
    try {
      const head = await this.host.store.loadCompanionPresence({ world: this.host.worldState.id, owner, character });
      return head.active || this.fencedCharacter(character);
    } catch { return true; }
  }
  paired(owner, character) {
    const p = this.host.companionPairing;
    return p.busy.size > 0 || [...p.codes.values(), ...p.tokens.values(), ...p.admitted.values()]
      .some(e => e.ownerId === owner || e.characterId === character) ||
      // A revoked socket stays in host.sockets until its close completes, but it no longer pairs the character.
      [...this.host.sockets.values()].some(s => s.agentIdentity === character && !s.pairingRevoked);
  }
  // A present body that is not mid-join, mid-retire, failed or about to auto-retire.
  liveBody(owner, character) {
    const e = this.entries.get(owner);
    return this.ready && !this.host.closing && !!e?.body && e.record.characterKey === character && !e.operation &&
      !e.unavailable && !this.busy.has(owner) && !this.detaching.has(e.body.id) ? e : null;
  }
  // A mind counts while its socket is open and its pairing admission and control epoch are current.
  mindLive(e) {
    const h = this.host, sock = e?.mind?.sock;
    return !!sock && h.sockets.get(sock.id) === sock && sock.ws.readyState === 1 &&
      h.companionPairing.admitted.has(sock.id) && h.agentControl.authorize(sock.id, e.mind.epoch);
  }
  mindCount() { return [...this.entries.values()].filter(e => this.mindLive(e)).length; }
  attachable(owner, character) {
    const e = this.liveBody(owner, character);
    return !!e && !this.mindLive(e);
  }
  // L03g-b: bind a paired socket to the owner's live body. No entity, profile or slot is created and
  // nothing about the body changes; from now on the socket perceives, hears and speaks as that body.
  attach(sock, owner, character, epoch) {
    const h = this.host, w = h.server.world, e = this.liveBody(owner, character);
    if (!e) return 'unavailable';
    if (this.mindLive(e)) return 'occupied';
    this.release(e); // A revoked or closing mind never blocks its replacement.
    const body = e.body;
    // Leave the spectator lane: the body's own stream replaces it, so nothing arrives twice.
    h.server.disconnect(sock.id);
    e.mind = { sock, epoch }; this.minds.set(body.id, sock);
    sock.companionMind = { owner, body: body.id, entity: body.entity };
    h.sendTo(body.id, { t: MSG.SPAWN, e: w.describe(body.entity) });
    h.sendTo(body.id, { t: MSG.WELCOME, v: PROTOCOL_VERSION, you: body.entity, tick: w.tick, seed: w.seed });
    h.server.chat.join(body.id); // The body speaks and listens through an ordinary chat session.
    return null;
  }
  release(e) {
    const m = e?.mind;
    if (!m) return false;
    e.mind = null; m.sock.companionMind = null;
    for (const [id, sock] of this.minds) if (sock === m.sock) this.minds.delete(id);
    // Only the chat session ends with the mind: order, position, health and profile stay as they are.
    if (e.body) this.host.server.chat.leave(e.body.id);
    return true;
  }
  // Retirement, failures and shutdown end the owner's pairing: codes and tokens drop, the mind closes (1008).
  revokePairing(e, why) {
    this.release(e);
    this.host.companionPairing.revokeOwner(e.owner, why);
  }
  revokeMinds(why) { for (const e of this.entries.values()) if (e.mind) this.revokePairing(e, why); }
  // The epoch captured at attach must still authorise this socket; revocation or replacement ends it.
  mindCurrent(sock) {
    const m = sock?.companionMind, e = m && this.entries.get(m.owner);
    return !!e && e.mind?.sock === sock && e.body?.id === m.body && this.mindLive(e) &&
      this.host.companionPairing.admissionCurrent(sock);
  }
  projection(e) {
    if (!e) return null;
    return { characterKey: e.record.characterKey, name: e.record.preset.name,
      status: e.unavailable ? 'unavailable' : e.body ? 'present' : e.head.active ? 'recovery' : 'resting',
      order: e.order, revision: e.revision, entity: e.body?.entity ?? null, reason: e.reason };
  }
  handle(sock, message) {
    if (message?.t !== MSG.AGENT_COMPANION_PRESENCE) return false;
    void this.dispatch(sock, message); return true;
  }
  rate(owner) {
    const now = Date.now();
    for (const [id, row] of this.rates) if (now - row.at >= 60000) this.rates.delete(id);
    const row = this.rates.get(owner);
    if ((!row && this.rates.size >= 64) || row?.count >= 60) return false;
    this.rates.set(owner, { at: row?.at ?? now, count: (row?.count ?? 0) + 1 }); return true;
  }
  async dispatch(sock, message) {
    // An attached mind (L03g-b) acts for the owner of its body, never through the owner's session.
    const h = this.host, mind = sock?.companionMind ?? null, session = mind ? null : this.principal(sock);
    const owner = mind ? mind.owner : session ? sessionOwner(session) : undefined;
    const requestId = typeof message.requestId === 'string' && REQUEST.test(message.requestId) ? message.requestId : null;
    const reply = why => {
      if (h.sockets.get(sock.id) !== sock || sock.ws.readyState !== 1 || (session && this.principal(sock) !== session)) return;
      h.sendTo(sock.id, { t: MSG.AGENT_COMPANION_PRESENCE_RESULT, requestId, ok: why === null, why,
        enabled: this.ready, presence: session || mind ? this.projection(this.entries.get(owner)) : null });
    };
    if (!session && !mind) return reply('forbidden');
    const keys = message.op === 'load' ? ['t', 'requestId', 'op'] : ['t', 'requestId', 'op', 'expectedRevision'];
    if (!requestId || !OPS.includes(message.op) || !exact(message, keys) ||
        (message.op !== 'load' && (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0))) return reply('invalid_request');
    if (!this.ready) return reply('unavailable');
    if (mind && (!MIND_OPS.includes(message.op) || !this.mindCurrent(sock))) return reply('forbidden');
    if (this.busy.has(owner) || this.busy.size >= 8 || !this.rate(owner)) return reply('busy');
    let abandoned = false, timer;
    const current = () => !abandoned && !h.closing && (mind ? this.mindCurrent(sock) : this.principal(sock) === session);
    const operation = Promise.resolve().then(async () => {
      let e = this.entries.get(owner);
      if (mind) {
        // Recheck the control epoch at execution: a revoked or replaced mind changes nothing.
        if (!current() || e?.mind?.sock !== sock || e.body?.id !== mind.body) return 'forbidden';
      } else if (!e) {
        const owned = await h.companionPairing.loadOwned(session, sock, current);
        if (!current()) return 'forbidden';
        if (!owned) return 'no_companion';
        const head = await h.store.loadCompanionPresence({ world: h.worldState.id, owner, character: owned.record.characterKey });
        if (!current()) return 'forbidden';
        e = { owner, record: owned.record, head, revision: head.revision, order: 'wait', body: null,
          reason: head.active ? 'recovery_required' : null, ownerSock: sock, ownerSession: session, operation: false };
        this.entries.set(owner, e);
      }
      if (!mind) { e.ownerSock = sock; e.ownerSession = session; }
      if (message.op === 'load') return e.unavailable ? 'unavailable' : null;
      if (e.revision !== message.expectedRevision) return 'conflict';
      if (e.unavailable) return 'unavailable';
      if (!e.body && e.head.active) return 'recovery_required';
      if (message.op === 'join') return this.join(e, session, current);
      if (!e.body) return 'no_companion';
      if (message.op === 'retire') return this.retire(e, current);
      // A mind's "follow" still means its owner; it can never name another target.
      const ownerSock = mind ? e.ownerSock : sock, world = h.server.world;
      const ownerEntity = ownerSock && (!mind || this.principal(ownerSock) === e.ownerSession) ? h.server.clients.get(ownerSock.id)?.entity : undefined;
      if (message.op === 'wait') {
        e.order = 'wait'; e.stagnant = 0; e.revision++;
        e.reason = presenceSafety(world, e.body.entity); return null;
      }
      const why = presenceSafety(world, e.body.entity) || presenceSafety(world, ownerEntity);
      if (why) return why;
      e.order = message.op; e.reason = null; e.stagnant = 0; e.revision++;
      return null;
    });
    this.busy.set(owner, operation); this.tasks.add(operation);
    operation.finally(() => { if (this.busy.get(owner) === operation) this.busy.delete(owner); this.tasks.delete(operation); }).catch(() => {});
    try {
      const why = await Promise.race([operation, new Promise(resolve => { timer = setTimeout(() => { abandoned = true; resolve('unavailable'); }, this.timeoutMs); })]);
      reply(why);
    } catch { reply('unavailable'); }
    finally { clearTimeout(timer); }
  }
  available() {
    const h = this.host;
    return !h.closing && h.healthy() && !h.contentSwitching && !h.pendingJoins && !h.economicAuthority?.busy &&
      !h.server.tickBlocked && !h.profiles.tasks.size;
  }
  async join(e, session, current) {
    const h = this.host, w = h.server.world;
    if (e.body) return 'conflict';
    if (!this.available()) return 'busy';
    if (this.paired(e.owner, e.record.characterKey)) return 'paired';
    const ownerEntity = h.server.clients.get(e.ownerSock.id)?.entity;
    let why = presenceSafety(w, ownerEntity, { anchor: true, fullHealth: true });
    if (why) return why;
    const anchor = presenceAnchor(w);
    if (!anchor || !presencePointAllowed(w, anchor.x, anchor.z)) return 'outside_zone';
    if (h.server.humans + h.pendingJoins + this.pendingSlots >= h.maxPlayers) return 'full';
    this.pendingSlots++; e.operation = true;
    const id = h.nextId++, runId = randomUUID(); let opened = false, candidate = null;
    try {
      const profile = await h.profiles.open(id, e.record.characterKey);
      opened = true;
      // A pre-existing controller profile cannot transport a different checkpoint into this port.
      if (profile.cp !== 'spawn') return 'outside_anchor';
      if (!current() || !this.available() || this.paired(e.owner, e.record.characterKey)) return 'busy';
      why = presenceSafety(w, ownerEntity, { anchor: true, fullHealth: true });
      if (why) return why;
      if (h.server.humans + h.pendingJoins >= h.maxPlayers) return 'full';
      const result = await h.store.saveCompanionPresence({ ...this.scope(e), expectedRevision: e.head.revision, active: true, runId });
      if (result.ok !== true) { e.head = result.head; e.revision++; return 'conflict'; }
      e.head = result.head; e.revision++;
      // An abandoned or uncertain admission is never compensated by clearing its durable gate.
      if (!current() || !this.available() || this.paired(e.owner, e.record.characterKey)) return 'busy';
      why = presenceSafety(w, ownerEntity, { anchor: true, fullHealth: true });
      if (why) return why;
      if (!presencePointAllowed(w, anchor.x, anchor.z) || h.server.humans + h.pendingJoins >= h.maxPlayers) return 'busy';
      h.server.connect(id);
      const c = h.server.clients.get(id);
      c.companionResident = true; c.serverProfile = true;
      c.entity = w.spawnPlayer({ name: h.server.uniqueName(`${e.record.preset.name.slice(0, 11)} [IA]`),
        skin: e.record.preset.skin, level: profile.lvl, clientId: id, x: anchor.x, z: anchor.z });
      candidate = c.entity;
      (w.residentPlayers ??= new Set()).add(c.entity);
      profile.pirateId ||= `account:${e.record.characterKey}`;
      attachProfile(w, c.entity, profile);
      w.profileDirty.delete(c.entity);
      e.body = { id, entity: c.entity }; e.order = 'wait'; e.reason = null; e.stagnant = 0;
      if (!h.saveProfile(id, profile)) throw new Error('profile');
      h.server.flushEvents();
      candidate = null;
      return null;
    } catch {
      if (candidate !== null) {
        // A failed unpublished attachment cannot leave a partial profile, entity, or recycled marker.
        detachProfile(w, candidate, { sync: false }); w.despawn(candidate);
        for (let i = w.events.length - 1; i >= 0; i--) {
          const event = w.events[i];
          if (event.id === candidate || event.to === candidate || event.e === candidate) w.events.splice(i, 1);
        }
        h.server.clients.delete(id); e.body = null;
      }
      e.unavailable = true; e.reason = 'unavailable'; e.revision++;
      return 'unavailable';
    } finally {
      if (opened && !e.body) h.profiles.close(id);
      this.pendingSlots--; e.operation = false;
    }
  }
  async retire(e, current = () => !this.host.closing) {
    const h = this.host, w = h.server.world, body = e.body;
    if (!body) return 'no_companion';
    if (!this.available()) return 'busy';
    const owner = e.ownerSock && this.principal(e.ownerSock) === e.ownerSession && h.server.clients.get(e.ownerSock.id)?.entity;
    const why = presenceSafety(w, body.entity, { anchor: true, fullHealth: true }) ||
      (owner ? presenceSafety(w, owner, { anchor: true, fullHealth: true }) : null);
    if (why) return why;
    e.operation = true;
    try {
      // Freeze the body while its ordinary profile authority settles. No second profile writer.
      if (!h.saveProfile(body.id, w.profiles.get(body.entity))) return 'busy';
      await h.profiles.flush();
      if (!current() || !this.available()) return 'busy';
      const latest = presenceSafety(w, body.entity, { anchor: true, fullHealth: true }) ||
        (owner ? presenceSafety(w, owner, { anchor: true, fullHealth: true }) : null);
      if (latest) return latest;
      // Detach synchronously before releasing the gate. A failed release leaves recovery required.
      this.trackDetach(e);
      this.revokePairing(e, 'retired');
      h.server.disconnect(body.id); h.profiles.close(body.id); e.body = null; e.order = 'wait'; e.revision++;
      await h.profiles.flush();
      this.detaching.delete(body.id);
      const result = await h.store.saveCompanionPresence({ ...this.scope(e), expectedRevision: e.head.revision,
        active: false, runId: e.head.runId });
      if (result.ok !== true) { e.head = result.head; e.reason = 'recovery_required'; return 'conflict'; }
      e.head = result.head; e.reason = null; return null;
    } catch { e.unavailable = true; e.reason = 'unavailable'; this.revokePairing(e, 'unavailable'); return 'unavailable'; }
    finally { e.operation = false; }
  }
  step() {
    if (!this.ready) return;
    const h = this.host, w = h.server.world;
    for (const e of this.entries.values()) {
      if (!e.body || e.operation || e.unavailable) continue;
      const entity = e.body.entity, ecs = w.ecs;
      let reason = presenceSafety(w, entity);
      const owner = e.ownerSock && this.principal(e.ownerSock) === e.ownerSession && h.server.clients.get(e.ownerSock.id)?.entity;
      if (!owner && e.order !== 'return') { e.order = 'return'; e.revision++; }
      if (!reason && e.order === 'follow') reason = presenceSafety(w, owner);
      if (reason) {
        if (e.reason !== reason) { e.reason = reason; e.revision++; }
        ecs.moveMag[entity] = 0; continue;
      }
      if (e.reason && e.reason !== 'blocked') { e.reason = null; e.revision++; }
      if (e.order === 'wait') { ecs.moveMag[entity] = 0; continue; }
      const target = e.order === 'return' ? presenceAnchor(w) : { x: ecs.x[owner], z: ecs.z[owner] };
      const distance = Math.hypot(target.x - ecs.x[entity], target.z - ecs.z[entity]);
      if (distance <= (e.order === 'return' ? 0.8 : 2)) {
        ecs.moveMag[entity] = 0; e.stagnant = 0;
        if (e.order === 'return') {
          e.order = 'wait'; e.reason = null; e.revision++;
          if (!owner) this.autoRetire(e);
        }
        continue;
      }
      const result = advancePresence(w, entity, target);
      e.stagnant = result.moved > 0.001 ? 0 : (e.stagnant ?? 0) + 1;
      if (result.reason || e.stagnant >= 180) { e.reason = result.reason ?? 'blocked'; e.order = 'wait'; e.revision++; }
    }
  }
  autoRetire(e) {
    if (this.busy.has(e.owner)) return;
    const task = Promise.resolve().then(() => this.retire(e));
    this.tasks.add(task); this.busy.set(e.owner, task);
    task.finally(() => { this.tasks.delete(task); if (this.busy.get(e.owner) === task) this.busy.delete(e.owner); }).catch(() => {});
  }
  onClose(sock) {
    for (const e of this.entries.values()) {
      // A closing mind leaves its body exactly as it is, with its current order.
      if (e.mind?.sock === sock) this.release(e);
      if (e.ownerSock === sock && e.body) {
        e.ownerSock = null; e.ownerSession = null; e.order = 'return'; e.reason = null; e.revision++;
      }
    }
  }
  async close() {
    await Promise.allSettled([...this.tasks]);
    // Shutdown never declares an unsafe body resting. Active gates survive for explicit recovery.
    for (const e of this.entries.values()) if (e.body) {
      const safe = !e.unavailable && this.host.profileAvailable(e.body.id, e.body.entity) &&
        presenceSafety(this.host.server.world, e.body.entity, { anchor: true, fullHealth: true }) === null;
      const id = e.body.id;
      this.trackDetach(e);
      this.revokePairing(e, 'server_close');
      this.host.server.disconnect(id); this.host.profiles.close(id); e.body = null;
      if (safe) {
        try {
          await this.host.profiles.flush();
          this.detaching.delete(id);
          const result = await this.host.store.saveCompanionPresence({ ...this.scope(e), expectedRevision: e.head.revision,
            active: false, runId: e.head.runId });
          if (result.ok === true) e.head = result.head;
        } catch { /* Active gate remains recovery evidence. */ }
      }
    }
  }
}
