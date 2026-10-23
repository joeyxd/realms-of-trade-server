// Read-only market projection. This lane exposes quotes and public town stock, never trade authority.
import { GOODS, LAW } from '../data/goods.js';
import { TOWNS } from '../data/towns.js';
import { MSG } from './protocol.js';

export const MARKET_QUERY_LIMIT = 64;
export const MARKET_READ_CAPABILITY = 'market_read';
export const marketId = (value) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value);
const int = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => {
  if (!plain(value)) return false;
  const fields = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(fields);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key) &&
    fields[key].enumerable && Object.hasOwn(fields[key], 'value'));
};
const array = (value, limit) => {
  if (!Array.isArray(value) || value.length > limit) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, i) => fields[i]).every(field => field?.enumerable && Object.hasOwn(field, 'value'));
};
const validTown = (town) => typeof town === 'string' && Object.hasOwn(TOWNS, town) && TOWNS[town].walkable === true;

function queryFields(op) {
  return op === 'list' ? ['t', 'requestId', 'epoch', 'sessionId', 'op'] :
    op === 'quote' ? ['t', 'requestId', 'epoch', 'sessionId', 'op', 'g', 'n', 'side'] : [];
}

// Exact managed wire request. Town/account/entity selectors are intentionally absent.
export function validMarketQuery(value) {
  if (!plain(value)) return false;
  const fields = Object.getOwnPropertyDescriptors(value), op = fields.op?.value, keys = queryFields(op), own = Reflect.ownKeys(fields);
  if (!keys.length || own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key)) ||
      !keys.every(key => fields[key]?.enumerable && Object.hasOwn(fields[key], 'value'))) return false;
  if (value.t !== MSG.AGENT_MARKET || !marketId(value.requestId) || !int(value.epoch) || value.epoch < 1 ||
      !marketId(value.sessionId)) return false;
  return op === 'list' || (typeof value.g === 'string' && Object.hasOwn(GOODS, value.g) && int(value.n, 500) && value.n >= 1 &&
    (value.side === 'buy' || value.side === 'sell'));
}

function validMarketRow(row) {
  return exact(row, ['g', 'stock', 'buy', 'sell', 'trend', 'illegal']) && typeof row.g === 'string' && Object.hasOwn(GOODS, row.g) &&
    int(row.stock, 1e9) && int(row.buy, 1e9) && int(row.sell, 1e9) &&
    [-1, 0, 1].includes(row.trend) && typeof row.illegal === 'boolean' && row.illegal === !!GOODS[row.g].illegal;
}

export function validMarketProjection(value) {
  if (!plain(value)) return false;
  const op = Object.getOwnPropertyDescriptors(value).op?.value;
  if (op === 'list') return exact(value, ['v', 'op', 'town', 'rows']) && value.v === 1 && validTown(value.town) &&
    array(value.rows, Object.keys(GOODS).length) && value.rows.length > 0 && value.rows.every(validMarketRow) &&
    new Set(value.rows.map(row => row.g)).size === value.rows.length;
  return op === 'quote' && exact(value, ['v', 'op', 'town', 'g', 'n', 'side', 'total', 'avg', 'law']) &&
    validTown(value.town) &&
    value.v === 1 && typeof value.g === 'string' && Object.hasOwn(GOODS, value.g) && int(value.n, 500) && value.n >= 1 &&
    (value.side === 'buy' || value.side === 'sell') && int(value.total, 1e9) &&
    (value.side !== 'buy' || value.total >= 1) && typeof value.avg === 'number' && Number.isFinite(value.avg) &&
    value.avg === value.total / value.n && Object.hasOwn(LAW, value.law) && value.law === TOWNS[value.town].law;
}

export const MARKET_FAILURES = Object.freeze([
  'invalid_request', 'control_mismatch', 'forbidden', 'unavailable', 'dead', 'query_limit',
  'far', 'busy', 'stock', 'law', 'market', 'command', 'request_id_conflict',
]);

export function validMarketResult(value) {
  if (!exact(value, ['t', 'requestId', 'epoch', 'sessionId', 'ok', 'why', 'tick', 'replay', 'market']) ||
      value.t !== MSG.AGENT_MARKET_RESULT || typeof value.ok !== 'boolean' || !int(value.tick) ||
      typeof value.replay !== 'boolean') return false;
  const idsValid = marketId(value.requestId) && int(value.epoch) && value.epoch > 0 && marketId(value.sessionId);
  const malformedIds = !value.ok && value.why === 'invalid_request' && !value.replay &&
    (value.requestId === null || marketId(value.requestId)) && (value.epoch === null || (int(value.epoch) && value.epoch > 0)) &&
    (value.sessionId === null || marketId(value.sessionId)) &&
    (value.requestId === null || value.epoch === null || value.sessionId === null);
  if (!idsValid && !malformedIds) return false;
  return value.ok ? value.why === null && validMarketProjection(value.market) :
    MARKET_FAILURES.includes(value.why) && value.market === null && (idsValid || !value.replay);
}
