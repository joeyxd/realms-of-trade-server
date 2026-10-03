// Combat V2 (PLAN-M3.5.md): aimed facing, the 3-tier timed sword reflect, the guard, weapon kits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BTN } from '../src/sim/systems/movement.js';
import { tuning, DT } from '../src/data/tuning.js';
import { wrapAngle } from '../src/core/math.js';
import { arena, clientAndServer } from './helpers.mjs';

const angTo = (w, e, x, z) => Math.atan2(x - w.ecs.x[e], z - w.ecs.z[e]);

test('with AIM the body faces the aim point while walking another way; without it, the way you walk', () => {
  const { w, e, step } = arena();
  // Walk +z (south) while aiming +x (east).
  for (let i = 0; i < 30; i++) step({ mz: 1, btn: BTN.AIM, ax: w.ecs.x[e] + 6, az: w.ecs.z[e] });
  assert.ok(Math.abs(wrapAngle(w.ecs.facing[e] - Math.PI / 2)) < 0.02, `faces the aim (${w.ecs.facing[e].toFixed(3)})`);
  assert.ok(w.ecs.vz[e] > 6, 'still walking south at full speed (sideways is free)');
  // Same walk without AIM: turns to the way it walks.
  for (let i = 0; i < 30; i++) step({ mz: 1, ax: w.ecs.x[e] + 6, az: w.ecs.z[e] });
  assert.ok(Math.abs(wrapAngle(w.ecs.facing[e] - 0)) < 0.02, 'faces the walk');
  // An aim point on top of you does not spin you around (stand still first).
  for (let i = 0; i < 20; i++) step();
  const f = w.ecs.facing[e];
  for (let i = 0; i < 10; i++) step({ btn: BTN.AIM, ax: w.ecs.x[e] + 0.05, az: w.ecs.z[e] - 0.05 });
  assert.equal(w.ecs.facing[e], f);
});

test('walking backwards away from the aim is slower, sideways is not', () => {
  const speed = (mx, mz) => {
    const { w, e, step } = arena();
    for (let i = 0; i < 40; i++) step({ mx, mz, btn: BTN.AIM, ax: w.ecs.x[e] + 6, az: w.ecs.z[e] });
    return Math.hypot(w.ecs.vx[e], w.ecs.vz[e]);
  };
  const fwd = speed(1, 0), side = speed(0, 1), back = speed(-1, 0);
  assert.ok(Math.abs(fwd - side) < 1e-6, 'forward = sideways');
  assert.ok(Math.abs(back - fwd * tuning.player.backMul) < 1e-6, `backwards × ${tuning.player.backMul} (${back.toFixed(3)} vs ${fwd.toFixed(3)})`);
});

test('a swing still turns to the aim at the press and holds that facing through its active frames', () => {
  const { w, e, step } = arena();
  const ax = w.ecs.x[e], az = w.ecs.z[e] - 5; // north
  step({ prs: BTN.ATTACK, btn: BTN.AIM, ax, az });
  const f0 = w.ecs.facing[e];
  assert.ok(Math.abs(wrapAngle(f0 - angTo(w, e, ax, az))) < 0.05, 'snapped to the aim');
  // Swinging the mouse around mid-swing: the facing stays until the lock ends.
  for (let i = 0; i < 6; i++) step({ btn: BTN.AIM, ax: w.ecs.x[e] + 5, az: w.ecs.z[e] });
  assert.equal(w.ecs.facing[e], f0, 'locked during the swing');
  for (let i = 0; i < 30; i++) step({ btn: BTN.AIM, ax: w.ecs.x[e] + 5, az: w.ecs.z[e] });
  assert.ok(Math.abs(wrapAngle(w.ecs.facing[e] - Math.PI / 2)) < 0.02, 'then follows the aim again');
});

test('client prediction stays exact with aimed facing, strafing and backpedalling', () => {
  const { server, client, deliver, sp, se, ecs } = clientAndServer();
  let maxErr = 0;
  for (let i = 0; i < 600; i++) {
    client.update(DT);
    const t = i * 0.05;
    const mx = Math.sin(t * 0.7), mz = Math.cos(t * 1.3);
    const ax = sp.x + Math.sin(t) * 3, az = sp.z + Math.cos(t * 0.5) * 3;
    const prs = (i % 41 === 0 ? BTN.ATTACK : 0) | (i % 97 === 50 ? BTN.DASH : 0);
    client.tickInput({ mx, mz, ax, az, btn: i % 200 < 150 ? BTN.AIM : 0, prs });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.equal(maxErr, 0, 'zero prediction error');
  for (const k of ['x', 'z', 'facing', 'hp']) assert.equal(client.pred.ecs[k][client.youLocal], ecs[k][se], k);
});
