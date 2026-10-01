// Deterministic island generation. Pure: shared by the worker (authoritative sim), the client
// (prediction + rendering) and node tests. Same seed => bit-identical world.
import { tuning } from '../data/tuning.js';
import { makeNoise2D } from './noise.js';
import { mulberry32 } from '../core/rng.js';
import { smoothstep, clamp01, lerp } from '../core/math.js';

const S = Math.SQRT1_2;
// Design frame: u = toward screen-up (north-west), v = toward screen-right (north-east).
export const toWorld = (u, v) => ({ x: -S * u + S * v, z: -S * u - S * v });
export const toUV = (x, z) => ({ u: -S * x - S * z, v: S * x - S * z });

export const ZONES = {
  playa: { name: 'Playa de la Marea', sub: 'Donde la corriente deja a los náufragos' },
  aldea: { name: 'Aldea Coralina', sub: 'Puerto de pescadores y piratas retirados' },
  camino: { name: 'Sendero del Humo', sub: 'Sigue el humo hasta el volcán' },
  selva: { name: 'Selva Esmeralda', sub: 'Algo se mueve entre las palmas' },
  caldera: { name: 'La Caldera', sub: 'Solo los valientes salen con el cofre' },
  mar: { name: 'Mar Turquesa', sub: '' },
};

// Layout in (u, v). Tuned so the walk goes "up the screen": beach → village → path → arena.
const L = {
  spawn: [-139, 6],
  village: [-100, -6],
  dockBase: [-139, 20],
  dockEnd: [-171, 24],
  ship: [-181, 27],
  captain: [-140, 15],
  vendor: [-95, 9],
  campfire: [-101, -7],
  arena: [25, 0],
  arenaR: 19,
  volcano: [84, 6],
  path: [[-88, -3], [-72, 6], [-55, -5], [-37, 5], [-20, -4], [-6, 1], [3, 0]],
  sign: [-85, 4],
};

function segDist(px, pz, ax, az, bx, bz, out) {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp01(t);
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  out.t = t;
  return Math.sqrt(dx * dx + dz * dz);
}

