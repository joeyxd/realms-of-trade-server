// GM08a: large terrain brushes. Radius up to 128 m with dabs spaced by the radius, strokes clipped softly to the
// editable ground instead of refused, the 0.75 m floor and +200 m ceiling as limits, the airbrush flow, and a gesture
// preview, commit and undo that rewrite only what changed. The 128 m measurement is printed as diagnostics.
// Imports three: keep it out of the deploy gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDocument, createDocumentHistory } from '../src/editor/document.js';
import { terrainEditableMask, terrainEditWeights, TERRAIN_EDIT_FEATHER, TERRAIN_GRID_SIZE, TERRAIN_MIN_HEIGHT } from '../src/editor/terrainData.js';
import { AIRBRUSH_HOLD_FLOW, brushParameters, brushWeight, strokeInfluence, strokePath, strokeSpacing,
  TERRAIN_BRUSH_MAX_RADIUS } from '../src/editor/terrainBrush.js';
import { TerrainSession, openTerrainDocument, tileKeysRegion, tileReferences } from '../src/editor/terrainSession.js';
import { sculptTerrainDocument } from '../src/editor/terrainSculpt.js';
import { createTerrain, updateTerrainGeometry } from '../src/render/terrain.js';
import { createTerrainPreview, joinRegions } from '../src/editor/terrainPreview.js';

const BASE = 'terrain-s21-v1';
const N = TERRAIN_GRID_SIZE;
const map = generateWorld(GAME.seed);
const mask = terrainEditableMask(map), share = terrainEditWeights(map);
const coded = (code) => (error) => error?.code === code;
const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const NAMES = ['position', 'normal', 'aMask', 'aPaint'];
const ms = (start) => performance.now() - start;

// The editable vertex farthest from any vertex off the mask (two chamfer passes): the widest ground to brush.
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
  return { x: best % N - 280, z: Math.floor(best / N) - 280, k: best, distance: d[best] };
})();

async function session() {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: createDocument({ seed: map.seed, baseRevision: BASE }) });
  const history = createDocumentHistory(opened.document, { tiles: opened.tiles });
  const terrain = new TerrainSession({ map, baseRevision: BASE, grid: opened.grid, references: tileReferences(opened.document),
    lookup: (sha256) => history.tile(sha256) });
  const edit = (options) => ({ document: history.current(), tool: 'raise', strength: 1, falloff: .5, radius: 8, ...options });
  const commit = async (options) => {
    const result = await terrain.commit(edit(options));
    history.commit(result.document, { tiles: result.tiles });
    return result;
  };
  return { history, terrain, edit, commit };
}

function grid() {
  const geometry = new THREE.BufferGeometry(), count = N * N;
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aMask', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
  geometry.setAttribute('aPaint', new THREE.BufferAttribute(new Uint8Array(count * 4), 4, true));
  return { geometry };
}
const uploaded = (mesh) => { for (const name of NAMES) {
  const attribute = mesh.geometry.getAttribute(name); attribute.clearUpdateRanges(); attribute.onUploadCallback();
} };
const same = (left, right) => { for (const name of NAMES)
  assert.ok(bytes(left.geometry.getAttribute(name).array).equals(bytes(right.geometry.getAttribute(name).array)), name); };

test('terrain brushes reach 128 m while scatter and the v3/v4 path keep 24 m; dabs are spaced by the radius', () => {
  assert.equal(TERRAIN_BRUSH_MAX_RADIUS, 128);
  assert.equal(brushParameters({ radius: 128 }, { maxRadius: TERRAIN_BRUSH_MAX_RADIUS }).radius, 128);
  assert.throws(() => brushParameters({ radius: 128.5 }, { maxRadius: TERRAIN_BRUSH_MAX_RADIUS }), TypeError);
  assert.throws(() => brushParameters({ radius: 25 }), TypeError, 'the default cap stays 24 m');
  const document = createDocument({ seed: map.seed, baseRevision: BASE });
  assert.throws(() => sculptTerrainDocument({ map, document, baseRevision: BASE, tool: 'raise', points: [deepest], radius: 30 }),
    coded('parameters'), 'the sparse v3/v4 path keeps its 24 m');
  assert.equal(strokeSpacing(2), .5);
  assert.equal(strokeSpacing(6), .5);
  assert.equal(strokeSpacing(120), 10);
  const points = [{ x: 0, z: 0 }, { x: 33, z: 4 }, { x: 33, z: 4 }];
  assert.deepEqual(strokePath(points), strokePath(points, .5), 'the default spacing is unchanged');
  const path = strokePath(points, 10);
  assert.deepEqual(path[0], points[0]); assert.deepEqual(path.at(-1), points.at(-1));
  for (let n = 1; n < path.length; n++) assert.ok(Math.hypot(path[n].x - path[n - 1].x, path[n].z - path[n - 1].z) <= 10 + 1e-9);
  assert.throws(() => strokePath(points, .25), TypeError);
});

