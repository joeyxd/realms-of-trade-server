// Restyle existing underwater anchors without consuming simulation RNG or changing the map.
export const SEAWEED_LIMIT = 256;

function hash(x, z, seed, salt) {
  let n = Math.imul(Math.round(x * 1000), 73856093) ^ Math.imul(Math.round(z * 1000), 19349663) ^ seed ^ salt;
  n = Math.imul(n ^ (n >>> 16), 2246822507); n = Math.imul(n ^ (n >>> 13), 3266489909);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

export function buildSeaweed(map, { limit = SEAWEED_LIMIT } = {}) {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.min(SEAWEED_LIMIT, Math.floor(limit))) : SEAWEED_LIMIT;
  if (!cap) return [];
  const candidates = [], seen = new Set(), seed = map.seed | 0;
  for (const p of map.props || []) {
    if (p.kind !== 'seaweed' || ![p.x, p.z, p.scale, p.rot].every(Number.isFinite) || p.scale <= 0) continue;
    const y = map.heightAt(p.x, p.z);
    if (!Number.isFinite(y) || y < -3.2 || y > -0.75 || map.onDock?.(p.x, p.z)) continue;
    // This conservative height also covers tilted ribbons and their maximum horizontal sway.
    const scale = Math.min(p.scale, 1.25, (-y - 0.42) / 1.35), radius = 0.77 * scale;
    const dx = (map.heightAt(p.x + radius, p.z) - map.heightAt(p.x - radius, p.z)) / (2 * radius);
    const dz = (map.heightAt(p.x, p.z + radius) - map.heightAt(p.x, p.z - radius)) / (2 * radius);
    // The seabed is much steeper than walkable ground; align roots to its local plane.
    if (![dx, dz].every(Number.isFinite) || Math.hypot(dx, dz) > 1.4) continue;
    let safe = true;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, x = p.x + Math.cos(angle) * radius, z = p.z + Math.sin(angle) * radius;
      const h = map.heightAt(x, z);
      if (!Number.isFinite(h) || h > -0.45 || h < -3.4 || map.onDock?.(x, z) ||
        Math.abs(h - y - dx * (x - p.x) - dz * (z - p.z)) > 0.09) { safe = false; break; }
    }
    if (!safe) continue;
    const { dockBase, dockEnd } = map.landmarks || {};
    if (dockBase && dockEnd && segmentDistance(p.x, p.z, dockBase, dockEnd) < radius + 2.5) continue;
    const length = Math.hypot(dx, 1, dz), key = `${p.x},${p.z}`;
    // Equal anchors share the same shape; duplicate map entries cannot create duplicate clumps.
    candidates.push({ x: p.x, y: y - 0.035, z: p.z, nx: -dx / length, ny: 1 / length, nz: -dz / length,
      rot: p.rot, scale, radius, variant: Math.floor(hash(p.x, p.z, seed, 1013) * 3),
      rank: hash(p.x, p.z, seed, 1019), key });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z || a.scale - b.scale || a.rot - b.rot);
  const points = [];
  for (const { rank, key, ...p } of candidates) {
    if (seen.has(key)) continue;
    seen.add(key); points.push(p); if (points.length === cap) break;
  }
  return points;
}

export function seaweedBudget(name = 'high', mobile = false) {
  if (name === 'low') return { limit: 96, distance: 32, detailDistance: 0 };
  if (mobile || name === 'medium') return { limit: 160, distance: 45, detailDistance: 14 };
  return { limit: SEAWEED_LIMIT, distance: 65, detailDistance: 22 };
}
