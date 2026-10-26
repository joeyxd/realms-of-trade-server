// P1b (MN_MELEE): the sabre combo on Marth's frames (docs/research/melee/06 C1; one Melee frame is one sim tick).
// Frame f of a blow runs on its f-th command. The hitbox is out on start..end. A press made during the blow (Melee's
// link gate) links the next one on frame `link`: jab 1 into jab 2 on 20, Melee's earliest continuable point; jab 2
// into the forward tilt on its first actable frame, as Melee takes a tilt at IASA. From `iasa` the stick, the guard,
// a skill, a dash or a jump may end it; after `total` it is over. Arc, reach, damage and the forward step stay ours.
import { tuning, DT } from './tuning.js';
import { MELEE_SMASH } from './lawless.js';

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

export const swingStages = (melee) => melee === 1 ? MELEE_STAGES : tuning.melee.stages;
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
export const swingKey = (stage, smash = 0) => stage === 3 && smash ? 'melee3s' : `melee${stage}`;
// A hit retains its move and charge even if the attacker has since changed state.
export function swingBlow(melee, stage, smash = 0, charge = 0) {
  if (melee !== 1 || stage !== 3 || !smash) return swingStages(melee)[stage - 1];
  const st = MELEE_SMASH_STAGE, n = Math.max(0, Math.min(MELEE_SMASH.cap, charge));
  return { ...st, mult: st.mult * (1 + (MELEE_SMASH.maxMul - 1) * n / MELEE_SMASH.cap),
    windup: st.windup + n * DT, charge: n };
}
export const swingDescriptor = (melee, ecs, e) => swingBlow(melee, ecs.atkStage[e], ecs.atkSmash[e], ecs.chgN[e]);
