// Client-side netcode: local-player prediction + reconciliation, remote entity interpolation, and the
// client's copy of the projectiles. The renderer only ever reads from here; it never decides gameplay.
//
// Projectile time (pt): every command carries the projectile tick the client is showing. Hostile
// projectiles are analytic (sim/projectiles.js), so the client draws them at pt and the server
// evaluates that command's parries, destroys, hits and grazes at the same pt: what you see is what is
// judged. pt advances one tick per command and drifts back toward the server clock gently.
// Prediction runs the same combat code on the projectiles the client knows; kills it predicts are
// tagged with the command's seq and are undone and replayed on reconciliation like movement.
import { DT, INTERP_DELAY, tuning } from '../data/tuning.js';
import { World, BEAM_FIELDS, LAVA_FIELDS } from '../sim/world.js';
import { C, ACT } from '../sim/ecs.js';
import { MSG, ENT, PROTOCOL_VERSION, quantAxis } from '../net/protocol.js';
import { emitPattern, NEVER, KILL } from '../sim/projectiles.js';
import { ENEMIES, ENEMY_KINDS } from '../data/enemies.js';
import { SKILLS } from '../data/weapons.js';
import { lerp, wrapAngle } from '../core/math.js';
import { NavalPilotPrediction } from './navalPilotPrediction.js';
import { NavalDeckPrediction } from './navalDeckPrediction.js';
import { interpolatePilotPose, pilotPoint } from '../sim/naval/pilotGeometry.js';

const BUF_MAX = 40;
const KILL_EVENTS = { parry: KILL.REFLECT, destroy: KILL.DESTROY, phit: KILL.HIT, guard: KILL.BLOCK };

export class GameClient {
  constructor(transport, map, bus) {
    this.t = transport;
    this.map = map;
    this.bus = bus;
    this.pred = new World(map.seed, { map });
    this.youServer = 0;
    this.personalLantern = false;
    this.youLocal = 0;
    this.seq = 0;
    this.pending = [];
    this.entities = new Map(); // serverId -> record
    this.pred.rafts = [];
    this.lastRaftTick = -1;
    this.resources = { nodes: [], bench: null };
    this.lastSnapshotTick = -1;
    this.naval = new NavalPilotPrediction(map);
    this.deck = new NavalDeckPrediction();
    this.voyage = { active: false };
    this.route = null;
    this.lesson = null;
    this.capacity = null;
    this.raftSamples = new Map();
    this.clock = 0;
    this.serverOffset = null;
    this.prev = { x: 0, y: 0, z: 0, f: 0 };
    this.cur = { x: 0, y: 0, z: 0, f: 0 };
    this.err = { x: 0, y: 0, z: 0 };
    this.awaitingFirst = false;
    this.stats = { predErr: 0, corrections: 0, pending: 0, snapAge: 0, ptLag: 0 };
    this.lastSnapClock = 0;
    this.ptPrev = 0; this.ptCur = 0; this.lastSweep = 0;
    this.predicted = new Set(); // "type:pid:seq" of feedback already shown from prediction
    this.sidOf = new Map(); // server shot id → local shot id
    this.nextLocalSid = 1 << 24;
    this.replaying = false;
    this.ackSeq = 0;
    this.meleeSeen = new Map(); // enemy id → swing key (client-side melee feedback, once per swing)
    this.ending = new Map(); // shot slot → {sid, x, z, hit, t, queue} (server said it ended; finishing the flight)
    this.endedEarly = new Set(); // bounce sids that ended before their deferred flight began
    // Despawns held until the death a shot is still flying to has been shown (the server frees the id at
    // once and its next spawn may reuse it: without this the late death would land on the newcomer).
    this.heldDespawn = new Map(); // id → clock when the despawn arrived
    this.tmp = { x: 0, y: 0, z: 0 };
    // Visual shots are spawned by prediction and by server events; during a replay they are reused.
    this.pred.spawnShot = (owner, o) => this.spawnLocalShot(owner, o);
    transport.onMessage((m) => this.onMessage(m));
    transport.onSnapshot((s) => this.onSnapshot(s));
  }

  // Begin receiving (call after everything that listens to the bus is registered).
  start() { this.t.start(); }

  get joined() { return this.youLocal !== 0 && !this.awaitingFirst; }
  // Human players in the instance (you included): with company, your hitstop is yours alone.
  get humans() { let n = 0; for (const r of this.entities.values()) if (r.human) n++; return n; }
  get hazards() { return this.pred.hazards; }
  get shots() { return this.pred.shots; }
  // Projectile tick being displayed this frame (fractional).
  displayTick(alpha) { return this.ptPrev + (this.ptCur - this.ptPrev) * alpha; }
  // Server time estimate in ticks (used before joining and for remote attack timelines).
  serverTick() { return this.serverOffset === null ? 0 : (this.clock + this.serverOffset) / DT; }
  viewTick(alpha) { return this.youLocal && !this.awaitingFirst ? this.displayTick(alpha) : this.serverTick(); }

