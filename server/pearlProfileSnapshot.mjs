// Read ECS-backed progress into a detached profile. Capturing never publishes, marks dirty or saves.
import { sanitizeProfile, syncProfile } from '../src/sim/systems/inventory.js';
import { canonicalText } from './pearlOperations.mjs';
import { StoreError } from './store.mjs';

export const PEARL_PROFILE_ECS_FIELDS = Object.freeze(['lvl', 'xp', 'pot', 'cp']);

export function capturePearlProfile(world, entity) {
  const profile = world.profiles.get(entity), ecs = world.ecs;
  if (!Number.isInteger(entity) || entity < 1 || entity >= ecs.cap || !ecs.alive[entity] || !profile) {
    throw new StoreError('session');
  }
  const before = sanitizeProfile(profile);
  if (!before || canonicalText(before) !== canonicalText(profile)) throw new StoreError('profile');
  const captured = syncProfile({ profiles: new Map([[entity, before]]), ecs, map: world.map }, entity);
  const checked = sanitizeProfile(captured);
  // Invalid ECS progress must fail, rather than silently clamp/reset a durable baseline.
  if (!checked || canonicalText(checked) !== canonicalText(captured)) throw new StoreError('profile');
  return checked;
}
