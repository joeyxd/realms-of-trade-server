import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { DEBRIS_IDS, DEBRIS_STYLES, debrisGeometry, loadedDebrisGeometry } from '../src/render/beachDebrisGeometry.js';
import { DEBRIS_LIMIT, buildBeachDebris, debrisBudget } from '../src/render/beachDebrisPlacement.js';
import { createBeachDebris } from '../src/render/beachDebris.js';

const EPS = 1e-6;
import fs from 'node:fs';
import crypto from 'node:crypto';
function mapFixture(patch = {}) {
  const map = { seed: 71, half: 60, props: [], heightAt: () => 0.8, materialAt: () => 'sand',
    masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }), onDock: () => false,
    landmarks: {}, npcs: [], racks: [], enemySpawns: [], ...patch };
  Object.defineProperty(map, 'rng', { get() { throw new Error('cosmetic debris placement must not consume world RNG'); } });
  return map;
}
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { adaptSourceWood } from '../src/render/beachDebrisGeometry.js';
async function parseGlb(relativePath) {
  const bytes = fs.readFileSync(new URL(`../${relativePath}`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(buffer, '');
}
function firstMeshGeometry(gltf) {
  gltf.scene.updateMatrixWorld(true);
  let geometry = null;
  gltf.scene.traverse((object) => {
    if (!geometry && object.isMesh) geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
  });
  assert.ok(geometry, 'GLB has a mesh');
  return geometry;
}
function positionHash(geometry) {
  const position = geometry.getAttribute('position');
  return crypto.createHash('sha256').update(Buffer.from(position.array.buffer, position.array.byteOffset, position.array.byteLength)).digest('hex');
}
function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function assertSoundGeometry(geometry, label) {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), c = geometry.getAttribute('color');
  assert.ok(p?.count >= 3, `${label} has vertices`);
  for (const [a, name] of [[n, 'normal'], [c, 'color']]) {
    assert.equal(a?.itemSize, 3); assert.equal(a.count, p.count, `${label} has matching ${name}`);
    for (const v of a.array) assert.ok(Number.isFinite(v), `${label} ${name} is finite`);
  }
  for (const v of p.array) assert.ok(Number.isFinite(v), `${label} position is finite`);
  let minY = Infinity, maxY = -Infinity, radial = 0;
  for (let i = 0; i < p.count; i++) {
    minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i));
    radial = Math.max(radial, Math.hypot(p.getX(i), p.getZ(i)));
  }
  assert.ok(minY >= -EPS && maxY <= 0.45 + EPS, `${label} stays grounded and below 0.45m`);
  assert.ok(radial <= 1.35 + EPS, `${label} fits its 1.35m radial footprint`);
  const index = geometry.index;
  assert.ok(index?.count > 0 && index.count % 3 === 0);
  for (let i = 0; i < index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, index.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 2));
    assert.ok(new THREE.Triangle(a, b, c).getArea() > EPS, `${label} has no degenerate triangle`);
  }
  assert.ok(index.count / 3 <= 250, `${label} is within the 250-triangle budget`);
}

test('three painted driftwood styles have finite grounded, non-degenerate geometry within budget', () => {
  assert.deepEqual(DEBRIS_STYLES, ['branch', 'log', 'planks']);
  assert.equal(DEBRIS_IDS.length, 3);
  for (let i = 0; i < DEBRIS_STYLES.length; i++) {
    const geometry = debrisGeometry(i);
    assertSoundGeometry(geometry, DEBRIS_STYLES[i]);
    geometry.dispose();
  }
});

