// Durable receipt transition for bounded fire fuel changes.
import { fireClockSeconds } from '../src/data/fire.js';
export { fireMutation, fireProfileDelta } from '../src/sim/systems/fireProfile.js';
import { fireProfileDelta } from '../src/sim/systems/fireProfile.js';

const clone = structuredClone;
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function sameWorldExceptResourceTick(current, requested) {
  if (!current || !requested || typeof current !== 'object' || typeof requested !== 'object') return false;
  const a = clone(current), b = clone(requested);
  if (a.resources && b.resources) {
    const at = a.resources.tick, bt = b.resources.tick;
    a.resources.tick = 0; b.resources.tick = 0;
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(bt) || bt < at) return false;
  }
  return same(a, b);
}

export function fireWorldTransition(current, request) {
  try {
    if (!request || request.command?.type !== 'fire' || !sameWorldExceptResourceTick(current, request.worldData)) return false;
    if (!request.ack?.ok) return same(request.before, request.profile);
    const nowSec = fireClockSeconds(current.economy.hours);
    const result = fireProfileDelta(request.before, request.command, nowSec);
    return !result.why && same(result.profile, request.profile) && request.ack.rev === result.profile.fire.rev;
  } catch { return false; }
}
