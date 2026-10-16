import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assets } from '../src/render/assets/registry.js';
import { RAFT_ATLAS_ID } from '../src/render/raftMaterials.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID, townPart, townMaterial } from '../src/render/townMaterials.js';
import { townCoverMaterial, townCoverNeutral, townCoverPart } from '../src/render/townCovers.js';
import { createProps } from '../src/render/props.js';

function sameAttribute(a, b, name) {
  assert.deepEqual(Array.from(a.getAttribute(name).array), Array.from(b.getAttribute(name).array), `${name} bytes match`);
}

test('townCoverPart preserves the ordinary bake and emits local thatch and cloth masks', () => {
  for (const source of [new THREE.BoxGeometry(2, 1, 3), new THREE.CylinderGeometry(0.7, 0.4, 2, 9)]) {
    for (const indexed of [true, false]) {
      const geometry = indexed ? source.clone() : source.toNonIndexed();
      const transform = { pos: [2, 3, -4], rot: [0.2, 0.5, -0.1], scale: [1.2, 0.8, 1.1] };
      const expected = townPart(geometry.clone(), 0x987654, transform, { mapped: false });
      const thatch = townCoverPart(geometry.clone(), 0x987654, transform, 'thatch');
      for (const name of ['position', 'normal', 'color']) sameAttribute(expected, thatch, name);
      assert.deepEqual(Array.from(expected.index?.array || []), Array.from(thatch.index?.array || []));
      const mask = thatch.getAttribute('aTownCover');
      assert.equal(mask.itemSize, 3);
      assert.equal(mask.count, thatch.getAttribute('position').count);
      let roofVertices = 0;
      for (let i = 0; i < mask.count; i++) {
        assert.ok(mask.getX(i) >= 0 && mask.getX(i) <= 4);
        assert.ok(mask.getY(i) >= 0 && mask.getY(i) <= 1);
        assert.equal(mask.getZ(i), 1); roofVertices++;
      }
      assert.equal(roofVertices, mask.count, 'thin roof ledges share the muted straw paint');

      const cloth = townCoverPart(geometry.clone(), 0x987654, transform, 'cloth');
      for (const name of ['position', 'normal', 'color']) sameAttribute(expected, cloth, name);
      const clothMask = cloth.getAttribute('aTownCover');
      assert.equal(clothMask.itemSize, 3);
      for (let i = 0; i < clothMask.count; i++) {
        assert.ok(clothMask.getX(i) >= 0 && clothMask.getX(i) <= 1);
        assert.ok(clothMask.getY(i) >= 0 && clothMask.getY(i) <= 1);
        assert.equal(clothMask.getZ(i), 2);
      }
      expected.dispose(); thatch.dispose(); cloth.dispose(); geometry.dispose();
    }
    source.dispose();
  }
});

test('townCoverNeutral adds one exact zero vec3 per vertex and preserves an existing mask', () => {
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  const count = geometry.getAttribute('position').count;
  assert.equal(townCoverNeutral(geometry), geometry);
  const neutral = geometry.getAttribute('aTownCover');
  assert.equal(neutral.itemSize, 3);
  assert.equal(neutral.count, count);
  assert.ok(Array.from(neutral.array).every((value) => value === 0));
  assert.equal(townCoverNeutral(geometry).getAttribute('aTownCover'), neutral);
  geometry.dispose();
});

test('townCoverMaterial keeps material assets and identity while separating cloth and native shader variants', () => {
  const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const cloth = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  let textureDisposals = 0;
  for (const texture of [albedo, normal, cloth]) texture.addEventListener('dispose', () => textureDisposals++);
  let material;
  try {
    const fallback = new THREE.MeshToonMaterial({ vertexColors: true });
    material = townMaterial(albedo, normal, fallback, { vertPars: '', vertBody: '', fragPars: '', albedo: '' });
    const beforeKey = material.customProgramCacheKey();
    assert.equal(townCoverMaterial(material, null), material);
    const nativeKey = material.customProgramCacheKey();
    assert.notEqual(nativeKey, beforeKey);
    assert.equal(material.map, albedo);
    assert.equal(material.normalMap, normal);
    assert.equal(material.normalScale.x, 0.18);
    assert.equal(material.normalScale.y, 0.18);
    assert.deepEqual(material.userData.townCovers, { family: 'town-covers-v1', clothAtlas: null });

    const withCloth = townMaterial(albedo, normal, fallback, { vertPars: '', vertBody: '', fragPars: '', albedo: '' });
    const clothKeyBefore = withCloth.customProgramCacheKey();
    townCoverMaterial(withCloth, cloth);
    assert.notEqual(withCloth.customProgramCacheKey(), clothKeyBefore);
    assert.notEqual(withCloth.customProgramCacheKey(), nativeKey);
    assert.equal(withCloth.map, albedo);
    assert.equal(withCloth.normalMap, normal);
    assert.equal(withCloth.normalScale.x, material.normalScale.x);
    assert.equal(withCloth.defines.MN_TOWN_CLOTH, 1);
    assert.deepEqual(withCloth.userData.townCovers, { family: 'town-covers-v1', clothAtlas: RAFT_ATLAS_ID });

    // Exercise the shader patch against Three.js include sites without requiring a WebGL context.
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <emissivemap_fragment>\n}',
    };
    withCloth.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /attribute vec3 aTownCover/);
    assert.match(shader.vertexShader, /vTownCover = aTownCover/);
    assert.match(shader.fragmentShader, /mnCoverLine/);
    assert.match(shader.fragmentShader, /vTownCover\.z > 1\.5/);
    assert.equal(shader.uniforms.mnTownCloth.value, cloth);
    withCloth.dispose();
    assert.equal(textureDisposals, 0, 'materials do not dispose shared registry textures');
  } finally {
    material?.dispose();
    albedo.dispose(); normal.dispose(); cloth.dispose();
  }
});

