// Opt-in client prediction for the bounded naval pilot trial. This module owns no transport or UI.
import { NAVAL_TRIAL } from '../data/navalTrial.js';
import { stepTrialBody } from '../sim/naval/trialBody.js';
import { angleDelta, wrapAngle } from '../core/math.js';
import { createNavalCoast } from '../sim/naval/coastGeometry.js';
import { hullIntegrity } from '../sim/naval/structure.js';

const MAX_PENDING = 240;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const neutralAxes = Object.freeze({ throttle: 0, brake: 1, steer: 0 });

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function validAnchor(anchor) {
  return anchor && ['x', 'y', 'z', 'f'].every((key) => finite(anchor[key]));
}

function validBody(body) {
  return body && body.structure && body.operational && body.state && body.pose &&
    Number.isSafeInteger(body.state.tick) && body.state.tick >= 0 &&
    ['x', 'y', 'z', 'yaw'].every((key) => finite(body.pose[key])) &&
    ['x', 'z', 'yaw', 'vx', 'vz', 'omega'].every((key) => finite(body.state[key]));
}

function validAxes(axes) {
  return axes && !Array.isArray(axes) && (Object.keys(axes).length === 3 ||
    (Object.keys(axes).length === 4 && Object.hasOwn(axes, 'capture'))) &&
    ['throttle', 'brake', 'steer'].every((key) => finite(axes[key])) &&
    axes.throttle >= 0 && axes.throttle <= 1 && axes.brake >= 0 && axes.brake <= 1 &&
    axes.steer >= -1 && axes.steer <= 1 && (!Object.hasOwn(axes, 'capture') || typeof axes.capture === 'boolean');
}

function wrapPose(pose) {
  return { x: pose.x, y: pose.y, z: pose.z, yaw: wrapAngle(pose.yaw) };
}

export class NavalPilotPrediction {
  constructor(map = null) {
    this.map = map;
    this.coast = null;
    this.epoch = 0;
    this.active = false;
    this.seq = 0;
    this.ack = 0;
    this.body = null;
    this.anchor = null;
    this.shipId = null;
    this.wind = null;
    this.authorityTick = -1;
    this.pending = [];
    this.prevPose = null;
  }

  receive(state) {
    return this.acceptSnapshot(state) === 'accepted';
  }

