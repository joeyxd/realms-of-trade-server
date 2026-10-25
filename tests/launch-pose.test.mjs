import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slid, startLaunch, stepLaunch } from '../src/render/launchPose.js';
import { launchSpeed, launchDecay, launchFrames } from '../src/sim/meleeHit.js';
import { LAWLESS, MELEE_GUARD } from '../src/data/lawless.js';

const DT = 1 / 60;
// Where the sim has slid a body i ticks after its hitlag (the movement.js / enemies.js step: move, then decay).
function simPath(kb, ticks) {
  const out = [0];
  let x = 0, v = launchSpeed(kb, LAWLESS.meleeUnit);
  for (let i = 0; i < ticks; i++) { x += v * DT; v = Math.max(0, v - launchDecay(LAWLESS.meleeUnit)); out.push(x); }
  return out;
}

test('slid matches the sim launch on whole frames and stops after launchFrames', () => {
  for (const kb of [30, 47.5, 90]) {
    const path = simPath(kb, 80), n = launchFrames(kb);
    for (let i = 0; i <= 80; i++) assert.ok(Math.abs(LAWLESS.meleeUnit * slid(kb, i) - path[i]) < 1e-9, `kb ${kb} frame ${i}`);
    assert.equal(slid(kb, n + 10), slid(kb, n));
  }
});

test('a body drawn 6 frames late flies on time with the led offset, and the offset returns to zero', () => {
  const kb = 60, hl = 7, lead = 6, path = simPath(kb, 120), L = startLaunch({ kb, hl, la: 0 }, lead / 60), o = {};
  let frame = 0, last = null;
  for (;;) {
    const r = stepLaunch(L, DT, o);
    if (!r) break;
    frame++; last = r;
    const f = frame - hl;
    if (f <= 0) { assert.equal(r.lift, 0); assert.ok(Math.abs(r.ox) <= 0.06 && r.oz === 0); continue; }
    const drawn = path[Math.max(0, f - lead)]; // what interpolation shows: the sim 6 frames ago
    assert.ok(Math.abs(drawn + r.ox - path[f]) < 1e-9, `frame ${f}`);
  }
  assert.ok(frame >= hl + launchFrames(kb) + lead); assert.ok(Math.abs(last.ox) < 1e-9); assert.ok(last.tilt < 0.01);
});

test('a tumble hops off the feet, lies on its back through the slide and stands up by the end', () => {
  const kb = 90, L = startLaunch({ kb, hl: 8, la: Math.PI / 2, kd: 1 }), o = {}, n = launchFrames(kb);
  let frame = 0, maxLift = 0, lying = 0, end = null;
  while (stepLaunch(L, DT, o)) {
    frame++; maxLift = Math.max(maxLift, o.lift);
    if (frame > 8 + n * 0.5 && frame < 8 + n) { assert.ok(o.tilt > 1.4); lying++; }
    assert.ok(Math.abs(o.dz - 1) < 1e-9);
    end = { ...o };
  }
  assert.ok(maxLift > 0.3); assert.ok(lying > 10); assert.ok(end.tilt < 0.01);
  assert.equal(frame, 8 + n + LAWLESS.meleeDown * 60 + 2);
  assert.equal(startLaunch({ kb: 0, hl: 3 }), null);
});

test('a shield break throws the body up 28 frames and down 32, lies 26, stands up over 50, then ends (led by the lead)', () => {
  const MG = MELEE_GUARD, h = MG.breakHeight * LAWLESS.meleeUnit, total = MG.breakFly + MG.breakDown + MG.breakStand;
  const ev = { type: 'guard', st: 'break', hl: 0, fly: MG.breakFly, down: MG.breakDown, stand: MG.breakStand, h, brk: 1, la: Math.PI / 2 };
  const run = (lead, hl = 0) => {
    const L = startLaunch({ ...ev, hl }, lead / 60), o = {}, rows = [];
    while (stepLaunch(L, DT, o)) rows.push({ ...o });
    return rows;
  };
  const rows = run(0), at = (f) => rows[f - 1]; // frame f: f ticks in
  assert.equal(rows.length, total);
  let peak = 0, peakAt = 0;
  rows.forEach((r, i) => { if (r.lift > peak) { peak = r.lift; peakAt = i + 1; } assert.equal(r.ox, 0); assert.equal(r.oz, 0); assert.ok(Math.abs(r.dz - 1) < 1e-9); });
  assert.ok(Math.abs(peak - h) < 0.01 && Math.abs(peakAt - 28) <= 1, `peak ${peak} at ${peakAt}`);
  assert.ok(at(10).lift > 0 && at(50).lift < at(40).lift && at(40).lift < at(30).lift && at(10).lift < at(20).lift && at(60).lift < 0.13, 'a parabola, down on the floor by 60');
  assert.ok(at(MG.breakFly + 13).tilt > 1.4, 'on its back while it lies'); assert.ok(at(MG.breakFly + MG.breakDown).tilt > 1.4);
  assert.ok(at(MG.breakFly + MG.breakDown + 25).tilt < at(MG.breakFly + MG.breakDown).tilt && at(total).tilt < 0.01, 'stands up');
  assert.equal(run(6).length, total + 6); assert.equal(run(0, 5).length, total + 5);
  assert.equal(startLaunch({ ...ev, la: undefined }), null);
});
