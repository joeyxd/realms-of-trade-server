import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { GRASS_STYLES, grassGeometry } from '../src/render/grassGeometry.js';
import { GRASS_LIMIT, buildGrassPatches, grassBudget } from '../src/render/grassPlacement.js';
import { createGrassPatches } from '../src/render/grassPatches.js';
import { buildShrubs } from '../src/render/shrubPlacement.js';

const EPS = 1e-6;

function mapFixture(patch = {}) {
  const map = {
    seed: 71, half: 60, props: [], heightAt: () => 1, materialAt: () => 'grass',
    masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }), onDock: () => false,
    landmarks: {}, npcs: [], racks: [], enemySpawns: [], ...patch,
  };
  Object.defineProperty(map, 'rng', { get() { throw new Error('cosmetic grass placement must not consume world RNG'); } });
  return map;
}

function assertGrassGeometry(geometry, label) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color'), uv = geometry.getAttribute('uv'), flex = geometry.getAttribute('aFlex');
  assert.ok(position?.count >= 3, `${label} has vertices`);
  for (const [attribute, name, size] of [[normal, 'normal', 3], [color, 'color', 3], [uv, 'UV', 2], [flex, 'flex', 1]]) {
    assert.equal(attribute?.count, position.count, `${label} has one ${name} per vertex`);
    assert.equal(attribute.itemSize, size, `${label} ${name} width is valid`);
  }
  for (let i = 0; i < position.count; i++) {
    for (const [attribute, name] of [[position, 'position'], [normal, 'normal'], [color, 'color'], [uv, 'UV'], [flex, 'flex']])
      for (let k = 0; k < attribute.itemSize; k++) assert.ok(Number.isFinite(attribute.getComponent(i, k)), `${label} ${name} ${i}:${k} is finite`);
    assert.ok(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 1e-4, `${label} normals are unit length`);
    for (let k = 0; k < 3; k++) assert.ok(color.getComponent(i, k) >= 0 && color.getComponent(i, k) <= 1, `${label} color is normalized`);
    assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1, `${label} UV is normalized`);
  }
  assert.equal(Math.min(...flex.array), 0, `${label} blade roots are rigid`);
  assert.equal(Math.max(...flex.array), 1, `${label} blade tips can flex`);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  assert.ok([...geometry.boundingBox.min.toArray(), ...geometry.boundingBox.max.toArray(), geometry.boundingSphere.radius].every(Number.isFinite));
  assert.ok(geometry.boundingBox.max.y <= 0.85, `${label} stays below the height budget`);
  let radialExtent = 0;
  for (let i = 0; i < position.count; i++) radialExtent = Math.max(radialExtent, Math.hypot(position.getX(i), position.getZ(i)));
  assert.ok(radialExtent <= 0.85, `${label} stays within its placement radius`);
  const index = geometry.index;
  assert.ok(index, `${label} is indexed`);
  for (let i = 0; i < index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 2));
    assert.ok(new THREE.Triangle(a, b, c).getArea() > EPS, `${label} has no degenerate triangles`);
  }
  return geometry;
}

test('three grass styles have compact full and far geometry with sound attributes', () => {
  assert.deepEqual(GRASS_STYLES, ['tuft', 'fan', 'wild']);
  const fullTris = [28, 36, 44], farTris = [14, 18, 22];
  for (let variant = 0; variant < GRASS_STYLES.length; variant++) {
    for (const [mode, expected] of [[{}, fullTris[variant]], [{ low: true }, farTris[variant]]]) {
      const geometry = grassGeometry(variant, mode);
      assertGrassGeometry(geometry, `${GRASS_STYLES[variant]} ${mode.low ? 'far' : 'full'}`);
      assert.equal(geometry.index.count / 3, expected);
      geometry.dispose();
    }
  }
  assert.throws(() => grassGeometry(-1), /Unknown grass variant/);
  assert.throws(() => grassGeometry(3), /Unknown grass variant/);
});