test('stroke influence: the strongest dab per vertex, or the airbrush sum of travel over the radius and hold dabs', () => {
  const brush = brushParameters({ radius: 8, falloff: .3 }), half = 280;
  const path = strokePath([{ x: 3, z: 2 }, { x: 20, z: 9 }], strokeSpacing(8));
  const field = strokeInfluence(path, brush, { half });
  for (const [i, j] of [[283, 282], [290, 287], [299, 290], [275, 280], [310, 300]]) {
    const n = (j - field.j0) * field.width + i - field.i0;
    const expected = Math.max(0, ...path.map((c) => brushWeight(i - half - c.x, j - half - c.z, brush)));
    assert.equal(i >= field.i0 && i <= field.i1 && j >= field.j0 && j <= field.j1 ? field.values[n] : 0, expected, `${i},${j}`);
  }
  const twice = strokeInfluence([...path, ...path.slice().reverse()], brush, { half });
  assert.deepEqual(twice.values, field.values, 'a second pass adds nothing to a single-pass stroke');
  const at = (result, i, j) => result.values[(j - result.j0) * result.width + i - result.i0];
  const one = strokeInfluence([{ x: 0, z: 0 }], brush, { half, flow: 'airbrush' });
  const held = strokeInfluence(strokePath([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }]), brush, { half, flow: 'airbrush' });
  assert.equal(at(one, 280, 280), AIRBRUSH_HOLD_FLOW);
  assert.ok(Math.abs(at(held, 280, 280) - 3 * AIRBRUSH_HOLD_FLOW) < 1e-12, 'each hold dab adds its flow');
  const pass = strokeInfluence(path, brush, { half, flow: 'airbrush' });
  const back = strokeInfluence([...path, ...path.slice(1).reverse()], brush, { half, flow: 'airbrush' });
  assert.ok(at(back, 290, 285) > at(pass, 290, 285) * 1.8, 'an airbrush pass back adds about as much again');
  assert.throws(() => strokeInfluence(path, brush, { half, flow: 'spray' }), TypeError);
});

test('edit weights: zero off the editable mask, one from the feather distance on, a smooth rise in between', () => {
  let full = 0, partial = 0;
  for (let k = 0; k < N * N; k++) {
    if (!mask[k]) { assert.equal(share[k], 0); continue; }
    assert.ok(share[k] > 0 && share[k] <= 1);
    if (share[k] === 1) full++; else partial++;
  }
  assert.ok(full > 0 && partial > 0);
  assert.equal(share[deepest.k], 1);
  assert.ok(deepest.distance > 20, `the widest editable ground is ${deepest.distance.toFixed(1)} m from protection`);
  // Walk from the deepest vertex to the first vertex off the mask: the last editable one takes a small share.
  let previous = 1, i = deepest.k % N;
  const j = Math.floor(deepest.k / N);
  for (; mask[j * N + i]; i++) previous = share[j * N + i];
  assert.ok(previous > 0 && previous < .5, `the last editable vertex before protection takes ${previous.toFixed(2)} (feather ${TERRAIN_EDIT_FEATHER} m)`);
  assert.strictEqual(terrainEditWeights(map), share, 'cached per base map');
});

