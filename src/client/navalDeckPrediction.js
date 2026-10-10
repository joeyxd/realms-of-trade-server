// Bounded client prediction for walking on a moving raft. No transport or UI ownership.
import { NAVAL_TRIAL } from '../data/navalTrial.js';
import { DeckWalkEngine } from '../sim/naval/deckWalk.js';
import { pilotPoint } from '../sim/naval/pilotGeometry.js';
import { angleDelta, wrapAngle } from '../core/math.js';

const MAX_PENDING = 240;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const neutralAxes = Object.freeze({ mx: 0, mz: 0 });

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validState(state) {
  return state && ['x', 'y', 'z', 'f', 'vx', 'vz', 'mag'].every((key) => finite(state[key]));
}

function validAxes(axes) {
  return axes && typeof axes === 'object' && !Array.isArray(axes) && Object.keys(axes).length === 2 &&
    finite(axes.mx) && finite(axes.mz) && Math.abs(axes.mx) <= 1 && Math.abs(axes.mz) <= 1;
}

function wrapState(state) {
  return { x: state.x, y: state.y, z: state.z, f: wrapAngle(state.f) };
}

function validShipId(id) {
  return (typeof id === 'string' && id.length > 0) || Number.isSafeInteger(id);
}

export class NavalDeckPrediction {
  constructor(engine = new DeckWalkEngine()) {
    if (!engine || typeof engine.step !== 'function') throw new TypeError('Deck walk engine is required');
    this.engine = engine;
    this.epoch = 0;
    this.active = false;
    this.seq = 0;
    this.ack = 0;
    this.authorityTick = -1;
    this.shipId = null;
    this.state = null;
    this.parts = null;
    this.params = null;
    this.pending = [];
    this.prevState = null;
  }

  acceptSnapshot(snapshot) {
    if (!snapshot || !Number.isSafeInteger(snapshot.epoch) || snapshot.epoch < 0 ||
        typeof snapshot.active !== 'boolean' || snapshot.epoch < this.epoch) return 'rejected';

    if (!snapshot.active) {
      if (snapshot.epoch === this.epoch && !this.active) return 'duplicate';
      this.#clear(snapshot.epoch);
      return 'accepted';
    }

    if (snapshot.epoch === 0 || snapshot.mode !== 'walk' || !Number.isSafeInteger(snapshot.ack) ||
        snapshot.ack < 0 || snapshot.ack > NAVAL_TRIAL.maxSequence ||
        !Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0 || !validShipId(snapshot.shipId) ||
        !validState(snapshot.state) || !Array.isArray(snapshot.parts) || !snapshot.params ||
        !finite(snapshot.params.speed) || snapshot.params.speed < 0 ||
        !finite(snapshot.params.radius) || snapshot.params.radius <= 0) return 'rejected';

    const newEpoch = snapshot.epoch > this.epoch;
    if (!newEpoch && (!this.active || snapshot.ack < this.ack || snapshot.tick < this.authorityTick || snapshot.ack > this.seq))
      return 'rejected';

    let state, parts, params;
    try {
      state = deepFreeze(clone(snapshot.state));
      parts = deepFreeze(clone(snapshot.parts));
      params = deepFreeze({ speed: snapshot.params.speed, radius: snapshot.params.radius,
        openDoors: clone(snapshot.params.openDoors || []) });
      // Validate nested deck data through the same deterministic engine used for prediction.
      this.engine.step(state, neutralAxes, parts, params);
    } catch { return 'rejected'; }

    // A door can change between ticks without changing the rig or the deck membership epoch.
    // Reconcile outstanding inputs against the new collision data even with the same tick/ACK.
    if (!newEpoch && snapshot.epoch === this.epoch && snapshot.ack === this.ack && snapshot.tick === this.authorityTick &&
        JSON.stringify(parts) === JSON.stringify(this.parts) && JSON.stringify(params) === JSON.stringify(this.params))
      return 'duplicate';

    const previous = newEpoch || !this.state ? wrapState(state) : wrapState(this.state);
    let pending = newEpoch ? [] : this.pending.filter((command) => command.seq > snapshot.ack);
    try {
      for (const command of pending) {
        if (command.advance) state = this.engine.step(state, { mx: command.mx, mz: command.mz }, parts, params);
      }
    } catch { return 'rejected'; }

    this.epoch = snapshot.epoch;
    this.active = true;
    this.ack = snapshot.ack;
    this.authorityTick = snapshot.tick;
    this.shipId = snapshot.shipId;
    this.state = state;
    this.parts = parts;
    this.params = params;
    this.pending = pending;
    this.seq = newEpoch ? snapshot.ack : Math.max(this.seq, snapshot.ack);
    this.prevState = previous;
    return 'accepted';
  }

  step(axes) {
    if (!this.active || !this.state || !validAxes(axes) || this.seq >= NAVAL_TRIAL.maxSequence) return null;
    const command = Object.freeze({ epoch: this.epoch, seq: this.seq + 1, mx: axes.mx, mz: axes.mz });
    let next;
    try { next = this.engine.step(this.state, axes, this.parts, this.params); } catch { return null; }
    if (!validState(next)) return null;
    this.prevState = wrapState(this.state);
    this.state = deepFreeze(next);
    this.seq = command.seq;
    this.pending.push({ ...command, advance: true });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return command;
  }

  neutral() {
    if (!this.active || !this.state || this.seq >= NAVAL_TRIAL.maxSequence) return null;
    const command = Object.freeze({ epoch: this.epoch, seq: this.seq + 1, ...neutralAxes });
    this.seq = command.seq;
    this.pending.push({ ...command, advance: false });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return command;
  }

  #clear(epoch) {
    this.epoch = epoch;
    this.active = false;
    this.seq = 0;
    this.ack = 0;
    this.authorityTick = -1;
    this.shipId = null;
    this.state = null;
    this.parts = null;
    this.params = null;
    this.pending = [];
    this.prevState = null;
  }

  position(raftPose, alpha = 1) {
    if (!this.active || !this.state || !raftPose || !['x', 'y', 'z', 'yaw'].every((key) => finite(raftPose[key]))) return null;
    const t = finite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    const a = this.prevState || this.state, b = this.state;
    const local = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      f: wrapAngle(a.f + angleDelta(a.f, b.f) * t),
    };
    return pilotPoint(raftPose, local);
  }
}
