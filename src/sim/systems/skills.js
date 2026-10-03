// Weapons and their skills (M3.5). One step per command, after movement, inside stepPlayerCombat:
// shared verbatim by the server and the client's prediction, like the rest of player combat. Anything
// that touches hostile bullets runs here, at the command's projectile tick, so prediction replays it;
// hits on enemies are server-only (world.lungeHits / world.crescentHits).
//
//   Equip  cmd.w = weapon + 1. Only next to a rack (map.racks, RACK_R): a swing, the guard and a cast in
//          progress are dropped; the cooldowns carry over.
//   Cast   Q / E (buffered like LMB) start the weapon's skill at the cursor when it is off cooldown and
//          you are free (not dashing, staggered, dead or mid-swing; a swing's recovery is cut short; it
//          lowers the guard). castK = 1 (Q) or 2 (E) while it runs; no dash in its windup / active frames.
//   Sable  Q Estocada: a lunge along the dash curve that destroys the parryables near its path and hits
//          each enemy on it once. E Hoja de viento: a crescent flies at the cursor (analytic, like the
//          hostile bullets), destroys the parryables it crosses and hits each enemy once. R Tormenta: the
//          RIPOSTE wave (combat.js).
//   Pistolas  LMB held: alternating shots (combat.js, the basic attack). Q Descarga: 7 pellets in a cone,
//          blows away the parryables in front, kicks you back. E Paso de humo: a short collision-stepped
//          blink toward where you walk (the cursor when standing) with i-frames. R Lluvia de plomo: a zone
//          at the cursor (≤ 9 u) where lead rains for 1.5 s: hits every 0.15 s, erases parryables.
import { tuning, DT } from '../../data/tuning.js';
import { WEAPON_KINDS, RACK_R, SKILLS, weaponOf } from '../../data/weapons.js';
import { PTYPE, KILL, SHOT, clipDistance } from '../projectiles.js';
import { hash01 } from '../../core/rng.js';
import { BTN, moveWithCollision } from './movement.js';
import { ACT } from '../ecs.js';
import { kitUnlocked, passive } from './stats.js';

export const CAST = { NONE: 0, Q: 1, E: 2 };
const dashCurve = (t) => 1 - Math.pow(1 - t, tuning.dash.curvePow);

// The rack within reach of (x, z), or null.
export function rackNear(map, x, z, r = RACK_R) {
  for (const k of map.racks || []) if (Math.hypot(x - k.x, z - k.z) <= r) return k;
  return null;
}

export function stepEquip(world, e, cmd) {
  const ecs = world.ecs, want = (cmd.w | 0) - 1;
  if (want < 0 || want >= WEAPON_KINDS.length || want === ecs.weapon[e] || ecs.dead[e] > 0) return false;
  if (!rackNear(world.map, ecs.x[e], ecs.z[e])) return false;
  setWeapon(world, e, want, cmd.seq >>> 0);
  return true;
}

export function setWeapon(world, e, w, seq = 0) {
  const ecs = world.ecs;
  ecs.weapon[e] = w;
  ecs.atkStage[e] = 0; ecs.atkBuf[e] = 0; ecs.lastStage[e] = 0;
  ecs.guardT[e] = -1;
  cancelCast(ecs, e);
  ecs.qBuf[e] = ecs.eBuf[e] = 0; ecs.shotCd[e] = 0; ecs.shotN[e] = 0;
  world.emit({ type: 'equip', e, weapon: w, seq, x: ecs.x[e], z: ecs.z[e] });
}

// The skill a slot ('q' | 'e' | 'r' | 'basic') has with the weapon e carries.
export const skillOf = (ecs, e, slot) => weaponOf(ecs.weapon[e])[slot];

// Seconds a cast takes: [windup, active, recover].
function phases(id) {
  const S = SKILLS[id];
  if (id === 'lunge') return [S.windup, S.time, S.recover];
  if (id === 'wave') return [S.windup, 0, S.recover];
  if (id === 'blast') return [S.windup, 0, S.root];
  if (id === 'blink') return [0, 0, S.recover];
  return [0, 0, 0];
}
export const castBusy = (ecs, e) => ecs.castK[e] > 0;

export function cancelCast(ecs, e) {
  ecs.castK[e] = 0; ecs.castT[e] = 0; ecs.castLock[e] = 0;
}

