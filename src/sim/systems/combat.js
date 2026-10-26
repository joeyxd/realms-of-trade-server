// Player combat, one fixed step per command (runs after movement in World.applyCommand).
// Shared verbatim by the server and the client's prediction: everything here reads the command and
// the analytic hostile projectiles at the command's projectile tick (pt), so both sides reach the
// same result. Hits on enemies are the one server-only part (world.isServer): the client gets
// them back as events.
//
//   LMB  3-hit combo: windup → active → recover. The active frames hit every hostile bullet in the arc:
//        how soon it would have touched you (tc) sets the tier of the reflect (M3.5): EXCELENTE (≤ 70 ms,
//        straight at the cursor, × 3, the only one that sends heavy orbs back), BUENO (≤ 150 ms, ± 10°),
//        POBRE (≤ 260 ms, ± 35°, × 1); anything farther is destroyed. Unstoppable spikes ignore the blade.
//   RMB  guard, held: blocks bullets and melee circles in front for a fraction of their damage and some
//        stamina (0 = GUARDIA ROTA, stunned). Raised just before a hit (PERFECT, 130 ms) it catches the
//        bullet (¡ATRAPADA!): the next swing throws every caught bullet back. Unstoppables pierce it.
//        Coyote: a parryable that touches you deals its damage 60 ms later; LMB in that gap is a POBRE
//        reflect, RMB a block.
//   R    riposte wave when the meter is full: reflects every projectile within 6 u.
//   Dash i-frames: projectiles pass through; dashing through an unstoppable spike = FANTASMA.
//   Graze: a projectile passing within 0.35 u of your hurtbox without touching = ROCE.
import { tuning, DT } from '../../data/tuning.js';
import { PEARL } from '../../data/pearls.js';
import { BTN, moveWithCollision, standingHeight } from './movement.js';
import { stepSwimming } from './swimming.js';
import { PTYPE, KILL, NEVER, SHOT, beamSeg, segDist, lavaR } from '../projectiles.js';
import { stepEquip, bufferSkills, skillWanted, tryCast, stepCast, castPose, castBusy, cancelCast, stepWave, skillOf, firePistol, firePistolSecondary, callRain, stepRain, stepTromba, stepWheel, takeEmpower, phases, skillNum } from './skills.js';
import { STATE, ACT, C as COMP, airborne, intangible, resetJump, resetGrab } from '../ecs.js';
import { hash01 } from '../../core/rng.js';
import { SKILLS } from '../../data/weapons.js';
import { CONSUMABLES } from '../../data/items.js';
import { LAWLESS, MELEE, MELEE_GUARD, MELEE_GRAB, MELEE_ROLL, MELEE_SMASH } from '../../data/lawless.js';
import { swingFrame, swingBusy, swingDescriptor, swingBlow, swingKey } from '../../data/meleeFrames.js';
import { knockback, hitlagFrames, hitstunFrames, launchSpeed, di, meleePercent, meleeStun } from '../meleeHit.js';
import { statsFor, refreshStats, kitUnlocked, passive, guardMax } from './stats.js';
import { respawnNeeds } from './survival.js';
import { staminaRegenMul } from '../../data/survival.js';
import { mealEffects } from '../../data/meals.js';
import { stepWaterCurse } from './pearlcombat.js';

const D2R = Math.PI / 180;
const TIERS = [null, 'poor', 'good', 'excellent'];
const tierCfg = (tier) => tuning.sword[TIERS[tier]];

export { statsFor };
export const xpToNext = (level) => tuning.stats.xp[Math.min(tuning.stats.xp.length - 1, Math.max(0, level - 1))];
export const mitigate = (dmg, def) => (dmg <= 0 ? 0 : Math.max(1, Math.round(dmg * (1 - def / (def + tuning.stats.defK)))));

// A new level: its stats (with the gear and mastery of a profile, systems/stats.js) and the dash charges.
export function applyLevel(world, e, level) {
  const ecs = world.ecs;
  ecs.level[e] = level;
  refreshStats(world, e);
  const dm = level >= 2 ? tuning.dash.chargesLv2 : tuning.dash.chargesBase;
  if (dm > ecs.dashMax[e]) ecs.dashCharges[e] += dm - ecs.dashMax[e];
  ecs.dashMax[e] = dm;
}

// XP (× the gear's bonus). The server also feeds it to the equipped weapon's mastery (world.onXp), even at
// the level cap.
export function gainXp(world, e, n, seq = 0) {
  const ecs = world.ecs;
  if (n <= 0) return;
  n *= ecs.xpMul[e];
  if (world.onXp) world.onXp(e, n, seq);
  if (ecs.level[e] >= tuning.stats.maxLevel) return;
  ecs.xp[e] += n;
  while (ecs.level[e] < tuning.stats.maxLevel && ecs.xp[e] >= xpToNext(ecs.level[e])) {
    ecs.xp[e] -= xpToNext(ecs.level[e]);
    applyLevel(world, e, ecs.level[e] + 1);
    ecs.hp[e] = ecs.maxHp[e];
    world.emit({ type: 'level', e, level: ecs.level[e], seq });
  }
}

const chainMul = (k, chain) => 1 + k * Math.max(0, chain - 1);

function faceAim(ecs, e, cmd) {
  const dx = (cmd.ax || 0) - ecs.x[e], dz = (cmd.az || 0) - ecs.z[e];
  if (dx * dx + dz * dz > 0.09) ecs.facing[e] = Math.atan2(dx, dz);
}

// Point (px, pz) inside the sector in front of e (radius rad, total arc in degrees)?
function inSector(ecs, e, px, pz, rad, arc) {
  const dx = px - ecs.x[e], dz = pz - ecs.z[e];
  const d2 = dx * dx + dz * dz;
  if (d2 > rad * rad) return false;
  if (arc >= 360 || d2 < 0.36) return true;
  const d = Math.sqrt(d2);
  return (dx * Math.sin(ecs.facing[e]) + dz * Math.cos(ecs.facing[e])) / d >= Math.cos((arc / 2) * D2R);
}

function addRiposte(ecs, e, n) {
  ecs.riposte[e] = Math.min(tuning.parry.riposte.max, ecs.riposte[e] + n * ecs.ripMul[e]);
}

const heldGrab = (ecs, e) => ecs.grabSt[e] === ACT.CAPTURE || ecs.grabSt[e] === ACT.THROWN;
const throwGrab = (st) => st === ACT.GRAB_THROW_F || st === ACT.GRAB_THROW_B;
const throwMove = (st) => st === ACT.GRAB_THROW_F ? 'fthrow' : 'bthrow';

// P3a: one paired hold, reconciled through PLAYER_FIELDS. Partner identities are server-owned.
function grabPose(ecs, e, st) {
  ecs.grabSt[e] = st; ecs.grabT[e] = 0; setAct(ecs, e, st);
  ecs.atkRej[e] = ecs.atkLink[e] = ecs.atkSmash[e] = ecs.chgN[e] = ecs.chgStop[e] = 0;
  ecs.atkStage[e] = ecs.atkBuf[e] = ecs.atkLatch[e] = ecs.qBuf[e] = ecs.eBuf[e] = ecs.gBuf[e] = ecs.rBuf[e] = 0;
  ecs.guardT[e] = -1; ecs.guardP[e] = ecs.guardLag[e] = ecs.guardStun[e] = ecs.dashBuffer[e] = 0;
  ecs.stagger[e] = ecs.faceLock[e] = ecs.dizzy[e] = ecs.dizzyIn[e] = ecs.brk[e] = ecs.grabDown[e] = ecs.state[e] = 0;
  ecs.dashT[e] = -1;
  ecs.vx[e] = ecs.vz[e] = ecs.lvx[e] = ecs.lvz[e] = ecs.kbx[e] = ecs.kbz[e] = ecs.moveMag[e] = ecs.moveMul[e] = 0;
  cancelCast(ecs, e);
}

export function beginGrab(world, e, cmd) {
  const ecs = world.ecs;
  if (world.meleeVersion !== 1) return;
  const shield = (skillOf(ecs, e, 'basic') !== 'pistol' && ((cmd.btn | cmd.prs) & BTN.GUARD))
    || (((cmd.btn | cmd.prs) & BTN.DASH) && (ecs.guardT[e] >= 0 || Math.hypot(cmd.mx || 0, cmd.mz || 0) < MELEE_ROLL.stick));
  if (ecs.rollT[e] || ecs.grabSt[e] || !(cmd.prs & BTN.ATTACK) || !shield
    || ecs.dead[e] || ecs.swim[e] || airborne(ecs, e) || ecs.dashT[e] >= 0
    || ecs.hitlag[e] || ecs.stagger[e] > 0 || ecs.guardLag[e] || ecs.guardStun[e] || ecs.dizzy[e] || ecs.brk[e]
    || ecs.atkStage[e] || castBusy(ecs, e)) return;
  faceAim(ecs, e, cmd); grabPose(ecs, e, ACT.GRAB);
}

export function endGrab(world, e, interrupted = false) {
  const ecs = world.ecs, who = ecs.grabWho[e], victim = heldGrab(ecs, e);
  const valid = world.isServer && who && ecs.alive[who] && ecs.generation[who] === ecs.grabGen[e]
    && ecs.grabWho[who] === e && ecs.grabGen[who] === ecs.generation[e];
  const cut = (id, held) => {
    const f = ecs.facing[id], v = -MELEE_GRAB.speed * LAWLESS.meleeUnit * 60;
    resetGrab(ecs, id); grabPose(ecs, id, held ? ACT.CAPTURE_CUT : ACT.GRAB_CUT);
    ecs.grabAt[id] = world.tick + 1; // both cuts start next tick, regardless of command order
    if (held) ecs.grabImm[id] = MELEE_GRAB.immune;
    ecs.lvx[id] = Math.sin(f) * v; ecs.lvz[id] = Math.cos(f) * v;
  };
  if (valid && !ecs.dead[who]) cut(who, !victim);
  if (!interrupted && !ecs.dead[e]) cut(e, victim);
  else { const imm = ecs.grabImm[e]; resetGrab(ecs, e); ecs.grabImm[e] = imm; ecs.moveMul[e] = 1; }
}

export function syncGrabs(world) {
  if (world.meleeVersion !== 1 || !world.isServer) return;
  const ecs = world.ecs;
  for (let e = 1; e < ecs.cap; e++) {
    const who = ecs.grabWho[e];
    if (!ecs.alive[e] || !who) continue;
    if (ecs.dead[e] || !ecs.alive[who] || ecs.dead[who] || ecs.generation[who] !== ecs.grabGen[e]
      || ecs.grabWho[who] !== e || ecs.grabGen[who] !== ecs.generation[e]) { endGrab(world, e, !!ecs.dead[e]); continue; }
    if (!heldGrab(ecs, e)) continue;
    const d = ecs.radius[e] + ecs.radius[who], f = ecs.facing[who]; // ours: body circles touch, never overlap
    ecs.x[e] = ecs.x[who] + Math.sin(f) * d; ecs.z[e] = ecs.z[who] + Math.cos(f) * d; ecs.y[e] = ecs.y[who];
    ecs.vx[e] = ecs.vz[e] = ecs.lvx[e] = ecs.lvz[e] = 0;
  }
}

