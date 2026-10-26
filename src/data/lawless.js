// La Cala Calavera (M4.5, PLAN-M4.5.md): the island's lawless corner. Pure data, shared by the sim and the client.
// Inside the ring of skulls (map.lawlessAt) every pirate's blow lands on every other pirate in it, the loot is
// whoever's who walks over it first, and a pirate who falls there drops everything they carry.
export const LAWLESS = {
  pvpDmg: 0.6, // a pirate's blow on another pirate: × this (before their DEF)
  meleeArmorKb: 45, // Melee heavy armor: a mob winding up ignores the launch of any blow below this KB
  meleeUnit: 0.06, // u per Melee unit; 0.12 (Bucanero ~1.8 u / Marth ~15 units) flew too far in Joi's test, halved
  meleeBody: 0.12, // ours: body geometry, Bucanero ~1.8 u / Marth ~15 units (not the launch scale)
  meleeStamina: 100, // HP a body counts at least for its Melee percent (a pirate has 100 + 12 per level)
  meleeTumble: 80, // KB from which a hit throws the victim off its feet (Melee's tumble)
  meleeDown: 0.5, // s a thrown victim stays down after the slide: the fall on the back and the get-up (ours)
  heavyStagger: 0.3, // the third hit, the lunge and the storm stagger a pirate this long
  shockStagger: 0.5, // a perfect guard staggers the pirate who struck it from close by
  shockR: 3.2,
  // What a fallen pirate leaves: seconds on the ground, u from the body.
  spill: { life: 180, scatter: [0.8, 2.6] },
  // Loot rolled inside lies there as long.
  publicLife: 150,
  // The Cala's mobs are harder and pay better (like a Marea: enemy HP and damage, item levels, rarity, XP, gold).
  tier: { name: 'Sin ley', hp: 1.6, dmg: 1.4, ilvl: 3, rar: 0.6, xp: 1.5, gold: 1.5 },
  // Mobs inside hurt each other: a bullet or a blow of one lands on any other mob inside (× this), and the one hit
  // turns on whoever hit it for `foe` s (a pirate's blow turns it back on the pirate). A mob that another mob finishes
  // off is still the kill of the last pirate who hurt it within `assist` s; with none, its loot drops for anyone and
  // nobody earns XP for watching.
  mobDmg: 1,
  foe: 6,
  assist: 8,
  rise: 1.1, // s a mob takes to stand up when it comes back (the Cala refills even with pirates around)
  // Who lives there: [kind, u, v] from the centre of the fort (the design frame of worldgen.js).
  spawns: [
    ['grunt', -8.5, 3.5], ['grunt', -8, 10], ['grunt', 9.5, -8.5], ['grunt', 11, -4.5],
    ['archer', 14, 6], ['archer', -13, -9], ['imp', 5.5, 11.5], ['imp', -4, -12],
    ['shaman', 12, -11], ['crab', -14, 8],
    // The Desalmados: renegade pirates who hunt pirates and mobs alike (not each other).
    ['renegado', 3, -6], ['pistolera', -7, 2], ['renegado', 15, -1],
  ],
  // Their names (one each, by spawn order).
  names: ['Cuervo Malasangre', 'La Viuda Roja', 'Tuerto Salazar', 'Garfio Mendoza', 'Mala Espina', 'Diente de Plata'],
  preferPirates: 0.7, // a Desalmado weighs a pirate's distance × this (it would rather hunt you)
  wake: 18, // u beyond the ring: with a pirate this close, the Desalmados hunt the mobs too
};

// P1a: Marth jabs, forward tilt and dash attack; other blows use our default.
export const MELEE = {
  fthrow: { bkb: 70, kbg: 45, weight: 100, throw: true }, // Melee SmashWiki Marth Forward throw; common throw weight (03 4.6, 06 C3)
  bthrow: { bkb: 70, kbg: 60, weight: 100, throw: true }, // Melee SmashWiki Marth Back throw; common throw weight (03 4.6, 06 C3)
  mob: { bkb: 30, kbg: 70 },
  melee1: { bkb: 20, kbg: 50 },
  melee2: { bkb: 20, kbg: 50 },
  melee3: { bkb: 30, kbg: 70 },
  melee3s: { bkb: 60, kbg: 70 }, // Melee forward smash non-tip, ficha 06:154
  lunge: { bkb: 35, kbg: 60 },
  gun_r: { bkb: 30, kbg: 70, proj: true },
  gun_l: { noKb: true, proj: true },
  rain: { noKb: true, proj: true },
  wave: { bkb: 30, kbg: 70, proj: true },
  pellet: { bkb: 30, kbg: 70, proj: true },
  storm: { bkb: 30, kbg: 70, proj: true },
  shot: { bkb: 30, kbg: 70, proj: true },
  comet: { bkb: 30, kbg: 70, proj: true },
  mastbolt: { bkb: 30, kbg: 70, proj: true },
  tromba: { bkb: 30, kbg: 70, proj: true },
  leap: { bkb: 30, kbg: 70, proj: true },
  wheel: { bkb: 30, kbg: 70, proj: true },
  lightning: { bkb: 30, kbg: 70, proj: true },
  default: { bkb: 30, kbg: 70, proj: true },
};