function addRiposte(ecs, e, n) {
  ecs.riposte[e] = Math.min(tuning.parry.riposte.max, ecs.riposte[e] + n * ecs.ripMul[e]);
}

function faceAim(ecs, e, cmd) {
  const dx = (cmd.ax || 0) - ecs.x[e], dz = (cmd.az || 0) - ecs.z[e];
  if (dx * dx + dz * dz > 0.09) ecs.facing[e] = Math.atan2(dx, dz);
}

// Q / E presses go into their buffers (stepPlayerCombat decrements them). A buffered skill that is
// ready wins over raising the guard. A slot the weapon's mastery has not opened yet says so instead (M4).
export function bufferSkills(world, e, cmd, seq = 0) {
  const ecs = world.ecs, ib = tuning.player.inputBuffer;
  for (const [bit, slot, buf] of PRESSES) {
    if (!(cmd.prs & bit)) continue;
    if (kitUnlocked(ecs, e, slot)) ecs[buf][e] = ib;
    else world.emit({ type: 'locked', e, seq, slot });
  }
}
const PRESSES = [[BTN.Q, 'q', 'qBuf'], [BTN.E, 'e', 'eBuf']];
export const skillWanted = (ecs, e) => (ecs.qBuf[e] > 0 && ecs.cdQ[e] <= 0) || (ecs.eBuf[e] > 0 && ecs.cdE[e] <= 0);

// Start a buffered Q or E (the caller checked you are free to act). Returns true when one started.
export function tryCast(world, e, cmd, seq) {
  const ecs = world.ecs;
  let k = 0;
  if (ecs.qBuf[e] > 0 && ecs.cdQ[e] <= 0) k = CAST.Q;
  else if (ecs.eBuf[e] > 0 && ecs.cdE[e] <= 0) k = CAST.E;
  if (!k) return false;
  const id = skillOf(ecs, e, k === CAST.Q ? 'q' : 'e');
  const S = SKILLS[id];
  if (!S || !phases(id).some((t) => t > 0)) return false; // not a cast skill (P5 adds the pistols' kit)
  const cd = S.cd * (1 - ecs.cdr[e]); // gear: Enfriamiento
  if (k === CAST.Q) { ecs.qBuf[e] = 0; ecs.cdQ[e] = cd; } else { ecs.eBuf[e] = 0; ecs.cdE[e] = cd; }
  ecs.atkStage[e] = 0; ecs.atkBuf[e] = 0; ecs.guardT[e] = -1;
  faceAim(ecs, e, cmd);
  const [w, a] = phases(id);
  ecs.castK[e] = k; ecs.castT[e] = 0;
  ecs.castX[e] = Math.sin(ecs.facing[e]); ecs.castZ[e] = Math.cos(ecs.facing[e]);
  ecs.castLock[e] = w + a;
  ecs.faceLock[e] = w + a + 0.05;
  ecs.lungeCov[e] = 0;
  if (id === 'lunge') { ecs.vx[e] = 0; ecs.vz[e] = 0; } // the lunge is all the movement there is
  ecs.swingId[e] += 1; // a fresh key for the server's once-per-attack hit bookkeeping
  world.emit({ type: 'cast', e, skill: id, seq, x: ecs.x[e], z: ecs.z[e], dx: ecs.castX[e], dz: ecs.castZ[e] });
  return true;
}

// One step of the skill being cast (castK > 0).
export function stepCast(world, e, cmd, dt, pt, seq) {
  const ecs = world.ecs;
  const id = skillOf(ecs, e, ecs.castK[e] === CAST.Q ? 'q' : 'e');
  const [w, a, r] = phases(id);
  const t0 = ecs.castT[e];
  ecs.castT[e] += dt;
  const t1 = ecs.castT[e];
  if (id === 'lunge' && t1 > w && t0 < w + a) lungeStep(world, e, t0, t1, pt, seq);
  if (t0 <= w && t1 > w) {
    if (id === 'wave') throwWave(world, e, pt, seq);
    else if (id === 'blast') fireBlast(world, e, pt, seq);
    else if (id === 'blink') blink(world, e, cmd, seq);
  }
  if (t1 >= w + a + r) cancelCast(ecs, e);
}

