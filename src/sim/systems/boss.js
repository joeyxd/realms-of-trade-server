// HELLFIRE (server only, PLAN-M2.5.md §2.2): a fixed attack cycle per phase instead of chooseAttack.
// Slam when you hug him, the heavy orb on its own timer, then the phase cycle in order. Omnidirectional
// patterns turn `spin` degrees more every attack. At each phase threshold: ENRAGE (invulnerable,
// hostile bullets cleared, minions summoned), then the next cycle. Damage rules live in damageEnemy.
import { ACT, C } from '../ecs.js';
import { dampAngle } from '../../core/math.js';
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
    world.spawnEnemy(a.minion, x, z, ang, { riseT: 0.7, aggro: 40, leash: 60, enc: b.enc, minion: e });
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
    world.emit({ type: 'phase', id: e, phase: b.phase + 1, shield: b.shieldOn ? 1 : 0, x: ecs.x[e], z: ecs.z[e], tick: world.tick, dur: def.enrage });
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
      steer(world, e, def, 0, 0, dt);
      if (b.t >= b.fireDur) { b.state = 'chase'; b.t = 0; b.gcd = P.gap; b.spin += def.spin * D2R; }
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
      if (i >= 0) startWindup(world, e, def, b, i, tx, tz);
    }
  }
}
