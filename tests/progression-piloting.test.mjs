import test from 'node:test';
import assert from 'node:assert/strict';
import { learnCoastalPilot, loggingStatus, newProgression, pilotingStatus, readProgression,
  newLoggingNode, planLoggingHit } from '../src/sim/systems/progression.js';
import { sanitizeProfile, newProfile } from '../src/sim/systems/inventory.js';
import { hmacSaves } from '../server/saves.mjs';
import { PILOTING } from '../src/data/progression.js';

test('only learning upgrades legacy/v1; parsing keeps old receipt shapes exact', () => {
  const old = newProgression(), before = structuredClone(old);
  assert.deepEqual(readProgression(old), before);
  assert.equal(readProgression(undefined).v, 1);
  for (const raw of [undefined, old]) {
    const learned = learnCoastalPilot(raw);
    assert.equal(learned.learned, true);
    assert.equal(learned.progression.v, 2);
    assert.deepEqual(learned.progression.milestones, [PILOTING.milestone]);
    assert.deepEqual(pilotingStatus(learned.progression), { learned: true, rank: 2, helmResponse: 1.15 });
    assert.deepEqual(learnCoastalPilot(learned.progression), { learned: false, progression: learned.progression });
  }
  assert.deepEqual(old, before);
});

test('piloting preserves common logging/recipe data and round-trips through profile signed saves', () => {
  const profile = newProfile();
  profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: ['raft_storage'] };
  const previous = structuredClone(profile);
  const grant = learnCoastalPilot(profile.progression);
  profile.progression = grant.progression;
  assert.deepEqual(loggingStatus(profile.progression), loggingStatus(previous.progression));
  assert.deepEqual(profile.progression.knowledge, previous.progression.knowledge);
  const saves = hmacSaves('pilot-common-profile-test');
  assert.deepEqual(saves.load(saves.store(profile)), sanitizeProfile(profile));
  assert.equal(pilotingStatus(saves.load(saves.store(profile)).progression).learned, true);
  assert.deepEqual(previous.progression.milestones, ['logging_steady']);
});

test('later logging practice retains piloting version and milestone', () => {
  const actor = '11111111-1111-4111-8111-111111111111';
  let node = newLoggingNode('pilot-palm'), progression = learnCoastalPilot().progression;
  for (let i = 0; i < 3; i++) {
    const plan = planLoggingHit(node, { actor, expectedRev: node.rev, tick: i }, [{ actor, progression }]);
    node = plan.node;
    if (plan.awards.length) progression = plan.awards[0].progression;
  }
  assert.equal(progression.v, 2);
  assert.equal(progression.practice.logging, 10);
  assert.equal(pilotingStatus(progression).learned, true);
});

test('v1 cannot claim a future technique; malformed v2 and future versions fail closed', () => {
  const learned = learnCoastalPilot().progression;
  for (const invalid of [
    { ...learned, v: 1 }, { ...learned, v: 3 },
    { ...learned, milestones: ['pilot_coastal', 'pilot_coastal'] },
    { ...learned, milestones: ['pilot_coastal', 'unknown'] },
    { ...learned, practice: { logging: 0, piloting: 999 } },
    { ...learned, helmResponse: 999 },
  ]) {
    assert.throws(() => readProgression(invalid), { code: 'progression' });
    assert.equal(sanitizeProfile({ ...newProfile(), progression: invalid }), null);
  }
});
