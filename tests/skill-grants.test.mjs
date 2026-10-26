// SK05a: equipment loans (PLAN-SKILLS.md 2.5). An item base may lend skills while worn; the lent art can sit in Q / E
// even with the other weapon in hand, the sheet marks it with a chain and the item, and nothing lent ever pays out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { BASES } from '../src/data/items.js';
import { NODES, MAX_NODE_RANK, nodeById, pointsSpent } from '../src/data/skillTree.js';
import { ARTS, skillId, skillIndex } from '../src/data/tattoos.js';
import { grantedSkills, effectiveRank, isLentArt, pruneLentLoadouts } from '../src/data/grants.js';
import { GAME } from '../src/data/meta.js';
import { World } from '../src/sim/world.js';
import { BTN } from '../src/sim/systems/movement.js';
import { installInventory, newProfile, attachProfile, sanitizeProfile, giveItem, equipItem, unequipItem, setLoadout, spillOnDeath, tattooXp } from '../src/sim/systems/inventory.js';
import { A, map } from './helpers.mjs';

// skillSheet.js reaches hud.js (the skill SVGs), which imports gsap: stub it as the other UI tests do.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'gsap') return { url: 'data:text/javascript,export const gsap={fromTo(){}}', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { skillSheetState, nodeView, skillCenterHtml, skillRightHtml } = await import('../src/ui/skillSheet.js');
const { grantLines } = await import('../src/ui/itemui.js');
const { atlasIcon, hasAtlasIcon, LINE_ICONS } = await import('../src/ui/kit.js');

const ring = (b = 'pedernal') => ({ u: 0, b, r: 0, l: 2, a: [] });

// A server world with one calm pirate holding the sabre (weapon 0) and a profile.
function fixture() {
  const w = new World(GAME.seed, { map, server: true });
  installInventory(w, 'grants-test');
  const e = w.spawnPlayer({ x: A.x, z: A.z + 5, facing: Math.PI / 2 });
  const profile = newProfile();
  attachProfile(w, e, profile);
  const ecs = w.ecs;
  ecs.regenT[e] = 99;
  let seq = 0;
  const step = (cmd = {}) => {
    w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, ax: ecs.x[e] + 5, az: ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...cmd });
    w.stepWorld();
    const events = w.events.slice();
    w.events.length = 0;
    return events;
  };
  // Put an item of base `b` on (first free ring hoop); returns it.
  const wear = (b = 'pedernal') => { const it = giveItem(w, e, ring(b)); assert.ok(equipItem(w, e, it.u), 'equipped'); w.events.length = 0; return it; };
  // A loadout command; returns the refusal reason ('' when accepted).
  const load = (slot, id) => {
    ecs.regenT[e] = 99; w.events.length = 0;
    const ok = setLoadout(w, e, slot, id), denied = w.events.find((ev) => ev.type === 'skillDenied');
    w.events.length = 0;
    return ok ? '' : denied ? denied.why : 'none';
  };
  const cols = () => [skillId(ecs.skQ[e]), skillId(ecs.skE[e])];
  return { w, e, ecs, profile, step, wear, load, cols };
}

// A test-only base lending `grants`, removed again when the test ends.
function tempBase(t, id, grants) {
  BASES[id] = { name: `Temp ${id}`, slot: 'ring', min: 99, stats: { atk: 0 }, grants };
  t.after(() => { delete BASES[id]; });
}

