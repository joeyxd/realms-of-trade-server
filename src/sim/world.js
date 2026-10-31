// Authoritative world state. Pure (no THREE, no DOM, no wall clock).
// The same class runs the server (isServer: enemies, shots, hits on enemies) and the client's
// prediction of its own player (movement + combat against the projectiles the client knows about).
import { tuning, DT } from '../data/tuning.js';
import { di, hitlagFrames, meleePercent } from './meleeHit.js';
import { swingDescriptor, swingKey, swingOn } from '../data/meleeFrames.js';
import { ENEMIES, ENEMY_KINDS as ENEMY_KINDS_LIST, enemyIndex } from '../data/enemies.js';
import { mulberry32 } from '../core/rng.js';
import { ECS, C, KIND, TEAM, ACT, PLAYER_FIELDS, airborne, intangible } from './ecs.js';
import { generateWorld } from './worldgen.js';
import { stepMover, moveWithCollision, BTN } from './systems/movement.js';
import { makeBotBrain, botCommand } from './systems/bots.js';
import { stepPlayerCombat, applyLevel, gainXp, stormRadius, hurtByPlayer, hurtPlayer, beginGrab, endGrab, syncGrabs, grabCollisions, releaseThrows } from './systems/combat.js';
import { jumpOn } from './systems/jump.js';
import { makeEnemyBrain, stepEnemy, recordHistory, historyAt, damageEnemy, defOf, newHistory } from './systems/enemies.js';
import { Hazards, Shots, emitPattern, patternCount, PTYPE, KILL, NEVER, SHOT } from './projectiles.js';
import { firstRelativeSphereContact, firstSegmentCircleContact2D, firstSegmentCylinderContact, pointOnSegment } from './projectileClash.js';
import { WEAPON_KINDS, WEAPON, SKILLS } from '../data/weapons.js';
import { skillSegDist, rainR, cancelCast } from './systems/skills.js';
import { applyLoadout } from './systems/stats.js';
import { createEncounter, stepEncounter, encounterKilled } from './systems/encounter.js';
import { lootOnKill, stepDrops } from './systems/inventory.js';
import { questKill, zoneSweep } from './systems/quests.js';
import { stepInfighting } from './systems/lawless.js';
import { LAWLESS, MELEE_GUARD } from '../data/lawless.js';
import { burnOnHit, chillOnHit, lightningOnHit, enemyChillMul, stepBurns, stepChills } from './systems/pearlcombat.js';
import { PEARL } from '../data/pearls.js';
import { CLOCK, hourOfDay, nightAt } from '../data/clock.js';
import { addInkCloud, removePredictedInkClouds, markOnHit, stepInk } from './systems/ink.js';
import { RaftDeck } from './raftGeometry.js';
import { NavalTrial } from './naval/trial.js';
import { NavalPilot } from './naval/pilot.js';
import { recoverSwimming, swimLoadOf } from './systems/swimming.js';
import { packLoadTier } from './economy/carry.js';
import { mealEffects } from '../data/meals.js';
import { stepNeeds } from './systems/survival.js';

const D2R = Math.PI / 180;

export class World {
  constructor(seed, { map, server = false, navalTrial = false, navalPilot = false } = {}) {
    this.seed = seed >>> 0;
    this.tick = 0;
    this.rng = mulberry32((seed ^ 0xabcdef) >>> 0);
    this.map = map || generateWorld(this.seed);
    this.raftDeck = new RaftDeck(this.map);
    this.ecs = new ECS(2048);
    this.grabHits = [];
    this.grabAttempts = new Map();
    this.events = [];
    this.isServer = server;
    if ([navalTrial, navalPilot].some((v) => typeof v !== 'boolean') || ((navalTrial || navalPilot) && !server))
      throw new TypeError('Naval trials are server-only opt-in');
    this.navalTrial = navalTrial || navalPilot ? new NavalTrial(this, { coast: navalPilot }) : null;
    this.navalPilot = navalPilot ? new NavalPilot(this) : null;
    this.hazards = new Hazards();
    this.hazards.predicting = !server;
    this.chills = new Map();
    this.inkClouds = [];
    this.inkMarks = [];
    this.clock = null;
    this.fieldOwner = 0; // online prediction may set this to the server entity id for stable field identities
    this.shots = new Shots();
    this.nextPid = 1;
    this.nextSid = 1;
    this.nextAoe = 1;
    this.nextLightning = 1;
    this.spawners = [];
    this.encounters = []; // server: scripted fights (populate)
    this.feelQ = new Map(); // e → {seq, hitstop, slowmo} merged per command
    this.shockSeq = new Map(); // e → seq of its last perfect-guard shock
    this.phist = new Map(); // server: pirate → position history and hit bookkeeping (friendly fire, M4.5)
    this.tmp = { x: 0, z: 0, y: 0 };
    this.tmpLag = { x: 0, z: 0, y: 0 };
    // PT06 jump (systems/jump.js): 'off' (today's game) | 'lab' | 'game'. The server sets it; prediction copies it from WELCOME.
    this.jumpMode = 'off';
    this.falls = []; // landings that hurt, (entity, fraction of maxHp, seq) triplets, applied by applyFalls (server only)
    this.yhist = new Map(); // server, jump on: player → its y of the last 32 ticks (lag compensation of height)
  }

