import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWater } from '../src/render/water.js';
import { createTerrain } from '../src/render/terrain.js';
import { U } from '../src/render/toon.js';
import { FXU, Pipeline, WATERU } from '../src/render/pipeline.js';

const map = {
  size: 12,
  heightAt: (x, z) => -1.2 + Math.sin(x * 0.17) * 0.2 + Math.cos(z * 0.13) * 0.15,
  masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }),
  landmarks: { spawn: { x: 0, z: 0 }, village: { x: 2, z: 2 }, arena: { x: 0, z: 0 }, arenaR: 3 },
};

function fixture() {
  const height = new THREE.DataTexture(new Float32Array([-1.2]), 1, 1, THREE.RedFormat, THREE.FloatType);
  height.needsUpdate = true;
  const water = createWater(map, height);
  const terrain = createTerrain(map, { segments: 4, assetRegistry: { texture: () => null } });
  return { height, water, terrain };
}

function dispose({ height, water, terrain }) {
  height.dispose();
  water.geometry.dispose();
  for (const material of Object.values(water.userData.materials)) material.dispose();
  terrain.geometry.dispose();
  terrain.material.dispose();
  terrain.userData.nm.dispose();
}

const sharedDetailKeys = [
  'mnCausticStrength', 'mnCausticWidth', 'mnFoamContactScale', 'mnFoamLaceWidth',
  'mnFoamLaceStrength', 'mnFoamWaveStrength', 'mnWaterSurfaceLight',
];

test('water quality modes preserve their depth, alpha, and two-triangle surface contract', () => {
  const f = fixture();
  try {
    const { ssr, simple } = f.water.userData.materials;
    const geometry = f.water.geometry;
    assert.equal(f.water.material, ssr);
    assert.equal(ssr.transparent, false);
    assert.equal(ssr.depthWrite, false);
    assert.equal(ssr.depthTest, false, 'SSR uses its shader depth comparison');
    assert.equal(simple.transparent, true);
    assert.equal(simple.depthWrite, false);
    assert.equal(simple.depthTest, true);
    assert.match(ssr.fragmentShader, /gl_FragColor\s*=\s*vec4\(col,\s*1\.0\s*-\s*glowW\s*\*\s*\(1\.0\s*-\s*foam\)\)/);
    assert.match(simple.fragmentShader, /gl_FragColor\s*=\s*vec4\(col,\s*max\(a,\s*foam\)\)/);
    assert.equal(f.water.geometry.index.count, 6);
    assert.equal(new Set(f.water.geometry.index.array).size, 4);
    for (const [mode, material] of [['SSR', ssr], ['simple', simple], ['SSR again', ssr], ['simple again', simple]]) {
      f.water.userData.setMode(mode.startsWith('SSR'));
      assert.strictEqual(f.water.material, material);
      assert.strictEqual(f.water.geometry, geometry);
    }
  } finally { dispose(f); }
});

test('switching water modes retains shared look bindings and only uses their established texture inputs', () => {
  const f = fixture();
  const { ssr } = f.water.userData.materials;
  const savedValues = new Map([...sharedDetailKeys, 'uWaves', 'uRefract', 'uFoamLight'].map((key) => [key, ssr.uniforms[key].value]));
  try {
    const { simple } = f.water.userData.materials;
    const before = Object.fromEntries([...sharedDetailKeys, 'uWaves', 'uRefract', 'uWaterLight', 'uFoamLight', 'uSparkle', 'uGlints', 'mnNoiseTex'].map((key) => [key, ssr.uniforms[key]]));
    ssr.uniforms.uWaves.value = 1.27;
    ssr.uniforms.uRefract.value = 0.041;
    ssr.uniforms.mnFoamLaceStrength.value = 0.41;
    ssr.uniforms.uFoamLight.value = 0.73;
    assert.strictEqual(ssr.uniforms.mnNoiseTex, simple.uniforms.mnNoiseTex);
    assert.strictEqual(ssr.uniforms.tWave.value, simple.uniforms.tWave.value);
    assert.strictEqual(ssr.uniforms.uWaves, simple.uniforms.uWaves);
    assert.strictEqual(ssr.uniforms.uRefract, simple.uniforms.uRefract);
    for (const key of [...sharedDetailKeys, 'uWaterLight', 'uFoamLight', 'uSparkle', 'uGlints']) {
      assert.strictEqual(ssr.uniforms[key], simple.uniforms[key], `${key} should be shared`);
    }

    assert.strictEqual(simple.uniforms.uHeight.value, f.height);
    assert.equal(ssr.uniforms.uHeight, undefined);
    assert.equal(simple.uniforms.tRefract, undefined);
    assert.equal(simple.uniforms.tSceneDepth, undefined);
    assert.equal(ssr.uniforms.tRefract.value, null);
    assert.equal(ssr.uniforms.tSceneDepth.value, null);
    assert.notStrictEqual(simple.uniforms.uHeight, ssr.uniforms.tSceneDepth);

    for (const useSsr of [false, true, false, true, true, false]) {
      f.water.userData.setMode(useSsr);
      assert.strictEqual(f.water.material, useSsr ? ssr : simple);
      for (const [key, uniform] of Object.entries(before)) {
        assert.strictEqual(ssr.uniforms[key], uniform, `${key} SSR binding changed`);
        assert.strictEqual(simple.uniforms[key], uniform, `${key} simple binding changed`);
      }
      assert.equal(simple.uniforms.uWaves.value, 1.27);
      assert.equal(simple.uniforms.uRefract.value, 0.041);
      assert.equal(simple.uniforms.mnFoamLaceStrength.value, 0.41);
      assert.equal(simple.uniforms.uFoamLight.value, 0.73);
      assert.strictEqual(simple.uniforms.uHeight.value, f.height);
      assert.strictEqual(ssr.uniforms.tSceneDepth.value, null);
    }
  } finally {
    for (const [key, value] of savedValues) ssr.uniforms[key].value = value;
    dispose(f);
  }
});

