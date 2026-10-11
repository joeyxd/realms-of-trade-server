import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { SEAWEED_STYLES, seaweedGeometry } from '../src/render/seaweedGeometry.js';
import { SEAWEED_LIMIT, buildSeaweed, seaweedBudget } from '../src/render/seaweedPlacement.js';
import { createSeaweed } from '../src/render/seaweed.js';

const EPS = 1e-6;

function mapFixture(patch = {}) {
  const map = {
    seed: 71, half: 60, props: [], heightAt: () => -1.4, materialAt: () => 'water',
    masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }), onDock: () => false,
    landmarks: {}, npcs: [], racks: [], enemySpawns: [], ...patch,
  };
  Object.defineProperty(map, 'rng', { get() { throw new Error('cosmetic seaweed placement must not consume world RNG'); } });
  return map;
}

function seaweedProp(x, z, scale = 1.1, y = -1.4) { return { kind: 'seaweed', x, z, y, scale, rot: 0.2 }; }

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, len = dx * dx + dz * dz;
  const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len)) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

function assertSeaweedGeometry(geometry, label) {
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
  assert.equal(Math.min(...flex.array), 0, `${label} roots are rigid`);
  assert.equal(Math.max(...flex.array), 1, `${label} tips can flex`);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  assert.ok([...geometry.boundingBox.min.toArray(), ...geometry.boundingBox.max.toArray(), geometry.boundingSphere.radius].every(Number.isFinite));
  assert.ok(geometry.boundingBox.max.y <= 1.1 + EPS, `${label} stays within the height budget`);
  let radialExtent = 0;
  for (let i = 0; i < position.count; i++) radialExtent = Math.max(radialExtent, Math.hypot(position.getX(i), position.getZ(i)));
  assert.ok(radialExtent <= 0.65 + EPS, `${label} stays within the placement radius`);
  assert.ok(geometry.index, `${label} is indexed`);
  assert.ok(geometry.index.count / 3 <= (label.endsWith('low') ? 40 : 100), `${label} stays within its triangle budget`);
  for (let i = 0; i < geometry.index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, geometry.index.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(position, geometry.index.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(position, geometry.index.getX(i + 2));
    assert.ok(new THREE.Triangle(a, b, c).getArea() > EPS, `${label} has no degenerate triangles`);
  }
}

test('seaweed styles have compact indexed full and low geometry with sound attributes', () => {
  assert.deepEqual(SEAWEED_STYLES, ['ribbon', 'fork', 'fan']);
  for (let variant = 0; variant < SEAWEED_STYLES.length; variant++) {
    for (const low of [false, true]) {
      const geometry = seaweedGeometry(variant, { low });
      assertSeaweedGeometry(geometry, `${SEAWEED_STYLES[variant]}${low ? ' low' : ''}`);
      geometry.dispose();
    }
  }
  assert.throws(() => seaweedGeometry(-1), /Unknown seaweed variant/);
  assert.throws(() => seaweedGeometry(3), /Unknown seaweed variant/);
});

test('seeded-world seaweed placement only filters existing props and preserves deterministic inputs', () => {
  const map = generateWorld(99282957), before = structuredClone(map.props);
  const anchors = new Set(map.props.filter((p) => p.kind === 'seaweed').map((p) => `${p.x},${p.z}`));
  assert.ok(anchors.size > 0, 'the seeded world supplies existing seaweed props');
  const first = buildSeaweed(map), again = buildSeaweed(map);
  assert.ok(first.length > 0 && first.length <= Math.min(SEAWEED_LIMIT, anchors.size));
  assert.deepEqual(first, again);
  assert.deepEqual(map.props, before, 'placement does not rewrite world props');
  assert.deepEqual(buildSeaweed({ ...map, props: [...map.props].reverse() }), first,
    'coordinate hash ranking is independent of prop array order');
  assert.deepEqual(buildSeaweed(map, { limit: 12 }), first.slice(0, 12), 'limits retain a stable ranked prefix');
  assert.deepEqual(buildSeaweed(map, { limit: 0 }), []);
  for (const p of first) {
    for (const key of ['x', 'y', 'z', 'nx', 'ny', 'nz', 'rot', 'scale', 'radius']) assert.ok(Number.isFinite(p[key]), `${key} is finite`);
    assert.ok(anchors.has(`${p.x},${p.z}`), 'every rendered instance uses an existing seaweed anchor');
    assert.ok(p.variant >= 0 && p.variant < SEAWEED_STYLES.length);
    const source = map.props.find((prop) => prop.kind === 'seaweed' && prop.x === p.x && prop.z === p.z);
    assert.ok(p.scale <= source.scale + EPS, 'render scale does not enlarge the source prop');
    const floor = map.heightAt(p.x, p.z);
    assert.ok(p.scale <= (-floor - 0.42) / 1.35 + EPS, 'tilt and sway leave a submerged safety margin');
    assert.ok(p.y + p.scale * (1.1 * p.ny + 0.77 * Math.hypot(p.nx, p.nz)) <= -0.4 + EPS,
      'the upper edge remains below the surface under ground tilt and sway');
    assert.ok(Math.abs(p.y - (map.heightAt(p.x, p.z) - 0.035)) < EPS, 'roots sit just above the sampled floor');
    assert.ok(p.radius <= 0.77 * p.scale + EPS, 'the placement footprint includes wind margin');
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, dx = Math.cos(angle) * p.radius, dz = Math.sin(angle) * p.radius;
      const ringFloor = map.heightAt(p.x + dx, p.z + dz);
      const planeFloor = floor - (p.nx / p.ny) * dx - (p.nz / p.ny) * dz;
      assert.ok(Number.isFinite(ringFloor) && Math.abs(ringFloor - planeFloor) <= 0.09 + EPS,
        'the sampled footprint follows a locally safe floor plane');
    }
  }
});

