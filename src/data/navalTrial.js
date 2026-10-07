// Internal D08c.1 authority experiment, not live sailing or progression tuning.
export const NAVAL_TRIAL = Object.freeze({
  maxBodies: 32,
  inputTimeoutTicks: 15,
  maxSequence: 2147483647,
  maxPendingDamage: 32,
  wind: Object.freeze({ yaw: 0, strength: 0.75 }),
});
