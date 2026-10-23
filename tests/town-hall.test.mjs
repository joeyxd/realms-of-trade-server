import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assets } from '../src/render/assets/registry.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID } from '../src/render/townMaterials.js';
import { createProps } from '../src/render/props.js';
import { selectTownHall, townHallBannerGeometry, townHallBannerMaterial, townHallSupportsGeometry } from '../src/render/townHall.js';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function forbidRng(map) {
  Object.defineProperty(map, 'rng', { get() { throw new Error('town hall rendering must not read world RNG'); } });
  return map;
}

function townMap(props = [{ kind: 'hut', x: 3, y: 0, z: 4, rot: 0, scale: 1 }]) {
  return forbidRng({ props, npcs: [], groundAt: () => 0,
    dock: { len: 0, halfWidth: 0, deckY: 0, base: { x: 0, z: 9 }, dir: { x: 0, z: 1 } } });
}

function withCanvas(fn) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls = [];
  const ctx = new Proxy({}, { get: (_target, key) => key === 'createLinearGradient' || key === 'createRadialGradient'
    ? () => ({ addColorStop() {} }) : (...args) => calls.push([key, ...args]) });
  globalThis.document = { createElement: (tag) => ({ tagName: tag, width: 0, height: 0, getContext: () => ctx }) };
  try { return fn(calls); }
  finally { if (prior) Object.defineProperty(globalThis, 'document', prior); else delete globalThis.document; }
}

function withAssets({ texture, propId = () => null, instanced = () => null }, fn) {
  const prior = new Map();
  for (const key of ['texture', 'propId', 'instanced']) prior.set(key, Object.getOwnPropertyDescriptor(assets, key));
  assets.texture = texture; assets.propId = propId; assets.instanced = instanced;
  try { return fn(); }
  finally {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(assets, key, descriptor); else delete assets[key];
    }
  }
}

function disposeProps(result) {
  result.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !Array.isArray(o.material)) o.material.dispose();
  });
}

test('selection chooses the nearest port-facing hut deterministically and leaves frozen world data alone', () => {
  const props = freezeDeep([
    { kind: 'hut', x: 3, y: 1, z: 4, rot: 0, scale: 1 }, // distance 5, faces +z
    { kind: 'hut', x: 0, y: 0, z: 8, rot: Math.PI, scale: 1 }, // nearer, faces away
    { kind: 'crate', x: 0, y: 0, z: 8, rot: 0, scale: 1 },
    { kind: 'hut', x: -3, y: 2, z: 4, rot: 0, scale: 1 }, // equal distance, later tie
  ]);
  const map = townMap(props);
  const before = structuredClone(props);
  assert.equal(selectTownHall(map), props[0]);
  assert.deepEqual(props, before);
  assert.equal(selectTownHall({ props, dock: {} }), null);
  assert.equal(selectTownHall({ props: [], dock: { base: { x: 0, z: 0 } } }), null);
});

test('supports stay above the doorway and within the landmark geometry and height budget', () => {
  const geometry = townHallSupportsGeometry();
  try {
    geometry.computeBoundingBox();
    const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), normals = geometry.getAttribute('normal');
    assert.ok(p.count / 3 <= 180, `support detail uses ${p.count / 3} triangles`);
    assert.ok(geometry.boundingBox.min.y > 3.0, 'attachments clear the doorway');
    assert.ok(geometry.boundingBox.max.y < 7.3, 'mast stays within the landmark height budget');
    assert.ok(uv && normals && uv.count === p.count && normals.count === p.count);
    for (let i = 0; i < p.count; i++) {
      for (const value of [p.getX(i), p.getY(i), p.getZ(i), normals.getX(i), normals.getY(i), normals.getZ(i), uv.getX(i), uv.getY(i)]) {
        assert.ok(Number.isFinite(value));
      }
    }
  } finally { geometry.dispose(); }
});

