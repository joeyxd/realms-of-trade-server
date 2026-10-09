// Small, painted coastal props. Placement is render-only and never consumes the world's RNG.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coastRockGeometry } from './coastRockGeometry.js';

export const BEACH_DETAIL_LIMITS = Object.freeze({ shells: 144, pebbles: 96 });
export const BEACH_SHELL_IDS = Object.freeze(['model:beach-shell-fan-v1', 'model:beach-shell-oval-v1', 'model:beach-shell-chip-v1']);
export const BEACH_PEBBLES_ID = 'model:beach-pebbles-v1';

export function shellGeometry(variant = 0) {
  if (![0, 1, 2].includes(variant)) throw new Error('Unknown shell variant');
  const oval = variant === 1, chip = variant === 2;
  const sectors = oval ? 12 : chip ? 6 : 10, rows = 3;
  const positions = [], colors = [];
  const ivory = new THREE.Color(0xf5dfb8), coral = new THREE.Color(0xc78068), edge = new THREE.Color(0x806957);
  const points = [], paints = [];
  // A folded, scalloped fan and a closed oval have different silhouettes at the same camera scale.
  const top = (t, k) => {
    const a = oval ? k / sectors * Math.PI * 2 : -1.32 + k / sectors * (chip ? 1.7 : 2.64);
    const r = t * (0.43 + 0.025 * Math.cos(k * Math.PI));
    const x = Math.sin(a) * r * (oval ? 0.73 : 1);
    const z = Math.cos(a) * r * (oval ? 1.1 : 1) - (oval ? 0 : 0.2);
    const ridge = k % 2 === 0 ? 0.014 : 0;
    const y = 0.025 + (1 - t * t) * (oval ? 0.105 : 0.08) + ridge * Math.sin(t * Math.PI / 2);
    return [x, y * (chip ? 0.65 : 1), z];
  };
  for (let j = 0; j <= rows; j++) {
    points[j] = []; paints[j] = [];
    for (let k = 0; k <= sectors; k++) {
      points[j][k] = top(j / rows, k);
      paints[j][k] = ivory.clone().lerp(coral, k % 3 === 0 ? 0.48 : 0.1).lerp(edge, j === rows ? 0.22 : 0);
    }
  }
  function triangle(a, b, c, ca, cb, cc, upward = true) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if ((ny < 0) === upward) { [b, c] = [c, b]; [cb, cc] = [cc, cb]; }
    for (const [p, color] of [[a, ca], [b, cb], [c, cc]]) { positions.push(...p); colors.push(color.r, color.g, color.b); }
  }
  for (let k = 0; k < sectors; k++) {
    triangle(points[0][k], points[1][k], points[1][k + 1], paints[0][k], paints[1][k], paints[1][k + 1]);
    for (let j = 1; j < rows; j++) {
      triangle(points[j][k], points[j + 1][k], points[j][k + 1], paints[j][k], paints[j + 1][k], paints[j][k + 1]);
      triangle(points[j][k + 1], points[j + 1][k], points[j + 1][k + 1], paints[j][k + 1], paints[j + 1][k], paints[j + 1][k + 1]);
    }
    const a = points[rows][k], b = points[rows][k + 1];
    const lowA = [a[0], 0, a[2]], lowB = [b[0], 0, b[2]], center = [0, 0, oval ? 0 : -0.2];
    // The dark skirt gives the edge thickness without an extra line or transparent bitmap.
    triangle(a, lowA, b, edge, edge, edge);
    triangle(b, lowA, lowB, edge, edge, edge);
    triangle(center, lowB, lowA, edge, edge, edge, false);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.beachStyle = ['fan', 'oval', 'chip'][variant];
  return geometry;
}

export function beachPebbleGeometry(source = null) {
  const parts = [], tones = [0x8d8479, 0xc4b69a, 0x726e73];
  const sizes = [[0.46, 0.2, 0.38], [0.29, 0.13, 0.26], [0.22, 0.1, 0.2]];
  const centers = [[-0.12, 0, 0], [0.2, 0, 0.1], [0.07, 0, -0.23]];
  for (let i = 0; i < 3; i++) {
    const fallback = source ? null : new THREE.IcosahedronGeometry(1, 0);
    const geo = coastRockGeometry(source || fallback, i);
    fallback?.dispose();
    const s = sizes[i]; geo.scale(s[0], s[1] / [0.78, 0.56, 0.36][i], s[2]);
    geo.rotateY(i * 1.9); geo.translate(...centers[i]);
    const color = new THREE.Color(tones[i]), colors = geo.getAttribute('color');
    for (let j = 0; j < colors.count; j++) {
      const light = 0.82 + Math.max(0, geo.getAttribute('normal').getY(j)) * 0.3;
      colors.setXYZ(j, color.r * light, color.g * light, color.b * light);
    }
    parts.push(geo);
  }
  const result = mergeGeometries(parts, false); parts.forEach((p) => p.dispose());
  result.computeBoundingBox(); result.computeBoundingSphere();
  result.userData.beachStyle = source ? 'SM_Rock-cluster' : 'procedural-cluster';
  return result;
}

