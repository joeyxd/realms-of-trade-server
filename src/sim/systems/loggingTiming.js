// Pure deterministic timing contract. The host supplies a challenge and authoritative received tick;
// no client-reported quality, wall clock, or random source participates in evaluation.
import { LOGGING_TIMING } from '../../data/loggingTiming.js';

const MAX_TICK = Number.MAX_SAFE_INTEGER;
const NODE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const CHALLENGE_KEYS = ['v', 'node', 'rev', 'startTick', 'targetTick', 'endTick', 'width'];
const INPUT_KEYS = ['rev', 'receivedTick'];
const has = (o, key) => Object.hasOwn(o, key);
const integer = (n, min = 0, max = MAX_TICK) => Number.isSafeInteger(n) && n >= min && n <= max;

export class LoggingTimingError extends Error {
  constructor(code) {
    super(`Logging timing: ${code}`);
    this.name = 'LoggingTimingError';
    this.code = code;
  }
}

const fail = code => { throw new LoggingTimingError(code); };

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => {
    const descriptor = descriptors[key];
    return descriptor?.enumerable && has(descriptor, 'value');
  });
}

function rankForPractice(practice) {
  if (!integer(practice)) fail('practice');
  let selected = LOGGING_TIMING.ranks[0];
  for (const row of LOGGING_TIMING.ranks) if (practice >= row.minimumPractice) selected = row;
  return selected;
}

/** Return the logging rank implied by trusted server-side practice. */
export function loggingTimingRank(practice) {
  return rankForPractice(practice).rank;
}

/**
 * Create a challenge from trusted node/revision/tick and practice values.
 * Challenge contents are deterministic; callers own issuance and persistence.
 */
export function createLoggingChallenge(input) {
  if (!exactObject(input, ['node', 'rev', 'startTick', 'practice'])) fail('input');
  const { node, rev, startTick, practice } = input;
  if (typeof node !== 'string' || !NODE_ID.test(node)) fail('node');
  if (!integer(rev, 1)) fail('revision');
  if (!integer(startTick, 0, MAX_TICK - LOGGING_TIMING.endOffsetTicks)) fail('tick');
  const rank = rankForPractice(practice);
  return validateLoggingChallenge({ v: LOGGING_TIMING.version, node, rev, startTick,
    targetTick: startTick + LOGGING_TIMING.targetOffsetTicks,
    endTick: startTick + LOGGING_TIMING.endOffsetTicks, width: rank.width });
}

/** Validate an exact challenge DTO and return a detached normalized copy. */
export function validateLoggingChallenge(challenge) {
  if (!exactObject(challenge, CHALLENGE_KEYS)) fail('challenge');
  const { v, node, rev, startTick, targetTick, endTick, width } = challenge;
  if (v !== LOGGING_TIMING.version || typeof node !== 'string' || !NODE_ID.test(node)) fail('challenge');
  if (!integer(rev, 1)) fail('revision');
  if (!integer(startTick, 0, MAX_TICK - LOGGING_TIMING.endOffsetTicks)
      || targetTick !== startTick + LOGGING_TIMING.targetOffsetTicks
      || endTick !== startTick + LOGGING_TIMING.endOffsetTicks) fail('tick');
  if (!LOGGING_TIMING.ranks.some(rank => rank.width === width)) fail('width');
  return { v, node, rev, startTick, targetTick, endTick, width };
}

/** Evaluate an input only against the server's receive tick and expected node revision. */
export function evaluateLoggingChallenge(challenge, input) {
  const checked = validateLoggingChallenge(challenge);
  if (!exactObject(input, INPUT_KEYS) || !integer(input.rev, 1) || !integer(input.receivedTick)) fail('input');
  if (input.rev !== checked.rev) fail('revision');
  if (input.receivedTick < checked.startTick + LOGGING_TIMING.earliestOffsetTicks) fail('early');
  if (input.receivedTick > checked.endTick) fail('late');
  const offset = input.receivedTick - checked.targetTick;
  return { quality: Math.abs(offset) <= checked.width ? 1 : 0, offset, receivedTick: input.receivedTick };
}

/** Base three logs plus one per perfect hit; legacy hits must be recorded as quality zero. */
export function timingYield(qualities) {
  if (!Array.isArray(qualities) || Object.getPrototypeOf(qualities) !== Array.prototype
      || qualities.length !== LOGGING_TIMING.hitsPerTree
      || Reflect.ownKeys(qualities).length !== qualities.length + 1) fail('qualities');
  let perfect = 0;
  for (let i = 0; i < qualities.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(qualities, String(i));
    if (!descriptor?.enumerable || !has(descriptor, 'value')
        || (descriptor.value !== 0 && descriptor.value !== 1)) fail('qualities');
    perfect += descriptor.value;
  }
  return LOGGING_TIMING.baseYield + perfect * LOGGING_TIMING.perfectYield;
}

