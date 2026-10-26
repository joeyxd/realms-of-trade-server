const valid = b => b && [b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) && b.minX < b.maxX && b.minZ < b.maxZ;

export function mapBounds(map) {
  const half = Number.isFinite(map?.half) ? map.half : map?.size / 2;
  const b = map?.bounds ?? { minX: -half, maxX: half, minZ: -half, maxZ: half };
  if (!valid(b)) throw new TypeError('Invalid map bounds');
  return Object.isFrozen(b) ? b : Object.freeze({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
}
export function insetMapBounds(map, margin = 0) {
  const b = mapBounds(map);
  return { minX: b.minX + margin, maxX: b.maxX - margin, minZ: b.minZ + margin, maxZ: b.maxZ - margin };
}
export function insideMapBounds(map, x, z, margin = 0) {
  const b = insetMapBounds(map, margin);
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}
export function centeredSquare(b) { return b.minX === b.minZ && b.maxX === b.maxZ && b.minX === -b.maxX; }
export function mapGrid(map) {
  return { Nx: map.Nx ?? map.N, Nz: map.Nz ?? map.N };
}
export function mapAxisCounts(map, count, texels = false) {
  const b = mapBounds(map), square = centeredSquare(b), offset = texels ? 1 : 0;
  const axis = extent => square ? count : Math.round((count - offset) * extent / 560) + offset;
  return { x: axis(b.maxX - b.minX), z: axis(b.maxZ - b.minZ) };
}
export function nearestMapEdge(map, fallback) {
  if (!map?.bounds && !Number.isFinite(map?.half)) return fallback;
  const b = mapBounds(map);
  return Math.min(-b.minX, b.maxX, -b.minZ, b.maxZ);
}