  emit(ev) {
    if (ev.elem === undefined && ev.e && (this.ecs.elem[ev.e] || (this.ecs.mask[ev.e] & C.PLAYER))) ev.elem = this.ecs.elem[ev.e];
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
    if (this.meleeVersion === 1 && this.ecs.grabSt[e]) endGrab(this, e, true);
    this.residentPlayers?.delete(e);
    this.burns?.delete(e);
    this.chills.delete(e);
    this.ecs.destroy(e);
    this.phist.delete(e);
    this.yhist.delete(e);
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
    const ecs = this.ecs;
    if (this.meleeVersion === 1 && (ecs.grabSt[e] === ACT.CAPTURE || ecs.grabSt[e] === ACT.THROWN)) {
      ecs.grabX[e] = cmd.mx || 0; ecs.grabZ[e] = cmd.mz || 0;
    }
    syncGrabs(this);
    if (ecs.hitlag[e] > 0) {
      if ((cmd.prs & BTN.ATTACK) && ecs.atkStage[e] > 0) ecs.atkLatch[e] = 1; // Melee keeps the presses made in hitlag
      if (--ecs.hitlag[e] === 0) {
        const v = di(ecs.lvx[e], ecs.lvz[e], cmd.mx || 0, cmd.mz || 0);
        ecs.lvx[e] = v.vx; ecs.lvz[e] = v.vz;
      }
      ecs.lastSeq[e] = cmd.seq >>> 0;
      return;
    }
    if (this.isServer) {
      const profile = this.profiles?.get(e);
      this.ecs.swimLoad[e] = swimLoadOf(profile);
    }
    // Needs advance with accepted commands while steering as well as on foot.
    const hadComfortMeal = this.ecs.mealKind[e] === 3 && this.ecs.mealTicks[e] > 0;
    stepNeeds(this, e, cmd, DT);
    const profile = this.profiles?.get(e);
    // Cargo is snapshot-authoritative. Prediction only reclassifies it when its timed comfort expires.
    if (profile && (this.isServer || hadComfortMeal && this.ecs.mealTicks[e] === 0))
      this.ecs.load[e] = packLoadTier(profile, mealEffects(this.ecs.mealKind[e], this.ecs.mealTicks[e]).comfort);
    // The bounded helm parks land locomotion/combat. They cannot become a second pose authority.
    if (this.navalPilot?.aboard(e) && !this.navalPilot.walking?.(e)) {
      if (!this.ecs.dead[e]) recoverSwimming(this.ecs, e, DT);
      this.ecs.lastSeq[e] = cmd.seq >>> 0; return;
    }
    beginGrab(this, e, cmd);
    const grab = this.meleeVersion === 1 && ecs.grabSt[e];
    if (!grab) stepMover(this, e, cmd, DT);
    else if (grab === ACT.GRAB_CUT || grab === ACT.CAPTURE_CUT) {
      const f = ecs.facing[e];
      stepMover(this, e, { ...cmd, mx: 0, mz: 0, btn: 0, prs: 0 }, DT); ecs.facing[e] = f;
    }
    if (this.falls.length) this.applyFalls();
    if (this.ecs.mask[e] & C.HEALTH) stepPlayerCombat(this, e, cmd, DT);
    this.flushFeel(e);
    this.ecs.lastSeq[e] = cmd.seq >>> 0;
    this.navalPilot?.capture?.(e, this.ecs.lastSeq[e]);
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

  // ---- Shared game clock and pearl fields ------------------------------------------------------------
  // The authority uses the economic clock, including its uncommitted low-rate accumulator.
  // Prediction extrapolates the last snapshot anchor at the command's projectile tick.
  gameHoursAt(tick = this.tick) {
    if (this.isServer && this.economy) return this.economy.hours + (this.economy.acc + (tick - this.tick) * DT) * 24 / CLOCK.daySec;
    if (this.clock) return this.clock.hours + (tick - this.clock.tick) * DT * 24 / this.clock.daySec;
    return CLOCK.startHour + tick * DT * 24 / CLOCK.daySec;
  }
  hourAt(tick = this.tick) { return hourOfDay(this.gameHoursAt(tick)); }
  isNightAt(tick = this.tick) { return nightAt(this.gameHoursAt(tick)); }
  addInkCloud(field) { return addInkCloud(this, field); }
  removePredictedInkClouds(e) { removePredictedInkClouds(this, e); }
  // ---- Projectiles ------------------------------------------------------------------------------------
  // How hard enemy e hits (its Marea, M4): every hostile pattern, circle, beam and the lava go through here.
  dmgMul(e) { const b = e ? this.ecs.brain[e] : null; return b && b.tier ? b.tier.dmg : 1; }
  enemyMoveMul(e) {
    const ecs = this.ecs;
    return Math.min(this.hazards.fieldSlowAt(ecs.x[e], ecs.z[e], this.tick), enemyChillMul(this, e));
  }

  firePattern(ev) {
    if (ev.src && this.dmgMul(ev.src) !== 1) ev.dmg = Math.round(ev.dmg * this.dmgMul(ev.src));
    // Anchors are chosen by the authority at emission, never from a client's interpolated pirates.
    const magnets = [];
    for (let e = 1; e < this.ecs.cap; e++) {
      if (!this.ecs.alive[e] || !(this.ecs.mask[e] & C.PLAYER) || this.ecs.dead[e] > 0 || this.ecs.elem[e] !== 3) continue;
      magnets.push({ e, x: this.ecs.x[e], z: this.ecs.z[e] });
    }
    if (magnets.length) ev.magnets = magnets;
    else delete ev.magnets;
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
    const elem = o.elem ?? this.ecs.elem[owner] ?? 0;
    this.shots.spawn(sid, { ...o, born: this.tick, elem, owner, lag, pred: this.isServer ? 0 : o.seq });
    if (this.isServer) {
      const S = this.shots, s = S.slot.get(sid);
      const ev = { type: 'shot', sid, pid: o.pid, key: o.key || 0, owner, elem, x: o.x, y: o.y, z: o.z, dx: o.dx, dy: o.dy || 0, dz: o.dz, speed: o.speed, dmg: o.dmg, life: o.life, r: o.r, ptype: o.type, heavy: o.heavy ? 1 : 0, seq: o.seq, homing: S.homing[s], cone: S.cone[s] };
      if (o.kind) ev.kind = o.kind;
      if (o.crit) ev.crit = 1;
      if (o.tier) ev.tier = o.tier;
      if (o.from) { ev.from = o.from; ev.target = o.target; }
      this.emit(ev);
    }
    return sid;
  }

  // Server: where enemy e was `lag` ticks ago (the history melee rewinds with). With the jump on, out.y is the feet
  // height then (a jumper is hit where its shooter saw it), else the current one.
  lagPos(e, lag, out) {
    if (lag > 0) historyAt(this, e, this.tick - lag, out);
    else { out.x = this.ecs.x[e]; out.z = this.ecs.z[e]; }
    if (jumpOn(this)) {
      const h = lag > 0 && lag < 31 ? this.yhist.get(e) : null;
      out.y = h ? h[((this.tick - lag) % 32 + 32) % 32] : this.ecs.y[e];
    }
    return out;
  }

  // A landing that hurts (jump.js queued it): true damage through hurtPlayer, no knockback, god mode respected.
  applyFalls() {
    const q = this.falls, ecs = this.ecs;
    this.falls = [];
    for (let i = 0; i < q.length; i += 3) {
      const e = q[i];
      if (!ecs.alive[e] || ecs.dead[e] > 0) continue;
      hurtPlayer(this, e, ecs.maxHp[e] * q[i + 1], { x: ecs.x[e], z: ecs.z[e], kind: 'fall', knock: 0, noInv: true, pierce: true, seq: q[i + 2] });
    }
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
    const deferred = [];
    const tick0 = this.tick, tick1 = tick0 + dt / DT;
    for (let s = 0; s < S.cap; s++) {
      if (S.id[s] === 0) continue;
      lag = S.lag[s];
      const from = { x: S.x[s], y: S.y[s], z: S.z[s] }, lifeBefore = S.life[s];
      const sid = S.id[s], owner = S.owner[s], elem = S.elem[s], dmg = S.dmg[s], heavy = S.heavy[s];
      const bounce = S.bounce[s], kind = S.kind[s], crit = S.crit[s] > 0, shotType = S.type[s], shotRadius = S.r[s];
      const shotKey = S.key[s], shotSpeed = S.speed[s], shotVx = S.vx[s], shotVz = S.vz[s];
      const shotSeq = shotKey < 0 ? Math.floor(-shotKey / 8) : S.pred[s];
      S.step(s, dt, find, pos, tmp);
      const to = { x: S.x[s], y: S.y[s], z: S.z[s] };

      // Determine the first ordinary end along this tick's swept path. Intercepts only win if they happen
      // before range expiry, terrain, a static collider, or the enemy impact that normally consumes a shot.
      const lifeT = dt > 0 ? Math.max(0, Math.min(1, lifeBefore / dt)) : 1;
      const limited = pointOnSegment(from, to, lifeT);
      let stopT = lifeT, hit = 0;
      const distance = Math.hypot(limited.x - from.x, limited.y - from.y, limited.z - from.z);
      const steps = Math.max(1, Math.ceil(distance / 0.08));
      let clearT = 0;
      for (let k = 1; k <= steps; k++) {
        const t = lifeT * k / steps, q = pointOnSegment(from, to, t);
        if (map.groundAt(q.x, q.z) <= q.y + 0.1) { clearT = t; continue; }
        let lo = clearT, hi = t;
        for (let n = 0; n < 10; n++) {
          const mid = (lo + hi) * 0.5, v = pointOnSegment(from, to, mid);
          if (map.groundAt(v.x, v.z) > v.y + 0.1) hi = mid; else lo = mid;
        }
        stopT = hi; break;
      }
      const midX = (from.x + limited.x) * 0.5, midZ = (from.z + limited.z) * 0.5;
      const broad = Math.hypot(limited.x - from.x, limited.z - from.z) * 0.5 + 2;
      const colliders = map.queryColliders(midX, midZ, broad);
      for (let k = 0; k < colliders.length; k++) {
        const c = map.colliders[colliders[k]], t = firstSegmentCircleContact2D(from, limited, c.x, c.z, c.r + shotRadius * 0.4);
        if (t !== null && t * lifeT < stopT) stopT = t * lifeT;
      }
      for (let e = 1; e < ecs.cap; e++) {
        if (e === S.lastHit[s] || !this.canHit(owner, e)) continue;
        this.lagPos(e, lag, p);
        const height = ecs.mask[e] & C.ENEMY ? (defOf(ecs, e)?.height || 1.8) : 1.8;
        const fy = jumpOn(this) ? p.y : ecs.y[e]; // PT06: the feet where the shooter saw them
        const t = firstSegmentCylinderContact(from, limited, p.x, p.z, ecs.hurtR[e] + shotRadius,
          fy - shotRadius, fy + height + shotRadius);
        if (t !== null && t * lifeT < stopT) { stopT = t * lifeT; hit = e; }
      }

      let clash = null;
      if (kind === SHOT.BULLET && stopT > 0) {
        const H = this.hazards;
        for (let hs = 0; hs < H.cap; hs++) {
          if (!H.id[hs] || H.dead[hs] !== NEVER) continue;
          if (H.type[hs] !== PTYPE.PARRY && H.type[hs] !== PTYPE.HEAVY) continue;
          const hazardOwner = H.owner[hs];
          if (hazardOwner > 0 && (ecs.mask[hazardOwner] & C.PLAYER)) continue; // no friendly-fire clashes
          const active0 = Math.max(tick0, H.t0[hs] + tuning.projectiles.armTime / DT);
          let active1 = Math.min(tick1, H.tEnd[hs]);
          if (active1 <= active0) continue;
          const h0 = H._path(hs, active0), clipD = H.clipD[hs];
          if (h0.dist >= clipD - 1e-9) continue;
          let h1 = H._path(hs, active1);
          if (h1.dist >= clipD - 1e-9) {
            let lo = active0, hi = active1;
            for (let n = 0; n < 12; n++) {
              const m = (lo + hi) * 0.5;
              if (H._path(hs, m).dist < clipD - 1e-9) lo = m; else hi = m;
            }
            active1 = lo;
            if (active1 <= active0) continue;
            h1 = H._path(hs, active1);
          }
          const a0 = (active0 - tick0) / (tick1 - tick0), a1 = (active1 - tick0) / (tick1 - tick0);
          if (a0 >= stopT) continue;
          const b0 = pointOnSegment(from, to, a0), b1 = pointOnSegment(from, to, Math.min(a1, stopT));
          const hs1 = a1 > stopT ? stopT : a1;
          const hp1 = hs1 === a1 ? h1 : H._path(hs, tick0 + hs1 * (tick1 - tick0));
          const t = firstRelativeSphereContact(b0, b1, h0, hp1, shotRadius + H.r[hs]);
          if (t === null) continue;
          const worldT = a0 + (hs1 - a0) * t;
          if (worldT >= stopT - 1e-9) continue;
          if (!clash || worldT < clash.t - 1e-9 || (Math.abs(worldT - clash.t) <= 1e-9 && H.id[hs] < H.id[clash.slot]))
            clash = { slot: hs, t: worldT, point: pointOnSegment(b0, b1, t), hazardPoint: pointOnSegment(h0, hp1, t) };
        }
      }

      if (clash) {
        const H = this.hazards, hs = clash.slot, pid = H.id[hs], when = tick0 + clash.t * (tick1 - tick0);
        const contact = { x: (clash.point.x + clash.hazardPoint.x) * 0.5, y: (clash.point.y + clash.hazardPoint.y) * 0.5,
          z: (clash.point.z + clash.hazardPoint.z) * 0.5 };
        const reflects = H.type[hs] === PTYPE.PARRY || !!heavy;
        if (!reflects) {
          // A light shot is spent on a heavy projectile, which continues on its authoritative path.
          S.free(s);
          this.emit({ type: 'shotEnd', sid, owner, elem, x: clash.point.x, y: clash.point.y, z: clash.point.z, hit: 0 });
          continue;
        }
        const v = H.velocityAt(hs, when), vSpeed = Math.hypot(v.x, H.speed[hs] > 1e-9 ? H.vy[hs] * v.speed / H.speed[hs] : 0, v.z);
        if (vSpeed > 1e-9) {
          const vy = H.speed[hs] > 1e-9 ? H.vy[hs] * v.speed / H.speed[hs] : 0;
          const reflectSpeed = Math.max(4, Math.min(tuning.parry.reflect.maxSpeed, vSpeed));
          const raw = Math.max(H.dmg[hs], tuning.parry.reflect.atkMult * ecs.atk[owner]);
          const reflectedDmg = Math.max(1, Math.round(raw * tuning.sword.good.dmg));
          const reflectedHeavy = H.type[hs] === PTYPE.HEAVY;
          const addRiposte = Math.min(tuning.sword.good.riposte, tuning.sword.good.riposte * ecs.ripMul[owner]);
          ecs.riposte[owner] = Math.min(tuning.parry.riposte.max, ecs.riposte[owner] + addRiposte);
          S.free(s);
          H.remove(hs, tick0 + 1, KILL.REFLECT, owner, shotSeq);
          this.emit({ type: 'shotEnd', sid, owner, elem, x: contact.x, y: contact.y, z: contact.z, hit: 0 });
          this.emit({ type: 'parry', pid, e: owner, seq: shotSeq, x: contact.x, y: contact.y, z: contact.z, tier: 2, heavy: reflectedHeavy ? 1 : 0, intercept: 1 });
          deferred.push({ type: 'reflect', owner, pid, seq: shotSeq, shotType: H.type[hs], point: contact,
            dx: -v.x / vSpeed, dy: -vy / vSpeed, dz: -v.z / vSpeed, speed: reflectSpeed, dmg: reflectedDmg, r: Math.max(0.2, H.r[hs] * 0.9), heavy: reflectedHeavy });
          continue;
        }
      }

      const ended = stopT < 1 - 1e-9 || lifeBefore <= dt;
      if (!ended) continue;
      const at = pointOnSegment(from, to, stopT), x = at.x, z = at.z;
      const o = { type: S.type[s], y: at.y, speed: S.speed[s], r: S.r[s], lag, kind, elem };
      const knock = S.knock[s] || undefined, age = (this.tick - S.born[s]) * DT;
      S.free(s);
      this.emit({ type: 'shotEnd', sid, owner, elem, x, y: at.y, z, hit });
      if (hit) {
        // Reflects and released catches ignore armour, shields and DEF; pistol bullets and pellets do not.
        const bullet = kind === SHOT.BULLET || kind === SHOT.PELLET;
        const so = { by: owner, shot: true, kind: bullet ? 'bullet' : 'shot', skill: kind === SHOT.PELLET ? 'pellet' : kind === SHOT.BULLET ? (heavy ? 'gun_r' : 'gun_l') : 'shot', age, dx: shotVx, dz: shotVz, x: x - shotVx * 0.1, z: z - shotVz * 0.1, heavy: !!heavy, pierce: !bullet, knock, crit, elem, pt: this.tick };
        this.strike(hit, dmg, so);
        // P2: a powershielded pirate shot goes back at its shooter, the defender's now, at reflectMul of its damage.
        if (so.reflected) deferred.push({ type: 'reflect', owner: hit, pid: 0, seq: 0, shotType, point: { x, y: at.y, z }, dx: -shotVx, dy: 0, dz: -shotVz,
          speed: shotSpeed, dmg: Math.max(1, Math.round(dmg * MELEE_GUARD.reflectMul)), r: shotRadius, heavy: !!heavy });
        else if (bounce > 0) deferred.push({ type: 'bounce', args: [sid, owner, hit, x, z, dmg, bounce, o] });
      }
    }
    // Defer newly returned and bounced shots until all pre-existing shots have been stepped once.
    for (const item of deferred) {
      if (item.type === 'bounce') this.bounceShot(...item.args);
      else this.spawnShot(item.owner, { key: item.pid, pid: item.pid, type: item.shotType, x: item.point.x, y: item.point.y, z: item.point.z,
        dx: item.dx, dy: item.dy, dz: item.dz, speed: item.speed, dmg: item.dmg, life: tuning.parry.reflect.life, r: item.r, heavy: item.heavy,
        seq: item.seq, bounce: 0, homing: 0, cone: 0, kind: SHOT.REFLECT, pt: tick1 });
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
      heavy: false, seq: 0, bounce: bounce - 1, lastHit: hit, target: best, from, lag: o.lag, kind: o.kind, elem: o.elem,
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
    if (intangible(ecs, o)) return false; // P2b: a pirate in the shield-break flight, fall and stand-up
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
    const by = opts.by || 0;
    if ((this.ecs.mask[by] & C.PLAYER) && this.ecs.elem[by] === 4 && this.isNightAt(opts.pt ?? this.tick)) raw *= PEARL.inkNightMult;
    const sourcePos = opts.elem === 3 && !opts.noElement && (this.ecs.mask[o] & C.ENEMY)
      ? historyAt(this, o, (opts.pt ?? this.tick) - tuning.combat.interpTicks, {}) : null;
    const n = this.events.length;
    const dmg = this.ecs.mask[o] & C.ENEMY ? damageEnemy(this, o, raw, opts) : hurtByPlayer(this, o, raw, opts);
    if (opts.elem) for (let i = n; i < this.events.length; i++) { const ev = this.events[i]; if (ev.type === 'damage' || ev.type === 'hurt') ev.elem = opts.elem; }
    if (dmg > 0 && opts.elem === 1 && !opts.noElement) burnOnHit(this, o, opts.by);
    if (dmg > 0 && opts.elem === 2 && !opts.noElement) chillOnHit(this, o, opts.by);
    if (dmg > 0 && opts.elem === 3 && !opts.noElement) lightningOnHit(this, o, raw, opts, sourcePos);
    if (dmg > 0 && opts.elem === 4 && !opts.noElement) markOnHit(this, o, { ...opts, dmg });
    return dmg;
  }

  // ---- Server-only combat hooks (called from systems/combat.js) ----------------------------------
  grabHp(e) { return this.isSandbag(e) ? ENEMIES[ENEMY_KINDS_LIST[this.ecs.enemy[e]]].meleeHp : this.ecs.maxHp[e]; }
  isSandbag(e) { return !!(this.ecs.mask[e] & C.ENEMY) && ENEMIES[ENEMY_KINDS_LIST[this.ecs.enemy[e]]]?.practice === true; }

  // Hold blade collision until every command in a grabbing tick has advanced: grab collision precedes attack collision.
  queueMeleeHits(e, st, pt, seq) {
    if (this.meleeVersion === 1 && this.ecs.grabSt.some((s) => s === ACT.GRAB))
      this.grabHits.push({ e, st, pt, seq, swing: this.ecs.swingId[e], stage: this.ecs.atkStage[e] });
    else this.meleeHits(e, st, pt, seq);
  }

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
      if (this.meleeVersion === 1 && (ecs.mask[o] & C.PLAYER) && this.clank(e, o, st) && !ecs.atkStage[e]) return;
      b.hitBy.set(e, key);
      const fist = st.fist ? { kit: WEAPON.PUNOS, far: st.near > 0 && d - ecs.hurtR[o] > st.near ? 1 : 0 } : null; // fists: near or far box's row
      const stage = ecs.atkStage[e], emp = ecs.empK[e]; // empowered: the first swing after a Parpadeo (× empK, a crit)
      this.strike(o, ecs.atk[e] * st.mult * (emp > 0 ? emp : 1), { by: e, kind: 'melee', stage, ...(st.smash ? { smash: 1, charge: st.charge } : {}), ...fist, seq, x: ecs.x[e], z: ecs.z[e], heavy: stage === 3, knock: M.knock, crit: emp > 0, elem: ecs.elem[e], pt });
      if (this.meleeVersion !== 1) this.feel(e, seq, tuning.feel.hitstopMelee, 0);
    }
  }

