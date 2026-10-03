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
import { BTN, moveWithCollision } from './movement.js';
import { PTYPE, KILL, NEVER, SHOT, beamSeg, segDist, lavaR } from '../projectiles.js';
import { stepEquip, bufferSkills, skillWanted, tryCast, stepCast, castPose, castBusy, cancelCast, stepWave, skillOf, firePistol, callRain, stepRain } from './skills.js';
import { ACT } from '../ecs.js';
import { hash01 } from '../../core/rng.js';
import { SKILLS } from '../../data/weapons.js';
import { CONSUMABLES } from '../../data/items.js';
import { statsFor, refreshStats, kitUnlocked, passive, guardMax } from './stats.js';

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

export function hurtPlayer(world, e, raw, o) {
  const ecs = world.ecs, C = tuning.combat;
  if (ecs.dead[e] > 0) return 0;
  const dmg = ecs.god[e] > 0 ? 0 : mitigate(raw, ecs.def[e]);
  if (dmg > 0) { ecs.hp[e] -= dmg; ecs.regenT[e] = 0; }
  if (!o.noInv) ecs.hurtInv[e] = C.hurtIframes;
  const kx = ecs.x[e] - o.x, kz = ecs.z[e] - o.z, kl = Math.hypot(kx, kz);
  if (kl > 1e-6) { const k = o.knock ?? C.hitKnock; ecs.kbx[e] += (kx / kl) * k; ecs.kbz[e] += (kz / kl) * k; }
  world.emit({ type: 'hurt', e, dmg, raw, kind: o.kind, src: o.src || 0, seq: o.seq, x: o.x, z: o.z, practice: raw <= 0 ? 1 : 0 });
  if (ecs.hp[e] <= 0) killPlayer(world, e, o.seq);
  return dmg;
}

function killPlayer(world, e, seq) {
  const ecs = world.ecs;
  ecs.hp[e] = 0;
  ecs.dead[e] = 1;
  ecs.deadT[e] = tuning.combat.respawnTime;
  ecs.atkStage[e] = 0; ecs.guardT[e] = -1; ecs.chain[e] = 0;
  ecs.pend0[e] = ecs.pend1[e] = 0;
  ecs.dashT[e] = -1; ecs.state[e] = 0;
  world.emit({ type: 'death', id: e, seq, x: ecs.x[e], z: ecs.z[e] });
}

function respawnPlayer(world, e, seq) {
  const ecs = world.ecs, map = world.map;
  ecs.dead[e] = 0; ecs.deadT[e] = 0;
  ecs.hp[e] = ecs.maxHp[e];
  ecs.x[e] = ecs.cpX[e]; ecs.z[e] = ecs.cpZ[e]; ecs.y[e] = map.groundAt(ecs.x[e], ecs.z[e]);
  ecs.vx[e] = ecs.vz[e] = ecs.kbx[e] = ecs.kbz[e] = 0;
  ecs.hurtInv[e] = tuning.combat.respawnIframes;
  ecs.stagger[e] = 0;
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
  const vx = H.vx[s], vz = H.vz[s], a = vx * vx + vz * vz, b = px * vx + pz * vz;
  if (a < 1e-9 || b >= 0) return Infinity;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return pt + t / DT >= H.tEnd[s] ? Infinity : t;
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
  if (T.spread) a += (hash01(pid, seq) * 2 - 1) * T.spread * D2R;
  const dmg = T.dmg * Math.max(H.dmg[s], R.atkMult * ecs.atk[e]) * chainMul(P.chainDmg, ecs.chain[e]) * ecs.reflMul[e];
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
  hurtPlayer(world, e, raw * (o.heavy ? G.heavyMult : G.blockMult), { x, z, kind: 'block', src: o.pid || o.aoe || 0, seq, knock: o.heavy ? G.heavyKnock : G.knock, noInv: true });
  if (ecs.dead[e] <= 0 && ecs.guardSt[e] <= 0) breakGuard(world, e, seq);
}

function swingStage(world, e, stage, cmd) {
  const ecs = world.ecs, st = tuning.melee.stages[stage - 1];
  ecs.atkStage[e] = stage; ecs.atkT[e] = 0; ecs.atkBuf[e] = 0; ecs.swingId[e] += 1;
  ecs.guardT[e] = -1;
  faceAim(ecs, e, cmd);
  ecs.faceLock[e] = st.windup + st.active + 0.05;
  world.emit({ type: 'swing', e, stage, seq: cmd.seq >>> 0 });
  if (ecs.catchN[e] > 0) releaseCaught(world, e, cmd.seq >>> 0);
}

