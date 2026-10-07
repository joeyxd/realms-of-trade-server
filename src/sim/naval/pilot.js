// Opt-in pilot experiment. The saved mooring remains canonical; only a transient public projection
// and its attached pilot sail. Promotion to public voyages must replace this return-to-dock policy.
import { C, KIND } from '../ecs.js';
import { RAFT } from '../../data/raftparts.js';
import { NAVAL_TRIAL } from '../../data/navalTrial.js';
import { pilotLocal, pilotPoint } from './pilotGeometry.js';
import { publicRafts } from '../systems/rafts.js';
import { DeckWalkEngine } from './deckWalk.js';
import { hullIntegrity } from './structure.js';

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

  constructor(world) {
    if (!world?.isServer || !world.navalTrial) throw new TypeError('Pilot trial requires naval authority');
    this.#world = world;
  }

  get size() { return this.#records.size; }
  has(owner) { return this.#records.has(owner); }
  aboard(e) { return this.has(e) || this.#walkers.has(e); }
  walking(e) { return this.#walkers.has(e); }
  recipients(shipId) {
    const members = [...this.#walkers.values()].filter((c) => c.shipId === shipId).map((c) => c.e);
    for (const r of this.#records.values()) if (r.shipId === shipId) members.push(r.owner);
    return [...new Set(members)];
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

  // Boarding requires the owner's permission and the passenger's separate consent, on real support.
  invite(owner, shipId, target) {
    const w = this.#world, source = w.rafts.get(shipId);
    if (this.#closed || !source || source.owner !== owner || owner === target || !this.#idle(owner) ||
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
    const parts = r?.shipId === shipId ? r.body.operational.parts : source.ship.grid.parts;
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
    if (this.#closed || !permit || !source || source.owner !== permit.owner || w.tick > permit.until ||
        w.ecs.clientId[e] !== permit.client || w.ecs.clientId[permit.owner] !== permit.ownerClient ||
        !this.#idle(e) || !this.#live(permit.owner) || this.aboard(e) || !this.#onDeck(e, shipId) ||
        [...this.#walkers.values()].filter((c) => c.shipId === shipId && c.e !== source.owner).length >= 3) return false;
    if (!this.#addWalker(e, shipId)) return false;
    this.#invites.get(shipId).delete(e);
    w.raftDeck.update(publicRafts(w));
    return true;
  }

  walk(owner, epoch) {
    const r = this.#records.get(owner);
    if (!r || r.epoch !== epoch || !r.helm || !this.#idle(owner) || !this.#addWalker(owner, r.shipId)) return false;
    r.helm = false;
    this.#world.navalTrial.releaseControl(r.handle);
    this.#world.raftDeck.update(publicRafts(this.#world));
    return true;
  }

  helm(owner, epoch) {
    const r = this.#records.get(owner), c = this.#walkers.get(owner);
    if (!r || r.epoch !== epoch || r.helm || !c || !this.#idle(owner)) return false;
    r.anchor = Object.freeze({ x: c.state.x, y: c.state.y, z: c.state.z, f: c.state.f });
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
      parts: (r?.shipId === c.shipId ? r.body.operational.parts : c.ship.grid.parts).map((p) => [...p]) }) :
      Object.freeze({ active: false, epoch: this.#deckEpochs.get(e) || 0 });
  }

  #guests(id, owner) {
    const w = this.#world, ecs = w.ecs;
    return [...ecs.each(C.PLAYER)].filter((e) => e !== owner &&
      w.raftDeck.surface(ecs.x[e], ecs.z[e], ecs.y[e])?.id === id);
  }

  mount(owner, shipId) {
    const w = this.#world, ecs = w.ecs, source = w.rafts?.get(shipId);
    if (this.#closed || this.#records.size >= 4 || this.has(owner) || !source || source.owner !== owner ||
        ecs.dashT[owner] >= 0 || ecs.castK[owner] || ecs.atkStage[owner] ||
        w.raftDeck.surface(ecs.x[owner], ecs.z[owner], ecs.y[owner])?.id !== shipId ||
        w.raftDeck.surface(ecs.x[owner], ecs.z[owner], ecs.y[owner])?.kind !== 'deck' ||
        this.#guests(shipId, owner).some((e) => this.#walkers.get(e)?.shipId !== shipId) ||
        this.#walkers.has(owner) || this.#nextEpoch >= Number.MAX_SAFE_INTEGER) return false;
    const handle = w.navalTrial.start(owner, shipId);
    if (!handle) return false;
    const snapshot = w.navalTrial.snapshot(handle), epoch = this.#nextEpoch++;
    const anchor = pilotLocal(snapshot.body.pose, { x: ecs.x[owner], y: ecs.y[owner], z: ecs.z[owner], f: ecs.facing[owner] });
    this.#records.set(owner, { owner, shipId, handle, epoch, anchor, helm: true, body: snapshot.body, ack: 0, clientId: ecs.clientId[owner] });
    this.#epochs.set(owner, epoch);
    ecs.vx[owner] = ecs.vz[owner] = ecs.kbx[owner] = ecs.kbz[owner] = 0;
    ecs.moveMag[owner] = 0;
    w.raftDeck.update(publicRafts(w));
    return true;
  }

  input(owner, command) {
    const r = this.#records.get(owner);
    if (!r || !command || command.epoch !== r.epoch || Object.keys(command).length !== 5) return false;
    if (!r.helm && (command.throttle !== 0 || command.steer !== 0)) return false;
    const { epoch, ...axes } = command;
    return this.#world.navalTrial.input(r.handle, axes);
  }

  snapshot(owner) {
    // Heartbeats while M5 holds a tick must be read-only. Source invalidation happens in prepare,
    // never from the transport's snapshot callback; publish only the last committed pilot anchor.
    const r = this.#records.get(owner);
    return r ? Object.freeze({ epoch: r.epoch, active: true, shipId: r.shipId, ack: r.ack,
      body: r.body, anchor: r.anchor, wind: NAVAL_TRIAL.wind, coast: this.#world.navalTrial.coast }) :
      Object.freeze({ epoch: this.#epochs.get(owner) || 0, active: false });
  }

  project(records) {
    return records.map((record) => {
      const r = this.#records.get(record.owner);
      const crew = [...this.#walkers.values()].filter((c) => c.shipId === record.id).map((c) =>
        ({ entity: c.e, epoch: c.epoch, mode: 'walk', anchor: { x: c.state.x, y: c.state.y, z: c.state.z, f: c.state.f }, mag: c.state.mag }));
      if (!r || r.shipId !== record.id) return crew.length ? { ...record, crew } : record;
      if (r.helm) crew.push({ entity: r.owner, epoch: r.epoch, mode: 'helm', anchor: { ...r.anchor }, mag: 0 });
      return { ...record, ...r.body.pose, parts: r.body.operational.parts.map((p) => [...p]), crew,
        hull: { ...hullIntegrity(r.body.structure) }, partHealth: r.body.structure.entries.map((p) =>
          ({ id: p.id, part: [...p.part], hp: p.hp, maxHp: p.maxHp })),
        pilot: { owner: r.owner, epoch: r.epoch, anchor: { ...r.anchor } } };
    });
  }

  // Walk inputs advance once per admitted tick in the ship frame. Ordinary land inputs stay parked;
  // foreign position changes invalidate support rather than becoming a second pose authority.
  prepare() {
    const w = this.#world, ecs = w.ecs;
    for (const r of [...this.#records.values()]) {
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
      const r = this.#records.get(source.owner), parts = r?.shipId === c.shipId ? r.body.operational.parts : c.ship.grid.parts;
      try { next.push({ c, params, state: this.#walker.step(c.state, active ? c.input : { mx: 0, mz: 0 }, parts, params), ack: active ? c.lastSeq : c.ack }); }
      catch { const own = this.#records.get(c.e); if (own) this.#release(own, 'support'); else this.#removeWalker(c, 'support', true); }
    }
    for (const n of next) if (this.#walkers.get(n.c.e) === n.c) {
      n.c.state = n.state; n.c.params = n.params; n.c.ack = n.ack;
      const own = this.#records.get(n.c.e); if (own) own.anchor = n.state;
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
      if (w.raftDeck.surface(ecs.x[r.owner], ecs.z[r.owner], ecs.y[r.owner])?.id !== r.shipId)
        this.#release(r, 'support');
    }
    for (const c of [...this.#walkers.values()]) if (!this.#onDeck(c.e, c.shipId)) {
      const r = this.#records.get(c.e); if (r) this.#release(r, 'support'); else this.#removeWalker(c, 'support', true);
    }
  }

  #removeWalker(c, why, rescue) {
    this.#walkers.delete(c.e);
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
    if (!r || epoch !== r.epoch) return false;
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
    this.#records.delete(r.owner);
    w.navalTrial.stop(r.handle);
    for (const c of [...this.#walkers.values()]) if (c.shipId === r.shipId) this.#removeWalker(c, why, true);
    if (ecs.clientId[r.owner] === r.clientId) this.#rescue(r.owner);
    for (const e of guests) this.#rescue(e);
    w.raftDeck.update(publicRafts(w));
    w.emit({ type: 'navalPilot', to: r.owner, active: false, epoch: r.epoch, why });
  }

  removeOwner(owner) {
    const r = this.#records.get(owner); if (r) this.#release(r, 'detach');
    for (const c of [...this.#walkers.values()]) if (c.e === owner || c.source.owner === owner) this.#removeWalker(c, 'detach', true);
    for (const [id, permits] of this.#invites) {
      for (const [e, permit] of permits) if (e === owner || permit.owner === owner) permits.delete(e);
      if (!permits.size) this.#invites.delete(id);
    }
  }
  close() {
    for (const r of [...this.#records.values()]) this.#release(r, 'close');
    for (const c of [...this.#walkers.values()]) this.#removeWalker(c, 'close', true);
    this.#invites.clear(); this.#closed = true;
  }
}