// Movement multiplier and animation of a cast (null when nothing is being cast).
export function castPose(ecs, e) {
  if (!(ecs.castK[e] > 0)) return null;
  const id = skillOf(ecs, e, ecs.castK[e] === CAST.Q ? 'q' : 'e');
  if (id === 'lunge') return { move: 0, act: ACT.LUNGE };
  if (id === 'wave') return { move: ecs.castT[e] < SKILLS.wave.windup ? 0.3 : 0.6, act: ACT.THROW };
  if (id === 'blast') return { move: 0, act: ACT.BLAST };
  return { move: 1, act: ACT.CAST };
}

// ---- Sable: Estocada ------------------------------------------------------------------------------------
function lungeStep(world, e, t0, t1, pt, seq) {
  const ecs = world.ecs, H = world.hazards, L = SKILLS.lunge, P = tuning.parry;
  const u0 = Math.max(0, (t0 - L.windup) / L.time), u1 = Math.min(1, (t1 - L.windup) / L.time);
  const want = L.dist * (dashCurve(u1) - dashCurve(u0));
  const x0 = ecs.x[e], z0 = ecs.z[e];
  const steps = Math.max(1, Math.ceil(want / 0.3));
  let moved = 0;
  for (let s = 0; s < steps; s++) moved += moveWithCollision(world, e, (ecs.castX[e] * want) / steps, (ecs.castZ[e] * want) / steps);
  ecs.lungeCov[e] += moved;
  const x1 = ecs.x[e], z1 = ecs.z[e];
  // Parryables near the path are cut down (the blade clears the line).
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt) || H.type[s] !== PTYPE.PARRY) continue;
    const x = H.px(s, pt), z = H.pz(s, pt);
    if (segDist(x, z, x0, z0, x1, z1) > L.width + H.r[s]) continue;
    H.remove(s, pt, KILL.DESTROY, e, seq);
    addRiposte(ecs, e, P.riposte.destroy);
    world.emit({ type: 'destroy', pid: H.id[s], e, seq, x, z, skill: 'lunge' });
  }
  if (world.isServer) world.lungeHits(e, x0, z0, x1, z1, pt, seq);
}

// ---- Sable: Hoja de viento ------------------------------------------------------------------------------
function throwWave(world, e, pt, seq) {
  const ecs = world.ecs, W = SKILLS.wave;
  const dx = ecs.castX[e], dz = ecs.castZ[e];
  const x = ecs.x[e] + dx * 0.5, z = ecs.z[e] + dz * 0.5;
  const maxD = W.speed * W.life;
  const d = clipDistance(world.map, x, ecs.y[e] + 1.0, z, dx, dz, 0.4, maxD);
  ecs.waveT0[e] = pt; ecs.waveX[e] = x; ecs.waveZ[e] = z; ecs.waveDx[e] = dx; ecs.waveDz[e] = dz;
  ecs.waveEnd[e] = pt + Math.max(1, Math.round(d / W.speed / DT));
  ecs.waveId[e] = seq; ecs.waveN[e] = 0;
  world.emit({ type: 'wave', e, id: seq, seq, x, z, dx, dz, tick: pt, end: ecs.waveEnd[e], speed: W.speed, w: W.half });
}

// How far the crescent's front is from its origin at tick t.
export function waveFront(ecs, e, t) {
  const W = SKILLS.wave;
  const tt = Math.max(ecs.waveT0[e], Math.min(ecs.waveEnd[e], t));
  return W.speed * (tt - ecs.waveT0[e]) * DT;
}

