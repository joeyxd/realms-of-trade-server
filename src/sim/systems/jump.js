// PT06: the Super Mario 64 jump on the shared sim (the server and the client's prediction run it identically).
// Single, double and triple jump, freefall and the landing actions, ported from n64decomp/sm64 9921382 (the lines
// are quoted in short comments; the numbers live in tuning.jump, in Mario units). Switch: world.jumpMode =
// 'off' (today's game, nothing here runs) | 'lab' (Mario's rules, run 8.5 u/s, air cap 25) | 'game' (a jump spends a dash charge,
// big falls kill). Clock: the jump logic runs at SM64's 30 Hz; one SM64 frame = 2 sim ticks, phased per mover from
// the takeoff tick (ecs.jmpPh: 0 = first tick of a frame). Speeds are u/s (1 mu/f = 0.3375 u/s), lengths u.
import { tuning } from '../../data/tuning.js';
import { STATE, C, ACT, airborne } from '../ecs.js';
import { BTN, moveWithCollision, standingHeight } from './movement.js';
import { canSwim, swimmingAt, refreshSwimming } from './swimming.js';

const J = tuning.jump;
const V = J.mu * J.fps; // u/s per mu/f

// What a remote client poses (ENT.JMP): 0 ground, 1 jump, 2 double, 3 triple, 4 freefall, 5 landing, 6 sliding on steep ground.
export const JUMP_STAGE = { GROUND: 0, JUMP: 1, DOUBLE: 2, TRIPLE: 3, FREEFALL: 4, LANDING: 5, STEEP: 6 };
// A stage with the body off its floor (the shadow drops, the pose flies): the four air actions and the steep slide.
export const airStage = (j) => (j >= 1 && j <= 4) || j === JUMP_STAGE.STEEP;
export const jumpOn = (world) => world.jumpMode === 'lab' || world.jumpMode === 'game';
export const jumpModeOf = (v) => (v === 'lab' || v === 'game' ? v : 'off');
export function jumpStage(ecs, e) {
  const a = ecs.jmpAct[e];
  return a < 4 ? a : a === 4 ? (ecs.jmpSteep[e] === 2 ? JUMP_STAGE.STEEP : JUMP_STAGE.FREEFALL) : JUMP_STAGE.LANDING;
}

// jmpAct: 1-4 in the air; 4 + k a landing action after air action k (5 JUMP_LAND, 6 DOUBLE_, 7 TRIPLE_, 8 FREEFALL_LAND);
// 8 + k its stop action (9-12). 0 = on the ground (walking, standing).
const A_JUMP = 1, A_DOUBLE = 2, A_TRIPLE = 3, A_FREE = 4;
const gate = (world, e, locked, heavy, swimming) => {
  const ecs = world.ecs;
  // The same press gate on land and on a raft deck.
  if (swimming || locked || heavy || ecs.dashT[e] >= 0 || ecs.castLock[e] > 0) return false;
  if (ecs.castK[e] > 0 && ecs.act[e] === ACT.LEAP) return false; // the Abordaje leap
  return ecs.dashCharges[e] >= (world.jumpMode === 'game' ? J.game.cost : J.lab.cost);
};

// set_mario_action_airborne (mario.c:776-891): vy from the forward speed, forward speed * 0.8, peak = y.
function takeoff(world, e, kind, fwd) {
  const ecs = world.ecs, squish = ecs.jmpSq[e] > 0;
  if (kind === A_DOUBLE && squish) kind = A_JUMP; // mario.c:779-782
  const i = kind - 1;
  let vy = J.vy[i] + J.vyFwd[i] * fwd / V; // mario.c:786, 797, 824 (mu/f)
  if (squish) vy *= 0.5; // mario.c:766-770
  const hs = Math.hypot(ecs.vx[e], ecs.vz[e]);
  if (hs > 0.5) ecs.facing[e] = Math.atan2(ecs.vx[e], ecs.vz[e]); // the facing stays fixed in the air
  ecs.jmpAct[e] = kind; ecs.jmpPh[e] = 0; ecs.jmpA[e] = 0; ecs.jmpLT[e] = 0; ecs.jmpTimer[e] = 0; ecs.jmpSteep[e] = 0;
  ecs.jmpVy[e] = vy * V; ecs.jmpFwd[e] = fwd * J.fwdKeep; ecs.jmpSide[e] = 0; ecs.jmpPeak[e] = ecs.y[e];
  ecs.dashCharges[e] -= world.jumpMode === 'game' ? J.game.cost : J.lab.cost;
  ecs.dashBuffer[e] = 0;
  ecs.state[e] = STATE.MOVE;
}

