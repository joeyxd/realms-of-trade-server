import { BTN } from '../../src/sim/systems/movement.js';
import { tuning } from '../../src/data/tuning.js';
import { validCombat } from './contract.mjs';

const copy = (value) => structuredClone(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const time = (value) => Number.isSafeInteger(value) && value >= 0;
const positionOk = (value) => value && finite(value.x) && finite(value.y) && finite(value.z);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const living = (entity) => entity && entity.kind === 'enemy' && finite(entity.hp) && entity.hp > 0 &&
  positionOk(entity.position) && entity.ref && Number.isSafeInteger(entity.ref.entityId) && typeof entity.ref.life === 'string';
const nullInput = () => ({ mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
const unit = (x, z) => {
  const length = Math.hypot(x, z);
  return length > 0 ? { mx: x / length, mz: z / length } : { mx: 0, mz: 0 };
};

function validateArgs(args, position, nowMs, blockedAfterMs, minProgress) {
  const keys = ['mode', 'protect', 'retreatHpFraction', 'allowPotion', 'durationMs'];
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(args, key)) || !positionOk(position) || !time(nowMs) ||
      !Number.isSafeInteger(blockedAfterMs) || blockedAfterMs < 1 || !finite(minProgress) || minProgress <= 0) {
    throw new TypeError('invalid PvE body origin');
  }
  if (!['aggressive', 'defensive', 'support'].includes(args.mode) ||
      !finite(args.retreatHpFraction) || args.retreatHpFraction < 0.1 || args.retreatHpFraction > 0.8 ||
      typeof args.allowPotion !== 'boolean' || !Number.isSafeInteger(args.durationMs) || args.durationMs < 1 ||
      (args.mode === 'support' ? !args.protect || typeof args.protect !== 'object' || Array.isArray(args.protect) ||
        Object.keys(args.protect).length !== 2 || !Object.hasOwn(args.protect, 'entityId') || !Object.hasOwn(args.protect, 'life') ||
        !Number.isSafeInteger(args.protect.entityId) ||
        args.protect.entityId < 0 || typeof args.protect.life !== 'string' || !args.protect.life.length || args.protect.life.length > 128 : args.protect !== null)) {
    throw new TypeError('invalid PvE body arguments');
  }
}

// A deterministic controller that only returns ordinary game input bits and axes.
export class PveBody {
  #args;
  #startedAtMs;
  #lastNowMs;
  #blockedAfterMs;
  #minProgress;
  #anchor;
  #position;
  #observedAtMs;
  #status = 'holding';
  #why = null;
  #target = null;
  #distance = null;
  #attackSuppressed = false;
  #retreating = false;
  #lastAttackAtMs = -Infinity;
  #lastPotionAtMs = -Infinity;
  #potionSignature = null;
  #watchActive = false;
  #watchPosition = null;
  #watchSinceMs = null;
  #lastStepMoving = false;
  #lastOutput = nullInput();

  constructor({ args, position, nowMs, blockedAfterMs = 1500, minProgress = 0.15 } = {}) {
    validateArgs(args, position, nowMs, blockedAfterMs, minProgress);
    this.#args = copy(args);
    this.#startedAtMs = nowMs;
    this.#lastNowMs = nowMs;
    this.#blockedAfterMs = blockedAfterMs;
    this.#minProgress = minProgress;
    this.#anchor = copy(position);
    this.#position = copy(position);
    this.#observedAtMs = nowMs;
  }

  get snapshot() {
    return copy({ mode: this.#args.mode, status: this.#status, why: this.#why,
      target: this.#target, protect: this.#args.protect, position: this.#position,
      distance: this.#distance, attackSuppressed: this.#attackSuppressed, observedAtMs: this.#observedAtMs });
  }

  #clock(nowMs) {
    if (!time(nowMs) || nowMs < this.#lastNowMs) throw new TypeError('nonmonotonic PvE body clock');
    this.#lastNowMs = nowMs;
  }

  #terminal() { return this.#status === 'blocked' || this.#status === 'cancelled'; }

  #stop(status, why) {
    this.#status = status;
    this.#why = why;
    this.#lastStepMoving = false;
    this.#watchActive = false;
    this.#watchPosition = null;
    this.#watchSinceMs = null;
    this.#lastOutput = nullInput();
  }

  #findProtect(entities) {
    const wanted = this.#args.protect;
    if (!wanted) return null;
    return entities.find((entity) => entity?.kind === 'player' && entity.hp > 0 && positionOk(entity.position) &&
      entity.ref?.entityId === wanted.entityId && entity.ref?.life === wanted.life) ?? null;
  }

  #pickEnemy(entities, center, maxFromSelf, maxFromCenter = Infinity) {
    return entities.filter(living).filter((entity) => distance(this.#position, entity.position) <= maxFromSelf &&
      distance(center, entity.position) <= maxFromCenter)
      .sort((a, b) => distance(this.#position, a.position) - distance(this.#position, b.position) ||
        a.ref.entityId - b.ref.entityId || (a.ref.life < b.ref.life ? -1 : a.ref.life > b.ref.life ? 1 : 0))[0] ?? null;
  }

  #direction(to, away = false) {
    const out = unit(away ? this.#position.x - to.x : to.x - this.#position.x,
      away ? this.#position.z - to.z : to.z - this.#position.z);
    if (away && out.mx === 0 && out.mz === 0) return { mx: 1, mz: 0 };
    return out;
  }

  step(confirmed, nowMs, { emit = false } = {}) {
    this.#clock(nowMs);
    if (this.#terminal()) return { ...nullInput(), body: this.snapshot };
    if (nowMs - this.#startedAtMs >= this.#args.durationMs) {
      this.#stop('cancelled', 'duration_elapsed');
      return { ...nullInput(), body: this.snapshot };
    }
    if (!positionOk(confirmed?.self?.position) || !finite(confirmed.self.hp) || !finite(confirmed.self.maxHp) || confirmed.self.maxHp <= 0 ||
        confirmed.self.hp < 0 || confirmed.self.hp > confirmed.self.maxHp || typeof confirmed.self.dead !== 'boolean' ||
        confirmed.self.dead !== (confirmed.self.hp === 0) || !Array.isArray(confirmed.entities) || !confirmed.combat ||
        typeof confirmed.combat !== 'object') {
      this.#stop('cancelled', 'combat_observation_missing');
      return { ...nullInput(), body: this.snapshot };
    }
    const combat = confirmed.combat;
    if (!validCombat(combat)) {
      this.#stop('cancelled', 'combat_observation_missing');
      return { ...nullInput(), body: this.snapshot };
    }
    if (confirmed.self.dead || confirmed.self.hp <= 0) {
      this.#stop('cancelled', 'dead');
      return { ...nullInput(), body: this.snapshot };
    }
    if (combat.weapon !== 0) {
      this.#stop('cancelled', 'unsupported_weapon');
      return { ...nullInput(), body: this.snapshot };
    }
    const canGuard = combat.stagger === 0 && combat.castLock === 0 &&
      (combat.guardRaised ? combat.guardStamina > 0 : combat.guardStamina >= tuning.guard.minRaise);

    const position = copy(confirmed.self.position);
    this.#position = position;
    this.#observedAtMs = nowMs;
    const entities = confirmed.entities;
    const protect = this.#findProtect(entities);
    if (this.#args.mode === 'support' && !protect) {
      this.#stop('cancelled', 'protect_unavailable');
      return { ...nullInput(), body: this.snapshot };
    }
    if (this.#watchActive && distance(position, this.#watchPosition) >= this.#minProgress) {
      this.#watchPosition = copy(position);
      this.#watchSinceMs = nowMs;
    }

    const healthFraction = confirmed.self.hp / confirmed.self.maxHp;
    if (healthFraction <= this.#args.retreatHpFraction) this.#retreating = true;
    else if (healthFraction >= Math.min(0.95, this.#args.retreatHpFraction + 0.1)) this.#retreating = false;

    let target = null;
    let destination = null;
    let destinationDistance = null;
    let moving = false;
    let guarding = false;
    let status = 'holding';
    let why = null;
    let targetAllowed = false;

    if (this.#retreating) {
      target = this.#pickEnemy(entities, position, 24);
      const threat = target;
      if (threat) {
        const d = distance(position, threat.position);
        if (d < 6) {
          const away = this.#direction(threat.position, true);
          destination = { x: position.x + away.mx * (6 - d + 1), y: position.y, z: position.z + away.mz * (6 - d + 1) };
          moving = true;
          status = 'retreating';
        }
        guarding = canGuard;
      }
      why = 'low_health';
    } else if (this.#args.mode === 'aggressive') {
      const anchorDistance = distance(position, this.#anchor);
      if (anchorDistance > 12) {
        destination = this.#anchor;
        destinationDistance = anchorDistance;
        moving = true;
        status = 'following';
        why = 'leash_return';
      } else {
        target = this.#pickEnemy(entities, this.#anchor, 12, 12);
        if (target) {
          destination = target.position;
          destinationDistance = distance(position, target.position);
          guarding = canGuard;
          if (destinationDistance > 1.7) { moving = true; status = 'approaching'; }
          else { status = 'attacking'; targetAllowed = !combat.playerNearby; }
        }
      }
    } else if (this.#args.mode === 'defensive') {
      target = entities.filter(living).filter((entity) => distance(position, entity.position) <= 5 || distance(this.#anchor, entity.position) <= 5)
        .sort((a, b) => distance(position, a.position) - distance(position, b.position) ||
          a.ref.entityId - b.ref.entityId || (a.ref.life < b.ref.life ? -1 : a.ref.life > b.ref.life ? 1 : 0))[0] ?? null;
      if (target) {
        destination = target.position;
        destinationDistance = distance(position, target.position);
        guarding = destinationDistance <= 4 && canGuard;
        if (destinationDistance <= 1.7) { status = 'attacking'; targetAllowed = !combat.playerNearby; }
        else if (guarding) status = 'guarding';
      }
    } else {
      const center = protect.position;
      target = this.#pickEnemy(entities, center, 12, 6);
      if (target) {
        destination = target.position;
        destinationDistance = distance(position, target.position);
        const threatDistance = distance(center, target.position);
        const scale = threatDistance > 0 ? Math.min(2, threatDistance) / threatDistance : 0;
        const intercept = { x: center.x + (target.position.x - center.x) * scale,
          y: position.y, z: center.z + (target.position.z - center.z) * scale };
        const interceptDistance = distance(position, intercept);
        guarding = canGuard;
        if (destinationDistance <= 1.7 && !combat.playerNearby) { status = 'attacking'; targetAllowed = true; }
        else if (interceptDistance > 0.5) {
          destination = intercept;
          destinationDistance = interceptDistance;
          moving = true;
          status = 'approaching';
        } else if (guarding) status = 'guarding';
      } else {
        const protectDistance = distance(position, center);
        if (protectDistance > 3) {
          destination = center;
          destinationDistance = protectDistance;
          moving = true;
          status = 'following';
        }
      }
    }

    this.#target = target ? copy(target.ref) : null;
    if (destinationDistance === null && destination) destinationDistance = distance(position, destination);
    this.#distance = destinationDistance;
    this.#attackSuppressed = Boolean(target && (!targetAllowed || combat.attackStage !== 0 || combat.stagger !== 0 || combat.castLock !== 0 ||
      nowMs - this.#lastAttackAtMs < (this.#args.mode === 'defensive' ? 800 : 450)));

    if (this.#watchActive && nowMs - this.#watchSinceMs >= this.#blockedAfterMs && moving) {
      this.#stop('blocked', 'no_observed_progress');
      return { ...nullInput(), body: this.snapshot };
    }

    let output = nullInput();
    const aimAt = target?.position ?? protect?.position ?? destination ?? this.#anchor;
    output.ax = aimAt.x;
    output.az = aimAt.z;
    output.btn |= BTN.AIM;
    if (moving && destination) {
      const direction = this.#direction(destination);
      output.mx = direction.mx;
      output.mz = direction.mz;
    }
    if (guarding) output.btn |= BTN.GUARD;

    const attackReady = targetAllowed && combat.attackStage === 0 && combat.stagger === 0 && combat.castLock === 0 &&
      nowMs - this.#lastAttackAtMs >= (this.#args.mode === 'defensive' ? 800 : 450);
    if (attackReady && emit) {
      output.btn &= ~BTN.GUARD;
      output.prs |= BTN.ATTACK;
      this.#lastAttackAtMs = nowMs;
      this.#attackSuppressed = false;
    }
    const potionSignature = `${combat.potions}:${combat.potionCooldown}`;
    const potionReady = this.#args.allowPotion && healthFraction <= this.#args.retreatHpFraction &&
      combat.potions >= 1 && combat.potionCooldown <= 0 && potionSignature !== this.#potionSignature &&
      nowMs - this.#lastPotionAtMs >= 1000;
    if (potionReady && emit) {
      output.prs |= BTN.POTION;
      this.#lastPotionAtMs = nowMs;
      this.#potionSignature = potionSignature;
    }

    if (!moving && guarding && status === 'holding') status = 'guarding';
    this.#status = status;
    this.#why = why;
    this.#lastStepMoving = moving && (output.mx !== 0 || output.mz !== 0);
    if (!this.#lastStepMoving) {
      this.#watchActive = false;
      this.#watchPosition = null;
      this.#watchSinceMs = null;
    }
    this.#lastOutput = copy(output);
    return { ...output, body: this.snapshot };
  }

  emitted(nowMs) {
    this.#clock(nowMs);
    if (this.#terminal() || !this.#lastStepMoving || (this.#lastOutput.mx === 0 && this.#lastOutput.mz === 0)) return this.snapshot;
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