  // P2 (MN_MELEE): pirate o is mid-swing with its hitbox out and e is inside its reach and arc, while e's own blow reaches
  // o: the two sabre blows meet. A side is cancelled when its Melee damage minus `clank` is under the other's: its swing
  // ends, it freezes (hitlag) and rebounds (cannot act), and its blow is spent against the other. The survivor carries on.
  // True when e's blow was cancelled.
  clank(e, o, st) {
    const ecs = this.ecs, mg = MELEE_GUARD;
    if (!ecs.atkStage[o] || airborne(ecs, e) || airborne(ecs, o)) return false;
    const so = swingDescriptor(1, ecs, o);
    if (!swingOn(so, ecs.atkT[o])) return false;
    if (this.hitState(e).hitBy.get(o) === o * 65536 + ecs.swingId[o]) return false; // o's blow already landed on e
    if (!this.inBlow(o, so, ecs.x[e], ecs.z[e], ecs.hurtR[e])) return false;
    const dmg = (a, v, s) => Math.floor(meleePercent(ecs.atk[a] * s.mult * LAWLESS.pvpDmg, ecs.maxHp[v], LAWLESS.meleeStamina));
    const dE = dmg(e, o, st), dO = dmg(o, e, so);
    const cutE = dE - mg.clank < dO, cutO = dO - mg.clank < dE;
    const mx = (ecs.x[e] + ecs.x[o]) / 2, mz = (ecs.z[e] + ecs.z[o]) / 2;
    // x's blow (stage s, damage d) is cancelled against y.
    const cancel = (x, y, s, d) => {
      const stage = ecs.atkStage[x];
      this.emit({ type: 'duel', e: y, by: x, skill: swingKey(stage, ecs.atkSmash[x], ecs.weapon[x]), heavy: stage === 3 ? 1 : 0, tele: Math.round(s.windup * 1000) / 1000, win: Math.round(ecs.atkT[x] * 1000) / 1000, x: mx, z: mz, out: 'clank', dmg: 0, hp: ecs.hp[y] });
      ecs.atkStage[x] = 0; ecs.atkBuf[x] = ecs.atkLatch[x] = 0;
      this.hitState(y).hitBy.set(x, x * 65536 + ecs.swingId[x]);
      return this.rebound(x, d, ecs.x[y], ecs.z[y]);
    };
    const ra = cutE ? cancel(e, o, st, dE) : 0, rb = cutO ? cancel(o, e, so, dO) : 0;
    this.emit({ type: 'clank', a: e, b: o, x: mx, z: mz, ra, rb });
    return cutE;
  }

