import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MELEE_STAGES, swingStages, swingFrame } from '../src/data/meleeFrames.js';
import { DT, tuning } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';
import { World } from '../src/sim/world.js';
import { BTN } from '../src/sim/systems/movement.js';
import { calaDuel } from './cala-duel.mjs';
import { map } from './helpers.mjs';

const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const command = (w, e, extra = {}) => ({ seq: w.ecs.lastSeq[e] + 1, mx: 0, mz: 0,
  ax: w.ecs.x[e] + 10, az: w.ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...extra });
function duel(version = 1) {
  const S = calaDuel();
  S.w.meleeVersion = version; S.w.rng = Object.assign(() => 1, S.w.rng);
  return S;
}
// Run n commands for pirate a (input(f) gives command f's extra fields). With `hits` off the swing's server hit test
// only logs [frame, stage]. Returns that log and, per command, the stage, dash and guard after it.
function run(S, n, input, { hits = false, pred = null } = {}) {
  const { w, ecs, a } = S, log = [], rows = [null];
  let f = 0;
  if (!hits) w.meleeHits = (e) => { log.push([f, ecs.atkStage[e]]); };
  let pe = 0;
  if (pred) { pe = pred.spawnPlayer({}); pred.setPlayerState(pe, w.playerState(a)); }
  for (f = 1; f <= n; f++) {
    const cmd = command(w, a, input(f) || {});
    w.applyCommand(a, cmd);
    if (pred) { pred.applyCommand(pe, cmd); assert.deepEqual(pred.playerState(pe), w.playerState(a), `prediction at ${f}`); }
    rows.push({ stage: ecs.atkStage[a], dash: ecs.dashT[a] >= 0, guard: ecs.guardT[a] >= 0, hitlag: ecs.hitlag[a] });
  }
  return { log, rows };
}
const span = (from, to, stage) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, stage]);

test('Marth frame descriptors convert to seconds for the readers; the flag off keeps ours', () => {
  assert.equal(swingStages(0), tuning.melee.stages); assert.equal(swingStages(1), MELEE_STAGES);
  near(MELEE_STAGES[0].windup, 3 * DT); near(MELEE_STAGES[0].active, 4 * DT); near(MELEE_STAGES[0].recover, 20 * DT);
  near(MELEE_STAGES[2].windup, 6 * DT); near(MELEE_STAGES[2].active, 4 * DT); near(MELEE_STAGES[2].recover, 25 * DT);
  for (const [i, st] of MELEE_STAGES.entries()) {
    assert.equal(st.move, 0); assert.equal(st.range, tuning.melee.stages[i].range); assert.equal(st.mult, tuning.melee.stages[i].mult);
  }
  assert.equal(swingFrame(19 * DT), 19);
});

test('jab 1 hits on frames 4-7 and, with no second press, ends after frame 27', () => {
  const { log, rows } = run(duel(), 30, (f) => f === 1 && { prs: BTN.ATTACK });
  assert.deepEqual(log, span(4, 7, 1));
  assert.equal(rows[26].stage, 1); assert.equal(rows[27].stage, 0);
});

test('a gated press links jab 2 on frame 20 and the forward tilt on jab 2 frame 25; prediction agrees', () => {
  const S = duel(), pred = new World(GAME.seed, { map, server: false });
  pred.meleeVersion = 1;
  S.w.events.length = 0;
  const { log, rows } = run(S, 80, (f) => [1, 10, 30].includes(f) && { prs: BTN.ATTACK }, { pred });
  // Jab 2 runs its frame 1 on jab 1's frame 20 (SmashWiki's quickest jab: jab 2 hits on 24-28); the tilt starts on 44.
  assert.deepEqual(log, [...span(4, 7, 1), ...span(24, 28, 2), ...span(50, 53, 3)]);
  assert.equal(rows[19].stage, 1); assert.equal(rows[20].stage, 2); assert.equal(rows[43].stage, 2); assert.equal(rows[44].stage, 3);
  assert.equal(rows[77].stage, 3); assert.equal(rows[78].stage, 0);
  assert.deepEqual(S.w.events.filter((ev) => ev.type === 'swing').map((ev) => ev.stage), [1, 2, 3]);
});

test('before its first actable frame a jab holds the dash and the guard; the flag off lets the dash cut it', () => {
  const dash = run(duel(), 30, (f) => f === 1 ? { prs: BTN.ATTACK } : { mx: 1, prs: BTN.DASH }).rows;
  assert.equal(dash.findIndex((r) => r && r.dash), 26); assert.equal(dash[26].stage, 0);
  const guard = run(duel(), 30, (f) => f === 1 ? { prs: BTN.ATTACK } : { btn: BTN.GUARD }).rows;
  assert.equal(guard.findIndex((r) => r && r.guard), 26); assert.equal(guard[26].stage, 0);
  const old = run(duel(0), 10, (f) => f === 1 ? { prs: BTN.ATTACK } : { prs: BTN.DASH }).rows;
  assert.equal(old.findIndex((r) => r && r.dash), 2);
});

// T-1025-46: the jab lands before open=10; a press in that hitlag now rejects the string (rule 2).
test('an early press during attacker hitlag rejects the next link', () => {
  const S = duel(), { w, ecs, a } = S;
  ecs.facing[a] = Math.PI / 2;
  w.events.length = 0;
  let hl = 0;
  const { rows } = run(S, 60, (f) => {
    if (f === 1) return { prs: BTN.ATTACK };
    if (!hl && ecs.hitlag[a] > 0) { hl = ecs.hitlag[a]; return { prs: BTN.ATTACK }; }
    return {};
  }, { hits: true });
  assert.ok(hl > 0, 'jab 1 lands');
  const ev = w.events.find((x) => x.type === 'duel');
  near(ev.tele, 0.05, 1e-3); near(ev.win, 4 * DT, 1e-3);
  assert.equal(rows[4].hitlag, hl); assert.equal(rows[19 + hl].stage, 1); assert.equal(rows[20 + hl].stage, 1);
  assert.equal(rows[27 + hl].stage, 0);
  assert.deepEqual(w.events.filter((x) => x.type === 'swing').map((x) => x.stage), [1]);
});
