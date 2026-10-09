// Session-local gathering. These limits describe content availability, not accepted economic balance.
export const HARVEST = Object.freeze({ radius: 2.5, benchRadius: 3, respawnTicks: 3600,
  actionTicks: 30, maxNodes: 176, maxPalms: 96, maxStones: 64, palmHits: 3, palmYield: 2,
  chopTicks: 54, craftMax: 10, maxRev: 2147483647 });
export const RESOURCE_KINDS = Object.freeze({
  wood: Object.freeze({ name: 'Tronco', good: 'tronco', verb: 'Recoger tronco' }),
  stone: Object.freeze({ name: 'Piedra', good: 'piedra', verb: 'Recoger piedra' }),
  palm: Object.freeze({ name: 'Palmera', good: 'tronco', verb: 'Cortar palmera' }),
});
export const WOOD_RECIPE = Object.freeze({ id: 'madera', input: 'tronco', output: 'madera', count: 1 });

// Candidate ordering is derived from the seed without consuming world/map RNG.
function hash(seed, n) {
  let x = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function resourceLayout(map) {
  // Terrain reshaping preserves the admitted resource identities, order and horizontal positions.
  if (map.terrainResources) return { nodes: map.terrainResources.nodes.map(n => ({ ...n })),
    bench: map.terrainResources.bench ? { ...map.terrainResources.bench } : null };
  const nodes = [], spawn = map.landmarks.spawn, village = map.landmarks.village;
  const dx = village.x - spawn.x, dz = village.z - spawn.z, length = Math.hypot(dx, dz) || 1;
  const ux = dx / length, uz = dz / length, vx = -uz, vz = ux;
  const height = (x, z) => map.heightAt(x, z);
  const clear = (x, z, spacing = 3, ignoreCollider = -1, propSpacing = false) => {
    const y = height(x, z);
    if (![x, y, z].every(Number.isFinite) || y < 0.35 || map.onDock?.(x, z) || map.lawlessAt?.(x, z)) return false;
    if ((map.colliders || []).some((c, i) => i !== ignoreCollider && Math.hypot(x - c.x, z - c.z) < (c.r || 0) + 1.2)) return false;
    if ((map.npcs || []).some((n) => Math.hypot(x - n.x, z - n.z) < 4)) return false;
    if ((map.racks || []).some((p) => Math.hypot(x - p.x, z - p.z) < 4)) return false;
    const practice = map.practice || {};
    if ((practice.dummy && Math.hypot(x - practice.dummy.x, z - practice.dummy.z) < 6)
      || (practice.cannon && Math.hypot(x - practice.cannon.x, z - practice.cannon.z) < 5)
      || (practice.ring && Math.hypot(x - practice.ring.x, z - practice.ring.z) < (practice.ring.r || 0) + 3)) return false;
    const path = map.pathInfo?.(x, z);
    if (path && path.d < 5 && path.t > 0 && path.t < 1) return false;
    const lm = map.landmarks || {};
    for (const key of ['spawn', 'village', 'arena', 'volcano', 'dockBase', 'dockEnd']) {
      const p = lm[key]; if (p && Math.hypot(x - p.x, z - p.z) < (key === 'arena' ? (lm.arenaR || 0) + 10 : 7)) return false;
    }
    if (nodes.some((n) => Math.hypot(x - n.x, z - n.z) < spacing)) return false;
    if (propSpacing && (map.props || []).some((p) => Math.hypot(x - p.x, z - p.z) < Math.max(1.2, p.r || 0.4) + 1.4)) return false;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      if (Math.abs(height(x + ox, z + oz) - y) > .6) return false;
    return true;
  };
  let bench = null;
  for (const forward of [8, 12, 16, 20, 24]) for (const side of [-4, 4, -7, 7]) {
    const x = spawn.x + ux * forward + vx * side, z = spawn.z + uz * forward + vz * side;
    if (!bench && clear(x, z)) bench = { x, y: height(x, z), z };
  }
  const addLegacy = (x, z) => {
    if (nodes.length >= 16 || !clear(x, z, 4) || (bench && Math.hypot(x - bench.x, z - bench.z) < 5)) return;
    const kind = nodes.length % 3 === 2 ? 'stone' : 'wood';
    nodes.push({ id: `coast-${nodes.length + 1}`, kind, x, y: height(x, z), z });
  };
  for (const forward of [4, 9, 15, 21, 28]) for (const side of [-9, 9, -14, 14]) {
    if (nodes.length >= 16) break;
    addLegacy(spawn.x + ux * forward + vx * side, spawn.z + uz * forward + vz * side);
  }
  const phase = ((map.seed >>> 0) % 64) / 64 * Math.PI * 2;
  for (let i = 0; i < 64 && nodes.length < 16; i++) {
    const angle = phase + i * Math.PI * 2 / 64;
    const p = map.toWorld(Math.cos(angle) * 134, Math.sin(angle) * 92);
    if (height(p.x, p.z) <= 4) addLegacy(p.x, p.z);
  }

  // Existing painted palms become the harvest nodes. Ignore only each palm's own small trunk collider.
  let palms = 0;
  for (let i = 0; i < (map.props || []).length && palms < HARVEST.maxPalms && nodes.length < HARVEST.maxNodes; i++) {
    const p = map.props[i]; if (p.kind !== 'palm' || ![p.x, p.z, p.y, p.h, p.scale].every(Number.isFinite)) continue;
    const colliderIndex = (map.colliders || []).findIndex((c) => c.x === p.x && c.z === p.z && Math.abs((c.r || 0) - (p.r || 0)) < 1e-6);
    if (!clear(p.x, p.z, 4, colliderIndex) || (bench && Math.hypot(p.x - bench.x, p.z - bench.z) < 5)) continue;
    nodes.push({ id: `palm-${i}`, kind: 'palm', x: p.x, y: p.y, z: p.z, propIndex: i,
      scale: p.h / 6 * p.scale, rot: Number.isFinite(p.rot) ? p.rot : 0 });
    palms++;
  }

  // Deterministic grid jitter covers the full island. Props, paths/landmarks, NPCs, racks and slope checks
  // keep the extra stones clear of important play space; no world RNG or map data is mutated here.
  const candidates = [];
  let index = 0;
  for (let z = -150; z <= 150; z += 9) for (let x = -165; x <= 165; x += 9) {
    const h = hash(map.seed >>> 0, index++);
    candidates.push({ x: x + ((h & 255) / 255 - .5) * 5, z: z + (((h >>> 8) & 255) / 255 - .5) * 5, order: h, index: index - 1 });
  }
  candidates.sort((a, b) => a.order - b.order);
  let stones = 0;
  for (const p of candidates) {
    if (stones >= HARVEST.maxStones || nodes.length >= HARVEST.maxNodes) break;
    if (!clear(p.x, p.z, 4, -1, true)) continue;
    nodes.push({ id: `stone-${p.index}`, kind: 'stone', x: p.x, y: height(p.x, p.z), z: p.z }); stones++;
  }
  return { nodes, bench };
}
