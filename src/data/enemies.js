// Enemy definitions (DESIGN.md §7): stats, steering and attacks. Pure data, shared by the sim
// (worker + node tests) and the client; the F4 panel edits it live like tuning.js.
// Distances in u, times in s, speeds in u/s. Attack kinds:
//   pattern  projectiles (burst / fan / single / spiral / ring), see sim/projectiles.js
//   aoe      ground circle that fills during the wind-up and bursts at its end
export const ENEMIES = {
  archer: {
    name: 'Arquero esqueleto', look: 'archer', title: 'Pirata maldito', level: 2,
    hp: 40, def: 0, speed: 3.2, radius: 0.42, hurt: 0.45, height: 1.9,
    range: [9, 12], aggro: 15, leash: 26, xp: 25, respawn: 40,
    attacks: [
      // 3 aimed parryable arrows 0.12 s apart, 10 u/s; bow glows for 450 ms first.
      { id: 'volley', kind: 'pattern', pat: 'burst', type: 'parry', n: 3, gap: 0.12, speed: 10, dmg: 8, windup: 0.45, cd: 2.2, minD: 0, maxD: 14, muzzle: [0, 1.3, 0.55], recover: 0.35 },
    ],
  },
  sentinel: {
    name: 'Centinela', look: 'sentinel', title: 'Guardián de La Caldera', level: 4,
    hp: 140, def: 2, speed: 2.3, radius: 0.62, hurt: 0.7, height: 2.25,
    range: [4.5, 8], aggro: 9, leash: 24, xp: 60, respawn: 60, dormant: true, wake: 1.3,
    attacks: [
      // Close: a cleave that marks a circle in front and bursts when the wind-up ends.
      { id: 'cleave', kind: 'aoe', r: 2.6, reach: 1.7, dmg: 18, windup: 0.8, cd: 2.2, minD: 0, maxD: 3.8, recover: 0.6 },
      // Mid: a fan of 3 unstoppable amethyst spikes (dash through them: FANTASMA).
      { id: 'spikes', kind: 'pattern', pat: 'fan', type: 'unstop', n: 3, spread: 22, speed: 10, dmg: 14, windup: 0.6, cd: 2.6, minD: 3, maxD: 13, muzzle: [0, 1.1, 0.7], recover: 0.45 },
      // Every ~9 s: a slow heavy orb (only a PERFECT parry sends it back).
      { id: 'orb', kind: 'pattern', pat: 'single', type: 'heavy', speed: 4.5, dmg: 22, windup: 0.8, cd: 3, minD: 4, maxD: 14, every: 9, muzzle: [0, 1.2, 0.8], recover: 0.5 },
    ],
  },
  // ---- M2.5 «La Prueba de Fuego» (PLAN-M2.5.md) ----
  // Melee minion: runs straight at you in packs and bites a small circle in front. Light: combos push it far.
  grunt: {
    name: 'Grumete ahogado', look: 'grunt', title: 'Esbirro', level: 2,
    hp: 24, def: 0, speed: 4.6, radius: 0.36, hurt: 0.42, height: 1.6, chaser: true, light: 1.6, minor: true,
    range: [0, 1.0], aggro: 16, leash: 26, xp: 8, respawn: 30,
    attacks: [
      { id: 'bite', kind: 'aoe', r: 1.05, reach: 0.85, dmg: 9, windup: 0.42, cd: 1.1, minD: 0, maxD: 1.7, recover: 0.35 },
    ],
  },
  // Orbits at mid range and fires a full-circle spiral of 10 parryable orbs.
  imp: {
    name: 'Diablillo de fuego', look: 'imp', title: 'Chispa de La Caldera', level: 3,
    hp: 28, def: 0, speed: 5.5, radius: 0.34, hurt: 0.4, height: 1.45, hover: true, minor: true,
    range: [5, 7], aggro: 15, leash: 26, xp: 20, respawn: 40,
    attacks: [
      { id: 'spiral', kind: 'pattern', pat: 'spiral', type: 'parry', n: 10, gap: 0.08, spread: 36, speed: 7, dmg: 7, windup: 0.4, cd: 2.8, minD: 0, maxD: 13, muzzle: [0, 1.0, 0.3], recover: 0.3 },
    ],
  },
  // Keeps its distance and casts rings of 14 that alternate parryable / unstoppable (dash or weave).
  shaman: {
    name: 'Chamán de coral', look: 'shaman', title: 'Voz del arrecife', level: 4,
    hp: 60, def: 1, speed: 2.4, radius: 0.42, hurt: 0.46, height: 1.9,
    range: [8, 10], aggro: 15, leash: 26, xp: 40, respawn: 50,
    attacks: [
      { id: 'ring', kind: 'pattern', pat: 'ring', type: 'parry', alt: true, n: 14, speed: 6, dmg: 9, windup: 0.6, cd: 3.5, minD: 0, maxD: 14, muzzle: [0, 1.2, 0.4], recover: 0.4 },
    ],
  },
  // The boss of La Prueba de Fuego (DESIGN §8, M2.5 version in 2 phases; phase 3 comes with M3).
  // Fixed attack cycle per phase (sim/systems/boss.js); `spin` turns the omnidirectional patterns a bit
  // more each time so no two flowers are the same. Reflected shots ignore the phase-2 shield; reflecting
  // the heavy orb (PERFECT) breaks it (ROTO: damage × brokenMult) and staggers him.
  hellfire: {
    name: 'HELLFIRE', look: 'hellfire', title: 'Señor de La Caldera', level: 6, boss: true,
    hp: 2600, def: 8, speed: 1.8, radius: 1.1, hurt: 1.25, height: 3.9, light: 0.15,
    range: [6, 11], aggro: 40, leash: 60, xp: 1500, respawn: 0,
    shield: 0.2, brokenMult: 1.5, brokenTime: 4, breakStagger: 1.5, enrage: 2.0, slamR: 4.5, spin: 23,
    phases: [
      { until: 0.55, cycle: ['fan5', 'spiral2', 'fan5', 'rings2'], gap: 0.75, heavyEvery: 12 },
      { until: 0, cycle: ['flower', 'wall', 'rings3', 'summon', 'fan7', 'spiral2'], gap: 0.45, heavyEvery: 10, shield: true, summon: 3 },
    ],
    attacks: [
      { id: 'fan5', kind: 'pattern', pat: 'fan', type: 'parry', n: 5, spread: 8, speed: 9, dmg: 10, windup: 0.5, recover: 0.45, muzzle: [0, 1.6, 1.3] },
      { id: 'spiral2', kind: 'pattern', pat: 'spiral', type: 'parry', arms: 3, n: 36, gap: 0.15, spread: 12, speed: 6.5, dmg: 8, windup: 0.4, recover: 0.4, muzzle: [0, 1.2, 0], omni: true },
      { id: 'rings2', kind: 'pattern', pat: 'rings', type: 'parry', alt: true, n: 16, waves: 2, gap: 0.5, spread: 11.25, speed: 6, dmg: 10, windup: 0.45, recover: 0.4, muzzle: [0, 1.2, 0], omni: true },
      { id: 'orb', kind: 'pattern', pat: 'single', type: 'heavy', speed: 4.5, dmg: 24, windup: 0.8, recover: 0.5, muzzle: [0, 1.6, 1.5] },
      { id: 'flower', kind: 'pattern', pat: 'spiral', type: 'parry', arms: 6, n: 84, gap: 0.13, spread: 6.5, speed: 5.5, dmg: 8, windup: 0.5, recover: 0.4, muzzle: [0, 1.2, 0], omni: true },
      { id: 'wall', kind: 'pattern', pat: 'fan', type: 'unstop', n: 9, spread: 10, speed: 8, dmg: 14, windup: 0.55, recover: 0.4, muzzle: [0, 1.2, 1.3] },
      { id: 'rings3', kind: 'pattern', pat: 'rings', type: 'parry', alt: true, n: 18, waves: 3, gap: 0.45, spread: 11.25, speed: 6.5, dmg: 10, windup: 0.45, recover: 0.4, muzzle: [0, 1.2, 0], omni: true },
      { id: 'summon', kind: 'summon', minion: 'grunt', n: 3, r: 3.5, max: 6, windup: 0.6, recover: 0.5 },
      { id: 'fan7', kind: 'pattern', pat: 'fan', type: 'parry', n: 7, spread: 9, speed: 10, dmg: 10, windup: 0.45, recover: 0.4, muzzle: [0, 1.6, 1.3] },
      { id: 'slam', kind: 'aoe', r: 4.6, reach: 0, dmg: 22, windup: 0.85, recover: 0.6, cd: 3 },
    ],
  },
  // Tutorial: a beach cannon that lobs slow parryable balls at whoever stands in its practice ring.
  cannon: {
    name: 'Cañón de práctica', look: 'cannon', title: 'Práctica de parry',
    hp: 1, def: 0, speed: 0, radius: 0.8, hurt: 0.85, height: 1.4, invulnerable: true, fixed: true, practice: true,
    range: [0, 0], aggro: 0, ring: 4.2, leash: 0, xp: 0, turn: 2.2,
    attacks: [
      { id: 'ball', kind: 'pattern', pat: 'single', type: 'parry', speed: 6.5, dmg: 0, windup: 0.75, cd: 2.4, minD: 0, maxD: 14, muzzle: [0, 0.75, 1.1], recover: 0.2 },
    ],
  },
  // Tutorial: a straw dummy for the 3-hit combo. Heals back between strings of hits.
  dummy: {
    name: 'Muñeco de práctica', look: 'dummy', title: '',
    hp: 300, def: 0, speed: 0, radius: 0.4, hurt: 0.5, height: 1.75, fixed: true, practice: true, regen: 2.5,
    range: [0, 0], aggro: 0, leash: 0, xp: 0, attacks: [],
  },
};

export const ENEMY_KINDS = Object.keys(ENEMIES);
export const enemyIndex = (kind) => ENEMY_KINDS.indexOf(kind);
