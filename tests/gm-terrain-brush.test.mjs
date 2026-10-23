import test from 'node:test';
import assert from 'node:assert/strict';
import { brushParameters, brushWeight, brushOutline, strokePath } from '../src/editor/terrainBrush.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument } from '../src/editor/document.js';
import { TERRAIN_GRID_SIZE, validateTerrainForMap } from '../src/editor/terrainData.js';
import { sculptTerrainDocument } from '../src/editor/terrainSculpt.js';

const map = generateWorld(20261010);
const BASE = 'gm-brush-test';

test('brush parameters provide stable defaults and enforce bounded values', () => {
  const defaults = brushParameters();
  assert.deepEqual(defaults, { radius: 6, strength: .5, falloff: .5, shape: 'circle', aspect: .5, rotation: 0 });
  assert.ok(Object.isFrozen(defaults));
  for (const invalid of [{ radius: 1 }, { radius: 25 }, { strength: 0 }, { strength: 1.1 },
    { falloff: -0.1 }, { falloff: 1.1 }, { shape: 'triangle' }, { aspect: .24 }, { aspect: 1.01 },
    { rotation: -1 }, { rotation: 361 }]) assert.throws(() => brushParameters(invalid));
});

test('circle, square, and ellipse weights have distinct footprints and rotated ellipses rotate', () => {
  assert.equal(brushWeight(3, 3, { radius: 4, shape: 'circle', falloff: 0 }), 0);
  assert.ok(brushWeight(3, 3, { radius: 4, shape: 'square', falloff: 0 }) > 0);
  assert.equal(brushWeight(0, 3, { radius: 4, shape: 'ellipse', aspect: .5, falloff: 0 }), 0);
  assert.ok(brushWeight(3, 0, { radius: 4, shape: 'ellipse', aspect: .5, falloff: 0 }) > 0);
  assert.equal(brushWeight(0, 3, { radius: 4, shape: 'ellipse', aspect: .5, rotation: 90, falloff: 0 }) > 0, true);
  assert.equal(brushWeight(3, 0, { radius: 4, shape: 'ellipse', aspect: .5, rotation: 90, falloff: 0 }), 0);
});

test('brush outlines represent shape, respect rotation, and stay within their radius', () => {
  const circle = brushOutline({ radius: 4, shape: 'circle' }, 32);
  const square = brushOutline({ radius: 4, shape: 'square' }, 32);
  const ellipse = brushOutline({ radius: 4, shape: 'ellipse', aspect: .5 }, 32);
  assert.equal(circle.length, 32);
  assert.ok(Math.abs(Math.hypot(circle[0].x, circle[0].z) - 4) < 1e-9);
  assert.ok(Math.max(...square.map(p => Math.max(Math.abs(p.x), Math.abs(p.z)))) <= 4 + 1e-9);
  assert.ok(Math.max(...ellipse.map(p => Math.abs(p.z))) <= 2 + 1e-9);
  const rotated = brushOutline({ radius: 4, shape: 'ellipse', aspect: .5, rotation: 90 }, 32);
  assert.ok(Math.abs(rotated[0].x) < 1e-9 && Math.abs(rotated[0].z - 4) < 1e-9);
  assert.ok(brushOutline({}, 10000).length <= 256);
});

test('stroke paths preserve legacy samples when bounded and reject oversized paths', () => {
  assert.deepEqual(strokePath([{ x: 0, z: 0 }, { x: 1, z: 0 }]), [
    { x: 0, z: 0 }, { x: .5, z: 0 }, { x: 1, z: 0 },
  ]);
  assert.throws(() => strokePath([{ x: -5000, z: 0 }, { x: 5000, z: 0 }]), /8192 sample limit/);
  const bounded = strokePath([{ x: -10, z: 0 }, { x: 10, z: 0 }]);
  assert.ok(bounded.length <= 8192);
  assert.deepEqual(bounded[0], { x: -10, z: 0 });
  assert.deepEqual(bounded.at(-1), { x: 10, z: 0 });
});

test('sculpt defaults preserve the prior circular footprint and reject invalid shape controls', () => {
  let point;
  for (let z = -250; z <= 250 && !point; z += 4) for (let x = -250; x <= 250; x += 4) {
    if (map.groundAt(x, z) > 4) { point = { x, z }; break; }
  }
  assert.ok(point);
  const document = createDocument({ seed: map.seed, baseRevision: BASE });
  const oldDefault = sculptTerrainDocument({ map, document, baseRevision: BASE, tool: 'raise', points: [point] });
  const explicit = sculptTerrainDocument({ map, document, baseRevision: BASE, tool: 'raise', points: [point],
    radius: 6, strength: .5, falloff: .5, shape: 'circle', aspect: .5, rotation: 0 });
  assert.deepEqual(oldDefault, explicit);
  assert.throws(() => sculptTerrainDocument({ map, document, baseRevision: BASE, tool: 'raise', points: [point], shape: 'hex' }),
    error => error.code === 'parameters');
});

test('sculpting a material-painted terrain keeps v2 materials and document version 4', () => {
  let point, index;
  for (let z = -250; z <= 250 && !point; z += 4) for (let x = -250; x <= 250; x += 4) {
    const i = Math.round(x + map.half), j = Math.round(z + map.half), candidate = j * TERRAIN_GRID_SIZE + i;
    if (map.groundAt(i - map.half, j - map.half) < 4) continue;
    try {
      validateTerrainForMap(map, { version: 2, samples: [], materials: [[candidate, 255, 0, 0, 0]] });
      point = { x: i - map.half, z: j - map.half };
      index = candidate;
      break;
    } catch { /* Find a dry unprotected sample for this fixture. */ }
  }
  assert.ok(point);
  const terrain = { version: 2, samples: [], materials: [[index, 255, 0, 0, 0]] };
  const document = createDocument({ seed: map.seed, baseRevision: BASE, terrain });
  const result = sculptTerrainDocument({ map, document, baseRevision: BASE, tool: 'raise', points: [point], radius: 2 });
  assert.equal(result.version, 4);
  assert.equal(result.terrain.version, 2);
  assert.deepEqual(result.terrain.materials, terrain.materials);
});

test('ramp remains a circular corridor when non-circular brush controls are supplied', () => {
  const document = createDocument({ seed: map.seed, baseRevision: BASE });
  let endpoints, circle, ellipse;
  for (let z = -240; z <= 240 && !circle; z += 8) for (let x = -240; x <= 240; x += 8) {
    const candidate = [{ x: x - 3, z }, { x: x + 3, z }];
    try {
      circle = sculptTerrainDocument({ map, document, baseRevision: BASE, tool: 'ramp', points: candidate, radius: 2 });
      ellipse = sculptTerrainDocument({ map, document, baseRevision: BASE, tool: 'ramp', points: candidate, radius: 2,
        shape: 'ellipse', aspect: .25, rotation: 90 });
      endpoints = candidate;
      break;
    } catch { circle = undefined; }
  }
  assert.ok(endpoints);
  assert.deepEqual(ellipse, circle);
});
