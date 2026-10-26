import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TREES, TIERS, NODES, CURVES, MAX_TREE_RANK, MAX_NODE_RANK, POINTS_PER_RANK, GRID_COLS,
  practiceOf, treeRank, practiceToNext, tierOpen, pointsEarned, pointsSpent, pointsFree,
  nodeRank, nodeById, nodesByTier, canRaise, gateState, migrateTattooRank, treeSummary, validateCatalog,
} from '../src/data/skillTree.js';
import { MASTERY } from '../src/data/weapons.js';
import { TATTOO } from '../src/data/tattoos.js';

test('catalog validates clean', () => {
  assert.deepEqual(validateCatalog(), []);
});

test('catalog sizes and constants', () => {
  assert.equal(NODES.length, 39);
  assert.equal(TREES.length, 6);
  assert.deepEqual(TREES.map((t) => t.id), ['combat', 'survival', 'sailing', 'crafting', 'trade', 'exploration']);
  assert.equal(TREES.filter((t) => t.hidden).length, 1);
  assert.equal(TREES.find((t) => t.id === 'exploration').hidden, true);
  assert.deepEqual(TIERS.map((t) => t.rank), [1, 3, 5, 7, 9]);
  assert.deepEqual(TIERS.map((t) => t.roman), ['I', 'II', 'III', 'IV', 'V']);
  assert.equal(MAX_TREE_RANK, 10);
  assert.equal(MAX_NODE_RANK, 3);
  assert.equal(POINTS_PER_RANK, 2);
  assert.equal(GRID_COLS, 3);
  assert.equal(NODES.filter((n) => n.tree === 'combat').length, 15);
  assert.equal(NODES.filter((n) => n.tree === 'exploration').length, 0);
});

test('combat reuses the mastery curve and the active ranks use the tattoo damage step', () => {
  let total = 0;
  assert.deepEqual(CURVES.combat, MASTERY.xp.map((n) => (total += n)));
  assert.deepEqual(nodeById('lunge').ranks, [{ dmg: 0 }, { dmg: TATTOO.dmg }, { dmg: 2 * TATTOO.dmg }]);
  assert.deepEqual(nodeById('steady_chop').ranks, [{}, {}, {}]);
  assert.equal(nodeById('pearl_affinity').draft, true);
  assert.equal(nodeById('temple').draft, false);
});

test('practiceOf sums survival and logging and ignores missing keys', () => {
  assert.equal(practiceOf('survival', { survival: 30, logging: 40, combat: 999 }), 70);
  assert.equal(practiceOf('survival', { logging: 25 }), 25);
  assert.equal(practiceOf('trade', {}), 0);
  assert.equal(practiceOf('trade', null), 0);
  assert.equal(practiceOf('nope', { trade: 5 }), 0);
});

test('treeRank follows the curve from 1 to 10', () => {
  assert.equal(treeRank('sailing', {}), 1);
  assert.equal(treeRank('sailing', { sailing: 59 }), 1);
  assert.equal(treeRank('sailing', { sailing: 60 }), 2);
  assert.equal(treeRank('sailing', { sailing: 5499 }), 9);
  assert.equal(treeRank('sailing', { sailing: 5500 }), 10);
  assert.equal(treeRank('sailing', { sailing: 999999 }), 10);
  assert.equal(treeRank('survival', { survival: 30, logging: 30 }), 2);
  assert.equal(treeRank('combat', { combat: MASTERY.xp[0] }), 2);
  assert.equal(treeRank('combat', { combat: MASTERY.xp[0] + MASTERY.xp[1] }), 3);
});

test('practiceToNext reports cumulative have/need and null at max rank', () => {
  assert.deepEqual(practiceToNext('crafting', { crafting: 100 }), { have: 100, need: 160 });
  assert.deepEqual(practiceToNext('crafting', {}), { have: 0, need: 60 });
  assert.equal(practiceToNext('crafting', { crafting: 5500 }), null);
});

