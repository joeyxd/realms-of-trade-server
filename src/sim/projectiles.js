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
// enemies, decided by the server (the client steps a visual copy toward what it sees).
import { tuning, DT } from '../data/tuning.js';

export const PTYPE = { PARRY: 0, HEAVY: 1, UNSTOP: 2 };
export const PTYPE_OF = { parry: PTYPE.PARRY, heavy: PTYPE.HEAVY, unstop: PTYPE.UNSTOP };
export const KILL = { NONE: 0, HIT: 1, DESTROY: 2, REFLECT: 3, BLOCK: 4, CANCEL: 5, WAVE: 6 };
export const NEVER = 0x7fffffff;

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
    this.aoes = []; // {id, owner, x, z, r, t0, tAct, dmg, hits: [{e, seq}]}
    this.dropped = 0;
  }

  // Returns the slot or -1 when the pool is full (oldest projectiles are not evicted: patterns are fair).
  spawn(id, type, owner, x, y, z, vx, vz, t0, dmg, map, slope = 0) {
    const s = this.freeList.pop();
    if (s === undefined) { this.dropped++; return -1; }
    const cfg = typeCfg(type);
    const speed = Math.hypot(vx, vz);
    this.id[s] = id; this.type[s] = type; this.owner[s] = owner;
    this.x0[s] = x; this.z0[s] = z; this.y[s] = y; this.vx[s] = vx; this.vy[s] = slope * speed; this.vz[s] = vz; this.speed[s] = speed;
    this.r[s] = cfg.radius; this.len[s] = lengthOf(type); this.dmg[s] = dmg;
    let lifeT = Math.round(cfg.life / DT);
    if (map && speed > 1e-6) {
      const maxD = speed * cfg.life;
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

  // Remove the projectiles an emitter had not fired yet (it died or was staggered mid-burst).
  cancelPending(owner, tick) {
    for (let s = 0; s < this.cap; s++) {
      if (this.id[s] !== 0 && this.owner[s] === owner && this.t0[s] > tick && this.dead[s] === NEVER) this.remove(s, tick, KILL.CANCEL);
    }
    for (const a of this.aoes) if (a.owner === owner && a.tAct > tick && !a.cancel) a.cancel = true;
  }

  // Clear everything hostile (boss phase change in M3, debug).
  clear(tick) {
    for (let s = 0; s < this.cap; s++) if (this.id[s] !== 0 && this.dead[s] === NEVER) this.remove(s, tick, KILL.CANCEL);
    for (const a of this.aoes) a.cancel = true;
  }

  // Free slots well after they ended (kept a moment for rewinding and death effects).
  sweep(tick) {
    for (let s = 0; s < this.cap; s++) {
      if (this.id[s] === 0) continue;
      if ((this.dead[s] !== NEVER && tick - this.dead[s] > 40) || tick - this.tEnd[s] > 40) this.free(s);
    }
    for (let i = this.aoes.length - 1; i >= 0; i--) if (tick - this.aoes[i].tAct > 40) this.aoes.splice(i, 1);
  }

  addAoe(a) { a.hits = []; this.aoes.push(a); return a; }
}

// ---- Patterns -------------------------------------------------------------------------------------
// ev: {pid0, tick, src, pat, ptype, n, gap, spread, speed, dmg, x, y, z, ang, slope}. Projectile k gets id pid0 + k.
// Angles follow the facing convention (0 = +z, atan2(dx, dz)).
export function patternCount(ev) { return ev.pat === 'single' ? 1 : ev.n | 0; }

export function emitPattern(store, ev, map) {
  const n = patternCount(ev);
  const type = PTYPE_OF[ev.ptype] ?? PTYPE.PARRY;
  const D2R = Math.PI / 180;
  for (let k = 0; k < n; k++) {
    let ang = ev.ang, t0 = ev.tick;
    if (ev.pat === 'burst') t0 = ev.tick + Math.round((k * ev.gap) / DT);
    else if (ev.pat === 'fan') ang = ev.ang + (k - (n - 1) / 2) * ev.spread * D2R;
    else if (ev.pat === 'spiral') { ang = ev.ang + k * ev.spread * D2R; t0 = ev.tick + Math.round((k * ev.gap) / DT); }
    else if (ev.pat === 'ring') ang = ev.ang + (k / n) * Math.PI * 2;
    const speed = Math.min(ev.speed, tuning.projectiles.maxSpeed);
    const t = ev.pat === 'ring' && ev.alt ? (k % 2 ? PTYPE.UNSTOP : PTYPE.PARRY) : type;
    store.spawn(ev.pid0 + k, t, ev.src, ev.x, ev.y, ev.z, Math.sin(ang) * speed, Math.cos(ang) * speed, t0, ev.dmg, map, ev.slope || 0);
  }
  return n;
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
    this.pid = new Int32Array(cap); // the hostile projectile it came from
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
    this.pid[s] = o.pid || 0; this.pred[s] = o.pred || 0;
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
    const R = tuning.parry.reflect;
    let tx = this.target[s];
    const sp = this.speed[s];
    const dx = this.vx[s] / sp, dz = this.vz[s] / sp;
    if (!tx || !targetPos(tx, tmp)) {
      tx = findTarget(this.x[s], this.z[s], dx, dz, Math.cos((R.cone / 2) * Math.PI / 180));
      this.target[s] = tx;
      if (tx && !targetPos(tx, tmp)) tx = 0;
    }
    if (tx) {
      if (tmp.y !== undefined) this.y[s] += Math.max(-2 * dt, Math.min(2 * dt, tmp.y - this.y[s]));
      const want = Math.atan2(tmp.x - this.x[s], tmp.z - this.z[s]);
      const cur = Math.atan2(dx, dz);
      let d = want - cur;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = R.homing * dt;
      const a = cur + Math.max(-maxTurn, Math.min(maxTurn, d));
      this.vx[s] = Math.sin(a) * sp; this.vz[s] = Math.cos(a) * sp;
    }
    this.x[s] += this.vx[s] * dt;
    this.z[s] += this.vz[s] * dt;
    this.life[s] -= dt;
  }
}