// Called before the tick's queued blade collisions, in entity-id order (ours: no grab clash).
export function grabCollisions(world) {
  const ecs = world.ecs, G = MELEE_GRAB, unit = LAWLESS.meleeBody;
  if (!world.isServer || world.meleeVersion !== 1) return;
  syncGrabs(world);
  const attempts = [...world.grabAttempts.values()].sort((a, b) => a.e - b.e); world.grabAttempts.clear();
  for (const { e, pt, generation } of attempts) {
    if (!ecs.alive[e] || ecs.dead[e] || ecs.generation[e] !== generation || ecs.grabSt[e] !== ACT.GRAB) continue;
    const x = ecs.x[e] + Math.sin(ecs.facing[e]) * G.forward * unit, z = ecs.z[e] + Math.cos(ecs.facing[e]) * G.forward * unit;
    for (let o = 1; o < ecs.cap; o++) {
      if (!world.canHit(e, o) || ((ecs.mask[o] & COMP.ENEMY) && !world.isSandbag(o)) || intangible(ecs, o)
        || ecs.iframes[o] || airborne(ecs, o) || (ecs.grabDown[o] && ecs.stagger[o] > 0 && !(ecs.dizzy[o] > 0)) || ecs.grabWho[o] || ecs.grabImm[o]
        || ecs.grabSt[o] === ACT.GRAB_CUT || ecs.grabSt[o] === ACT.CAPTURE_CUT) continue;
      const p = world.lagPos(o, world.tick - pt + tuning.combat.interpTicks, {});
      if (Math.hypot(p.x - x, p.z - z) > G.radius * unit + ecs.radius[o]
        || (p.y ?? ecs.y[o]) > ecs.y[e] + (G.height + G.radius) * unit) continue;
      endDash(ecs, o); // P5: a successful grab interrupts a vulnerable dash.
      grabPose(ecs, e, G.pull ? ACT.GRAB_PULL : ACT.GRAB_WAIT); grabPose(ecs, o, ACT.CAPTURE);
      ecs.grabWho[e] = o; ecs.grabWho[o] = e; ecs.grabGen[e] = ecs.generation[o]; ecs.grabGen[o] = ecs.generation[e];
      ecs.grabAt[o] = world.tick + 1;
      const hp = world.grabHp(o);
      ecs.grabHold[o] = Math.floor(G.base + G.percent * meleePercent(ecs.maxHp[o] - Math.max(0, ecs.hp[o]), hp, LAWLESS.meleeStamina));
      ecs.facing[o] = ecs.facing[e] + Math.PI;
      if (ecs.mask[o] & COMP.PLAYER) world.emit({ type: 'duel', e: o, by: e, skill: 'grab', out: 'grab', tele: (G.start - 1) * DT,
        win: G.start * DT, heavy: 0, dmg: 0, hp: ecs.hp[o], x: ecs.x[e], z: ecs.z[e] });
      syncGrabs(world); break;
    }
  }
}

// Finalize after all player commands: DI samples the victim's release command regardless of entity order.
export function releaseThrows(world) {
  if (!world.isServer || world.meleeVersion !== 1) return;
  const ecs = world.ecs;
  for (let e = 1; e < ecs.cap; e++) {
    const st = ecs.grabSt[e], who = ecs.grabWho[e], move = throwMove(st), t = ecs.grabT[e];
    if (!ecs.alive[e] || !throwGrab(st) || !who || t < MELEE_GRAB[move].release) continue;
    const v = di(ecs.grabX[e], ecs.grabZ[e], ecs.grabX[who], ecs.grabZ[who]);
    if (st === ACT.GRAB_THROW_B) ecs.facing[e] += Math.PI; // ours: game_throwb has no explicit reverse; flip at release
    const hp = world.grabHp(who);
    resetGrab(ecs, e); ecs.grabSt[e] = st; ecs.grabT[e] = t; // committed recovery continues, pairing ends
    resetGrab(ecs, who); ecs.moveMul[who] = 1; setAct(ecs, who, ACT.IDLE);
    world.strike(who, MELEE_GRAB.throwDamage * Math.max(hp, LAWLESS.meleeStamina) / 100,
      { by: e, kind: 'throw', skill: move, throw: true, dx: v.vx, dz: v.vz, x: ecs.x[e], z: ecs.z[e], pt: world.tick });
    // Ultimate status_Thrown.cpp:26-27 -> misc.cpp:186-189, also on an ordinary throw release.
    if (!ecs.dead[who]) ecs.grabImm[who] = MELEE_GRAB.immune;
  }
}

// One grab animation / capture command. Sandbags call this from their own world step and never mash.
export function stepGrab(world, e, cmd) {
  const ecs = world.ecs, G = MELEE_GRAB;
  if (world.meleeVersion !== 1) return false;
  const st = ecs.grabSt[e];
  if (world.isServer && ecs.grabAt[e] === world.tick + 1 && (st === ACT.CAPTURE || st === ACT.GRAB_CUT || st === ACT.CAPTURE_CUT)) return true;
  if (ecs.grabImm[e] > 0) ecs.grabImm[e]--;
  if (!st) return false;
  ecs.grabT[e]++; ecs.moveMul[e] = 0;
  if (st === ACT.GRAB && world.isServer && ecs.grabT[e] >= G.start && ecs.grabT[e] <= G.end && !world.grabAttempts.has(e))
    world.grabAttempts.set(e, { e, pt: ecs.lastPt[e], generation: ecs.generation[e] });
  if (st === ACT.THROWN) return true; // committed: no timer and no mash; server releases the pair
  if (st === ACT.CAPTURE) {
    const n = mashInputs(ecs, e, cmd, 'grabIn');
    ecs.grabHold[e] -= 1 + (ecs.grabFlinch[e] > 0 ? 0 : G.mash * n);
    if (ecs.grabFlinch[e] > 0) ecs.grabFlinch[e]--;
    if (ecs.grabHold[e] <= 0) endGrab(world, e);
  } else if (st === ACT.GRAB_WAIT) {
    const x = cmd.mx || 0, z = cmd.mz || 0, len = Math.hypot(x, z);
    if (cmd.prs & BTN.ATTACK) { grabPose(ecs, e, ACT.GRAB_PUMMEL); ecs.grabT[e] = 1; }
    else if (len >= G.throwStick) {
      grabPose(ecs, e, x * Math.sin(ecs.facing[e]) + z * Math.cos(ecs.facing[e]) >= 0 ? ACT.GRAB_THROW_F : ACT.GRAB_THROW_B);
      ecs.grabT[e] = 1; ecs.grabX[e] = x / len; ecs.grabZ[e] = z / len;
      if (world.isServer) { ecs.grabSt[ecs.grabWho[e]] = ACT.THROWN; setAct(ecs, ecs.grabWho[e], ACT.THROWN); }
    }
  } else if (throwGrab(st)) {
    const move = throwMove(st);
    if (!world.isServer && ecs.grabT[e] === G[move].release) {
      if (st === ACT.GRAB_THROW_B) ecs.facing[e] += Math.PI;
      const t = ecs.grabT[e]; resetGrab(ecs, e); ecs.grabSt[e] = st; ecs.grabT[e] = t;
    }
    if (!ecs.grabWho[e] && ecs.grabT[e] >= G[move].total) {
      resetGrab(ecs, e); ecs.moveMul[e] = 1; setAct(ecs, e, ACT.IDLE);
    }
  } else if (st === ACT.GRAB_PUMMEL) {
    const who = ecs.grabWho[e];
    if (ecs.grabT[e] === G.hit && world.isServer && who) {
      const hp = world.grabHp(who);
      world.strike(who, G.damage * Math.max(hp, LAWLESS.meleeStamina) / 100,
        { by: e, kind: 'pummel', skill: 'pummel', pummel: true, seq: cmd.seq, x: ecs.x[e], z: ecs.z[e], pt: world.tick });
    }
    if (ecs.grabSt[e] === st && ecs.grabT[e] >= G.pummel) grabPose(ecs, e, ACT.GRAB_WAIT);
  } else if (st === ACT.GRAB_PULL && ecs.grabT[e] >= G.pull) grabPose(ecs, e, ACT.GRAB_WAIT);
  else if ((st === ACT.GRAB && ecs.grabT[e] >= G.total) || ((st === ACT.GRAB_CUT || st === ACT.CAPTURE_CUT) && ecs.grabT[e] >= G.cut)) {
    ecs.grabSt[e] = ecs.grabT[e] = 0; ecs.moveMul[e] = 1; setAct(ecs, e, ACT.IDLE);
  }
  return true;
}

// o: {x, z (source), kind, src, seq, knock, noInv, pierce (ignores DEF), by (pirate), crit}.
export function hurtPlayer(world, e, raw, o) {
  const ecs = world.ecs, C = tuning.combat;
  if (ecs.dead[e] > 0) return 0;
  if (ecs.elem[e] === 2 && o.fire) raw *= 1.5;
  const hp = ecs.hp[e];
  const captured = world.meleeVersion === 1 && heldGrab(ecs, e);
  const dmg = (ecs.god[e] > 0 ? 0 : mitigate(raw, o.pierce ? 0 : ecs.def[e])) * (captured && !o.pummel ? MELEE_GRAB.external : 1);
  if (dmg > 0 && world.meleeVersion === 1) {
    endDash(ecs, e); // P5: all landed damage shares this path, including chip shots and skills.
    if (captured && !o.pummel) {
      ecs.grabDmg[e] += meleePercent(dmg, ecs.maxHp[e], LAWLESS.meleeStamina); ecs.grabFlinch[e] = MELEE_GRAB.flinch;
      if (ecs.grabSt[e] !== ACT.THROWN && ecs.grabDmg[e] >= MELEE_GRAB.free) endGrab(world, e);
    } else if (!captured && ((ecs.grabSt[e] >= ACT.GRAB && ecs.grabSt[e] <= ACT.GRAB_PUMMEL) || throwGrab(ecs.grabSt[e]))) endGrab(world, e, true);
  }
  if (dmg > 0) { ecs.hp[e] -= dmg; ecs.regenT[e] = 0; }
  if (!o.noInv) ecs.hurtInv[e] = C.hurtIframes;
  const kx = ecs.x[e] - o.x, kz = ecs.z[e] - o.z, kl = Math.hypot(kx, kz);
  let meleeData;
  if (world.meleeVersion === 1 && !captured && dmg > 0 && ['proj', 'punish', 'aoe', 'beam'].includes(o.kind)) {
    const L = LAWLESS, damage = meleePercent(hp - Math.max(0, ecs.hp[e]), ecs.maxHp[e], L.meleeStamina);
    const percent = meleePercent(ecs.maxHp[e] - Math.max(0, ecs.hp[e]), ecs.maxHp[e], L.meleeStamina);
    const kb = knockback(percent, damage, 87, MELEE.mob.bkb, MELEE.mob.kbg);
    const hl = hitlagFrames(damage), hs = hitstunFrames(kb), speed = launchSpeed(kb, L.meleeUnit);
    launched(ecs, e); ecs.grabDown[e] = kb >= L.meleeTumble ? 1 : 0;
    ecs.hitlag[e] = hl; ecs.stagger[e] = Math.max(ecs.stagger[e], meleeStun(kb, hs, L.meleeTumble, L.meleeDown));
    ecs.atkStage[e] = 0; ecs.guardT[e] = -1;
    cancelCast(ecs, e);
    ecs.lvx[e] = kl > 0 ? kx / kl * speed : 0; ecs.lvz[e] = kl > 0 ? kz / kl * speed : 0;
    if (o.melee && world.isServer && ecs.alive[o.owner] && (ecs.mask[o.owner] & COMP.ENEMY) && ecs.dead[o.owner] <= 0) ecs.hitlag[o.owner] = hl;
    meleeData = { kb: Math.round(kb * 10) / 10, hl, hs, p: Math.round(percent * 10) / 10 };
    if (kl > 0) meleeData.la = Math.round(Math.atan2(kz, kx) * 1000) / 1000; // the view throws it this way
    if (kb >= L.meleeTumble) meleeData.kd = 1;
  } else if (!captured && kl > 1e-6) { const k = o.knock ?? C.hitKnock; ecs.kbx[e] += (kx / kl) * k; ecs.kbz[e] += (kz / kl) * k; }
  const ev = { type: 'hurt', e, dmg, raw, kind: o.kind, src: o.src || 0, seq: o.seq, x: o.x, z: o.z, practice: raw <= 0 ? 1 : 0, ...meleeData };
  if (o.via) ev.via = o.via;
  if (o.fire) ev.fire = 1;
  if (o.by) { ev.by = o.by; if (o.crit) ev.crit = 1; }
  world.emit(ev);
  if (ecs.hp[e] <= 0) killPlayer(world, e, o.seq, o.by || 0);
  return dmg;
}