// Our heightfield has cliffs Mario's floor does not: a ground step that drops more than cliffDrop, or steeper than
// cliffSlope, leaves the ground (FREEFALL, vy 0, forward speed = the walking speed). Called by moveOnce; true = fall.
export function groundCliff(world, e, x, z, nx, nz, y, ny) {
  const ecs = world.ecs, map = world.map;
  if (!(ecs.mask[e] & C.PLAYER) || ecs.dead[e] > 0 || ecs.swim[e]) return false;
  const drop = y - ny, d = Math.hypot(nx - x, nz - z);
  if (d < 1e-6 || !(drop > J.cliffDrop || drop / d > J.cliffSlope)) return false;
  // Docks and decks keep their own |dh| < 0.6 rule.
  if (map.onDock(x, z) || map.onDock(nx, nz) || world.raftDeck?.surface(x, z, y) || world.raftDeck?.surface(nx, nz, y)) return false;
  const hs = Math.hypot(ecs.vx[e], ecs.vz[e]);
  if (hs > 0.5) ecs.facing[e] = Math.atan2(ecs.vx[e], ecs.vz[e]);
  ecs.jmpAct[e] = A_FREE; ecs.jmpPh[e] = 0; ecs.jmpA[e] = 0; ecs.jmpLT[e] = 0; ecs.jmpTimer[e] = 0; ecs.jmpSteep[e] = 0;
  ecs.jmpVy[e] = 0; ecs.jmpFwd[e] = hs; ecs.jmpSide[e] = 0; ecs.jmpPeak[e] = y;
  if (ecs.dashT[e] >= 0) { ecs.dashT[e] = -1; ecs.state[e] = STATE.MOVE; }
  return true;
}

// ---- On the ground: the press, the landing actions and the double-jump timer (clock: SM64 frames) --------------
function groundTick(world, e, press, len, locked, heavy, swimming) {
  const ecs = world.ecs, act = ecs.jmpAct[e];
  if (act === 0) {
    if (press && gate(world, e, locked, heavy, swimming)) { takeoff(world, e, A_JUMP, Math.hypot(ecs.vx[e], ecs.vz[e])); return; }
    if (ecs.jmpSq[e] > 0) { // squish timer after a fall: counts frames
      if (ecs.jmpPh[e] === 1 && --ecs.jmpSq[e] < 0) ecs.jmpSq[e] = 0;
      ecs.jmpPh[e] = 1 - ecs.jmpPh[e];
    }
    return;
  }
  // A landing action: its frame runs on the second tick, seeing a press from either tick of the frame.
  let a = ecs.jmpA[e];
  if (press) a |= 2;
  if (ecs.jmpPh[e] === 0) { ecs.jmpA[e] = a | 1; ecs.jmpPh[e] = 1; return; }
  ecs.jmpPh[e] = 0;
  if (!(a & 1)) { ecs.jmpA[e] = a & 2; return; } // the landing tick closed the frame before: a press waits for the next one
  ecs.jmpA[e] = 0;
  landFrame(world, e, (a & 2) !== 0, len, locked, heavy, swimming);
}