test('banner geometry has finite UVs and normals and the canvas material stays opaque toon paint', () => withCanvas((drawCalls) => {
  const geometry = townHallBannerGeometry();
  let material;
  try {
    const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), n = geometry.getAttribute('normal');
    assert.equal(geometry.index.count / 3, 72);
    assert.equal(uv.count, p.count); assert.equal(n.count, p.count);
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.min.y > 3.3 && geometry.boundingBox.max.y < 4.9);
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)));
      assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)));
      assert.ok(Number.isFinite(n.getX(i)) && Number.isFinite(n.getY(i)) && Number.isFinite(n.getZ(i)));
    }
    material = townHallBannerMaterial();
    assert.ok(material.isMeshToonMaterial);
    assert.equal(material.transparent, false); assert.equal(material.alphaTest, 0);
    assert.equal(material.side, THREE.DoubleSide);
    assert.equal(material.normalMap, null);
    assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
    assert.deepEqual(material.map.image && [material.map.image.width, material.map.image.height], [256, 256]);
    assert.deepEqual(material.userData.townHall, { family: 'town-hall-v1', canvas: [256, 256], texturesDownloaded: 0 });
    assert.ok(drawCalls.length > 0, 'banner is drawn into its canvas without external image downloads');
  } finally { geometry.dispose(); material?.dispose(); }
}));

test('createProps adds a shadowed banner at the selected hut and records the render anchor without map mutation', () => withCanvas(() => {
  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  const map = freezeDeep(townMap([
    { kind: 'hut', x: 3, y: 0, z: 4, rot: 0.25, scale: 1.1 },
    { kind: 'hut', x: -9, y: 0, z: -9, rot: 0, scale: 1 },
  ]));
  // Keep the selected doorway facing the arrival approach from the port.
  const fixture = freezeDeep(forbidRng({ ...map, dock: { ...map.dock, base: { x: 9, z: 9 } } }));
  try {
    withAssets({ texture: (id) => id === TOWN_ALBEDO_ID ? albedo : id === TOWN_NORMAL_ID ? normal : null }, () => {
      const out = createProps(fixture);
      try {
        const banner = out.group.getObjectByName('townHallBanner');
        assert.ok(banner && banner.isMesh);
        assert.equal(banner.castShadow, true); assert.equal(banner.receiveShadow, true);
        assert.deepEqual(banner.position.toArray(), [3, 0, 4]);
        assert.equal(banner.rotation.y, 0.25); assert.deepEqual(banner.scale.toArray(), [1.1, 1.1, 1.1]);
        assert.equal(banner.material.map.image.width, 256); assert.equal(banner.material.normalMap, null);
        assert.deepEqual(out.group.userData.townHall, { family: 'town-hall-v1',
          anchor: { x: 3, y: 0, z: 4, rot: 0.25, scale: 1.1 }, canvas: [256, 256], texturesDownloaded: 0 });
        const chunks = out.group.children.filter((child) => child.name === 'propsChunk');
        assert.ok(chunks.length > 0, 'the hut supports are merged into the existing chunk bucket');
      } finally { disposeProps(out); }
    });
  } finally { albedo.dispose(); normal.dispose(); }
}));

test('createProps omits town-hall output without mapped albedo and when the hut is imported', () => withCanvas(() => {
  const map = freezeDeep(townMap([{ kind: 'hut', x: 3, y: 0, z: 4, rot: 0, scale: 1 }]));
  assert.ok(selectTownHall(map), 'fixture would be decorated if native atlas paint were available');
  withAssets({ texture: () => null }, () => {
    const out = createProps(map);
    try {
      assert.equal(out.group.getObjectByName('townHallBanner'), undefined);
      assert.equal(out.group.userData.townHall, undefined);
    } finally { disposeProps(out); }
  });

  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const imported = new THREE.Group();
  try {
    withAssets({ texture: (id) => id === TOWN_ALBEDO_ID ? albedo : null,
      propId: (kind) => kind === 'hut' ? 'prop:hut-model' : null,
      instanced: () => imported }, () => {
      const out = createProps(map);
      try {
        assert.equal(out.group.getObjectByName('townHallBanner'), undefined);
        assert.equal(out.group.userData.townHall, undefined);
      } finally { disposeProps(out); }
    });
  } finally { albedo.dispose(); }
}));
