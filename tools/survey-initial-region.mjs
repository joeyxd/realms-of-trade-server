// Offline geographic survey. It never loads credentials, starts a host, or writes game content.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { tuning } from '../src/data/tuning.js';
import { LOAD } from '../src/data/carry.js';
import { resourceLayout } from '../src/data/resources.js';
import { freshwaterSource } from '../src/data/freshwater.js';
import { navalRouteLayout } from '../src/sim/naval/route.js';
import { createNavalCoast } from '../src/sim/naval/coastGeometry.js';
import { canStand } from '../src/sim/systems/movement.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.resolve(root, process.argv[2] || 'docs/world/a0-g1');
const map = generateWorld(GAME.seed), world = { map };
assert.equal(map.N, 561); assert.equal(map.size, 560); assert.equal(map.res, 1);
const hash = value => createHash('sha256').update(value).digest('hex');
const heightHash = () => hash(Buffer.from(map.heights.buffer, map.heights.byteOffset, map.heights.byteLength));
const before = heightHash();
const round = n => Number(n.toFixed(3));
const point = p => ({ x: round(p.x), y: round(map.groundAt(p.x, p.z)), z: round(p.z) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const resources = resourceLayout(map);
const route = navalRouteLayout(map);
const anchors = [];
const add = (id, p, footprint, policy = 'conservar') => {
  if (p) anchors.push({ id, ...point(p), footprint, policy });
};
for (const key of ['spawn', 'village', 'dockBase', 'dockEnd', 'ship', 'arena', 'volcano'])
  add(`landmark:${key}`, map.landmarks[key], key === 'arena' ? { radius: map.landmarks.arenaR } : null);
add('town:cala', map.cala, { radius: map.cala.r });
add('freshwater:salty-spring', freshwaterSource(map), { radius: 3 });
add('resource:bench', resources.bench, { surveyBuffer: 5 });
for (const n of map.npcs) add(`npc:${n.id}`, n, { surveyBuffer: 4 });
for (const [id, p] of Object.entries(map.checkpoints)) add(`checkpoint:${id}`, p, { surveyBuffer: 4 });
for (const [id, p] of Object.entries(map.practice)) if (Number.isFinite(p?.x))
  add(`practice:${id}`, p, { radius: p.r || 0, surveyBuffer: 2 });
for (const rack of map.racks) add(`rack:${rack.id}`, rack, { surveyBuffer: 4 });
for (const buoy of route?.buoys || []) add(`naval:${buoy.id}`, buoy, { radius: buoy.radius });
add('naval:corsair-battery', route?.threat, { surveyBuffer: 4 });

// Candidate footprints are design reservations, not existing services or editor placements.
const sites = [
  { id: 'S1', name: 'Península sur existente', x: -80, z: 130, water: { x: -80, z: 212 } },
  { id: 'S2', name: 'Península oeste existente', x: -155, z: -60, water: { x: -244, z: -60 } },
];
const reserved = { id: 'S3', name: 'Puerto Sol — extensión propuesta', x: -720, z: 100,
  footprint: { width: 100, depth: 120 }, market: { x: -710, z: 110, radius: 22 },
  plaza: { x: -710, z: 110, width: 36, depth: 36 },
  textiles: { x: -745, z: 90, width: 20, depth: 20 },
  service: { x: -685, z: 75, width: 18, depth: 18 },
  dock: { base: { x: -720, z: 172 }, end: { x: -720, z: 204 }, halfWidth: 3 },
  turning: { x: -720, z: 230, radius: 20 },
};
const extension = { minX: -840, maxX: 280, minZ: -280, maxZ: 280 };
const transitionBand = { minX: -280, maxX: -130, minZ: 95, maxZ: 170 };
const inBand = p => p.x >= transitionBand.minX && p.x <= transitionBand.maxX &&
  p.z >= transitionBand.minZ && p.z <= transitionBand.maxZ;
const junction = { x: -130, z: 130 };
const proposedRoad = [junction, { x: -210, z: 125 }, { x: -420, z: 115 },
  { x: -620, z: 100 }, { x: reserved.x, z: reserved.z }];
const proposedCoast = [{ x: -80, z: 212 }, { x: -200, z: 240 },
  { x: -440, z: 240 }, { x: -650, z: 240 }, reserved.turning];

function footprint(site) {
  let total = 0, dry = 0, standable = 0, low = Infinity, high = -Infinity;
  for (let z = site.z - 60; z <= site.z + 60; z += 2) for (let x = site.x - 50; x <= site.x + 50; x += 2) {
    const h = map.groundAt(x, z); total++;
    low = Math.min(low, h); high = Math.max(high, h);
    if (h >= .75) dry++;
    if (h >= .75 && canStand(world, x, z)) standable++;
  }
  return { width: 100, depth: 120, samples: total, spacing: 2, minY: round(low), maxY: round(high),
    dryPercent: round(dry / total * 100), standablePercent: round(standable / total * 100),
    colliders: map.colliders.filter(c => Math.abs(c.x - site.x) < 50 + c.r && Math.abs(c.z - site.z) < 60 + c.r).length,
    resourceIds: resources.nodes.filter(p => Math.abs(p.x - site.x) <= 50 && Math.abs(p.z - site.z) <= 60).map(p => p.id) };
}

// Search only the current generated base. Edges are checked in both slope directions.
// A centerline is not a six-unit road, player input acceptance, or a future-terrain path.
function findPath(start, end, step, allowed, edgeAllowed) {
  const N = Math.round(map.size / step) + 1;
  const at = id => ({ x: -map.half + (id % N) * step, z: -map.half + Math.floor(id / N) * step });
  const valid = new Uint8Array(N * N);
  for (let id = 0; id < valid.length; id++) valid[id] = Number(allowed(at(id)));
  function nearest(p) {
    let best = -1, distance = Infinity;
    for (let id = 0; id < valid.length; id++) if (valid[id]) {
      const d = dist(p, at(id)); if (d < distance) { best = id; distance = d; }
    }
    return { id: best, distance };
  }
  const a = nearest(start), b = nearest(end);
  if (a.distance > step * 2 || b.distance > step * 2) return { found: false, reason: 'endpoint_not_clear', startSnap: a.distance, endSnap: b.distance };
  const costs = new Float64Array(valid.length).fill(Infinity), prev = new Int32Array(valid.length).fill(-1);
  const heap = [];
  function push(item) {
    let i = heap.length; heap.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= item.f) break; heap[i] = heap[p]; i = p; } heap[i] = item;
  }
  function pop() {
    const first = heap[0], last = heap.pop(); if (!heap.length) return first;
    let i = 0;
    while (2 * i + 1 < heap.length) {
      let j = 2 * i + 1; if (j + 1 < heap.length && heap[j + 1].f < heap[j].f) j++;
      if (heap[j].f >= last.f) break; heap[i] = heap[j]; i = j;
    } heap[i] = last; return first;
  }
  costs[a.id] = 0; push({ id: a.id, g: 0, f: dist(at(a.id), at(b.id)) });
  while (heap.length) {
    const current = pop(), id = current.id; if (current.g !== costs[id]) continue;
    if (id === b.id) break;
    const p = at(id), ix = id % N, iz = Math.floor(id / N);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || ix + dx < 0 || ix + dx >= N || iz + dz < 0 || iz + dz >= N) continue;
      const next = id + dz * N + dx; if (!valid[next]) continue;
      const q = at(next), g = costs[id] + dist(p, q);
      if (g >= costs[next] || !edgeAllowed(p, q)) continue;
      costs[next] = g; prev[next] = id; push({ id: next, g, f: g + dist(q, at(b.id)) });
    }
  }
  if (!Number.isFinite(costs[b.id])) return { found: false, reason: 'no_lattice_connection' };
  const points = []; for (let id = b.id; id !== -1; id = prev[id]) points.push(at(id)); points.reverse();
  return { found: true, length: round(costs[b.id]), startSnap: round(a.distance), endSnap: round(b.distance), points };
}
const safeLand = p => map.groundAt(p.x, p.z) >= .2 && canStand(world, p.x, p.z) &&
  dist(p, map.cala) > map.cala.r + 8 && dist(p, map.landmarks.arena) > map.landmarks.arenaR + 12 &&
  dist(p, map.landmarks.volcano) > 45 && map.masks(p.x, p.z).lava === 0;
