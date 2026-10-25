// GM11b2 part A (docs/briefs/gm11-world-growth-zones.md, GM11b design): the editor's dense grid, tiles and session read
// the base map's bounds. A 16 x 8 tile base map (x -840..280, z -280..280) behaves as today's island shifted by 560
// columns, and today's 561 square is unchanged. Pure: no three, no render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { revampTerrain } from '../src/sim/terrainRevamp.js';
import { GAME } from '../src/data/meta.js';
import { createDocument } from '../src/editor/document.js';
import { compileTerrainGrid, compileTerrainMap, createTerrainGrid, terrainEditableMask, terrainEditWeights, terrainGridOf,
  validateTerrainForMap, validateTerrainGrid, validateTerrainGridForMap } from '../src/editor/terrainData.js';
import { gridToTiles, terrainTileRange, tilesToGrid } from '../src/editor/terrainTiles.js';
import { openTerrainDocument } from '../src/editor/terrainSession.js';

const BASE = 'terrain-s21-v1';
const DOMAIN = Object.freeze({ minX: -840, maxX: 280, minZ: -280, maxZ: 280, cell: 1 });
const today = generateWorld(GAME.seed);
const grown = revampTerrain(today.terrainSource, { bounds: { minX: -840, maxX: 280, minZ: -280, maxZ: 280 } });
const N = 561, GX = 1121, SHIFT = 560;
const shifted = k => { const i = k % N, j = (k - i) / N; return j * GX + i + SHIFT; };
const coded = code => error => error?.code === code;

// Island edits: every 37th editable vertex of today's mask, a height delta and a paint weight on alternate ones.
const mask = terrainEditableMask(today);
const edits = [];
for (let k = 0, n = 0; k < mask.length; k++) if (mask[k] && n++ % 37 === 0) edits.push(k);
function fill(grid, index) {
  edits.forEach((k, n) => {
    const at = index(k);
    if (n % 2 === 0) grid.deltasMm[at] = 400 + n % 5 * 100;
    else grid.weights[at * 4 + n % 4] = 120 + n % 3 * 40;
  });
  return grid;
}
const todayGrid = () => fill(createTerrainGrid(), k => k);
const grownGrid = () => fill(createTerrainGrid({ Nx: GX, Nz: N }), shifted);

test('terrainGridOf reads the bounds of today and of a grown map, and refuses a map it cannot index', () => {
  assert.deepEqual({ ...terrainGridOf(today) }, { minX: -280, maxX: 280, minZ: -280, maxZ: 280, Nx: N, Nz: N, count: 314721 });
  assert.ok(Object.isFrozen(terrainGridOf(today)));
  assert.deepEqual({ ...terrainGridOf(grown) }, { minX: -840, maxX: 280, minZ: -280, maxZ: 280, Nx: GX, Nz: N, count: GX * N });
  for (const key of ['half', 'size', 'N', 'mapSpan']) assert.ok(!Object.hasOwn(grown, key));
  const bad = [{ ...today, res: 2 }, { ...today, heights: new Float32Array(10) },
    { heights: today.heights, Nx: N, Nz: N, res: 1, bounds: { minX: -280.5, maxX: 279.5, minZ: -280, maxZ: 280 } }];
  for (const map of bad) assert.throws(() => terrainGridOf(map), coded('base_map'));
});

test('the editable mask and edit weights of a grown map are today\'s shifted, and nothing in the new sea', () => {
  const grownMask = terrainEditableMask(grown), weights = terrainEditWeights(today), grownWeights = terrainEditWeights(grown);
  assert.equal(grownMask.length, GX * N);
  const inSquare = new Uint8Array(GX * N);
  for (let k = 0; k < N * N; k++) {
    const g = shifted(k); inSquare[g] = 1;
    assert.equal(grownMask[g], mask[k]); assert.equal(grownWeights[g], weights[k]);
  }
  for (let g = 0; g < GX * N; g++) if (!inSquare[g]) { assert.equal(grownMask[g], 0); assert.equal(grownWeights[g], 0); }
});

