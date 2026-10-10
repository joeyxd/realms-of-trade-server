import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEditorModels } from '../src/editor/modelFactory.js';
import { fitBox } from '../src/render/assets/manifest.js';
import { PALM_IDS } from '../src/render/palmGeometry.js';
import { PALM_BASE_IDS } from '../src/render/palmBaseGeometry.js';
import { SHRUB_IDS } from '../src/render/shrubGeometry.js';

const FAMILY_IDS = [...PALM_IDS, ...PALM_BASE_IDS, ...SHRUB_IDS];

function sourceGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 4, 1], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 0.6, 0.8, 0.4, 0.3, 0.7, 0.2], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  geometry.setAttribute('_flex', new THREE.Float32BufferAttribute([0, 1, 2], 1));
  geometry.setAttribute('_paint', new THREE.Float32BufferAttribute([0, 0, 0.5, 0.5, 1, 1], 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function fixtureRegistry() {
  const sourceGeometries = new Map();
  const data = new Map(FAMILY_IDS.map((id) => {
    const parts = [sourceGeometry(), sourceGeometry()].map(geo => ({ geo }));
    sourceGeometries.set(id, parts.map(part => part.geo));
    return [id, { min: [-1, 0, -1], max: [1, 4, 1], parts }];
  }));
  const textures = new Map();
  const fallbackCalls = [];
  const registry = {
    data: id => data.get(id) || null,
    entry: id => data.has(id) ? { id, kind: 'model', fit: 'proc', scale: 1, yOffset: 0.1, shadow: true } : null,
    texture(id) {
      if (!textures.has(id)) textures.set(id, new THREE.Texture());
      return textures.get(id);
    },
    model(id, target) {
      const group = new THREE.Group();
      fallbackCalls.push([id, target]);
      return group;
    },
  };
  return { registry, sourceGeometries, textures, fallbackCalls };
}

function shaderFor(material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
    fragmentShader: 'void main() {\n#include <clipping_planes_fragment>\n}',
  };
  material.onBeforeCompile(shader);
  return shader;
}

test('vegetation editor models preserve painted family materials, normal/depth passes, fit and cached templates', () => {
  const { registry, sourceGeometries, fallbackCalls } = fixtureRegistry();
  const swayUniform = { value: 0.65 };
  const factory = createEditorModels(registry, { swayUniform });
  const groups = new Map();

  for (const id of FAMILY_IDS) {
    const target = { w: 2, h: 3 };
    const first = factory.model(id, target);
    const second = factory.model(id, target);
    groups.set(id, [first, second]);
    assert.equal(first.name, id);
    assert.equal(first.children.length, 1);
    const inner = first.children[0];
    const meshes = inner.children;
    assert.equal(meshes.length, 2);
    const entry = registry.entry(id), data = registry.data(id), fit = fitBox(data.min, data.max, entry, target);
    assert.deepEqual(inner.scale.toArray(), [fit.s, fit.s, fit.s]);
    assert.deepEqual(inner.position.toArray(), [fit.x, fit.y, fit.z]);
    for (let part = 0; part < meshes.length; part++) {
      const mesh = meshes[part], peer = second.children[0].children[part];
      assert.ok(mesh.isMesh);
      assert.notEqual(mesh.geometry, sourceGeometries.get(id)[part], 'loaded helpers clone registry geometry before adaptation');
      assert.equal(mesh.geometry, peer.geometry, 'separate placements share cached immutable family geometry');
      assert.equal(mesh.material, peer.material, 'separate placements share cached family material');
      assert.ok(mesh.geometry.getAttribute('aFlex'));
      assert.ok(mesh.geometry.getAttribute('aPaint'));
      assert.equal(mesh.geometry.getAttribute('_flex'), undefined);
      assert.equal(mesh.geometry.getAttribute('_paint'), undefined);
      if (!(SHRUB_IDS.includes(id) && part === 0)) assert.ok(mesh.material.map?.isTexture, 'painted atlas remains the color material map');
      assert.ok(mesh.userData.nm?.isMeshNormalMaterial, 'the outline pass uses its paired normal material');
      assert.ok(mesh.customDepthMaterial?.isMeshDepthMaterial, 'the shadow pass uses the family alpha/wind material');
      assert.equal(mesh.castShadow, true);
      assert.equal(mesh.receiveShadow, true);
    }
  }
  const fallbackTarget = { w: 3, h: 2 };
  assert.ok(factory.model('model:gm-coral-50k-hash', fallbackTarget).isGroup, 'unadapted models delegate to the registry');
  assert.deepEqual(fallbackCalls, [['model:gm-coral-50k-hash', fallbackTarget]]);

  const palmMesh = groups.get(PALM_IDS[0])[0].children[0].children[1];
  for (const material of [palmMesh.material, palmMesh.userData.nm, palmMesh.customDepthMaterial]) {
    const shader = shaderFor(material);
    assert.match(shader.vertexShader, /#ifdef USE_INSTANCING[\s\S]*?#endif/);
    assert.match(shader.vertexShader, /vec3 o = vec3\(0\.0\)/);
    assert.match(shader.vertexShader, /aFlex/);
    assert.equal(shader.uniforms.mnSwayAmt, swayUniform, 'render, normal and depth passes share the editor wind uniform');
  }
  assert.equal(swayUniform.value, 0.65);
});

test('factory disposal releases only its cached clones and materials, never registry geometry or textures', () => {
  const { registry, sourceGeometries, textures } = fixtureRegistry();
  const factory = createEditorModels(registry);
  const groups = FAMILY_IDS.map(id => factory.model(id));
  const ownedGeometries = new Set(groups.flatMap(group => group.children[0].children.map(mesh => mesh.geometry)));
  const ownedMaterials = new Set(groups.flatMap(group => group.children[0].children.flatMap(mesh => [mesh.material, mesh.userData.nm, mesh.customDepthMaterial])));
  const geometryDisposals = new Map(), materialDisposals = new Map(), textureDisposals = new Map();
  for (const geometry of ownedGeometries) geometry.addEventListener('dispose', () => geometryDisposals.set(geometry, (geometryDisposals.get(geometry) || 0) + 1));
  for (const material of ownedMaterials) material.addEventListener('dispose', () => materialDisposals.set(material, (materialDisposals.get(material) || 0) + 1));
  for (const texture of textures.values()) texture.addEventListener('dispose', () => textureDisposals.set(texture, (textureDisposals.get(texture) || 0) + 1));
  let sourceDisposals = 0;
  for (const geometries of sourceGeometries.values()) for (const geometry of geometries) geometry.addEventListener('dispose', () => sourceDisposals++);

  factory.dispose();
  factory.dispose();
  assert.equal(geometryDisposals.size, ownedGeometries.size);
  assert.ok([...geometryDisposals.values()].every(count => count === 1));
  assert.equal(materialDisposals.size, ownedMaterials.size);
  assert.ok([...materialDisposals.values()].every(count => count === 1));
  assert.equal(sourceDisposals, 0, 'the registry continues to own imported source geometry');
  assert.equal(textureDisposals.size, 0, 'textures remain registry-owned');
  assert.equal(factory.model(PALM_IDS[0]), null, 'a disposed factory cannot make meshes over released templates');
});
