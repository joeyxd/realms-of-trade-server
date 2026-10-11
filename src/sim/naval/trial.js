// A server-owned copy of an active raft, advanced on World ticks. This experiment deliberately does
// not publish a moving ECS pose before the pilot, prediction and moving deck can move together.
import { C, KIND } from '../ecs.js';
import { DT } from '../../data/tuning.js';
import { NAVAL_STEP } from './handling.js';
import { NAVAL_TRIAL as T } from '../../data/navalTrial.js';
import { createTrialBody, stepTrialBody, damageTrialBody, parkTrialBody, setTrialCargo, refreshTrialPayload } from './trialBody.js';
import { canPlace } from '../economy/raft.js';
import { hullIntegrity } from './structure.js';
import { createNavalCoast } from './coastGeometry.js';
import { persistRaftCondition } from './condition.js';
import { RAFT, RAFT_PARTS, RAFT_LOAD } from '../../data/raftparts.js';
import { GOODS } from '../../data/goods.js';
import { goodMass } from '../economy/cargo.js';
import { pilotingStatus } from '../systems/progression.js';

const NEUTRAL = Object.freeze({ throttle: 0, brake: 1, steer: 0 });
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const validCommand = (cmd, navigation = false) => cmd && !Array.isArray(cmd) &&
  (Object.keys(cmd).length === 4 || (navigation && Object.keys(cmd).length === 5 && Object.hasOwn(cmd, 'capture'))) &&
  ['seq', 'throttle', 'brake', 'steer'].every((key) => Object.hasOwn(cmd, key)) &&
  Number.isInteger(cmd.seq) && cmd.seq > 0 && cmd.seq <= T.maxSequence &&
  ['throttle', 'brake', 'steer'].every((key) => finite(cmd[key])) &&
  cmd.throttle >= 0 && cmd.throttle <= 1 && cmd.brake >= 0 && cmd.brake <= 1 && Math.abs(cmd.steer) <= 1 &&
  (!Object.hasOwn(cmd, 'capture') || (navigation && typeof cmd.capture === 'boolean'));

function sameParts(parts, original) {
  return Array.isArray(parts) && parts.length === original.length && parts.every((part, i) =>
    Array.isArray(part) && part.length === original[i].length && part.every((value, j) => value === original[i][j]));
}

function validBlueprint(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 600) return false;
  const placed = [];
  for (const part of parts) {
    if (!Array.isArray(part) || (part.length !== 4 && part.length !== 5)) return false;
    const [, x, z, level, dir = 0] = part;
    if (![x, z, level, dir].every(Number.isSafeInteger) || dir < 0 || dir > 3 || canPlace(placed, part)) return false;
    placed.push(part);
  }
  return true;
}

function goodsSignature(goods) {
  if (!goods || typeof goods !== 'object' || Array.isArray(goods)) return '';
  return JSON.stringify(Object.keys(goods).sort().map((id) => [id, goods[id]]));
}

function cargoRows(goods, point) {
  if (!goods || typeof goods !== 'object' || Array.isArray(goods)) throw new TypeError('Invalid voyage cargo');
  return Object.keys(goods).sort().flatMap((id) => {
    const count = goods[id], item = GOODS[id];
    if (!item || !Number.isSafeInteger(count) || count < 0) throw new TypeError('Invalid voyage cargo');
    const mass = goodMass(id) * count;
    return mass > 0 ? [{ mass, x: point.x, z: point.z, height: point.height || 0 }] : [];
  });
}

function crateCenter(parts) {
  const stores = parts.filter((part) => (RAFT_PARTS[part[0]]?.hold || 0) > 0);
  if (!stores.length) return { x: 0, z: 0, height: 0 };
  let total = 0, x = 0, z = 0;
  for (const part of stores) {
    const capacity = RAFT_PARTS[part[0]].hold;
    total += capacity;
    x += (part[1] + 0.5) * RAFT.cell * capacity;
    z += (part[2] + 0.5) * RAFT.cell * capacity;
  }
  return { x: x / total, z: z / total, height: 0 };
}

