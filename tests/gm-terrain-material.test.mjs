import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createDocumentHistory, validateDocument } from '../src/editor/document.js';
import { compileTerrainMap, TERRAIN_GRID_SIZE, validateTerrain, validateTerrainForMap } from '../src/editor/terrainData.js';
import { paintTerrainDocument } from '../src/editor/terrainPaint.js';
import { sculptTerrainDocument } from '../src/editor/terrainSculpt.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { freshwaterSource } from '../src/data/freshwater.js';
import { resourceLayout } from '../src/data/resources.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';

const BASE = 'gm05b-material-test';
const map = generateWorld(20261010);
const empty = () => createDocument({ seed: map.seed, baseRevision: BASE });

function safeSample() {
  for (let z = -250; z <= 250; z += 4) for (let x = -250; x <= 250; x += 4) {
    const i = Math.round(x + map.half), j = Math.round(z + map.half), index = j * TERRAIN_GRID_SIZE + i;
    if (map.groundAt(i - map.half, j - map.half) < 4) continue;
    try {
      validateTerrainForMap(map, { version: 2, samples: [], materials: [[index, 255, 0, 0, 0]] });
      return { index, i, j, point: { x: i - map.half, z: j - map.half } };
    } catch { /* Find a dry sample outside protected gameplay areas. */ }
  }
  throw new Error('Could not find a safe dry terrain material sample');
}
const safe = safeSample();

test('terrain material validator rejects invalid sums, ordering, and document-version mismatches', () => {
  const good = { version: 2, samples: [], materials: [[10, 255, 0, 0, 0], [11, 0, 0, 128, 0]] };
  assert.deepEqual(validateTerrain(good), good);
  for (const materials of [
    [[10, 0, 0, 0, 0]], [[10, 200, 100, 0, 0]], [[11, 255, 0, 0, 0], [10, 255, 0, 0, 0]],
  ]) assert.throws(() => validateTerrain({ ...good, materials }));
  const document = createDocument({ seed: map.seed, baseRevision: BASE, terrain: good });
  assert.equal(document.version, 4);
  assert.throws(() => validateDocument({ ...document, version: 3 }), error => error.code === 'terrain_version');
  assert.throws(() => validateDocument({ ...document, terrain: { version: 1, samples: [], materials: good.materials } }));
});

test('paint and erase are deterministic, nonmutating, and undo/redo restore exact bytes', () => {
  const initial = empty(), initialBytes = JSON.stringify(initial);
  const args = { map, document: initial, baseRevision: BASE, points: [safe.point], radius: 2, strength: .8,
    falloff: .2, shape: 'ellipse', aspect: .5, rotation: 35, material: 'sand' };
  const painted = paintTerrainDocument(args);
  assert.deepEqual(paintTerrainDocument(args), painted);
  assert.equal(JSON.stringify(initial), initialBytes);
  assert.equal(painted.version, 4);
  assert.ok(painted.terrain.materials.length > 0);
  const history = createDocumentHistory(initial);
  history.commit(painted);
  assert.deepEqual(history.undo(), initial);
  assert.deepEqual(history.redo(), painted);

  const beforeErase = structuredClone(painted.terrain.materials);
  const eraseArgs = { ...args, document: painted, tool: 'erase', material: 'sand', strength: 1 };
  const erased = paintTerrainDocument(eraseArgs);
  assert.deepEqual(paintTerrainDocument(eraseArgs), erased);
  assert.deepEqual(painted.terrain.materials, beforeErase, 'erase must not mutate its input');
  assert.equal(erased.terrain.materials.some(([index]) => index === safe.index), false);
  assert.ok(erased.terrain.materials.length < painted.terrain.materials.length);
  history.commit(erased);
  assert.deepEqual(history.undo(), painted);
  assert.deepEqual(history.redo(), erased);
});

test('paint projection preserves height bytes, props, colliders, and resource layout', () => {
  const sourceBytes = Buffer.from(new Uint8Array(map.heights.buffer, map.heights.byteOffset, map.heights.byteLength));
  const props = map.props, colliders = map.colliders, resources = JSON.stringify(resourceLayout(map));
  const painted = paintTerrainDocument({ map, document: empty(), baseRevision: BASE, points: [safe.point], radius: 2,
    strength: 1, falloff: 1, material: 'rock' });
  const projection = compileTerrainMap(map, painted.terrain);
  assert.equal(Buffer.from(new Uint8Array(map.heights.buffer, map.heights.byteOffset, map.heights.byteLength)).compare(sourceBytes), 0);
  assert.strictEqual(projection.heights, map.heights);
  assert.strictEqual(projection.props, props);
  assert.strictEqual(projection.colliders, colliders);
  assert.equal(JSON.stringify(resourceLayout(projection)), resources);
});

