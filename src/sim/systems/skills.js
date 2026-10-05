// Weapons and their skills (M3.5). One step per command, after movement, inside stepPlayerCombat:
// shared verbatim by the server and the client's prediction, like the rest of player combat. Anything
// that touches hostile bullets runs here, at the command's projectile tick, so prediction replays it;
// hits on enemies are server-only (world.lungeHits / world.crescentHits).
//
//   Equip  cmd.w = weapon + 1. Only next to a rack (map.racks, RACK_R): a swing, the guard and a cast in
//          progress are dropped; the cooldowns carry over; the new weapon's loadout (below) takes the slots.
//   Slots  Q / E hold a skill each (M4.7, data/tattoos.js): an art of the weapon (the four below) or a learned
//          tattoo. ecs.skQ / skE (index into SKILL_IDS) + form + rank say which; skillOf(slot) reads them
//          (`basic` and `r` still come from the weapon). Loadouts live in the profile; the server changes them
//          with the loadout / form / learn commands (systems/inventory.js). An id with no numbers in SKILLS (no
//          cast) is not buffered: pressing it does nothing (no event, no cooldown). A tattoo's numbers depend on
//          its form (skillNum / formed) and its damage on its rank (tattooMul).
//   Cast   Q / E (buffered like LMB) start the slot's skill at the cursor when it is off cooldown and
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
//   Tattoos (M4.7, any weapon; the forms in data/weapons.js)
//          Tromba (ground): after a short windup a column of water lands `delay` s later on the aim point (≤ 10 u):
//          erases parryables, stuns. A: a whirlpool lingers (pulls, hits, erases). B: a second column follows.
//          Abordaje (ground): a leap (i-frames, no collision in the air) to the last standable point of the line to
//          the aim point; the landing slams, knocks back and erases parryables. A «Parpadeo»: a blink instead, and
//          the next basic attack is a crit. B: higher, wider, stuns.
//          Timón (charge): Q / E HELD (cmd.btn) charges, releasing throws a wheel: fast and short when tapped, slow,
//          long and heavy when charged. It goes out decelerating, comes back to you (catch it for a cooldown
//          refund), hits each enemy once each way and erases the parryables it crosses.
//          Their effects in flight (stepTromba, stepWheel) keep running whatever you do, like the crescent and the
//          rain: everything that touches hostile bullets is here at the command's tick; hits are the server's.
import { tuning, DT } from '../../data/tuning.js';
import { WEAPON_KINDS, RACK_R, SKILLS, weaponOf, formed } from '../../data/weapons.js';
import { PTYPE, KILL, SHOT, clipDistance } from '../projectiles.js';
import { hash01 } from '../../core/rng.js';
import { BTN, moveWithCollision, canStand } from './movement.js';
import { ACT } from '../ecs.js';
import { kitUnlocked, passive, applyLoadout } from './stats.js';
import { SLOTS, SLOT_COLS, TATTOO, slotSkill } from '../../data/tattoos.js';
import { addInkCloud } from './ink.js';

export const CAST = { NONE: 0, Q: 1, E: 2, G: 3 };
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
  if (world.onRack) world.onRack(e, want); // the server swaps the weapon item too (systems/inventory.js)
  return true;
}

export function setWeapon(world, e, w, seq = 0) {
  const ecs = world.ecs;
  ecs.weapon[e] = w;
  ecs.atkStage[e] = 0; ecs.atkBuf[e] = 0; ecs.lastStage[e] = 0;
  ecs.guardT[e] = -1;
  cancelCast(ecs, e);
  ecs.qBuf[e] = ecs.eBuf[e] = 0; ecs.shotCd[e] = 0; ecs.shotN[e] = 0;
  applyLoadout(world, e); // each weapon keeps its own loadout (a profile-less player: the weapon's arts)
  world.emit({ type: 'equip', e, weapon: w, seq, x: ecs.x[e], z: ecs.z[e] });
}

// The skill in a slot: 'q' / 'e' read the loadout columns (an art or a tattoo); 'basic' and 'r' are the weapon's.
export const skillOf = (ecs, e, slot) => (SLOT_COLS[slot] ? slotSkill(ecs, e, slot) : weaponOf(ecs.weapon[e])[slot]);
const castSlot = (k) => SLOTS[k - 1]; // castK 1 = the first slot (Q), 2 = E
const SLOT_BTN = { q: BTN.Q, e: BTN.E, g: BTN.G }; // the held bit of each slot in cmd.btn (a charge ends when it lets go)

