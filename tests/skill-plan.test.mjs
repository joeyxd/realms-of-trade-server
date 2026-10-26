import test from 'node:test';
import assert from 'node:assert/strict';
import { kitOf, newProfile } from '../src/sim/systems/inventory.js';
import { readProgression } from '../src/sim/systems/progression.js';
import { planSkillChange, parseSkillCommand } from '../src/sim/systems/skillPlan.js';
import { NODES, RESET_FREE, SKILL_RESET_GOLD, TREES, canRaise, legacySkills } from '../src/data/skillTree.js';

const clone = structuredClone;
const assign = (p, node, extra = {}) => ({ type: 'skills', op: 'assign', opId: `assign-${node}`,
  expectedRev: p.eco.tradeRev, tree: NODES.find(n => n.id === node)?.tree ?? 'combat', node, ...extra });
const reset = (p, tree = 'combat', extra = {}) => ({ type: 'skills', op: 'reset', opId: `reset-${tree}`,
  expectedRev: p.eco.tradeRev, tree, ...extra });
// Mastery levels per weapon; combat practice is derived from them (sable 4 -> 500 practice, combat rank 4).
function character(sable = 4, pistolas = 1, edit = () => {}) {
  const p = newProfile(); p.mast = [[sable, 0], [pistolas, 0]]; edit(p); return p;
}
const v3 = (skills, extra = {}) => ({ v: 3, practice: { logging: 0 }, milestones: [], knowledge: [], skills,
  skr: {}, skg: { combat: 0, survival: 0, sailing: 0, crafting: 0, trade: 0 }, ...extra });
const others = p => { const o = clone(p); delete o.progression; delete o.gold; delete o.eco.tradeRev; return o; };

test('assign raises one rank by one point, adopts implicitly, and round-trips readProgression', () => {
  const p = character(4, 1, q => { q.gold = 7; q.sk.has.tromba = [2, 0, 0]; }), before = clone(p);
  const r = planSkillChange(p, assign(p, 'lunge'));
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(p, before, 'the source profile is never mutated');
  const progression = r.profile.progression;
  assert.equal(progression.v, 3);
  assert.deepEqual(readProgression(progression), progression, 'the written block passes the shared reader unchanged');
  const legacy = legacySkills(p.sk.has, { sable: 4, pistolas: 1 });
  assert.deepEqual(progression.skills, { ...legacy, lunge: legacy.lunge + 1 });
  assert.equal(progression.skills.tromba, 2, 'tattoo rank 2 migrates to node rank 2');
  assert.deepEqual(progression.skr, {});
  assert.deepEqual(Object.keys(progression.skg), TREES.filter(t => !t.hidden).map(t => t.id));
  assert.equal(progression.skg.combat, 0, 'combat rank 4 earns 6 points, the legacy ranks spend 5');
  assert.equal(r.profile.eco.tradeRev, p.eco.tradeRev + 1);
  assert.equal(r.profile.gold, 7);
  assert.deepEqual(others(r.profile), others(p), 'only progression and the trade revision change');
  assert.deepEqual(r.points, { earned: 6, spent: 6, free: 0 });

  const adopted = r.profile, second = planSkillChange(adopted, assign(adopted, 'lunge'));
  assert.equal(second.why, 'points', 'the next rank needs a free point');
  assert.deepEqual(second.profile, adopted);
});

test('the migrated overspend becomes a permanent grant that a free reset frees for spending', () => {
  const p = character(1, 1, q => { q.sk.has.tromba = [5, 0, 0]; });
  assert.equal(planSkillChange(p, assign(p, 'lunge')).why, 'points', 'combat rank 1 earns nothing; the grant only covers legacy ranks');
  const first = planSkillChange(p, reset(p));
  assert.equal(first.ok, true, first.why);
  assert.deepEqual(readProgression(first.profile.progression), first.profile.progression);
  assert.equal(first.profile.progression.skg.combat, 5, 'lunge 1 + blast 1 + tromba 3 over zero earned');
  assert.deepEqual(first.profile.progression.skr, { combat: 1 });
  assert.equal(first.profile.gold, p.gold, 'the first reset of a tree is free');
  for (const n of NODES.filter(node => node.tree === 'combat')) assert.equal(first.profile.progression.skills[n.id], 0);
  const raised = planSkillChange(first.profile, assign(first.profile, 'lunge'));
  assert.equal(raised.ok, true, raised.why);
  assert.equal(raised.profile.progression.skills.lunge, 1);
  assert.deepEqual(raised.profile.progression.skg, first.profile.progression.skg, 'skg never changes after adoption');
  assert.deepEqual(raised.points, { earned: 5, spent: 1, free: 4 });
});

