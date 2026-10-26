// GM11b2 B: pure terrain tools on today's island and the same island in a rectangular base map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { revampTerrain } from '../src/sim/terrainRevamp.js';
import { GAME } from '../src/data/meta.js';
import { createDocument } from '../src/editor/document.js';
import { compileTerrainGrid, createTerrainGrid, terrainEditableMask, terrainEditWeights, terrainGridOf } from '../src/editor/terrainData.js';
import { brushParameters, strokeInfluence, strokePath } from '../src/editor/terrainBrush.js';
import { sculptTerrainGrid } from '../src/editor/terrainSculpt.js';
import { paintTerrainGrid } from '../src/editor/terrainPaint.js';
import { regionInfluence, regionTerrainGrid } from '../src/editor/terrainRegion.js';
import { decodeHeightmap, exportHeightmap, heightmapTargets, sidecarRange } from '../src/editor/terrainHeightmap.js';
import { planScatter } from '../src/editor/scatterBrush.js';

const BASE = 'terrain-s21-v1', N = 561, GX = 1121, SHIFT = 560;
const today = generateWorld(GAME.seed);
const grown = revampTerrain(today.terrainSource, { bounds: { minX: -840, maxX: 280, minZ: -280, maxZ: 280 } });
const mask = terrainEditableMask(today), share = terrainEditWeights(grown);
const shifted = k => Math.floor(k / N) * GX + k % N + SHIFT;
// The widest editable ground, away from protected places and the coast (two chamfer passes).
const center = (() => {
  const d = Float64Array.from(mask, free => free ? Infinity : 0);
  for (let pass = 0; pass < 2; pass++) for (let n = 0; n < N * N; n++) {
    const k = pass ? N * N - 1 - n : n, i = k % N, s = pass ? -1 : 1;
    if (!d[k]) continue;
    for (const [di, dj, w] of [[-1, 0, 1], [0, -1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2]]) {
      const ii = i + s * di, kk = k + s * (dj * N + di);
      if (ii >= 0 && ii < N && kk >= 0 && kk < N * N) d[k] = Math.min(d[k], d[kk] + w);
    }
  }
  let k = 0;
  for (let n = 0; n < d.length; n++) if (d[n] > d[k]) k = n;
  return { x: k % N - 280, z: Math.floor(k / N) - 280, k };
})();
const point = (dx, dz) => ({ x: center.x + dx, z: center.z + dz });
const regions = [
  { shape: 'rect', feather: 4, points: [point(-16, -16), point(16, 16)] },
  { shape: 'lasso', feather: 4, points: [point(-16, -15), point(15, -13), point(12, 16), point(-14, 11)] },
];
function input(map) {
  const grid = createTerrainGrid(terrainGridOf(map));
  // A small island peak makes smoothing and both erosions observable, including on otherwise flat ground.
  grid.deltasMm[map === today ? center.k : shifted(center.k)] = 3000;
  return { map, grid, surface: compileTerrainGrid(map, grid), baseRevision: BASE,
    document: createDocument({ seed: map.seed, baseRevision: BASE }) };
}
function apply(input, patch) {
  patch.indices.forEach((k, n) => {
    if (patch.deltasMm) input.grid.deltasMm[k] = patch.deltasMm[n];
    if (patch.weights) input.grid.weights.set(patch.weights.subarray(n * 4, n * 4 + 4), k * 4);
  });
  return input.grid;
}
function equivalent(a, b) {
  for (const [key, channels] of [['deltasMm', 1], ['weights', 4]]) for (let j = 0; j < N; j++) {
    const start = (j * GX + SHIFT) * channels;
    assert.deepEqual(b[key].subarray(start, start + N * channels), a[key].subarray(j * N * channels, (j + 1) * N * channels), `${key} row ${j}`);
    assert.ok(b[key].subarray(j * GX * channels, start).every(v => v === 0), `${key} new sea row ${j}`);
  }
}
function compare(tool, options) {
  const a = input(today), b = input(grown);
  const pa = tool({ ...a, ...options }), pb = tool({ ...b, ...options });
  assert.ok(pa.indices.length > 0, options.tool);
  assert.ok(pb.indices.length > 0, options.tool);
  equivalent(apply(a, pa), apply(b, pb));
  return pb;
}
function confined(patch, region) {
  const field = regionInfluence(region, terrainGridOf(grown));
  for (const k of patch.indices) {
    const i = k % GX, j = Math.floor(k / GX);
    assert.ok(i >= field.i0 && i <= field.i1 && j >= field.j0 && j <= field.j1);
    assert.ok(field.values[(j - field.j0) * field.width + i - field.i0] > 0);
    assert.ok(share[k] > 0, 'only editable ground changes');
  }
}

test('U1 sculpt: raise, lower, smooth, flatten and ramp keep every island vertex and leave new sea untouched', () => {
  for (const tool of ['raise', 'lower', 'smooth', 'flatten', 'ramp', 'noise']) {
    compare(sculptTerrainGrid, { tool, points: [point(-7, -3), point(9, 5)], radius: 12,
      strength: .7, falloff: .35, level: 9, seed: 733 });
  }
  compare(sculptTerrainGrid, { tool: 'raise', points: [point(0, 0), point(0, 0)], radius: 12, flow: 'airbrush' });
});

