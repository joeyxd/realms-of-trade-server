// Ambience step 2: lighting presets, particle and streak pools, lava points (needs `three` from
// devDependencies; skipped when it is not installed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';

let mod = null;
try {
  const THREE = await import('three');
  const { PRESETS } = await import('../src/render/lighting.js');
  const { StreakPool } = await import('../src/render/vfx/streaks.js');
  const { ParticlePool, SHAPE } = await import('../src/render/vfx/particles.js');
  const { lavaPoints, LocalLights } = await import('../src/render/lights.js');
  mod = { THREE, PRESETS, StreakPool, ParticlePool, SHAPE, lavaPoints, LocalLights };
} catch { mod = null; }
const opts = mod ? {} : { skip: 'three is not installed (npm install)' };
const map = generateWorld(GAME.seed);

test('every lighting preset carries the same keys (they blend key by key)', opts, () => {
  const keys = Object.keys(mod.PRESETS.day).sort();
  for (const [name, p] of Object.entries(mod.PRESETS)) {
    assert.deepEqual(Object.keys(p).sort(), keys, `${name} keys`);
    for (const k of keys) assert.equal(!!p[k].isColor, !!mod.PRESETS.day[k].isColor, `${name}.${k} type`);
  }
  for (const k of ['bloom', 'glints', 'fxLight']) assert.ok(keys.includes(k), `presets have ${k}`);
  // The dark presets bloom more than the day.
  assert.ok(mod.PRESETS.night.bloom > mod.PRESETS.day.bloom);
  assert.ok(mod.PRESETS.volcanic.bloom >= mod.PRESETS.night.bloom);
});

test('streak pool: spawn, cool, die and reuse slots without growing', opts, () => {
  const pool = new mod.StreakPool(8);
  for (let i = 0; i < 12; i++) pool.spawn(i, 1, 0, 0, 2, 0, { life: 0.5, width: 0.1, color: [1, 1, 0], color1: [1, 0, 0] });
  assert.equal(pool.cursor, 4, 'ring buffer wraps');
  pool.update(0.25);
  assert.equal(pool.count, 8);
  // Halfway: color halfway between hot and cool, width shrinking, still moving up.
  assert.ok(Math.abs(pool.col[1] - 0.5) < 0.01, 'green channel cools 1 → 0');
  assert.ok(pool.size[0] > 0 && pool.size[0] < 0.1);
  assert.ok(pool.pos[1] > 1);
  pool.update(0.3);
  assert.equal(pool.count, 0);
  for (let i = 0; i < 8; i++) assert.equal(pool.size[i * 2], 0, 'dead streaks collapse (width 0)');
  assert.equal(pool.mesh.geometry.instanceCount, 8);
});

test('streak budget thins spawns on low quality', opts, () => {
  const pool = new mod.StreakPool(400);
  pool.budget = 0.5;
  for (let i = 0; i < 400; i++) pool.spawn(0, 0, 0, 0, 0, 0, { life: 5 });
  pool.update(0.01);
  assert.ok(pool.count > 120 && pool.count < 280, `about half spawned (${pool.count})`);
});

test('particle pool encodes shape and a per-particle seed in one float', opts, () => {
  const pool = new mod.ParticlePool(4);
  pool.spawn(0, 0, 0, 0, 0, 0, { shape: mod.SHAPE.FLAKE, heat: 0.7 });
  pool.spawn(0, 0, 0, 0, 0, 0, { shape: mod.SHAPE.WISP });
  assert.equal(Math.floor(pool.data[2] + 0.001), mod.SHAPE.FLAKE);
  assert.ok(pool.data[2] - mod.SHAPE.FLAKE < 0.99);
  assert.ok(Math.abs(pool.data[3] - 0.7) < 1e-6, 'heat');
  assert.equal(Math.floor(pool.data[6] + 0.001), mod.SHAPE.WISP);
  pool.update(0.1);
  assert.ok(pool.data[0] > 0, 'alive particles have a size');
});

test('lava points are shared by the lights and the lava bubbles', opts, () => {
  const pts = mod.lavaPoints(map);
  assert.ok(pts.length >= 3);
  assert.equal(mod.lavaPoints(map), pts, 'cached per map');
  for (const p of pts) assert.ok(map.masks(p.x, p.z).lava >= 0.75);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) >= 9, 'at least 9 u apart');
  }
  const lights = new mod.LocalLights(map);
  assert.equal(lights.sources.filter((s) => s.kind === 'lava').length, pts.length);
});