// P2 (MN_MELEE): the sabre guard as Melee's shield (docs/research/melee 02, 06 A3/A4/A6). Frames are sim ticks.
export const MELEE_GUARD = {
  drain: 0.28, // shield HP lost per frame held
  regen: 0.07, // shield HP gained per frame while it is down (no delay; our needs and meal multipliers still scale it)
  dmgMul: 0.7, // shield damage = this x the blow's damage
  stunMul: 0.45, stunAdd: 2, // shieldstun frames = floor((d * stunMul + stunAdd) * 200 / 201)
  minHold: 8, // frames a raised shield cannot be dropped
  dropLag: 15, // frames after the drop in which nothing but dash and jump works
  powerFrames: 4, powerProjFrames: 2, // powershield window (shield age in frames): blows, projectiles
  reflectMul: 0.5, // a powershielded projectile goes back at this x its damage
  pushDef: [0.09, 0.4], // defender slide (Melee units per frame) = floor(d) * [0] + [1], times pushDefMul
  pushDefMul: 0.6, pushDefPower: 1, pushDefMax: 2, // factor on a normal shield, on a powershield, and the cap
  pushAtk: [0.07, 0.02], // attacker slide = floor(d) * [0] + [1]
  breakReset: 30, // shield HP after a break
  dizzyBase: 400, dizzyAdd: 90, // dizzy frames = floor(max(0, dizzyBase - percent)) + dizzyAdd
  dizzyMash: 3, // frames off the dizzy per input
  clank: 9, // a blow is cancelled when its damage minus this is under the other's
  rebound: [0.559, 10], // rebound frames = ceil(rebound[0] * (floor(d) + rebound[1]))
  // P2b: the break sequence before the dizzy (frames; Ultimate FuraFura statuses, a few numbers ours). The dizzy itself stays Melee's.
  breakFly: 60, // frames in the air, up and down: ours, inferred from Ultimate (shield_break_y 38 read as a height like jump_y, air_accel_y 0.096, fall cap 1.58: 28 up, 32 down); the launch speed is native code
  breakHeight: 38, // peak height in Ultimate units (Marth shield_break_y), times LAWLESS.meleeUnit on the view
  breakDown: 26, // frames lying down (Ultimate down_bound_u cancel frame)
  breakStand: 50, // frames of the stand-up, up to the dizzy (Ultimate furafura_start_u cancel frame)
  breakStandXlu: 31, // intangible through the first 31 frames of the stand (Ultimate furafura_stand_whole_hit_xlu_frame), so the whole fly and down too
  reboundPush: 0.55, // slide of a cancelled blow, Melee units per frame (Ultimate attack_100_rebound_speed and attack_lw3_rebound_speed; Melee's own is disc data)
};

// P3c (MN_MELEE): Marth rolls, sim ticks at 60 Hz.
export const MELEE_ROLL = {
  stick: 0.5, // ours: same threshold as P3b throws; crossing edge (no stick recency timer here)
  total: 35, start: 4, forwardEnd: 19, backEnd: 23, // Melee SmashWiki via ficha 06 C2, Marth rolls
  distance: 30, // ours, Melee units: Marth's Ultimate params have no ground-roll speed/distance; root motion is animation data
};

// P5 (MN_MELEE): generic roll timeline, sim ticks at 60 Hz (06-data-values.md:106).
export const MELEE_DASH = {
  total: 31, // Melee: generic roll duration
  start: 4, // Melee: first intangible frame
  end: 19, // Melee: last intangible frame, followed by 12 vulnerable frames
  move: 19, // ours: cover tuning.dash.distance before the stationary endlag
};

// P4 (MN_MELEE): Ultimate values; Melee's cap and 1.3671 multiplier remain unconfirmed (06:164).
export const MELEE_SMASH = {
  cap: 60, // Ultimate fighter_param.prc.txt:180, attack_s4_hold_frame
  maxMul: 1.4, // Ultimate fighter_param.prc.txt:304, attack_s4_smash_hold_attack_up
};

// P3 (MN_MELEE). Frames at 60 Hz; throw animation rate 1 (weight coefficient is DATA; pirates weigh 87).
export const MELEE_GRAB = {
  throwStick: 0.5, // ours: Melee CatchWait uses unnamed DATA x98; its numerical value is unavailable
  fthrow: { release: 14, total: 31 }, // Melee SmashWiki Marth Forward throw (06 C3)
  bthrow: { release: 16, total: 44 }, // Ultimate Marth game_throwb game.cpp:2298-2302 release; Melee SmashWiki total (06 C3)
  throwDamage: 4, // Melee SmashWiki Marth throws (06 C3); no bystander release hitbox (ours)
  total: 30, start: 7, end: 8, // Melee Marth standing grab, SmashWiki (06 C1)
  radius: 3.906, // Melee grab radius, SmashWiki Marth/Grab; body units
  forward: (4 + 7.7) / 2, height: 8, // Ultimate Marth game_catch grounded capsule midpoint and height; body units
  pull: 0, // ours: motion-list cancel frame is not a verified CatchPull animation length; straight to wait
  base: 76, percent: 1.6, mash: 6, // Melee hold and mash, SmashWiki Grab (06 A5); handicap/rank zero
  pummel: 24, hit: 7, damage: 3, // Melee Marth pummel, SmashWiki (06 C1)
  cut: 29, external: 0.5, free: 6, flinch: 20, // Melee ground release and external hit, SmashWiki Grab (06 A5)
  speed: 1.2, // Ultimate capture_cut_speed_x; Melee uses the same common release speed for both bodies (03 4.4)
  immune: 60, // Ultimate invalid_capture_frame (misc.cpp FighterStatusCapture_set_invalid_capture)
};