test('catalog: every BASES grant names a real skill-tree node and a rank inside the node ranks; pedernal lends blast 1', () => {
  const withGrants = Object.entries(BASES).filter(([, B]) => B.grants);
  assert.ok(withGrants.length >= 1);
  for (const [id, B] of withGrants) {
    assert.ok(Array.isArray(B.grants) && B.grants.length > 0, id);
    for (const g of B.grants) {
      const node = nodeById(g.skill);
      assert.ok(node, `${id} lends ${g.skill}: not a node`);
      assert.ok(NODES.some((n) => n.id === g.skill));
      assert.ok(Number.isInteger(g.rank) && g.rank >= 1 && g.rank <= node.ranks.length && g.rank <= MAX_NODE_RANK, `${id}: rank ${g.rank}`);
    }
  }
  assert.deepEqual(BASES.pedernal.grants, [{ skill: 'blast', rank: 1 }]);
  assert.equal(BASES.pedernal.slot, 'ring');
  assert.deepEqual(BASES.alpargatas.grants, [{ skill: 'swimmer', rank: 1 }]);
  assert.equal(BASES.alpargatas.slot, 'boots');
  assert.equal(nodeById('swimmer').tree, 'survival');
  assert.ok(!('grants' in BASES.brujula), 'no existing base changes');
});

test('two items lending the same node take the highest rank, never the sum; the owned rank wins when higher', (t) => {
  tempBase(t, 'tmpA', [{ skill: 'blast', rank: 1 }, { skill: 'lunge', rank: 2 }]);
  tempBase(t, 'tmpB', [{ skill: 'blast', rank: 3 }]);
  const eq = { ring1: ring('tmpA'), ring2: ring('tmpB') };
  assert.deepEqual(grantedSkills(eq), { blast: { rank: 3, by: ['tmpA', 'tmpB'] }, lunge: { rank: 2, by: ['tmpA'] } });
  assert.equal(grantedSkills({ ring1: ring('tmpA'), ring2: ring('tmpA') }).blast.rank, 1, 'the same base twice is still rank 1');
  assert.deepEqual(grantedSkills({ ring1: ring('pedernal'), ring2: ring('pedernal') }), { blast: { rank: 1, by: ['pedernal'] } });
  assert.deepEqual([grantedSkills(null), grantedSkills({}), grantedSkills({ ring1: { b: 'nope' } })], [{}, {}, {}]);
  const g = grantedSkills(eq);
  assert.equal(effectiveRank(0, g.blast), 3);
  assert.equal(effectiveRank(2, g.blast), 3);
  assert.equal(effectiveRank(3, { rank: 1 }), 3, 'owned rank above the loan stays');
  assert.equal(effectiveRank(1, undefined), 1);
  assert.equal(effectiveRank(0, undefined), 0);
});

test('pedernal worn with the sabre: Q and E accept the lent Ráfaga and the ECS column holds it', () => {
  const F = fixture(), { ecs, e, profile } = F;
  assert.equal(ecs.weapon[e], 0, 'sabre in hand');
  F.wear();
  assert.ok(isLentArt(grantedSkills(profile.eq), 'blast'));
  assert.equal(F.load('q', 'blast'), '');
  assert.equal(ecs.skQ[e], skillIndex('blast'));
  assert.deepEqual(profile.sk.lo[0], ['blast', 'wave']);
  assert.deepEqual(F.cols(), ['blast', 'wave']);
  assert.equal(F.load('e', 'blast'), '', 'E takes it too (the two slots swap)');
  assert.deepEqual(F.cols(), ['wave', 'blast']);
  assert.equal(F.load('e', 'blink'), 'weapon', 'only the lent id opens, not the pistols\' other art');
  assert.equal(F.load('r', 'blast'), 'unknown', 'R is never assignable');
  assert.deepEqual(profile.sk.lo[1], ['blast', 'blink'], 'the pistols\' own row is untouched');
});

test('without the item the same loadout is denied \'weapon\'', () => {
  const F = fixture();
  assert.equal(F.load('q', 'blast'), 'weapon');
  assert.deepEqual(F.cols(), ['lunge', 'wave']);
  assert.deepEqual(F.profile.sk.lo[0], ['lunge', 'wave']);
});

