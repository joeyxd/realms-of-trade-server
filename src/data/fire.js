import { CLOCK } from './clock.js';
// Fuel durations use active simulation seconds. Municipal/public fires are not represented here.
export const FIRE_SECONDS = Object.freeze({
  handTorch: 20 * 60,
  lantern: 60 * 60,
  torchFloor: 60 * 60,
  torchWall: 60 * 60,
  campfire: 30 * 60,
  grill: 30 * 60,
});
// Whole simulation seconds avoid JSON/SQL floating-point anchor differences.
export const fireClockSeconds = hours => {
  if (!Number.isFinite(hours) || hours < 0) throw new TypeError('fire clock');
  return Math.floor(hours * (CLOCK.daySec / 24) + 0.000001);
};
export const FIRE_KIND_SECONDS = FIRE_SECONDS;
// Raft stations keep their basic-plank load; the hand torch uses two logs and one palm resin.
// FIRE_FUEL remains as the legacy station requirement; callers use fuelForKind for a specific fire kind.
export const FIRE_FUEL = Object.freeze({ good: 'madera', count: 1 });
const HAND_TORCH_FUEL = Object.freeze({ tronco: 2, resina: 1 });
const STATION_FIRE_FUEL = Object.freeze({ madera: 1 });
export function fuelForKind(kind) {
  if (!Object.hasOwn(FIRE_SECONDS, kind)) return null;
  return kind === 'handTorch' ? HAND_TORCH_FUEL : STATION_FIRE_FUEL;
}

export const FIRE_MAX_SLOTS = 601;
export const FIRE_MAX_REV = 2147483646;
export const FIRE_KINDS = Object.freeze(Object.keys(FIRE_SECONDS));