  acceptSnapshot(state) {
    if (!state || !Number.isSafeInteger(state.epoch) || state.epoch < 0 || typeof state.active !== 'boolean') return 'rejected';
    if (state.epoch < this.epoch) return 'rejected';

    if (!state.active) {
      if (state.epoch === this.epoch && !this.active) return 'duplicate';
      this.epoch = state.epoch;
      this.active = false;
      this.body = null;
      this.anchor = null;
      this.shipId = null;
      this.wind = null;
      this.coast = null;
      this.authorityTick = -1;
      this.pending = [];
      this.prevPose = null;
      this.seq = 0;
      this.ack = 0;
      return 'accepted';
    }

    if (state.epoch === 0 || !Number.isSafeInteger(state.ack) || state.ack < 0 ||
        state.ack > NAVAL_TRIAL.maxSequence || !validBody(state.body) || !validAnchor(state.anchor) ||
        (typeof state.shipId !== 'string' && !Number.isSafeInteger(state.shipId)) || state.shipId === '' ||
        !state.wind || !finite(state.wind.yaw) || !finite(state.wind.strength) || state.wind.strength < 0 || state.wind.strength > 1) return 'rejected';
    if (state.epoch === this.epoch) {
      if (!this.active || state.ack < this.ack || state.body.state.tick < this.authorityTick) return 'rejected';
      if (!!this.coast !== (state.coast != null)) return 'rejected';
    }

    let body, anchor, wind, coast = null;
    try {
      if (state.coast != null) {
        if (state.coast.version !== 1 || !this.map || state.coast.seed !== this.map.seed ||
          Object.keys(state.coast).length !== 2) return 'rejected';
        coast = createNavalCoast(this.map);
      }
      body = deepFreeze(clone(state.body));
      anchor = deepFreeze({ x: state.anchor.x, y: state.anchor.y, z: state.anchor.z, f: state.anchor.f });
      wind = deepFreeze({ yaw: state.wind.yaw, strength: state.wind.strength });
      // Validate nested rig/structure data with the real deterministic step without committing it.
      stepTrialBody(body, neutralAxes, wind, coast);
    } catch { return 'rejected'; }

    // A duplicate body anchor is a valid heartbeat. Validate its complete nested body above, then
    // leave the current prediction untouched so callers can still accept other snapshot fields.
    if (state.epoch === this.epoch && state.ack === this.ack && state.body.state.tick === this.authorityTick)
      return 'duplicate';

    const newEpoch = state.epoch > this.epoch;
    const previous = !newEpoch && this.body ? wrapPose(this.body.pose) : wrapPose(body.pose);
    let pending = newEpoch ? [] : this.pending.filter((command) => command.seq > state.ack);
    try {
      for (const command of pending) if (command.advance) body = stepTrialBody(body, command, wind, coast);
    } catch { return 'rejected'; }

    this.epoch = state.epoch;
    this.active = true;
    this.ack = state.ack;
    this.authorityTick = state.body.state.tick;
    this.body = body;
    this.anchor = anchor;
    this.shipId = state.shipId;
    this.wind = wind;
    this.coast = coast;
    this.pending = pending;
    this.seq = newEpoch ? state.ack : Math.max(this.seq, state.ack);
    this.prevPose = previous;
    return 'accepted';
  }

  step(axes) {
    if (!this.active || !this.body || !validAxes(axes) || this.seq >= NAVAL_TRIAL.maxSequence) return null;
    const command = Object.freeze({ epoch: this.epoch, seq: this.seq + 1,
      throttle: axes.throttle, brake: axes.brake, steer: axes.steer,
      ...(Object.hasOwn(axes, 'capture') ? { capture: axes.capture } : {}) });
    let next;
    try { next = stepTrialBody(this.body, command, this.wind, this.coast); } catch { return null; }
    this.prevPose = wrapPose(this.body.pose);
    this.body = next;
    this.seq = command.seq;
    this.pending.push({ ...command, advance: true });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return command;
  }

  neutral() {
    if (!this.active || !this.body || this.seq >= NAVAL_TRIAL.maxSequence) return null;
    const command = Object.freeze({ epoch: this.epoch, seq: this.seq + 1, ...neutralAxes });
    this.seq = command.seq;
    this.pending.push({ ...command, advance: false });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return command;
  }

  pose(alpha = 1) {
    if (!this.active || !this.body) return null;
    const t = clamp01(finite(alpha) ? alpha : 1), a = this.prevPose || this.body.pose, b = this.body.pose;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t, yaw: wrapAngle(a.yaw + angleDelta(a.yaw, b.yaw) * t) };
  }

  position(alpha = 1) {
    const pose = this.pose(alpha), anchor = this.anchor;
    if (!pose || !anchor) return null;
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    return { x: pose.x + c * anchor.x + s * anchor.z, y: pose.y + anchor.y,
      z: pose.z - s * anchor.x + c * anchor.z, f: wrapAngle(pose.yaw + anchor.f) };
  }

  project(records, alpha = 1) {
    if (!Array.isArray(records)) return [];
    if (!this.active || !this.body) return records.slice();
    const pose = this.pose(alpha);
    return records.map((record) => record && record.id === this.shipId
      ? { ...record, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw,
        parts: this.body.operational.parts.map((p) => [...p]), hull: { ...hullIntegrity(this.body.structure) },
        partHealth: this.body.structure.entries.map((p) => ({ id: p.id, part: [...p.part], hp: p.hp, maxHp: p.maxHp })) }
      : record);
  }
}