function landEdge(a, b) {
  const n = Math.ceil(dist(a, b) / .5); let old = map.groundAt(a.x, a.z);
  for (let i = 1; i <= n; i++) {
    const p = { x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n };
    const h = map.groundAt(p.x, p.z);
    if (!safeLand(p) || Math.abs(h - old) / (dist(a, b) / n) > tuning.world.maxSlope) return false;
    old = h;
  } return true;
}

// Integral image of obstructed cells, including the runtime's saddle correction.
// The reserved 16x16 square contains a rotating
// centered 8x12 hull. This is a conservative corridor screen, not a dynamic sailing test.
const stride = map.N + 1, blocked = new Int32Array(stride * stride);
const dockCorners = [-1.5, map.dock.len].flatMap(a => [-map.dock.halfWidth, map.dock.halfWidth].map(b => ({
  x: map.dock.base.x + map.dock.dir.x * a - map.dock.dir.z * b,
  z: map.dock.base.z + map.dock.dir.z * a + map.dock.dir.x * b,
})));
const dockBounds = { minX: Math.min(...dockCorners.map(p => p.x)), maxX: Math.max(...dockCorners.map(p => p.x)),
  minZ: Math.min(...dockCorners.map(p => p.z)), maxZ: Math.max(...dockCorners.map(p => p.z)) };
