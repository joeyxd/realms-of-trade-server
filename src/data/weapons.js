// Weapons (M3.5): the equipped weapon decides LMB and Q / E / R (Albion style). The guard (RMB), the
// dash and the RIPOSTE meter belong to every weapon; R spends a full meter and differs per weapon.
// ecs.weapon = index into WEAPON_KINDS. You change weapon at a rack (map.racks): F within RACK_R.
// Live-tunable from F4 (root 'skills').
export const WEAPONS = {
  sable: { name: 'Sable de cubierta', short: 'Sable', basic: 'combo', q: 'lunge', e: 'wave', r: 'storm' },
  pistolas: { name: 'Pistolas de chispa', short: 'Pistolas', basic: 'pistol', q: 'blast', e: 'blink', r: 'rain' },
};
export const WEAPON_KINDS = Object.keys(WEAPONS);
export const WEAPON = { SABLE: 0, PISTOLAS: 1 };
export const weaponIndex = (kind) => Math.max(0, WEAPON_KINDS.indexOf(kind));
export const weaponOf = (i) => WEAPONS[WEAPON_KINDS[i]] || WEAPONS.sable;
export const RACK_R = 2.4;

// Numbers per skill (seconds, u, u/s, × ATK). See PLAN-M3.5.md §2.4.
export const SKILLS = {
  combo: { name: 'Combo', hint: 'Tres tajos · refleja a tiempo' }, // tuning.melee + tuning.sword
  // Q: a lunge at the cursor along the dash curve; hits once what is within `width` of its path.
  lunge: { name: 'Estocada', hint: 'Embestida que atraviesa', windup: 0.08, dist: 4.5, time: 0.16, recover: 0.22, mult: 1.8, width: 1.0, cd: 7 },
  // E: a crescent that flies at the cursor: hits each enemy once, destroys the parryables it crosses.
  wave: { name: 'Hoja de viento', hint: 'Media luna a distancia', windup: 0.12, recover: 0.2, speed: 14, life: 0.75, half: 0.9, depth: 0.45, mult: 1.4, riposte: 2, riposteMax: 10, cd: 5 },
  storm: { name: 'Tormenta', hint: 'Refleja todo a tu alrededor' }, // tuning.parry.riposte
  // LMB held: alternating hands, every `every` s.
  pistol: { name: 'Disparo', hint: 'Mantén para disparar', every: 0.2, speed: 20, life: 0.65, r: 0.16, mult: 0.7, spread: 1.5, move: 0.85, side: 0.24 },
  // Q: a shotgun cone that also blows away the parryables in front.
  blast: { name: 'Descarga', hint: 'Escopetazo que sopla balas', windup: 0.05, n: 7, arc: 44, speed: 16, life: 0.4, r: 0.14, mult: 0.55, knock: 7, clearR: 3.2, clearArc: 70, riposte: 2, riposteMax: 10, recoil: 5, root: 0.15, cd: 6 },
  // E: a short teleport (collision-stepped) with i-frames.
  blink: { name: 'Paso de humo', hint: 'Teletransporte corto', dist: 4.5, iframes: 0.3, recover: 0.1, cd: 7 },
  // R: lead rain on a zone at the cursor.
  rain: { name: 'Lluvia de plomo', hint: 'Zona de balas en el cursor', range: 9, delay: 0.35, dur: 1.5, every: 0.15, r: 3.2, mult: 0.55 },
};

// Weapon mastery (M4, PLAN-M4.md §2.2): 1–10 per weapon kit, fed by all the XP you earn with it equipped.
// The kit opens with it (LMB + Q from 1, E at `unlock.e`, R at `unlock.r`); every level above 1 adds `dmg`
// to the weapon's damage, and two levels bring a passive. A player without a profile (tests, tools) has
// mastery 0 = unmanaged: the whole kit, no bonuses (the M3.5 game).
export const MASTERY = {
  max: 10,
  xp: [60, 140, 260, 400, 560, 740, 940, 1160, 1400], // to go from n to n + 1
  unlock: { q: 1, e: 2, r: 3 },
  dmg: 0.02,
  passives: {
    sable: [
      { at: 5, id: 'temple', name: 'Filo templado', hint: '+15 ms a las ventanas de EXCELENTE y BUENO', win: 0.015 },
      { at: 10, id: 'eye', name: 'Ojo del huracán', hint: 'La Tormenta alcanza 8 u en lugar de 6', stormR: 2 },
    ],
    pistolas: [
      { at: 5, id: 'trigger', name: 'Gatillo fácil', hint: 'Disparas un 15 % más rápido', fire: 0.85 },
      { at: 10, id: 'deluge', name: 'Diluvio', hint: 'La Lluvia de plomo dura 2,25 s y crece 0,8 u', rainDur: 0.75, rainR: 0.8 },
    ],
  },
};
