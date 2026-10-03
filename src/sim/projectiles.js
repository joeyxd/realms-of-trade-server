// Projectiles. Pure and deterministic (sim, worker, client, node tests).
//
// Hostile projectiles are ANALYTIC: a straight line from (x0, z0) at tick t0 with constant velocity,
// alive until tEnd (life, or the first pillar / rock / cliff on its path, computed once at spawn).
// Their position at any tick is a formula, so:
//   · the server never sends them one by one: it sends a PATTERN event (who, where, angle, params) and
//     every client expands it into the same projectiles with the same ids;
//   · the server can evaluate a player's command at the projectile tick that player was seeing
//     (lag compensation for parries, destroys, hits and grazes) without keeping any history.
// What changes a projectile (a hit, a destroy, a reflect) is an event with the tick and, when a
// player caused it, the sequence number of that player's command (prediction dedupes by it).
//
// Reflected projectiles become SHOTS: owned by a player, stepped every tick with soft homing toward
// enemies, decided by the server (the client steps a visual copy toward what it sees). Weapons fire
// shots too (pistol bullets, pellets). The server tests a shot against the enemies as its shooter saw
// them: `lag` ticks in the past (lag compensation, like melee).
import { tuning, DT } from '../data/tuning.js';

export const PTYPE = { PARRY: 0, HEAVY: 1, UNSTOP: 2 };
export const PTYPE_OF = { parry: PTYPE.PARRY, heavy: PTYPE.HEAVY, unstop: PTYPE.UNSTOP };
export const KILL = { NONE: 0, HIT: 1, DESTROY: 2, REFLECT: 3, BLOCK: 4, CANCEL: 5, WAVE: 6 };
export const NEVER = 0x7fffffff;
// What a player shot is (Shots.kind): a reflected bullet and a released catch ignore armour and the
// boss's shield; pistol bullets and pellets do not.
export const SHOT = { REFLECT: 0, BULLET: 1, PELLET: 2, RELEASE: 3 };

const typeCfg = (t) => (t === PTYPE.HEAVY ? tuning.projectiles.heavy : t === PTYPE.UNSTOP ? tuning.projectiles.unstoppable : tuning.projectiles.parryable);
export const radiusOf = (t) => typeCfg(t).radius;
export const lengthOf = (t) => (t === PTYPE.UNSTOP ? tuning.projectiles.unstoppable.length : 0);

// First distance along (dx, dz) from (x, z) at height y where a static collider or the ground blocks
// a projectile of radius r. Deterministic (same map → same result on every machine).
// slope: height change per u travelled (aimed shots climb or dip toward their target).
export function clipDistance(map, x, y, z, dx, dz, r, maxD, slope = 0) {
  const step = 0.35;
  for (let d = step; d <= maxD; d += step) {
    const px = x + dx * d, pz = z + dz * d;
    if (map.groundAt(px, pz) > y + slope * d - 0.25) return d;
    const list = map.queryColliders(px, pz, r + 1.2);
    for (let k = 0; k < list.length; k++) {
      const c = map.colliders[list[k]];
      const ox = px - c.x, oz = pz - c.z, m = c.r + r * 0.5;
      if (ox * ox + oz * oz < m * m) return d;
    }
  }
  return maxD;
}

export class Hazards {
  constructor(cap = tuning.projectiles.cap) {
    this.cap = cap;
    const I = () => new Int32Array(cap), F = () => new Float64Array(cap);
    this.id = I(); // 0 = free slot
    this.type = new Uint8Array(cap);
    this.owner = I();
    this.x0 = F(); this.z0 = F(); this.y = F(); this.vx = F(); this.vy = F(); this.vz = F(); this.speed = F();
    this.t0 = I(); this.tEnd = I();
    this.r = F(); this.len = F(); this.dmg = F();
    this.dead = I().fill(NEVER); // tick it was removed (hit, destroyed, reflected…)
    this.kill = new Uint8Array(cap);
    this.killBy = I();
    this.killSeq = new Uint32Array(cap);
    this.confirmed = new Uint8Array(cap); // client: the server agreed with a predicted kill
    this.marks = new Array(cap).fill(null); // per-player one-shot flags: [{e, k ('g' graze | 'h' ghost), seq}]
    this.slot = new Map(); // id → slot
    this.freeList = [];
    for (let i = cap - 1; i >= 0; i--) this.freeList.push(i);
    this.count = 0;
    this.aoes = []; // {id, owner, x, z, r, t0, tAct, dmg, keep, hits: [{e, seq}]}
    this.beams = []; // lasers, fire lanes, the boss charge (see beamSeg)
    this.lava = null; // the shrinking lava ring of the boss's last phase (see lavaR)
    this.dropped = 0;
  }

