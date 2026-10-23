// Exposed roots and small leaf rosettes. All geometry/placement is cosmetic and RNG-independent.
import * as THREE from 'three';

export const PALM_BASE_STYLES = ['open', 'lush'];
export const PALM_BASE_IDS = PALM_BASE_STYLES.map((s) => `model:palm-base-${s}-v1`);
export const PALM_BASE_LIMIT = 144;

function builder() {
  const pos = [], colors = [], uv = [], flex = [], paint = [];
  return {
    tri(a, b, c) {
      for (const v of [a, b, c]) {
        pos.push(...v.p); colors.push(...v.c); uv.push(...v.uv); flex.push(v.flex || 0); paint.push(0, 0);
      }
    },
    finish() {
      const g = new THREE.BufferGeometry();
      for (const [n, values, size] of [['position', pos, 3], ['color', colors, 3], ['uv', uv, 2], ['aFlex', flex, 1], ['aPaint', paint, 2]])
        g.setAttribute(n, new THREE.Float32BufferAttribute(values, size));
      g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
    },
  };
}

export function palmBaseGeometry(variant = 0, { cards = true } = {}) {
  if (![0, 1].includes(variant)) throw new Error('Unknown palm base variant');
  const roots = builder(), leaves = builder();
  const wood = new THREE.Color(0xb8783b), green = new THREE.Color(0x66a833), lime = new THREE.Color(0xa5c83d);
  // The roots borrow S05's trunk quadrant, including its ink and warm grain; no ground disk is baked in.
  const rootUV = (u, t) => [1 / 64 + u * 15 / 32, 0.5 + 1 / 64 + t * 15 / 32];
  const tube = (angle, start, length, radius, phase) => {
    const rows = 5, sides = 5, rings = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows, bend = Math.sin(t * Math.PI) * 0.09;
      const x = Math.cos(angle) * (start + t * length) - Math.sin(angle) * bend;
      const z = Math.sin(angle) * (start + t * length) + Math.cos(angle) * bend;
      const y = 0.025 + 0.20 * Math.pow(1 - t, 2), r = radius * (1 - t * 0.92);
      rings[j] = [];
      for (let k = 0; k <= sides; k++) {
        const a = k / sides * Math.PI * 2;
        const c = wood.clone().multiplyScalar(0.78 + Math.max(0, Math.cos(a)) * 0.32);
        rings[j].push({ p: [x - Math.sin(angle) * Math.sin(a) * r, y + Math.cos(a) * r * 0.7, z + Math.cos(angle) * Math.sin(a) * r],
          c: c.toArray(), uv: rootUV(k / sides, 0.12 + t * 0.73 + phase), flex: 0 });
      }
    }
    for (let j = 0; j < rows; j++) for (let k = 0; k < sides; k++) {
      roots.tri(rings[j][k], rings[j][k + 1], rings[j + 1][k]);
      roots.tri(rings[j][k + 1], rings[j + 1][k + 1], rings[j + 1][k]);
    }
  };
  const rootCount = 5 + variant;
  for (let i = 0; i < rootCount; i++) tube(i / rootCount * Math.PI * 2 + 0.2, 0.16,
    0.66 + (i % 3) * 0.15, 0.115 + (i % 2) * 0.018, (i % 2) * 0.05);

  // Two or three off-centre rosettes keep open sand between roots and leave the stem readable.
  const centers = variant ? [[0.48, 0.24], [-0.47, 0.19], [0.02, -0.54]] : [[0.48, 0.24], [-0.33, -0.46]];
  for (const [plant, center] of centers.entries()) for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2 + plant * 1.6, length = 0.46 + (i % 3) * 0.13;
    const height = 0.36 + (i % 2) * 0.19, width = 0.105 + (i % 2) * 0.025;
    const rows = 4, grid = [], tile = (i + plant) % 2;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows, extent = cards ? width : width * (0.06 + 0.94 * Math.sin(Math.PI * t));
      grid[j] = [];
      for (let k = 0; k < 3; k++) {
        const side = k - 1, distance = length * t;
        const color = green.clone().lerp(lime, t * 0.7);
        grid[j].push({ p: [center[0] + Math.cos(angle) * distance - Math.sin(angle) * side * extent,
          0.12 + height * Math.sin(t * Math.PI * 0.72) - Math.abs(side) * 0.05 * Math.sin(Math.PI * t),
          center[1] + Math.sin(angle) * distance + Math.cos(angle) * side * extent], c: color.toArray(), flex: t * t * 0.62,
          // Two horizontal leaf tiles, each with 1/32 inset and 15/16 vertical span. TextureLoader flipY=true.
          uv: [tile * 0.5 + 1 / 64 + (k / 2) * 15 / 32, 1 / 32 + t * 15 / 16] });
      }
    }
    for (let j = 0; j < rows; j++) for (let k = 0; k < 2; k++) {
      leaves.tri(grid[j][k], grid[j][k + 1], grid[j + 1][k]);
      leaves.tri(grid[j][k + 1], grid[j + 1][k + 1], grid[j + 1][k]);
    }
  }
  return { roots: roots.finish(), leaves: leaves.finish() };
}

