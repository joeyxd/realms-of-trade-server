import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLoggingChallenge, evaluateLoggingChallenge, loggingTimingRank,
  timingYield, validateLoggingChallenge, LoggingTimingError,
} from '../src/sim/systems/loggingTiming.js';

const challenge = (practice = 0, startTick = 100) => createLoggingChallenge({
  node: 'palm-1', rev: 7, startTick, practice,
});
const failure = (code, action) => assert.throws(action, error =>
  error instanceof LoggingTimingError && error.code === code);

test('challenge uses exact integer-tick offsets and validates strict bounds', () => {
  const c = challenge();
  assert.deepEqual(c, { v: 1, node: 'palm-1', rev: 7, startTick: 100,
    targetTick: 145, endTick: 190, width: 5 });
  assert.deepEqual(validateLoggingChallenge(c), c);
  assert.equal(createLoggingChallenge({ node: 'palm-1', rev: 7, startTick: 0, practice: 0 }).endTick, 90);
  failure('challenge', () => validateLoggingChallenge({ ...c, extra: true }));
  failure('tick', () => validateLoggingChallenge({ ...c, targetTick: 146 }));
  failure('width', () => validateLoggingChallenge({ ...c, width: 6 }));
  failure('node', () => createLoggingChallenge({ node: 'bad node', rev: 1, startTick: 0, practice: 0 }));
  failure('revision', () => createLoggingChallenge({ node: 'palm-1', rev: 0, startTick: 0, practice: 0 }));
});

test('challenge issuance rejects invalid ticks and safe-integer overflow', () => {
  for (const startTick of [-1, 1.25, Number.MAX_SAFE_INTEGER - 89, Number.MAX_SAFE_INTEGER + 1])
    failure('tick', () => createLoggingChallenge({ node: 'palm-1', rev: 1, startTick, practice: 0 }));
  for (const receivedTick of [-1, 12.5, Number.MAX_SAFE_INTEGER + 1])
    failure('input', () => evaluateLoggingChallenge(challenge(), { rev: 7, receivedTick }));
});

test('early and late inputs reject; eligible off-window inputs are ordinary quality', () => {
  const c = challenge();
  failure('early', () => evaluateLoggingChallenge(c, { rev: 7, receivedTick: 105 }));
  failure('late', () => evaluateLoggingChallenge(c, { rev: 7, receivedTick: 191 }));
  assert.deepEqual(evaluateLoggingChallenge(c, { rev: 7, receivedTick: 139 }),
    { quality: 0, offset: -6, receivedTick: 139 });
  assert.equal(evaluateLoggingChallenge(c, { rev: 7, receivedTick: 190 }).quality, 0);
  failure('revision', () => evaluateLoggingChallenge(c, { rev: 8, receivedTick: 145 }));
});

test('logging practice opens rank windows at 60 and 180 points', () => {
  assert.deepEqual([0, 59, 60, 179, 180].map(loggingTimingRank), [1, 1, 2, 2, 3]);
  for (const [practice, width] of [[0, 5], [60, 8], [180, 11]]) {
    const c = challenge(practice);
    assert.equal(c.width, width);
    assert.equal(evaluateLoggingChallenge(c, { rev: 7, receivedTick: c.targetTick + width }).quality, 1);
    assert.equal(evaluateLoggingChallenge(c, { rev: 7, receivedTick: c.targetTick + width + 1 }).quality, 0);
  }
  failure('practice', () => loggingTimingRank(-1));
  failure('practice', () => loggingTimingRank(1.5));
});

test('yield stays between three and six and legacy quality zero earns no bonus', () => {
  assert.equal(timingYield([0, 0, 0]), 3);
  assert.equal(timingYield([1, 0, 1]), 5);
  assert.equal(timingYield([1, 1, 1]), 6);
  assert.equal(timingYield([0, 0, 0]), 3, 'legacy hits remain quality zero without retroactive credit');
  for (const qualities of [[], [0, 0], [0, 0, 0, 0], [0, 1, 2], [true, 0, 0], Array(3)])
    failure('qualities', () => timingYield(qualities));
});

test('retry evaluation is deterministic for the same challenge and authoritative tick', () => {
  const c = challenge(180, 500), input = { rev: c.rev, receivedTick: c.targetTick + 9 };
  assert.deepEqual(evaluateLoggingChallenge(c, input), evaluateLoggingChallenge(c, input));
  assert.deepEqual(evaluateLoggingChallenge(c, input), { quality: 1, offset: 9, receivedTick: 554 });
});