  // Returns the slot or -1 when the pool is full (oldest projectiles are not evicted: patterns are fair).
  // life: seconds, overrides the type's (curtains that must cross the whole arena).
  spawn(id, type, owner, x, y, z, vx, vz, t0, dmg, map, slope = 0, life = 0) {
    const s = this.freeList.pop();
    if (s === undefined) { this.dropped++; return -1; }
    const cfg = typeCfg(type);
    const speed = Math.hypot(vx, vz);
    this.id[s] = id; this.type[s] = type; this.owner[s] = owner;
    this.x0[s] = x; this.z0[s] = z; this.y[s] = y; this.vx[s] = vx; this.vy[s] = slope * speed; this.vz[s] = vz; this.speed[s] = speed;
    this.r[s] = cfg.radius; this.len[s] = lengthOf(type); this.dmg[s] = dmg;
    const L = life || cfg.life;
    let lifeT = Math.round(L / DT);
    if (map && speed > 1e-6) {
      const maxD = speed * L;
      const d = clipDistance(map, x, y, z, vx / speed, vz / speed, cfg.radius, maxD, slope);
      if (d < maxD) lifeT = Math.max(1, Math.round(d / speed / DT));
    }
    this.t0[s] = t0; this.tEnd[s] = t0 + lifeT;
    this.dead[s] = NEVER; this.kill[s] = 0; this.killBy[s] = 0; this.killSeq[s] = 0; this.confirmed[s] = 0;
    this.marks[s] = null;
    this.slot.set(id, s);
    this.count++;
    return s;
  }

  free(s) {
    this.slot.delete(this.id[s]);
    this.id[s] = 0;
    this.marks[s] = null;
    this.freeList.push(s);
    this.count--;
  }

  // Elapsed seconds since spawn at tick t (may be negative: staggered patterns spawn later).
  age(s, t) { return (t - this.t0[s]) * DT; }
  px(s, t) { return this.x0[s] + this.vx[s] * (t - this.t0[s]) * DT; }
  pz(s, t) { return this.z0[s] + this.vz[s] * (t - this.t0[s]) * DT; }
  py(s, t) { return this.y[s] + this.vy[s] * (t - this.t0[s]) * DT; }
  // Exists in the world at tick t (spawned, not past its end, not removed).
  live(s, t) { return this.id[s] !== 0 && t >= this.t0[s] && t < this.tEnd[s] && this.dead[s] === NEVER; }
  armed(s, t) { return (t - this.t0[s]) * DT >= tuning.projectiles.armTime; }

  remove(s, tick, kind, by = 0, seq = 0) {
    this.dead[s] = tick; this.kill[s] = kind; this.killBy[s] = by; this.killSeq[s] = seq;
  }

  hasMark(s, e, k) {
    const m = this.marks[s];
    if (!m) return false;
    for (let i = 0; i < m.length; i++) if (m[i].e === e && m[i].k === k) return true;
    return false;
  }
  mark(s, e, k, seq) { (this.marks[s] || (this.marks[s] = [])).push({ e, k, seq }); }

  // Remove the projectiles an emitter had not fired yet (it died or was staggered mid-burst), its
  // pending ground circles (not the `keep` ones: mortar shells and meteors already in the air) and its
  // beams (a staggered boss stops lasering).
  cancelPending(owner, tick) {
    for (let s = 0; s < this.cap; s++) {
      if (this.id[s] !== 0 && this.owner[s] === owner && this.t0[s] > tick && this.dead[s] === NEVER) this.remove(s, tick, KILL.CANCEL);
    }
    for (const a of this.aoes) if (a.owner === owner && a.tAct > tick && !a.cancel && !a.keep) a.cancel = true;
    for (const b of this.beams) if (b.owner === owner && b.tEnd > tick && !b.cancel && !b.keep) { b.cancel = true; b.cancelT = tick; }
  }