test('loaded debris accepts safe geometry by clone and rejects invalid data without mutation', () => {
  const registryData = (geo) => ({ parts: [{ geo }] });
  for (const [label, data] of [
    ['missing registry parts', {}],
    ['ambiguous multiple parts', { parts: [{ geo: null }, { geo: null }] }],
    ['missing part geometry', { parts: [{}] }],
  ]) assert.equal(loadedDebrisGeometry(data), null, `${label} is rejected`);
  const safe = debrisGeometry(1), safeBefore = safe.getAttribute('position').array.slice();
  const accepted = loadedDebrisGeometry(registryData(safe));
  assert.ok(accepted && accepted !== safe, 'valid exported geometry is cloned');
  assert.deepEqual(safe.getAttribute('position').array, safeBefore, 'source data is unchanged');
  accepted.dispose(); safe.dispose();

  const invalidCases = [
    ['missing normal', (g) => g.deleteAttribute('normal')],
    ['non-finite normal', (g) => g.getAttribute('normal').setX(0, Infinity)],
    ['non-finite color', (g) => g.getAttribute('color').setY(0, NaN)],
    ['non-finite position', (g) => g.getAttribute('position').setX(0, NaN)],
    ['degenerate triangle', (g) => { const p = g.getAttribute('position'); p.setXYZ(1, p.getX(0), p.getY(0), p.getZ(0)); }],
    ['oversized footprint', (g) => g.getAttribute('position').setX(0, 2)],
    ['height outside bounds', (g) => g.getAttribute('position').setY(0, 0.8)],
    ['invalid index', (g) => { const index = g.index.array; index[0] = 999999; }],
  ];
  for (const [label, damage] of invalidCases) {
    const source = debrisGeometry(1), positionBefore = source.getAttribute('position').array.slice();
    damage(source);
    const damagedBefore = source.getAttribute('position').array.slice();
    assert.equal(loadedDebrisGeometry(registryData(source)), null, `${label} is rejected`);
    assert.deepEqual(source.getAttribute('position').array, damagedBefore, `${label} source is not mutated`);
    source.dispose();
  }
});

test('audited SM_Logs topology adapts without mutation and prepared GLBs pass registry validation', async () => {
  const sourceGltf = await parseGlb('docs/art/source/beach-debris-v1/SM_Logs.geometry-export.glb');
  const source = firstMeshGeometry(sourceGltf), sourceBefore = positionHash(source);
  assert.equal((source.index?.count ?? source.getAttribute('position').count) / 3, 132, 'audited source retains 132 triangles');
  const prepared = adaptSourceWood(source);
  assert.ok(prepared, 'audited stacked boards adapt into painted geometry');
  assert.equal((prepared.index?.count ?? prepared.getAttribute('position').count) / 3, 132, 'adaptation preserves source topology');
  assertSoundGeometry(prepared, 'adapted SM_Logs boards');
  assert.equal(prepared.getAttribute('uv')?.count, prepared.getAttribute('position').count, 'adapted wood has UVs');
  assert.notEqual(positionHash(prepared), sourceBefore, 'adaptation normalizes source bounds');
  assert.equal(positionHash(source), sourceBefore, 'loader-owned source positions remain unchanged');
  const preparedLoaded = loadedDebrisGeometry({ parts: [{ geo: prepared }] });
  assert.ok(preparedLoaded, 'adapted source passes registry payload validation');
  preparedLoaded.dispose(); prepared.dispose(); source.dispose();
  sourceGltf.scene.traverse((object) => { if (object.isMesh) object.material?.dispose?.(); });

  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
  const modelsById = new Map(manifest.assets.filter((asset) => DEBRIS_IDS.includes(asset.id)).map((asset) => [asset.id, asset]));
  assert.deepEqual([...modelsById.keys()].sort(), [...DEBRIS_IDS].sort(), 'manifest contains the three debris model ids');
  assert.deepEqual(DEBRIS_IDS.map((id) => id.split(':')[1].replace('beach-debris-', '').replace('-v1', '')), DEBRIS_STYLES);
  for (const id of DEBRIS_IDS) {
    const entry = modelsById.get(id), modelPath = `assets/${entry.src}`, gltf = await parseGlb(modelPath), geometry = firstMeshGeometry(gltf);
    const modelBefore = positionHash(geometry);
    assert.ok(fs.statSync(new URL(`../${modelPath}`, import.meta.url)).size <= 32 * 1024, `${id} GLB stays within the file budget`);
    assert.equal(gltf.parser.json.images?.length ?? 0, 0, `${id} embeds no images`);
    const loaded = loadedDebrisGeometry({ parts: [{ geo: geometry }] });
    assert.ok(loaded, `${id} round-trips through the registry payload and validator`);
    assert.ok((loaded.index?.count ?? loaded.getAttribute('position').count) / 3 <= 250, `${id} stays within triangle budget`);
    assert.equal(loaded.getAttribute('color')?.count, loaded.getAttribute('position').count, `${id} keeps vertex paint`);
    assert.equal(loaded.getAttribute('uv')?.count, loaded.getAttribute('position').count, `${id} keeps UVs`);
    assert.equal(positionHash(geometry), modelBefore, `${id} registry validation does not mutate source geometry`);
    assert.ok(gltf.scene.children.every((object) => !object.isMesh || !(object.material.map || object.material.normalMap)), `${id} has no loaded texture maps`);
    loaded.dispose(); geometry.dispose();
    gltf.scene.traverse((object) => { if (object.isMesh) object.material?.dispose?.(); });
  }
});