test('tierOpen boundaries at ranks 1, 3, 5, 7 and 9', () => {
  const open = (p) => [1, 2, 3, 4, 5].map((t) => tierOpen('trade', { trade: p }, t));
  assert.deepEqual(open(0), [true, false, false, false, false]);
  assert.deepEqual(open(159), [true, false, false, false, false]);
  assert.deepEqual(open(160), [true, true, false, false, false]);
  assert.deepEqual(open(599), [true, true, false, false, false]);
  assert.deepEqual(open(600), [true, true, true, false, false]);
  assert.deepEqual(open(1600), [true, true, true, true, false]);
  assert.deepEqual(open(3800), [true, true, true, true, true]);
  assert.equal(tierOpen('trade', { trade: 99999 }, 6), false);
});

test('pointsEarned is 0 at rank 1 and 18 at rank 10', () => {
  assert.equal(pointsEarned('trade', {}), 0);
  assert.equal(pointsEarned('trade', { trade: 60 }), 2);
  assert.equal(pointsEarned('trade', { trade: 5500 }), 18);
});

test('pointsSpent and pointsFree count only the tree own nodes', () => {
  const skills = { haggling: 2, contacts: 1, lunge: 3, nonsense: 3 };
  assert.equal(pointsSpent('trade', skills), 3);
  assert.equal(pointsSpent('combat', skills), 3);
  assert.equal(pointsSpent('sailing', skills), 0);
  // Rank 4 of the trade tree earns 6 points; 3 are spent.
  assert.equal(pointsFree('trade', { trade: 320 }, skills), 3);
  assert.equal(pointsFree('trade', { trade: 60 }, skills), 0);
});

test('nodeRank clamps to an integer 0..3', () => {
  assert.equal(nodeRank({ lunge: 2 }, 'lunge'), 2);
  assert.equal(nodeRank({ lunge: 9 }, 'lunge'), 3);
  assert.equal(nodeRank({ lunge: -4 }, 'lunge'), 0);
  assert.equal(nodeRank({ lunge: 1.9 }, 'lunge'), 1);
  assert.equal(nodeRank({ lunge: 'x' }, 'lunge'), 0);
  assert.equal(nodeRank({}, 'lunge'), 0);
  assert.equal(nodeRank(null, 'lunge'), 0);
});

test('canRaise reasons', () => {
  const practice = { trade: 160 }; // rank 3: tier II open, 4 points
  assert.deepEqual(canRaise('trade', 'haggling', { practice, skills: {} }), { ok: true, reason: null });
  assert.deepEqual(canRaise('trade', 'nope', { practice, skills: {} }), { ok: false, reason: 'unknown' });
  assert.deepEqual(canRaise('trade', 'lunge', { practice, skills: {} }), { ok: false, reason: 'tree' });
  assert.equal(canRaise('combat', 'tromba', { practice: { combat: 140 }, skills: {} }).reason, 'tier');
  assert.equal(canRaise('trade', 'haggling', { practice, skills: { haggling: 3 } }).reason, 'max');
  assert.equal(canRaise('trade', 'haggling', { practice, skills: { contacts: 3, contracts: 1 } }).reason, 'points');
  assert.equal(canRaise('trade', 'haggling', { practice: {}, skills: {} }).reason, 'points');
});

test('gateState for weapon, mastery, knowledge and pearl', () => {
  const ctx = { weapon: 'sable', mastery: { sable: 5, pistolas: 0 }, knowledge: [], pearl: false };
  assert.deepEqual(gateState({ gate: null }, ctx), { ok: true, reason: null });
  assert.deepEqual(gateState(nodeById('steady_chop'), {}), { ok: true, reason: null });
  assert.deepEqual(gateState(nodeById('lunge'), ctx), { ok: true, reason: null });
  assert.equal(gateState(nodeById('blast'), ctx).reason, 'weapon');
  assert.equal(gateState(nodeById('temple'), ctx).ok, true);
  assert.equal(gateState(nodeById('eye'), ctx).reason, 'mastery');
  assert.equal(gateState(nodeById('eye'), { ...ctx, mastery: { sable: 10 } }).ok, true);
  assert.equal(gateState(nodeById('tromba'), ctx).reason, 'knowledge');
  assert.equal(gateState(nodeById('tromba'), { ...ctx, knowledge: ['tattoo'] }).ok, true);
  assert.equal(gateState(nodeById('pearl_affinity'), ctx).reason, 'pearl');
  assert.equal(gateState(nodeById('pearl_affinity'), { ...ctx, pearl: true }).ok, true);
});

