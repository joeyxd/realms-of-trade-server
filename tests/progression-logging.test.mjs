import test from 'node:test';
import assert from 'node:assert/strict';
import { LOGGING } from '../src/data/progression.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import {
  newProgression, readProgression, loggingStatus, loggingShares, planLoggingHit,
  newLoggingNode, ProgressionError,
} from '../src/sim/systems/progression.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const practice = (logging = 0, milestones = [], knowledge = []) => ({
  v: 1, practice: { logging }, milestones, knowledge,
});
const snapshot = (value) => JSON.parse(JSON.stringify(value));
const errorCode = (code) => (err) => err instanceof ProgressionError && err.code === code;

function hit(node, actor, tick, roster, expectedRev = node.rev) {
  return planLoggingHit(node, { actor, expectedRev, tick }, roster);
}

function completeSolo(node, actor, tick, p) {
  let result;
  for (let i = 0; i < 3; i++) {
    result = hit(node, actor, tick + i, [{ actor, progression: p }]);
    node = result.node;
    if (result.awards.length) p = result.awards[0].progression;
  }
  return { node, progression: p, result };
}

test('logging contract constants and empty progression are stable and JSON-safe', () => {
  assert.deepEqual(LOGGING, {
    practicePerPalm: 10, firstMilestoneAt: 60, milestone: 'logging_steady',
    baseActionTicks: 54, learnedActionTicks: 45, maxPractice: 1_000_000_000,
  });
  assert.deepEqual(newProgression(), practice());
  assert.deepEqual(readProgression(undefined), newProgression());
  assert.deepEqual(JSON.parse(JSON.stringify(newProgression())), newProgression());
  assert.deepEqual(newLoggingNode('palm-1'), {
    id: 'palm-1', kind: 'palm', rev: 1, cycle: 1, hits: 0, readyTick: 0, contributors: [],
  });
});

test('progression parsing rejects malformed, unknown, duplicate, extra, and out-of-bound state', () => {
  const invalid = [
    null,
    { ...practice(), v: 2 },
    { ...practice(), extra: true },
    { ...practice(), practice: { logging: 1, mining: 2 } },
    { ...practice(), practice: { logging: 1.5 } },
    { ...practice(), practice: { logging: -1 } },
    { ...practice(), practice: { logging: LOGGING.maxPractice + 1 } },
    { ...practice(), milestones: ['unknown_milestone'] },
    { ...practice(), milestones: ['logging_steady', 'logging_steady'] },
    { ...practice(), knowledge: ['unknown_recipe'] },
    { ...practice(), knowledge: ['raft_storage', 'raft_storage'] },
  ];
  for (const raw of invalid) assert.throws(() => readProgression(raw), errorCode('progression'));
  assert.deepEqual(readProgression(practice(60, ['logging_steady'], ['raft_storage'])),
    practice(60, ['logging_steady'], ['raft_storage']));
  assert.deepEqual(readProgression(practice(1, ['logging_steady'])), practice(1, ['logging_steady']),
    'earned milestone remains retained when practice is below its threshold');
});

test('status derives rank, action time, next milestone, and storage learning eligibility', () => {
  assert.deepEqual(loggingStatus(undefined), {
    practice: 0, rank: 1, actionTicks: 54, nextAt: 60, canLearnStorage: false,
  });
  assert.deepEqual(loggingStatus(practice(59)), {
    practice: 59, rank: 1, actionTicks: 54, nextAt: 60, canLearnStorage: false,
  });
  assert.deepEqual(loggingStatus(practice(60)), {
    practice: 60, rank: 2, actionTicks: 45, nextAt: null, canLearnStorage: true,
  });
  assert.deepEqual(loggingStatus(practice(100, ['logging_steady'], ['raft_storage'])), {
    practice: 100, rank: 2, actionTicks: 45, nextAt: null, canLearnStorage: false,
  });
  assert.equal(loggingStatus(practice(60, [], ['raft_storage'])).canLearnStorage, false);
});