// The numbers of the skill in a slot, in the form it is set to (arts: the base).
export const skillNum = (ecs, e, slot) => formed(slotSkill(ecs, e, slot), ecs[SLOT_COLS[slot].fm][e]);
// A tattoo's damage factor: + TATTOO.dmg per rank above I, read from the rank column of the slot that holds it.
export function tattooMul(ecs, e, id) {
  for (const slot of SLOTS) if (slotSkill(ecs, e, slot) === id) return 1 + TATTOO.dmg * Math.max(0, ecs[SLOT_COLS[slot].rk][e] - 1);
  return 1;
}

// Seconds a cast takes: [windup, active, recover]. S: the numbers in the form in use.
function phases(id, S = SKILLS[id]) {
  if (id === 'lunge' || id === 'comet') return [S.windup, S.time, S.recover];
  if (id === 'wave') return [S.windup, 0, S.recover];
  if (id === 'blast') return [S.windup, 0, S.root];
  if (id === 'blink') return [0, 0, S.recover];
  if (id === 'tromba') return [S.windup, 0, S.recover];
  if (id === 'iceanchor') return [S.windup, 0, S.recover];
  if (id === 'inkcloud') return [S.windup, 0, S.recover];
  if (id === 'mastbolt') return [0, 0, 0];
  if (id === 'leap') return [S.windup, S.blink ? 0 : S.air, S.recover];
  return [0, 0, 0]; // the wheel's charge has no fixed phases: it lasts as long as you hold
}
// Does the skill have a cast (phases or a charge)? An id with no numbers is skipped.
export const castable = (id) => { const S = SKILLS[id]; return !!S && (S.charge > 0 || phases(id, S).some((t) => t > 0)); };
export const castBusy = (ecs, e) => ecs.castK[e] > 0;

export function cancelCast(ecs, e) {
  // A leap cut short in the air (something that ignores i-frames) still lands where it was going: never on water.
  if (ecs.castK[e] > 0 && !ecs.chg[e] && skillOf(ecs, e, castSlot(ecs.castK[e])) === 'leap') {
    const S = skillNum(ecs, e, castSlot(ecs.castK[e]));
    if (!S.blink && ecs.castT[e] > S.windup && ecs.castT[e] < S.windup + S.air) { ecs.x[e] = ecs.lpX1[e]; ecs.z[e] = ecs.lpZ1[e]; }
  }
  ecs.castK[e] = 0; ecs.castT[e] = 0; ecs.castLock[e] = 0; ecs.chg[e] = 0;
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
  for (const [bit, slot] of PRESSES) {
    if (!(cmd.prs & bit)) continue;
    if (!kitUnlocked(ecs, e, slot)) world.emit({ type: 'locked', e, seq, slot });
    else if (castable(skillOf(ecs, e, slot))) ecs[SLOT_COLS[slot].buf][e] = ib;
  }
}
const PRESSES = [[BTN.Q, 'q'], [BTN.E, 'e'], [BTN.G, 'g']];
export const skillWanted = (ecs, e) => SLOTS.some((s) => ecs[SLOT_COLS[s].buf][e] > 0 && ecs[SLOT_COLS[s].cd][e] <= 0);

// Start a buffered Q or E (the caller checked you are free to act). Returns true when one started.
export function tryCast(world, e, cmd, seq) {
  const ecs = world.ecs;
  let k = 0;
  for (let i = 0; i < SLOTS.length && !k; i++) {
    const c = SLOT_COLS[SLOTS[i]];
    if (ecs[c.buf][e] > 0 && ecs[c.cd][e] <= 0) k = i + 1;
  }
  if (!k) return false;
  const slot = castSlot(k), c = SLOT_COLS[slot], id = skillOf(ecs, e, slot);
  if (!castable(id)) { ecs[c.buf][e] = 0; return false; } // no cast (yet): nothing happens, nothing is spent
  const S = skillNum(ecs, e, slot), charge = S.charge > 0;
  ecs[c.buf][e] = 0;
  if (!charge) ecs[c.cd][e] = S.cd * (1 - ecs.cdr[e]); // gear: Enfriamiento. A charge pays when it is thrown
  ecs.atkStage[e] = 0; ecs.atkBuf[e] = 0; ecs.guardT[e] = -1;
  faceAim(ecs, e, cmd);
  const [w, a] = phases(id, S);
  ecs.castK[e] = k; ecs.castT[e] = 0;
  ecs.castX[e] = Math.sin(ecs.facing[e]); ecs.castZ[e] = Math.cos(ecs.facing[e]);
  ecs.castLock[e] = charge ? 0 : w + a; // a dash cancels a charge (with no cooldown); it cannot interrupt the others
  ecs.faceLock[e] = w + a + 0.05;
  ecs.lungeCov[e] = 0;
  ecs.chg[e] = charge ? 1 : 0;
  const ev = { type: 'cast', e, skill: id, seq, x: ecs.x[e], z: ecs.z[e], dx: ecs.castX[e], dz: ecs.castZ[e] };
  if (id === 'lunge' || id === 'comet') { ecs.vx[e] = 0; ecs.vz[e] = 0; } // the lunge is all the movement there is
  else if (id === 'leap') planLeap(world, e, cmd, S, ecs[c.fm][e], ev);
  ecs.swingId[e] += 1; // a fresh key for the server's once-per-attack hit bookkeeping
  world.emit(ev);
  return true;
}

