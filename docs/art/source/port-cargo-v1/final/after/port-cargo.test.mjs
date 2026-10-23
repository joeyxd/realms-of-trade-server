import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { portCargoGeometry, paintPortCargoInstances } from '../src/render/portCargo.js';
import { assets } from '../src/render/assets/registry.js';
import { createProps } from '../src/render/props.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID, TOWN_TILES, townRect } from '../src/render/townMaterials.js';
import { RAFT_ATLAS_ID } from '../src/render/raftMaterials.js';

function sameAttribute(a, b, name) {
  const left = a.getAttribute(name), right = b.getAttribute(name);
  assert.equal(!!left, !!right, `${name} presence is preserved`);
  if (left) {
    assert.equal(left.itemSize, right.itemSize);
    assert.deepEqual(Array.from(left.array), Array.from(right.array), `${name} values are preserved`);
  }
}

function barrelSource() {
  const points = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    points.push(new THREE.Vector2(0.38 + Math.sin(t * Math.PI) * 0.08, t));
  }
  const body = new THREE.LatheGeometry(points, 14);
  const cap = new THREE.CylinderGeometry(0.38, 0.38, 0.04, 14);
  cap.translate(0, 0.99, 0);
  // The runtime merge produces a non-indexed barrel, so model that resource boundary here.
  const merged = new THREE.BufferGeometry();
  const positions = [], normals = [];
  for (const g of [body, cap]) {
    const flat = g.index ? g.toNonIndexed() : g;
    positions.push(...flat.attributes.position.array);
    normals.push(...flat.attributes.normal.array);
    if (flat !== g) flat.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 3).fill(0.5), 3));
  body.dispose(); cap.dispose();
  return merged;
}

function atlasTile(uv, i) {
  const x = Math.min(3, Math.floor(uv.getX(i) * 4));
  const y = Math.min(2, Math.floor((1 - uv.getY(i)) * 4));
  return TOWN_TILES[y * 4 + x];
}

function disposeGroup(group, registryResources = new Set()) {
  const geometries = new Set(), materials = new Set();
  group.traverse((o) => {
    if (o.geometry && !registryResources.has(o.geometry)) geometries.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && !registryResources.has(m)) materials.add(m);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

test('barrel triangles stay within one painted role, including iron strap crops and the lathe seam', () => {
  const source = barrelSource();
  const original = source.clone();
  const mapped = portCargoGeometry(source, 'barrel');
  assert.equal(source.index, null, 'the native barrel fixture is non-indexed');
  for (const name of ['position', 'normal', 'color']) {
    sameAttribute(original, source, name);
    sameAttribute(original, mapped, name);
  }
  for (let i = 0; i < source.attributes.position.count; i += 3) {
    const roles = [0, 1, 2].map((j) => atlasTile(mapped.attributes.uv, i + j));
    assert.equal(new Set(roles).size, 1, `triangle ${i / 3} does not interpolate across atlas roles`);
    const u = [0, 1, 2].map((j) => mapped.attributes.uv.getX(i + j));
    if ([0, 1, 2].every(j => Math.abs(mapped.attributes.normal.getY(i + j)) < .8)) {
      const rect = townRect(roles[0]);
      assert.ok((Math.max(...u) - Math.min(...u)) / (rect.u1 - rect.u0) < .072,
        `triangle ${i / 3} spans at most one of fourteen barrel facets at the angular seam`);
    }
    for (let j = 0; j < 3; j++) {
      const uv = mapped.attributes.uv, rect = townRect(roles[j]);
      assert.ok(Number.isFinite(uv.getX(i + j)) && Number.isFinite(uv.getY(i + j)));
      assert.ok(uv.getX(i + j) >= rect.u0 - 1e-6 && uv.getX(i + j) <= rect.u1 + 1e-6);
      assert.ok(uv.getY(i + j) >= rect.v0 - 1e-6 && uv.getY(i + j) <= rect.v1 + 1e-6);
      if (roles[j] === 'iron') {
        const localV = (uv.getY(i + j) - rect.v0) / (rect.v1 - rect.v0);
        assert.ok(localV >= 0.835 - 1e-5 && localV <= 0.895 + 1e-5,
          'barrel hoops sample only the painted strap band');
      }
    }
  }
  assert.ok(mapped.userData.portCargo.roles.iron > 0);
  assert.ok(mapped.userData.portCargo.roles.planks > 0);
  assert.ok(mapped.userData.portCargo.roles.floor > 0);
  assert.equal(mapped.userData.portCargo.texturesAdded, 0);
  mapped.dispose(); original.dispose(); source.dispose();
});

test('indexed imported crate geometry is cloned with its attributes and index intact', () => {
  const source = new THREE.BoxGeometry(1.2, 1, 0.8);
  source.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.count * 3).fill(0.4), 3));
  const snapshot = source.clone();
  const mapped = portCargoGeometry(source, 'crate');
  assert.ok(source.index, 'the imported geometry fixture is indexed');
  for (const name of ['position', 'normal', 'color']) {
    sameAttribute(snapshot, source, name);
    sameAttribute(snapshot, mapped, name);
  }
  assert.deepEqual(Array.from(mapped.index.array), Array.from(source.index.array));
  assert.notEqual(mapped, source);
  assert.equal(mapped.userData.portCargo.kind, 'crate');
  const uv = mapped.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)));
    assert.ok(['planks', 'floor'].includes(atlasTile(uv, i)));
    if (Math.abs(mapped.attributes.normal.getY(i)) < .8) {
      const rect = townRect('planks');
      assert.ok(Math.abs(uv.getX(i) - (rect.u0 + (mapped.attributes.position.getY(i) + .5) * (rect.u1 - rect.u0))) < 1e-6,
        'crate wall grain runs horizontally along the accepted model boards');
    }
  }
  mapped.dispose(); snapshot.dispose(); source.dispose();
});

