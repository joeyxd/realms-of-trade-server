// Player combat, one fixed step per command (runs after movement in World.applyCommand).
// Shared verbatim by the server and the client's prediction: everything here reads the command and
// the analytic hostile projectiles at the command's projectile tick (pt), so both sides reach the
// same result. Hits on enemies are the one server-only part (world.isServer): the client gets
// them back as events.
//
//   LMB  3-hit combo: windup → active (hits enemies, destroys parryable projectiles) → recover.
//   RMB  parry window (180 ms, first 80 ms PERFECT): reflects parryables, a PERFECT also reflects heavy
//        orbs (a normal parry blocks them: half damage + push). Unstoppable spikes punish a raised parry.
//        Coyote: a parryable that touches you deals its damage 60 ms later; RMB in that gap converts it
//        into a normal parry. Whiff (nothing parried): 0.35 s before the next parry.
//   R    riposte wave when the meter is full: reflects every projectile within 6 u.
//   Dash i-frames: projectiles pass through; dashing through an unstoppable spike = FANTASMA.
//   Graze: a projectile passing within 0.35 u of your hurtbox without touching = ROCE.
import { tuning, DT } from '../../data/tuning.js';
import { BTN, moveWithCollision } from './movement.js';
import { PTYPE, KILL, NEVER, beamSeg, segDist, lavaR } from '../projectiles.js';
import { ACT } from '../ecs.js';

const D2R = Math.PI / 180;

export function statsFor(level) {
  const S = tuning.stats, l = Math.max(1, level) - 1;
  return { hp: S.hp[0] + S.hp[1] * l, atk: S.atk[0] + S.atk[1] * l, def: S.def[0] + S.def[1] * l };
}
export const xpToNext = (level) => tuning.stats.xp[Math.min(tuning.stats.xp.length - 1, Math.max(0, level - 1))];
export const mitigate = (dmg, def) => (dmg <= 0 ? 0 : Math.max(1, Math.round(dmg * (1 - def / (def + tuning.stats.defK)))));

export function applyLevel(world, e, level) {
  const ecs = world.ecs, s = statsFor(level);
  const frac = ecs.maxHp[e] > 0 ? ecs.hp[e] / ecs.maxHp[e] : 1;
  ecs.level[e] = level;
  ecs.maxHp[e] = s.hp; ecs.atk[e] = s.atk; ecs.def[e] = s.def;
  ecs.hp[e] = Math.min(s.hp, Math.max(1, frac * s.hp));
  const dm = level >= 2 ? tuning.dash.chargesLv2 : tuning.dash.chargesBase;
  if (dm > ecs.dashMax[e]) ecs.dashCharges[e] += dm - ecs.dashMax[e];
  ecs.dashMax[e] = dm;
}

