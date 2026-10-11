// Tattoos and slots (M4.7, PLAN-M4.7.md §1, §2.2): Q and E are free slots. They hold the weapon's ARTS (its M4.6
// Q / E skills, only with that weapon, opened by its mastery) or a TATTOO you learned (any weapon, ranked up by
// use, with free variant forms). One loadout per weapon, kept in the profile (p.sk, systems/inventory.js).
// Pure data + small helpers: gameplay numbers of the tattoos live in SKILLS (data/weapons.js, Phase B).
//   SKILL_IDS  fixed order: the ECS stores the index (skQ / skE)
//   SLOTS      the equippable slots; SLOT_COLS the ECS columns of each (a third slot G, M4.8, is one entry here)
//   cast       how the client aims it: dir (arrow) · self · ground (area mark) · charge (hold and release)

export const SKILL_IDS = ['lunge', 'wave', 'blast', 'blink', 'tromba', 'leap', 'wheel', 'none', 'comet', 'iceanchor', 'mastbolt', 'inkcloud'];
export const skillIndex = (id) => Math.max(0, SKILL_IDS.indexOf(id));
export const skillId = (i) => SKILL_IDS[i | 0] || SKILL_IDS[0];

// The weapon's own skills: which weapon carries it and the mastery that opens it (0 = unmanaged = open).
export const ARTS = {
  lunge: { weapon: 'sable', mastery: 1, cast: 'dir' },
  wave: { weapon: 'sable', mastery: 2, cast: 'dir' },
  blast: { weapon: 'pistolas', mastery: 1, cast: 'dir' },
  blink: { weapon: 'pistolas', mastery: 2, cast: 'self' },
};

// Learned from Doña Sepia. forms[0] is the base; forms 1 and 2 (A, B) open at the rank they ask for and can be
// switched for free out of combat.
export const TATTOOS = {
  tromba: {
    name: 'Tromba', hint: 'Columna de agua que aturde y borra balas', cast: 'ground',
    forms: [
      { name: 'Tromba', hint: 'Columna de agua que aturde y borra balas' },
      { name: 'Ojo de tormenta', hint: 'Tras el golpe, un remolino atrae y borra balas', rank: 2 },
      { name: 'Gemelas', hint: 'Una segunda columna cae 0,4 s después', rank: 4 },
    ],
  },
  leap: {
    name: 'Abordaje', hint: 'Salto que cae golpeando y borra balas', cast: 'ground',
    forms: [
      { name: 'Abordaje', hint: 'Salto que cae golpeando y borra balas' },
      { name: 'Parpadeo', hint: 'Teletransporte al punto; tu siguiente golpe es crítico', rank: 2 },
      { name: 'Ancla de abordaje', hint: 'Salto largo y área grande que aturde', rank: 4 },
    ],
  },
  wheel: {
    name: 'Timón', hint: 'Mantén para cargar: un timón que vuelve a ti', cast: 'charge',
    forms: [
      { name: 'Timón', hint: 'Mantén para cargar: un timón que vuelve a ti' },
      { name: 'Remolino', hint: 'Gira en el ápice borrando balas y golpeando', rank: 2 },
      { name: 'Timón de guerra', hint: 'Más grande y lento: empuja, sin devolución', rank: 4 },
    ],
  },
};
export const TATTOO_IDS = Object.keys(TATTOOS);

// xp: to go from rank n to n + 1 (n = 1…4); dmg: +6 % per rank above 1; catchUp: XP × 2 when the rank is below
// (your best − 1); swapCd: the least cooldown left on a changed slot; calm: s without damage to change anything;
// price: gold for each tattoo after the first (free); learnR: how close to Doña Sepia.
export const TATTOO = { xp: [120, 360, 900, 2000], maxRank: 5, dmg: 0.06, catchUp: 2, swapCd: 4, calm: 3, price: 150, learnR: 3.5 };
export const tattooXpToNext = (rank) => TATTOO.xp[Math.min(TATTOO.xp.length - 1, Math.max(0, rank - 1))];

export const DEFAULT_LOADOUT = { sable: ['lunge', 'wave'], pistolas: ['blast', 'blink'] };

// The slots in order (a loadout is one id per slot, in this order) and the ECS columns each one owns:
// skill index, form, rank, cooldown, press buffer.
export const LOADOUT_SLOTS = ['q', 'e']; // Only Q/E can be reassigned; G always comes from the pearl.
export const SLOTS = [...LOADOUT_SLOTS, 'g'];
export const SLOT_COLS = {
  q: { sk: 'skQ', fm: 'fmQ', rk: 'rkQ', cd: 'cdQ', buf: 'qBuf' },
  e: { sk: 'skE', fm: 'fmE', rk: 'rkE', cd: 'cdE', buf: 'eBuf' },
  g: { sk: 'skG', fm: 'fmG', rk: 'rkG', cd: 'cdG', buf: 'gBuf' },
};

export const isArt = (id) => Object.prototype.hasOwnProperty.call(ARTS, id);
export const isTattoo = (id) => Object.prototype.hasOwnProperty.call(TATTOOS, id);
export const castKind = (id) => (id === 'none' ? 'self' : id === 'iceanchor' || id === 'inkcloud' ? 'ground' : id === 'mastbolt' ? 'charge' : isArt(id) ? ARTS[id].cast : isTattoo(id) ? TATTOOS[id].cast : 'dir');
// The rank a form asks for (the base asks none).
export const formRank = (id, form) => (isTattoo(id) && TATTOOS[id].forms[form] ? TATTOOS[id].forms[form].rank || 1 : Infinity);
// The id held by `slot` ('q' | 'e') of entity e, read from the ECS columns.
export const slotSkill = (ecs, e, slot) => skillId(ecs[SLOT_COLS[slot].sk][e]);
