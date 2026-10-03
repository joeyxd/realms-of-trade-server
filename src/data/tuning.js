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
    aimLambda: 30, // facing → aim point (mouse / right stick) when the command says AIM
    backMul: 0.9, // speed × this walking away from where you aim (blends in from 100° to 145°)
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
    regenDelay: 5, // s without damage before HP comes back (M4: slower, the potions are the real heal)
    regenRate: 0.05, // fraction of max HP per second (M2–M3.6: 4 s and 0.1)
    respawnTime: 3,
    respawnIframes: 2,
    hitKnock: 4, // u/s of knockback when hit (decays at 10/s → 0.4 u)
    rewind: 24, // max ticks (400 ms) the server rewinds to a command's projectile tick (lag compensation; M3.6: 20 clipped at 300 ms RTT)
    lead: 2, // max ticks a command may be ahead of the server
    interpTicks: 6, // remote entities are drawn this far behind (INTERP_DELAY): melee rewinds enemies by it
    starveTicks: 12, // online: a client silent this long gets neutral filler commands (it still gets hit)
    coopHitstop: 0.06, // with other humans in the instance, your own hitstop is yours alone, capped here
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
  // Reflect economy, shared by the sword's timed reflects (sword), the guard's caught bullets (guard) and
  // the riposte wave. Since M3.5 RMB is the guard: there is no parry window any more.
  parry: {
    coyote: 0.06, // a parryable that touches you deals its damage this much later: LMB → POBRE reflect, RMB → block
    reflect: { atkMult: 0.8, life: 2.5, maxSpeed: 22,
      // The riposte wave reflects radially at BUENO strength (no spread).
      wave: { dmg: 2, speed: 1.4, minSpeed: 4, spread: 0, homing: 4, cone: 60, bounce: 1 },
      // A reflected shot that hits jumps to the nearest other enemy (M2.5): `bounce` jumps by tier.
      bounce: { range: 7, dmgMult: 0.75, life: 1.4 },
      // Many reflected shots on one enemy within `window` s: each next one × (1 − step·n), at least floor
      // (a point-blank reflect of a 15-bullet flower is a jackpot, not an instant kill).
      stack: { window: 0.6, step: 0.2, floor: 0.15 } },
    chainGap: 1.2,
    chainMax: 5,
    chainDmg: 0.1, // reflected damage × (1 + 0.1·(chain − 1))
    chainRiposte: 0.15, // riposte gain × (1 + 0.15·(chain − 1))
    riposte: { destroy: 4, graze: 4, ghost: 8, dodge: 3, max: 100, radius: 6, dmgMult: 3, knock: 14 },
    xp: { perfect: 5, graze: 2, ghost: 3, dodge: 1 },
  },
  // The sword's timed reflect (M3.5): a swing's active frames hit every hostile bullet in the arc; the tier
  // comes from how soon that bullet would have touched you (tc, seconds; slack u added to the touch radius).
  // R = max(bullet damage, 0.8·ATK). Spread is a deterministic hash of (projectile id, command seq).
  sword: {
    slack: 0.15,
    excellent: { tc: 0.07, dmg: 3, speed: 1.9, minSpeed: 9, spread: 0, homing: 1.5, cone: 24, bounce: 2, riposte: 18, hitstop: 0.11, slowmo: 0.35 },
    good: { tc: 0.15, dmg: 2, speed: 1.4, minSpeed: 4, spread: 10, homing: 4, cone: 60, bounce: 1, riposte: 10, hitstop: 0.08, slowmo: 0 },
    poor: { tc: 0.26, dmg: 1, speed: 1.0, minSpeed: 4, spread: 35, homing: 0, cone: 0, bounce: 0, riposte: 5, hitstop: 0.05, slowmo: 0 },
  },
  // RMB held: frontal guard (M3.5). Blocks bullets and melee circles in the arc for a fraction of their
  // damage and stamina; raised just before a hit (perfect) it CATCHES the bullet (max catchMax, they fade
  // after catchLife s) and the next basic attack throws them all back (release). Unstoppables pierce it.
  guard: {
    arc: 130, perfect: 0.13, rearm: 0.45, move: 0.45,
    blockMult: 0.25, heavyMult: 0.4, knock: 2, heavyKnock: 7,
    stamina: 60, cost: 1, heavyCost: 1.5, regen: 30, regenDelay: 0.7, minRaise: 10, breakStagger: 0.9,
    catchMax: 3, catchLife: 6, shockR: 3, shockStagger: 0.7,
    riposte: 12, blockRiposte: 2, xp: 3, hitstop: 0.09, slowmo: 0.5,
    release: { spread: 7, dmg: 2, heavyDmg: 3, speed: 12, heavySpeed: 8, homing: 2, cone: 30, bounce: 1 },
  },
  feel: {
    hitstopMelee: 0.045,
    hitstopDestroy: 0.07,
    hitstopRiposte: 0.14,
    perfectSlowmoTime: 0.25, // how long a slow-mo (EXCELENTE, perfect guard) lasts
    flashMax: 0.8,
  },

  // ---- Visual-only tuning ---------------------------------------------------------------------
  visual: {
    outlineColor: 0x1a1033,
    errorSmoothLambda: 15,
  },
};
