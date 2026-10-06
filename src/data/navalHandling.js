// D08 laboratory coefficients, not progression or final naval balance. Mass uses the existing
// part-weight units; cargo in this experiment is explicit ballast, never an economy hold.
export const NAVAL_STEP = 1 / 60;
export const NAVAL_HANDLING = Object.freeze({
  paddleForce: 12,
  sailForce: 80,
  headwindEfficiency: 0.12,
  forwardDrag: 6,
  quadraticDrag: 1.2,
  brakeForce: 28,
  lateralDamping: 3.4,
  rudderTorque: 105,
  lowSpeedHelm: 0.4,
  yawDamping: 2.3,
  maxTurnRate: 1.2,
  maxSpeed: 10,
});
