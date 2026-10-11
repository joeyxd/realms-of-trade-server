// Exact server-owned clock checkpoints. Storage chooses no clock source or offline ageing rule.
// The simulation tick remains a separate coordinate until the host integration defines its mapping.
import { StoreError, playerKey } from './store.mjs';
import { groundKey } from './pearlGround.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { snapshotDropData } from './deathDropApply.mjs';

const MAX_VERSION = 2147483647;
const integer = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const keys = (v, expected) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === expected;
function snapshot(raw, code) {
  try { return snapshotDropData(raw); } catch { throw new StoreError(code); }
}
function id(raw) {
  try {
    const value = playerKey(raw);
    if (value !== raw) throw new Error('identity');
    return value;
  } catch { throw new StoreError('operation'); }
}
export function groundClockOperation(input) {
  const raw = snapshot(input, 'operation');
  if (!keys(raw, 'expectedTick,expectedVersion,operationId,tick,world') ||
      !integer(raw.expectedVersion, 0, MAX_VERSION - 1) ||
      !integer(raw.expectedTick, 0, Number.MAX_SAFE_INTEGER) || !integer(raw.tick, 0, Number.MAX_SAFE_INTEGER) ||
      (raw.expectedVersion === 0 ? raw.expectedTick !== 0 : raw.tick <= raw.expectedTick)) throw new StoreError('operation');
  const operationId = id(raw.operationId), world = groundKey(raw.world);
  return { operationId, request: { world, expectedVersion: raw.expectedVersion, expectedTick: raw.expectedTick, tick: raw.tick } };
}
export function checkedGroundClock(input, world) {
  try {
    const raw = snapshot(input, 'response');
    if (!keys(raw, 'operationId,tick,version,world') || groundKey(raw.world) !== groundKey(world) ||
        !integer(raw.version, 1, MAX_VERSION) || !integer(raw.tick, 0, Number.MAX_SAFE_INTEGER)) throw new Error('clock');
    return { world: raw.world, tick: raw.tick, version: raw.version, operationId: id(raw.operationId) };
  } catch { throw new StoreError('response'); }
}
export function groundClockResult(request, operationId, replay = false) {
  return { ok: true, replay, clock: { world: request.world, tick: request.tick,
    version: request.expectedVersion + 1, operationId } };
}
export function checkedGroundClockResult(input, request, operationId) {
  try {
    const raw = snapshot(input, 'response');
    if (keys(raw, 'ok,why') && raw.ok === false && ['conflict','operation'].includes(raw.why)) return { ok: false, why: raw.why };
    if (!keys(raw, 'clock,ok,replay') || raw.ok !== true || typeof raw.replay !== 'boolean') throw new Error('result');
    const clock = checkedGroundClock(raw.clock, request.world), expected = groundClockResult(request, operationId, raw.replay);
    if (canonicalText(clock) !== canonicalText(expected.clock)) throw new Error('clock');
    return expected;
  } catch { throw new StoreError('response'); }
}
export function checkedGroundClockReceipt(input, operationId) {
  if (input === null) return null;
  try {
    const raw = snapshot(input, 'response');
    if (!keys(raw, 'request,result')) throw new Error('receipt');
    const operation = groundClockOperation({ operationId, ...raw.request });
    if (canonicalText(raw.request) !== canonicalText(operation.request)) throw new Error('request');
    const result = checkedGroundClockResult(raw.result, operation.request, operationId);
    if (!result.ok || result.replay) throw new Error('result');
    return { request: operation.request, result };
  } catch { throw new StoreError('response'); }
}