test('combat gates match the mastery table', () => {
  assert.deepEqual(nodeById('wave').gate, { weapon: 'sable', mastery: MASTERY.unlock.e });
  assert.deepEqual(nodeById('rain').gate, { weapon: 'pistolas', mastery: MASTERY.unlock.r });
  assert.deepEqual(nodeById('trigger').gate, { weapon: 'pistolas', mastery: 5 });
  assert.deepEqual(nodeById('deluge').gate, { weapon: 'pistolas', mastery: 10, pearl: true });
  assert.equal(nodeById('deluge').passive, 'deluge');
});

test('migrateTattooRank table', () => {
  const table = [[0, 0], [1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [6, 3], [99, 3], [-1, 0], [NaN, 0], [undefined, 0]];
  for (const [from, to] of table) assert.equal(migrateTattooRank(from), to, `rank ${from}`);
});

test('nodesByTier is 5 rows of 3 with nulls for empty cells', () => {
  const combat = nodesByTier('combat');
  assert.equal(combat.length, 5);
  assert.ok(combat.every((row) => row.length === 3 && row.every((c) => c && c.tree === 'combat')));
  assert.deepEqual(combat.map((row) => row.map((c) => c.id)), [
    ['lunge', 'blast', 'temple'], ['wave', 'blink', 'trigger'], ['tromba', 'leap', 'wheel'],
    ['storm', 'rain', 'eye'], ['pearl_affinity', 'deluge', 'curse_tamed'],
  ]);
  const sailing = nodesByTier('sailing');
  assert.ok(sailing[0].every(Boolean) && sailing[1].every(Boolean));
  assert.ok(sailing.slice(2).every((row) => row.length === 3 && row.every((c) => c === null)));
  const exploration = nodesByTier('exploration');
  assert.equal(exploration.length, 5);
  assert.ok(exploration.every((row) => row.length === 3 && row.every((c) => c === null)));
});

test('treeSummary bundles rank, points and tiers', () => {
  const s = treeSummary('survival', { practice: { survival: 100, logging: 60 }, skills: { swimmer: 1, lunge: 3 } });
  assert.equal(s.id, 'survival');
  assert.equal(s.rank, 3);
  assert.equal(s.practice, 160 - 0);
  assert.deepEqual(s.toNext, { have: 160, need: 320 });
  assert.deepEqual(s.points, { earned: 4, spent: 1, free: 3 });
  assert.deepEqual(s.tiers.map((t) => t.open), [true, true, false, false, false]);
  assert.equal(s.raised, 1);
});

test('node ids are unique across trees', () => {
  const ids = NODES.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('tree ids that name inherited properties are unknown trees, not crashes', () => {
  assert.equal(treeRank('constructor', {}), 1);
  assert.equal(practiceToNext('constructor', {}), null);
  assert.equal(treeSummary('constructor', { practice: {}, skills: {} }).rank, 1);
});

test('deluge needs pistolas mastery 10 and a swallowed pearl', () => {
  const node = nodeById('deluge');
  assert.deepEqual(node.gate, { weapon: 'pistolas', mastery: 10, pearl: true });
  const ctx = { weapon: 'pistolas', mastery: { sable: 0, pistolas: 10 }, knowledge: [], pearl: false };
  assert.equal(gateState(node, ctx).reason, 'pearl');
  assert.equal(gateState(node, { ...ctx, pearl: true }).ok, true);
});
