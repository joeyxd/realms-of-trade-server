// Session-only swimming state. Shared by authority and prediction; no clocks or economic writes.
import { tuning } from '../../data/tuning.js';
import { C, STATE, ACT } from '../ecs.js';
import { holdMass } from '../economy/cargo.js';

export const canSwim = (ecs, e) => !!(ecs.mask[e] & C.PLAYER) && !(ecs.mask[e] & C.BOT);
export const swimLoadOf = (profile) => Math.max(0, Math.min(1, holdMass(profile?.eco?.pack) / tuning.swim.heavyMass));

export function swimmingAt(world, x, z, y) {
  return !world.map.onDock(x, z) && !world.raftDeck?.surface(x, z, y) &&
    tuning.world.waterLevel - world.map.groundAt(x, z) > tuning.world.wadeMax;
}

export function refreshSwimming(world, e) {
  const s = world.ecs;
  const airborne = s.castK[e] > 0 && s.act[e] === ACT.LEAP;
  const wet = canSwim(s, e) && !s.dead[e] && !airborne && swimmingAt(world, s.x[e], s.z[e], s.y[e]);
  s.swim[e] = wet ? 1 : 0;
  if (wet) {
    s.y[e] = tuning.world.waterLevel - tuning.swim.bodyDepth;
    s.wade[e] = tuning.swim.bodyDepth;
    s.state[e] = STATE.SWIM;
    s.dashT[e] = -1; s.dashBuffer[e] = 0; s.iframes[e] = 0;
  } else if (s.state[e] === STATE.SWIM) s.state[e] = STATE.MOVE;
  return wet;
}

export function recoverSwimming(s, e, dt) {
  s.swim[e] = 0; s.swimDrown[e] = 0;
  s.swimStamina[e] = Math.min(tuning.swim.stamina, s.swimStamina[e] + tuning.swim.recovery * dt);
  if (s.state[e] === STATE.SWIM) s.state[e] = STATE.MOVE;
}

// Return whole damage pulses, so rounding/minimum damage in hurtPlayer is never applied per tick.
export function stepSwimming(world, e, dt) {
  const s = world.ecs, S = tuning.swim;
  if (!canSwim(s, e) || s.dead[e]) return 0;
  if (!s.swim[e]) { recoverSwimming(s, e, dt); return 0; }
  const drain = (s.moveMag[e] > 0.05 ? S.drain : S.idleDrain) * (1 + s.swimLoad[e]);
  const prior = s.swimStamina[e];
  s.swimStamina[e] = Math.max(0, prior - dt * drain);
  if (s.swimStamina[e] > 0) { s.swimDrown[e] = 0; return 0; }
  const before = s.swimDrown[e];
  // Only the fraction after exhaustion belongs to the drowning timer.
  s.swimDrown[e] += Math.max(0, dt - prior / drain);
  const pulses = (t) => Math.max(0, Math.floor((t - S.grace + 1e-9) / S.damageEvery));
  return pulses(s.swimDrown[e]) - pulses(before);
}