function landFrame(world, e, pressed, len, locked, heavy, swimming) {
  const ecs = world.ecs;
  if (ecs.jmpTimer[e] > 0) ecs.jmpTimer[e]--; // mario.c:1411
  if (ecs.jmpSq[e] > 0) ecs.jmpSq[e]--;
  let act = ecs.jmpAct[e];
  if (act <= 8) { // moving landing action (moving.c:1758-1790, in this order)
    const k = act - 4;
    ecs.jmpTimer[e] = k === 3 ? 0 : J.doubleTimer; // :1767 (5 frames, 0 after a triple)
    if (k === 3) pressed = false; // act_triple_jump_land clears A (:1883)
    if (++ecs.jmpLT[e] >= J.landFrames) act = ecs.jmpAct[e] = 8 + k; // :1777, the stop action runs in this same frame
    else {
      const fwdMu = ecs.jmpFwd[e] / V;
      if (pressed && gate(world, e, locked, heavy, swimming)) { // aPressedAction (:26-56, :1875)
        const kind = k === 2 ? (fwdMu > J.tripleFwd ? A_TRIPLE : A_JUMP) : A_DOUBLE;
        takeoff(world, e, kind, ecs.jmpFwd[e]);
        return;
      }
      // common_landing_action friction (:1726-1730): 0.98 with the stick held, else a steady decel above 16 mu/f
      if (len > 0.05) { ecs.jmpFwd[e] *= J.landKeep; if (ecs.jmpFwd[e] < V) ecs.jmpFwd[e] = 0; }
      else if (fwdMu >= J.landDecelMin) ecs.jmpFwd[e] = Math.max(0, ecs.jmpFwd[e] - J.landDecel * V);
      return;
    }
  }
  const k = act - 8; // stop action: A goes through set_jump_from_landing (mario.c:1018-1068)
  if (pressed) {
    let kind = A_JUMP;
    if (k !== 3 && ecs.jmpTimer[e] > 0 && ecs.jmpSq[e] === 0)
      kind = k === 2 ? (ecs.jmpFwd[e] / V > J.tripleFwd ? A_TRIPLE : A_JUMP) : A_DOUBLE;
    if (gate(world, e, locked, heavy, swimming)) { takeoff(world, e, kind, ecs.jmpFwd[e]); return; }
  }
  ecs.jmpFwd[e] = 0; // stationary_ground_step forces the forward speed to 0 (mario_step.c:241)
  if (len > 0.05) ecs.jmpAct[e] = 0; // the stick walks on: the chain is lost (prevAction is the stop action)
  else { ecs.vx[e] = ecs.vz[e] = 0; if (ecs.jmpTimer[e] === 0) ecs.jmpAct[e] = 0; }
}

// ---- In the air ------------------------------------------------------------------------------------------
// update_air_without_turn (airborne.c:216-251): facing fixed, the stick accelerates forward and drifts sideways.
function airHorizontal(ecs, e, mx, mz, len) {
  let fwd = ecs.jmpFwd[e] / V;
  fwd = fwd > J.drag ? fwd - J.drag : fwd < -J.drag ? fwd + J.drag : 0; // :224
  let side = 0;
  if (len > 0.05) {
    const mag = len * len, d = Math.atan2(mx, mz) - ecs.facing[e]; // Mario's stick magnitude is squared
    fwd += mag * Math.cos(d) * J.accel; // :230
    side = mag * Math.sin(d) * J.side; // :231
  }
  if (fwd > J.cap) fwd -= J.capOver; // :235 (air speed is not capped: net +0.15 mu/f per frame above the cap)
  if (fwd < J.minFwd) fwd += J.minAdd; // :238
  ecs.jmpFwd[e] = fwd * V; ecs.jmpSide[e] = side * V;
  const sf = Math.sin(ecs.facing[e]), cf = Math.cos(ecs.facing[e]);
  ecs.vx[e] = ecs.jmpFwd[e] * sf + ecs.jmpSide[e] * cf;
  ecs.vz[e] = ecs.jmpFwd[e] * cf - ecs.jmpSide[e] * sf;
}

function land(world, e, y, wet, seq) {
  const ecs = world.ecs, k = ecs.jmpAct[e];
  ecs.y[e] = y;
  if (wet) { // deep water: no damage, swim as usual
    ecs.jmpAct[e] = 0; ecs.jmpSteep[e] = 0; ecs.jmpVy[e] = 0;
    refreshSwimming(world, e);
    return;
  }
  // check_fall_damage (airborne.c:61-106): the fall must be fast (or have touched steep ground) and high enough.
  const fh = ecs.jmpPeak[e] - y;
  if (fh > J.fallTier1 && (ecs.jmpSteep[e] > 0 || ecs.jmpVy[e] < J.fallGate * V)) {
    const big = fh > J.fallTier2;
    if (!big) ecs.jmpSq[e] = J.squish;
    // True damage happens where the server applies the other damage (World.applyFalls); prediction never touches hp.
    if (world.isServer) world.falls?.push(e, (world.jumpMode === 'game' ? J.game : J.lab).fall[big ? 1 : 0], seq);
  }
  ecs.jmpAct[e] = 4 + k; ecs.jmpLT[e] = 0; ecs.jmpA[e] = 0; ecs.jmpVy[e] = 0; ecs.jmpSteep[e] = 0;
}

const slope = { gx: 0, gz: 0 };
function slopeAt(map, x, z) { // central differences of the heightfield at +-0.5 u
  slope.gx = map.groundAt(x + 0.5, z) - map.groundAt(x - 0.5, z);
  slope.gz = map.groundAt(x, z + 0.5) - map.groundAt(x, z - 0.5);
  return Math.hypot(slope.gx, slope.gz);
}