for (let j = 0; j < map.N - 1; j++) for (let i = 0; i < map.N - 1; i++) {
  const x = i - map.half, z = j - map.half, k = (j + 1) * stride + i + 1;
  const cell = j * map.N + i, h00 = map.heights[cell], h10 = map.heights[cell + 1];
  const h01 = map.heights[cell + map.N], h11 = map.heights[cell + map.N + 1];
  // One-unit depth is a survey reservation, not an implemented vessel draft rule.
  const threshold = Math.min(-1, .15 - Math.abs(h00 - h10 - h01 + h11) / 4);
  const dockOverlap = x + 1 >= dockBounds.minX && x <= dockBounds.maxX && z + 1 >= dockBounds.minZ && z <= dockBounds.maxZ;
  blocked[k] = Number(Math.max(h00, h10, h01, h11) > threshold || dockOverlap) +
    blocked[k - 1] + blocked[k - stride] - blocked[k - stride - 1];
}
function safeSea(p) {
  const pad = 8;
  if (Math.abs(p.x) + pad >= map.half - 2 || Math.abs(p.z) + pad >= map.half - 2) return false;
  const x0 = Math.floor(p.x - pad + map.half) - 1, x1 = Math.ceil(p.x + pad + map.half) + 1;
  const z0 = Math.floor(p.z - pad + map.half) - 1, z1 = Math.ceil(p.z + pad + map.half) + 1;
  return blocked[z1 * stride + x1] - blocked[z1 * stride + x0] - blocked[z0 * stride + x1] + blocked[z0 * stride + x0] === 0;
}
function seaEdge(a, b) {
  const n = Math.ceil(dist(a, b));
  for (let i = 0; i <= n; i++) if (!safeSea({ x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n })) return false;
  return true;
}
const seaStart = { x: 164, z: 132 };
const coast = createNavalCoast(map);
function screenEvidence(result, mode) {
  if (!result.found) return;
  let n = 0, widthFailures = 0, minDepth = Infinity, maxDepth = -Infinity;
  for (let i = 1; i < result.points.length; i++) {
    const a = result.points[i - 1], b = result.points[i], d = dist(a, b), steps = Math.ceil(d / .5);
    for (let k = 0; k <= steps; k++) {
      const p = { x: a.x + (b.x - a.x) * k / steps, z: a.z + (b.z - a.z) * k / steps }; n++;
      if (mode === 'land') {
        if ([-3, 0, 3].some(offset => !safeLand({ x: p.x - (b.z - a.z) / d * offset, z: p.z + (b.x - a.x) / d * offset }))) widthFailures++;
      } else {
        assert.equal(coast.query(p.x - 8, p.z - 8, p.x + 8, p.z + 8).length, 0, 'runtime coast enters reserved corridor');
        for (const [dx, dz] of [[0, 0], [-8, -8], [-8, 8], [8, -8], [8, 8]]) {
          const depth = tuning.world.waterLevel - map.groundAt(p.x + dx, p.z + dz);
          minDepth = Math.min(minDepth, depth); maxDepth = Math.max(maxDepth, depth);
        }
      }
    }
  }
  result.screen = mode === 'land' ? { samples: n, lateralOffsets: [-3, 0, 3], widthFailureSamples: widthFailures,
    scope: 'Three lateral samples only, no continuous full-width road acceptance' } :
    { samples: n, runtimeCoastQueriesEmpty: true, halfWidth: 8, sampledMinDepth: round(minDepth), sampledMaxDepth: round(maxDepth),
      scope: 'Static corridor; five depth samples per point; no draft, wind, loaded vessel, turning, docking or landing acceptance' };
}
for (const site of sites) {
  site.footprint = footprint(site);
  site.land = findPath(map.landmarks.village, site, 2, safeLand, landEdge);
  site.sea = findPath(seaStart, site.water, 4, safeSea, seaEdge);
  screenEvidence(site.land, 'land'); screenEvidence(site.sea, 'sea');
  if (site.land.found) site.land.idealSecondsByLoadTier = LOAD.speed.map(m => round(site.land.length / tuning.player.runSpeed / m));
}
const joinPath = findPath(map.landmarks.village, junction, 2, safeLand, landEdge);
screenEvidence(joinPath, 'land');
const length = points => points.slice(1).reduce((sum, p, i) => sum + dist(p, points[i]), 0);
const report = {
  schema: 'marea.initial-region-survey', version: 1, date: '2026-10-13',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  seed: GAME.seed, terrainRevision: map.terrainRevision, heightSha256: before,
  scope: 'Generated base only; no GM overlay, geography activation, gameplay timing or live traversal acceptance',
  bounds: { minX: -map.half, maxX: map.half, minZ: -map.half, maxZ: map.half },
  movementBounds: { minX: -map.half + 2, maxX: map.half - 2, minZ: -map.half + 2, maxZ: map.half - 2 },
  grid: { N: map.N, resolution: map.res, samples: map.heights.length, heightBytes: map.heights.byteLength },
  sourceHashNormalization: 'UTF-8 text with CRLF normalized to LF',
  sourceHashes: Object.fromEntries(await Promise.all(['src/data/meta.js', 'src/data/tuning.js', 'src/data/carry.js',
    'src/data/resources.js', 'src/data/freshwater.js', 'src/sim/worldgen.js', 'src/sim/terrainRevamp.js',
    'src/sim/systems/movement.js', 'src/sim/naval/coastGeometry.js', 'src/sim/naval/route.js'].map(async rel =>
    [rel, hash((await fs.readFile(path.join(root, rel), 'utf8')).replaceAll('\r\n', '\n'))]))),
  methodology: { landGrid: 2, edgeSample: .5, minLandHeight: .2, bodyRadius: tuning.player.radius,
    maxAbsoluteSlope: tuning.world.maxSlope, calderaBuffer: 12, volcanoRadius: 45, calaBuffer: 8,
    seaGrid: 4, seaHalfWidth: 8, seaSurveyDepthFloor: 1,
    seaObstruction: 'Any cell with max corner > min(-1, 0.15 - abs(h00-h10-h01+h11)/4); bordering cells and conservative dock AABB', seaStart,
    timings: 'Length / base runSpeed / load multiplier only; no acceleration, enemy, service, ship speed or input test' },
  anchors, dock: map.dock, existingPaths: { smoke: map.landmarks.path, cala: map.cala.trail, growth: map.terrainLayout.connections },
  inventory: { props: map.props.length, propsSha256: hash(JSON.stringify(map.props)),
    colliders: map.colliders.length, collidersSha256: hash(JSON.stringify(map.colliders)), resources: resources.nodes.length,
    resourcesSha256: hash(JSON.stringify(resources)), resourceRows: resources.nodes, enemySpawns: map.enemySpawns },
  existingCandidates: sites,
  recommendation: { status: 'proposal_for_GM06a', site: reserved, envelope: extension,
    transitionBand: { ...transitionBand, props: map.props.filter(inBand).length,
      colliders: map.colliders.filter(inBand).length, resourceIds: resources.nodes.filter(inBand).map(p => p.id),
      enemySpawns: map.enemySpawns.filter(inBand).length, anchorIds: anchors.filter(inBand).map(p => p.id),
      policy: 'Reserve a connection through previously wet cells; preserve existing dry ground and all functional anchors. This is not a terrain edit.' },
    existingJunction: point(junction), measuredApproach: joinPath, proposedRoad, proposedCoast,
    proposedRoadLength: round(length(proposedRoad)), proposedCoastLength: round(length(proposedCoast)),
    straightLineMinimum: round(dist(map.landmarks.village, reserved)),
    directUnloadedSecondsMinimum: round(dist(map.landmarks.village, reserved) / tuning.player.runSpeed),
    estimatedRoadTotal: joinPath.found ? round(joinPath.length + length(proposedRoad)) : null,
    estimatedRoadSecondsByLoadTier: joinPath.found ? LOAD.speed.map(m => round((joinPath.length + length(proposedRoad)) / tuning.player.runSpeed / m)) : null,
    estimatedSeaTotal: sites[0].sea.found ? round(sites[0].sea.length + length(proposedCoast)) : null,
    needsNewCoast: true, needsAsymmetricBounds: true, cenizaIncluded: false },
};
assert.equal(heightHash(), before, 'survey mutated the generated heightfield');
assert.equal(map.N, 561); assert.equal(map.size, 560);
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'survey.json'), JSON.stringify(report, null, 2) + '\n');

