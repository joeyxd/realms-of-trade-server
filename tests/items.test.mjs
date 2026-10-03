// M4 P1: items (rolls, stats, names, values) and a player's numbers from level + gear + mastery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/core/rng.js';
import { tuning } from '../src/data/tuning.js';
import { RARITIES, ITEMS, BASES, AFFIXES, STATS } from '../src/data/items.js';
import { MASTERY } from '../src/data/weapons.js';
import { rollItem, rollRarity, rarityWeights, itemStats, itemName, itemValue, itemScore, sanitizeItem, budget } from '../src/sim/items.js';
import { statsFor, refreshStats, packMastery, masteryOf } from '../src/sim/systems/stats.js';
import { arena } from './helpers.mjs';

test('rarities follow their weights; the Mareas bonus and a floor shift them', () => {
  const rng = mulberry32(42), N = 200000, n = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) n[rollRarity(rng)]++;
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  RARITIES.forEach((r, i) => assert.ok(Math.abs(n[i] / N - r.weight / total) < 0.005, `${r.id} ${(n[i] / N * 100).toFixed(2)} %`));
  const w = rarityWeights(1);
  assert.ok(w[4] / w.reduce((s, v) => s + v, 0) > 0.02, 'b = 1: legendaries above 2 %');
  for (let i = 0; i < 2000; i++) assert.ok(rollRarity(rng, 0, 2) >= 2, 'never below the floor');
});

test('items: deterministic, every slot as likely, bases by level, affixes by rarity within the budget', () => {
  const a = rollItem(mulberry32(7), { lvl: 5, uid: 3 }), b = rollItem(mulberry32(7), { lvl: 5, uid: 3 });
  assert.deepEqual(a, b, 'same seed, same item');
  const rng = mulberry32(99), slots = {};
  for (let i = 0; i < 20000; i++) {
    const it = rollItem(rng, { lvl: 1 + (i % 15) });
    const B = BASES[it.b];
    slots[B.slot] = (slots[B.slot] || 0) + 1;
    assert.ok(B.min <= it.l, `${it.b} at level ${it.l}`);
    assert.equal(it.a.length, RARITIES[it.r].affixes);
    assert.equal(new Set(it.a.map((x) => x[0])).size, it.a.length, 'no repeated affix');
    const P = budget(it.l, it.r);
    for (const [k, pts] of it.a) {
      assert.ok(AFFIXES[B.slot].includes(k), `${k} on ${B.slot}`);
      assert.ok(pts >= P * ITEMS.affixRoll[0] - 0.01 && pts <= P * ITEMS.affixRoll[1] + 0.01, `${k} ${pts} of ${P}`);
    }
  }
  for (const k of ['weapon', 'head', 'chest', 'boots', 'ring']) assert.ok(Math.abs(slots[k] / 20000 - 0.2) < 0.02, `${k} ${slots[k]}`);
  const w = rollItem(mulberry32(1), { lvl: 3, weapon: 'pistolas', rarity: 4 });
  assert.equal(BASES[w.b].weapon, 'pistolas');
  assert.equal(w.r, 4);
  assert.equal(w.a.length, 4);
});

test('item stats, names and value', () => {
  // A common level-1 cutlass: 2.8 budget points → +3 ATK.
  assert.deepEqual(pick(itemStats({ u: 1, b: 'sable', r: 0, l: 1, a: [] }), ['atk', 'def', 'hp']), { atk: 3, def: 0, hp: 0 });
  // A rare level-6 tricorne: P = 11.56 → DEF 0.6·P ≈ 7, HP 0.4·P·5 ≈ 23; its affixes on top.
  const tri = { u: 2, b: 'tricornio', r: 2, l: 6, a: [['crit', 4], ['hp', 5]] };
  const s = itemStats(tri);
  assert.equal(s.def, 7);
  assert.equal(s.hp, Math.round(budget(6, 2) * 0.4 * 5 + 5 * 5));
  assert.equal(s.crit, 0.02);
  assert.equal(itemName(tri), 'Tricornio del Kraken', 'named after its biggest affix');
  assert.equal(itemName({ u: 3, b: 'chaleco', r: 0, l: 1, a: [] }), 'Chaleco de lona');
  // Base extras ignore the budget.
  assert.equal(itemStats({ u: 4, b: 'daga', r: 0, l: 2, a: [] }).win, 0.02);
  assert.equal(itemStats({ u: 5, b: 'coraza', r: 0, l: 4, a: [] }).spd, -0.03);
  assert.equal(itemStats({ u: 6, b: 'trabuco', r: 0, l: 4, a: [] }).fire, 0.2);
  // Value grows with level, rarity and affixes.
  const v = (r, l, n = 0) => itemValue({ u: 0, b: 'sable', r, l, a: Array.from({ length: n }, (_, i) => [AFFIXES.weapon[i], 1]) });
  assert.ok(v(0, 1) < v(0, 5) && v(0, 5) < v(2, 5, 2) && v(2, 5, 2) < v(4, 5, 4));
  assert.ok(itemScore({ u: 0, b: 'sable', r: 2, l: 5, a: [] }) > itemScore({ u: 0, b: 'sable', r: 0, l: 5, a: [] }));
});

