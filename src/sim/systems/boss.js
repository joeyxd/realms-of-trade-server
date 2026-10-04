// HELLFIRE (server only, PLAN-M2.5.md §2.2): a fixed attack cycle per phase instead of chooseAttack.
// Slam when you hug him, the heavy orb on its own timer, then the phase cycle in order. Omnidirectional
// patterns turn `spin` degrees more every attack. At each phase threshold: ENRAGE (invulnerable,
// hostile bullets cleared, minions summoned), then the next cycle. Damage rules live in damageEnemy.
import { ACT, C } from '../ecs.js';
import { DT } from '../../data/tuning.js';
import { dampAngle } from '../../core/math.js';
import { clipDistance, beamSeg, lavaR } from '../projectiles.js';
import { pickTarget, steer, startWindup, fire, setAct } from './enemies.js';

const D2R = Math.PI / 180;

export function bossBrain(def) {
  return { phase: 0, cyc: 0, spin: 0, heavyT: def.phases[0].heavyEvery * 0.6, inv: 0, broken: 0, slamCd: 0, shieldOn: !!def.phases[0].shield };
}

const attackIndex = (def, id) => def.attacks.findIndex((a) => a.id === id);

export function minionCount(world, boss) {
  const ecs = world.ecs;
  let n = 0;
  for (let o = 1; o < ecs.cap; o++) if (ecs.alive[o] && (ecs.mask[o] & C.ENEMY) && ecs.dead[o] <= 0 && ecs.brain[o] && ecs.brain[o].minion === boss) n++;
  return n;
}

export function summonMinions(world, e, a, b, n = a.n) {
  const ecs = world.ecs;
  const k = Math.min(n, a.max - minionCount(world, e));
  for (let i = 0; i < k; i++) {
    const ang = ecs.facing[e] + (i - (k - 1) / 2) * 0.9 + (b.spin || 0);
    const x = ecs.x[e] + Math.sin(ang) * a.r, z = ecs.z[e] + Math.cos(ang) * a.r;
    const kind = Array.isArray(a.minion) ? a.minion[(b.summoned = (b.summoned || 0) + 1) % a.minion.length] : a.minion;
    world.spawnEnemy(kind, x, z, ang, { riseT: 0.7, aggro: 40, leash: 60, enc: b.enc, minion: e });
  }
  return k;
}

export function stepBoss(world, e, def, b, dt) {
  const ecs = world.ecs;
  if (b.inv > 0) b.inv -= dt;
  if (b.broken > 0) {
    b.broken -= dt;
    if (b.broken <= 0) world.emit({ type: 'shield', id: e, st: b.shieldOn ? 'up' : 'off' });
  }
  b.heavyT -= dt; b.slamCd -= dt;
  const P = def.phases[b.phase];

  // Phase threshold → ENRAGE.
  if (b.state !== 'enrage' && b.phase + 1 < def.phases.length && ecs.hp[e] <= ecs.maxHp[e] * P.until) {
    b.phase++; b.cyc = 0; b.state = 'enrage'; b.t = 0; b.inv = def.enrage;
    const NP = def.phases[b.phase];
    b.shieldOn = !!NP.shield; b.heavyT = NP.heavyEvery * 0.5;
    world.cancelEmitter(e);
    world.clearHostile();
    setAct(ecs, e, ACT.ENRAGE);
    world.emit({ type: 'phase', id: e, phase: b.phase + 1, shield: b.shieldOn ? 1 : 0, x: ecs.x[e], z: ecs.z[e], tick: world.tick, dur: def.enrage, last: b.phase + 1 === def.phases.length ? 1 : 0 });
    if (NP.lava && def.lava) {
      // The arena starts to burn from the rim inward once the roar is over.
      const c = arenaOf(world, e, b), L = def.lava;
      world.setLava({ owner: e, cx: c.x, cz: c.z, r0: L.r0, rMin: L.rMin, rate: L.rate, t0: world.tick + Math.round(def.enrage / DT), R: L.R, dmg: L.dmg, every: Math.round(L.every / DT) });
    }
    return;
  }

  if (b.state !== 'windup' && b.state !== 'fire') b.target = pickTarget(world, e, def, b);
  const tgt = b.target;
  const tx = tgt ? ecs.x[tgt] : b.homeX, tz = tgt ? ecs.z[tgt] : b.homeZ;
  const dx = tx - ecs.x[e], dz = tz - ecs.z[e], d = Math.hypot(dx, dz);

  switch (b.state) {
    case 'enrage': {
      setAct(ecs, e, ACT.ENRAGE);
      steer(world, e, def, 0, 0, dt);
      if (b.t >= def.enrage) {
        const NP = def.phases[b.phase], si = attackIndex(def, 'summon');
        if (NP.summon && si >= 0) summonMinions(world, e, def.attacks[si], b, NP.summon);
        b.state = 'chase'; b.t = 0; b.gcd = 0.6;
      }
      break;
    }
    case 'windup': {
      setAct(ecs, e, ACT.WINDUP);
      const a = def.attacks[b.atk];
      steer(world, e, def, 0, 0, dt);
      if (a.kind === 'pattern' && !a.omni && tgt && b.t < a.windup * 0.6) ecs.facing[e] = dampAngle(ecs.facing[e], Math.atan2(dx, dz), 10, dt);
      if (b.t >= a.windup) fire(world, e, def, b, a);
      break;
    }
    case 'fire': {
      setAct(ecs, e, ACT.FIRE);
      if (b.charge) chargeStep(world, e, def, b);
      else steer(world, e, def, 0, 0, dt);
      if (b.lasers && !b.lasers[0].cancel) ecs.facing[e] = beamSeg(b.lasers[0], world.tick, SEG).ang;
      if (b.t >= b.fireDur) { b.state = 'chase'; b.t = 0; b.gcd = P.gap; b.spin += def.spin * D2R; b.charge = null; b.lasers = null; }
      break;
    }
    default: {
      // idle / chase: keep to range around the target, drifting around them slowly.
      setAct(ecs, e, ACT.IDLE);
      b.state = 'chase';
      if (!tgt) { steer(world, e, def, 0, 0, dt); break; }
      const ux = dx / Math.max(d, 1e-6), uz = dz / Math.max(d, 1e-6), [lo, hi] = def.range;
      b.orbitT -= dt;
      if (b.orbitT <= 0) { b.orbit = -b.orbit; b.orbitT = world.rng.range(3, 5); }
      let mx = -uz * b.orbit * 0.5, mz = ux * b.orbit * 0.5;
      if (d > hi) { mx += ux; mz += uz; } else if (d < lo) { mx -= ux * 0.6; mz -= uz * 0.6; }
      steer(world, e, def, mx * def.speed, mz * def.speed, dt);
      ecs.facing[e] = dampAngle(ecs.facing[e], Math.atan2(dx, dz), 5, dt);
      if (b.gcd > 0) break;
      let i = -1;
      const slam = attackIndex(def, 'slam');
      if (slam >= 0 && d < def.slamR && b.slamCd <= 0) { i = slam; b.slamCd = def.attacks[slam].cd; }
      else if (b.heavyT <= 0) { i = attackIndex(def, 'orb'); b.heavyT = P.heavyEvery; }
      else {
        for (let k = 0; k < P.cycle.length && i < 0; k++) {
          const id = P.cycle[b.cyc++ % P.cycle.length], j = attackIndex(def, id), a = def.attacks[j];
          if (a.kind === 'summon' && minionCount(world, e) >= a.max) continue;
          i = j;
        }
      }
      if (i >= 0) { startWindup(world, e, def, b, i, tx, tz); bossWindup(world, e, def, b, def.attacks[i], tx, tz); }
    }
  }
}