export function gainXp(world, e, n, seq = 0) {
  const ecs = world.ecs;
  if (n <= 0 || ecs.level[e] >= tuning.stats.maxLevel) return;
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
  ecs.riposte[e] = Math.min(tuning.parry.riposte.max, ecs.riposte[e] + n);
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
  ecs.atkStage[e] = 0; ecs.parryT[e] = -1; ecs.chain[e] = 0;
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

// A hostile projectile becomes a player-owned shot (parry, perfect, coyote conversion, riposte wave).
function reflect(world, e, s, pt, seq, o) {
  const ecs = world.ecs, H = world.hazards, R = tuning.parry.reflect, P = tuning.parry;
  const x = H.px(s, pt), z = H.pz(s, pt);
  H.remove(s, pt, o.kind || KILL.REFLECT, e, seq);
  const chain = ecs.chain[e];
  let dx = Math.sin(ecs.facing[e]), dz = Math.cos(ecs.facing[e]);
  if (o.radial) {
    const rx = x - ecs.x[e], rz = z - ecs.z[e], rl = Math.hypot(rx, rz);
    if (rl > 0.3) { dx = rx / rl; dz = rz / rl; }
  }
  const dmg = R.dmgMult * Math.max(H.dmg[s], R.atkMult * ecs.atk[e]) * chainMul(P.chainDmg, chain);
  world.spawnShot(e, {
    pid: H.id[s], type: H.type[s], x: o.fromX ?? x, y: o.fromX !== undefined ? ecs.y[e] + 1.1 : H.py(s, pt), z: o.fromZ ?? z, dx, dz,
    speed: Math.max(4, H.speed[s]) * R.speedMult, dmg, life: R.life, r: Math.max(0.2, H.r[s] * 0.9), heavy: H.type[s] === PTYPE.HEAVY, seq,
    bounce: o.kind === KILL.WAVE ? R.bounce.wave : o.perfect ? R.bounce.perfect : R.bounce.normal,
  });
  return { x, z };
}

function countParry(world, e, perfect, seq) {
  const ecs = world.ecs, P = tuning.parry;
  ecs.chain[e] = ecs.chainT[e] <= P.chainGap ? Math.min(P.chainMax, ecs.chain[e] + 1) : 1;
  ecs.chainT[e] = 0;
  ecs.parryHits[e] += 1;
  addRiposte(ecs, e, (perfect ? P.riposte.perfect : P.riposte.normal) * chainMul(P.chainRiposte, ecs.chain[e]));
  if (perfect) gainXp(world, e, P.xp.perfect, seq);
}

function parryProjectiles(world, e, pt, seq) {
  const ecs = world.ecs, H = world.hazards, P = tuning.parry, F = tuning.feel;
  const perfect = ecs.parryT[e] < P.perfect;
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt) || H.type[s] === PTYPE.UNSTOP) continue;
    const x = H.px(s, pt), z = H.pz(s, pt);
    if (!inSector(ecs, e, x, z, P.radius + H.r[s], P.arc)) continue;
    if (H.type[s] === PTYPE.HEAVY && !perfect) {
      // Normal parry on a heavy orb: block (half damage + push), it does not come back.
      H.remove(s, pt, KILL.BLOCK, e, seq);
      ecs.parryHits[e] += 1;
      world.emit({ type: 'block', pid: H.id[s], e, seq, x, z });
      hurtPlayer(world, e, H.dmg[s] * 0.5, { x, z, kind: 'block', src: H.id[s], seq, knock: P.blockKnock });
      world.feel(e, seq, F.hitstopDestroy, 0);
      continue;
    }
    countParry(world, e, perfect, seq);
    const heavy = H.type[s] === PTYPE.HEAVY;
    reflect(world, e, s, pt, seq, { perfect });
    world.emit({ type: 'parry', pid: H.id[s], e, seq, x, z, perfect: perfect ? 1 : 0, chain: ecs.chain[e], heavy: heavy ? 1 : 0 });
    world.feel(e, seq, F.hitstopReflect, perfect ? F.perfectSlowmo : 0);
  }
}

function swingStage(world, e, stage, cmd) {
  const ecs = world.ecs, st = tuning.melee.stages[stage - 1];
  ecs.atkStage[e] = stage; ecs.atkT[e] = 0; ecs.atkBuf[e] = 0; ecs.swingId[e] += 1;
  faceAim(ecs, e, cmd);
  ecs.faceLock[e] = st.windup + st.active + 0.05;
  world.emit({ type: 'swing', e, stage, seq: cmd.seq >>> 0 });
}