function hash(x, z, seed, salt = 0) {
  let n = (Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ seed ^ salt) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 2246822507) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 3266489909) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function beachDetailEligible(map, x, z, radius = 0.6) {
  if (map.onDock?.(x, z) || map.materialAt(x, z) !== 'sand') return false;
  const m = map.masks(x, z), y = map.heightAt(x, z);
  if (y < 0.22 || y > 1.38 || m.path >= 0.12 || m.volcanic >= 0.15 || m.arenaFloor >= 0.1 || m.lava >= 0.1) return false;
  const e = radius, dx = (map.heightAt(x + e, z) - map.heightAt(x - e, z)) / (2 * e);
  const dz = (map.heightAt(x, z + e) - map.heightAt(x, z - e)) / (2 * e);
  if (Math.hypot(dx, dz) > 0.22) return false;
  // Keep the whole prop on exposed sand and leave the tutorial, spawn and access points readable.
  for (const [ox, oz] of [[e, 0], [-e, 0], [0, e], [0, -e]]) {
    const h = map.heightAt(x + ox, z + oz), mask = map.masks(x + ox, z + oz);
    if (h < 0.18 || h > 1.45 || mask.path >= 0.12 || map.materialAt(x + ox, z + oz) !== 'sand') return false;
  }
  const spawn = map.landmarks?.spawn;
  if (spawn && Math.hypot(x - spawn.x, z - spawn.z) < 2.5) return false;
  const practice = map.practice;
  if (practice && [practice.dummy, practice.cannon, practice.ring].some((p) => p && Math.hypot(x - p.x, z - p.z) < (p.r || 0) + 2)) return false;
  if (map.racks?.some((p) => Math.hypot(x - p.x, z - p.z) < 1.5)) return false;
  if (map.npcs?.some((p) => Math.hypot(x - p.x, z - p.z) < 1.5)) return false;
  if (map.props?.some((p) => !['seaweed', 'pebble', 'flower'].includes(p.kind) && Math.hypot(x - p.x, z - p.z) < Math.max(0.65, (p.r || 0.4) + radius + 0.15))) return false;
  return true;
}

export function buildBeachDetails(map) {
  const candidates = [], seed = map.seed | 0, step = 4;
  const half = Math.min(map.half || 190, 190);
  for (let iz = Math.ceil(-half / step); iz <= Math.floor(half / step); iz++) {
    for (let ix = Math.ceil(-half / step); ix <= Math.floor(half / step); ix++) {
      const rank = hash(ix, iz, seed, 139);
      if (rank > 0.38) continue;
      const x = (ix + hash(ix, iz, seed, 29) * 0.72 - 0.36) * step;
      const z = (iz + hash(ix, iz, seed, 43) * 0.72 - 0.36) * step;
      if (!beachDetailEligible(map, x, z)) continue;
      const dx = (map.heightAt(x + 0.6, z) - map.heightAt(x - 0.6, z)) / 1.2;
      const dz = (map.heightAt(x, z + 0.6) - map.heightAt(x, z - 0.6)) / 1.2;
      const normal = new THREE.Vector3(-dx, 1, -dz).normalize();
      candidates.push({ x, y: map.heightAt(x, z) - 0.008, z, scale: 0.78 + hash(ix, iz, seed, 71) * 0.4,
        rot: hash(ix, iz, seed, 89) * Math.PI * 2, variant: Math.floor(hash(ix, iz, seed, 97) * 3),
        nx: normal.x, ny: normal.y, nz: normal.z, rank, family: hash(ix, iz, seed, 101) < 0.62 ? 'shells' : 'pebbles' });
    }
  }
  // Lowest hashes win, so reaching the fixed budget cannot favour the first scanned corner of the island.
  candidates.sort((a, b) => a.rank - b.rank);
  const result = { shells: [], pebbles: [] };
  for (const { rank, family, ...p } of candidates) if (result[family].length < BEACH_DETAIL_LIMITS[family]) result[family].push(p);
  return result;
}
