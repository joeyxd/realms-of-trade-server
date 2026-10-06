// D08 laboratory coefficients, not progression or final naval balance. Mass uses the existing
// part-weight units; cargo in this experiment is explicit ballast, never an economy hold.
export const NAVAL_STEP = 1 / 60;
export const NAVAL_HANDLING = Object.freeze({
  paddleForce: 8,
  sailForce: 55,
  headwindEfficiency: 0.12,
  forwardDrag: 6,
  quadraticDrag: 1.2,
  brakeForce: 28,
  lateralDamping: 2.4,
  rudderTorque: 50,
  lowSpeedHelm: 0.22,
  yawDamping: 1.8,
  maxTurnRate: 0.9,
  maxSpeed: 10,
});