test('sanitizeItem keeps good items and refuses forged ones', () => {
  const good = rollItem(mulberry32(5), { lvl: 8, rarity: 3 });
  assert.deepEqual(sanitizeItem(JSON.parse(JSON.stringify(good))), good);
  assert.equal(sanitizeItem({ ...good, b: 'excalibur' }), null);
  assert.equal(sanitizeItem({ ...good, r: 9 }), null);
  assert.equal(sanitizeItem({ ...good, l: 99 }), null);
  assert.equal(sanitizeItem({ ...good, a: [...good.a, ['atk', 1], ['def', 1]] }), null, 'too many affixes');
  assert.equal(sanitizeItem({ ...good, r: 0 }), null, 'a common with affixes');
  const dup = { u: 1, b: 'sable', r: 2, l: 5, a: [['atk', 1], ['atk', 1]] };
  assert.equal(sanitizeItem(dup), null, 'repeated affix');
  const fat = sanitizeItem({ u: 1, b: 'sable', r: 1, l: 5, a: [['atk', 9999]] });
  assert.ok(fat.a[0][1] <= budget(5, 1) * ITEMS.affixRoll[1] + 0.01, 'points clamped to what a roll can give');
});

// A profile wearing `eq` (items), at mastery `mast` for each kit.
const profile = (eq, mast = [1, 1]) => ({ eq, mast: mast.map((m) => [m, 0]) });

test('refreshStats: level + gear + mastery; caps; HP keeps its fraction; no profile is the old game', () => {
  const { w, e } = arena({ level: 5 });
  const ecs = w.ecs, base = statsFor(5);
  assert.equal(ecs.atk[e], base.atk);
  assert.equal(ecs.speed[e], tuning.player.runSpeed);
  assert.equal(masteryOf(ecs, e), 0, 'unmanaged');
  w.profiles = new Map([[e, profile({
    weapon: { u: 1, b: 'sable', r: 2, l: 5, a: [['atk', 4], ['cdr', 5]] },
    boots: { u: 2, b: 'botas', r: 4, l: 10, a: [['spd', 14], ['dash', 15], ['def', 1], ['hp', 1]] },
    ring1: { u: 3, b: 'anillo', r: 4, l: 15, a: [['crit', 20], ['cdr', 20], ['xp', 5], ['gold', 5]] },
    ring2: { u: 4, b: 'brujula', r: 1, l: 3, a: [['pot', 2]] },
  }, [4, 1])]]);
  ecs.hp[e] = ecs.maxHp[e] / 2;
  refreshStats(w, e);
  const g = (b, r, l, k) => budget(l, r) * BASES[b].stats[k];
  const wpnAtk = Math.round(g('sable', 2, 5, 'atk')) + 4;
  assert.equal(ecs.atk[e], Math.round((base.atk + wpnAtk) * (1 + MASTERY.dmg * 3)), 'mastery 4: +6 %');
  assert.equal(masteryOf(ecs, e, 0), 4);
  assert.equal(masteryOf(ecs, e, 1), 1);
  assert.equal(ecs.cdr[e], STATS.cdr.cap, 'cooldown reduction capped at 30 %');
  assert.equal(ecs.speed[e], tuning.player.runSpeed * (1 + STATS.spd.cap), 'speed capped at +25 %');
  assert.ok(Math.abs(ecs.dashRec[e] - (1 - STATS.dash.cap)) < 1e-12, 'dash recharge capped');
  assert.ok(Math.abs(ecs.hp[e] / ecs.maxHp[e] - 0.5) < 1e-9, 'half HP stays half');
  assert.ok(ecs.critAdd[e] > 0.1 && ecs.critAdd[e] + tuning.stats.crit <= STATS.crit.cap + 1e-12);
  assert.ok(ecs.xpMul[e] > 1 && ecs.goldMul[e] > 1);
  assert.equal(packMastery([4, 1]), 4 + 16);
});

function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }
