// Authoritative world state. Pure (no THREE, no DOM, no wall clock).
// The same class runs the server (isServer: enemies, shots, hits on enemies) and the client's
// prediction of its own player (movement + combat against the projectiles the client knows about).
import { tuning, DT } from '../data/tuning.js';
import { ENEMIES, ENEMY_KINDS as ENEMY_KINDS_LIST, enemyIndex } from '../data/enemies.js';
import { mulberry32 } from '../core/rng.js';
import { ECS, C, KIND, TEAM, ACT, PLAYER_FIELDS } from './ecs.js';
import { generateWorld } from './worldgen.js';
import { stepMover, moveWithCollision } from './systems/movement.js';
import { makeBotBrain, botCommand } from './systems/bots.js';
import { stepPlayerCombat, applyLevel, gainXp, stormRadius, hurtByPlayer } from './systems/combat.js';
import { makeEnemyBrain, stepEnemy, recordHistory, historyAt, damageEnemy, defOf, newHistory } from './systems/enemies.js';
import { Hazards, Shots, emitPattern, patternCount, PTYPE, SHOT } from './projectiles.js';
import { WEAPON_KINDS, SKILLS } from '../data/weapons.js';
import { skillSegDist, rainR, cancelCast } from './systems/skills.js';
import { applyLoadout } from './systems/stats.js';
import { createEncounter, stepEncounter, encounterKilled } from './systems/encounter.js';
import { lootOnKill, stepDrops } from './systems/inventory.js';
import { questKill, zoneSweep } from './systems/quests.js';
import { stepInfighting } from './systems/lawless.js';
import { LAWLESS } from '../data/lawless.js';
import { burnOnHit, chillOnHit, enemyChillMul, stepBurns, stepChills } from './systems/pearlcombat.js';

const D2R = Math.PI / 180;

export class World {
  constructor(seed, { map, server = false } = {}) {
    this.seed = seed >>> 0;
    this.tick = 0;
    this.rng = mulberry32((seed ^ 0xabcdef) >>> 0);
    this.map = map || generateWorld(this.seed);
    this.ecs = new ECS(2048);
    this.events = [];
    this.isServer = server;
    this.hazards = new Hazards();
    this.chills = new Map();
    this.fieldOwner = 0; // online prediction may set this to the server entity id for stable field identities
    this.shots = new Shots();
    this.nextPid = 1;
    this.nextSid = 1;
    this.nextAoe = 1;
    this.spawners = [];
    this.encounters = []; // server: scripted fights (populate)
    this.feelQ = new Map(); // e → {seq, hitstop, slowmo} merged per command
    this.shockSeq = new Map(); // e → seq of its last perfect-guard shock
    this.phist = new Map(); // server: pirate → position history and hit bookkeeping (friendly fire, M4.5)
    this.tmp = { x: 0, z: 0, y: 0 };
    this.tmpLag = { x: 0, z: 0 };
  }

  emit(ev) {
    if (ev.elem === undefined && ev.e && this.ecs.elem[ev.e]) ev.elem = this.ecs.elem[ev.e];
    this.events.push(ev);
  }

  // ---- Spawning ---------------------------------------------------------------------------------------
  spawnPlayer({ name = 'Grumete', skin = 0, level = 1, x, z, clientId = -1, bot = false, facing = 0, weapon = 0 }) {
    const ecs = this.ecs;
    const e = ecs.create(KIND.PLAYER, C.POS | C.MOVER | C.DASH | C.PLAYER | C.HEALTH | (bot ? C.BOT : 0));
    const s = this.map.landmarks.spawn;
    ecs.x[e] = x ?? s.x;
    ecs.z[e] = z ?? s.z;
    ecs.y[e] = this.map.groundAt(ecs.x[e], ecs.z[e]);
    ecs.facing[e] = facing;
    ecs.speed[e] = tuning.player.runSpeed;
    ecs.radius[e] = tuning.player.radius;
    ecs.hurtR[e] = tuning.player.hurtRadius;
    ecs.team[e] = TEAM.PLAYERS;
    ecs.dashMax[e] = 0;
    applyLevel(this, e, level);
    ecs.hp[e] = ecs.maxHp[e];
    ecs.dashCharges[e] = ecs.dashMax[e];
    ecs.guardSt[e] = tuning.guard.stamina + ecs.guardAdd[e];
    ecs.weapon[e] = Math.max(0, Math.min(WEAPON_KINDS.length - 1, weapon | 0));
    applyLoadout(this, e); // its weapon's arts in Q / E (a profile replaces them: attachProfile)
    const cp = this.map.checkpoints.spawn;
    ecs.cpX[e] = cp.x; ecs.cpZ[e] = cp.z;
    ecs.skin[e] = skin;
    ecs.names[e] = name;
    ecs.clientId[e] = clientId;
    if (bot) ecs.bot[e] = makeBotBrain(this.rng);
    this.events.push({ type: 'spawn', id: e });
    return e;
  }

