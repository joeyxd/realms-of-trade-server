import { mapBounds, mapGrid, insetMapBounds, centeredSquare } from '../mapBounds.js';
// Deterministic collision polygons for shoreline, dock, and map boundary queries.
const cache = new WeakMap();
const WATERLINE = 0.15;
const BOUNDARY_LIMIT = 1e9;
const MAX_QUERY_EXTENT = 128;
const AREA_EPSILON = 1e-12;

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

function freezePolygon(id, vertices, kind) {
  const frozenVertices = Object.freeze(vertices.map(({ x, z }) => Object.freeze({ x, z })));
  return Object.freeze({ id, vertices: frozenVertices, kind });
}

function polygonArea2(vertices) {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area;
}

function clippedTriangle(points, threshold) {
  const clipped = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const aIn = a.h >= threshold, bIn = b.h >= threshold;
    if (aIn) clipped.push({ x: a.x, z: a.z });
    if (aIn !== bIn) {
      const t = (threshold - a.h) / (b.h - a.h);
      clipped.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  if (clipped.length < 3 || Math.abs(polygonArea2(clipped)) <= AREA_EPSILON) return null;
  return clipped;
}

function validateMap(map) {
  const b = mapBounds(map), { Nx, Nz } = mapGrid(map);
  if (![Nx, Nz].every(n => Number.isSafeInteger(n) && n >= 2 && n <= 4097) ||
      Math.min(b.maxX - b.minX, b.maxZ - b.minZ) <= 4 || !finite(map.res) || map.res <= 0 || map.res > 4 ||
      !map.heights || !Number.isSafeInteger(map.heights.length) || map.heights.length !== Nx * Nz ||
      !finite(map.seed)) throw new TypeError('Invalid coast heightfield map');
  const expectedX = (b.maxX - b.minX) * map.res + 1, expectedZ = (b.maxZ - b.minZ) * map.res + 1;
  if (Math.abs(Nx - expectedX) > 1e-6 || Math.abs(Nz - expectedZ) > 1e-6) throw new TypeError('Coast heightfield dimensions do not match');
  for (let i = 0; i < map.heights.length; i++) if (!finite(map.heights[i]))
    throw new TypeError('Coast heightfield contains a non-finite height');
  if (map.dock !== undefined && map.dock !== null) {
    const dock = map.dock;
    if (!dock.base || !dock.dir || !['x', 'z'].every((key) => finite(dock.base[key]) && finite(dock.dir[key])) ||
        !finite(dock.len) || dock.len <= 0 || !finite(dock.halfWidth) || dock.halfWidth <= 0 || !finite(dock.deckY))
      throw new TypeError('Invalid coast dock geometry');
    const length = Math.hypot(dock.dir.x, dock.dir.z);
    if (Math.abs(length - 1) > 1e-6) throw new TypeError('Coast dock direction must be normalized');
  }
}

function makeDockPolygon(dock) {
  if (!dock || dock.deckY <= WATERLINE) return null;
  const { x, z } = dock.base, { x: dx, z: dz } = dock.dir;
  const px = -dz * dock.halfWidth, pz = dx * dock.halfWidth;
  const startX = x - dx * 1.5, startZ = z - dz * 1.5;
  const endX = x + dx * dock.len, endZ = z + dz * dock.len;
  return freezePolygon('dock:main', [
    { x: startX - px, z: startZ - pz }, { x: endX - px, z: endZ - pz },
    { x: endX + px, z: endZ + pz }, { x: startX + px, z: startZ + pz },
  ], 'dock');
}

function makeBoundaryPolygons(b, bounds) {
  const L = Math.max(BOUNDARY_LIMIT, ...Object.values(bounds).map(Math.abs)) + (Object.values(bounds).some(v => Math.abs(v) >= BOUNDARY_LIMIT) ? 1 : 0);
  return Object.freeze([
    freezePolygon('boundary:left', [{ x: -L, z: -L }, { x: b.minX, z: -L }, { x: b.minX, z: L }, { x: -L, z: L }], 'boundary'),
    freezePolygon('boundary:right', [{ x: b.maxX, z: -L }, { x: L, z: -L }, { x: L, z: L }, { x: b.maxX, z: L }], 'boundary'),
    freezePolygon('boundary:north', [{ x: -L, z: -L }, { x: L, z: -L }, { x: L, z: b.minZ }, { x: -L, z: b.minZ }], 'boundary'),
    freezePolygon('boundary:south', [{ x: -L, z: b.maxZ }, { x: L, z: b.maxZ }, { x: L, z: L }, { x: -L, z: L }], 'boundary'),
  ]);
}

function validateQuery(minX, minZ, maxX, maxZ) {
  if (![minX, minZ, maxX, maxZ].every(finite) || minX > maxX || minZ > maxZ ||
      maxX - minX > MAX_QUERY_EXTENT || maxZ - minZ > MAX_QUERY_EXTENT)
    throw new TypeError('Invalid coast query bounds');
}

export function createNavalCoast(map) {
  if (!map || typeof map !== 'object') throw new TypeError('Invalid coast heightfield map');
  const prior = cache.get(map);
  if (prior) return prior;
  validateMap(map);

  const { res, heights, seed } = map, { Nx, Nz } = mapGrid(map), bounds = mapBounds(map);
  const boundary = insetMapBounds(map, 2);
  const dock = makeDockPolygon(map.dock);
  const boundaries = makeBoundaryPolygons(boundary, bounds);
  const cells = new Map();

  const buildCell = (i, j) => {
    const cellId = j * (Nx - 1) + i;
    if (cells.has(cellId)) return cells.get(cellId);
    const k = j * Nx + i;
    const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + Nx], h11 = heights[k + Nx + 1];
    const threshold = WATERLINE - Math.abs(h00 - h10 - h01 + h11) / 4;
    const x0 = bounds.minX + i / res, x1 = x0 + 1 / res;
    const z0 = bounds.minZ + j / res, z1 = z0 + 1 / res;
    const p00 = { x: x0, z: z0, h: h00 }, p10 = { x: x1, z: z0, h: h10 };
    const p01 = { x: x0, z: z1, h: h01 }, p11 = { x: x1, z: z1, h: h11 };
    const triangles = [[p00, p10, p11], [p00, p11, p01]];
    const polygons = [];
    for (let t = 0; t < triangles.length; t++) {
      const triangle = triangles[t];
      if (Math.max(triangle[0].h, triangle[1].h, triangle[2].h) <= threshold) continue;
      const vertices = clippedTriangle(triangle, threshold);
      if (vertices) polygons.push(freezePolygon(`terrain:${j}:${i}:${t}`, vertices, 'terrain'));
    }
    const result = Object.freeze(polygons);
    cells.set(cellId, result);
    return result;
  };

  const query = (minX, minZ, maxX, maxZ) => {
    validateQuery(minX, minZ, maxX, maxZ);
    const found = [];
    const add = (polygon) => {
      if (!polygon) return;
      const xs = polygon.vertices.map((v) => v.x), zs = polygon.vertices.map((v) => v.z);
      if (Math.max(...xs) < minX || Math.min(...xs) > maxX || Math.max(...zs) < minZ || Math.min(...zs) > maxZ) return;
      found.push(polygon);
    };

    const gx0 = (minX - bounds.minX) * res, gx1 = (maxX - bounds.minX) * res;
    const gz0 = (minZ - bounds.minZ) * res, gz1 = (maxZ - bounds.minZ) * res;
    const i0 = Math.max(0, Math.min(Nx - 2, Math.floor(gx0) - 1));
    const i1 = Math.max(0, Math.min(Nx - 2, Math.floor(gx1)));
    const j0 = Math.max(0, Math.min(Nz - 2, Math.floor(gz0) - 1));
    const j1 = Math.max(0, Math.min(Nz - 2, Math.floor(gz1)));
    if (gx1 >= 0 && gx0 <= Nx - 1 && gz1 >= 0 && gz0 <= Nz - 1) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++)
        for (const polygon of buildCell(i, j)) add(polygon);
    }

    if (dock && Math.max(...dock.vertices.map((v) => v.x)) >= minX && Math.min(...dock.vertices.map((v) => v.x)) <= maxX &&
        Math.max(...dock.vertices.map((v) => v.z)) >= minZ && Math.min(...dock.vertices.map((v) => v.z)) <= maxZ) add(dock);
    if (minX <= boundary.minX) add(boundaries[0]);
    if (maxX >= boundary.maxX) add(boundaries[1]);
    if (minZ <= boundary.minZ) add(boundaries[2]);
    if (maxZ >= boundary.maxZ) add(boundaries[3]);
    found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return Object.freeze(found);
  };

  const coast = Object.freeze({ version: 1, seed, bounds, ...(centeredSquare(bounds) ? { half: bounds.maxX } : {}), cell: 1 / res, query });
  cache.set(map, coast);
  return coast;
}
