// Exact server-owned operation contract shared by commerce and community construction.
// Identity, gameplay eligibility and candidate construction remain the host's responsibility.
import { GOODS } from '../src/data/goods.js';
import { TOWN_IDS } from '../src/data/towns.js';
import { CRAFT_RECIPES } from '../src/data/resources.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { checkedResourceState } from './resourceState.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
const MAX_VERSION = 2147483647;
const MAX_PROFILE_BYTES = 128 * 1024;
const MAX_WORLD_BYTES = 2 * 1024 * 1024;
const MAX_ACK_BYTES = 32 * 1024;
const REQUEST_FIELDS = ['world', 'account', 'command', 'expectedProfileVersion', 'expectedWorldVersion', 'profile', 'worldData', 'ack'];
const COMMERCE_BUY_FIELDS = ['type', 'op', 'opId', 'town', 'g', 'n', 'expectedTotal'];
const COMMERCE_TRANSFER_FIELDS = ['type', 'op', 'opId', 'id', 'expectedRev', 'g', 'n', 'side'];
const COMMUNITY_FIELDS = ['type', 'op', 'opId', 'projectId', 'good', 'amount', 'expectedRev'];
const RAFT_SUPPLY_FIELDS = ['type', 'op', 'opId', 'id', 'expectedRev', 'g', 'n'];
const RESOURCE_GATHER_FIELDS = ['type', 'op', 'opId', 'node', 'expectedRev'];
const RESOURCE_CRAFT_FIELDS = ['type', 'op', 'opId', 'recipe', 'expectedRev', 'n'];
const ACK_FIELDS = ['type', 'op', 'opId', 'ok', 'why', 'rev'];
const fail = code => { throw new EconomicOperationError(code); };

export class EconomicOperationError extends Error {
  constructor(code) { super(`Economic operation: ${code}`); this.name = 'EconomicOperationError'; this.code = code; }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value, fields) {
  if (!object(value) || Reflect.ownKeys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k)) ||
    fields.some(k => { const d = Object.getOwnPropertyDescriptor(value, k); return !d.enumerable || !Object.hasOwn(d, 'value'); })) fail('input');
}
function json(value, seen = new Set(), depth = 0) {
  if (depth > 64) fail('input');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('input'); return; }
  if ((!Array.isArray(value) && !object(value)) || seen.has(value)) fail('input');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) fail('input');
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, i);
      if (!d || !Object.hasOwn(d, 'value')) fail('input');
      json(d.value, seen, depth + 1);
    }
  } else for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value')) fail('input');
    json(d.value, seen, depth + 1);
  }
  seen.delete(value);
}
function bytes(value, maximum) {
  json(value);
  try {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > maximum) fail('input');
    return text;
  } catch { fail('input'); }
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value) || NIL_UUID.test(value)) fail('input');
  return value.toLowerCase();
}
function key(value, max = 100) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]+$/.test(value) || value.length < 1 || value.length > max) fail('input');
  return value;
}
function commandId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) fail('input');
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('input');
}
function jsonCopy(value) { return JSON.parse(JSON.stringify(value)); }

export function canonicalEconomicText(value) {
  json(value);
  const sort = item => Array.isArray(item) ? item.map(sort) : object(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, sort(item[k])])) : item;
  return JSON.stringify(sort(value));
}

function checkedCommand(raw) {
  if (!object(raw)) fail('input');
  const id = commandId(raw.opId);
  if (raw.type === 'commerce' && ['buy', 'sell'].includes(raw.op)) {
    exact(raw, COMMERCE_BUY_FIELDS);
    if (!TOWN_IDS.includes(raw.town) || !Object.hasOwn(GOODS, raw.g)) fail('input');
    integer(raw.n, 1, 500); integer(raw.expectedTotal, 0, 1_000_000_000);
    return { type: 'commerce', op: raw.op, opId: id, town: raw.town, g: raw.g, n: raw.n, expectedTotal: raw.expectedTotal };
  }
  if (raw.type === 'commerce' && raw.op === 'transfer') {
    exact(raw, COMMERCE_TRANSFER_FIELDS);
    key(raw.id, 120);
    integer(raw.expectedRev, 1, MAX_VERSION - 1);
    if (!Object.hasOwn(GOODS, raw.g) || !['deposit', 'withdraw'].includes(raw.side)) fail('input');
    integer(raw.n, 1, 500);
    return { type: 'commerce', op: 'transfer', opId: id, id: raw.id, expectedRev: raw.expectedRev,
      g: raw.g, n: raw.n, side: raw.side };
  }
  if (raw.type === 'community' && raw.op === 'contribute') {
    exact(raw, COMMUNITY_FIELDS);
    key(raw.projectId);
    if (!Object.hasOwn(GOODS, raw.good) || GOODS[raw.good].cat !== 'material') fail('input');
    integer(raw.amount, 1, 500); integer(raw.expectedRev, 1, MAX_VERSION - 1);
    return { type: 'community', op: 'contribute', opId: id, projectId: raw.projectId,
      good: raw.good, amount: raw.amount, expectedRev: raw.expectedRev };
  }
  if (raw.type === 'raft' && raw.op === 'supply') {
    exact(raw, RAFT_SUPPLY_FIELDS);
    key(raw.id, 120);
    integer(raw.expectedRev, 1, MAX_VERSION - 1);
    if (!['madera', 'hierro'].includes(raw.g)) fail('input');
    integer(raw.n, 1, 10);
    return { type: 'raft', op: 'supply', opId: id, id: raw.id, expectedRev: raw.expectedRev,
      g: raw.g, n: raw.n };
  }
  if (raw.type === 'resource' && raw.op === 'gather') {
    exact(raw, RESOURCE_GATHER_FIELDS);
    if (typeof raw.node !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.node)) fail('input');
    integer(raw.expectedRev, 1, MAX_VERSION - 1);
    return { type: 'resource', op: 'gather', opId: id, node: raw.node, expectedRev: raw.expectedRev };
  }
  if (raw.type === 'resource' && raw.op === 'craft') {
    exact(raw, RESOURCE_CRAFT_FIELDS);
    const recipe = CRAFT_RECIPES[raw.recipe];
    if (!recipe) fail('input');
    integer(raw.expectedRev, 0, MAX_VERSION - 1);
    integer(raw.n, 1, recipe.max);
    return { type: 'resource', op: 'craft', opId: id, recipe: raw.recipe, expectedRev: raw.expectedRev, n: raw.n };
  }
  fail('input');
}

