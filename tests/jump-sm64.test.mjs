// PT06: the Super Mario 64 jump on a flat floor (lab mode unless stated). Heights are above the takeoff floor; the
// reference numbers are Mario's (mu = 0.01125 u, 1 mu/f = 0.3375 u/s) from context/pt06-sm64-jump-spec.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arena, map } from './helpers.mjs';
import { BTN } from '../src/sim/systems/movement.js';

const J = BTN.JUMP, FLOOR = 5;
const flat = { ...map, groundAt: () => FLOOR, queryColliders: () => [], onDock: () => false };
const lab = (o = {}) => arena({ jump: 'lab', map: flat, x: 0, z: 0, ...o });
const air = (a) => a.w.ecs.jmpAct[a.e] >= 1 && a.w.ecs.jmpAct[a.e] <= 4;
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got} vs ${want} +-${tol}`);

const runUp = (a, n = 40) => { for (let i = 0; i < n; i++) a.step({ mx: 1 }); };
// Land (idle, the same stick) and return the apex above the floor reached on the way.
function glide(a, { held = true, mx = 0, mz = 0, cap = 600 } = {}) {
  let apex = a.w.ecs.y[a.e] - FLOOR, n = 0;
  while (air(a) && n++ < cap) { a.step({ btn: held ? J : 0, mx, mz }); apex = Math.max(apex, a.w.ecs.y[a.e] - FLOOR); }
  return { apex, ticks: n };
}
// Press jump now; true if the body took off.
function jumpNow(a, { held = true, mx = 0, mz = 0 } = {}) {
  a.step({ prs: J, btn: held ? J : 0, mx, mz });
  return air(a);
}
// `wait` idle steps, then the press; the kind of jump it gave (1 single, 2 double, 3 triple, 0 none). Frames close on the
// second tick, so the takeoff may come a tick after the press.
function press(a, wait = 0, { mx = 0, held = true } = {}) {
  for (let i = 0; i < wait; i++) a.step({ mx });
  a.step({ prs: J, btn: held ? J : 0, mx });
  for (let i = 0; i < 3 && !air(a); i++) a.step({ btn: held ? J : 0, mx });
  return air(a) ? a.w.ecs.jmpAct[a.e] : 0;
}
// A full single jump from the spot, stick as given; leaves the body landed (the landing step is "now").
function single(a, o = {}) { assert.ok(jumpNow(a, o), 'took off'); return glide(a, o); }
// Put a mover into a landing action by hand (the speeds of the chain are then exact).
function inLanding(a, act, fwd) {
  const ecs = a.w.ecs, e = a.e;
  ecs.jmpAct[e] = act; ecs.jmpLT[e] = 0; ecs.jmpPh[e] = 0; ecs.jmpA[e] = 0; ecs.jmpFwd[e] = fwd; ecs.vx[e] = fwd; ecs.vz[e] = 0;
}

test('single jump from standing: apex 2.7225 u, about 44 ticks in the air', () => {
  const a = lab();
  assert.ok(jumpNow(a));
  const r = glide(a);
  near(r.apex, 2.7225, 0.02, 'apex');
  near(r.ticks + 1, 44, 2, 'air ticks');
  assert.ok(a.w.ecs.jmpAct[a.e] >= 5, 'landed');
});

test('single jump at the lab run speed 10.8 u/s: apex 3.8025 u; in game mode at 6.5 u/s: 3.350 u', () => {
  const a = lab();
  runUp(a);
  near(Math.hypot(a.w.ecs.vx[a.e], a.w.ecs.vz[a.e]), 10.8, 1e-6, 'lab run speed');
  assert.ok(jumpNow(a, { mx: 1 }));
  near(glide(a, { mx: 1 }).apex, 3.8025, 0.03, 'lab apex');
  const g = arena({ jump: 'game', map: flat, x: 0, z: 0 });
  runUp(g);
  near(Math.hypot(g.w.ecs.vx[g.e], g.w.ecs.vz[g.e]), 6.5, 1e-6, 'game run speed');
  assert.ok(jumpNow(g, { mx: 1 }));
  near(glide(g, { mx: 1 }).apex, 3.350, 0.03, 'game apex');
});

test('A released on the first frame quarters the climb: apex 0.692 u', () => {
  const a = lab();
  assert.ok(jumpNow(a, { held: false }));
  near(glide(a, { held: false }).apex, 0.692, 0.02, 'apex');
});

test('double jump: apex 4.095 u from standing, 5.40 u at 10.8 u/s; triple 7.0875 u even with A released at once', () => {
  const a = lab();
  single(a);
  assert.equal(press(a), 2);
  near(glide(a).apex, 4.095, 0.02, 'double from standing');
  const b = lab();
  inLanding(b, 5, 10.8); // JUMP_LAND at the cap speed
  assert.equal(press(b), 2);
  near(glide(b, { mx: 1 }).apex, 5.40, 0.03, 'double at 10.8');
  const c = lab();
  inLanding(c, 6, 10); // DOUBLE_JUMP_LAND, fast enough
  assert.equal(press(c, 0, { held: false }), 3);
  near(glide(c, { held: false }).apex, 7.0875, 0.02, 'triple, A released');
});

test('stick neutral: A within 16 ticks of the landing gives a double, from 18 on a single', () => {
  for (const [k, want] of [[1, 2], [8, 2], [16, 2], [18, 1], [24, 1], [40, 1]]) {
    const a = lab();
    single(a);
    assert.equal(press(a, k - 1), want, `A ${k} ticks after landing`);
  }
});

test('stick held: within 8 ticks a double, later a single (the walk loses the chain)', () => {
  for (const [k, want] of [[1, 2], [4, 2], [8, 2], [10, 1], [14, 1], [30, 1]]) {
    const a = lab();
    single(a, { mx: 1 });
    assert.equal(press(a, k - 1, { mx: 1 }), want, `A ${k} ticks after landing`);
  }
});

test('triple needs forward speed above 6.75 u/s at the double landing, else a single', () => {
  for (const [fwd, want] of [[6, 1], [6.7, 1], [6.8, 3], [10, 3]]) {
    const a = lab();
    inLanding(a, 6, fwd);
    assert.equal(press(a, 0, { mx: 1 }), want, `fwd ${fwd}`);
  }
  // The real chain: running, the stick held in the air keeps the speed up.
  const a = lab();
  runUp(a);
  single(a, { mx: 1 });
  assert.equal(press(a, 0, { mx: 1 }), 2);
  glide(a, { mx: 1 });
  assert.equal(press(a, 0, { mx: 1 }), 3);
  // Stick neutral all the way: the double lands at a standstill, no triple.
  const b = lab();
  single(b);
  assert.equal(press(b), 2);
  glide(b);
  assert.equal(press(b), 1);
});

test('A during the triple landing frames is ignored, then a single', () => {
  const a = lab();
  inLanding(a, 7, 9); // TRIPLE_JUMP_LAND
  a.step({ prs: J, btn: J });
  for (let i = 0; i < 3; i++) a.step({ btn: J });
  assert.ok(!air(a), 'the press during the four landing frames did nothing');
  for (let i = 0; i < 12; i++) a.step({});
  assert.equal(press(a), 1, 'afterwards a single (timer 0 after a triple)');
});

test('FREEFALL_LAND: A in its first frames gives a double', () => {
  const a = lab();
  const ecs = a.w.ecs, e = a.e;
  ecs.y[e] = FLOOR + 3; ecs.jmpAct[e] = 4; ecs.jmpPeak[e] = FLOOR + 3;
  glide(a);
  assert.equal(ecs.jmpAct[e], 8, 'FREEFALL_LAND');
  assert.equal(press(a, 3), 2);
});

test('the facing is fixed in the air; a sideways stick drifts at most 3.375 u/s', () => {
  const a = lab();
  const ecs = a.w.ecs, e = a.e, f0 = ecs.facing[e];
  assert.ok(jumpNow(a, { mz: 1 }));
  let side = 0;
  for (let i = 0; i < 30; i++) {
    a.step({ btn: J, mz: 1 });
    assert.equal(ecs.facing[e], f0, 'facing unchanged');
    side = Math.max(side, Math.abs(ecs.vz[e]));
  }
  near(side, 3.375, 1e-6, 'sideways speed');
});

test('air forward speed climbs to the 10.8 u/s cap and stays within 0.34 u/s of it for the first frames', () => {
  const a = lab();
  runUp(a);
  assert.ok(jumpNow(a, { mx: 1 }));
  near(Math.hypot(a.w.ecs.vx[a.e], a.w.ecs.vz[a.e]), (32 * 0.8 - 0.35 + 1.5) * 0.3375, 1e-6, 'frame 1: 0.8 * 32, drag, stick');
  let top = 0;
  for (let i = 0; i < 20; i++) { a.step({ btn: J, mx: 1 }); top = Math.max(top, Math.hypot(a.w.ecs.vx[a.e], a.w.ecs.vz[a.e])); }
  assert.ok(top <= 10.8 + 0.34 + 1e-9 && top > 10.5, `top ${top}`); // SM64 air speed creeps +0.15 mu/f a frame past 32 (airborne.c:234)
});

test('terminal fall speed is -25.3125 u/s (-75 mu/f)', () => {
  const a = lab();
  const ecs = a.w.ecs, e = a.e;
  ecs.y[e] = FLOOR + 60; ecs.jmpAct[e] = 4; ecs.jmpPeak[e] = FLOOR + 60;
  let min = 0;
  while (air(a)) { a.step({}); min = Math.min(min, ecs.jmpVy[e]); }
  near(min, -25.3125, 1e-9, 'terminal');
});