// One step of the skill being cast (castK > 0).
export function stepCast(world, e, cmd, dt, pt, seq) {
  const ecs = world.ecs, slot = castSlot(ecs.castK[e]), id = skillOf(ecs, e, slot);
  const S = skillNum(ecs, e, slot);
  if (S.charge > 0) { stepCharge(world, e, cmd, dt, pt, seq, slot, S); return; }
  const [w, a, r] = phases(id, S);
  const t0 = ecs.castT[e];
  ecs.castT[e] += dt;
  const t1 = ecs.castT[e];
  if (id === 'lunge' && t1 > w && t0 < w + a) lungeStep(world, e, t0, t1, pt, seq);
  else if (id === 'comet' && t1 > w && t0 < w + a) cometStep(world, e, t0, t1, pt, seq);
  else if (id === 'leap' && !S.blink && t1 > w && t0 < w + a) leapAir(world, e, S, slot, t0, t1, pt, seq);
  if (t0 <= w && t1 > w) {
    if (id === 'wave') throwWave(world, e, pt, seq);
    else if (id === 'blast') fireBlast(world, e, pt, seq);
    else if (id === 'blink') blink(world, e, cmd, seq);
    else if (id === 'tromba') castTromba(world, e, cmd, S, ecs[SLOT_COLS[slot].fm][e], pt, seq);
    else if (id === 'iceanchor') castIceanchor(world, e, cmd, S, pt, seq);
    else if (id === 'inkcloud') castInkcloud(world, e, cmd, S, pt, seq);
    else if (id === 'leap' && S.blink) leapBlink(world, e, cmd, S, seq);
  }
  if (t1 >= w + a + r) cancelCast(ecs, e);
}

// Movement multiplier and animation of a cast (null when nothing is being cast).
export function castPose(ecs, e) {
  if (!(ecs.castK[e] > 0)) return null;
  const slot = castSlot(ecs.castK[e]), id = skillOf(ecs, e, slot);
  if (id === 'lunge' || id === 'comet') return { move: 0, act: ACT.LUNGE };
  if (id === 'wave') return { move: ecs.castT[e] < SKILLS.wave.windup ? 0.3 : 0.6, act: ACT.THROW };
  if (id === 'blast') return { move: 0, act: ACT.BLAST };
  if (id === 'tromba' || id === 'iceanchor' || id === 'inkcloud' || id === 'leap' || id === 'wheel' || id === 'mastbolt') {
    const S = skillNum(ecs, e, slot);
    if (id === 'tromba') return { move: ecs.castT[e] < S.windup ? S.move : 1, act: ACT.CAST };
    if (id === 'iceanchor') return { move: ecs.castT[e] < S.windup ? S.move : 1, act: ACT.CAST };
    if (id === 'inkcloud') return { move: ecs.castT[e] < S.windup ? S.move : 1, act: ACT.CAST };
    if (id === 'wheel') return { move: S.move, act: ACT.CHARGE };
    if (id === 'mastbolt') return { move: S.move, act: ACT.CHARGE };
    if (S.blink) return { move: 1, act: ACT.CAST };
    return { move: ecs.castT[e] < S.windup + S.air ? 0 : 0.5, act: ACT.LEAP };
  }
  return { move: 1, act: ACT.CAST };
}

