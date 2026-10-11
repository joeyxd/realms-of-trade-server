// Player/bot locomotion: acceleration, dash (with buffered input, charges, i-frames), static collision.
// Pure and deterministic: runs identically in the worker (authoritative) and the client (prediction).
import { tuning } from '../../data/tuning.js';
import { STATE } from '../ecs.js';
import { dampAngle } from '../../core/math.js';
import { canSwim, refreshSwimming } from './swimming.js';

// AIM (held bit): the command's aim point is explicit (mouse moved, right stick tilted), so the body faces it
// even while walking another way; without it you face where you walk (touch, keyboard only).
export const BTN = { DASH: 1, ATTACK: 2, PARRY: 4, GUARD: 4, Q: 8, E: 16, R: 32, INTERACT: 64, AIM: 128, POTION: 256, G: 512 };

const dashCurve = (t) => 1 - Math.pow(1 - t, tuning.dash.curvePow);

export function standingHeight(world, x, z, referenceY) {
  return world.raftDeck?.surface(x, z, referenceY)?.y ?? world.map.groundAt(x, z);
}

function walkStep(world, x0, z0, x1, z1, y0, r, waterAllowed = false) {
  const map = world.map;
  const W = tuning.world;
  const lim = map.half - 2;
  if (x1 < -lim || x1 > lim || z1 < -lim || z1 > lim) return false;
  const raft0 = world.raftDeck?.surface(x0, z0, y0), raft1 = world.raftDeck?.surface(x1, z1, y0);
  const deck1 = map.onDock(x1, z1) || raft1, deck0 = map.onDock(x0, z0) || raft0;
  const terrain1 = map.groundAt(x1, z1), terrain0 = map.groundAt(x0, z0);
  const wet1 = !deck1 && W.waterLevel - terrain1 > W.wadeMax;
  const wet0 = !deck0 && W.waterLevel - terrain0 > W.wadeMax;
  if (wet1 && (!waterAllowed || world.raftDeck?.surface(x1, z1))) return false;
  const g1 = raft1?.y ?? (wet1 ? W.waterLevel - tuning.swim.bodyDepth : terrain1);
  if (world.raftDeck?.blocked(x1, z1, g1, r)) return false;
  const g0 = raft0?.y ?? (wet0 ? W.waterLevel - tuning.swim.bodyDepth : terrain0);
  const d = Math.hypot(x1 - x0, z1 - z0);
  if (d < 1e-9) return true;
  const dh = g1 - g0;
  if (deck0 || deck1) return Math.abs(dh) < 0.6;
  // Water follows its surface rather than the seabed. A shallow shore is reachable without
  // treating the small float-to-wade height change as a vertical cliff.
  if (waterAllowed && (wet0 || wet1)) return wet1 || (g1 <= W.waterLevel + 0.05 && dh < 0.6);
  // Steep ground stops you going up; going down you just drop (a knockback onto a ledge is no trap).
  return dh / d <= W.maxSlope;
}

// Could a body of radius r stand at (x, z)? The rules moveWithCollision applies to where you end up: inside the map,
// not in deep water (a dock is dry), not inside a collider. (Landing spots of a leap.)
export function canStand(world, x, z, r = tuning.player.radius, referenceY) {
  const map = world.map, W = tuning.world, lim = map.half - 2;
  if (x < -lim || x > lim || z < -lim || z > lim) return false;
  const surface = world.raftDeck?.surface(x, z, referenceY), y = surface?.y ?? map.groundAt(x, z);
  if (!surface && !map.onDock(x, z) && W.waterLevel - y > W.wadeMax) return false;
  if (world.raftDeck?.blocked(x, z, y, r)) return false;
  const list = map.queryColliders(x, z, r + 3);
  for (let k = 0; k < list.length; k++) {
    const c = map.colliders[list[k]], ox = x - c.x, oz = z - c.z, m = r + c.r;
    if (ox * ox + oz * oz < m * m - 1e-9) return false; // A collision-resolved tangent is standable despite float rounding.
  }
  return true;
}

// Moves entity e by (dx, dz) resolving terrain walkability (axis sliding) and static circle colliders.
export function moveWithCollision(world, e, dx, dz) {
  // A continuous sampled path also protects ordinary walking, knockback and skill movement from
  // skipping a narrow deck gap or an edge. Keep the existing island path unchanged without rafts.
  const steps = world.raftDeck?.size || canSwim(world.ecs, e) ? Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15)) : 1;
  let moved = 0;
  for (let i = 0; i < steps; i++) moved += moveOnce(world, e, dx / steps, dz / steps);
  return moved;
}

