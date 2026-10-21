// Reshape the ground only after legacy placement/RNG has finished. Shared by client and server.
import { smoothstep, lerp } from '../core/math.js';
import { makeNoise2D } from './noise.js';
import { resourceLayout } from '../data/resources.js';
import { tuning } from '../data/tuning.js';

export const TERRAIN_REVISION = 'island-terraces-v2';
const TOWN_SLOPE = .68; // design slope of the town embankments, under the sim's maxSlope 1.0
export const TOWN_PALM_FLATS = [[-108.95, -11.35], [-90.02, 12.02]]; // (u, v) footing flats of two village palms, see townHeight
export const TERRAIN_SIZE = 560;

function sampler(heights, size, res, N) {
  const half = size / 2;
  return (x, z) => {
    const fx = Math.max(0, Math.min(N - 1.001, (x + half) * res));
    const fz = Math.max(0, Math.min(N - 1.001, (z + half) * res));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * N + i;
    return lerp(lerp(heights[k], heights[k + 1], tx), lerp(heights[k + N], heights[k + N + 1], tx), tz);
  };
}

export function revampTerrain(source) {
  const size = Math.max(TERRAIN_SIZE, source.size), half = size / 2, res = source.res;
  const N = Math.round(size * res) + 1, heights = new Float32Array(N * N);
  const { fbm } = makeNoise2D(source.seed ^ 0x743e91);
  const resources = resourceLayout(source), L = source.landmarks;
  const dist = (x, z, p) => Math.hypot(x - p.x, z - p.z);
  const oldHeight = (x, z) => Math.abs(x) <= source.half && Math.abs(z) <= source.half ? source.heightAt(x, z) : -7.5;
  // Water decorations retain a broad inlet, rather than turning into buried objects on new land.
  const wet = new Map(), cell = 16;
  for (const p of source.props) if (oldHeight(p.x, p.z) < 0.3 || ['ship', 'float', 'dockPost'].includes(p.kind)) {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    if (!wet.has(key)) wet.set(key, []); wet.get(key).push(p);
  }
  const wetDistance = (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell); let d = Infinity;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++)
      for (const p of wet.get(`${cx + i},${cz + j}`) || []) d = Math.min(d, dist(x, z, p));
    return d;
  };
  const waterKeep = (x, z) => 1 - smoothstep(3, 8, wetDistance(x, z));
  // Dry corridors cross gaps between legacy water decorations; their wet cores remain submerged.
  const connections = [
    { from: { u: 120, v: -28 }, to: { u: 190, v: -28 } },
    { from: { u: -38, v: -60 }, to: { u: -38, v: -125 } },
  ].map(link => {
    const p = source.toWorld(link.from.u, link.from.v), end = source.toWorld(link.to.u, link.to.v);
    return { ...link, startY: source.heightAt(p.x, p.z), endY: 6.7, access: end };
  });
  const townWeight = (u, v) => (1 - smoothstep(.58, 1, Math.hypot((u + 102) / 43, (v + 6) / 39))) * smoothstep(-132, -124, u);
  const pathWeight = (u, v) => (1 - smoothstep(.67, 1, Math.hypot((u + 102) / 43, (v + 6) / 39))) * smoothstep(-132, -124, u); // the dirt mask keeps its v1 extent
  // Town ground: flat levels joined by embankments no steeper than TOWN_SLOPE, so a walker is never stopped by a step.
  // Every flat (a terrace band, a building pad, the ramp line) is a plateau with a 1-Lipschitz distance d >= 0. The envelopes
  // lower = max(y - s d) and upper = min(y + s d) are s-Lipschitz, so their mean is too and equals y on a plateau, unless another
  // sits closer than their level gap allows (the stall below): then both lean by half the shortfall.
  const ramp = u => 2.4 + 8 * smoothstep(-122, -83, u), rampV = -6, corridor = 4.5;
  const bands = [{ y: 2.4, lo: -Infinity, hi: -110.5 }, { y: 6.4, lo: -104.5, hi: -97.5 }, { y: 10.4, lo: -91.5, hi: Infinity }];
  // Buildings keep their original footprint and doorway; the whole pad shares one level (the band its door sits on).
  // Huts keep their band level; the stall keeps its band level too on a small flat (0.7) and tilts gently toward the bank of the
  // 10.4 hut 8.94 away, so the hut stays level and no step is left next to the vendor.
  const pads = source.props.filter(p => ['hut', 'stall'].includes(p.kind)).map(p => {
    const { u, v } = source.toUV(p.x, p.z);
    return { x: p.x, z: p.z, u, v, y: u < -106.5 ? 2.4 : u < -93.5 ? 6.4 : 10.4, r: p.kind === 'hut' ? 3.3 : 0.7 };
  });
  const rampLine = []; for (let u = -134; u <= -58; u += .5) rampLine.push({ u, y: ramp(u) });
  const heightOver = list => (u, v) => {
    let lo = -Infinity, hi = Infinity;
    const add = (y, d) => { lo = Math.max(lo, y - TOWN_SLOPE * d); hi = Math.min(hi, y + TOWN_SLOPE * d); };
    for (const b of bands) { // the band's two sides of the ramp corridor, minus a clearance around pads on another level
      let d = Math.hypot(Math.max(b.lo - u, 0, u - b.hi), Math.max(corridor - Math.abs(v - rampV), 0));
      for (const p of list) if (p.y !== b.y) d = Math.max(d, p.r + Math.abs(b.y - p.y) / TOWN_SLOPE - Math.hypot(u - p.u, v - p.v));
      add(b.y, d);
    }
    for (const p of list) add(p.y, Math.max(0, Math.hypot(u - p.u, v - p.v) - p.r));
    for (const q of rampLine) add(q.y, Math.hypot(u - q.u, v - rampV));
    return (lo + hi) / 2;
  };
  // Two village palms (worldgen.js VILLAGE_PALMS.AT rows 9 and 16, from 0) have no level spot within reach of their row: each
  // stands on a footing flat at its spot (u, v) the size of its footing window (0.8), at the bank's own level clamped to what
  // every pad and the ramp line allow at TOWN_SLOPE, so no pad tilts; the bands yield around it as around a pad.
  const natural = heightOver([...pads]), ridge = rampLine.map(q => ({ u: q.u, v: rampV, y: q.y, r: 0 }));
  for (const [u, v] of TOWN_PALM_FLATS) {
    let lo = -Infinity, hi = Infinity;
    for (const p of [...pads, ...ridge]) {
      const d = Math.max(0, Math.hypot(u - p.u, v - p.v) - p.r - .8);
      lo = Math.max(lo, p.y - TOWN_SLOPE * d); hi = Math.min(hi, p.y + TOWN_SLOPE * d);
    }
    pads.push({ u, v, y: Math.min(hi, Math.max(lo, natural(u, v))), r: .8 });
  }
  const townHeight = heightOver(pads);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -half + i / res, z = -half + j / res, { u, v } = source.toUV(x, z), was = oldHeight(x, z);
    const coastNoise = fbm(x * .014 + 3, z * .014 - 2, 3) * .035;
    const a = Math.hypot((u - 145) / 83, (v + 48) / 102) + coastNoise;
    const b = Math.hypot((u + 20) / 106, (v + 133) / 61) + coastNoise;
    const e = Math.min(a, b), inside = 1 - e;
    let extra = lerp(-7.5, .7, smoothstep(-.12, .025, inside));
    extra += 2.8 * smoothstep(.06, .20, inside) + 3.2 * smoothstep(.28, .36, inside);
    extra += fbm(x * .025, z * .025, 3) * .65 * smoothstep(.14, .30, inside);
    // Preserve arrival waters, the actual boss floor/gate, volcano/crater and the existing PvP fort.
    const protectedWeight = Math.max(1 - smoothstep(-124, -114, u),
      1 - smoothstep(L.arenaR + 26, L.arenaR + 41, dist(x, z, L.arena)),
      1 - smoothstep(55, 75, dist(x, z, L.volcano)),
      1 - smoothstep(source.cala.r + 8, source.cala.r + 20, dist(x, z, source.cala)));
    let h = was;
    if (extra > was && protectedWeight < 1) h = lerp(was, extra, (1 - protectedWeight) * (1 - waterKeep(x, z)));
    for (const link of connections) {
      const du = link.to.u - link.from.u, dv = link.to.v - link.from.v;
      const t = Math.max(0, Math.min(1, ((u - link.from.u) * du + (v - link.from.v) * dv) / (du * du + dv * dv)));
      const d = Math.hypot(u - link.from.u - du * t, v - link.from.v - dv * t);
      if (d < 12 && protectedWeight < 1) {
        const weight = (1 - smoothstep(3, 12, d)) * (1 - protectedWeight) * smoothstep(2, 3, wetDistance(x, z));
        h = lerp(h, Math.max(was, lerp(link.startY, link.endY, t)), weight);
      }
    }
    const tw = townWeight(u, v);
    if (tw > 0 && was > .25) {
      h = lerp(h, townHeight(u, v), tw);
    }
    heights[j * N + i] = h;
  }
  const heightAt = sampler(heights, size, res, N);
  const groundAt = (x, z) => source.onDock(x, z) ? Math.max(heightAt(x, z), source.dock.deckY) : heightAt(x, z);
  const props = source.props.map(p => {
    if (['ship', 'float', 'dockPost'].includes(p.kind) || source.onDock(p.x, p.z) || p.y === source.dock.deckY + .62) return { ...p };
    return { ...p, y: p.y + heightAt(p.x, p.z) - source.heightAt(p.x, p.z) };
  });
  const masks = (x, z) => {
    const m = source.masks(x, z), { u, v } = source.toUV(x, z);
    return { ...m, path: Math.max(m.path, pathWeight(u, v) * .82) };
  };
  const materialAt = (x, z) => {
    if (source.onDock(x, z)) return 'wood';
    const h = groundAt(x, z), m = masks(x, z);
    if (h < -.05) return 'water';
    if (m.volcanic > .5 || m.arenaFloor > .5) return 'rock';
    if (m.path > .5) return 'dirt';
    return h < 1.5 ? 'sand' : 'grass';
  };
  const zoneAt = (x, z) => {
    const old = source.zoneAt(x, z);
    if (old !== 'mar' || groundAt(x, z) < -tuning.world.wadeMax) return old;
    return groundAt(x, z) < 1.6 ? 'playa' : 'selva';
  };
  const projectResource = p => ({ ...p, y: p.y + groundAt(p.x, p.z) - source.groundAt(p.x, p.z) });
  return { ...source, size, half, N, heights, heightAt, groundAt, masks, materialAt, zoneAt, props,
    terrainSource: source,
    terrainResources: { nodes: resources.nodes.map(projectResource), bench: resources.bench ? projectResource(resources.bench) : null },
    terrainRevision: TERRAIN_REVISION, mapSpan: 255,
    terrainLayout: { terraces: [2.4, 6.4, 10.4], town: { u: -102, v: -6, radiusU: 43, radiusV: 39 },
      expansions: [{ u: 145, v: -48, radiusU: 83, radiusV: 102 }, { u: -20, v: -133, radiusU: 106, radiusV: 61 }],
      connections } };
}