test('six solo palm completions reach the first milestone exactly once and speed only later actions', () => {
  let node = newLoggingNode('palm-solo');
  let p = newProgression();
  let tick = 100;
  const milestoneAwards = [];
  const completionActionTicks = [];

  for (let cycle = 0; cycle < 6; cycle++) {
    if (cycle) tick = node.readyTick;
    const done = completeSolo(node, A, tick, p);
    node = done.node;
    p = done.progression;
    completionActionTicks.push(done.result.actionTicks);
    milestoneAwards.push(...done.result.awards.flatMap((award) => award.milestones));
    assert.deepEqual(done.result.materials, [{ actor: A, good: 'tronco', count: 2 }]);
    assert.equal(done.result.awards[0].amount, 10);
  }

  assert.deepEqual(completionActionTicks.slice(0, 5), [54, 54, 54, 54, 54]);
  assert.equal(completionActionTicks[5], 54, 'the threshold-crossing action uses the old rank');
  assert.deepEqual(p, practice(60, ['logging_steady']));
  assert.deepEqual(milestoneAwards, ['logging_steady']);
  assert.equal(loggingStatus(p).canLearnStorage, true);
  const nextAction = hit(node, A, node.readyTick, [{ actor: A, progression: p }]);
  assert.equal(nextAction.actionTicks, 45, 'only actions after the milestone use the faster time');
  const nextHit = hit(nextAction.node, A, node.readyTick + 1, [{ actor: A, progression: p }]);
  const seventh = hit(nextHit.node, A, node.readyTick + 2, [{ actor: A, progression: p }]);
  assert.deepEqual(seventh.awards[0].milestones, [], 'the seventh completion cannot award the milestone again');
  assert.equal(seventh.awards[0].progression.practice.logging, 70);
});

test('cooperative shares are deterministic across contributor order and allocate largest remainders', () => {
  const expected = [{ actor: A, amount: 7 }, { actor: B, amount: 3 }];
  assert.deepEqual(loggingShares([{ actor: B, hits: 1 }, { actor: A, hits: 2 }]), expected);
  assert.deepEqual(loggingShares([{ actor: A, hits: 2 }, { actor: B, hits: 1 }]), expected);
  assert.deepEqual(loggingShares([
    { actor: C, hits: 1 }, { actor: B, hits: 1 }, { actor: A, hits: 1 },
  ]), [
    { actor: A, amount: 4 }, { actor: B, amount: 3 }, { actor: C, amount: 3 },
  ]);

  const node = { ...newLoggingNode('palm-coop'), rev: 3, hits: 2,
    contributors: [{ actor: A, hits: 1 }, { actor: B, hits: 1 }] };
  const roster = [
    { actor: B, progression: newProgression() },
    { actor: A, progression: newProgression() },
  ];
  const result = hit(node, A, 500, roster);
  assert.deepEqual(result.awards.map(({ actor, amount, credited }) => ({ actor, amount, credited })), [
    { actor: A, amount: 7, credited: 7 }, { actor: B, amount: 3, credited: 3 },
  ]);
  assert.deepEqual(result.awards.map((award) => award.actor), [A, B]);
});

test('final cooperative hit requires the exact roster, including an offline contributor', () => {
  const node = { ...newLoggingNode('palm-offline'), rev: 3, hits: 2,
    contributors: [{ actor: A, hits: 1 }, { actor: B, hits: 1 }] };
  const before = snapshot(node);
  assert.throws(() => hit(node, B, 700, [{ actor: B, progression: newProgression() }]), errorCode('beneficiary'));
  assert.deepEqual(node, before, 'rejection leaves the node untouched');

  const result = hit(node, A, 700, [
    { actor: A, progression: newProgression() },
    { actor: B, progression: newProgression() },
  ]);
  assert.deepEqual(result.awards.map((award) => award.actor), [A, B]);
  assert.deepEqual(result.awards.map((award) => award.amount), [7, 3]);
});

test('partial hits award nothing; the final hit advances one revision and sets the regeneration tick', () => {
  let node = newLoggingNode('palm-partial');
  const p = newProgression();
  const one = hit(node, A, 10, [{ actor: A, progression: p }]);
  assert.equal(one.node.rev, 2);
  assert.equal(one.node.hits, 1);
  assert.equal(one.node.readyTick, 0);
  assert.deepEqual(one.materials, []);
  assert.deepEqual(one.awards, []);
  const two = hit(one.node, A, 11, [{ actor: A, progression: p }]);
  assert.equal(two.node.hits, 2);
  assert.deepEqual(two.materials, []);
  assert.deepEqual(two.awards, []);

  const final = hit(two.node, A, 12, [{ actor: A, progression: p }]);
  assert.equal(final.node.rev, 4);
  assert.equal(final.node.hits, 3);
  assert.equal(final.node.cycle, 1);
  assert.equal(final.node.readyTick, 12 + 3600);
  assert.deepEqual(final.materials, [{ actor: A, good: 'tronco', count: 2 }]);
  assert.equal(final.awards[0].amount, 10);
  assert.equal(final.awards[0].credited, 10);
});

