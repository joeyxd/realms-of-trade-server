// Wind Waker hull motion constants (research/wind-waker 01 section 5 and 02 section 3, T-1025-02), in WW units:
// lengths in WW units, angles in s16 (0x10000 = one turn), per WW logic frame (30 a second). Convert with
// WW_UNIT / WW_ANGLE from navalHandling.js. SH = src/d/actor/d_a_ship.cpp, SEA = d_a_sea.cpp, S = d_a_player_ship.inc.
export const NAVAL_HULL = Object.freeze({
  frameRate: 30, // WW logic frames a second
  maxFramesPerStep: 4, // a render hitch never replays more than this many frames
  // Probes in the ship frame (x is the ship's left), SH:809-812.
  probeFront: 180, probeBack: -190, probeSide: 80,
  // Wave spring (SH:839-848): v += stiffness * (target - pos); pos += v; v decays by addCalcAngleS(v, 0, 20, 0x1000, 4).
  waveSpring: 0.045, springDecay: Object.freeze({ divisor: 20, max: 0x1000, min: 4 }),
  // Steering lean (SH:775-789, 1102-1110): aim = clamp(dYaw * 7, +-0x600), same decay.
  leanSpring: 0.05, leanGain: 7, leanMax: 0x600,
  // setYPos, not flying (SH:920-958).
  speedFollow: 0.1, // y += f * 0.1 * (water - y)
  ySpring: 0.05, vyMax: 20, // vy += 0.05 * (water - y), clamp +-20
  vyDecay: Object.freeze({ scale: 0.05, max: 1.0, min: 0.05 }),
  noisePhase: Object.freeze({ base: 1000, rand: 1000, speed: 500 }), // m03B0 += base + rnd(rand) + speed * f
  noiseAmp: 0.25, noiseLift: 0.6, // y += f * 0.25 * sin(phase) + 0.6
  yBelow: 60, yAbove: 40, // y stays inside [water - 60, water + 40]
  // Sway terms: phases advance (0.5 f + 1) * (min + rnd(min)) per frame; added to the pitch / roll positions.
  pitchSway: Object.freeze({ phaseMin: 800, amp: 100, lift: 30 }), // m03AE, SH:954, 957
  rollSway: Object.freeze({ phaseMin: 600, amp: 115, lift: 35 }), // m03AC, SH:955, 958
  // Sea (SEA:25-58, 541-547, 623-627): h = sum A_i cos(theta_i), A_i = 2.5 * waveMax, theta = Km * 6.28 * (vx x + vz z)
  // - 0x10000 * (counter / counterMax - 0.5) + phase. Evaluated directly: no 800-unit grid, no edge fade, no room blend.
  waveAmp: 2.5, kScale: 6.28,
  waves: Object.freeze([
    Object.freeze({ km: 7.352941e-5, phase: 0, vx: 0.98, vz: 0.2, period: 200 }),
    Object.freeze({ km: 8.928571e-5, phase: 4000, vx: 0.2, vz: 0.98, period: 190 }),
    Object.freeze({ km: 1.13636364e-4, phase: 8000, vx: -0.98, vz: 0.2, period: 210 }),
    Object.freeze({ km: 1.5625e-4, phase: 12000, vx: 0.2, vz: -0.98, period: 180 }),
  ]),
  // Our knob: the WW default room value is 10 (SEA:83-95; the Great Sea's per-room value lives on the disc), which
  // lifts a hull up to 1.27 of our units. Our water is a flat plane, so the swell is kept small.
  waveMax: 1.5,
  // Yaw rate per frame = turnRate * tiller / 64 (SH:1113-1134), full tiller 0x2000; inverted to read the tiller.
  turnBase: 4, turnSlope: 3, turnMin: 0.1, turnMax: 3.6, tillerShift: 64, tillerMax: 0x2000,
  // Pilot's body on the boat (S:181-186, 232-236, HIO ship field_0x4 = 2000).
  rider: Object.freeze({
    pitchSpring: 0.75, pitchDecay: Object.freeze({ scale: 1 / 5, max: 0x200, min: 0x100 }),
    rollSpring: 0.5, rollDecay: Object.freeze({ scale: 1 / 5, max: 0x100, min: 0x30 }),
    turnLean: 2000, leanDecay: Object.freeze({ scale: 1 / 4, max: 0x400, min: 0x80 }),
  }),
});