test('only cloned static storage-crate instances take the town material and preserve fitted instance data', () => {
  const sourceGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sourceMaterial = new THREE.MeshStandardMaterial({ color: 0x987654 });
  const registryOwnedGeometry = sourceGeometry.clone(), registryOwnedMaterial = sourceMaterial.clone();
  const mesh = new THREE.InstancedMesh(registryOwnedGeometry, registryOwnedMaterial, 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 3, 4));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeScale(2, 1, 0.5));
  mesh.instanceMatrix.needsUpdate = true;
  const matrices = Array.from(mesh.instanceMatrix.array);
  const group = new THREE.Group(); group.add(mesh);
  const painted = new THREE.MeshStandardMaterial();
  paintPortCargoInstances(group, painted);
  assert.equal(mesh.geometry === registryOwnedGeometry, false, 'rendered instance owns a geometry clone');
  assert.equal(mesh.material, painted);
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), matrices, 'fitting and per-instance transforms stay intact');
  assert.deepEqual(Array.from(registryOwnedGeometry.attributes.position.array), Array.from(sourceGeometry.attributes.position.array));
  assert.deepEqual(Array.from(registryOwnedGeometry.index.array), Array.from(sourceGeometry.index.array));
  assert.equal(mesh.userData.portCargo.instances, 2);
  assert.equal(registryOwnedMaterial.color.getHex(), sourceMaterial.color.getHex(), 'registry material is untouched');
  mesh.geometry.dispose(); painted.dispose(); registryOwnedGeometry.dispose(); registryOwnedMaterial.dispose();
  sourceGeometry.dispose(); sourceMaterial.dispose();
});

