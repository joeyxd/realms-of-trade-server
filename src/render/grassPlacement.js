// Small cosmetic clusters share the shrub clearance checks without touching world RNG or colliders.
// Pure module: no THREE, no DOM, so Node tests can import it directly.
import { PLANT_R, shrubSite, shrubSiteContext } from './shrubPlacement.js';

export const GRASS_LIMIT = 1000;

// Edge clumps hug building bases, fences and path borders; the plaza and walkable paths stay clear.
const GRASS_VILLAGE_CLEAR = 3; // shrubs keep 8 u around the village point; grass only 3 u
const CAMPFIRE_CLEAR = 6.5; // plaza radius around every campfire prop, for every clump
const COLLIDER_CLEAR = 1.0; // clump centre to collider edge, for every clump
const RING_IN = 0.5, RING_OUT = 1.9; // ring around a prop, measured from its collider edge
const DOOR_ARC = 0.55; // radians skipped on each side of a hut door direction
const WALK_STEP = 2.4, WALK_NEAR = 1.7, WALK_FAR = 2.8, PATH_CORE = 1.6;
const EDGE_KINDS = ['hut', 'stall', 'stallTarp', 'board', 'fence']; // also the placement priority
const GRASS_CELL_CHANCE = 0.95; // share of 9 u hash cells that carry a patch (was 0.6)
const EDGE_SCALE_MIN = 0.8, EDGE_SCALE_SPAN = 0.5;
// Grass may lean over a fern, its root may not grow inside it: plants block only the clump centre.
const PLANT_ROOT_MARGIN = 0.1;
const RING_ATTEMPTS = 8; // retries per ring clump; the first 4 salts reproduce the original layout

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