test('the same island edits compile to the same terrain on both maps', () => {
  assert.ok(edits.length > 100);
  const a = todayGrid(), b = grownGrid();
  validateTerrainGridForMap(today, a); validateTerrainGridForMap(grown, b);
  const ca = compileTerrainGrid(today, a), cb = compileTerrainGrid(grown, b);
  assert.equal(ca.gmTerrain, true); assert.equal(cb.gmTerrain, true);
  assert.equal(ca.fullsegments, 560); assert.ok(!Object.hasOwn(cb, 'fullsegments'));
  assert.deepEqual(cb.bounds, grown.bounds); assert.equal(cb.Nx, GX);
  const inSquare = new Uint8Array(GX * N);
  for (let k = 0; k < N * N; k++) { inSquare[shifted(k)] = 1; assert.equal(cb.heights[shifted(k)], ca.heights[k]); }
  for (let g = 0; g < GX * N; g++) if (!inSquare[g]) assert.equal(cb.heights[g], grown.heights[g]);
  // Between vertices the two origins (-280, -840) round x - minX differently, so heights agree to 1e-9 m there.
  const near = (p, q) => assert.ok(Math.abs(p - q) < 1e-9, `${p} vs ${q}`);
  for (const k of edits.slice(0, 40)) {
    const x = k % N - 280, z = Math.floor(k / N) - 280;
    assert.equal(cb.groundAt(x, z), ca.groundAt(x, z));
    near(cb.groundAt(x + .3, z + .6), ca.groundAt(x + .3, z + .6));
    assert.equal(cb.materialAt(x + .25, z + .5), ca.materialAt(x + .25, z + .5));
    cb.materialWeightsAt(x + .25, z + .5).forEach((w, c) => near(w, ca.materialWeightsAt(x + .25, z + .5)[c]));
  }
});

test('a grown grid keeps its outer ring untouched and must match the base map shape', () => {
  for (const at of [100 * GX, 100 * GX + GX - 1, 300, (N - 1) * GX + 300]) {
    const grid = createTerrainGrid({ Nx: GX, Nz: N }); grid.deltasMm[at] = 100;
    assert.throws(() => validateTerrainGrid(grid), coded('grid_edge'));
  }
  assert.throws(() => compileTerrainGrid(grown, todayGrid()), coded('grid'));
  assert.throws(() => validateTerrainGridForMap(grown, todayGrid()), coded('grid'));
  assert.throws(() => compileTerrainGrid(today, grownGrid()), coded('grid'));
  // An edit in the new open sea is protected ground, as today's sea is.
  const sea = createTerrainGrid({ Nx: GX, Nz: N }); sea.deltasMm[280 * GX + 140] = 500;
  assert.throws(() => validateTerrainGridForMap(grown, sea), coded('protected_ground'));
});

test('tiles round trip on a 16 x 8 domain, and the island keeps its tile keys and bytes', async () => {
  assert.deepEqual({ ...terrainTileRange(DOMAIN) }, { txMin: -12, txMax: 3, tzMin: -4, tzMax: 3 });
  const b = grownGrid(), tiled = await gridToTiles(b, DOMAIN);
  const back = tilesToGrid(tiled, DOMAIN);
  assert.equal(back.Nx, GX); assert.equal(back.Nz, N);
  assert.deepEqual(back.deltasMm, b.deltasMm); assert.deepEqual(back.weights, b.weights);
  assert.deepEqual(tiled.tiles, (await gridToTiles(todayGrid(), BASE)).tiles);
  assert.throws(() => terrainTileRange({ ...DOMAIN, minX: -839 }), coded('domain'));
  assert.throws(() => terrainTileRange({ ...DOMAIN, cell: 2 }), coded('domain'));
  await assert.rejects(gridToTiles(b, BASE), coded('domain_grid'));
  await assert.rejects(gridToTiles(todayGrid(), DOMAIN), coded('domain_grid'));
});

test('terrain v3/v4 sample documents stay on today\'s square', () => {
  const terrain = { version: 1, samples: [[edits[0], 500]] };
  assert.throws(() => compileTerrainMap(grown, terrain), coded('base_map'));
  assert.throws(() => validateTerrainForMap(grown, terrain), coded('base_map'));
  validateTerrainForMap(today, terrain);
  assert.equal(compileTerrainMap(today, terrain).heights[edits[0]], Math.fround(today.heights[edits[0]] + .5));
});

test('a terrain session opens on a grown map only with its own domain', async () => {
  const document = createDocument({ seed: today.seed, baseRevision: BASE });
  const opened = await openTerrainDocument({ map: grown, baseRevision: DOMAIN, document });
  assert.equal(opened.grid.Nx, GX); assert.equal(opened.grid.Nz, N);
  await assert.rejects(openTerrainDocument({ map: grown, baseRevision: BASE, document }), coded('domain_grid'));
  const square = await openTerrainDocument({ map: today, baseRevision: BASE, document });
  assert.equal(square.grid.deltasMm.length, N * N);
});
