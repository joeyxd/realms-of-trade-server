// Playtest R1 PT08: after sword swings the body runs at full speed again in the recovery, the stick cancels the
// recovery, and the pistol slow ends with the trigger instead of with the cooldown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuning, DT } from '../src/data/tuning.js';
import { SKILLS, WEAPON } from '../src/data/weapons.js';
import { BTN } from '../src/sim/systems/movement.js';
import { arena } from './helpers.mjs';

const M = tuning.melee, RUN = tuning.player.runSpeed, FULL = 0.98 * RUN, P = SKILLS.pistol;
const win = (s) => M.stages[s - 1].windup + M.stages[s - 1].active; // committed time of a stage

// Runs the stick at full speed for a moment so the swings start from a run.
function warm(step, mx) {
  for (let i = 0; i < 20; i++) step({ mx });
}

// One command per tick: cmdFor(i, ecs, e) -> cmd overrides. Returns a record per tick (state after the step).
function trace(world, step, n, cmdFor) {
  const { w, e } = world, ecs = w.ecs, out = [];
  for (let i = 0; i < n; i++) {
    const x = ecs.x[e], z = ecs.z[e];
    step(cmdFor(i, ecs, e));
    out.push({
      i, stage: ecs.atkStage[e], last: ecs.lastStage[e], t: ecs.atkT[e], mul: ecs.moveMul[e], id: ecs.swingId[e],
      shotCd: ecs.shotCd[e], shotAltCd: ecs.shotAltCd[e], speed: Math.hypot(ecs.x[e] - x, ecs.z[e] - z) / DT,
    });
  }
  return out;
}

// Seconds from the end of a stage's active frames (`a1`, counted from the swing start) until the speed first
// reaches 98% of runSpeed. Record `s` is the swing's first tick and `tS` its atkT; the tick that crosses `a1` is
// skipped (it still carries the tail of the lunge), so the search starts on the tick after it.
function runBack(recs, s, tS, a1) {
  for (let k = s; k < recs.length; k++) {
    const prev = tS + (k - 1 - s) * DT;
    if (prev >= a1 - 1e-9 && recs[k].speed >= FULL) return tS + (k - s) * DT - a1;
  }
  return Infinity;
}

// Full 3-hit combo as a player would press it: LMB once to start, then once in each stage's active frames.
function comboDriver(mx) {
  const pressed = new Set();
  return (i, ecs, e) => {
    const c = { mx };
    const s = ecs.atkStage[e];
    if (i === 0) c.prs = BTN.ATTACK;
    else if (s > 0 && s < 3 && ecs.atkT[e] >= M.stages[s - 1].windup && !pressed.has(ecs.swingId[e])) {
      pressed.add(ecs.swingId[e]); c.prs = BTN.ATTACK;
    }
    return c;
  };
}

test('stage 1 with the stick held: slowed through windup + active, full run within 0.15 s after the last active frame', (t) => {
  const world = arena(), { w, e, step } = world;
  warm(step, 1);
  const a1 = win(1);
  const recs = trace(world, step, 40, (i) => (i === 0 ? { mx: 1, prs: BTN.ATTACK } : { mx: 1 }));
  let inside = 0;
  for (const r of recs) if (r.stage > 0 && r.t < a1) { assert.equal(r.mul, M.stages[0].move, `tick ${r.i}`); inside++; }
  assert.ok(inside >= 9, `${inside} committed ticks`);
  const k = recs.findIndex((r) => r.stage === 0);
  assert.ok(k > 0 && (k + 1) * DT < a1 + M.stages[0].recover, 'the stick cancelled the recovery');
  const after = runBack(recs, 0, recs[0].t, a1);
  t.diagnostic(`a) stage 1: ${(after * 1000).toFixed(0)} ms from the last active frame to ${FULL.toFixed(2)} u/s`);
  assert.ok(after <= 0.15, `${after} s`);
  assert.ok(w.ecs.speed[e] >= RUN - 1e-9);
});

test('after the stage-3 active frames of a full combo the body is back to full speed within 0.15 s', (t) => {
  const world = arena(), { step } = world;
  warm(step, 1);
  const recs = trace(world, step, 60, comboDriver(1));
  const s3 = recs.findIndex((r) => r.stage === 3);
  assert.ok(s3 > 0, 'reached stage 3');
  assert.deepEqual([...new Set(recs.filter((r) => r.stage > 0).map((r) => r.stage))], [1, 2, 3]);
  const back = runBack(recs, s3, recs[s3].t, win(3));
  t.diagnostic(`b) stage 3: ${(back * 1000).toFixed(0)} ms from the last active frame to ${FULL.toFixed(2)} u/s`);
  assert.ok(back <= 0.15, `${back} s`);
});

