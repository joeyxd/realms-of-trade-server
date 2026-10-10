import { compileGmColliders } from './publicationValidation.js';

const CELL = 4;
const cellKey = (x, z) => (x * 73856093) ^ (z * 19349663);

function colliderQuery(colliders) {
  const grid = new Map();
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const x0 = Math.floor((c.x - c.r) / CELL), x1 = Math.floor((c.x + c.r) / CELL);
    const z0 = Math.floor((c.z - c.r) / CELL), z1 = Math.floor((c.z + c.r) / CELL);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const key = cellKey(x, z);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
  }
  const out = [];
  return (x, z, r) => {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const list = grid.get(cellKey(gx, gz));
      if (!list) continue;
      for (const index of list) if (!out.includes(index)) out.push(index);
    }
    return out;
  };
}

function assertBase(map, baseRevision) {
  if (!map || !Array.isArray(map.props) || !Array.isArray(map.colliders) ||
      !Number.isSafeInteger(map.seed) || typeof map.groundAt !== 'function') {
    throw new TypeError('A generated base map is required');
  }
  if (typeof baseRevision !== 'string' || !baseRevision) throw new TypeError('A base revision is required');
}

/** Build an immutable-by-convention content projection while preserving all base map data and functions. */
export function projectGmContent(baseMap, document = null, baseRevision = 'terrain-s21-v1') {
  assertBase(baseMap, baseRevision);
  const colliders = document === null ? baseMap.colliders.map((c) => structuredClone(c))
    : compileGmColliders(baseMap, document, baseRevision);
  return { ...baseMap, colliders, queryColliders: colliderQuery(colliders) };
}

/** Replace only the collision list/index on a caller-owned active map. */
export function installGmContent(map, baseMap, document = null, baseRevision = 'terrain-s21-v1') {
  if (!map || typeof map !== 'object') throw new TypeError('An active map is required');
  const projected = projectGmContent(baseMap, document, baseRevision);
  map.colliders = projected.colliders;
  map.queryColliders = projected.queryColliders;
  return map;
}

function blockedInterval(a, b, circle, playerRadius) {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  if (length2 < 1e-12) return Math.hypot(a.x - circle.x, a.z - circle.z) < circle.r + playerRadius ? [0, 1] : null;
  const cx = circle.x - a.x, cz = circle.z - a.z;
  const center = (cx * dx + cz * dz) / length2;
  const perpendicular2 = Math.max(0, cx * cx + cz * cz - center * center * length2);
  const radius = circle.r + playerRadius, remainder = radius * radius - perpendicular2;
  if (remainder < 0) return null;
  const half = Math.sqrt(remainder / length2), start = Math.max(0, center - half), end = Math.min(1, center + half);
  return start <= end ? [start, end] : null;
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter(Boolean).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current[0] <= last[1] + 1e-10) last[1] = Math.max(last[1], current[1]);
    else merged.push([...current]);
  }
  return merged;
}

function intervalHasNewClearance(candidate, baseBlocked) {
  let cursor = candidate[0];
  for (const interval of baseBlocked) {
    if (interval[1] < cursor - 1e-10) continue;
    if (interval[0] > cursor + 1e-10) return true;
    cursor = Math.max(cursor, interval[1]);
    if (cursor >= candidate[1] - 1e-10) return false;
  }
  return cursor < candidate[1] - 1e-10;
}

function introducedColliders(base, target) {
  const counts = new Map();
  for (const collider of base.colliders) {
    const key = JSON.stringify([collider.x, collider.z, collider.r]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const introduced = [];
  for (const collider of target.colliders) {
    const key = JSON.stringify([collider.x, collider.z, collider.r]), count = counts.get(key) || 0;
    if (count) counts.set(key, count - 1);
    else introduced.push(collider);
  }
  return introduced;
}

function routeSegments(map) {
  const routes = [], lm = map.landmarks || {};
  const path = Array.isArray(lm.path) ? lm.path.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z)) : [];
  const anchorPairs = [
    ['spawn-village', lm.spawn, lm.village], ['spawn-dock', lm.spawn, lm.dockBase],
    ['village-dock', lm.village, lm.dockBase],
  ];
  for (const [id, a, b] of anchorPairs) if (a && b && [a.x, a.z, b.x, b.z].every(Number.isFinite))
    routes.push({ id, points: [a, b] });
  if (path.length > 1) routes.push({ id: 'main-trail', points: path });
  if (lm.dockBase && lm.dockEnd) routes.push({ id: 'dock', points: [lm.dockBase, lm.dockEnd] });
  const checkpoints = Object.entries(map.checkpoints || {}).filter(([, p]) => Number.isFinite(p?.x) && Number.isFinite(p?.z));
  if (path.length && checkpoints.length) {
    for (const [id, point] of checkpoints) {
      const nearest = path.reduce((best, candidate) => Math.hypot(candidate.x - point.x, candidate.z - point.z) <
        Math.hypot(best.x - point.x, best.z - point.z) ? candidate : best, path[0]);
      routes.push({ id: `checkpoint:${id}`, points: [point, nearest] });
    }
  }
  return routes;
}

/** Reject any new circle that consumes previously clear clearance along a protected route segment. */
export function validateGmRoutes(baseMap, targetMap) {
  if (!baseMap || !targetMap || typeof baseMap.queryColliders !== 'function' ||
      typeof targetMap.queryColliders !== 'function') throw new TypeError('Base and target maps with collider queries are required');
  const failures = [];
  const added = introducedColliders(baseMap, targetMap);
  const playerRadius = 0.72;
  for (const route of routeSegments(baseMap)) {
    let failed = false;
    for (let i = 1; i < route.points.length && !failed; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const baseBlocked = mergeIntervals(baseMap.colliders.map((circle) => blockedInterval(a, b, circle, playerRadius)));
      for (const circle of added) {
        const interval = blockedInterval(a, b, circle, playerRadius);
        if (interval && intervalHasNewClearance(interval, baseBlocked)) { failed = true; break; }
      }
    }
    if (failed) failures.push({ code: 'route_regression', routeId: route.id });
  }
  return { valid: failures.length === 0, issues: failures };
}
