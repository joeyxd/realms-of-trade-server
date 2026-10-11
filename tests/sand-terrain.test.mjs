import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createTerrain } from '../src/render/terrain.js';
import { sandUniforms, SAND_MATERIALS, sandTextureId } from '../src/render/sandMaterials.js';
import { normalizeManifest, selectTextureSource } from '../src/render/assets/manifest.js';

const map = { size: 12, heightAt: (x, z) => 0.7 + x * 0.01 + z * 0.01,
  masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }),
  landmarks: { spawn: { x: 1, z: 2 }, village: { x: 4, z: 5 }, arena: { x: 0, z: 0 }, arenaR: 3 } };
const empty = { texture: () => null };

test('missing texture family keeps terrain valid and normals flat', () => {
  const m = createTerrain(map, { segments: 2, assetRegistry: empty });
  assert.equal(m.userData.sand.uniforms.mnSandEnabled.value, 0);
  assert.deepEqual(m.userData.sand.loaded, []);
  for (const kind of SAND_MATERIALS) {
    assert.equal(m.userData.sand.uniforms[`mnSand${kind.name}On`].value, 0);
    assert.deepEqual([...m.userData.sand.uniforms[`mnSand${kind.name}Normal`].value.image.data], [128, 128, 255, 255]);
  }
  m.geometry.dispose(); m.material.dispose(); m.userData.nm.dispose();
});

test('wet uses same normal; missing colour cannot activate its normal; placement never alters heightfield', () => {
  const normal = new THREE.Texture(), dry = new THREE.Texture(), wet = new THREE.Texture();
  const registry = { texture: (id) => ({ [sandTextureId('dry-normal')]: normal, [sandTextureId('dry-albedo')]: dry, [sandTextureId('wet-albedo')]: wet })[id] || null };
  const s = sandUniforms(registry, map);
  assert.equal(s.uniforms.mnSandDryNormal.value, normal);
  assert.equal(s.uniforms.mnSandWetNormal.value, normal);
  assert.equal(s.uniforms.mnSandFootprintsOn.value, 0);
  assert.deepEqual(s.uniforms.mnSandTrail.value.toArray(), [1, 2, 4, 5]);
  const a = createTerrain(map, { segments: 3, assetRegistry: empty });
  const b = createTerrain(map, { segments: 3, assetRegistry: registry });
  for (const key of ['position', 'normal', 'aMask']) assert.deepEqual(a.geometry.attributes[key].array, b.geometry.attributes[key].array);
  assert.deepEqual(a.geometry.index.array, b.geometry.index.array);
  for (const m of [a, b]) { m.geometry.dispose(); m.material.dispose(); m.userData.nm.dispose(); }
});

test('all consumers have one desktop/mobile source, linear normals and existing files', () => {
  const manifest = normalizeManifest(JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url))));
  assert.deepEqual(manifest.errors, []);
  const names = new Set(SAND_MATERIALS.flatMap((m) => [m.albedo, m.normal]));
  assert.equal(names.size, 9);
  for (const name of names) {
    const entry = manifest.entries.get(sandTextureId(name));
    assert.ok(entry, name);
    assert.equal(entry.data, name.endsWith('normal'));
    assert.match(selectTextureSource(entry), /-desktop\.webp$/);
    assert.match(selectTextureSource(entry, true), /-mobile\.webp$/);
    for (const src of [entry.src, entry.mobileSrc]) assert.ok(fs.existsSync(new URL('../assets/' + src, import.meta.url)));
  }
});