export function generateWorld(seed) {
  const W = tuning.world;
  const size = W.size, half = size / 2;
  const res = W.gridRes;
  const N = size * res + 1;
  const { fbm, noise } = makeNoise2D(seed);
  const { fbm: fbm2 } = makeNoise2D(seed ^ 0x51ed);

  const P = (uv) => toWorld(uv[0], uv[1]);
  const spawn = P(L.spawn), village = P(L.village), arena = P(L.arena), volcano = P(L.volcano);
  const dockBase = P(L.dockBase), dockEnd = P(L.dockEnd);
  const path = L.path.map(P);
  const pathLen = [];
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    pathLen.push(acc);
    acc += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
  }
  const pathTotal = acc;
  const tmp = { t: 0 };

  // Distance to the path polyline + progress along it (0..1).
  function pathInfo(x, z) {
    let best = 1e9, prog = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const d = segDist(x, z, path[i].x, path[i].z, path[i + 1].x, path[i + 1].z, tmp);
      if (d < best) {
        best = d;
        const segL = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
        prog = (pathLen[i] + tmp.t * segL) / pathTotal;
      }
    }
    return { d: best, t: prog };
  }

  const dockDist = (x, z) => segDist(x, z, dockBase.x, dockBase.z, dockEnd.x, dockEnd.z, tmp);
  // Meandering lava river from the crater lip down to the back of the arena.
  const lavaPath = [[80, 5], [73, 1], [66, 7], [58, 2], [51, 6], [46, 3]].map(P);
  const lavaRiverDist = (x, z) => {
    let best = 1e9;
    for (let i = 0; i < lavaPath.length - 1; i++) {
      const d = segDist(x, z, lavaPath[i].x, lavaPath[i].z, lavaPath[i + 1].x, lavaPath[i + 1].z, tmp);
      if (d < best) best = d;
    }
    return best;
  };

  function rawHeight(x, z) {
    const { u, v } = toUV(x, z);
    const nearDock = 1 - smoothstep(10, 40, Math.hypot(x - dockBase.x, z - dockBase.z));
    const coastNoise = fbm(x * 0.011 + 7.3, z * 0.011 - 2.1, 3) * 0.1 * (1 - 0.85 * nearDock);
    const e = Math.sqrt((u / 150) * (u / 150) + (v / 105) * (v / 105)) + coastNoise;
    const ct = 1 - e;
    let h = lerp(-7.5, 0.7, smoothstep(-0.11, 0.025, ct));
    h += 1.9 * smoothstep(0.05, 0.16, ct);
    const hill = clamp01(fbm(x * 0.02 + 3.1, z * 0.02 - 1.7, 4) * 0.6 + 0.5);
    const pi = pathInfo(x, z);
    const dv = Math.hypot(x - village.x, z - village.z);
    const da = Math.hypot(x - arena.x, z - arena.z);
    const dvol = Math.hypot(x - volcano.x, z - volcano.z);
    h += 6.5 * Math.pow(hill, 1.5) * smoothstep(0.08, 0.3, ct);

    // Village plateau.
    h = lerp(h, 2.4, 1 - smoothstep(16, 30, dv));
    // Path: gentle ramp from the village to the arena gate.
    const pathH = lerp(2.4, 4.6, pi.t);
    h = lerp(h, pathH, 1 - smoothstep(3.0, 9.5, pi.d));
    // Volcano cone with crater.
    const ang = Math.atan2(z - volcano.z, x - volcano.x);
    const ridges = 1 + 0.07 * Math.sin(ang * 9 + fbm2(x * 0.03, z * 0.03, 2) * 4) * smoothstep(6, 20, dvol);
    const cone = 36 * Math.pow(1 - smoothstep(0, 62, dvol), 1.7) * ridges;
    h += cone + fbm2(x * 0.08, z * 0.08, 2) * 1.2 * smoothstep(8, 30, dvol) * (1 - smoothstep(30, 60, dvol));
    h -= 9 * (1 - smoothstep(0, 8.5, dvol));
    // Lava river from the crater towards the back of the arena.
    const lr = lavaRiverDist(x, z);
    h -= 1.4 * (1 - smoothstep(1.2, 3.6, lr)) * smoothstep(9, 14, dvol);

    // Arena: flat basalt floor, rim higher on the far (north-west) side, gap at the gate.
    const ax = (x - arena.x) / Math.max(da, 1e-6), az = (z - arena.z) / Math.max(da, 1e-6);
    const side = -S * ax - S * az; // +1 = far side (screen-up), -1 = camera side
    const across = Math.abs(S * (x - arena.x) - S * (z - arena.z)); // |v| relative to the arena
    let rimH = lerp(0.9, 4.8, smoothstep(-0.3, 0.8, side));
    const gate = side < -0.5 ? 1 - smoothstep(2.6, 5.0, across) : 0;
    rimH *= 1 - gate;
    const arenaProfile = 4.6 + rimH * smoothstep(L.arenaR, L.arenaR + 2.6, da);
    h = lerp(h, arenaProfile, 1 - smoothstep(L.arenaR + 4.5, L.arenaR + 14, da));
    // Tiny surface detail.
    h += noise(x * 0.35, z * 0.35) * 0.06 * smoothstep(0.0, 0.05, ct);
    return h;
  }

  // Heightfield (sampled at gridRes per unit).
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = -half + j / res;
    for (let i = 0; i < N; i++) {
      const x = -half + i / res;
      heights[j * N + i] = rawHeight(x, z);
    }
  }

  function heightAt(x, z) {
    let fx = (x + half) * res, fz = (z + half) * res;
    if (fx < 0) fx = 0; else if (fx > N - 1.001) fx = N - 1.001;
    if (fz < 0) fz = 0; else if (fz > N - 1.001) fz = N - 1.001;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * N + i;
    const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + N], h11 = heights[k + N + 1];
    return (h00 + (h10 - h00) * tx) * (1 - tz) + (h01 + (h11 - h01) * tx) * tz;
  }

  // Walkable deck of the dock (oriented rectangle) at a fixed height.
  const dockDir = { x: dockEnd.x - dockBase.x, z: dockEnd.z - dockBase.z };
  const dockLen = Math.hypot(dockDir.x, dockDir.z);
  dockDir.x /= dockLen; dockDir.z /= dockLen;
  const dock = { base: dockBase, end: dockEnd, dir: dockDir, len: dockLen, halfWidth: 1.7, deckY: 1.05 };
  function onDock(x, z) {
    const rx = x - dockBase.x, rz = z - dockBase.z;
    const along = rx * dockDir.x + rz * dockDir.z;
    const across = -rx * dockDir.z + rz * dockDir.x;
    return along > -1.5 && along < dockLen && Math.abs(across) < dock.halfWidth;
  }
  function groundAt(x, z) {
    const h = heightAt(x, z);
    return onDock(x, z) ? Math.max(h, dock.deckY) : h;
  }

  // Shading / gameplay masks (used by the terrain shader and footstep materials).
  function masks(x, z) {
    const pi = pathInfo(x, z);
    const onPath = pi.t > 0.0 && pi.t < 1.0 ? 1 - smoothstep(1.5, 2.7, pi.d) : 0;
    const dv = Math.hypot(x - village.x, z - village.z);
    const da = Math.hypot(x - arena.x, z - arena.z);
    const dvol = Math.hypot(x - volcano.x, z - volcano.z);
    const villageDirt = (1 - smoothstep(8, 15, dv)) * clamp01(0.75 + fbm2(x * 0.15, z * 0.15, 2));
    const volcanic = Math.max(1 - smoothstep(L.arenaR + 6, L.arenaR + 20, da), 1 - smoothstep(26, 60, dvol));
    const arenaFloor = 1 - smoothstep(L.arenaR - 0.5, L.arenaR + 0.5, da);
    const lava = Math.max(1 - smoothstep(1.3, 2.4, lavaRiverDist(x, z)), 1 - smoothstep(5.5, 7.5, dvol));
    return { path: Math.max(onPath, villageDirt * 0.85), volcanic, arenaFloor, lava };
  }

  function materialAt(x, z) {
    const h = groundAt(x, z);
    if (onDock(x, z)) return 'wood';
    if (h < -0.05) return 'water';
    const m = masks(x, z);
    if (m.volcanic > 0.5 || m.arenaFloor > 0.5) return 'rock';
    if (m.path > 0.5) return 'dirt';
    if (h < 1.5) return 'sand';
    return 'grass';
  }

  function zoneAt(x, z) {
    const h = groundAt(x, z);
    if (h < -tuning.world.wadeMax && !onDock(x, z)) return 'mar';
    if (Math.hypot(x - arena.x, z - arena.z) < L.arenaR + 8) return 'caldera';
    if (Math.hypot(x - village.x, z - village.z) < 30) return 'aldea';
    const pi = pathInfo(x, z);
    if (pi.d < 9 && pi.t > 0.02 && pi.t < 0.99) return 'camino';
    if (h < 1.6 || onDock(x, z)) return 'playa';
    return 'selva';
  }

  // ---- Props ---------------------------------------------------------------------------------
  const props = [];
  const colliders = [];
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const occ = new Map(); // coarse spacing grid
  const cellKey = (x, z, c) => `${Math.floor(x / c)},${Math.floor(z / c)}`;
  function farFromOthers(x, z, minD, kindSet) {
    const c = 4;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const list = occ.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const p of list) {
        const need = kindSet ? (kindSet.has(p.kind) ? minD : Math.max(p.r + 0.6, 1.2)) : minD;
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < need * need) return false;
      }
    }
    return true;
  }
  function addProp(kind, x, z, opts = {}) {
    const p = {
      kind, x, z,
      y: opts.y ?? groundAt(x, z),
      rot: opts.rot ?? rng() * Math.PI * 2,
      scale: opts.scale ?? 1,
      r: opts.r ?? 0,
      v: opts.v ?? rng(), // variant seed
      h: opts.h ?? 0,
    };
    props.push(p);
    const key = cellKey(x, z, 4);
    if (!occ.has(key)) occ.set(key, []);
    occ.get(key).push(p);
    if (p.r > 0) colliders.push({ x, z, r: p.r });
    return p;
  }
  const slopeAt = (x, z) => {
    const e = 0.75;
    return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  };

  // Fixed village layout.
  const V = (du, dv) => P([L.village[0] + du, L.village[1] + dv]);
  const huts = [[10, -11, 0.4], [-2, -15, 1.3], [-12, -8, 2.2], [-11, 9, 3.4], [13, 11, 5.6], [2, 17, 4.6]];
  for (const [du, dv, rot] of huts) { const p = V(du, dv); addProp('hut', p.x, p.z, { r: 2.6, rot, scale: 1 }); }
  { const p = P(L.campfire); addProp('campfire', p.x, p.z, { r: 0.9, rot: 0 }); }
  for (const [du, dv] of [[4, 6], [5, 7.4], [-6, 3], [8, -4], [-4, -5.5]]) {
    const p = V(du, dv); addProp(rng() < 0.5 ? 'crate' : 'barrel', p.x, p.z, { r: 0.6 });
  }
  { const p = P(L.vendor); addProp('stall', p.x, p.z, { r: 1.8, rot: Math.PI * 0.25 + Math.PI }); }
  // Lanterns lining the walk from the beach to the village and on the dock.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const p = P([lerp(-133, -108, t), lerp(12, 3, t) + (i % 2 ? 2.6 : -2.6)]);
    addProp('lantern', p.x, p.z, { r: 0.3, rot: 0 });
  }
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    const bx = lerp(dockBase.x, dockEnd.x, t), bz = lerp(dockBase.z, dockEnd.z, t);
    for (const s of [-1, 1]) {
      addProp('dockPost', bx - dockDir.z * s * 1.75, bz + dockDir.x * s * 1.75, { r: 0.28, y: dock.deckY, rot: 0 });
    }
  }
  { const p = P(L.ship); addProp('ship', p.x, p.z, { y: 0, rot: Math.atan2(dockDir.x, dockDir.z) + Math.PI / 2, r: 0 }); }
  { const p = P(L.sign); addProp('sign', p.x, p.z, { r: 0.35, rot: Math.PI * 0.75 }); }
  // Caldera dressing: braziers and basalt pillars around the rim (skipping the gate gap).
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    const dir = { u: Math.cos(a), v: Math.sin(a) };
    if (dir.u < -0.82) continue; // gate gap (camera side)
    const p = P([L.arena[0] + dir.u * (L.arenaR - 1.2), L.arena[1] + dir.v * (L.arenaR - 1.2)]);
    addProp('brazier', p.x, p.z, { r: 0.55, y: 4.6 });
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.12;
    const dir = { u: Math.cos(a), v: Math.sin(a) };
    if (dir.u < -0.72) continue;
    const far = smoothstep(-0.3, 0.9, dir.u);
    const p = P([L.arena[0] + dir.u * (L.arenaR + 1.6), L.arena[1] + dir.v * (L.arenaR + 1.6)]);
    addProp('pillar', p.x, p.z, { r: 1.0, h: lerp(1.6, 5.5, far) * (0.8 + rng() * 0.4), y: heightAt(p.x, p.z) - 0.3 });
  }
  {
    const g1 = P([L.arena[0] - L.arenaR - 1.6, -3.6]), g2 = P([L.arena[0] - L.arenaR - 1.6, 3.6]);
    addProp('gatePost', g1.x, g1.z, { r: 0.8, rot: 0, h: 4.2 });
    addProp('gatePost', g2.x, g2.z, { r: 0.8, rot: 0, h: 4.2 });
    const g = P([L.arena[0] - L.arenaR - 1.6, 0]);
    addProp('gate', g.x, g.z, { r: 0, rot: Math.atan2(g2.x - g1.x, g2.z - g1.z) });
  }

  // Scattered vegetation and rocks (rejection sampling, deterministic).
  const palms = new Set(['palm']);
  const excl = (x, z, padPath, padVillage) => {
    const pi = pathInfo(x, z);
    if (pi.d < padPath && pi.t > 0.0 && pi.t < 1.0) return true;
    if (Math.hypot(x - village.x, z - village.z) < padVillage) return true;
    if (Math.hypot(x - arena.x, z - arena.z) < L.arenaR + 9) return true;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 7) return true;
    if (dockDist(x, z) < 5) return true;
    return false;
  };
  for (let n = 0; n < 5200; n++) {
    const x = rng.range(-170, 170), z = rng.range(-170, 170);
    const h = heightAt(x, z);
    if (h < 0.45) continue;
    const { u, v } = toUV(x, z);
    const e = Math.sqrt((u / 150) ** 2 + (v / 105) ** 2);
    const ct = 1 - e;
    const dvol = Math.hypot(x - volcano.x, z - volcano.z);
    let p = ct < 0.1 ? 0.5 : 0.09;
    if (dvol < 48) p *= 0.12;
    if (slopeAt(x, z) > 0.55) continue;
    if (excl(x, z, 4.6, 15)) continue;
    if (rng() > p) continue;
    if (!farFromOthers(x, z, 3.4, palms)) continue;
    addProp('palm', x, z, { r: 0.38, scale: rng.range(0.85, 1.15), h: rng.range(3.9, 5.6) });
  }
  // A few hand-placed palms framing the village and the spawn.
  for (const [du, dv] of [[-18, 4], [16, -3], [6, -20], [-6, 20], [19, 15]]) {
    const p = V(du, dv);
    if (farFromOthers(p.x, p.z, 3.4, palms)) addProp('palm', p.x, p.z, { r: 0.38, scale: 1.05, h: 5.4 });
  }
  const bushSet = new Set(['bush']);
  for (let n = 0; n < 8000; n++) {
    const x = rng.range(-165, 165), z = rng.range(-165, 165);
    const h = heightAt(x, z);
    if (h < 1.6) continue;
    const pi = pathInfo(x, z);
    const dvol = Math.hypot(x - volcano.x, z - volcano.z);
    let p = 0.17;
    if (pi.d > 3.6 && pi.d < 9 && pi.t > 0.02 && pi.t < 0.98) p = 0.65;
    if (dvol < 45) p *= 0.15;
    if (slopeAt(x, z) > 0.7) continue;
    if (excl(x, z, 3.4, 14)) continue;
    if (rng() > p) continue;
    if (!farFromOthers(x, z, 1.9, bushSet)) continue;
    addProp('bush', x, z, { r: 0.55, scale: rng.range(0.7, 1.35) });
  }
  const rockSet = new Set(['rock']);
  for (let n = 0; n < 1400; n++) {
    const x = rng.range(-165, 165), z = rng.range(-165, 165);
    const h = heightAt(x, z);
    if (h < -1.2) continue;
    const m = masks(x, z);
    let p = 0.07 + m.volcanic * 0.4;
    if (m.lava > 0.3) continue;
    if (excl(x, z, 3.2, 13)) continue;
    if (rng() > p) continue;
    if (!farFromOthers(x, z, 3.0, rockSet)) continue;
    const s = rng.range(0.6, 1.9) * (1 + m.volcanic * 0.5);
    addProp('rock', x, z, { r: 0.55 * s, scale: s, y: h - 0.15 * s });
  }
  for (let n = 0; n < 9000; n++) {
    const x = rng.range(-170, 170), z = rng.range(-170, 170);
    const h = heightAt(x, z);
    if (h < 1.7) continue;
    const pi = pathInfo(x, z);
    const dv = Math.hypot(x - village.x, z - village.z);
    const nearPath = pi.d > 2.5 && pi.d < 5.5 && pi.t > 0 && pi.t < 0.9;
    const nearVillage = dv > 6 && dv < 22;
    if (!nearPath && !nearVillage) continue;
    if (!farFromOthers(x, z, 0.9, null)) continue;
    if (rng() > 0.45) continue;
    addProp('flower', x, z, { r: 0, scale: rng.range(0.7, 1.2) });
  }

  // Underwater dressing (cosmetic, no colliders): seaweed and pebbles in the shallows so the
  // refraction has something to show. Seaweed stays well below the surface (no foam rings).
  const weedSet = new Set(['seaweed']);
  for (let n = 0; n < 40000; n++) {
    const x = rng.range(-185, 185), z = rng.range(-185, 185);
    const h = heightAt(x, z);
    if (h > -0.75 || h < -3.2) continue;
    if (dockDist(x, z) < 2.5) continue;
    if (rng() > (fbm2(x * 0.05, z * 0.05, 2) > 0 ? 0.55 : 0.08)) continue;
    if (!farFromOthers(x, z, 1.3, weedSet)) continue;
    const maxH = (-h - 0.4) / 1.1;
    addProp('seaweed', x, z, { r: 0, y: h, scale: Math.min(rng.range(0.6, 1.25), maxH) });
  }
  for (let n = 0; n < 30000; n++) {
    const x = rng.range(-185, 185), z = rng.range(-185, 185);
    const h = heightAt(x, z);
    if (h > 0.25 || h < -2.4) continue;
    if (rng() > 0.3) continue;
    if (!farFromOthers(x, z, 0.8, null)) continue;
    addProp('pebble', x, z, { r: 0, y: h, scale: rng.range(0.6, 1.6) });
  }
  // Floating cargo and a rowboat tied to the dock (they bob; the water foams around them).
  {
    const off = (along, across) => ({ x: dockBase.x + dockDir.x * along - dockDir.z * across, z: dockBase.z + dockDir.z * along + dockDir.x * across });
    const floats = [['barrel', 14, 3.6], ['crate', 19, -3.8], ['barrel', 25, -4.4], ['crate', 30, 4.2], ['rowboat', 12, 3.4]];
    for (const [kind, along, across] of floats) {
      const p = off(along, across);
      addProp('float', p.x, p.z, { r: 0, y: 0, v: rng(), h: kind === 'rowboat' ? 1 : kind === 'crate' ? 2 : 3, rot: kind === 'rowboat' ? Math.atan2(dockDir.x, dockDir.z) + 0.12 : rng() * 6.28 });
    }
  }

  // Static collider spatial hash.
  const CELL = 4;
  const grid = new Map();
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const x0 = Math.floor((c.x - c.r) / CELL), x1 = Math.floor((c.x + c.r) / CELL);
    const z0 = Math.floor((c.z - c.r) / CELL), z1 = Math.floor((c.z + c.r) / CELL);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const k = gx * 73856093 ^ gz * 19349663;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  }
  const queryOut = [];
  function queryColliders(x, z, r) {
    queryOut.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const list = grid.get(gx * 73856093 ^ gz * 19349663);
      if (!list) continue;
      for (const i of list) if (!queryOut.includes(i)) queryOut.push(i);
    }
    return queryOut;
  }

  const npcs = [
    { id: 'captain', name: 'Capitana Brea', title: 'Capitana del puerto', skin: 5, ...P(L.captain), facing: Math.atan2(-dockDir.x, -dockDir.z) },
    { id: 'vendor', name: 'Tía Perla', title: 'Vendedora', skin: 6, ...P([L.vendor[0] - 2.2, L.vendor[1] - 1.2]), facing: 2.2 },
  ];
  const botWaypoints = [
    [-100, 2], [-108, -10], [-92, -14], [-94, 6], [-112, 4], [-122, 10], [-128, 0], [-118, 18],
    [-86, -2], [-104, 14], [-136, 6], [-90, 10],
  ].map(P);

  return {
    seed, size, half, res, N, heights,
    heightAt, groundAt, onDock, masks, materialAt, zoneAt, pathInfo,
    props, colliders, queryColliders, npcs, botWaypoints, dock,
    landmarks: { spawn, village, arena, arenaR: L.arenaR, volcano, dockBase, dockEnd, path, ship: P(L.ship) },
    toWorld, toUV,
  };
}