// Active frames of a swing: reflect (by timing) or destroy the bullets in the arc, clunk on heavy orbs
// that came too early, hit enemies (server).
function swingActive(world, e, st, stage, pt, seq) {
  const ecs = world.ecs, H = world.hazards, P = tuning.parry, F = tuning.feel;
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
  if (world.isServer) world.meleeHits(e, st, pt, seq);
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
      const ux = H.vx[s] / sp, uz = H.vz[s] / sp;
      ax -= ux * len * 0.5; az -= uz * len * 0.5; bx += ux * len * 0.5; bz += uz * len * 0.5;
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
      if (type !== PTYPE.UNSTOP && guardUp(ecs, e) && inGuardArc(ecs, e, hx, hz)) {
        // The guard takes it (a block, or a catch when it was just raised).
        const pid = H.id[s], raw = H.dmg[s];
        H.remove(s, pt, KILL.BLOCK, e, seq);
        guardTake(world, e, raw, hx, hz, seq, { pid, heavy: type === PTYPE.HEAVY });
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
      hurtPlayer(world, e, H.dmg[s], { x: hx, z: hz, kind: punish ? 'punish' : 'proj', src: H.id[s], seq });
      if (punish && ecs.dead[e] <= 0) {
        ecs.stagger[e] = PR.unstoppable.stagger;
        ecs.guardT[e] = -1; ecs.atkStage[e] = 0;
      }
      if (ecs.dead[e] > 0) return;
    } else if (d < touch + PR.graze && !H.hasMark(s, e, 'g') && !H.hasMark(s, e, 'h') && !H.hasMark(s, e, 'p')) {
      // Brushed past and now moving away (straight lines only get farther from here on).
      const rx = H.px(s, pt) - px, rz = H.pz(s, pt) - pz;
      if (rx * H.vx[s] + rz * H.vz[s] > 0) {
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
    if (ecs.iframes[e] > 0 || ecs.hurtInv[e] > 0) continue;
    // Melee circles (a bite, a cleave, a slam) can be guarded if the blow comes from in front; shells and
    // meteors falling from the sky cannot.
    if (!a.keep && guardUp(ecs, e) && inGuardArc(ecs, e, a.sx ?? a.x, a.sz ?? a.z)) {
      guardTake(world, e, a.dmg, a.sx ?? a.x, a.sz ?? a.z, seq, { aoe: a.id });
      if (ecs.dead[e] > 0) return;
      continue;
    }
    hurtPlayer(world, e, a.dmg, { x: a.x, z: a.z, kind: 'aoe', src: a.id, seq, knock: 6 });
    if (ecs.dead[e] > 0) return;
  }
  // Beams (lasers, fire lanes, the boss charge): damage every `every` ticks while you stand in them;
  // dashing through one is a FANTASMA (once per beam).
  for (const b of H.beams) {
    if (b.cancel || pt < b.tAct || prev >= b.tEnd) continue;
    beamSeg(b, Math.min(pt, b.tEnd - 1), SEG);
    const d = segDist(px, pz, SEG.ax, SEG.az, SEG.bx, SEG.bz, SEG);
    if (d >= b.w * 0.5 + hr * 0.5) continue;
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
    hurtPlayer(world, e, b.dmg, { x: SEG.cx, z: SEG.cz, kind: 'beam', src: b.id, seq, knock: b.knock ?? 4 });
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
        hurtPlayer(world, e, L.dmg, { x: px + dx / d, z: pz + dz / d, kind: 'lava', src: L.id, seq, knock: 3, noInv: true });
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
  const seq = cmd.seq >>> 0;
  const pt = world.cmdTick(e, cmd);
  let prev = ecs.lastPt[e];
  if (!(prev > 0) || prev >= pt || pt - prev > 30) prev = pt - 1;
  ecs.lastPt[e] = pt;

  ecs.actT[e] += dt;
  const dec = (k) => { if (ecs[k][e] > 0) ecs[k][e] = Math.max(0, ecs[k][e] - dt); };
  dec('hurtInv'); dec('faceLock'); dec('atkBuf'); dec('rBuf'); dec('guardRe');
  dec('cdQ'); dec('cdE'); dec('qBuf'); dec('eBuf'); dec('castLock'); dec('shotCd'); dec('potCd');
  ecs.chainT[e] += dt; ecs.comboT[e] += dt; ecs.regenT[e] += dt; ecs.guardRegT[e] += dt; ecs.catchT[e] += dt;
  if (ecs.chainT[e] > P.chainGap) ecs.chain[e] = 0;
  // A crescent in flight and the lead rain keep going whatever you do (even down).
  stepWave(world, e, prev, pt, seq);
  stepRain(world, e, prev, pt, seq);

  if (ecs.dead[e] > 0) {
    ecs.moveMul[e] = 0;
    ecs.guardT[e] = -1;
    cancelCast(ecs, e);
    ecs.deadT[e] -= dt;
    if (ecs.deadT[e] <= 0) respawnPlayer(world, e, seq);
    setAct(ecs, e, ecs.dead[e] > 0 ? ACT.DEAD : ACT.IDLE);
    return;
  }
  dec('stagger');
  if (ecs.regenT[e] > Cb.regenDelay && ecs.hp[e] < ecs.maxHp[e]) ecs.hp[e] = Math.min(ecs.maxHp[e], ecs.hp[e] + ecs.maxHp[e] * Cb.regenRate * dt);
  const gMax = guardMax(ecs, e);
  if (ecs.guardRegT[e] > G.regenDelay && ecs.guardSt[e] < gMax) ecs.guardSt[e] = Math.min(gMax, ecs.guardSt[e] + G.regen * dt);
  if (ecs.catchN[e] > 0 && ecs.catchT[e] > G.catchLife) {
    ecs.catchN[e] = ecs.catchHv[e] = ecs.catchDmg[e] = 0;
    world.emit({ type: 'guard', st: 'lost', e, seq, x: ecs.x[e], z: ecs.z[e] });
  }
  if (world.isServer && world.checkpoint) world.checkpoint(e);
  if (cmd.w) stepEquip(world, e, cmd);
  if (cmd.prs & BTN.POTION) usePotion(world, e, seq);

  const atkPress = (cmd.prs & BTN.ATTACK) !== 0, guardPress = (cmd.prs & BTN.GUARD) !== 0;
  const pistol = skillOf(ecs, e, 'basic') === 'pistol';
  const trigger = pistol && (atkPress || (cmd.btn & BTN.ATTACK) !== 0); // held LMB keeps the pistols firing
  const guardHeld = guardPress || (cmd.btn & BTN.GUARD) !== 0;
  if (atkPress) ecs.atkBuf[e] = T.player.inputBuffer;
  if (cmd.prs & BTN.R) {
    if (kitUnlocked(ecs, e, 'r')) ecs.rBuf[e] = T.player.inputBuffer;
    else world.emit({ type: 'locked', e, seq, slot: 'r' });
  }
  bufferSkills(world, e, cmd, seq);

  const dashing = ecs.dashT[e] >= 0;
  if (dashing) {
    if (ecs.atkStage[e] > 0) { ecs.lastStage[e] = 0; ecs.atkStage[e] = 0; }
    ecs.guardT[e] = -1;
    cancelCast(ecs, e); // only in a cast's recovery: its windup / active frames hold the dash back
  }
  if (ecs.stagger[e] > 0) cancelCast(ecs, e);
  const canAct = !dashing && ecs.stagger[e] <= 0;

  // Coyote: right after a parryable touched you, LMB turns its pending damage into a POBRE reflect (from
  // where you stand; the cutlass only: the pistols reflect by catching) and RMB into a block.
  if (((atkPress && !pistol) || guardPress) && canAct) {
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
      } else {
        const hx = H.px(s, H.dead[s]), hz = H.pz(s, H.dead[s]);
        ecs.guardSt[e] -= dmg * G.cost; ecs.guardRegT[e] = 0;
        world.emit({ type: 'guard', st: 'block', e, seq, pid: id, x: hx, z: hz, heavy: 0, coyote: 1 });
        hurtPlayer(world, e, dmg * G.blockMult, { x: hx, z: hz, kind: 'block', src: id, seq, knock: G.knock, noInv: true });
      }
    }
  }

  // Guard: up while RMB is held and nothing else is going on (a swing in its recovery is cut short; an
  // attack press wins over the guard). A new raise is only PERFECT-capable once the re-arm has run out.
  const st0 = ecs.atkStage[e] > 0 ? M.stages[ecs.atkStage[e] - 1] : null;
  const swingBusy = st0 && ecs.atkT[e] < st0.windup + st0.active;
  if (guardHeld && canAct && !swingBusy && !castBusy(ecs, e) && !trigger && !(ecs.atkBuf[e] > 0) && !skillWanted(ecs, e) && !(ecs.rBuf[e] > 0 && ecs.riposte[e] >= P.riposte.max)) {
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
  if (canAct && !swingBusy && !castBusy(ecs, e) && skillWanted(ecs, e)) tryCast(world, e, cmd, seq);
  if (castBusy(ecs, e)) stepCast(world, e, cmd, dt, pt, seq);

  // Pistols: fire while LMB is held (a press is buffered), every SKILLS.pistol.every s. The first shot after
  // a perfect guard also throws the caught bullets back.
  if (pistol && canAct && !castBusy(ecs, e) && (trigger || ecs.atkBuf[e] > 0) && ecs.shotCd[e] <= 0) {
    ecs.atkBuf[e] = 0; ecs.guardT[e] = -1;
    faceAim(ecs, e, cmd);
    if (ecs.catchN[e] > 0) releaseCaught(world, e, seq);
    firePistol(world, e, pt, seq);
  }

  // Melee combo.
  if (!pistol && canAct && !castBusy(ecs, e) && ecs.atkStage[e] === 0 && ecs.atkBuf[e] > 0) {
    const ls = ecs.lastStage[e];
    swingStage(world, e, ecs.comboT[e] <= M.comboGap && ls > 0 && ls < 3 ? ls + 1 : 1, cmd);
  }
  if (ecs.atkStage[e] > 0) {
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
    else if (t1 >= a1 + st.recover) { ecs.lastStage[e] = stage; ecs.atkStage[e] = 0; ecs.comboT[e] = 0; }
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
    const s = world.hazards.slot.get(id);
    const H = world.hazards;
    const hx = s !== undefined ? H.px(s, H.dead[s] === NEVER ? pt : H.dead[s]) : ecs.x[e];
    const hz = s !== undefined ? H.pz(s, H.dead[s] === NEVER ? pt : H.dead[s]) : ecs.z[e];
    hurtPlayer(world, e, dmg, { x: hx, z: hz, kind: 'proj', src: id, seq });
  }
  if (ecs.guardT[e] >= 0) ecs.guardT[e] += dt;

  // Movement multiplier and the action shown to others.
  if (ecs.dead[e] > 0) { ecs.moveMul[e] = 0; setAct(ecs, e, ACT.DEAD); return; }
  const cp = castPose(ecs, e);
  const firing = pistol && ecs.shotCd[e] > 0;
  ecs.moveMul[e] = cp ? cp.move : ecs.atkStage[e] > 0 ? M.stages[ecs.atkStage[e] - 1].move : ecs.guardT[e] >= 0 ? G.move
    : ecs.stagger[e] > 0 ? 0 : firing ? SKILLS.pistol.move : 1;
  let a = ACT.IDLE;
  if (ecs.stagger[e] > 0) a = ACT.STAGGER;
  else if (cp) a = cp.act;
  else if (ecs.guardT[e] >= 0) a = ACT.GUARD;
  else if (firing) a = ACT.SHOOT;
  else if (ecs.act[e] === ACT.CAST && ecs.actT[e] < 0.4) a = ACT.CAST;
  else if (ecs.atkStage[e] > 0) a = ACT.SWING1 + ecs.atkStage[e] - 1;
  else if (ecs.act[e] === ACT.RIPOSTE && ecs.actT[e] < 0.45) a = ACT.RIPOSTE;
  setAct(ecs, e, a);
}

// A ron-coco potion (BTN.POTION): heals a share of max HP at once, then a short cooldown. Predicted.
export function usePotion(world, e, seq) {
  const ecs = world.ecs, Pn = CONSUMABLES.potion;
  const why = ecs.potions[e] < 1 ? 'empty' : ecs.potCd[e] > 0 ? 'cd' : ecs.hp[e] >= ecs.maxHp[e] ? 'full' : '';
  if (why) { world.emit({ type: 'potion', e, seq, denied: why }); return false; }
  const heal = Math.min(ecs.maxHp[e] - ecs.hp[e], Math.round(ecs.maxHp[e] * Pn.heal * ecs.potHeal[e]));
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