test('grass placement is coordinate-hash deterministic, capped, safe, and leaves world inputs alone', () => {
  const map = mapFixture({ half: 165, seed: 99282957, props: [
    { kind: 'bush', x: -35, z: 18, y: 1, scale: 1, rot: 0.4 },
    { kind: 'palm', x: 12, z: -8, y: 1, h: 6, scale: 1, rot: 0.2 },
    { kind: 'hut', x: 30, z: 30, r: 3 },
  ] });
  const propsBefore = structuredClone(map.props), shrubs = [{ x: 0, z: 0, radius: 2 }];
  const shrubsBefore = structuredClone(shrubs);
  const first = buildGrassPatches(map, { shrubs }), second = buildGrassPatches(map, { shrubs });
  assert.ok(first.length > 0, 'safe grass terrain receives sparse patches');
  assert.deepEqual(first, second);
  assert.ok(first.length <= GRASS_LIMIT);
  assert.equal(buildGrassPatches(map, { shrubs, limit: 12 }).length, 12);
  assert.equal(buildGrassPatches(map, { shrubs, limit: 0 }).length, 0);
  assert.deepEqual(map.props, propsBefore);
  assert.deepEqual(shrubs, shrubsBefore);
  assert.deepEqual(buildGrassPatches({ ...map, props: [...map.props].reverse() }, { shrubs }), first,
    'input prop ordering does not change selected patches');
  for (const p of first) {
    for (const key of ['x', 'y', 'z', 'nx', 'ny', 'nz', 'rot', 'scale', 'radius']) assert.ok(Number.isFinite(p[key]), `${key} is finite`);
    assert.ok(p.variant >= 0 && p.variant < GRASS_STYLES.length);
    assert.ok(p.scale >= 0.7 && p.scale <= 1.25);
    assert.ok(Math.abs(p.radius - p.scale * 0.85) < EPS);
    assert.ok(Math.abs(Math.hypot(p.nx, p.ny, p.nz) - 1) < 1e-6 && p.ny > 0.9);
    assert.ok(Math.hypot(p.x, p.z) >= p.radius + shrubs[0].radius + 0.2,
      'patch avoids the supplied shrub footprint');
  }
  const patches = new Map();
  for (const p of first) patches.set(p.patch, (patches.get(p.patch) || 0) + 1);
  assert.ok([...patches.values()].every((count) => count <= 5), 'each sparse patch has at most five clumps');
});

test('grass placement inherits terrain, mask, access, obstacle, dock, and shrub exclusions', () => {
  const unsafeMaps = [
    ['water', mapFixture({ half: 18, materialAt: () => 'water' })],
    ['path', mapFixture({ half: 18, masks: () => ({ path: 0.16, volcanic: 0, arenaFloor: 0, lava: 0 }) })],
    ['lava', mapFixture({ half: 18, masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0.11 }) })],
    ['dock', mapFixture({ half: 18, onDock: () => true })],
    ['steep terrain', mapFixture({ half: 18, heightAt: (x) => 1 + x })],
    ['solid obstacle', mapFixture({ half: 18, props: [{ kind: 'hut', x: 0, z: 0, r: 100 }] })],
  ];
  for (const [label, map] of unsafeMaps) assert.deepEqual(buildGrassPatches(map), [], `${label} is excluded`);
  const clearCases = [
    ['spawn', mapFixture({ landmarks: { spawn: { x: 0, z: 0 } } }), (p) => p.radius + 6],
    ['village', mapFixture({ landmarks: { village: { x: 0, z: 0 } } }), (p) => p.radius + 8],
    ['dock approach', mapFixture({ landmarks: { dockBase: { x: -10, z: 0 }, dockEnd: { x: 10, z: 0 } } }), (p) => p.radius + 3],
    ['access point', mapFixture({ npcs: [{ x: 0, z: 0, r: 0.5 }] }), (p) => p.radius + 2.5],
  ];
  for (const [label, map, clearance] of clearCases) {
    const points = buildGrassPatches(map);
    assert.ok(points.length > 0, `${label} fixture retains safe ground elsewhere`);
    for (const p of points) {
      const t = Math.max(0, Math.min(1, (p.x + 10) / 20));
      const d = label === 'dock approach' ? Math.hypot(p.x - (-10 + 20 * t), p.z) : Math.hypot(p.x, p.z);
      assert.ok(d >= clearance(p) - EPS, `${label} keeps its access clearance`);
    }
  }
  const blockedByShrubs = mapFixture({ half: 18 });
  assert.deepEqual(buildGrassPatches(blockedByShrubs, { shrubs: [{ x: 0, z: 0, radius: 100 }] }), [], 'existing shrub footprint excludes grass');
});

test('grass quality tiers impose the requested instance and LOD budgets', () => {
  assert.deepEqual(grassBudget('high'), { limit: 600, distance: 55, detailDistance: 24 });
  assert.deepEqual(grassBudget('medium'), { limit: 320, distance: 38, detailDistance: 14 });
  assert.deepEqual(grassBudget('high', true), { limit: 320, distance: 38, detailDistance: 14 });
  assert.deepEqual(grassBudget('low'), { limit: 160, distance: 28, detailDistance: 0 });
});

test('seeded world grass stays deterministic and within the coordinate-hash cap', () => {
  const map = generateWorld(99282957), before = structuredClone(map.props);
  const shrubs = buildShrubs(map), first = buildGrassPatches(map, { shrubs });
  assert.ok(first.length > 0 && first.length <= GRASS_LIMIT);
  assert.deepEqual(buildGrassPatches({ ...map, props: [...map.props].reverse() }, { shrubs }), first);
  assert.deepEqual(map.props, before);
});

