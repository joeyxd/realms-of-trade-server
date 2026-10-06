import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RAFT_ATLAS_ID, RAFT_ATLAS_RECTS } from '../src/render/raftMaterials.js';
import { STARTER_RAFT } from '../src/data/raftparts.js';
import { assets } from '../src/render/assets/registry.js';
import { RaftLayer } from '../src/render/rafts.js';

const record = () => ({
  id: 'renderer-test-raft', entity: 6, owner: 2, rev: 1, name: 'La Balsa', berth: 0,
  x: 10, y: 0.72, z: -4, yaw: 0.3,
  parts: STARTER_RAFT.map(([id, x, z, level, dir]) => [id, x, z, level, dir ?? 0]),
  look: { banner: 'franjas', paint: 0 },
});

function disposalCount(object) {
  let count = 0;
  object.addEventListener('dispose', () => { count++; });
  return () => count;
}

function patchAssets({ atlas, sourceCrate, crateId = 'prop:test-crate' }) {
  const keys = ['texture', 'propId', 'model'];
  const old = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(assets, key)]));
  let modelCalls = 0;
  assets.texture = (id) => { assert.equal(id, RAFT_ATLAS_ID); return atlas; };
  assets.propId = (kind) => kind === 'crate' ? crateId : null;
  assets.model = (id, target) => {
    assert.equal(id, crateId);
    assert.deepEqual(target, { w: 1.25, h: 1.15 });
    modelCalls++;
    return sourceCrate.clone(true); // Object clones share the registered geometry/material.
  };
  return {
    modelCalls: () => modelCalls,
    restore() {
      for (const [key, descriptor] of old) {
        if (descriptor) Object.defineProperty(assets, key, descriptor);
        else delete assets[key];
      }
    },
  };
}

function makeSourceCrate() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x995522 });
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'registry-fab-crate';
  group.add(mesh);
  return { group, geometry, material, mesh };
}

function atlasTexture() {
  const texture = new THREE.DataTexture(new Uint8Array(2 * 2 * 4).fill(255), 2, 2, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function mappedMeshes(root, atlas) {
  if (!atlas) return [];
  const out = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => material?.map === atlas)) out.push(object);
  });
  return out;
}

function assertMeshUvsConfined(mesh, atlas) {
  const kind = mesh.userData.raftSurface;
  const rect = RAFT_ATLAS_RECTS[kind];
  assert.ok(rect, `mapped mesh has a semantic raft surface: ${kind}`);
  const uv = mesh.geometry.getAttribute('uv');
  assert.ok(uv?.count > 0, `mapped ${kind} mesh has UVs`);
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    assert.ok(Number.isFinite(u) && Number.isFinite(v), `${kind} UV ${i} is finite`);
    assert.ok(u >= rect.u0 - 1e-6 && u <= rect.u1 + 1e-6, `${kind} U ${u} stays in atlas region`);
    assert.ok(v >= rect.v0 - 1e-6 && v <= rect.v1 + 1e-6, `${kind} V ${v} stays in atlas region`);
  }
}