// The crescent sweeps from where its front was at `prev` to where it is at `pt`: what it crossed.
export function stepWave(world, e, prev, pt, seq) {
  const ecs = world.ecs;
  if (!(ecs.waveT0[e] > 0)) return;
  const H = world.hazards, W = SKILLS.wave;
  const ox = ecs.waveX[e], oz = ecs.waveZ[e], dx = ecs.waveDx[e], dz = ecs.waveDz[e];
  const f0 = waveFront(ecs, e, Math.max(prev, ecs.waveT0[e])), f1 = waveFront(ecs, e, pt);
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt) || H.type[s] !== PTYPE.PARRY) continue;
    const rx = H.px(s, pt) - ox, rz = H.pz(s, pt) - oz;
    const a = rx * dx + rz * dz, l = Math.abs(rx * dz - rz * dx);
    if (a < f0 - W.depth - H.r[s] || a > f1 + H.r[s] || l > W.half + H.r[s]) continue;
    H.remove(s, pt, KILL.DESTROY, e, seq);
    const gain = Math.min(W.riposte, W.riposteMax - ecs.waveN[e]);
    if (gain > 0) { addRiposte(ecs, e, gain); ecs.waveN[e] += gain; }
    world.emit({ type: 'destroy', pid: H.id[s], e, seq, x: H.px(s, pt), z: H.pz(s, pt), skill: 'wave' });
  }
  if (world.isServer) world.crescentHits(e, f0, f1, pt, seq);
  if (pt >= ecs.waveEnd[e]) ecs.waveT0[e] = 0;
}

// ---- Pistolas: Descarga -----------------------------------------------------------------------------
function fireBlast(world, e, pt, seq) {
  const ecs = world.ecs, H = world.hazards, B = SKILLS.blast;
  const f = Math.atan2(ecs.castX[e], ecs.castZ[e]), dx = ecs.castX[e], dz = ecs.castZ[e];
  const x = ecs.x[e] + dx * 0.6, y = ecs.y[e] + 1.1, z = ecs.z[e] + dz * 0.6;
  for (let k = 0; k < B.n; k++) {
    const a = f + (k - (B.n - 1) / 2) * (B.arc / Math.max(1, B.n - 1)) * Math.PI / 180;
    world.spawnShot(e, {
      key: -(seq * 8 + k + 1), pid: 0, type: PTYPE.PARRY, x, y, z, dx: Math.sin(a), dz: Math.cos(a), speed: B.speed,
      dmg: ecs.atk[e] * B.mult, life: B.life, r: B.r, heavy: false, seq, bounce: 0, homing: 0, cone: 0, kind: SHOT.PELLET, knock: B.knock, pt,
    });
  }
  // The blast blows away the parryables in front of you.
  const half = Math.cos((B.clearArc / 2) * Math.PI / 180);
  let gained = 0;
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt) || H.type[s] !== PTYPE.PARRY) continue;
    const hx = H.px(s, pt), hz = H.pz(s, pt), rx = hx - ecs.x[e], rz = hz - ecs.z[e], d = Math.hypot(rx, rz);
    if (d > B.clearR + H.r[s] || (d > 0.5 && (rx * dx + rz * dz) / d < half)) continue;
    H.remove(s, pt, KILL.DESTROY, e, seq);
    const g = Math.min(B.riposte, B.riposteMax - gained);
    if (g > 0) { addRiposte(ecs, e, g); gained += g; }
    world.emit({ type: 'destroy', pid: H.id[s], e, seq, x: hx, z: hz, skill: 'blast' });
  }
  ecs.kbx[e] -= dx * B.recoil; ecs.kbz[e] -= dz * B.recoil;
  world.emit({ type: 'blast', e, seq, x, z, dx, dz });
}

// ---- Pistolas: Paso de humo -----------------------------------------------------------------------------
function blink(world, e, cmd, seq) {
  const ecs = world.ecs, B = SKILLS.blink;
  let dx = cmd.mx || 0, dz = cmd.mz || 0;
  const len = Math.hypot(dx, dz);
  if (len > 0.1) { dx /= len; dz /= len; } else { dx = ecs.castX[e]; dz = ecs.castZ[e]; }
  const x0 = ecs.x[e], z0 = ecs.z[e], step = 0.3;
  for (let d = 0; d < B.dist - 1e-9; d += step) {
    const s = Math.min(step, B.dist - d);
    if (moveWithCollision(world, e, dx * s, dz * s) < s * 0.5) break; // a rock, a cliff, deep water
  }
  ecs.iframes[e] = Math.max(ecs.iframes[e], B.iframes);
  ecs.facing[e] = Math.atan2(dx, dz);
  world.emit({ type: 'blink', e, seq, x0, z0, x1: ecs.x[e], z1: ecs.z[e] });
}

