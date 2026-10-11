import { CARRY, LOAD, carryLimits, comfortMass, loadTier, nextBackpack, readCarry, readCarryField } from '../../data/carry.js';
import { readAttrField } from '../../data/attributes.js';
import { holdMass } from './cargo.js';

export { CARRY, LOAD, carryLimits, comfortMass, loadTier, nextBackpack, readCarry, readCarryField };

export function packLimitsForProfile(profile, carryOverride) {
  try {
    const level = Object.getOwnPropertyDescriptor(profile, 'lvl');
    if (!level?.enumerable || !Object.hasOwn(level, 'value') || !Number.isSafeInteger(level.value)) return null;
    const carryField = readCarryField(profile), carry = arguments.length > 1 ? carryOverride : carryField.value;
    const limits = carryLimits(carry, level.value);
    if (!limits) return null;
    const attr = readAttrField(profile);
    if (attr.present && (!attr.value || attr.value.carga > level.value - 1)) return null;
    return { volume: limits.volume, maxMass: attr.present ? 50 + 5 * attr.value.carga : limits.maxMass };
  } catch { return null; }
}

/** The comfortable load of a profile's pack (bonus: a timed meal's extra comfort); null without a weight limit. */
export function packComfort(profile, bonus = 0) {
  const pack = profile?.eco?.pack;
  if (!pack || !Number.isFinite(pack.maxMass)) return null;
  return comfortMass(pack.maxMass, readAttrField(profile).value !== null, bonus);
}

/** The load tier of a profile's pack (data/carry.js loadTier): 0 without a weight limit. */
export function packLoadTier(profile, bonus = 0) {
  const comfort = packComfort(profile, bonus);
  return comfort === null ? 0 : loadTier(holdMass(profile.eco.pack), profile.eco.pack.maxMass, comfort);
}
