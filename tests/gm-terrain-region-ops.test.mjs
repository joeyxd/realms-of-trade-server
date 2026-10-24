// GM08b: region operations. A rectangle or a lasso with an inner feather becomes a field over the grid; level, raise or
// lower by an amount, smooth n passes, paint and erase run over it with the stroke's clip and clamps, in one commit
// that undo reverses whole. No three, no docs/ or tools/: it can run in the deploy gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDocument, createDocumentHistory } from '../src/editor/document.js';
import { terrainEditableMask, terrainEditWeights, TERRAIN_GRID_SIZE, TERRAIN_MIN_HEIGHT } from '../src/editor/terrainData.js';
import { TerrainSession, openTerrainDocument, tileReferences } from '../src/editor/terrainSession.js';
import { REGION_MAX_POINTS, regionInfluence, regionOutline } from '../src/editor/terrainRegion.js';

const BASE = 'terrain-s21-v1';
const N = TERRAIN_GRID_SIZE;
const map = generateWorld(GAME.seed);
const mask = terrainEditableMask(map), share = terrainEditWeights(map);
const coded = (code) => (error) => error?.code === code;
const ms = (start) => performance.now() - start;
const at = (field, i, j) => i < field.i0 || i > field.i1 || j < field.j0 || j > field.j1 ? 0 : field.values[(j - field.j0) * field.width + i - field.i0];

// The editable vertex farthest from any vertex off the mask (42 m on this map): a 30 m square around it is all share 1.
const deepest = (() => {
  const d = Float64Array.from(mask, (free) => free ? Infinity : 0);
  for (let pass = 0; pass < 2; pass++) for (let n = 0; n < N * N; n++) {
    const k = pass ? N * N - 1 - n : n, i = k % N, s = pass ? -1 : 1;
    if (!d[k]) continue;
    for (const [di, dj, w] of [[-1, 0, 1], [0, -1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2]]) {
      const ii = i + s * di, kk = k + s * (dj * N + di);
      if (ii >= 0 && ii < N && kk >= 0 && kk < N * N) d[k] = Math.min(d[k], d[kk] + w);
    }
  }
  let best = 0;
  for (let k = 0; k < N * N; k++) if (d[k] > d[best]) best = k;
  return { x: best % N - 280, z: Math.floor(best / N) - 280 };
})();
const square = (r, feather = 0) => ({ shape: 'rect', feather,
  points: [{ x: deepest.x - r, z: deepest.z - r }, { x: deepest.x + r, z: deepest.z + r }] });

async function session() {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: createDocument({ seed: map.seed, baseRevision: BASE }) });
  const history = createDocumentHistory(opened.document, { tiles: opened.tiles });
  const terrain = new TerrainSession({ map, baseRevision: BASE, grid: opened.grid, references: tileReferences(opened.document),
    lookup: (sha256) => history.tile(sha256) });
  const edit = (options) => ({ document: history.current(), tool: 'flatten', ...options });
  const commit = async (options) => {
    const result = await terrain.commit(edit(options));
    history.commit(result.document, { tiles: result.tiles });
    return result;
  };
  return { history, terrain, edit, commit };
}

