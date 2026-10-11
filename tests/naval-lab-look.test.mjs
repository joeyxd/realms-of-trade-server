import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSky, SKY } from '../src/render/sky.js';
import { createWater, WATER_LIGHT, WATER_LOOK } from '../src/render/water.js';
import { U } from '../src/render/toon.js';
import { configureNavalReferenceLook, NAVAL_REFERENCE_PALETTE } from '../tools/naval-lab/look.js';

function valueState(value) {
  if (value?.isColor || value?.isVector2 || value?.isVector3 || value?.isVector4) return value.toArray();
  if (Array.isArray(value)) return value.map(valueState);
  return value;
}

function snapshotUniforms(uniforms) {
  return Object.fromEntries(Object.entries(uniforms).map(([key, uniform]) => [key, {
    uniform, value: uniform.value, state: valueState(uniform.value),
  }]));
}

function assertUniformsUnchanged(uniforms, snapshot) {
  for (const [key, before] of Object.entries(snapshot)) {
    assert.strictEqual(uniforms[key], before.uniform, `${key} uniform binding changed`);
    assert.strictEqual(uniforms[key].value, before.value, `${key} value reference changed`);
    assert.deepEqual(valueState(uniforms[key].value), before.state, `${key} value changed`);
  }
}

function snapshotValues(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
    value, state: valueState(value),
  }]));
}

function assertValuesUnchanged(values, snapshot) {
  for (const [key, before] of Object.entries(snapshot)) {
    assert.strictEqual(values[key], before.value, `${key} reference changed`);
    assert.deepEqual(valueState(values[key]), before.state, `${key} value changed`);
  }
}

function makeLookFixture() {
  const scene = new THREE.Scene();
  const sky = createSky();
  const height = new THREE.DataTexture(new Float32Array([-8]), 1, 1, THREE.RedFormat, THREE.FloatType);
  height.needsUpdate = true;
  const sea = createWater({ size: 100 }, height);
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x112233 }));
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  const pipeline = { grading: { contrast: 0, sat: 1, bloom: 0, vignette: 0 } };
  scene.add(sky, sea, bottom, hemisphere, sun);
  return { scene, sky, sea, bottom, hemisphere, sun, pipeline, height };
}

function disposeFixture(fixture) {
  fixture.sky.geometry.dispose(); fixture.sky.material.dispose();
  fixture.sea.geometry.dispose();
  for (const material of Object.values(fixture.sea.userData.materials)) material.dispose();
  fixture.bottom.geometry.dispose(); fixture.bottom.material.dispose();
  fixture.height.dispose();
}

