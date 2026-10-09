// Authoritative coastal piloting. Recovery preserves committed position and damage with fresh controls.
import { C, KIND } from '../ecs.js';
import { RAFT, RAFT_LOAD } from '../../data/raftparts.js';
import { holdMass } from '../economy/cargo.js';
import { raftCapacity } from '../economy/raftCapacity.js';
import { NAVAL_TRIAL } from '../../data/navalTrial.js';
import { liveHelmAnchor, pilotLocal, pilotPoint } from './pilotGeometry.js';
import { publicRafts } from '../systems/rafts.js';
import { DeckWalkEngine } from './deckWalk.js';
import { hullIntegrity } from './structure.js';
import { activeRaftParts } from './condition.js';
import { encodeRaftVoyage } from './recovery.js';
import { distanceToNavalHull, isNavalLandingValid, nearestNavalLanding } from './landing.js';

export class NavalPilot {
  #world;
  #records = new Map();
  #epochs = new Map();
  #nextEpoch = 1;
  #closed = false;
  #walkers = new Map();
  #deckEpochs = new Map();
  #nextDeckEpoch = 1;
  #invites = new Map();
  #walker = new DeckWalkEngine();
  #walkTick = -1;
  #liveVoyages;
  #recoveries = new Map();

  constructor(world, { live = false } = {}) {
    if (!world?.isServer || !world.navalTrial) throw new TypeError('Pilot trial requires naval authority');
    if (typeof live !== 'boolean') throw new TypeError('Invalid live voyage option');
    this.#world = world;
    this.#liveVoyages = live;
  }