export function killPlayer(world, e, seq, by = 0) {
  const ecs = world.ecs;
  if (!ecs.alive[e] || ecs.dead[e] > 0) return false;
  if (world.deferPlayerDeath) {
    const deferred = world.deferPlayerDeath(e, seq, by);
    if (typeof deferred !== 'boolean') {
      if (deferred && typeof deferred.then === 'function') Promise.resolve(deferred).catch(() => {});
      throw new TypeError('death hook must return a synchronous boolean');
    }
    if (deferred) return true;
  }
  if (world.meleeVersion === 1 && ecs.grabSt[e]) endGrab(world, e, true);
  resetGrab(ecs, e);
  ecs.hp[e] = 0;
  ecs.atkRej[e] = ecs.atkLink[e] = ecs.atkSmash[e] = ecs.chgN[e] = ecs.chgStop[e] = 0;
  ecs.rollT[e] = 0;
  ecs.dead[e] = 1;
  ecs.hitlag[e] = ecs.lvx[e] = ecs.lvz[e] = 0;
  ecs.lantern[e] = 0;
  if (world.fireEnabled) world.hideHandFire?.(e);
  ecs.deadT[e] = tuning.combat.respawnTime;
  ecs.atkStage[e] = 0; ecs.guardT[e] = -1; ecs.chain[e] = 0;
  ecs.guardLag[e] = ecs.guardStun[e] = ecs.dizzy[e] = ecs.dizzyIn[e] = ecs.brk[e] = 0;
  ecs.pend0[e] = ecs.pend1[e] = 0;
  ecs.dashT[e] = -1; ecs.state[e] = 0;
  if (airborne(ecs, e)) ecs.y[e] = standingHeight(world, ecs.x[e], ecs.z[e], ecs.y[e]); // PT06: the body drops where it stands
  if (ecs.jmpAct?.[e] || ecs.jmpSq?.[e]) resetJump(ecs, e);
  const loss = Math.max(0, Math.min(1, tuning.combat.deathXpLoss));
  ecs.xp[e] = Math.max(0, ecs.xp[e] * (1 - loss));
  const ev = { type: 'death', id: e, seq, x: ecs.x[e], z: ecs.z[e] };
  if (by) ev.by = by;
  world.emit(ev);
  // The server spills carried items everywhere, with additional equipment risk inside the Cala.
  if (world.onDeath) world.onDeath(e, by);
  return true;
}

// A blow from another pirate inside the Cala Calavera (M4.5; server only, between the victim's own commands, which
// it then reconciles). What the victim's dash, invulnerability after a hit and guard make of it. The damage is
// × LAWLESS.pvpDmg and can crit; the third hit, the lunge and the storm (heavy) stagger. o: as damageEnemy's
// {by, kind, seq (the attacker's), x, z, heavy, knock, pierce, above}.
function duelBlow(world, e, o) {
  const ecs = world.ecs, by = o.by, melee = o.kind === 'melee', cast = o.kind === 'skill';
  const skill = melee ? swingKey(o.stage, world.meleeVersion === 1 && o.smash) : o.kind === 'wave' ? 'storm' : o.skill || o.kind;
  const slot = ['q', 'e', 'g'][ecs.castK[by] - 1];
  const tele = melee ? swingBlow(world.meleeVersion, o.stage, o.smash, o.charge).windup : cast ? phases(skill, slot && skillOf(ecs, by, slot) === skill ? skillNum(ecs, by, slot) : SKILLS[skill])[0] : 0;
  const win = melee ? ecs.atkT[by] : o.age ?? (cast && slot ? ecs.castT[by] : 0);
  return { type: 'duel', e, by, skill, heavy: o.heavy ? 1 : 0, tele: Math.round(tele * 1000) / 1000, win: Math.round(win * 1000) / 1000, x: o.x, z: o.z };
}

export function hurtByPlayer(world, e, raw, o) {
  const ecs = world.ecs, G = tuning.guard, by = o.by > 0 ? o.by : 0;
  if (ecs.dead[e] > 0) return 0;
  const duel = duelBlow(world, e, o);
  const melee = world.meleeVersion === 1, captured = melee && heldGrab(ecs, e);
  if (melee) { duel.kb = 0; duel.hl = 0; duel.hs = 0; }
  const finish = (out, dmg = 0) => {
    if (melee) duel.p = Math.round(1000 * (ecs.maxHp[e] - Math.max(0, ecs.hp[e])) / ecs.maxHp[e]) / 10;
    world.emit({ ...duel, out, dmg, hp: ecs.hp[e], ...(ecs.dead[e] > 0 ? { dead: 1 } : {}) });
    return dmg;
  };
  if (ecs.iframes[e] > 0) { world.emit({ type: 'dodge', e, seq: 0, pvp: 1, x: o.x, z: o.z }); return finish('dodge'); }
  // The mercy window after a hit is for bullets; a blade lands once per swing anyway, so the combo and the
  // lunge go through it (otherwise the second swing of every combo is lost).
  if (ecs.hurtInv[e] > 0 && o.kind !== 'melee' && o.skill !== 'lunge' && !o.pummel && !o.throw) return finish('mercy');
  const crit = world.rng() < tuning.stats.crit + ecs.critAdd[by] || !!o.crit;
  raw *= LAWLESS.pvpDmg * (crit ? tuning.stats.critMult + ecs.critDAdd[by] : 1);
  if (guardUp(ecs, e) && !o.above && (melee || inGuardArc(ecs, e, o.x, o.z))) {
    if (melee) {
      // P2: the bubble covers every side; no HP is lost, the shield takes the blow (shieldTake).
      const move = MELEE[duel.skill] || MELEE.default;
      const r = shieldTake(world, e, meleePercent(raw, ecs.maxHp[e], LAWLESS.meleeStamina), { x: o.x, z: o.z, seq: 0, by, proj: !!move.proj, dx: o.dx, dz: o.dz, ev: { pvp: 1 } });
      duel.hl = r.hl; duel.sd = Math.round(r.sd * 10) / 10; duel.ss = r.ss;
      if (r.dz) duel.dz = r.dz;
      if (r.ps && move.proj && o.shot) o.reflected = true; // stepShots sends the pirate's shot back
      return finish(r.ps ? 'perfect' : 'block', 0);
    }
    if (guardPerfect(ecs, e)) {
      // Nothing gets through; whoever struck it from close by reels.
      addRiposte(ecs, e, G.riposte);
      world.emit({ type: 'guard', st: 'perfect', e, seq: 0, pvp: 1, x: o.x, z: o.z, heavy: 0, n: ecs.catchN[e] });
      if (by && ecs.alive[by] && Math.hypot(ecs.x[by] - ecs.x[e], ecs.z[by] - ecs.z[e]) < LAWLESS.shockR) {
        ecs.stagger[by] = Math.max(ecs.stagger[by], LAWLESS.shockStagger);
        ecs.atkStage[by] = 0; ecs.guardT[by] = -1;
        cancelCast(ecs, by);
        world.emit({ type: 'stun', id: by, by: e, seq: 0, x: ecs.x[by], z: ecs.z[by] });
      }
      return finish('perfect');
    }
    ecs.guardSt[e] -= raw * (o.heavy ? G.heavyCost : G.cost);
    ecs.guardRegT[e] = 0;
    addRiposte(ecs, e, G.blockRiposte);
    world.emit({ type: 'guard', st: 'block', e, seq: 0, pvp: 1, x: o.x, z: o.z, heavy: o.heavy ? 1 : 0 });
    const d = hurtPlayer(world, e, raw * (o.heavy ? G.heavyMult : G.blockMult), { x: o.x, z: o.z, kind: 'block', via: duel.skill, src: by, by, seq: 0, knock: o.heavy ? G.heavyKnock : G.knock, noInv: true, fire: o.fire });
    if (ecs.dead[e] <= 0 && ecs.guardSt[e] <= 0) breakGuard(world, e, 0);
    return finish('block', d);
  }
  const hp = ecs.hp[e];
  const d = hurtPlayer(world, e, raw, { x: o.x, z: o.z, kind: 'pvp', via: duel.skill, src: by, by, crit, seq: 0, knock: melee ? 0 : Math.min(o.knock ?? tuning.combat.hitKnock, 8), pierce: o.pierce, fire: o.fire, pummel: o.pummel });
  if (melee) {
    o.meleeHit = true; // Tattoo callbacks must not add their old stagger to this hit.
    const move = MELEE[duel.skill] || MELEE.default;
    if (o.pummel || captured) {
      duel.hl = hitlagFrames(meleePercent(d, ecs.maxHp[e], LAWLESS.meleeStamina));
      ecs.hitlag[by] = duel.hl; if (ecs.dead[e] <= 0) ecs.hitlag[e] = duel.hl;
    } else if (!move.noKb) {
      const L = LAWLESS, damage = meleePercent(hp - Math.max(0, ecs.hp[e]), ecs.maxHp[e], L.meleeStamina);
      const percent = meleePercent(ecs.maxHp[e] - Math.max(0, ecs.hp[e]), ecs.maxHp[e], L.meleeStamina);
      const kb = knockback(percent, damage, move.weight ?? 87, move.bkb, move.kbg);
      const hl = move.throw ? 0 : hitlagFrames(damage), hs = hitstunFrames(kb); // ordinary Melee release sets no hitlag (03 4.5-4.6)
      duel.kb = Math.round(kb * 10) / 10; duel.hl = hl; duel.hs = hs;
      if (!move.proj) ecs.hitlag[by] = hl;
      if (ecs.dead[e] <= 0) {
        let dx = move.proj || move.throw ? o.dx || 0 : Math.sin(ecs.facing[by]);
        let dz = move.proj || move.throw ? o.dz || 0 : Math.cos(ecs.facing[by]);
        // A spin (hit 3 is 360 deg) sends a pirate behind the attacker backwards, not through them.
        if (!move.proj && !move.throw && dx * (ecs.x[e] - o.x) + dz * (ecs.z[e] - o.z) < 0) { dx = -dx; dz = -dz; }
        if (Math.hypot(dx, dz) < 1e-6) { dx = ecs.x[e] - o.x; dz = ecs.z[e] - o.z; }
        const len = Math.hypot(dx, dz), speed = launchSpeed(kb, L.meleeUnit);
        ecs.lvx[e] = len > 0 ? dx / len * speed : 0; ecs.lvz[e] = len > 0 ? dz / len * speed : 0;
        launched(ecs, e); ecs.grabDown[e] = kb >= L.meleeTumble ? 1 : 0;
        ecs.hitlag[e] = hl; ecs.stagger[e] = meleeStun(kb, hs, L.meleeTumble, L.meleeDown);
        if (len > 0) duel.la = Math.round(Math.atan2(dz, dx) * 1000) / 1000; // the view throws it this way
        if (kb >= L.meleeTumble) duel.kd = 1;
        ecs.atkStage[e] = 0; ecs.guardT[e] = -1;
        cancelCast(ecs, e);
      }
    }
  } else if (o.heavy && ecs.dead[e] <= 0) {
    ecs.stagger[e] = Math.max(ecs.stagger[e], LAWLESS.heavyStagger);
    ecs.atkStage[e] = 0; ecs.guardT[e] = -1;
    cancelCast(ecs, e);
  }
  return finish(crit ? 'crit' : 'hit', d);
}

function respawnPlayer(world, e, seq) {
  const ecs = world.ecs, map = world.map;
  resetGrab(ecs, e);
  ecs.rollT[e] = ecs.rollBack[e] = ecs.rollX[e] = ecs.rollZ[e] = ecs.shieldStick[e] = 0;
  ecs.dead[e] = 0; ecs.deadT[e] = 0;
  ecs.hitlag[e] = ecs.lvx[e] = ecs.lvz[e] = 0;
  respawnNeeds(world, e);
  ecs.hp[e] = ecs.maxHp[e];
  ecs.x[e] = ecs.cpX[e]; ecs.z[e] = ecs.cpZ[e]; ecs.y[e] = map.groundAt(ecs.x[e], ecs.z[e]);
  ecs.vx[e] = ecs.vz[e] = ecs.kbx[e] = ecs.kbz[e] = 0;
  ecs.hurtInv[e] = tuning.combat.respawnIframes;
  ecs.stagger[e] = 0;
  ecs.swim[e] = ecs.swimDrown[e] = 0; ecs.swimStamina[e] = tuning.swim.stamina; ecs.state[e] = 0;
  world.emit({ type: 'respawn', id: e, seq, x: ecs.x[e], z: ecs.z[e] });
}

