// Enemy AI (server only). Steering, no pathfinding (DESIGN §7): approach to range, orbit, back off,
// go home when the target leaves the leash. Attacks are telegraphed: a wind-up (event, so the client
// shows the pose and the glow on its own timeline), then a pattern of projectiles or a ground circle.
// Enemies root while they wind up and fire, so what you see leaving the bow is where it really left.
import { ENEMIES, ENEMY_KINDS } from '../../data/enemies.js';
import { tuning, DT } from '../../data/tuning.js';
import { ACT, C } from '../ecs.js';
import { moveWithCollision } from './movement.js';
import { dampAngle, angleDelta } from '../../core/math.js';

export const defOf = (ecs, e) => ENEMIES[ENEMY_KINDS[ecs.enemy[e]]];

const HIST = 32;

export function makeEnemyBrain(def, x, z, facing, rng, extra = {}) {
  return {
    homeX: x, homeZ: z, homeF: facing,
    target: 0, state: def.dormant ? 'dormant' : 'idle', t: 0,
    atk: -1, gcd: rng.range(0.4, 1.2), every: def.attacks.map((a) => (a.every ? rng.range(2, a.every * 0.6) : 0)),
    orbit: rng() < 0.5 ? 1 : -1, orbitT: rng.range(1.5, 3.5), sinceHit: 99, hitBy: new Map(),
    hx: new Float64Array(HIST), hz: new Float64Array(HIST), histTick: -1,
    ...extra,
  };
}

// Position history for lag-compensated melee: the attacker saw enemies interpTicks in the past.
export function recordHistory(world, e) {
  const b = world.ecs.brain[e], i = world.tick % HIST;
  b.hx[i] = world.ecs.x[e]; b.hz[i] = world.ecs.z[e];
  if (b.histTick < 0) { b.hx.fill(world.ecs.x[e]); b.hz.fill(world.ecs.z[e]); }
  b.histTick = world.tick;
}
export function historyAt(world, e, tick, out) {
  const ecs = world.ecs, b = ecs.brain[e];
  const back = world.tick - tick;
  if (!b || b.histTick < 0 || back <= 0 || back >= HIST - 1) { out.x = ecs.x[e]; out.z = ecs.z[e]; return out; }
  const i = ((tick % HIST) + HIST) % HIST;
  out.x = b.hx[i]; out.z = b.hz[i];
  return out;
}