// ---- Sable: Estocada ------------------------------------------------------------------------------------
function cometStep(world, e, t0, t1, pt, seq) {
  const ecs = world.ecs, S = SKILLS.comet;
  const u0 = Math.max(0, (t0 - S.windup) / S.time), u1 = Math.min(1, (t1 - S.windup) / S.time);
  const want = S.dist * (dashCurve(u1) - dashCurve(u0)), x0 = ecs.x[e], z0 = ecs.z[e];
  const steps = Math.max(1, Math.ceil(want / 0.25));
  for (let i = 0; i < steps; i++) moveWithCollision(world, e, ecs.castX[e] * want / steps, ecs.castZ[e] * want / steps);
  const x1 = ecs.x[e], z1 = ecs.z[e];
  clearParry(world, e, onSegment(x0, z0, x1, z1, S.width), pt, seq, 'comet', 0, 0);
  if (world.isServer) world.pathHits(e, x0, z0, x1, z1, S.width, S.mult, ecs.swingId[e], { skill: 'comet', knock: 4, fire: 1 }, pt, seq);
  if (world.isServer && Math.hypot(x1 - x0, z1 - z0) > 0.05) {
    const trails = world.fireTrails || (world.fireTrails = []);
    if (trails.length < 256) trails.push({ e, x0, z0, x1, z1, castId: ecs.swingId[e],
      next: (Math.floor(world.tick / 30) + 1) * 30, until: world.tick + 120, pirateId: world.profiles?.get(e)?.pirateId || '' });
  }
  if (Math.hypot(x1 - x0, z1 - z0) > 0.05) world.emit({ type: 'cometTrail', e, seq, x0, z0, x1, z1, elem: 1 });
}

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
// A collision-stepped teleport of up to `dist` u along (dx, dz) with i-frames (also Abordaje's Parpadeo).
function blinkStep(world, e, dx, dz, dist, iframes, seq) {
  const ecs = world.ecs;
  const x0 = ecs.x[e], z0 = ecs.z[e], step = 0.3;
  for (let d = 0; d < dist - 1e-9; d += step) {
    const s = Math.min(step, dist - d);
    if (moveWithCollision(world, e, dx * s, dz * s) < s * 0.5) break; // a rock, a cliff, deep water
  }
  ecs.iframes[e] = Math.max(ecs.iframes[e], iframes);
  ecs.facing[e] = Math.atan2(dx, dz);
  world.emit({ type: 'blink', e, seq, x0, z0, x1: ecs.x[e], z1: ecs.z[e] });
}

function blink(world, e, cmd, seq) {
  const ecs = world.ecs, B = SKILLS.blink;
  let dx = cmd.mx || 0, dz = cmd.mz || 0;
  const len = Math.hypot(dx, dz);
  if (len > 0.1) { dx /= len; dz /= len; } else { dx = ecs.castX[e]; dz = ecs.castZ[e]; }
  blinkStep(world, e, dx, dz, B.dist, B.iframes, seq);
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
  const emp = takeEmpower(ecs, e); // the first shot after a Parpadeo: × empMult, a crit
  world.spawnShot(e, {
    key: -(seq * 8 + 5), pid: 0, type: PTYPE.PARRY, x, y: ecs.y[e] + 1.15, z, dx, dz, speed: P.speed,
    dmg: ecs.atk[e] * P.mult * (emp || 1), life: P.life, r: P.r, heavy: false, seq, bounce: 0, homing: 0, cone: 0, kind: SHOT.BULLET, pt, crit: emp > 0,
  });
  ecs.shotN[e] += 1;
  ecs.shotCd[e] = P.every * ecs.fireMul[e]; // trabucos are slower, «Gatillo fácil» faster
  world.emit({ type: 'fire', e, seq, hand, x, z, dx, dz });
}

// ---- Tattoos (M4.7 P3) ----------------------------------------------------------------------------------
// Erases the live parryables that `near(x, z, r)` accepts at tick pt: each gives `per` RIPOSTE while the cast has
// given less than `left` more (returns what it gave). The shared bullet clearing of the three tattoos.
function clearParry(world, e, near, pt, seq, skill, per, left) {
  const ecs = world.ecs, H = world.hazards;
  let got = 0;
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt) || H.type[s] !== PTYPE.PARRY) continue;
    const hx = H.px(s, pt), hz = H.pz(s, pt);
    if (!near(hx, hz, H.r[s])) continue;
    H.remove(s, pt, KILL.DESTROY, e, seq);
    const g = Math.min(per, left - got);
    if (g > 0) { addRiposte(ecs, e, g); got += g; }
    world.emit({ type: 'destroy', pid: H.id[s], e, seq, x: hx, z: hz, skill });
  }
  return got;
}
const inCircle = (x, z, r) => (hx, hz, hr) => Math.hypot(hx - x, hz - z) <= r + hr;
const onSegment = (x0, z0, x1, z1, r) => (hx, hz, hr) => segDist(hx, hz, x0, z0, x1, z1) <= r + hr;

// The aim point of cmd clamped to [min, max] from you (straight ahead at `min` when you aim at your feet).
function aimAt(ecs, e, cmd, min, max) {
  let dx = (cmd.ax || 0) - ecs.x[e], dz = (cmd.az || 0) - ecs.z[e];
  let d = Math.hypot(dx, dz);
  if (d < 1e-3) { dx = ecs.castX[e]; dz = ecs.castZ[e]; d = 1; }
  const k = Math.max(min, Math.min(max, d)) / d;
  return [ecs.x[e] + dx * k, ecs.z[e] + dz * k];
}
const ticks = (s) => Math.max(1, Math.round(s / DT));

