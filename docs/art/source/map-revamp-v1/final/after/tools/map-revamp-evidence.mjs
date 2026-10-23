import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../src/sim/worldgen.js';
import { resourceLayout } from '../src/data/resources.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = resolve(root, 'docs/art/map-revamp');
const baseline = JSON.parse(await readFile(resolve(dir, 'baseline-v1.json'), 'utf8'));
const runtime = JSON.parse(await readFile(resolve(dir, 'runtime-evidence-v1.json'), 'utf8'));
assert.equal(runtime.family, 'map-revamp-v1');
assert.equal(runtime.after.length, 5, 'expected five final runtime captures');

const seed = 99282957;
assert.equal(baseline.seed, seed);
const map = generateWorld(seed), source = map.terrainSource;
assert.equal(map.seed, seed);
assert.deepEqual(Buffer.from(source.heights.buffer, source.heights.byteOffset, source.heights.byteLength),
  await readFile(resolve(dir, 'baseline-heights-v1.bin')), 'legacy heightfield differs from baseline bytes');

const omitY = (value) => {
  if (Array.isArray(value)) return value.map(omitY);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'y').map(([key, item]) => [key, omitY(item)]));
};
const sameJson = (a, b, label) => assert.deepEqual(a, b, label);
assert.equal(map.props.length, 1259);
sameJson(omitY(map.props), omitY(baseline.props), 'prop index/order/xz/non-y fields changed');
for (const key of ['colliders', 'npcs', 'enemySpawns', 'racks', 'checkpoints', 'dock', 'landmarks', 'cala'])
  sameJson(map[key], baseline[key], `${key} metadata changed`);

const resources = resourceLayout(map);
assert.equal(resources.nodes.length, 176);
sameJson(omitY(resources.nodes), omitY(baseline.resources.nodes), 'resource identity/order/xz/non-y fields changed');
sameJson(omitY(resources.bench), omitY(baseline.resources.bench), 'bench identity/xz/non-y fields changed');

const deltaStats = (rows, beforeRows) => {
  const deltas = rows.map((row, i) => row.y - beforeRows[i].y);
  const changed = deltas.filter((delta) => Math.abs(delta) > 1e-6);
  return { count: rows.length, changedCount: changed.length,
    minYDelta: Math.min(...deltas), maxYDelta: Math.max(...deltas) };
};
const propsY = deltaStats(map.props, baseline.props);
const resourcesY = deltaStats(resources.nodes, baseline.resources.nodes);
const hutExpected = [10.4, 6.4, 2.4, 2.4, 10.4, 6.4];
const huts = map.props.filter((p) => p.kind === 'hut');
assert.equal(huts.length, 6);
for (let i = 0; i < huts.length; i++) assert.ok(Math.abs(map.heightAt(huts[i].x, huts[i].z) - hutExpected[i]) < 0.18,
  `hut ${i} misses expected terrace`);

function sampledDry(size, threshold) {
  const half = size / 2, cells = new Set();
  let dryCount = 0;
  for (let z = -half; z <= half; z += 2) for (let x = -half; x <= half; x += 2) {
    if (threshold(x, z)) { const i = (x + half) / 2, j = (z + half) / 2; cells.add(`${i},${j}`); dryCount++; }
  }
  return { half, cells, dryCount };
}
const beforeLand = sampledDry(source.size, (x, z) => source.groundAt(x, z) > 0.65);
const afterLand = sampledDry(map.size, (x, z) => map.groundAt(x, z) > 0.65);
const dryIncreasePercent = (afterLand.dryCount / beforeLand.dryCount - 1) * 100;
assert.ok(dryIncreasePercent >= 40, `dryland area increase only ${dryIncreasePercent.toFixed(3)}%`);

const walk = sampledDry(map.size, (x, z) => map.groundAt(x, z) > 0.2);
const spawn = map.landmarks.spawn;
const startI = Math.round((spawn.x + walk.half) / 2), startJ = Math.round((spawn.z + walk.half) / 2);
const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let start = `${startI},${startJ}`;
if (!walk.cells.has(start)) {
  const si = startI, sj = startJ;
  start = [...walk.cells].sort((a, b) => {
    const [ai, aj] = a.split(',').map(Number), [bi, bj] = b.split(',').map(Number);
    return (ai-si)**2+(aj-sj)**2 - ((bi-si)**2+(bj-sj)**2);
  })[0];
}
const queue = [start], visited = new Set([start]);
for (let q = 0; q < queue.length; q++) {
  const [i, j] = queue[q].split(',').map(Number);
  for (const [di, dj] of neighbors) { const key = `${i+di},${j+dj}`; if (walk.cells.has(key) && !visited.has(key)) { visited.add(key); queue.push(key); } }
}
const connectedPercent = visited.size / walk.dryCount * 100;
assert.ok(connectedPercent >= 98, `spawn-connected dry cells only ${connectedPercent.toFixed(3)}%`);

