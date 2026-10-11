import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NavalLabScenery } from '../tools/naval-lab/scenery.js';
import { LAYER } from '../src/render/pipeline.js';

test('naval lab scenery is a deterministic, bounded, static world silhouette field', () => {
  for (const mobile of [true, false]) {
    const sceneA = new THREE.Scene(), sceneB = new THREE.Scene();
    const a = new NavalLabScenery(sceneA, { mobile }), b = new NavalLabScenery(sceneB, { mobile });
    const stats = a.diagnostics();
    const vertices = a.geometry.attributes.position.array.slice();
    assert.equal(sceneA.children.length, 1);
    assert.equal(stats.formations, 9);
    assert.equal(stats.meshes, 1, 'the island field draws as one merged mesh');
    assert.ok(stats.vertices < 3000 && stats.triangles < 1000, 'merged rock geometry stays compact');
    assert.equal(a.mesh.layers.isEnabled(LAYER.WORLD), true);
    assert.equal(a.mesh.castShadow, false);
    assert.equal(a.mesh.receiveShadow, false);
    assert.equal(a.material.fog, true);
    assert.deepEqual(a.geometry.attributes.position.array, b.geometry.attributes.position.array,
      'the same world seed produces the same silhouette field');
    assert.ok(Math.max(...vertices.filter((_value, i) => i % 3 === 1)) >= 60, 'distant peaks rise above the sea');

    a.update({ x: 22, z: 180 });
    const moved = a.diagnostics();
    assert.equal(moved.updateCount, 1);
    assert.deepEqual(a.geometry.attributes.position.array, vertices, 'boat travel never drags the islands');
    a.update({ x: 90, z: 310, paused: true });
    assert.equal(a.diagnostics().updateCount, 1, 'pause freezes scenery bookkeeping');
    assert.deepEqual(a.diagnostics().lastCenter, { x: 22, z: 180 });
    a.reset();
    assert.equal(a.diagnostics().updateCount, 0);
    assert.deepEqual(a.diagnostics().lastCenter, { x: 0, z: 0 });
    assert.deepEqual(a.geometry.attributes.position.array, vertices, 'reset leaves world anchored rocks in place');
    a.dispose(); b.dispose();
    assert.equal(sceneA.children.length, 0);
    assert.equal(a.diagnostics().disposed, true);
    assert.equal(a.mesh, null);
  }
});

test('naval lab scenery keeps a clear near-water passage through z=120', () => {
  const scenery = new NavalLabScenery(new THREE.Scene(), { mobile: true });
  const positions = scenery.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    if (z <= 120) assert.ok(Math.abs(x) >= scenery.diagnostics().clearCorridorHalfWidth,
      `rock vertex at x=${x.toFixed(1)} blocks the near-water corridor`);
  }
  scenery.dispose();
});