test('debris placement is deterministic, capped, independent of props ordering, and RNG-free', () => {
  const map = mapFixture({ half: 165, seed: 99282957, props: [
    { kind: 'bush', x: -35, z: 18, y: 1, scale: 1, rot: 0.4 },
    { kind: 'palm', x: 12, z: -8, y: 1, h: 6, scale: 1, rot: 0.2 },
    { kind: 'hut', x: 30, z: 30, r: 3 },
  ] });
  const before = structuredClone(map.props), shrubs = [{ x: 0, z: 0, radius: 2 }], shrubsBefore = structuredClone(shrubs);
  const first = buildBeachDebris(map, { shrubs }), second = buildBeachDebris(map, { shrubs });
  assert.ok(first.length > 0 && first.length <= DEBRIS_LIMIT);
  assert.deepEqual(first, second);
  assert.deepEqual(map.props, before); assert.deepEqual(shrubs, shrubsBefore);
  assert.equal(buildBeachDebris(map, { shrubs, limit: 8 }).length, 8);
  assert.equal(buildBeachDebris(map, { shrubs, limit: 0 }).length, 0);
  assert.deepEqual(buildBeachDebris({ ...map, props: [...map.props].reverse() }, { shrubs }), first);
  assert.ok(first.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.variant >= 0 && p.variant < 3));
  assert.ok(first.every((p) => Math.hypot(p.x, p.z) >= p.radius + shrubs[0].radius + 0.2));
});

test('debris footprint stays on sand and outside water, paths, docks, access, obstacles, and earlier clearances', () => {
  const unsafe = [
    ['water', mapFixture({ half: 30, materialAt: () => 'water' })],
    ['path', mapFixture({ half: 30, masks: () => ({ path: 1, volcanic: 0, arenaFloor: 0, lava: 0 }) })],
    ['dock', mapFixture({ half: 30, onDock: () => true })],
  ];
  for (const [label, map] of unsafe) assert.deepEqual(buildBeachDebris(map), [], `${label} is excluded`);
  const crossing = mapFixture({ half: 40, masks: (x) => ({ path: Math.abs(x) < 4 ? 1 : 0, volcanic: 0, arenaFloor: 0, lava: 0 }),
    materialAt: (x) => x < 0 ? 'water' : 'sand' });
  for (const p of buildBeachDebris(crossing)) for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, x = p.x + Math.cos(a) * p.radius, z = p.z + Math.sin(a) * p.radius;
    assert.equal(crossing.materialAt(x, z), 'sand', 'whole footprint avoids water boundary');
    assert.equal(crossing.masks(x, z).path, 0, 'whole footprint avoids paths');
  }
  const map = mapFixture({ half: 165, seed: 80321,
    landmarks: { spawn: { x: 0, z: 0 }, village: { x: 80, z: 80 }, dockBase: { x: -80, z: 0 }, dockEnd: { x: 80, z: 0 } },
    npcs: [{ x: -60, z: 60, r: 1 }], racks: [{ x: 60, z: -60, r: 1 }], enemySpawns: [{ x: 60, z: 60, r: 1 }],
    props: [{ kind: 'rock', x: -60, z: -60, r: 2 }] });
  const shrubs = [{ x: 0, z: 0, radius: 1.1 }], grass = [{ x: 0, z: 0, radius: 0.9 }];
  const points = buildBeachDebris(map, { shrubs, grass });
  assert.ok(points.length > 0);
  for (const p of points) {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, x = p.x + Math.cos(a) * p.radius, z = p.z + Math.sin(a) * p.radius;
      assert.equal(map.materialAt(x, z), 'sand'); assert.equal(map.onDock(x, z), false);
      assert.equal(map.masks(x, z).path, 0);
    }
    assert.ok(Math.hypot(p.x, p.z) >= p.radius + 6 - EPS, 'spawn clearance');
    assert.ok(Math.hypot(p.x - 80, p.z - 80) >= p.radius + 8 - EPS, 'village clearance');
    assert.ok(segmentDistance(p.x, p.z, map.landmarks.dockBase, map.landmarks.dockEnd) >= p.radius + 3 - EPS, 'dock approach clearance');
    for (const a of [...map.npcs, ...map.racks, ...map.enemySpawns, ...map.props])
      assert.ok(Math.hypot(p.x - a.x, p.z - a.z) >= p.radius + (a.r || 0.5) + 2 - EPS, 'access or obstacle clearance');
    for (const a of [...shrubs, ...grass]) assert.ok(Math.hypot(p.x - a.x, p.z - a.z) >= p.radius + a.radius + 0.2 - EPS, 'S07/S08 vegetation clearance');
  }
});