test('grass renderer shares opaque resources, applies distance LOD, and reuses batches across quality changes', () => {
  const map = generateWorld(99282957), shrubs = buildShrubs(map), grass = createGrassPatches(map, { shrubs });
  try {
    assert.ok(grass.points.length > 0 && grass.points.length <= GRASS_LIMIT);
    const meshes = grass.group.children;
    assert.ok(meshes.length > 0);
    const material = meshes[0].material;
    assert.ok(material, 'grass has a material');
    assert.equal(material.map, null); assert.equal(material.normalMap, null);
    assert.equal(material.alphaTest, 0); assert.equal(material.transparent, false);
    assert.equal(material.depthWrite, true);
    assert.equal(material.side, THREE.DoubleSide);
    assert.ok(meshes.every((mesh) => mesh.material === material), 'all batches share one material');
    assert.ok(meshes.every((mesh) => mesh.castShadow === false), 'grass avoids shadow-map draw cost');
    assert.ok(meshes.every((mesh) => mesh.layers.mask === 1 << 2), 'grass skips the outline pass');
    assert.ok(meshes.every((mesh) => mesh.isInstancedMesh));

    const originalChildren = [...meshes], originalGeometries = new Set(meshes.map((mesh) => mesh.geometry));
    const originalMaterial = material;
    const points = grass.points;
    const nearest = points.reduce((best, p) => !best || Math.hypot(p.x, p.z) < Math.hypot(best.x, best.z) ? p : best, null);
    grass.update({ x: nearest.x, z: nearest.z });
    const stats = grass.group.userData.grass;
    const expectedHigh = points.slice(0, 600).filter((p) => Math.hypot(p.x - nearest.x, p.z - nearest.z) <= 55);
    const expectedNear = expectedHigh.filter((p) => Math.hypot(p.x - nearest.x, p.z - nearest.z) <= 24).length;
    assert.equal(stats.active, expectedHigh.length, 'active instances obey the high distance and priority cap');
    assert.equal(stats.near, expectedNear, 'near LOD follows the high detail distance');
    assert.equal(stats.far, expectedHigh.length - expectedNear, 'remaining visible instances use the far mesh');
    assert.ok(stats.active > 0);
    assert.equal(meshes.reduce((sum, mesh) => sum + mesh.count, 0), stats.active);
    assert.ok(meshes.every((mesh) => Number.isFinite(mesh.boundingSphere.radius)));

    const expectedTriangles = expectedHigh.reduce((sum, p) => sum + (Math.hypot(p.x - nearest.x, p.z - nearest.z) <= 24
      ? [28, 36, 44][p.variant] : [14, 18, 22][p.variant]), 0);
    assert.equal(stats.triangles, expectedTriangles, 'triangle stats use the full and shared far geometry');
    for (const [name, mobile, distance, detailDistance, limit] of [
      ['medium', false, 38, 14, 320], ['high', true, 38, 14, 320], ['low', false, 28, 0, 160], ['high', false, 55, 24, 600],
    ]) {
      grass.setQuality(name, mobile);
      const eligible = points.slice(0, limit).filter((p) => Math.hypot(p.x - nearest.x, p.z - nearest.z) <= distance);
      const nearCount = eligible.filter((p) => detailDistance > 0 && Math.hypot(p.x - nearest.x, p.z - nearest.z) <= detailDistance).length;
      assert.equal(stats.active, eligible.length, `${name}${mobile ? ' mobile' : ''} distance and cap are applied`);
      assert.equal(stats.near, nearCount, `${name}${mobile ? ' mobile' : ''} detail distance is applied`);
      assert.equal(stats.far, eligible.length - nearCount);
      assert.deepEqual(grass.group.children, originalChildren, 'quality change does not allocate batches');
      assert.equal(grass.group.children[0].material, originalMaterial, 'quality change does not allocate a material');
      assert.ok(grass.group.children.every((mesh) => originalGeometries.has(mesh.geometry)), 'quality change reuses full and shared far geometry');
    }
    grass.setQuality('low'); grass.update(points[0]);
    assert.equal(stats.near, 0, 'low uses far geometry even when the focus sits exactly on a blade root');
    grass.update({ x: nearest.x + 10, z: nearest.z - 4 });
    assert.deepEqual(grass.group.children, originalChildren, 'moving focus updates existing batches');
  } finally {
    grass.group.traverse((object) => { if (object.isInstancedMesh) object.geometry.dispose(); });
    const materials = new Set(grass.group.children.map((mesh) => mesh.material));
    materials.forEach((material) => material.dispose());
  }
});
