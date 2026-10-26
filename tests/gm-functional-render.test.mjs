import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEditorModels } from '../src/editor/modelFactory.js';
import { ResourcePanel } from '../src/editor/resourcePanel.js';
import { resourceDescriptor, sourceAssetId } from '../src/editor/resourceAdapters.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createGmContentLayer } from '../src/render/gmContent.js';
import { palmVariant } from '../src/render/palmGeometry.js';
import { palmGeometry } from '../src/render/palmGeometry.js';
import { palmMaterials } from '../src/render/palmMaterials.js';
import { ResourceNodes } from '../src/render/resourceNodes.js';
import { assets } from '../src/render/assets/registry.js';

const PALM_ALIAS = 'prop:gm-resource-palm-v1';
const STONE_ALIAS = 'prop:gm-resource-stone-v1';

function sourceGeometry({ palm = false } = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 2, 1], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, .7, .7, .7, .4, .8, .4], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .5, 1], 2));
  if (palm) {
    geo.setAttribute('_flex', new THREE.Float32BufferAttribute([0, 1, 2], 1));
    geo.setAttribute('_paint', new THREE.Float32BufferAttribute([0, 0, .5, .5, 1, 1], 2));
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

function factoryFixture() {
  const palmId = sourceAssetId(PALM_ALIAS), stoneId = sourceAssetId(STONE_ALIAS);
  const originalPalm = [sourceGeometry({ palm: true }), sourceGeometry({ palm: true })];
  const originalStone = sourceGeometry();
  const data = new Map([
    [palmId, { parts: originalPalm.map((geo) => ({ geo })) }],
    [stoneId, { parts: [{ geo: originalStone }] }],
  ]);
  const textures = new Map();
  const registry = {
    data: (id) => data.get(id) || null,
    entry: (id) => data.has(id) ? { id, kind: 'model', shadow: true } : null,
    texture(id) { if (!textures.has(id)) textures.set(id, new THREE.Texture()); return textures.get(id); },
    model: () => null,
  };
  return { registry, originalPalm, originalStone, textures };
}

test('resource model aliases use the native gameplay silhouettes and reserved source mapping', () => {
  assert.deepEqual(resourceDescriptor(PALM_ALIAS).label, { es: 'Palmera talable', en: 'Harvestable palm' });
  assert.equal(sourceAssetId(PALM_ALIAS), 'model:palm-tall-v1');
  assert.equal(sourceAssetId(STONE_ALIAS), 'model:coast-rock-v1');
  const { registry, originalPalm, originalStone } = factoryFixture();
  const factory = createEditorModels(registry);
  const palm = factory.model(PALM_ALIAS), stone = factory.model(STONE_ALIAS);
  try {
    assert.equal(palm.children.length, 1);
    assert.equal(palm.children[0].position.y, -0.1);
    assert.equal(palm.children[0].children.length, 2);
    assert.equal(palm.children[0].children[0].geometry.getAttribute('aFlex').count, 3);
    assert.equal(palm.userData.gmFunctionalResource.kind, 'palm');
    assert.equal(stone.children[0].geometry.userData.coastVariant, 'compact');
    assert.equal(stone.children[0].scale.x, 1.5);
    assert.equal(stone.children[0].material.userData.rockPaint.family, 'rock-faces-v1');
    assert.equal(stone.userData.gmFunctionalResource.kind, 'stone');
    assert.ok(originalPalm.every((geo) => geo.getAttribute('position')),
      'source palm geometry remains registry-owned and intact');
    assert.ok(originalStone.getAttribute('position'), 'source rock geometry remains registry-owned and intact');
  } finally { factory.dispose(); }
});

test('authored GM palm identity always selects the tall native render variant', () => {
  assert.equal(palmVariant({ id: 'gm_0123456789abcdef0123456789abcdef', x: 19, z: -31 }), 0);
});

test('resource renderer reserves authored palm instances and keeps authored stones at yaw zero', () => {
  const originalData = assets.data;
  const scene = new THREE.Scene(), geometries = [0, 1, 2].map((variant) => palmGeometry(variant));
  const mats = palmMaterials({ texture: () => null }, { value: 0.4 });
  assets.data = () => null;
  try {
    const map = { gmResources: Array.from({ length: 128 }, (_, i) => ({ id: `gm_${String(i).padStart(32, '0')}`, kind: 'palm' })) };
    const nodes = new ResourceNodes(scene, { palms: { geometries, mats }, map });
    assert.equal(nodes.maxPalms, 224);
    assert.equal(nodes.palmMeshes[0].trunk.instanceMatrix.count, 224);
    const stone = { id: 'gm_0123456789abcdef0123456789abcdef', kind: 'stone', x: 2, y: 1, z: 3,
      rev: 1, ready: true, wait: 0 };
    nodes.update({ nodes: [stone], bench: null }, { x: 2, z: 3 }, 0);
    const record = nodes.records.get(stone.id);
    assert.ok(record);
    assert.equal(record.mesh.rotation.y, 0);
    assert.equal(record.mesh.scale.x, 1.5);
    const retained = new Set();
    scene.traverse((object) => {
      if (object.geometry) retained.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) retained.add(material);
    });
    for (const geometry of geometries.flatMap((item) => [item.trunk, item.fronds])) retained.add(geometry);
    for (const material of Object.values(mats)) if (material?.isMaterial) retained.add(material);
    for (const item of retained) item.dispose();
  } finally {
    assets.data = originalData;
  }
});

test('resource palette presents reserved resource actions and routes selection through the editor', async () => {
  const root = { innerHTML: '', addEventListener() {}, removeEventListener() {}, replaceChildren() {} };
  const selected = [];
  const editor = { lang: 'es', document: { objects: [] }, _t: (_en, es) => es,
    assets: { list: () => [{ id: sourceAssetId(PALM_ALIAS), state: 'ok' }],
      entry: () => ({ id: sourceAssetId(PALM_ALIAS) }), ensureModel: async () => true,
      model: (id) => ({ id }) },
    _selectAsset: (entry, model) => selected.push([entry.id, model.id]) };
  const panel = new ResourcePanel({ editor, root });
  try {
    assert.match(root.innerHTML, /Palmera talable/);
    assert.match(root.innerHTML, /Piedra recogible/);
    assert.match(root.innerHTML, /128 recursos añadidos/);
    assert.equal(await panel.choose(PALM_ALIAS), true);
    assert.deepEqual(selected, [[PALM_ALIAS, PALM_ALIAS]]);
  } finally { panel.dispose(); }
});

test('published resource objects are omitted from decorative GM mesh projection', async () => {
  const map = generateWorld(20261031), scene = new THREE.Scene();
  let ensured = 0, modelCalls = 0;
  const assets = { data: () => null, entry: () => null, has: () => true,
    ensureModel: async () => { ensured++; return true; },
    model: () => { modelCalls++; return new THREE.Group(); } };
  const resource = createDecoration({ id: 'gm-01234567-89ab-cdef-0123-456789abcdef', assetId: PALM_ALIAS,
    position: { x: 12, y: map.groundAt(12, 0), z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1,
    collider: 'none' });
  const document = createDocument({ seed: map.seed, baseRevision: 'terrain-s21-v1', objects: [resource] });
  const layer = createGmContentLayer({ scene, map, assets });
  try {
    await layer.load(document);
    assert.equal(ensured, 0);
    assert.equal(modelCalls, 0);
    assert.equal(scene.getObjectByName(`gm:${resource.id}`), undefined);
    assert.equal(layer.active, true);
  } finally { layer.dispose(); }
});
