// One-time adoption of a legacy world snapshot and its first ground clock anchor.
import { StoreError, playerKey } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { snapshotDropData } from './deathDropApply.mjs';
import { checkedWorldData } from './economicOperation.mjs';

const MAX_VERSION = 2147483647;
const MAX_BYTES = 2 * 1024 * 1024;
const WORLD = /^[a-zA-Z0-9:_-]{1,100}$/;
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === fields;
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };

function copy(value, code = 'operation') {
  try {
    const detached = snapshotDropData(value);
    if (Buffer.byteLength(JSON.stringify(detached)) > MAX_BYTES) fail(code);
    return detached;
  } catch { fail(code); }
}

function uuid(value) {
  try {
    const normalized = playerKey(value);
    if (normalized !== value || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(normalized)) fail('operation');
    return normalized;
  } catch { fail('operation'); }
}

function adoption(operationId, rawRequest) {
  const request = copy(rawRequest);
  if (!exact(request, 'expectedWorldVersion,world,worldData') || typeof request.world !== 'string' ||
      !WORLD.test(request.world) || !integer(request.expectedWorldVersion, 1, MAX_VERSION - 1)) fail('operation');
  let worldData;
  try { worldData = checkedWorldData(request.worldData); } catch { fail('operation'); }
  if (!Object.hasOwn(worldData, 'resources') || !same(worldData, request.worldData)) fail('operation');
  return { operationId: uuid(operationId), request: { ...request, worldData } };
}

function checkedResult(raw, operationId, request, replayExpected = null) {
  const value = copy(raw, 'response');
  if (exact(value, 'ok,why') && value.ok === false && ['operation', 'conflict'].includes(value.why)) return value;
  if (!exact(value, 'clock,ok,replay,worldVersion') || value.ok !== true || typeof value.replay !== 'boolean' ||
      (replayExpected !== null && value.replay !== replayExpected) ||
      value.worldVersion !== request.expectedWorldVersion ||
      !exact(value.clock, 'operationId,tick,version,world') || value.clock.operationId !== operationId ||
      value.clock.world !== request.world || value.clock.tick !== request.worldData.resources.tick || value.clock.version !== 1) {
    fail('response');
  }
  return { ok: true, replay: value.replay, worldVersion: value.worldVersion,
    clock: { world: value.clock.world, tick: value.clock.tick, version: value.clock.version, operationId: value.clock.operationId } };
}

function checkedReceipt(raw, world) {
  if (raw === null) return null;
  const value = copy(raw, 'response');
  if (!exact(value, 'operationId,request,result')) fail('response');
  let entry;
  try { entry = adoption(value.operationId, value.request); } catch { fail('response'); }
  if (entry.request.world !== world) fail('response');
  const result = checkedResult(value.result, entry.operationId, entry.request, false);
  if (!result.ok) fail('response');
  return { operationId: entry.operationId, request: entry.request, result };
}

export function createSupabaseGroundWorldAdoption(client) {
  if (!client || typeof client.rpc !== 'function') fail('configuration');

  async function rpc(name, args) {
    try {
      const reply = await client.rpc(name, args);
      if (!reply || reply.error) {
        if (reply?.error?.code === 'MNP02') fail('operation');
        throw new Error('rpc');
      }
      return reply.data;
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError('unavailable');
    }
  }

  async function read(world) {
    if (typeof world !== 'string' || !WORLD.test(world)) fail('operation');
    return checkedReceipt(await rpc('mn_load_ground_world_adoption', { p_world: world }), world);
  }

  async function write(entry) {
    return checkedResult(await rpc('mn_adopt_ground_world', {
      p_operation_id: entry.operationId, p_request: entry.request,
    }), entry.operationId, entry.request);
  }

  return {
    async ready() {
      const value = copy(await rpc('mn_ground_world_adoption_ready', {}), 'response');
      if (!exact(value, 'version') || value.version !== 1) fail('response');
      return { version: 1 };
    },
    load: read,
    async adopt(raw) {
      const frozen = copy(raw);
      if (!exact(frozen, 'operationId,request')) fail('operation');
      const entry = adoption(frozen.operationId, frozen.request);
      try { return await write(entry); }
      catch (initialError) {
        if (!(initialError instanceof StoreError) || initialError.code !== 'unavailable') throw initialError;
        // A failed HTTP reply is ambiguous. Resolve by durable world receipt, then retry only
        // this exact immutable candidate once if no receipt can be read or none exists.
        let receipt = null;
        try {
          receipt = await read(entry.request.world);
        } catch (readError) {
          if (!(readError instanceof StoreError) || readError.code !== 'unavailable') throw readError;
        }
        if (receipt) {
          if (receipt.operationId !== entry.operationId || !same(receipt.request, entry.request)) return { ok: false, why: 'conflict' };
          return { ...receipt.result, replay: true };
        }
        try { return await write(entry); }
        catch (retryError) {
          if (!(retryError instanceof StoreError) || retryError.code !== 'unavailable') throw retryError;
          try {
            receipt = await read(entry.request.world);
            if (receipt) {
              if (receipt.operationId !== entry.operationId || !same(receipt.request, entry.request)) return { ok: false, why: 'conflict' };
              return { ...receipt.result, replay: true };
            }
          } catch (readError) {
            if (!(readError instanceof StoreError) || readError.code !== 'unavailable') throw readError;
          }
          throw new StoreError('unavailable');
        }
      }
    },
  };
}