test('stick released: the recovery still runs by time (atkStage > 0 until windup + active + recover)', () => {
  const world = arena(), { step } = world;
  const recs = trace(world, step, 40, (i) => (i === 0 ? { prs: BTN.ATTACK } : {}));
  const end = win(1) + M.stages[0].recover;
  for (const r of recs) {
    const t = (r.i + 1) * DT;
    if (t < end - 1e-9) assert.ok(r.stage === 1, `tick ${r.i} still swinging`);
    else assert.equal(r.stage, 0, `tick ${r.i} over`);
  }
  assert.equal(recs.find((r) => r.stage === 0).last, 1);
});

test('a buffered press during the active frames still chains while the stick is held (buffer beats cancel)', () => {
  const world = arena(), { step } = world;
  warm(step, 1);
  const recs = trace(world, step, 30, (i) => (i === 0 ? { mx: 1, prs: BTN.ATTACK } : i === 8 ? { mx: 1, prs: BTN.ATTACK } : { mx: 1 }));
  const k = recs.findIndex((r) => r.stage === 2);
  assert.ok(k >= 8 && k <= 12, `stage 2 started at tick ${k}`);
  assert.ok(recs.slice(0, k).every((r) => r.stage === 1), 'no gap between the stages');
  assert.equal(recs[k].mul, M.stages[1].move);
});

test('after a stick cancel of stage 1, a press within comboGap starts stage 2', () => {
  const world = arena(), { step } = world;
  warm(step, 1);
  const recs = trace(world, step, 30, (i) => (i === 0 ? { mx: 1, prs: BTN.ATTACK } : i === 16 ? { mx: 1, prs: BTN.ATTACK } : { mx: 1 }));
  const k = recs.findIndex((r) => r.stage === 0);
  assert.ok(k > 0 && k < 16, `cancelled at tick ${k}`);
  assert.equal(recs[k].last, 1);
  assert.ok((16 - k) * DT <= M.comboGap, 'inside comboGap');
  assert.equal(recs[16].stage, 2, 'the press continues the combo');
});

test('after a stick cancel of stage 3 a press within comboGap restarts at stage 1', () => {
  const world = arena(), { step } = world;
  warm(step, 1);
  const drive = comboDriver(1);
  let pressedAgain = -1;
  const recs = trace(world, step, 60, (i, ecs, e) => {
    const c = drive(i, ecs, e);
    if (pressedAgain < 0 && ecs.atkStage[e] === 0 && ecs.lastStage[e] === 3) { pressedAgain = i; c.prs = BTN.ATTACK; }
    return c;
  });
  assert.ok(pressedAgain > 0, 'stage 3 ended');
  assert.equal(recs[pressedAgain].stage, 1);
});

test('stage 3 slows to 0.3 in its windup and active frames', () => {
  const world = arena(), { step } = world;
  warm(step, 1);
  const recs = trace(world, step, 60, comboDriver(1));
  const inside = recs.filter((r) => r.stage === 3 && r.t < win(3));
  assert.ok(inside.length >= 12, `${inside.length} committed ticks`);
  for (const r of inside) assert.equal(r.mul, 0.3, `tick ${r.i}`);
  assert.equal(M.stages[2].move, 0.3);
});

for (const [name, btn, cd] of [['left gun (ATTACK, 0.2 s)', BTN.ATTACK, 'shotCd'], ['right gun (GUARD, 0.6 s)', BTN.GUARD, 'shotAltCd']]) {
  test(`pistolas ${name}: slowed while the trigger is held, full speed the tick after release though the cooldown runs`, (t) => {
    const world = arena({ weapon: WEAPON.PISTOLAS }), { step } = world;
    warm(step, 1);
    const HOLD = 8;
    const recs = trace(world, step, 30, (i) => (i < HOLD ? { mx: 1, btn, prs: i === 0 ? btn : 0 } : { mx: 1 }));
    for (const r of recs.slice(0, HOLD)) { assert.ok(r[cd === 'shotCd' ? 'shotCd' : 'shotAltCd'] > 0); assert.equal(r.mul, P.move, `tick ${r.i} held`); }
    const rel = recs[HOLD];
    assert.ok(rel[cd] > 0, 'the cooldown is still running');
    assert.equal(rel.mul, 1, 'full speed on the first tick after release');
    let back = Infinity;
    for (let k = HOLD; k < recs.length; k++) if (recs[k].speed >= FULL) { back = (k - HOLD + 1) * DT; break; }
    t.diagnostic(`g) ${name}: ${(back * 1000).toFixed(0)} ms from the release to ${FULL.toFixed(2)} u/s`);
    assert.ok(back <= 0.15, `${back} s`);
  });
}