// Seconds until projectile s (at tick pt) would touch e's hurtbox (grown by the sword's slack); Infinity
// when it is not coming at you or ends before it gets there.
export function timeToContact(world, e, s, pt) {
  const ecs = world.ecs, H = world.hazards;
  const px = H.px(s, pt) - ecs.x[e], pz = H.pz(s, pt) - ecs.z[e];
  const R = ecs.hurtR[e] + H.r[s] + tuning.sword.slack + H.len[s] * 0.5;
  const c = px * px + pz * pz - R * R;
  if (c <= 0) return 0;
  if (H.curve[s]) {
    // Search the same curved path used by contact sweeps. Each short segment solves circle
    // entry directly, including bullets that begin turning toward the hurtbox later.
    const end = Math.min(H.tEnd[s], pt + tuning.sword.poor.tc / DT);
    let a = H._path(s, pt);
    for (let ta = pt; ta < end; ta += 1) {
      const tb = Math.min(ta + 1, end), b = H._path(s, tb);
      const dx = b.x - a.x, dz = b.z - a.z, ox = a.x - ecs.x[e], oz = a.z - ecs.z[e];
      const aa = dx * dx + dz * dz, bb = ox * dx + oz * dz, cc = ox * ox + oz * oz - R * R;
      const disc = bb * bb - aa * cc;
      if (aa > 1e-12 && disc >= 0) {
        const u = (-bb - Math.sqrt(disc)) / aa;
        if (u >= 0 && u <= 1) {
          const t = ta + (tb - ta) * u;
          return t < H.tEnd[s] && H._path(s, t).dist < H.clipD[s] - 1e-9 ? (t - pt) * DT : Infinity;
        }
      }
      if (b.dist >= H.clipD[s] - 1e-9) break;
      a = b;
    }
    return Infinity;
  }
  if (!H.frostFields.length) {
    const vx = H.vx[s], vz = H.vz[s], a = vx * vx + vz * vz, b = px * vx + pz * vz;
    if (a < 1e-9 || b >= 0) return Infinity;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / a;
    const dist = Math.sqrt(a) * t;
    return pt + t / DT >= H.tEnd[s] || H._path(s, pt).dist + dist >= H.clipD[s] ? Infinity : t;
  }
  const speed = H.speed[s];
  if (speed < 1e-9) return Infinity;
  const ux = H.vx[s] / speed, uz = H.vz[s] / speed;
  const toward = -(px * ux + pz * uz);
  if (toward <= 0) return Infinity;
  const perp2 = Math.max(0, px * px + pz * pz - toward * toward);
  if (perp2 > R * R) return Infinity;
  const dist = toward - Math.sqrt(R * R - perp2);
  if (dist <= 0) return 0;
  const startDist = H._path(s, pt).dist, endTick = Math.min(H.tEnd[s], pt + tuning.sword.poor.tc / DT);
  if (endTick <= pt || H._path(s, endTick).dist - startDist < dist) return Infinity;
  let lo = 0, hi = (endTick - pt) * DT;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (H._path(s, pt + mid / DT).dist - startDist >= dist) hi = mid; else lo = mid;
  }
  return hi;
}

// bonus: s added to the EXCELENTE and BUENO windows (the weapon base, Filo templado); POBRE stays put.
export function reflectTier(tc, bonus = 0) {
  const S = tuning.sword;
  const ex = Math.max(0.02, S.excellent.tc + bonus), gd = Math.max(ex, Math.min(S.poor.tc, S.good.tc + bonus));
  return tc <= ex ? 3 : tc <= gd ? 2 : tc <= S.poor.tc ? 1 : 0;
}

// A hostile projectile becomes a player-owned shot. T: the tier's numbers (tuning.sword.*, the wave's).
// o: {radial (spin finisher, riposte wave: away from you), kind (KILL.*), fromX/fromZ (coyote: from you)}.
function reflect(world, e, s, pt, seq, T, o = {}) {
  const ecs = world.ecs, H = world.hazards, R = tuning.parry.reflect, P = tuning.parry;
  const x = H.px(s, pt), z = H.pz(s, pt), pid = H.id[s];
  H.remove(s, pt, o.kind || KILL.REFLECT, e, seq);
  let a = ecs.facing[e];
  if (o.radial) {
    const rx = x - ecs.x[e], rz = z - ecs.z[e];
    if (Math.hypot(rx, rz) > 0.3) a = Math.atan2(rx, rz);
  }
  if (T.spread && !o.straight) a += (hash01(pid, seq) * 2 - 1) * T.spread * D2R;
  const dmg = o.dmg ?? T.dmg * Math.max(H.dmg[s], R.atkMult * ecs.atk[e]) * chainMul(P.chainDmg, ecs.chain[e]) * ecs.reflMul[e];
  const from = o.fromX !== undefined;
  world.spawnShot(e, {
    key: pid, pid, type: H.type[s], x: from ? o.fromX : x, y: from ? ecs.y[e] + 1.1 : H.py(s, pt), z: from ? o.fromZ : z,
    dx: Math.sin(a), dz: Math.cos(a), speed: Math.min(R.maxSpeed, Math.max(T.minSpeed, H.speed[s]) * T.speed), dmg, life: R.life,
    r: Math.max(0.2, H.r[s] * 0.9), heavy: H.type[s] === PTYPE.HEAVY, seq, bounce: T.bounce, homing: T.homing, cone: T.cone, pt, tier: o.tier || 0,
  });
  return { x, z };
}

// A sword reflect of tier 1–3: chain, meter, XP, the event and the hitstop.
function swordReflect(world, e, s, pt, seq, tier, o = {}) {
  const ecs = world.ecs, P = tuning.parry, T = tierCfg(tier);
  const heavy = world.hazards.type[s] === PTYPE.HEAVY, pid = world.hazards.id[s];
  if (tier >= 2) { ecs.chain[e] = ecs.chainT[e] <= P.chainGap ? Math.min(P.chainMax, ecs.chain[e] + 1) : 1; ecs.chainT[e] = 0; }
  addRiposte(ecs, e, T.riposte * (tier >= 2 ? chainMul(P.chainRiposte, ecs.chain[e]) : 1));
  if (tier === 3) gainXp(world, e, P.xp.perfect, seq);
  const at = reflect(world, e, s, pt, seq, T, { ...o, tier });
  const ev = { type: 'parry', pid, e, seq, x: at.x, z: at.z, tier, perfect: tier === 3 ? 1 : 0, chain: ecs.chain[e], heavy: heavy ? 1 : 0 };
  if (o.coyote) ev.coyote = 1;
  world.emit(ev);
  world.feel(e, seq, T.hitstop, T.slowmo);
}

// The next basic attack after a perfect guard: every caught bullet goes back at the cursor in a fan.
function releaseCaught(world, e, seq) {
  const ecs = world.ecs, RL = tuning.guard.release, R = tuning.parry.reflect;
  const n = ecs.catchN[e], hv = ecs.catchHv[e];
  const base = Math.max(ecs.catchDmg[e], R.atkMult * ecs.atk[e]) * ecs.reflMul[e];
  for (let k = 0; k < n; k++) {
    const heavy = k < hv;
    const a = ecs.facing[e] + (k - (n - 1) / 2) * RL.spread * D2R, dx = Math.sin(a), dz = Math.cos(a);
    world.spawnShot(e, {
      key: -(seq * 8 + k + 1), pid: 0, type: heavy ? PTYPE.HEAVY : PTYPE.PARRY, x: ecs.x[e] + dx * 0.6, y: ecs.y[e] + 1.1, z: ecs.z[e] + dz * 0.6,
      dx, dz, speed: heavy ? RL.heavySpeed : RL.speed, dmg: base * (heavy ? RL.heavyDmg : RL.dmg), life: R.life,
      r: heavy ? 0.58 : 0.25, heavy, seq, bounce: RL.bounce, homing: RL.homing, cone: RL.cone, kind: SHOT.RELEASE, pt: ecs.lastPt[e],
    });
  }
  ecs.catchN[e] = ecs.catchHv[e] = ecs.catchDmg[e] = 0;
  world.emit({ type: 'release', e, seq, n, heavy: hv, x: ecs.x[e], z: ecs.z[e] });
}

// ---- Guard --------------------------------------------------------------------------------------------
const guardUp = (ecs, e) => ecs.guardT[e] >= 0;
const guardPerfect = (ecs, e) => ecs.guardT[e] >= 0 && ecs.guardP[e] > 0 && ecs.guardT[e] < tuning.guard.perfect;
// (x, z) inside the guard's frontal arc (right on top of you counts as in front).
function inGuardArc(ecs, e, x, z) {
  const dx = x - ecs.x[e], dz = z - ecs.z[e], d = Math.hypot(dx, dz);
  if (d < 0.3) return true;
  return (dx * Math.sin(ecs.facing[e]) + dz * Math.cos(ecs.facing[e])) / d >= Math.cos((tuning.guard.arc / 2) * D2R);
}

function breakGuard(world, e, seq) {
  const ecs = world.ecs, G = tuning.guard;
  ecs.guardSt[e] = 0; ecs.guardT[e] = -1;
  ecs.stagger[e] = Math.max(ecs.stagger[e], G.breakStagger);
  ecs.atkStage[e] = 0;
  world.emit({ type: 'guard', st: 'break', e, seq, x: ecs.x[e], z: ecs.z[e] });
}

// A blow the guard took (raw damage from (x, z)). Perfect: nothing gets through, the bullet (pid, type)
// is caught, nearby attackers are stunned. Otherwise a fraction gets through and it costs stamina.
function guardTake(world, e, raw, x, z, seq, o) {
  const ecs = world.ecs, G = tuning.guard;
  if (world.meleeVersion === 1) {
    const ev = { pid: o.pid || 0, aoe: o.aoe || 0 };
    if (o.coyote) ev.coyote = 1;
    shieldTake(world, e, meleePercent(raw, ecs.maxHp[e], LAWLESS.meleeStamina), { x, z, seq, proj: !o.aoe, dx: o.dx, dz: o.dz, owner: o.owner, noPower: o.noPower, ev });
    return;
  }
  if (guardPerfect(ecs, e)) {
    if (o.pid && ecs.catchN[e] < G.catchMax) {
      ecs.catchN[e] += 1;
      if (o.heavy) ecs.catchHv[e] += 1;
      ecs.catchDmg[e] = Math.max(ecs.catchDmg[e], raw);
      ecs.catchT[e] = 0;
    }
    addRiposte(ecs, e, G.riposte);
    gainXp(world, e, G.xp, seq);
    world.emit({ type: 'guard', st: 'perfect', e, seq, pid: o.pid || 0, aoe: o.aoe || 0, x, z, heavy: o.heavy ? 1 : 0, n: ecs.catchN[e] });
    world.feel(e, seq, G.hitstop, G.slowmo);
    if (world.isServer) world.guardShock(e, seq);
    return;
  }
  ecs.guardSt[e] -= raw * (o.heavy ? G.heavyCost : G.cost);
  ecs.guardRegT[e] = 0;
  addRiposte(ecs, e, G.blockRiposte);
  world.emit({ type: 'guard', st: 'block', e, seq, pid: o.pid || 0, aoe: o.aoe || 0, x, z, heavy: o.heavy ? 1 : 0 });
  hurtPlayer(world, e, raw * (o.heavy ? G.heavyMult : G.blockMult), { x, z, kind: 'block', src: o.pid || o.aoe || 0, seq, knock: o.heavy ? G.heavyKnock : G.knock, noInv: true, fire: o.fire });
  if (ecs.dead[e] <= 0 && ecs.guardSt[e] <= 0) breakGuard(world, e, seq);
}

// ---- P2 (MN_MELEE): the shield -----------------------------------------------------------------------------
const shieldAge = (ecs, e) => Math.round(ecs.guardT[e] / DT); // frames the shield has been up

