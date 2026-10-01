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
    hp: 24, def: 0, speed: 4.6, radius: 0.36, hurt: 0.42, height: 1.6, chaser: true, light: 1.6,
    range: [0, 1.0], aggro: 16, leash: 26, xp: 8, respawn: 30,
    attacks: [
      { id: 'bite', kind: 'aoe', r: 1.05, reach: 0.85, dmg: 9, windup: 0.42, cd: 1.1, minD: 0, maxD: 1.7, recover: 0.35 },
    ],
  },
  // Orbits at mid range and fires a full-circle spiral of 8 parryable orbs.
  imp: {
    name: 'Diablillo de fuego', look: 'imp', title: 'Chispa de La Caldera', level: 3,
    hp: 28, def: 0, speed: 5.5, radius: 0.34, hurt: 0.4, height: 1.45, hover: true,
    range: [5, 7], aggro: 15, leash: 26, xp: 20, respawn: 40,
    attacks: [
      { id: 'spiral', kind: 'pattern', pat: 'spiral', type: 'parry', n: 8, gap: 0.1, spread: 45, speed: 7, dmg: 7, windup: 0.4, cd: 2.8, minD: 0, maxD: 13, muzzle: [0, 1.0, 0.3], recover: 0.3 },
    ],
  },
  // Keeps its distance and casts rings of 12 that alternate parryable / unstoppable (dash or weave).
  shaman: {
    name: 'Chamán de coral', look: 'shaman', title: 'Voz del arrecife', level: 4,
    hp: 60, def: 1, speed: 2.4, radius: 0.42, hurt: 0.46, height: 1.9,
    range: [8, 10], aggro: 15, leash: 26, xp: 40, respawn: 50,
    attacks: [
      { id: 'ring', kind: 'pattern', pat: 'ring', type: 'parry', alt: true, n: 12, speed: 6, dmg: 9, windup: 0.6, cd: 3.5, minD: 0, maxD: 14, muzzle: [0, 1.2, 0.4], recover: 0.4 },
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
