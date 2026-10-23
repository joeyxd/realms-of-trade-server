// Private synchronous projection. Read descriptors without invoking profile getters or sanitizing live state.
import { types } from 'node:util';
import { ITEMS, SLOTS, CONSUMABLES } from '../src/data/items.js';
import { PACK_CAP, goodVolume } from '../src/sim/economy/cargo.js';
import { validInventory } from '../src/net/agentInventory.js';

function fields(value) {
  if (!value || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('invalid inventory source');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value')))
    throw new TypeError('invalid inventory source');
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function list(value, limit) {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > limit) throw new TypeError('invalid inventory source');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, i) => descriptors[i]).some(d => !d || !Object.hasOwn(d, 'value')))
    throw new TypeError('invalid inventory source');
  return Array.from({ length: value.length }, (_, i) => descriptors[i].value);
}
function item(raw) {
  if (raw == null) return null;
  const source = fields(raw);
  const out = { u: source.u, b: source.b, r: source.r, l: source.l,
    a: list(source.a, 4).map(row => list(row, 2)) };
  if (Object.hasOwn(source, 's')) out.s = source.s;
  return out;
}

export function captureAgentInventory(world, entity) {
  try {
    const profile = fields(world.profiles.get(entity)), eq = fields(profile.eq), eco = fields(profile.eco),
      pack = fields(eco.pack), goods = fields(pack.goods);
    const rows = Object.keys(goods).sort().map(id => ({ id, quantity: goods[id] }));
    const inventory = { v: 1, gold: profile.gold,
      bag: { capacity: ITEMS.bag, items: list(profile.bag, ITEMS.bag).map(item) },
      equipment: Object.fromEntries(SLOTS.map(slot => [slot, item(eq[slot])])),
      potions: { count: world.ecs.potions[entity], capacity: CONSUMABLES.potion.max },
      pack: { capacity: pack.cap, used: rows.reduce((used, row) => used + goodVolume(row.id) * row.quantity, 0), goods: rows } };
    return pack.cap === PACK_CAP && validInventory(inventory) ? inventory : null;
  } catch { return null; }
}
