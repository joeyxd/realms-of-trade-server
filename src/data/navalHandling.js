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

// Wind Waker sailing, ported exactly first (research/wind-waker, T-1024-41..43, zeldaret/tww 9815333;
// SH = src/d/actor/d_a_ship.cpp). Values stay in WW units: speeds in WW units per WW frame, angles in
// s16 (0x10000 = one turn). WW logic runs at 30 frames a second, so one WW frame is two of our ticks.
// Scale (Joi 2026-10-24: copy WW's proportion, the boat at ~3.2 times the run): our run 6.5 u/s
// (tuning.js player runSpeed) over Link's run 17 WW u/frame (player HIO move 0x18) gives the speed scale.
export const WW_FRAME_TICKS = 2;
export const WW_SPEED = 6.5 / 17; // our u/s per WW u/frame: 55 -> 21.0 u/s, 10 -> 3.8 u/s
export const WW_UNIT = WW_SPEED / 30; // our units per WW unit (~1/78.5): the same scale applied to lengths
export const WW_ANGLE = Math.PI * 2 / 65536; // radians per s16 unit
export const NAVAL_WW = Object.freeze({
  sailMax: 55, // target at full wind, tailwind (SH:1614)
  paddleMax: 10, // paddle target at full trigger (SH:1379)
  windNormal: 0.5, // k = min(1, power / 0.5) (SH:1596, 1611-1613)
  // Wind factor by |angle from the wind's heading| (SH:1597-1609): 1 - a/0x10000 below 0x4000,
  // 0.75 - (a - 0x4000) * slopeMid up to 0x6000, then max(0, 0.3 - (a - 0x6000) * slopeBack).
  windBeam: 0x4000, windQuarter: 0x6000, factorBeam: 0.75, factorQuarter: 0.3,
  slopeMid: 5.493164e-5, slopeBack: 0.00032967,
  // addCalc(value, target, scale, maxStep, minStep) parameter sets, per WW frame.
  sailAccel: Object.freeze({ scale: 0.1, maxStep: 0.5, minStep: 0.1 }), // speed below the sail target (SH:1636)
  coast: Object.freeze({ scale: 0.05, maxStep: 0.1, minStep: 0.015 }), // decrementShipSpeed (SH:1090-1092)
  stopBrake: Object.freeze({ scale: 0.1, maxStep: 1.0, minStep: 0.1 }), // STOP with A held (SH:1375-1377)
  // Tiller: target = 0x2000 * stick, addCalcAngleS divisor 4, max 700, min 0x100 (SH:71, 1361, 1366, 1586).
  tillerMax: 0x2000, tillerDivisor: 4, tillerMaxStep: 700, tillerMinStep: 0x100,
  // Yaw per frame = turnRate * (tiller >> 6), turnRate = clamp(4 - 3 * |speed| / 55, 0.1, 3.6) (SH:1113-1134).
  turnBase: 4, turnSlope: 3, turnMin: 0.1, turnMax: 3.6, tillerShift: 64,
});