test('seaweed placement rejects invalid, dry, shallow, deep, steep, and dock-access anchors', () => {
  const invalid = [
    seaweedProp(NaN, 0), seaweedProp(0, Infinity), seaweedProp(0, 0, NaN),
  ];
  const cases = [
    ['dry floor', mapFixture({ props: [seaweedProp(0, 0)], heightAt: () => 0.1 })],
    ['too-shallow floor', mapFixture({ props: [seaweedProp(0, 0)], heightAt: () => -0.5 })],
    ['too-deep floor', mapFixture({ props: [seaweedProp(0, 0)], heightAt: () => -3.3 })],
    ['steep floor', mapFixture({ props: [seaweedProp(0, 0)], heightAt: (x) => -1.4 + 2 * x })],
    ['uneven footprint', mapFixture({ props: [seaweedProp(0, 0)],
      heightAt: (x, z) => -1.4 + (Math.hypot(x, z) > 0.2 ? 0.2 : 0) })],
    ['dock surface', mapFixture({ props: [seaweedProp(0, 0)], onDock: () => true })],
    ['non-seaweed prop', mapFixture({ props: [{ kind: 'pebble', x: 0, z: 0, scale: 1 }] })],
    ['invalid anchor fields', mapFixture({ props: invalid })],
  ];
  for (const [label, map] of cases) assert.deepEqual(buildSeaweed(map), [], `${label} is excluded`);

  const access = mapFixture({ props: [seaweedProp(0, 0), seaweedProp(0, 8)],
    landmarks: { dockBase: { x: -10, z: 0 }, dockEnd: { x: 10, z: 0 } } });
  const retained = buildSeaweed(access);
  assert.ok(retained.length > 0, 'a safe anchor away from the dock remains');
  assert.ok(retained.every((p) => segmentDistance(p.x, p.z, access.landmarks.dockBase, access.landmarks.dockEnd) >= 2.5 + p.radius - EPS),
    'each clump clears the dock access segment by the requested margin');
});

test('seaweed quality tiers apply their instance, range, and near detail budgets', () => {
  assert.deepEqual(seaweedBudget('high'), { limit: 256, distance: 65, detailDistance: 22 });
  assert.deepEqual(seaweedBudget('medium'), { limit: 160, distance: 45, detailDistance: 14 });
  assert.deepEqual(seaweedBudget('high', true), { limit: 160, distance: 45, detailDistance: 14 });
  assert.deepEqual(seaweedBudget('low'), { limit: 96, distance: 32, detailDistance: 0 });
});