test('a 128 m raise dragged 300 m: clipped to the editable ground, valid tiles, measured end to end', async (t) => {
  const { history, terrain, edit } = await session();
  const x0 = Math.max(-270, deepest.x - 100), points = [];
  for (let x = x0; x <= Math.min(270, x0 + 300); x += strokeSpacing(128)) points.push({ x, z: deepest.z });
  const stroke = edit({ radius: 128, points });
  let start = performance.now();
  const preview = terrain.preview(stroke);
  const previewMs = ms(start);
  const before = terrain.surface();
  start = performance.now();
  const result = await terrain.commit(stroke);
  const commitMs = ms(start);
  history.commit(result.document, { tiles: result.tiles });
  let changed = 0;
  for (let k = 0; k < N * N; k++) {
    if (result.map.heights[k] === before.heights[k]) continue;
    changed++;
    if (!mask[k]) assert.fail(`vertex ${k} off the editable mask was raised`);
  }
  assert.ok(changed > 10000, `${changed} vertices raised`);
  assert.ok(Math.abs(result.map.heights[deepest.k] - before.heights[deepest.k] - 1) < 2e-3, 'full strength at the widest ground');
  assert.equal(preview.region.i0, result.region.i0);
  assert.equal(preview.region.j1, result.region.j1);

  const mesh = grid(); updateTerrainGeometry(mesh, before); uploaded(mesh);
  start = performance.now(); updateTerrainGeometry(mesh, result.map, { region: result.region }); const regionMs = ms(start);
  const whole = grid(); start = performance.now(); updateTerrainGeometry(whole, result.map); const wholeMs = ms(start);
  same(mesh, whole);

  // Undo decodes only the rewritten tiles; their bounds cover every vertex the undo changes.
  start = performance.now();
  const rewritten = terrain.sync(history.undo()), undone = terrain.surface();
  const undoMs = ms(start), region = tileKeysRegion(rewritten);
  for (let k = 0; k < N * N; k++) if (undone.heights[k] !== result.map.heights[k]) {
    const i = k % N, j = (k - i) / N;
    assert.ok(i >= region.i0 && i <= region.i1 && j >= region.j0 && j <= region.j1, `vertex ${i},${j} outside the undo region`);
  }
  const { timings } = result, f = (n) => n.toFixed(1);
  t.diagnostic(`128 m raise over ${points.length} points (300 m): ${changed} vertices in ${result.dirtyTiles.length} tiles; preview ${f(previewMs)} ms, ` +
    `commit ${f(commitMs)} ms (stroke ${f(timings.stroke)}, validate ${f(timings.validate)}, compile ${f(timings.compile)}, ` +
    `encode ${f(timings.encode)}, hash ${f(timings.hash)}); render region ${f(regionMs)} ms ` +
    `(${result.region.i1 - result.region.i0 + 1} x ${result.region.j1 - result.region.j0 + 1}) vs whole ${f(wholeMs)} ms; undo sync + compile ${f(undoMs)} ms`);
});

test('lowering and smoothing stop at the 0.75 m floor and never lift ground already below it', async () => {
  const { terrain, commit } = await session();
  // An editable vertex on low ground: the brush reaches the floor long before it runs out of strength.
  let low = null;
  for (let k = 0; k < N * N && !low; k++) if (share[k] >= .9 && map.heights[k] < 2) low = { x: k % N - 280, z: Math.floor(k / N) - 280, k };
  assert.ok(low, 'low editable ground exists');
  const before = terrain.surface().heights.slice();
  const held = Array.from({ length: 40 }, () => ({ x: low.x, z: low.z }));
  const result = await commit({ tool: 'lower', radius: 24, flow: 'airbrush', points: held });
  let lowered = 0;
  for (let k = 0; k < N * N; k++) {
    const after = result.map.heights[k];
    if (after === before[k]) continue;
    assert.ok(after < before[k], `vertex ${k} rose from ${before[k]} to ${after}`);
    assert.ok(after >= TERRAIN_MIN_HEIGHT, `vertex ${k} went below the floor: ${after}`);
    lowered++;
  }
  assert.ok(lowered > 0);
  assert.ok(result.map.heights[low.k] < TERRAIN_MIN_HEIGHT + .01, `the centre sits on the floor: ${result.map.heights[low.k]}`);
  const smooth = await commit({ tool: 'smooth', radius: 24, strength: 1, points: [low] });
  for (let k = 0; k < N * N; k++) assert.ok(smooth.map.heights[k] >= Math.min(result.map.heights[k], TERRAIN_MIN_HEIGHT));
});

