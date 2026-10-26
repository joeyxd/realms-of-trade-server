// Internal W01 storage DTOs. These identities are selected by a trusted server, not by player messages.
export class AssetRegistryError extends Error {
  constructor(code) { super(`Asset registry: ${code}`); this.name = 'AssetRegistryError'; this.code = code; }
}

export const MAX_VERSION = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const HASH = /^[0-9a-f]{64}$/;
const INVALID_KEY = /[^a-zA-Z0-9:_-]/;
const REGISTER = ['operationId', 'action', 'assetId', 'worldId', 'worldGeneration', 'assetClass',
  'sourceKey', 'contentId', 'contentHash', 'rightsHash', 'to'];
const TRANSFER = ['operationId', 'action', 'assetId', 'worldId', 'worldGeneration', 'from', 'to', 'expectedVersion'];
const ASSET = ['assetId', 'worldId', 'worldGeneration', 'assetClass', 'sourceKey', 'contentId',
  'contentHash', 'rightsHash', 'ownerId', 'version'];
const PREPARE_FAILURES = ['operation', 'conflict', 'ownership', 'busy', 'identity'];
const TERMINAL_FAILURES = ['conflict', 'ownership', 'identity', 'cancelled'];
const CLAIM_FAILURES = ['missing', 'busy', 'ownership', 'conflict'];
const fail = (code) => { throw new AssetRegistryError(code); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function exact(value, fields, code = 'input') {
  if (!object(value) || Reflect.ownKeys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) fail(code);
  return value;
}
export function uuid(value, code = 'input') {
  if (typeof value !== 'string' || value.length !== 36 || !UUID.test(value) || value === ZERO_UUID) fail(code);
  return value;
}
export function key(value, max = 100, code = 'input') {
  if (typeof value !== 'string' || !value.length || value.length > max || INVALID_KEY.test(value)) fail(code);
  return value;
}
export function version(value, max = MAX_VERSION, code = 'input') {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(code);
  return value;
}
function hash(value, code) {
  if (typeof value !== 'string' || value.length !== 64 || !HASH.test(value)) fail(code);
  return value;
}
function identity(value, code) {
  uuid(value.assetId, code); key(value.worldId, 100, code); uuid(value.worldGeneration, code);
}
function definition(value, code) {
  if (!['equipment', 'plot'].includes(value.assetClass)) fail(code);
  key(value.sourceKey, 160, code); key(value.contentId, 100, code);
  hash(value.contentHash, code); hash(value.rightsHash, code);
}
export function requestOf(raw, code = 'input') {
  const fields = raw?.action === 'register' ? REGISTER : raw?.action === 'transfer' ? TRANSFER : null;
  if (!fields) fail(code);
  exact(raw, fields, code); uuid(raw.operationId, code); identity(raw, code); uuid(raw.to, code);
  if (raw.action === 'register') definition(raw, code);
  else {
    uuid(raw.from, code); version(raw.expectedVersion, MAX_VERSION - 1, code);
    if (raw.from === raw.to) fail(code);
  }
  return Object.fromEntries(fields.map((field) => [field, raw[field]]));
}
export function assetOf(raw, code = 'response') {
  exact(raw, ASSET, code); identity(raw, code); definition(raw, code);
  uuid(raw.ownerId, code); version(raw.version, MAX_VERSION, code);
  return Object.fromEntries(ASSET.map((field) => [field, raw[field]]));
}
export function canonical(value) {
  const sort = (v) => Array.isArray(v) ? v.map(sort) : object(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}
export function sourceOf(value) {
  return canonical([value.worldId, value.worldGeneration, value.assetClass, value.sourceKey]);
}
export function registerAsset(request) {
  return assetOf({ assetId: request.assetId, worldId: request.worldId, worldGeneration: request.worldGeneration,
    assetClass: request.assetClass, sourceKey: request.sourceKey, contentId: request.contentId,
    contentHash: request.contentHash, rightsHash: request.rightsHash, ownerId: request.to, version: 1 });
}
function resultOf(raw, request, code = 'response') {
  if (raw?.ok === true) {
    exact(raw, ['ok', 'asset'], code);
    const asset = assetOf(raw.asset, code);
    if (asset.assetId !== request.assetId || asset.worldId !== request.worldId
      || asset.worldGeneration !== request.worldGeneration || asset.ownerId !== request.to
      || asset.version !== (request.action === 'register' ? 1 : request.expectedVersion + 1)) fail(code);
    if (request.action === 'register' && canonical(asset) !== canonical(registerAsset(request))) fail(code);
    return { ok: true, asset };
  }
  exact(raw, ['ok', 'why'], code);
  if (raw.ok !== false || !TERMINAL_FAILURES.includes(raw.why)) fail(code);
  return { ok: false, why: raw.why };
}
export function operationOf(raw, expectedId = null) {
  exact(raw, ['operationId', 'request', 'state', 'result'], 'response');
  const id = uuid(raw.operationId, 'response'), request = requestOf(raw.request, 'response');
  if (id !== request.operationId || (expectedId !== null && id !== expectedId)) fail('response');
  if (!['pending', 'committed', 'rejected', 'cancelled'].includes(raw.state)) fail('response');
  let result = null;
  if (raw.state === 'pending') { if (raw.result !== null) fail('response'); }
  else {
    result = resultOf(raw.result, request);
    if ((raw.state === 'committed') !== result.ok
      || (raw.state === 'cancelled') !== (result.why === 'cancelled')) fail('response');
  }
  return { operationId: id, request, state: raw.state, result };
}
export function checkedPrepare(raw, request) {
  if (raw?.ok === false) {
    exact(raw, ['ok', 'replay', 'why'], 'response');
    if (raw.replay !== false || !PREPARE_FAILURES.includes(raw.why)) fail('response');
    return { ok: false, replay: false, why: raw.why };
  }
  exact(raw, ['ok', 'replay', 'operation'], 'response');
  if (raw.ok !== true || typeof raw.replay !== 'boolean') fail('response');
  const operation = operationOf(raw.operation, request.operationId);
  if (canonical(operation.request) !== canonical(request) || (!raw.replay && operation.state !== 'pending')) fail('response');
  return { ok: true, replay: raw.replay, operation };
}
export function checkedOutcome(raw, operation) {
  if (typeof raw?.replay !== 'boolean') fail('response');
  const { replay, ...result } = raw;
  if (operation === null) {
    exact(result, ['ok', 'why'], 'response');
    if (result.ok !== false || result.why !== 'missing' || replay !== false) fail('response');
  } else {
    if (operation.state === 'pending' || canonical(result) !== canonical(operation.result)) fail('response');
    resultOf(result, operation.request);
  }
  return { ...result, replay };
}
export function pageOf(worldId, worldGeneration, options = {}) {
  key(worldId); uuid(worldGeneration);
  if (!object(options) || Reflect.ownKeys(options).some((k) => !['afterId', 'limit'].includes(k))) fail('input');
  const { afterId = null, limit = 50 } = options;
  if (afterId !== null) uuid(afterId);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('input');
  return { worldId, worldGeneration, afterId, limit };
}
export function checkedPage(raw, page) {
  if (!Array.isArray(raw) || raw.length > page.limit) fail('response');
  let previous = page.afterId;
  return raw.map((value) => {
    const op = operationOf(value);
    if (op.state !== 'pending' || op.request.worldId !== page.worldId
      || op.request.worldGeneration !== page.worldGeneration || (previous !== null && op.operationId <= previous)) fail('response');
    previous = op.operationId; return op;
  });
}
export function claimOf(raw) {
  exact(raw, ['assetId', 'ownerId', 'version']); uuid(raw.assetId); uuid(raw.ownerId); version(raw.version);
  return { assetId: raw.assetId, ownerId: raw.ownerId, version: raw.version };
}
export function checkedClaim(raw) {
  exact(raw, raw?.ok === true ? ['ok'] : ['ok', 'why'], 'response');
  if (raw.ok !== true && (raw.ok !== false || !CLAIM_FAILURES.includes(raw.why))) fail('response');
  return { ...raw };
}
