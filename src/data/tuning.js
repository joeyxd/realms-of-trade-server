// All balance and feel numbers live here (see DESIGN.md). Units: u (≈ m), seconds, u/s.
// Pure data: imported by sim (worker + node) and by the client. The F4 debug panel (M2) edits it live.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 3; // 20 Hz
export const INTERP_DELAY = 0.1; // s of buffer for remote entities
export const MAX_FRAME_DT = 0.05;

export const tuning = {
  world: {
    size: 400, // terrain spans [-size/2, size/2]
    gridRes: 1, // sim heightfield samples per unit
    waterLevel: 0,
    wadeStart: 0.15,
    wadeMax: 0.65, // deeper than this blocks movement
    wadeSlow: 0.35,
    maxSlope: 1.0,
  },

  player: {
    runSpeed: 6.5,
    accel: 70,
    decel: 50,
    turnLambda: 20,
    radius: 0.4,
    hurtRadius: 0.36,
    inputBuffer: 0.13,
  },

  dash: {
    duration: 0.22,
    distance: 5.5,
    curvePow: 2, // d(t) = D * (1 - (1 - t)^p)
    chargesBase: 1,
    chargesLv2: 2,
    recharge: 0.9,
    exitCarry: 1.0, // * runSpeed when move is held after a dash
    exitGlide: 0.35, // * runSpeed when no input
    afterimages: [0, 0.05, 0.1, 0.15],
    afterimageLife: 0.25,
  },

  camera: {
    fov: 35,
    pitch: 57,
    yaw: 45,
    zoomLevels: [16, 23, 31],
    zoomDefault: 1,
    followLambda: 9,
    lookAhead: 0.3,
    lookAheadMaxFrac: 0.2,
    lookAheadLambda: 4,
    rotateStep: 90,
    rotateTime: 0.35,
    shake: { decay: 1.6, maxOffset: 0.6, maxRoll: 2.5, freq: 22 },
    punchLambda: 12,
    slowmoDolly: 0.08,
    navalDistance: 46,
    navalPitch: 50,
    occluderRadius: 1.8,
  },

  // ---- M2+ (documented now, used later) --------------------------------------------------------
  projectiles: {
    cap: 1500,
    armTime: 0.15,
    maxSpeed: 14,
    graze: 0.35,
    parryable: { radius: 0.28, damage: 8 },
    heavy: { radius: 0.65, speed: 4.5, damage: 22 },
    unstoppable: { radius: 0.22, length: 0.9, damage: 14, stagger: 0.3 },
    aoe: { damage: 18 },
    laser: { width: 0.9, telegraph: 0.6, damage: 10, tick: 0.2 },
  },
  parry: {
    destroyWindow: 0.12,
    window: 0.18,
    perfect: 0.08,
    coyote: 0.06,
    arc: 110,
    radius: 1.6,
    whiffRecovery: 0.35,
    reflect: { dmgMult: 2, speedMult: 1.4, homing: 4, cone: 60, life: 2.5 },
    chainGap: 1.2,
    chainMax: 5,
    riposte: { perfect: 18, normal: 10, destroy: 4, graze: 4, ghost: 8, radius: 6 },
  },
  feel: {
    hitstopDestroy: 0.07,
    hitstopReflect: 0.11,
    perfectSlowmo: 0.35,
    perfectSlowmoTime: 0.25,
    flashMax: 0.8,
  },

  // ---- Visual-only tuning ---------------------------------------------------------------------
  visual: {
    outlineColor: 0x1a1033,
    errorSmoothLambda: 15,
  },
};