test('unequipping the item reverts every slot holding the lent art, in the saved loadout and the ECS; re-equipping does not restore it', () => {
  const F = fixture(), { ecs, e, profile } = F;
  const it = F.wear();
  F.load('q', 'blast');
  assert.deepEqual(F.cols(), ['blast', 'wave']);
  assert.ok(unequipItem(F.w, e, 'ring1'));
  assert.deepEqual(profile.sk.lo[0], ['lunge', 'wave']);
  assert.deepEqual(F.cols(), ['lunge', 'wave']);
  assert.equal(skillId(ecs.skQ[e]), 'lunge');
  assert.ok(equipItem(F.w, e, it.u, 'ring1'));
  assert.deepEqual(F.cols(), ['lunge', 'wave'], 're-equipping does not bring the lent art back');
  assert.deepEqual(profile.sk.lo[0], ['lunge', 'wave']);
});

test('swapping the item for another ring reverts it too; a weapon swap keeps it while the item stays worn', () => {
  const F = fixture(), { e, profile } = F;
  F.wear();
  F.load('e', 'blast');
  assert.deepEqual(F.cols(), ['lunge', 'blast']);
  const pistols = giveItem(F.w, e, { u: 0, b: 'chispa', r: 0, l: 1, a: [] });
  assert.ok(equipItem(F.w, e, pistols.u));
  assert.equal(F.ecs.weapon[e], 1);
  assert.deepEqual(F.cols(), ['blast', 'blink'], 'the pistols row, blast is theirs');
  const sabre = giveItem(F.w, e, { u: 0, b: 'sable', r: 0, l: 1, a: [] });
  assert.ok(equipItem(F.w, e, sabre.u));
  assert.deepEqual(F.cols(), ['lunge', 'blast'], 'back to the sabre: the loan is still there');
  const other = giveItem(F.w, e, ring('anillo'));
  assert.ok(equipItem(F.w, e, other.u, 'ring1')); // the hoop that held the pedernal
  assert.equal(profile.eq.ring1.b, 'anillo');
  assert.deepEqual(F.cols(), ['lunge', 'wave']);
  assert.deepEqual(profile.sk.lo[0], ['lunge', 'wave']);
});

test('a lawless spill takes the worn item and the lent art with it', () => {
  const F = fixture(), { ecs, e, profile, w } = F;
  F.wear();
  F.load('q', 'blast');
  const K = map.cala;
  ecs.x[e] = K.x; ecs.z[e] = K.z; ecs.y[e] = map.groundAt(K.x, K.z);
  assert.ok(map.lawlessAt(K.x, K.z));
  assert.ok(spillOnDeath(w, e) >= 1);
  assert.equal(profile.eq.ring1, null, 'the ring dropped');
  assert.deepEqual(profile.sk.lo[0], ['lunge', 'wave']);
  assert.deepEqual(F.cols(), ['lunge', 'wave']);
});

test('profile load: a lent art saved in the other weapon\'s row reverts without the item and stays with it', () => {
  const raw = (eq) => JSON.parse(JSON.stringify({ ...newProfile(), eq: { ...newProfile().eq, ...eq }, sk: { has: {}, lo: [['blast', 'wave'], ['blast', 'blink']], free: 1 } }));
  const bare = sanitizeProfile(raw({}));
  assert.deepEqual(bare.sk.lo, [['lunge', 'wave'], ['blast', 'blink']]);
  const worn = sanitizeProfile(raw({ ring1: { u: 40, b: 'pedernal', r: 0, l: 2, a: [] } }));
  assert.equal(worn.eq.ring1.b, 'pedernal');
  assert.deepEqual(worn.sk.lo, [['blast', 'wave'], ['blast', 'blink']]);
  // The shared pruner agrees with the sanitizer.
  const sk = { has: {}, lo: [['blast', 'wave'], ['lunge', 'blink']], free: 1 };
  assert.equal(pruneLentLoadouts(sk, {}), true);
  assert.deepEqual(sk.lo, [['lunge', 'wave'], ['blast', 'blink']]);
  assert.equal(pruneLentLoadouts(sk, {}), false);
});

