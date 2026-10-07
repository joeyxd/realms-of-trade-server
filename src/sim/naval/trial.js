// A server-owned copy of an active raft, advanced on World ticks. This experiment deliberately does
// not publish a moving ECS pose before the pilot, prediction and moving deck can move together.
import { C, KIND } from '../ecs.js';
import { DT } from '../../data/tuning.js';
import { NAVAL_STEP } from './handling.js';
import { NAVAL_TRIAL as T } from '../../data/navalTrial.js';
import { createTrialBody, stepTrialBody, damageTrialBody } from './trialBody.js';
import { canPlace } from '../economy/raft.js';

const NEUTRAL = Object.freeze({ throttle: 0, brake: 1, steer: 0 });
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const validCommand = (cmd) => cmd && !Array.isArray(cmd) &&
  Object.keys(cmd).length === 4 && ['seq', 'throttle', 'brake', 'steer'].every((key) => Object.hasOwn(cmd, key)) &&
  Number.isInteger(cmd.seq) && cmd.seq > 0 && cmd.seq <= T.maxSequence &&
  ['throttle', 'brake', 'steer'].every((key) => finite(cmd[key])) &&
  cmd.throttle >= 0 && cmd.throttle <= 1 && cmd.brake >= 0 && cmd.brake <= 1 && Math.abs(cmd.steer) <= 1;

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

export class NavalTrial {
  #world;
  #bodies = new Map();
  #handles = new WeakMap();
  #nextInstance = 1;
  #lastTick = -1;
  #closed = false;

  constructor(world) {
    if (!world?.isServer || DT !== NAVAL_STEP) throw new TypeError('Naval trials require server fixed ticks');
    this.#world = world;
  }

  get size() { return this.#bodies.size; }

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
    let body;
    const bodyTick = w.tick + (this.#lastTick === w.tick ? 1 : 0);
    try { body = createTrialBody(source.ship.grid.parts, pose, `trial:${this.#nextInstance}`, bodyTick); }
    catch (error) { if (error instanceof TypeError || error instanceof RangeError) return null; throw error; }
    const handle = Object.freeze({});
    const record = { handle, owner, shipId, source, profile, ship: source.ship, entity: source.entity,
      clientId: ecs.clientId[owner], rev: source.ship.rev, grid: source.ship.grid, parts: source.ship.grid.parts,
      original: source.ship.grid.parts.map((p) => [...p]), pose, body,
      input: NEUTRAL, lastSeq: 0, ack: 0, inputTick: -Infinity, controlActive: false, pendingDamage: [] };
    this.#nextInstance++;
    this.#handles.set(handle, record);
    this.#bodies.set(shipId, record);
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
    const w = this.#world, ecs = w.ecs, { owner, source, ship, entity, pose } = record;
    return !this.#closed && this.#livePlayer(owner) && ecs.clientId[owner] === record.clientId &&
      w.profiles?.get(owner) === record.profile && record.profile.eco?.ships?.includes(ship) &&
      w.rafts?.get(record.shipId) === source && source.owner === owner && source.entity === entity &&
      source.ship === ship && this.#liveShip(entity) && ship.id === record.shipId && ship.kind === 'raft' &&
      ship.at === 'aldea' && ship.hp > 0 && ship.rev === record.rev && ship.grid === record.grid &&
      ship.grid.parts === record.parts && sameParts(ship.grid.parts, record.original) &&
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
    if (!r || r.body.operational.disabled || !validCommand(command) || command.seq <= r.lastSeq) return false;
    r.input = Object.freeze({ throttle: command.throttle, brake: command.brake, steer: command.steer });
    r.lastSeq = command.seq;
    r.inputTick = this.#world.tick;
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
      controlActive: r.controlActive, body: r.body }) : null;
  }

  step() {
    const tick = this.#world.tick;
    if (this.#closed || tick === this.#lastTick) return;
    if (!Number.isSafeInteger(tick) || tick < 0 || tick <= this.#lastTick ||
      (this.#lastTick >= 0 && tick !== this.#lastTick + 1)) throw new TypeError('Nonconsecutive naval World tick');
    const next = [], removed = [];
    for (const r of this.#bodies.values()) {
      if (!this.#valid(r)) { removed.push(r.handle); continue; }
      let body = r.body;
      for (const damage of r.pendingDamage) body = damageTrialBody(body, damage.partId, damage.amount).body;
      const controlActive = !body.operational.disabled && tick - r.inputTick < T.inputTimeoutTicks;
      const input = controlActive ? r.input : NEUTRAL;
      body = stepTrialBody(body, input, T.wind);
      next.push({ record: r, body, controlActive, input, ack: controlActive ? r.lastSeq : r.ack });
    }
    // Commit only after every body has a valid next step. A failed calculation must not consume
    // damage or ACKs, leave half the fleet advanced, or mark the tick as already processed.
    for (const handle of removed) this.stop(handle);
    for (const n of next) {
      const r = n.record;
      r.body = n.body; r.controlActive = n.controlActive; r.input = n.input; r.ack = n.ack;
      r.pendingDamage.length = 0;
    }
    this.#lastTick = tick;
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
