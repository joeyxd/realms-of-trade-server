import { GOOD_IDS } from '../src/data/goods.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GOODS = new Set(GOOD_IDS);
const exact = (value, keys) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key) &&
    descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')) && keys.every(key => Object.hasOwn(descriptors, key));
};
const fail = () => { throw new TypeError('invalid agent goods budget'); };
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value; }
function integer(value, max) { if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(); return value; }
export function checkedAgentGoodsLimits(value) {
  if (!exact(value, ['buyGold', 'buyGoldPerTrade', 'sellUnits', 'sellUnitsPerTrade']) ||
      !value.sellUnits || typeof value.sellUnits !== 'object' || Array.isArray(value.sellUnits) ||
      Object.keys(value.sellUnits).some(g => !GOODS.has(g))) fail();
  const sellUnits = Object.fromEntries(Object.entries(value.sellUnits).sort(([a], [b]) => a.localeCompare(b))
    .map(([good, amount]) => [good, integer(amount, 1_000_000)]));
  const buyGold = integer(value.buyGold, 1_000_000_000), buyGoldPerTrade = integer(value.buyGoldPerTrade, 1_000_000_000);
  const sellUnitsPerTrade = integer(value.sellUnitsPerTrade, 500);
  if (buyGoldPerTrade > buyGold) fail();
  return { buyGold, buyGoldPerTrade, sellUnits, sellUnitsPerTrade };
}

export function agentGoodsBudgetScope(raw) {
  if (!exact(raw, ['world', 'ownerId', 'characterId'])) fail();
  if (typeof raw.world !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(raw.world)) fail();
  const ownerId = uuid(raw.ownerId), characterId = uuid(raw.characterId);
  if (ownerId === characterId) fail();
  return { world: raw.world, ownerId, characterId };
}

export function agentGoodsBudgetCreate(raw) {
  if (!exact(raw, ['world', 'ownerId', 'characterId', 'budgetId', 'limits'])) fail();
  return { ...agentGoodsBudgetScope({ world: raw.world, ownerId: raw.ownerId, characterId: raw.characterId }),
    budgetId: uuid(raw.budgetId), limits: checkedAgentGoodsLimits(raw.limits) };
}

export function agentGoodsBudgetRevoke(raw) {
  if (!exact(raw, ['world', 'ownerId', 'characterId', 'budgetId'])) fail();
  return { ...agentGoodsBudgetScope({ world: raw.world, ownerId: raw.ownerId, characterId: raw.characterId }),
    budgetId: uuid(raw.budgetId) };
}

export function checkedAgentGoodsBudget(raw) {
  if (!exact(raw, ['v', 'budgetId', 'enabled', 'limits', 'buyGoldUsed', 'sellUnitsUsed']) || raw.v !== 1 ||
      typeof raw.enabled !== 'boolean' || !raw.sellUnitsUsed || typeof raw.sellUnitsUsed !== 'object' ||
      Array.isArray(raw.sellUnitsUsed) || Object.keys(raw.sellUnitsUsed).some(g => !GOODS.has(g))) fail();
  const cleanLimits = checkedAgentGoodsLimits(raw.limits), used = Object.fromEntries(Object.entries(raw.sellUnitsUsed).sort(([a], [b]) => a.localeCompare(b))
    .map(([good, amount]) => [good, integer(amount, 1_000_000)]));
  if (Object.entries(used).some(([good, amount]) => amount > (cleanLimits.sellUnits[good] ?? 0)) ||
      integer(raw.buyGoldUsed, 1_000_000_000) > cleanLimits.buyGold) fail();
  return { v: 1, budgetId: uuid(raw.budgetId), enabled: raw.enabled, limits: cleanLimits,
    buyGoldUsed: raw.buyGoldUsed, sellUnitsUsed: used };
}

export const publicAgentGoodsBudget = checkedAgentGoodsBudget;

export function agentTradeInput(raw) {
  if (!exact(raw, ['operationId', 'request', 'ownerId', 'budgetId'])) fail();
  const operationId = uuid(raw.operationId), ownerId = uuid(raw.ownerId), budgetId = uuid(raw.budgetId);
  if (!raw.request || typeof raw.request !== 'object' || Array.isArray(raw.request) ||
      raw.request.command?.type !== 'commerce' || !['buy', 'sell'].includes(raw.request.command?.op)) fail();
  const scope = agentGoodsBudgetScope({ world: raw.request.world, ownerId, characterId: raw.request.account });
  if (scope.world !== raw.request.world) fail();
  return { operationId, request: raw.request, ownerId, budgetId };
}

export function checkAgentTradeDelta(current, request) {
  const { command, profile, ack } = request, oldGoods = current?.eco?.pack?.goods ?? {}, newGoods = profile?.eco?.pack?.goods ?? {};
  const oldOther = { ...oldGoods }, newOther = { ...newGoods };
  delete oldOther[command.g]; delete newOther[command.g];
  if (ack?.ok !== true) {
    if (!current || profile.gold !== current.gold || canonical(oldGoods) !== canonical(newGoods)) fail();
    return { buyGold: 0, sellUnits: 0 };
  }
  const deltaGoods = (newGoods[command.g] ?? 0) - (oldGoods[command.g] ?? 0);
  if (canonical(oldOther) !== canonical(newOther)) fail();
  if (command.op === 'buy') {
    const gold = current.gold - profile.gold;
    if (gold !== command.expectedTotal || deltaGoods !== command.n) fail();
    return { buyGold: gold, sellUnits: 0 };
  }
  const gold = profile.gold - current.gold;
  if (gold !== command.expectedTotal || deltaGoods !== -command.n) fail();
  return { buyGold: 0, sellUnits: command.n };
}

function canonical(value) { return JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))); }