  // Clear everything hostile (boss phase change, end of a wave, debug). The lava is terrain: it stays.
  clear(tick) {
    for (let s = 0; s < this.cap; s++) if (this.id[s] !== 0 && this.dead[s] === NEVER) this.remove(s, tick, KILL.CANCEL);
    for (const a of this.aoes) a.cancel = true;
    for (const b of this.beams) if (!b.cancel && b.tEnd > tick) { b.cancel = true; b.cancelT = tick; }
  }

  // Free slots well after they ended (kept a moment for rewinding and death effects).
  sweep(tick) {
    for (let s = 0; s < this.cap; s++) {
      if (this.id[s] === 0) continue;
      if ((this.dead[s] !== NEVER && tick - this.dead[s] > 40) || tick - this.tEnd[s] > 40) this.free(s);
    }
    for (let i = this.aoes.length - 1; i >= 0; i--) if (tick - this.aoes[i].tAct > 40) this.aoes.splice(i, 1);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      if (tick - b.tEnd > 40 || (b.cancel && tick - b.cancelT > 40)) this.beams.splice(i, 1);
    }
    if (this.lava) this.lava.hits = this.lava.hits.filter((h) => tick - h.tick < 120);
  }

  addAoe(a) { a.hits = []; this.aoes.push(a); return a; }
  addBeam(b) { b.hits = []; b.ghosts = []; this.beams.push(b); return b; }
  setLava(L) { this.lava = L ? { ...L, hits: [] } : null; return this.lava; }
}

// ---- Beams ------------------------------------------------------------------------------------------
// {x0, z0, ang0, omega, vx, vz, off, len, w, t0, tAct, tEnd}: from tAct the origin slides at (vx, vz) u/s
// and the beam turns omega rad/s; it covers the segment from origin + dir·off to origin + dir·(off + len).
//   laser   origin on the boss, turning (two of them, opposite, for laser2)
//   lane    a long band of fire sliding sideways across the arena
//   charge  the boss's own body during a charge (the server moves him along the same formula)
// t0 → tAct is the telegraph (no damage). Positions at tick t (clamped to the active window).
export function beamSeg(b, t, out) {
  const tt = Math.max(b.tAct, Math.min(b.tEnd, t));
  const tau = (tt - b.tAct) * DT;
  const ox = b.x0 + b.vx * tau, oz = b.z0 + b.vz * tau, a = b.ang0 + b.omega * tau;
  const dx = Math.sin(a), dz = Math.cos(a);
  out.ax = ox + dx * b.off; out.az = oz + dz * b.off;
  out.bx = ox + dx * (b.off + b.len); out.bz = oz + dz * (b.off + b.len);
  out.ox = ox; out.oz = oz; out.ang = a;
  return out;
}

// Distance from (px, pz) to the segment (ax, az)–(bx, bz); out.cx/cz = closest point.
export function segDist(px, pz, ax, az, bx, bz, out) {
  const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.cx = ax + abx * t; out.cz = az + abz * t;
  return Math.hypot(px - out.cx, pz - out.cz);
}

// ---- Lava -------------------------------------------------------------------------------------------
// {cx, cz, r0, rMin, rate, t0, R, dmg, every}: the safe radius shrinks from r0 to rMin at `rate` u/s;
// between it and R + 1 the ground burns (dmg every `every` ticks, counted from t0).
export function lavaR(L, t) { return Math.max(L.rMin, L.r0 - L.rate * Math.max(0, t - L.t0) * DT); }

