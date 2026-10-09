import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen.js';
import { resourceLayout } from '../src/data/resources.js';
import { World } from '../src/sim/world.js';
import { canStand, moveWithCollision } from '../src/sim/systems/movement.js';
import { preserveTerrainSites } from '../src/render/terrainSites.js';
import { buildShrubs } from '../src/render/shrubPlacement.js';
import { buildGrassPatches } from '../src/render/grassPlacement.js';
import { buildPalmBases } from '../src/render/palmBaseGeometry.js';
import { buildBeachDetails } from '../src/render/beachDetails.js';

const dir = new URL('../docs/art/map-revamp/', import.meta.url);
const baseline = JSON.parse(readFileSync(new URL('baseline-v1.json', dir), 'utf8'));
const rawHeights = readFileSync(new URL('baseline-heights-v1.bin', dir));
const oldHeights = new Float32Array(rawHeights.buffer, rawHeights.byteOffset, rawHeights.byteLength / 4);
const seed = baseline.seed;
const near = (a, b, e = 0.025) => assert.ok(Math.abs(a - b) <= e, `${a} differs from ${b} by more than ${e}`);
const withoutY = (value) => {
  if (Array.isArray(value)) return value.map(withoutY);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'y').map(([k, v]) => [k, withoutY(v)]));
};

function oldHeightAt(x, z) {
  const N = baseline.N, res = baseline.res, half = baseline.size / 2;
  const fx = Math.max(0, Math.min(N - 1.001, (x + half) * res));
  const fz = Math.max(0, Math.min(N - 1.001, (z + half) * res));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * N + i;
  return (oldHeights[k] * (1 - tx) + oldHeights[k + 1] * tx) * (1 - tz)
    + (oldHeights[k + N] * (1 - tx) + oldHeights[k + N + 1] * tx) * tz;
}

test('revamp keeps the full seed baseline placement and gameplay landmarks intact', () => {
  const map = generateWorld(seed);
  assert.equal(map.props.length, 1259);
  assert.deepEqual(withoutY(map.props), withoutY(baseline.props));
  for (const key of ['colliders', 'npcs', 'enemySpawns', 'racks', 'checkpoints', 'dock', 'landmarks', 'cala'])
    assert.deepEqual(map[key], baseline[key], `${key} changed during terrain-only pass`);

  const byKind = new Map();
  for (const p of map.props) {
    if (['ship', 'float', 'dockPost'].includes(p.kind) || map.onDock(p.x, p.z)
      || p.y === map.dock.deckY + 0.62) continue;
    const prior = baseline.props[map.props.indexOf(p)];
    const old = oldHeightAt(p.x, p.z);
    near(p.y - prior.y, map.heightAt(p.x, p.z) - old, 0.035);
    byKind.set(p.kind, (byKind.get(p.kind) || 0) + 1);
  }
  assert.ok(byKind.get('hut') >= 6);
});

test('terrain expansion is deterministic, bounded, and leaves protected gameplay ground unchanged', () => {
  const a = generateWorld(seed), b = generateWorld(seed);
  assert.equal(a.size, 560);
  assert.deepEqual(a.heights, b.heights);
  for (const s of [1, 42]) {
    const other = generateWorld(s);
    assert.equal(other.heights.length, other.N * other.N);
    for (const h of other.heights) assert.ok(Number.isFinite(h));
  }
  let dry = 0, total = 0;
  for (let z = -280; z <= 280; z += 2) for (let x = -280; x <= 280; x += 2) {
    const h = a.groundAt(x, z); total++;
    if (h > 0.65) dry++;
  }
  const oldDry = (() => {
    let n = 0;
    for (let z = -200; z <= 200; z += 2) for (let x = -200; x <= 200; x += 2) if (oldHeightAt(x, z) > 0.65) n++;
    return n;
  })();
  assert.ok(dry >= oldDry * 1.4, `dryland area ratio ${dry / oldDry}`);
  for (const [x, z] of [[-280, -280], [280, 280], [-280, 0], [0, 280]]) assert.ok(Number.isFinite(a.heightAt(x, z)));
  assert.ok(a.heightAt(-279, 279) < -1, 'expanded outer margin should remain seabed');

  const { toWorld } = a;
  const protectedPoints = [];
  for (const [u, v, radius] of [[25, 0, 45], [84, 6, 55], [-35, 66, 29]]) {
    for (let d = 0; d <= radius; d += 3) for (let t = 0; t < 8; t++) {
      const p = toWorld(u + d * Math.cos(t * Math.PI / 4), v + d * Math.sin(t * Math.PI / 4));
      protectedPoints.push(p);
    }
  }
  for (const p of protectedPoints) near(a.heightAt(p.x, p.z), oldHeightAt(p.x, p.z), 0.035);
  for (let u = -155; u <= -132; u += 2) for (let v = 0; v <= 36; v += 3) {
    const p = toWorld(u, v);
    near(a.heightAt(p.x, p.z), oldHeightAt(p.x, p.z), 0.035);
  }
  // Every sampled dry cell should belong to the spawn landmass; isolated dry specks are a terrain defect.
  const grid = new Map(); let dryCells = 0;
  for (let j = 0; j <= 280; j++) for (let i = 0; i <= 280; i++) {
    const p = { x: -280 + i * 2, z: -280 + j * 2 };
    if (a.groundAt(p.x, p.z) > 0.2) { grid.set(`${i},${j}`, 0); dryCells++; }
  }
  const spawn = a.landmarks.spawn, si = Math.round((spawn.x + 280) / 2), sj = Math.round((spawn.z + 280) / 2);
  let startKey = `${si},${sj}`;
  if (!grid.has(startKey)) {
    let best = Infinity;
    for (const key of grid.keys()) { const [i,j] = key.split(',').map(Number), d = (i-si)**2 + (j-sj)**2; if (d < best) { best=d; startKey=key; } }
  }
  const flood = [startKey]; grid.set(startKey, 1);
  for (let k=0; k<flood.length; k++) {
    const [i,j] = flood[k].split(',').map(Number);
    for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const key=`${i+di},${j+dj}`;
      if (grid.has(key) && grid.get(key) === 0) { grid.set(key,1); flood.push(key); }
    }
  }
  assert.ok(flood.length / dryCells >= 0.98, `spawn component covers ${(100*flood.length/dryCells).toFixed(2)}% of sampled dry cells`);
});