  spawnNpc(def) {
    const ecs = this.ecs;
    const e = ecs.create(KIND.NPC, C.POS | C.NPC);
    ecs.x[e] = def.x; ecs.z[e] = def.z; ecs.y[e] = this.map.groundAt(def.x, def.z);
    ecs.facing[e] = def.facing || 0;
    ecs.skin[e] = def.skin || 0;
    ecs.names[e] = def.name;
    ecs.titles[e] = def.title || '';
    ecs.level[e] = 30;
    if (def.id) { if (!this.npcs) this.npcs = new Map(); this.npcs.set(def.id, e); } // M4: quests, the vendor
    this.events.push({ type: 'spawn', id: e });
    return e;
  }

  spawnEnemy(kind, x, z, facing = 0, extra = {}) {
    const ecs = this.ecs, def = ENEMIES[kind];
    const e = ecs.create(KIND.ENEMY, C.POS | C.MOVER | C.HEALTH | C.ENEMY);
    this.chills.delete(e);
    ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = this.map.groundAt(x, z);
    ecs.facing[e] = facing;
    ecs.enemy[e] = enemyIndex(kind);
    ecs.speed[e] = def.speed;
    ecs.radius[e] = def.radius;
    ecs.hurtR[e] = def.hurt;
    ecs.team[e] = TEAM.ENEMIES;
    // Co-op scaling (encounters): the boss's minions take their boss's multiplier.
    let mul = extra.hpMul > 0 ? extra.hpMul : 1;
    if (extra.minion && extra.enc) { const q = this.encounters.find((o) => o.id === extra.enc); if (q && q.bossMul) mul = q.bossMul; }
    ecs.hp[e] = ecs.maxHp[e] = Math.round(def.hp * mul);
    ecs.def[e] = def.def;
    ecs.level[e] = def.level || 1;
    ecs.names[e] = extra.name || def.name;
    ecs.titles[e] = def.title || '';
    ecs.brain[e] = makeEnemyBrain(def, x, z, facing, this.rng, extra);
    // The Marea of its encounter (M4): damage, XP and loot follow it.
    if (extra.enc) { const q = this.encounters.find((o) => o.id === extra.enc); if (q && q.tierDef) ecs.brain[e].tier = q.tierDef; }
    ecs.act[e] = extra.riseT ? ACT.WAKE : def.dormant ? ACT.DORMANT : ACT.IDLE;
    this.events.push({ type: 'spawn', id: e });
    // Encounter spawns stand up out of the ground first (bones assemble / a burst of fire).
    if (extra.riseT) this.emit({ type: 'rise', id: e, kind, x, z, dur: extra.riseT, tick: this.tick });
    // A boss's minions join its encounter's roster.
    if (extra.minion && extra.enc) { const enc = this.encounters.find((q) => q.id === extra.enc); if (enc) enc.alive.add(e); }
    return e;
  }

  // Map spawn points + the practice ground (server).
  populate() {
    const m = this.map;
    for (const sp of m.enemySpawns) this.spawners.push({ ...sp, entity: 0, timer: 0 });
    const P = m.practice;
    this.spawners.push({ kind: 'dummy', x: P.dummy.x, z: P.dummy.z, facing: P.dummy.facing, entity: 0, timer: 0 });
    this.spawners.push({ kind: 'cannon', x: P.cannon.x, z: P.cannon.z, facing: P.cannon.facing, entity: 0, timer: 0, extra: { ringX: P.ring.x, ringZ: P.ring.z } });
    for (const sp of this.spawners) sp.entity = this.spawnEnemy(sp.kind, sp.x, sp.z, sp.facing, sp.extra);
    this.encounters.push(createEncounter('caldera', m));
  }

  despawn(e) {
    this.burns?.delete(e);
    this.chills.delete(e);
    this.ecs.destroy(e);
    this.phist.delete(e);
    this.events.push({ type: 'despawn', id: e });
  }

  // ---- Commands -----------------------------------------------------------------------------------------
  // The projectile tick a command is evaluated at: what the client saw, within the rewind budget.
  cmdTick(e, cmd) {
    if (!this.isServer) return cmd.pt >>> 0; // prediction: exactly what the client is showing
    const C2 = tuning.combat;
    const pt = cmd.pt >>> 0;
    if (!pt) return this.tick;
    return Math.max(this.tick - C2.rewind, Math.min(this.tick + C2.lead, pt));
  }

  applyCommand(e, cmd) {
    if (!this.ecs.alive[e]) return;
    stepMover(this, e, cmd, DT);
    if (this.ecs.mask[e] & C.HEALTH) stepPlayerCombat(this, e, cmd, DT);
    this.flushFeel(e);
    this.ecs.lastSeq[e] = cmd.seq >>> 0;
  }

  // Hitstop / slow-mo requests from one command, merged (several reflects in a tick = one hitstop).
  feel(e, seq, hitstop, slowmo) {
    const q = this.feelQ.get(e);
    if (q && q.seq === seq) { q.hitstop = Math.max(q.hitstop, hitstop); q.slowmo = slowmo ? Math.min(q.slowmo || 1, slowmo) : q.slowmo; return; }
    this.flushFeel(e);
    this.feelQ.set(e, { seq, hitstop, slowmo: slowmo || 0 });
  }
  flushFeel(e) {
    const q = this.feelQ.get(e);
    if (!q) return;
    this.feelQ.delete(e);
    const F = tuning.feel;
    this.emit({ type: 'time', e, seq: q.seq, hitstop: q.hitstop, scale: q.slowmo || 1, dur: q.slowmo ? F.perfectSlowmoTime : 0 });
  }
  flushAllFeel() { for (const e of [...this.feelQ.keys()]) this.flushFeel(e); }

