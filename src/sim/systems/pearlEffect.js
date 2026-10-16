import { PEARL } from '../../data/pearls.js';
import { refreshStats } from './stats.js';

// Gameplay and durable tick apply share the same ECS effect. Callers own eligibility,
// profile changes and publication; this also runs on a detached row without live writes.
export function applyPearlChange(world, entity) {
  const s = world.ecs;
  s.gBuf[entity] = 0;
  s.cdG[entity] = Math.max(s.cdG[entity], PEARL.swapCd);
  s.waterT[entity] = 0;
  refreshStats(world, entity);
}
