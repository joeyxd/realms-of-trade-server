import { CARRY, carryLimits, nextBackpack, readCarry, readCarryField } from '../../data/carry.js';
import { readAttrField } from '../../data/attributes.js';

export { CARRY, carryLimits, nextBackpack, readCarry, readCarryField };

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
