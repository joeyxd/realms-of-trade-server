// Personal carry tuning. Volume is backpack space; mass is an independent limit.
// These are abstract game units, not real-world weights.
export const CARRY = Object.freeze({
  version: 1,
  baseVolume: 18,
  baseStrength: 10,
  strengthPerLevel: 1,
  massPerStrength: 2,
  backpacks: Object.freeze([18, 30, 42]),
  maxBackpack: 2,
});

export function readCarry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== 2 || !keys.includes('v') || !keys.includes('backpack')) return null;
    const v = Object.getOwnPropertyDescriptor(raw, 'v');
    const backpack = Object.getOwnPropertyDescriptor(raw, 'backpack');
    if (!v?.enumerable || !Object.hasOwn(v, 'value') || v.value !== CARRY.version ||
        !backpack?.enumerable || !Object.hasOwn(backpack, 'value') ||
        !Number.isInteger(backpack.value) || backpack.value < 0 || backpack.value > CARRY.maxBackpack) return null;
    return { v: CARRY.version, backpack: backpack.value };
  } catch { return null; }
}

export function readCarryField(profile) {
  try {
    if (!profile || typeof profile !== 'object') return { present: false, value: null };
    let owner = profile;
    while (owner && !Object.hasOwn(owner, 'carry')) owner = Object.getPrototypeOf(owner);
    if (!owner) return { present: false, value: null };
    if (owner !== profile) return { present: true, value: null };
    const descriptor = Object.getOwnPropertyDescriptor(profile, 'carry');
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return { present: true, value: null };
    return { present: true, value: readCarry(descriptor.value) };
  } catch { return { present: true, value: null }; }
}

export function carryLimits(carry, level = 1) {
  const state = readCarry(carry);
  if (!state) return null;
  const lvl = Number.isSafeInteger(level) ? Math.max(1, level) : 1;
  const strength = CARRY.baseStrength + (lvl - 1) * CARRY.strengthPerLevel;
  return Object.freeze({
    volume: CARRY.backpacks[state.backpack],
    strength,
    maxMass: CARRY.baseVolume + (strength - CARRY.baseStrength) * CARRY.massPerStrength,
  });
}

// Overload (PLAN-PROGRESSION §15.7.4, author decisions 2026-10-10). With Carga adopted the saved maxMass is 125 % of the
// comfortable load (40 + 4 per point → 50 + 5 per point, attributePlan). Above the comfortable load the pirate walks at
// 70 % without dash; a pack found above its ceiling keeps its goods and walks at 40 %. A pack without Carga keeps its
// level ceiling as a plain limit, with no slow zone. The ceiling is still where taking more goods stops.
export const LOAD = Object.freeze({
  ceiling: 1.25,
  speed: Object.freeze([1, 0.7, 0.4]), // walking speed × per load tier; tiers 1 and 2 also forbid the dash
});

/** The comfortable load under a ceiling: maxMass / 1.25 with Carga adopted (plus a timed meal's bonus), else maxMass. */
export function comfortMass(maxMass, adopted, bonus = 0) {
  if (!Number.isFinite(maxMass)) return maxMass;
  return adopted ? maxMass / LOAD.ceiling + (bonus > 0 ? bonus : 0) : maxMass;
}

/** 0 comfortable, 1 heavy (slower, no dash), 2 above the ceiling (much slower). No limit: always 0. */
export function loadTier(mass, maxMass, comfort = maxMass) {
  if (!Number.isFinite(maxMass) || maxMass <= 0 || !Number.isFinite(mass)) return 0;
  return mass > maxMass + 1e-9 ? 2 : mass > comfort + 1e-9 ? 1 : 0;
}

// Pure progression helper; payment and persistence belong to the authoritative operation.
export function nextBackpack(carry) {
  const state = readCarry(carry);
  return state && state.backpack < CARRY.maxBackpack
    ? { v: CARRY.version, backpack: state.backpack + 1 }
    : null;
}