test('naval reference look forks both water modes without changing shared render presets', () => {
  const baseline = makeLookFixture();
  const lab = makeLookFixture();
  const globalSnapshot = {
    sky: snapshotUniforms(SKY),
    waterLight: snapshotUniforms(WATER_LIGHT),
    waterLook: snapshotValues(WATER_LOOK),
    toonUniforms: snapshotUniforms(U),
  };
  const baselineSky = snapshotUniforms(baseline.sky.material.uniforms);
  const baselineWater = Object.fromEntries(Object.entries(baseline.sea.userData.materials).map(([mode, material]) => [mode, {
    uniforms: snapshotUniforms(material.uniforms), shader: material.fragmentShader,
  }]));
  const geometryState = (mesh) => ({
    geometry: mesh.geometry,
    position: mesh.geometry.getAttribute('position').array.slice(),
  });
  const baselineSeaGeometry = geometryState(baseline.sea), labSeaGeometry = geometryState(lab.sea);
  const labSkyGeometry = lab.sky.geometry;
  const labSkyPosition = lab.sky.geometry.getAttribute('position').array.slice();
  const labTextureBindings = Object.fromEntries(Object.entries(lab.sea.userData.materials).map(([mode, material]) => [mode, {
    wave: material.uniforms.tWave.value, height: material.uniforms.uHeight?.value,
    refract: material.uniforms.tRefract?.value, depth: material.uniforms.tSceneDepth?.value,
  }]));

  configureNavalReferenceLook(lab);

  assertUniformsUnchanged(SKY, globalSnapshot.sky);
  assertUniformsUnchanged(WATER_LIGHT, globalSnapshot.waterLight);
  assertValuesUnchanged(WATER_LOOK, globalSnapshot.waterLook);
  assertUniformsUnchanged(U, globalSnapshot.toonUniforms);
  assertUniformsUnchanged(baseline.sky.material.uniforms, baselineSky);
  for (const [mode, material] of Object.entries(baseline.sea.userData.materials)) {
    assertUniformsUnchanged(material.uniforms, baselineWater[mode].uniforms);
    assert.equal(material.fragmentShader, baselineWater[mode].shader, `${mode} baseline shader changed`);
  }

  const { ssr, simple } = lab.sea.userData.materials;
  for (const [mode, material] of Object.entries({ ssr, simple })) {
    assert.notEqual(material.uniforms.skyTop.value.getHex(), SKY.skyTop.value.getHex(), `${mode} keeps the shared sky palette`);
    assert.notEqual(material.uniforms.uScatterDeep.value.getHex(), WATER_LOOK.scatterDeep.getHex(), `${mode} keeps the shared water palette`);
    assert.equal(material.uniforms.uWaves.value, 1.35);
    assert.match(material.fragmentShader, /labSwell/);
    assert.match(material.fragmentShader, /Lab reference: broken pale caps/);
    assert.ok(material.version > 0, `${mode} shader update was not requested`);
  }
  for (const key of ['uAbsorb', 'uScatterShallow', 'uScatterDeep', 'uFoam', 'uCaustic', 'uWaterLight', 'uSparkle', 'uGlints']) {
    assert.deepEqual(valueState(ssr.uniforms[key].value), valueState(simple.uniforms[key].value), `${key} differs between SSR and simple water`);
  }
  assert.notEqual(lab.sky.material.uniforms.skyTop.value.getHex(), SKY.skyTop.value.getHex());
  assert.notEqual(baseline.scene.fog, lab.scene.fog);
  assert.equal(lab.scene.fog.color.getHex(), NAVAL_REFERENCE_PALETTE.horizon);
  assert.deepEqual([...baselineSeaGeometry.position], [...baseline.sea.geometry.getAttribute('position').array]);
  assert.strictEqual(baseline.sea.geometry, baselineSeaGeometry.geometry);
  assert.deepEqual([...labSeaGeometry.position], [...lab.sea.geometry.getAttribute('position').array]);
  assert.strictEqual(lab.sea.geometry, labSeaGeometry.geometry);
  assert.strictEqual(lab.sky.geometry, labSkyGeometry);
  assert.deepEqual([...labSkyPosition], [...lab.sky.geometry.getAttribute('position').array]);
  for (const [mode, material] of Object.entries(lab.sea.userData.materials)) {
    assert.strictEqual(material.uniforms.tWave.value, labTextureBindings[mode].wave);
    assert.strictEqual(material.uniforms.uHeight?.value, labTextureBindings[mode].height);
    assert.strictEqual(material.uniforms.tRefract?.value, labTextureBindings[mode].refract);
    assert.strictEqual(material.uniforms.tSceneDepth?.value, labTextureBindings[mode].depth);
  }
  assert.equal(lab.pipeline.grading.contrast, 0.08);
  assert.equal(lab.pipeline.grading.sat, 0.96);
  assert.equal(lab.pipeline.grading.bloom, 0.08);
  assert.equal(lab.pipeline.grading.vignette, 0.16);

  disposeFixture(baseline); disposeFixture(lab);
});

test('naval reference look reports a clear error when the shared water shader anchor drifts', () => {
  const fixture = makeLookFixture();
  fixture.sea.userData.materials.ssr.fragmentShader = 'void main() { gl_FragColor = vec4(1.0); }';
  assert.throws(() => configureNavalReferenceLook(fixture), /Water reference look anchor changed/);
  disposeFixture(fixture);
});