test('a region field: the even-odd inside, an inner feather, nothing outside the outline', () => {
  const rect = { shape: 'rect', points: [{ x: 9.5, z: 4.5 }, { x: -10.5, z: -5.5 }] };
  assert.deepEqual(regionOutline(rect), [{ x: -10.5, z: -5.5 }, { x: 9.5, z: -5.5 }, { x: 9.5, z: 4.5 }, { x: -10.5, z: 4.5 }]);
  const hard = regionInfluence(rect, 280);
  let inside = 0;
  for (const value of hard.values) { assert.ok(value === 0 || value === 1); inside += value; }
  assert.equal(inside, 20 * 10, 'columns x = -10..9, rows z = -5..4');
  const soft = regionInfluence({ ...rect, feather: 4 }, 280);
  assert.equal(at(soft, 280 - 10, 280), .15625, 'the border vertex is 1 m in: smoothstep(1/4)');
  assert.equal(at(soft, 280, 280), 1);
  for (let i = soft.i0; i <= soft.i1; i++) for (let j = soft.j0; j <= soft.j1; j++)
    assert.equal(at(soft, i, j) > 0, at(hard, i, j) > 0, 'the feather grows inwards only');
  for (let i = 280 - 10; i < 280; i++) assert.ok(at(soft, i, 280) <= at(soft, i + 1, 280), 'it rises towards the middle');

  // A concave lasso (a C shape) against a brute-force even-odd test at every vertex of its window.
  const points = [[-20, -20], [20, -20], [20, -10], [-10, -10], [-10, 10], [20, 10], [20, 20], [-20, 20]].map(([x, z]) => ({ x: x + .3, z: z + .3 }));
  const lasso = regionInfluence({ shape: 'lasso', points }, 280);
  for (let j = lasso.j0; j <= lasso.j1; j++) for (let i = lasso.i0; i <= lasso.i1; i++) {
    const x = i - 280, z = j - 280;
    let odd = false;
    for (let a = 0, b = points.length - 1; a < points.length; b = a++)
      if ((points[a].z > z) !== (points[b].z > z) && x < points[a].x + (z - points[a].z) * (points[b].x - points[a].x) / (points[b].z - points[a].z)) odd = !odd;
    assert.equal(at(lasso, i, j), odd ? 1 : 0, `vertex ${x},${z}`);
  }
  assert.equal(at(lasso, 280 + 5, 280), 0, 'the mouth of the C stays outside');

  assert.throws(() => regionInfluence({ shape: 'rect', points: points.slice(0, 3) }, 280), coded('region'));
  assert.throws(() => regionInfluence({ shape: 'lasso', points: points.slice(0, 2) }, 280), coded('region'));
  assert.throws(() => regionInfluence({ shape: 'lasso', points: Array.from({ length: REGION_MAX_POINTS + 1 }, (_, n) => ({ x: Math.cos(n), z: Math.sin(n) })) }, 280), coded('region'));
  assert.throws(() => regionInfluence({ ...rect, feather: 33 }, 280), coded('parameters'));
  assert.throws(() => regionInfluence({ shape: 'rect', points: [{ x: 0, z: 0 }, { x: 281, z: 0 }] }, 280), coded('region'));
});

test('level, raise and lower: one commit over the region, clipped to editable ground, clamped at the floor; undo whole', async () => {
  const { history, terrain, commit, edit } = await session();
  const before = terrain.surface().heights.slice(), deltas = terrain.grid.deltasMm.slice();
  const field = regionInfluence(square(15), 280), level = 5.5;
  const flat = await commit({ region: square(15), level });
  assert.equal(history.canUndo(), true);
  let levelled = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, value = at(field, i, j) * share[k];
    if (value === 1) { assert.equal(Math.round(flat.map.heights[k] * 1000), Math.round(level * 1000), 'levelled to the millimetre'); levelled++; }
    else if (value === 0) assert.equal(flat.map.heights[k], before[k], 'outside the region or protected: untouched');
  }
  assert.equal(levelled, 31 * 30, 'the whole 30 m square (rows half-open)');

  // Raise by 5 m with an 8 m feather: the middle moves 5 m, the feather less, nothing outside.
  const raised = await commit({ tool: 'raise', amount: 5, region: square(20, 8) });
  const middle = (deepest.z + 280) * N + deepest.x + 280, edge = middle + 20;
  assert.equal(Math.round((raised.map.heights[middle] - flat.map.heights[middle]) * 1000), 5000);
  const rise = raised.map.heights[edge] - flat.map.heights[edge];
  assert.ok(Math.abs(rise - 5 * .04296875) < .002, `the border vertex, 1 m in, rises 5 m x smoothstep(1/8) (${rise})`);

  // Lower by 50 m: never below 0.752 m, and nothing below the floor moves further down.
  const lowered = await commit({ tool: 'lower', amount: 50, region: square(25) });
  for (let k = 0; k < N * N; k++) if (lowered.map.heights[k] !== raised.map.heights[k])
    assert.ok(lowered.map.heights[k] >= TERRAIN_MIN_HEIGHT + .001, `vertex ${k} at ${lowered.map.heights[k]}`);

  // Each operation is one history entry: three undos give back the starting grid byte for byte.
  for (let n = 0; n < 3; n++) terrain.sync(history.undo());
  assert.equal(history.canUndo(), false);
  assert.deepEqual(terrain.grid.deltasMm, deltas);
  assert.deepEqual(terrain.surface().heights, before);

  assert.throws(() => terrain.preview(edit({ tool: 'raise', amount: 0, region: square(5) })), coded('parameters'));
  assert.throws(() => terrain.preview(edit({ tool: 'smooth', passes: 1.5, region: square(5) })), coded('parameters'));
  assert.throws(() => terrain.preview(edit({ tool: 'ramp', region: square(5) })), coded('tool'));
  assert.throws(() => terrain.preview(edit({ level: 0.5, region: square(5) })), coded('parameters'));
});