  // P2b: is the point (x, z) of radius r inside pirate o's blow `so`: its reach, and its arc from o's facing?
  inBlow(o, so, x, z, r) {
    const ecs = this.ecs, dx = x - ecs.x[o], dz = z - ecs.z[o], dist = Math.hypot(dx, dz);
    if (dist > so.range + r) return false;
    return !(so.arc < 360 && dist > 0.6 && (dx * Math.sin(ecs.facing[o]) + dz * Math.cos(ecs.facing[o])) / dist < Math.cos((so.arc / 2) * D2R));
  }

  // P2b: x's blow of Melee damage d was cancelled against whoever stands at (fx, fz): it freezes (hitlag), rebounds (cannot
  // act) and slides away at reboundPush (the slide the shield uses; hitlag holds it still first). Returns the rebound frames.
  rebound(x, d, fx, fz) {
    const ecs = this.ecs, mg = MELEE_GUARD, rb = Math.ceil(mg.rebound[0] * (d + mg.rebound[1])), kx = ecs.x[x] - fx, kz = ecs.z[x] - fz, kl = Math.hypot(kx, kz);
    ecs.hitlag[x] = hitlagFrames(d); ecs.stagger[x] = Math.max(ecs.stagger[x], rb * DT);
    if (kl > 1e-6) { const v = mg.reboundPush * LAWLESS.meleeUnit * 60 / kl; ecs.lvx[x] = kx * v; ecs.lvz[x] = kz * v; }
    return rb;
  }

