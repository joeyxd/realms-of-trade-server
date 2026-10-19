// Deterministic island generation. Pure: shared by the worker (authoritative sim), the client
// (prediction + rendering) and node tests. Same seed => bit-identical world.
import { tuning } from '../data/tuning.js';
import { LAWLESS } from '../data/lawless.js';
import { makeNoise2D } from './noise.js';
import { mulberry32 } from '../core/rng.js';
import { smoothstep, clamp01, lerp } from '../core/math.js';
import { revampTerrain } from './terrainRevamp.js';

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
  // M4.5: no law inside the ring of skulls (friendly fire, public loot, you drop what you carry).
  calavera: { name: 'Cala Calavera', sub: 'Sin ley: fuego amigo y botín completo', lawless: true },
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
  tattoo: [-102, 3], // Doña Sepia (M4.7): by the walk from the beach, 6 u from the huts, props and Tía Perla
  campfire: [-101, -7],
  arena: [25, 0],
  arenaR: 19,
  volcano: [84, 6],
  path: [[-88, -3], [-72, 6], [-55, -5], [-37, 5], [-20, -4], [-6, 1], [3, 0]],
  sign: [-85, 4],
  // La Cala Calavera (M4.5): a ruined pirate fort near the east shore, off the Sendero by a side trail.
  cala: [-35, 66],
  calaR: 21,
  calaTrail: [[-37, 6], [-38, 24], [-36, 45.5]],
  calaSign: [-33.5, 7.5],
  calaCp: [-36, 41],
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
  // La Cala Calavera and the trail to it (M4.5): distance to the trail and progress along it (0 at the Sendero).
  const cala = P(L.cala), calaR = L.calaR, trail = L.calaTrail.map(P);
  const trailLen = [];
  let tacc = 0;
  for (let i = 0; i < trail.length - 1; i++) { trailLen.push(tacc); tacc += Math.hypot(trail[i + 1].x - trail[i].x, trail[i + 1].z - trail[i].z); }
  function trailInfo(x, z) {
    let best = 1e9, prog = 0;
    for (let i = 0; i < trail.length - 1; i++) {
      const d = segDist(x, z, trail[i].x, trail[i].z, trail[i + 1].x, trail[i + 1].z, tmp);
      if (d < best) { best = d; prog = (trailLen[i] + tmp.t * Math.hypot(trail[i + 1].x - trail[i].x, trail[i + 1].z - trail[i].z)) / tacc; }
    }
    return { d: best, t: prog };
  }
  const calaD = (x, z) => Math.hypot(x - cala.x, z - cala.z);
  // Nothing random grows here (checked after the draws: the rest of the island keeps its layout).
  const calaClear = (x, z, pad, padTrail) => calaD(x, z) < calaR + pad || trailInfo(x, z).d < padTrail;
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
    // The Cala (M4.5): a trodden dirt trail and a patchy dirt floor inside the fort.
    const dc = calaD(x, z);
    let cal = 0;
    if (dc < calaR + 12) cal = (1 - smoothstep(calaR - 6, calaR + 1, dc)) * clamp01(0.55 + fbm2(x * 0.13 + 4, z * 0.13, 2));
    const tr = dc < 120 ? trailInfo(x, z) : null;
    if (tr && tr.t > 0.02) cal = Math.max(cal, 1 - smoothstep(1.2, 2.3, tr.d));
    return { path: Math.max(onPath, villageDirt * 0.85, cal), volcanic, arenaFloor, lava };
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
    if (calaD(x, z) < calaR + 1) return 'calavera';
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
  // A prop the Cala clears (M4.5): never placed, but it still keeps its neighbours apart as it did, so every
  // later random draw lands where it always has.
  function ghost(kind, x, z, r) {
    rng(); rng(); // the rot and variant addProp would have drawn
    const key = cellKey(x, z, 4);
    if (!occ.has(key)) occ.set(key, []);
    occ.get(key).push({ kind, x, z, r });
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
  // Two lanterns on top of pier posts, arms over the deck (no rng: the rest of the island stays put).
  for (const [i, s] of [[3, 1], [1, -1]]) {
    const t = (i + 0.5) / 4;
    const bx = lerp(dockBase.x, dockEnd.x, t), bz = lerp(dockBase.z, dockEnd.z, t);
    addProp('lantern', bx - dockDir.z * s * 1.75, bz + dockDir.x * s * 1.75, { r: 0, y: dock.deckY + 0.62, rot: Math.atan2(s * dockDir.x, s * dockDir.z), v: 0 });
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
  // Enemies (server-spawned entities, M2): two bone sentinels sleep just inside the gate facing whoever
  // comes in; three skeleton archers keep watch beside the Sendero del Humo.
  const enemySpawns = [];
  for (const sv of [-4.4, 4.4]) {
    const p = P([L.arena[0] - L.arenaR + 3.6, sv]), q = P([L.arena[0] - L.arenaR + 2.6, sv * 1.15]);
    enemySpawns.push({ kind: 'sentinel', x: p.x, z: p.z, facing: Math.atan2(q.x - p.x, q.z - p.z) });
  }
  for (const [u, v] of [[-60, 8], [-42, -8], [-26, 6]]) {
    const p = P([u, v]), q = P([u - 6, v * 0.3]);
    enemySpawns.push({ kind: 'archer', x: p.x, z: p.z, facing: Math.atan2(q.x - p.x, q.z - p.z) });
  }
  // La Cala Calavera (M4.5): its mobs are harder, refill with pirates around, and the Desalmados have names.
  {
    let n = 0;
    for (const [kind, du, dv] of LAWLESS.spawns) {
      const p = P([L.cala[0] + du, L.cala[1] + dv]), c = P(L.cala);
      const extra = { cala: 1, tier: LAWLESS.tier, hpMul: LAWLESS.tier.hp };
      if (kind === 'renegado' || kind === 'pistolera') extra.name = LAWLESS.names[n++ % LAWLESS.names.length];
      enemySpawns.push({ kind, x: p.x, z: p.z, facing: Math.atan2(c.x - p.x, c.z - p.z), extra });
    }
  }
  // Tutorial practice ground on the beach, up and left of the spawn (open sand, no palms in front of the
  // camera): a straw dummy, and a cannon up the slope that fires slow parryable balls at whoever stands
  // in its rope ring.
  const practice = (() => {
    const dummy = P([-134, 4]), ring = P([-137, -3]), cannon = P([-129, -6]);
    return {
      dummy: { ...dummy, facing: Math.atan2(spawn.x - dummy.x, spawn.z - dummy.z) },
      ring: { ...ring, r: 4.2 },
      cannon: { ...cannon, facing: Math.atan2(ring.x - cannon.x, ring.z - cannon.z) },
    };
  })();
  colliders.push({ x: practice.dummy.x, z: practice.dummy.z, r: 0.35 }, { x: practice.cannon.x, z: practice.cannon.z, r: 0.75 });
  // Weapon racks (M3.5): F next to one swaps the sable and the pistols. One on the beach by the spawn,
  // one in the village. Their props are added after every random draw (fixed rot / variant, no rng).
  const racks = [
    { id: 'playa', ...P([-136, 10]), face: spawn },
    { id: 'aldea', ...V(3, -6), face: P(L.campfire) },
  ].map((k) => ({ id: k.id, x: k.x, z: k.z, facing: Math.atan2(k.face.x - k.x, k.face.z - k.z) }));
  for (const k of racks) colliders.push({ x: k.x, z: k.z, r: 0.55 });
  // Keep the practice ground and the racks clear of palms, bushes and rocks (checked after the random
  // draws so the rest of the island keeps its exact layout).
  const nearPractice = (x, z) => Math.hypot(x - practice.ring.x, z - practice.ring.z) < practice.ring.r + 5
    || Math.hypot(x - practice.dummy.x, z - practice.dummy.z) < 6 || Math.hypot(x - practice.cannon.x, z - practice.cannon.z) < 5
    || racks.some((k) => Math.hypot(x - k.x, z - k.z) < 3.2);

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
    const scale = rng.range(0.85, 1.15), ph = rng.range(3.9, 5.6);
    if (nearPractice(x, z)) continue;
    if (calaClear(x, z, 2, 4.5)) { ghost('palm', x, z, 0.38); continue; }
    addProp('palm', x, z, { r: 0.38, scale, h: ph });
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
    const scale = rng.range(0.7, 1.35);
    if (nearPractice(x, z)) continue;
    if (calaClear(x, z, 0, 3.4)) { ghost('bush', x, z, 0.55); continue; }
    addProp('bush', x, z, { r: 0.55, scale });
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
    if (nearPractice(x, z)) continue;
    if (calaClear(x, z, 1, 3.2)) { ghost('rock', x, z, 0.55 * s); continue; }
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
    const fs = rng.range(0.7, 1.2);
    if (calaClear(x, z, 0, 2.2)) { ghost('flower', x, z, 0); continue; }
    addProp('flower', x, z, { r: 0, scale: fs });
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

  for (const k of racks) addProp('rack', k.x, k.z, { r: 0, rot: k.facing, v: 0.5 });

  // ---- La Cala Calavera (M4.5) -------------------------------------------------------------------------
  // After every random draw. The ground inside the fort settles toward a gentle floor (keeping a little of its
  // swell) and the trail becomes a ramp from the Sendero; the props standing on the reshaped ground move with it.
  {
    const floorH = 3.6, h0 = heightAt(trail[0].x, trail[0].z);
    const reach = calaR + 7;
    const near = (x, z) => calaD(x, z) < reach + 2 || trailInfo(x, z).d < 9;
    const keep = props.filter((p) => near(p.x, p.z)).map((p) => [p, heightAt(p.x, p.z)]);
    const xs = trail.map((q) => q.x).concat([cala.x - reach, cala.x + reach]), zs = trail.map((q) => q.z).concat([cala.z - reach, cala.z + reach]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - 8 + half) * res)), i1 = Math.min(N - 1, Math.ceil((Math.max(...xs) + 8 + half) * res));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - 8 + half) * res)), j1 = Math.min(N - 1, Math.ceil((Math.max(...zs) + 8 + half) * res));
    for (let j = j0; j <= j1; j++) {
      const z = -half + j / res;
      for (let i = i0; i <= i1; i++) {
        const x = -half + i / res, k = j * N + i;
        let h = heights[k];
        if (h < -0.3) continue; // the sea stays the sea
        const wC = 1 - smoothstep(calaR - 2, reach, calaD(x, z));
        const ti = trailInfo(x, z), wT = (1 - smoothstep(2.6, 7.5, ti.d)) * (1 - wC);
        if (wC > 0) h = lerp(h, floorH + (h - floorH) * 0.3, wC);
        if (wT > 0) h = lerp(h, lerp(h0, floorH, smoothstep(0, 1, ti.t)), wT);
        heights[k] = h;
      }
    }
    for (const [p, was] of keep) p.y += heightAt(p.x, p.z) - was;
  }
  // The fort: a ring of skull posts on the border (a gap where the trail comes in), broken palisades for cover,
  // crates and barrels, braziers, a fire and the black flag in the middle; the sign by the Sendero.
  const C = (du, dv) => P([L.cala[0] + du, L.cala[1] + dv]);
  const fromC = (a, r) => C(Math.cos(a) * r, Math.sin(a) * r); // a: 0 = up the screen (+u), π/2 = right (+v)
  const entryA = Math.atan2(L.calaTrail[2][1] - L.cala[1], L.calaTrail[2][0] - L.cala[0]);
  const fortProps = [];
  const fort = (kind, q, o) => { const pr = addProp(kind, q.x, q.z, { v: 0.5, rot: 0, ...o }); fortProps.push(pr); return pr; };
  for (let i = 0; i < 16; i++) {
    const a = entryA + ((i + 0.5) / 16) * Math.PI * 2;
    const q = fromC(a, calaR);
    fort('skullPost', q, { r: 0.3, rot: Math.atan2(cala.x - q.x, cala.z - q.z), v: (i * 0.37) % 1 });
  }
  // Palisade arcs around the old fort (angles in the (u, v) frame, from the centre).
  for (const [a0, a1, r] of [[0.35, 1.2, 10.5], [1.95, 2.55, 10.5], [3.55, 4.25, 10.5], [4.85, 5.75, 10.5], [0.9, 1.5, 15], [3.9, 4.5, 15.5]]) {
    const n = Math.max(2, Math.round(((a1 - a0) * r) / 1.25));
    for (let k = 0; k <= n; k++) {
      if ((k * 7 + Math.round(a0 * 10)) % 9 === 4) continue; // a broken stake here and there
      const a = a0 + ((a1 - a0) * k) / n, q = fromC(a, r), t = fromC(a + 0.05, r);
      fort('palisade', q, { r: 0.5, rot: Math.atan2(t.x - q.x, t.z - q.z), v: (k * 0.61) % 1 });
    }
  }
  for (const [du, dv, kind] of [[-6, 4, 'crate'], [5, -6, 'barrel'], [7, 5, 'crate'], [-4, -7, 'barrel'], [13, -3, 'crate'], [-12, 2, 'crate'], [1, 13, 'barrel'], [3, -14, 'crate'], [-15, -6, 'barrel'], [8, 15, 'crate']]) {
    fort(kind, C(du, dv), { r: 0.6, rot: du * 0.7 + dv });
  }
  for (const a of [0.785, 2.356, 3.927, 5.498]) fort('brazier', fromC(a, 6.5), { r: 0.55 });
  fort('campfire', C(0, 0), { r: 0.9 });
  fort('blackFlag', C(2.5, 2.5), { r: 0.25 });
  { const q = P(L.calaSign); addProp('sign', q.x, q.z, { r: 0.35, rot: Math.PI / 4 + 0.3, v: 0, h: 1 }); } // facing the camera, turned to the trail

  const botWaypoints = [
    [-100, 2], [-108, -10], [-92, -14], [-94, 6], [-112, 4], [-122, 10], [-128, 0], [-118, 18],
    [-86, -2], [-104, 14], [-136, 6], [-90, 10],
  ].map(P);

  // Night plaza dressing (T-1018-20): lantern posts, fences, a notice board, planters, a tarp stall and two more crate stacks
  // around the campfire. After every random draw and with explicit rot / v, so no rng value moves and no existing prop
  // shifts; before the collider hash, so the new colliders are in it. Every spot keeps the walkable plaza walkable:
  // clear of bot waypoints, the straight lines bots walk between them, the Sendero polyline and the NPCs, and away from the
  // campfire when it has a collider. All placement numbers live in PLAZA; (du, dv) are offsets from the village centre.
  const PLAZA = {
    // Clearances (world u).
    FIRE_CLEAR: 3.2,        // a collider prop stays this far from the campfire centre
    WAYPOINT_GAP: 1.5,      // min distance from any bot waypoint
    ROUTE_GAP: 0.9,         // min distance between a footprint edge and any straight line between two bot waypoints
    PATH_GAP: 1.5,          // min distance from the Sendero polyline
    NPC_GAP: 1.2,           // min distance from the merchant (Don Bacalao), the vendor at the stall front (Tía Perla) and the tattooist
    NPC_VENDOR_BACK: [-8, 3],       // the merchant Don Bacalao, offset from the vendor spot (du, dv)
    NPC_VENDOR_FRONT: [-2.2, -1.2], // shopkeeper stall front, offset from the vendor spot (du, dv)
    NUDGE_STEP: 0.2,        // search ring spacing when a spot is blocked
    NUDGE_DIRS: 16,         // directions tried per search ring
    CRATE_ROUTE_GAP: 0.55,  // the same for the crate stacks: the east stack sits between the stall front and three route legs, nothing within DRESS_NUDGE clears 0.9; a bot body is 0.4 u
    // Collider footprints (circle radius).
    LANTERN_R: 0.3, BOARD_R: 0.65, PLANTER_R: 0.33, TARP_R: 1.5, CRATE_R: 0.6, FENCE_R: 0.2,
    EDGE_GAP: 0.3,          // default gap between a new footprint and an existing collider edge
    // Lantern ring around the campfire.
    RING_COUNT: 6, RING_A0: 0.3, RING_RADIUS: 7.5, RING_CENTRE: [-1, -1],
    RING_COLLIDER_GAP: 1.3, // a ring post is skipped when this close to a collider edge
    RING_HUT_GAP: 3.6,      // ... or this close to a hut centre
    RING_NUDGE: 1,          // max slide of a ring post to clear a route
    // Lanterns beside the stalls.
    STALL_LANTERN_SIDE: 2.6, TATTOO_LANTERN_SIDE: 2.2, TATTOO_ROT: 1.1, STALL_LANTERN_NUDGE: 0.6,
    // Fences: runs of segments end to end.
    FENCE_SEGMENTS: 3, FENCE_LEN: 2, // the kit is 2 u long along its local x (props.js fenceGeo)
    FENCE_FOOT_STEP: 0.75,  // three footprint circles at -step, 0, +step along the segment axis
    FENCE_HUT_GAP: 2.9,     // a fence line stays this far from a hut centre
    FENCE_SLIDE: 1,         // max slide of a run along the plaza edge to clear a route or a hut
    FENCE_EAST: [12, -7.5, 'v'], FENCE_NORTH: [-8.5, -12.6, 'u'], // start (du, dv) and run axis; east moved out from (9.6, -6), where the bot route from waypoint 2 to 8 crosses it
    // Single props (du, dv).
    BOARD_AT: [-7.5, 5.5],
    PLANTERS_AT: [[-8, -3], [7, -7], [-3, 12], [9, 8]],
    TARP_AT: [-6, -11.5],
    CRATES_AT: [[3, 12.5, 0.4], [8, 13, 1.9]], // du, dv, rot
    DRESS_NUDGE: 2,         // default max slide of a single prop (a crate stack that finds no clear spot is dropped)
  };
  {
    const hutsAt = props.filter((q) => q.kind === 'hut');
    const campfireAt = P(L.campfire);
    const npcSpots = [
      P([L.vendor[0] + PLAZA.NPC_VENDOR_BACK[0], L.vendor[1] + PLAZA.NPC_VENDOR_BACK[1]]),
      P([L.vendor[0] + PLAZA.NPC_VENDOR_FRONT[0], L.vendor[1] + PLAZA.NPC_VENDOR_FRONT[1]]),
      P(L.tattoo),
    ];
    // The straight route legs between consecutive waypoints, closing the loop (last to first), and every pair of waypoints
    // (a bot picks any waypoint as its next target). Small props clear the legs; the long fence walls clear every pair.
    const botLegs = botWaypoints.map((w, i) => [w, botWaypoints[(i + 1) % botWaypoints.length]]);
    const botPairs = [];
    for (let i = 0; i < botWaypoints.length; i++) for (let j = i + 1; j < botWaypoints.length; j++) botPairs.push([botWaypoints[i], botWaypoints[j]]);
    const edgeGap = (x, z) => { let g = 1e9; for (const c of colliders) g = Math.min(g, Math.hypot(x - c.x, z - c.z) - c.r); return g; };
    const hutGap = (x, z) => { let g = 1e9; for (const h of hutsAt) g = Math.min(g, Math.hypot(x - h.x, z - h.z)); return g; };
    // A spot with a footprint of radius `r` is clear of every waypoint, every bot line, the path and the NPCs.
    const routeClear = (x, z, r = 0, gap = PLAZA.ROUTE_GAP, lines = botLegs) => botWaypoints.every((w) => Math.hypot(x - w.x, z - w.z) >= PLAZA.WAYPOINT_GAP)
      && lines.every(([a, b]) => segDist(x, z, a.x, a.z, b.x, b.z, tmp) >= gap + r)
      && pathInfo(x, z).d >= PLAZA.PATH_GAP && npcSpots.every((n) => Math.hypot(x - n.x, z - n.z) >= PLAZA.NPC_GAP);
    // Offsets to try when a spot is blocked: the spot itself, then rings of directions up to `max` u.
    const nudges = (max) => {
      const out = [[0, 0]];
      for (let d = PLAZA.NUDGE_STEP; d <= max + 1e-9; d += PLAZA.NUDGE_STEP) for (let k = 0; k < PLAZA.NUDGE_DIRS; k++) {
        const ang = (k * 2 * Math.PI) / PLAZA.NUDGE_DIRS;
        out.push([Math.cos(ang) * d, Math.sin(ang) * d]);
      }
      return out;
    };
    const faceCampfire = (x, z) => Math.atan2(campfireAt.x - x, campfireAt.z - z); // local +z (the front) toward the fire
    const armCampfire = (x, z) => Math.atan2(-(campfireAt.z - z), campfireAt.x - x); // lantern arm (local +x) over the plaza
    // Collider props: place at relative (du, dv), nudging up to `max` u until the spot is clear of colliders (edge gap
    // `gap`) and of the walking routes; a prop with a collider also stays clear of the campfire. Appends nothing when no
    // spot fits and logs nothing: tests/map-revamp.test.mjs pins the prop count, so a miss fails there.
    const dress = (kind, du, dv, opts, { max = PLAZA.DRESS_NUDGE, gap = PLAZA.EDGE_GAP, rotOf = faceCampfire, hutMin = 0, routeGap = PLAZA.ROUTE_GAP } = {}) => {
      for (const [a, b] of nudges(max)) {
        const p = V(du + a, dv + b);
        if (edgeGap(p.x, p.z) < gap + (opts.r || 0) || hutGap(p.x, p.z) < hutMin || !routeClear(p.x, p.z, opts.r || 0, routeGap)) continue;
        if ((opts.r || 0) > 0 && Math.hypot(p.x - campfireAt.x, p.z - campfireAt.z) < PLAZA.FIRE_CLEAR) continue;
        addProp(kind, p.x, p.z, { v: 0.5, rot: rotOf(p.x, p.z), ...opts });
        return true;
      }
      return false;
    };
    // Lantern ring around the campfire: a post whose spot is too close to a collider or a hut is skipped; the others move
    // up to RING_NUDGE only to clear a waypoint, a bot line, the path or an NPC.
    for (let k = 0; k < PLAZA.RING_COUNT; k++) {
      const a = PLAZA.RING_A0 + (k * 2 * Math.PI) / PLAZA.RING_COUNT;
      const du = PLAZA.RING_CENTRE[0] + PLAZA.RING_RADIUS * Math.cos(a), dv = PLAZA.RING_CENTRE[1] + PLAZA.RING_RADIUS * Math.sin(a), p = V(du, dv);
      if (edgeGap(p.x, p.z) < PLAZA.RING_COLLIDER_GAP || hutGap(p.x, p.z) < PLAZA.RING_HUT_GAP) continue;
      dress('lantern', du, dv, { r: PLAZA.LANTERN_R }, { max: PLAZA.RING_NUDGE, gap: PLAZA.RING_COLLIDER_GAP, hutMin: PLAZA.RING_HUT_GAP, rotOf: armCampfire });
    }
    // One lantern beside the vendor stall, one beside the tattooist: on the side facing the plaza, or the other side when
    // that one is on a route.
    const stallRef = [[props.find((q) => q.kind === 'stall'), PLAZA.STALL_LANTERN_SIDE], [{ ...P(L.tattoo), rot: PLAZA.TATTOO_ROT }, PLAZA.TATTOO_LANTERN_SIDE]]; // the tattooist faces TATTOO_ROT
    for (const [c, off] of stallRef) {
      const toFire = (e) => { const w = toWorld(e.u, e.v); return Math.hypot(w.x - campfireAt.x, w.z - campfireAt.z); };
      const spots = [off, -off].map((o) => toUV(c.x + Math.cos(c.rot) * o, c.z - Math.sin(c.rot) * o)).sort((p, q) => toFire(p) - toFire(q));
      for (const sp of spots) if (dress('lantern', sp.u - L.village[0], sp.v - L.village[1], { r: PLAZA.LANTERN_R }, { max: PLAZA.STALL_LANTERN_NUDGE, rotOf: armCampfire })) break;
    }
    // Fence runs of FENCE_SEGMENTS segments, end to end along the u or v axis. A run slides up to FENCE_SLIDE along the
    // plaza edge (any direction) when it would touch a hut or come too close to a waypoint, a bot line or the path.
    // Each segment gets three footprint circles along its axis, appended right after its prop.
    const fenceRun = (du0, dv0, along) => {
      const dir = along === 'v' ? [0, 1] : [1, 0], len = PLAZA.FENCE_LEN, n = PLAZA.FENCE_SEGMENTS;
      for (const [a, b] of nudges(PLAZA.FENCE_SLIDE)) {
        const centres = Array.from({ length: n }, (_, i) => V(du0 + a + dir[0] * len * i, dv0 + b + dir[1] * len * i));
        const ends = [V(du0 + a - dir[0] * len / 2, dv0 + b - dir[1] * len / 2), V(du0 + a + dir[0] * (len * n - len / 2), dv0 + b + dir[1] * (len * n - len / 2))];
        let ok = true;
        for (let s = 0; s <= 12 && ok; s++) {
          const t = s / 12, x = ends[0].x + (ends[1].x - ends[0].x) * t, z = ends[0].z + (ends[1].z - ends[0].z) * t;
          if (hutGap(x, z) < PLAZA.FENCE_HUT_GAP || !routeClear(x, z, PLAZA.FENCE_R, PLAZA.ROUTE_GAP, botPairs)) ok = false;
        }
        if (!ok) continue;
        const rot = Math.atan2(-(ends[1].z - ends[0].z), ends[1].x - ends[0].x);
        const ax = Math.cos(rot), az = -Math.sin(rot); // the segment axis in world space (local +x under rotation.y = rot)
        for (const c of centres) {
          addProp('fence', c.x, c.z, { r: 0, rot, v: 0.5 });
          for (const k of [-1, 0, 1]) colliders.push({ x: c.x + ax * k * PLAZA.FENCE_FOOT_STEP, z: c.z + az * k * PLAZA.FENCE_FOOT_STEP, r: PLAZA.FENCE_R });
        }
        return;
      }
    };
    fenceRun(...PLAZA.FENCE_EAST);
    fenceRun(...PLAZA.FENCE_NORTH);
    dress('board', PLAZA.BOARD_AT[0], PLAZA.BOARD_AT[1], { r: PLAZA.BOARD_R });
    for (const [du, dv] of PLAZA.PLANTERS_AT) dress('planter', du, dv, { r: PLAZA.PLANTER_R });
    dress('stallTarp', PLAZA.TARP_AT[0], PLAZA.TARP_AT[1], { r: PLAZA.TARP_R });
    for (const [du, dv, rot] of PLAZA.CRATES_AT) dress('crate', du, dv, { r: PLAZA.CRATE_R, rot }, { routeGap: PLAZA.CRATE_ROUTE_GAP });

    // ---- Village palms (T-1018-36) ------------------------------------------------------------------------------------------
    // Real palms standing in the village, as in the reference: a loose ring just outside the cobbles with gaps where the routes
    // leave the plaza, one or two beside each hut (outside its collider, never in its door arc), two by the vendor stall, and
    // three down the screen from the plaza, on the lower terrace (between the default camera and the tools/shot.mjs spot).
    // Walking past them puts their crowns between the camera and the player: toon.js dissolves the near field only in a disc
    // around the player and the depth of field blurs the rest.
    // Appended after the plaza dressing with explicit rot / v (no rng), so every earlier prop and collider stays where it was.
    // A blocked spot is nudged up to NUDGE u; a palm with no clear spot is dropped (tests/map-revamp.test.mjs pins the count).
    // The render picks the palm form from a hash of the coordinates (palmGeometry.js palmVariant, repeated in palmForm): each
    // palm slides along world x in FORM_STEP steps until the hash gives the form it asks for.
    const VILLAGE_PALMS = {
      COBBLE_CLEAR: 7.5,  // min distance from the village point (the cobbled plaza fades out at 7 u, groundMaterials.js)
      FIRE_GAP: 3.5,      // from the campfire centre
      PALM_GAP: 2.8,      // between palms, the island's own included
      HUT_GAP: 3.2,       // from a hut centre (the hut collider is 2.6)
      DOOR_ARC: 0.9, DOOR_REACH: 6, // no palm within DOOR_ARC rad of a hut's door axis (its local +z) when closer than DOOR_REACH u
      PROP_GAP: 1.4,      // from the edge of a town prop (lantern, fence, board, planter, tarp, crate, barrel, stall, rack, sign)
      EDGE_GAP: 0.3,      // between the trunk collider and any other collider edge
      R: 0.38,            // trunk collider, as every palm on the island
      NUDGE: 0.6,         // max slide of a blocked spot
      FORM_STEP: 0.01, FORM_TRIES: 40, // the form search along world x
      // du, dv (from the village point), rot, scale, h, form (0 tall, 1 curved, 2 short). A curved palm leans along its local +x,
      // so its rot points the crown away from the hut or the plaza it stands by. Crowns at 5.5 to 6 u (short ones about 4).
      AT: [
        [10.5, -2, 0.4, 1.0, 5.6, 0], [10, 3.5, 1.571, 1.04, 5.8, 1],                         // ring, up the screen behind the plaza
        [9.9, -7.5, 2.356, 1.0, 5.8, 1], [11.3, -14.2, 5.3, 1.03, 5.6, 0],                     // beside the upper-left hut
        [-0.3, -12, 1.9, 1.05, 5.6, 0], [2.4, -10, 3.927, 1.02, 5.8, 1], [-0.5, -9, 3.1, 0.98, 5.6, 0], // ring, left of the plaza
        [1, -16.7, 4.4, 1.05, 5.6, 2],                                                        // behind the left hut
        [-8.6, -8.4, 4.712, 1.06, 5.8, 1], [-8.6, -5.4, 2.6, 1.07, 5.6, 0],                    // camera side, lower left
        [-12.1, -11.5, 0.9, 1.02, 5.6, 0],                                                    // behind the lower-left hut
        [-9.7, 5.4, 0, 1.06, 5.8, 1], [-12.2, 12.3, 3.7, 1.0, 5.6, 0],                         // camera side, lower right, and its hut
        [13.4, 14.5, 1.2, 1.05, 5.6, 2],                                                      // behind the upper-right hut
        [4.8, 19.6, 1.6, 1.03, 5.8, 1], [-0.7, 19.2, 5.9, 1.04, 5.6, 0], [10, 18, 0.785, 1.0, 5.8, 1], // the stall and the right hut
      ],
    };
    {
      const VP = VILLAGE_PALMS;
      const townKinds = new Set(['lantern', 'fence', 'board', 'planter', 'stallTarp', 'crate', 'barrel', 'stall', 'rack', 'sign']);
      const local = props.filter((q) => (q.kind === 'palm' || townKinds.has(q.kind)) && Math.hypot(q.x - village.x, q.z - village.z) < 45);
      // A fence counts as its whole segment (FENCE_LEN along its local x), any other prop as a circle of radius r.
      const propGap = (x, z, q) => {
        if (q.kind !== 'fence') return Math.hypot(x - q.x, z - q.z) - q.r;
        const ax = Math.cos(q.rot) * PLAZA.FENCE_LEN / 2, az = -Math.sin(q.rot) * PLAZA.FENCE_LEN / 2;
        return segDist(x, z, q.x - ax, q.z - az, q.x + ax, q.z + az, tmp);
      };
      // The form the render picks for a spot (palmGeometry.js palmVariant, same hash); tests/village-palms.test.mjs checks the
      // placed palms get the forms asked for here.
      const palmForm = (x, z) => {
        let k = Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663);
        k = Math.imul(k ^ (k >>> 16), 0x45d9f3b); k ^= k >>> 16;
        return (k >>> 0) % 3;
      };
      const doorClear = (x, z, h) => {
        const d = Math.hypot(x - h.x, z - h.z);
        if (d < VP.HUT_GAP) return false;
        if (d >= VP.DOOR_REACH) return true;
        const a = Math.atan2(x - h.x, z - h.z) - h.rot;
        return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) >= VP.DOOR_ARC;
      };
      const palmClear = (x, z) => Math.hypot(x - village.x, z - village.z) >= VP.COBBLE_CLEAR
        && Math.hypot(x - campfireAt.x, z - campfireAt.z) >= VP.FIRE_GAP
        && hutsAt.every((h) => doorClear(x, z, h))
        && local.every((q) => (q.kind === 'palm' ? Math.hypot(x - q.x, z - q.z) >= VP.PALM_GAP : propGap(x, z, q) >= VP.PROP_GAP))
        && edgeGap(x, z) >= VP.EDGE_GAP + VP.R && routeClear(x, z, VP.R) && !nearPractice(x, z);
      for (const [du, dv, rot, scale, h, form] of VP.AT) {
        for (const [a, b] of nudges(VP.NUDGE)) {
          const p = V(du + a, dv + b);
          let j = 0;
          while (j < VP.FORM_TRIES && palmForm(p.x + j * VP.FORM_STEP, p.z) !== form) j++;
          const x = p.x + j * VP.FORM_STEP;
          if (j === VP.FORM_TRIES || !palmClear(x, p.z)) continue;
          local.push(addProp('palm', x, p.z, { r: VP.R, rot, scale, h, v: 0.5 }));
          break;
        }
      }
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
    { id: 'merchant', name: 'Don Bacalao', title: 'Mercader de mercancías', skin: 2, ...P([L.vendor[0] - 8, L.vendor[1] + 3]), facing: 2.2 },
    { id: 'calaMerchant', name: 'La Tuerta', title: 'Mercader de la Cala', skin: 3, ...P([L.cala[0] - 5, L.cala[1] + 6]), facing: 1.1 },
    { id: 'captain', name: 'Capitana Brea', title: 'Capitana del puerto', skin: 5, ...P(L.captain), facing: Math.atan2(-dockDir.x, -dockDir.z) },
    { id: 'vendor', name: 'Tía Perla', title: 'Vendedora', skin: 6, ...P([L.vendor[0] - 2.2, L.vendor[1] - 1.2]), facing: 2.2 },
    // No look of her own yet: she wears the vendor's (no spare NPC skin). Facing the walk up from the beach.
    { id: 'tattoo', name: 'Doña Sepia', title: 'Tatuadora', skin: 15, ...P(L.tattoo), facing: 1.1 },
  ];

  // Respawn checkpoints: the last one you reached (by zone) is where you wake up after falling.
  const checkpoints = {
    spawn: { x: spawn.x, z: spawn.z },
    aldea: { ...V(2, 3) },
    camino: { ...path[3] },
    puerta: { ...path[path.length - 2] },
    calavera: { ...P(L.calaCp) }, // outside the ring: who falls in the Cala wakes at its door
  };
  function checkpointAt(x, z) {
    const zn = zoneAt(x, z);
    if (zn === 'calavera') return 'calavera';
    if (zn === 'aldea') return 'aldea';
    if (zn === 'camino') return pathInfo(x, z).t > 0.45 ? 'camino' : 'aldea';
    if (zn === 'caldera') return 'puerta';
    return null;
  }

  return revampTerrain({
    seed, size, half, res, N, heights,
    enemySpawns, practice, racks, checkpoints, checkpointAt,
    heightAt, groundAt, onDock, masks, materialAt, zoneAt, pathInfo, trailInfo,
    // Inside the ring of skulls (M4.5): no law.
    lawlessAt: (x, z) => calaD(x, z) < calaR,
    cala: { x: cala.x, z: cala.z, r: calaR, trail, entry: P(L.calaTrail[2]), sign: P(L.calaSign) },
    props, colliders, queryColliders, npcs, botWaypoints, dock,
    landmarks: { spawn, village, arena, arenaR: L.arenaR, volcano, dockBase, dockEnd, path, ship: P(L.ship) },
    toWorld, toUV,
  });
}
