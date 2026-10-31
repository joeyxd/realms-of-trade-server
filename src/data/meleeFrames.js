// P1b (MN_MELEE): the sabre combo on Marth's frames (docs/research/melee/06 C1; one Melee frame is one sim tick).
// Frame f of a blow runs on its f-th command. The hitbox is out on start..end. A press made during the blow (Melee's
// link gate) links the next one on frame `link`: jab 1 into jab 2 on 20, Melee's earliest continuable point; jab 2
// into the forward tilt on its first actable frame, as Melee takes a tilt at IASA. From `iasa` the stick, the guard,
// a skill, a dash or a jump may end it; after `total` it is over. Arc, reach, damage and the forward step stay ours.
import { tuning, DT } from './tuning.js';
import { MELEE_SMASH } from './lawless.js';
import { WEAPON } from './weapons.js';

const FRAMES = [
  { start: 4, end: 7, link: 20, open: 10, close: 25, iasa: 26, total: 27 }, // jab 1; open: Ultimate game.cpp:17-19 combo flag; close: ours, IASA - 1
  { start: 5, end: 9, link: 25, open: 6, close: 24, iasa: 25, total: 28 }, // jab 2; open: ours, start + 1 (Ultimate game_attack12, game.cpp:23-34 has no combo flag); close: ours, IASA - 1
  { start: 7, end: 10, link: 0, open: 0, close: 0, iasa: 35, total: 35 }, // forward tilt (no IASA stated: the whole move); ours: no next link
];

// The same blows in seconds for the readers of tuning.melee.stages (the pose, the slash, telemetry). move 0: a Melee
// ground attack gives the stick no control until IASA; only the blow's own step moves the body.
export const MELEE_STAGES = tuning.melee.stages.map((st, i) => {
  const F = FRAMES[i];
  return { ...st, ...F, move: 0, windup: (F.start - 1) * DT, active: (F.end - F.start + 1) * DT, recover: (F.total - F.end) * DT };
});

// Puños (T-1030-12): Terry's jab 1-2-3 (Ultimate dolly game.cpp; docs/research/melee/10-terry.md, converted to ticks: jab 1 runs at
// motion rate 2 until script frame 5, so script 5 = tick 3). open 1: a press anywhere in the blow is kept and fires at `link`
// (Ultimate keeps an early jab press; ours: no poisoning for fists). close = iasa - 1 as the sabre. Jab 3 ends the chain.
// Reach, arc, damage and step are ours, from Terry's box positions x LAWLESS.meleeBody 0.12 u: `near` (jab 1, 2) is the first box's
// reach; a target farther than that takes the far box's knockback row (MELEE fistNf). mult: ours, the chain's damage per second near the
// sabre's, split by Terry's 3 : 2 : 7 (sabre 1.0 / 1.15 / 1.6).
const FIST_BLOWS = [
  { start: 3, end: 4, link: 5, open: 1, close: 13, iasa: 14, total: 14, near: 1.0, range: 1.6, arc: 70, mult: 0.7, lunge: 0.1 }, // jab 1: hit script 5-6, ENABLE_COMBO 7, cancel 16
  { start: 3, end: 7, link: 8, open: 1, close: 24, iasa: 25, total: 25, near: 1.7, range: 2.0, arc: 70, mult: 0.5, lunge: 0.15 }, // jab 2: ENABLE_COMBO 8, cancel 25
  { start: 7, end: 10, link: 0, open: 0, close: 0, iasa: 34, total: 34, near: 0, range: 1.75, arc: 90, mult: 1.6, lunge: 0.3 }, // jab 3: no near split, the chain ends
];
export const FIST_STAGES = FIST_BLOWS.map((F) => ({ ...F, fist: 1, move: 0,
  windup: (F.start - 1) * DT, active: (F.end - F.start + 1) * DT, recover: (F.total - F.end) * DT }));

// kit: the attacker's ecs.weapon. Under the old machine (melee 0) every kit swings the sabre's tuning.
export const swingStages = (melee, kit = 0) => melee !== 1 ? tuning.melee.stages : kit === WEAPON.PUNOS ? FIST_STAGES : MELEE_STAGES;
// The frame a swing's command ran, from its atkT after the step (atkT is f * DT).
export const swingFrame = (t) => Math.round(t / DT);
// Is the hitbox out on that frame? (frames under Melee, seconds otherwise)
export const swingOn = (st, t) => st.iasa ? swingFrame(t) >= st.start && swingFrame(t) <= st.end
  : t > st.windup && t - DT < st.windup + st.active;
// Does the swing still hold the stick, the guard and the skills on the next command? Its wind-up and active frames;
// under Melee every frame before its first actable one.
export const swingBusy = (st, t) => st.iasa ? swingFrame(t) + 1 < st.iasa : t < st.windup + st.active;

// P4: Marth forward smash (06 C1). Reach, arc, damage and step remain our stage 3's.
const SMASH_FRAMES = { start: 10, end: 13, link: 0, open: 0, close: 0, iasa: 48, total: 49, chargeOpen: 3, chargeClose: 4 }; // Melee, 06:154/157
export const MELEE_SMASH_STAGE = { ...MELEE_STAGES[2], ...SMASH_FRAMES, smash: 1,
  windup: 9 * DT, active: 4 * DT, recover: 36 * DT }; // Melee frames above, in seconds
// far: the target stood past the blow's `near` (fists only: jab 1 and 2 have a far row).
export const swingKey = (stage, smash = 0, kit = 0, far = 0) => kit === WEAPON.PUNOS ? `fist${stage}${far && stage < 3 ? 'f' : ''}`
  : stage === 3 && smash ? 'melee3s' : `melee${stage}`;
// A hit retains its move and charge even if the attacker has since changed state.
export function swingBlow(melee, stage, smash = 0, charge = 0, kit = 0) {
  if (melee !== 1 || stage !== 3 || !smash) return swingStages(melee, kit)[stage - 1];
  const st = MELEE_SMASH_STAGE, n = Math.max(0, Math.min(MELEE_SMASH.cap, charge));
  return { ...st, mult: st.mult * (1 + (MELEE_SMASH.maxMul - 1) * n / MELEE_SMASH.cap),
    windup: st.windup + n * DT, charge: n };
}
export const swingDescriptor = (melee, ecs, e) => swingBlow(melee, ecs.atkStage[e], ecs.atkSmash[e], ecs.chgN[e], ecs.weapon[e]);
