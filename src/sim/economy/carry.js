import { CARRY, carryLimits, nextBackpack, readCarry, readCarryField } from '../../data/carry.js';

export { CARRY, carryLimits, nextBackpack, readCarry, readCarryField };

export function packLimitsForProfile(profile) {
  const limits = carryLimits(profile?.carry, profile?.lvl);
  return limits ? { volume: limits.volume, maxMass: limits.maxMass } : null;
}