test('createProps maps static cargo only with the shared town atlas and leaves floaters and fallback geometry alone', () => {
  const prior = Object.fromEntries(['texture', 'propId', 'instanced'].map((key) => [key, Object.getOwnPropertyDescriptor(assets, key)]));
  const albedo = new THREE.Texture(), normal = new THREE.Texture(), raft = new THREE.Texture();
  const extSources = new Map();
  const storage = new THREE.Group(); storage.name = 'prop:storage-crate';
  const storageGeometry = new THREE.BoxGeometry(1, 1, 1), storageMaterial = new THREE.MeshStandardMaterial();
  const storageMesh = new THREE.InstancedMesh(storageGeometry, storageMaterial, 1); storage.add(storageMesh);
  const barrel = new THREE.Group(); barrel.name = 'prop:custom-barrel';
  const barrelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 1); barrel.add(barrelMesh);
  extSources.set('prop:storage-crate', storage); extSources.set('prop:custom-barrel', barrel);
  const lookups = [];
  const map = {
    props: [
      { kind: 'crate', x: 1, y: 0, z: 2, rot: 0.2, scale: 1 },
      { kind: 'barrel', x: 4, y: 0, z: 5, rot: 0.3, scale: 1 },
      { kind: 'float', h: 2, x: 7, y: 0, z: 8, rot: 0.4, scale: 1, v: 0.2 },
    ], npcs: [], dock: { len: 4, halfWidth: 1, deckY: 0.8, base: { x: 0, z: 0 }, dir: { x: 0, z: 1 } },
    groundAt: () => 0,
    get rng() { throw new Error('cargo rendering must not read simulation RNG'); },
  };
  const before = structuredClone(map.props);
  assets.texture = (id) => { lookups.push(id); return id === TOWN_ALBEDO_ID ? albedo : id === TOWN_NORMAL_ID ? normal : id === RAFT_ATLAS_ID ? raft : null; };
  assets.propId = (kind) => kind === 'crate' ? 'prop:storage-crate' : kind === 'barrel' ? 'prop:custom-barrel' : null;
  assets.instanced = (id) => {
    const source = extSources.get(id);
    if (!source) return null;
    const group = new THREE.Group(); group.name = source.name;
    for (const child of source.children) group.add(new THREE.InstancedMesh(child.geometry, child.material, child.count));
    return group;
  };
  try {
    const out = createProps(map);
    assert.deepEqual(lookups, [TOWN_ALBEDO_ID, TOWN_NORMAL_ID, RAFT_ATLAS_ID], 'cargo adds no texture lookups');
    assert.deepEqual(map.props, before, 'rendering leaves map placements unchanged');
    const paintedCrate = out.group.getObjectByName('prop:storage-crate');
    assert.ok(paintedCrate);
    assert.equal(paintedCrate.children[0].material.map, albedo);
    assert.equal(paintedCrate.children[0].material.normalMap, normal);
    assert.equal(paintedCrate.children[0].userData.portCargo.kind, 'crate');
    const untouchedBarrel = out.group.getObjectByName('prop:custom-barrel');
    assert.ok(untouchedBarrel);
    assert.equal(untouchedBarrel.children[0].geometry, barrelMesh.geometry, 'non-storage imported prop keeps registry geometry');
    assert.equal(untouchedBarrel.children[0].material, barrelMesh.material, 'non-storage imported prop keeps registry material');
    const floater = out.floaters[0].children[0];
    assert.ok(floater);
    assert.equal(floater.material.map, null, 'floating cargo stays on the legacy material');
    assert.equal(floater.geometry.userData.portCargo, undefined, 'floating cargo is not remapped');
    disposeGroup(out.group, new Set([barrelMesh.geometry, barrelMesh.material]));

    lookups.length = 0;
    assets.texture = (id) => { lookups.push(id); return id === TOWN_NORMAL_ID ? normal : null; };
    const fallback = createProps(map);
    assert.deepEqual(lookups, [TOWN_ALBEDO_ID, RAFT_ATLAS_ID], 'missing albedo skips the normal lookup');
    assert.equal(fallback.group.getObjectByName('prop:storage-crate').children[0].geometry, storageMesh.geometry,
      'without town albedo the imported storage model remains untouched');
    assert.equal(fallback.group.getObjectByName('prop:storage-crate').children[0].material, storageMaterial,
      'without town albedo the original registry palette material remains active');
    assert.equal(fallback.floaters[0].children[0].geometry.userData.portCargo, undefined);
    disposeGroup(fallback.group, new Set([barrelMesh.geometry, barrelMesh.material, storageMesh.geometry, storageMesh.material]));
  } finally {
    for (const [key, descriptor] of Object.entries(prior)) {
      if (descriptor) Object.defineProperty(assets, key, descriptor); else delete assets[key];
    }
    // The registry owns source model resources; test fixtures retain and release them here.
    for (const root of [storage, barrel]) root.traverse((o) => { if (o.isInstancedMesh) { o.geometry.dispose(); o.material.dispose(); } });
    albedo.dispose(); normal.dispose(); raft.dispose();
  }
});
