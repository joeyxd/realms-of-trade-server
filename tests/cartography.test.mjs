import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMap, mapDirection, projectMap, unprojectMap } from '../src/ui/cartography.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';

const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} differs from ${b}`);

test('explicit shifted rectangular bounds fit all four rotated world corners', () => {
  const map = { cartography: { title: 'Archipelago', revision: 'r7',
    bounds: { minX: 700, maxX: 1900, minZ: -300, maxZ: 700 }, points: [], regions: [] } };
  const desc = describeMap(map), bounds = map.cartography.bounds;
  assert.equal(desc.title, 'Archipelago'); assert.equal(desc.revision, 'r7');
  for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) {
    const [px, py] = projectMap(desc.frame, x, z, 1000);
    assert.ok(px >= -1e-9 && px <= 1000 + 1e-9 && py >= -1e-9 && py <= 1000 + 1e-9);
    const world = unprojectMap(desc.frame, px, py, 1000);
    close(world.x, x); close(world.z, z);
  }
  assert.notEqual(desc.frame.centerU, 0); assert.notEqual(desc.frame.centerV, 0);
});

test('projection round trips and keeps the current NW-up cardinal orientation', () => {
  const frame = { centerU: 0, centerV: 0, span: 100 };
  for (const [x, z] of [[0, 0], [31, -47], [-83, 22]]) {
    const [px, py] = projectMap(frame, x, z, 640), result = unprojectMap(frame, px, py, 640);
    close(result.x, x); close(result.z, z);
  }
  close(mapDirection(0), 3 * Math.PI / 4); // +Z points down-left.
  close(mapDirection(Math.PI / 2), Math.PI / 4); // +X points down-right.
  close(mapDirection(Math.PI), -Math.PI / 4); // -Z points up-right.
  close(mapDirection(-Math.PI / 2), -3 * Math.PI / 4); // -X points up-left.
});

test('current generated island adapts landmarks and its markers fit the established 255 span', () => {
  const map = generateWorld(GAME.seed);
  const desc = describeMap(map);
  assert.equal(desc.title, 'Isla de la Caldera'); assert.equal(desc.frame.span, 255);
  assert.ok(desc.points.some((p) => p.id === 'spawn'));
  assert.ok(desc.points.some((p) => p.id === 'village'));
  assert.ok(desc.points.some((p) => p.id === 'cala'));
  for (const p of desc.points) {
    const [x, y] = projectMap(desc.frame, p.x, p.z, 640);
    assert.ok(x >= 0 && x <= 640 && y >= 0 && y <= 640, `${p.id} stays on the legacy map`);
  }
});

test('size fallback frames the rotated corners of a square when no legacy span is supplied', () => {
  const desc = describeMap({ size: 400 });
  close(desc.frame.span, 200 * Math.SQRT2);
  for (const x of [-200, 200]) for (const z of [-200, 200]) {
    const [px, py] = projectMap(desc.frame, x, z, 512);
    assert.ok(px >= -1e-9 && px <= 512 + 1e-9 && py >= -1e-9 && py <= 512 + 1e-9);
  }
});

test('explicit empty feature arrays override legacy island points and regions', () => {
  const map = { size: 560, landmarks: { spawn: { x: 1, z: 2 }, arena: { x: 3, z: 4 }, arenaR: 10 },
    cartography: { bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, points: [], regions: [] } };
  const desc = describeMap(map);
  assert.deepEqual(desc.points, []); assert.deepEqual(desc.regions, []);
});

test('numeric cartography revisions are preserved as strings', () => {
  const desc = describeMap({ cartography: { revision: 12, bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } } });
  assert.equal(desc.revision, '12');
});

test('cartography without valid bounds frames known terrain and shifted features instead of cropping them', () => {
  const map = { size: 400, mapSpan: 1, terrainRevision: 7, cartography: { bounds: { minX: 20, maxX: -20 },
    points: [{ id: 'remote-port', x: 900, z: -300 }], regions: [{ id: 'remote-zone', x: 900, z: -300, r: 50, kind: 'danger' }] } };
  const desc = describeMap(map);
  assert.equal(desc.revision, '7');
  for (const p of [{ x: -200, z: -200 }, { x: 200, z: 200 }, { x: 950, z: -350 }]) {
    const [x, y] = projectMap(desc.frame, p.x, p.z, 100);
    assert.ok(x >= -1e-9 && x <= 100 + 1e-9 && y >= -1e-9 && y <= 100 + 1e-9);
  }
});

test('missing optional world fields and malformed explicit features are safe', () => {
  const empty = describeMap(null);
  assert.equal(empty.title, 'Mapa del mundo'); assert.deepEqual(empty.points, []); assert.deepEqual(empty.regions, []);
  assert.equal(empty.frame.span, 1);
  const explicit = describeMap({ cartography: { points: [null, { id: 'bad', x: Infinity, z: 2 },
      { id: '<b>', name: '<img>', x: 1, z: 2, kind: 'island' }],
    regions: [{ x: 1, z: 2, r: -1, kind: 'danger' }, { x: 0, z: 0, r: 4, kind: 'unknown' }] } });
  assert.equal(explicit.points.length, 1); assert.equal(explicit.points[0].name, '<img>');
  assert.deepEqual(explicit.regions, []);
  assert.equal(projectMap(empty.frame, NaN, 0, 50), null);
  assert.equal(unprojectMap(empty.frame, 1, 1, 0), null);
  assert.equal(mapDirection(Infinity), null);
});
