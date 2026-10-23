// GM07c: a stroke updates only the terrain rows and water texels it changed, and the result equals a whole rewrite.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDocument, createDocumentHistory } from '../src/editor/document.js';
import { terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { TerrainSession, openTerrainDocument, tileReferences } from '../src/editor/terrainSession.js';
import { createTerrain, createHeightTexture, updateHeightTexture, updateTerrainGeometry } from '../src/render/terrain.js';
import { createTerrainPreview } from '../src/editor/terrainPreview.js';

const BASE = 'terrain-s21-v1';
const N = TERRAIN_GRID_SIZE;
const map = generateWorld(GAME.seed);
const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const NAMES = ['position', 'normal', 'aMask', 'aPaint'];

function center(radius) {
  const mask = terrainEditableMask(map);
  for (let j = radius + 2; j < N - radius - 2; j++) for (let i = radius + 2; i < N - radius - 2; i++) {
    let free = true;
    for (let dz = -radius - 1; dz <= radius + 1 && free; dz++) for (let dx = -radius - 1; dx <= radius + 1; dx++)
      if (!mask[(j + dz) * N + i + dx]) { free = false; break; }
    if (free) return { x: i - 280, z: j - 280 };
  }
  throw new Error('no free area');
}

async function session() {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: createDocument({ seed: map.seed, baseRevision: BASE }) });
  const history = createDocumentHistory(opened.document, { tiles: opened.tiles });
  const terrain = new TerrainSession({ map, baseRevision: BASE, grid: opened.grid, references: tileReferences(opened.document),
    lookup: (sha256) => history.tile(sha256) });
  const commit = async (edit) => {
    const result = await terrain.commit({ document: history.current(), radius: 4, strength: 1, falloff: .5, ...edit });
    history.commit(result.document, { tiles: result.tiles });
    return result;
  };
  return { terrain, commit };
}

function grid() {
  const geometry = new THREE.BufferGeometry(), count = N * N;
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aMask', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
  geometry.setAttribute('aPaint', new THREE.BufferAttribute(new Uint8Array(count * 4), 4, true));
  return { geometry };
}
// What WebGLAttributes.updateBuffer does after an upload (three r160).
const uploaded = (mesh) => { for (const name of NAMES) {
  const attribute = mesh.geometry.getAttribute(name); attribute.clearUpdateRanges(); attribute.onUploadCallback();
} };
const same = (left, right, names = NAMES) => { for (const name of names)
  assert.ok(bytes(left.geometry.getAttribute(name).array).equals(bytes(right.geometry.getAttribute(name).array)), name); };

test('a sculpt and a paint region rewrite only their rows and equal a whole rewrite byte for byte', async () => {
  const { commit } = await session(), at = center(6);
  const first = await commit({ tool: 'raise', points: [at] });
  const mesh = grid(); updateTerrainGeometry(mesh, first.map); uploaded(mesh);
  const water = createHeightTexture(first.map, 561);

  const second = await commit({ tool: 'raise', points: [{ x: at.x + 2, z: at.z + 1 }] });
  const { region } = second;
  assert.strictEqual(region.from, first.map);
  const before = first.map.heights, after = second.map.heights;
  let changed = 0;
  for (let k = 0; k < after.length; k++) if (before[k] !== after[k]) {
    const i = k % N, j = (k - i) / N; changed++;
    assert.ok(i >= region.i0 && i <= region.i1 && j >= region.j0 && j <= region.j1, `vertex ${i},${j} outside the region`);
  }
  assert.ok(changed > 0);
  updateTerrainGeometry(mesh, second.map, { region });
  const whole = grid(); updateTerrainGeometry(whole, second.map);
  same(mesh, whole);
  const rows = region.j1 - region.j0 + 3, width = region.i1 - region.i0 + 3;
  const ranges = mesh.geometry.getAttribute('position').updateRanges;
  assert.equal(ranges.length, rows);
  assert.ok(ranges.every(({ count }) => count === width * 3));
  assert.strictEqual(second.map.masks, first.map.masks);
  assert.equal(mesh.geometry.getAttribute('aMask').updateRanges.length, 0, 'masks belong to the base map and stay');
  assert.ok(rows * width < N * N / 100, 'a 4 m stroke touches under 1 % of the grid');
  updateHeightTexture(second.map, water, { region });
  assert.ok(bytes(water.image.data).equals(bytes(createHeightTexture(second.map, 561).image.data)));

  uploaded(mesh);
  const paint = await commit({ tool: 'paint', material: 'sand', points: [at] });
  assert.strictEqual(paint.region.from, second.map);
  updateTerrainGeometry(mesh, paint.map, { region: paint.region, paintOnly: true });
  updateTerrainGeometry(whole, paint.map, { paintOnly: true });
  same(mesh, whole, ['aPaint']);
  assert.equal(mesh.geometry.getAttribute('position').updateRanges.length, 0, 'paint leaves the heights alone');
  assert.ok(mesh.geometry.getAttribute('aPaint').updateRanges.length > 0);
});

test('a region never narrows a whole upload that has not reached the GPU', async () => {
  const { commit } = await session(), at = center(6);
  const first = await commit({ tool: 'raise', points: [at] });
  const mesh = grid();
  const position = mesh.geometry.getAttribute('position');
  position.addUpdateRange(0, 3);
  updateTerrainGeometry(mesh, first.map);
  assert.equal(position.updateRanges.length, 0, 'a whole update drops pending ranges');
  const second = await commit({ tool: 'lower', points: [at] });
  updateTerrainGeometry(mesh, second.map, { region: second.region });
  assert.equal(position.updateRanges.length, 0, 'the pending whole upload stays whole');
  uploaded(mesh);
  const third = await commit({ tool: 'raise', points: [at] });
  updateTerrainGeometry(mesh, third.map, { region: third.region });
  assert.ok(position.updateRanges.length > 0);
  assert.throws(() => updateTerrainGeometry(mesh, third.map, { region: { i0: 4, j0: 4, i1: 2, j1: 9 } }), RangeError);
});

test('the preview takes a region only against the map it shows', async () => {
  const { commit } = await session(), at = center(6);
  const base = createTerrain(map, { segments: 2, assetRegistry: { texture: () => null } });
  const scene = new THREE.Scene(); scene.add(base);
  const preview = createTerrainPreview({ scene, map });
  const first = await commit({ tool: 'raise', points: [at] });
  preview.apply(first.map, { region: first.region });
  const position = base.geometry.getAttribute('position');
  assert.equal(position.count, N * N);
  assert.equal(position.updateRanges.length, 0, 'the first projection builds the grid');
  const second = await commit({ tool: 'raise', points: [{ x: at.x + 1, z: at.z }] });
  preview.apply(second.map, { region: second.region });
  assert.ok(position.updateRanges.length > 0, 'the stroke region is used');
  const third = await commit({ tool: 'raise', points: [at] });
  preview.apply(third.map, { region: { ...third.region, from: first.map } });
  assert.equal(position.updateRanges.length, 0, 'a region against another map rewrites the whole grid');
  const whole = grid(); updateTerrainGeometry(whole, third.map);
  same(base, whole);
  preview.dispose();
});