// P5: damage, launch and capture share the same dash interruption; never clear skill i-frames.
function endDash(ecs, e) {
  if (ecs.dashT[e] < 0) return;
  ecs.dashT[e] = -1; ecs.state[e] = STATE.MOVE; ecs.vx[e] = ecs.vz[e] = 0;
}

// A hit that staggers or launches ends the break sequence, the dizzy and the shield's lag and stun.
function launched(ecs, e) {
  endDash(ecs, e); // Melee-only callers: also stop a launch with zero HP damage.
  ecs.rollT[e] = 0;
  if (ecs.dizzy[e] > 0 || ecs.brk[e] > 0) { ecs.dizzy[e] = ecs.brk[e] = 0; ecs.stagger[e] = 0; }
  ecs.guardLag[e] = ecs.guardStun[e] = 0;
}

// The shield takes a blow of Melee damage d from (o.x, o.z). Inside the powershield window it takes nothing; else it loses
// dmgMul * d and breaks below 0. A blow is held in hitlag (both sides, a projectile's shooter excepted), stuns the shield
// and slides both. o: {x, z, seq, proj (no attacker hitlag or push), by (pirate attacker), owner (mob whose circle it is),
// dx/dz (a projectile's travel), noPower, ev (more fields for the guard event)}. A powershielded projectile gets no
// shieldstun; whoever sent it reflects it.
function shieldTake(world, e, d, o) {
  const ecs = world.ecs, mg = MELEE_GUARD, seq = o.seq >>> 0, proj = !!o.proj, fl = Math.floor(d), unit = LAWLESS.meleeUnit * 60;
  const ps = !o.noPower && shieldAge(ecs, e) <= (proj ? mg.powerProjFrames : mg.powerFrames);
  const hl = hitlagFrames(d), sd = ps ? 0 : mg.dmgMul * d, ss = ps && proj ? 0 : Math.floor((d * mg.stunMul + mg.stunAdd) * 200 / 201);
  const foe = o.by && ecs.alive[o.by] ? o.by
    : o.owner && world.isServer && ecs.alive[o.owner] && (ecs.mask[o.owner] & COMP.ENEMY) && ecs.dead[o.owner] <= 0 ? o.owner : 0;
  const r = { ps, hl, sd, ss: 0, dz: 0 };
  ecs.guardSt[e] -= sd;
  addRiposte(ecs, e, ps ? tuning.guard.riposte : tuning.guard.blockRiposte);
  ecs.hitlag[e] = hl;
  if (!proj && foe) ecs.hitlag[foe] = hl;
  if (ecs.guardSt[e] < 0) { r.dz = shieldBreak(world, e, seq, o.x, o.z, sd); return r; }
  if (ps) ecs.guardP[e] = 1; // the drop lag after this raise is 1 frame
  if (ss > 0) { ecs.guardStun[e] = ss; ecs.castLock[e] = Math.max(ecs.castLock[e], (ss - 0.5) * DT); r.ss = ss; }
  if (!(ps && proj)) {
    let kx = ecs.x[e] - o.x, kz = ecs.z[e] - o.z;
    if (proj && (o.dx || o.dz)) { kx = o.dx; kz = o.dz; }
    const kl = Math.hypot(kx, kz);
    if (kl > 1e-6) {
      const v = Math.min(mg.pushDefMax, (fl * mg.pushDef[0] + mg.pushDef[1]) * (ps ? mg.pushDefPower : mg.pushDefMul)) * unit;
      ecs.lvx[e] = kx / kl * v; ecs.lvz[e] = kz / kl * v;
    }
    if (!proj && o.by && ecs.alive[o.by]) {
      const ax = ecs.x[o.by] - ecs.x[e], az = ecs.z[o.by] - ecs.z[e], al = Math.hypot(ax, az);
      if (al > 1e-6) { const v = (fl * mg.pushAtk[0] + mg.pushAtk[1]) * unit; ecs.lvx[o.by] = ax / al * v; ecs.lvz[o.by] = az / al * v; }
    }
  }
  const ev = { type: 'guard', st: ps ? 'perfect' : 'block', e, seq, x: o.x, z: o.z, heavy: 0, n: 0, sd: Math.round(sd * 10) / 10, ss: r.ss, ...o.ev };
  if (ps) ev.ps = 1;
  world.emit(ev);
  return r;
}

// The shield broke: back to breakReset, then the break sequence (fly, down, stand-up: brk frames, intangible for most of
// it) and the dizzy for (dizzyBase - percent) + dizzyAdd frames; the pirate cannot act or move. Returns the dizzy frames.
function shieldBreak(world, e, seq, x, z, sd = 0) {
  const ecs = world.ecs, mg = MELEE_GUARD;
  const p = meleePercent(ecs.maxHp[e] - Math.max(0, ecs.hp[e]), ecs.maxHp[e], LAWLESS.meleeStamina);
  const dz = Math.floor(Math.max(0, mg.dizzyBase - p)) + mg.dizzyAdd, brk = mg.breakFly + mg.breakDown + mg.breakStand;
  ecs.guardSt[e] = mg.breakReset; ecs.guardT[e] = -1; ecs.guardP[e] = 0; ecs.guardLag[e] = ecs.guardStun[e] = 0;
  ecs.dizzy[e] = dz; ecs.brk[e] = brk; ecs.dizzyIn[e] = 0; ecs.stagger[e] = (brk + dz) * DT; ecs.atkStage[e] = 0; ecs.castLock[e] = 0;
  cancelCast(ecs, e);
  // hl: the hitlag the blow left (0 for a drained shield); fly/down/stand: the sequence's frames; h: peak height in u (view)
  world.emit({ type: 'guard', st: 'break', e, seq, x, z, dz, sd: Math.round(sd * 10) / 10, hl: ecs.hitlag[e], fly: mg.breakFly, down: mg.breakDown, stand: mg.breakStand, h: Math.round(mg.breakHeight * LAWLESS.meleeUnit * 1000) / 1000 });
  return dz;
}

// One command of the break sequence or the dizzy. The sequence counts down alone (no mash counts, but the sticks held are
// tracked so a held one is not a new input at its end). The dizzy: 1 frame off, a newly pressed button or a stick pushed
// into a new direction 3 more.
function mashInputs(ecs, e, cmd, key) {
  const mx = cmd.mx || 0, mz = cmd.mz || 0;
  const sticks = (mx > 0.5 ? 1 : 0) | (mx < -0.5 ? 2 : 0) | (mz > 0.5 ? 4 : 0) | (mz < -0.5 ? 8 : 0);
  let n = 0;
  for (let b = cmd.prs & 2047; b; b &= b - 1) n++;
  for (let b = sticks & ~ecs[key][e]; b; b &= b - 1) n++;
  ecs[key][e] = sticks;
  return n;
}
function stepDizzy(ecs, e, cmd) {
  const n = mashInputs(ecs, e, cmd, 'dizzyIn');
  if (ecs.brk[e] > 0) { ecs.brk[e] -= 1; ecs.stagger[e] = (ecs.brk[e] + ecs.dizzy[e]) * DT; return; }
  ecs.dizzy[e] -= 1 + MELEE_GUARD.dizzyMash * n;
  if (ecs.dizzy[e] <= 0) { ecs.dizzy[e] = 0; ecs.stagger[e] = 0; } else ecs.stagger[e] = ecs.dizzy[e] * DT;
}

function swingStage(world, e, stage, cmd) {
  const ecs = world.ecs;
  if (world.meleeVersion === 1) {
    ecs.atkRej[e] = ecs.atkLink[e] = ecs.chgN[e] = ecs.chgStop[e] = 0;
    ecs.atkSmash[e] = stage === 3 && (cmd.btn & BTN.ATTACK) ? 1 : 0;
  }
  const st = swingBlow(world.meleeVersion, stage, ecs.atkSmash[e]);
  ecs.atkStage[e] = stage; ecs.atkT[e] = 0; ecs.atkBuf[e] = 0; ecs.atkLatch[e] = 0; ecs.swingId[e] += 1;
  ecs.guardT[e] = -1;
  ecs.empK[e] = takeEmpower(ecs, e); // the first swing after a Parpadeo hits harder, as a crit (world.meleeHits)
  faceAim(ecs, e, cmd);
  ecs.faceLock[e] = st.iasa ? (st.iasa - 1) * DT : st.windup + st.active + 0.05;
  // P1b: no dash or jump before the first actable frame. castLock holds both and ticks down from the next command,
  // whose mover runs before it: it opens on the command that runs frame `iasa`.
  if (st.iasa) ecs.castLock[e] = (st.iasa - 2.5) * DT;
  world.emit({ type: 'swing', e, stage, seq: cmd.seq >>> 0 });
  if (ecs.catchN[e] > 0) releaseCaught(world, e, cmd.seq >>> 0);
}

// P4: Dancing Blade's gate, without an input buffer. An early press poisons this blow's link;
// an accepted one runs at link or on the next frame, whichever is later.
function linkPress(ecs, e, st, f) {
  if (!st.link || ecs.atkRej[e]) return;
  if (f < st.open) { ecs.atkRej[e] = 1; ecs.atkLink[e] = 0; }
  else if (f <= st.close && !ecs.atkLink[e]) ecs.atkLink[e] = Math.max(st.link, f + 1);
}
function meleeSwing(world, e, cmd, dt, pt, seq, canAct, prev) {
  const ecs = world.ecs;
  let stage = ecs.atkStage[e], st = swingDescriptor(1, ecs, e), f = swingFrame(ecs.atkT[e]);
  // World retains hitlag presses in atkLatch. Judge them at the frozen frame, not after the gate advances.
  if (ecs.atkLatch[e]) { linkPress(ecs, e, st, f); ecs.atkLatch[e] = 0; }
  if (f > 0 && (cmd.prs & BTN.ATTACK)) linkPress(ecs, e, st, f + 1);
  if (ecs.atkLink[e] && !ecs.atkRej[e] && canAct && f + 1 >= ecs.atkLink[e]) {
    swingStage(world, e, ++stage, cmd); st = swingDescriptor(1, ecs, e); f = 0;
  }
  // The 3-4 charge window holds its last pose. Each held command after frame 4 pays one extra frame;
  // reaching the cap releases on 5 on that command, even if the button stays down.
  if (st.smash && f + 1 >= st.chargeOpen && !(cmd.btn & BTN.ATTACK)) ecs.chgStop[e] = 1;
  const charging = st.smash && !ecs.chgStop[e] && f === st.chargeClose && (cmd.btn & BTN.ATTACK) && ecs.chgN[e] < MELEE_SMASH.cap;
  if (charging) {
    ecs.chgN[e] += 1;
    if (ecs.chgN[e] === MELEE_SMASH.cap) ecs.atkT[e] = (st.chargeClose + 1) * dt;
  } else ecs.atkT[e] += dt;
  f = swingFrame(ecs.atkT[e]);
  if (st.smash) {
    ecs.castLock[e] = Math.max(0, (st.iasa - f - 1.5) * DT); // hold dash/jump through the frozen pose too
    ecs.faceLock[e] = Math.max(0, (st.iasa - f - 1) * DT);
    st = swingDescriptor(1, ecs, e);
  }
  if (f >= st.start && f <= st.end) {
    if (st.lunge > 0) {
      const step = st.lunge / (st.end - st.start + 1);
      moveWithCollision(world, e, Math.sin(ecs.facing[e]) * step, Math.cos(ecs.facing[e]) * step);
    }
    swingActive(world, e, st, stage, pt, seq, prev);
  }
  if (f >= st.total || (f >= st.iasa && Math.hypot(cmd.mx || 0, cmd.mz || 0) > 0.2)) { ecs.lastStage[e] = stage; ecs.atkStage[e] = 0; ecs.comboT[e] = 0; }
}

