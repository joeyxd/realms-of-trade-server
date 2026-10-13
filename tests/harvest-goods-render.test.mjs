import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HarvestGoods } from '../src/render/harvestGoods.js';
import { assets } from '../src/render/assets/registry.js';

test('awarded goods have bounded cosmetic lifetime, replay suppression and shared resources', () => {
  const prior = assets.model;
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  material.addEventListener('dispose', () => disposed++);
  assets.model = () => new THREE.Group().add(new THREE.Mesh(geometry, material));
  try {
    const scene = new THREE.Scene(), view = new HarvestGoods(scene);
    const node = { id: 'palm-1', x: 2, y: 1, z: 3 };
    const ack = { ok: true, felled: true, rev: 4, opId: 'first', loot: { coco: 1, resina: 1 } };
    assert.equal(view.award({ ...ack, ok: false }, node), false);
    assert.equal(view.award({ ...ack, historical: true }, node), false);
    assert.equal(view.award(ack, node), true);
    assert.equal(view.award(ack, node), false);
    assert.equal(scene.children.length, 2);
    for (let i = 0; i < 10; i++) view.award({ ...ack, opId: `next${i}` }, node);
    assert.equal(scene.children.length, 8);
    for (let i = 0; i < 30; i++) view.update(.1);
    assert.equal(scene.children.length, 0);
    view.award({ ...ack, opId: 'last' }, node); view.reset();
    assert.equal(scene.children.length, 0);
    assert.equal(view.receipts.size, 0);
    assert.equal(disposed, 0, 'removal must preserve registry-owned GPU resources');
  } finally { assets.model = prior; geometry.dispose(); material.dispose(); }
});
