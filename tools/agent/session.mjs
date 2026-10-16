import { labLimits, validGrant, validObservation, validateOrder, validEvidence, sameScope, integer, canonicalJson, MOVEMENT_TYPES } from './contract.mjs';
import { MovementTask } from './movement-task.mjs';
import { PveBody } from './pve-body.mjs';

const closed = new Set(['confirmed', 'rejected', 'cancelled']);
const neutral = () => ({ mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });

// No transport, physical simulation, provider, or implicit retry lives in this controller.
export class AgentSession {
  #grant; #limits; #source; #observation = null; #actions = new Map(); #active = null; #running = true; #lastNow = 0; #reason = null;
  #movement = null; #body = null;
  constructor({ grant, limits = {}, source = 'fixture' }) {
    if (!validGrant(grant)) throw new TypeError('invalid grant');
    if (!['fixture', 'server'].includes(source)) throw new TypeError('invalid evidence source');
    this.#source = source;
    this.#grant = structuredClone(grant);
    this.#limits = labLimits(limits);
  }
  #clock(nowMs) {
    if (!integer(nowMs) || nowMs < this.#lastNow) throw new TypeError('nonmonotonic lab clock');
    this.#lastNow = nowMs;
  }
  get grant() { return structuredClone(this.#grant); }
  get observation() { return structuredClone(this.#observation); }
  get actions() { return [...this.#actions.values()].map((v) => structuredClone(v)); }
  #cancel(action, why) {
    if (!action || closed.has(action.state)) return;
    // Already sent inputs may have applied effects even if no receipt arrived.
    action.state = action.inputRange ? 'uncertain' : 'cancelled';
    action.why = why;
    if (this.#active === action.order.actionId) {
      if (this.#movement) {
        this.#movement.cancel(why);
        action.navigation = { ...action.navigation, ...this.#movement.snapshot,
          observedAtMs: action.navigation.observedAtMs };
      }
      if (this.#body) {
        this.#body.cancel(why);
        action.body = { ...action.body, ...this.#body.snapshot, observedAtMs: action.body.observedAtMs };
      }
      this.#movement = this.#body = null; this.#active = null;
    }
  }
  interrupt(reason, nowMs) {
    this.#clock(nowMs);
    if (!['death', 'disconnect', 'stop', 'revoked', 'expired'].includes(reason)) throw new TypeError('invalid interruption');
    if (!this.#running) return { state: 'stopped', reason: this.#reason, input: neutral(), actions: this.actions };
    for (const a of this.#actions.values()) this.#cancel(a, reason);
    this.#running = false;
    this.#reason = reason;
    this.#observation = null;
    this.#grant.controlRevision++;
    return { state: 'stopped', reason, input: neutral(), actions: this.actions };
  }
  stop(ownerId, nowMs) {
    if (ownerId !== this.#grant.scope.ownerId) return { ok: false, why: 'owner_mismatch' };
    return { ok: true, ...this.interrupt('stop', nowMs) };
  }
  cancel(actionId, nowMs, why = 'cancelled') {
    this.#clock(nowMs);
    if (!['cancelled', 'target_unavailable', 'superseded'].includes(why)) throw new TypeError('invalid cancellation');
    const action = this.#actions.get(actionId);
    if (!action) return { ok: false, why: 'unknown_action' };
    this.#cancel(action, why);
    return { ok: true, action: structuredClone(action) };
  }
  observe(observation, nowMs) {
    this.#clock(nowMs);
    if (!this.#running) return { ok: false, why: 'stopped' };
    if (!validObservation(observation, this.#limits, this.#source)) return { ok: false, why: 'invalid_observation' };
    if (!sameScope(observation.scope, this.#grant.scope) || observation.controlRevision !== this.#grant.controlRevision) return { ok: false, why: 'control_mismatch' };
    if (observation.receivedAtMs > nowMs || nowMs - observation.receivedAtMs > this.#limits.maxObservationAgeMs ||
        (this.#observation && (observation.revision <= this.#observation.revision || observation.tick < this.#observation.tick))) return { ok: false, why: 'stale_observation' };
    if (nowMs >= this.#grant.expiresAtMs) { this.interrupt('expired', nowMs); return { ok: false, why: 'authorization_expired' }; }
    this.#observation = structuredClone(observation);
    if (observation.confirmed.self.dead) { this.interrupt('death', nowMs); return { ok: false, why: 'dead' }; }
    const active = this.#actions.get(this.#active);
    if (active?.navigation) this.#movementStep(active, nowMs);
    if (active?.body) this.#bodyStep(active, nowMs);
    if (active?.order.type === 'attack_pve') {
      const target = active.order.args.target;
      if (!observation.confirmed.entities.some((e) => e.kind === 'enemy' && e.hp !== 0 && e.ref.entityId === target.entityId && e.ref.life === target.life)) this.#cancel(active, 'target_unavailable');
    }
    return { ok: true, revision: observation.revision, source: this.#source };
  }
  accept(order, nowMs) {
    this.#clock(nowMs);
    const existing = this.#actions.get(order?.actionId);
    if (existing) {
      try {
        if (canonicalJson(existing.order) !== canonicalJson(order)) return { ok: false, why: 'action_id_conflict' };
      } catch { return { ok: false, why: 'invalid_order' }; }
      return { ok: true, replay: true, action: structuredClone(existing) };
    }
    if (!this.#running) return { ok: false, why: 'stopped' };
    const check = validateOrder(order, { grant: this.#grant, observation: this.#observation, nowMs, limits: this.#limits, source: this.#source });
    if (!check.ok) return check;
    if (this.#actions.size >= this.#limits.maxActions) return { ok: false, why: 'action_capacity' };
    this.#cancel(this.#actions.get(this.#active), 'superseded');
    const a = { order: structuredClone(order), state: 'accepted', why: null, acceptedAtMs: nowMs, observationTick: this.#observation.tick,
      inputRange: null, inputAck: null, effects: [], result: null, pulseEmitted: false };
    this.#actions.set(order.actionId, a);
    this.#active = order.actionId;
    if (MOVEMENT_TYPES.includes(order.type)) {
      this.#movement = new MovementTask({ type: order.type, args: order.args,
        position: this.#observation.confirmed.self.position, nowMs,
        blockedAfterMs: this.#limits.movementBlockedAfterMs, minProgress: this.#limits.movementMinProgressMm / 1000 });
      this.#movementStep(a, nowMs);
    }
    if (order.type === 'body_pve') {
      this.#body = new PveBody({ args: order.args, position: this.#observation.confirmed.self.position, nowMs,
        blockedAfterMs: this.#limits.movementBlockedAfterMs, minProgress: this.#limits.movementMinProgressMm / 1000 });
      this.#bodyStep(a, nowMs);
    }
    return { ok: true, replay: false, action: structuredClone(a) };
  }
  markSent(actionId, inputRange, nowMs) {
    this.#clock(nowMs);
    const a = this.#actions.get(actionId);
    if (!a || this.#active !== actionId || !this.#running || closed.has(a.state) || a.state === 'uncertain') return { ok: false, why: 'inactive_action' };
    if (nowMs >= this.#grant.expiresAtMs || nowMs >= a.acceptedAtMs + a.order.args.durationMs ||
        !this.#observation || nowMs - this.#observation.receivedAtMs > this.#limits.maxObservationAgeMs) {
      this.#cancel(a, 'emission_expired'); return { ok: false, why: 'emission_expired' };
    }
    if (!inputRange || Object.keys(inputRange).length !== 2 || !integer(inputRange.first) || !integer(inputRange.last) ||
        inputRange.first > inputRange.last || (a.inputRange && inputRange.first !== a.inputRange.last + 1)) return { ok: false, why: 'invalid_input_range' };
    a.inputRange = { first: a.inputRange?.first ?? inputRange.first, last: inputRange.last };
    a.state = 'sent';
    if (this.#movement) this.#movement.emitted(nowMs);
    if (this.#body) this.#body.emitted(nowMs);
    return { ok: true, action: structuredClone(a) };
  }
  acknowledge(actionId, sequence) {
    const a = this.#actions.get(actionId);
    if (!a?.inputRange || !integer(sequence) || sequence < a.inputRange.first || sequence > a.inputRange.last) return { ok: false, why: 'invalid_ack' };
    a.inputAck = Math.max(a.inputAck ?? 0, sequence);
    return { ok: true, action: structuredClone(a) };
  }
  step(nowMs) {
    this.#clock(nowMs);
    if (this.#running && nowMs >= this.#grant.expiresAtMs) this.interrupt('expired', nowMs);
    const a = this.#actions.get(this.#active);
    if (!this.#running || !a) return neutral();
    if (!this.#observation || nowMs - this.#observation.receivedAtMs > this.#limits.maxObservationAgeMs) { this.#cancel(a, 'stale_observation'); return neutral(); }
    if (nowMs >= a.acceptedAtMs + a.order.args.durationMs) {
      if (a.navigation || a.body) { this.#cancel(a, 'duration_elapsed'); return neutral(); }
      if (!a.inputRange) this.#cancel(a, 'not_sent');
      else if (nowMs >= a.acceptedAtMs + a.order.args.durationMs + this.#limits.resultTimeoutMs) this.#cancel(a, 'result_timeout');
      return neutral();
    }
    const args = a.order.args;
    const input = neutral();
    if (a.body) {
      const next = this.#bodyStep(a, nowMs, true);
      if (a.inputRange && this.#active === a.order.actionId) a.state = 'executing';
      const { body, ...command } = next;
      return command;
    }
    if (a.navigation) {
      const next = this.#movementStep(a, nowMs);
      if (a.inputRange && this.#active === a.order.actionId) a.state = 'executing';
      return { ...input, mx: next.mx, mz: next.mz };
    }
    if (a.order.type === 'move') { input.mx = args.mx; input.mz = args.mz; }
    if (a.order.type === 'aim') { input.ax = args.ax; input.az = args.az; }
    if (a.order.type === 'attack_pve') {
      const target = this.#observation.confirmed.entities.find((e) => e.ref.entityId === args.target.entityId && e.ref.life === args.target.life);
      if (!target) { this.#cancel(a, 'target_unavailable'); return neutral(); }
      input.ax = target.position.x; input.az = target.position.z;
      if (!a.pulseEmitted) { input.prs = 2; a.pulseEmitted = true; }
    }
    if (a.inputRange) a.state = 'executing';
    return input;
  }
  #movementStep(action, nowMs) {
    const next = this.#movement.step(this.#observation.confirmed, nowMs);
    action.navigation = { ...next.navigation, observedAtMs: this.#observation.receivedAtMs,
      observationTick: this.#observation.tick, source: this.#source };
    if (['blocked', 'cancelled'].includes(next.navigation.status)) this.#cancel(action, next.navigation.why);
    return next;
  }
  #bodyStep(action, nowMs, emit = false) {
    const next = this.#body.step(this.#observation.confirmed, nowMs, { emit });
    action.body = { ...next.body, observedAtMs: this.#observation.receivedAtMs,
      observationTick: this.#observation.tick, source: this.#source };
    if (['blocked', 'cancelled'].includes(next.body.status)) this.#cancel(action, next.body.why);
    return next;
  }
  recordEvidence(evidence) {
    if (!validEvidence(evidence, this.#source)) return { ok: false, why: 'invalid_evidence' };
    const a = this.#actions.get(evidence.actionId);
    const observedWithoutMovement = a?.order.type === 'go_to' && a.navigation?.status === 'arrived' &&
      evidence.code === 'destination_observed' && evidence.outcome === 'confirmed';
    if (!a || (!a.inputRange && !observedWithoutMovement) || !sameScope(evidence.scope, a.order.scope) || evidence.controlRevision !== a.order.controlRevision ||
        evidence.tick < a.observationTick) return { ok: false, why: 'evidence_mismatch' };
    const previous = a.effects.find((e) => e.evidenceId === evidence.evidenceId) || (a.result?.evidenceId === evidence.evidenceId ? a.result : null);
    if (previous) return canonicalJson(previous) === canonicalJson(evidence) ? { ok: true, replay: true, action: structuredClone(a) } : { ok: false, why: 'evidence_id_conflict' };
    if (closed.has(a.state)) return { ok: false, why: 'result_closed' };
    if (evidence.outcome === 'partial') {
      if (a.effects.length >= this.#limits.maxEffects) return { ok: false, why: 'effect_capacity' };
      a.effects.push(structuredClone(evidence));
    } else {
      a.result = structuredClone(evidence);
      a.state = evidence.outcome;
      // A late receipt resolves uncertainty, but never restarts cancelled input.
      if (this.#active === evidence.actionId) { this.#active = null; this.#movement = this.#body = null; }
    }
    return { ok: true, replay: false, action: structuredClone(a) };
  }
}

// Preserve the explicitly fixture-only L00 API.
export class AgentLabSession extends AgentSession {
  constructor(options) { super({ ...options, source: 'fixture' }); }
}
