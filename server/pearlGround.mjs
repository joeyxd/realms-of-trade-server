// Durable location DTOs. The command authority chooses geometry, price and clock semantics; storage
// conserves one UID across profiles and ground, without deleting expired or historical records.
import { sanitizePearl } from '../src/data/pearls.js';
import { StoreError, playerKey } from './store.mjs';
import { canonicalText, pearlOperation, pearlResult, managedPearl } from './pearlOperations.mjs';

const MAX_VERSION = 2147483647;
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const generation = (v, min = 0) => Number.isSafeInteger(v) && v >= min && v < MAX_VERSION;
export function groundKey(v) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(v)) throw new StoreError('operation');
  return v;
}
export function groundData(raw) {
  if (!object(raw) || Object.keys(raw).sort().join(',') !== 'availableAt,returnAt,x,z' ||
    ![raw.x, raw.z].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6) ||
    ![raw.availableAt, raw.returnAt].every((v) => Number.isSafeInteger(v) && v >= 0) ||
    raw.returnAt <= raw.availableAt) throw new StoreError('operation');
  return { x: raw.x, z: raw.z, availableAt: raw.availableAt, returnAt: raw.returnAt };
}
export function groundPage(world, options = {}) {
  world = groundKey(world);
  if (!object(options)) throw new StoreError('operation');
  const afterUid = options.afterUid ?? null, limit = options.limit ?? 64;
  if (afterUid !== null) groundKey(afterUid);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new StoreError('operation');
  return { world, afterUid, limit };
}

export function groundOperation(raw) {
  if (!object(raw)) throw new StoreError('operation');
  let operationId, base;
  if (raw.from === null && raw.to === null) {
    operationId = playerKey(raw.operationId);
    const pearl = sanitizePearl(raw);
    if (!pearl || !generation(raw.expectedVersion) || !Array.isArray(raw.profiles) || raw.profiles.length) {
      throw new StoreError('operation');
    }
    base = { ...pearl, from: null, to: null, expectedVersion: raw.expectedVersion, profiles: [] };
  } else ({ operationId, request: base } = pearlOperation(raw));
  const world = groundKey(raw.world), ground = raw.ground === null ? null : groundData(raw.ground);
  if ((base.to === null) !== (ground !== null)) throw new StoreError('operation');
  return { operationId, request: { ...base, world, ground } };
}

export function groundResult(request, replay = false) {
  return { ...pearlResult(request, replay), location: {
    uid: request.uid, world: request.world, ground: structuredClone(request.ground), version: request.expectedVersion + 1,
  } };
}
export function checkedGroundResult(raw, request) {
  if (raw?.ok === false && ['conflict', 'kind', 'ownership', 'operation'].includes(raw.why)) return { ok: false, why: raw.why };
  if (raw?.ok !== true || typeof raw.replay !== 'boolean') throw new StoreError('response');
  const wanted = groundResult(request, raw.replay);
  if (canonicalText(raw) !== canonicalText(wanted)) throw new StoreError('response');
  return wanted;
}
export function checkedGroundReceipt(raw, operationId) {
  if (raw === null) return null;
  try {
    if (!object(raw) || !object(raw.request)) throw new Error('record');
    const { request } = groundOperation({ ...raw.request, operationId });
    if (canonicalText(request) !== canonicalText(raw.request)) throw new Error('request');
    const result = checkedGroundResult(raw.result, request);
    if (!result.ok || result.replay) throw new Error('result');
    return { request, result };
  } catch { throw new StoreError('response'); }
}
export function checkedLocation(raw) {
  if (raw === null) return null;
  try {
    if (!object(raw) || !Number.isSafeInteger(raw.version) || raw.version < 1 || raw.version > MAX_VERSION) throw new Error('record');
    const location = { world: groundKey(raw.world), ground: raw.ground === null ? null : groundData(raw.ground), version: raw.version };
    if (canonicalText(location) !== canonicalText(raw)) throw new Error('record');
    return location;
  } catch { throw new StoreError('response'); }
}
export function checkedGroundPage(raw, page) {
  if (!Array.isArray(raw) || raw.length > page.limit) throw new StoreError('response');
  let previous = page.afterUid;
  return raw.map((row) => {
    const pearl = sanitizePearl(row);
    if (!pearl || (previous !== null && pearl.uid <= previous)) throw new StoreError('response');
    const location = checkedLocation({ world: row.world, ground: row.ground, version: row.version });
    if (!location?.ground || location.world !== page.world) throw new StoreError('response');
    const value = { ...pearl, ...location };
    if (canonicalText(value) !== canonicalText(row)) throw new StoreError('response');
    previous = pearl.uid;
    return value;
  });
}
export function assertGroundLocations(uniques, locations) {
  for (const [uid, location] of locations) {
    const unique = uniques.get(uid);
    if (!unique || !managedPearl(unique.kind) || location.version !== unique.version ||
      (unique.holder === null) !== (location.ground !== null)) throw new StoreError('ownership');
  }
}