test('dense seaweed input is capped without duplicate clumps or dependence on input order', () => {
  const props = [];
  for (let x = -40; x <= 40; x += 4) for (let z = -40; z <= 40; z += 4) props.push(seaweedProp(x, z));
  props.push(...props.slice(0, 8).map((p) => ({ ...p, scale: 0.7 })));
  const map = mapFixture({ props }), selected = buildSeaweed(map);
  assert.equal(selected.length, SEAWEED_LIMIT);
  assert.equal(new Set(selected.map((p) => `${p.x},${p.z}`)).size, selected.length);
  assert.deepEqual(buildSeaweed({ ...map, props: [...props].reverse() }), selected);
  assert.deepEqual(buildSeaweed(map, { limit: 500 }), selected);
  assert.deepEqual(buildSeaweed(map, { limit: 96 }), selected.slice(0, 96));
});

test('seaweed renderer shares resources, applies culling and LOD, and reuses batches across quality changes', () => {
  const props = [];
  for (let x = -44; x <= 44; x += 8) for (let z = -44; z <= 44; z += 8) props.push(seaweedProp(x, z, 1.1));
  const seaweed = createSeaweed(mapFixture({ half: 60, props }));
  try {
    const points = seaweed.points;
    assert.ok(points.length > 0 && points.length <= SEAWEED_LIMIT);
    const meshes = seaweed.group.children, material = meshes[0]?.material;
    assert.ok(meshes.length > 0 && material, 'seaweed creates render batches and a shared material');
    assert.equal(material.map, null); assert.equal(material.normalMap, null);
    assert.equal(material.alphaTest, 0); assert.equal(material.transparent, false); assert.equal(material.depthWrite, true);
    assert.ok(meshes.every((mesh) => mesh.material === material), 'batches share the opaque material');
    assert.ok(meshes.every((mesh) => mesh.castShadow === false), 'seaweed avoids shadow-map draw cost');
    assert.ok(meshes.every((mesh) => mesh.layers.mask === 1 << 2), 'seaweed skips the outline pass');
    assert.ok(meshes.every((mesh) => mesh.isInstancedMesh), 'instances are batched');
    const children = [...meshes], geometries = new Set(meshes.map((mesh) => mesh.geometry));
    const nearest = points.reduce((best, p) => !best || Math.hypot(p.x, p.z) < Math.hypot(best.x, best.z) ? p : best, null);
    seaweed.update({ x: nearest.x, z: nearest.z });
    const stats = seaweed.group.userData.seaweed;
    assert.ok(stats.active > 0 && stats.near > 0 && stats.far > 0);
    assert.ok(stats.batches > 0 && stats.variants, 'stats report batches and variant counts');
    assert.deepEqual(stats.textures, [], 'the procedural seaweed has no texture dependencies');
    assert.equal(meshes.reduce((sum, mesh) => sum + mesh.count, 0), stats.active);
    for (const [name, mobile, distance, detailDistance, limit] of [
      ['medium', false, 45, 14, 160], ['high', true, 45, 14, 160], ['low', false, 32, 0, 96], ['high', false, 65, 22, 256],
    ]) {
      seaweed.setQuality(name, mobile);
      const eligible = points.slice(0, limit).filter((p) => Math.hypot(p.x - nearest.x, p.z - nearest.z) <= distance);
      const near = eligible.filter((p) => detailDistance > 0 && Math.hypot(p.x - nearest.x, p.z - nearest.z) <= detailDistance).length;
      assert.equal(stats.active, eligible.length, `${name}${mobile ? ' mobile' : ''} culling and cap are applied`);
      assert.equal(stats.near, near); assert.equal(stats.far, eligible.length - near);
      assert.deepEqual(seaweed.group.children, children, 'quality changes reuse the batches');
      assert.ok(seaweed.group.children.every((mesh) => geometries.has(mesh.geometry)), 'quality changes reuse geometry resources');
    }
    seaweed.setQuality('low'); seaweed.update(nearest);
    assert.equal(stats.near, 0, 'low uses only reduced geometry');
  } finally {
    seaweed.group.traverse((object) => { if (object.isInstancedMesh) object.geometry.dispose(); });
    new Set(seaweed.group.children.map((mesh) => mesh.material)).forEach((material) => material.dispose());
  }
});
