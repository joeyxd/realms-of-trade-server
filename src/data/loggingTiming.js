// Deterministic three-hit timing rules for a future server-authoritative logging flow.
// `width` is the inclusive perfect radius around targetTick, in simulation ticks.
export const LOGGING_TIMING = Object.freeze({
  version: 1,
  hitsPerTree: 3,
  targetOffsetTicks: 45,
  endOffsetTicks: 90,
  earliestOffsetTicks: 6,
  ranks: Object.freeze([
    Object.freeze({ rank: 1, minimumPractice: 0, width: 5 }),
    Object.freeze({ rank: 2, minimumPractice: 60, width: 8 }),
    Object.freeze({ rank: 3, minimumPractice: 180, width: 11 }),
  ]),
  baseYield: 3,
  perfectYield: 1,
});

