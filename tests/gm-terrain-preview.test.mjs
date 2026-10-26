import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTerrain, createHeightTexture, updateHeightTexture } from '../src/render/terrain.js';
import { createWater } from '../src/render/water.js';
import { createTerrainPreview } from '../src/editor/terrainPreview.js';

function map({ height = 1, gmTerrain = false, paint = null } = {}) {
  return { size: 12, gmTerrain, heightAt: () => height,
    ...(paint ? { materialWeightsAt: (_x, _z, out = [0, 0, 0, 0]) => { out.splice(0, 4, ...paint); return out; } } : {}),
    masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }),
    landmarks: { arena: { x: 0, z: 0 }, arenaR: 3, spawn: { x: 0, z: 0 }, village: { x: 2, z: 2 } } };
}

test('GM terrain preview reuses the terrain object and material, updates its 561 grid and water, then restores exact originals', () => {
  const base = map(), original = createTerrain(base, { segments: 2, assetRegistry: { texture: () => null } });
  const originalGeometry = original.geometry, originalMaterial = original.material;
  const originalPaintAttribute = originalGeometry.getAttribute('aPaint');
  const originalPaintBytes = originalPaintAttribute.array.slice();
  const simpleHeight = createHeightTexture(base, 8);
  const water = createWater(base, simpleHeight);
  const simpleMaterial = water.userData.materials.simple, ssrMaterial = water.userData.materials.ssr;
  assert.strictEqual(simpleMaterial.uniforms.uHeight.value, simpleHeight);
  assert.strictEqual(ssrMaterial.uniforms.uHeight, simpleMaterial.uniforms.uHeight, 'SSR shares the height binding (swash shore mask)');
  const scene = new THREE.Scene(); scene.add(original, water);
  let invalidations = 0;
  const preview = createTerrainPreview({ scene, map: base, invalidate: () => invalidations++ });
  const first = map({ height: 4, gmTerrain: true, paint: [1, 0, 0, 0] });
  first.terrain = { samples: [[1, 100]], materials: [[0, 255, 0, 0, 0]] };
  preview.apply(first);
  assert.strictEqual(scene.getObjectByName('terrain'), original);
  assert.strictEqual(original.material, originalMaterial);
  assert.notStrictEqual(original.geometry, originalGeometry);
  assert.equal(original.geometry.getAttribute('position').count, 561 * 561);
  assert.ok(Math.abs(original.geometry.getAttribute('position').getY(0) - 4) < 1e-6);
  const previewPaint = original.geometry.getAttribute('aPaint');
  assert.equal(previewPaint.normalized, true);
  assert.equal(previewPaint.array[0], 255);
  assert.equal(previewPaint.getX(0), 1);
  assert.deepEqual([previewPaint.getX(0), previewPaint.getY(0), previewPaint.getZ(0), previewPaint.getW(0)],
    first.materialWeightsAt(-6, -6));
  const activeGeometry = original.geometry, positions = activeGeometry.getAttribute('position');
  const privateSimple = water.userData.materials.simple.uniforms.uHeight.value;
  assert.notStrictEqual(privateSimple, simpleHeight);
  water.userData.setMode(false);
  assert.strictEqual(water.material.uniforms.uHeight.value, privateSimple, 'low quality water reads the preview height');
  water.userData.setMode(true);
  assert.strictEqual(water.material, ssrMaterial, 'SSR water remains on its own mode');
  assert.strictEqual(water.material.uniforms.uHeight.value, privateSimple, 'SSR water reads the preview height too');
  const second = map({ height: 6, gmTerrain: true });
  second.terrain = { samples: [[2, 100]], materials: [] };
  preview.apply(second);
  assert.strictEqual(original.geometry, activeGeometry, 'a new stroke sample set keeps the same GPU geometry');
  assert.strictEqual(original.geometry.getAttribute('position'), positions);
  assert.ok(Math.abs(positions.getY(0) - 6) < 1e-6);
  assert.strictEqual(preview.map, second);
  const paintOnly = map({ height: 6, gmTerrain: true, paint: [0, 1, 0, 0] });
  paintOnly.terrain = { samples: [[2, 100]], materials: [[1, 0, 255, 0, 0]] };
  const positionAttribute = original.geometry.getAttribute('position');
  const normalAttribute = original.geometry.getAttribute('normal');
  const maskAttribute = original.geometry.getAttribute('aMask');
  const paintAttribute = original.geometry.getAttribute('aPaint');
  const uploadVersions = [positionAttribute.version, normalAttribute.version, maskAttribute.version];
  const heightTexture = water.userData.materials.simple.uniforms.uHeight.value;
  const heightTextureVersion = heightTexture.version;
  preview.apply(paintOnly);
  assert.deepEqual([positionAttribute.version, normalAttribute.version, maskAttribute.version], uploadVersions,
    'paint-only preview must not upload height, normal, or mask buffers');
  assert.ok(paintAttribute.version > 0, 'paint weights should upload to aPaint');
  assert.strictEqual(water.userData.materials.simple.uniforms.uHeight.value, heightTexture);
  assert.equal(heightTexture.version, heightTextureVersion, 'paint-only preview must not refresh the water height texture');
  assert.equal(paintAttribute.array[1], 255);
  assert.deepEqual([paintAttribute.getX(0), paintAttribute.getY(0), paintAttribute.getZ(0), paintAttribute.getW(0)],
    paintOnly.materialWeightsAt(-6, -6));
  assert.strictEqual(preview.map, paintOnly);
  preview.apply(base);
  assert.strictEqual(original.geometry, originalGeometry);
  assert.strictEqual(original.material, originalMaterial);
  assert.strictEqual(original.geometry.getAttribute('aPaint'), originalPaintAttribute);
  assert.deepEqual(originalPaintAttribute.array, originalPaintBytes, 'cancel restores the original paint buffer');
  assert.strictEqual(water.userData.materials.simple.uniforms.uHeight.value, simpleHeight);
  water.userData.setMode(false);
  assert.strictEqual(water.material.uniforms.uHeight.value, simpleHeight);
  assert.strictEqual(preview.map, base);
  assert.ok(invalidations >= 4);
  preview.dispose();
  originalGeometry.dispose(); originalMaterial.dispose(); original.userData.nm.dispose();
  water.geometry.dispose(); simpleMaterial.dispose(); ssrMaterial.dispose(); simpleHeight.dispose();
});

test('height texture updates preserve the private texture object and refresh all samples', () => {
  const a = map({ height: 1 }), b = map({ height: 3 });
  const texture = createHeightTexture(a, 8), before = [...texture.image.data];
  const version = texture.version;
  updateHeightTexture(b, texture);
  assert.deepEqual([...texture.image.data], before.map((_, i) => THREE.DataUtils.toHalfFloat(3)));
  assert.equal(texture.version, version + 1);
  texture.dispose();
});
