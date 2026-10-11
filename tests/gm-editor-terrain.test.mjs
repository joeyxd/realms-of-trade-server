import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createDocumentHistory, validateDocument } from '../src/editor/document.js';
import { compileTerrainMap, validateTerrain, validateTerrainForMap } from '../src/editor/terrainData.js';
import { sculptTerrainDocument } from '../src/editor/terrainSculpt.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { stepMover } from '../src/sim/systems/movement.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';

const BASE = 'gm05a-test-base';
const map = generateWorld(20261010);
const empty = () => createDocument({ seed: map.seed, baseRevision: BASE });

function findSafePoint() {
  for (let z = -250; z <= 250; z += 4) for (let x = -250; x <= 250; x += 4) {
    const i = Math.round(x + map.half), j = Math.round(z + map.half), index = j * 561 + i;
    try {
      validateTerrainForMap(map, { version: 1, samples: [[index, 1]] });
      if (map.groundAt(i - map.half, j - map.half) >= 4) return { x: i - map.half, z: j - map.half };
    } catch { /* Try another point outside protected gameplay space. */ }
  }
  throw new Error('No safe terrain sample found for the generated test map');
}
const safe = findSafePoint();

test('v2 canonical shape stays unchanged, v3 requires terrain, and terrain validates exact canonical samples', () => {
  const v2 = empty();
  assert.deepEqual(Object.keys(v2), ['schema', 'version', 'base', 'objects', 'baseOverrides']);
  const v3 = createDocument({ seed: map.seed, baseRevision: BASE, terrain: { version: 1, samples: [[123, 10]] } });
  assert.equal(v3.version, 3);
  assert.deepEqual(validateDocument(structuredClone(v3)), v3);
  assert.throws(() => validateDocument({ ...v3, terrain: undefined }), error => error.code === 'format');
  for (const invalid of [
    { version: 1, samples: [[2, 1], [1, 1]] }, { version: 1, samples: [[1, 0]] },
    { version: 1, samples: [[1, 12001]] }, { version: 1, samples: [[561 * 561, 1]] },
    { version: 1, samples: [[1, 1], [1, 2]] }, { version: 1, samples: [], extra: true },
  ]) assert.throws(() => validateTerrain(invalid));
});

test('terrain compilation uses alternating mesh triangles, keeps source immutable, and projects walking/material queries', () => {
  const before = new Float32Array(map.heights), terrain = { version: 1, samples: [[100 * 561 + 100, 1000], [100 * 561 + 101, 3000]] };
  const projected = compileTerrainMap(map, terrain);
  assert.deepEqual(map.heights, before);
  assert.equal(projected.fullsegments, 560);
  assert.equal(projected.gmTerrain, true);
  assert.equal(projected.heightAt(-180, -180), map.heightAt(-180, -180) + 1);
  const source = projected.heights[100 * 561 + 100], right = projected.heights[100 * 561 + 101];
  const expected = source + (right - source) * .25;
  assert.ok(Math.abs(projected.heightAt(-180 + .25, -180) - expected) < .002);
  const dock = map.landmarks.dockBase;
  assert.equal(projected.groundAt(dock.x, dock.z), Math.max(projected.heightAt(dock.x, dock.z), map.dock.deckY));
  assert.equal(projected.materialAt(dock.x, dock.z), 'wood');
  assert.strictEqual(projected.props, map.props);
  const emptyProjection = compileTerrainMap(map, { version: 1, samples: [] });
  assert.equal(emptyProjection.gmTerrain, false);
  assert.strictEqual(emptyProjection.heightAt, map.heightAt);
  assert.strictEqual(emptyProjection.groundAt, map.groundAt);
  assert.strictEqual(emptyProjection.materialAt, map.materialAt);
  assert.strictEqual(emptyProjection.heights, map.heights);
  assert.strictEqual(emptyProjection.props, map.props);
  assert.equal(projected.heightAt(safe.x + 35.25, safe.z + 35.4), map.heightAt(safe.x + 35.25, safe.z + 35.4));
  assert.equal(projected.groundAt(safe.x + 35.25, safe.z + 35.4), map.groundAt(safe.x + 35.25, safe.z + 35.4));
  assert.equal(projected.materialAt(safe.x + 35.25, safe.z + 35.4), map.materialAt(safe.x + 35.25, safe.z + 35.4));
});

test('changed samples protect their interpolation neighbors across the dry coast boundary', () => {
  let edgeIndex = -1;
  for (let j = 3; j < 558 && edgeIndex < 0; j++) for (let i = 3; i < 558; i++) {
    const x = i - map.half, z = j - map.half, h = map.groundAt(x, z);
    if (h < .9 || h > 1.5) continue;
    const neighbors = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
    if (neighbors.some(([nx, nz]) => map.groundAt(nx - map.half, nz - map.half) < .75)) {
      edgeIndex = j * 561 + i;
      try { validateTerrainForMap(map, { version: 1, samples: [[edgeIndex, 1]] }); edgeIndex = -1; }
      catch (error) { if (error.code !== 'protected_ground') edgeIndex = -1; }
      if (edgeIndex >= 0) break;
    }
  }
  assert.ok(edgeIndex >= 0, 'the generated map should contain a policy-rejected dry/wet interpolation edge');
});

