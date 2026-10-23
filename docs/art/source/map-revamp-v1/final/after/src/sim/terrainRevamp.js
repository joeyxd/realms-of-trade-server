// Reshape the ground only after legacy placement/RNG has finished. Shared by client and server.
import { smoothstep, lerp } from '../core/math.js';
import { makeNoise2D } from './noise.js';
import { resourceLayout } from '../data/resources.js';
import { tuning } from '../data/tuning.js';

export const TERRAIN_REVISION = 'island-terraces-v1';
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
  const waterKeep = (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell); let d = Infinity;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++)
      for (const p of wet.get(`${cx + i},${cz + j}`) || []) d = Math.min(d, dist(x, z, p));
    return 1 - smoothstep(3, 8, d);
  };
  const townWeight = (u, v) => (1 - smoothstep(.67, 1, Math.hypot((u + 102) / 43, (v + 6) / 39))) * smoothstep(-132, -124, u);
  const terrace = u => 2.4 + 4 * smoothstep(-108, -105, u) + 4 * smoothstep(-95, -92, u);
  const ramp = u => 2.4 + 8 * smoothstep(-122, -83, u);
  const townHeight = (u, v) => lerp(terrace(u), ramp(u), 1 - smoothstep(3, 8, Math.abs(v + 6)));
  const pads = source.props.filter(p => ['hut', 'stall'].includes(p.kind)).map(p => {
    const { u } = source.toUV(p.x, p.z);
    // Every building keeps its original footprint and doorway. Its whole pad shares one elevation.
    return { ...p, padY: terrace(u), inner: p.kind === 'hut' ? 4.4 : 3, outer: p.kind === 'hut' ? 7 : 5.5 };
  });
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
    const tw = townWeight(u, v);
    if (tw > 0 && was > .25) {
      h = lerp(h, townHeight(u, v), tw);
      for (const p of pads) h = lerp(h, p.padY, (1 - smoothstep(p.inner, p.outer, dist(x, z, p))) * tw);
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
    return { ...m, path: Math.max(m.path, townWeight(u, v) * .82) };
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
      expansions: [{ u: 145, v: -48, radiusU: 83, radiusV: 102 }, { u: -20, v: -133, radiusU: 106, radiusV: 61 }] } };
}