// Active frames of a swing: destroy parryables in the arc, clunk on heavy orbs, hit enemies (server).
function swingActive(world, e, st, pt, seq) {
  const ecs = world.ecs, H = world.hazards, P = tuning.parry, F = tuning.feel;
  const tag = 'c' + ecs.swingId[e];
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt) || H.type[s] === PTYPE.UNSTOP) continue;
    const x = H.px(s, pt), z = H.pz(s, pt);
    if (!inSector(ecs, e, x, z, st.range + H.r[s], st.arc)) continue;
    if (H.type[s] === PTYPE.HEAVY) {
      if (!H.hasMark(s, e, tag)) { H.mark(s, e, tag, seq); world.emit({ type: 'clunk', pid: H.id[s], e, seq, x, z }); }
      continue;
    }
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
      H.remove(s, pt, KILL.HIT, e, seq);
      world.emit({ type: 'phit', pid: H.id[s], e, seq, x: hx, z: hz });
      if (type === PTYPE.PARRY && (!ecs.pend0[e] || !ecs.pend1[e])) {
        // Coyote: the damage lands 60 ms later unless RMB comes first.
        if (!ecs.pend0[e]) { ecs.pend0[e] = H.id[s]; ecs.pend0T[e] = P.coyote; ecs.pend0D[e] = H.dmg[s]; }
        else { ecs.pend1[e] = H.id[s]; ecs.pend1T[e] = P.coyote; ecs.pend1D[e] = H.dmg[s]; }
        continue;
      }
      const punish = type === PTYPE.UNSTOP && ecs.parryT[e] >= 0;
      hurtPlayer(world, e, H.dmg[s], { x: hx, z: hz, kind: punish ? 'punish' : 'proj', src: H.id[s], seq });
      if (punish && ecs.dead[e] <= 0) {
        ecs.stagger[e] = PR.unstoppable.stagger;
        ecs.parryT[e] = -1; ecs.atkStage[e] = 0;
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

function riposteWave(world, e, pt, seq) {
  const ecs = world.ecs, H = world.hazards, RP = tuning.parry.riposte;
  ecs.riposte[e] = 0;
  let n = 0;
  for (let s = 0; s < H.cap; s++) {
    if (!H.live(s, pt)) continue;
    const x = H.px(s, pt), z = H.pz(s, pt);
    if (Math.hypot(x - ecs.x[e], z - ecs.z[e]) > RP.radius + H.r[s]) continue;
    reflect(world, e, s, pt, seq, { radial: true, kind: KILL.WAVE });
    n++;
  }
  world.emit({ type: 'riposte', e, seq, x: ecs.x[e], z: ecs.z[e], n });
  if (world.isServer) world.waveHits(e, seq);
  world.feel(e, seq, tuning.feel.hitstopRiposte, 0);
}

export function stepPlayerCombat(world, e, cmd, dt) {
  const ecs = world.ecs, T = tuning, P = T.parry, M = T.melee, Cb = T.combat;
  const seq = cmd.seq >>> 0;
  const pt = world.cmdTick(e, cmd);
  let prev = ecs.lastPt[e];
  if (!(prev > 0) || prev >= pt || pt - prev > 30) prev = pt - 1;
  ecs.lastPt[e] = pt;

  ecs.actT[e] += dt;
  const dec = (k) => { if (ecs[k][e] > 0) ecs[k][e] = Math.max(0, ecs[k][e] - dt); };
  dec('hurtInv'); dec('faceLock'); dec('atkBuf'); dec('parryBuf'); dec('rBuf'); dec('parryLock');
  ecs.chainT[e] += dt; ecs.comboT[e] += dt; ecs.regenT[e] += dt;
  if (ecs.chainT[e] > P.chainGap) ecs.chain[e] = 0;

  if (ecs.dead[e] > 0) {
    ecs.moveMul[e] = 0;
    ecs.deadT[e] -= dt;
    if (ecs.deadT[e] <= 0) respawnPlayer(world, e, seq);
    setAct(ecs, e, ecs.dead[e] > 0 ? ACT.DEAD : ACT.IDLE);
    return;
  }
  dec('stagger');
  if (ecs.regenT[e] > Cb.regenDelay && ecs.hp[e] < ecs.maxHp[e]) ecs.hp[e] = Math.min(ecs.maxHp[e], ecs.hp[e] + ecs.maxHp[e] * Cb.regenRate * dt);
  if (world.isServer && world.checkpoint) world.checkpoint(e);

  const parryPress = (cmd.prs & BTN.PARRY) !== 0;
  if (cmd.prs & BTN.ATTACK) ecs.atkBuf[e] = T.player.inputBuffer;
  if (parryPress) ecs.parryBuf[e] = T.player.inputBuffer;
  if (cmd.prs & BTN.R) ecs.rBuf[e] = T.player.inputBuffer;

  const dashing = ecs.dashT[e] >= 0;
  if (dashing) {
    if (ecs.atkStage[e] > 0) { ecs.lastStage[e] = 0; ecs.atkStage[e] = 0; }
    if (ecs.parryT[e] >= 0) ecs.parryT[e] = -1; // a dash out of a parry is not a whiff
  }
  const canAct = !dashing && ecs.stagger[e] <= 0;

  // Coyote: RMB right after a parryable touched you turns its pending damage into a normal parry.
  if (parryPress && canAct) {
    for (const k of [0, 1]) {
      const id = k ? ecs.pend1[e] : ecs.pend0[e];
      if (!id) continue;
      const s = world.hazards.slot.get(id);
      if (k) ecs.pend1[e] = 0; else ecs.pend0[e] = 0;
      if (s === undefined) continue;
      countParry(world, e, false, seq);
      faceAim(ecs, e, cmd);
      const H = world.hazards;
      H.dead[s] = NEVER; // re-open it so reflect() sees a live projectile at the hit point
      const at = reflect(world, e, s, Math.min(pt, H.dead[s]), seq, { fromX: ecs.x[e], fromZ: ecs.z[e] });
      world.emit({ type: 'parry', pid: id, e, seq, x: at.x, z: at.z, perfect: 0, chain: ecs.chain[e], heavy: 0, coyote: 1 });
      world.feel(e, seq, T.feel.hitstopReflect, 0);
    }
  }

  // Parry window.
  if (canAct && ecs.parryBuf[e] > 0 && ecs.parryLock[e] <= 0 && ecs.parryT[e] < 0) {
    ecs.parryT[e] = 0; ecs.parryHits[e] = 0; ecs.parryBuf[e] = 0;
    ecs.atkStage[e] = 0; ecs.atkBuf[e] = 0;
    faceAim(ecs, e, cmd);
    ecs.faceLock[e] = P.window + 0.08;
    world.emit({ type: 'parryUp', e, seq });
  }
  if (ecs.parryT[e] >= 0) {
    parryProjectiles(world, e, pt, seq);
    ecs.parryT[e] += dt;
    if (ecs.parryT[e] >= P.window - 1e-9) {
      if (!ecs.parryHits[e]) { ecs.parryLock[e] = P.whiffRecovery; world.emit({ type: 'whiff', e, seq }); }
      ecs.parryT[e] = -1;
    }
  }

  // Melee combo.
  if (canAct && ecs.parryT[e] < 0 && ecs.atkStage[e] === 0 && ecs.atkBuf[e] > 0) {
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
      swingActive(world, e, st, pt, seq);
    }
    if (t1 >= a1 && ecs.atkBuf[e] > 0 && stage < 3 && canAct) swingStage(world, e, stage + 1, cmd);
    else if (t1 >= a1 + st.recover) { ecs.lastStage[e] = stage; ecs.atkStage[e] = 0; ecs.comboT[e] = 0; }
  }

  // Riposte release.
  if (canAct && ecs.rBuf[e] > 0 && ecs.riposte[e] >= P.riposte.max) {
    ecs.rBuf[e] = 0;
    ecs.atkStage[e] = 0; ecs.parryT[e] = -1;
    riposteWave(world, e, pt, seq);
    ecs.act[e] = ACT.RIPOSTE; ecs.actT[e] = 0;
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

  // Movement multiplier and the action shown to others.
  if (ecs.dead[e] > 0) { ecs.moveMul[e] = 0; setAct(ecs, e, ACT.DEAD); return; }
  ecs.moveMul[e] = ecs.atkStage[e] > 0 ? M.stages[ecs.atkStage[e] - 1].move : ecs.parryT[e] >= 0 ? 0.35 : ecs.stagger[e] > 0 ? 0 : 1;
  let a = ACT.IDLE;
  if (ecs.stagger[e] > 0) a = ACT.STAGGER;
  else if (ecs.parryT[e] >= 0) a = ACT.PARRY;
  else if (ecs.atkStage[e] > 0) a = ACT.SWING1 + ecs.atkStage[e] - 1;
  else if (ecs.act[e] === ACT.RIPOSTE && ecs.actT[e] < 0.45) a = ACT.RIPOSTE;
  setAct(ecs, e, a);
}

function setAct(ecs, e, a) {
  if (ecs.act[e] !== a) { ecs.act[e] = a; ecs.actT[e] = 0; }
}

export { DT };
