// GM08c: procedural terrain. A seeded fBm noise (brush and region) and two erosions over a region, thermal and simple
// hydraulic, on the session grid with the stroke's clip and clamps, one commit each that undo reverses whole, and a
// cost bound. No three, no docs/ or tools/: it can run in the deploy gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDocument, createDocumentHistory } from '../src/editor/document.js';
import { terrainEditableMask, terrainEditWeights, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { TerrainSession, openTerrainDocument, tileReferences } from '../src/editor/terrainSession.js';
import { regionInfluence } from '../src/editor/terrainRegion.js';
import { sculptTerrainDocument } from '../src/editor/terrainSculpt.js';
import { fbmNoise, hydraulicErosion, THERMAL_MAX_WORK, thermalErosion, thermalWork } from '../src/editor/terrainNoise.js';

const BASE = 'terrain-s21-v1';
const N = TERRAIN_GRID_SIZE;
const map = generateWorld(GAME.seed);
const mask = terrainEditableMask(map), share = terrainEditWeights(map);
const coded = (code) => (error) => error?.code === code;
const at = (field, i, j) => i < field.i0 || i > field.i1 || j < field.j0 || j > field.j1 ? 0 : field.values[(j - field.j0) * field.width + i - field.i0];
const NOISE = { amplitude: 6, octaves: 5, scale: 24, seed: 77 };

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
const WHOLE = { shape: 'rect', feather: 8, points: [{ x: -280, z: -280 }, { x: 280, z: 280 }] };

async function session() {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: createDocument({ seed: map.seed, baseRevision: BASE }) });
  const history = createDocumentHistory(opened.document, { tiles: opened.tiles });
  const terrain = new TerrainSession({ map, baseRevision: BASE, grid: opened.grid, references: tileReferences(opened.document),
    lookup: (sha256) => history.tile(sha256) });
  const edit = (options) => ({ document: history.current(), ...options });
  const commit = async (options) => {
    const result = await terrain.commit(edit(options));
    history.commit(result.document, { tiles: result.tiles });
    return result;
  };
  return { history, terrain, edit, commit };
}

// A window of heights with share 1 inside and 0 on its one-vertex border.
function windowOf(width, height) {
  const heights = new Float64Array(width * height), weights = new Float64Array(width * height);
  for (let j = 1; j < height - 1; j++) for (let i = 1; i < width - 1; i++) weights[j * width + i] = 1;
  return { heights, weights };
}

test('fbm noise: deterministic per seed, within [-1, 1], continuous, world-anchored', () => {
  let min = Infinity, max = -Infinity, sum = 0, jump = 0, n = 0;
  for (let z = -200; z <= 200; z += 1.7) for (let x = -200; x <= 200; x += 1.3) {
    const v = fbmNoise(x, z, NOISE);
    min = Math.min(min, v); max = Math.max(max, v); sum += v; n++;
    jump = Math.max(jump, Math.abs(fbmNoise(x + .01, z, NOISE) - v));
    assert.equal(fbmNoise(x, z, { ...NOISE }), v, 'same parameters, same value');
  }
  assert.ok(min >= -1 && max <= 1 && max - min > .8, `range ${min}..${max}`);
  assert.ok(Math.abs(sum / n) < .1, `mean ${sum / n}`);
  assert.ok(jump < .02, `a 1 cm step moves it by ${jump} at most`);
  let differs = 0, coarse = 0;
  for (let x = 0; x < 100; x += 3.1) {
    if (fbmNoise(x, 5.5, NOISE) !== fbmNoise(x, 5.5, { ...NOISE, seed: 78 })) differs++;
    coarse += Math.abs(fbmNoise(x, 5.5, { ...NOISE, octaves: 1 }) - fbmNoise(x + 1, 5.5, { ...NOISE, octaves: 1 }));
  }
  assert.ok(differs > 30, 'another seed draws another field');
  assert.ok(coarse < 33 * .15, 'one octave at 24 m changes slowly over 1 m');
});

