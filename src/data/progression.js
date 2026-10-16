// Shared tuning for the opt-in M5 logging pilot and its pure progression plans.
// Practice is independent of general XP, weapon mastery, tattoos, equipment and language.
import { RESOURCE_KINDS } from './resources.js';

export const PROGRESSION_VERSION = 1;
// Keep v1 profiles byte-compatible until this first pilot milestone is actually learned.
export const PILOTING = Object.freeze({
  version: 2,
  milestone: 'pilot_coastal',
  rudderMultiplier: 1.15,
});
export const LOGGING = Object.freeze({
  practicePerPalm: 10,
  firstMilestoneAt: 60,
  milestone: 'logging_steady',
  baseActionTicks: RESOURCE_KINDS.palm.actionTicks,
  learnedActionTicks: 45,
  maxPractice: 1_000_000_000,
});

// Eligibility is not a grant: the artisan transaction must teach this separately in PRG01c.
export const LOGGING_LESSON = Object.freeze({ id: 'raft_storage', part: 'storage' });
