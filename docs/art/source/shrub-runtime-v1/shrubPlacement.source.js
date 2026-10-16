// Cosmetic foliage uses coordinate hashes, never the simulation RNG or collider list.
export const SHRUB_LIMIT = 900;

function rank(x, z, seed, salt) {
  let n = Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663) ^ seed ^ salt;
  n = Math.imul(n ^ (n >>> 16), 2246822507); n = Math.imul(n ^ (n >>> 13), 3266489909);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function context(map) {
  const buckets = new Map(), cell = 8;
  for (const p of map.props || []) {
    if (['bush', 'flower', 'pebble', 'seaweed', 'float'].includes(p.kind)) continue;
    const radius = p.kind === 'palm' ? Math.max(p.r || 0.4, (p.h / 6) * p.scale * 1.32) : p.r || 0.6;
    // Index the full obstacle radius so large huts cannot be missed at cell edges.
    for (let ix = Math.floor((p.x - radius) / cell); ix <= Math.floor((p.x + radius) / cell); ix++)
      for (let iz = Math.floor((p.z - radius) / cell); iz <= Math.floor((p.z + radius) / cell); iz++) {
        const key = `${ix},${iz}`; if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ x: p.x, z: p.z, radius });
      }
  }
  const access = [...(map.npcs || []), ...(map.racks || []), ...(map.enemySpawns || []),
    ...(map.practice ? [map.practice.dummy, map.practice.cannon, map.practice.ring] : [])].filter(Boolean);
  return { buckets, cell, access };
}

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

export function shrubSite(map, x, z, radius = 1, ctx = context(map)) {
  if (![x, z, radius].every(Number.isFinite) || radius <= 0) return null;
  const y = map.heightAt(x, z), dx = (map.heightAt(x + radius, z) - map.heightAt(x - radius, z)) / (2 * radius);
  const dz = (map.heightAt(x, z + radius) - map.heightAt(x, z - radius)) / (2 * radius);
  if (![y, dx, dz].every(Number.isFinite) || Math.hypot(dx, dz) > 0.48) return null;
  for (let i = 0; i <= 8; i++) {
    const a = i * Math.PI / 4, px = x + (i === 8 ? 0 : Math.cos(a) * radius), pz = z + (i === 8 ? 0 : Math.sin(a) * radius);
    const mask = map.masks(px, pz), h = map.heightAt(px, pz);
    if (!['sand', 'grass'].includes(map.materialAt(px, pz)) || h < 0.36 || map.onDock?.(px, pz) ||
      mask.path > 0.15 || mask.volcanic > 0.2 || mask.arenaFloor > 0.1 || mask.lava > 0.1 ||
      Math.abs(h - y - dx * (px - x) - dz * (pz - z)) > 0.18) return null;
  }
  const l = map.landmarks || {};
  for (const [point, clear] of [[l.spawn, 6], [l.village, 8], [l.arena, (l.arenaR || 19) + 4], [map.cala, map.cala?.r + 1]])
    if (point && Math.hypot(x - point.x, z - point.z) < radius + clear) return null;
  if (l.dockBase && l.dockEnd && segmentDistance(x, z, l.dockBase, l.dockEnd) < radius + 3) return null;
  if (ctx.access.some((p) => Math.hypot(x - p.x, z - p.z) < radius + (p.r || 0.5) + 2)) return null;
  for (let ix = Math.floor((x - radius - 0.3) / ctx.cell); ix <= Math.floor((x + radius + 0.3) / ctx.cell); ix++)
    for (let iz = Math.floor((z - radius - 0.3) / ctx.cell); iz <= Math.floor((z + radius + 0.3) / ctx.cell); iz++)
      for (const p of ctx.buckets.get(`${ix},${iz}`) || [])
        if (Math.hypot(x - p.x, z - p.z) < radius + p.radius + 0.3) return null;
  const length = Math.hypot(dx, 1, dz);
  return { y: y - 0.05, nx: -dx / length, ny: 1 / length, nz: -dz / length };
}

export function buildShrubs(map, { limit = SHRUB_LIMIT } = {}) {
  const cap = Math.max(0, Math.min(SHRUB_LIMIT, Math.floor(limit) || 0));
  if (!cap) return [];
  const ctx = context(map), seed = map.seed | 0, candidates = [], existing = (map.props || []).filter((p) => p.kind === 'bush');
  const add = (x, z, scale, source, original = null) => {
    const radius = scale * 1.2, site = shrubSite(map, x, z, radius, ctx);
    if (!site) return;
    const r = rank(x, z, seed, 17), variant = map.materialAt(x, z) === 'sand' ? 1 : r < 0.48 ? 0 : r < 0.76 ? 1 : 2;
    candidates.push({ x, z, ...site, scale, radius, variant, rot: rank(x, z, seed, 53) * Math.PI * 2,
      source, original, rank: rank(x, z, seed, 89) });
  };
  for (const p of existing) add(p.x, p.z, Math.max(0.55, Math.min(1.05, p.scale * 0.8)), 'existing', p);
  const half = Math.min(200, Number.isFinite(map.half) ? map.half : 165);
  // A jittered grid plus a coarser patch hash gives dense pockets separated by open ground.
  for (let x = -half + 3; x < half - 3; x += 5) for (let z = -half + 3; z < half - 3; z += 5) {
    const patch = rank(Math.floor(x / 18), Math.floor(z / 18), seed, 103);
    if (rank(x, z, seed, 97) > 0.2 + patch * 0.68) continue;
    const px = x + (rank(x, z, seed, 31) - 0.5) * 3.6, pz = z + (rank(x, z, seed, 37) - 0.5) * 3.6;
    const scale = 0.58 + rank(px, pz, seed, 67) * 0.4, radius = scale * 1.2;
    if (existing.some((p) => Math.hypot(px - p.x, pz - p.z) < radius + 1.2 * Math.max(0.55, Math.min(1.05, p.scale * 0.8)) + 0.3)) continue;
    add(px, pz, scale, 'scatter');
  }
  candidates.sort((a, b) => (a.source === 'existing' ? 0 : 1) - (b.source === 'existing' ? 0 : 1) || a.rank - b.rank || a.x - b.x || a.z - b.z);
  const selected = [], buckets = new Map(), cell = 4;
  for (const p of candidates) {
    const ix = Math.floor(p.x / cell), iz = Math.floor(p.z / cell);
    let blocked = false;
    for (let dx = -1; dx <= 1 && !blocked; dx++) for (let dz = -1; dz <= 1 && !blocked; dz++)
      blocked = (buckets.get(`${ix + dx},${iz + dz}`) || []).some((o) => Math.hypot(p.x - o.x, p.z - o.z) < p.radius + o.radius + 0.2);
    if (blocked) continue;
    const { rank: ignored, ...item } = p; selected.push(item);
    const key = `${ix},${iz}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(p);
    if (selected.length === cap) break;
  }
  return selected;
}