// Active frames of a swing: reflect (by timing) or destroy the bullets in the arc, clunk on heavy orbs
// that came too early, hit enemies (server).
function swingActive(world, e, st, stage, pt, seq, prev) {
  const ecs = world.ecs, H = world.hazards, P = tuning.parry, F = tuning.feel;
  if (world.meleeVersion === 1) st = swingDescriptor(1, ecs, e);
  const tag = 'c' + ecs.swingId[e];
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt) || H.type[s] === PTYPE.UNSTOP) continue;
    const x = H.px(s, pt), z = H.pz(s, pt);
    if (!inSector(ecs, e, x, z, st.range + H.r[s], st.arc)) continue;
    const tier = reflectTier(timeToContact(world, e, s, pt), ecs.winBonus[e]);
    if (H.type[s] === PTYPE.HEAVY) {
      // Too early is a clunk, and that swing is spent on it (it cannot turn EXCELENTE a few frames later).
      if (H.hasMark(s, e, tag)) continue;
      if (tier === 3) swordReflect(world, e, s, pt, seq, 3, { radial: stage === 3 });
      else { H.mark(s, e, tag, seq); world.emit({ type: 'clunk', pid: H.id[s], e, seq, x, z }); }
      continue;
    }
    if (tier > 0) { swordReflect(world, e, s, pt, seq, tier, { radial: stage === 3 }); continue; }
    H.remove(s, pt, KILL.DESTROY, e, seq);
    addRiposte(ecs, e, P.riposte.destroy);
    world.emit({ type: 'destroy', pid: H.id[s], e, seq, x, z });
    world.feel(e, seq, F.hitstopDestroy, 0);
  }
  if (prev !== undefined) { mobClanks(world, e, prev, pt); if (!ecs.atkStage[e]) return; } // P2b: a cancelled blow lands on nobody
  if (world.isServer) world.queueMeleeHits(e, st, pt, seq);
}

// P2b (MN_MELEE): the mob melee circles about to burst on pirate e this command meet its blow before the blow lands (clank:
// a cancelled circle hits nobody, a cancelled blow ends). It runs ahead of meleeHits and of contacts, which come later in the
// command, or the blow would always land first. Same circle test as contacts.
function mobClanks(world, e, prev, pt) {
  const ecs = world.ecs;
  if (ecs.iframes[e] > 0 || ecs.hurtInv[e] > 0 || intangible(ecs, e)) return;
  for (const a of world.hazards.aoes) {
    if (a.cancel || a.keep || !(prev < a.tAct && a.tAct <= pt) || a.hits.some((h) => h.e === e)) continue;
    if (Math.hypot(ecs.x[e] - a.x, ecs.z[e] - a.z) <= a.r + ecs.hurtR[e] * 0.5) world.clankMob(e, a);
  }
}

// Hostile projectiles and ground circles touching (or brushing past) the hurtbox between ticks prev → pt.
function contacts(world, e, prev, pt, seq) {
  const ecs = world.ecs, H = world.hazards, T = tuning, P = T.parry, PR = T.projectiles;
  const px = ecs.x[e], pz = ecs.z[e], hr = ecs.hurtR[e];
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt) || !H.armed(s, pt)) continue;
    const ta = Math.max(prev, H.t0[s]);
    let ax = H.px(s, ta), az = H.pz(s, ta), bx = H.px(s, pt), bz = H.pz(s, pt);
    const sp = H.speed[s], len = H.len[s];
    if (len > 0 && sp > 1e-6) {
      const va = H.velocityAt(s, ta), vb = H.velocityAt(s, pt);
      ax -= va.x / va.speed * len * 0.5; az -= va.z / va.speed * len * 0.5;
      bx += vb.x / vb.speed * len * 0.5; bz += vb.z / vb.speed * len * 0.5;
    }
    // Distance from the player to the swept segment.
    const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
    let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
    const d = Math.sqrt(dx * dx + dz * dz);
    const touch = hr + H.r[s];
    const type = H.type[s];
    if (d < touch) {
      if (intangible(ecs, e)) { if (!H.hasMark(s, e, 'p')) H.mark(s, e, 'p', seq); continue; } // P2b: the break sequence, passes through
      if (ecs.iframes[e] > 0) {
        if (type === PTYPE.UNSTOP && !H.hasMark(s, e, 'h')) {
          H.mark(s, e, 'h', seq);
          addRiposte(ecs, e, P.riposte.ghost);
          gainXp(world, e, P.xp.ghost, seq);
          world.emit({ type: 'ghost', pid: H.id[s], e, seq, x: bx, z: bz });
        } else if (type !== PTYPE.UNSTOP && !H.hasMark(s, e, 'd')) {
          // ESQUIVA: dashed through a bullet that would have hit (bullet hell: the dash is a weapon too).
          H.mark(s, e, 'd', seq);
          H.mark(s, e, 'p', seq);
          addRiposte(ecs, e, P.riposte.dodge);
          gainXp(world, e, P.xp.dodge, seq);
          world.emit({ type: 'dodge', pid: H.id[s], e, seq, x: bx, z: bz });
        }
        continue;
      }
      if (ecs.hurtInv[e] > 0) { if (!H.hasMark(s, e, 'p')) H.mark(s, e, 'p', seq); continue; } // passes through: not a graze
      const hx = H.px(s, pt), hz = H.pz(s, pt);
      const shield = world.meleeVersion === 1; // P2: the bubble covers every side
      if (type !== PTYPE.UNSTOP && guardUp(ecs, e) && (shield || inGuardArc(ecs, e, hx, hz))) {
        // The guard takes it (a block, or a catch when it was just raised).
        const pid = H.id[s], raw = H.dmg[s], v = shield ? H.velocityAt(s, pt) : null;
        // A powershield sends the bullet back as the pirate's own shot.
        if (shield && shieldAge(ecs, e) <= MELEE_GUARD.powerProjFrames) swordReflect(world, e, s, pt, seq, 1, { dmg: Math.max(1, Math.round(raw * MELEE_GUARD.reflectMul)), straight: true });
        else H.remove(s, pt, KILL.BLOCK, e, seq);
        guardTake(world, e, raw, hx, hz, seq, { pid, heavy: type === PTYPE.HEAVY, fire: H.fire[s], ...(shield ? { dx: v.x, dz: v.z } : {}) });
        if (ecs.dead[e] > 0) return;
        continue;
      }
      H.remove(s, pt, KILL.HIT, e, seq);
      world.emit({ type: 'phit', pid: H.id[s], e, seq, x: hx, z: hz });
      if (type === PTYPE.PARRY && (!ecs.pend0[e] || !ecs.pend1[e])) {
        // Coyote: the damage lands 60 ms later unless RMB comes first.
        if (!ecs.pend0[e]) { ecs.pend0[e] = H.id[s]; ecs.pend0T[e] = P.coyote; ecs.pend0D[e] = H.dmg[s]; }
        else { ecs.pend1[e] = H.id[s]; ecs.pend1T[e] = P.coyote; ecs.pend1D[e] = H.dmg[s]; }
        continue;
      }
      // Unstoppables pierce a raised guard and stun you.
      const punish = type === PTYPE.UNSTOP && guardUp(ecs, e);
      const dmg = hurtPlayer(world, e, H.dmg[s], { x: hx, z: hz, kind: punish ? 'punish' : 'proj', src: H.id[s], seq, fire: H.fire[s] });
      if (punish && ecs.dead[e] <= 0 && (world.meleeVersion !== 1 || dmg <= 0)) {
        ecs.stagger[e] = PR.unstoppable.stagger;
        ecs.guardT[e] = -1; ecs.atkStage[e] = 0;
      }
      if (ecs.dead[e] > 0) return;
    } else if (d < touch + PR.graze && !intangible(ecs, e) && !H.hasMark(s, e, 'g') && !H.hasMark(s, e, 'h') && !H.hasMark(s, e, 'p')) {
      // Brushed past and now moving away (straight lines only get farther from here on).
      const rx = H.px(s, pt) - px, rz = H.pz(s, pt) - pz;
      const v = H.velocityAt(s, pt);
      if (rx * v.x + rz * v.z > 0) {
        H.mark(s, e, 'g', seq);
        addRiposte(ecs, e, P.riposte.graze);
        gainXp(world, e, P.xp.graze, seq);
        world.emit({ type: 'graze', pid: H.id[s], e, seq, x: bx, z: bz });
      }
    }
  }
  // Ground circles burst once, at their activation tick.
  for (const a of H.aoes) {
    if (a.cancel || !(prev < a.tAct && a.tAct <= pt)) continue;
    let hit = false;
    for (const h of a.hits) if (h.e === e) hit = true;
    if (hit) continue;
    const d = Math.hypot(px - a.x, pz - a.z);
    if (d > a.r + hr * 0.5) continue;
    a.hits.push({ e, seq });
    if (ecs.iframes[e] > 0 || ecs.hurtInv[e] > 0 || intangible(ecs, e)) continue;
    // Melee circles (a bite, a cleave, a slam) can be guarded if the blow comes from in front; shells and
    // meteors falling from the sky cannot.
    if (!a.keep && guardUp(ecs, e) && (world.meleeVersion === 1 || inGuardArc(ecs, e, a.sx ?? a.x, a.sz ?? a.z))) {
      guardTake(world, e, a.dmg, a.sx ?? a.x, a.sz ?? a.z, seq, { aoe: a.id, fire: a.fire, owner: a.owner });
      if (ecs.dead[e] > 0) return;
      continue;
    }
    hurtPlayer(world, e, a.dmg, { x: a.x, z: a.z, kind: 'aoe', src: a.id, seq, knock: 6, fire: a.fire, melee: !a.keep, owner: a.owner });
    if (ecs.dead[e] > 0) return;
  }
  // Beams (lasers, fire lanes, the boss charge): damage every `every` ticks while you stand in them;
  // dashing through one is a FANTASMA (once per beam).
  for (const b of H.beams) {
    if (b.cancel || pt < b.tAct || prev >= b.tEnd) continue;
    beamSeg(b, Math.min(pt, b.tEnd - 1), SEG);
    const d = segDist(px, pz, SEG.ax, SEG.az, SEG.bx, SEG.bz, SEG);
    if (d >= b.w * 0.5 + hr * 0.5) continue;
    if (intangible(ecs, e)) continue; // P2b: no ghost, no hit
    if (ecs.iframes[e] > 0) {
      if (!b.ghosts.some((g) => g.e === e)) {
        b.ghosts.push({ e, seq });
        addRiposte(ecs, e, P.riposte.ghost);
        gainXp(world, e, P.xp.ghost, seq);
        world.emit({ type: 'ghost', beam: b.id, e, seq, x: px, z: pz });
      }
      continue;
    }
    if (ecs.hurtInv[e] > 0) continue;
    let last = -1e9;
    for (const h of b.hits) if (h.e === e && h.tick > last) last = h.tick;
    if (pt - last < b.every) continue;
    b.hits.push({ e, seq, tick: pt });
    hurtPlayer(world, e, b.dmg, { x: SEG.cx, z: SEG.cz, kind: 'beam', src: b.id, seq, knock: b.knock ?? 4, fire: b.fire });
    if (ecs.dead[e] > 0) return;
  }
  // Lava: burns outside the safe radius on every `every`-th tick (the ground: no dash, no iframes).
  const L = H.lava;
  if (L && pt >= L.t0) {
    const t = pt - ((pt - L.t0) % L.every);
    if (t > prev && !L.hits.some((h) => h.e === e && h.tick === t)) {
      const dx = px - L.cx, dz = pz - L.cz, d = Math.hypot(dx, dz);
      if (d > lavaR(L, t) && d < L.R + 1) {
        L.hits.push({ e, seq, tick: t });
        hurtPlayer(world, e, L.dmg, { x: px + dx / d, z: pz + dz / d, kind: 'lava', src: L.id, seq, knock: 3, noInv: true, fire: 1 });
        if (ecs.dead[e] > 0) return;
      }
    }
  }
}
const SEG = { ax: 0, az: 0, bx: 0, bz: 0, cx: 0, cz: 0, ox: 0, oz: 0, ang: 0 };

// The Tormenta's reach: 6 u, 8 with the cutlass's «Ojo del huracán».
export const stormRadius = (ecs, e) => tuning.parry.riposte.radius + passive(ecs, e, 'stormR');