function localPoint(worldPoint, pose) {
  const dx = worldPoint.x - pose.x, dz = worldPoint.z - pose.z, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

function flowOrigin(map) {
  const d = map?.dock;
  if (!d?.base || !d?.dir || ![d.base.x, d.base.z, d.dir.x, d.dir.z, d.len, d.halfWidth].every(finite))
    throw new TypeError('Navigation needs a dock flow origin');
  const acrossX = -d.dir.z, acrossZ = d.dir.x, side = d.halfWidth + 6, ahead = d.len + 5;
  return Object.freeze({ x: d.base.x + d.dir.x * ahead + acrossX * side,
    z: d.base.z + d.dir.z * ahead + acrossZ * side, yaw: Math.atan2(d.dir.x, d.dir.z) });
}

export class NavalTrial {
  #world;
  #bodies = new Map();
  #handles = new WeakMap();
  #nextInstance = 1;
  #lastTick = -1;
  #closed = false;
  #coast;
  #navigation;
  #flowOrigin;

  constructor(world, { coast = false, navigation = false } = {}) {
    if (!world?.isServer || DT !== NAVAL_STEP) throw new TypeError('Naval trials require server fixed ticks');
    if (typeof coast !== 'boolean' || typeof navigation !== 'boolean') throw new TypeError('Invalid naval trial option');
    this.#world = world;
    this.#coast = coast ? createNavalCoast(world.map) : null;
    this.#navigation = navigation;
    this.#flowOrigin = navigation ? flowOrigin(world.map) : null;
  }

  get size() { return this.#bodies.size; }
  get coast() { return this.#coast ? Object.freeze({ version: 1, seed: this.#coast.seed }) : null; }
  get navigation() { return this.#navigation; }

  // The caller resolves owner from its server session, never from a packet's owner field. The returned
  // capability is an object identity that cannot survive serialization and is invalidated on teardown.
  start(owner, shipId) {
    const w = this.#world, ecs = w.ecs, source = w.rafts?.get(shipId), profile = w.profiles?.get(owner);
    if (this.#closed || this.#bodies.size >= T.maxBodies || this.#bodies.has(shipId) ||
      [...this.#bodies.values()].some((r) => r.owner === owner) || !this.#livePlayer(owner) ||
      !profile || !source?.ship || source.owner !== owner || source.ship.id !== shipId ||
      source.ship.kind !== 'raft' || source.ship.at !== 'aldea' || !(source.ship.hp > 0) ||
      !profile.eco?.ships?.includes(source.ship) || !this.#liveShip(source.entity) ||
      !validBlueprint(source.ship.grid?.parts) || this.#nextInstance >= Number.MAX_SAFE_INTEGER) return null;
    const pose = { x: ecs.x[source.entity], y: ecs.y[source.entity], z: ecs.z[source.entity], yaw: ecs.facing[source.entity] };
    let body, refs = null;
    const bodyTick = w.tick + (this.#lastTick === w.tick ? 1 : 0);
    try {
      if (this.#navigation) {
        const hold = source.ship.hold, pack = profile.eco?.pack;
        if (!hold || !pack || !hold.goods || !pack.goods) return null;
        const pilotPoint = localPoint({ x: ecs.x[owner], z: ecs.z[owner] }, pose);
        const holdCargo = cargoRows(hold.goods, crateCenter(source.ship.grid.parts));
        const packCargo = cargoRows(pack.goods, { ...pilotPoint, height: Math.max(0, Math.min(8, ecs.y[owner] - pose.y)) });
        const payload = w.navalPilot?.payload(shipId) || { crewMass: RAFT_LOAD.crewMass, guestMass: 0 };
        const crewCargo = [{ ...crateCenter(source.ship.grid.parts), mass: payload.crewMass + payload.guestMass }];
        const cargo = [...holdCargo, ...packCargo, ...crewCargo];
        refs = { hold, holdGoods: hold.goods, holdSignature: goodsSignature(hold.goods),
          pack, packGoods: pack.goods, packSignature: goodsSignature(pack.goods),
          holdCargo, packCargo, crewCargo, payloadSignature: JSON.stringify(payload) };
        body = createTrialBody(source.ship.grid.parts, pose, `trial:${this.#nextInstance}`, bodyTick,
          { navigation: true, cargo, flowOrigin: this.#flowOrigin, wind: T.wind, structure: source.condition,
            helmResponse: pilotingStatus(profile.progression).helmResponse });
      } else body = createTrialBody(source.ship.grid.parts, pose, `trial:${this.#nextInstance}`, bodyTick);
    }
    catch (error) { if (error instanceof TypeError || error instanceof RangeError) return null; throw error; }
    const handle = Object.freeze({});
    const record = { handle, owner, shipId, source, profile, ship: source.ship, entity: source.entity,
      clientId: ecs.clientId[owner], rev: source.ship.rev, grid: source.ship.grid, parts: source.ship.grid.parts,
      original: source.ship.grid.parts.map((p) => [...p]), pose, body,
      refs, parked: false, input: NEUTRAL, lastSeq: 0, ack: 0, inputTick: -Infinity, controlActive: false, pendingDamage: [] };
    this.#nextInstance++;
    this.#handles.set(handle, record);
    this.#bodies.set(shipId, record);
    if (this.#navigation) source.condition = body.structure;
    return handle;
  }

  #livePlayer(owner) {
    const ecs = this.#world.ecs;
    return Number.isInteger(owner) && owner > 0 && owner < ecs.cap && ecs.alive[owner] &&
      ecs.kind[owner] === KIND.PLAYER && (ecs.mask[owner] & C.PLAYER) && !(ecs.mask[owner] & C.BOT) &&
      ecs.clientId[owner] >= 0 && ecs.hp[owner] > 0 && !ecs.dead[owner];
  }

  #liveShip(entity) {
    const ecs = this.#world.ecs;
    return ecs.alive[entity] && ecs.kind[entity] === KIND.SHIP && (ecs.mask[entity] & C.VEHICLE);
  }

  #valid(record) {
    const w = this.#world, ecs = w.ecs, { owner, source, ship, entity, pose, profile } = record;
    return !this.#closed && this.#livePlayer(owner) && ecs.clientId[owner] === record.clientId &&
      w.profiles?.get(owner) === record.profile && record.profile.eco?.ships?.includes(ship) &&
      w.rafts?.get(record.shipId) === source && source.owner === owner && source.entity === entity &&
      source.ship === ship && this.#liveShip(entity) && ship.id === record.shipId && ship.kind === 'raft' &&
      ship.at === 'aldea' && ship.hp > 0 && ship.rev === record.rev && ship.grid === record.grid &&
      ship.grid.parts === record.parts && sameParts(ship.grid.parts, record.original) &&
      (!this.#navigation || (record.refs && ship.hold === record.refs.hold && ship.hold.goods === record.refs.holdGoods &&
        goodsSignature(ship.hold.goods) === record.refs.holdSignature && (record.parked ||
          (profile.eco?.pack === record.refs.pack && profile.eco.pack.goods === record.refs.packGoods &&
            goodsSignature(profile.eco.pack.goods) === record.refs.packSignature)))) &&
      ecs.x[entity] === pose.x && ecs.y[entity] === pose.y && ecs.z[entity] === pose.z && ecs.facing[entity] === pose.yaw;
  }

  #resolve(handle) {
    const record = handle && typeof handle === 'object' ? this.#handles.get(handle) : null;
    if (!record) return null;
    if (!this.#valid(record)) { this.stop(handle); return null; }
    return record;
  }

  input(handle, command) {
    const r = this.#resolve(handle);
    if (!r || r.parked || r.body.operational.disabled || !validCommand(command, this.#navigation) || command.seq <= r.lastSeq) return false;
    r.input = Object.freeze({ throttle: command.throttle, brake: command.brake, steer: command.steer,
      ...(Object.hasOwn(command, 'capture') ? { capture: command.capture } : {}) });
    r.lastSeq = command.seq;
    r.inputTick = this.#world.tick;
    return true;
  }

  // Releasing the helm must cancel even a previously queued thrust command. This changes neither
  // sequence nor ACK; the next admitted tick applies braking unless a new valid coast input arrives.
  releaseControl(handle) {
    const r = this.#resolve(handle);
    if (!r) return false;
    r.input = NEUTRAL; r.inputTick = -Infinity;
    return true;
  }

  // Membership changes alter aggregate ballast without healing damage or rewriting inventories.
  // Walking across the deck does not move this ballast in the first operational-load slice.
  refreshPayload(handle) {
    const r = this.#resolve(handle);
    if (!r || !this.#navigation) return false;
    const payload = this.#world.navalPilot?.payload(r.shipId) || { crewMass: RAFT_LOAD.crewMass, guestMass: 0 };
    const signature = JSON.stringify(payload);
    if (signature === r.refs.payloadSignature) return true;
    const crewCargo = [{ ...crateCenter(r.parts), mass: payload.crewMass + payload.guestMass }];
    try { r.body = refreshTrialPayload(r.body, [...r.refs.holdCargo, ...r.refs.packCargo, ...crewCargo]); }
    catch (error) { if (error instanceof TypeError || error instanceof RangeError) return false; throw error; }
    r.refs.crewCargo = crewCargo; r.refs.payloadSignature = signature;
    return true;
  }

  park(handle, parked) {
    const r = this.#resolve(handle);
    if (!r || !this.#navigation || typeof parked !== 'boolean') return false;
    if (r.parked === parked) return true;
    if (!parked) {
      const pack = r.profile.eco?.pack;
      if (!pack?.goods) return false;
      try {
        const ecs = this.#world.ecs;
        const point = localPoint({ x: ecs.x[r.owner], z: ecs.z[r.owner] }, r.body.pose);
        const carriedCargo = cargoRows(pack.goods, { ...point, height: Math.max(0, Math.min(8, ecs.y[r.owner] - r.body.pose.y)) });
        const cargo = [...r.refs.holdCargo, ...carriedCargo, ...r.refs.crewCargo];
        r.body = setTrialCargo(r.body, cargo);
        r.refs.pack = pack; r.refs.packGoods = pack.goods; r.refs.packSignature = goodsSignature(pack.goods);
        r.refs.packCargo = carriedCargo;
      } catch (error) { if (error instanceof TypeError || error instanceof RangeError) return false; throw error; }
    }
    r.parked = parked;
    r.body = parkTrialBody(r.body, parked);
    r.input = NEUTRAL; r.inputTick = -Infinity; r.controlActive = false;
    if (!parked) { r.lastSeq = 0; r.ack = 0; }
    return true;
  }

  // Internal damage is staged until the World boundary, just like axes. It never changes profile HP,
  // the saved blueprint, holds or production. Real combat and durable loss are separate later cuts.
  queueDamage(handle, partId, amount) {
    const r = this.#resolve(handle);
    if (!r || !finite(amount) || amount <= 0 || amount > 1e6 || r.pendingDamage.length >= T.maxPendingDamage ||
      !r.body.structure.entries.some((entry) => entry.id === partId && entry.hp > 0)) return false;
    r.pendingDamage.push(Object.freeze({ partId, amount }));
    return true;
  }

  snapshot(handle) {
    const r = this.#resolve(handle);
    return r ? Object.freeze({ shipId: r.shipId, owner: r.owner, ack: r.ack,
      controlActive: r.controlActive, ...(this.#navigation ? { parked: r.parked } : {}), body: r.body }) : null;
  }

  step() {
    const tick = this.#world.tick;
    if (this.#closed) return;
    if (!Number.isSafeInteger(tick) || tick < 0 || tick < this.#lastTick)
      throw new TypeError('Invalid naval World tick');
    if (tick === this.#lastTick) return;
    if (this.#bodies.size === 0) { this.#lastTick = tick; return; }
    if (tick <= this.#lastTick ||
      (this.#lastTick >= 0 && tick !== this.#lastTick + 1)) throw new TypeError('Nonconsecutive naval World tick');
    const next = [], removed = [];
    for (const r of this.#bodies.values()) {
      if (!this.#valid(r)) { removed.push(r.handle); continue; }
      let body = r.body;
      for (const damage of r.pendingDamage) body = damageTrialBody(body, damage.partId, damage.amount).body;
      const controlActive = !r.parked && !body.operational.disabled && tick - r.inputTick < T.inputTimeoutTicks;
      const input = controlActive ? r.input : NEUTRAL;
      const priorResultUntil = body.activity?.resultUntil || 0;
      body = stepTrialBody(body, input, T.wind, this.#coast, { parked: r.parked });
      const routePlan = this.#navigation ? this.#world.navalRoute?.plan(r.owner, r.shipId, body) : null;
      if (routePlan) body = routePlan.body;
      const lessonPlan = this.#navigation ? this.#world.navalLesson?.plan(r.owner, r.shipId, body) : null;
      next.push({ record: r, body, routePlan, lessonPlan, controlActive, input, ack: controlActive ? r.lastSeq : r.ack,
        confirmedEvent: this.#navigation && body.activity?.resultUntil > priorResultUntil ? body.activity.result : '' });
    }
    // Commit only after every body has a valid next step. A failed calculation must not consume
    // damage or ACKs, leave half the fleet advanced, or mark the tick as already processed.
    for (const handle of removed) this.stop(handle);
    for (const n of next) {
      const r = n.record;
      r.body = n.body; r.controlActive = n.controlActive; r.input = n.input; r.ack = n.ack;
      if (this.#navigation) {
        const changed = r.source.condition !== n.body.structure;
        r.source.condition = n.body.structure;
        if (changed) { persistRaftCondition(r.source); this.#world.profileDirty?.add(r.owner); }
      }
      r.pendingDamage.length = 0;
    }
    for (const n of next) this.#world.navalRoute?.commit(n.routePlan);
    for (const n of next) this.#world.navalLesson?.commit(n.lessonPlan);
    this.#lastTick = tick;
    // Feedback follows the all-body commit. Prediction computes the same physics but emits nothing.
    for (const n of next) for (const impact of [...n.body.impacts, ...(n.routePlan?.impacts || [])]) if (impact.damage > 0) {
      const recipients = this.#world.navalPilot?.recipients(n.record.shipId) || [n.record.owner];
      const piece = n.body.structure.entries.find((p) => p.id === impact.partId);
      for (const to of recipients) this.#world.emit({ type: 'navalImpact', to, shipId: n.record.shipId, ...impact,
        partType: piece?.part[0] || null, partHp: piece?.hp ?? null, partMaxHp: piece?.maxHp ?? null,
        hull: { ...hullIntegrity(n.body.structure) } });
    }
    for (const n of next) if (n.confirmedEvent) {
      const recipients = this.#world.navalPilot?.recipients(n.record.shipId) || [n.record.owner];
      for (const to of recipients) this.#world.emit({ type: 'navalGust', to, shipId: n.record.shipId,
        tick: n.body.state.tick, event: n.confirmedEvent, gust: n.body.gust, activity: n.body.activity });
    }
  }

  stop(handle) {
    const r = handle && typeof handle === 'object' ? this.#handles.get(handle) : null;
    if (!r) return false;
    this.#handles.delete(handle);
    this.#bodies.delete(r.shipId);
    r.pendingDamage.length = 0;
    r.input = NEUTRAL;
    return true;
  }

  removeOwner(owner) {
    for (const r of this.#bodies.values()) if (r.owner === owner) this.stop(r.handle);
  }

  close() {
    for (const r of this.#bodies.values()) this.stop(r.handle);
    this.#closed = true;
  }
}