test('RaftLayer skins and owns atlas geometry while preserving shared registry and texture resources', () => {
  const atlas = atlasTexture(), atlasDisposed = disposalCount(atlas);
  const source = makeSourceCrate();
  const sourceGeoDisposed = disposalCount(source.geometry), sourceMatDisposed = disposalCount(source.material);
  const sourceUvs = Array.from(source.geometry.getAttribute('uv').array);
  const sourceColor = source.material.color.getHex();
  const patched = patchAssets({ atlas, sourceCrate: source.group });
  const scene = new THREE.Scene();
  const layer = new RaftLayer(scene);
  try {
    const raft = record();
    assert.equal(layer.update([raft], 0, 6), true);
    assert.equal(patched.modelCalls(), 1);
    assert.equal(layer.views.size, 1);
    const view = layer.views.get(raft.id);
    assert.ok(scene.children.includes(view.root));

    const meshes = mappedMeshes(view.root, atlas);
    const surfaces = new Set(meshes.map((mesh) => mesh.userData.raftSurface));
    for (const kind of ['wood', 'iron', 'rope', 'cloth']) assert.ok(surfaces.has(kind), `starter skin contains ${kind}`);
    assert.ok(meshes.length >= 4);
    for (const mesh of meshes) assertMeshUvsConfined(mesh, atlas);
    const mappedMaterials = [...layer.materials.values()].filter((material) => material.map);
    assert.ok(mappedMaterials.length >= 4);
    assert.equal(layer.atlas, atlas);
    for (const material of mappedMaterials) assert.equal(material.map, atlas, 'all atlas materials share one loaded texture');
    for (const mesh of meshes) {
      assert.ok(mesh.material.isMeshToonMaterial);
      assert.ok(mesh.userData.nm?.isMeshNormalMaterial, 'mapped geometry keeps its normal-pass material');
      assert.ok(!mesh.userData.nm.map, 'the atlas is only sampled in the color pass');
    }

    const imported = view.root.getObjectByName('raft:crate:1:1:0');
    const importedMesh = imported?.getObjectByName('registry-fab-crate');
    assert.ok(importedMesh, 'the registered crate model remains part of the raft view');
    assert.notEqual(importedMesh.geometry, source.geometry, 'the FAB mesh receives a private geometry clone before UV mapping');
    assert.notEqual(importedMesh.material, source.material, 'the clone receives the raft atlas material');
    assert.equal(source.mesh.geometry, source.geometry);
    assert.equal(source.mesh.material, source.material);
    assert.deepEqual(Array.from(source.geometry.getAttribute('uv').array), sourceUvs);
    assert.equal(source.material.color.getHex(), sourceColor);
    assert.equal(source.material.map, null);
    assert.equal(source.mesh.userData.raftSurface, undefined);
    assert.equal(source.mesh.userData.nm, undefined);

    const rootBefore = view.root;
    assert.equal(layer.update([raft], 0, 6), false, 'an identical public record does not rebuild geometry');
    assert.equal(layer.views.get(raft.id).root, rootBefore);
    assert.equal(patched.modelCalls(), 1);

    const previousGeometries = [...view.ownedGeometries];
    const previousGeometryDisposals = previousGeometries.map(disposalCount);
    const cargoRevision = { ...raft, rev: raft.rev + 1 };
    assert.equal(layer.update([cargoRevision], 0, 6), false, 'private cargo/work revisions reuse GPU geometry');
    assert.equal(layer.views.get(raft.id).root, rootBefore);
    assert.ok(previousGeometryDisposals.every((getCount) => getCount() === 0));
    const changed = { ...cargoRevision, parts: [...raft.parts, ['grill', 1, 0, 0, 0]] };
    assert.equal(layer.update([changed], 0, 6), true, 'blueprint change rebuilds the view');
    assert.notEqual(layer.views.get(raft.id).root, rootBefore);
    assert.ok(previousGeometryDisposals.every((getCount) => getCount() === 1), 'replaced view geometries are disposed');

    const revisedView = layer.views.get(raft.id);
    const removedGeometryDisposals = revisedView.ownedGeometries.map(disposalCount);
    assert.equal(layer.update([], 0, 6), true, 'an empty full-list snapshot removes the raft');
    assert.equal(layer.views.size, 0);
    assert.ok(removedGeometryDisposals.every((getCount) => getCount() === 1), 'removed view geometries are disposed');
    assert.equal(scene.children.includes(revisedView.root), false);
    assert.equal(layer.update([raft], 0, 6), true, 'the same public raft can be rebuilt after removal');

    const liveView = layer.views.get(raft.id);
    const finalGeometryDisposals = liveView.ownedGeometries.map(disposalCount);
    const liveMaterials = [...layer.materials.values()];
    const materialDisposals = liveMaterials.map(disposalCount);
    layer.dispose();
    assert.equal(layer.views.size, 0);
    assert.ok(finalGeometryDisposals.every((getCount) => getCount() === 1), 'dispose releases view-owned geometry');
    assert.ok(materialDisposals.every((getCount) => getCount() === 1), 'dispose releases layer-owned materials');
    assert.equal(sourceGeoDisposed(), 0, 'shared asset geometry stays alive');
    assert.equal(sourceMatDisposed(), 0, 'shared asset material stays alive');
    assert.equal(atlasDisposed(), 0, 'registry-owned atlas texture stays alive');
    assert.ok(atlas.image.data.every((value) => value === 255));
  } finally {
    layer.dispose();
    patched.restore();
    source.geometry.dispose();
    source.material.dispose();
    atlas.dispose();
  }
});

test('RaftLayer without a loaded atlas keeps procedural fallback and shared imported model resources', () => {
  const source = makeSourceCrate();
  const sourceGeoDisposed = disposalCount(source.geometry), sourceMatDisposed = disposalCount(source.material);
  const patched = patchAssets({ atlas: null, sourceCrate: source.group });
  const scene = new THREE.Scene();
  const layer = new RaftLayer(scene);
  try {
    assert.equal(layer.atlas, null);
    assert.equal(layer.update([record()], 0), true);
    const view = layer.views.get('renderer-test-raft');
    assert.ok(view);
    assert.equal(patched.modelCalls(), 1, 'missing atlas does not disable the registered crate model');
    assert.equal(mappedMeshes(view.root, null).length, 0);
    assert.ok([...layer.materials.values()].every((material) => material.map === null), 'fallback surfaces do not retain a missing atlas map');
    const raftMeshes = [];
    view.root.traverse((o) => { if (o.isMesh) raftMeshes.push(o); });
    assert.ok(raftMeshes.length > 0, 'procedural starter surfaces still render');
    const crate = view.root.getObjectByName('raft:crate:1:1:0');
    const crateMesh = crate?.getObjectByName('registry-fab-crate');
    assert.ok(crateMesh);
    assert.equal(crateMesh.geometry, source.geometry);
    assert.equal(crateMesh.material, source.material);
    assert.equal(crateMesh.userData.raftSurface, undefined, 'no skin work mutates the unskinned imported instance');

    layer.dispose();
    assert.equal(sourceGeoDisposed(), 0);
    assert.equal(sourceMatDisposed(), 0);
  } finally {
    layer.dispose();
    patched.restore();
    source.geometry.dispose();
    source.material.dispose();
  }
});