test('town hut pads sit on their intended terrace with level support footprints', () => {
  const map = generateWorld(seed);
  const huts = map.props.filter(p => p.kind === 'hut');
  assert.equal(huts.length, 6);
  const expected = [10.4, 6.4, 2.4, 2.4, 10.4, 6.4];
  for (let i = 0; i < huts.length; i++) {
    const hut = huts[i];
    near(map.heightAt(hut.x, hut.z), expected[i], 0.18);
    let lo = Infinity, hi = -Infinity;
    for (let z = -3.5; z <= 3.5; z += 1) for (let x = -3.5; x <= 3.5; x += 1) {
      if (x * x + z * z > 12.25) continue;
      const h = map.heightAt(hut.x + x, hut.z + z); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    assert.ok(hi - lo < 0.22, `hut ${i} footprint varied ${lo}..${hi}`);
  }
});

test('resources preserve their baseline identity and horizontal layout while returning fresh records', () => {
  const map = generateWorld(seed), first = resourceLayout(map), second = resourceLayout(map);
  assert.equal(first.nodes.length, 206);
  assert.deepEqual(withoutY({ ...first, nodes: first.nodes.slice(0, 176) }), withoutY(baseline.resources));
  assert.equal(first.nodes.filter(n => n.kind === 'rock').length, 24);
  assert.equal(first.nodes.filter(n => n.kind === 'iron_ore').length, 6);
  assert.notEqual(first.nodes, second.nodes);
  assert.notEqual(first.nodes[0], second.nodes[0]);
  const before = second.nodes[0].x;
  first.nodes[0].x += 1000;
  assert.equal(second.nodes[0].x, before);
  assert.notEqual(first.bench, second.bench);
  assert.deepEqual(withoutY(second.bench), withoutY(baseline.resources.bench));
  assert.equal(second.bench.x, baseline.resources.bench.x);
  assert.equal(second.bench.z, baseline.resources.bench.z);
});

test('cosmetic terrain sites retain legacy decisions and reproject onto the reshaped ground', () => {
  const map = generateWorld(seed), source = map.terrainSource;
  const shrubs = buildShrubs(source);
  const builders = [
    ['shrubs', buildShrubs, undefined],
    ['grass', buildGrassPatches, { shrubs }],
    ['palm bases', buildPalmBases, undefined],
    ['beach details', buildBeachDetails, undefined],
  ];
  const plain = (v) => Array.isArray(v) ? v.map(plain) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !['y','nx','ny','nz','original'].includes(k)).map(([k,x])=>[k,plain(x)])) : v;
  for (const [label, build, options] of builders) {
    const legacy = build(source, options), projected = preserveTerrainSites(map, build, options);
    assert.deepEqual(plain(projected), plain(legacy), `${label} placement decisions changed`);
    const flatten = (v, path='root', out=[]) => {
      if (Array.isArray(v)) v.forEach((x,i)=>flatten(x,`${path}.${i}`,out));
      else if (v && typeof v === 'object') {
        if (Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.y)) out.push({v,path});
        else for (const [k,x] of Object.entries(v)) flatten(x,`${path}.${k}`,out);
      }
      return out;
    };
    const oldSites=flatten(legacy), newSites=flatten(projected);
    assert.equal(newSites.length,oldSites.length,`${label} site count changed`);
    for (let i=0;i<oldSites.length;i++) {
      const {v:old}=oldSites[i], {v:next}=newSites[i];
      assert.equal(next.x,old.x); assert.equal(next.z,old.z);
      near(next.y-old.y,map.heightAt(old.x,old.z)-source.heightAt(old.x,old.z),0.035);
      for (const n of ['nx','ny','nz']) if (n in next) assert.ok(Number.isFinite(next[n]),`${label} ${n} is not finite`);
      if (old.original) assert.equal(next.original,map.props[source.props.indexOf(old.original)],`${label} original prop was not remapped`);
    }
  }
});