test('noise over a region and as a brush: clipped, previewed as committed, undone whole', async () => {
  const { history, terrain, commit, edit } = await session();
  const before = terrain.surface().heights.slice(), deltas = terrain.grid.deltasMm.slice();
  const region = square(20, 6), field = regionInfluence(region, 280);
  const preview = terrain.preview(edit({ tool: 'noise', region, ...NOISE }));
  const result = await commit({ tool: 'noise', region, ...NOISE });
  assert.deepEqual(result.map.heights, preview.map.heights, 'the preview is the commit');
  let moved = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, w = at(field, i, j) * share[k];
    if (w === 0) { assert.equal(result.map.heights[k], before[k], 'outside the region or protected: untouched'); continue; }
    const expected = before[k] + NOISE.amplitude * fbmNoise(i - 280, j - 280, NOISE) * w;
    assert.ok(Math.abs(result.map.heights[k] - Math.max(expected, .752)) < .002, `vertex ${i},${j}`);
    if (Math.abs(result.map.heights[k] - before[k]) > 1) moved++;
  }
  assert.ok(moved > 400, `${moved} vertices moved more than 1 m`);

  // The brush adds strength x amplitude x noise at full influence; airbrush adds like raise, not like a blend.
  const centre = (deepest.z + 280) * N + deepest.x + 280, start = terrain.surface().heights[centre];
  const point = { x: deepest.x, z: deepest.z };
  const dab = terrain.preview(edit({ tool: 'noise', points: [point], radius: 8, strength: .5, falloff: 1, ...NOISE }));
  const expected = start + .5 * NOISE.amplitude * fbmNoise(deepest.x, deepest.z, NOISE);
  assert.ok(Math.abs(dab.map.heights[centre] - expected) < .002, `${dab.map.heights[centre]} vs ${expected}`);
  const held = terrain.preview(edit({ tool: 'noise', points: [point, point, point], radius: 8, strength: .5, falloff: 1, flow: 'airbrush', ...NOISE }));
  const step = NOISE.amplitude * fbmNoise(deepest.x, deepest.z, NOISE);
  assert.ok(Math.abs(held.map.heights[centre] - (start + .5 * step * .3)) < .002, 'three held dabs add 0.3 of the flow');

  terrain.sync(history.undo());
  assert.deepEqual(terrain.grid.deltasMm, deltas);
  assert.deepEqual(terrain.surface().heights, before);

  for (const bad of [{ octaves: 7 }, { octaves: 2.5 }, { scale: 2 }, { scale: 300 }, { amplitude: 0 }, { amplitude: 21 }, { seed: -1 }, { seed: 1.5 }])
    assert.throws(() => terrain.preview(edit({ tool: 'noise', region, ...NOISE, ...bad })), coded('parameters'), JSON.stringify(bad));
  assert.throws(() => terrain.preview(edit({ tool: 'noise', points: [point], ...NOISE, octaves: 0 })), coded('parameters'));
  assert.throws(() => sculptTerrainDocument({ map, document: history.current(), baseRevision: BASE, tool: 'noise', points: [point] }),
    coded('tool'), 'the sparse v3/v4 path has no noise');
});

test('thermal erosion: slopes above the talus relax, the volume is kept, share 0 never moves', () => {
  // A 10 m step across a 24 x 24 window.
  const width = 24, { heights, weights } = windowOf(width, width);
  for (let n = 0; n < heights.length; n++) heights[n] = n % width < 12 ? 20 : 10;
  const before = heights.slice(), steepest = (h) => {
    let most = 0;
    for (let j = 1; j < width - 1; j++) for (let i = 1; i < width - 2; i++) most = Math.max(most, Math.abs(h[j * width + i] - h[j * width + i + 1]));
    return most;
  };
  const volume = (h) => h.reduce((a, b) => a + b, 0);
  const few = heights.slice(), many = heights.slice();
  thermalErosion(few, weights, width, { talus: 30, iterations: 10 });
  thermalErosion(many, weights, width, { talus: 30, iterations: 200 });
  assert.ok(steepest(few) < steepest(before) / 2, `ten iterations: ${steepest(few)} m`);
  assert.ok(steepest(many) < Math.tan(Math.PI / 6) * 1.2, `two hundred iterations near the talus: ${steepest(many)} m`);
  assert.ok(Math.abs(volume(many) - volume(before)) < 1e-6, 'the total height is kept');
  for (let n = 0; n < heights.length; n++) if (!weights[n]) assert.equal(many[n], before[n], 'the border never moves');
  const steep = heights.slice();
  thermalErosion(steep, weights, width, { talus: 45, iterations: 200 });
  assert.ok(steepest(steep) > steepest(many), 'a steeper talus keeps steeper ground');

  // The cost bound: the editable island (about 35,000 vertices) takes up to about 110 iterations.
  const whole = regionInfluence(WHOLE, 280), w = Float64Array.from(whole.values, (v, n) => v * share[(Math.floor(n / whole.width) + whole.j0) * N + n % whole.width + whole.i0]);
  assert.ok(thermalWork(w, 100) <= THERMAL_MAX_WORK && thermalWork(w, 200) > THERMAL_MAX_WORK);
});

