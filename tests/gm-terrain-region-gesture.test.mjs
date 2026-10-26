// GM08b: the region gesture as the editor runs it. TerrainInteraction against a stub editor: a rectangle drag, a lasso
// that thins itself out past 256 points, the outline on the ground, one commit on release, and the level eyedropper.
// Imports three (through the interaction): keep it out of the deploy gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDocument, createDocumentHistory } from '../src/editor/document.js';
import { terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { TerrainSession, openTerrainDocument, tileReferences } from '../src/editor/terrainSession.js';
import { REGION_MAX_POINTS } from '../src/editor/terrainRegion.js';
import { exportHeightmap } from '../src/editor/terrainHeightmap.js';

globalThis.window ||= { addEventListener() {}, removeEventListener() {} };
const { TerrainInteraction } = await import('../src/editor/terrainInteraction.js');

const BASE = 'terrain-s21-v1';
const N = TERRAIN_GRID_SIZE;
const map = generateWorld(GAME.seed);
// The editable vertex farthest from protection (42 m on this map): every gesture below stays on share-1 ground.
const centre = (() => {
  const d = Float64Array.from(terrainEditableMask(map), (free) => free ? Infinity : 0);
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

async function rig() {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: createDocument({ seed: map.seed, baseRevision: BASE }) });
  const history = createDocumentHistory(opened.document, { tiles: opened.tiles });
  const terrain = new TerrainSession({ map, baseRevision: BASE, grid: opened.grid, references: tileReferences(opened.document),
    lookup: (sha256) => history.tile(sha256) });
  const statuses = [], renders = [];
  let hit = { x: centre.x, z: centre.z };
  const editor = {
    scene: new THREE.Scene(), map, draftMap: map, active: true, pointerInside: true, terrain, history, terrainTask: null,
    cameraController: { disable() {}, enable() {} }, canvas: { focus() {} }, transform: {},
    _terrainHits: () => [{ point: { x: hit.x, y: 0, z: hit.z } }], _clearGhost() {}, _cancelTransform() {}, select() {},
    _setStatus: (message, kind) => statuses.push([kind, message.en + ' | ' + message.es]), invalidate() {},
    _renderDocument: (document, options = {}) => renders.push(options), _terrainSurface: (document) => terrain.surfaceFor(document),
    async _commitTerrainStroke(edit) {
      try {
        const result = await terrain.commit(edit);
        history.commit(result.document, { tiles: result.tiles }); editor.draftMap = result.map;
        return true;
      } catch (error) { editor.lastError = error; return false; }
    },
  };
  const panel = { tool: null, picking: false, level: 2.4, values: { selection: 'brush', feather: 0, amount: 3, passes: 2 },
    render() {}, parameters() {
      return { tool: this.tool, radius: 6, strength: .5, falloff: .5, level: this.level, material: 'grass', shape: 'circle',
        aspect: .5, rotation: 0, flow: 'stroke', ...this.values };
    } };
  const interaction = new TerrainInteraction(editor, panel);
  const event = { button: 0, preventDefault() {}, stopImmediatePropagation() {} };
  const pointer = (x, z) => { hit = { x, z }; interaction.move(); };
  return { interaction, panel, editor, history, statuses, renders, event, pointer };
}

test('a rectangle drag previews through the gesture, draws its outline on the ground and commits once on release', async () => {
  const { interaction, panel, history, statuses, renders, event, pointer, editor } = await rig();
  panel.values.selection = 'rect'; interaction.select('raise');
  assert.match(statuses.at(-1)[1], /Rectangle|Rectángulo/);
  pointer(centre.x - 10, centre.z - 6);
  assert.equal(interaction.down(event), true);
  assert.equal(renders.length, 0, 'no preview of an empty rectangle');
  pointer(centre.x + 10, centre.z + 6);
  assert.deepEqual(interaction.stroke.points.map(({ x, z }) => [x - centre.x, z - centre.z]), [[-10, -6], [10, 6]]);
  const outline = interaction.cursor.geometry.getAttribute('position');
  assert.ok(outline.count >= 32, `the outline follows the ground (${outline.count} vertices)`);
  interaction.lastPreview = 0; interaction.update();
  assert.equal(renders.at(-1).preview, true);
  assert.ok(renders.at(-1).region, 'the preview renders through a region');
  const before = history.current();
  await interaction.finish();
  assert.notEqual(history.current(), before);
  assert.equal(history.canUndo(), true);
  const raised = editor.draftMap.heights[(centre.z + 280) * 561 + centre.x + 280] - map.heights[(centre.z + 280) * 561 + centre.x + 280];
  assert.ok(Math.abs(raised - 3) < .002, `the middle rises by the amount (${raised})`);
  assert.match(statuses.at(-1)[1], /Region kept|Región conservada/);
  history.undo();
  assert.equal(history.canUndo(), false, 'one history entry');
});

test('GM08c: an erosion drag shows only its outline, runs once on release, and says so when its cost is refused', async () => {
  const { interaction, panel, history, statuses, renders, event, pointer } = await rig();
  panel.values.selection = 'rect'; panel.values.droplets = 2000; panel.values.seed = 3; interaction.select('hydraulic');
  pointer(centre.x - 15, centre.z - 15);
  interaction.down(event);
  pointer(centre.x + 15, centre.z + 15);
  interaction.lastPreview = 0; interaction.update();
  assert.equal(renders.length, 0, 'no preview while dragging an erosion');
  assert.equal(interaction.cursor.visible, true, 'the outline is drawn');
  const before = history.current();
  await interaction.finish();
  assert.notDeepEqual(history.current(), before, 'one commit on release');
  assert.match(statuses.at(-1)[1], /Region kept|Región conservada/);

  // The whole map at 200 iterations is over the thermal cost bound: nothing saved, a message that says why.
  panel.values.talus = 25; panel.values.iterations = 200; interaction.select('thermal');
  pointer(-280, -280); interaction.down(event); pointer(280, 280);
  const kept = history.current();
  await interaction.finish();
  assert.deepEqual(history.current(), kept, 'nothing saved');
  assert.equal(statuses.at(-1)[0], 'error');
  assert.match(statuses.at(-1)[1], /Erosion refused: the area is too large/);
});

test('a lasso thins itself out past 256 points, and a lasso of fewer than 3 points saves nothing', async () => {
  const { interaction, panel, history, statuses, event, pointer } = await rig();
  panel.values.selection = 'lasso'; interaction.select('lower');
  // Four laps of a 15 m circle: about 300 points at a metre apart or more.
  pointer(centre.x + 15, centre.z);
  interaction.down(event);
  for (let n = 1; n <= 1200; n++) { const a = n / 300 * Math.PI * 2; pointer(centre.x + 15 * Math.cos(a), centre.z + 15 * Math.sin(a)); }
  const count = interaction.stroke.points.length;
  assert.ok(count >= 3 && count <= REGION_MAX_POINTS, `${count} points`);
  assert.equal(interaction.stroke.spacing, 2, 'the spacing doubled once');
  await interaction.finish();
  assert.equal(history.canUndo(), true);

  pointer(centre.x, centre.z); interaction.down(event); pointer(centre.x + 3, centre.z);
  assert.equal(interaction.stroke.points.length, 2);
  await interaction.finish();
  assert.match(statuses.at(-1)[1], /Lasso too small|Lazo demasiado/);
  history.undo();
  assert.equal(history.canUndo(), false, 'only the first lasso reached history');
});

test('the eyedropper sets the level from the ground under the cursor; Escape (cancel) ends picking', async () => {
  const { interaction, panel, event, pointer, editor } = await rig();
  panel.values.selection = 'brush'; interaction.select('flatten');
  panel.picking = true;
  pointer(centre.x + .5, centre.z + .5);
  interaction.down(event);
  assert.equal(panel.picking, false);
  assert.equal(panel.level, Math.round(editor.draftMap.heightAt(centre.x + .5, centre.z + .5) * 100) / 100);
  assert.equal(interaction.stroke, null, 'picking starts no stroke');
  panel.picking = true;
  assert.equal(interaction.cancel(), true, 'Escape ends picking before it deselects the tool');
  assert.equal(panel.picking, false);
});

test('a drawn region stays selected: level, then smooth, then paint run on it without drawing it again', async () => {
  const { interaction, panel, history, statuses, event, pointer, editor } = await rig();
  const k = (centre.z + 280) * 561 + centre.x + 280;
  panel.values.selection = 'rect'; interaction.select('flatten'); panel.level = 3.5;
  pointer(centre.x - 8, centre.z - 8); interaction.down(event); pointer(centre.x + 8, centre.z + 8);
  await interaction.finish();
  assert.equal(interaction.held?.shape, 'rect');
  assert.equal(panel.held, 256, 'the panel shows the held area in m2');
  assert.match(statuses.at(-1)[1], /stays selected|sigue seleccionada/);
  assert.ok(interaction.heldLine.visible, 'the held outline stays on the ground');
  assert.ok(Math.abs(editor.draftMap.heights[k] - 3.5) < .002, 'levelled');

  interaction.select('smooth');
  assert.ok(interaction.held, 'a change of tool keeps the region');
  assert.match(statuses.at(-1)[1], /Region selected|Región seleccionada/);
  panel.values.passes = 2;
  assert.equal(await interaction.apply(), true);
  interaction.select('paint');
  assert.equal(await interaction.apply(), true);
  assert.ok(editor.terrain.grid.weights[k * 4] > 0, 'the region took the paint');
  for (let n = 0; n < 3; n++) history.undo();
  assert.equal(history.canUndo(), false, 'three operations, three undo entries');

  // A click without a drag never replaces the held region; drawing a real one does.
  const held = interaction.held;
  pointer(centre.x, centre.z); interaction.down(event); await interaction.finish();
  assert.equal(interaction.held, held);
  pointer(centre.x - 3, centre.z - 3); interaction.down(event); pointer(centre.x + 3, centre.z + 2); await interaction.finish();
  assert.equal(interaction.held.area, 30);

  assert.equal(interaction.release(), true, 'Escape drops the held region');
  assert.equal(interaction.held, null); assert.equal(panel.held, null); assert.equal(interaction.heldLine.visible, false);
  assert.equal(interaction.release(), false, 'then Escape leaves the tool');
  assert.equal(interaction.apply(), null, 'nothing to apply');

  pointer(centre.x - 3, centre.z - 3); interaction.down(event); pointer(centre.x + 3, centre.z + 3); await interaction.finish();
  panel.values.selection = 'brush'; interaction.select('paint');
  assert.equal(interaction.held, null, 'the brush area drops the region');
  panel.values.selection = 'lasso'; interaction.select('raise');
  pointer(centre.x - 3, centre.z - 3); interaction.down(event); pointer(centre.x + 3, centre.z + 3); await interaction.finish();
  interaction.select(null);
  assert.equal(interaction.held, null, 'leaving the terrain tools drops the region');
});

test('GM08d: a heightmap file levels the whole map, or the held region, in one commit; our export carries its range', async () => {
  const { interaction, panel, history, statuses, editor } = await rig();
  const k = (centre.z + 280) * 561 + centre.x + 280, far = (centre.z + 280 + 30) * 561 + centre.x + 280 + 30;
  const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => new TextDecoder().decode(bytes) });
  Object.assign(panel, { feather: 0, importMin: 0, importMax: 12, render() {} });

  // A foreign .r16 maps black and white to the panel's heights; no tool and no region: the whole map.
  const white = new Uint8Array(18).fill(255);
  assert.equal(await interaction.importHeightmap([file('Landscape.r16', white)]), true);
  assert.ok(Math.abs(editor.draftMap.heights[k] - 12) < .002, `levelled to white (${editor.draftMap.heights[k]})`);
  assert.match(statuses.at(-1)[1], /whole map|todo el mapa/);
  assert.equal(statuses.at(-1)[0], 'ok');

  // Our export brings its own range (into the panel) and comes back within a millimetre.
  const { png } = await exportHeightmap(map, { baseRevision: BASE });
  assert.equal(await interaction.importHeightmap([file('isla-heightmap.png', png)]), true);
  assert.equal(panel.importMin, -7.5);
  assert.ok(Math.abs(editor.draftMap.heights[k] - map.heights[k]) <= .001, 'back to the base height');
  history.undo(); history.undo();
  assert.equal(history.canUndo(), false, 'one undo entry per import');

  // The panel keeps the last range used (the export's) until the GM changes it; a held region limits the import.
  assert.equal(await interaction.importHeightmap([file('Landscape.r16', white)]), true);
  assert.ok(Math.abs(editor.draftMap.heights[k] - Math.min(map.heights.reduce((a, b) => Math.max(a, b)), 199.998)) < .002, 'white is the export\'s highest');
  history.undo();
  Object.assign(panel, { importMin: 0, importMax: 12 });
  interaction._hold('rect', [{ x: centre.x - 5, z: centre.z - 5 }, { x: centre.x + 5, z: centre.z + 5 }]);
  assert.equal(await interaction.importHeightmap([file('Landscape.r16', white)]), true);
  assert.ok(Math.abs(editor.draftMap.heights[k] - 12) < .002, 'inside the region it reaches white');
  assert.equal(editor.draftMap.heights[far], map.heights[far], 'outside the region nothing moves');
  assert.match(statuses.at(-1)[1], /selected region|región seleccionada/);

  // Refusals change nothing.
  const current = history.current();
  assert.equal(await interaction.importHeightmap([file('foto.jpg', white)]), false);
  assert.match(statuses.at(-1)[1], /not read|no leído/);
  assert.equal(await interaction.importHeightmap([file('solo.json', white)]), false);
  panel.importMin = 20; panel.importMax = 10;
  assert.equal(await interaction.importHeightmap([file('Landscape.r16', white)]), false);
  assert.match(statuses.at(-1)[1], /range not valid|Rango del mapa/);
  assert.deepEqual(history.current(), current);
});