function castIceanchor(world, e, cmd, S, pt, seq) {
  const ecs = world.ecs, [x, z] = aimAt(ecs, e, cmd, 0, S.range);
  const owner = world.fieldOwner || e, t0 = pt, tEnd = pt + ticks(S.dur);
  ecs.icX[e] = x; ecs.icZ[e] = z; ecs.icT0[e] = t0; ecs.icEnd[e] = tEnd; ecs.icSeq[e] = seq;
  const field = { type: 'frostField', e: owner, seq, x, z, r: S.r, t0, tEnd, slow: S.slow, predicted: !world.isServer };
  world.hazards.addFrostField(field);
  world.emit(field);
}

function castInkcloud(world, e, cmd, S, pt, seq) {
  const ecs = world.ecs, [x, z] = aimAt(ecs, e, cmd, 0, S.range);
  const owner = world.fieldOwner || e, t0 = pt, tEnd = pt + ticks(S.dur);
  ecs.inkX[e] = x; ecs.inkZ[e] = z; ecs.inkT0[e] = t0; ecs.inkEnd[e] = tEnd; ecs.inkSeq[e] = seq;
  const field = { type: 'inkCloud', e: owner, seq, x, z, r: S.r, t0, tEnd, predicted: !world.isServer };
  addInkCloud(world, field);
  world.emit(field);
}

// ---- Tromba ----------------------------------------------------------------------------------------------
// The end of the windup: the column will land `delay` s later on the aim point. trT0 > 0: the impact tick, still to
// come; < 0: it landed (at −trT0) and a whirlpool (trEnd) or the twin (trT1) may still be pending.
function castTromba(world, e, cmd, S, form, pt, seq) {
  const ecs = world.ecs, [x, z] = aimAt(ecs, e, cmd, S.min || 0, S.range);
  ecs.trT0[e] = pt + ticks(S.delay); ecs.trX[e] = x; ecs.trZ[e] = z; ecs.trId[e] = seq; ecs.trF[e] = form;
  ecs.trEnd[e] = 0; ecs.trT1[e] = 0; ecs.trN[e] = 0;
  world.emit({ type: 'tromba', e, id: seq, seq, x, z, tick: ecs.trT0[e], r: S.r, form, n: 0 });
}

// A column lands at (x, z): erases the parryables under it, stuns and knocks up what it hits (server).
function trombaImpact(world, e, x, z, S, T, pt, seq, n) {
  const ecs = world.ecs;
  ecs.trN[e] += clearParry(world, e, inCircle(x, z, S.r), pt, seq, 'tromba', S.riposte, S.riposteMax - ecs.trN[e]);
  if (world.isServer) world.areaHits(e, x, z, S.r, S.mult * tattooMul(ecs, e, 'tromba'), { stun: S.lift, knock: S.knock, skill: 'tromba', heavy: true }, T, seq);
  world.emit({ type: 'trombaHit', e, id: ecs.trId[e], seq, x, z, r: S.r, form: ecs.trF[e], n });
}

// The Tromba in flight (keeps going whatever you do): the impact, the whirlpool of «Ojo de tormenta», the second
// column of «Gemelas» (aimed where you aim when the first one lands).
export function stepTromba(world, e, cmd, prev, pt, seq) {
  const ecs = world.ecs;
  if (!ecs.trT0[e]) return;
  const S = formed('tromba', ecs.trF[e]);
  if (ecs.trT0[e] > 0) {
    if (pt < ecs.trT0[e]) return;
    const T = ecs.trT0[e];
    trombaImpact(world, e, ecs.trX[e], ecs.trZ[e], S, T, pt, seq, 0);
    ecs.trT0[e] = -T;
    if (S.linger > 0) ecs.trEnd[e] = T + ticks(S.linger);
    if (S.twin) {
      const [x, z] = aimAt(ecs, e, cmd, S.min || 0, S.range);
      ecs.trT1[e] = T + ticks(S.gap); ecs.trX1[e] = x; ecs.trZ1[e] = z;
      world.emit({ type: 'tromba', e, id: ecs.trId[e], seq, x, z, tick: ecs.trT1[e], r: S.r, form: ecs.trF[e], n: 1 });
    }
  } else if (ecs.trEnd[e] > 0) {
    // The whirlpool: erases what drifts in, pulls enemies to the centre and hits every `every` s (server).
    const T0 = -ecs.trT0[e], x = ecs.trX[e], z = ecs.trZ[e], end = ecs.trEnd[e];
    ecs.trN[e] += clearParry(world, e, inCircle(x, z, S.r), pt, seq, 'tromba', S.riposte, S.riposteMax - ecs.trN[e]);
    if (world.isServer) {
      const every = ticks(S.every), last = Math.min(pt, end), m = S.mult * S.tick * tattooMul(ecs, e, 'tromba');
      for (let k = Math.max(1, Math.ceil((prev + 1 - T0) / every)); T0 + k * every <= last; k++) world.areaHits(e, x, z, S.r, m, { knock: 0, skill: 'tromba' }, T0 + k * every, seq);
      world.pullEnemies(x, z, S.r, S.pull * Math.max(1, Math.min(pt, end) - prev) * DT);
    }
    if (pt >= end) { ecs.trEnd[e] = 0; world.emit({ type: 'trombaEnd', e, id: ecs.trId[e], seq, x, z }); }
  }
  if (ecs.trT1[e] > 0 && pt >= ecs.trT1[e]) {
    trombaImpact(world, e, ecs.trX1[e], ecs.trZ1[e], S, ecs.trT1[e], pt, seq, 1);
    ecs.trT1[e] = 0;
  }
  if (ecs.trT0[e] < 0 && !ecs.trEnd[e] && !ecs.trT1[e]) ecs.trT0[e] = 0;
}

