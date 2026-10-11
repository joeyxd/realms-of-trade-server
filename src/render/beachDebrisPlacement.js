// Driftwood is a sparse cosmetic layer: placement never changes world props, RNG or colliders.
import { beachDetailEligible, buildBeachDetails } from './beachDetails.js';

export const DEBRIS_LIMIT = 96;

function hash(x, z, seed, salt) {
  let n = Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663) ^ seed ^ salt;
  n = Math.imul(n ^ (n >>> 16), 2246822507); n = Math.imul(n ^ (n >>> 13), 3266489909);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

export function debrisSite(map, x, z, radius = 1.4) {
  if (![x, z, radius].every(Number.isFinite) || radius <= 0 || !beachDetailEligible(map, x, z, radius)) return null;
  const y = map.heightAt(x, z);
  const dx = (map.heightAt(x + radius, z) - map.heightAt(x - radius, z)) / (2 * radius);
  const dz = (map.heightAt(x, z + radius) - map.heightAt(x, z - radius)) / (2 * radius);
  if (![y, dx, dz].every(Number.isFinite) || y > 1.3) return null;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
    const h = map.heightAt(px, pz), masks = map.masks(px, pz);
    if (!Number.isFinite(h) || h < 0.18 || h > 1.45 || map.materialAt(px, pz) !== 'sand' || map.onDock?.(px, pz) ||
      masks.path >= 0.12 || masks.volcanic >= 0.15 || masks.arenaFloor >= 0.1 || masks.lava >= 0.1 ||
      Math.abs(h - y - dx * (px - x) - dz * (pz - z)) > 0.07) return null;
  }
  const l = map.landmarks || {};
  if (l.spawn && Math.hypot(x - l.spawn.x, z - l.spawn.z) < radius + 6) return null;
  if (l.village && Math.hypot(x - l.village.x, z - l.village.z) < radius + 8) return null;
  if (l.dockBase && l.dockEnd && segmentDistance(x, z, l.dockBase, l.dockEnd) < radius + 3) return null;
  for (const p of [...(map.enemySpawns || []), ...(map.npcs || []), ...(map.racks || [])])
    if (Math.hypot(x - p.x, z - p.z) < radius + (p.r || 0.5) + 2) return null;
  const length = Math.hypot(dx, 1, dz);
  return { y: y - 0.025, nx: -dx / length, ny: 1 / length, nz: -dz / length };
}

export function buildBeachDebris(map, { shrubs = [], grass = [], limit = DEBRIS_LIMIT } = {}) {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.min(DEBRIS_LIMIT, Math.floor(limit))) : DEBRIS_LIMIT;
  if (!cap) return [];
  const seed = map.seed | 0, candidates = [], detail = buildBeachDetails(map);
  const occupied = [...shrubs, ...grass, ...detail.shells.map((p) => ({ ...p, radius: 0.45 * p.scale })),
    ...detail.pebbles.map((p) => ({ ...p, radius: 0.55 * p.scale }))];
  const half = Math.max(0, Math.min(190, Number.isFinite(map.half) ? map.half : 165));
  for (let x = -half + 3; x < half - 3; x += 7) for (let z = -half + 3; z < half - 3; z += 7) {
    if (hash(x, z, seed, 907) > 0.65) continue;
    const px = x + (hash(x, z, seed, 911) - 0.5) * 4, pz = z + (hash(x, z, seed, 919) - 0.5) * 4;
    const scale = 0.72 + hash(px, pz, seed, 929) * 0.38, radius = scale * 1.4;
    const site = debrisSite(map, px, pz, radius);
    if (!site || occupied.some((p) => Math.hypot(px - p.x, pz - p.z) < radius + (p.radius || 0.7) + 0.2)) continue;
    candidates.push({ x: px, z: pz, ...site, scale, radius, variant: Math.floor(hash(px, pz, seed, 937) * 3),
      rot: hash(px, pz, seed, 941) * Math.PI * 2, rank: hash(px, pz, seed, 947) });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z);
  const selected = [];
  for (const { rank, ...p } of candidates) {
    if (selected.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < p.radius + o.radius + 1)) continue;
    selected.push(p); if (selected.length === cap) break;
  }
  return selected;
}

export function debrisBudget(name = 'high', mobile = false) {
  if (name === 'low') return { limit: 32, distance: 32 };
  if (mobile || name === 'medium') return { limit: 64, distance: 45 };
  return { limit: DEBRIS_LIMIT, distance: 65 };
}