test('regeneration resets contributors and hits after the ready tick while revision stays monotonic', () => {
  let node = { ...newLoggingNode('palm-cycle'), rev: 10, cycle: 3,
    hits: 3, readyTick: 900, contributors: [{ actor: A, hits: 3 }] };
  assert.throws(() => hit(node, A, 899, [{ actor: A, progression: newProgression() }]), errorCode('depleted'));
  const result = hit(node, B, 900, [{ actor: B, progression: newProgression() }]);
  assert.equal(result.node.rev, 11);
  assert.equal(result.node.cycle, 4);
  assert.equal(result.node.hits, 1);
  assert.deepEqual(result.node.contributors, [{ actor: B, hits: 1 }]);
  assert.deepEqual(result.materials, []);
  assert.deepEqual(result.awards, []);
});

test('practice is capped per beneficiary without redistributing unused share or granting knowledge', () => {
  const cooperative = { ...newLoggingNode('palm-cap-valid'), rev: 3, hits: 2,
    contributors: [{ actor: A, hits: 1 }, { actor: B, hits: 1 }] };
  const result = hit(cooperative, A, 1000, [
    { actor: A, progression: practice(LOGGING.maxPractice - 1) },
    { actor: B, progression: newProgression() },
  ]);
  assert.deepEqual(result.awards.map(({ actor, amount, credited }) => ({ actor, amount, credited })), [
    { actor: A, amount: 7, credited: 1 }, { actor: B, amount: 3, credited: 3 },
  ]);
  assert.deepEqual(result.awards[0].progression.knowledge, []);
  assert.deepEqual(result.awards[1].progression.knowledge, []);
});

test('progression and combat profile fields remain independent across awards and JSON round trips', () => {
  const legacy = newProfile();
  delete legacy.progression; // Profiles written before PRG01b1 omit this field.
  legacy.lvl = 8; legacy.xp = 123.5; legacy.mast = [[4, 30], [2, 10]];
  legacy.sk.has.tromba = [2, 50, 0]; legacy.tools = { axe: 1, pickaxe: 0 };
  assert.equal(Object.hasOwn(legacy, 'progression'), false);
  const before = snapshot(legacy);
  const node = { ...newLoggingNode('palm-projection'), rev: 3, hits: 2,
    contributors: [{ actor: A, hits: 2 }] };
  const result = hit(node, A, 1200, [{ actor: A, progression: legacy.progression }]);
  const candidate = { ...legacy, progression: result.awards[0].progression };
  assert.deepEqual(legacy, before, 'pure planning does not mutate the legacy profile');
  assert.equal(candidate.lvl, before.lvl);
  assert.equal(candidate.xp, before.xp);
  assert.deepEqual(candidate.mast, before.mast);
  assert.deepEqual(candidate.sk, before.sk);
  assert.deepEqual(candidate.tools, before.tools);
  assert.deepEqual(readProgression(candidate.progression), candidate.progression);
  assert.deepEqual(JSON.parse(JSON.stringify({ candidate, node: result.node })), { candidate, node: result.node });
  assert.deepEqual(candidate.progression.knowledge, [], 'work practice grants no recipe knowledge');
});

test('malformed contributions and node, command, beneficiary, and stale revision inputs fail with stable codes', () => {
  for (const contributors of [
    [], [{ actor: A, hits: 2 }], [{ actor: A, hits: 1 }, { actor: A, hits: 2 }],
    [{ actor: 'abcdefab-abcd-4abc-8abc-abcdefabcdef'.toUpperCase(), hits: 3 }],
    [{ actor: A, hits: 4 }], [{ actor: A, hits: 1.5 }],
    [{ actor: A, hits: 1 }, { actor: B, hits: 1 }],
  ]) assert.throws(() => loggingShares(contributors), errorCode('contribution'));

  const node = newLoggingNode('palm-errors');
  const roster = [{ actor: A, progression: newProgression() }];
  assert.throws(() => hit({ ...node, hits: 1 }, A, 1, roster), errorCode('node'));
  assert.throws(() => planLoggingHit(node, { actor: A, expectedRev: '1', tick: 1 }, roster), errorCode('input'));
  assert.throws(() => hit(node, A, 1, roster, 2), errorCode('conflict'));
  assert.throws(() => hit(node, 'abcdefab-abcd-4abc-8abc-abcdefabcdef'.toUpperCase(), 1, roster), errorCode('input'));
  assert.throws(() => hit(node, A, 1, [{ actor: B, progression: newProgression() }]), errorCode('beneficiary'));
  assert.throws(() => hit(node, A, 1, [
    { actor: A, progression: newProgression() }, { actor: A, progression: newProgression() },
  ]), errorCode('beneficiary'));
  assert.throws(() => hit(node, A, 1, [
    { actor: A, progression: { v: 2, practice: { logging: 0 }, milestones: [], knowledge: [] } },
  ]), errorCode('beneficiary'));
  assert.throws(() => hit(node, A, 1, [
    { actor: A, progression: newProgression() }, { actor: B, progression: newProgression() },
  ]), errorCode('beneficiary'), 'partial hits require only the current actor');
  assert.throws(() => hit(node, A, 1, [{ actor: A }]), errorCode('beneficiary'),
    'a beneficiary row must explicitly carry progression, even when legacy data is undefined');
});

