// One SQL transaction binds an existing gameplay family to its world snapshot and logical clock.
// This contract does not mount a GameHost, initialize a clock, adopt legacy rows or choose gameplay.
import { StoreError, playerKey } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { snapshotDropData } from './deathDropApply.mjs';
import { groundOperation, checkedGroundResult } from './pearlGround.mjs';
import { batchOperation, checkedBatchResult } from './pearlBatch.mjs';
import { deathOperation, checkedDeathResult } from './deathOperation.mjs';
import { deathDropOperation, checkedDeathDropResult } from './deathDropOperation.mjs';
import { economicOperation, checkedEconomicResult, checkedWorldData } from './economicOperation.mjs';
import { checkedGroundClock } from './groundClockOperation.mjs';

const MAX_VERSION = 2147483647;
const MAX_BYTES = 2 * 1024 * 1024;
const exact = (v, fields) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === fields;
const integer = (n, lo, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
const families = Object.freeze({
  economic: {
    request: (id, request) => economicOperation({ operationId: id, request }).request,
    result: (raw, request) => checkedEconomicResult(raw, request),
  },
  ground: { request: (id, raw) => groundOperation({ ...raw, operationId: id }).request,
    result: checkedGroundResult },
  batch: { request: (id, raw) => batchOperation({ ...raw, operationId: id }).request,
    result: checkedBatchResult },
  death: { request: (id, raw) => deathOperation({ ...raw, operationId: id }).request,
    result: checkedDeathResult },
  drop: { request: (id, raw) => deathDropOperation({ ...raw, operationId: id }).request,
    result: checkedDeathDropResult },
});

function snapshot(raw, code) {
  try {
    const value = snapshotDropData(raw);
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) fail(code);
    return value;
  } catch { fail(code); }
}
function uuid(raw) {
  const result = playerKey(raw);
  if (result !== raw || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(result)) fail('operation');
  return result;
}

export function groundTransactionOperation(input) {
  try {
    const raw = snapshot(input, 'operation');
    if (!exact(raw, 'operationId,request')) fail('operation');
    const operationId = uuid(raw.operationId), request = raw.request;
    if (!exact(request, 'clock,expectedWorldVersion,family,operation,world,worldData') ||
        typeof request.world !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(request.world) ||
        !integer(request.expectedWorldVersion, 1, MAX_VERSION - 1) ||
        !exact(request.clock, 'expectedTick,expectedVersion,operationId,tick')) fail('operation');
    const clock = request.clock;
    uuid(clock.operationId);
    if (clock.operationId === operationId || !integer(clock.expectedVersion, 1, MAX_VERSION - 1) ||
        !integer(clock.expectedTick, 0) || !integer(clock.tick, clock.expectedTick)) fail('operation');
    const worldData = checkedWorldData(request.worldData);
    if (!same(worldData, request.worldData) ||
        worldData.resources && worldData.resources.tick !== clock.tick) fail('operation');
    if (request.family === 'checkpoint') {
      if (!exact(request.operation, '')) fail('operation');
    } else {
      if (!Object.hasOwn(families, request.family)) fail('operation');
      const normalized = families[request.family].request(operationId, request.operation);
      if (!same(normalized, request.operation) || normalized.world !== request.world) fail('operation');
      if (request.family === 'economic' && (normalized.expectedWorldVersion !== request.expectedWorldVersion ||
          !same(normalized.worldData, worldData))) fail('operation');
      if (request.family === 'drop' && normalized.at !== clock.tick) fail('operation');
    }
    return { operationId, request: { ...request, worldData } };
  } catch { fail('operation'); }
}

export function checkedGroundTransactionResult(input, request, operationId) {
  try {
    const raw = snapshot(input, 'response');
    if (exact(raw, 'ok,why') && raw.ok === false &&
        ['operation', 'conflict', 'ownership', 'kind'].includes(raw.why)) return raw;
    if (!exact(raw, 'clock,effect,ok,replay,worldVersion') || raw.ok !== true || typeof raw.replay !== 'boolean' ||
        raw.worldVersion !== request.expectedWorldVersion + 1) fail('response');
    const clock = checkedGroundClock(raw.clock, request.world);
    const expectedClock = { world: request.world, tick: request.clock.tick,
      version: request.clock.expectedVersion + Number(request.clock.tick > request.clock.expectedTick),
      operationId: request.clock.operationId };
    if (!same(clock, expectedClock)) fail('response');
    let effect;
    if (request.family === 'checkpoint') {
      if (!same(raw.effect, { ok: true, replay: false })) fail('response');
      effect = { ok: true, replay: false };
    } else effect = families[request.family].result(raw.effect, request.operation, operationId);
    if (effect.ok !== true || effect.replay !== false || !same(effect, raw.effect)) fail('response');
    return { ok: true, replay: raw.replay, worldVersion: raw.worldVersion, clock, effect };
  } catch { fail('response'); }
}

export function checkedGroundTransactionReceipt(input, operationId) {
  if (input === null) return null;
  try {
    const raw = snapshot(input, 'response');
    if (!exact(raw, 'request,result')) fail('response');
    const { request } = groundTransactionOperation({ operationId, request: raw.request });
    const result = checkedGroundTransactionResult(raw.result, request, operationId);
    if (!result.ok || result.replay) fail('response');
    return { request, result };
  } catch { fail('response'); }
}