function pickTarget(world, e, def, b) {
  const ecs = world.ecs;
  let best = 0, bd = Infinity;
  const ax = def.fixed && b.ringX !== undefined ? b.ringX : ecs.x[e];
  const az = def.fixed && b.ringZ !== undefined ? b.ringZ : ecs.z[e];
  const reach = def.fixed ? def.ring : def.aggro;
  if (!reach) return 0;
  for (let p = 1; p < ecs.cap; p++) {
    if (!ecs.alive[p] || !(ecs.mask[p] & C.PLAYER) || (ecs.mask[p] & C.BOT) || ecs.dead[p] > 0) continue;
    const d = Math.hypot(ecs.x[p] - ax, ecs.z[p] - az);
    const keep = p === b.target ? reach * 1.35 : reach; // hysteresis: a target is kept a bit longer
    if (d > keep) continue;
    if (!def.fixed && Math.hypot(ecs.x[p] - b.homeX, ecs.z[p] - b.homeZ) > def.leash) continue;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function setAct(ecs, e, a) { if (ecs.act[e] !== a) { ecs.act[e] = a; ecs.actT[e] = 0; } }

function steer(world, e, def, vx, vz, dt) {
  const ecs = world.ecs;
  // Keep a little space between enemies.
  for (let o = 1; o < ecs.cap; o++) {
    if (o === e || !ecs.alive[o] || !(ecs.mask[o] & C.ENEMY)) continue;
    const dx = ecs.x[e] - ecs.x[o], dz = ecs.z[e] - ecs.z[o], d = Math.hypot(dx, dz);
    const m = ecs.radius[e] + ecs.radius[o] + 0.6;
    if (d < m && d > 1e-6) { vx += (dx / d) * (m - d) * 4; vz += (dz / d) * (m - d) * 4; }
  }
  const k = 1 - Math.exp(-8 * dt);
  ecs.vx[e] += (vx - ecs.vx[e]) * k;
  ecs.vz[e] += (vz - ecs.vz[e]) * k;
  if (Math.abs(ecs.vx[e]) + Math.abs(ecs.vz[e]) > 1e-4) {
    const want = Math.hypot(ecs.vx[e], ecs.vz[e]) * dt;
    const moved = moveWithCollision(world, e, ecs.vx[e] * dt, ecs.vz[e] * dt);
    if (want > 1e-6 && moved < want * 0.4) { ecs.vx[e] *= 0.5; ecs.vz[e] *= 0.5; }
  }
  ecs.moveMag[e] = Math.min(1, Math.hypot(ecs.vx[e], ecs.vz[e]) / Math.max(def.speed, 0.1));
}

function knockback(world, e, dt) {
  const ecs = world.ecs;
  if (ecs.kbx[e] === 0 && ecs.kbz[e] === 0) return;
  moveWithCollision(world, e, ecs.kbx[e] * dt, ecs.kbz[e] * dt);
  const k = Math.exp(-10 * dt);
  ecs.kbx[e] *= k; ecs.kbz[e] *= k;
  if (Math.abs(ecs.kbx[e]) + Math.abs(ecs.kbz[e]) < 0.05) ecs.kbx[e] = ecs.kbz[e] = 0;
}

function chooseAttack(def, b, d) {
  // Priority: attacks with their own timer first (the sentinel's orb), then the first that fits.
  for (let i = 0; i < def.attacks.length; i++) {
    const a = def.attacks[i];
    if (a.every && b.every[i] <= 0 && d >= a.minD && d <= a.maxD) return i;
  }
  for (let i = 0; i < def.attacks.length; i++) {
    const a = def.attacks[i];
    if (!a.every && d >= a.minD && d <= a.maxD) return i;
  }
  return -1;
}

export function stepEnemy(world, e, dt) {
  const ecs = world.ecs, def = defOf(ecs, e), b = ecs.brain[e];
  ecs.actT[e] += dt;
  b.t += dt; b.sinceHit += dt; b.gcd -= dt;
  for (let i = 0; i < b.every.length; i++) b.every[i] -= dt;
  if (def.regen && b.sinceHit > def.regen && ecs.hp[e] < ecs.maxHp[e]) ecs.hp[e] = ecs.maxHp[e];
  knockback(world, e, dt);

  if (b.state === 'dormant') {
    setAct(ecs, e, ACT.DORMANT);
    ecs.vx[e] = ecs.vz[e] = 0; ecs.moveMag[e] = 0;
    const t = pickTarget(world, e, def, b);
    if (t) wake(world, e, t);
    return;
  }
  if (b.state === 'wake') {
    setAct(ecs, e, ACT.WAKE);
    if (b.t >= def.wake) { b.state = 'chase'; b.t = 0; }
    return;
  }
  if (ecs.stagger[e] > 0) {
    ecs.stagger[e] = Math.max(0, ecs.stagger[e] - dt);
    setAct(ecs, e, ACT.STAGGER);
    steer(world, e, def, 0, 0, dt);
    if (ecs.stagger[e] <= 0) { b.state = 'chase'; b.t = 0; }
    return;
  }

  // Target bookkeeping.
  if (b.state !== 'return' && b.state !== 'windup' && b.state !== 'fire') {
    const t = pickTarget(world, e, def, b);
    if (t !== b.target) b.target = t;
    if (!t && !def.fixed && b.state !== 'idle') { b.state = 'return'; b.t = 0; }
  }
  const tgt = b.target;
  const tx = tgt ? ecs.x[tgt] : b.homeX, tz = tgt ? ecs.z[tgt] : b.homeZ;
  const dx = tx - ecs.x[e], dz = tz - ecs.z[e], d = Math.hypot(dx, dz);

  if (def.fixed) {
    // Cannon: turns toward whoever stands in the practice ring and fires on cooldown.
    if (def.turn && tgt && b.state !== 'fire') ecs.facing[e] += Math.max(-def.turn * dt, Math.min(def.turn * dt, angleDelta(ecs.facing[e], Math.atan2(dx, dz))));
  }

  switch (b.state) {
    case 'idle': {
      setAct(ecs, e, ACT.IDLE);
      if (!def.fixed) {
        const hx = b.homeX - ecs.x[e], hz = b.homeZ - ecs.z[e], hd = Math.hypot(hx, hz);
        if (hd > 0.6) steer(world, e, def, (hx / hd) * def.speed * 0.5, (hz / hd) * def.speed * 0.5, dt);
        else { steer(world, e, def, 0, 0, dt); ecs.facing[e] = dampAngle(ecs.facing[e], b.homeF, 3, dt); }
        if (hd > 0.6) ecs.facing[e] = dampAngle(ecs.facing[e], Math.atan2(hx, hz), 8, dt);
      }
      if (tgt) { b.state = 'chase'; b.t = 0; }
      break;
    }
    case 'return': {
      setAct(ecs, e, ACT.IDLE);
      const hx = b.homeX - ecs.x[e], hz = b.homeZ - ecs.z[e], hd = Math.hypot(hx, hz);
      if (hd < 0.8 || b.t > 12) {
        b.state = 'idle'; b.t = 0;
        ecs.hp[e] = ecs.maxHp[e];
        world.emit({ type: 'heal', id: e });
      } else {
        steer(world, e, def, (hx / hd) * def.speed * 1.2, (hz / hd) * def.speed * 1.2, dt);
        ecs.facing[e] = dampAngle(ecs.facing[e], Math.atan2(hx, hz), 8, dt);
      }
      // Re-engage if someone walks back in while it is still near home.
      const t = pickTarget(world, e, def, b);
      if (t && hd < def.leash * 0.6) { b.target = t; b.state = 'chase'; b.t = 0; }
      break;
    }
    case 'chase': {
      setAct(ecs, e, ACT.IDLE);
      if (!tgt) { b.state = def.fixed ? 'idle' : 'return'; break; }
      if (!def.fixed) {
        const ux = dx / Math.max(d, 1e-6), uz = dz / Math.max(d, 1e-6);
        const [lo, hi] = def.range;
        let mx = 0, mz = 0;
        b.orbitT -= dt;
        if (b.orbitT <= 0) { b.orbit = -b.orbit; b.orbitT = world.rng.range(1.8, 3.6); }
        if (d > hi) { mx = ux; mz = uz; }
        else if (d < lo * 0.8) { mx = -ux; mz = -uz; }
        else { mx = -uz * b.orbit * 0.6; mz = ux * b.orbit * 0.6; }
        steer(world, e, def, mx * def.speed, mz * def.speed, dt);
        ecs.facing[e] = dampAngle(ecs.facing[e], Math.atan2(dx, dz), 9, dt);
      }
      if (b.gcd <= 0) {
        const i = chooseAttack(def, b, d);
        if (i >= 0) startWindup(world, e, def, b, i, tx, tz);
      }
      break;
    }
    case 'windup': {
      setAct(ecs, e, ACT.WINDUP);
      const a = def.attacks[b.atk];
      steer(world, e, def, 0, 0, dt);
      // Tracks the target for the first 60 % of the wind-up, then commits (fair to dodge).
      if (a.kind !== 'aoe' && tgt && b.t < a.windup * 0.6 && !def.fixed) ecs.facing[e] = dampAngle(ecs.facing[e], Math.atan2(dx, dz), 10, dt);
      if (b.t >= a.windup) fire(world, e, def, b, a);
      break;
    }
    case 'fire': {
      setAct(ecs, e, ACT.FIRE);
      steer(world, e, def, 0, 0, dt);
      if (b.t >= b.fireDur) { b.state = 'chase'; b.t = 0; b.gcd = def.attacks[b.atk].cd; }
      break;
    }
    default:
      b.state = 'idle';
  }
}

function wake(world, e, target) {
  const ecs = world.ecs, b = ecs.brain[e];
  if (b.state !== 'dormant') return;
  b.state = 'wake'; b.t = 0; b.target = target;
  ecs.act[e] = ACT.WAKE; ecs.actT[e] = 0;
  world.emit({ type: 'wake', id: e, tick: world.tick });
}

function startWindup(world, e, def, b, i, tx, tz) {
  const ecs = world.ecs, a = def.attacks[i];
  b.state = 'windup'; b.t = 0; b.atk = i;
  ecs.vx[e] *= 0.3; ecs.vz[e] *= 0.3;
  if (a.kind === 'aoe') {
    // Commit to the facing now: the circle is drawn in front and bursts at the end of the wind-up.
    ecs.facing[e] = Math.atan2(tx - ecs.x[e], tz - ecs.z[e]);
    const fx = Math.sin(ecs.facing[e]), fz = Math.cos(ecs.facing[e]);
    const id = world.nextAoe++;
    const ax = ecs.x[e] + fx * a.reach, az = ecs.z[e] + fz * a.reach;
    const tAct = world.tick + Math.round(a.windup / DT);
    world.hazards.addAoe({ id, owner: e, x: ax, z: az, r: a.r, t0: world.tick, tAct, dmg: a.dmg });
    world.emit({ type: 'aoe', id, src: e, x: ax, z: az, r: a.r, tick: world.tick, tAct, dmg: a.dmg });
  }
  world.emit({ type: 'windup', id: e, atk: a.id, tick: world.tick, dur: a.windup, ang: ecs.facing[e] });
}

function fire(world, e, def, b, a) {
  const ecs = world.ecs;
  b.state = 'fire'; b.t = 0;
  if (a.every) b.every[b.atk] = a.every;
  if (a.kind === 'aoe') { b.fireDur = a.recover; return; }
  const f = ecs.facing[e], fx = Math.sin(f), fz = Math.cos(f);
  const m = a.muzzle || [0, 1.2, 0.5];
  const mx = ecs.x[e] + fx * m[2] + fz * m[0], my = ecs.y[e] + m[1], mz = ecs.z[e] + fz * m[2] - fx * m[0];
  // Aim the height too: shots from a ledge dip toward the target's chest.
  let slope = 0;
  const t = b.target;
  if (t && ecs.alive[t]) {
    const hd = Math.hypot(ecs.x[t] - mx, ecs.z[t] - mz);
    if (hd > 1) slope = Math.max(-0.35, Math.min(0.35, (ecs.y[t] + 1.1 - my) / hd));
  }
  const ev = {
    type: 'pattern', pid0: world.nextPid, tick: world.tick, src: e, atk: a.id, pat: a.pat, ptype: a.type,
    n: a.n || 1, gap: a.gap || 0, spread: a.spread || 0, speed: a.speed, dmg: a.dmg,
    x: mx, y: my, z: mz, ang: f, slope,
  };
  world.firePattern(ev);
  b.fireDur = (ev.n - 1) * (a.pat === 'burst' || a.pat === 'spiral' ? a.gap : 0) + a.recover;
}

// Damage from players (melee, reflected shots, the riposte wave). Returns the damage dealt.
export function damageEnemy(world, e, raw, o) {
  const ecs = world.ecs, def = defOf(ecs, e), b = ecs.brain[e], M = tuning.melee;
  if (!ecs.alive[e] || ecs.dead[e] > 0) return 0;
  b.sinceHit = 0;
  if (b.state === 'dormant') wake(world, e, o.by);
  if (o.by && !def.fixed && b.state !== 'return') b.target = o.by;
  if (def.invulnerable) {
    world.emit({ type: 'damage', id: e, dmg: 0, by: o.by, kind: o.kind, seq: o.seq || 0, x: ecs.x[e], z: ecs.z[e], immune: 1 });
    return 0;
  }
  const crit = world.rng() < tuning.stats.crit;
  const raw2 = raw * (crit ? tuning.stats.critMult : 1);
  const dmg = Math.max(1, Math.round(raw2 * (1 - (o.pierce ? 0 : ecs.def[e]) / ((o.pierce ? 0 : ecs.def[e]) + tuning.stats.defK))));
  ecs.hp[e] -= dmg;
  if (!def.fixed) {
    const kx = ecs.x[e] - o.x, kz = ecs.z[e] - o.z, kl = Math.hypot(kx, kz);
    const k = o.knock ?? M.knock;
    if (kl > 1e-6) { ecs.kbx[e] += (kx / kl) * k; ecs.kbz[e] += (kz / kl) * k; }
    if (o.heavy) {
      ecs.stagger[e] = M.heavyStagger;
      if (b.state === 'windup' || b.state === 'fire') {
        world.cancelEmitter(e);
        b.state = 'chase'; b.gcd = 0.8;
      }
    }
  }
  world.emit({ type: 'damage', id: e, dmg, by: o.by, kind: o.kind, crit: crit ? 1 : 0, seq: o.seq || 0, x: ecs.x[e], z: ecs.z[e], heavy: o.heavy ? 1 : 0 });
  if (def.regen && ecs.hp[e] < 1) ecs.hp[e] = 1;
  if (ecs.hp[e] <= 0) world.killEnemy(e, o.by);
  return dmg;
}