  get size() { return this.#records.size; }
  has(owner) { const r = this.#records.get(owner); return !!r && !r.ashore; }
  aboard(e) { return this.has(e) || this.#walkers.has(e); }
  walking(e) { return this.#walkers.has(e); }
  recipients(shipId) {
    const members = [...this.#walkers.values()].filter((c) => c.shipId === shipId).map((c) => c.e);
    for (const r of this.#records.values()) if (r.shipId === shipId && !r.ashore) members.push(r.owner);
    return [...new Set(members)];
  }

  locked(owner) { return this.#records.has(owner) || this.#walkers.has(owner) || this.#recoveries.has(owner); }

  // Reconnection restores an uncrewed parked vessel, not a trial handle or a piloting seat.
  restore(owner, shipId) {
    const w = this.#world, source = w.rafts.get(shipId);
    if (!this.#liveVoyages || !source || source.owner !== owner || !source.ship.voyage ||
        this.#records.has(owner) || this.#recoveries.has(owner)) return false;
    const pose = this.#pose(shipId), parts = activeRaftParts(source);
    this.#recoveries.set(owner, { owner, shipId, source, home: source.home, pose,
      landing: nearestNavalLanding(w, pose, parts, 6) });
    return true;
  }

  persist(owner) {
    if (!this.#liveVoyages) return;
    const r = this.#records.get(owner), source = r && this.#world.rafts.get(r.shipId);
    if (r && source?.ship === r.ship) {
      const home = source.home, pose = r.body.pose;
      source.ship.voyage = home && Math.hypot(pose.x - home.x, pose.z - home.z) < 1e-6 &&
        Math.abs(Math.atan2(Math.sin(pose.yaw - home.yaw), Math.cos(pose.yaw - home.yaw))) < 1e-6
        ? null : encodeRaftVoyage(this.#world, pose);
    }
  }

  // Aggregate only server-admitted passengers. The pilot is reserved even while on shore.
  // Passenger goods stay private; the moving rig receives their combined mass at the store center.
  payload(shipId) {
    const source = this.#world.rafts.get(shipId);
    const guests = [...this.#walkers.values()].filter((c) => c.shipId === shipId && c.e !== source?.owner && this.#live(c.e));
    const crewCount = 1 + guests.length;
    const guestMass = guests.reduce((sum, c) => sum + holdMass(this.#world.profiles.get(c.e)?.eco?.pack), 0);
    return { crewCount, crewMass: crewCount * RAFT_LOAD.crewMass, guestMass };
  }

  loadCapacity(shipId, extraGuest = null) {
    const source = this.#world.rafts.get(shipId);
    if (!source) return null;
    const r = this.#records.get(source.owner), payload = this.payload(shipId);
    if (extraGuest !== null && extraGuest !== source.owner && this.#walkers.get(extraGuest)?.shipId !== shipId) {
      payload.crewCount++; payload.crewMass += RAFT_LOAD.crewMass;
      payload.guestMass += holdMass(this.#world.profiles.get(extraGuest)?.eco?.pack);
    }
    return raftCapacity(r?.body.operational.parts || activeRaftParts(source), source.ship.hold,
      this.#world.profiles.get(source.owner)?.eco?.pack, null, payload);
  }

  #refreshPayload(r) {
    if (!r || !this.#world.navalTrial.navigation) return;
    this.#world.navalTrial.refreshPayload(r.handle);
    const s = this.#world.navalTrial.snapshot(r.handle);
    if (s) { r.body = s.body; r.ack = s.ack; }
  }

  neutral(owner) {
    const r = this.#records.get(owner);
    if (!r) return false;
    this.#world.navalTrial.releaseControl(r.handle);
    const c = this.#walkers.get(owner);
    if (c) { c.input = Object.freeze({ mx: 0, mz: 0 }); c.inputTick = -Infinity; }
    return true;
  }

  voyageSnapshot(owner) {
    const r = this.#records.get(owner);
    if (!r) {
      const recovery = this.#recoveries.get(owner);
      if (!recovery) return Object.freeze({ active: false });
      const { shipId, home, pose, landing } = recovery;
      return Object.freeze({ active: true, shipId, phase: 'shore', recovery: true, home: { ...home },
        landing: landing ? { ...landing } : null, canLand: false, canDock: false, visited: true,
        distanceHome: Math.hypot(pose.x - home.x, pose.z - home.z),
        target: landing ? { ...pose, label: 'Balsa' } : { ...home, label: 'Puerto' } });
    }
    const pose = r.body.pose, home = r.home;
    const distanceHome = Math.hypot(pose.x - home.x, pose.z - home.z);
    const speed = Math.hypot(r.body.state.vx, r.body.state.vz);
    const guests = this.#guests(r.shipId, owner).length > 0;
    const landing = r.ashore ? r.landing : this.#liveVoyages && !guests && r.visited && speed <= 0.8 &&
      (r.helm || this.#walkers.has(owner)) ? this.#findLanding(r) : null;
    const canLand = this.#liveVoyages && !r.ashore && (r.helm || this.#walkers.has(owner)) && !guests && r.visited && speed <= 0.8 && !!landing;
    const canDock = this.#liveVoyages && !r.ashore && r.helm && speed <= 0.8 && distanceHome <= 12;
    return Object.freeze({ active: true, shipId: r.shipId, phase: r.ashore ? 'shore' : 'sailing',
      home: Object.freeze({ x: home.x, y: home.y, z: home.z }),
      landing: landing ? Object.freeze({ x: landing.x, y: landing.y, z: landing.z }) : null,
      canLand, canDock, distanceHome, visited: r.visited,
      target: landing ? Object.freeze({ x: landing.x, y: landing.y, z: landing.z, label: r.ashore ? 'Balsa' : 'Costa' }) :
        Object.freeze({ x: home.x, y: home.y, z: home.z, label: 'Puerto' }) });
  }

  #live(e) {
    const ecs = this.#world.ecs;
    return Number.isInteger(e) && e > 0 && e < ecs.cap && ecs.alive[e] && ecs.kind[e] === KIND.PLAYER &&
      (ecs.mask[e] & C.PLAYER) && !(ecs.mask[e] & C.BOT) && ecs.clientId[e] >= 0 && ecs.hp[e] > 0 && !ecs.dead[e];
  }

  #idle(e) {
    const ecs = this.#world.ecs;
    return this.#live(e) && ecs.dashT[e] < 0 && !ecs.castK[e] && !ecs.atkStage[e];
  }

  #onDeck(e, shipId) {
    const ecs = this.#world.ecs, surface = this.#world.raftDeck.surface(ecs.x[e], ecs.z[e], ecs.y[e]);
    return surface?.id === shipId && (surface.kind === 'deck' || surface.kind === 'stairs');
  }

  #pose(shipId) {
    const w = this.#world, source = w.rafts.get(shipId), r = source && this.#records.get(source.owner);
    if (r?.shipId === shipId) return r.body.pose;
    return source && { x: w.ecs.x[source.entity], y: w.ecs.y[source.entity], z: w.ecs.z[source.entity], yaw: w.ecs.facing[source.entity] };
  }

  #findLanding(r, force = false) {
    const w = this.#world, pose = r.body.pose, parts = r.body.operational.parts, prior = r.landingSearch;
    const sameCoast = prior && prior.groundAt === w.map.groundAt && prior.onDock === w.map.onDock &&
      prior.queryColliders === w.map.queryColliders;
    if (!force && prior && prior.parts === parts && sameCoast && w.tick - prior.tick < 6) {
      if (!prior.point) return null;
      if (isNavalLandingValid(w, pose, parts, prior.point, 6)) return prior.point;
    }
    if (!force && prior?.tick === w.tick && prior.parts === parts && sameCoast) return null;
    const point = nearestNavalLanding(w, pose, parts, 6);
    r.landingSearch = { tick: w.tick, parts, point, groundAt: w.map.groundAt,
      onDock: w.map.onDock, queryColliders: w.map.queryColliders };
    return point;
  }

  // Boarding requires the owner's permission and the passenger's separate consent, on real support.
  invite(owner, shipId, target) {
    const w = this.#world, source = w.rafts.get(shipId);
    if (this.#closed || this.#recoveries.has(owner) || !source || source.owner !== owner || owner === target || !this.#idle(owner) ||
        !this.#idle(target) || !this.#onDeck(owner, shipId) || !this.#onDeck(target, shipId) || this.aboard(target)) return false;
    const permits = this.#invites.get(shipId) || new Map();
    permits.set(target, { owner, ownerClient: w.ecs.clientId[owner], client: w.ecs.clientId[target], until: w.tick + 600 });
    this.#invites.set(shipId, permits);
    w.emit({ type: 'navalInvite', to: target, shipId, owner });
    return true;
  }

  #addWalker(e, shipId) {
    const w = this.#world, source = w.rafts.get(shipId), pose = this.#pose(shipId), ecs = w.ecs;
    if (this.#nextDeckEpoch >= Number.MAX_SAFE_INTEGER || !pose || !source) return false;
    const anchor = pilotLocal(pose, { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e], f: ecs.facing[e] });
    const state = Object.freeze({ ...anchor, vx: 0, vz: 0, mag: 0 });
    const params = Object.freeze({ speed: ecs.speed[e], radius: ecs.radius[e] });
    const r = this.#records.get(source.owner);
    const parts = r?.shipId === shipId ? r.body.operational.parts : activeRaftParts(source);
    try { this.#walker.step(state, { mx: 0, mz: 0 }, parts, params); } catch { return false; }
    const epoch = this.#nextDeckEpoch++;
    this.#walkers.set(e, { e, shipId, epoch, state, params, ack: 0, lastSeq: 0, input: { mx: 0, mz: 0 },
      inputTick: -Infinity, client: ecs.clientId[e], source, ship: source.ship, rev: source.ship.rev,
      blueprint: JSON.stringify(source.ship.grid.parts), ownerClient: ecs.clientId[source.owner] });
    this.#deckEpochs.set(e, epoch);
    ecs.vx[e] = ecs.vz[e] = ecs.kbx[e] = ecs.kbz[e] = ecs.moveMag[e] = 0;
    return true;
  }

  board(e, shipId) {
    const w = this.#world, permit = this.#invites.get(shipId)?.get(e), source = w.rafts.get(shipId);
    if (this.#closed || !permit || !source || this.#recoveries.has(source.owner) || source.owner !== permit.owner || w.tick > permit.until ||
        w.ecs.clientId[e] !== permit.client || w.ecs.clientId[permit.owner] !== permit.ownerClient ||
        !this.#idle(e) || !this.#live(permit.owner) || this.aboard(e) || !this.#onDeck(e, shipId) ||
        [...this.#walkers.values()].filter((c) => c.shipId === shipId && c.e !== source.owner).length >= 3) return false;
    if (w.navalTrial.navigation && this.loadCapacity(shipId, e)?.status === 'overloaded') return false;
    if (!this.#addWalker(e, shipId)) return false;
    this.#refreshPayload(this.#records.get(source.owner));
    this.#invites.get(shipId).delete(e);
    w.raftDeck.update(publicRafts(w));
    return true;
  }

  walk(owner, epoch) {
    const r = this.#records.get(owner);
    if (!r || r.ashore || r.epoch !== epoch || !r.helm || !this.#idle(owner) || !this.#addWalker(owner, r.shipId)) return false;
    r.helm = false;
    this.#world.navalTrial.releaseControl(r.handle);
    this.#world.raftDeck.update(publicRafts(this.#world));
    return true;
  }

  helm(owner, epoch) {
    const r = this.#records.get(owner), c = this.#walkers.get(owner);
    if (!r || r.ashore || r.epoch !== epoch || r.helm || !c || !this.#idle(owner)) return false;
    if (this.#liveVoyages) {
      const source = this.#world.rafts.get(r.shipId);
      const station = source?.helm || liveHelmAnchor(r.body.operational.parts);
      if (!station) return false;
      const point = pilotPoint(r.body.pose, station), ecs = this.#world.ecs;
      if (Math.hypot(ecs.x[owner] - point.x, ecs.z[owner] - point.z) > 2 || !this.#onDeck(owner, r.shipId)) return false;
      r.anchor = Object.freeze({ ...station });
    } else r.anchor = Object.freeze({ x: c.state.x, y: c.state.y, z: c.state.z, f: c.state.f });
    this.#removeWalker(c, 'helm', false);
    r.helm = true;
    this.#world.raftDeck.update(publicRafts(this.#world));
    return true;
  }

  deckInput(e, command) {
    const c = this.#walkers.get(e);
    if (!c || !command || Array.isArray(command) || Object.keys(command).length !== 4 ||
        command.epoch !== c.epoch || !Number.isInteger(command.seq) || command.seq <= c.lastSeq ||
        command.seq > NAVAL_TRIAL.maxSequence || !Number.isFinite(command.mx) || Math.abs(command.mx) > 1 ||
        !Number.isFinite(command.mz) || Math.abs(command.mz) > 1) return false;
    c.input = Object.freeze({ mx: command.mx, mz: command.mz });
    c.inputTick = this.#world.tick; c.lastSeq = command.seq;
    return true;
  }

  deckSnapshot(e) {
    const c = this.#walkers.get(e), r = c && this.#records.get(c.source.owner);
    return c ? Object.freeze({ active: true, epoch: c.epoch, shipId: c.shipId, mode: 'walk', tick: this.#world.tick,
      ack: c.ack, state: c.state, params: c.params,
      parts: (r?.shipId === c.shipId ? r.body.operational.parts : activeRaftParts(c.source)).map((p) => [...p]) }) :
      Object.freeze({ active: false, epoch: this.#deckEpochs.get(e) || 0 });
  }

  #guests(id, owner) {
    const w = this.#world, ecs = w.ecs;
    return [...ecs.each(C.PLAYER)].filter((e) => e !== owner &&
      w.raftDeck.surface(ecs.x[e], ecs.z[e], ecs.y[e])?.id === id);
  }

  mount(owner, shipId) {
    const w = this.#world, ecs = w.ecs, source = w.rafts?.get(shipId);
    if (this.#closed || this.#records.size >= 4 || this.has(owner) || this.#recoveries.has(owner) || !source || source.owner !== owner ||
        ecs.dashT[owner] >= 0 || ecs.castK[owner] || ecs.atkStage[owner] ||
        w.raftDeck.surface(ecs.x[owner], ecs.z[owner], ecs.y[owner])?.id !== shipId ||
        w.raftDeck.surface(ecs.x[owner], ecs.z[owner], ecs.y[owner])?.kind !== 'deck' ||
        this.#guests(shipId, owner).some((e) => this.#walkers.get(e)?.shipId !== shipId) ||
        this.#walkers.has(owner) || this.#nextEpoch >= Number.MAX_SAFE_INTEGER) return false;
    if (w.navalTrial.navigation && this.loadCapacity(shipId)?.status === 'overloaded') return false;
    const handle = w.navalTrial.start(owner, shipId);
    if (!handle) return false;
    const snapshot = w.navalTrial.snapshot(handle);
    if (!snapshot?.body || !snapshot.body.operational?.parts) { w.navalTrial.stop(handle); return false; }
    const epoch = this.#nextEpoch++;
    let anchor;
    if (this.#liveVoyages) {
      const helm = source.helm || liveHelmAnchor(snapshot.body.operational.parts);
      if (!helm || Math.hypot(ecs.x[owner] - pilotPoint(snapshot.body.pose, helm).x,
          ecs.z[owner] - pilotPoint(snapshot.body.pose, helm).z) > 2 ||
          !this.#onDeck(owner, shipId)) { w.navalTrial.stop(handle); return false; }
      anchor = Object.freeze({ ...helm });
    } else anchor = pilotLocal(snapshot.body.pose, { x: ecs.x[owner], y: ecs.y[owner], z: ecs.z[owner], f: ecs.facing[owner] });
    this.#records.set(owner, { owner, shipId, handle, epoch, anchor, helm: true, body: snapshot.body,
      ack: 0, clientId: ecs.clientId[owner], ship: source.ship, home: Object.freeze({ ...(source.home || snapshot.body.pose) }),
      landing: null, ashore: false, visited: false, inputSeq: 0 });
    this.#epochs.set(owner, epoch);
    ecs.vx[owner] = ecs.vz[owner] = ecs.kbx[owner] = ecs.kbz[owner] = 0;
    ecs.moveMag[owner] = 0;
    const pilot = pilotPoint(snapshot.body.pose, anchor);
    ecs.x[owner] = pilot.x; ecs.y[owner] = pilot.y; ecs.z[owner] = pilot.z; ecs.facing[owner] = pilot.f;
    w.raftDeck.update(publicRafts(w));
    this.persist(owner); w.profileDirty?.add(owner);
    return true;
  }

  input(owner, command) {
    const r = this.#records.get(owner);
    const keys = command && Object.keys(command);
    if (!r || r.ashore || !r.helm || !command || command.epoch !== r.epoch ||
        (this.#liveVoyages ? ![5, 6].includes(keys.length) : keys.length !== 5) ||
        keys.some((key) => !['epoch', 'seq', 'throttle', 'brake', 'steer', ...(this.#liveVoyages ? ['capture'] : [])].includes(key)) ||
        (this.#liveVoyages && Object.hasOwn(command, 'capture') && typeof command.capture !== 'boolean')) return false;
    if (!r.helm && (command.throttle !== 0 || command.steer !== 0)) return false;
    const { epoch, ...axes } = command;
    if (this.#liveVoyages && !Object.hasOwn(axes, 'capture')) axes.capture = false;
    return this.#world.navalTrial.input(r.handle, axes);
  }

  snapshot(owner) {
    // Heartbeats while M5 holds a tick must be read-only. Source invalidation happens in prepare,
    // never from the transport's snapshot callback; publish only the last committed pilot anchor.
    const r = this.#records.get(owner);
    return r && !r.ashore ? Object.freeze({ epoch: r.epoch, active: true, shipId: r.shipId, ack: r.ack,
      body: r.body, anchor: r.anchor, wind: NAVAL_TRIAL.wind, coast: this.#world.navalTrial.coast }) :
      Object.freeze({ epoch: this.#epochs.get(owner) || 0, active: false });
  }

  // Trusted route adapter; only an owner's live voyage can opt in, never a guest's deck seat.
  routeContext(owner) {
    const r = this.#records.get(owner);
    if (this.#closed || !this.#liveVoyages || !r || !this.#world.ecs.alive[owner] || this.#world.ecs.clientId[owner] !== r.clientId) return null;
    return { shipId: r.shipId, epoch: r.epoch, body: r.body, home: r.home,
      ashore: r.ashore === true, helm: r.helm && this.#idle(owner) };
  }

  land(owner, epoch) {
    const r = this.#records.get(owner), w = this.#world, ecs = w.ecs;
    if (!this.#liveVoyages || !r || r.ashore || epoch !== r.epoch || !this.#idle(owner) ||
        this.#guests(r.shipId, owner).length || Math.hypot(r.body.state.vx, r.body.state.vz) > 0.8) return false;
    const distanceHome = Math.hypot(r.body.pose.x - r.home.x, r.body.pose.z - r.home.z);
    const landing = this.#findLanding(r, true);
    if ((!r.visited && distanceHome < 20) || !landing || this.#nextEpoch >= Number.MAX_SAFE_INTEGER ||
        !w.navalTrial.park(r.handle, true)) return false;
    const parked = w.navalTrial.snapshot(r.handle);
    if (parked?.body) { r.body = parked.body; r.ack = parked.ack; }
    this.neutral(owner);
    const walker = this.#walkers.get(owner);
    if (walker) this.#removeWalker(walker, 'land', false);
    r.ashore = true; r.helm = false; r.landing = Object.freeze({ x: landing.x, y: landing.y, z: landing.z });
    w.navalRoute?.end(owner, 'shore');
    r.epoch = this.#nextEpoch++;
    this.#epochs.set(owner, r.epoch);
    this.#placePlayer(owner, landing);
    w.raftDeck.update(publicRafts(w));
    w.emit({ type: 'navalPilot', to: owner, active: false, epoch: r.epoch - 1, why: 'shore' });
    return true;
  }

  reboard(owner, shipId) {
    const r = this.#records.get(owner), w = this.#world, ecs = w.ecs;
    const recovery = this.#recoveries.get(owner);
    if (recovery) {
      const source = w.rafts.get(shipId), parts = source && activeRaftParts(source), landing = recovery.landing;
      if (!this.#liveVoyages || recovery.shipId !== shipId || source !== recovery.source || !landing ||
          !this.#idle(owner) || this.#records.size >= 4 || this.#walkers.has(owner) ||
          this.#nextEpoch >= Number.MAX_SAFE_INTEGER || Math.hypot(ecs.x[owner] - landing.x, ecs.z[owner] - landing.z) > 4 ||
          distanceToNavalHull(ecs.x[owner], ecs.z[owner], recovery.pose, parts) > 6 ||
          !isNavalLandingValid(w, recovery.pose, parts, landing, 6)) return false;
      const helm = liveHelmAnchor(parts);
      if (!helm) return false;
      const handle = w.navalTrial.start(owner, shipId), snapshot = handle && w.navalTrial.snapshot(handle);
      if (!snapshot) { if (handle) w.navalTrial.stop(handle); return false; }
      const epoch = this.#nextEpoch++;
      this.#recoveries.delete(owner);
      this.#records.set(owner, { owner, shipId, handle, epoch, anchor: Object.freeze({ ...helm }), helm: true,
        body: snapshot.body, ack: 0, clientId: ecs.clientId[owner], ship: source.ship, home: source.home,
        landing: null, ashore: false, visited: true, inputSeq: 0 });
      this.#epochs.set(owner, epoch);
      this.#placePlayer(owner, pilotPoint(snapshot.body.pose, helm));
      this.persist(owner); w.profileDirty?.add(owner); w.raftDeck.update(publicRafts(w));
      w.emit({ type: 'navalPilot', to: owner, active: true, epoch, shipId, mode: 'helm' });
      return true;
    }
    if (!this.#liveVoyages || !r || !r.ashore || r.shipId !== shipId || !this.#idle(owner) ||
        Math.hypot(ecs.x[owner] - r.landing.x, ecs.z[owner] - r.landing.z) > 4 ||
        distanceToNavalHull(ecs.x[owner], ecs.z[owner], r.body.pose, r.body.operational.parts) > 6 ||
        this.#nextEpoch >= Number.MAX_SAFE_INTEGER) return false;
    const source = w.rafts.get(shipId), helm = source?.helm || liveHelmAnchor(r.body.operational.parts);
    if (!source || source.owner !== owner || source.ship !== r.ship || !helm ||
        !w.navalTrial.park(r.handle, false)) return false;
    const resumed = w.navalTrial.snapshot(r.handle);
    if (!resumed?.body) { w.navalTrial.park(r.handle, true); return false; }
    r.body = resumed.body; r.ack = resumed.ack;
    this.neutral(owner);
    r.anchor = Object.freeze({ ...helm }); r.ashore = false; r.helm = true;
    r.epoch = this.#nextEpoch++; this.#epochs.set(owner, r.epoch);
    this.#placePlayer(owner, pilotPoint(r.body.pose, r.anchor));
    w.raftDeck.update(publicRafts(w));
    w.emit({ type: 'navalPilot', to: owner, active: true, epoch: r.epoch, shipId, mode: 'helm' });
    return true;
  }

  dock(owner, epoch) {
    const r = this.#records.get(owner);
    if (!this.#liveVoyages || !r || r.ashore || !r.helm || epoch !== r.epoch || !this.#idle(owner) ||
        Math.hypot(r.body.state.vx, r.body.state.vz) > 0.8 ||
        Math.hypot(r.body.pose.x - r.home.x, r.body.pose.z - r.home.z) > 12) return false;
    this.#release(r, 'dock');
    return true;
  }

  recall(owner) {
    const r = this.#records.get(owner), w = this.#world, ecs = w.ecs, d = w.map.dock;
    const recovery = this.#recoveries.get(owner);
    if (!this.#liveVoyages || (!r?.ashore && !recovery) || !this.#live(owner)) return false;
    const dockX = d.base.x + d.dir.x * Math.max(0, d.len - 10), dockZ = d.base.z + d.dir.z * Math.max(0, d.len - 10);
    if (Math.hypot(ecs.x[owner] - dockX, ecs.z[owner] - dockZ) > 6) return false;
    if (recovery) {
      this.#recoveries.delete(owner);
      this.#returnHome(recovery.source);
      w.raftDeck.update(publicRafts(w));
      return true;
    }
    this.#release(r, 'recall');
    return true;
  }

  #placePlayer(e, point) {
    const ecs = this.#world.ecs;
    ecs.x[e] = point.x; ecs.y[e] = point.y; ecs.z[e] = point.z;
    ecs.vx[e] = ecs.vz[e] = ecs.kbx[e] = ecs.kbz[e] = ecs.moveMag[e] = 0;
    ecs.dashT[e] = -1;
    ecs.castK[e] = ecs.castT[e] = ecs.castLock[e] = ecs.chg[e] = 0;
  }

  project(records) {
    return records.map((record) => {
      const r = this.#records.get(record.owner);
      const crew = [...this.#walkers.values()].filter((c) => c.shipId === record.id).map((c) =>
        ({ entity: c.e, epoch: c.epoch, mode: 'walk', anchor: { x: c.state.x, y: c.state.y, z: c.state.z, f: c.state.f }, mag: c.state.mag }));
      if (!r || r.shipId !== record.id) return this.#recoveries.get(record.owner)?.shipId === record.id
        ? { ...record, voyage: true, crew: [] } : crew.length ? { ...record, crew } : record;
      if (r.ashore) return { ...record, ...r.body.pose, parts: r.body.operational.parts.map((p) => [...p]), crew,
        voyage: true, hull: { ...hullIntegrity(r.body.structure) }, partHealth: r.body.structure.entries.map((p) =>
          ({ id: p.id, part: [...p.part], hp: p.hp, maxHp: p.maxHp })) };
      if (r.helm) crew.push({ entity: r.owner, epoch: r.epoch, mode: 'helm', anchor: { ...r.anchor }, mag: 0 });
      return { ...record, ...r.body.pose, parts: r.body.operational.parts.map((p) => [...p]), crew,
        voyage: true,
        hull: { ...hullIntegrity(r.body.structure) }, partHealth: r.body.structure.entries.map((p) =>
          ({ id: p.id, part: [...p.part], hp: p.hp, maxHp: p.maxHp })),
        pilot: { owner: r.owner, epoch: r.epoch, anchor: { ...r.anchor } } };
    });
  }

  // Walk inputs advance once per admitted tick in the ship frame. Ordinary land inputs stay parked;
  // foreign position changes invalidate support rather than becoming a second pose authority.
  prepare() {
    const w = this.#world, ecs = w.ecs;
    for (const r of this.#records.values()) this.#refreshPayload(r);
    for (const r of [...this.#records.values()]) {
      if (r.ashore) {
        const parked = w.navalTrial.snapshot(r.handle);
        if (!parked || !this.#live(r.owner) || ecs.clientId[r.owner] !== r.clientId ||
            w.rafts.get(r.shipId)?.ship !== r.ship || w.profiles.get(r.owner)?.eco?.ships?.includes(r.ship) !== true) {
          this.#release(r, 'shore-invalid');
        } else { r.body = parked.body; r.ack = parked.ack; }
        continue;
      }
      const s = w.navalTrial.snapshot(r.handle), p = pilotPoint(r.body.pose, r.anchor);
      if (!s || ecs.hp[r.owner] <= 0 || ecs.dead[r.owner] || this.#guests(r.shipId, r.owner).some((e) => this.#walkers.get(e)?.shipId !== r.shipId) ||
          Math.hypot(ecs.x[r.owner] - p.x, ecs.y[r.owner] - p.y, ecs.z[r.owner] - p.z) > 0.05 ||
          Math.abs(Math.atan2(Math.sin(ecs.facing[r.owner] - p.f), Math.cos(ecs.facing[r.owner] - p.f))) > 0.05)
        this.#release(r, 'seat');
    }
    const next = [];
    for (const c of [...this.#walkers.values()]) {
      const source = w.rafts.get(c.shipId), pose = this.#pose(c.shipId), expected = pose && pilotPoint(pose, c.state);
      if (!this.#live(c.e) || ecs.clientId[c.e] !== c.client || source !== c.source || source.ship !== c.ship ||
          !this.#live(source.owner) || ecs.clientId[source.owner] !== c.ownerClient || !ecs.alive[source.entity] ||
          ecs.kind[source.entity] !== KIND.SHIP || !(c.ship.hp > 0) || c.ship.at !== 'aldea' ||
          !w.profiles.get(source.owner)?.eco?.ships?.includes(c.ship) || c.ship.rev !== c.rev ||
          JSON.stringify(c.ship.grid.parts) !== c.blueprint || !expected ||
          Math.hypot(ecs.x[c.e] - expected.x, ecs.y[c.e] - expected.y, ecs.z[c.e] - expected.z) > 0.05) {
        const r = this.#records.get(c.e);
        if (r) this.#release(r, 'support'); else this.#removeWalker(c, 'support', true);
        continue;
      }
      if (this.#walkTick === w.tick) continue;
      const params = Object.freeze({ speed: ecs.speed[c.e], radius: ecs.radius[c.e] });
      const active = w.tick - c.inputTick < NAVAL_TRIAL.inputTimeoutTicks;
      const r = this.#records.get(source.owner), parts = r?.shipId === c.shipId ? r.body.operational.parts : activeRaftParts(source);
      try { next.push({ c, params, state: this.#walker.step(c.state, active ? c.input : { mx: 0, mz: 0 }, parts, params), ack: active ? c.lastSeq : c.ack }); }
      catch { const own = this.#records.get(c.e); if (own) this.#release(own, 'support'); else this.#removeWalker(c, 'support', true); }
    }
    for (const n of next) if (this.#walkers.get(n.c.e) === n.c) {
      n.c.state = n.state; n.c.params = n.params; n.c.ack = n.ack;
      const own = this.#records.get(n.c.e); if (own) own.anchor = n.state;
    }
    for (const r of this.#records.values()) {
      const distance = Math.hypot(r.body.pose.x - r.home.x, r.body.pose.z - r.home.z);
      if (distance >= 20) r.visited = true;
    }
    this.#walkTick = w.tick;
  }

  sync() {
    const w = this.#world, ecs = w.ecs;
    for (const r of [...this.#records.values()]) {
      const s = w.navalTrial.snapshot(r.handle);
      if (!s || s.body.operational.disabled) { this.#release(r, 'flotation'); continue; }
      r.body = s.body;
      r.ack = s.ack;
      this.persist(r.owner); w.profileDirty?.add(r.owner);
      if (r.ashore) continue;
      const p = pilotPoint(r.body.pose, r.anchor);
      ecs.x[r.owner] = p.x; ecs.y[r.owner] = p.y; ecs.z[r.owner] = p.z; ecs.facing[r.owner] = p.f;
      ecs.vx[r.owner] = ecs.vz[r.owner] = ecs.kbx[r.owner] = ecs.kbz[r.owner] = 0;
      ecs.moveMag[r.owner] = this.#walkers.get(r.owner)?.state.mag || 0;
    }
    for (const c of this.#walkers.values()) {
      const pose = this.#pose(c.shipId); if (!pose) continue;
      const p = pilotPoint(pose, c.state), cos = Math.cos(pose.yaw), sin = Math.sin(pose.yaw);
      ecs.x[c.e] = p.x; ecs.y[c.e] = p.y; ecs.z[c.e] = p.z; ecs.facing[c.e] = p.f;
      ecs.vx[c.e] = cos * c.state.vx + sin * c.state.vz; ecs.vz[c.e] = -sin * c.state.vx + cos * c.state.vz;
      ecs.kbx[c.e] = ecs.kbz[c.e] = 0; ecs.moveMag[c.e] = c.state.mag;
    }
    w.raftDeck.update(publicRafts(w));
    for (const r of [...this.#records.values()]) {
      if (!r.ashore && w.raftDeck.surface(ecs.x[r.owner], ecs.z[r.owner], ecs.y[r.owner])?.id !== r.shipId)
        this.#release(r, 'support');
    }
    for (const c of [...this.#walkers.values()]) if (!this.#onDeck(c.e, c.shipId)) {
      const r = this.#records.get(c.e); if (r) this.#release(r, 'support'); else this.#removeWalker(c, 'support', true);
    }
  }

  #removeWalker(c, why, rescue) {
    this.#walkers.delete(c.e);
    this.#refreshPayload(this.#records.get(c.source.owner));
    if (rescue && this.#world.ecs.clientId[c.e] === c.client) this.#rescue(c.e);
    this.#world.emit({ type: 'navalDeck', to: c.e, active: false, epoch: c.epoch, why });
  }

  leaveDeck(e, epoch) {
    const c = this.#walkers.get(e);
    if (!c || c.epoch !== epoch) return false;
    const r = this.#records.get(e);
    if (r) this.#release(r, 'leave'); else { this.#removeWalker(c, 'leave', true); this.#world.raftDeck.update(publicRafts(this.#world)); }
    return true;
  }

  leave(owner, epoch) {
    const r = this.#records.get(owner);
    if (!r || epoch !== r.epoch || this.#liveVoyages) return false;
    this.#release(r, 'leave');
    return true;
  }

  #rescue(e) {
    const w = this.#world, ecs = w.ecs, d = w.map.dock;
    if (!ecs.alive[e] || ecs.kind[e] !== KIND.PLAYER) return;
    ecs.x[e] = d.base.x + d.dir.x * Math.max(0, d.len - 10);
    ecs.z[e] = d.base.z + d.dir.z * Math.max(0, d.len - 10);
    ecs.y[e] = w.map.groundAt(ecs.x[e], ecs.z[e]);
    ecs.vx[e] = ecs.vz[e] = ecs.kbx[e] = ecs.kbz[e] = 0;
    ecs.dashT[e] = -1;
    ecs.castK[e] = ecs.castT[e] = ecs.castLock[e] = ecs.chg[e] = 0;
  }

  #release(r, why) {
    const w = this.#world, ecs = w.ecs, guests = this.#guests(r.shipId, r.owner);
    this.persist(r.owner);
    w.navalRoute?.end(r.owner, why);
    this.#records.delete(r.owner);
    w.navalTrial.stop(r.handle);
    if (!['detach', 'close'].includes(why)) this.#returnHome(w.rafts.get(r.shipId));
    for (const c of [...this.#walkers.values()]) if (c.shipId === r.shipId) this.#removeWalker(c, why, true);
    if (ecs.clientId[r.owner] === r.clientId) this.#rescue(r.owner);
    for (const e of guests) this.#rescue(e);
    w.raftDeck.update(publicRafts(w));
    w.emit({ type: 'navalPilot', to: r.owner, active: false, epoch: r.epoch, why });
  }

  removeOwner(owner) {
    const r = this.#records.get(owner); if (r) this.#release(r, 'detach');
    this.#world.navalRoute?.end(owner, 'detach');
    this.#recoveries.delete(owner);
    for (const c of [...this.#walkers.values()]) if (c.e === owner || c.source.owner === owner) this.#removeWalker(c, 'detach', true);
    for (const [id, permits] of this.#invites) {
      for (const [e, permit] of permits) if (e === owner || permit.owner === owner) permits.delete(e);
      if (!permits.size) this.#invites.delete(id);
    }
  }
  close() {
    for (const r of [...this.#records.values()]) this.#release(r, 'close');
    for (const c of [...this.#walkers.values()]) this.#removeWalker(c, 'close', true);
    this.#invites.clear(); this.#recoveries.clear(); this.#closed = true;
  }

  #returnHome(source) {
    if (!source) return;
    const w = this.#world, ecs = w.ecs, home = source.home;
    if (home) { ecs.x[source.entity] = home.x; ecs.y[source.entity] = home.y; ecs.z[source.entity] = home.z; ecs.facing[source.entity] = home.yaw; }
    source.ship.voyage = null;
    w.profileDirty?.add(source.owner);
  }
}
