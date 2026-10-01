// M2.5 «La Prueba de Fuego» (PLAN-M2.5.md): new patterns, melee minions, bounces, dodges, the encounter
// and the Hellfire boss, on the pure sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { Hazards, emitPattern, patternCount, patternSpan, PTYPE } from '../src/sim/projectiles.js';
import { tuning, DT } from '../src/data/tuning.js';
import { BTN } from '../src/sim/systems/movement.js';
import { ENEMIES } from '../src/data/enemies.js';
import { damageEnemy } from '../src/sim/systems/enemies.js';
import { GAME } from '../src/data/meta.js';

const map = generateWorld(GAME.seed);
const A = map.landmarks.arena;

// A server world with one player in the arena (no map enemies), stepped one command per tick.
function arena(x = A.x + 6, z = A.z + 6) {
  const w = new World(GAME.seed, { map, server: true });
  const e = w.spawnPlayer({ x, z, facing: Math.PI / 2 });
  w.events.length = 0;
  let seq = 0;
  const step = (o = {}) => {
    const cmd = { seq: ++seq, mx: 0, mz: 0, ax: w.ecs.x[e] + 5, az: w.ecs.z[e], prs: 0, pt: w.tick, ...o };
    w.applyCommand(e, cmd);
    w.stepWorld();
    const evs = w.events.slice();
    w.events.length = 0;
    return evs;
  };
  return { w, e, step };
}

test('multi-arm spirals and staggered rings expand identically on server and client', () => {
  const pats = [
    { pat: 'spiral', arms: 4, n: 48, gap: 0.05, spread: 9, ptype: 'parry' },
    { pat: 'rings', n: 16, waves: 3, gap: 0.45, spread: 11.25, alt: 1, ptype: 'parry' },
    { pat: 'ring', n: 12, alt: 1, ptype: 'parry' },
  ];
  for (const p of pats) {
    const ev = { pid0: 100, tick: 50, src: 7, speed: 6, dmg: 8, x: A.x, y: 1.2, z: A.z, ang: 0.3, slope: 0, ...p };
    const a = new Hazards(), b = new Hazards();
    assert.equal(emitPattern(a, ev, map), patternCount(ev));
    emitPattern(b, JSON.parse(JSON.stringify(ev)), map); // the client gets it through the wire
    const n = patternCount(ev);
    assert.equal(a.count, n);
    const t = 50 + Math.round(patternSpan(ev) / DT) + 20;
    const types = new Set(), angles = new Set();
    for (let k = 0; k < n; k++) {
      const sa = a.slot.get(100 + k), sb = b.slot.get(100 + k);
      assert.ok(sa !== undefined && sb !== undefined);
      assert.equal(a.t0[sa], b.t0[sb]);
      assert.equal(a.px(sa, t), b.px(sb, t));
      assert.equal(a.pz(sa, t), b.pz(sb, t));
      types.add(a.type[sa]);
      angles.add(Math.round(Math.atan2(a.vx[sa], a.vz[sa]) * 1000));
    }
    if (p.alt) assert.deepEqual([...types].sort(), [PTYPE.PARRY, PTYPE.UNSTOP]);
    assert.ok(angles.size >= n * 0.6, `${p.pat}: shots go in many directions`);
  }
  // Timing: the 4-arm spiral fires 4 at a time, 12 steps 0.05 s apart; 3 rings 0.45 s apart.
  assert.equal(patternSpan({ pat: 'spiral', arms: 4, n: 48, gap: 0.05 }).toFixed(2), '0.55');
  assert.equal(patternSpan({ pat: 'rings', n: 16, waves: 3, gap: 0.45 }).toFixed(2), '0.90');
  assert.equal(patternCount({ pat: 'rings', n: 16, waves: 3 }), 48);
});

test('a drowned grunt chases, bites a player who stands still and misses one who dashes out', () => {
  for (const dodge of [false, true]) {
    const { w, e, step } = arena();
    const g = w.spawnEnemy('grunt', w.ecs.x[e] + 6, w.ecs.z[e], -Math.PI / 2);
    let wind = null, hurt = 0;
    for (let i = 0; i < 240 && !wind; i++) for (const ev of step()) if (ev.type === 'windup' && ev.id === g) wind = ev;
    assert.ok(wind, 'it closes in and winds up the bite');
    assert.equal(wind.atk, 'bite');
    assert.ok(Math.hypot(w.ecs.x[g] - w.ecs.x[e], w.ecs.z[g] - w.ecs.z[e]) < 1.8, 'from melee range');
    const bite = ENEMIES.grunt.attacks[0], ticks = Math.round(bite.windup / DT);
    for (let i = 0; i < ticks + 30; i++) {
      // Dash straight away from it 0.15 s before the bite lands.
      const o = dodge && i === ticks - 9 ? { prs: BTN.DASH, mx: -1, mz: 0 } : dodge && i > ticks - 9 ? { mx: -1, mz: 0 } : {};
      for (const ev of step(o)) if (ev.type === 'hurt' && ev.e === e && ev.kind !== 'contact') hurt += ev.dmg;
    }
    if (dodge) assert.equal(hurt, 0, 'dashed out of the circle');
    else assert.ok(hurt >= 1, 'bitten');
  }
});

test('light enemies fly further from the same hit; encounter spawns rise before they act', () => {
  const { w, e } = arena();
  const a = w.spawnEnemy('grunt', w.ecs.x[e] + 3, w.ecs.z[e]), b = w.spawnEnemy('archer', w.ecs.x[e] - 3, w.ecs.z[e]);
  for (const t of [a, b]) w.ecs.hp[t] = 999;
  const kb = (t) => { w.ecs.kbx[t] = w.ecs.kbz[t] = 0; return t; };
  {
    damageEnemy(w, kb(a), 5, { by: e, kind: 'melee', x: w.ecs.x[e], z: w.ecs.z[e] });
    damageEnemy(w, kb(b), 5, { by: e, kind: 'melee', x: w.ecs.x[e], z: w.ecs.z[e] });
    assert.ok(Math.abs(w.ecs.kbx[a]) > Math.abs(w.ecs.kbx[b]) * 1.5);
    w.events.length = 0;
    const r = w.spawnEnemy('imp', A.x, A.z, 0, { riseT: 0.8, aggro: 40, leash: 60 });
    assert.ok(w.events.some((ev) => ev.type === 'rise' && ev.id === r));
    const br = w.ecs.brain[r];
    assert.equal(br.state, 'wake');
    for (let i = 0; i < 30; i++) w.stepWorld();
    assert.equal(br.state, 'wake', 'still standing up');
    for (let i = 0; i < 30; i++) w.stepWorld();
    assert.notEqual(br.state, 'wake');
    assert.equal(br.target, e, 'the encounter aggro reaches across the arena');
  }
});