// ---- Abordaje ------------------------------------------------------------------------------------------------
// At the cast: where it lands. The leap flies over anything, so it is the farthest point of the line to the aim
// (min…range) where a pirate can stand (not water, rock or out of bounds); the blink (Parpadeo) just aims there.
function planLeap(world, e, cmd, S, form, ev) {
  const ecs = world.ecs, x0 = ecs.x[e], z0 = ecs.z[e];
  let [x1, z1] = aimAt(ecs, e, cmd, S.min, S.range);
  if (!S.blink) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.3);
    let k = n;
    while (k > 0 && !canStand(world, x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n, ecs.radius[e])) k--;
    x1 = x0 + ((x1 - x0) * k) / n; z1 = z0 + ((z1 - z0) * k) / n;
    ecs.iframes[e] = Math.max(ecs.iframes[e], S.windup + S.air);
    ev.air = S.air; ev.h = S.h;
  }
  if (Math.hypot(x1 - x0, z1 - z0) > 0.05) ecs.facing[e] = Math.atan2(x1 - x0, z1 - z0);
  ecs.castX[e] = Math.sin(ecs.facing[e]); ecs.castZ[e] = Math.cos(ecs.facing[e]);
  ecs.lpX0[e] = x0; ecs.lpZ0[e] = z0; ecs.lpX1[e] = x1; ecs.lpZ1[e] = z1;
  ecs.vx[e] = 0; ecs.vz[e] = 0;
  ev.dx = ecs.castX[e]; ev.dz = ecs.castZ[e];
  ev.x0 = x0; ev.z0 = z0; ev.x1 = x1; ev.z1 = z1; ev.form = form;
}

// In the air (windup → windup + air): no collision, eased along the line; crossing the end, the slam.
function leapAir(world, e, S, slot, t0, t1, pt, seq) {
  const ecs = world.ecs, u = Math.min(1, (t1 - S.windup) / S.air), k = u * u * (3 - 2 * u);
  ecs.x[e] = ecs.lpX0[e] + (ecs.lpX1[e] - ecs.lpX0[e]) * k;
  ecs.z[e] = ecs.lpZ0[e] + (ecs.lpZ1[e] - ecs.lpZ0[e]) * k;
  ecs.y[e] = world.map.groundAt(ecs.x[e], ecs.z[e]);
  if (u < 1) return;
  const x = ecs.x[e], z = ecs.z[e], form = ecs[SLOT_COLS[slot].fm][e];
  clearParry(world, e, inCircle(x, z, S.clearR), pt, seq, 'leap', S.riposte, S.riposteMax);
  if (world.isServer) world.areaHits(e, x, z, S.r, S.mult * tattooMul(ecs, e, 'leap'), { knock: S.knock, stun: S.stun || 0, skill: 'leap', heavy: true }, pt, seq);
  world.emit({ type: 'slam', e, seq, x, z, r: S.r, form });
}

// «Parpadeo»: the blink toward the planned point, and the next basic attack within `emp` s is empowered.
function leapBlink(world, e, cmd, S, seq) {
  const ecs = world.ecs, dx = ecs.lpX1[e] - ecs.x[e], dz = ecs.lpZ1[e] - ecs.z[e], d = Math.hypot(dx, dz);
  if (d > 1e-3) blinkStep(world, e, dx / d, dz / d, d, S.iframes, seq);
  else blinkStep(world, e, ecs.castX[e], ecs.castZ[e], 0, S.iframes, seq);
  ecs.empT[e] = S.emp;
}

