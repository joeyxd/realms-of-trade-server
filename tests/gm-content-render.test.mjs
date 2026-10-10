import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { createGmContentLayer } from '../src/render/gmContent.js';

const BASE = 'terrain-s21-v1';

function makeScene(map, entry) {
  const scene = new THREE.Scene();
  const name = entry.kind === 'rock' ? 'rocks0' : entry.kind === 'flower' ? `flowers${Math.floor(entry.prop.v * 4)}` : 'pebbles';
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0xffffff }), 1);
  mesh.name = name;
  mesh.userData.gmBaseProps = [entry.prop];
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(entry.prop.x, entry.prop.y, entry.prop.z),
    new THREE.Quaternion(), new THREE.Vector3(entry.prop.scale, entry.prop.scale, entry.prop.scale)));
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return { scene, mesh };
}

function fakeAssets() {
  const geom = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshBasicMaterial({ color: 0x55aa33 });
  return {
    data: () => null,
    entry: () => null,
    has: (id) => id === 'prop:crate',
    model: (id) => {
      if (id !== 'prop:crate') return null;
      const group = new THREE.Group(); group.add(new THREE.Mesh(geom, mat)); return group;
    },
  };
}

test('two scenes install identical base override matrices; restore returns both to base', async () => {
  const map = generateWorld(20261020), entry = gmEditableBaseProps(map, BASE)[0];
  assert.ok(entry);
  const a = makeScene(map, entry), b = makeScene(map, entry);
  const target = { position: { x: entry.prop.x + 7, y: entry.prop.y + 1, z: entry.prop.z - 3 },
    rotation: { x: 0.2, y: 0.7, z: -0.1 }, scale: entry.prop.scale * 1.25 };
  const doc = createDocument({ seed: map.seed, baseRevision: BASE, objects: [], baseOverrides: [{ id: entry.id, transform: target, hidden: false }] });
  const first = createGmContentLayer({ scene: a.scene, map, assets: fakeAssets(), baseRevision: BASE });
  const second = createGmContentLayer({ scene: b.scene, map, assets: fakeAssets(), baseRevision: BASE });
  await Promise.all([first.load(doc), second.load(doc)]);
  const ma = new THREE.Matrix4(), mb = new THREE.Matrix4();
  a.mesh.getMatrixAt(0, ma); b.mesh.getMatrixAt(0, mb);
  assert.ok(ma.elements.every((n, i) => Math.abs(n - mb.elements[i]) < 1e-9));
  const pos = new THREE.Vector3().setFromMatrixPosition(ma);
  assert.ok(Math.abs(pos.x - target.position.x) < 1e-6);
  assert.ok(Math.abs(pos.z - target.position.z) < 1e-6);
  first.restore(); second.dispose();
  const restored = new THREE.Matrix4(); a.mesh.getMatrixAt(0, restored);
  const restoredPos = new THREE.Vector3().setFromMatrixPosition(restored);
  assert.ok(Math.abs(restoredPos.x - entry.prop.x) < 1e-6);
  assert.ok(Math.abs(restoredPos.z - entry.prop.z) < 1e-6);
});

test('authored models load from prepared entries, preserve YXZ transform, and are removed on restore', async () => {
  const map = generateWorld(20261021), entry = gmEditableBaseProps(map, BASE)[0], { scene } = makeScene(map, entry);
  const assets = fakeAssets();
  let ensured = 0;
  assets.has = () => false;
  assets.ensureModel = async (raw, options) => { ensured++; assert.equal(raw.src, 'gm/crate.glb'); assert.equal(options.base, 'assets/'); assets.has = (id) => id === 'prop:crate'; return true; };
  const doc = createDocument({ seed: map.seed, baseRevision: BASE, objects: [createDecoration({ id: 'crate-a', assetId: 'prop:crate',
    position: { x: 8, y: 2, z: 9 }, rotation: { x: 0.25, y: 1.1, z: -0.15 }, scale: 2 })] });
  const layer = createGmContentLayer({ scene, map, assets, baseRevision: BASE });
  await layer.load(doc, [{ id: 'prop:crate', src: 'assets/gm/crate.glb', loader: { kind: 'prop', fit: 'size', size: 2 } }]);
  assert.equal(ensured, 1);
  const group = scene.getObjectByName('gm:crate-a');
  assert.ok(group);
  assert.deepEqual(group.rotation.order, 'YXZ');
  assert.ok(Math.abs(group.rotation.y - 1.1) < 1e-9);
  assert.equal(group.scale.x, 2);
  assert.equal(layer.suspend(), true);
  assert.equal(group.visible, false);
  assert.equal(layer.suspended, true);
  scene.remove(group); // Simulate a temporary scene rebuild while the editor owns the base matrices.
  assert.equal(layer.resume(), true);
  assert.equal(group.parent, scene);
  assert.equal(group.visible, true);
  assert.equal(layer.suspended, false);
  layer.restore();
  assert.equal(scene.getObjectByName('gm:crate-a'), undefined);
  assert.equal(layer.active, false);
  layer.dispose();
});

test('cloned base model preserves per-instance tint and disposes its owned proxy materials', async () => {
  const map = generateWorld(20261023), entry = gmEditableBaseProps(map, BASE)[0], { scene, mesh } = makeScene(map, entry);
  mesh.setColorAt(0, new THREE.Color(0x7f5a33));
  mesh.instanceColor.needsUpdate = true;
  const doc = createDocument({ seed: map.seed, baseRevision: BASE, objects: [createDecoration({ id: 'base-copy', assetId: entry.id,
    position: { x: entry.prop.x + 10, y: entry.prop.y, z: entry.prop.z + 10 } })] });
  const layer = createGmContentLayer({ scene, map, assets: fakeAssets(), baseRevision: BASE });
  await layer.load(doc);
  const group = scene.getObjectByName('gm:base-copy');
  assert.ok(group);
  const proxy = group.userData.gmOwnedMaterials?.[0];
  assert.ok(proxy && proxy !== mesh.material);
  let disposed = false;
  proxy.addEventListener('dispose', () => { disposed = true; });
  layer.restore();
  assert.equal(disposed, true);
  layer.dispose();
});

test('missing prepared asset fails closed without leaving any GM scene nodes', async () => {
  const map = generateWorld(20261022), entry = gmEditableBaseProps(map, BASE)[0], { scene } = makeScene(map, entry);
  const doc = createDocument({ seed: map.seed, baseRevision: BASE, objects: [createDecoration({ id: 'missing', assetId: 'prop:missing', position: { x: 1, y: 0, z: 1 } })] });
  const layer = createGmContentLayer({ scene, map, assets: fakeAssets(), baseRevision: BASE });
  await assert.rejects(layer.load(doc), /Missing prepared GM asset/);
  assert.equal(scene.getObjectByName('gm:missing'), undefined);
  assert.equal(layer.active, false);
  layer.dispose();
});