// ---- Patterns -------------------------------------------------------------------------------------
// ev: {pid0, tick, src, pat, ptype, n, gap, spread, speed, dmg, x, y, z, ang, slope, arms, waves, alt}.
// Projectile k gets id pid0 + k. Angles follow the facing convention (0 = +z, atan2(dx, dz)).
//   burst   n aimed shots, gap s apart
//   fan     n shots at once, spread deg apart, centred on ang
//   spiral  n shots over time on `arms` arms (default 1): arm k % arms, step ⌊k / arms⌋ turns spread deg
//           and waits gap s
//   ring    n shots around a full circle (alt: every other one unstoppable)
//   rings   `waves` rings of n, gap s apart, each turned spread deg from the last (alt as ring)
//   rows    a curtain: `waves` rows of n side by side (sp u apart, across ang), gap s apart; row w leaves
//           a hole of hw shots from index holes[w] (the ids are used anyway). life: s (optional)
export function patternCount(ev) {
  if (ev.pat === 'single') return 1;
  if (ev.pat === 'rings' || ev.pat === 'rows') return (ev.n | 0) * Math.max(1, ev.waves | 0);
  return ev.n | 0;
}

export function emitPattern(store, ev, map) {
  const n = patternCount(ev);
  const type = PTYPE_OF[ev.ptype] ?? PTYPE.PARRY;
  const D2R = Math.PI / 180, TAU = Math.PI * 2;
  const arms = Math.max(1, ev.arms | 0), per = ev.n | 0;
  for (let k = 0; k < n; k++) {
    let ang = ev.ang, t0 = ev.tick, j = k;
    if (ev.pat === 'burst') t0 = ev.tick + Math.round((k * ev.gap) / DT);
    else if (ev.pat === 'fan') ang = ev.ang + (k - (n - 1) / 2) * ev.spread * D2R;
    else if (ev.pat === 'spiral') {
      const step = Math.floor(k / arms);
      ang = ev.ang + ((k % arms) / arms) * TAU + step * ev.spread * D2R;
      t0 = ev.tick + Math.round((step * ev.gap) / DT);
    } else if (ev.pat === 'ring') ang = ev.ang + (k / n) * TAU;
    else if (ev.pat === 'rings') {
      const w = Math.floor(k / per);
      j = k % per;
      ang = ev.ang + (j / per) * TAU + w * ev.spread * D2R;
      t0 = ev.tick + Math.round((w * ev.gap) / DT);
    }
    let x = ev.x, z = ev.z;
    if (ev.pat === 'rows') {
      const w = Math.floor(k / per);
      j = k % per;
      const h = ev.holes ? ev.holes[w] : -1;
      if (h !== undefined && h >= 0 && j >= h && j < h + (ev.hw | 0)) continue;
      const o = (j - (per - 1) / 2) * ev.sp;
      x += Math.cos(ang) * o; z -= Math.sin(ang) * o;
      t0 = ev.tick + Math.round((w * ev.gap) / DT);
    }
    const speed = Math.min(ev.speed, tuning.projectiles.maxSpeed);
    const t = (ev.pat === 'ring' || ev.pat === 'rings') && ev.alt ? (j % 2 ? PTYPE.UNSTOP : PTYPE.PARRY) : type;
    store.spawn(ev.pid0 + k, t, ev.src, x, ev.y, z, Math.sin(ang) * speed, Math.cos(ang) * speed, t0, ev.dmg, map, ev.slope || 0, ev.life || 0);
  }
  return n;
}

// Seconds from the first projectile of a pattern to the last one.
export function patternSpan(ev) {
  if (ev.pat === 'burst') return Math.max(0, (ev.n | 0) - 1) * (ev.gap || 0);
  if (ev.pat === 'spiral') return Math.floor(Math.max(0, (ev.n | 0) - 1) / Math.max(1, ev.arms | 0)) * (ev.gap || 0);
  if (ev.pat === 'rings' || ev.pat === 'rows') return Math.max(0, (ev.waves | 0) - 1) * (ev.gap || 0);
  return 0;
}

