// M3 (PLAN-M3.md): curtains, beams, lava, the mortar crab, 5 waves and Hellfire in 3 phases, on the pure sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { Hazards, emitPattern, patternCount, patternSpan, lavaR } from '../src/sim/projectiles.js';
import { tuning, DT } from '../src/data/tuning.js';
import { BTN } from '../src/sim/systems/movement.js';
import { GAME } from '../src/data/meta.js';

const map = generateWorld(GAME.seed);
const A = map.landmarks.arena;

// A server world with one player in the arena, stepped one command per tick.
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
const hurts = (evs, kind) => evs.filter((ev) => ev.type === 'hurt' && (!kind || ev.kind === kind));

test('a curtain (rows) leaves holes, crosses the arena with its own life and expands the same on the client', () => {
  const ev = { pid0: 10, tick: 100, src: 3, pat: 'rows', ptype: 'parry', n: 30, waves: 4, gap: 0.9, sp: 1.15, holes: [4, 12, 20, 9], hw: 3, life: 8, speed: 5.5, dmg: 8, x: A.x, y: 5.8, z: A.z - 16, ang: 0, slope: 0 };
  const a = new Hazards(), b = new Hazards();
  emitPattern(a, ev, map);
  emitPattern(b, JSON.parse(JSON.stringify(ev)), map);
  assert.equal(patternCount(ev), 120, 'ids for every slot');
  assert.equal(a.count, 120 - 4 * 3, 'the holes are not spawned');
  assert.equal(b.count, a.count);
  assert.ok(Math.abs(patternSpan(ev) - 2.7) < 1e-9);
  // Row 0: slots 4, 5, 6 are missing, the rest is a straight line across ang, all with the long life.
  assert.equal(a.slot.get(10 + 4), undefined);
  assert.equal(a.slot.get(10 + 7) !== undefined, true);
  const s0 = a.slot.get(10), s29 = a.slot.get(10 + 29);
  assert.ok(Math.abs(a.x0[s29] - a.x0[s0] - 29 * 1.15) < 1e-9 && Math.abs(a.z0[s29] - a.z0[s0]) < 1e-9);
  for (const [id, s] of a.slot) {
    const t = b.slot.get(id);
    assert.equal(a.x0[s], b.x0[t]); assert.equal(a.t0[s], b.t0[t]); assert.equal(a.tEnd[s], b.tEnd[t]);
  }
  const mid = a.slot.get(10 + 15);
  assert.ok((a.tEnd[mid] - a.t0[mid]) * DT > tuning.projectiles.parryable.life + 1, 'lives longer than a normal orb');
});

