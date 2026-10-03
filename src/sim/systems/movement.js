// Player/bot locomotion: acceleration, dash (with buffered input, charges, i-frames), static collision.
// Pure and deterministic: runs identically in the worker (authoritative) and the client (prediction).
import { tuning } from '../../data/tuning.js';
import { STATE } from '../ecs.js';
import { dampAngle } from '../../core/math.js';

// AIM (held bit): the command's aim point is explicit (mouse moved, right stick tilted), so the body faces it
// even while walking another way; without it you face where you walk (touch, keyboard only).
export const BTN = { DASH: 1, ATTACK: 2, PARRY: 4, GUARD: 4, Q: 8, E: 16, R: 32, INTERACT: 64, AIM: 128 };

const dashCurve = (t) => 1 - Math.pow(1 - t, tuning.dash.curvePow);

function walkStep(map, x0, z0, x1, z1) {
  const W = tuning.world;
  const lim = map.half - 2;
  if (x1 < -lim || x1 > lim || z1 < -lim || z1 > lim) return false;
  const deck1 = map.onDock(x1, z1), deck0 = map.onDock(x0, z0);
  const g1 = map.groundAt(x1, z1);
  if (!deck1 && W.waterLevel - g1 > W.wadeMax) return false;
  const g0 = map.groundAt(x0, z0);
  const d = Math.hypot(x1 - x0, z1 - z0);
  if (d < 1e-9) return true;
  const dh = g1 - g0;
  if (deck0 || deck1) return Math.abs(dh) < 0.6;
  // Steep ground stops you going up; going down you just drop (a knockback onto a ledge is no trap).
  return dh / d <= W.maxSlope;
}

// Moves entity e by (dx, dz) resolving terrain walkability (axis sliding) and static circle colliders.
export function moveWithCollision(world, e, dx, dz) {
  const ecs = world.ecs, map = world.map;
  const x = ecs.x[e], z = ecs.z[e], r = ecs.radius[e];
  let nx = x + dx, nz = z + dz;
  if (!walkStep(map, x, z, nx, nz)) {
    if (walkStep(map, x, z, nx, z)) nz = z;
    else if (walkStep(map, x, z, x, nz)) nx = x;
    else { nx = x; nz = z; }
  }
  for (let iter = 0; iter < 2; iter++) {
    const list = map.queryColliders(nx, nz, r + 3);
    for (let k = 0; k < list.length; k++) {
      const c = map.colliders[list[k]];
      const ox = nx - c.x, oz = nz - c.z;
      const minD = r + c.r;
      const d2 = ox * ox + oz * oz;
      if (d2 < minD * minD && d2 > 1e-12) {
        const d = Math.sqrt(d2);
        const push = minD - d;
        nx += (ox / d) * push;
        nz += (oz / d) * push;
      }
    }
  }
  if (!walkStep(map, x, z, nx, nz)) { nx = x; nz = z; }
  ecs.x[e] = nx;
  ecs.z[e] = nz;
  ecs.y[e] = map.groundAt(nx, nz);
  return Math.hypot(nx - x, nz - z);
}

