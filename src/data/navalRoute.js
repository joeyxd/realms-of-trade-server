// Initial optional circuit tuning. Damage is a repairable practice cost, never cargo loss.
export const NAVAL_ROUTE = Object.freeze({
  version: 1, startRange: 24, buoyRadius: 9, shotRadius: 3.5,
  warningTicks: 120, salvoTicks: 210, firstSalvoTicks: 90, range: 58,
  shotDamage: 6, damageBudget: 24, partFloor: 0.5, timeoutTicks: 10800,
  maxShots: 2, maxRuns: 4,
});
