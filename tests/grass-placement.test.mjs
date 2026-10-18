import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { GRASS_LIMIT, buildGrassPatches, grassBudget } from '../src/render/grassPlacement.js';
import { buildShrubs } from '../src/render/shrubPlacement.js';
import { preserveTerrainSites } from '../src/render/terrainSites.js';

// Pure placement check: grassPlacement.js imports no THREE or DOM, so the real seeded map is enough.
const map = generateWorld(99282957), shrubs = buildShrubs(map);
const points = buildGrassPatches(map, { shrubs });
const edge = points.filter((p) => p.edge);
const village = map.landmarks.village;
const campfires = map.props.filter((p) => p.kind === 'campfire');
const huts = map.props.filter((p) => p.kind === 'hut');

test('grass budgets and edge clump counts per tier', () => {
  const tiers = Object.fromEntries(['low', 'medium', 'high'].map((name) =>
    [name, buildGrassPatches(map, { shrubs, limit: grassBudget(name).limit })]));
  const byKind = {};
  for (const p of edge) byKind[p.edge] = (byKind[p.edge] || 0) + 1;
  console.log('grass clumps per tier', Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.length])));
  console.log('edge clumps per tier', Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.filter((p) => p.edge).length])), byKind);
  assert.equal(GRASS_LIMIT, 1000);
  assert.deepEqual(grassBudget('high'), { limit: 1000, distance: 55, detailDistance: 24 });
  assert.deepEqual(grassBudget('medium'), { limit: 520, distance: 38, detailDistance: 14 });
  assert.deepEqual(grassBudget('low'), { limit: 160, distance: 28, detailDistance: 0 });
  assert.ok(tiers.high.length <= 1000 && tiers.high.length >= 800, `high tier holds ${tiers.high.length} clumps`);
  assert.equal(tiers.medium.length, 520);
  assert.equal(tiers.low.length, 160);
  // Edge clumps come first, so every smaller tier is a prefix of the larger one.
  assert.deepEqual(tiers.medium, tiers.high.slice(0, 520));
  assert.deepEqual(tiers.low, tiers.high.slice(0, 160));
  assert.ok(tiers.low[0].edge && tiers.medium.filter((p) => p.edge).length === edge.length, 'edge clumps survive the cut');
});

test('edge clumps hug the village props and the walk', () => {
  const nearVillage = edge.filter((p) => Math.hypot(p.x - village.x, p.z - village.z) < 30);
  assert.ok(nearVillage.length >= 60, `${nearVillage.length} edge clumps near the village`);
  for (const kind of ['hut', 'walk', 'path']) assert.ok(edge.some((p) => p.edge === kind), `${kind} edge clumps exist`);
  assert.ok(edge.every((p) => p.scale >= 0.8 && p.scale <= 1.3 && Math.abs(p.radius - p.scale * 0.85) < 1e-6));
  assert.ok(edge.filter((p) => p.variant < 2).length > edge.length * 0.8, 'tuft and fan styles dominate');
  for (const hut of huts) {
    const ring = edge.filter((p) => p.edge === 'hut' && Math.hypot(p.x - hut.x, p.z - hut.z) < hut.r + 2.1);
    assert.ok(ring.length >= 4, `hut at ${hut.x.toFixed(0)},${hut.z.toFixed(0)} has ${ring.length} ring clumps`);
    // The door faces local +z: no clump inside the door arc.
    for (const p of ring) {
      const angle = Math.atan2(p.x - hut.x, p.z - hut.z), diff = Math.atan2(Math.sin(angle - hut.rot), Math.cos(angle - hut.rot));
      assert.ok(Math.abs(diff) >= 0.55 - 1e-6, 'hut door side stays clear');
    }
  }
});

test('plaza, colliders, water, and walkable paths stay clear', () => {
  assert.ok(campfires.length > 0 && huts.length > 0);
  for (const p of points) {
    for (const f of campfires) assert.ok(Math.hypot(p.x - f.x, p.z - f.z) >= 6.5 - 1e-6, 'no clump within 6.5 u of a campfire');
    for (const c of map.colliders) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) - c.r >= 1.0 - 1e-6, 'no clump within 1.0 u of a collider');
    assert.ok(map.materialAt(p.x, p.z) !== 'water' && map.heightAt(p.x, p.z) > 0, 'no clump on water');
    assert.ok(map.pathInfo(p.x, p.z).d >= 1.5, 'the Sendero core stays clear');
  }
  for (const hut of huts) for (const p of points) assert.ok(Math.hypot(p.x - hut.x, p.z - hut.z) - hut.r >= 1.0 - 1e-6);
});

test('layout is deterministic and the runtime path (legacy terrain source) honours the same rules', () => {
  assert.deepEqual(buildGrassPatches({ ...map, props: [...map.props].reverse() }, { shrubs }), points);
  const runtime = preserveTerrainSites(map, buildGrassPatches, { shrubs: preserveTerrainSites(map, buildShrubs, {}) });
  assert.ok(runtime.length > 800 && runtime.length <= 1000, `runtime path holds ${runtime.length} clumps`);
  assert.ok(runtime.filter((p) => p.edge).length >= 60);
  for (const p of runtime) {
    for (const f of campfires) assert.ok(Math.hypot(p.x - f.x, p.z - f.z) >= 6.5 - 1e-6);
    assert.ok(map.materialAt(p.x, p.z) !== 'water' && map.heightAt(p.x, p.z) > 0, 'no clump on water after projection');
  }
});