function riposteWave(world, e, pt, seq) {
  const ecs = world.ecs, H = world.hazards, rad = stormRadius(ecs, e);
  ecs.riposte[e] = 0;
  let n = 0;
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt)) continue;
    const x = H.px(s, pt), z = H.pz(s, pt);
    if (Math.hypot(x - ecs.x[e], z - ecs.z[e]) > rad + H.r[s]) continue;
    reflect(world, e, s, pt, seq, tuning.parry.reflect.wave, { radial: true, kind: KILL.WAVE });
    n++;
  }
  world.emit({ type: 'riposte', e, seq, x: ecs.x[e], z: ecs.z[e], n, r: rad });
  if (world.isServer) world.waveHits(e, seq);
  world.feel(e, seq, tuning.feel.hitstopRiposte, 0);
}

export function stepPlayerCombat(world, e, cmd, dt) {
  const ecs = world.ecs, T = tuning, P = T.parry, M = T.melee, Cb = T.combat, G = T.guard;
  const seq = cmd.seq >>> 0, melee = world.meleeVersion === 1;
  // PT06: in a jump or fall nothing is pressed (no attack, guard, skill, potion or aim) and nothing is buffered.
  const air = airborne(ecs, e);
  if (air) cmd = { ...cmd, btn: 0, prs: 0 };
  if (ecs.swim[e]) {
    cmd = { ...cmd, btn: cmd.btn & (BTN.AIM | BTN.INTERACT | BTN.POTION), prs: cmd.prs & (BTN.INTERACT | BTN.POTION) };
    ecs.atkStage[e] = ecs.atkBuf[e] = ecs.qBuf[e] = ecs.eBuf[e] = ecs.gBuf[e] = ecs.rBuf[e] = 0;
    ecs.guardT[e] = -1;
    cancelCast(ecs, e);
  }
  const pt = world.cmdTick(e, cmd);
  let prev = ecs.lastPt[e];
  if (!(prev > 0) || prev >= pt || pt - prev > 30) prev = pt - 1;
  ecs.lastPt[e] = pt;

  ecs.actT[e] += dt;
  const dec = (k) => { if (ecs[k][e] > 0) ecs[k][e] = Math.max(0, ecs[k][e] - dt); };
  dec('hurtInv'); dec('faceLock'); dec('atkBuf'); dec('rBuf'); dec('guardRe');
  dec('cdQ'); dec('cdE'); dec('qBuf'); dec('eBuf'); dec('castLock'); dec('shotCd'); dec('shotAltCd'); dec('potCd'); dec('empT');
  dec('cdG'); dec('gBuf');
  ecs.chainT[e] += dt; ecs.comboT[e] += dt; ecs.regenT[e] += dt; ecs.guardRegT[e] += dt; ecs.catchT[e] += dt;
  if (ecs.chainT[e] > P.chainGap) ecs.chain[e] = 0;
  // A crescent in flight, the lead rain, a Tromba and a Timón keep going whatever you do (even down).
  stepWave(world, e, prev, pt, seq);
  stepRain(world, e, prev, pt, seq);
  stepTromba(world, e, cmd, prev, pt, seq);
  stepWheel(world, e, prev, pt, seq);
  stepWaterCurse(world, e, dt, seq);
  const drowning = stepSwimming(world, e, dt);
  for (let pulse = 0; pulse < drowning && !ecs.dead[e]; pulse++) hurtPlayer(world, e,
    ecs.maxHp[e] * tuning.swim.damageFraction,
    { kind: 'drowning', x: ecs.x[e], z: ecs.z[e], knock: 0, noInv: true, pierce: true, seq });

  if (ecs.dead[e] > 0) {
    ecs.moveMul[e] = 0;
    ecs.guardT[e] = -1;
    cancelCast(ecs, e);
    // Provisional deaths finish the current tick without starting respawn before their receipt.
    if (!world.isPlayerDeathPending?.(e)) {
      ecs.deadT[e] -= dt;
      if (ecs.deadT[e] <= 0) respawnPlayer(world, e, seq);
    }
    setAct(ecs, e, ecs.dead[e] > 0 ? ACT.DEAD : ACT.IDLE);
    return;
  }
  if (stepGrab(world, e, cmd)) { contacts(world, e, prev, pt, seq); return; }
  dec('stagger');
  if (ecs.regenT[e] > Cb.regenDelay && ecs.hp[e] < ecs.maxHp[e]) ecs.hp[e] = Math.min(ecs.maxHp[e], ecs.hp[e] + ecs.maxHp[e] * Cb.regenRate * dt);
  const gMax = guardMax(ecs, e);
  if ((melee ? ecs.guardT[e] < 0 : ecs.guardRegT[e] > G.regenDelay) && ecs.guardSt[e] < gMax) { // P2: regen only while the shield is down, no delay
    const needMul = ecs.needs[e] > 0 ? staminaRegenMul(ecs.sat[e], ecs.hyd[e]) : 1;
    const mealMul = mealEffects(ecs.mealKind?.[e] ?? 0, ecs.mealTicks?.[e] ?? 0).regen;
    ecs.guardSt[e] = Math.min(gMax, ecs.guardSt[e] + (melee ? MELEE_GUARD.regen : G.regen * dt) * needMul * mealMul);
  }
  if (ecs.catchN[e] > 0 && ecs.catchT[e] > G.catchLife) {
    ecs.catchN[e] = ecs.catchHv[e] = ecs.catchDmg[e] = 0;
    world.emit({ type: 'guard', st: 'lost', e, seq, x: ecs.x[e], z: ecs.z[e] });
  }
  if (world.isServer && world.checkpoint) world.checkpoint(e);
  if (melee && ecs.rollT[e] > 0) {
    ecs.guardT[e] = -1; ecs.moveMul[e] = 0;
    ecs.act[e] = ecs.rollBack[e] ? ACT.ROLL_B : ACT.ROLL_F; ecs.actT[e] = ecs.rollT[e] * dt;
    contacts(world, e, prev, pt, seq); return;
  }
  // P2: the dizzy and the shield's timers tick on commands that run. lagging / stunned: this command is inside the
  // drop lag / shieldstun (no attack, guard, skill or potion). A shield up or dropping ignores attack presses.
  if (melee && (ecs.dizzy[e] > 0 || ecs.brk[e] > 0)) stepDizzy(ecs, e, cmd);
  const lagging = melee && ecs.guardLag[e] > 0, stunned = melee && ecs.guardStun[e] > 0;
  if (lagging) ecs.guardLag[e] -= 1;
  if (stunned) ecs.guardStun[e] -= 1;
  const shielding = melee && (ecs.guardT[e] >= 0 || lagging);
  if (shielding) ecs.atkBuf[e] = ecs.atkLatch[e] = 0;
  if (cmd.w) stepEquip(world, e, cmd);
  if ((cmd.prs & BTN.POTION) && !(melee && (lagging || stunned || ecs.dizzy[e] > 0))) usePotion(world, e, seq, pt);

  const atkPress = (cmd.prs & BTN.ATTACK) !== 0, guardPress = (cmd.prs & BTN.GUARD) !== 0;
  const pistol = skillOf(ecs, e, 'basic') === 'pistol';
  const blow = melee && ecs.atkStage[e] > 0 ? swingDescriptor(1, ecs, e) : null;
  const chargeLocked = blow?.smash && swingFrame(ecs.atkT[e]) + 1 >= blow.chargeOpen
    && swingFrame(ecs.atkT[e]) <= blow.chargeClose && (cmd.btn & BTN.ATTACK) && !ecs.chgStop[e] && ecs.chgN[e] < MELEE_SMASH.cap;
  const dashShield = melee && ((cmd.btn | cmd.prs) & BTN.DASH) && (ecs.guardT[e] >= 0 || Math.hypot(cmd.mx || 0, cmd.mz || 0) < MELEE_ROLL.stick);
  const bodyShield = melee && (ecs.guardT[e] >= 0 || dashShield);
  const trigger = pistol && !bodyShield && (atkPress || (cmd.btn & BTN.ATTACK) !== 0); // held LMB keeps the left gun firing
  const triggerSecondary = pistol && !bodyShield && (guardPress || (cmd.btn & BTN.GUARD) !== 0); // RMB/K/LT/touch fires the right gun
  const guardHeld = dashShield || (!pistol && (guardPress || (cmd.btn & BTN.GUARD) !== 0));
  if (pistol && !melee && ecs.guardT[e] >= 0) ecs.guardT[e] = -1; // the pistol kit has no guard action
  if (atkPress && (!melee || pistol) && !shielding && !dashShield) ecs.atkBuf[e] = T.player.inputBuffer;
  if (atkPress && !melee && !shielding && ecs.atkStage[e] > 0) ecs.atkLatch[e] = 1;
  if (cmd.prs & BTN.R) {
    if (kitUnlocked(ecs, e, 'r')) ecs.rBuf[e] = T.player.inputBuffer;
    else world.emit({ type: 'locked', e, seq, slot: 'r' });
  }
  bufferSkills(world, e, cmd, seq);
  if (lagging || stunned || chargeLocked) ecs.qBuf[e] = ecs.eBuf[e] = ecs.gBuf[e] = ecs.rBuf[e] = 0;

  const dashing = ecs.dashT[e] >= 0 || air; // a jump cancels a swing and the guard just as a dash does
  if (dashing) {
    if (ecs.atkStage[e] > 0) { ecs.lastStage[e] = 0; ecs.atkStage[e] = 0; }
    ecs.guardT[e] = -1;
    if (melee) ecs.guardLag[e] = 0; // a dash or jump out of the drop lag
    cancelCast(ecs, e); // only in a cast's recovery: its windup / active frames hold the dash back
  }
  if (ecs.stagger[e] > 0) cancelCast(ecs, e);
  const canAct = !ecs.swim[e] && !dashing && ecs.stagger[e] <= 0 && !lagging && !stunned && !chargeLocked;

  // Coyote: right after a parryable touched you, LMB turns its pending damage into a POBRE reflect (from
  // where you stand; the cutlass only: the pistols reflect by catching) and RMB into a block.
  if (((atkPress && !pistol) || (guardPress && !pistol)) && canAct) {
    for (const k of [0, 1]) {
      const id = k ? ecs.pend1[e] : ecs.pend0[e];
      if (!id) continue;
      const s = world.hazards.slot.get(id);
      const dmg = k ? ecs.pend1D[e] : ecs.pend0D[e];
      if (k) ecs.pend1[e] = 0; else ecs.pend0[e] = 0;
      if (s === undefined) continue;
      const H = world.hazards;
      faceAim(ecs, e, cmd);
      if (atkPress && !pistol) {
        H.dead[s] = NEVER; // re-open it so reflect() sees a live projectile at the hit point
        swordReflect(world, e, s, Math.min(pt, H.dead[s]), seq, 1, { fromX: ecs.x[e], fromZ: ecs.z[e], coyote: true });
      } else if (melee) {
        // P2: the pending bullet is a plain shield block (no powershield) and the shield comes up with it.
        const hx = H.px(s, H.dead[s]), hz = H.pz(s, H.dead[s]), v = H.velocityAt(s, H.dead[s]);
        if (ecs.guardT[e] < 0 && ecs.guardSt[e] > 0) {
          ecs.guardT[e] = 0; ecs.guardP[e] = 0;
          world.emit({ type: 'guard', st: 'up', e, seq, x: ecs.x[e], z: ecs.z[e] });
        }
        if (ecs.guardT[e] >= 0) guardTake(world, e, dmg, hx, hz, seq, { pid: id, fire: H.fire[s], coyote: 1, noPower: true, dx: v.x, dz: v.z });
        else hurtPlayer(world, e, dmg, { x: hx, z: hz, kind: 'proj', src: id, seq, fire: H.fire[s] });
      } else {
        const hx = H.px(s, H.dead[s]), hz = H.pz(s, H.dead[s]);
        ecs.guardSt[e] -= dmg * G.cost; ecs.guardRegT[e] = 0;
        world.emit({ type: 'guard', st: 'block', e, seq, pid: id, x: hx, z: hz, heavy: 0, coyote: 1 });
        hurtPlayer(world, e, dmg * G.blockMult, { x: hx, z: hz, kind: 'block', src: id, seq, knock: G.knock, noInv: true, fire: H.fire[s] });
      }
    }
  }

  // Guard: up while RMB is held and nothing else is going on (a swing in its recovery is cut short; an
  // attack press wins over the guard). A new raise is only PERFECT-capable once the re-arm has run out.
  const st0 = ecs.atkStage[e] > 0 ? swingDescriptor(world.meleeVersion, ecs, e) : null;
  const busy = st0 && swingBusy(st0, ecs.atkT[e]);
  const linking = st0 && st0.link > 0 && (melee ? ecs.atkLink[e] > 0 && !ecs.atkRej[e] : ecs.atkLatch[e] > 0); // under Melee a latched press wins over the guard too
  const guardOk = guardHeld && canAct && !busy && !castBusy(ecs, e) && !trigger && !(ecs.atkBuf[e] > 0) && !linking && !skillWanted(ecs, e) && !(ecs.rBuf[e] > 0 && ecs.riposte[e] >= P.riposte.max);
  if (melee) {
    // P2: Melee's shield. It stays up while held, for at least minHold frames and through shieldstun; a release past that
    // drops it into the drop lag (1 frame after a powershield). Anything else that wants the body drops it at once.
    if (ecs.guardT[e] >= 0) {
      if (stunned || guardOk) { if (!(cmd.btn & BTN.AIM)) faceAim(ecs, e, cmd); }
      else if (guardHeld || !canAct) { ecs.guardT[e] = -1; ecs.guardP[e] = 0; }
      else if (shieldAge(ecs, e) >= MELEE_GUARD.minHold) {
        ecs.guardT[e] = -1; ecs.guardLag[e] = ecs.guardP[e] > 0 ? 0 : MELEE_GUARD.dropLag - 1; ecs.guardP[e] = 0;
      }
    } else if (guardOk && ecs.guardSt[e] > 0) {
      if (ecs.atkStage[e] > 0) { ecs.lastStage[e] = ecs.atkStage[e]; ecs.atkStage[e] = 0; ecs.comboT[e] = 0; }
      ecs.guardT[e] = 0; ecs.guardP[e] = 0; ecs.guardLag[e] = 0;
      faceAim(ecs, e, cmd);
      world.emit({ type: 'guard', st: 'up', e, seq, x: ecs.x[e], z: ecs.z[e] });
    }
    // Melee drains a held shield, not one in shieldstun.
    if (ecs.guardT[e] >= 0 && !stunned) { ecs.guardSt[e] -= MELEE_GUARD.drain; if (ecs.guardSt[e] <= 0) shieldBreak(world, e, seq, ecs.x[e], ecs.z[e]); }
  } else if (guardOk) {
    if (ecs.atkStage[e] > 0) { ecs.lastStage[e] = ecs.atkStage[e]; ecs.atkStage[e] = 0; ecs.comboT[e] = 0; }
    if (ecs.guardT[e] < 0 && ecs.guardSt[e] >= G.minRaise) {
      ecs.guardT[e] = 0;
      ecs.guardP[e] = ecs.guardRe[e] <= 0 ? 1 : 0;
      ecs.guardRe[e] = G.rearm;
      faceAim(ecs, e, cmd);
      world.emit({ type: 'guard', st: 'up', e, seq, x: ecs.x[e], z: ecs.z[e] });
    } else if (ecs.guardT[e] >= 0 && !(cmd.btn & BTN.AIM)) faceAim(ecs, e, cmd); // auto-aim keeps facing the threat
  } else if (ecs.guardT[e] >= 0) ecs.guardT[e] = -1;

  // Weapon skills (Q / E): wait for a swing's active frames, cut its recovery.
  if (canAct && !busy && !castBusy(ecs, e) && skillWanted(ecs, e)) tryCast(world, e, cmd, seq);
  if (castBusy(ecs, e)) stepCast(world, e, cmd, dt, pt, seq);

  // Pistol triggers are independent and may both fire on the same command. Old catches are released once,
  // on the first shot, for profiles that entered this kit with a guard catch already stored.
  const firePrimary = pistol && !bodyShield && canAct && !castBusy(ecs, e) && (trigger || ecs.atkBuf[e] > 0) && ecs.shotCd[e] <= 0;
  const fireSecondary = pistol && !bodyShield && canAct && !castBusy(ecs, e) && triggerSecondary && ecs.shotAltCd[e] <= 0;
  if (firePrimary || fireSecondary) {
    ecs.guardT[e] = -1;
    faceAim(ecs, e, cmd);
    if (ecs.catchN[e] > 0) releaseCaught(world, e, seq);
    if (firePrimary) { ecs.atkBuf[e] = 0; firePistol(world, e, pt, seq); }
    if (fireSecondary) firePistolSecondary(world, e, pt, seq);
  }

  // Melee combo.
  if (!pistol && canAct && !castBusy(ecs, e) && ecs.atkStage[e] === 0 && (melee ? atkPress && !shielding && !dashShield : ecs.atkBuf[e] > 0)) {
    const ls = ecs.lastStage[e];
    // Under Melee a blow links only through the latch: from rest it is always jab 1.
    swingStage(world, e, !melee && ecs.comboT[e] <= M.comboGap && ls > 0 && ls < 3 ? ls + 1 : 1, cmd);
  }
  if (ecs.atkStage[e] > 0 && melee) meleeSwing(world, e, cmd, dt, pt, seq, canAct, prev);
  else if (ecs.atkStage[e] > 0) {
    const stage = ecs.atkStage[e], st = M.stages[stage - 1];
    const t0 = ecs.atkT[e];
    ecs.atkT[e] += dt;
    const t1 = ecs.atkT[e];
    const a0 = st.windup, a1 = st.windup + st.active;
    if (t1 > a0 && t0 < a1) {
      if (st.lunge > 0) {
        const step = (st.lunge / st.active) * (Math.min(t1, a1) - Math.max(t0, a0));
        moveWithCollision(world, e, Math.sin(ecs.facing[e]) * step, Math.cos(ecs.facing[e]) * step);
      }
      swingActive(world, e, st, stage, pt, seq);
    }
    if (t1 >= a1 && ecs.atkBuf[e] > 0 && stage < 3 && canAct) swingStage(world, e, stage + 1, cmd);
    // The recovery ends by time, or as soon as the stick asks to move (a buffered press above still chains first).
    else if (t1 >= a1 + st.recover || (t1 >= a1 && Math.hypot(cmd.mx || 0, cmd.mz || 0) > 0.2)) { ecs.lastStage[e] = stage; ecs.atkStage[e] = 0; ecs.comboT[e] = 0; }
  }

  // R: a full RIPOSTE meter. The cutlass's is the Tormenta (the reflecting wave).
  if (canAct && ecs.rBuf[e] > 0 && ecs.riposte[e] >= P.riposte.max && skillOf(ecs, e, 'r') === 'storm') {
    ecs.rBuf[e] = 0;
    ecs.atkStage[e] = 0; ecs.guardT[e] = -1;
    cancelCast(ecs, e);
    riposteWave(world, e, pt, seq);
    ecs.act[e] = ACT.RIPOSTE; ecs.actT[e] = 0;
  } else if (canAct && ecs.rBuf[e] > 0 && ecs.riposte[e] >= P.riposte.max && skillOf(ecs, e, 'r') === 'rain') {
    // The pistols' R: lead rain on the cursor (you keep moving).
    ecs.rBuf[e] = 0; ecs.guardT[e] = -1;
    callRain(world, e, cmd, pt, seq);
    ecs.act[e] = ACT.CAST; ecs.actT[e] = 0;
  }

  contacts(world, e, prev, pt, seq);

  // Pending (coyote) damage lands.
  for (const k of [0, 1]) {
    const id = k ? ecs.pend1[e] : ecs.pend0[e];
    if (!id || ecs.dead[e] > 0) continue;
    const tk = k ? 'pend1T' : 'pend0T';
    ecs[tk][e] -= dt;
    if (ecs[tk][e] > 1e-9) continue;
    const dmg = k ? ecs.pend1D[e] : ecs.pend0D[e];
    if (k) ecs.pend1[e] = 0; else ecs.pend0[e] = 0;
    if (intangible(ecs, e)) continue; // P2b: a coyote hit still pending when the shield broke is lost
    const s = world.hazards.slot.get(id);
    const H = world.hazards;
    const hx = s !== undefined ? H.px(s, H.dead[s] === NEVER ? pt : H.dead[s]) : ecs.x[e];
    const hz = s !== undefined ? H.pz(s, H.dead[s] === NEVER ? pt : H.dead[s]) : ecs.z[e];
    hurtPlayer(world, e, dmg, { x: hx, z: hz, kind: 'proj', src: id, seq, fire: s !== undefined ? H.fire[s] : 0 });
  }
  if (ecs.guardT[e] >= 0) ecs.guardT[e] += dt;

  // Movement multiplier and the action shown to others.
  if (ecs.dead[e] > 0) { ecs.moveMul[e] = 0; setAct(ecs, e, ACT.DEAD); return; }
  const cp = castPose(ecs, e);
  const firing = pistol && (ecs.shotCd[e] > 0 || ecs.shotAltCd[e] > 0);
  const swingSt = ecs.atkStage[e] > 0 ? swingDescriptor(world.meleeVersion, ecs, e) : null;
  const committed = swingSt && swingBusy(swingSt, ecs.atkT[e]); // the recovery runs at full speed
  const triggerSlow = (trigger && ecs.shotCd[e] > 0) || (triggerSecondary && ecs.shotAltCd[e] > 0); // slow only while a trigger is held
  ecs.moveMul[e] = cp ? cp.move : committed ? swingSt.move : ecs.guardT[e] >= 0 ? (melee ? 0 : G.move)
    : melee && (ecs.guardLag[e] > 0 || ecs.guardStun[e] > 0) ? 0 : ecs.stagger[e] > 0 ? 0 : triggerSlow ? SKILLS.pistol.move : 1;
  let a = ACT.IDLE;
  if (ecs.stagger[e] > 0) a = ACT.STAGGER;
  else if (cp) a = cp.act;
  else if (ecs.guardT[e] >= 0) a = ACT.GUARD;
  else if (firing) a = ACT.SHOOT;
  else if (ecs.act[e] === ACT.CAST && ecs.actT[e] < 0.4) a = ACT.CAST;
  else if (ecs.atkStage[e] > 0) a = melee && ecs.atkSmash[e] ? ACT.SMASH : ACT.SWING1 + ecs.atkStage[e] - 1;
  else if (ecs.act[e] === ACT.RIPOSTE && ecs.actT[e] < 0.45) a = ACT.RIPOSTE;
  setAct(ecs, e, a);
  if (a === ACT.SMASH) ecs.actT[e] = ecs.atkT[e];
  if (melee && !ecs.atkStage[e]) ecs.atkRej[e] = ecs.atkLink[e] = ecs.atkSmash[e] = ecs.chgN[e] = ecs.chgStop[e] = 0;
}

// A ron-coco potion (BTN.POTION): heals a share of max HP at once, then a short cooldown. Predicted.
export function usePotion(world, e, seq, pt = world.tick) {
  const ecs = world.ecs, Pn = CONSUMABLES.potion;
  const why = ecs.potions[e] < 1 ? 'empty' : ecs.potCd[e] > 0 ? 'cd' : ecs.hp[e] >= ecs.maxHp[e] ? 'full' : '';
  if (why) { world.emit({ type: 'potion', e, seq, denied: why }); return false; }
  const curse = ecs.elem[e] === 4 && !world.isNightAt(pt) ? PEARL.inkDayHeal : 1;
  const heal = Math.min(ecs.maxHp[e] - ecs.hp[e], Math.round(ecs.maxHp[e] * Pn.heal * ecs.potHeal[e] * curse));
  ecs.hp[e] += heal;
  ecs.potions[e] -= 1;
  ecs.potCd[e] = Pn.cd;
  world.emit({ type: 'potion', e, seq, heal, n: ecs.potions[e], x: ecs.x[e], z: ecs.z[e] });
  return true;
}

function setAct(ecs, e, a) {
  if (ecs.act[e] !== a) { ecs.act[e] = a; ecs.actT[e] = 0; }
}

export { DT };
