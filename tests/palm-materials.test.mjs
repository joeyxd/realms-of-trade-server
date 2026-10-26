import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { U } from '../src/render/toon.js';
import { PALM_TEXTURE_IDS, palmMaterials } from '../src/render/palmMaterials.js';

function registry(albedo, normal = null) {
  const textures = new Map([[PALM_TEXTURE_IDS[0], albedo], [PALM_TEXTURE_IDS[1], normal]]);
  return { texture: (id) => textures.get(id) || null };
}

function shaderPair(shader) {
  return { uniforms: {}, vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader };
}

test('frond outline normal pass samples the atlas alpha and shadows keep matching alpha and wind', () => {
  const albedo = new THREE.Texture(), normal = new THREE.Texture(), sway = { value: 0.27 };
  const mats = palmMaterials(registry(albedo, normal), sway);
  assert.equal(mats.fronds.map, albedo);
  assert.equal(mats.fronds.normalMap, normal);
  assert.equal(mats.frondNm.map, albedo);
  assert.equal(mats.frondNm.alphaTest, 0.35);

  const normalShader = shaderPair(THREE.ShaderLib.normal);
  assert.equal(THREE.ShaderLib.normal.fragmentShader.includes('#include <alphatest_fragment>'), false,
    'Three r160 normal shader has no standard alpha test to rely on');
  mats.frondNm.onBeforeCompile(normalShader);
  assert.equal(normalShader.uniforms.mnPalmCut.value, albedo);
  assert.match(normalShader.vertexShader, /varying vec2 vPalmCutUV/);
  assert.match(normalShader.vertexShader, /vPalmCutUV\s*=\s*uv/);
  assert.match(normalShader.fragmentShader, /uniform sampler2D mnPalmCut/);
  assert.match(normalShader.fragmentShader, /texture2D\(mnPalmCut, vPalmCutUV\)\.a < 0\.35\) discard/);
  assert.match(normalShader.vertexShader, /sin\(mnTime \* 1\.25/);
  assert.match(normalShader.vertexShader, /aFlex/);

  const depthShader = shaderPair(THREE.ShaderLib.depth);
  assert.match(THREE.ShaderLib.depth.fragmentShader, /#include <alphatest_fragment>/,
    'the standard depth shader retains its map alpha test');
  mats.frondDepth.onBeforeCompile(depthShader);
  assert.strictEqual(depthShader.uniforms.mnTime, U.mnTime);
  assert.strictEqual(depthShader.uniforms.mnSwayAmt, sway);
  assert.match(depthShader.vertexShader, /sin\(mnTime \* 1\.25/);
  assert.match(depthShader.vertexShader, /cos\(mnTime \* 1\.05/);
  assert.match(depthShader.vertexShader, /step\(1\.5, aFlex\)/);
  assert.equal(mats.frondDepth.map, albedo);
  assert.equal(mats.frondDepth.alphaTest, 0.35);
  albedo.dispose(); normal.dispose();
});

test('missing albedo keeps vertex-color fallback and disables normal and alpha sampling', () => {
  const unusedNormal = new THREE.Texture(), sway = { value: 0.19 };
  const mats = palmMaterials(registry(null, unusedNormal), sway);
  assert.equal(mats.painted, false);
  assert.equal(mats.normal, false);
  assert.equal(mats.fronds.vertexColors, true);
  assert.equal(mats.fronds.map, null);
  assert.equal(mats.fronds.normalMap, null, 'a normal map is never applied without its matching color atlas');
  assert.equal(mats.fronds.alphaTest, 0);
  assert.equal(mats.frondDepth.map, null);
  assert.equal(mats.frondDepth.alphaTest, 0);

  const normalShader = shaderPair(THREE.ShaderLib.normal);
  mats.frondNm.onBeforeCompile(normalShader);
  assert.equal(normalShader.uniforms.mnPalmCut, undefined);
  assert.doesNotMatch(normalShader.fragmentShader, /mnPalmCut|vPalmCutUV/);
  unusedNormal.dispose();
});