const SEG = { ax: 0, az: 0, bx: 0, bz: 0, ox: 0, oz: 0, ang: 0 };

// The arena the boss fights in (its encounter), for lava, lanes, meteors and curtains.
export function arenaOf(world, e, b) {
  const enc = b.enc && world.encounters ? world.encounters.find((q) => q.id === b.enc) : null;
  if (enc) return { x: enc.cx, z: enc.cz, r: world.map.landmarks.arenaR };
  return { x: b.homeX, z: b.homeZ, r: world.map.landmarks.arenaR };
}
// Radius that is still safe to stand in (the lava eats it in phase 3).
function safeR(world, c) {
  const L = world.hazards.lava;
  return L ? lavaR(L, world.tick) - 0.8 : c.r - 1.5;
}

// Telegraphed beams are created when the wind-up starts: the wind-up is their telegraph.
function bossWindup(world, e, def, b, a, tx, tz) {
  const ecs = world.ecs, tAct = world.tick + Math.round(a.windup / DT);
  if (a.kind === 'charge') {
    const f = Math.atan2(tx - ecs.x[e], tz - ecs.z[e]);
    ecs.facing[e] = f;
    const dx = Math.sin(f), dz = Math.cos(f);
    // Stop at walls, rocks and the arena rim.
    let len = clipDistance(world.map, ecs.x[e], ecs.y[e] + 1.2, ecs.z[e], dx, dz, ecs.radius[e], a.len);
    const c = arenaOf(world, e, b);
    while (len > 1 && Math.hypot(ecs.x[e] + dx * len - c.x, ecs.z[e] + dz * len - c.z) > c.r - 1.5) len -= 0.5;
    const dur = Math.max(1, Math.round(len / a.speed / DT));
    b.charge = world.addBeam({
      owner: e, kind: 'charge', x0: ecs.x[e], z0: ecs.z[e], ang0: f, vx: dx * a.speed, vz: dz * a.speed,
      off: -a.w / 2, len: a.w, w: a.w, tele: len + a.w / 2, tAct, tEnd: tAct + dur, dmg: a.dmg, every: 600, knock: a.knock,
    });
  } else if (a.kind === 'laser') {
    b.laserSign = -(b.laserSign || -1);
    const f = ecs.facing[e], om = b.laserSign * a.omega * D2R;
    b.lasers = [];
    for (let k = 0; k < a.beams; k++) {
      b.lasers.push(world.addBeam({
        owner: e, kind: 'laser', x0: ecs.x[e], z0: ecs.z[e], ang0: f + (k / a.beams) * Math.PI * 2, omega: om,
        off: a.off, len: a.len, w: a.w, tAct, tEnd: tAct + Math.round(a.dur / DT), dmg: a.dmg, every: Math.round(a.every / DT), fire: a.fire,
      }));
    }
  } else if (a.kind === 'lanes') {
    const c = arenaOf(world, e, b), th = world.rng.range(0, Math.PI * 2), sgn = world.rng() < 0.5 ? 1 : -1;
    const dx = Math.sin(th), dz = Math.cos(th), px = Math.cos(th) * sgn, pz = -Math.sin(th) * sgn;
    const travel = a.speed * a.dur, start = -(c.r + a.w) + world.rng.range(0, 3);
    for (let k = 0; k < a.n; k++) {
      const o = start + k * a.spacing;
      world.addBeam({
        owner: e, kind: 'lane', x0: c.x + px * o - dx * a.len / 2, z0: c.z + pz * o - dz * a.len / 2, ang0: th,
        vx: px * a.speed, vz: pz * a.speed, off: 0, len: a.len, w: a.w, tAct, tEnd: tAct + Math.round(a.dur / DT),
        dmg: a.dmg, every: Math.round(a.every / DT), travel, fire: a.fire,
      });
    }
  }
}