test('smooth: more passes take the ground further, inside the region only', async () => {
  const { terrain, commit, history } = await session();
  // Rough ground first: a raised square inside a larger one gives two 6 m cliffs to smooth.
  await commit({ tool: 'raise', amount: 6, region: square(8) });
  const rough = terrain.surface().heights.slice();
  const roughness = (heights) => {
    let sum = 0;
    for (let j = deepest.z + 280 - 12; j <= deepest.z + 280 + 12; j++) for (let i = deepest.x + 280 - 12; i <= deepest.x + 280 + 12; i++) {
      const k = j * N + i, lap = 4 * heights[k] - heights[k - 1] - heights[k + 1] - heights[k - N] - heights[k + N];
      sum += lap * lap;
    }
    return sum;
  };
  const one = terrain.preview({ document: history.current(), tool: 'smooth', passes: 1, region: square(14) });
  const many = terrain.preview({ document: history.current(), tool: 'smooth', passes: 12, region: square(14) });
  assert.ok(roughness(one.map.heights) < roughness(rough), 'one pass smooths');
  assert.ok(roughness(many.map.heights) < roughness(one.map.heights) / 2, 'twelve passes smooth much more');
  const field = regionInfluence(square(14), 280);
  for (let k = 0; k < N * N; k++) if (many.map.heights[k] !== rough[k]) {
    const i = k % N, j = (k - i) / N;
    assert.ok(at(field, i, j) > 0 && share[k] > 0, `vertex ${i},${j} changed outside the region`);
  }
  assert.deepEqual(terrain.surface().heights, rough, 'a preview leaves the session as it was');
});

test('paint fill and erase over a lasso; a whole-map region stays fast', async () => {
  const { terrain, commit } = await session();
  const r = 18, points = Array.from({ length: 40 }, (_, n) => ({ x: deepest.x + r * Math.cos(n * Math.PI / 20), z: deepest.z + r * Math.sin(n * Math.PI / 20) }));
  const lasso = { shape: 'lasso', points, feather: 0 };
  const painted = await commit({ tool: 'paint', material: 'rock', strength: 1, region: lasso });
  assert.ok(painted.dirtyTiles.length >= 1);
  const field = regionInfluence(lasso, 280), w = terrain.grid.weights;
  let filled = 0;
  for (let k = 0; k < N * N; k++) {
    const i = k % N, j = (k - i) / N, value = at(field, i, j) * share[k];
    const weights = [w[k * 4], w[k * 4 + 1], w[k * 4 + 2], w[k * 4 + 3]];
    if (value === 1) { assert.deepEqual(weights, [0, 0, 0, 255]); filled++; }
    else if (value === 0) assert.deepEqual(weights, [0, 0, 0, 0]);
  }
  assert.ok(filled > 900, `${filled} vertices filled with rock`);
  const erased = await commit({ tool: 'erase', strength: 1, region: lasso });
  assert.equal(erased.document.terrain.tiles.length, 0, 'erasing all the paint leaves no tile');
  assert.ok(terrain.grid.weights.every((weight) => weight === 0));

  // The whole map as a rectangle with a 32 m feather, smoothed 16 times: every editable vertex, one bounded commit.
  let start = performance.now();
  const whole = await commit({ tool: 'smooth', passes: 16, region: { shape: 'rect', feather: 32, points: [{ x: -280, z: -280 }, { x: 280, z: 280 }] } });
  const smoothMs = ms(start);
  start = performance.now();
  const level = await commit({ level: 3, region: { shape: 'rect', feather: 0, points: [{ x: -280, z: -280 }, { x: 280, z: 280 }] } });
  const levelMs = ms(start);
  const f = (n) => n.toFixed(1);
  console.log(`# GM08b whole-map region: smooth x16 ${f(smoothMs)} ms (${whole.dirtyTiles.length} tiles; stroke ${f(whole.timings.stroke)}), ` +
    `level ${f(levelMs)} ms (${level.dirtyTiles.length} tiles; stroke ${f(level.timings.stroke)})`);
  assert.ok(level.dirtyTiles.length > 20);
});
