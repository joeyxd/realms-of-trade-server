// A player's numbers (M4, PLAN-M4.md §2.2): level + equipped gear + the weapon's mastery → ECS columns.
// The server keeps profiles (world.profiles, entity → profile); the client's prediction world holds a copy of
// its own (MSG.PROFILE), so a predicted level-up refreshes to the same numbers. Without a profile (bots,
// tests, tools) this is the M3.6 game: level stats only, mastery 0 = the whole kit and no bonuses.
import { tuning } from '../../data/tuning.js';
import { STATS, SLOTS } from '../../data/items.js';
import { MASTERY, WEAPON_KINDS } from '../../data/weapons.js';
import { ARTS, DEFAULT_LOADOUT, LOADOUT_SLOTS as SKILL_SLOTS, SLOT_COLS, isArt, skillIndex, slotSkill } from '../../data/tattoos.js';
import { PEARLS } from '../../data/pearls.js';
import { itemStats, emptyStats } from '../items.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Per level: HP 100 + 12·(Lv−1), ATK 10 + 2·(Lv−1), DEF 2 + (Lv−1) (DESIGN §9).
export function statsFor(level) {
  const S = tuning.stats, l = Math.max(1, level) - 1;
  return { hp: S.hp[0] + S.hp[1] * l, atk: S.atk[0] + S.atk[1] * l, def: S.def[0] + S.def[1] * l };
}

// ---- Mastery ----------------------------------------------------------------------------------------------
// ecs.mastery packs one level per kit, 4 bits each (index = WEAPON_KINDS order).
export const masteryOf = (ecs, e, kind = ecs.weapon[e]) => Math.floor(ecs.mastery[e] / 16 ** kind) % 16;
export const packMastery = (levels) => levels.reduce((s, l, k) => s + Math.max(0, Math.min(15, l | 0)) * 16 ** k, 0);
export const masteryXpToNext = (lvl) => MASTERY.xp[Math.min(MASTERY.xp.length - 1, Math.max(0, lvl - 1))];

// May e use this slot ('q' | 'e' | 'r') yet? (0 = unmanaged: always.) Q / E hold an art (it needs its mastery on the
// weapon e carries) or a tattoo (always open); R is the weapon's and opens at MASTERY.unlock.r.
export function kitUnlocked(ecs, e, slot) {
  if (slot === 'g') return ecs.elem[e] > 0;
  const m = masteryOf(ecs, e);
  if (SLOT_COLS[slot]) {
    const id = slotSkill(ecs, e, slot);
    return m === 0 || !isArt(id) || m >= ARTS[id].mastery;
  }
  return m === 0 || m >= (MASTERY.unlock[slot] || 0);
}

// ---- Tattoos ------------------------------------------------------------------------------------------------
// The loadout of the weapon e carries → the slot columns (skill, form, rank). A profile keeps it in p.sk (lo per
// weapon, has[id] = [rank, xp, form]); without one (bots, tests, tools) it is the weapon's default arts.
export function applyLoadout(world, e) {
  const ecs = world.ecs, prof = world.profiles ? world.profiles.get(e) : null, k = Math.max(0, ecs.weapon[e] | 0);
  const kind = WEAPON_KINDS[k] || WEAPON_KINDS[0], sk = prof && prof.sk && prof.sk.lo ? prof.sk : null;
  const lo = (sk && sk.lo[k]) || DEFAULT_LOADOUT[kind];
  SKILL_SLOTS.forEach((slot, i) => {
    const c = SLOT_COLS[slot], id = lo[i] || DEFAULT_LOADOUT[kind][i], has = sk && sk.has ? sk.has[id] : null;
    ecs[c.sk][e] = skillIndex(id);
    ecs[c.fm][e] = has ? has[2] | 0 : 0;
    ecs[c.rk][e] = has ? has[0] | 0 : 1;
  });
}

// The passives of the weapon e carries reached so far, summed over `key` (0 when none has it).
export function passive(ecs, e, key) {
  const m = masteryOf(ecs, e), list = MASTERY.passives[WEAPON_KINDS[ecs.weapon[e]]];
  let v = 0;
  if (!m || !list) return 0;
  for (const p of list) if (m >= p.at && p[key]) v += p[key];
  return v;
}

// ---- Gear ---------------------------------------------------------------------------------------------------
export function gearTotals(profile, out = emptyStats()) {
  if (profile && profile.eq) for (const slot of SLOTS) if (profile.eq[slot]) itemStats(profile.eq[slot], out);
  return out;
}

const capped = (g, k) => clamp(g[k], STATS[k].min ?? -Infinity, STATS[k].cap ?? Infinity);

// Level + gear + mastery → the columns. HP keeps its fraction (a fallen player stays at 0).
export function refreshStats(world, e) {
  const ecs = world.ecs, prof = world.profiles ? world.profiles.get(e) : null;
  const base = statsFor(ecs.level[e]), g = gearTotals(prof);
  if (prof && Array.isArray(prof.mast)) ecs.mastery[e] = packMastery(WEAPON_KINDS.map((_, i) => (prof.mast[i] ? prof.mast[i][0] : 1)));
  const m = masteryOf(ecs, e);
  const frac = ecs.maxHp[e] > 0 ? ecs.hp[e] / ecs.maxHp[e] : 1;
  ecs.atk[e] = Math.round((base.atk + g.atk) * (1 + MASTERY.dmg * Math.max(0, m - 1)));
  ecs.def[e] = base.def + g.def;
  ecs.maxHp[e] = base.hp + g.hp;
  ecs.hp[e] = ecs.dead[e] > 0 ? 0 : Math.min(ecs.maxHp[e], Math.max(1, frac * ecs.maxHp[e]));
  ecs.speed[e] = tuning.player.runSpeed * (1 + capped(g, 'spd'));
  ecs.cdr[e] = capped(g, 'cdr');
  ecs.ripMul[e] = 1 + g.rip;
  ecs.reflMul[e] = 1 + g.refl;
  ecs.guardAdd[e] = g.guard;
  ecs.guardSt[e] = Math.min(ecs.guardSt[e], tuning.guard.stamina + g.guard);
  ecs.dashRec[e] = 1 - capped(g, 'dash');
  ecs.winBonus[e] = g.win + passive(ecs, e, 'win');
  ecs.fireMul[e] = (1 + g.fire) * (passive(ecs, e, 'fire') || 1);
  ecs.potHeal[e] = 1 + g.pot;
  ecs.xpMul[e] = 1 + g.xp;
  ecs.critAdd[e] = Math.max(0, Math.min(STATS.crit.cap - tuning.stats.crit, g.crit));
  ecs.critDAdd[e] = g.critD;
  ecs.goldMul[e] = 1 + g.gold;
  ecs.onKill[e] = g.kill;
  applyLoadout(world, e);
  const pearl = prof?.pearls?.swallowed, power = pearl && PEARLS[pearl.kind];
  ecs.elem[e] = power?.elem || 0;
  ecs.skG[e] = skillIndex(power?.skill || 'none'); ecs.fmG[e] = 0; ecs.rkG[e] = 1;
}

export const guardMax = (ecs, e) => tuning.guard.stamina + ecs.guardAdd[e];
