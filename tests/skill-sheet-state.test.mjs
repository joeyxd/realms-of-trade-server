import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { CURVES, NODES, nodeById, treeRank } from '../src/data/skillTree.js';
import { MASTERY } from '../src/data/weapons.js';

// skillSheet.js reaches hud.js (the skill SVGs), which imports gsap: stub it as the other UI tests do.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'gsap') return { url: 'data:text/javascript,export const gsap={fromTo(){}}', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { skillSheetState, skillGlyph } = await import('../src/ui/skillSheet.js');

const ranksOf = (state) => NODES.map((n) => state.skills[n.id]);

test('a null and an empty profile give an all-zero state without throwing', () => {
  for (const profile of [null, undefined, {}, { mast: [], sk: {}, pearls: {}, progression: {} }]) {
    const state = skillSheetState(profile, 0);
    assert.ok(ranksOf(state).every((r) => r === 0), 'every node rank is 0');
    assert.deepEqual(Object.values(state.practice), [0, 0, 0, 0, 0, 0]);
    assert.equal(Object.hasOwn(state, 'provisional'), false);
    assert.equal(state.pearl, false);
    for (const node of NODES) assert.equal(state.ctxFor(node).pearl, false);
    for (const id of ['combat', 'survival', 'sailing', 'crafting', 'trade']) assert.deepEqual(state.points(id), { earned: 0, spent: 0, free: 0 });
  }
});

test('a weak weapon index and odd shapes never throw', () => {
  assert.doesNotThrow(() => skillSheetState({ mast: 'x', sk: { has: 5 }, progression: { practice: 'x', skills: [] } }, 99));
  assert.doesNotThrow(() => skillSheetState({ mast: [null, [NaN, 'a']], pearls: null }, -1));
});

test('tattoo ranks migrate from the XP rank: 1 to 1, 2-3 to 2, 4-5 to 3', () => {
  const rank = (old) => skillSheetState({ sk: { has: { lunge: [old, 0, 0] } } }, 0).skills.lunge;
  assert.equal(rank(3), 2);
  assert.equal(rank(5), 3);
  assert.equal(rank(1), 1);
  assert.equal(rank(4), 3);
  assert.equal(skillSheetState({ sk: { has: { tromba: [2, 5, 0] } } }, 0).skills.tromba, 2);
});

test('a weapon art opens at rank 1 only when the weapon mastery reaches its requirement', () => {
  const below = skillSheetState({ mast: [[1, 0], [1, 0]] }, 0);
  assert.equal(below.skills.lunge, 1, 'lunge needs mastery 1 of the saber');
  assert.equal(below.skills.wave, 0, 'wave needs mastery 2');
  const at = skillSheetState({ mast: [[2, 0], [1, 30]] }, 0);
  assert.equal(at.skills.wave, 1);
  assert.equal(at.skills.blast, 1);
  assert.equal(at.skills.blink, 0, 'blink needs mastery 2 of the pistols');
  assert.equal(skillSheetState({ mast: [[5, 0], [3, 0]] }, 0).skills.blink, 1);
  assert.equal(skillSheetState({ mast: [[5, 0], [3, 0]] }, 0).skills.temple, 0, 'passives have no skill id');
});

test('progression.skills present wins over the fallback', () => {
  const profile = { mast: [[5, 0], [5, 0]], sk: { has: { lunge: [5, 0, 0] } }, progression: { skills: { lunge: 1, blast: 3 } } };
  const state = skillSheetState(profile, 0);
  assert.equal(state.skills.lunge, 1);
  assert.equal(state.skills.blast, 3);
  assert.equal(state.skills.wave, undefined);
  profile.progression.skills.lunge = 2;
  assert.equal(state.skills.lunge, 1, 'the state is a copy');
});

test('combat practice always comes from mastery even if an unvalidated counter is present', () => {
  const profile = { mast: [[6, 100], [3, 0]], progression: { practice: { combat: 42, logging: 7, trade: 3 } } };
  const state = skillSheetState(profile, 0);
  assert.equal(state.practice.combat, MASTERY.xp.slice(0, 5).reduce((a, b) => a + b, 0) + 100 + MASTERY.xp[0] + MASTERY.xp[1]);
  assert.equal(Object.hasOwn(state, 'provisional'), false);
  assert.equal(state.practice.logging, 7);
  assert.equal(state.practice.trade, 3);
  assert.equal(state.practice.sailing, 0);
  assert.equal(skillSheetState({ progression: { practice: { combat: 0 } } }, 0).practice.combat, 0);
});

test('combat practice sums the XP of every weapon mastery', () => {
  const state = skillSheetState({ mast: [[3, 10], [2, 5]] }, 0);
  const expected = MASTERY.xp[0] + MASTERY.xp[1] + 10 + MASTERY.xp[0] + 5;
  assert.equal(state.practice.combat, expected);
  assert.equal(Object.hasOwn(state, 'provisional'), false);
  // One weapon at mastery level L with no XP in the bar: the tree rank it buys.
  const rankAt = (level) => treeRank('combat', skillSheetState({ mast: [[level, 0]] }, 0).practice);
  assert.deepEqual([1, 2, 3, 4, 5].map(rankAt), [1, 2, 3, 4, 5]);
  assert.equal(CURVES.combat[0], MASTERY.xp[0]);
});

test('ctxFor reads the weapon in hand, both masteries, the knowledge and the swallowed pearl', () => {
  const profile = { mast: [[4, 0], [7, 0]], sk: { has: { tromba: [1, 0, 0] } }, pearls: { swallowed: { kind: 'ink' }, bag: [] } };
  const state = skillSheetState(profile, 1);
  const ctx = state.ctxFor(nodeById('tromba'));
  assert.equal(ctx.weapon, 'pistolas');
  assert.deepEqual(ctx.mastery, { sable: 4, pistolas: 7 });
  assert.deepEqual(ctx.knowledge, ['tattoo']);
  assert.equal(ctx.pearl, true);
  assert.deepEqual(state.ctxFor(nodeById('leap')).knowledge, []);
  assert.deepEqual(state.ctxFor(nodeById('temple')).knowledge, []);
  assert.equal(skillSheetState({ pearls: { swallowed: null, bag: [] } }, 0).ctxFor(nodeById('temple')).pearl, false);
});

test('free points never go negative', () => {
  // Rank 1 only: 0 earned, with more ranks spent than earned.
  const state = skillSheetState({ progression: { practice: { combat: 0 }, skills: { lunge: 3, wave: 3, blast: 3 } } }, 0);
  const pts = state.points('combat');
  assert.equal(pts.earned, 0);
  assert.equal(pts.spent, 9);
  assert.equal(pts.free, 0);
  const rich = skillSheetState({ mast: [[MASTERY.max, 0]], progression: { skills: { lunge: 2 } } }, 0).points('combat');
  assert.deepEqual(rich, { earned: 18, spent: 2, free: 16 });
});

test('skillGlyph picks the painted atlas cell when one exists and wraps the HUD svg otherwise', () => {
  assert.equal(skillGlyph('lunge', 'sk-ico'), '<span class="kit-ico sk-ico" data-atlas="skills" style="--ix:0;--iy:1" aria-hidden="true"></span>');
  assert.match(skillGlyph('steady_chop', 'sk-ico'), /^<span class="sk-ico"><svg/);
  assert.match(skillGlyph('nothing-like-this', 'x'), /^<span class="x"><svg/);
});
