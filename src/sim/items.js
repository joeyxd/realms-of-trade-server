// Items (M4, PLAN-M4.md §2.1): rolling, stats, names and values. Pure functions over the compact item
// {u: uid, b: base id, r: rarity 0–4, l: item level, a: [[affix stat, points], …]}; the server rolls with its
// loot RNG, the client uses the same functions for tooltips and comparisons.
import { RARITIES, ITEMS, STATS, STAT_KEYS, BASES, BASE_KINDS, AFFIXES } from '../data/items.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round2 = (v) => Math.round(v * 100) / 100;
const SLOT_KINDS = ['weapon', 'head', 'chest', 'boots', 'ring'];

export const budget = (lvl, r) => (ITEMS.budget[0] + ITEMS.budget[1] * lvl) * RARITIES[r].mul;

// Rarity weights with a bonus b (the Mareas): rarity i ≥ 1 weighs × (1 + b·i). min: the lowest allowed.
export function rarityWeights(b = 0, min = 0) {
  return RARITIES.map((R, i) => (i < min ? 0 : R.weight * (i ? 1 + b * i : 1)));
}
export function rollRarity(rng, b = 0, min = 0) {
  const w = rarityWeights(b, min);
  let x = rng() * w.reduce((s, v) => s + v, 0);
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0 && w[i] > 0) return i; }
  return RARITIES.length - 1;
}

// Bases that drop at item level lvl (optionally one slot kind / one weapon kit).
export function basesFor(lvl, { slot, weapon } = {}) {
  return BASE_KINDS.filter((k) => {
    const B = BASES[k];
    return B.min <= lvl && (!slot || B.slot === slot) && (!weapon || B.weapon === weapon);
  });
}

// A fresh item. o: {lvl, uid, rarity (fixed) | minRarity + rarityBonus, slot (kind), weapon (kit), base}.
// The slot kind is picked first (each as likely), then a base of it, then the affixes.
export function rollItem(rng, o = {}) {
  const l = clamp(Math.round(o.lvl || 1), 1, ITEMS.maxLevel);
  const r = o.rarity ?? rollRarity(rng, o.rarityBonus || 0, o.minRarity || 0);
  let b = o.base;
  if (!BASES[b]) {
    let slot = o.slot || (o.weapon ? 'weapon' : SLOT_KINDS[Math.floor(rng() * SLOT_KINDS.length)]);
    let list = basesFor(l, { slot, weapon: o.weapon });
    if (!list.length) { slot = 'weapon'; list = basesFor(l, { slot }); }
    // Weapons: each kit as likely, whatever its number of bases.
    if (slot === 'weapon' && !o.weapon) {
      const kits = [...new Set(list.map((k) => BASES[k].weapon))];
      const kit = kits[Math.floor(rng() * kits.length)];
      list = list.filter((k) => BASES[k].weapon === kit);
    }
    b = list[Math.floor(rng() * list.length)];
  }
  const P = budget(l, r), pool = AFFIXES[BASES[b].slot].slice(), a = [];
  for (let k = 0; k < RARITIES[r].affixes && pool.length; k++) {
    const id = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    a.push([id, round2(P * (ITEMS.affixRoll[0] + (ITEMS.affixRoll[1] - ITEMS.affixRoll[0]) * rng()))]);
  }
  return { u: o.uid | 0, b, r, l, a };
}

// Flat stats are whole numbers on every item; the rest to 0.1 %.
const FLAT = new Set(['atk', 'def', 'hp', 'guard', 'kill']);
const fix = (k, v) => (FLAT.has(k) ? Math.round(v) : Math.round(v * 1000) / 1000);

export function emptyStats() {
  const o = {};
  for (const k of STAT_KEYS) o[k] = 0;
  return o;
}

// What one item gives: {atk, def, hp, crit, …} (zeros included).
export function itemStats(item, out = emptyStats()) {
  const B = BASES[item.b];
  if (!B) return out;
  const P = budget(item.l, item.r), part = emptyStats();
  for (const k in B.stats) part[k] += P * B.stats[k] * STATS[k].per;
  for (const [k, pts] of item.a) if (STATS[k]) part[k] += pts * STATS[k].per;
  if (B.flat) for (const k in B.flat) part[k] += B.flat[k];
  for (const k of STAT_KEYS) out[k] += fix(k, part[k]);
  return out;
}

// The affix with the most points names the item («Sable de cubierta del Tiburón»).
export function itemName(item) {
  const B = BASES[item.b];
  if (!B) return '¿?';
  let best = null;
  for (const [k, pts] of item.a) if (!best || pts > best[1]) best = [k, pts];
  return best ? `${B.name} ${STATS[best[0]].suffix}` : B.name;
}

export function itemValue(item) {
  const V = ITEMS.value, R = RARITIES[item.r] || RARITIES[0];
  return Math.max(1, Math.round((V.base + V.perLevel * item.l) * Math.pow(R.mul, V.rarityPow) * (1 + V.perAffix * item.a.length)));
}

// One number to rank items of the same slot (bots, «best weapon of this kit», upgrade arrows).
const SCORE = { atk: 3, def: 1.6, hp: 0.4, crit: 180, critD: 50, spd: 120, cdr: 120, rip: 40, refl: 60, guard: 0.5, dash: 60, xp: 20, gold: 15, pot: 25, kill: 1.5, win: 300, fire: -150 };
export function itemScore(item) {
  const s = itemStats(item);
  let v = 0;
  for (const k of STAT_KEYS) v += (SCORE[k] || 0) * s[k];
  return v;
}

// A saved / received item made safe: known base and affixes, sane numbers; null when it cannot be one.
export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object' || !BASES[raw.b]) return null;
  const r = raw.r | 0, l = raw.l | 0;
  if (r < 0 || r >= RARITIES.length || l < 1 || l > ITEMS.maxLevel) return null;
  const pool = AFFIXES[BASES[raw.b].slot], max = budget(l, r) * ITEMS.affixRoll[1] + 0.01, a = [], seen = new Set();
  for (const x of Array.isArray(raw.a) ? raw.a : []) {
    if (!Array.isArray(x) || !pool.includes(x[0]) || seen.has(x[0]) || !Number.isFinite(x[1])) return null;
    seen.add(x[0]);
    a.push([x[0], round2(clamp(x[1], 0, max))]);
  }
  if (a.length > RARITIES[r].affixes) return null;
  return { u: Math.max(0, raw.u | 0), b: raw.b, r, l, a };
}