function moveOnce(world, e, dx, dz) {
  const ecs = world.ecs, map = world.map;
  const x = ecs.x[e], z = ecs.z[e], r = ecs.radius[e];
  let nx = x + dx, nz = z + dz;
  const y = ecs.y[e];
  const waterAllowed = canSwim(ecs, e) && !ecs.dead[e];
  if (!walkStep(world, x, z, nx, nz, y, r, waterAllowed)) {
    if (walkStep(world, x, z, nx, z, y, r, waterAllowed)) nz = z;
    else if (walkStep(world, x, z, x, nz, y, r, waterAllowed)) nx = x;
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
  if (!walkStep(world, x, z, nx, nz, y, r, waterAllowed)) { nx = x; nz = z; }
  ecs.x[e] = nx;
  ecs.z[e] = nz;
  ecs.y[e] = standingHeight(world, nx, nz, y);
  if (waterAllowed) refreshSwimming(world, e);
  return Math.hypot(nx - x, nz - z);
}

// One fixed step of locomotion for entity e driven by command cmd {mx, mz, ax, az, btn, prs}.
export function stepMover(world, e, cmd, dt) {
  const ecs = world.ecs, map = world.map;
  const P = tuning.player, D = tuning.dash, W = tuning.world;
  const swimming = refreshSwimming(world, e);

  let mx = cmd.mx || 0, mz = cmd.mz || 0;
  // Down or staggered: no steering, no dash (presses are still buffered).
  const locked = ecs.dead[e] > 0 || ecs.stagger[e] > 0;
  if (locked) { mx = 0; mz = 0; }
  let len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; len = 1; }
  ecs.moveMag[e] = len;

  if (!swimming && cmd.prs & BTN.DASH) ecs.dashBuffer[e] = P.inputBuffer;

  // Charges recharge sequentially.
  if (ecs.dashCharges[e] < ecs.dashMax[e]) {
    const rec = D.recharge * ecs.dashRec[e]; // gear: Recarga de dash
    ecs.dashRecharge[e] += dt;
    if (ecs.dashRecharge[e] >= rec) {
      ecs.dashCharges[e] += 1;
      ecs.dashRecharge[e] = ecs.dashCharges[e] < ecs.dashMax[e] ? ecs.dashRecharge[e] - rec : 0;
    }
  }
  if (ecs.iframes[e] > 0) ecs.iframes[e] = Math.max(0, ecs.iframes[e] - dt);

  // Start a buffered dash (not during a skill's windup / active frames: the buffer waits).
  if (ecs.dashT[e] < 0 && ecs.dashBuffer[e] > 0 && ecs.dashCharges[e] >= 1 && !locked && !(ecs.castLock[e] > 0)) {
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
    for (let s = 0; s < steps; s++) {
      moved += moveWithCollision(world, e, (ecs.dashDirX[e] * want) / steps, (ecs.dashDirZ[e] * want) / steps);
      if (ecs.swim[e]) break;
    }
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
    const depth = map.onDock(ecs.x[e], ecs.z[e]) || world.raftDeck?.surface(ecs.x[e], ecs.z[e], ecs.y[e]) ? 0 : W.waterLevel - ecs.y[e];
    ecs.wade[e] = depth > 0 ? depth : 0;
    let mul = 1;
    if (depth > W.wadeStart) mul = 1 - W.wadeSlow * Math.min(1, depth / W.wadeMax);
    mul *= ecs.moveMul[e]; // swings and parries slow you down
    if (swimming) mul = 1;
    // Walking backwards (away from where you aim) is a little slower; sideways is free.
    const aimed = (cmd.btn & BTN.AIM) !== 0;
    if (!swimming && aimed && len > 0.05) {
      const c = (mx * Math.sin(ecs.facing[e]) + mz * Math.cos(ecs.facing[e])) / len;
      const k = Math.min(1, Math.max(0, (-c - 0.17) / 0.6));
      mul *= 1 - (1 - P.backMul) * k;
    }
    const speed = swimming ? (ecs.swimStamina[e] <= 0 ? tuning.swim.exhaustedSpeed :
      tuning.swim.speed * (1 - tuning.swim.loadSlow * ecs.swimLoad[e])) : ecs.speed[e];
    const tx = mx * speed * mul, tz = mz * speed * mul;
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
  if (refreshSwimming(world, e)) {
    const limit = ecs.swimStamina[e] <= 0 ? tuning.swim.exhaustedSpeed : tuning.swim.speed * (1 - tuning.swim.loadSlow * ecs.swimLoad[e]);
    const speed = Math.hypot(ecs.vx[e], ecs.vz[e]);
    if (speed > limit) { ecs.vx[e] *= limit / speed; ecs.vz[e] *= limit / speed; }
  }
}
