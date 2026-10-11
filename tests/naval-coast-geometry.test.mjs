import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavalCoast } from '../src/sim/naval/coastGeometry.js';

const makeMap = ({ half = 4, res = 1, seed = 17, fill = -2, dock } = {}) => {
  const N = 2 * half * res + 1;
  return { seed, half, res, N, heights: new Float32Array(N * N).fill(fill), ...(dock ? { dock } : {}) };
};

function setCell(map, i, j, values) {
  const k = j * map.N + i;
  map.heights[k] = values[0]; map.heights[k + 1] = values[1];
  map.heights[k + map.N] = values[2]; map.heights[k + map.N + 1] = values[3];
}

function bilinear(values, x, z) {
  const [h00, h10, h01, h11] = values;
  return h00 * (1 - x) * (1 - z) + h10 * x * (1 - z) + h01 * (1 - x) * z + h11 * x * z;
}

function contains(poly, x, z) {
  let inside = false;
  const v = poly.vertices;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[i], b = v[j];
    const cross = (x - a.x) * (b.z - a.z) - (z - a.z) * (b.x - a.x);
    if (Math.abs(cross) < 1e-9 && x >= Math.min(a.x, b.x) - 1e-9 && x <= Math.max(a.x, b.x) + 1e-9 &&
        z >= Math.min(a.z, b.z) - 1e-9 && z <= Math.max(a.z, b.z) + 1e-9) return true;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function area2(poly) {
  return poly.vertices.reduce((area, a, i, vertices) => {
    const b = vertices[(i + 1) % vertices.length];
    return area + a.x * b.z - b.x * a.z;
  }, 0);
}

test('clips both fixed-diagonal triangles conservatively around bilinear land above the waterline', () => {
  for (const values of [[0, 1, 1, 0], [1, 0, 0, 1], [-0.2, 0.9, 0.8, -0.1]]) {
    const map = makeMap();
    setCell(map, 4, 4, values);
    const polys = createNavalCoast(map).query(0.01, 0.01, 0.99, 0.99).filter((p) => p.kind === 'terrain');
    assert.ok(polys.length > 0);
    for (let z = 0.05; z < 1; z += 0.05) for (let x = 0.05; x < 1; x += 0.05) {
      if (bilinear(values, x, z) > 0.150001)
        assert.ok(polys.some((poly) => contains(poly, x, z)), `land point (${x}, ${z}) is enclosed`);
    }
    assert.deepEqual(polys.map((p) => p.id), ['terrain:4:4:0', 'terrain:4:4:1'].filter((id) => polys.some((p) => p.id === id)));
  }
});

test('terrain polygons are convex, consistently wound, and deeply immutable', () => {
  const map = makeMap();
  setCell(map, 4, 4, [-1, 2, 2, -1]);
  const coast = createNavalCoast(map), polygons = coast.query(0, 0, 1, 1);
  const terrain = polygons.filter((p) => p.kind === 'terrain' && p.id.startsWith('terrain:4:4:'));
  assert.ok(terrain.length >= 1 && terrain.length <= 2);
  assert.ok(terrain.every((p) => area2(p) > 0), 'clipped triangle winding remains consistently CCW');
  assert.ok(Object.isFrozen(polygons));
  for (const polygon of polygons) {
    assert.ok(Object.isFrozen(polygon));
    assert.ok(Object.isFrozen(polygon.vertices));
    for (const vertex of polygon.vertices) assert.ok(Object.isFrozen(vertex));
    assert.ok(polygon.vertices.length >= 3);
  }
  assert.throws(() => { polygons.push({}); }, TypeError);
  assert.throws(() => { terrain[0].vertices[0].x = 500; }, TypeError);
});

test('fully wet cells are omitted and only overlapped grid cells enter the lazy query cache', () => {
  const map = makeMap();
  setCell(map, 6, 6, [1, 1, 1, 1]);
  const coast = createNavalCoast(map);
  assert.deepEqual(coast.query(-0.9, -0.9, -0.1, -0.1), []);
  const nearLand = coast.query(2.05, 2.05, 2.95, 2.95);
  assert.ok(nearLand.some((p) => p.id.startsWith('terrain:6:6:')));
  assert.ok(nearLand.every((p) => !p.id.startsWith('terrain:4:4:')));
  assert.deepEqual(coast.query(2.05, 2.05, 2.95, 2.95).map((p) => p.id), nearLand.map((p) => p.id));
});

test('oriented dock matches the walkable footprint and is absent below the waterline', () => {
  const dock = { base: { x: 1, z: 0 }, dir: { x: 1, z: 0 }, len: 2, halfWidth: 0.5, deckY: 1.05 };
  const coast = createNavalCoast(makeMap({ dock }));
  const hit = coast.query(0, -0.2, 0.1, 0.2).find((p) => p.kind === 'dock');
  assert.equal(hit?.id, 'dock:main');
  assert.ok(area2(hit) > 0, 'dock polygon shares the terrain winding');
  assert.ok(contains(hit, 0, 0), 'walkable start extension reaches along=-1.5');
  assert.equal(coast.query(-1, 0.7, 2.9, 0.9).some((p) => p.kind === 'dock'), false, 'outside halfWidth is excluded');

  const submerged = createNavalCoast(makeMap({ dock: { ...dock, deckY: 0.15 } }));
  assert.equal(submerged.query(-1, -1, 4, 1).some((p) => p.kind === 'dock'), false);
});

test('four convex boundary boxes appear only when a query reaches half minus two', () => {
  const coast = createNavalCoast(makeMap());
  assert.deepEqual(coast.query(-1, -1, 1, 1).filter((p) => p.kind === 'boundary'), []);
  const west = coast.query(-2.2, -0.5, -1.8, 0.5).filter((p) => p.kind === 'boundary');
  assert.deepEqual(west.map((p) => p.id), ['boundary:left']);
  const corner = coast.query(-2.1, -2.1, -1.9, -1.9).filter((p) => p.kind === 'boundary').map((p) => p.id);
  assert.deepEqual(corner, ['boundary:left', 'boundary:north']);
  const outsideCorner = coast.query(3, 3, 3.5, 3.5).filter((p) => p.kind === 'boundary').map((p) => p.id);
  assert.deepEqual(outsideCorner, ['boundary:right', 'boundary:south'], 'boundary union covers points outside both axes');
  for (const poly of coast.query(-2.1, -2.1, -1.9, -1.9).filter((p) => p.kind === 'boundary'))
    assert.ok(area2(poly) > 0, `${poly.id} has consistent winding`);
});

test('map identity cache and query results are deterministic, sorted, duplicate-free, and frozen', () => {
  const map = makeMap({ fill: 1 });
  const a = createNavalCoast(map), b = createNavalCoast(map);
  assert.equal(a, b);
  assert.deepEqual({ version: a.version, seed: a.seed, half: a.half, cell: a.cell },
    { version: 1, seed: map.seed, half: map.half, cell: 1 });
  const first = a.query(-0.5, -0.5, 0.5, 0.5), second = b.query(-0.5, -0.5, 0.5, 0.5);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((p) => p.id), [...new Set(first.map((p) => p.id))].sort());
});

test('rejects malformed heightfields, dock frames, and unbounded or invalid queries', () => {
  for (const map of [null, {}, makeMap({ half: 4, res: 1 })]) {
    if (map && map.heights) map.heights = new Float32Array(map.heights.length - 1);
    assert.throws(() => createNavalCoast(map), TypeError);
  }
  const nonFinite = makeMap(); nonFinite.heights[3] = NaN;
  assert.throws(() => createNavalCoast(nonFinite), TypeError);
  const wrongShape = makeMap(); wrongShape.N++;
  assert.throws(() => createNavalCoast(wrongShape), TypeError);
  assert.throws(() => createNavalCoast(makeMap({ dock: { base: { x: 0, z: 0 }, dir: { x: 2, z: 0 }, len: 1, halfWidth: 1, deckY: 1 } })), TypeError);

  const query = createNavalCoast(makeMap()).query;
  for (const bounds of [[0, 0, NaN, 1], [1, 0, 0, 1], [0, 1, 1, 0], [0, 0, 129, 1], [0, 0, 1, 129]])
    assert.throws(() => query(...bounds), TypeError);
});