test('every refusal returns its why code and leaves the profile untouched', () => {
  const p = character(4, 1);
  const cases = [
    ['command', p, { ...assign(p, 'lunge'), n: 1 }],
    ['command', p, (({ node, ...rest }) => rest)(assign(p, 'lunge'))],
    ['command', p, { ...reset(p), node: 'lunge' }],
    ['command', p, { ...reset(p), op: 'adopt' }],
    ['command', p, { ...assign(p, 'lunge'), type: 'attributes' }],
    ['command', p, assign(p, 'lunge', { tree: 'exploration' })],
    ['command', p, assign(p, 'lunge', { tree: 'nope' })],
    ['command', p, assign(p, 'Lunge')],
    ['command', p, assign(p, 'nope')],
    ['command', p, assign(p, 'haggling', { tree: 'combat' })],
    ['command', p, assign(p, 'lunge', { expectedRev: -1 })],
    ['command', p, assign(p, 'lunge', { opId: 'bad id' })],
    ['command', p, null],
    ['profile', (({ eco, ...rest }) => rest)(p), assign(p, 'lunge')],
    ['profile', { ...p, progression: { v: 9 } }, assign(p, 'lunge')],
    ['profile', { ...p, gold: -1 }, assign(p, 'lunge')],
    ['limit', { ...p, eco: { ...p.eco, tradeRev: 2147483646 } }, assign(p, 'lunge', { expectedRev: 2147483645 })],
    ['conflict', p, assign(p, 'lunge', { expectedRev: 5 })],
    ['draft', p, assign(p, 'steady_chop')],
    ['draft', p, assign(p, 'pearl_affinity')],
    ['tier', p, assign(p, 'tromba')],
    ['max', { ...p, progression: v3({ lunge: 3 }) }, assign(p, 'lunge')],
    ['points', character(1, 1), assign(p, 'lunge')],
    // Mastery 4 opens tier I by practice, but the node asks for saber mastery 5.
    ['gate', p, assign(p, 'temple')],
    ['gate', character(5, 1), assign(p, 'tromba')],
    ['gate', character(1, 10), assign(p, 'deluge')],
  ];
  for (const [why, profile, command] of cases) {
    const before = clone(profile), result = planSkillChange(profile, command);
    assert.equal(result.ok, false, JSON.stringify(command));
    assert.equal(result.why, why, JSON.stringify(command));
    assert.deepEqual(result.profile, before);
    assert.deepEqual(profile, before);
  }
});

test('gates use mastery, knowledge and the pearl, never the weapon in hand', () => {
  const p = character(5, 1);
  assert.equal(kitOf(p.eq.weapon), 'sable');
  const pistolNode = planSkillChange(p, assign(p, 'blast'));
  assert.equal(pistolNode.ok, true, 'a pistol node is raised with the saber in hand');
  assert.equal(pistolNode.profile.progression.skills.blast, 2);

  const knows = character(5, 1, q => { q.sk.has.tromba = [1, 0, 0]; });
  const tattoo = planSkillChange(knows, assign(knows, 'tromba'));
  assert.equal(tattoo.ok, true, tattoo.why);
  assert.equal(tattoo.profile.progression.skills.tromba, 2);

  const pearl = character(1, 10, q => { q.pearls.swallowed = { k: 'storm' }; });
  const deluge = planSkillChange(pearl, assign(pearl, 'deluge'));
  assert.equal(deluge.ok, true, deluge.why);
  assert.equal(deluge.profile.progression.skills.deluge, 1);
});