test('quality tiers cap placement and visibility at requested distances', () => {
  assert.deepEqual(debrisBudget('high'), { limit: 96, distance: 65 });
  assert.deepEqual(debrisBudget('high', true), { limit: 64, distance: 45 });
  assert.deepEqual(debrisBudget('medium'), { limit: 64, distance: 45 });
  assert.deepEqual(debrisBudget('low'), { limit: 32, distance: 32 });
});

test('renderer uses shared opaque resources, distance culling, and reuses batches on quality changes', () => {
  const map = generateWorld(99282957), debris = createBeachDebris(map);
  try {
    const meshes = [...debris.group.children], stats = debris.group.userData.debris;
    assert.ok(debris.points.length > 0 && debris.points.length <= DEBRIS_LIMIT);
    assert.ok(meshes.length > 0 && meshes.every((mesh) => mesh.isInstancedMesh));
    const material = meshes[0].material, geometries = new Set(meshes.map((mesh) => mesh.geometry)), children = [...meshes];
    assert.ok(meshes.every((mesh) => mesh.material === material));
    assert.equal(material.map, null); assert.equal(material.normalMap, null); assert.equal(material.alphaTest, 0);
    assert.equal(material.transparent, false); assert.equal(material.depthWrite, true); assert.equal(material.side, THREE.DoubleSide);
    assert.ok(meshes.every((mesh) => mesh.castShadow === false && mesh.layers.mask === 1 << 2));
    const focus = debris.points.reduce((best, p) => !best || Math.hypot(p.x, p.z) < Math.hypot(best.x, best.z) ? p : best, null);
    debris.update({ x: focus.x, z: focus.z });
    for (const [name, mobile, limit, distance] of [['high', false, 96, 65], ['high', true, 64, 45], ['low', false, 32, 32]]) {
      debris.setQuality(name, mobile);
      const expected = debris.points.slice(0, limit).filter((p) => Math.hypot(p.x - focus.x, p.z - focus.z) <= distance).length;
      assert.equal(stats.active, expected, `${name}${mobile ? ' mobile' : ''} applies cap and culling radius`);
      assert.ok(stats.triangles <= 250 * stats.active, 'active triangle work stays bounded per instance');
      assert.deepEqual(debris.group.children, children, 'quality switches reuse batches');
      assert.ok(debris.group.children.every((mesh) => geometries.has(mesh.geometry)), 'quality switches reuse geometry');
      assert.ok(debris.group.children.every((mesh) => mesh.material === material), 'quality switches reuse material');
    }
  } finally {
    debris.group.traverse((object) => { if (object.isInstancedMesh) object.geometry.dispose(); });
    for (const material of new Set(debris.group.children.map((mesh) => mesh.material))) material.dispose();
  }
});

test('seeded map produces real stable debris placements', () => {
  const map = generateWorld(99282957), before = structuredClone(map.props), first = buildBeachDebris(map);
  assert.ok(first.length > 0 && first.length <= DEBRIS_LIMIT);
  assert.deepEqual(buildBeachDebris({ ...map, props: [...map.props].reverse() }), first);
  assert.deepEqual(map.props, before);
});