test('one caustic control reaches both water modes and the terrain shader binding', () => {
  const f = fixture();
  const previous = U.mnTerrainCaustics.value;
  const control = f.water.userData.materials.ssr.uniforms.mnCausticStrength;
  const original = control.value;
  try {
    const { ssr, simple } = f.water.userData.materials;
    assert.strictEqual(control, simple.uniforms.mnCausticStrength);
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <common>' };
    f.terrain.material.onBeforeCompile(shader);
    assert.strictEqual(shader.uniforms.mnCausticStrength, control);
    assert.strictEqual(shader.uniforms.mnCausticWidth, ssr.uniforms.mnCausticWidth);
    assert.match(shader.fragmentShader, /mnCausticMask/);

    control.value = original + 0.19;
    assert.equal(ssr.uniforms.mnCausticStrength.value, original + 0.19);
    assert.equal(simple.uniforms.mnCausticStrength.value, original + 0.19);
    assert.equal(shader.uniforms.mnCausticStrength.value, original + 0.19);
  } finally {
    control.value = original;
    U.mnTerrainCaustics.value = previous;
    dispose(f);
  }
});

test('tuning material controls leaves terrain positions, normals, masks, and indices unchanged', () => {
  const baseline = createTerrain(map, { segments: 4, assetRegistry: { texture: () => null } });
  const tuned = createTerrain(map, { segments: 4, assetRegistry: { texture: () => null } });
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' };
  tuned.material.onBeforeCompile(shader);
  const strength = shader.uniforms.mnCausticStrength;
  const width = shader.uniforms.mnCausticWidth;
  const oldStrength = strength.value, oldWidth = width.value;
  try {
    strength.value = oldStrength * 1.8;
    width.value = oldWidth * 0.6;
    for (const key of ['position', 'normal', 'aMask']) {
      assert.deepEqual(tuned.geometry.attributes[key].array, baseline.geometry.attributes[key].array, key);
    }
    assert.deepEqual(tuned.geometry.index.array, baseline.geometry.index.array);
  } finally {
    strength.value = oldStrength;
    width.value = oldWidth;
    for (const terrain of [baseline, tuned]) {
      terrain.geometry.dispose();
      terrain.material.dispose();
      terrain.userData.nm.dispose();
    }
  }
});

test('pipeline resize keeps the shared normal depth attachment aligned across low-to-medium without rebinding samplers', () => {
  const renderer = {
    extensions: { has: () => false },
    capabilities: { isWebGL2: false },
    pixelRatio: 1,
    setPixelRatio(value) { this.pixelRatio = value; },
    setSize() {},
    getPixelRatio() { return this.pixelRatio; },
  };
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 1200);
  const oldFxDepth = FXU.uDepth.value;
  const oldWaterDepth = WATERU.tSceneDepth.value;
  const oldRefract = WATERU.tRefract.value;
  const pipeline = new Pipeline(renderer, new THREE.Scene(), camera);
  const depth = pipeline.rtNormal.depthTexture;
  const color = pipeline.rtNormal.texture;
  const bindings = [FXU.uDepth, WATERU.tSceneDepth, pipeline.composite.uniforms.tDepth];
  try {
    const size = (ss, outlines) => pipeline.setQuality({ pixelRatio: 1, ss, outlines, fxaa: true, comic: 0, outlineMul: 1 });
    pipeline.resize(1280, 720);
    size(1.5, true); // high: 1280x720 canvas, 1920x1080 offscreen targets
    assert.deepEqual([color.image.width, color.image.height], [1920, 1080]);
    assert.deepEqual([depth.image.width, depth.image.height], [1920, 1080]);
    assert.ok(bindings.every((uniform) => uniform.value === depth));

    size(1, false); // low: direct draw, 1280x720 targets
    assert.deepEqual([pipeline.rtNormal.width, pipeline.rtNormal.height], [1280, 720]);
    assert.deepEqual([color.image.width, color.image.height], [1280, 720]);
    assert.deepEqual([depth.image.width, depth.image.height], [1280, 720]);
    assert.ok(bindings.every((uniform) => uniform.value === depth), 'depth sampler references survive low resize');
    const lowVersion = depth.version;

    size(1, true); // medium: same target size, outlines rebind the FBO
    assert.deepEqual([pipeline.rtNormal.width, pipeline.rtNormal.height], [1280, 720]);
    assert.deepEqual([color.image.width, color.image.height], [1280, 720]);
    assert.deepEqual([depth.image.width, depth.image.height], [1280, 720]);
    assert.equal(depth.version, lowVersion, 'same-size resize must not request another depth upload');
    assert.ok(bindings.every((uniform) => uniform.value === depth), 'all FX/composite/water bindings keep their original depth texture');
  } finally {
    FXU.uDepth.value = oldFxDepth;
    WATERU.tSceneDepth.value = oldWaterDepth;
    WATERU.tRefract.value = oldRefract;
    for (const target of [pipeline.rtMain, pipeline.rtNormal, pipeline.rtPost, pipeline.rtRefract, ...pipeline.bloomRT]) target.dispose();
    for (const material of [pipeline.composite, pipeline.copy, pipeline.final, pipeline.bloomExtract, pipeline.bloomDown, pipeline.bloomUp]) material.dispose();
    for (const quad of [pipeline.bloomQuad, pipeline.compQuad, pipeline.copyQuad, pipeline.finalQuad]) quad.mesh.geometry.dispose();
  }
});
