// Opt-in pilot experiment. The saved mooring remains canonical; only a transient public projection
// and its attached pilot sail. Promotion to public voyages must replace this return-to-dock policy.
import { C, KIND } from '../ecs.js';
import { RAFT } from '../../data/raftparts.js';
import { NAVAL_TRIAL } from '../../data/navalTrial.js';
import { pilotLocal, pilotPoint } from './pilotGeometry.js';
import { publicRafts } from '../systems/rafts.js';

export class NavalPilot {
  #world;
  #records = new Map();
  #epochs = new Map();
  #nextEpoch = 1;
  #closed = false;

  constructor(world) {
    if (!world?.isServer || !world.navalTrial) throw new TypeError('Pilot trial requires naval authority');
    this.#world = world;
  }

  get size() { return this.#records.size; }
  has(owner) { return this.#records.has(owner); }

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
        this.#guests(shipId, owner).length || this.#nextEpoch >= Number.MAX_SAFE_INTEGER) return false;
    const handle = w.navalTrial.start(owner, shipId);
    if (!handle) return false;
    const snapshot = w.navalTrial.snapshot(handle), epoch = this.#nextEpoch++;
    const anchor = pilotLocal(snapshot.body.pose, { x: ecs.x[owner], y: ecs.y[owner], z: ecs.z[owner], f: ecs.facing[owner] });
    this.#records.set(owner, { owner, shipId, handle, epoch, anchor, body: snapshot.body, ack: 0, clientId: ecs.clientId[owner] });
    this.#epochs.set(owner, epoch);
    ecs.vx[owner] = ecs.vz[owner] = ecs.kbx[owner] = ecs.kbz[owner] = 0;
    ecs.moveMag[owner] = 0;
    w.raftDeck.update(publicRafts(w));
    return true;
  }

  input(owner, command) {
    const r = this.#records.get(owner);
    if (!r || !command || command.epoch !== r.epoch || Object.keys(command).length !== 5) return false;
    const { epoch, ...axes } = command;
    return this.#world.navalTrial.input(r.handle, axes);
  }

  snapshot(owner) {
    // Heartbeats while M5 holds a tick must be read-only. Source invalidation happens in prepare,
    // never from the transport's snapshot callback; publish only the last committed pilot anchor.
    const r = this.#records.get(owner);
    return r ? Object.freeze({ epoch: r.epoch, active: true, shipId: r.shipId, ack: r.ack,
      body: r.body, anchor: r.anchor, wind: NAVAL_TRIAL.wind }) :
      Object.freeze({ epoch: this.#epochs.get(owner) || 0, active: false });
  }

  project(records) {
    return records.map((record) => {
      const r = this.#records.get(record.owner);
      if (!r || r.shipId !== record.id) return record;
      return { ...record, ...r.body.pose, parts: r.body.operational.parts.map((p) => [...p]),
        pilot: { owner: r.owner, epoch: r.epoch, anchor: { ...r.anchor } } };
    });
  }

  // Check before trial preparation. Land input is parked, so a foreign position change is a loss
  // of the seat rather than another movement authority. Guests are a later, separate contract.
  prepare() {
    const w = this.#world, ecs = w.ecs;
    for (const r of [...this.#records.values()]) {
      const s = w.navalTrial.snapshot(r.handle), p = pilotPoint(r.body.pose, r.anchor);
      if (!s || ecs.hp[r.owner] <= 0 || ecs.dead[r.owner] || this.#guests(r.shipId, r.owner).length ||
          Math.hypot(ecs.x[r.owner] - p.x, ecs.y[r.owner] - p.y, ecs.z[r.owner] - p.z) > 0.05 ||
          Math.abs(Math.atan2(Math.sin(ecs.facing[r.owner] - p.f), Math.cos(ecs.facing[r.owner] - p.f))) > 0.05)
        this.#release(r, 'seat');
    }
  }

  #allowed(body) {
    const w = this.#world, limit = w.map.half - 2;
    for (const part of body.operational.parts) if (part[0] === 'foundation') {
      for (const dx of [0, RAFT.cell]) for (const dz of [0, RAFT.cell]) {
        const p = pilotPoint(body.pose, { x: part[1] * RAFT.cell + dx, y: 0, z: part[2] * RAFT.cell + dz, f: 0 });
        if (Math.abs(p.x) > limit || Math.abs(p.z) > limit || w.map.groundAt(p.x, p.z) > 0.15) return false;
      }
    }
    return true;
  }

  sync() {
    const w = this.#world, ecs = w.ecs;
    for (const r of [...this.#records.values()]) {
      const s = w.navalTrial.snapshot(r.handle);
      if (!s || s.body.operational.disabled || !this.#allowed(s.body)) { this.#release(r, 'boundary'); continue; }
      r.body = s.body;
      r.ack = s.ack;
      const p = pilotPoint(r.body.pose, r.anchor);
      ecs.x[r.owner] = p.x; ecs.y[r.owner] = p.y; ecs.z[r.owner] = p.z; ecs.facing[r.owner] = p.f;
      ecs.vx[r.owner] = ecs.vz[r.owner] = ecs.kbx[r.owner] = ecs.kbz[r.owner] = 0;
      ecs.moveMag[r.owner] = 0;
    }
    w.raftDeck.update(publicRafts(w));
    for (const r of [...this.#records.values()]) {
      if (w.raftDeck.surface(ecs.x[r.owner], ecs.z[r.owner], ecs.y[r.owner])?.id !== r.shipId)
        this.#release(r, 'support');
    }
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
    if (ecs.clientId[r.owner] === r.clientId) this.#rescue(r.owner);
    for (const e of guests) this.#rescue(e);
    w.raftDeck.update(publicRafts(w));
    w.emit({ type: 'navalPilot', to: r.owner, active: false, epoch: r.epoch, why });
  }

  removeOwner(owner) { const r = this.#records.get(owner); if (r) this.#release(r, 'detach'); }
  close() { for (const r of [...this.#records.values()]) this.#release(r, 'close'); this.#closed = true; }
}