test('spawn can navigate to town services, the arena gate, Cala entry, and both expansions using live collision rules', () => {
  const world = new World(seed), map = world.map, player = world.spawnPlayer({ name: 'map-test' });
  const step = 1.5, width = Math.ceil(map.size / step), origin = -map.half + 2;
  const indexAt = (x, z) => [Math.round((x - origin) / step), Math.round((z - origin) / step)];
  const pointAt = (i, j) => ({ x: origin + i * step, z: origin + j * step });
  const start = indexAt(map.landmarks.spawn.x, map.landmarks.spawn.z);
  const startPoint = pointAt(start[0], start[1]);
  world.ecs.x[player]=startPoint.x; world.ecs.z[player]=startPoint.z; world.ecs.y[player]=map.groundAt(startPoint.x,startPoint.z);
  const queue = [start], seen = new Set([`${start[0]},${start[1]}`]), parent = new Map();
  const goals = [
    ...map.npcs.map(n => ({ id: `npc:${n.id}`, x: n.x, z: n.z, radius: 2.2 })),
    ...map.racks.map(r => ({ id: `rack:${r.id}`, x: r.x, z: r.z, radius: 2.1 })),
    { id: 'bench', x: resourceLayout(map).bench.x, z: resourceLayout(map).bench.z, radius: 2.2 },
    { id: 'arena-entry', ...map.landmarks.path.at(-1), radius: 3.5 },
    { id: 'cala-entry', ...map.cala.entry, radius: 3.5 },
    ...map.terrainLayout.connections.map((connection, i) => ({ id: `expansion-${i + 1}`, ...connection.access, radius: 2.5 })),
  ];
  const reached = new Set();
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let q = 0; q < queue.length && q < 100000 && reached.size < goals.length; q++) {
    const [i,j] = queue[q], p = pointAt(i,j), key = `${i},${j}`;
    for (const g of goals) if (!reached.has(g.id) && Math.hypot(p.x-g.x,p.z-g.z) <= g.radius) reached.add(g.id);
    for (const [di,dj] of dirs) {
      const ni=i+di,nj=j+dj,nk=`${ni},${nj}`;
      if (seen.has(nk) || ni<0 || nj<0 || ni>=width || nj>=width) continue;
      const np=pointAt(ni,nj);
      if (!canStand(world,np.x,np.z,world.ecs.radius[player],world.ecs.y[player])) continue;
      world.ecs.x[player]=p.x; world.ecs.z[player]=p.z; world.ecs.y[player]=map.groundAt(p.x,p.z);
      const length=Math.hypot(np.x-p.x,np.z-p.z), steps=Math.ceil(length/0.15);
      for (let s=0;s<steps;s++) moveWithCollision(world,player,(np.x-p.x)/steps,(np.z-p.z)/steps);
      const arrived=Math.hypot(world.ecs.x[player]-np.x,world.ecs.z[player]-np.z)<=0.05;
      world.ecs.x[player]=p.x; world.ecs.z[player]=p.z; world.ecs.y[player]=map.groundAt(p.x,p.z);
      if (!arrived) continue;
      seen.add(nk); parent.set(nk,key); queue.push([ni,nj]);
    }
  }
  assert.deepEqual([...reached].sort(), goals.map(g=>g.id).sort(), `unreachable targets: ${goals.map(g=>g.id).filter(x=>!reached.has(x)).join(', ')}`);
  const pvp = map.toWorld(25, 0), cala = map.cala;
  assert.equal(map.lawlessAt(pvp.x,pvp.z), false);
  assert.equal(map.lawlessAt(cala.x,cala.z), true);
  assert.equal(map.zoneAt(cala.x,cala.z), 'calavera');
});
