// First arcade coast-contact tuning. These are experimental values, not a settled loss policy.
export const NAVAL_DAMAGE = Object.freeze({
  safeNormalSpeed: 1.8, // Tangential travel does not increase collision damage.
  damageScale: 1.6,
  maxImpactDamage: 90,
  restitution: 0.08,
  tangentRetention: 0.9,
});