function airTick(world, e, cmd, dt, mx, mz, len) {
  const ecs = world.ecs, map = world.map, ph = ecs.jmpPh[e];
  let sliding = false;
  if (ecs.jmpSteep[e] === 2) { // the last tick slid on steep ground: forward / side / facing follow the slide velocity
    ecs.jmpSteep[e] = 1; sliding = true;
    const hs = Math.hypot(ecs.vx[e], ecs.vz[e]);
    if (hs > 0.5) ecs.facing[e] = Math.atan2(ecs.vx[e], ecs.vz[e]);
    ecs.jmpFwd[e] = hs; ecs.jmpSide[e] = 0;
  }
  if (ph === 0) { // frame begin: A_DOWN of this frame, then the horizontal update (the stick is ignored while sliding)
    ecs.jmpA[e] = cmd.btn & BTN.JUMP ? 4 : 0;
    if (!sliding) airHorizontal(ecs, e, mx, mz, len);
  }
  // Half of the frame displacement on each tick.
  const y0 = ecs.y[e], want = Math.hypot(ecs.vx[e], ecs.vz[e]) * dt;
  const moved = moveWithCollision(world, e, ecs.vx[e] * dt, ecs.vz[e] * dt);
  if (want > 1e-6 && moved < want * 0.5) { // blocked by a collider: lose the speed into it
    const k = moved / want;
    ecs.vx[e] *= k; ecs.vz[e] *= k; ecs.jmpFwd[e] *= k; ecs.jmpSide[e] *= k;
  }
  const x = ecs.x[e], z = ecs.z[e], y1 = y0 + ecs.jmpVy[e] * dt;
  // The floor: deep water (the swim height) for a swimmer, else a deck / the terrain.
  const wet = canSwim(ecs, e) && swimmingAt(world, x, z, y0);
  const floor = wet ? tuning.world.waterLevel - tuning.swim.bodyDepth : standingHeight(world, x, z, y0);
  if (y1 <= floor) {
    const solid = !wet && !map.onDock(x, z) && !world.raftDeck?.surface(x, z, y0);
    if (solid && slopeAt(map, x, z) > J.cliffSlope) { // steep ground is no landing: slide along it
      const il = 1 / Math.hypot(slope.gx, 1, slope.gz), nx = -slope.gx * il, ny = il, nz = -slope.gz * il;
      const vn = ecs.vx[e] * nx + ecs.jmpVy[e] * ny + ecs.vz[e] * nz;
      if (vn < 0) { ecs.vx[e] -= nx * vn; ecs.jmpVy[e] -= ny * vn; ecs.vz[e] -= nz * vn; }
      ecs.y[e] = floor; ecs.jmpSteep[e] = 2; ecs.jmpAct[e] = A_FREE;
    } else { land(world, e, floor, wet, cmd.seq >>> 0); ecs.jmpPh[e] = 1 - ph; return; }
  } else ecs.y[e] = y1;
  if (ph === 1) { // frame end: peakY, then gravity or the variable-height cut (mario_step.c:519-581, :640)
    let vy = ecs.jmpVy[e];
    if (vy >= 0 && ecs.jmpSteep[e] !== 2) ecs.jmpPeak[e] = ecs.y[e];
    const act = ecs.jmpAct[e];
    if ((act === A_JUMP || act === A_DOUBLE) && !(ecs.jmpA[e] & 4) && vy > J.cutVy * V) vy /= J.cutDiv;
    else vy = Math.max(vy - J.gravity * V, J.terminal * V);
    ecs.jmpVy[e] = vy;
  }
  ecs.jmpPh[e] = 1 - ph;
}

// One tick of the jump machine for mover e (called by stepMover in lab / game). True = the body was in the air this
// tick (the caller skips dash, steering and the swim snap); false = on the ground (landing actions run beside walking).
export function jumpTick(world, e, cmd, dt, mx, mz, len, locked, heavy, swimming) {
  const ecs = world.ecs;
  if (!airborne(ecs, e)) {
    const press = (cmd.prs & BTN.JUMP) !== 0;
    if (!press && ecs.jmpAct[e] === 0 && ecs.jmpSq[e] === 0) return false;
    groundTick(world, e, press, len, locked, heavy, swimming);
    if (!airborne(ecs, e)) return false;
  }
  airTick(world, e, cmd, dt, mx, mz, len);
  return true;
}
