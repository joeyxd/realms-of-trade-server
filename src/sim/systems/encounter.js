// Encounters (server only, PLAN-M2.5.md §2.3): «La Prueba de Fuego» in La Caldera.
//   idle → intro → wave i → rest → … → bossIntro → boss → victory (cooldown) → idle
// Stepping into the rune circle at the arena centre starts it. If no participant is alive inside the
// arena for wipeGrace s it resets, remembering a reached boss (the next try starts at the boss).
// Enemies it spawns carry brain.enc = id (no respawn; killEnemy reports back here).
import { ENCOUNTERS } from '../../data/encounters.js';
import { ENEMIES } from '../../data/enemies.js';
import { C } from '../ecs.js';
import { LAVA_FIELDS } from '../world.js';

const D2R = Math.PI / 180;

export function createEncounter(id, map) {
  const D = ENCOUNTERS[id], A = map.landmarks.arena;
  // The gate is on the -u side of the arena (worldgen L.arena): no spawns in front of it.
  const g = map.toWorld(-1, 0), gateAng = Math.atan2(g.x, g.z);
  const points = [];
  const span = 360 - 2 * D.gateGap;
  for (let k = 0; k < D.spawnN; k++) {
    const a = gateAng + (D.gateGap + (k / (D.spawnN - 1)) * span) * D2R;
    for (let r = D.spawnR; r > D.spawnR - 4; r -= 1) {
      const x = A.x + Math.sin(a) * r, z = A.z + Math.cos(a) * r;
      const near = map.queryColliders(x, z, 2.5).some((i) => Math.hypot(map.colliders[i].x - x, map.colliders[i].z - z) < map.colliders[i].r + 1.2);
      if (!near) { points.push({ x, z }); break; }
    }
  }
  const bo = map.toWorld(D.boss.at[0], D.boss.at[1]);
  return {
    id, def: D, cx: A.x, cz: A.z, gateAng, points, boss: { x: A.x + bo.x, z: A.z + bo.z },
    st: 'idle', t: 0, wave: -1, alive: new Set(), late: false, reached: '', cool: 0, out: 0,
    bossE: 0, cursor: 0, left: -1,
  };
}

const participants = (world, enc, r) => {
  const ecs = world.ecs, out = [];
  for (let p = 1; p < ecs.cap; p++) {
    if (!ecs.alive[p] || !(ecs.mask[p] & C.PLAYER) || (ecs.mask[p] & C.BOT) || ecs.dead[p] > 0) continue;
    if (Math.hypot(ecs.x[p] - enc.cx, ecs.z[p] - enc.cz) < r) out.push(p);
  }
  return out;
};

function emit(world, enc, extra = {}) {
  world.emit({ type: 'enc', id: enc.id, st: enc.st, wave: enc.wave, waves: enc.def.waves.length, left: enc.alive.size, tick: world.tick, ...extra });
}

function go(world, enc, st, extra) { enc.st = st; enc.t = 0; emit(world, enc, extra); }

function spawnGroups(world, enc, groups) {
  for (const [kind, n] of groups) {
    for (let i = 0; i < n; i++) {
      const p = enc.points[enc.cursor++ % enc.points.length];
      // A little scatter so a group from one point does not stack.
      const j = (enc.cursor * 2.399) % (Math.PI * 2), r = (i % 3) * 0.9;
      const x = p.x + Math.sin(j) * r, z = p.z + Math.cos(j) * r;
      const e = world.spawnEnemy(kind, x, z, Math.atan2(enc.cx - x, enc.cz - z), { riseT: enc.def.riseT, aggro: 40, leash: 60, enc: enc.id });
      enc.alive.add(e);
    }
  }
}

// Despawn everything the encounter owns (reset / victory leftovers) and clear the hostile bullets.
function sweepOut(world, enc) {
  for (const e of enc.alive) if (world.ecs.alive[e]) world.despawn(e);
  enc.alive.clear();
  if (enc.bossE && world.ecs.alive[enc.bossE]) world.despawn(enc.bossE);
  enc.bossE = 0;
  world.clearHostile();
  if (world.hazards.lava) world.setLava(null);
}

function startWave(world, enc, i) {
  enc.wave = i; enc.late = false;
  spawnGroups(world, enc, enc.def.waves[i].groups);
  go(world, enc, 'wave');
}