test('all brushes produce atomic terrain documents and history undo/redo restores the exact sample set', () => {
  const p = safe;
  const actions = [
    ['raise', [p], { strength: .35 }], ['lower', [p], { strength: .25 }],
    ['flatten', [p], { level: map.groundAt(p.x, p.z) + .3 }], ['smooth', [p], { strength: .8 }],
    ['ramp', [{ x: p.x - 7, z: p.z }, { x: p.x + 7, z: p.z }], {}],
  ];
  for (const [tool, points, options] of actions) {
    const result = sculptTerrainDocument({ map, document: empty(), baseRevision: BASE, tool, points, radius: 2, ...options });
    assert.equal(result.version, 3);
    assert.ok(result.terrain.samples.length > 0, `${tool} should change samples`);
    assert.deepEqual(validateDocument(structuredClone(result)), result);
    const history = createDocumentHistory(empty()); history.commit(result);
    assert.equal(history.undo().version, 2);
    assert.deepEqual(history.redo(), result);
  }
  const existing = sculptTerrainDocument({ map, document: empty(), baseRevision: BASE, tool: 'raise', points: [p], radius: 2 });
  assert.throws(() => sculptTerrainDocument({ map, document: existing, baseRevision: BASE,
    tool: 'raise', points: [{ x: map.landmarks.spawn.x, z: map.landmarks.spawn.z }], radius: 2 }), error =>
    ['protected_area', 'protected_ground', 'protected_route'].includes(error.code));
  assert.equal(existing.terrain.samples.some(([index]) => Math.hypot(index % 561 - map.half - map.landmarks.spawn.x,
    Math.floor(index / 561) - map.half - map.landmarks.spawn.z) < 5), false);
  for (const options of [
    { radius: 25 }, { strength: 1.01 }, { falloff: -0.01 }, { tool: 'flatten', level: .5 },
  ]) assert.throws(() => sculptTerrainDocument({ map, document: empty(), baseRevision: BASE,
    tool: 'raise', points: [p], ...options }), error => error.code === 'parameters');
});

test('terrain moves editable base decorations as explicit overrides and stepMover walks the compiled slope', () => {
  const entries = gmEditableBaseProps(map, BASE);
  let decorated = null;
  for (const entry of entries) {
    try {
      const document = sculptTerrainDocument({ map, document: empty(), baseRevision: BASE,
        tool: 'raise', points: [{ x: entry.prop.x, z: entry.prop.z }], radius: 2, strength: .2 });
      const override = document.baseOverrides.find(item => item.id === entry.id);
      if (override) { decorated = { entry, document, override }; break; }
    } catch { /* Skip protected decoration locations and try the next editable base prop. */ }
  }
  assert.ok(decorated, 'at least one safe editable prop should be reprojected as a document override');
  assert.equal(decorated.override.transform.position.x, decorated.entry.prop.x);
  assert.equal(decorated.override.transform.position.z, decorated.entry.prop.z);
  const baseProjected = compileTerrainMap(map, { version: 1, samples: [] });
  const afterProjected = compileTerrainMap(map, decorated.document.terrain);
  const supportDelta = afterProjected.groundAt(decorated.entry.prop.x, decorated.entry.prop.z) -
    baseProjected.groundAt(decorated.entry.prop.x, decorated.entry.prop.z);
  assert.ok(Math.abs(decorated.override.transform.position.y - decorated.entry.prop.y - supportDelta) < .002);

  const center = safe;
  const document = sculptTerrainDocument({ map, document: empty(), baseRevision: BASE,
    tool: 'raise', points: [center], radius: 6, strength: .2 });
  const projected = compileTerrainMap(map, document.terrain);
  const world = new World(map.seed, { map: projected });
  const e = world.spawnPlayer({ x: center.x - 7, z: center.z });
  let progressed = false;
  for (let step = 0; step < 240; step++) {
    const beforeX = world.ecs.x[e];
    stepMover(world, e, { mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 }, 1 / 60);
    assert.equal(world.ecs.y[e], projected.groundAt(world.ecs.x[e], world.ecs.z[e]));
    if (world.ecs.x[e] > beforeX + .001) progressed = true;
  }
  assert.ok(progressed, 'the body should travel onto the terrain edit instead of colliding with an unsampled slope');
});

test('stroke interpolation is continuous, non-mutating, and invalid gestures reject as a whole', () => {
  const source = new Float32Array(map.heights), point = safe;
  const result = sculptTerrainDocument({ map, document: empty(), baseRevision: BASE, tool: 'raise',
    points: [{ x: point.x - 3, z: point.z }, { x: point.x + 3, z: point.z }], radius: 2, strength: .2 });
  const xs = new Set(result.terrain.samples.map(([index]) => index % 561));
  assert.ok(xs.size >= 8);
  assert.deepEqual(map.heights, source);
  assert.throws(() => sculptTerrainDocument({ map, document: empty(), baseRevision: BASE,
    tool: 'ramp', points: [{ x: point.x, z: point.z }], radius: 2 }), error => error.code === 'points');
  assert.throws(() => sculptTerrainDocument({ map, document: empty(), baseRevision: 'wrong', tool: 'raise', points: [point] }),
    error => error.code === 'base_mismatch');
  const ramp = sculptTerrainDocument({ map, document: empty(), baseRevision: BASE, tool: 'ramp',
    points: [{ x: point.x - 3, z: point.z }, { x: point.x + 3, z: point.z },], radius: 2 });
  const beyondEnd = (Math.round(point.z + map.half) * 561) + Math.round(point.x + map.half + 6);
  assert.equal(ramp.terrain.samples.some(([index]) => index === beyondEnd), false,
    'the ramp footprint must stop at the rounded segment capsule');
});