test('hydraulic erosion: seeded, carves downhill, share 0 never moves', () => {
  // A tilted plane (0.2 m per metre) with a gentle bump: the drops roll towards low x.
  const width = 48, { heights, weights } = windowOf(width, width);
  for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) heights[j * width + i] = 5 + .2 * i + .5 * Math.sin(j / 3);
  const before = heights.slice(), a = heights.slice(), b = heights.slice(), c = heights.slice();
  hydraulicErosion(a, weights, width, { droplets: 5000, seed: 9 });
  hydraulicErosion(b, weights, width, { droplets: 5000, seed: 9 });
  hydraulicErosion(c, weights, width, { droplets: 5000, seed: 10 });
  assert.deepEqual(a, b, 'the same seed gives the same result');
  assert.notDeepEqual(a, c, 'another seed gives another one');
  let lowered = 0, raised = 0, volume = 0;
  for (let n = 0; n < heights.length; n++) {
    if (!weights[n]) { assert.equal(a[n], before[n], 'the border never moves'); continue; }
    const d = a[n] - before[n]; volume += d;
    if (d < -.01) lowered++; else if (d > .01) raised++;
    assert.ok(Math.abs(d) < 3, `vertex ${n} moved ${d} m`);
  }
  assert.ok(lowered > 300 && raised > 0, `${lowered} lowered, ${raised} raised`);
  assert.ok(volume < 0, 'sediment that leaves the window is gone');
});

test('erosion over a region: one commit, previewed as committed, undone whole; thermal refused above its cost', async () => {
  const { history, terrain, commit, edit } = await session();
  // Rough ground first (noise), then erode it.
  await commit({ tool: 'noise', region: square(22), ...NOISE, amplitude: 12 });
  const rough = terrain.surface().heights.slice(), deltas = terrain.grid.deltasMm.slice();
  const region = square(18, 4), field = regionInfluence(region, 280);
  for (const parameters of [{ tool: 'thermal', talus: 25, iterations: 60 }, { tool: 'hydraulic', droplets: 4000, seed: 5 }]) {
    const preview = terrain.preview(edit({ region, ...parameters }));
    const result = await commit({ region, ...parameters });
    assert.deepEqual(result.map.heights, preview.map.heights, `${parameters.tool}: the preview is the commit`);
    let changed = 0;
    for (let k = 0; k < N * N; k++) if (result.map.heights[k] !== rough[k]) {
      const i = k % N, j = (k - i) / N;
      assert.ok(at(field, i, j) > 0 && share[k] > 0, `${parameters.tool}: vertex ${i},${j} changed outside the region`);
      assert.ok(result.map.heights[k] >= .751, 'the floor holds');
      changed++;
    }
    assert.ok(changed > 200, `${parameters.tool}: ${changed} vertices changed`);
    terrain.sync(history.undo());
    assert.deepEqual(terrain.grid.deltasMm, deltas, `${parameters.tool}: undo restores the grid`);
  }
  assert.throws(() => terrain.preview(edit({ tool: 'thermal', talus: 30, iterations: 200, region: WHOLE })), coded('cost'));
  for (const bad of [{ tool: 'thermal', talus: 20 }, { tool: 'thermal', talus: 50 }, { tool: 'thermal', iterations: 5 }, { tool: 'thermal', iterations: 12.5 },
    { tool: 'hydraulic', droplets: 500 }, { tool: 'hydraulic', droplets: 60000 }, { tool: 'hydraulic', seed: 2 ** 33 }])
    assert.throws(() => terrain.preview(edit({ region, ...bad })), coded('parameters'), JSON.stringify(bad));
  assert.throws(() => terrain.preview(edit({ tool: 'thermal', points: [{ x: deepest.x, z: deepest.z }] })), coded('tool'), 'erosion has no brush');

  // The whole island at the bounds: thermal 100 iterations and 50,000 drops (logged; CPU time, the machine is shared).
  const cpu = (run) => { const start = process.cpuUsage(); run(); const used = process.cpuUsage(start); return (used.user + used.system) / 1000; };
  const thermalMs = cpu(() => terrain.preview(edit({ tool: 'thermal', talus: 25, iterations: 100, region: WHOLE })));
  const hydraulicMs = cpu(() => terrain.preview(edit({ tool: 'hydraulic', droplets: 50000, seed: 1, region: WHOLE })));
  console.log(`# GM08c whole island: thermal x100 ${thermalMs.toFixed(0)} ms CPU, hydraulic 50,000 drops ${hydraulicMs.toFixed(0)} ms CPU`);
});
