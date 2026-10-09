import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createTerrain } from '../src/render/terrain.js';
import {
  GROUND_INSET, GROUND_SPAN, GROUND_TEXTURES, GROUND_TILES,
  groundAtlasUV, groundTextureId, groundTransitionUV, groundUniforms,
} from '../src/render/groundMaterials.js';
import { normalizeManifest, selectTextureSource } from '../src/render/assets/manifest.js';

const map = {
  size: 12,
  heightAt: (x, z) => 0.7 + x * 0.01 + z * 0.01,
  masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }),
  landmarks: { spawn: { x: 1, z: 2 }, village: { x: 4, z: 5 }, arena: { x: 0, z: 0 }, arenaR: 3 },
};

test('ground transition runs from sand to grass monotonically and stays bounded at extremes', () => {
  assert.deepEqual(groundTransitionUV(0, 0), [0.09, 0.09]);
  for (const value of groundTransitionUV(1, 0)) assert.ok(Math.abs(value - 0.91) < 1e-12);

  for (const phase of [-1e15, -1e9, -Math.PI, 0, Math.PI, 1e9, 1e15]) {
    const samples = Array.from({ length: 101 }, (_, i) => groundTransitionUV(i / 100, phase));
    for (let i = 0; i < samples.length; i++) {
      for (const coordinate of samples[i]) {
        assert.ok(Number.isFinite(coordinate));
        assert.ok(coordinate >= 0.02 && coordinate <= 0.98);
      }
      if (i > 0) {
        assert.ok(samples[i][0] >= samples[i - 1][0]);
        assert.ok(samples[i][1] >= samples[i - 1][1]);
      }
    }
  }
  assert.deepEqual(groundTransitionUV(-100, 0), groundTransitionUV(0, 0));
  assert.deepEqual(groundTransitionUV(100, 0), groundTransitionUV(1, 0));
});

test('ground atlas coordinates stay inside each padded tile, including clamped UV extremes', () => {
  for (const [name, origin] of Object.entries(GROUND_TILES)) {
    const min = groundAtlasUV(origin, [0, 0]);
    const max = groundAtlasUV(origin, [1, 1]);
    const below = groundAtlasUV(origin, [-10, -10]);
    const above = groundAtlasUV(origin, [10, 10]);
    assert.deepEqual(below, min, `${name} lower clamp`);
    assert.deepEqual(above, max, `${name} upper clamp`);
    for (let axis = 0; axis < 2; axis++) {
      const tileStart = origin[axis];
      const tileEnd = tileStart + 0.5;
      assert.equal(min[axis], tileStart + GROUND_INSET);
      assert.equal(max[axis], tileStart + GROUND_INSET + GROUND_SPAN);
      assert.ok(min[axis] >= tileStart + GROUND_INSET);
      assert.ok(max[axis] <= tileEnd - GROUND_INSET);
      assert.ok(max[axis] < tileEnd);
    }
  }
});

test('a normal map alone cannot enable painted ground; colour without a normal stays flat', () => {
  const normal = new THREE.Texture();
  const color = new THREE.Texture();
  const empty = groundUniforms({ texture: () => null });
  assert.equal(empty.uniforms.mnGroundEnabled.value, 0);
  assert.equal(empty.uniforms.mnGroundNormalOn.value, 0);
  assert.deepEqual(empty.loaded, []);

  const normalOnly = groundUniforms({ texture: (id) => id === groundTextureId('atlas-normal') ? normal : null });
  assert.equal(normalOnly.uniforms.mnGroundEnabled.value, 0);
  assert.equal(normalOnly.uniforms.mnGroundNormalOn.value, 0);
  assert.deepEqual(normalOnly.loaded, []);

  const colorOnly = groundUniforms({ texture: (id) => id === groundTextureId('atlas-albedo') ? color : null });
  assert.equal(colorOnly.uniforms.mnGroundEnabled.value, 1);
  assert.equal(colorOnly.uniforms.mnGroundNormalOn.value, 0);
  assert.deepEqual(colorOnly.loaded, ['sand-grass', 'sand-dirt', 'grass', 'dirt']);
  assert.deepEqual([...colorOnly.uniforms.mnGroundNormal.value.image.data], [128, 128, 255, 255]);

  normal.dispose();
  color.dispose();
});

test('enabling the ground atlas leaves the shared terrain geometry byte-for-byte unchanged', () => {
  const empty = { texture: () => null };
  const loaded = new Map([
    [groundTextureId('atlas-albedo'), new THREE.Texture()],
    [groundTextureId('atlas-normal'), new THREE.Texture()],
  ]);
  const registry = { texture: (id) => loaded.get(id) || null };
  const procedural = createTerrain(map, { segments: 3, assetRegistry: empty });
  const painted = createTerrain(map, { segments: 3, assetRegistry: registry });
  try {
    for (const key of ['position', 'normal', 'aMask']) {
      assert.deepEqual(painted.geometry.attributes[key].array, procedural.geometry.attributes[key].array, key);
    }
    assert.deepEqual(painted.geometry.index.array, procedural.geometry.index.array);
  } finally {
    for (const mesh of [procedural, painted]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.userData.nm.dispose();
    }
    for (const texture of loaded.values()) texture.dispose();
  }
});

test('the ground atlas manifest has desktop and mobile sources and linear normal data', () => {
  const path = new URL('../assets/manifest.json', import.meta.url);
  const manifest = normalizeManifest(JSON.parse(fs.readFileSync(path, 'utf8')));
  assert.deepEqual(manifest.errors, []);
  const ids = GROUND_TEXTURES.map(groundTextureId);
  const groundEntries = [...manifest.entries.keys()].filter((id) => id.startsWith('tex:ground-'));
  assert.deepEqual(groundEntries.sort(), [...ids].sort());

  for (const name of GROUND_TEXTURES) {
    const entry = manifest.entries.get(groundTextureId(name));
    assert.ok(entry, name);
    assert.equal(entry.kind, 'tex');
    assert.ok(entry.mobileSrc, `${name} has a mobile source`);
    assert.equal(selectTextureSource(entry, false), entry.src);
    assert.equal(selectTextureSource(entry, true), entry.mobileSrc);
    for (const source of [entry.src, entry.mobileSrc]) {
      assert.ok(fs.existsSync(new URL(`../assets/${source}`, import.meta.url)), `${name}: ${source}`);
    }
    if (name.endsWith('normal')) {
      assert.equal(entry.data, true);
      assert.equal(entry.filter, 'linear');
    } else {
      assert.equal(entry.data, false);
    }
  }
});
