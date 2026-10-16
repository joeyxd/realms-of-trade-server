// Carga uses the existing M5 economic lane. This module builds and checks a candidate only.
import { planAttributeChange } from '../src/sim/systems/attributePlan.js';
import { canonicalText } from './pearlOperations.mjs';

export const attributeMutation = command => command?.type === 'attributes';

export function draftAttributes(profile, command) {
  const planned = planAttributeChange(profile, command);
  return { profile: planned.profile, ack: {
    type: 'attributes', op: command.op, opId: command.opId, ok: planned.ok, why: planned.why,
    rev: planned.profile.eco.tradeRev,
    ...(planned.ok ? { points: planned.points, limits: planned.limits } : {}),
  } };
}

// Exact transition against the locked profile is checked separately by the store.
// The world's only allowed change is its already-owned, monotonic resource checkpoint.
export function attributeWorldTransition(currentWorld, request) {
  if (!attributeMutation(request.command)) return true;
  try {
    const old = structuredClone(currentWorld), next = structuredClone(request.worldData);
    if (old.resources && next.resources) {
      if (!Number.isSafeInteger(next.resources.tick) || next.resources.tick < old.resources.tick) return false;
      old.resources.tick = next.resources.tick;
    }
    if (canonicalText(old) !== canonicalText(next)) return false;
    const planned = draftAttributes(request.before, request.command);
    return canonicalText(planned.profile) === canonicalText(request.profile) &&
      canonicalText(planned.ack) === canonicalText(request.ack);
  } catch { return false; }
}
