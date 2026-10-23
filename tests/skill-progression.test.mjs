import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { LOGGING, PILOTING, SKILLS_PROGRESSION_VERSION, SKILL_PRACTICE_MAX } from '../src/data/progression.js';
import { MAX_NODE_RANK, NODES, TREES, combatPractice, legacySkills, pointsEarned, pointsFree, pointsSpent,
  skillGrant, treeSummary } from '../src/data/skillTree.js';
import { MASTERY } from '../src/data/weapons.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { ProgressionError, creditPractice, learnCoastalPilot, newProgression, readProgression } from '../src/sim/systems/progression.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'gsap') return { url: 'data:text/javascript,export const gsap={fromTo(){}}', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { skillSheetState, skillRightHtml } = await import('../src/ui/skillSheet.js');

const legacy = (v = 1) => ({ v, practice: { logging: 70 },
  milestones: v === 1 ? [LOGGING.milestone] : [LOGGING.milestone, PILOTING.milestone],
  knowledge: ['raft_storage'] });
const skillsProgression = () => ({
  ...legacy(SKILLS_PROGRESSION_VERSION),
  practice: { logging: LOGGING.maxPractice, survival: 0, sailing: 31, crafting: 59, trade: SKILL_PRACTICE_MAX },
  skills: Object.fromEntries(NODES.map(n => [n.id, MAX_NODE_RANK])),
  skr: Object.fromEntries(TREES.map(t => [t.id, 1000])),
  skg: Object.fromEntries(TREES.map(t => [t.id, MAX_NODE_RANK * NODES.filter(n => n.tree === t.id).length])),
});
const progressionError = error => error instanceof ProgressionError && error.code === 'progression';
const profileWith = progression => ({ ...newProfile(), progression });

test('v1 and v2 keep their exact JSON shape through reading and profile sanitation; omission stays absent', () => {
  for (const raw of [newProgression(), legacy(), legacy(2)]) {
    const before = JSON.stringify(raw);
    assert.equal(JSON.stringify(readProgression(raw)), before);
    assert.equal(JSON.stringify(sanitizeProfile(profileWith(raw)).progression), before);
    assert.equal(JSON.stringify(raw), before);
  }
  const profile = newProfile();
  delete profile.progression;
  assert.equal(Object.hasOwn(sanitizeProfile(profile), 'progression'), false);
  assert.equal(Object.hasOwn(profile, 'progression'), false);
  assert.equal(newProgression().v, 1);
  assert.equal(newProfile().progression.v, 1);
});

test('v3 round-trips all optional keys as fresh copies without mutating the source', () => {
  const raw = skillsProgression(), before = structuredClone(raw);
  for (const result of [readProgression(raw), sanitizeProfile(profileWith(raw)).progression]) {
    assert.equal(JSON.stringify(result), JSON.stringify(raw));
    assert.notEqual(result, raw);
    for (const key of ['practice', 'milestones', 'knowledge', 'skills', 'skr', 'skg']) {
      assert.notEqual(result[key], raw[key], key);
    }
  }
  assert.deepEqual(raw, before);
});

test('v3 preserves absent optional fields and distinguishes them from present empty objects', () => {
  const raw = { ...legacy(2), v: 3 };
  for (const result of [readProgression(raw), sanitizeProfile(profileWith(raw)).progression]) {
    assert.deepEqual(result, raw);
    for (const key of ['skills', 'skr', 'skg']) assert.equal(Object.hasOwn(result, key), false);
    for (const key of ['survival', 'sailing', 'crafting', 'trade']) assert.equal(Object.hasOwn(result.practice, key), false);
  }
  for (const key of ['skills', 'skr', 'skg']) {
    const input = { ...raw, [key]: {} }, output = readProgression(input);
    assert.deepEqual(output, input);
    assert.notEqual(output[key], input[key]);
  }
});

test('v3 rejects future versions, forbidden keys and values outside every field bound', () => {
  const raw = skillsProgression();
  const invalid = [
    { ...raw, v: 4 },
    { ...raw, extra: 0 },
    { ...raw, practice: { combat: 1, logging: 0 } },
    { ...raw, practice: { mining: 1, logging: 0 } },
    { ...raw, practice: { survival: 0 } },
    { ...raw, skills: { unknown: 1 } },
    { ...raw, skills: { lunge: 4 } },
    { ...raw, skills: { lunge: -1 } },
    { ...raw, skills: { lunge: 0.5 } },
    { ...raw, skr: { unknown: 0 } },
    { ...raw, skr: { combat: 1001 } },
    { ...raw, skr: { combat: -1 } },
    { ...raw, skr: { combat: 0.5 } },
    { ...raw, skg: { unknown: 0 } },
    { ...raw, skg: { combat: 46 } },
    { ...raw, skg: { survival: 19 } },
    { ...raw, skg: { exploration: 1 } },
    { ...raw, skg: { combat: -1 } },
    { ...raw, skg: { combat: 0.5 } },
    { ...raw, milestones: [PILOTING.milestone, PILOTING.milestone] },
    { ...raw, milestones: ['unknown'] },
    { ...raw, knowledge: ['unknown'] },
    { ...raw, knowledge: ['raft_storage', 'raft_storage'] },
  ];
  for (const key of ['logging', 'survival', 'sailing', 'crafting', 'trade']) {
    for (const value of [-1, 0.5, SKILL_PRACTICE_MAX + 1, NaN, Infinity, '1']) {
      invalid.push({ ...raw, practice: { ...raw.practice, [key]: value } });
    }
  }
  for (const key of ['skills', 'skr', 'skg']) {
    for (const value of [null, undefined, [], 1]) invalid.push({ ...raw, [key]: value });
    for (const v of [1, 2]) invalid.push({ ...legacy(v), [key]: {} });
  }
  for (const v of [1, 2]) invalid.push({ ...legacy(v), practice: { logging: 0, survival: 1 } });
  for (const candidate of invalid) {
    assert.throws(() => readProgression(candidate), progressionError, JSON.stringify(candidate));
    assert.equal(sanitizeProfile(profileWith(candidate)), null);
  }
});

test('v3 rejects inherited keys, accessors, symbols and hidden properties without invoking accessors', () => {
  let reads = 0;
  const getter = { enumerable: true, get() { reads++; throw new Error('must not run'); } };
  for (const field of [null, 'practice', 'skills', 'skr', 'skg']) {
    const key = field === null ? 'v' : field === 'practice' ? 'logging' : field === 'skills' ? 'lunge' : 'combat';
    for (const kind of ['accessor', 'inherited', 'symbol', 'hidden']) {
      const raw = skillsProgression(), target = field === null ? raw : raw[field];
      if (kind === 'accessor') Object.defineProperty(target, key, getter);
      if (kind === 'inherited') {
        delete target[key];
        Object.setPrototypeOf(target, Object.create(Object.prototype, { [key]: getter }));
      }
      if (kind === 'symbol') target[Symbol('extra')] = 0;
      if (kind === 'hidden') Object.defineProperty(target, 'hidden', { value: 0 });
      assert.throws(() => readProgression(raw), progressionError, `${field}/${kind}`);
      assert.equal(reads, 0);
    }
  }
  for (const field of ['skills', 'skr', 'skg']) {
    for (const key of ['__proto__', 'constructor', 'toString']) {
      assert.throws(() => readProgression({ ...skillsProgression(), [field]: { [key]: 0 } }), progressionError);
    }
  }
});

test('v3 accepts plain null-prototype maps and all zero ranks without adding other fields', () => {
  const raw = { ...legacy(2), v: 3, skills: Object.assign(Object.create(null), { lunge: 0 }),
    skr: Object.assign(Object.create(null), { combat: 0 }), skg: Object.assign(Object.create(null), { exploration: 0 }) };
  assert.equal(JSON.stringify(readProgression(raw)), JSON.stringify(raw));
});

test('v3 validates shape without comparing points spent against practice or grants', () => {
  const raw = { v: 3, practice: { logging: 0 }, milestones: [], knowledge: [],
    skills: { lunge: 3, blast: 3, haggling: 3 }, skg: { combat: 0, trade: 0 } };
  assert.deepEqual(readProgression(raw), raw);
  assert.deepEqual(sanitizeProfile(profileWith(raw)).progression, raw);
});

test('learning coastal piloting keeps v3 optional content and still upgrades v1 to v2', () => {
  const raw = skillsProgression();
  raw.milestones = [LOGGING.milestone];
  const before = structuredClone(raw), result = learnCoastalPilot(raw);
  assert.equal(result.learned, true);
  assert.deepEqual(result.progression, { ...before, milestones: [LOGGING.milestone, PILOTING.milestone] });
  assert.equal(result.progression.v, 3);
  assert.deepEqual(learnCoastalPilot(result.progression), { learned: false, progression: result.progression });
  assert.deepEqual(raw, before);
  assert.equal(learnCoastalPilot(legacy()).progression.v, 2);
});

test('creditPractice upgrades legacy content purely, preserves v3 optionals and caps each peaceful counter', () => {
  for (const raw of [undefined, legacy(), legacy(2), skillsProgression()]) {
    const before = structuredClone(raw), original = readProgression(raw);
    for (const key of ['survival', 'sailing', 'crafting', 'trade']) {
      const result = creditPractice(raw, key, 7);
      assert.deepEqual(result, { ...original, v: 3,
        practice: { ...original.practice, [key]: Math.min(SKILL_PRACTICE_MAX, (original.practice[key] ?? 0) + 7) } });
      assert.deepEqual(readProgression(result), result);
      assert.notEqual(result.practice, original.practice);
    }
    assert.deepEqual(raw, before);
  }
  const raw = { ...legacy(2), v: 3, practice: { logging: 70, sailing: SKILL_PRACTICE_MAX - 1 } };
  assert.equal(creditPractice(raw, 'sailing', 2).practice.sailing, SKILL_PRACTICE_MAX);
  assert.equal(creditPractice(raw, 'sailing', Number.MAX_SAFE_INTEGER).practice.sailing, SKILL_PRACTICE_MAX);
});

test('creditPractice rejects bad keys, nonpositive or unsafe amounts and corrupt source data', () => {
  for (const key of ['combat', 'logging', 'exploration', 'unknown', '__proto__', 'constructor', null, 1]) {
    assert.throws(() => creditPractice(undefined, key, 1), progressionError);
  }
  for (const n of [0, -1, 0.5, NaN, Infinity, '1', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => creditPractice(undefined, 'survival', n), progressionError);
  }
  assert.throws(() => creditPractice({ ...legacy(), v: 4 }, 'survival', 1), progressionError);
});

test('combatPractice retains the mastery sum and legacySkills retains tattoos and weapon arts', () => {
  assert.equal(combatPractice([[3, 10], [2, 5]]), MASTERY.xp[0] * 2 + MASTERY.xp[1] + 15);
  assert.equal(combatPractice([[MASTERY.max + 5, 2]]), MASTERY.xp.reduce((a, b) => a + b, 0) + 2);
  for (const mast of [undefined, [], [null], [[0, 90]], [[NaN, 10]]]) assert.equal(combatPractice(mast), 0);
  assert.equal(combatPractice([[2, -1], [1, Infinity]]), MASTERY.xp[0]);
  const has = { tromba: [5, 4, 0], lunge: [3, 0, 0] }, mastery = { sable: 3, pistolas: 1 };
  const before = structuredClone({ has, mastery }), skills = legacySkills(has, mastery);
  assert.equal(skills.tromba, 3);
  assert.equal(skills.lunge, 2);
  assert.equal(skills.wave, 1);
  assert.equal(skills.blast, 1);
  assert.equal(skills.blink, 0);
  assert.equal(skills.temple, 0);
  assert.deepEqual({ has, mastery }, before);
});

test('skill grants fill only the shortfall and optional grants feed free points and tree summaries', () => {
  const skills = { lunge: 3, blast: 2, haggling: 3 };
  const grant = skillGrant('combat', {}, skills);
  assert.equal(grant, 5);
  assert.equal(skillGrant('combat', { combat: MASTERY.xp[0] }, skills), 3);
  assert.equal(skillGrant('combat', { combat: 99999 }, skills), 0);
  assert.equal(skillGrant('trade', {}, skills), 3);
  assert.equal(pointsFree('combat', {}, skills), 0);
  assert.equal(pointsFree('combat', {}, skills, grant + 2), 2);
  assert.deepEqual(treeSummary('combat', { practice: {}, skills, grant }).points, { earned: 5, spent: 5, free: 0 });
  assert.deepEqual(treeSummary('combat', { practice: {}, skills }).points, { earned: 0, spent: 5, free: 0 });
});

test('a fresh legacy profile has earned plus grant equal to spent and no free points; veterans retain every tree', () => {
  const fresh = newProfile();
  delete fresh.progression;
  const before = structuredClone(fresh), state = skillSheetState(fresh);
  assert.deepEqual(state.points('combat'), { earned: 2, spent: 2, free: 0 });
  const practiceEarned = pointsEarned('combat', state.practice);
  assert.equal(practiceEarned + skillGrant('combat', state.practice, state.skills), pointsSpent('combat', state.skills));
  assert.deepEqual(fresh, before);
  const veteran = { ...fresh, mast: [[5, 20], [4, 10]], sk: { ...fresh.sk, has: { tromba: [5, 0, 0], leap: [4, 0, 0] } } };
  const vet = skillSheetState(veteran);
  for (const tree of TREES) assert.ok(vet.points(tree.id).earned >= vet.points(tree.id).spent, tree.id);
  assert.equal(Object.hasOwn(veteran, 'progression'), false);
});

test('an adopted profile uses its skills and explicit grants, including empty skills and absent grants', () => {
  const progression = { v: 3, practice: { logging: 0 }, milestones: [], knowledge: [],
    skills: { lunge: 3, haggling: 2 }, skg: { combat: 5, trade: 3 } };
  const profile = { ...newProfile(), sk: { has: { tromba: [5, 0, 0] } }, progression };
  const before = structuredClone(profile), state = skillSheetState(profile);
  assert.deepEqual(state.skills, progression.skills);
  assert.deepEqual(state.points('combat'), { earned: 5, spent: 3, free: 2 });
  assert.deepEqual(state.points('trade'), { earned: 3, spent: 2, free: 1 });
  assert.deepEqual(profile, before);
  delete progression.skg;
  assert.deepEqual(skillSheetState(profile).points('combat'), { earned: 0, spent: 3, free: 0 });
  progression.skills = {};
  assert.deepEqual(skillSheetState(profile).skills, {});
  delete progression.skills;
  progression.skg = { combat: 45 };
  const legacyState = skillSheetState(profile);
  assert.equal(legacyState.skills.tromba, 3);
  assert.deepEqual(legacyState.points('combat'), { earned: 5, spent: 5, free: 0 });
});

test('combat practice is always derived, even when an unvalidated input has a counter accessor', () => {
  let reads = 0;
  const profile = { mast: [[2, 5]], progression: { practice: {} } };
  Object.defineProperty(profile.progression.practice, 'combat', { get() { reads++; throw new Error('must not read'); } });
  const state = skillSheetState(profile);
  assert.equal(state.practice.combat, MASTERY.xp[0] + 5);
  assert.equal(reads, 0);
  assert.match(skillRightHtml(state, { tree: 'combat' }, 'es'), /Práctica de combate: suma de la maestría de tus armas\./);
  assert.match(skillRightHtml(state, { tree: 'combat' }, 'en'), /Combat practice: the sum of your weapon mastery\./);
});