// fire() hands the boss-only attacks here. Returns true when handled.
export function bossFire(world, e, def, b, a) {
  const ecs = world.ecs;
  if (a.kind === 'charge') { b.fireDur = (b.charge ? (b.charge.tEnd - b.charge.tAct) * DT : 0) + a.recover; return true; }
  if (a.kind === 'laser') { b.fireDur = a.dur + a.recover; return true; }
  if (a.kind === 'lanes') { b.fireDur = a.recover + 0.4; return true; }
  if (a.kind === 'meteors') {
    const c = arenaOf(world, e, b), R = safeR(world, c), t = b.target;
    for (let i = 0; i < a.n; i++) {
      let x, z;
      if (t && ecs.alive[t] && i % a.aimEvery === 0) { x = ecs.x[t]; z = ecs.z[t]; }
      else {
        const r = Math.sqrt(world.rng()) * R, an = world.rng.range(0, Math.PI * 2);
        x = c.x + Math.sin(an) * r; z = c.z + Math.cos(an) * r;
      }
      world.addAoe({ owner: e, x, z, r: a.r, tAct: world.tick + Math.round((a.tele + i * a.stagger) / DT), dmg: a.dmg, keep: 1, fire: a.fire, fall: 'meteor', fx: x + 4, fz: z - 3, fy: ecs.y[e] + 22 });
    }
    b.fireDur = a.recover + 0.3;
    return true;
  }
  if (a.pat === 'rows') {
    // A curtain from the far side of the arena, sweeping toward the target, one hole per row.
    const c = arenaOf(world, e, b), t = b.target;
    const tx = t ? ecs.x[t] : ecs.x[e], tz = t ? ecs.z[t] : ecs.z[e];
    let ang = Math.atan2(tx - c.x, tz - c.z);
    if (Math.hypot(tx - c.x, tz - c.z) < 1) ang = ecs.facing[e];
    const x = c.x - Math.sin(ang) * a.from, z = c.z - Math.cos(ang) * a.from;
    const holes = [];
    let h = Math.floor(world.rng.range(0, a.n - a.hw));
    for (let w = 0; w < a.waves; w++) {
      holes.push(h);
      h = Math.max(0, Math.min(a.n - a.hw, h + Math.round(world.rng.range(-7, 7))));
    }
    const ev = {
      type: 'pattern', pid0: world.nextPid, tick: world.tick, src: e, atk: a.id, pat: 'rows', ptype: a.type,
      n: a.n, waves: a.waves, gap: a.gap, sp: a.sp, hw: a.hw, holes, life: a.life, spread: 0, speed: a.speed, dmg: a.dmg,
      x, y: world.map.groundAt(x, z) + 1.1, z, ang, slope: 0,
    };
    world.firePattern(ev);
    b.fireDur = (a.waves - 1) * a.gap + a.recover;
    return true;
  }
  return false;
}

// The charge: he IS the beam, so his position follows its formula exactly (the client draws the beam
// where the server will hit).
function chargeStep(world, e, def, b) {
  const ecs = world.ecs, B = b.charge;
  if (B.cancel || world.tick < B.tAct || world.tick > B.tEnd) { ecs.vx[e] = ecs.vz[e] = 0; ecs.moveMag[e] = 0; return; }
  beamSeg(B, world.tick, SEG);
  ecs.x[e] = SEG.ox; ecs.z[e] = SEG.oz; ecs.y[e] = world.map.groundAt(SEG.ox, SEG.oz);
  ecs.vx[e] = B.vx; ecs.vz[e] = B.vz; ecs.kbx[e] = ecs.kbz[e] = 0;
  ecs.moveMag[e] = 1;
}