export function loadedPalmBaseGeometry(data) {
  if (data?.parts?.length !== 2) return null;
  const sources = data.parts.map((p) => p.geo);
  for (const g of sources) {
    const count = g?.attributes?.position?.count;
    if (!count || g.attributes.position.itemSize !== 3 || [['normal', 3], ['color', 3], ['uv', 2], ['_flex', 1]]
      .some(([n, size]) => g.attributes[n]?.count !== count || g.attributes[n]?.itemSize !== size)) return null;
  }
  const copies = sources.map((g) => {
    const copy = g.clone(); copy.setAttribute('aFlex', copy.getAttribute('_flex')); copy.deleteAttribute('_flex');
    if (copy.getAttribute('_paint')) { copy.setAttribute('aPaint', copy.getAttribute('_paint')); copy.deleteAttribute('_paint'); }
    copy.computeBoundingBox(); copy.computeBoundingSphere(); return copy;
  });
  return { roots: copies[0], leaves: copies[1] };
}

function rank(p, seed, salt = 0) {
  let n = Math.imul(Math.round(p.x * 100), 73856093) ^ Math.imul(Math.round(p.z * 100), 19349663) ^ seed ^ salt;
  n = Math.imul(n ^ (n >>> 16), 2246822507); n = Math.imul(n ^ (n >>> 13), 3266489909);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function buildPalmBases(map, { limit = PALM_BASE_LIMIT } = {}) {
  const result = [];
  for (const p of map.props) {
    if (p.kind !== 'palm') continue;
    const scale = (p.h / 6) * p.scale, radius = scale * 1.32;
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1.4) continue;
    const y = map.heightAt(p.x, p.z), dx = (map.heightAt(p.x + radius, p.z) - map.heightAt(p.x - radius, p.z)) / (2 * radius);
    const dz = (map.heightAt(p.x, p.z + radius) - map.heightAt(p.x, p.z - radius)) / (2 * radius);
    if (Math.hypot(dx, dz) > 0.28 || Math.abs(p.y - y) > 0.12) continue;
    let fits = true;
    for (let j = 0; j <= 12; j++) {
      const a = j / 12 * Math.PI * 2, x = p.x + (j === 12 ? 0 : Math.cos(a) * radius), z = p.z + (j === 12 ? 0 : Math.sin(a) * radius);
      const m = map.masks(x, z), h = map.heightAt(x, z);
      if (map.onDock?.(x, z) || !['sand', 'grass'].includes(map.materialAt(x, z)) || h < 0.3 || m.path > 0.16 || m.volcanic > 0.15 || m.arenaFloor > 0.1 || m.lava > 0.1 ||
        Math.abs(h - y - dx * (x - p.x) - dz * (z - p.z)) > 0.07) { fits = false; break; }
    }
    if (!fits) continue;
    const nearby = [...(map.npcs || []), ...(map.racks || []), ...(map.practice ? [map.practice.dummy, map.practice.cannon, map.practice.ring] : [])];
    if (nearby.some((o) => o && Math.hypot(p.x - o.x, p.z - o.z) < radius + (o.r || 0.5) + 0.8)) continue;
    if (map.landmarks?.spawn && Math.hypot(p.x - map.landmarks.spawn.x, p.z - map.landmarks.spawn.z) < radius + 2.5) continue;
    if (map.props.some((o) => o !== p && !['flower', 'seaweed', 'pebble'].includes(o.kind) && Math.hypot(p.x - o.x, p.z - o.z) < radius + (o.r || 0.4) + 0.15)) continue;
    const n = new THREE.Vector3(-dx, 1, -dz).normalize();
    result.push({ x: p.x, y: p.y - 0.1, z: p.z, rot: p.rot, scale, nx: n.x, ny: n.y, nz: n.z,
      variant: rank(p, map.seed | 0, 41) < 0.55 ? 0 : 1, rank: rank(p, map.seed | 0, 89) });
  }
  result.sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z);
  return result.slice(0, Math.max(0, Math.min(PALM_BASE_LIMIT, Math.floor(limit) || 0))).map(({ rank: ignored, ...p }) => p);
}