  // save: the blob the server sent last time (M4), '' for a fresh start.
  join(name, skin, weapon = 0, save = '', account = null) {
    this.t.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin, weapon, save,
      ...(account ? { token: account.token, importSave: account.importSave === true } : {}) });
  }

  send(msg) { this.t.send(msg); }

  onMessage(m) {
    switch (m.t) {
      case MSG.SPAWN: {
        const d = m.e;
        if (this.heldDespawn.has(d.id)) this.releaseDespawn(d.id);
        const rec = {
          id: d.id, kind: d.kind, name: d.name, title: d.title, skin: d.skin, level: d.level, team: d.team ?? 0, human: !!d.human,
          enemy: d.enemy !== undefined ? ENEMY_KINDS[d.enemy] : null, maxHp: d.maxHp || 0, weapon: d.weapon || 0,
          buf: [], r: { x: 0, y: 0, z: 0, f: 0, vx: 0, vz: 0, st: 0, mag: 0, wade: 0, dashes: 0, hp: 1, maxHp: 1, act: 0, actT: 0, lvl: 1, wpn: d.weapon || 0 }, ready: false,
        };
        if (rec.enemy) rec.def = ENEMIES[rec.enemy];
        this.entities.set(d.id, rec);
        this.bus.emit('entity:spawn', rec);
        break;
      }
      case MSG.DESPAWN: {
        if (this.killPending(m.id)) { this.heldDespawn.set(m.id, this.clock); break; }
        this.despawnNow(m.id);
        break;
      }
      case MSG.WELCOME: {
        this.personalLantern = false;
        this.naval = new NavalPilotPrediction(this.map);
        this.route = null;
        this.lesson = null;
        this.deck = new NavalDeckPrediction();
        this.raftSamples.clear();
        this.youServer = m.you;
        // Field keys use server entity IDs, including locally predicted casts.
        this.pred.fieldOwner = m.you;
        const rec = this.entities.get(m.you);
        this.youLocal = this.pred.spawnPlayer({
          name: rec ? rec.name : 'Grumete', skin: rec ? rec.skin : 0, level: rec ? rec.level : 1, weapon: rec ? rec.weapon : 0,
        });
        this.pred.events.length = 0;
        this.awaitingFirst = true;
        if (rec) rec.isYou = true;
        this.bus.emit('you:welcome', { id: m.you, rec });
        break;
      }
      case MSG.EVENT:
        this.onEvent(m.ev);
        break;
      case MSG.PROFILE:
        // Your bag, gear, gold, masteries (M4). The prediction keeps a copy so a predicted level-up comes out
        // with the same numbers as the server's.
        this.profile = m.p;
        if (!this.pred.profiles) this.pred.profiles = new Map();
        if (this.youLocal) this.pred.profiles.set(this.youLocal, m.p);
        this.bus.emit('profile', m.p);
        break;
      case MSG.SAVE: this.bus.emit('save', m); break;
      case MSG.FULL: this.bus.emit('net:full', m); break;
      case MSG.ERROR: this.bus.emit('net:error', m); break;
      case MSG.CHAT_STATE: this.bus.emit('chat:state', m); break;
      case MSG.CHAT_MESSAGE: this.bus.emit('chat:message', m); break;
      case MSG.CHAT_RESULT: this.bus.emit('chat:result', m); break;
      default:
        break;
    }
  }

  // ---- Server events ----------------------------------------------------------------------------------
  isMe(e) { return e !== undefined && e === this.youServer; }

  onEvent(ev) {
    if (ev.type === 'resourceHit') {
      this.bus.emit('resourceHit', ev);
      return;
    }
    if (ev.type === 'navalDeck' || ev.type === 'navalInvite' || ev.type === 'navalImpact' || ev.type === 'navalGust') {
      if (ev.to === this.youServer) this.bus.emit(ev.type, ev);
      return;
    }
    if (ev.type === 'navalPilot') {
      if (ev.to === this.youServer) this.bus.emit('navalPilot', ev);
      return;
    }
    if (ev.type === 'raftProduction') {
      if (ev.to === this.youServer) this.bus.emit('raftProduction', ev);
      return;
    }
    if (ev.type === 'commerce') {
      if (ev.to === this.youServer) this.bus.emit('commerce', ev);
      return;
    }
    if (ev.type === 'community' || ev.type === 'artisan') {
      if (ev.to === this.youServer) this.bus.emit(ev.type, ev);
      return;
    }
    if (ev.type === 'resource') {
      if (ev.to === this.youServer) this.bus.emit('resource', ev);
      return;
    }
    if (ev.type === 'raftEdit') {
      if (ev.to === this.youServer) this.bus.emit('raftEdit', ev);
      return;
    }
    if (ev.type === 'raftDoor') {
      if (ev.to === this.youServer) this.bus.emit('raftDoor', ev);
      return;
    }
    if (ev.type === 'raftLantern') {
      if (ev.to === this.youServer) this.bus.emit('raftLantern', ev);
      return;
    }
    if (ev.type === 'personalLantern') {
      if (ev.to === this.youServer) this.bus.emit('personalLantern', ev);
      return;
    }
    const H = this.pred.hazards;
    // (A shot names its owner, not `e`.)
    const mine = this.isMe(ev.type === 'shot' ? ev.owner : ev.e) || ((ev.type === 'death' || ev.type === 'respawn') && ev.id === this.youServer);
    let show = true;
    switch (ev.type) {
      case 'cast': {
        const rec = this.entities.get(ev.e);
        if (rec) rec.chargeSkill = ev.skill;
        break;
      }
      case 'wheel': case 'mastbolt': {
        const rec = this.entities.get(ev.e);
        if (rec) rec.chargeSkill = null;
        break;
      }
      case 'pattern':
        emitPattern(H, ev, this.map);
        break;
      case 'cancel': H.cancelPending(ev.src, ev.tick); break;
      case 'clear':
        H.clear(Math.round(this.ptCur));
        if (!ev.hostile) for (let s = 0; s < this.shots.cap; s++) if (this.shots.id[s]) this.shots.free(s);
        break;
      case 'frostField':
        H.addFrostField({ ...ev, predicted: false });
        break;
      case 'inkCloud':
        this.pred.addInkCloud({ ...ev, predicted: false });
        break;
      case 'aoe':
        if (!H.aoes.some((a) => a.id === ev.id)) {
          const a = { id: ev.id, owner: ev.src, x: ev.x, z: ev.z, r: ev.r, t0: ev.tick, tAct: ev.tAct, dmg: ev.dmg, keep: ev.keep || 0, fire: ev.fire || 0 };
          if (ev.sx !== undefined) { a.sx = ev.sx; a.sz = ev.sz; }
          H.addAoe(a);
        }
        break;
      case 'beam':
        if (!H.beams.some((b) => b.id === ev.id)) {
          const b = { owner: ev.src, t0: ev.tick };
          for (const k of BEAM_FIELDS) b[k] = ev[k];
          H.addBeam(b);
        }
        break;
      case 'lava':
        if (ev.off) H.setLava(null);
        else if (!H.lava || H.lava.id !== ev.id) { const L = {}; for (const k of LAVA_FIELDS) L[k] = ev[k]; H.setLava(L); }
        break;
      case 'parry': case 'destroy': case 'phit': case 'guard': {
        const s = ev.pid ? H.slot.get(ev.pid) : undefined;
        if (s !== undefined) {
          if (mine && H.killBy[s] === this.youLocal && H.killSeq[s] === ev.seq) H.confirmed[s] = 1;
          else { H.remove(s, Math.round(this.ptCur), KILL_EVENTS[ev.type], mine ? this.youLocal : ev.e, ev.seq); H.confirmed[s] = 1; }
        }
        break;
      }
      case 'shot': {
        // A bounce: it leaves from where the previous shot lands, once that flight is drawn to the end.
        if (ev.from) {
          for (const end of this.ending.values()) if (end.sid === ev.from) { end.queue.push({ spawnShot: ev }); return; }
          const l = this.spawnLocalShot(ev.owner, { ...ev, type: ev.ptype, server: true });
          if (l) this.sidOf.set(ev.sid, l);
          break;
        }
        // The server's copy of a shot this client predicted (a reflect: same source projectile; a released
        // catch: same command): adopt it, or create it.
        let local = 0;
        const S = this.shots;
        if (mine && ev.key) for (let s = 0; s < S.cap; s++) if (S.id[s] && S.key[s] === ev.key && S.pred[s]) { local = S.id[s]; S.pred[s] = 0; break; }
        if (!local) local = this.spawnLocalShot(ev.owner, { ...ev, type: ev.ptype, server: true });
        if (local) {
          this.sidOf.set(ev.sid, local);
          const s = S.slot.get(local);
          if (s !== undefined) S.elem[s] = ev.elem || 0;
        }
        break;
      }
      case 'shotEnd': {
        // The visual shot is drawn against enemies 100 ms in the past: let it fly to where it hit, then
        // play the impact (and the damage / kill it caused) on arrival.
        const local = this.sidOf.get(ev.sid);
        this.sidOf.delete(ev.sid);
        const s = local !== undefined ? this.shots.slot.get(local) : undefined;
        if (s !== undefined) { this.ending.set(s, { sid: ev.sid, owner: ev.owner ?? this.shots.owner[s], elem: ev.elem ?? this.shots.elem[s], x: ev.x, z: ev.z, hit: ev.hit, t: 0, queue: [] }); return; }
        for (const en of this.ending.values()) if (en.queue.some((q) => q.spawnShot && q.spawnShot.sid === ev.sid)) this.endedEarly.add(ev.sid);
        this.bus.emit('combat', { type: 'shotImpact', e: ev.owner, elem: ev.elem || 0, x: ev.x, z: ev.z, hit: ev.hit });
        return;
      }
      case 'damage': case 'kill':
        if (ev.type === 'kill' || ev.kind === 'shot') {
          for (const end of this.ending.values()) if (end.hit && end.hit === ev.id) { end.queue.push({ ...ev, me: false, fromServer: true }); return; }
        }
        break;
      default: break;
    }
    // Feedback the prediction already played is not played twice.
    if (mine && ev.seq !== undefined && this.predicted.has(this.keyOf(ev))) show = false;
    if (ev.type === 'damage' && ev.by === this.youServer && ev.kind === 'melee' && this.predicted.has('mhit:' + ev.id + ':' + ev.seq)) ev.predictedHit = true;
    if (show) this.bus.emit('combat', { ...ev, me: mine, fromServer: true });
  }

  keyOf(ev) { return ev.type + ':' + (ev.pid ?? ev.id ?? '') + ':' + ev.seq; }

  despawnNow(id) {
    this.heldDespawn.delete(id);
    const rec = this.entities.get(id);
    this.entities.delete(id);
    if (rec) this.bus.emit('entity:despawn', rec);
  }

  // A kill waiting for its shot to land on this entity?
  killPending(id) {
    for (const end of this.ending.values()) if (end.queue.some((q) => q.type === 'kill' && q.id === id)) return true;
    return false;
  }

  // Show the deaths still in flight to `id` now (at the server's impact point), then despawn it.
  releaseDespawn(id) {
    for (const [s, end] of [...this.ending]) if (end.queue.some((q) => q.type === 'kill' && q.id === id)) this.finishEnding(s, end, end.x, end.z);
    if (this.heldDespawn.has(id)) this.despawnNow(id);
  }

  // A visual shot the server already ended reaches its impact: the impact, then what it caused.
  finishEnding(s, end, ix, iz) {
    const elem = end.elem ?? this.shots.elem[s], owner = end.owner ?? this.shots.owner[s];
    this.shots.free(s);
    this.ending.delete(s);
    this.bus.emit('combat', { type: 'shotImpact', e: owner, elem, x: ix, z: iz, hit: end.hit });
    for (const q of end.queue) {
      if (!q.spawnShot) { this.bus.emit('combat', q); continue; }
      const b = q.spawnShot;
      if (this.endedEarly.delete(b.sid)) continue;
      const l = this.spawnLocalShot(b.owner, { ...b, x: ix, z: iz, type: b.ptype, server: true });
      if (l) this.sidOf.set(b.sid, l);
      this.bus.emit('combat', { type: 'bounce', x: ix, z: iz, owner: b.owner });
    }
    for (const q of end.queue) if (q.type === 'kill' && this.heldDespawn.has(q.id) && !this.killPending(q.id)) this.despawnNow(q.id);
  }

  spawnLocalShot(owner, o) {
    const S = this.shots;
    if (this.replaying) {
      // Replaying a predicted reflect: the shot already exists.
      for (let s = 0; s < S.cap; s++) if (S.id[s] && o.key && S.key[s] === o.key) { this.keepShots.add(s); return S.id[s]; }
    }
    const id = this.nextLocalSid++;
    const elem = o.elem ?? (o.server ? 0 : this.pred.ecs.elem[owner]) ?? 0;
    S.spawn(id, { ...o, elem, owner: owner === this.youLocal ? this.youServer : owner, pred: o.server ? 0 : o.seq || 0 });
    return id;
  }

  onSnapshot(s) {
    // Never reconcile an older player state against a newer set of deck surfaces.
    if (s.tick < this.lastSnapshotTick) return;
    let naval = this.naval, deck = this.deck;
    if (s.deck) {
      if (s.deck.active && s.deck.tick !== s.tick) return;
      deck = Object.assign(new NavalDeckPrediction(this.deck.engine), this.deck);
      if (deck.acceptSnapshot(s.deck) === 'rejected') return;
    }
    if (s.naval) {
      if (s.naval.active && s.naval.body?.state?.tick !== s.tick) return;
      naval = Object.assign(new NavalPilotPrediction(this.map), this.naval);
      if (naval.acceptSnapshot(s.naval) === 'rejected') return;
    }
    if (naval.active && deck.active && naval.shipId !== deck.shipId) return;
    // Validate both private streams before committing either cursor or the shared snapshot.
    this.naval = naval; this.deck = deck;
    if (s.voyage && typeof s.voyage.active === 'boolean') this.voyage = s.voyage;
    this.route = s.route?.v === 1 ? s.route : null;
    this.lesson = s.lesson?.v === 1 ? s.lesson : null;
    if (this.naval.active || this.deck.active) this.pending.length = 0;
    this.lastSnapshotTick = s.tick;
    if (s.resources && Array.isArray(s.resources.nodes)) { this.resources = s.resources; this.resourceTick = s.tick; }
    if (Object.hasOwn(s, 'capacity')) this.capacity = s.capacity;
    if (Array.isArray(s.rafts) && s.tick >= this.lastRaftTick) {
      this.lastRaftTick = s.tick;
      this.pred.rafts = s.rafts;
      this.pred.raftDeck.update(s.rafts);
      const ids = new Set();
      for (const r of s.rafts) {
        ids.add(r.id);
        const samples = this.raftSamples.get(r.id) || [];
        if (!samples.length || samples[samples.length - 1].tick < s.tick) {
          samples.push({ tick: s.tick, record: r });
          if (samples.length > BUF_MAX) samples.shift();
        }
        this.raftSamples.set(r.id, samples);
      }
      for (const id of this.raftSamples.keys()) if (!ids.has(id)) this.raftSamples.delete(id);
    }
    const st = s.tick * DT;
    const off = st - this.clock;
    // Asymmetric: a snapshot saying the server is further ahead is taken at once (the least delayed one
    // is the best clock sample; a slow device whose clock lags real time keeps up), late ones only
    // pull the estimate back slowly (network jitter).
    if (this.serverOffset === null || Math.abs(off - this.serverOffset) > 0.25) this.serverOffset = off;
    else this.serverOffset += (off - this.serverOffset) * (off > this.serverOffset ? 0.6 : 0.05);
    this.lastSnapClock = this.clock;

    for (const e of s.ents) {
      const rec = this.entities.get(e[ENT.ID]);
      if (!rec) continue;
      rec.lantern = e[ENT.LANTERN] === 1 && e[ENT.HP] > 0;
      if (e[ENT.ID] === this.youServer) this.personalLantern = rec.lantern;
      if (e[ENT.ID] === this.youServer) { rec.serverState = e; continue; }
      const sample = {
        time: st, x: e[ENT.X], y: e[ENT.Y], z: e[ENT.Z], f: e[ENT.F], vx: e[ENT.VX], vz: e[ENT.VZ],
        st: e[ENT.ST], mag: e[ENT.MAG], wade: e[ENT.WADE], dashes: e[ENT.DASHES],
        hp: e[ENT.HP], maxHp: e[ENT.MAXHP], act: e[ENT.ACT], actT: e[ENT.ACTT], lvl: e[ENT.LVL], wpn: e[ENT.WPN] | 0, elem: e[ENT.ELEM] | 0,
      };
      const b = rec.buf;
      if (b.length && b[b.length - 1].time >= st) continue;
      b.push(sample);
      if (b.length > BUF_MAX) b.shift();
      if (!rec.ready) { Object.assign(rec.r, sample); rec.ready = true; }
    }

    if (s.enc) {
      this.enc = s.enc;
      // The lava ring for late joiners (or a lost event): rebuild it from the snapshot.
      const L = s.enc[0] && s.enc[0][9], H = this.pred.hazards;
      if (L && (!H.lava || H.lava.id !== L[0])) { const o = {}; LAVA_FIELDS.forEach((k, i) => { o[k] = L[i]; }); H.setLava(o); }
      else if (s.enc[0] && !L && H.lava) H.setLava(null);
    }
    if (s.frost && (this.lastFrostTick === undefined || s.tick >= this.lastFrostTick)) {
      this.lastFrostTick = s.tick;
      // A complete authoritative list repairs lost creation events and rejected local casts.
      // Pending commands below recreate any fields that have not yet been acknowledged.
      const H = this.pred.hazards;
      const canonical = H.frostFields.filter((f) => !f.predicted);
      const keys = ['e', 'seq', 'x', 'z', 'r', 't0', 'tEnd', 'slow'];
      if (canonical.length !== s.frost.length || canonical.some((f, i) => keys.some((k) => f[k] !== s.frost[i][k]))) {
        H.frostFields = []; H.frostRev++;
        for (const f of s.frost) H.addFrostField({ ...f, predicted: false });
      }
    }
    if (s.storm && (this.lastStormTick === undefined || s.tick >= this.lastStormTick)) {
      this.lastStormTick = s.tick;
      const H = this.pred.hazards;
      for (const ev of s.storm) {
        emitPattern(H, ev, this.map);
        for (const k of ev.removed || []) {
          const slot = H.slot.get(k.pid);
          if (slot === undefined) continue;
          H.remove(slot, k.tick, k.kind, k.by === this.youServer ? this.youLocal : k.by, k.seq);
          H.confirmed[slot] = 1;
        }
      }
    }
    if (s.clock && Number.isFinite(s.clock.hours) && Number.isFinite(s.clock.tick) && Number.isFinite(s.clock.daySec) && s.clock.daySec > 0 &&
        (!this.pred.clock || s.tick >= this.pred.clock.tick)) this.pred.clock = { ...s.clock };
    if (s.ink && (this.lastInkTick === undefined || s.tick >= this.lastInkTick)) {
      this.lastInkTick = s.tick;
      this.pred.inkClouds = [];
      for (const f of s.ink.clouds || []) this.pred.addInkCloud({ ...f, predicted: false });
      this.pred.inkMarks = s.ink.marks || [];
    }
    if (s.you && this.youLocal) this.reconcile(s.ack, s.you);
    if (this.naval.active) this.syncNavalPilot();
    else if (this.deck.active) this.syncNavalDeck();
  }

  mountNaval(shipId) { this.send({ t: MSG.CMD, type: 'navalPilot', op: 'mount', shipId }); }
  inviteNaval(shipId, target) { this.send({ t: MSG.CMD, type: 'navalPilot', op: 'invite', shipId, target }); }
  boardNaval(shipId) { this.send({ t: MSG.CMD, type: 'navalPilot', op: 'board', shipId }); }
  walkNaval() {
    this.neutralNaval();
    this.send({ t: MSG.CMD, type: 'navalPilot', op: 'walk', epoch: this.naval.epoch });
  }
  helmNaval() {
    this.neutralDeck();
    this.send({ t: MSG.CMD, type: 'navalPilot', op: 'helm', epoch: this.naval.epoch });
  }
  leaveDeck() {
    this.neutralDeck();
    this.send({ t: MSG.CMD, type: 'navalPilot', op: 'deckleave', epoch: this.deck.epoch });
  }
  neutralDeck() {
    const command = this.deck.neutral();
    if (command) this.send({ t: MSG.DECK_INPUT, ...command });
  }
  tickDeck(axes) {
    if (!this.joined) return false;
    const command = this.deck.step(axes);
    if (!command) return false;
    this.syncNavalDeck();
    this.send({ t: MSG.DECK_INPUT, ...command });
    return true;
  }
  leaveNaval() {
    this.neutralNaval();
    this.send({ t: MSG.CMD, type: 'navalPilot', op: 'leave', epoch: this.naval.epoch });
  }
  neutralNaval() {
    const command = this.naval.neutral();
    if (command) this.send({ t: MSG.SHIP_INPUT, ...command });
  }
  tickNaval(axes) {
    if (!this.joined) return false;
    if (this.deck.active) axes = { throttle: 0, brake: axes?.brake || 0, steer: 0 };
    const command = this.naval.step(axes);
    if (!command) return false;
    this.syncNavalPilot();
    this.send({ t: MSG.SHIP_INPUT, ...command });
    return true;
  }
  syncNavalPilot() {
    if (this.deck.active) { this.pred.rafts = this.naval.project(this.pred.rafts); this.syncNavalDeck(); return; }
    const p = this.naval.position(), ecs = this.pred.ecs, e = this.youLocal;
    if (!p || !e) return;
    ecs.x[e] = this.cur.x = p.x; ecs.y[e] = this.cur.y = p.y; ecs.z[e] = this.cur.z = p.z;
    ecs.facing[e] = this.cur.f = p.f;
    ecs.vx[e] = ecs.vz[e] = ecs.moveMag[e] = 0;
    this.err.x = this.err.y = this.err.z = 0;
    this.pred.rafts = this.naval.project(this.pred.rafts);
    this.pred.raftDeck.update(this.pred.rafts);
  }
  syncNavalDeck() {
    const raft = this.renderRafts().find((r) => r.id === this.deck.shipId), p = raft && this.deck.position(raft);
    const ecs = this.pred.ecs, e = this.youLocal;
    if (!p || !e) return;
    ecs.x[e] = this.cur.x = p.x; ecs.y[e] = this.cur.y = p.y; ecs.z[e] = this.cur.z = p.z; ecs.facing[e] = this.cur.f = p.f;
    ecs.vx[e] = ecs.vz[e] = 0; ecs.moveMag[e] = this.deck.state.mag;
    this.err.x = this.err.y = this.err.z = 0;
    this.pred.raftDeck.update(this.pred.rafts);
  }
  renderRafts(alpha = 1) {
    const time = this.serverTick() - INTERP_DELAY / DT;
    const records = this.pred.rafts.map((r) => {
      if (!r.pilot && !r.crew?.length) return r;
      const samples = this.raftSamples.get(r.id) || [];
      let a = samples[0], b = a;
      for (const sample of samples) { if (sample.tick <= time) a = sample; if (sample.tick >= time) { b = sample; break; } b = sample; }
      if (!a || !b || a.record.pilot?.epoch !== r.pilot?.epoch || b.record.pilot?.epoch !== r.pilot?.epoch) return r;
      const t = a.tick === b.tick ? 1 : Math.max(0, Math.min(1, (time - a.tick) / (b.tick - a.tick)));
      const pose = r.id === this.naval.shipId ? r : interpolatePilotPose(a.record, b.record, t);
      const crew = r.crew?.map((member) => {
        const ca = a.record.crew?.find((c) => c.entity === member.entity && c.epoch === member.epoch);
        const cb = b.record.crew?.find((c) => c.entity === member.entity && c.epoch === member.epoch);
        if (!ca || !cb) return member;
        const anchor = { x: lerp(ca.anchor.x, cb.anchor.x, t), y: lerp(ca.anchor.y, cb.anchor.y, t),
          z: lerp(ca.anchor.z, cb.anchor.z, t), f: ca.anchor.f + wrapAngle(cb.anchor.f - ca.anchor.f) * t };
        return { ...member, anchor, mag: lerp(ca.mag, cb.mag, t) };
      });
      return { ...r, ...pose, ...(crew ? { crew } : {}) };
    });
    return this.naval.project(records, alpha);
  }

  reconcile(ack, state) {
    const ecs = this.pred.ecs, e = this.youLocal;
    this.ackSeq = ack;
    if (this.awaitingFirst) {
      this.pred.setPlayerState(e, state);
      this.pending = this.pending.filter((c) => c.seq > ack);
      this.replay(ack);
      this.cur.x = this.prev.x = ecs.x[e];
      this.cur.y = this.prev.y = ecs.y[e];
      this.cur.z = this.prev.z = ecs.z[e];
      this.cur.f = this.prev.f = ecs.facing[e];
      this.awaitingFirst = false;
      this.bus.emit('you:ready', { x: ecs.x[e], z: ecs.z[e] });
      return;
    }
    const bx = ecs.x[e], by = ecs.y[e], bz = ecs.z[e];
    this.pred.setPlayerState(e, state);
    let i = 0;
    while (i < this.pending.length && this.pending[i].seq <= ack) i++;
    if (i) this.pending.splice(0, i);
    this.replay(ack);
    const dx = bx - ecs.x[e], dy = by - ecs.y[e], dz = bz - ecs.z[e];
    const errLen = Math.hypot(dx, dy, dz);
    this.stats.predErr = errLen;
    if (errLen > 1e-6) {
      this.stats.corrections++;
      if (errLen > 4) { this.err.x = this.err.y = this.err.z = 0; } // teleport / respawn: don't smooth
      else { this.err.x += dx; this.err.y += dy; this.err.z += dz; }
      this.cur.x = ecs.x[e]; this.cur.y = ecs.y[e]; this.cur.z = ecs.z[e];
      this.prev.x -= dx; this.prev.y -= dy; this.prev.z -= dz;
    }
    // Old feedback keys can go.
    if (this.predicted.size > 400) for (const k of this.predicted) { if (+k.slice(k.lastIndexOf(':') + 1) < ack - 120) this.predicted.delete(k); }
  }

  // Undo what prediction did after `ack` (kills, graze/ghost marks, ground-circle hits), then re-run
  // the pending commands from the server's state. Events from a replay are not shown again.
  replay(ack) {
    const H = this.pred.hazards, me = this.youLocal;
    H.removePredictedFrostFields(this.youServer);
    const ecs = this.pred.ecs;
    this.pred.removePredictedInkClouds(this.youServer);
    if (ecs.inkEnd[me] > this.ptCur) this.pred.addInkCloud({ e: this.youServer, seq: ecs.inkSeq[me],
      x: ecs.inkX[me], z: ecs.inkZ[me], t0: ecs.inkT0[me], tEnd: ecs.inkEnd[me], r: SKILLS.inkcloud.r, predicted: false });
    // The restored player state also names its last deployed field. Pending commands may start
    // after its activation, so they cannot recreate it by crossing the cast's windup again.
    if (ecs.icEnd[me] > ecs.icT0[me] && this.ptCur - ecs.icEnd[me] <= H.maxLifeTicks + tuning.combat.rewind) H.addFrostField({ e: this.youServer, seq: ecs.icSeq[me],
      x: ecs.icX[me], z: ecs.icZ[me], t0: ecs.icT0[me], tEnd: ecs.icEnd[me],
      r: SKILLS.iceanchor.r, slow: SKILLS.iceanchor.slow, predicted: false });
    for (let s = 0; s < H.cap; s++) {
      if (H.id[s] === 0) continue;
      if (H.dead[s] !== NEVER && H.killBy[s] === me && H.killSeq[s] > ack && !H.confirmed[s]) {
        H.dead[s] = NEVER; H.kill[s] = 0; H.killBy[s] = 0; H.killSeq[s] = 0;
      }
      const m = H.marks[s];
      if (m) { for (let k = m.length - 1; k >= 0; k--) if (m[k].e === me && m[k].seq > ack) m.splice(k, 1); }
    }
    for (const a of H.aoes) for (let k = a.hits.length - 1; k >= 0; k--) if (a.hits[k].e === me && a.hits[k].seq > ack) a.hits.splice(k, 1);
    const undo = (list) => { for (let k = list.length - 1; k >= 0; k--) if (list[k].e === me && list[k].seq > ack) list.splice(k, 1); };
    for (const b of H.beams) { undo(b.hits); undo(b.ghosts); }
    if (H.lava) undo(H.lava.hits);
    const S = this.shots;
    this.keepShots = new Set();
    this.replaying = true;
    const e = this.youLocal;
    for (const c of this.pending) this.pred.applyCommand(e, c);
    this.replaying = false;
    // Predicted shots that the replay no longer produces (and the server never adopted) go away.
    for (let s = 0; s < S.cap; s++) if (S.id[s] && S.pred[s] > ack && !this.keepShots.has(s)) S.free(s);
    this.pred.events.length = 0;
  }

  // One fixed client tick: build the command, predict, send.
  tickInput(input) {
    if (!this.youLocal || this.awaitingFirst) return;
    if (this.deck.active) {
      if (this.naval.active) this.tickNaval(input.naval || { throttle: 0, brake: 0, steer: 0 });
      this.tickDeck(input.deck || { mx: 0, mz: 0 });
      return;
    }
    if (this.naval.active) { if (input.naval) this.tickNaval(input.naval); return; }
    const ecs = this.pred.ecs, e = this.youLocal;
    // Projectile tick for this command: one step ahead, nudged toward the server clock.
    const target = Math.max(1, Math.round(this.serverTick()));
    let pt = this.ptCur + 1;
    const err = target - pt;
    // Behind (a slow device runs fewer commands than server ticks): catch up by up to 3 extra ticks a
    // command, which still moves the fastest projectile less than its hit radius per step.
    if (!this.ptCur || Math.abs(err) > 12) pt = target;
    else if (err >= 2) pt += Math.min(3, err >> 1);
    else if (err <= -2) pt -= 1;
    this.stats.ptLag = target - pt;
    const cmd = {
      seq: ++this.seq,
      mx: quantAxis(input.mx), mz: quantAxis(input.mz),
      ax: input.ax, az: input.az, btn: input.btn | 0, prs: input.prs | 0, pt, w: input.w | 0,
    };
    this.ptPrev = this.ptCur || pt;
    this.ptCur = pt;
    this.prev.x = this.cur.x; this.prev.y = this.cur.y; this.prev.z = this.cur.z; this.prev.f = this.cur.f;
    const wasDash = ecs.dashT[e] >= 0;
    const ch = ecs.dashCharges[e];
    this.pred.events.length = 0;
    this.pred.applyCommand(e, cmd);
    this.cur.x = ecs.x[e]; this.cur.y = ecs.y[e]; this.cur.z = ecs.z[e]; this.cur.f = ecs.facing[e];
    if (!wasDash && ecs.dashT[e] >= 0) {
      this.bus.emit('local:dash', { x: ecs.x[e], z: ecs.z[e], dx: ecs.dashDirX[e], dz: ecs.dashDirZ[e] });
    } else if ((cmd.prs & 1) && ch < 1 && ecs.dashT[e] < 0 && ecs.dashBuffer[e] > 0) {
      this.bus.emit('local:dashDenied', {});
    }
    // Predicted combat feedback, shown now; the server's copy of the same event is skipped later.
    for (const ev of this.pred.events) {
      if (ev.type === 'spawn' || ev.type === 'despawn') continue;
      if (ev.e === e) ev.e = this.youServer;
      if (ev.id === e) ev.id = this.youServer;
      this.predicted.add(this.keyOf(ev));
      this.bus.emit('combat', { ...ev, me: true, predicted: true });
    }
    this.pred.events.length = 0;
    this.predictMelee(cmd.seq);
    this.pending.push(cmd);
    if (this.pending.length > 240) this.pending.shift();
    this.stats.pending = this.pending.length;
    this.t.sendInput(cmd.seq, cmd);
  }

  // Melee feedback against what the player sees (interpolated enemies). The server decides the damage;
  // this only makes the spark, the sound and the hitstop land on the frame of the hit.
  predictMelee(seq) {
    const ecs = this.pred.ecs, e = this.youLocal, stage = ecs.atkStage[e];
    if (!stage) return;
    const st = tuning.melee.stages[stage - 1];
    const t = ecs.atkT[e];
    if (t <= st.windup || t - DT >= st.windup + st.active) return;
    const key = ecs.swingId[e];
    const fx = Math.sin(ecs.facing[e]), fz = Math.cos(ecs.facing[e]);
    const half = Math.cos((st.arc / 2) * Math.PI / 180);
    // Inside the Cala Calavera (M4.5) the other pirates in it are fair game too.
    const law = this.map.lawlessAt, pvp = !!law && law(ecs.x[e], ecs.z[e]);
    for (const rec of this.entities.values()) {
      if (!rec.ready || rec.dying || rec.id === this.youServer) continue;
      const foe = rec.enemy || (pvp && rec.human && rec.r.hp > 0 && law(rec.r.x, rec.r.z));
      if (!foe) continue;
      if (this.meleeSeen.get(rec.id) === key) continue;
      const dx = rec.r.x - ecs.x[e], dz = rec.r.z - ecs.z[e], d = Math.hypot(dx, dz);
      if (d > st.range + (rec.def ? rec.def.hurt : tuning.player.hurtRadius)) continue;
      if (st.arc < 360 && d > 0.6 && (dx * fx + dz * fz) / d < half) continue;
      this.meleeSeen.set(rec.id, key);
      this.predicted.add('mhit:' + rec.id + ':' + seq);
      this.predicted.add('time::' + seq);
      this.bus.emit('combat', { type: 'mhit', id: rec.id, e: this.youServer, stage, seq, x: rec.r.x, z: rec.r.z, me: true, predicted: true });
    }
  }

  update(simDt, realDt = simDt) {
    this.clock += simDt;
    const k = Math.exp(-tuning.visual.errorSmoothLambda * realDt);
    this.err.x *= k; this.err.y *= k; this.err.z *= k;
    this.stats.snapAge = this.clock - this.lastSnapClock;
    const rt = this.serverOffset === null ? 0 : this.clock + this.serverOffset - INTERP_DELAY;
    for (const rec of this.entities.values()) {
      if (rec.id === this.youServer || !rec.buf.length) continue;
      this.sampleRemote(rec, rt);
    }
    for (const raft of this.renderRafts()) {
      const crew = raft.crew || (raft.pilot ? [{ entity: raft.pilot.owner, anchor: raft.pilot.anchor, mag: 0 }] : []);
      for (const member of crew) if (member.entity !== this.youServer) {
        const rec = this.entities.get(member.entity);
        if (rec?.ready) Object.assign(rec.r, pilotPoint(raft, member.anchor), { vx: 0, vz: 0, mag: member.mag });
      }
    }
    if (simDt > 0) this.stepShots(simDt);
    // A held despawn never waits long (its shot may have been cleared away).
    for (const [id, t] of this.heldDespawn) if (this.clock - t > 0.4) this.releaseDespawn(id);
    // Hostile projectiles the client no longer needs.
    // (Every 32 ticks of pt, which can step by more than one per command.)
    if (this.ptCur && Math.abs(this.ptCur - this.lastSweep) >= 32) { this.pred.hazards.sweep(this.ptCur); this.lastSweep = this.ptCur; }
  }

  // Visual shots: the same homing as the server, toward the enemies as drawn here.
  stepShots(dt) {
    const S = this.shots, tmp = this.tmp;
    const find = (x, z, dx, dz, coneCos) => {
      let best = 0, bd = 16;
      for (const rec of this.entities.values()) {
        if (!rec.enemy || !rec.ready || rec.dying) continue;
        const ox = rec.r.x - x, oz = rec.r.z - z, d = Math.hypot(ox, oz);
        if (d > bd || d < 1e-6 || (ox * dx + oz * dz) / d < coneCos) continue;
        bd = d; best = rec.id;
      }
      return best;
    };
    const pos = (id, out) => {
      const rec = this.entities.get(id);
      if (!rec || !rec.ready || rec.dying) return false;
      out.x = rec.r.x; out.z = rec.r.z; out.y = rec.r.y + 1.1;
      return true;
    };
    for (let s = 0; s < S.cap; s++) {
      if (!S.id[s]) continue;
      const end = this.ending.get(s);
      if (end) {
        // Fly straight to the impact (the enemy as drawn, or the wall).
        let ex = end.x, ez = end.z;
        if (end.hit && pos(end.hit, tmp)) { ex = tmp.x; ez = tmp.z; }
        const dx = ex - S.x[s], dz = ez - S.z[s], d = Math.hypot(dx, dz);
        const step = S.speed[s] * dt;
        end.t += dt;
        if (d <= step + 0.35 || end.t > 0.22) {
          this.finishEnding(s, end, d < 3 ? ex : S.x[s], d < 3 ? ez : S.z[s]);
          continue;
        }
        S.vx[s] = (dx / d) * S.speed[s]; S.vz[s] = (dz / d) * S.speed[s];
        S.x[s] += S.vx[s] * dt; S.z[s] += S.vz[s] * dt;
        continue;
      }
      S.step(s, dt, find, pos, tmp);
      // Keep it alive a little past its life: the server's end event removes it with the right impact.
      if (S.life[s] < -0.5) S.free(s);
    }
  }

  sampleRemote(rec, time) {
    const b = rec.buf, r = rec.r;
    // drop samples we no longer need (keep one before `time`)
    while (b.length > 2 && b[1].time <= time) b.shift();
    const a = b[0];
    const c = b.length > 1 ? b[1] : null;
    if (!c || time <= a.time) {
      // Before the buffer or only one sample: hold / brief extrapolation.
      const ex = c ? 0 : Math.min(0.1, Math.max(0, time - a.time));
      r.x = a.x + a.vx * ex; r.z = a.z + a.vz * ex; r.y = a.y; r.f = a.f;
      r.vx = a.vx; r.vz = a.vz; r.st = a.st; r.mag = a.mag; r.wade = a.wade; r.dashes = a.dashes;
      r.hp = a.hp; r.maxHp = a.maxHp; r.act = a.act; r.actT = a.actT + Math.max(0, time - a.time); r.lvl = a.lvl; r.wpn = a.wpn; r.elem = a.elem;
      return;
    }
    const t = Math.min(1, (time - a.time) / (c.time - a.time));
    r.x = lerp(a.x, c.x, t); r.y = lerp(a.y, c.y, t); r.z = lerp(a.z, c.z, t);
    r.f = a.f + wrapAngle(c.f - a.f) * t;
    r.vx = lerp(a.vx, c.vx, t); r.vz = lerp(a.vz, c.vz, t);
    r.st = t < 0.5 ? a.st : c.st; r.mag = lerp(a.mag, c.mag, t); r.wade = lerp(a.wade, c.wade, t);
    r.dashes = c.dashes;
    r.hp = c.hp; r.maxHp = c.maxHp; r.lvl = c.lvl; r.wpn = t < 0.5 ? a.wpn : c.wpn; r.elem = t < 0.5 ? a.elem : c.elem;
    // Action: keep counting time inside the same action, switch when the next sample does.
    if (c.act === a.act) { r.act = a.act; r.actT = lerp(a.actT, c.actT, t); }
    else { r.act = t < 0.5 ? a.act : c.act; r.actT = t < 0.5 ? a.actT + (time - a.time) : Math.max(0, c.actT - (c.time - time)); }
  }

  // Interpolated, error-smoothed local player state for rendering.
  localState(alpha, out) {
    const ecs = this.pred.ecs, e = this.youLocal;
    out.x = lerp(this.prev.x, this.cur.x, alpha) + this.err.x;
    out.y = lerp(this.prev.y, this.cur.y, alpha) + this.err.y;
    out.z = lerp(this.prev.z, this.cur.z, alpha) + this.err.z;
    out.f = this.prev.f + wrapAngle(this.cur.f - this.prev.f) * alpha;
    if (this.deck.active) {
      const raft = this.renderRafts(alpha).find((r) => r.id === this.deck.shipId);
      if (raft) Object.assign(out, this.deck.position(raft, alpha));
    } else if (this.naval.active) Object.assign(out, this.naval.position(alpha));
    out.vx = ecs.vx[e]; out.vz = ecs.vz[e];
    out.st = ecs.state[e]; out.mag = this.deck.active ? this.deck.state.mag : ecs.moveMag[e]; out.wade = ecs.wade[e];
    out.dashT = ecs.dashT[e]; out.dashes = ecs.dashCount[e];
    out.charges = ecs.dashCharges[e]; out.maxCharges = ecs.dashMax[e]; out.recharge = ecs.dashRecharge[e];
    out.iframes = ecs.iframes[e];
    out.hp = ecs.hp[e]; out.maxHp = ecs.maxHp[e]; out.dead = ecs.dead[e]; out.deadT = ecs.deadT[e];
    out.act = ecs.act[e]; out.actT = ecs.actT[e] + alpha * DT;
    out.atkStage = ecs.atkStage[e]; out.atkT = ecs.atkT[e];
    out.guardT = ecs.guardT[e]; out.guardSt = ecs.guardSt[e]; out.catchN = ecs.catchN[e]; out.catchHv = ecs.catchHv[e]; out.catchT = ecs.catchT[e];
    out.riposte = ecs.riposte[e]; out.chain = ecs.chain[e]; out.chainT = ecs.chainT[e];
    out.level = ecs.level[e]; out.xp = ecs.xp[e]; out.hurtInv = ecs.hurtInv[e]; out.stagger = ecs.stagger[e];
    out.god = ecs.god[e];
    out.weapon = ecs.weapon[e]; out.cdQ = ecs.cdQ[e]; out.cdE = ecs.cdE[e]; out.castK = ecs.castK[e]; out.castT = ecs.castT[e];
    out.potions = ecs.potions[e]; out.potCd = ecs.potCd[e]; out.mastery = ecs.mastery[e]; out.guardMax = tuning.guard.stamina + ecs.guardAdd[e];
    // M4.7: what the slots hold (skill index, form, rank), the charge and the empowered attack after a Parpadeo.
    out.skQ = ecs.skQ[e]; out.skE = ecs.skE[e]; out.fmQ = ecs.fmQ[e]; out.fmE = ecs.fmE[e]; out.rkQ = ecs.rkQ[e]; out.rkE = ecs.rkE[e];
    out.skG = ecs.skG[e]; out.cdG = ecs.cdG[e];
    out.elem = ecs.elem[e]; out.chg = ecs.chg[e]; out.empT = ecs.empT[e]; out.cdr = ecs.cdr[e];
    return out;
  }
}

export { C, ACT };