  // ---- Projectiles ------------------------------------------------------------------------------------
  // How hard enemy e hits (its Marea, M4): every hostile pattern, circle, beam and the lava go through here.
  dmgMul(e) { const b = e ? this.ecs.brain[e] : null; return b && b.tier ? b.tier.dmg : 1; }
  enemyMoveMul(e) {
    const ecs = this.ecs;
    return Math.min(this.hazards.fieldSlowAt(ecs.x[e], ecs.z[e], this.tick), enemyChillMul(this, e));
  }

  firePattern(ev) {
    if (ev.src && this.dmgMul(ev.src) !== 1) ev.dmg = Math.round(ev.dmg * this.dmgMul(ev.src));
    this.nextPid += patternCount(ev);
    emitPattern(this.hazards, ev, this.map);
    this.emit(ev);
  }

  // Remove every hostile projectile and pending ground circle (phase change, end of a wave). The
  // players' reflected shots keep flying.
  clearHostile() {
    this.hazards.clear(this.tick);
    this.emit({ type: 'clear', tick: this.tick, hostile: 1 });
  }

  // Ground circle / beam / lava, created here so the event carries everything the client rebuilds.
  addAoe(o) {
    const a = { id: this.nextAoe++, owner: o.owner || 0, x: o.x, z: o.z, r: o.r, t0: o.t0 ?? this.tick, tAct: o.tAct, dmg: Math.round(o.dmg * this.dmgMul(o.owner)), keep: o.keep ? 1 : 0, fire: o.fire ? 1 : 0 };
    // Where the blow comes from (a melee bite / cleave / slam): the guard checks it against its arc.
    if (o.sx !== undefined) { a.sx = o.sx; a.sz = o.sz; }
    this.hazards.addAoe(a);
    const ev = { type: 'aoe', id: a.id, src: a.owner, x: a.x, z: a.z, r: a.r, tick: a.t0, tAct: a.tAct, dmg: a.dmg };
    if (a.keep) ev.keep = 1;
    if (a.fire) ev.fire = 1;
    if (a.sx !== undefined) { ev.sx = a.sx; ev.sz = a.sz; }
    if (o.fall) { ev.fall = o.fall; ev.fx = o.fx; ev.fz = o.fz; ev.fy = o.fy; }
    this.emit(ev);
    return a;
  }
  addBeam(o) {
    const b = {
      id: this.nextAoe++, owner: o.owner || 0, kind: o.kind, x0: o.x0, z0: o.z0, ang0: o.ang0, omega: o.omega || 0,
      vx: o.vx || 0, vz: o.vz || 0, off: o.off || 0, len: o.len, w: o.w, t0: o.t0 ?? this.tick, tAct: o.tAct, tEnd: o.tEnd,
      dmg: Math.round(o.dmg * this.dmgMul(o.owner)), every: o.every || 12, knock: o.knock ?? 4, keep: o.keep ? 1 : 0, tele: o.tele || 0, travel: o.travel || 0, fire: o.fire ? 1 : 0,
    };
    this.hazards.addBeam(b);
    const ev = { type: 'beam', src: b.owner, tick: b.t0 };
    for (const k of BEAM_FIELDS) ev[k] = b[k];
    this.emit(ev);
    return b;
  }
  setLava(o) {
    if (!o) { this.hazards.setLava(null); this.emit({ type: 'lava', off: 1 }); return null; }
    const L = this.hazards.setLava({ id: this.nextAoe++, ...o, dmg: Math.round(o.dmg * this.dmgMul(o.owner)) });
    const ev = { type: 'lava' };
    for (const k of LAVA_FIELDS) ev[k] = L[k];
    this.emit(ev);
    return L;
  }

  cancelEmitter(e) {
    this.hazards.cancelPending(e, this.tick);
    this.emit({ type: 'cancel', src: e, tick: this.tick });
  }

  // o.pt: the projectile tick of the command that fired it (the server judges the shot against the
  // enemies as that player saw them: lag = how far behind the present, + the interpolation delay).
  spawnShot(owner, o) {
    const sid = this.nextSid++;
    const Cb = tuning.combat;
    const lag = o.lag ?? (this.isServer && o.pt ? Math.max(0, Math.min(Cb.rewind, this.tick - o.pt)) + Cb.interpTicks : Cb.interpTicks);
    this.shots.spawn(sid, { ...o, owner, lag, pred: this.isServer ? 0 : o.seq });
    if (this.isServer) {
      const S = this.shots, s = S.slot.get(sid);
      const ev = { type: 'shot', sid, pid: o.pid, key: o.key || 0, owner, x: o.x, y: o.y, z: o.z, dx: o.dx, dz: o.dz, speed: o.speed, dmg: o.dmg, life: o.life, r: o.r, ptype: o.type, heavy: o.heavy ? 1 : 0, seq: o.seq, homing: S.homing[s], cone: S.cone[s] };
      if (o.kind) ev.kind = o.kind;
      if (o.crit) ev.crit = 1;
      if (o.tier) ev.tier = o.tier;
      if (o.from) { ev.from = o.from; ev.target = o.target; }
      this.emit(ev);
    }
    return sid;
  }