export function stepEncounter(world, enc, dt) {
  const D = enc.def;
  enc.t += dt;
  if (enc.cool > 0) enc.cool -= dt;
  if (enc.st === 'idle') {
    if (enc.cool > 0) return;
    if (!participants(world, enc, D.startR).length) return;
    enc.out = 0;
    go(world, enc, enc.reached === 'boss' ? 'bossIntro' : 'intro');
    return;
  }
  // Wipe: nobody alive inside the arena for a while.
  if (enc.st !== 'victory') {
    if (participants(world, enc, D.radius).length) enc.out = 0;
    else if ((enc.out += dt) > D.wipeGrace) { reset(world, enc); return; }
  }
  // Drop the dead from the roster (kills report back too; this catches despawns).
  for (const e of enc.alive) if (!world.ecs.alive[e] || world.ecs.dead[e] > 0) enc.alive.delete(e);
  switch (enc.st) {
    case 'intro':
      if (enc.t >= D.intro) startWave(world, enc, 0);
      break;
    case 'wave': {
      const W = D.waves[enc.wave];
      if (W.late && !enc.late && (enc.t >= W.late.after || enc.alive.size === 0)) {
        enc.late = true;
        spawnGroups(world, enc, W.late.groups);
        emit(world, enc, { late: 1 });
      }
      if (enc.alive.size === 0 && (!W.late || enc.late)) {
        world.clearHostile();
        if (enc.wave + 1 < D.waves.length) go(world, enc, 'rest');
        else go(world, enc, 'bossIntro');
      } else if (enc.alive.size !== enc.left) { enc.left = enc.alive.size; emit(world, enc); }
      break;
    }
    case 'rest':
      if (enc.t >= D.rest) startWave(world, enc, enc.wave + 1);
      break;
    case 'bossIntro':
      if (!enc.bossE) {
        enc.reached = 'boss';
        const B = D.boss, b = enc.boss;
        enc.bossE = world.spawnEnemy(B.kind, b.x, b.z, Math.atan2(enc.cx - b.x, enc.cz - b.z), { riseT: B.riseT, aggro: 40, leash: 60, enc: enc.id, boss: 1 });
        emit(world, enc, { boss: enc.bossE });
      }
      if (enc.t >= D.boss.intro) go(world, enc, 'boss', { boss: enc.bossE });
      break;
    case 'boss':
      if (!enc.bossE || !world.ecs.alive[enc.bossE]) victory(world, enc);
      break;
    case 'victory':
      if (enc.t >= 3) { enc.cool = D.cooldown; go(world, enc, 'idle'); }
      break;
    default: break;
  }
}

function victory(world, enc) {
  enc.reached = '';
  enc.bossE = 0;
  // The minions crumble with their master (no XP: the boss paid for everything).
  for (const e of enc.alive) if (world.ecs.alive[e]) world.killEnemy(e, 0, { noXp: true });
  enc.alive.clear();
  world.clearHostile();
  if (world.hazards.lava) world.setLava(null);
  go(world, enc, 'victory');
}

export function reset(world, enc) {
  sweepOut(world, enc);
  enc.wave = -1; enc.cool = 3; enc.out = 0; enc.left = -1;
  go(world, enc, 'idle', { wipe: 1 });
}

// killEnemy hook.
export function encounterKilled(world, e) {
  const b = world.ecs.brain[e];
  if (!b || !b.enc || !world.encounters) return;
  const enc = world.encounters.find((q) => q.id === b.enc);
  if (!enc) return;
  enc.alive.delete(e);
  if (e === enc.bossE) enc.bossE = 0;
}

// Compact state for snapshots (late joiners, the HUD):
// [id, st, wave, waves, left, boss, bossPhase (0-based), shield (0 off · 1 up · 2 broken), invulnerable,
//  lava (0, or its LAVA_FIELDS values: late joiners rebuild it)].
export function encounterState(world, enc) {
  const b = enc.bossE && world.ecs.alive[enc.bossE] ? world.ecs.brain[enc.bossE] : null;
  const L = world.hazards.lava;
  return [enc.id, enc.st, enc.wave, enc.def.waves.length, enc.alive.size, b ? enc.bossE : 0,
    b ? b.phase : 0, b ? (b.broken > 0 ? 2 : b.shieldOn ? 1 : 0) : 0, b && (b.inv > 0 || b.state === 'wake') ? 1 : 0,
    L ? LAVA_FIELDS.map((k) => L[k]) : 0];
}

// F4: start | wave (finish the current one) | boss | phase2 | phase3 | win | reset.
export function encounterDev(world, enc, op) {
  switch (op) {
    case 'start': if (enc.st === 'idle') { enc.cool = 0; go(world, enc, 'intro'); } break;
    case 'wave': if (enc.st === 'wave') { for (const e of [...enc.alive]) if (world.ecs.alive[e]) world.killEnemy(e, 0, { noXp: true }); enc.late = true; } break;
    case 'boss': sweepOut(world, enc); enc.wave = enc.def.waves.length - 1; go(world, enc, 'bossIntro'); break;
    case 'phase2': case 'phase3':
      if (enc.bossE) { const ecs = world.ecs; ecs.hp[enc.bossE] = Math.floor(ecs.maxHp[enc.bossE] * (ENEMIES.hellfire.phases[op === 'phase2' ? 0 : 1].until - 0.01)); }
      break;
    case 'win': if (enc.bossE) world.killEnemy(enc.bossE, 0); break;
    case 'reset': enc.reached = ''; reset(world, enc); break;
    default: break;
  }
}
