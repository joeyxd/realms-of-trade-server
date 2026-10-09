import { MOVEMENT_TYPES } from './contract.mjs';
export { MOVEMENT_TYPES };

const copy = (value) => structuredClone(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const validTime = (value) => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const validPosition = (value) => exact(value, ['x', 'y', 'z']) &&
  finite(value.x) && finite(value.y) && finite(value.z);
const distance2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const neutral = () => ({ mx: 0, mz: 0 });

function unit(x, z) {
  const length = Math.hypot(x, z);
  return length > 0 ? { mx: x / length, mz: z / length } : { mx: 0, mz: 0 };
}

function validateTask(type, args, position, nowMs, blockedAfterMs, minProgress) {
  if (!MOVEMENT_TYPES.includes(type)) throw new TypeError('invalid movement type');
  if (!validPosition(position) || !validTime(nowMs)) throw new TypeError('invalid movement origin');
  if (!Number.isSafeInteger(blockedAfterMs) || blockedAfterMs < 1 ||
      !finite(minProgress) || minProgress <= 0) throw new TypeError('invalid movement watchdog');

  if (!Number.isSafeInteger(args?.durationMs) || args.durationMs < 1 ||
      !finite(args?.tolerance) || args.tolerance < 0) throw new TypeError('invalid movement arguments');
  if (type === 'go_to') {
    if (!exact(args, ['x', 'z', 'tolerance', 'durationMs']) || !finite(args.x) || !finite(args.z)) {
      throw new TypeError('invalid go_to arguments');
    }
  } else {
    if (!exact(args, ['target', 'distance', 'tolerance', 'durationMs']) ||
        !exact(args.target, ['entityId', 'life']) || !Number.isSafeInteger(args.target.entityId) ||
        args.target.entityId < 0 || typeof args.target.life !== 'string' || !args.target.life.length ||
        args.target.life.length > 128 || !finite(args.distance) || args.distance < 0) {
      throw new TypeError('invalid target movement arguments');
    }
  }
}

// A deterministic planar controller. It emits ordinary normalized movement axes and
// judges progress only from later confirmed self positions after an input was emitted.
export class MovementTask {
  #type;
  #args;
  #startedAtMs;
  #lastNowMs;
  #blockedAfterMs;
  #minProgress;
  #status = 'holding';
  #why = null;
  #distance = null;
  #position;
  #destination = null;
  #observedAtMs;
  #watchActive = false;
  #watchPosition = null;
  #watchSinceMs = null;
  #lastStepMoving = false;

  constructor({ type, args, position, nowMs, blockedAfterMs = 1500, minProgress = 0.15 } = {}) {
    validateTask(type, args, position, nowMs, blockedAfterMs, minProgress);
    this.#type = type;
    this.#args = copy(args);
    this.#startedAtMs = nowMs;
    this.#lastNowMs = nowMs;
    this.#blockedAfterMs = blockedAfterMs;
    this.#minProgress = minProgress;
    this.#position = copy(position);
    this.#observedAtMs = nowMs;
    if (type === 'go_to') {
      this.#destination = { x: args.x, z: args.z };
      this.#distance = distance2d(position, this.#destination);
    }
  }

  get snapshot() {
    return copy({ status: this.#status, why: this.#why, distance: this.#distance,
      position: this.#position, destination: this.#destination, observedAtMs: this.#observedAtMs });
  }

  #clock(nowMs) {
    if (!validTime(nowMs) || nowMs < this.#lastNowMs) throw new TypeError('nonmonotonic movement clock');
    this.#lastNowMs = nowMs;
  }

  #terminal() { return ['arrived', 'blocked', 'cancelled'].includes(this.#status); }

  #stop(status, why) {
    this.#status = status;
    this.#why = why;
    this.#lastStepMoving = false;
    this.#watchActive = false;
    this.#watchPosition = null;
    this.#watchSinceMs = null;
  }

  #target(confirmed) {
    if (!Array.isArray(confirmed?.entities)) return null;
    return confirmed.entities.find((entity) => entity?.ref?.entityId === this.#args.target.entityId &&
      entity?.ref?.life === this.#args.target.life && entity.kind === 'player' && entity.hp !== 0 && validPosition(entity.position)) ?? null;
  }

  #direction(position, destination, away = false) {
    const dx = away ? position.x - destination.x : destination.x - position.x;
    const dz = away ? position.z - destination.z : destination.z - position.z;
    const direction = unit(dx, dz);
    // Coincident points have no radial direction. Pick a fixed axis for a stable escape.
    return away && direction.mx === 0 && direction.mz === 0 ? { mx: 1, mz: 0 } : direction;
  }

  step(confirmed, nowMs) {
    this.#clock(nowMs);
    if (this.#terminal()) return { ...neutral(), navigation: this.snapshot };
    if (nowMs - this.#startedAtMs >= this.#args.durationMs) {
      this.#stop('cancelled', 'duration_elapsed');
      return { ...neutral(), navigation: this.snapshot };
    }

    if (!validPosition(confirmed?.self?.position)) throw new TypeError('invalid confirmed self position');
    const position = copy(confirmed.self.position);
    this.#position = position;
    this.#observedAtMs = nowMs;

    let destination;
    let distance;
    let away = false;
    if (this.#type === 'go_to') {
      destination = { x: this.#args.x, z: this.#args.z };
      distance = distance2d(position, destination);
      if (distance <= this.#args.tolerance) {
        this.#destination = destination;
        this.#distance = distance;
        this.#stop('arrived', 'within_tolerance');
        return { ...neutral(), navigation: this.snapshot };
      }
    } else {
      const target = this.#target(confirmed);
      if (!target) {
        this.#stop('cancelled', 'target_unavailable');
        return { ...neutral(), navigation: this.snapshot };
      }
      destination = { x: target.position.x, z: target.position.z };
      distance = distance2d(position, destination);
      const lower = Math.max(0, this.#args.distance - this.#args.tolerance);
      const upper = this.#args.distance + this.#args.tolerance;
      if (this.#type === 'follow') {
        if (distance <= upper) {
          this.#destination = destination;
          this.#distance = distance;
          this.#stop('holding', null);
          return { ...neutral(), navigation: this.snapshot };
        }
      } else if (distance < lower) {
        away = true;
      } else if (distance <= upper) {
        this.#destination = destination;
        this.#distance = distance;
        this.#stop('holding', null);
        return { ...neutral(), navigation: this.snapshot };
      }
    }

    this.#destination = destination;
    this.#distance = distance;
    if (this.#watchActive && distance2d(position, this.#watchPosition) >= this.#minProgress) {
      this.#watchPosition = copy(position);
      this.#watchSinceMs = nowMs;
    }
    if (this.#watchActive && nowMs - this.#watchSinceMs >= this.#blockedAfterMs) {
      this.#stop('blocked', 'no_observed_progress');
      return { ...neutral(), navigation: this.snapshot };
    }

    this.#status = 'moving';
    this.#why = null;
    this.#lastStepMoving = true;
    const direction = this.#direction(position, destination, away);
    return { ...direction, navigation: this.snapshot };
  }

  emitted(nowMs) {
    this.#clock(nowMs);
    if (this.#terminal() || this.#status !== 'moving' || !this.#lastStepMoving) return this.snapshot;
    if (nowMs - this.#startedAtMs >= this.#args.durationMs) {
      this.#stop('cancelled', 'duration_elapsed');
      return this.snapshot;
    }
    if (!this.#watchActive) {
      this.#watchActive = true;
      this.#watchPosition = copy(this.#position);
      this.#watchSinceMs = nowMs;
    }
    return this.snapshot;
  }

  cancel(why = 'cancelled') {
    if (!this.#terminal()) this.#stop('cancelled', typeof why === 'string' && why.length ? why : 'cancelled');
    return this.snapshot;
  }
}