// ---- Pistolas: Lluvia de plomo ---------------------------------------------------------------------------
// How long it falls and how wide (the pistols' «Diluvio» at mastery 10 makes it longer and wider).
export const rainDur = (ecs, e) => SKILLS.rain.dur + passive(ecs, e, 'rainDur');
export const rainR = (ecs, e) => SKILLS.rain.r + passive(ecs, e, 'rainR');

// R with a full meter: the zone goes where you aim (at most `range` away) and starts after `delay`.
export function callRain(world, e, cmd, pt, seq) {
  const ecs = world.ecs, R = SKILLS.rain;
  let ax = (cmd.ax || 0) - ecs.x[e], az = (cmd.az || 0) - ecs.z[e];
  const d = Math.hypot(ax, az);
  if (d > R.range) { ax *= R.range / d; az *= R.range / d; }
  ecs.riposte[e] = 0;
  ecs.rainX[e] = ecs.x[e] + ax; ecs.rainZ[e] = ecs.z[e] + az;
  ecs.rainT0[e] = pt + Math.max(1, Math.round(R.delay / DT));
  ecs.rainId[e] = seq;
  if (d > 0.3) ecs.facing[e] = Math.atan2(ax, az);
  world.emit({ type: 'rain', e, id: seq, seq, x: ecs.rainX[e], z: ecs.rainZ[e], tick: ecs.rainT0[e], dur: rainDur(ecs, e), r: rainR(ecs, e) });
}

// The rain falls from rainT0 for `dur`: parryables inside are erased; every `every` s it hits (server).
export function stepRain(world, e, prev, pt, seq) {
  const ecs = world.ecs;
  if (!(ecs.rainT0[e] > 0)) return;
  const R = SKILLS.rain, H = world.hazards, t0 = ecs.rainT0[e];
  const end = t0 + Math.round(rainDur(ecs, e) / DT), every = Math.max(1, Math.round(R.every / DT)), rr = rainR(ecs, e);
  if (pt >= t0) {
    const cx = ecs.rainX[e], cz = ecs.rainZ[e];
    for (let s = 0; s < H.cap; s++) {
      if (!H.live(s, pt) || H.type[s] !== PTYPE.PARRY) continue;
      const hx = H.px(s, pt), hz = H.pz(s, pt);
      if (Math.hypot(hx - cx, hz - cz) > rr + H.r[s]) continue;
      H.remove(s, pt, KILL.DESTROY, e, seq);
      world.emit({ type: 'destroy', pid: H.id[s], e, seq, x: hx, z: hz, skill: 'rain' });
    }
    if (world.isServer) {
      const last = Math.min(pt, end - 1);
      for (let k = Math.max(0, Math.ceil((prev + 1 - t0) / every)); t0 + k * every <= last; k++) world.rainHits(e, t0 + k * every, seq);
    }
  }
  if (pt >= end - 1) ecs.rainT0[e] = 0;
}

// The pistol's basic shot: alternating hands, a hair of deterministic spread.
export function firePistol(world, e, pt, seq) {
  const ecs = world.ecs, P = SKILLS.pistol;
  const hand = ecs.shotN[e] % 2 ? 1 : -1;
  const f = ecs.facing[e] + (hash01(seq, ecs.shotN[e], 7) * 2 - 1) * P.spread * Math.PI / 180;
  const dx = Math.sin(f), dz = Math.cos(f);
  const fx = Math.sin(ecs.facing[e]), fz = Math.cos(ecs.facing[e]);
  const x = ecs.x[e] + fx * 0.55 + fz * P.side * hand, z = ecs.z[e] + fz * 0.55 - fx * P.side * hand;
  world.spawnShot(e, {
    key: -(seq * 8 + 5), pid: 0, type: PTYPE.PARRY, x, y: ecs.y[e] + 1.15, z, dx, dz, speed: P.speed,
    dmg: ecs.atk[e] * P.mult, life: P.life, r: P.r, heavy: false, seq, bounce: 0, homing: 0, cone: 0, kind: SHOT.BULLET, pt,
  });
  ecs.shotN[e] += 1;
  ecs.shotCd[e] = P.every * ecs.fireMul[e]; // trabucos are slower, «Gatillo fácil» faster
  world.emit({ type: 'fire', e, seq, hand, x, z, dx, dz });
}

// Distance from (px, pz) to the segment (ax, az)–(bx, bz).
function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}
export { segDist as skillSegDist };
