import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Assets } from '../src/render/assets/registry.js';

const entry = { id: 'model:gm-test', kind: 'model', src: 'editor/test.glb', fit: 'size', size: 4 };
function fixture() {
  const assets = new Assets();
  let downloads = 0;
  assets.gltfLoader = async () => ({ loadAsync: async (url) => {
    downloads++;
    assert.equal(url, 'http://localhost/assets/editor/test.glb');
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 3, 1), new THREE.MeshStandardMaterial()));
    return { scene };
  } });
  return { assets, count: () => downloads };
}

test('editor assets load once on demand and clones share immutable prepared geometry', async () => {
  const { assets, count } = fixture();
  assert.equal(assets.list().length, 0);
  assert.equal(count(), 0);
  assert.deepEqual(await Promise.all([assets.ensureModel(entry), assets.ensureModel(entry)]), [true, true]);
  assert.equal(count(), 1);
  const first = assets.model(entry.id), second = assets.model(entry.id);
  first.position.x = 10;
  assert.equal(second.position.x, 0);
  assert.equal(first.children[0].children[0].geometry, second.children[0].children[0].geometry);
  assert.equal(new THREE.Box3().setFromObject(second).getSize(new THREE.Vector3()).x, 4);
  assert.equal(await assets.ensureModel(entry), true);
  assert.equal(count(), 1);
});

test('catalog entry cannot escape assets, replace loaded IDs, or install prop replacement bindings', async () => {
  const { assets, count } = fixture();
  assert.equal(await assets.ensureModel({ ...entry, src: '../private.glb' }), false);
  assert.equal(await assets.ensureModel({ ...entry, src: 'https://other.test/file.glb' }), false);
  assert.equal(count(), 0);
  assert.equal(await assets.ensureModel(entry), true);
  assert.equal(await assets.ensureModel({ ...entry, src: 'editor/different.glb' }), false);
  assert.equal(assets.entry(entry.id).src, entry.src);
  assert.equal(assets.man.byProp.size, 0);
});

test('failed lazy load can retry without poisoning normal runtime assets', async () => {
  const { assets } = fixture();
  const success = assets.gltfLoader;
  assets.gltfLoader = async () => ({ loadAsync: async () => { throw new Error('404'); } });
  assert.equal(await assets.ensureModel(entry), false);
  assert.equal(assets.model(entry.id), null);
  assets.gltfLoader = success;
  assert.equal(await assets.ensureModel(entry), true);
  assert.ok(assets.model(entry.id));
});