test('casting the lent art credits no tattoo XP, no mastery and no practice', () => {
  const F = fixture(), { e, profile, ecs } = F;
  F.wear();
  F.load('q', 'blast');
  const before = JSON.stringify([profile.mast, profile.sk.has, profile.progression, profile.stats]);
  ecs.regenT[e] = 99; ecs.cdQ[e] = 0; // a changed slot cools down for a few seconds
  const evs = F.step({ prs: BTN.Q });
  assert.ok(evs.some((ev) => ev.type === 'cast' && ev.skill === 'blast'), 'Ráfaga cast with the sabre in hand');
  for (let i = 0; i < 40; i++) F.step();
  assert.equal(JSON.stringify([profile.mast, profile.sk.has, profile.progression, profile.stats]), before);
  // XP earned any other way: the lent art is not a tattoo (no ink) and the pistols' mastery never moves.
  const pistolsBefore = JSON.stringify(profile.mast[1]);
  tattooXp(F.w, e, 500);
  F.w.onXp(e, 50);
  assert.deepEqual(profile.sk.has, {});
  assert.equal(JSON.stringify(profile.mast[1]), pistolsBefore);
  assert.deepEqual(profile.sk.lo[0], ['blast', 'wave']);
});

test('the sheet: a lent node shows the lent rank, the chain and the item while Subir, points and tier gates see owned rank 0', () => {
  const eq = { ring1: { u: 7, b: 'pedernal', r: 0, l: 2, a: [] } };
  // Mastery 10 on both weapons opens the tiers and 4 granted points are free, so Subir is live for an unowned node.
  // An adopted progression (skills: {}) means blast is owned at rank 0 (a legacy profile would derive it from mastery).
  const profile = { ...newProfile(), eq, mast: [[10, 0], [10, 0]], progression: { skills: {}, skg: { combat: 4 } } };
  const state = skillSheetState(profile, 0);
  const blast = nodeById('blast'), lunge = nodeById('lunge');
  assert.deepEqual(state.lent, { blast: { rank: 1, by: ['Pedernal de pistolero'] } });
  const v = nodeView(state, blast);
  assert.equal(v.rank, 1);
  assert.equal(v.owned, 0);
  assert.deepEqual(v.lent, { rank: 1, by: ['Pedernal de pistolero'] });
  assert.match(v.cls, /is-lent/);
  assert.doesNotMatch(v.cls, /is-locked/);
  assert.equal(nodeView(state, lunge).lent, null);
  assert.equal(state.skills.blast ?? 0, 0, 'owned ranks stay owned');
  assert.equal(pointsSpent('combat', state.skills), 0);
  assert.equal(state.points('combat').spent, 0);
  const sel = { tree: 'combat', node: 'blast' }, ctl = { enabled: true };
  const grid = skillCenterHtml(state, sel, 'es', ctl);
  assert.match(grid, /data-node="blast"[^>]*title="Ráfaga · Prestado por Pedernal de pistolero"/);
  assert.match(grid, /class="sk-chain"/);
  assert.equal((grid.match(/class="sk-chain"/g) || []).length, 1, 'only the lent node is chained');
  const detail = skillRightHtml(state, sel, 'es', {}, ctl);
  assert.match(detail, /class="sk-lent"/);
  assert.match(detail, /Prestado por Pedernal de pistolero/);
  assert.match(detail, /data-put="q" data-id="blast"/);
  assert.match(detail, /data-put="e" data-id="blast"/);
  assert.match(detail, /data-skill-op="assign" data-tree="combat" data-node="blast"/, 'Subir is live: it spends from the owned rank 0');
  assert.match(skillRightHtml(state, sel, 'en', {}, ctl), /Lent by /);
  assert.match(skillRightHtml(state, sel, 'en', {}, ctl), /Put in Q/);
  // With the pistols in hand the art is native: the character screen's own card handles Q / E.
  const held = skillSheetState(profile, 1);
  assert.doesNotMatch(skillRightHtml(held, sel, 'es', {}, ctl), /data-id="blast"/);
  assert.equal(nodeView(held, blast).lent.rank, 1);
  // No item, no chain.
  const none = skillSheetState({ ...profile, eq: {} }, 0);
  assert.deepEqual(none.lent, {});
  assert.equal(nodeView(none, blast).rank, 0);
  assert.doesNotMatch(skillCenterHtml(none, sel, 'es', ctl), /sk-chain/);
});

