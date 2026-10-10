// PRG01a tuning for the first logging pilot; not mounted by the resource handler yet.
// Practice is independent of general XP, weapon mastery, tattoos, equipment and language.
import { RESOURCE_KINDS } from './resources.js';

export const PROGRESSION_VERSION = 1;
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
