import { NAVAL_STEP } from '../../src/data/navalHandling.js';

// Bound catch-up after a stalled tab. Within the budget, different render schedules execute
// the same integer tick stream. Time beyond 250ms is discarded, never converted to a giant step.
export class NavalLabClock {
  constructor() { this.acc = 0; this.dropped = 0; }
  clear() { this.acc = 0; }
  advance(seconds, fixed) {
    if (!Number.isFinite(seconds) || seconds < 0) return 0;
    this.dropped += Math.max(0, seconds - 0.25);
    this.acc += Math.min(0.25, seconds);
    let count = 0;
    while (this.acc + 1e-10 >= NAVAL_STEP && count < 15) {
      this.acc = Math.max(0, this.acc - NAVAL_STEP); fixed(); count++;
    }
    return count;
  }
  get alpha() { return Math.min(1, this.acc / NAVAL_STEP); }
}
