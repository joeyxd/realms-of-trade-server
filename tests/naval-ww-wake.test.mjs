import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWake, stepWake, setWakeRig, landing, landingCount } from '../src/render/naval/wake.js';
import { WW_UNIT, WW_ANGLE } from '../src/data/navalHandling.js';

// Numbers below are the ficha's CONSTANTES (research/wind-waker/05-vela-y-agua.md), not read back from the implementation.
const RIG = { length: 7.2, beam: 2.4 };
const near = (a, b, e = 0.01) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const ww = (fwd) => fwd * WW_UNIT * 30; // WW units per frame -> our units per second
const flat = () => 0;
// Whole WW frames at dt 1/30, heading +z (yaw 0), at speed v u/s.
function run(w, frames, v, extra = {}) {
  for (let i = 0; i < frames; i++) stepWake(w, { dt: 1 / 30, x: 0, z: 0, yaw: 0, vx: 0, vz: v, surfaceAt: flat, ...extra });
  return w;
}
const live = (w) => w.waves[0].n + w.waves[1].n;

test('wake.js and its data import no three', () => {
  for (const f of ['../src/render/naval/wake.js', '../src/data/navalWake.js', './naval-ww-wake.test.mjs']) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /from\s+['"]three['"]/);
  }
});

test('the track starts above 3 WW u a frame (1.15 u/s), in either direction', () => {
  const slow = run(createWake(RIG), 5, 1.1), fast = run(createWake(RIG), 5, 1.2), back = run(createWake(RIG), 5, -1.2);
  assert.equal(slow.track.n, 0); assert.equal(slow.track.alpha, 0);
  assert.equal(fast.track.n, 5); assert.equal(fast.track.alpha, 25);
  assert.equal(back.track.n, 5);
  assert.equal(live(fast), 0); // far under the wave band
});

test('the waves and the splash start above 11 WW u a frame (4.2 u/s)', () => {
  const under = run(createWake(RIG), 10, 4.1), over = run(createWake(RIG), 10, 4.3);
  assert.equal(live(under), 0); assert.equal(under.splash.scale, 0); assert.equal(under.splash.pending, 0);
  assert.ok(over.waves[0].n > 0 && over.waves[1].n > 0);
  assert.ok(over.splash.scale > 0.3 && over.splash.pending > 0);
});

test('stopping freezes the crest 20 frames (0.67 s), then clears it', () => {
  const w = run(createWake(RIG), 20, 12);
  const n = w.waves[1].n, snapshot = w.waves[1].x[3];
  assert.ok(n > 5);
  run(w, 19, 0);
  assert.equal(w.waves[1].n, n); assert.equal(w.waves[1].x[3], snapshot); assert.equal(w.waves[1].speed, 0);
  run(w, 1, 0);
  assert.equal(live(w), 0);
});

test('a direction flip stops everything, and in flight (40 WW u = 0.51 over the sea) nothing emits', () => {
  const w = run(createWake(RIG), 20, 12);
  run(w, 1, -12); // sign change this frame: the latch drops
  assert.equal(w.waveOn, false);
  const hover = run(createWake(RIG), 20, 12, { hullY: 0.52 }), low = run(createWake(RIG), 20, 12, { hullY: 0.5 });
  assert.equal(live(hover), 0); assert.equal(hover.track.n, 0);
  assert.ok(live(low) > 0);
});

test('the wave speed chases 0.7 d by at most 2 WW u a frame and stops at 40', () => {
  const w = createWake(RIG);
  let last = 0;
  for (let i = 0; i < 40; i++) {
    run(w, 1, 21); // 54.9 WW u a frame: d is capped at 40, so the aim is 28
    assert.ok(Math.abs(w.waves[1].speed - last) <= 2 + 1e-9, `frame ${i}: ${last} -> ${w.waves[1].speed}`);
    last = w.waves[1].speed;
  }
  near(last, 28, 1e-6);
  const slow = run(createWake(RIG), 20, ww(11.5)); // just over the band: aim 0.7 * 11.5
  near(slow.waves[1].speed, 8.05, 1e-6);
});

test('the roll pitches the waves by up to +-30 percent: right 1 + k, left 1 - k', () => {
  const big = run(createWake(RIG), 40, 21, { roll: 20000 * WW_ANGLE }), small = run(createWake(RIG), 40, 21, { roll: 4096 * WW_ANGLE });
  near(big.waves[1].speed, 36.4, 1e-6); near(big.waves[0].speed, 19.6, 1e-6); // 0.7 * 40 * 1.3 and * 0.7
  near(small.waves[1].speed, 28 * 1.25, 1e-6); near(small.waves[0].speed, 28 * 0.75, 1e-6);
  const level = run(createWake(RIG), 40, 21);
  near(level.waves[1].speed, 28, 1e-6); near(level.waves[0].speed, 28, 1e-6);
});

