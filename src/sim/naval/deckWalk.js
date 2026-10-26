// Fixed-step walking on one moving raft, expressed in the raft's local frame.
// The caller owns attachment to the world pose; this engine only resolves deck locomotion.
import { C, ECS, KIND } from '../ecs.js';
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
import { DT, tuning } from '../../data/tuning.js';
import { RaftDeck } from '../raftGeometry.js';
import { stepMover } from '../systems/movement.js';
import { doorKey } from './shelter.js';

const OFFSET_Y = 0.72;
const LIMIT = 256;
const own = (value, fields) => value && typeof value === 'object' &&
  fields.every((key) => Object.hasOwn(value, key));
const finite = (value) => Number.isFinite(value);

function validate(state, axes, parts, params) {
  if (!own(state, ['x', 'y', 'z', 'f', 'vx', 'vz', 'mag']) ||
      !['x', 'y', 'z', 'f', 'vx', 'vz', 'mag'].every((key) => finite(state[key])) ||
      Math.abs(state.x) > LIMIT || Math.abs(state.z) > LIMIT || state.y < -1 || state.y > 32 ||
      Math.abs(state.vx) > 50 || Math.abs(state.vz) > 50 || state.mag < 0 || state.mag > 1)
    throw new TypeError('invalid deck walk state');
  if (!own(axes, ['mx', 'mz']) || !finite(axes.mx) || !finite(axes.mz) ||
      Math.abs(axes.mx) > 1 || Math.abs(axes.mz) > 1) throw new TypeError('invalid deck walk axes');
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 600 || parts.some((part) =>
    !Array.isArray(part) || (part.length !== 4 && part.length !== 5) ||
    typeof part[0] !== 'string' || !RAFT_PARTS[part[0]] ||
    !Number.isInteger(part[1]) || Math.abs(part[1]) > 128 ||
    !Number.isInteger(part[2]) || Math.abs(part[2]) > 128 ||
    !Number.isInteger(part[3]) || part[3] < 0 || part[3] > 8 ||
    (part.length === 5 && (!Number.isInteger(part[4]) || part[4] < 0 || part[4] > 3))))
    throw new TypeError('invalid operational raft parts');
  if (!own(params, ['speed', 'radius']) || !finite(params.speed) || params.speed < 0 || params.speed > 50 ||
      !finite(params.radius) || params.radius < 0.05 || params.radius > 2) throw new TypeError('invalid deck walk params');
  if (params.openDoors !== undefined && (!Array.isArray(params.openDoors) || params.openDoors.length > 600 ||
      params.openDoors.some((part) => !doorKey(part) || !parts.some((p) => doorKey(p) === doorKey(part)))))
    throw new TypeError('invalid open deck doors');
}

function virtualMap() {
  return {
    half: LIMIT + 2,
    groundAt: () => -100,
    onDock: () => false,
    colliders: [],
    queryColliders: () => [],
  };
}

export class DeckWalkEngine {
  #ecs;
  #world;
  #entity;

  constructor() {
    this.#ecs = new ECS(2);
    this.#entity = this.#ecs.create(KIND.PLAYER, C.POS | C.MOVER | C.DASH | C.HEALTH);
    const map = virtualMap();
    this.#world = { ecs: this.#ecs, map, raftDeck: new RaftDeck(map) };
  }

  // Invalid arguments throw TypeError. State and all nested input are read-only;
  // a successful call returns a new frozen state in raft-local coordinates.
  step(state, axes, parts, params) {
    validate(state, axes, parts, params);
    const e = this.#entity, ecs = this.#ecs;
    const raft = { id: 'deck-walk', x: 0, y: OFFSET_Y, z: 0, yaw: 0, rev: 0, parts, openDoors: params.openDoors || [] };
    this.#world.raftDeck.update([raft]);
    const support = this.#world.raftDeck.surface(state.x, state.z, state.y + OFFSET_Y);
    if (!support || Math.abs(support.y - (state.y + OFFSET_Y)) >= 0.6 ||
        this.#world.raftDeck.blocked(state.x, state.z, support.y, params.radius))
      throw new TypeError('deck walk state must have clear raft support');

    ecs.x[e] = state.x; ecs.y[e] = state.y + OFFSET_Y; ecs.z[e] = state.z;
    ecs.facing[e] = state.f; ecs.vx[e] = state.vx; ecs.vz[e] = state.vz;
    ecs.speed[e] = params.speed; ecs.radius[e] = params.radius;
    ecs.moveMag[e] = state.mag;
    ecs.wade[e] = 0; ecs.moveMul[e] = 1; ecs.faceLock[e] = 0;
    ecs.kbx[e] = ecs.kbz[e] = 0; ecs.dead[e] = ecs.stagger[e] = ecs.castLock[e] = 0;
    ecs.dashT[e] = -1; ecs.dashBuffer[e] = 0; ecs.dashCharges[e] = ecs.dashMax[e] = 0;
    ecs.iframes[e] = 0;

    stepMover(this.#world, e, {
      mx: axes.mx, mz: axes.mz, ax: state.x, az: state.z, btn: 0, prs: 0,
    }, DT);
    const resultY = ecs.y[e] - OFFSET_Y;
    const resultSupport = this.#world.raftDeck.surface(ecs.x[e], ecs.z[e], ecs.y[e]);
    if (!finite(resultY) || !resultSupport || this.#world.raftDeck.blocked(ecs.x[e], ecs.z[e], resultSupport.y, params.radius))
      throw new TypeError('deck walk result lost raft support');
    return Object.freeze({ x: ecs.x[e], y: resultY, z: ecs.z[e],
      f: ecs.facing[e], vx: ecs.vx[e], vz: ecs.vz[e], mag: ecs.moveMag[e] });
  }
}

// The land body is authoritative; only its moving frame is stored on the raft.
import { pilotLocal, pilotPoint } from './pilotGeometry.js';

const vectors = [['vx', 'vz'], ['kbx', 'kbz'], ['dashDirX', 'dashDirZ']];
export function readDeckState(ecs, e, pose) {
  const state = { ...pilotLocal(pose, { x: ecs.x[e], y: ecs.y[e], z: ecs.z[e], f: ecs.facing[e] }), mag: ecs.moveMag[e] };
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  for (const [x, z] of vectors) { state[x] = c * ecs[x][e] - s * ecs[z][e]; state[z] = s * ecs[x][e] + c * ecs[z][e]; }
  return Object.freeze(state);
}

export function poseDeckState(ecs, e, pose, state) {
  const p = pilotPoint(pose, state), c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  // The jump peak is an absolute height on the real body, not a second jump machine.
  ecs.jmpPeak[e] += p.y - ecs.y[e];
  ecs.x[e] = p.x; ecs.y[e] = p.y; ecs.z[e] = p.z; ecs.facing[e] = p.f;
  for (const [x, z] of vectors) { ecs[x][e] = c * state[x] + s * state[z]; ecs[z][e] = -s * state[x] + c * state[z]; }
  ecs.moveMag[e] = state.mag;
}