// One fixed step of locomotion for entity e driven by command cmd {mx, mz, ax, az, btn, prs}.
export function stepMover(world, e, cmd, dt) {
  const ecs = world.ecs, map = world.map;
  const P = tuning.player, D = tuning.dash, W = tuning.world;

  let mx = cmd.mx || 0, mz = cmd.mz || 0;
  // Down or staggered: no steering, no dash (presses are still buffered).
  const locked = ecs.dead[e] > 0 || ecs.stagger[e] > 0;
  if (locked) { mx = 0; mz = 0; }
  let len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; len = 1; }
  ecs.moveMag[e] = len;

  if (cmd.prs & BTN.DASH) ecs.dashBuffer[e] = P.inputBuffer;

  // Charges recharge sequentially.
  if (ecs.dashCharges[e] < ecs.dashMax[e]) {
    ecs.dashRecharge[e] += dt;
    if (ecs.dashRecharge[e] >= D.recharge) {
      ecs.dashCharges[e] += 1;
      ecs.dashRecharge[e] = ecs.dashCharges[e] < ecs.dashMax[e] ? ecs.dashRecharge[e] - D.recharge : 0;
    }
  }
  if (ecs.iframes[e] > 0) ecs.iframes[e] = Math.max(0, ecs.iframes[e] - dt);

  // Start a buffered dash.
  if (ecs.dashT[e] < 0 && ecs.dashBuffer[e] > 0 && ecs.dashCharges[e] >= 1 && !locked) {
    let dx, dz;
    if (len > 0.1) { dx = mx / len; dz = mz / len; }
    else { dx = Math.sin(ecs.facing[e]); dz = Math.cos(ecs.facing[e]); }
    ecs.dashDirX[e] = dx; ecs.dashDirZ[e] = dz;
    ecs.dashT[e] = 0;
    ecs.dashCovered[e] = 0;
    ecs.dashCharges[e] -= 1;
    ecs.iframes[e] = D.duration;
    ecs.dashBuffer[e] = 0;
    ecs.dashCount[e] += 1;
    ecs.state[e] = STATE.DASH;
    ecs.facing[e] = Math.atan2(dx, dz);
  }
  if (ecs.dashBuffer[e] > 0) ecs.dashBuffer[e] = Math.max(0, ecs.dashBuffer[e] - dt);

  if (ecs.dashT[e] >= 0) {
    const t0 = ecs.dashT[e] / D.duration;
    ecs.dashT[e] += dt;
    const t1 = Math.min(1, ecs.dashT[e] / D.duration);
    const want = D.distance * (dashCurve(t1) - dashCurve(t0));
    // Sub-step so fast dashes never tunnel through colliders.
    const steps = Math.max(1, Math.ceil(want / 0.3));
    let moved = 0;
    for (let s = 0; s < steps; s++) moved += moveWithCollision(world, e, (ecs.dashDirX[e] * want) / steps, (ecs.dashDirZ[e] * want) / steps);
    ecs.dashCovered[e] += moved;
    ecs.vx[e] = (ecs.dashDirX[e] * moved) / dt;
    ecs.vz[e] = (ecs.dashDirZ[e] * moved) / dt;
    if (t1 >= 1) {
      ecs.dashT[e] = -1;
      ecs.state[e] = STATE.MOVE;
      const carry = len > 0.1 ? D.exitCarry : D.exitGlide;
      const ex = len > 0.1 ? mx / len : ecs.dashDirX[e];
      const ez = len > 0.1 ? mz / len : ecs.dashDirZ[e];
      ecs.vx[e] = ex * ecs.speed[e] * carry * Math.min(1, len > 0.1 ? len : 1);
      ecs.vz[e] = ez * ecs.speed[e] * carry * Math.min(1, len > 0.1 ? len : 1);
    }
  } else {
    // Wading slows you down.
    const depth = map.onDock(ecs.x[e], ecs.z[e]) ? 0 : W.waterLevel - ecs.y[e];
    ecs.wade[e] = depth > 0 ? depth : 0;
    let mul = 1;
    if (depth > W.wadeStart) mul = 1 - W.wadeSlow * Math.min(1, depth / W.wadeMax);
    mul *= ecs.moveMul[e]; // swings and parries slow you down
    // Walking backwards (away from where you aim) is a little slower; sideways is free.
    const aimed = (cmd.btn & BTN.AIM) !== 0;
    if (aimed && len > 0.05) {
      const c = (mx * Math.sin(ecs.facing[e]) + mz * Math.cos(ecs.facing[e])) / len;
      const k = Math.min(1, Math.max(0, (-c - 0.17) / 0.6));
      mul *= 1 - (1 - P.backMul) * k;
    }
    const tx = mx * ecs.speed[e] * mul, tz = mz * ecs.speed[e] * mul;
    const rate = (len > 0.05 ? P.accel : P.decel) * dt;
    let ddx = tx - ecs.vx[e], ddz = tz - ecs.vz[e];
    const dl = Math.hypot(ddx, ddz);
    if (dl > rate) { ddx *= rate / dl; ddz *= rate / dl; }
    ecs.vx[e] += ddx; ecs.vz[e] += ddz;
    if (Math.abs(ecs.vx[e]) < 1e-6 && Math.abs(ecs.vz[e]) < 1e-6) { ecs.vx[e] = 0; ecs.vz[e] = 0; }
    if (ecs.vx[e] !== 0 || ecs.vz[e] !== 0) {
      const moved = moveWithCollision(world, e, ecs.vx[e] * dt, ecs.vz[e] * dt);
      // Kill velocity into walls so we don't "stick" with phantom speed.
      const sp = Math.hypot(ecs.vx[e], ecs.vz[e]) * dt;
      if (sp > 1e-6 && moved < sp * 0.5) { ecs.vx[e] *= moved / sp; ecs.vz[e] *= moved / sp; }
    }
    if (ecs.faceLock[e] <= 0 && !locked) {
      const ax = (cmd.ax || 0) - ecs.x[e], az = (cmd.az || 0) - ecs.z[e];
      if (aimed) { if (ax * ax + az * az > 0.0225) ecs.facing[e] = dampAngle(ecs.facing[e], Math.atan2(ax, az), P.aimLambda, dt); }
      else if (len > 0.05) ecs.facing[e] = dampAngle(ecs.facing[e], Math.atan2(mx, mz), P.turnLambda, dt);
    }
  }
  // Knockback (hits, blocked heavy orbs): its own velocity, decaying fast.
  if (ecs.kbx[e] !== 0 || ecs.kbz[e] !== 0) {
    moveWithCollision(world, e, ecs.kbx[e] * dt, ecs.kbz[e] * dt);
    const k = Math.exp(-10 * dt);
    ecs.kbx[e] *= k; ecs.kbz[e] *= k;
    if (Math.abs(ecs.kbx[e]) + Math.abs(ecs.kbz[e]) < 0.05) { ecs.kbx[e] = 0; ecs.kbz[e] = 0; }
  }
}
