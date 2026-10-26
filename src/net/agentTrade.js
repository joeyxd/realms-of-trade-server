// Closed managed-agent trade lane. A trade is a durable economic operation, not a market read.
import { GOODS } from '../data/goods.js';
import { MSG } from './protocol.js';

export const AGENT_TRADE_LIMIT = 64;
export const AGENT_TRADE_CAPABILITIES = Object.freeze({ buy: 'trade_buy', sell: 'trade_sell' });
export const agentTradeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const int = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => {
  if (!plain(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key) &&
    descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'));
};

export function validAgentTradeRequest(value) {
  return exact(value, ['t', 'opId', 'epoch', 'sessionId', 'op', 'g', 'n', 'expectedTotal']) &&
    value.t === MSG.AGENT_TRADE && agentTradeId(value.opId) && int(value.epoch) && value.epoch > 0 &&
    agentTradeId(value.sessionId) && ['buy', 'sell'].includes(value.op) &&
    typeof value.g === 'string' && Object.hasOwn(GOODS, value.g) && int(value.n, 500) && value.n >= 1 &&
    int(value.expectedTotal, 1e9);
}

const BUDGET_LIMIT_KEYS = ['buyGold', 'buyGoldPerTrade', 'sellUnits', 'sellUnitsPerTrade'];
function validBudget(value) {
  if (value === null) return true;
  if (!exact(value, ['v', 'budgetId', 'enabled', 'limits', 'buyGoldUsed', 'sellUnitsUsed']) ||
      value.v !== 1 || !uuid(value.budgetId) || typeof value.enabled !== 'boolean' ||
      !exact(value.limits, BUDGET_LIMIT_KEYS) || !int(value.buyGoldUsed, 1e9) ||
    !plain(value.sellUnitsUsed) || Object.keys(value.sellUnitsUsed).length > Object.keys(GOODS).length ||
      Object.entries(value.sellUnitsUsed).some(([good, amount]) => !Object.hasOwn(GOODS, good) || !int(amount, 1e6))) return false;
  const limits = value.limits;
  return int(limits.buyGold, 1e9) && int(limits.buyGoldPerTrade, 1e9) && plain(limits.sellUnits) &&
    Object.keys(limits.sellUnits).length <= Object.keys(GOODS).length &&
    Object.entries(limits.sellUnits).every(([good, amount]) => Object.hasOwn(GOODS, good) && int(amount, 1e6)) &&
    int(limits.sellUnitsPerTrade, 500);
}

function validReceipt(value) {
  return exact(value, ['op', 'g', 'n', 'total', 'rev', 'ok', 'why']) &&
    ['buy', 'sell'].includes(value.op) && typeof value.g === 'string' && Object.hasOwn(GOODS, value.g) &&
    int(value.n, 500) && value.n >= 1 && int(value.total, 1e9) && int(value.rev, 2147483647) &&
    typeof value.ok === 'boolean' && typeof value.why === 'string' && value.why.length <= 64;
}

export function validAgentTradeResult(value) {
  if (!exact(value, ['t', 'opId', 'epoch', 'sessionId', 'ok', 'why', 'tick', 'replay', 'historical', 'receipt', 'budget']) ||
      value.t !== MSG.AGENT_TRADE_RESULT || !agentTradeId(value.opId) || !int(value.epoch) || value.epoch < 1 ||
      !agentTradeId(value.sessionId) || typeof value.ok !== 'boolean' ||
      (value.why !== null && (typeof value.why !== 'string' || value.why.length > 64)) ||
      !int(value.tick) || typeof value.replay !== 'boolean' || typeof value.historical !== 'boolean' ||
      (value.receipt !== null && !validReceipt(value.receipt)) || !validBudget(value.budget)) return false;
  if (value.ok) return (value.why === null || value.why === '') && value.receipt?.ok === true;
  return typeof value.why === 'string' && value.why.length > 0 && (value.receipt === null || value.receipt.ok === false);
}