test('material interpolation follows alternating terrain diagonals exactly', () => {
  // Pick a fully dry, unprotected cell whose four corners can carry fixture paint.
  const findCell = parity => {
    for (let j = 12; j < 548; j += 4) for (let i = 12 + parity; i < 548; i += 4) {
      if (((i + j) & 1) !== parity) continue;
      const a = j * TERRAIN_GRID_SIZE + i, entries = [
        [a, 255, 0, 0, 0], [a + 1, 0, 255, 0, 0],
        [a + TERRAIN_GRID_SIZE, 0, 0, 255, 0], [a + TERRAIN_GRID_SIZE + 1, 0, 0, 0, 255],
      ];
      try { validateTerrainForMap(map, { version: 2, samples: [], materials: entries }); return { i, j, entries }; }
      catch { /* Continue until all four vertices pass the map policy. */ }
    }
    return null;
  };
  for (const parity of [0, 1]) {
    const cell = findCell(parity);
    assert.ok(cell, `fixture should contain a safe four-vertex cell with parity ${parity}`);
    const projected = compileTerrainMap(map, { version: 2, samples: [], materials: cell.entries });
    const weights = parity === 0
      ? projected.materialWeightsAt(cell.i - map.half + .25, cell.j - map.half + .75)
      : projected.materialWeightsAt(cell.i - map.half + .25, cell.j - map.half + .25);
    assert.deepEqual(weights.map(v => Math.round(v * 1000) / 1000),
      parity === 0 ? [.25, 0, .5, .25] : [.5, .25, .25, 0]);
  }
});

test('matching painted family stays continuous with the automatic residual', () => {
  const automatic = map.materialAt(safe.point.x, safe.point.z);
  const channel = ['grass', 'dirt', 'sand', 'rock'].indexOf(automatic);
  assert.ok(channel >= 0, `safe dry sample should use a paintable family, got ${automatic}`);
  const weights = [0, 0, 0, 0];
  weights[channel] = 80;
  const projected = compileTerrainMap(map, { version: 2, samples: [], materials: [[safe.index, ...weights]] });
  const actual = projected.materialWeightsAt(safe.point.x, safe.point.z);
  assert.ok(1 - actual.reduce((sum, value) => sum + value, 0) > actual[channel]);
  assert.equal(projected.materialAt(safe.point.x, safe.point.z), automatic);
});

test('safe dry material paint passes server draft validation and the spring interpolation margin is rejected', () => {
  const validate = createGmDraftValidator({ map, baseRevision: BASE, manifest: [], editorCatalog: [] });
  const accepted = paintTerrainDocument({ map, document: empty(), baseRevision: BASE, points: [safe.point], radius: 2,
    strength: 1, falloff: 1, material: 'dirt' });
  assert.deepEqual(validate(accepted), accepted);

  const spring = freshwaterSource(map), i = Math.round(spring.x + map.half), j = Math.round(spring.z + map.half);
  const index = j * TERRAIN_GRID_SIZE + i;
  const malicious = createDocument({ seed: map.seed, baseRevision: BASE,
    terrain: { version: 2, samples: [], materials: [[index, 255, 0, 0, 0]] } });
  assert.throws(() => validate(malicious), error => error.name === 'GmDraftValidationError' && error.code === 'protected_area');
});

test('painting then sculpting preserves material samples in document v4', () => {
  const painted = paintTerrainDocument({ map, document: empty(), baseRevision: BASE, points: [safe.point], radius: 2,
    strength: 1, falloff: 1, material: 'sand' });
  const result = sculptTerrainDocument({ map, document: painted, baseRevision: BASE, tool: 'raise', points: [safe.point], radius: 2 });
  assert.equal(result.version, 4);
  assert.equal(result.terrain.version, 2);
  assert.deepEqual(result.terrain.materials, painted.terrain.materials);
  assert.ok(result.terrain.samples.length > 0);
});