test('the bow point is 150 WW u (1.91) ahead at rest and farther with the speed (21 u/s: +0.7)', () => {
  const rest = run(createWake(RIG), 1, 0), fast = run(createWake(RIG), 1, 21);
  near(rest.bow.z, 1.91); near(rest.bow.x, 0);
  near(fast.bow.z, 1.91 + 0.7); // fwd = 55 WW u of displacement a frame
  const turned = createWake(RIG);
  stepWake(turned, { dt: 1 / 30, x: 5, z: 7, yaw: Math.PI / 2, vx: 0, vz: 0, surfaceAt: () => 0.25 });
  near(turned.bow.x, 5 + 1.91); near(turned.bow.z, 7); near(turned.bow.y, 0.25);
});

test('the track alpha rises 5 a frame to 255 (51 frames), falls 5 under the band and 10 and clears when stopped', () => {
  const w = run(createWake(RIG), 50, 21);
  assert.equal(w.track.alpha, 250);
  run(w, 1, 21); assert.equal(w.track.alpha, 255);
  run(w, 10, 21); assert.equal(w.track.alpha, 255);
  run(w, 4, 1); // 2.6 WW u a frame: still moving, under the band
  assert.equal(w.track.alpha, 235);
  run(w, 22, 0); assert.equal(w.track.alpha, 15);
  run(w, 1, 0); assert.equal(w.track.alpha, 5);
  run(w, 1, 0); assert.equal(w.track.alpha, 0); assert.equal(w.track.n, 0);
});

test('the track rows ride the swell 2 WW u over it, three wide across the beam', () => {
  const w = createWake(RIG);
  stepWake(w, { dt: 1 / 30, x: 0, z: 0, yaw: 0, vx: 0, vz: 21, surfaceAt: (x, z) => 0.3 + 0.1 * Math.sin(x + z) });
  assert.equal(w.track.n, 1);
  for (let c = 0; c < 3; c++) near(w.track.ty[c], 0.3 + 0.1 * Math.sin(w.track.tx[c] + w.track.tz[c]) + 0.0255, 1e-5);
  near(w.track.tx[0] - w.track.tx[2], 2.4); // left (+x) to right across rig.beam
  assert.ok(w.track.tx[0] > w.track.tx[2]);
});

test('the splash scale is v / 11.5 u/s capped at 1 and fades 0.2 a frame (0.17 s)', () => {
  const half = run(createWake(RIG), 3, ww(15)), full = run(createWake(RIG), 3, 21);
  near(half.splash.scale, 0.5, 1e-6); near(half.splash.speed, 7.5, 1e-6);
  near(full.splash.scale, 1, 1e-9); near(full.splash.speed, 15, 1e-9);
  const fade = [];
  for (let i = 0; i < 5; i++) { run(full, 1, 0); fade.push(full.splash.scale); }
  fade.forEach((s, i) => near(s, Math.max(0, 0.8 - 0.2 * i), 1e-9));
});

test('the landing burst is 10 at vy >= -15 WW u a frame and 60 at the clamp', () => {
  assert.equal(landingCount(0), 10); assert.equal(landingCount(-15), 10);
  assert.equal(landingCount(-30), 35); // 10 + 50 * 15 / 30
  assert.equal(landingCount(-45), 60); assert.equal(landingCount(-90), 60);
  const w = createWake(RIG);
  assert.equal(landing(w, ww(-45)), 60); assert.equal(landing(w, ww(-10)), 10);
  assert.equal(w.burst, 70);
});

test('the anchors are (-80,-50,-150) and (-40,-100,-350) WW u, scaled by rig.length / 7.2, mirrored on the left', () => {
  const [left, right] = createWake({ length: 7.2, beam: 2 }).anchorsLocal;
  near(right[0][0], -1.02); near(right[0][1], -0.64); near(right[0][2], -1.91);
  near(right[1][0], -0.51); near(right[1][1], -1.28); near(right[1][2], -4.46);
  near(left[0][0], 1.02); near(left[1][0], 0.51); near(left[1][2], -4.46);
  const big = createWake({ length: 14.4, beam: 2 }).anchorsLocal[1];
  near(big[0][0], -2.04); near(big[0][2], -3.82); near(big[1][2], -8.92);
  const w = createWake({ length: 7.2, beam: 2 });
  setWakeRig(w, { length: 14.4, beam: 2 });
  near(w.anchorsLocal[1][1][2], -8.92);
  // World anchors turn with the heading: yaw pi/2 sends boat +z to world +x.
  stepWake(w, { dt: 0, x: 10, z: 20, yaw: Math.PI / 2, surfaceAt: () => 1 });
  near(w.anchors[1][3], 10 - 8.92); near(w.anchors[1][4], 1 - 2.55, 0.01);
});

test('a slow render frame runs at most 5 WW frames, and dt accumulates in WW frames', () => {
  const w = createWake(RIG);
  stepWake(w, { dt: 1, x: 0, z: 0, yaw: 0, vz: 21, surfaceAt: flat });
  assert.equal(w.track.n, 5);
  const v = createWake(RIG);
  for (let i = 0; i < 6; i++) stepWake(v, { dt: 1 / 60, x: 0, z: 0, yaw: 0, vz: 21, surfaceAt: flat });
  assert.equal(v.track.n, 3); // 6 / 60 s = 3 WW frames
});
