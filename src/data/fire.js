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

export const FIRE_MAX_SLOTS = 601;
export const FIRE_MAX_REV = 2147483646;
export const FIRE_KINDS = Object.freeze(Object.keys(FIRE_SECONDS));