test('a laser turns, hurts every `every` ticks, and a dash through it is a FANTASMA without damage', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  ecs.x[e] = A.x + 6; ecs.z[e] = A.z;
  // A laser from the arena centre pointing at +x (ang π/2), active right away, not turning.
  w.addBeam({ owner: 0, kind: 'laser', x0: A.x, z0: A.z, ang0: Math.PI / 2, omega: 0, off: 1, len: 20, w: 0.9, tAct: w.tick + 3, tEnd: w.tick + 120, dmg: 10, every: 12 });
  let evs = [];
  for (let i = 0; i < 60; i++) evs.push(...step());
  const h = hurts(evs, 'beam');
  // hurtIframes (0.35 s = 21 ticks) is longer than every (12): one hit per 21+ ticks.
  assert.ok(h.length >= 2 && h.length <= 3, `hit a few times while standing in it (${h.length})`);
  // Turning beam: a player 6 u away at 90° gets swept after ~1.8 s at 50 °/s.
  const t2 = arena();
  t2.w.ecs.x[t2.e] = A.x; t2.w.ecs.z[t2.e] = A.z + 6;
  t2.w.addBeam({ owner: 0, kind: 'laser', x0: A.x, z0: A.z, ang0: Math.PI / 2, omega: -50 * Math.PI / 180, off: 1, len: 20, w: 0.9, tAct: t2.w.tick + 1, tEnd: t2.w.tick + 240, dmg: 10, every: 12 });
  let first = -1;
  for (let i = 0; i < 200 && first < 0; i++) if (hurts(t2.step(), 'beam').length) first = i;
  assert.ok(first > 90 && first < 125, `swept by the turning laser after ~1.8 s (${first} ticks)`);
  // Dash through a fire lane: no damage, one FANTASMA.
  const t3 = arena();
  const p = t3.w.ecs;
  p.x[t3.e] = A.x - 3; p.z[t3.e] = A.z;
  t3.w.addBeam({ owner: 0, kind: 'lane', x0: A.x, z0: A.z - 20, ang0: 0, off: 0, len: 40, w: 3, tAct: t3.w.tick + 1, tEnd: t3.w.tick + 400, dmg: 10, every: 15 });
  for (let i = 0; i < 5; i++) t3.step();
  evs = [];
  evs.push(...t3.step({ mx: 1, mz: 0, prs: BTN.DASH, btn: BTN.DASH }));
  for (let i = 0; i < 14; i++) evs.push(...t3.step({ mx: 1, mz: 0 }));
  assert.ok(p.x[t3.e] > A.x + 1.5, `dashed across (${(p.x[t3.e] - A.x).toFixed(2)})`);
  assert.equal(hurts(evs, 'beam').length, 0, 'no damage');
  assert.equal(evs.filter((ev) => ev.type === 'ghost' && ev.beam).length, 1, 'one FANTASMA');
});

test('the lava ring shrinks to its minimum and burns only outside it, pushing you inward', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  const L = w.setLava({ cx: A.x, cz: A.z, r0: 19, rMin: 11, rate: 0.12 * 20, t0: w.tick, R: 21, dmg: 6, every: 30 });
  assert.equal(lavaR(L, w.tick), 19);
  assert.equal(lavaR(L, w.tick + 10 / DT), 11, 'stops at rMin');
  ecs.x[e] = A.x + 8; ecs.z[e] = A.z;
  let evs = [];
  for (let i = 0; i < 60; i++) evs.push(...step());
  assert.equal(hurts(evs, 'lava').length, 0, 'safe inside');
  ecs.x[e] = A.x + 18; ecs.z[e] = A.z; // at 1 s the safe radius is 16.6
  evs = [];
  for (let i = 0; i < 61; i++) evs.push(...step());
  const h = hurts(evs, 'lava');
  assert.ok(h.length === 2 || h.length === 3, `burns every 0.5 s (${h.length})`);
  assert.ok(ecs.x[e] < A.x + 18, 'pushed toward the centre');
  assert.equal(ecs.hurtInv[e] > tuning.combat.hurtIframes - 0.05, false, 'lava gives no hurt iframes');
  w.setLava(null);
  assert.equal(w.hazards.lava, null);
});

test('keep circles (mortar shells, meteors) still land when their owner dies; normal ones are cancelled', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  const foe = w.debugSpawn('archer', A.x + 12, A.z, 0);
  const px = ecs.x[e], pz = ecs.z[e];
  const keep = w.addAoe({ owner: foe, x: px, z: pz, r: 2.2, tAct: w.tick + 30, dmg: 12, keep: 1, fall: 'mortar', fx: ecs.x[foe], fz: ecs.z[foe], fy: 1 });
  const norm = w.addAoe({ owner: foe, x: px, z: pz, r: 2.2, tAct: w.tick + 30, dmg: 12 });
  w.killEnemy(foe, e);
  assert.equal(!!keep.cancel, false);
  assert.equal(!!norm.cancel, true);
  let evs = [];
  for (let i = 0; i < 40; i++) evs.push(...step());
  assert.equal(hurts(evs, 'aoe').length, 1, 'the shell in the air still lands');
  // clearHostile (end of a wave, phase change) removes everything, kept or not.
  const k2 = w.addAoe({ owner: 0, x: px, z: pz, r: 2.2, tAct: w.tick + 30, dmg: 12, keep: 1 });
  w.clearHostile();
  assert.equal(k2.cancel, true);
});