function checkedWorldData(raw) {
  if (!object(raw)) fail('input');
  const fields = Object.keys(raw).sort();
  const expected = ['economy', 'seed', 'v', ...(Object.hasOwn(raw, 'community') ? ['community'] : []),
    ...(Object.hasOwn(raw, 'resources') ? ['resources'] : [])].sort();
  if (canonicalEconomicText(fields) !== canonicalEconomicText(expected)) fail('input');
  if (raw.v !== 1) fail('input');
  integer(raw.seed, 0, 0xffffffff);
  if (!object(raw.economy) || raw.economy.v !== 2 || !object(raw.economy.markets) || !object(raw.economy.plots)) fail('input');
  if (Object.keys(raw.economy.markets).length !== TOWN_IDS.length || Object.keys(raw.economy.plots).length !== TOWN_IDS.length) fail('input');
  for (const town of TOWN_IDS) {
    const market = raw.economy.markets[town], plots = raw.economy.plots[town];
    if (!object(market) || market.id !== town || !object(market.stock) || !object(market.last) || !Array.isArray(plots)) fail('input');
  }
  if (Object.hasOwn(raw, 'community') && !object(raw.community)) fail('input');
  if (Object.hasOwn(raw, 'resources')) {
    try { checkedResourceState(raw.resources); } catch { fail('input'); }
  }
  const data = jsonCopy(raw);
  bytes(data, MAX_WORLD_BYTES);
  return data;
}

function checkedAck(raw, command) {
  if (!object(raw) || ACK_FIELDS.some(k => !Object.hasOwn(raw, k)) || Object.hasOwn(raw, 'to')) fail('input');
  const expectedType = command.type === 'raft' ? 'raftEdit' : command.type;
  if (raw.type !== expectedType || raw.op !== command.op || raw.opId !== command.opId || typeof raw.ok !== 'boolean' ||
    typeof raw.why !== 'string' || raw.why.length > 64) fail('input');
  integer(raw.rev, 0, MAX_VERSION);
  bytes(raw, MAX_ACK_BYTES);
  return jsonCopy(raw);
}

function checkedRequest(input) {
  exact(input, REQUEST_FIELDS);
  const world = key(input.world), account = uuid(input.account);
  integer(input.expectedProfileVersion, 1, MAX_VERSION - 1);
  integer(input.expectedWorldVersion, 1, MAX_VERSION - 1);
  const command = checkedCommand(input.command);
  const profileText = bytes(input.profile, MAX_PROFILE_BYTES);
  const parsedProfile = JSON.parse(profileText);
  const profile = parsedProfile && sanitizeProfile(parsedProfile);
  if (!profile || canonicalEconomicText(profile) !== canonicalEconomicText(parsedProfile)) fail('input');
  const worldData = checkedWorldData(input.worldData);
  if (command.type === 'resource' && !Object.hasOwn(worldData, 'resources')) fail('input');
  const ack = checkedAck(input.ack, command);
  const request = { world, account, command, expectedProfileVersion: input.expectedProfileVersion,
    expectedWorldVersion: input.expectedWorldVersion, profile, worldData, ack };
  return request;
}

export function economicOperation(raw) {
  exact(raw, ['operationId', 'request']);
  const operationId = uuid(raw.operationId);
  return { operationId, request: checkedRequest(raw.request) };
}

function resultShape(raw, request, replay) {
  if (object(raw) && raw.ok === false) {
    exact(raw, ['ok', 'why']);
    if (!['conflict', 'operation'].includes(raw.why)) fail('response');
    return jsonCopy(raw);
  }
  exact(raw, ['ok', 'replay', 'profileVersion', 'worldVersion', 'ack']);
  if (raw.ok !== true || raw.replay !== replay || raw.profileVersion !== request.expectedProfileVersion + 1 ||
    raw.worldVersion !== request.expectedWorldVersion + 1 || canonicalEconomicText(raw.ack) !== canonicalEconomicText(request.ack)) fail('response');
  return jsonCopy(raw);
}

export function checkedEconomicResult(raw, requestRaw, replay = false) {
  const request = checkedRequest(requestRaw);
  return resultShape(raw, request, replay);
}

export function checkedEconomicReceipt(raw, operationIdRaw) {
  const operationId = uuid(operationIdRaw);
  if (raw === null) return null;
  try {
    exact(raw, ['request', 'result']);
    const { operationId: requestId, request } = economicOperation({ operationId, request: raw.request });
    if (requestId !== operationId) fail('response');
    const result = resultShape(raw.result, request, false);
    if (!result.ok) fail('response');
    return { request, result };
  } catch { fail('response'); }
}