test('revision, cycle, and ready-tick overflow are rejected before changing the node', () => {
  const roster = [{ actor: A, progression: newProgression() }];
  const revisionOverflow = { ...newLoggingNode('palm-rev-limit'), rev: 2147483647, cycle: 715827883 };
  assert.throws(() => hit(revisionOverflow, A, 1, roster), errorCode('limit'));

  const inconsistentCycle = { ...newLoggingNode('palm-bad-cycle'), cycle: 7 };
  assert.throws(() => hit(inconsistentCycle, A, 1, roster), errorCode('node'));
  const unreachableCycle = { ...newLoggingNode('palm-cycle-limit'), cycle: 2147483647 };
  assert.throws(() => hit(unreachableCycle, A, 1, roster), errorCode('node'));

  const tickOverflow = { ...newLoggingNode('palm-tick-limit'), rev: 3, hits: 2,
    contributors: [{ actor: A, hits: 2 }] };
  assert.throws(() => hit(tickOverflow, A, Number.MAX_SAFE_INTEGER, roster), errorCode('limit'));
  assert.equal(hit(tickOverflow, A, Number.MAX_SAFE_INTEGER - 3600, roster).node.readyTick,
    Number.MAX_SAFE_INTEGER, 'the last representable deadline is valid');
});

test('every three-hit cooperation order conserves credit and only the finisher receives material', () => {
  const allocations = new Map();
  for (const first of [A, B, C]) for (const second of [A, B, C]) for (const third of [A, B, C]) {
    let node = newLoggingNode('palm-orders'), result;
    const counts = new Map();
    for (const [i, actor] of [first, second, third].entries()) {
      counts.set(actor, (counts.get(actor) || 0) + 1);
      const roster = (i === 2 ? [...counts.keys()] : [actor]).map(actor => ({ actor, progression: undefined }));
      result = hit(node, actor, 100 + i * 54, roster);
      node = result.node;
      if (i < 2) { assert.deepEqual(result.awards, []); assert.deepEqual(result.materials, []); }
    }
    assert.equal(result.awards.reduce((sum, award) => sum + award.amount, 0), 10);
    assert.deepEqual(result.materials, [{ actor: third, good: 'tronco', count: 2 }]);
    for (const award of result.awards) {
      const fraction = 10 * counts.get(award.actor) / 3;
      assert.ok(award.amount === Math.floor(fraction) || award.amount === Math.ceil(fraction));
      assert.equal(award.progression.practice.logging, award.credited);
    }
    const signature = [...counts.entries()].sort().map(([actor, count]) => `${actor}:${count}`).join(',');
    const actual = result.awards.map(({ actor, amount }) => ({ actor, amount }));
    if (allocations.has(signature)) assert.deepEqual(actual, allocations.get(signature));
    else allocations.set(signature, actual);
  }
});

test('a returned current node rejects replaying its old revision and retained milestones keep their benefit', () => {
  const before = newLoggingNode('palm-stale');
  const roster = [{ actor: A, progression: practice(1, ['logging_steady']) }];
  const planned = hit(before, A, 100, roster);
  assert.equal(planned.actionTicks, 45);
  const current = snapshot(planned.node);
  assert.throws(() => hit(current, A, 154, roster, before.rev), errorCode('conflict'));
  assert.deepEqual(current, planned.node);
  assert.deepEqual(roster[0].progression, practice(1, ['logging_steady']));
});

test('progression validation rejects sparse arrays and accessors without executing them', () => {
  let reads = 0;
  const raw = newProgression();
  Object.defineProperty(raw.practice, 'logging', { enumerable: true, get() { reads++; return 100; } });
  assert.throws(() => readProgression(raw), errorCode('progression'));
  assert.equal(reads, 0);
  assert.throws(() => readProgression({ ...newProgression(), milestones: new Array(1) }), errorCode('progression'));
  assert.throws(() => readProgression({ ...newProgression(), [Symbol('unknown')]: true }), errorCode('progression'));
  assert.throws(() => loggingShares(new Array(1)), errorCode('contribution'));
});

test('accepted and rejected planning is pure and does not mutate supplied node or progression records', () => {
  const node = newLoggingNode('palm-pure');
  const p = newProgression();
  const roster = [{ actor: A, progression: p }];
  const before = snapshot({ node, p, roster });
  hit(node, A, 40, roster);
  assert.deepEqual({ node, p, roster }, before);
  assert.throws(() => hit(node, A, 40, roster, 99), errorCode('conflict'));
  assert.deepEqual({ node, p, roster }, before);
});