// The damage factor of the basic attack starting now: × empMult (and a crit) right after a Parpadeo, which it spends.
export function takeEmpower(ecs, e) {
  if (!(ecs.empT[e] > 0)) return 0;
  ecs.empT[e] = 0;
  return formed('leap', 1).empMult * tattooMul(ecs, e, 'leap');
}

// ---- Timón ---------------------------------------------------------------------------------------------------
// The charge (castK > 0, chg = 1): you face the aim and castT counts while the slot's key is held; letting go (a tap
// throws at once, k = 0) or maxHold throws. A dash, a stagger or death cancel it with no cooldown spent.
function stepCharge(world, e, cmd, dt, pt, seq, slot, S) {
  const ecs = world.ecs;
  faceAim(ecs, e, cmd);
  ecs.castX[e] = Math.sin(ecs.facing[e]); ecs.castZ[e] = Math.cos(ecs.facing[e]);
  const mastbolt = skillOf(ecs, e, slot) === 'mastbolt';
  if ((cmd.btn & SLOT_BTN[slot]) && ecs.castT[e] < S.maxHold) {
    ecs.castT[e] = mastbolt ? Math.min(S.maxHold, ecs.castT[e] + dt) : ecs.castT[e] + dt;
    if (!mastbolt || ecs.castT[e] < S.maxHold) return;
  }
  const k = Math.min(1, ecs.castT[e] / S.charge);
  if (mastbolt) throwMastbolt(world, e, S, k, pt, seq);
  else throwWheel(world, e, slot, S, k, pt, seq);
  cancelCast(ecs, e);
}

// The charged release predicts its own visual; the server independently resolves and broadcasts its hit chain.
function throwMastbolt(world, e, S, k, pt, seq) {
  const ecs = world.ecs, dx = ecs.castX[e], dz = ecs.castZ[e];
  const jumps = 1 + Math.floor(k * S.jumps);
  ecs.cdG[e] = S.cd * (1 - ecs.cdr[e]);
  world.emit({ type: 'mastbolt', e, seq, x: ecs.x[e], z: ecs.z[e], dx, dz, k, jumps, tick: pt });
  if (world.isServer) world.lightningHits(e, k, pt, seq);
}

// The throw: k = 0 fast and short … 1 slow, long and heavy (form B: wider, heavier, slower). A wall ahead shortens
// the range (it turns early). The flight is analytic out (whPh 1) and stepped back (3); 2 = hanging at the apex.
function throwWheel(world, e, slot, S, k, pt, seq) {
  const ecs = world.ecs, F = S.fast, L = S.slow, mix = (a, b) => a + (b - a) * k;
  const c = SLOT_COLS[slot], form = ecs[c.fm][e];
  if (ecs.whPh[e] > 0) world.emit({ type: 'wheelDrop', e, id: ecs.whId[e], seq, x: ecs.whX[e], z: ecs.whZ[e] });
  const dx = ecs.castX[e], dz = ecs.castZ[e];
  const x = ecs.x[e] + dx * 0.6, z = ecs.z[e] + dz * 0.6;
  const v0 = mix(F.speed, L.speed) * (S.speedMul || 1), r = mix(F.r, L.r) + (S.rAdd || 0);
  const R = Math.max(0.6, clipDistance(world.map, x, ecs.y[e] + 1.0, z, dx, dz, r, mix(F.range, L.range)));
  ecs[c.cd][e] = S.cd * (1 - ecs.cdr[e]);
  ecs.whT0[e] = pt; ecs.whX0[e] = x; ecs.whZ0[e] = z; ecs.whDx[e] = dx; ecs.whDz[e] = dz;
  ecs.whV[e] = v0; ecs.whR[e] = R; ecs.whRr[e] = r; ecs.whMul[e] = mix(F.mult, L.mult) * (S.multMul || 1) * tattooMul(ecs, e, 'wheel');
  ecs.whF[e] = form; ecs.whPh[e] = 1; ecs.whX[e] = x; ecs.whZ[e] = z; ecs.whS[e] = 0; ecs.whTb[e] = pt;
  ecs.whId[e] = seq; ecs.whN[e] = 0; ecs.whSlot[e] = SLOTS.indexOf(slot) + 1;
  world.emit({ type: 'wheel', e, id: seq, seq, x, z, dx, dz, v0, R, r, k, hang: S.hang || 0, tick: pt, form, slot });
}