const beforeRuntime = runtime.before;
const afterRuntime = runtime.after;
const asTerrain = (entry) => ({ device: entry.device, phase: entry.phase,
  size: entry.map.size, half: entry.map.half, gridResolution: entry.map.gridResolution,
  gridN: entry.map.gridN, gridBytes: entry.map.gridBytes,
  terrainGeometry: entry.terrainGeometry });
const runtimeBeforeCopy = JSON.stringify(beforeRuntime, null, 2) + '\n';
const evidence = {
  family: 'map-revamp-v1', seed, domain: 'Cala Calavera island terrain; deterministic map terrain only',
  terrainRevision: map.terrainRevision, mapSpan: map.mapSpan,
  before: { size: source.size, half: source.half, gridResolution: source.res, gridN: source.N,
    heightGridBytes: source.heights.byteLength, sampledDryCellsAbove0_65: beforeLand.dryCount,
    runtime: asTerrain(beforeRuntime) },
  after: { size: map.size, half: map.half, gridResolution: map.res, gridN: map.N,
    heightGridBytes: map.heights.byteLength, sampledDryCellsAbove0_65: afterLand.dryCount,
    drylandAreaIncreasePercent: Number(dryIncreasePercent.toFixed(6)),
    sampledDryCellsAbove0_2: walk.dryCount, spawnConnectedDryCellsAbove0_2: visited.size,
    spawnConnectedPercent: Number(connectedPercent.toFixed(6)),
    runtimeCaptures: afterRuntime.map(asTerrain) },
  cpuHeightGrids: { legacyBytes: source.heights.byteLength, revisedBytes: map.heights.byteLength,
    combinedBytes: source.heights.byteLength + map.heights.byteLength },
  compatibility: { sourceHeightfieldMatchesBaselineBytes: true,
    props: { count: map.props.length, legacyIndexOrderAndAllNonYFieldsUnchanged: true, ...propsY },
    resources: { count: resources.nodes.length, identitiesOrderAndXZUnchanged: true, ...resourcesY,
      benchXZUnchanged: true, benchYDelta: resources.bench.y - baseline.resources.bench.y },
    unchangedMetadata: ['colliders', 'npcs', 'enemySpawns', 'racks', 'checkpoints', 'dock', 'landmarks', 'cala'],
    hutTerraceHeights: huts.map((p) => map.heightAt(p.x, p.z)), hutExpectedTerraceHeights: hutExpected },
  runtimeTerrain: { beforeGpuBytes: beforeRuntime.terrainGeometry.bytes,
    afterGpuBytes: afterRuntime[0].terrainGeometry.bytes, gpuBytesIncrease: afterRuntime[0].terrainGeometry.bytes - beforeRuntime.terrainGeometry.bytes,
    beforeTriangles: beforeRuntime.terrainGeometry.triangles, afterTriangles: afterRuntime[0].terrainGeometry.triangles,
    gpuMetricsAcrossFiveCaptures: afterRuntime.map((entry) => ({ device: entry.device, bytes: entry.terrainGeometry.bytes,
      triangles: entry.terrainGeometry.triangles })) },
  scope: 'Deterministic data and captured geometry accounting; these measurements are not FPS evidence.'
};

await writeFile(resolve(dir, 'runtime-before-v1.json'), runtimeBeforeCopy, 'utf8');
await writeFile(resolve(dir, 'layout-evidence-v1.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ seed, drylandAreaIncreasePercent: evidence.after.drylandAreaIncreasePercent,
  spawnConnectedPercent: evidence.after.spawnConnectedPercent, props: evidence.compatibility.props,
  resources: evidence.compatibility.resources, cpuHeightGrids: evidence.cpuHeightGrids,
  runtimeTerrain: evidence.runtimeTerrain }, null, 2));