test('reset is free once per tree, then costs SKILL_RESET_GOLD, and refuses empty, short and capped trees', () => {
  assert.equal(SKILL_RESET_GOLD, 150); assert.equal(RESET_FREE, 1);
  const p = character(4, 1, q => { q.gold = 200; });
  assert.equal(planSkillChange(p, reset(p, 'survival')).why, 'empty');
  const free = planSkillChange(p, reset(p));
  assert.equal(free.ok, true, free.why);
  assert.deepEqual(readProgression(free.profile.progression), free.profile.progression, 'first reset adopts readable state');
  assert.equal(free.profile.gold, 200); assert.deepEqual(free.profile.progression.skr, { combat: 1 });
  assert.equal(planSkillChange(free.profile, reset(free.profile)).why, 'empty', 'zeroed nodes free the points');
  const raised = planSkillChange(free.profile, assign(free.profile, 'lunge')).profile;
  const paid = planSkillChange(raised, reset(raised));
  assert.equal(paid.ok, true, paid.why);
  assert.equal(paid.profile.gold, 50); assert.deepEqual(paid.profile.progression.skr, { combat: 2 });
  assert.deepEqual(others(paid.profile), others(p));
  const short = { ...raised, gold: 149 };
  const denied = planSkillChange(short, reset(short));
  assert.equal(denied.why, 'gold'); assert.deepEqual(denied.profile, short);
  const capped = { ...p, progression: v3({ lunge: 1 }, { skr: { combat: 1000 } }) };
  assert.equal(planSkillChange(capped, reset(capped)).why, 'limit');
  const otherTree = { ...p, progression: v3({ lunge: 1, wave: 2 }, { skr: { trade: 4 } }) };
  const kept = planSkillChange(otherTree, reset(otherTree));
  assert.deepEqual(kept.profile.progression.skr, { trade: 4, combat: 1 });
  assert.equal(kept.profile.gold, 200, 'resets of another tree do not count against this one');
});

test('no clawback: an overspent tree keeps its ranks and only refuses new points', () => {
  const p = character(1, 1, q => { q.progression = v3({ lunge: 3, wave: 3 }); });
  const before = clone(p), r = planSkillChange(p, assign(p, 'blast'));
  assert.equal(r.why, 'points');
  assert.deepEqual(r.profile, before);
  const freed = planSkillChange(p, reset(p));
  assert.equal(freed.ok, true, 'a reset is still allowed');
});

test('an adopted v3 block keeps practice, milestones, knowledge and absent optional keys', () => {
  const progression = { v: 3, practice: { logging: 70, survival: 5, trade: 2 }, milestones: ['logging_steady', 'pilot_coastal'],
    knowledge: ['raft_storage'], skills: { lunge: 1 } };
  const p = character(4, 1, q => { q.progression = clone(progression); });
  const r = planSkillChange(p, assign(p, 'lunge'));
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.profile.progression, { ...progression, skills: { lunge: 2 } }, 'no skr or skg is invented');
  const legacyV2 = character(4, 1, q => { q.progression = { v: 2, practice: { logging: 3 }, milestones: ['pilot_coastal'], knowledge: [] }; });
  const adopted = planSkillChange(legacyV2, reset(legacyV2));
  assert.equal(adopted.profile.progression.v, 3);
  assert.deepEqual(adopted.profile.progression.practice, { logging: 3 });
  assert.deepEqual(adopted.profile.progression.milestones, ['pilot_coastal']);
});

test('the command parser is exact and canRaise keeps its callers when the grant is omitted', () => {
  const p = character();
  assert.deepEqual(parseSkillCommand(assign(p, 'lunge')), assign(p, 'lunge'));
  assert.equal(parseSkillCommand(Object.assign(Object.create({ inherited: 1 }), assign(p, 'lunge'))), null);
  const practice = { trade: 60 };
  assert.equal(canRaise('trade', 'haggling', { practice, skills: { contacts: 3, contracts: 1 } }).reason, 'points');
  assert.equal(canRaise('trade', 'haggling', { practice, skills: { contacts: 3, contracts: 1 }, grant: 2 }).reason, 'points');
  assert.equal(canRaise('trade', 'haggling', { practice, skills: { contacts: 3, contracts: 1 }, grant: 3 }).ok, true);
});

test('every catalog node id and tree fits the SQL041 format and count bounds', () => {
  for (const n of NODES) assert.match(n.id, /^[a-z][a-z0-9_]{0,39}$/);
  assert.ok(NODES.length <= 90);
  for (const t of TREES) assert.ok(NODES.filter(n => n.tree === t.id).length * 3 <= 45, t.id);
  assert.deepEqual(TREES.map(t => t.id).sort(), ['combat', 'crafting', 'exploration', 'sailing', 'survival', 'trade']);
});