const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const parts = [];
const text = (x, y, s, size = 18, color = '#dce8e7') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${esc(s)}</text>`;
const colors = ['#102c42', '#1c5369', '#69a6a5', '#d7c998', '#60946d', '#477c58', '#a19d72', '#c2a180', '#e4c9a3'];
function terrain(ox, oy, scale, step = 2) {
  const band = h => h < -1 ? 0 : h < 0 ? 1 : h < .75 ? 2 : h < 1.6 ? 3 : h < 4 ? 4 : h < 8 ? 5 : h < 12 ? 6 : h < 20 ? 7 : 8;
  parts.push('<g shape-rendering="crispEdges">');
  for (let z = -map.half; z < map.half; z += step) {
    let last = -1, start = -map.half;
    for (let x = -map.half; x <= map.half; x += step) {
      const b = x === map.half ? -1 : band(map.groundAt(x + step / 2, z + step / 2));
      if (b !== last) {
        if (last !== -1) parts.push(`<rect x="${round(ox + (start + map.half) * scale)}" y="${round(oy + (z + map.half) * scale)}" width="${round((x - start) * scale)}" height="${step * scale}" fill="${colors[last]}"/>`);
        start = x; last = b;
      }
    }
  }
  parts.push('</g>');
}
const ox = 65, oy = 155, scale = 1.4;
const screen = p => ({ x: ox + (p.x + 280) * scale, y: oy + (p.z + 280) * scale });
const line = (points, color, dashed = false, width = 3, convert = screen) => {
  if (!points?.length) return '';
  return `<polyline points="${points.map(p => { const q = convert(p); return `${round(q.x)},${round(q.y)}`; }).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" ${dashed ? 'stroke-dasharray="9 6"' : ''}/>`;
};
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1660" viewBox="0 0 1440 1660" role="img" aria-labelledby="title desc"><title id="title">A0-G1: terreno medido y propuesta de Puerto Sol</title><desc id="desc">Base XZ de 560 unidades con anclas conservadas. Dos candidatos existentes medidos y propuesta de extensión occidental, todavía sin terreno nuevo.</desc><rect width="1440" height="1660" fill="#0a1822"/><g font-family="Segoe UI, Arial, sans-serif">`);
parts.push(text(55, 53, 'A0-G1 · Del dibujo al terreno real', 32), text(55, 87, 'Base generada · seed 99282957 · island-terraces-v1 · XZ de mundo · 13 oct 2026', 18, '#9abbbc'), text(55, 118, 'Medido arriba; reservas de diseño abajo. Ningún destino o terreno se activa con este plano.', 18, '#edcb87'));
terrain(ox, oy, scale);
for (let v = -280; v <= 280; v += 70) {
  const p = screen({ x: v, z: v });
  parts.push(`<path d="M${p.x} ${oy}v784 M${ox} ${p.y}h784" stroke="#bed6df" stroke-opacity=".13"/>`, text(p.x - 14, 965, v, 14), text(22, p.y + 5, v, 14));
}
parts.push(line(map.landmarks.path, '#fff0bf'), line(map.cala.trail, '#e8968e', false, 2));
for (const site of sites) {
  const p = screen(site);
  parts.push(`<rect x="${p.x - 70}" y="${p.y - 84}" width="140" height="168" fill="none" stroke="#f0ba74" stroke-dasharray="6 4"/>`, text(p.x - 12, p.y - 10, site.id, 23, '#fff3db'));
  parts.push(line(site.land.points, '#f4b75b', false, 2), line(site.sea.points, '#64d5f6', false, 3));
}
parts.push(line(joinPath.points, '#eb85bf', false, 3));
for (const [p, radius, color] of [[map.cala, map.cala.r, '#f39088'], [map.landmarks.arena, 19, '#f8b266'], [map.landmarks.volcano, 45, '#df9a84']]) {
  const q = screen(p); parts.push(`<circle cx="${q.x}" cy="${q.y}" r="${radius * scale}" fill="none" stroke="${color}" stroke-width="2"/>`);
}
const labelled = [map.landmarks.spawn, map.landmarks.village, map.dock.end, freshwaterSource(map), map.landmarks.arena, map.landmarks.volcano, map.cala, resources.bench];
labelled.forEach((p, i) => { const q = screen(p); parts.push(`<circle cx="${q.x}" cy="${q.y}" r="10" fill="#10202c" stroke="#f5eed3"/>`, text(q.x - 4, q.y + 5, i + 1, 13, '#ffffff')); });
for (const n of resources.nodes) { const p = screen(n); parts.push(`<circle cx="${p.x}" cy="${p.y}" r="1.5" fill="#c8e6b7" opacity=".55"/>`); }
parts.push(text(650, 995, 'X →     Z ↓', 18));
let y = 178;
for (const [label, p] of [['1 · Llegada', labelled[0]], ['2 · Salty Shore', labelled[1]], ['3 · Extremo del muelle', labelled[2]], ['4 · salty-spring', labelled[3]], ['5 · La Caldera (r19)', labelled[4]], ['6 · Volcán (reserva r45)', labelled[5]], ['7 · Cala (PvP r21)', labelled[6]], ['8 · Banco de materiales', labelled[7]]]) {
  parts.push(text(905, y, label, 19), text(905, y + 24, `XZ ${round(p.x)}, ${round(p.z)} · Y ${round(map.groundAt(p.x, p.z))}`, 16, '#8eb6bd')); y += 67;
}
parts.push(text(905, 750, 'Candidatos en terreno existente', 22, '#f0ba74'));
sites.forEach((s, i) => {
  const y = 785 + i * 70;
  parts.push(text(905, y, `${s.id} · suelo seco ${s.footprint.dryPercent}%`, 18), text(905, y + 25, s.land.found ? `Centro: ${s.land.length} u · ideal ${s.land.idealSecondsByLoadTier[0]} s sin carga` : `Centro: sin conexión en esta rejilla`, 16, '#9abbbc'));
});
parts.push(text(65, 1020, 'Ocre: centros medidos a pie · azul: corredor de agua de 16 u · rosa: acceso a la extensión', 18), text(65, 1050, 'Cotas por color: agua / bajío / playa / 1,6–4 / 4–8 / 8–12 / 12–20 / >20 u. Puntos: recursos existentes.', 17, '#9abbbc'));
const bx = 55, by = 1120, bs = .8;
const overview = p => ({ x: bx + (p.x - extension.minX) * bs, y: by + (p.z - extension.minZ) * bs });
parts.push(text(55, 1094, 'Reserva occidental propuesta · límites X [-840, 280], Z [-280, 280]', 22, '#edcb87'), `<rect x="${bx}" y="${by}" width="896" height="448" fill="#102c42"/>`);
terrain(bx + 560 * bs, by, bs, 4);
const old = overview({ x: -280, z: -280 });
parts.push(`<rect x="${old.x}" y="${old.y}" width="448" height="448" fill="none" stroke="#7cbac9" stroke-dasharray="5 5"/>`);
// The fill is only a reservation envelope, not a sampled future coastline.
const zone = overview({ x: -800, z: 15 });
parts.push(`<rect x="${zone.x}" y="${zone.y}" width="536" height="164" rx="38" fill="#8e9e71" fill-opacity=".18" stroke="#b6bb8c" stroke-dasharray="7 6"/>`);
parts.push(line(sites[0].sea.points, '#64d5f6', false, 2, overview), line(proposedRoad, '#f4b75b', true, 4, overview), line(proposedCoast, '#64d5f6', true, 4, overview), line(joinPath.points, '#eb85bf', false, 2, overview));
const r = overview(reserved);
parts.push(`<rect x="${r.x - 40}" y="${r.y - 48}" width="80" height="96" fill="#ddbd7c" fill-opacity=".18" stroke="#edcb87"/>`, text(r.x - 32, r.y - 57, 'SOL · S3', 18, '#edcb87'), line([reserved.dock.base, reserved.dock.end], '#e5d4ac', false, 5, overview));
const turn = overview(reserved.turning);
parts.push(`<circle cx="${turn.x}" cy="${turn.y}" r="16" stroke="#64d5f6" fill="none"/>`);
const ss = overview(map.landmarks.village); parts.push(text(ss.x + 7, ss.y - 6, 'Salty', 16));
parts.push(text(990, 1150, 'S3 · recomendación', 25, '#edcb87'), text(990, 1188, 'Centro XZ (-720, 100)', 19), text(990, 1220, 'Núcleo reservado: 100 × 120 u', 18), text(990, 1252, 'Cotas, costa y camino por crear.', 18), text(990, 1284, 'Mismo ID económico: sol.', 18), text(990, 1330, 'GM06a primero:', 22, '#edcb87'), text(990, 1363, 'bounds asimétricos + costa,', 18), text(990, 1394, 'chunks/samplers/mapas y', 18), text(990, 1425, 'correspondencia de base/IDs.', 18), text(990, 1471, 'Ceniza: otra fase, mar lejano.', 18), text(990, 1502, 'A6/D10 antes de su llegada.', 18));
parts.push(text(55, 1610, 'Los recorridos son un estudio de conectividad geométrica. No aceptan atraque, navegación cargada ni tiempos jugados.', 18, '#9abbbc'), text(55, 1640, 'El esquema regional aprobado sigue vigente. Aquí se separa la base medida de la expansión que aún hay que construir.', 18, '#9abbbc'), '</g></svg>');
await fs.writeFile(path.join(out, 'terrain-survey.svg'), parts.join('\n') + '\n');
console.log(JSON.stringify({ out, heightSha256: before, anchors: anchors.length,
  sites: sites.map(({ id, footprint, land, sea }) => ({ id, footprint, land: { ...land, points: land.points?.length }, sea: { ...sea, points: sea.points?.length } })),
  junction: { ...joinPath, points: joinPath.points?.length }, recommendation: { ...report.recommendation, measuredApproach: undefined } }, null, 2));