test('createProps keeps baked props stable, marks only covers, and does not read or mutate map state', () => {
  const townAlbedo = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const townNormal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const clothAtlas = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const prior = Object.getOwnPropertyDescriptor(assets, 'texture');
  const map = {
    props: [
      { kind: 'hut', x: 2, y: 0, z: 3, rot: 0.2, scale: 1 },
      { kind: 'stall', x: 4, y: 0, z: 5, rot: -0.4, scale: 1 },
      { kind: 'dockPost', x: 6, y: 0, z: 7, rot: 1.1, scale: 1 },
      { kind: 'crate', x: 8, y: 0, z: 9, rot: 0.8, scale: 1 },
    ],
    npcs: [],
    dock: { len: 4, halfWidth: 1, deckY: 0.8, base: { x: 0, z: 0 }, dir: { x: 0, z: 1 } },
    groundAt: () => 0,
    get rng() { throw new Error('rendering must not read simulation RNG'); },
  };
  const mapFields = () => JSON.stringify({ props: map.props, npcs: map.npcs, dock: map.dock });
  const baseline = mapFields();
  function build(atlases) {
    assets.texture = (id) => id === TOWN_ALBEDO_ID ? (atlases ? townAlbedo : null)
      : id === TOWN_NORMAL_ID ? (atlases ? townNormal : null)
        : id === RAFT_ATLAS_ID ? (atlases ? clothAtlas : null) : null;
    const out = createProps(map);
    const chunk = out.group.children.find((object) => object.name === 'propsChunk');
    assert.ok(chunk);
    return { out, chunk };
  }
  try {
    const native = build(false), mapped = build(true);
    for (const name of ['position', 'normal', 'color']) sameAttribute(native.chunk.geometry, mapped.chunk.geometry, name);
    assert.deepEqual(Array.from(native.chunk.geometry.index?.array || []), Array.from(mapped.chunk.geometry.index?.array || []));
    assert.deepEqual(native.chunk.matrix.toArray(), mapped.chunk.matrix.toArray());
    for (const chunk of [native.chunk, mapped.chunk]) {
      const cover = chunk.geometry.getAttribute('aTownCover');
      assert.equal(cover.itemSize, 3);
      const kinds = new Set();
      let neutralVertices = 0;
      for (let i = 0; i < cover.count; i++) {
        if (cover.getZ(i) > 0) kinds.add(cover.getZ(i));
        else if (cover.getX(i) === 0 && cover.getY(i) === 0) neutralVertices++;
      }
      assert.ok(kinds.has(1), 'hut thatch vertices are selected');
      assert.ok(kinds.has(2), 'stall canopy vertices are selected');
      assert.ok(neutralVertices > 0, 'wood and unrelated props retain neutral masks');
      assert.equal(chunk.userData.townCovers.family, 'town-covers-v1');
    }
    assert.equal(native.chunk.userData.townCovers.clothAtlas, null);
    assert.deepEqual(mapped.chunk.userData.townCovers, { family: 'town-covers-v1', clothAtlas: RAFT_ATLAS_ID });
    assert.equal(mapFields(), baseline, 'map inputs remain unchanged');

    // The optional tattoo stall joins the same merged chunk and receives neutral cover values.
    map.npcs.push({ id: 'tattoo', x: 20, y: 0, z: 20, facing: 0 });
    const npcMapBaseline = mapFields();
    const beforeNpc = native.chunk;
    const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, {
        get: (_target, name) => typeof name === 'string' ? (() => {}) : undefined,
        set: () => true,
      }) }),
    };
    let withNpc;
    try { withNpc = build(false).chunk; }
    finally {
      if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument);
      else delete globalThis.document;
    }
    const attr = withNpc.geometry.getAttribute('aTownCover');
    const baseCount = beforeNpc.geometry.getAttribute('position').count;
    assert.ok(attr.count > baseCount, 'tattoo NPC stall geometry joins the chunk');
    for (let i = baseCount; i < attr.count; i++) {
      assert.equal(attr.getX(i), 0); assert.equal(attr.getY(i), 0); assert.equal(attr.getZ(i), 0);
    }
    assert.equal(mapFields(), npcMapBaseline, 'map inputs remain unchanged when tattoo NPC props are merged');
    for (const built of [native, mapped, { chunk: beforeNpc }, { chunk: withNpc }]) {
      built.chunk.geometry.dispose(); built.chunk.material.dispose();
    }
  } finally {
    if (prior) Object.defineProperty(assets, 'texture', prior); else delete assets.texture;
    townAlbedo.dispose(); townNormal.dispose(); clothAtlas.dispose();
  }
});
