// Ordinary death-drop lifecycle DTOs. Trusted authority supplies the logical tick and
// frozen receiver baseline; this contract does not grant proximity or gameplay permission.
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { StoreError, playerKey } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { groundKey } from './pearlGround.mjs';
import { checkedDeathDropPage, deathDropPage, MAX_DEATH_DROPS } from './deathOperation.mjs';

const same = (a, b) => canonicalText(a) === canonicalText(b);
const integer = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const keys = (v, expected) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === expected;
function id(v) {
  const out = playerKey(v);
  if (out !== v) throw new StoreError('operation');
  return out;
}
// Snapshot only plain JSON data: do not execute accessors/toJSON or discard symbols,
// sparse entries, non-enumerable fields, custom prototypes or non-finite numbers.
function data(raw, depth = 0) {
  if (depth > 64) throw new StoreError('operation');
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (!raw || typeof raw !== 'object') throw new StoreError('operation');
  const array = Array.isArray(raw), proto = Object.getPrototypeOf(raw);
  if (!array && proto !== Object.prototype && proto !== null) throw new StoreError('operation');
  if (array && proto !== Array.prototype) throw new StoreError('operation');
  const descriptors = Object.getOwnPropertyDescriptors(raw), all = Reflect.ownKeys(descriptors);
  if (all.some((k) => typeof k !== 'string')) throw new StoreError('operation');
  const out = array ? [] : Object.create(null);
  if (array && all.length !== raw.length + 1) throw new StoreError('operation');
  for (const k of all) {
    if (array && k === 'length') continue;
    const d = descriptors[k];
    if (!d.enumerable || !Object.hasOwn(d, 'value') ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= raw.length))) throw new StoreError('operation');
    Object.defineProperty(out, k, { value: data(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}
function profile(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > 131072) throw new Error('profile');
    const p = sanitizeProfile(raw);
    if (!p || !same(p, raw)) throw new Error('canonical');
    return p;
  } catch { throw new StoreError('profile'); }
}
function creation(raw) {
  try {
    return checkedDeathDropPage([raw], { world: groundKey(raw.world), after: null, limit: 1 })[0];
  } catch { throw new StoreError('operation'); }
}
export function deathDropKey(operationId, ordinal) {
  operationId = id(operationId);
  if (!integer(ordinal, 1, MAX_DEATH_DROPS)) throw new StoreError('operation');
  return { operationId, ordinal };
}
export function deathDropOperation(input) {
  const raw = data(input);
  if (!keys(raw, 'at,drop,mode,operationId,profile,world') || !['pickup','expire'].includes(raw.mode) ||
      !integer(raw.at, 0, Number.MAX_SAFE_INTEGER) ||
      !keys(raw.drop, 'expectedVersion,ground,item,kind,operationId,ordinal,victim,world') ||
      !integer(raw.drop.expectedVersion, 1, 2147483646)) throw new StoreError('operation');
  const operationId = id(raw.operationId), world = groundKey(raw.world);
  const { expectedVersion, ...fields } = raw.drop;
  const drop = { ...creation(fields), expectedVersion };
  if (drop.kind === 'item' && !integer(drop.item.u, 1, 2147483646)) throw new StoreError('operation');
  id(drop.operationId); id(drop.victim);
  if (drop.world !== world || drop.operationId === operationId) throw new StoreError('operation');
  let receiver = null;
  if (raw.mode === 'pickup') {
    const p = raw.profile;
    if (!keys(p, 'before,data,expectedVersion,id') || !integer(p.expectedVersion, 1, 2147483646)) throw new StoreError('operation');
    receiver = { id: id(p.id), expectedVersion: p.expectedVersion, before: profile(p.before), data: profile(p.data) };
    if (receiver.before.pirateId !== 'account:' + receiver.id) throw new StoreError('identity');
  } else if (raw.profile !== null) throw new StoreError('operation');
  const request = { world, mode: raw.mode, at: raw.at, drop, profile: receiver };
  if (!validDeathDropDelta(request)) throw new StoreError('ownership');
  return { operationId, request };
}
export function validDeathDropDelta(request) {
  if (request.mode === 'expire') return request.profile === null;
  const p = request.profile;
  if (!p || !Array.isArray(p.before.bag)) return false;
  const expected = structuredClone(p.before);
  if (request.drop.kind === 'item') {
    if (expected.bag.length >= 24 || !integer(expected.uid, 1, 2147483646) ||
        !integer(expected.stats?.items, 0, 999999999)) return false;
    const item = structuredClone(request.drop.item); item.u = expected.uid++;
    expected.bag.push(item); expected.stats.items++;
  } else {
    if (!integer(expected.pot, 0, 4)) return false;
    expected.pot++;
  }
  return same(expected, p.data);
}
export function deathDropInWindow(request) {
  return request.mode === 'expire' ? request.at > request.drop.ground.expiresAt :
    request.at >= request.drop.ground.availableAt && request.at <= request.drop.ground.expiresAt;
}
export function deathDropResult(request, operationId, replay = false) {
  const { expectedVersion, ...source } = request.drop;
  return { ok: true, replay, profiles: request.profile ? [{ id: request.profile.id, version: request.profile.expectedVersion + 1 }] : [],
    drop: { ...structuredClone(source), state: request.mode === 'pickup' ? 'picked' : 'expired',
      version: expectedVersion + 1, holder: request.profile?.id ?? null, transitionOperationId: operationId } };
}
export function checkedDeathDropResult(raw, request, operationId) {
  try {
    raw = data(raw);
    if (keys(raw, 'ok,why') && raw.ok === false && ['conflict','ownership','operation'].includes(raw.why)) return { ok: false, why: raw.why };
    if (raw?.ok !== true || typeof raw.replay !== 'boolean' || request.drop.expectedVersion !== 1 || !deathDropInWindow(request)) throw new Error('result');
    const expected = deathDropResult(request, operationId, raw.replay);
    if (!same(raw, expected)) throw new Error('result');
    return expected;
  } catch { throw new StoreError('response'); }
}
export function checkedDeathDropReceipt(raw, operationId) {
  if (raw === null) return null;
  try {
    raw = data(raw);
    if (!keys(raw, 'request,result')) throw new Error('receipt');
    const { request } = deathDropOperation({ ...raw.request, operationId });
    if (!same(request, raw.request)) throw new Error('request');
    const result = checkedDeathDropResult(raw.result, request, operationId);
    if (!result.ok || result.replay || !deathDropInWindow(request)) throw new Error('result');
    return { request, result };
  } catch { throw new StoreError('response'); }
}
export function checkedCurrentDeathDrop(input, source = null) {
  if (input === null) return null;
  try {
    const raw = data(input);
    if (!keys(raw, 'ground,holder,item,kind,operationId,ordinal,state,transitionOperationId,version,victim,world')) throw new Error('state');
    const { state, version, holder, transitionOperationId, ...fields } = raw;
    const row = creation(fields);
    if (source && (row.operationId !== source.operationId || row.ordinal !== source.ordinal)) throw new Error('source');
    if (state === 'ground') {
      if (version !== 1 || holder !== null || transitionOperationId !== null) throw new Error('ground');
    } else {
      if (!['picked','expired'].includes(state) || version !== 2 || id(transitionOperationId) === row.operationId ||
          (state === 'expired' ? holder !== null : id(holder) !== holder)) throw new Error('terminal');
    }
    return { ...row, state, version, holder, transitionOperationId };
  } catch { throw new StoreError('response'); }
}
export function currentDeathDropPage(world, options = {}) {
  return deathDropPage(world, data(options));
}
export function checkedCurrentDeathDropPage(raw, page) {
  try {
    raw = data(raw);
    if (!Array.isArray(raw) || raw.length > page.limit) throw new Error('page');
    const rows = raw.map((r) => checkedCurrentDeathDrop(r));
    if (rows.some((r) => r === null || r.state !== 'ground' || r.world !== page.world)) throw new Error('ground');
    const creations = rows.map(({ state, version, holder, transitionOperationId, ...fields }) => fields);
    checkedDeathDropPage(creations, page);
    return rows;
  } catch { throw new StoreError('response'); }
}