test('U2 paint strokes use rectangular rows with identical island weights', () => {
  for (const flow of ['stroke', 'airbrush']) compare(paintTerrainGrid, { tool: 'paint', material: 'rock',
    points: [point(-6, -4), point(10, 6)], radius: 14, shape: 'square', rotation: 37, flow });
});

test('U3 feathered rectangle and lasso: flatten, raise, smooth, paint and world-anchored noise', () => {
  for (const region of regions) for (const tool of ['flatten', 'raise', 'smooth', 'paint', 'noise']) {
    const patch = compare(regionTerrainGrid, { region, tool, level: 8, amount: 2, passes: 3, material: 'sand',
      amplitude: 3, scale: 16, octaves: 4, seed: 733 });
    confined(patch, region);
  }
});

test('U3 erosions: thermal and seeded hydraulic keep identical island results and stay inside editable regions', () => {
  for (const region of regions) for (const tool of ['thermal', 'hydraulic']) {
    const patch = compare(regionTerrainGrid, { region, tool, talus: 25, iterations: 10, droplets: 1000, seed: 733 });
    confined(patch, region);
  }
});

test('U4 export: rectangular PNG, sidecar origin and height round trip within one millimetre', async () => {
  const b = input(grown), compiled = compileTerrainGrid(grown, b.grid);
  const { png, sidecar } = await exportHeightmap(compiled, { baseRevision: BASE });
  assert.deepEqual([sidecar.width, sidecar.height, sidecar.origin], [GX, N, { x: -840, z: -280 }]);
  const decoded = await decodeHeightmap(png);
  assert.deepEqual([decoded.width, decoded.height, decoded.sidecar], [GX, N, sidecar]);
  const targets = heightmapTargets(decoded, sidecarRange(decoded.sidecar), terrainGridOf(grown));
  assert.equal(targets.length, GX * N);
  for (let k = 0; k < targets.length; k++) assert.ok(Math.abs(targets[k] - compiled.heights[k]) <= .001, `vertex ${k}`);
  await assert.rejects(decodeHeightmap(new Uint8Array(GX * N * 2), 'rect.r16'), error => error.code === 'r16_size');
});

test('U4 import: heightmap region and whole-map rectangle only change island ground', () => {
  const image = { width: 2, height: 2, values: Uint16Array.of(0, 32768, 65535, 8192) }, range = { min: 2, max: 12 };
  for (const region of [...regions, { shape: 'rect', feather: 0, points: [{ x: -840, z: -280 }, { x: 280, z: 280 }] }]) {
    const b = input(grown), targets = heightmapTargets(image, range, terrainGridOf(grown));
    const patch = regionTerrainGrid({ ...b, tool: 'heightmap', region, targets });
    assert.ok(patch.indices.length > 0);
    confined(patch, region);
    for (const k of patch.indices) assert.ok(k % GX >= SHIFT, 'new sea stays unchanged');
    const grid = apply(b, patch);
    for (let j = 0; j < N; j++) {
      assert.ok(grid.deltasMm.subarray(j * GX, j * GX + SHIFT).every(v => v === 0));
      assert.ok(grid.weights.subarray(j * GX * 4, (j * GX + SHIFT) * 4).every(v => v === 0));
    }
  }
});

test('U5 scatter: seed keeps placements in world coordinates on either map', () => {
  const plan = map => planScatter({ map, document: createDocument({ seed: map.seed, baseRevision: BASE }),
    assetId: 'model:decorative-palm-v1', points: [point(-8, -4), point(8, 4)],
    parameters: { radius: 12, strength: 1, spacing: 3, seed: 733 },
    metrics: { triangles: 100, primitives: 1, radius: .4 }, isAllowed: (x, z) => map.groundAt(x, z) > .75 });
  const a = plan(today), b = plan(grown);
  assert.ok(a.placements.length > 0);
  assert.equal(b.placements.length, a.placements.length);
  a.placements.forEach((p, n) => {
    const q = b.placements[n];
    assert.deepEqual([q.position.x, q.position.z, q.rotation, q.scale], [p.position.x, p.position.z, p.rotation, p.scale]);
    // The two origins round fractional interpolation coordinates differently; the base grid is identical.
    assert.ok(Math.abs(q.position.y - p.position.y) < 1e-9);
  });
  assert.deepEqual([b.candidates, b.skipped, b.cost], [a.candidates, a.skipped, a.cost]);
});

test('U6 numeric half keeps exactly the field of today for strokes and regions', () => {
  const path = strokePath([point(-7.5, -3.25), point(8.5, 5.25)]);
  for (const flow of ['stroke', 'airbrush']) for (const shape of ['circle', 'square', 'ellipse']) {
    const brush = brushParameters({ radius: 14, shape, rotation: 37, falloff: .35 });
    assert.deepEqual(strokeInfluence(path, brush, { half: 280, flow }),
      strokeInfluence(path, brush, { half: terrainGridOf(today), flow }));
  }
  for (const region of regions) assert.deepEqual(regionInfluence(region, 280), regionInfluence(region, terrainGridOf(today)));
});