// ---- Shots (reflected, player-owned) -----------------------------------------------------------------
export class Shots {
  constructor(cap = tuning.projectiles.shotCap) {
    this.cap = cap;
    const F = () => new Float64Array(cap);
    this.id = new Int32Array(cap);
    this.type = new Uint8Array(cap);
    this.owner = new Int32Array(cap);
    this.target = new Int32Array(cap);
    this.x = F(); this.y = F(); this.z = F(); this.vx = F(); this.vz = F(); this.speed = F();
    this.life = F(); this.dmg = F(); this.r = F();
    this.heavy = new Uint8Array(cap);
    this.pid = new Int32Array(cap); // the hostile projectile it came from (0: a bounce, a released catch)
    // Prediction key: the client adopts the server's copy of a shot it predicted by this (reflects: the
    // projectile id; shots made by a command: −(seq·8 + k + 1); bounces: 0, never predicted).
    this.key = F();
    this.homing = F(); this.cone = F(); // soft homing (rad/s) toward enemies in a cone ahead (deg); 0 = straight
    this.kind = new Uint8Array(cap); // SHOT.*
    this.knock = F(); // knockback on hit (0 = the melee default)
    this.lag = new Int32Array(cap); // server: ticks behind the present its hits and homing are judged at
    this.bounce = new Uint8Array(cap); // server: jumps left after a hit
    this.lastHit = new Int32Array(cap); // server: the enemy it bounced off (not chosen again right away)
    this.pred = new Uint32Array(cap); // client: seq of the command that predicted it (0 = from the server)
    this.slot = new Map();
    this.cursor = 0;
    this.count = 0;
  }

  spawn(id, o) {
    let s = -1;
    for (let k = 0; k < this.cap; k++) {
      const i = (this.cursor + k) % this.cap;
      if (this.id[i] === 0) { s = i; break; }
    }
    if (s < 0) return -1;
    this.cursor = (s + 1) % this.cap;
    this.id[s] = id; this.type[s] = o.type; this.owner[s] = o.owner; this.target[s] = o.target || 0;
    this.x[s] = o.x; this.y[s] = o.y; this.z[s] = o.z;
    this.speed[s] = o.speed; this.vx[s] = o.dx * o.speed; this.vz[s] = o.dz * o.speed;
    this.life[s] = o.life; this.dmg[s] = o.dmg; this.r[s] = o.r; this.heavy[s] = o.heavy ? 1 : 0;
    this.pid[s] = o.pid || 0; this.pred[s] = o.pred || 0; this.key[s] = o.key || 0;
    this.homing[s] = o.homing ?? tuning.parry.reflect.wave.homing; this.cone[s] = o.cone ?? tuning.parry.reflect.wave.cone;
    this.bounce[s] = o.bounce || 0; this.lastHit[s] = o.lastHit || 0;
    this.kind[s] = o.kind || 0; this.knock[s] = o.knock || 0; this.lag[s] = o.lag || 0;
    this.slot.set(id, s);
    this.count++;
    return s;
  }

  free(s) {
    this.slot.delete(this.id[s]);
    this.id[s] = 0;
    this.count--;
  }

  // One step: soft homing toward the target (re-acquired in a cone ahead when lost), then move.
  // findTarget(x, z, dirX, dirZ, coneCos) → id or 0; targetPos(id, out) → bool.
  step(s, dt, findTarget, targetPos, tmp) {
    let tx = this.homing[s] > 0 ? this.target[s] : 0;
    const sp = this.speed[s];
    const dx = this.vx[s] / sp, dz = this.vz[s] / sp;
    if (this.homing[s] > 0 && (!tx || !targetPos(tx, tmp))) {
      tx = findTarget(this.x[s], this.z[s], dx, dz, Math.cos((this.cone[s] / 2) * Math.PI / 180));
      this.target[s] = tx;
      if (tx && !targetPos(tx, tmp)) tx = 0;
    }
    if (tx) {
      if (tmp.y !== undefined) this.y[s] += Math.max(-2 * dt, Math.min(2 * dt, tmp.y - this.y[s]));
      const want = Math.atan2(tmp.x - this.x[s], tmp.z - this.z[s]);
      const cur = Math.atan2(dx, dz);
      let d = want - cur;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = this.homing[s] * dt;
      const a = cur + Math.max(-maxTurn, Math.min(maxTurn, d));
      this.vx[s] = Math.sin(a) * sp; this.vz[s] = Math.cos(a) * sp;
    }
    this.x[s] += this.vx[s] * dt;
    this.z[s] += this.vz[s] * dt;
    this.life[s] -= dt;
  }
}