test('an owned rank above the loan keeps showing; the loan never lowers it', () => {
  const profile = { ...newProfile(), eq: { ring1: { u: 7, b: 'pedernal', r: 0, l: 2, a: [] } }, mast: [[10, 0], [10, 0]],
    progression: { skills: { blast: 2 } } };
  const state = skillSheetState(profile, 1);
  const v = nodeView(state, nodeById('blast'));
  assert.equal(v.owned, 2);
  assert.equal(v.rank, 2);
  assert.equal(pointsSpent('combat', state.skills), 2);
});

test('tooltip and icon: the base lists what it lends in both languages and borrows the compass icon cell', () => {
  assert.deepEqual(grantLines({ b: 'pedernal' }), ['Presta: Ráfaga (rango 1)']);
  assert.deepEqual(grantLines({ b: 'brujula' }), []);
  assert.ok(hasAtlasIcon('pedernal'));
  assert.equal(atlasIcon('pedernal', 'x'), atlasIcon('brujula', 'x'));
  assert.ok(atlasIcon('pedernal', 'x').includes('--ix:'));
  assert.ok(LINE_ICONS.chain.startsWith('<svg') && LINE_ICONS.chain.includes('currentColor'));
  assert.ok(Object.hasOwn(ARTS, 'blast'));
});

test('alpargatas lend the Survival passive Nadador: chained on the sheet, no Q / E, the loadout untouched; it leaves with the boots', () => {
  const F = fixture(), { e, profile } = F;
  const before = profile.sk.lo.map((row) => [...row]);
  F.wear('alpargatas');
  assert.equal(profile.eq.boots?.b, 'alpargatas');
  assert.deepEqual(grantedSkills(profile.eq), { swimmer: { rank: 1, by: ['alpargatas'] } });
  assert.ok(!isLentArt(grantedSkills(profile.eq), 'swimmer'), 'a passive is not a Q / E art');
  assert.equal(F.load('q', 'swimmer'), 'unknown');
  assert.deepEqual(profile.sk.lo, before);
  const state = skillSheetState(profile, 0), swimmer = nodeById('swimmer'), sel = { tree: 'survival', node: 'swimmer' };
  assert.deepEqual(state.lent, { swimmer: { rank: 1, by: ['Alpargatas de pescador'] } });
  const v = nodeView(state, swimmer);
  assert.equal(v.rank, 1);
  assert.equal(v.owned, 0);
  assert.equal(state.points('survival').spent, 0);
  assert.match(skillCenterHtml(state, sel, 'es', { enabled: true }), /data-node="swimmer"[^>]*title="Nadador · Prestado por Alpargatas de pescador"/);
  const detail = skillRightHtml(state, sel, 'es', {}, { enabled: true });
  assert.match(detail, /Prestado por Alpargatas de pescador/);
  assert.doesNotMatch(detail, /data-put=/);
  assert.match(skillRightHtml(state, sel, 'en', {}, { enabled: true }), /Lent by /); // the item name follows the UI locale
  assert.deepEqual(grantLines({ b: 'alpargatas' }), ['Presta: Nadador (rango 1)']);
  assert.equal(atlasIcon('alpargatas', 'x'), atlasIcon('botas', 'x'));
  assert.ok(unequipItem(F.w, e, 'boots'));
  assert.deepEqual(grantedSkills(profile.eq), {});
  assert.deepEqual(skillSheetState(profile, 0).lent, {});
});
