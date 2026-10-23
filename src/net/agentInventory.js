// Read-only inventory wire contract. This view never grants ownership or mutation rights.
import { ITEMS, SLOTS, BASES, CONSUMABLES, slotFits } from '../data/items.js';
import { GOODS } from '../data/goods.js';
import { sanitizeItem } from '../sim/items.js';
import { PACK_CAP, goodVolume } from '../sim/economy/cargo.js';
import { MSG } from './protocol.js';

export const INVENTORY_QUERY_LIMIT = 64;
export const INVENTORY_READ_CAPABILITY = 'inventory_read';
export const inventoryId = (value) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value);
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

export function validInventoryItem(value) {
  if (!exact(value, ['u', 'b', 'r', 'l', 'a', ...(Object.hasOwn(value ?? {}, 's') ? ['s'] : [])]) ||
      !int(value.u, 2147483647) || typeof value.b !== 'string' || !Object.hasOwn(BASES, value.b) ||
      !int(value.r, 4) || !int(value.l, ITEMS.maxLevel) || value.l < 1 ||
      !array(value.a, 4) ||
      value.a.some(row => !array(row, 2) || row.length !== 2 || typeof row[0] !== 'string' ||
        typeof row[1] !== 'number' || !Number.isFinite(row[1]) || row[1] < 0) ||
      (Object.hasOwn(value, 's') && value.s !== 1)) return false;
  const canonical = sanitizeItem(value);
  return canonical !== null && canonical.u === value.u && canonical.r === value.r && canonical.l === value.l &&
    JSON.stringify(canonical.a) === JSON.stringify(value.a);
}

export function validInventory(value) {
  if (!exact(value, ['v', 'gold', 'bag', 'equipment', 'potions', 'pack']) || value.v !== 1 || !int(value.gold, 1e9) ||
      !exact(value.bag, ['capacity', 'items']) || value.bag.capacity !== ITEMS.bag ||
      !array(value.bag.items, ITEMS.bag) || !value.bag.items.every(validInventoryItem) ||
      !exact(value.equipment, SLOTS) || !SLOTS.every(slot => value.equipment[slot] === null ||
        (validInventoryItem(value.equipment[slot]) && slotFits(BASES[value.equipment[slot].b].slot, slot))) ||
      !exact(value.potions, ['count', 'capacity']) || value.potions.capacity !== CONSUMABLES.potion.max ||
      !int(value.potions.count, CONSUMABLES.potion.max) || !exact(value.pack, ['capacity', 'used', 'goods']) ||
      value.pack.capacity !== PACK_CAP || typeof value.pack.used !== 'number' || !Number.isFinite(value.pack.used) ||
      value.pack.used < 0 || value.pack.used > PACK_CAP + 1e-8 || !array(value.pack.goods, Object.keys(GOODS).length) || value.pack.goods.some(row =>
        !exact(row, ['id', 'quantity']) || typeof row.id !== 'string' || !Object.hasOwn(GOODS, row.id) ||
        !int(row.quantity, 1e6) || row.quantity < 1)) return false;
  const owned = [...value.bag.items, ...Object.values(value.equipment).filter(Boolean)];
  if (new Set(owned.map(item => item.u)).size !== owned.length) return false;
  const ids = value.pack.goods.map(row => row.id);
  return new Set(ids).size === ids.length && ids.every((id, i) => !i || ids[i - 1] < id) &&
    value.pack.used === value.pack.goods.reduce((used, row) => used + goodVolume(row.id) * row.quantity, 0);
}

export const INVENTORY_FAILURES = Object.freeze([
  'invalid_request', 'control_mismatch', 'forbidden', 'unavailable', 'dead', 'query_limit',
]);

export function validInventoryResult(value) {
  return exact(value, ['t', 'requestId', 'epoch', 'sessionId', 'ok', 'why', 'tick', 'replay', 'inventory']) &&
    value.t === MSG.AGENT_INVENTORY_RESULT && inventoryId(value.requestId) && int(value.epoch) && value.epoch > 0 &&
    inventoryId(value.sessionId) && int(value.tick) && typeof value.ok === 'boolean' && typeof value.replay === 'boolean' &&
    (value.ok ? value.why === null && validInventory(value.inventory) :
      INVENTORY_FAILURES.includes(value.why) && value.inventory === null && !value.replay);
}
