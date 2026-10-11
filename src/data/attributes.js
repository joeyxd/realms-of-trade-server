// Unmounted INV02a attribute data contract. This module describes points only; no runtime system calls it.
// A plan is not a durable ACK or replay guarantee. M5 must own any live mutation before gameplay is enabled.
import { tuning } from './tuning.js';

export const ATTR = Object.freeze({
  version: 1,
  maxPoints: Math.max(0, tuning.stats.maxLevel - 1),
  freeResets: 1,
});

const exact = (raw, keys) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  try {
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return false;
    const own = Reflect.ownKeys(raw);
    return own.length === keys.length && keys.every((key) => {
      const d = Object.getOwnPropertyDescriptor(raw, key);
      return d?.enumerable && Object.hasOwn(d, 'value');
    });
  } catch { return false; }
};

/** A valid v1 attribute state, or null for malformed, accessor-bearing, or future data. */
export function readAttr(raw) {
  if (!exact(raw, ['v', 'carga', 're'])) return null;
  try {
    if (raw.v !== ATTR.version || !Number.isSafeInteger(raw.carga) || raw.carga < 0 || raw.carga > ATTR.maxPoints ||
        !Number.isSafeInteger(raw.re) || raw.re < 0 || raw.re > ATTR.freeResets) return null;
    return { v: ATTR.version, carga: raw.carga, re: raw.re };
  } catch { return null; }
}

/** Read an own optional attr field without invoking accessors. Inherited fields are corrupt. */
export function readAttrField(profile) {
  try {
    if (!profile || typeof profile !== 'object') return { present: false, value: null };
    let owner = profile;
    while (owner && !Object.hasOwn(owner, 'attr')) owner = Object.getPrototypeOf(owner);
    if (!owner) return { present: false, value: null };
    if (owner !== profile) return { present: true, value: null };
    const d = Object.getOwnPropertyDescriptor(profile, 'attr');
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return { present: true, value: null };
    return { present: true, value: readAttr(d.value) };
  } catch { return { present: true, value: null }; }
}

export const pointsEarned = (level) => Number.isSafeInteger(level) && level >= 1 && level <= tuning.stats.maxLevel
  ? level - 1 : 0;

/**
 * Point totals for a valid profile field and level. Callers that accept serialized state must validate first.
 */
export function attrPoints(profile, level = profile?.lvl) {
  const field = readAttrField(profile), attr = field.value || { v: ATTR.version, carga: 0, re: 0 };
  const earned = pointsEarned(level);
  return { attr, earned, invested: attr.carga, available: Math.max(0, earned - attr.carga),
    resetsLeft: Math.max(0, ATTR.freeResets - attr.re) };
}