test('the airbrush builds up: a held raise grows with each tick, a held flatten nears its level without passing it', async () => {
  const { terrain, edit } = await session(), at = { x: deepest.x, z: deepest.z };
  const height = (options) => terrain.preview(edit(options)).map.heights[deepest.k];
  const base = terrain.surface().heights[deepest.k];
  const once = height({ flow: 'airbrush', strength: .5, points: [at] }) - base;
  const four = height({ flow: 'airbrush', strength: .5, points: [at, at, at, at] }) - base;
  assert.ok(Math.abs(once - .5 * AIRBRUSH_HOLD_FLOW) < 2e-3, `one hold dab raises ${once}`);
  assert.ok(Math.abs(four - 4 * once) < 2e-3, `four hold dabs raise ${four}`);
  assert.ok(Math.abs(height({ points: [at, at, at, at], strength: .5 }) - base - .5) < 2e-3, 'a single-pass stroke raises its strength once');
  const level = base + 6, flatten = (n) => height({ tool: 'flatten', flow: 'airbrush', strength: 1, level, points: Array(n).fill(at) });
  const steps = [1, 10, 60].map(flatten);
  assert.ok(steps[0] < steps[1] && steps[1] < steps[2] && steps[2] <= level + 1e-3, steps.join(' < '));
  assert.ok(level - steps[2] < .02, 'held long enough it reaches the level');
});

test('a gesture preview rewrites only what changed; the commit after it and an undo equal a whole rewrite', async () => {
  const { history, terrain, edit } = await session(), at = { x: deepest.x, z: deepest.z };
  const base = createTerrain(map, { segments: 2, assetRegistry: { texture: () => null } });
  const scene = new THREE.Scene(); scene.add(base);
  const view = createTerrainPreview({ scene, map });
  const settle = () => { for (const name of NAMES) base.geometry.getAttribute(name).clearUpdateRanges(); };
  const first = await terrain.commit(edit({ radius: 6, points: [at] }));
  history.commit(first.document, { tiles: first.tiles });
  view.apply(first.map, { region: first.region }); settle();
  const position = base.geometry.getAttribute('position');
  assert.equal(position.count, N * N, 'the first projection built the grid');

  // The gesture as TerrainInteraction runs it: each render joins the gesture's regions, from the map shown last.
  const gesture = { region: null, shown: null };
  const render = (map, region) => {
    gesture.region = joinRegions(gesture.region, region);
    view.apply(map, { region: gesture.shown ? { ...gesture.region, from: gesture.shown } : region });
    gesture.shown = map;
  };
  const a = { x: at.x - 10, z: at.z }, b = { x: at.x + 10, z: at.z };
  const one = terrain.preview(edit({ radius: 24, points: [a] }));
  render(one.map, one.region);
  const rowsOne = position.updateRanges.length; settle();
  const two = terrain.preview(edit({ radius: 24, points: [a, b] }));
  render(two.map, two.region);
  const rowsTwo = position.updateRanges.length, columnsTwo = position.updateRanges[0]?.count / 3; settle();
  assert.ok(rowsOne > 0 && rowsTwo > 0);
  assert.ok(columnsTwo < gesture.region.i1 - gesture.region.i0 + 1,
    `the second frame rewrites ${columnsTwo} columns of the gesture's ${gesture.region.i1 - gesture.region.i0 + 1}: only around the new dabs`);
  const wholeTwo = grid(); updateTerrainGeometry(wholeTwo, two.map);
  same(base, wholeTwo);

  const committed = await terrain.commit(edit({ radius: 24, points: [a, b] }));
  history.commit(committed.document, { tiles: committed.tiles });
  render(committed.map, committed.region);
  assert.equal(position.updateRanges.length, 0, 'the commit after its preview has nothing left to upload');
  assert.strictEqual(view.map, committed.map);

  const rewritten = terrain.sync(history.undo());
  view.apply(terrain.surface(), { region: { ...tileKeysRegion(rewritten), from: view.map } });
  assert.ok(position.updateRanges.length > 0 && position.updateRanges.length < N, 'the undo rewrites only its tiles');
  const wholeUndo = grid(); updateTerrainGeometry(wholeUndo, terrain.surface());
  same(base, wholeUndo);
  view.dispose();
});