// Ticks the wheel takes to reach its apex: s(t) = v0·t − v0²·t² / (4R) stops at R after 2R / v0.
const wheelOutTicks = (ecs, e) => ticks((2 * ecs.whR[e]) / ecs.whV[e]);
// How far out the wheel is at tick T (out phase).
export function wheelOut(ecs, e, T) {
  const v = ecs.whV[e], R = ecs.whR[e], t = Math.min(Math.max(0, T - ecs.whT0[e]), wheelOutTicks(ecs, e)) * DT;
  return Math.min(R, v * t - (v * v * t * t) / (4 * R));
}

// The wheel in flight (keeps going whatever you do; dropped when you die or after `life` s): each step sweeps from
// where it was to where it is, erasing the parryables it crosses and hitting (server) each enemy once out, once back.
export function stepWheel(world, e, prev, pt, seq) {
  const ecs = world.ecs;
  if (!(ecs.whPh[e] > 0)) return;
  const S = formed('wheel', ecs.whF[e]), id = ecs.whId[e];
  if (ecs.dead[e] > 0 || pt - ecs.whT0[e] > ticks(S.life)) {
    ecs.whPh[e] = 0;
    world.emit({ type: 'wheelDrop', e, id, seq, x: ecs.whX[e], z: ecs.whZ[e] });
    return;
  }
  const r = ecs.whRr[e], x0 = ecs.whX[e], z0 = ecs.whZ[e];
  const sweep = (x1, z1, back) => {
    ecs.whN[e] += clearParry(world, e, onSegment(x0, z0, x1, z1, r), pt, seq, 'wheel', S.riposte, S.riposteMax - ecs.whN[e]);
    if (world.isServer) world.pathHits(e, x0, z0, x1, z1, r, ecs.whMul[e], id * 2 + (back ? 1 : 0), { knock: S.knock || 1.5, skill: 'wheel' }, pt, seq);
    ecs.whX[e] = x1; ecs.whZ[e] = z1;
  };
  const toBack = () => { ecs.whPh[e] = 3; ecs.whTb[e] = pt; ecs.whS[e] = 0; world.emit({ type: 'wheelBack', e, id, seq, x: ecs.whX[e], z: ecs.whZ[e], tick: pt }); };
  if (ecs.whPh[e] === 1) {
    const s = wheelOut(ecs, e, pt);
    sweep(ecs.whX0[e] + ecs.whDx[e] * s, ecs.whZ0[e] + ecs.whDz[e] * s, false);
    if (pt - ecs.whT0[e] >= wheelOutTicks(ecs, e)) {
      if (S.hang > 0) { ecs.whPh[e] = 2; ecs.whTb[e] = pt; } else toBack();
    }
    return;
  }
  if (ecs.whPh[e] === 2) {
    // «Remolino»: it spins at the apex, erasing what drifts in and hitting every hangEvery s (server).
    const x = ecs.whX[e], z = ecs.whZ[e], T0 = ecs.whTb[e], every = ticks(S.hangEvery);
    ecs.whN[e] += clearParry(world, e, inCircle(x, z, S.hangR), pt, seq, 'wheel', S.riposte, S.riposteMax - ecs.whN[e]);
    if (world.isServer) {
      for (let k = Math.max(1, Math.ceil((prev + 1 - T0) / every)); T0 + k * every <= pt; k++) world.areaHits(e, x, z, S.hangR, ecs.whMul[e] * S.hangMult, { knock: 0, skill: 'wheel' }, T0 + k * every, seq);
    }
    if (pt - T0 >= ticks(S.hang)) toBack();
    return;
  }
  // Back: it homes on where you are now, speeding up to ret × max(v0, 14) in retRamp s, one tick at a time.
  const vRet = S.ret * Math.max(ecs.whV[e], 14);
  let x = x0, z = z0;
  for (let T = Math.max(prev, ecs.whTb[e]) + 1; T <= pt; T++) {
    const v = vRet * Math.min(1, ((T - ecs.whTb[e]) * DT) / S.retRamp);
    const dx = ecs.x[e] - x, dz = ecs.z[e] - z, d = Math.hypot(dx, dz), m = Math.min(d, v * DT);
    if (d > 1e-6) { x += (dx / d) * m; z += (dz / d) * m; }
    ecs.whS[e] = v;
  }
  sweep(x, z, true);
  if (Math.hypot(ecs.x[e] - x, ecs.z[e] - z) <= S.catchR) {
    ecs.whPh[e] = 0;
    const cd = SLOT_COLS[SLOTS[ecs.whSlot[e] - 1]]?.cd;
    if (cd && skillOf(ecs, e, SLOTS[ecs.whSlot[e] - 1]) === 'wheel') ecs[cd][e] *= 1 - S.refund;
    world.emit({ type: 'wheelCatch', e, id, seq, x, z });
  }
}

// Distance from (px, pz) to the segment (ax, az)–(bx, bz).
function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}
export { segDist as skillSegDist };
