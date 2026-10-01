// Authoritative world state. Pure (no THREE, no DOM, no wall clock).
// The same class runs the server (isServer: enemies, shots, hits on enemies) and the client's
// prediction of its own player (movement + combat against the projectiles the client knows about).
import { tuning, DT } from '../data/tuning.js';
import { ENEMIES, enemyIndex } from '../data/enemies.js';
import { mulberry32 } from '../core/rng.js';
import { ECS, C, KIND, TEAM, ACT, PLAYER_FIELDS } from './ecs.js';
import { generateWorld } from './worldgen.js';
import { stepMover } from './systems/movement.js';
import { makeBotBrain, botCommand } from './systems/bots.js';
import { stepPlayerCombat, applyLevel, gainXp } from './systems/combat.js';
import { makeEnemyBrain, stepEnemy, recordHistory, historyAt, damageEnemy, defOf } from './systems/enemies.js';
import { Hazards, Shots, emitPattern, patternCount, PTYPE } from './projectiles.js';

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
    this.shots = new Shots();
    this.nextPid = 1;
    this.nextSid = 1;
    this.nextAoe = 1;
    this.spawners = [];
    this.feelQ = new Map(); // e → {seq, hitstop, slowmo} merged per command
    this.tmp = { x: 0, z: 0, y: 0 };
  }

  emit(ev) { this.events.push(ev); }

  // ---- Spawning ---------------------------------------------------------------------------------------
  spawnPlayer({ name = 'Grumete', skin = 0, level = 1, x, z, clientId = -1, bot = false, facing = 0 }) {
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
    this.events.push({ type: 'spawn', id: e });
    return e;
  }

  spawnEnemy(kind, x, z, facing = 0, extra = {}) {
    const ecs = this.ecs, def = ENEMIES[kind];
    const e = ecs.create(KIND.ENEMY, C.POS | C.MOVER | C.HEALTH | C.ENEMY);
    ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = this.map.groundAt(x, z);
    ecs.facing[e] = facing;
    ecs.enemy[e] = enemyIndex(kind);
    ecs.speed[e] = def.speed;
    ecs.radius[e] = def.radius;
    ecs.hurtR[e] = def.hurt;
    ecs.team[e] = TEAM.ENEMIES;
    ecs.hp[e] = ecs.maxHp[e] = def.hp;
    ecs.def[e] = def.def;
    ecs.level[e] = def.level || 1;
    ecs.names[e] = def.name;
    ecs.titles[e] = def.title || '';
    ecs.brain[e] = makeEnemyBrain(def, x, z, facing, this.rng, extra);
    ecs.act[e] = extra.riseT ? ACT.WAKE : def.dormant ? ACT.DORMANT : ACT.IDLE;
    this.events.push({ type: 'spawn', id: e });
    // Encounter spawns stand up out of the ground first (bones assemble / a burst of fire).
    if (extra.riseT) this.emit({ type: 'rise', id: e, kind, x, z, dur: extra.riseT, tick: this.tick });
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
  }

  despawn(e) {
    this.ecs.destroy(e);
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
  firePattern(ev) {
    this.nextPid += patternCount(ev);
    emitPattern(this.hazards, ev, this.map);
    this.emit(ev);
  }

  cancelEmitter(e) {
    this.hazards.cancelPending(e, this.tick);
    this.emit({ type: 'cancel', src: e, tick: this.tick });
  }

  spawnShot(owner, o) {
    const sid = this.nextSid++;
    this.shots.spawn(sid, { ...o, owner, pred: this.isServer ? 0 : o.seq });
    if (this.isServer) {
      this.emit({ type: 'shot', sid, pid: o.pid, owner, x: o.x, y: o.y, z: o.z, dx: o.dx, dz: o.dz, speed: o.speed, dmg: o.dmg, life: o.life, r: o.r, ptype: o.type, heavy: o.heavy ? 1 : 0, seq: o.seq });
    }
    return sid;
  }

  // Server: nearest enemy (team 2) in a cone ahead of a shot.
  findEnemy(x, z, dx, dz, coneCos, maxD = 16) {
    const ecs = this.ecs;
    let best = 0, bd = maxD;
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e] || !(ecs.mask[e] & C.ENEMY) || ecs.dead[e] > 0) continue;
      const ox = ecs.x[e] - x, oz = ecs.z[e] - z, d = Math.hypot(ox, oz);
      if (d > bd || d < 1e-6) continue;
      if ((ox * dx + oz * dz) / d < coneCos) continue;
      bd = d; best = e;
    }
    return best;
  }

  stepShots(dt) {
    const S = this.shots, ecs = this.ecs, map = this.map, tmp = this.tmp;
    const find = (x, z, dx, dz, c) => this.findEnemy(x, z, dx, dz, c);
    const pos = (id, out) => {
      if (!ecs.alive[id] || !(ecs.mask[id] & C.ENEMY)) return false;
      out.x = ecs.x[id]; out.z = ecs.z[id]; out.y = ecs.y[id] + 1.1;
      return true;
    };
    for (let s = 0; s < S.cap; s++) {
      if (S.id[s] === 0) continue;
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
        for (let e = 1; e < ecs.cap; e++) {
          if (!ecs.alive[e] || !(ecs.mask[e] & C.ENEMY) || ecs.dead[e] > 0) continue;
          const rr = ecs.hurtR[e] + S.r[s];
          if ((ecs.x[e] - x) ** 2 + (ecs.z[e] - z) ** 2 < rr * rr) { hit = e; end = true; break; }
        }
      }
      if (!end) continue;
      const sid = S.id[s], owner = S.owner[s], dmg = S.dmg[s], heavy = S.heavy[s];
      S.free(s);
      this.emit({ type: 'shotEnd', sid, x, z, hit });
      if (hit) damageEnemy(this, hit, dmg, { by: owner, kind: 'shot', x: x - S.vx[s] * 0.1, z: z - S.vz[s] * 0.1, heavy: !!heavy, pierce: true });
    }
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
      if (!ecs.alive[o] || !(ecs.mask[o] & C.ENEMY) || ecs.dead[o] > 0) continue;
      const b = ecs.brain[o];
      if (b.hitBy.get(e) === key) continue;
      historyAt(this, o, back, tmp);
      const dx = tmp.x - ecs.x[e], dz = tmp.z - ecs.z[e], d = Math.hypot(dx, dz);
      if (d > st.range + ecs.hurtR[o]) continue;
      if (st.arc < 360 && d > 0.6 && (dx * fx + dz * fz) / d < half) continue;
      b.hitBy.set(e, key);
      const stage = ecs.atkStage[e];
      damageEnemy(this, o, ecs.atk[e] * st.mult, { by: e, kind: 'melee', seq, x: ecs.x[e], z: ecs.z[e], heavy: stage === 3, knock: M.knock });
      this.feel(e, seq, tuning.feel.hitstopMelee, 0);
    }
  }

  waveHits(e, seq) {
    const ecs = this.ecs, RP = tuning.parry.riposte;
    for (let o = 1; o < ecs.cap; o++) {
      if (!ecs.alive[o] || !(ecs.mask[o] & C.ENEMY) || ecs.dead[o] > 0) continue;
      if (Math.hypot(ecs.x[o] - ecs.x[e], ecs.z[o] - ecs.z[e]) > RP.radius + ecs.hurtR[o]) continue;
      damageEnemy(this, o, ecs.atk[e] * RP.dmgMult, { by: e, kind: 'wave', seq, x: ecs.x[e], z: ecs.z[e], heavy: true, knock: RP.knock, pierce: true });
    }
  }

  checkpoint(e) {
    if ((this.tick + e) % 15 !== 0) return;
    const ecs = this.ecs, id = this.map.checkpointAt(ecs.x[e], ecs.z[e]);
    if (!id) return;
    const cp = this.map.checkpoints[id];
    ecs.cpX[e] = cp.x; ecs.cpZ[e] = cp.z;
  }

  killEnemy(e, by) {
    const ecs = this.ecs, def = defOf(ecs, e);
    ecs.dead[e] = 1;
    this.hazards.cancelPending(e, this.tick);
    for (const a of this.hazards.aoes) if (a.owner === e && a.tAct > this.tick) a.cancel = true;
    // XP to every player nearby (the killer and whoever helped).
    for (let p = 1; p < ecs.cap; p++) {
      if (!ecs.alive[p] || !(ecs.mask[p] & C.PLAYER) || (ecs.mask[p] & C.BOT)) continue;
      if (p !== by && Math.hypot(ecs.x[p] - ecs.x[e], ecs.z[p] - ecs.z[e]) > 25) continue;
      gainXp(this, p, def.xp);
    }
    this.emit({ type: 'kill', id: e, by, x: ecs.x[e], z: ecs.z[e], xp: def.xp, tick: this.tick });
    const sp = this.spawners.find((q) => q.entity === e);
    if (sp) { sp.entity = 0; sp.timer = def.respawn || 30; }
    this.despawn(e);
  }

  // World systems that are not driven by player commands.
  stepWorld() {
    const ecs = this.ecs;
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e]) continue;
      const m = ecs.mask[e];
      if (m & C.BOT) stepMover(this, e, botCommand(this, e, DT), DT);
      else if (m & C.ENEMY) stepEnemy(this, e, DT);
    }
    if (this.isServer) {
      this.stepShots(DT);
      for (let e = 1; e < ecs.cap; e++) if (ecs.alive[e] && (ecs.mask[e] & C.ENEMY)) recordHistory(this, e);
      for (const sp of this.spawners) {
        if (sp.entity) continue;
        sp.timer -= DT;
        if (sp.timer > 0) continue;
        let near = false;
        for (let p = 1; p < ecs.cap; p++) {
          if (ecs.alive[p] && (ecs.mask[p] & C.PLAYER) && !(ecs.mask[p] & C.BOT) && Math.hypot(ecs.x[p] - sp.x, ecs.z[p] - sp.z) < 18) near = true;
        }
        if (near) { sp.timer = 2; continue; }
        sp.entity = this.spawnEnemy(sp.kind, sp.x, sp.z, sp.facing, sp.extra);
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
