import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../src/sim/worldgen.js';
import { revampTerrain } from '../src/sim/terrainRevamp.js';
import { mapBounds } from '../src/sim/mapBounds.js';
import { createNavalCoast } from '../src/sim/naval/coastGeometry.js';
import { moveWithCollision } from '../src/sim/systems/movement.js';
import { returnPearl } from '../src/sim/systems/pearls.js';
import { World } from '../src/sim/world.js';
import { installInventory } from '../src/sim/systems/inventory.js';
import { tuning } from '../src/data/tuning.js';
import { describeMap, projectMap } from '../src/ui/cartography.js';

const seed = 99282957, original = generateWorld(seed);
const bounds = { minX: -840, maxX: 280, minZ: -280, maxZ: 280 };
const grown = revampTerrain(original.terrainSource, { bounds });
const DEFAULT_HEIGHT_SHA256 = 'f0dd28e3664ce0ebb38904e706a578de962958b0767131cf92e9820032d835b5';

test('default terrain retains its exact height bytes and legacy square fields', () => {
  const h = original.heights;
  assert.equal(createHash('sha256').update(new Uint8Array(h.buffer, h.byteOffset, h.byteLength)).digest('hex'), DEFAULT_HEIGHT_SHA256);
  assert.deepEqual(original.bounds, { minX: -280, maxX: 280, minZ: -280, maxZ: 280 });
  assert.ok(Object.isFrozen(original.bounds));
  for (const [key, value] of Object.entries({ Nx: 561, Nz: 561, size: 560, half: 280, N: 561, mapSpan: 255 })) assert.equal(original[key], value);
});
test('rectangular terrain preserves every original vertex and exposes open sea in its new extent', () => {
  assert.deepEqual(grown.bounds, bounds); assert.ok(Object.isFrozen(grown.bounds));
  assert.equal(grown.Nx, 1121); assert.equal(grown.Nz, 561); assert.equal(grown.heights.length, 1121 * 561);
  for (const key of ['half', 'N', 'size', 'mapSpan']) { assert.equal(grown[key], undefined); assert.ok(!Object.hasOwn(grown, key)); }
  for (let j = 0; j < 561; j++) for (let i = 0; i < 561; i++) assert.equal(grown.heights[j * 1121 + i + 560], original.heights[j * 561 + i]);
  assert.ok(grown.groundAt(-700, 0) < -tuning.world.wadeMax);
  const frame = describeMap(grown).frame;
  for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) {
    const [px, py] = projectMap(frame, x, z, 512); assert.ok(px >= 0 && px <= 512 && py >= 0 && py <= 512);
  }
});
test('bounds adapters accept legacy maps and reject invalid generator extents', () => {
  for (const map of [{ half: 280 }, { size: 560 }, { bounds: original.bounds }]) {
    assert.deepEqual(mapBounds(map), original.bounds); assert.ok(Object.isFrozen(mapBounds(map)));
  }
  for (const invalid of [null, {}, { ...bounds, minX: -279 }, { ...bounds, maxZ: 279 }, { ...bounds, minZ: -279 },
    { ...bounds, maxX: 279 }, { ...bounds, minX: -840.5 }, { ...bounds, minX: NaN }, { ...bounds, maxX: Infinity }, { ...bounds, minX: 281 }])
    assert.throws(() => revampTerrain(original.terrainSource, { bounds: invalid }), TypeError);
  assert.throws(() => mapBounds({}), TypeError);
});
test('movement and pearl sampling respect each rectangular edge and retain default RNG ranges', () => {
  const map = { ...grown, groundAt: () => 0.5, onDock: () => false, queryColliders: () => [], colliders: [] };
  const w = new World(seed, { map, server: true }), e = w.spawnPlayer({ x: -700, z: 0 });
  w.jumpMode = 'lab'; w.ecs.jmpAct[e] = 4;
  for (const [dx, dz, x, z] of [[-2000, -2000, -838, -278], [2000, 2000, 278, 278]]) {
    moveWithCollision(w, e, dx, dz); assert.equal(w.ecs.x[e], x); assert.equal(w.ecs.z[e], z);
  }
  installInventory(w, 'bounds');
  for (const m of [original, grown]) {
    w.map = { ...map, bounds: m.bounds }; const draws = [], range = w.lootRng.range.bind(w.lootRng);
    w.lootRng.range = (lo, hi) => { draws.push([lo, hi]); return range(lo, hi); };
    const d = returnPearl(w, { id: 0, pearl: { uid: 'bounds-test', kind: 'brasa' } });
    assert.deepEqual(draws, [[m.bounds.minX + 3, m.bounds.maxX - 3], [m.bounds.minZ + 3, m.bounds.maxZ - 3]]);
    assert.ok(d.x >= m.bounds.minX + 3 && d.x <= m.bounds.maxX - 3 && d.z >= m.bounds.minZ + 3 && d.z <= m.bounds.maxZ - 3);
    w.lootRng.range = range;
  }
});
test('rectangular coast walls sit two metres inside each side and extend beyond the map', () => {
  const coast = createNavalCoast(grown);
  for (const [id, axis, at, other] of [['left', 'x', -838, 0], ['right', 'x', 278, 0], ['north', 'z', -278, -700], ['south', 'z', 278, -700]]) {
    const x = axis === 'x' ? at : other, z = axis === 'z' ? at : other;
    const wall = coast.query(x - 0.1, z - 0.1, x + 0.1, z + 0.1).find(p => p.id === `boundary:${id}`);
    assert.ok(wall); assert.ok(wall.vertices.some(v => v[axis] === at));
    assert.ok(wall.vertices.some(v => v[axis] < bounds[axis === 'x' ? 'minX' : 'minZ'] || v[axis] > bounds[axis === 'x' ? 'maxX' : 'maxZ']));
  }
});