  // P2b (MN_MELEE): a mob's melee circle `a` bursts on pirate e while e's sabre blow has its hitbox out and the mob stands in
  // its reach and arc: the blows meet by clank's 9 rule (PvE, so no pvpDmg). A cancelled mob's circle hits nobody (a.cancel);
  // a cancelled pirate's blow ends, is spent on the mob, and the circle still lands on e. Bosses do not clank.
  clankMob(e, a) {
    const ecs = this.ecs, mg = MELEE_GUARD, o = a.owner;
    if (!ecs.atkStage[e] || airborne(ecs, e) || !o || !ecs.alive[o] || !(ecs.mask[o] & C.ENEMY) || ecs.dead[o] > 0 || defOf(ecs, o)?.boss) return;
    const st = swingDescriptor(1, ecs, e), key = e * 65536 + ecs.swingId[e];
    if (!swingOn(st, ecs.atkT[e]) || this.hitState(o).hitBy.get(e) === key || !this.inBlow(e, st, ecs.x[o], ecs.z[o], ecs.hurtR[o])) return;
    const dP = Math.floor(meleePercent(ecs.atk[e] * st.mult, ecs.maxHp[o], LAWLESS.meleeStamina)), dM = Math.floor(meleePercent(a.dmg, ecs.maxHp[e], LAWLESS.meleeStamina));
    let ra = 0, rb = 0;
    if (dM - mg.clank < dP) { a.cancel = true; rb = this.rebound(o, dM, ecs.x[e], ecs.z[e]); }
    if (dP - mg.clank < dM) {
      ecs.atkStage[e] = 0; ecs.atkBuf[e] = ecs.atkLatch[e] = 0;
      this.hitState(o).hitBy.set(e, key);
      ra = this.rebound(e, dP, ecs.x[o], ecs.z[o]);
    }
    this.emit({ type: 'clank', a: e, b: o, x: (ecs.x[e] + ecs.x[o]) / 2, z: (ecs.z[e] + ecs.z[o]) / 2, ra, rb });
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
      this.strike(o, ecs.atk[e] * L.mult, { by: e, kind: 'skill', skill: 'lunge', seq, x: x0, z: z0, heavy: true, knock: tuning.melee.knock, elem: ecs.elem[e], pt });
      if (this.meleeVersion !== 1) this.feel(e, seq, tuning.feel.hitstopMelee, 0);
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
      this.strike(o, ecs.atk[e] * W.mult, { by: e, kind: 'skill', skill: 'wave', seq, dx, dz, x: tmp.x - dx, z: tmp.z - dz, knock: 6, elem: ecs.elem[e], pt });
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
      this.strike(o, ecs.atk[e] * R.mult, { by: e, kind: 'skill', skill: 'rain', seq, x: cx, z: cz, pierce: true, knock: 0.6, above: true, elem: ecs.elem[e], pt: T });
    }
  }

  // The Mastbolt selects its first target in the charged aim cone, then chains to the nearest live NPC each hop.
  lightningHits(e, k, pt, seq) {
    const ecs = this.ecs, S = SKILLS.mastbolt, back = pt - tuning.combat.interpTicks;
    const origin = this.tmpMastOrigin || (this.tmpMastOrigin = {}), target = this.tmpMastTarget || (this.tmpMastTarget = {});
    origin.x = ecs.x[e]; origin.z = ecs.z[e];
    const fx = Math.sin(ecs.facing[e]), fz = Math.cos(ecs.facing[e]), cone = Math.cos(S.halfArc * D2R);
    let first = 0, firstD = Infinity, firstX = 0, firstZ = 0;
    for (let t = 1; t < ecs.cap; t++) {
      if (!(ecs.mask[t] & C.ENEMY) || !this.canHit(e, t)) continue;
      historyAt(this, t, back, target);
      const dx = target.x - origin.x, dz = target.z - origin.z, d = Math.hypot(dx, dz);
      if (d > S.range + ecs.hurtR[t] || (d > 0.05 && (dx * fx + dz * fz) / d < cone)) continue;
      if (d < firstD || (d === firstD && (!first || t < first))) { first = t; firstD = d; firstX = target.x; firstZ = target.z; }
    }
    if (!first) return 0;
    const jumps = 1 + Math.floor(Math.min(1, k) * S.jumps), points = [{ id: first, x: firstX, z: firstZ }], visited = new Set([first]);
    let current = first, cx = firstX, cz = firstZ, mult = S.mult, hits = 0;
    for (let hop = 0; hop <= jumps; hop++) {
      if (!ecs.alive[current] || ecs.dead[current] > 0) break;
      this.strike(current, ecs.atk[e] * mult, {
        by: e, kind: 'skill', skill: 'mastbolt', seq, x: hop === 0 ? origin.x : points[hop - 1].x,
        z: hop === 0 ? origin.z : points[hop - 1].z, noCrit: true, noElement: true, elem: 3, pt,
      });
      hits++;
      if (hop >= jumps) break;
      let next = 0, nextD = Infinity, nx = 0, nz = 0;
      for (let t = 1; t < ecs.cap; t++) {
        if (visited.has(t) || !(ecs.mask[t] & C.ENEMY) || !this.canHit(e, t)) continue;
        historyAt(this, t, back, target);
        const d = Math.hypot(target.x - cx, target.z - cz);
        if (d > S.chainR) continue;
        if (d < nextD || (d === nextD && (!next || t < next))) { next = t; nextD = d; nx = target.x; nz = target.z; }
      }
      if (!next) break;
      visited.add(next); current = next; cx = nx; cz = nz;
      points.push({ id: next, x: nx, z: nz });
      mult *= S.falloff;
    }
    this.emit({ type: 'lightning', id: this.nextLightning++, e, seq, points, kind: 'mastbolt', elem: 3, x: ecs.x[e], z: ecs.z[e] });
    return hits;
  }

  // ---- Tattoo hits (M4.7 P3, server only) ---------------------------------------------------------------
  // One blow of a tattoo (ATK × mult) on target t: the strike (elem: the attacker's), then o.stun s of stagger.
  // o: {skill, knock, stun, heavy, kind}.
  skillStrike(e, t, mult, o, x, z, seq, pt) {
    const ecs = this.ecs;
    const hit = { by: e, kind: o.kind || 'skill', skill: o.skill, seq, x, z, knock: o.knock, heavy: o.heavy, elem: ecs.elem[e], fire: o.fire, pt };
    const dmg = this.strike(t, ecs.atk[e] * mult, hit);
    // Melee armor and chip hits must not fall back to the tattoo stun.
    if (o.stun > 0 && !hit.meleeHit && !(this.meleeVersion === 1 && (ecs.mask[t] & C.ENEMY))) this.stun(e, t, o.stun, seq, dmg);
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
      this.skillStrike(e, t, mult, o, x, z, seq, pt);
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
      this.skillStrike(e, t, mult, o, x0, z0, seq, pt);
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
      this.strike(o, ecs.atk[e] * RP.dmgMult, { by: e, kind: 'wave', seq, x: ecs.x[e], z: ecs.z[e], heavy: true, knock: RP.knock, pierce: true, elem: ecs.elem[e], pt: this.tick });
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
      if (this.residentPlayers?.has(p)) continue; // Safe-port social bodies earn no passive rewards.
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
    grabCollisions(this);
    const hits = this.grabHits; this.grabHits = [];
    for (const h of hits) if (ecs.alive[h.e] && !ecs.dead[h.e] && ecs.atkStage[h.e] === h.stage && ecs.swingId[h.e] === h.swing)
      this.meleeHits(h.e, h.st, h.pt, h.seq);
    syncGrabs(this);
    releaseThrows(this);
    // Trial preparation can fail before any World system consumes this fixed tick.
    this.navalPilot?.prepare();
    if (this.isServer) this.navalTrial?.step();
    this.navalPilot?.sync();
    stepChills(this);
    stepInk(this);
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e]) continue;
      const m = ecs.mask[e];
      if (m & C.BOT) { stepMover(this, e, botCommand(this, e, DT), DT); if (this.falls.length) this.applyFalls(); }
      else if (m & C.ENEMY) stepEnemy(this, e, DT);
    }
    if (this.falls.length) this.applyFalls(); // a fall from a crew walking a deck (deckWalk)
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
        else if ((ecs.mask[e] & C.PLAYER) && !(ecs.mask[e] & C.BOT)) {
          recordHistory(this, e, this.hitState(e));
          if (jumpOn(this)) { // PT06: the feet height too, for the hits that rewind (lagPos)
            let h = this.yhist.get(e);
            if (!h) { h = new Float64Array(32).fill(ecs.y[e]); this.yhist.set(e, h); }
            h[this.tick % 32] = ecs.y[e];
          }
        }
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
    ecs.state[e] = ecs.swim[e] ? 2 : ecs.dashT[e] >= 0 ? 1 : 0;
  }

  // Back-compat names (tools and tests from M1).
  moverState(e, out) { return this.playerState(e, out); }
  setMoverState(e, arr) { this.setPlayerState(e, arr); }
}

export { PTYPE };
export const BEAM_FIELDS = ['id', 'kind', 'x0', 'z0', 'ang0', 'omega', 'vx', 'vz', 'off', 'len', 'w', 'tAct', 'tEnd', 'dmg', 'every', 'knock', 'keep', 'tele', 'travel', 'fire'];
export const LAVA_FIELDS = ['id', 'cx', 'cz', 'r0', 'rMin', 'rate', 't0', 'R', 'dmg', 'every'];
