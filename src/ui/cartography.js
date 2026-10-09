// Pure display adapter for world maps. Keep world geometry separate from map UI and rendering.
import { toUV, toWorld, ZONES } from '../sim/worldgen.js';

const SQRT_HALF = Math.SQRT1_2;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const point = (p) => p && finite(p.x) && finite(p.z);
const safeText = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const revisionText = (value) => typeof value === 'string' && value.trim() ? value.trim()
  : finite(value) ? String(value) : '';

function normalizePoint(value, index, prefix = 'point') {
  if (!point(value)) return null;
  const kind = safeText(value.kind, 'point');
  const id = safeText(value.id, `${prefix}-${index}`);
  const name = safeText(value.name, id);
  return { id, name, kind, x: value.x, z: value.z };
}

function normalizeRegion(value, index) {
  if (!point(value) || !finite(value.r) || value.r < 0 || !['danger', 'arena'].includes(value.kind)) return null;
  return { id: safeText(value.id, `region-${index}`), name: safeText(value.name, safeText(value.id, `region-${index}`)),
    x: value.x, z: value.z, r: value.r, kind: value.kind };
}

function frameForBounds(bounds) {
  if (!bounds || !['minX', 'maxX', 'minZ', 'maxZ'].every((key) => finite(bounds[key])) ||
      bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) return null;
  const corners = [[bounds.minX, bounds.minZ], [bounds.minX, bounds.maxZ],
    [bounds.maxX, bounds.minZ], [bounds.maxX, bounds.maxZ]].map(([x, z]) => toUV(x, z));
  const minU = Math.min(...corners.map((p) => p.u)), maxU = Math.max(...corners.map((p) => p.u));
  const minV = Math.min(...corners.map((p) => p.v)), maxV = Math.max(...corners.map((p) => p.v));
  return { centerU: (minU + maxU) / 2, centerV: (minV + maxV) / 2,
    span: Math.max((maxU - minU) / 2, (maxV - minV) / 2, 0.5) };
}

function legacyData(map) {
  const L = map?.landmarks || {}, points = [], regions = [];
  const add = (id, name, kind, value) => {
    const p = normalizePoint({ ...value, id, name, kind }, points.length);
    if (p) points.push(p);
  };
  const zone = (id) => safeText(ZONES[id]?.name, id);
  add('spawn', zone('playa'), 'spawn', L.spawn);
  add('village', zone('aldea'), 'town', L.village);
  if (Array.isArray(L.path) && L.path.length) add('path', zone('camino'), 'route', L.path[Math.floor(L.path.length / 2)]);
  add('arena', zone('caldera'), 'arena', L.arena);
  add('ship', 'Barco', 'ship', L.ship);
  for (const n of Array.isArray(map?.npcs) ? map.npcs : []) add(n?.id, n?.name, 'npc', n);
  for (const rack of (Array.isArray(map?.racks) ? map.racks : [])) add(rack?.id, rack?.name, 'rack', rack);
  const arenaR = L.arenaR;
  if (point(L.arena) && finite(arenaR) && arenaR >= 0)
    regions.push({ id: 'arena', name: zone('caldera'), x: L.arena.x, z: L.arena.z, r: arenaR, kind: 'arena' });
  if (point(map?.cala) && finite(map.cala.r) && map.cala.r >= 0) {
    add('cala', zone('calavera'), 'danger', map.cala);
    regions.push({ id: 'cala', name: zone('calavera'), x: map.cala.x, z: map.cala.z, r: map.cala.r, kind: 'danger' });
  }
  return { points, regions };
}

/** Describe explicit cartography when present, otherwise adapt the current island map data. */
export function describeMap(map) {
  const explicit = map?.cartography && typeof map.cartography === 'object' ? map.cartography : null;
  const points = explicit ? (Array.isArray(explicit.points) ? explicit.points : []).map((p, i) => normalizePoint(p, i)).filter(Boolean) : [];
  const regions = explicit ? (Array.isArray(explicit.regions) ? explicit.regions : []).map(normalizeRegion).filter(Boolean) : [];
  let frame = explicit ? frameForBounds(explicit.bounds) : null;
  if (!frame) {
    if (!explicit && finite(map?.mapSpan) && map.mapSpan > 0) frame = { centerU: 0, centerV: 0, span: map.mapSpan };
    else {
      const half = finite(map?.half) && map.half > 0 ? map.half
        : finite(map?.size) && map.size > 0 ? map.size / 2 : 0;
      // With no explicit bounds, include available terrain bounds and declared feature extents.
      const extents = [...points, ...regions].flatMap(p => [{ x: p.x - (p.r || 0), z: p.z - (p.r || 0) },
        { x: p.x + (p.r || 0), z: p.z + (p.r || 0) }]);
      if (half > 0) extents.push({ x: -half, z: -half }, { x: half, z: half });
      frame = extents.length ? frameForBounds({ minX: Math.min(...extents.map(p => p.x)), maxX: Math.max(...extents.map(p => p.x)),
        minZ: Math.min(...extents.map(p => p.z)), maxZ: Math.max(...extents.map(p => p.z)) }) : { centerU: 0, centerV: 0, span: 1 };
    }
  }
  if (explicit) {
    return { title: safeText(explicit.title, 'Mapa del mundo'), revision: revisionText(explicit.revision ?? map?.terrainRevision), frame,
      points, regions };
  }
  const legacy = legacyData(map || {});
  return { title: map?.landmarks ? 'Isla de la Caldera' : 'Mapa del mundo',
    revision: revisionText(map?.terrainRevision), frame, points: legacy.points, regions: legacy.regions };
}

/** Project world XZ into a square map canvas, with u up and v right. */
export function projectMap(frame, x, z, size) {
  if (!frame || !finite(frame.centerU) || !finite(frame.centerV) || !finite(frame.span) || frame.span <= 0 ||
      !finite(x) || !finite(z) || !finite(size) || size <= 0) return null;
  const { u, v } = toUV(x, z);
  return [((v - frame.centerV + frame.span) / (2 * frame.span)) * size,
    ((frame.centerU + frame.span - u) / (2 * frame.span)) * size];
}

/** Invert projectMap for a square map canvas. */
export function unprojectMap(frame, px, py, size) {
  if (!frame || !finite(frame.centerU) || !finite(frame.centerV) || !finite(frame.span) || frame.span <= 0 ||
      !finite(px) || !finite(py) || !finite(size) || size <= 0) return null;
  const v = frame.centerV + (px / size * 2 - 1) * frame.span;
  const u = frame.centerU + (1 - py / size * 2) * frame.span;
  return toWorld(u, v);
}

/** Canvas rotation for a world-facing angle, in the map's NW-up frame. */
export function mapDirection(facing) {
  if (!finite(facing)) return null;
  const fx = Math.sin(facing), fz = Math.cos(facing);
  const du = -SQRT_HALF * fx - SQRT_HALF * fz, dv = SQRT_HALF * fx - SQRT_HALF * fz;
  return Math.atan2(-du, dv);
}