// Collider edges and campfire plazas, bucketed so a thousand candidates stay cheap.
function clearance(map) {
  const colliders = Array.isArray(map.colliders) ? map.colliders
    : (map.props || []).filter((p) => p.r > 0 && p.kind !== 'bush');
  const campfires = (map.props || []).filter((p) => p.kind === 'campfire');
  const cell = 8, buckets = new Map();
  for (const c of colliders) {
    if (![c.x, c.z, c.r].every(Number.isFinite)) continue;
    const reach = c.r + COLLIDER_CLEAR;
    for (let ix = Math.floor((c.x - reach) / cell); ix <= Math.floor((c.x + reach) / cell); ix++)
      for (let iz = Math.floor((c.z - reach) / cell); iz <= Math.floor((c.z + reach) / cell); iz++) {
        const key = `${ix},${iz}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(c);
      }
  }
  return (x, z) => {
    if (campfires.some((f) => Math.hypot(x - f.x, z - f.z) < CAMPFIRE_CLEAR)) return false;
    return !(buckets.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || [])
      .some((c) => Math.hypot(x - c.x, z - c.z) < c.r + COLLIDER_CLEAR);
  };
}

// Site test for edge clumps. Unlike shrubSite it accepts the village dirt around the huts (that is where the
// edge grass belongs) and replaces the prop-radius rule by the collider clearance applied by the caller.
function edgeSite(map, x, z, radius, ctx, half) {
  if (!(Math.abs(x) < half - 4 && Math.abs(z) < half - 4)) return null;
  const y = map.heightAt(x, z), dx = (map.heightAt(x + radius, z) - map.heightAt(x - radius, z)) / (2 * radius);
  const dz = (map.heightAt(x, z + radius) - map.heightAt(x, z - radius)) / (2 * radius);
  if (![y, dx, dz].every(Number.isFinite) || y <= 0.05 || Math.hypot(dx, dz) > 0.6) return null;
  const material = map.materialAt(x, z);
  if (material === 'water' || material === 'rock' || material === 'wood' || map.onDock?.(x, z)) return null;
  const mask = map.masks(x, z);
  if (mask.volcanic > 0.2 || mask.arenaFloor > 0.1 || mask.lava > 0.1) return null;
  if (map.pathInfo && map.pathInfo(x, z).d < PATH_CORE) return null;
  const l = map.landmarks || {};
  for (const [point, clear] of [[l.spawn, 6], [l.village, GRASS_VILLAGE_CLEAR], [l.arena, (l.arenaR || 19) + 4], [map.cala, map.cala?.r + 1]])
    if (point && Math.hypot(x - point.x, z - point.z) < radius + clear) return null;
  if (l.dockBase && l.dockEnd && segmentDistance(x, z, l.dockBase, l.dockEnd) < radius + 3) return null;
  if (ctx.access.some((p) => Math.hypot(x - p.x, z - p.z) < radius + (p.r || 0.5) + 2)) return null;
  const length = Math.hypot(dx, 1, dz);
  return { y: y - 0.05, nx: -dx / length, ny: 1 / length, nz: -dz / length, material };
}

// Shrubs and bushes keep the full disc rule; entries flagged root (village plants) only block the clump centre.
function blocked(occupied, x, z, radius) {
  return occupied.some((p) => Math.hypot(x - p.x, z - p.z) < (p.root ? p.radius + PLANT_ROOT_MARGIN : radius + p.radius + 0.2));
}

// Edge clump sources in priority order: village props first, then the beach walk, then the Sendero.
// Everything is keyed by coordinates, so prop order and client never change the layout.
function edgeClumps(map, { ctx, seed, half, occupied, clear }) {
  const out = [];
  const accept = (x, z, salt, patch, kind, { skipSand = false } = {}) => {
    const scale = EDGE_SCALE_MIN + hash(x, z, seed, salt + 3) * EDGE_SCALE_SPAN, radius = scale * 0.85;
    if (!clear(x, z)) return false;
    const site = edgeSite(map, x, z, radius, ctx, half);
    if (!site || (skipSand && site.material === 'sand')) return false;
    if (blocked(occupied, x, z, radius)) return false;
    if (out.some((c) => Math.hypot(x - c.x, z - c.z) < (radius + c.radius) * 0.6)) return false;
    const r = hash(x, z, seed, salt + 4);
    const { material, ...rest } = site;
    out.push({ x, z, ...rest, y: site.y + 0.03, scale, radius,
      // Edge clumps prefer the tuft and fan silhouettes; the wild style stays occasional.
      variant: r < 0.45 ? 0 : r < 0.9 ? 1 : 2, rot: hash(x, z, seed, salt + 5) * Math.PI * 2, patch, edge: kind });
    return true;
  };

  const sources = (map.props || []).filter((p) => EDGE_KINDS.includes(p.kind) && [p.x, p.z].every(Number.isFinite))
    .sort((a, b) => EDGE_KINDS.indexOf(a.kind) - EDGE_KINDS.indexOf(b.kind) || a.x - b.x || a.z - b.z);
  for (const p of sources) {
    const r = Number.isFinite(p.r) && p.r > 0 ? p.r : 0;
    const want = p.kind === 'hut' ? 8 + Math.floor(hash(p.x, p.z, seed, 901) * 7) : 2 + Math.floor(hash(p.x, p.z, seed, 907) * 3);
    // The collider clearance already keeps COLLIDER_CLEAR from the edge, so the ring starts at the larger of the two.
    const inner = r + Math.max(RING_IN, COLLIDER_CLEAR), span = r + RING_OUT - inner;
    const door = p.kind === 'hut' && Number.isFinite(p.rot) ? p.rot : null; // hut door faces local +z
    const patch = `edge:${p.kind}:${Math.round(p.x)},${Math.round(p.z)}`;
    for (let i = 0; i < want; i++) for (let attempt = 0; attempt < RING_ATTEMPTS; attempt++) {
      const salt = 1000 + (i * 4 + attempt) * 8;
      const angle = hash(p.x, p.z, seed, salt + 1) * Math.PI * 2;
      if (door !== null && Math.abs(Math.atan2(Math.sin(angle - door), Math.cos(angle - door))) < DOOR_ARC) continue;
      const d = inner + hash(p.x, p.z, seed, salt + 2) * span;
      if (accept(p.x + Math.sin(angle) * d, p.z + Math.cos(angle) * d, salt, patch, p.kind)) break;
    }
  }

  const l = map.landmarks || {};
  const lines = [];
  if (l.spawn && l.village) lines.push({ name: 'walk', points: [l.spawn, l.village] });
  if (Array.isArray(l.path) && l.path.length > 1) lines.push({ name: 'path', points: l.path });
  for (const { name, points } of lines) for (let s = 0; s < points.length - 1; s++) {
    const a = points[s], b = points[s + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
    if (!(len > 0)) continue;
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, steps = Math.floor(len / WALK_STEP);
    for (let k = 0; k < steps; k++) for (const side of [-1, 1]) for (let attempt = 0; attempt < 3; attempt++) {
      const bx = a.x + ux * (k + 0.5) * WALK_STEP, bz = a.z + uz * (k + 0.5) * WALK_STEP;
      const salt = 5000 + ((attempt * 2 + (side > 0 ? 1 : 0)) * 8);
      const along = (hash(bx, bz, seed, salt + 1) - 0.5) * 1.0;
      const lateral = side * (WALK_NEAR + hash(bx, bz, seed, salt + 2) * (WALK_FAR - WALK_NEAR));
      const x = bx + ux * along - uz * lateral, z = bz + uz * along + ux * lateral;
      if (accept(x, z, salt, `edge:${name}:${s}:${k}`, name, { skipSand: true })) break;
    }
  }
  return out;
}

export function buildGrassPatches(map, { shrubs = [], limit = GRASS_LIMIT } = {}) {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.min(GRASS_LIMIT, Math.floor(limit))) : GRASS_LIMIT;
  if (!cap) return [];
  const ctx = shrubSiteContext(map), seed = map.seed | 0, candidates = [], clear = clearance(map);
  const half = Math.max(0, Math.min(200, Number.isFinite(map.half) ? map.half : 165));
  const props = map.props || [];
  const occupied = [...shrubs, ...props.filter((p) => p.kind === 'bush').map((p) =>
    ({ x: p.x, z: p.z, radius: Math.max(0.6, (p.scale || 1) * 1.2) })),
  ...props.filter((p) => PLANT_R[p.kind]).map((p) =>
    ({ x: p.x, z: p.z, radius: PLANT_R[p.kind] * (p.scale || 1), root: true }))];
  // Edge clumps come first so the sort-and-cut below never drops them.
  const edge = edgeClumps(map, { ctx, seed, half, occupied, clear });
  for (let x = -half + 4; x < half - 4; x += 9) for (let z = -half + 4; z < half - 4; z += 9) {
    if (hash(x, z, seed, 811) > GRASS_CELL_CHANCE) continue;
    const cx = x + (hash(x, z, seed, 821) - 0.5) * 5, cz = z + (hash(x, z, seed, 823) - 0.5) * 5;
    // Sandy fringes get occasional pockets; grass terrain carries most of the volume.
    if (map.materialAt(cx, cz) === 'sand' && (hash(x, z, seed, 811) > 0.6 || hash(x, z, seed, 827) > 0.2)) continue;
    const count = 3 + Math.floor(hash(x, z, seed, 829) * 3), patchRank = hash(x, z, seed, 839);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963 + hash(x, z, seed, 853) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.85 + hash(x + i, z, seed, 857) * 0.65;
      const px = cx + Math.cos(angle) * r, pz = cz + Math.sin(angle) * r;
      const scale = 0.7 + hash(px, pz, seed, 859) * 0.55, radius = scale * 0.85;
      const site = shrubSite(map, px, pz, radius, ctx, { villageClear: GRASS_VILLAGE_CLEAR });
      if (!site || !clear(px, pz) || blocked(occupied, px, pz, radius)) continue;
      if (edge.some((c) => Math.hypot(px - c.x, pz - c.z) < (radius + c.radius) * 0.6)) continue;
      // Keep every blade root on the sampled plane while burying only a small base margin.
      candidates.push({ x: px, z: pz, ...site, y: site.y + 0.03, scale, radius,
        variant: Math.floor(hash(cx, cz, seed, 863) * 3), rot: hash(px, pz, seed, 877) * Math.PI * 2,
        patch: `${x},${z}`, rank: patchRank, order: i });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.order - b.order || a.x - b.x || a.z - b.z);
  return [...edge, ...candidates.map(({ rank, order, ...item }) => item)].slice(0, cap);
}

export function grassBudget(name = 'high', mobile = false) {
  if (name === 'low') return { limit: 160, distance: 28, detailDistance: 0 };
  if (mobile || name === 'medium') return { limit: 520, distance: 38, detailDistance: 14 };
  return { limit: GRASS_LIMIT, distance: 55, detailDistance: 24 };
}
