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
    pitch: 48,
    yaw: 45,
    zoomLevels: [15, 20, 27],
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

  // ---- Combat (M2) ------------------------------------------------------------------------------
  stats: {
    // Per level: HP 100 + 12·(Lv−1), ATK 10 + 2·(Lv−1), DEF 2 + (Lv−1). XP to go from Lv n to n+1.
    hp: [100, 12], atk: [10, 2], def: [2, 1], crit: 0.05, critMult: 1.75, defK: 40,
    xp: [100, 180, 280, 400, 550, 720, 920, 1150, 1400],
    maxLevel: 10,
  },
  combat: {
    hurtIframes: 0.35, // after taking damage, projectiles pass through you
    regenDelay: 4, // s without damage before HP comes back (M2 stand-in for potions)
    regenRate: 0.1, // fraction of max HP per second
    respawnTime: 3,
    respawnIframes: 2,
    hitKnock: 4, // u/s of knockback when hit (decays at 10/s → 0.4 u)
    rewind: 20, // max ticks the server rewinds to a command's projectile tick (lag compensation)
    lead: 2, // max ticks a command may be ahead of the server
    interpTicks: 6, // remote entities are drawn this far behind (INTERP_DELAY): melee rewinds enemies by it
  },
  // 3-hit combo (LMB). windup → active (hits + destroys parryables) → recover. A buffered press at the end
  // of the active frames chains the next stage; within comboGap after a stage ends it also continues.
  melee: {
    stages: [
      { windup: 0.06, active: 0.12, recover: 0.16, arc: 150, range: 2.1, mult: 1.0, lunge: 0.55, move: 0.3 },
      { windup: 0.06, active: 0.12, recover: 0.18, arc: 150, range: 2.1, mult: 1.15, lunge: 0.55, move: 0.3 },
      { windup: 0.1, active: 0.14, recover: 0.3, arc: 360, range: 2.5, mult: 1.6, lunge: 0, move: 0.15 },
    ],
    comboGap: 0.3,
    knock: 6, // enemy knockback u/s (decays at 10/s → 0.6 u, DESIGN §7)
    heavyStagger: 0.35, // 3rd hit / reflected heavy / riposte: interrupts an enemy's wind-up
  },
  projectiles: {
    cap: 1500,
    armTime: 0.15,
    maxSpeed: 14,
    graze: 0.35,
    parryable: { radius: 0.28, damage: 8, life: 3.2 },
    heavy: { radius: 0.65, speed: 4.5, damage: 22, life: 5 },
    unstoppable: { radius: 0.22, length: 0.9, damage: 14, stagger: 0.3, life: 2.4 },
    aoe: { damage: 18 },
    laser: { width: 0.9, telegraph: 0.6, damage: 10, tick: 0.2 },
    shotCap: 256,
  },
  parry: {
    destroyWindow: 0.12, // = the active frames of a swing
    window: 0.18,
    perfect: 0.08,
    coyote: 0.06,
    arc: 110,
    radius: 1.6,
    whiffRecovery: 0.35,
    blockKnock: 7, // heavy orb blocked by a normal parry: half damage + push
    reflect: { dmgMult: 2, atkMult: 0.8, speedMult: 1.4, homing: 4, cone: 60, life: 2.5,
      // A reflected shot that hits jumps to the nearest other enemy (M2.5): bounces by how it was sent back.
      bounce: { normal: 1, perfect: 2, wave: 1, range: 7, dmgMult: 0.75, life: 1.4 } },
    chainGap: 1.2,
    chainMax: 5,
    chainDmg: 0.1, // reflected damage × (1 + 0.1·(chain − 1))
    chainRiposte: 0.25, // riposte gain × (1 + 0.25·(chain − 1))
    riposte: { perfect: 18, normal: 10, destroy: 4, graze: 4, ghost: 8, dodge: 3, max: 100, radius: 6, dmgMult: 3, knock: 14 },
    xp: { perfect: 5, graze: 2, ghost: 3, dodge: 1 },
  },
  feel: {
    hitstopMelee: 0.045,
    hitstopDestroy: 0.07,
    hitstopReflect: 0.11,
    hitstopRiposte: 0.14,
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