  // Server: where enemy e was `lag` ticks ago (the history melee rewinds with).
  lagPos(e, lag, out) {
    if (lag > 0) return historyAt(this, e, this.tick - lag, out);
    out.x = this.ecs.x[e]; out.z = this.ecs.z[e];
    return out;
  }

  // Server: nearest enemy (team 2) in a cone ahead of a shot (as seen `lag` ticks ago).
  findEnemy(x, z, dx, dz, coneCos, maxD = 16, lag = 0) {
    const ecs = this.ecs, p = this.tmpLag;
    let best = 0, bd = maxD;
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e] || !(ecs.mask[e] & C.ENEMY) || ecs.dead[e] > 0) continue;
      this.lagPos(e, lag, p);
      const ox = p.x - x, oz = p.z - z, d = Math.hypot(ox, oz);
      if (d > bd || d < 1e-6) continue;
      if ((ox * dx + oz * dz) / d < coneCos) continue;
      bd = d; best = e;
    }
    return best;
  }

  stepShots(dt) {
    const S = this.shots, ecs = this.ecs, map = this.map, tmp = this.tmp, p = this.tmpLag;
    let lag = 0;
    const find = (x, z, dx, dz, c) => this.findEnemy(x, z, dx, dz, c, 16, lag);
    const pos = (id, out) => {
      if (!ecs.alive[id] || !(ecs.mask[id] & C.ENEMY) || ecs.dead[id] > 0) return false;
      this.lagPos(id, lag, out); out.y = ecs.y[id] + 1.1;
      return true;
    };
    for (let s = 0; s < S.cap; s++) {
      if (S.id[s] === 0) continue;
      lag = S.lag[s];
      S.step(s, dt, find, pos, tmp);
      let end = S.life[s] <= 0, hit = 0;
      const x = S.x[s], z = S.z[s];
      if (!end && map.groundAt(x, z) > S.y[s] + 0.1) end = true;
      if (!end) {
        const list = map.queryColliders(x, z, 2);
        for (let k = 0; k < list.length; k++) {
          const c = map.colliders[list[k]];
          if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + S.r[s] * 0.4) ** 2) { end = true; break; }
        }
      }
      if (!end) {
        const own = S.owner[s];
        for (let e = 1; e < ecs.cap; e++) {
          if (e === S.lastHit[s] || !this.canHit(own, e)) continue;
          const rr = ecs.hurtR[e] + S.r[s];
          this.lagPos(e, lag, p);
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < rr * rr) { hit = e; end = true; break; }
        }
      }
      if (!end) continue;
      const sid = S.id[s], owner = S.owner[s], dmg = S.dmg[s], heavy = S.heavy[s], bounce = S.bounce[s], kind = S.kind[s], crit = S.crit[s] > 0;
      const o = { type: S.type[s], y: S.y[s], speed: S.speed[s], r: S.r[s], lag, kind };
      const knock = S.knock[s] || undefined;
      S.free(s);
      this.emit({ type: 'shotEnd', sid, x, z, hit });
      if (hit) {
        // Reflects and released catches ignore armour, shields and DEF; pistol bullets and pellets do not.
        const bullet = kind === SHOT.BULLET || kind === SHOT.PELLET;
        this.strike(hit, dmg, { by: owner, kind: bullet ? 'bullet' : 'shot', x: x - S.vx[s] * 0.1, z: z - S.vz[s] * 0.1, heavy: !!heavy, pierce: !bullet, knock, crit, elem: ecs.elem[owner] });
        if (bounce > 0) this.bounceShot(sid, owner, hit, x, z, dmg, bounce, o);
      }
    }
  }

  // A reflected shot that hit jumps to the nearest other enemy in range (straight at it, soft homing).
  bounceShot(from, owner, hit, x, z, dmg, bounce, o) {
    const ecs = this.ecs, B = tuning.parry.reflect.bounce, p = this.tmpLag;
    let best = 0, bd = B.range, bx = 0, bz = 0;
    for (let e = 1; e < ecs.cap; e++) {
      if (e === hit || !this.canHit(owner, e)) continue;
      this.lagPos(e, o.lag, p);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = e; bx = p.x; bz = p.z; }
    }
    if (!best) return 0;
    const dx = (bx - x) / Math.max(bd, 1e-6), dz = (bz - z) / Math.max(bd, 1e-6);
    return this.spawnShot(owner, {
      pid: 0, type: o.type, x, y: o.y, z, dx, dz, speed: o.speed, dmg: Math.max(1, Math.round(dmg * B.dmgMult)), life: B.life, r: o.r,
      heavy: false, seq: 0, bounce: bounce - 1, lastHit: hit, target: best, from, lag: o.lag, kind: o.kind,
    });
  }

  // ---- Friendly fire (M4.5) ----------------------------------------------------------------------------
  // Where nobody is safe: inside the Cala Calavera.
  lawless(e) { const m = this.map, ecs = this.ecs; return !!m.lawlessAt && m.lawlessAt(ecs.x[e], ecs.z[e]); }
  // Who player e's blows land on: enemies, and every other pirate (not a bot) inside the Cala with e.
  canHit(e, o) {
    const ecs = this.ecs;
    if (!ecs.alive[o] || ecs.dead[o] > 0 || o === e) return false;
    if (ecs.mask[o] & C.ENEMY) return true;
    return (ecs.mask[o] & C.PLAYER) !== 0 && !(ecs.mask[o] & C.BOT) && this.lawless(o) && this.lawless(e);
  }
  // Once-per-attack bookkeeping of a target: an enemy's brain, a pirate's history record.
  hitState(o) {
    const b = this.ecs.brain[o];
    if (b) return b;
    let h = this.phist.get(o);
    if (!h) { h = newHistory(); this.phist.set(o, h); }
    return h;
  }
  // A player's blow on target o: an enemy takes it, a pirate may dodge, guard or take it. opts.elem (M4.8: the
  // attacker's element, ecs.elem; 0 = none) is copied onto the damage / hurt event it emits.
  strike(o, raw, opts) {
    const n = this.events.length;
    const dmg = this.ecs.mask[o] & C.ENEMY ? damageEnemy(this, o, raw, opts) : hurtByPlayer(this, o, raw, opts);
    if (opts.elem) for (let i = n; i < this.events.length; i++) { const ev = this.events[i]; if (ev.type === 'damage' || ev.type === 'hurt') ev.elem = opts.elem; }
    if (dmg > 0 && opts.elem === 1 && !opts.noElement) burnOnHit(this, o, opts.by);
    if (dmg > 0 && opts.elem === 2 && !opts.noElement) chillOnHit(this, o, opts.by);
    return dmg;
  }

  // ---- Server-only combat hooks (called from systems/combat.js) ----------------------------------
  // Melee against enemies where the attacker saw them: interpTicks behind the command's projectile tick.
  meleeHits(e, st, pt, seq) {
    const ecs = this.ecs, tmp = this.tmp, M = tuning.melee;
    const back = pt - tuning.combat.interpTicks;
    const fx = Math.sin(ecs.facing[e]), fz = Math.cos(ecs.facing[e]);
    const half = Math.cos((st.arc / 2) * D2R);
    const key = e * 65536 + ecs.swingId[e];
    for (let o = 1; o < ecs.cap; o++) {
      if (!this.canHit(e, o)) continue;
      const b = this.hitState(o);
      if (b.hitBy.get(e) === key) continue;
      historyAt(this, o, back, tmp);
      const dx = tmp.x - ecs.x[e], dz = tmp.z - ecs.z[e], d = Math.hypot(dx, dz);
      if (d > st.range + ecs.hurtR[o]) continue;
      if (st.arc < 360 && d > 0.6 && (dx * fx + dz * fz) / d < half) continue;
      b.hitBy.set(e, key);
      const stage = ecs.atkStage[e], emp = ecs.empK[e]; // empowered: the first swing after a Parpadeo (× empK, a crit)
      this.strike(o, ecs.atk[e] * st.mult * (emp > 0 ? emp : 1), { by: e, kind: 'melee', seq, x: ecs.x[e], z: ecs.z[e], heavy: stage === 3, knock: M.knock, crit: emp > 0, elem: ecs.elem[e] });
      this.feel(e, seq, tuning.feel.hitstopMelee, 0);
    }
  }

  // The cutlass lunge: enemies (where the attacker saw them) within reach of this step of its path, once
  // per lunge. Heavy: staggers like the third hit of the combo.
  lungeHits(e, x0, z0, x1, z1, pt, seq) {
    const ecs = this.ecs, tmp = this.tmp, L = SKILLS.lunge;
    const back = pt - tuning.combat.interpTicks;
    const key = e * 65536 + ecs.swingId[e];
    for (let o = 1; o < ecs.cap; o++) {
      if (!this.canHit(e, o)) continue;
      const b = this.hitState(o);
      if (b.hitBy.get(e) === key) continue;
      historyAt(this, o, back, tmp);
      if (skillSegDist(tmp.x, tmp.z, x0, z0, x1, z1) > L.width + ecs.hurtR[o]) continue;
      b.hitBy.set(e, key);
      this.strike(o, ecs.atk[e] * L.mult, { by: e, kind: 'skill', skill: 'lunge', seq, x: x0, z: z0, heavy: true, knock: tuning.melee.knock, elem: ecs.elem[e] });
      this.feel(e, seq, tuning.feel.hitstopMelee, 0);
    }
  }

  // The cutlass crescent between fronts f0 → f1 (u from its origin): each enemy it crosses, once.
  crescentHits(e, f0, f1, pt, seq) {
    const ecs = this.ecs, tmp = this.tmp, W = SKILLS.wave;
    const back = pt - tuning.combat.interpTicks;
    const ox = ecs.waveX[e], oz = ecs.waveZ[e], dx = ecs.waveDx[e], dz = ecs.waveDz[e], id = ecs.waveId[e];
    for (let o = 1; o < ecs.cap; o++) {
      if (!this.canHit(e, o)) continue;
      const b = this.hitState(o);
      if (!b.waveBy) b.waveBy = new Map();
      if (b.waveBy.get(e) === id) continue;
      historyAt(this, o, back, tmp);
      const rx = tmp.x - ox, rz = tmp.z - oz, hr = ecs.hurtR[o];
      const a = rx * dx + rz * dz, l = Math.abs(rx * dz - rz * dx);
      if (a < f0 - W.depth - hr || a > f1 + hr || l > W.half + hr) continue;
      b.waveBy.set(e, id);
      this.strike(o, ecs.atk[e] * W.mult, { by: e, kind: 'skill', skill: 'wave', seq, x: tmp.x - dx, z: tmp.z - dz, knock: 6, elem: ecs.elem[e] });
    }
  }

  // One pulse of the lead rain at tick T: every enemy in the zone (as the caller saw it), DEF pierced.
  rainHits(e, T, seq) {
    const ecs = this.ecs, tmp = this.tmp, R = SKILLS.rain;
    const cx = ecs.rainX[e], cz = ecs.rainZ[e], rr = rainR(ecs, e);
    for (let o = 1; o < ecs.cap; o++) {
      if (!this.canHit(e, o)) continue;
      historyAt(this, o, T - tuning.combat.interpTicks, tmp);
      if (Math.hypot(tmp.x - cx, tmp.z - cz) > rr + ecs.hurtR[o]) continue;
      this.strike(o, ecs.atk[e] * R.mult, { by: e, kind: 'skill', skill: 'rain', seq, x: cx, z: cz, pierce: true, knock: 0.6, above: true, elem: ecs.elem[e] });
    }
  }

  // ---- Tattoo hits (M4.7 P3, server only) ---------------------------------------------------------------
  // One blow of a tattoo (ATK × mult) on target t: the strike (elem: the attacker's), then o.stun s of stagger.
  // o: {skill, knock, stun, heavy, kind}.
  skillStrike(e, t, mult, o, x, z, seq) {
    const ecs = this.ecs;
    const dmg = this.strike(t, ecs.atk[e] * mult, { by: e, kind: o.kind || 'skill', skill: o.skill, seq, x, z, knock: o.knock, heavy: o.heavy, elem: ecs.elem[e], fire: o.fire });
    if (o.stun > 0) this.stun(e, t, o.stun, seq, dmg);
    return dmg;
  }

  // Every enemy within r (+ its hurt radius) of (x, z) as the attacker saw it at tick pt, hit for ATK × mult. Returns
  // how many. o: skillStrike's.
  areaHits(e, x, z, r, mult, o, pt, seq) {
    const ecs = this.ecs, tmp = this.tmp, back = pt - tuning.combat.interpTicks;
    let n = 0;
    for (let t = 1; t < ecs.cap; t++) {
      if (!this.canHit(e, t)) continue;
      historyAt(this, t, back, tmp);
      if (Math.hypot(tmp.x - x, tmp.z - z) > r + ecs.hurtR[t]) continue;
      this.skillStrike(e, t, mult, o, x, z, seq);
      n++;
    }
    return n;
  }

  // The same along a segment (x0, z0) → (x1, z1) of width r, each enemy once per `key` (like lungeHits: a fresh key
  // is a fresh chance). A blow's knockback comes from the segment's start.
  pathHits(e, x0, z0, x1, z1, r, mult, key, o, pt, seq) {
    const ecs = this.ecs, tmp = this.tmp, back = pt - tuning.combat.interpTicks;
    let n = 0;
    for (let t = 1; t < ecs.cap; t++) {
      if (!this.canHit(e, t)) continue;
      const b = this.hitState(t);
      if (!b.pathBy) b.pathBy = new Map();
      if (b.pathBy.get(e) === key) continue;
      historyAt(this, t, back, tmp);
      if (skillSegDist(tmp.x, tmp.z, x0, z0, x1, z1) > r + ecs.hurtR[t]) continue;
      b.pathBy.set(e, key);
      this.skillStrike(e, t, mult, o, x0, z0, seq);
      n++;
    }
    return n;
  }

  // Stagger from a tattoo: enemies (not bosses or fixed ones) get `secs`, and one winding up or striking drops it and
  // chases (as the perfect guard's shock does). In the Cala a pirate that was hurt gets half of it and loses its
  // swing, guard and cast.
  stun(e, o, secs, seq, dmg = 1) {
    const ecs = this.ecs;
    if (!ecs.alive[o] || ecs.dead[o] > 0) return;
    if (ecs.mask[o] & C.ENEMY) {
      const b = ecs.brain[o], def = ENEMIES[ENEMY_KINDS_LIST[ecs.enemy[o]]];
      if (!b || def.boss || def.fixed) return;
      ecs.stagger[o] = Math.max(ecs.stagger[o], secs);
      if (b.state === 'windup' || b.state === 'fire') { this.cancelEmitter(o); b.state = 'chase'; b.t = 0; b.gcd = 0.8; }
    } else {
      if (!(dmg > 0)) return;
      ecs.stagger[o] = Math.max(ecs.stagger[o], secs / 2);
      ecs.atkStage[o] = 0; ecs.guardT[o] = -1;
      cancelCast(ecs, o);
    }
    this.emit({ type: 'stun', id: o, by: e, seq, x: ecs.x[o], z: ecs.z[o] });
  }

  // The whirlpool of «Ojo de tormenta»: enemies (not bosses or fixed ones) within r of (cx, cz) slide `step` u toward it.
  pullEnemies(cx, cz, r, step) {
    const ecs = this.ecs;
    for (let o = 1; o < ecs.cap; o++) {
      if (!ecs.alive[o] || !(ecs.mask[o] & C.ENEMY) || ecs.dead[o] > 0) continue;
      const def = ENEMIES[ENEMY_KINDS_LIST[ecs.enemy[o]]];
      if (def.boss || def.fixed) continue;
      const dx = cx - ecs.x[o], dz = cz - ecs.z[o], d = Math.hypot(dx, dz);
      if (d > r + ecs.hurtR[o] || d < 0.05) continue;
      const m = Math.min(step, d);
      moveWithCollision(this, o, (dx / d) * m, (dz / d) * m);
    }
  }

  waveHits(e, seq) {
    const ecs = this.ecs, RP = tuning.parry.riposte;
    for (let o = 1; o < ecs.cap; o++) {
      if (!this.canHit(e, o)) continue;
      if (Math.hypot(ecs.x[o] - ecs.x[e], ecs.z[o] - ecs.z[e]) > stormRadius(ecs, e) + ecs.hurtR[o]) continue;
      this.strike(o, ecs.atk[e] * RP.dmgMult, { by: e, kind: 'wave', seq, x: ecs.x[e], z: ecs.z[e], heavy: true, knock: RP.knock, pierce: true, elem: ecs.elem[e] });
    }
  }

  // A perfect guard: enemies close by that are winding up or striking are stunned (bosses shrug it off).
  // Once per command.
  guardShock(e, seq) {
    const ecs = this.ecs, G = tuning.guard;
    if (this.shockSeq.get(e) === seq) return;
    this.shockSeq.set(e, seq);
    for (let o = 1; o < ecs.cap; o++) {
      if (!ecs.alive[o] || !(ecs.mask[o] & C.ENEMY) || ecs.dead[o] > 0) continue;
      const b = ecs.brain[o], def = ENEMIES[ENEMY_KINDS_LIST[ecs.enemy[o]]];
      if (!b || def.boss || def.fixed || (b.state !== 'windup' && b.state !== 'fire')) continue;
      const dx = ecs.x[o] - ecs.x[e], dz = ecs.z[o] - ecs.z[e], d = Math.hypot(dx, dz);
      if (d > G.shockR + ecs.hurtR[o]) continue;
      ecs.stagger[o] = Math.max(ecs.stagger[o], G.shockStagger);
      this.cancelEmitter(o);
      b.state = 'chase'; b.t = 0; b.gcd = 0.8;
      if (d > 1e-6) { ecs.kbx[o] += (dx / d) * 5; ecs.kbz[o] += (dz / d) * 5; }
      this.emit({ type: 'stun', id: o, by: e, seq, x: ecs.x[o], z: ecs.z[o] });
    }
  }

  checkpoint(e) {
    if ((this.tick + e) % 15 !== 0) return;
    const ecs = this.ecs, id = this.map.checkpointAt(ecs.x[e], ecs.z[e]);
    if (!id) return;
    const cp = this.map.checkpoints[id];
    ecs.cpX[e] = cp.x; ecs.cpZ[e] = cp.z;
  }

  killEnemy(e, by, o = {}) {
    const ecs = this.ecs, def = defOf(ecs, e);
    ecs.dead[e] = 1;
    encounterKilled(this, e);
    this.hazards.cancelPending(e, this.tick);
    // XP to every player nearby (the killer and whoever helped); each of them rolls their own loot (M4).
    const tierXp = ecs.brain[e] && ecs.brain[e].tier ? ecs.brain[e].tier.xp : 1;
    // Finished off by another mob (the Cala, M4.5): the kill of the last pirate who hurt it lately; with none, its
    // loot still drops (public) but nobody earns XP or a quest kill for watching.
    let credit = by;
    if (by > 0 && (ecs.mask[by] & C.ENEMY)) {
      const b = ecs.brain[e];
      credit = b && b.pirate && ecs.alive[b.pirate] && this.tick - b.pirateTick <= LAWLESS.assist / DT ? b.pirate : 0;
    }
    const earn = credit === by || credit > 0;
    const xp = o.noXp ? 0 : Math.round(def.xp * tierXp), got = [];
    for (let p = 1; p < ecs.cap && xp; p++) {
      if (!ecs.alive[p] || !(ecs.mask[p] & C.PLAYER) || (ecs.mask[p] & C.BOT)) continue;
      if (p !== credit && Math.hypot(ecs.x[p] - ecs.x[e], ecs.z[p] - ecs.z[e]) > (def.boss ? 40 : 25)) continue;
      if (earn) gainXp(this, p, xp);
      got.push(p);
    }
    if (this.profiles && got.length) { lootOnKill(this, e, credit || by, got); if (earn) questKill(this, e, got); }
    this.emit({ type: 'kill', id: e, by, x: ecs.x[e], z: ecs.z[e], xp: earn ? xp : 0, tick: this.tick, boss: def.boss ? 1 : 0 });
    // A boss dies in slow motion for everyone in the instance (DESIGN §8).
    if (def.boss) this.emit({ type: 'time', e: 0, seq: 0, hitstop: 0.15, scale: 0.3, dur: 1.2 });
    const sp = this.spawners.find((q) => q.entity === e);
    if (sp) { sp.entity = 0; sp.timer = def.respawn || 30; }
    this.despawn(e);
  }

  // World systems that are not driven by player commands.
  stepWorld() {
    const ecs = this.ecs;
    stepChills(this);
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e]) continue;
      const m = ecs.mask[e];
      if (m & C.BOT) stepMover(this, e, botCommand(this, e, DT), DT);
      else if (m & C.ENEMY) stepEnemy(this, e, DT);
    }
    if (this.isServer) {
      stepBurns(this);
      this.stepShots(DT);
      stepInfighting(this);
      if (this.drops) stepDrops(this);
      if (this.economy) this.economy.step(DT); // M7: markets and workshops on the game clock
      if (this.profiles) zoneSweep(this);
      for (const enc of this.encounters) stepEncounter(this, enc, DT);
      for (let e = 1; e < ecs.cap; e++) {
        if (!ecs.alive[e]) continue;
        if (ecs.mask[e] & C.ENEMY) recordHistory(this, e);
        else if ((ecs.mask[e] & C.PLAYER) && !(ecs.mask[e] & C.BOT)) recordHistory(this, e, this.hitState(e));
      }
      for (const sp of this.spawners) {
        if (sp.entity) continue;
        sp.timer -= DT;
        if (sp.timer > 0) continue;
        let near = false;
        // The Cala Calavera refills even with pirates around (its mobs rise out of the ground).
        const cala = sp.extra && sp.extra.cala;
        for (let p = 1; p < ecs.cap && !cala; p++) {
          if (ecs.alive[p] && (ecs.mask[p] & C.PLAYER) && !(ecs.mask[p] & C.BOT) && Math.hypot(ecs.x[p] - sp.x, ecs.z[p] - sp.z) < 18) near = true;
        }
        if (near) { sp.timer = 2; continue; }
        sp.entity = this.spawnEnemy(sp.kind, sp.x, sp.z, sp.facing, cala ? { ...sp.extra, riseT: LAWLESS.rise } : sp.extra);
      }
      if (this.tick % 30 === 0) this.hazards.sweep(this.tick);
    }
    this.flushAllFeel();
    this.tick++;
  }

  // ---- Debug (F4 panel; the local server only) --------------------------------------------------------
  debugSpawn(kind, x, z, facing = 0) {
    if (!ENEMIES[kind]) return 0;
    const e = this.spawnEnemy(kind, x, z, facing);
    const b = this.ecs.brain[e];
    b.homeX = x; b.homeZ = z;
    if (b.state === 'dormant') b.state = 'idle';
    return e;
  }
  debugClear() {
    const ecs = this.ecs;
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e] || !(ecs.mask[e] & C.ENEMY)) continue;
      if (this.spawners.some((s) => s.entity === e)) continue;
      this.despawn(e);
    }
    this.hazards.clear(this.tick);
    this.emit({ type: 'clear', tick: this.tick });
  }

  // ---- Serialization (protocol field order lives in net/protocol.js) ---------------------------
  describe(e) {
    const ecs = this.ecs;
    const d = { id: e, kind: ecs.kind[e], name: ecs.names[e], title: ecs.titles[e], skin: ecs.skin[e], level: ecs.level[e] };
    if (ecs.mask[e] & C.ENEMY) { d.enemy = ecs.enemy[e]; d.maxHp = ecs.maxHp[e]; }
    if (ecs.mask[e] & C.HEALTH) d.team = ecs.team[e];
    if (ecs.mask[e] & C.PLAYER) { d.weapon = ecs.weapon[e]; d.elem = ecs.elem[e]; if (ecs.clientId[e] >= 0 && !(ecs.mask[e] & C.BOT)) d.human = 1; }
    return d;
  }

  playerState(e, out = new Array(PLAYER_FIELDS.length)) {
    const ecs = this.ecs;
    for (let i = 0; i < PLAYER_FIELDS.length; i++) out[i] = ecs[PLAYER_FIELDS[i]][e];
    return out;
  }

  setPlayerState(e, arr) {
    const ecs = this.ecs;
    for (let i = 0; i < PLAYER_FIELDS.length; i++) ecs[PLAYER_FIELDS[i]][e] = arr[i];
    ecs.state[e] = ecs.dashT[e] >= 0 ? 1 : 0;
  }

  // Back-compat names (tools and tests from M1).
  moverState(e, out) { return this.playerState(e, out); }
  setMoverState(e, arr) { this.setPlayerState(e, arr); }
}

export { PTYPE };
export const BEAM_FIELDS = ['id', 'kind', 'x0', 'z0', 'ang0', 'omega', 'vx', 'vz', 'off', 'len', 'w', 'tAct', 'tEnd', 'dmg', 'every', 'knock', 'keep', 'tele', 'travel', 'fire'];
export const LAVA_FIELDS = ['id', 'cx', 'cz', 'r0', 'rMin', 'rate', 't0', 'R', 'dmg', 'every'];
