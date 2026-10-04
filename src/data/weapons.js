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

// Tattoos (M4.7 P3, PLAN-M4.7.md §2.3; names and hints in data/tattoos.js). forms = [base, A, B]: what each form
// overrides of the base numbers (formed(id, form) merges them). A tattoo's damage is × (1 + TATTOO.dmg × (rank − 1)).
export const TATTOO_SKILLS = {
  // Ground area (the aim point, ≤ range): winds up, the column lands `delay` after the windup. A «Ojo de tormenta»:
  // a whirlpool stays `linger` s (hits `tick` × mult every `every` s, pulls `pull` u/s). B «Gemelas»: a second column
  // `gap` s later at the aim of the first impact.
  tromba: {
    range: 10, min: 0, r: 2.4, windup: 0.22, recover: 0.12, move: 0.35, delay: 0.55, mult: 2.4, lift: 0.7, knock: 3, riposte: 1, riposteMax: 8, cd: 9,
    forms: [{}, { r: 3.0, mult: 1.4, linger: 2.0, every: 0.25, tick: 0.3, pull: 3.2 }, { r: 1.9, mult: 1.7, twin: 1, gap: 0.4 }],
  },
  // A leap to the aim point (min…range), landing on the last standable point of the line: slams, knocks back, erases
  // parryables within clearR. A «Parpadeo»: a collision-stepped blink instead, and the next basic attack within `emp` s
  // hits × empMult as a crit. B «Ancla de abordaje»: higher, longer, wider, stuns.
  leap: {
    range: 7, min: 1.5, windup: 0.06, air: 0.42, h: 2.2, recover: 0.16, r: 2.2, clearR: 2.6, mult: 1.8, knock: 6, riposte: 1, riposteMax: 8, cd: 10,
    forms: [{}, { blink: 1, range: 6, min: 0.5, iframes: 0.3, recover: 0.08, emp: 1.5, empMult: 1.6, cd: 7 }, { air: 0.6, h: 3.0, r: 3.2, clearR: 3.4, mult: 2.6, stun: 0.5, cd: 13 }],
  },
  // Charged boomerang: hold Q / E up to maxHold s (full at `charge`), release throws it: k = held / charge picks the
  // fast end (speed, range, r, mult of `fast`) or the slow one. Out decelerating to the apex, back accelerating to
  // you (ret × max(speed, 14), ramp retRamp s); caught within catchR it returns `refund` of the cooldown left. Hits
  // each enemy once out and once back, erases parryables on its way. A «Remolino»: hangs `hang` s at the apex.
  // B «Timón de guerra»: bigger, slower, knocks back, no refund.
  wheel: {
    charge: 0.9, maxHold: 3, move: 0.6, fast: { speed: 26, range: 7, r: 0.45, mult: 1.0 }, slow: { speed: 13, range: 12, r: 0.8, mult: 2.2 },
    ret: 1.1, retRamp: 0.3, catchR: 0.9, refund: 0.4, life: 4, riposte: 1, riposteMax: 6, cd: 8,
    forms: [{}, { hang: 1.0, hangR: 1.3, hangEvery: 0.3, hangMult: 0.5 }, { rAdd: 0.35, multMul: 1.35, speedMul: 0.8, knock: 5, refund: 0 }],
  },
};
Object.assign(SKILLS, TATTOO_SKILLS);

// The numbers of skill `id` in form `form` (0 base, 1 A, 2 B): the base's, with the form's overrides on top. One
// object per id + form, made once; both layers stay live, so the F4 panel can still tune either.
const FORMED = new Map();
export function formed(id, form = 0) {
  const base = SKILLS[id], f = form | 0, src = base && base.forms ? base.forms[f] : null;
  if (!src || f <= 0) return base;
  const key = id + ':' + f;
  let o = FORMED.get(key);
  if (!o) {
    o = Object.create(base);
    for (const k of Object.keys(src)) Object.defineProperty(o, k, { get: () => src[k], enumerable: true });
    FORMED.set(key, o);
  }
  return o;
}

// Weapon mastery (M4, PLAN-M4.md §2.2): 1–10 per weapon kit, fed by all the XP you earn with it equipped.
// The kit opens with it (LMB + Q from 1, E at `unlock.e`, R at `unlock.r`); every level above 1 adds `dmg`
// to the weapon's damage, and two levels bring a passive. A player without a profile (tests, tools) has
// mastery 0 = unmanaged: the whole kit, no bonuses (the M3.5 game).
export const MASTERY = {
  max: 10,
  xp: [60, 140, 300, 900, 1800, 3200, 5600, 9000, 14000], // to go from n to n + 1: the kit on the path, M5 in the first trial, M10 after ~5
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
