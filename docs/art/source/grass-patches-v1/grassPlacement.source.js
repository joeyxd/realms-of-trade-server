// Small cosmetic clusters share the shrub clearance checks without touching world RNG or colliders.
import { shrubSite, shrubSiteContext } from './shrubPlacement.js';

export const GRASS_LIMIT = 600;

function hash(x, z, seed, salt) {
  let n = Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663) ^ seed ^ salt;
  n = Math.imul(n ^ (n >>> 16), 2246822507); n = Math.imul(n ^ (n >>> 13), 3266489909);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function buildGrassPatches(map, { shrubs = [], limit = GRASS_LIMIT } = {}) {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.min(GRASS_LIMIT, Math.floor(limit))) : GRASS_LIMIT;
  if (!cap) return [];
  const ctx = shrubSiteContext(map), seed = map.seed | 0, candidates = [];
  const half = Math.max(0, Math.min(200, Number.isFinite(map.half) ? map.half : 165));
  const occupied = [...shrubs, ...(map.props || []).filter((p) => p.kind === 'bush').map((p) =>
    ({ x: p.x, z: p.z, radius: Math.max(0.6, (p.scale || 1) * 1.2) }))];
  for (let x = -half + 4; x < half - 4; x += 9) for (let z = -half + 4; z < half - 4; z += 9) {
    if (hash(x, z, seed, 811) > 0.6) continue;
    const cx = x + (hash(x, z, seed, 821) - 0.5) * 5, cz = z + (hash(x, z, seed, 823) - 0.5) * 5;
    // Sandy fringes get occasional pockets; grass terrain carries most of the volume.
    if (map.materialAt(cx, cz) === 'sand' && hash(x, z, seed, 827) > 0.2) continue;
    const count = 3 + Math.floor(hash(x, z, seed, 829) * 3), patchRank = hash(x, z, seed, 839);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963 + hash(x, z, seed, 853) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.85 + hash(x + i, z, seed, 857) * 0.65;
      const px = cx + Math.cos(angle) * r, pz = cz + Math.sin(angle) * r;
      const scale = 0.7 + hash(px, pz, seed, 859) * 0.55, radius = scale * 0.85;
      const site = shrubSite(map, px, pz, radius, ctx);
      if (!site || occupied.some((p) => Math.hypot(px - p.x, pz - p.z) < radius + p.radius + 0.2)) continue;
      // Keep every blade root on the sampled plane while burying only a small base margin.
      candidates.push({ x: px, z: pz, ...site, y: site.y + 0.03, scale, radius,
        variant: Math.floor(hash(cx, cz, seed, 863) * 3), rot: hash(px, pz, seed, 877) * Math.PI * 2,
        patch: `${x},${z}`, rank: patchRank, order: i });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.order - b.order || a.x - b.x || a.z - b.z);
  return candidates.slice(0, cap).map(({ rank, order, ...item }) => item);
}

export function grassBudget(name = 'high', mobile = false) {
  if (name === 'low') return { limit: 160, distance: 28, detailDistance: 0 };
  if (mobile || name === 'medium') return { limit: 320, distance: 38, detailDistance: 14 };
  return { limit: GRASS_LIMIT, distance: 55, detailDistance: 24 };
}
