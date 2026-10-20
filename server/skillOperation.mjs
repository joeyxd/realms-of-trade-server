// Skill points use the existing M5 economic lane. This module builds and checks a candidate only.
import { planSkillChange } from '../src/sim/systems/skillPlan.js';
import { canonicalText } from './pearlOperations.mjs';

export const skillMutation = command => command?.type === 'skills';

export function draftSkills(profile, command) {
  const planned = planSkillChange(profile, command);
  return { profile: planned.profile, ack: {
    type: 'skills', op: command.op, opId: command.opId, ok: planned.ok, why: planned.why,
    rev: planned.profile.eco.tradeRev,
  } };
}

// Exact transition against the locked profile is checked separately by the store.
// The world's only allowed change is its already-owned, monotonic resource checkpoint.
export function skillWorldTransition(currentWorld, request) {
  if (!skillMutation(request.command)) return true;
  try {
    const old = structuredClone(currentWorld), next = structuredClone(request.worldData);
    if (old.resources && next.resources) {
      if (!Number.isSafeInteger(next.resources.tick) || next.resources.tick < old.resources.tick) return false;
      old.resources.tick = next.resources.tick;
    }
    if (canonicalText(old) !== canonicalText(next)) return false;
    const planned = draftSkills(request.before, request.command);
    return canonicalText(planned.profile) === canonicalText(request.profile) &&
      canonicalText(planned.ack) === canonicalText(request.ack);
  } catch { return false; }
}

// Every other economic writer keeps node ranks, resets, grants and the peaceful practice
// counters (all but logging) byte-equal; only a skills receipt may change the first three.
const frozenSkillState = profile => {
  const p = profile?.progression, practice = { ...(p?.practice ?? {}) };
  delete practice.logging;
  return { skills: p?.skills ?? null, skr: p?.skr ?? null, skg: p?.skg ?? null, practice };
};
export function skillStatePreserved(before, after) {
  return canonicalText(frozenSkillState(before)) === canonicalText(frozenSkillState(after));
}
