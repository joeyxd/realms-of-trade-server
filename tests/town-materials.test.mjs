import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assets } from '../src/render/assets/registry.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID, TOWN_TILES, TOWN_NORMAL_STRENGTH, townMaterial, townNeutral, townPart, townRect } from '../src/render/townMaterials.js';
import { createProps } from '../src/render/props.js';

function sameAttribute(a, b, name) {
  assert.deepEqual(Array.from(a.getAttribute(name).array), Array.from(b.getAttribute(name).array), `${name} bytes match`);
}

test('townPart keeps baked geometry identical while adding finite atlas UVs and masks', () => {
  for (const source of [new THREE.BoxGeometry(2, 1, 3), new THREE.CylinderGeometry(0.7, 0.4, 2, 9)]) {
    for (const indexed of [false, true]) {
      const geometry = indexed ? source.clone() : source.toNonIndexed();
      const options = { pos: [2, 3, -4], rot: [0.2, 0.5, -0.1], scale: [1.2, 0.8, 1.1] };
      const fallback = townPart(geometry.clone(), 0x987654, options, { mapped: false });
      for (const role of TOWN_TILES) {
        for (const crop of [[0, 0, 1, 1], [0.2, 0.1, 0.75, 0.9]]) {
          const mapped = townPart(geometry.clone(), 0x987654, options, { mapped: true, role, crop, longU: true });
          for (const name of ['position', 'normal', 'color']) sameAttribute(fallback, mapped, name);
          assert.deepEqual(Array.from(fallback.index?.array || []), Array.from(mapped.index?.array || []));
          assert.equal(mapped.getAttribute('uv').count, mapped.getAttribute('position').count);
          const rect = townRect(role), uv = mapped.getAttribute('uv'), mask = mapped.getAttribute('aTownWood');
          for (let i = 0; i < uv.count; i++) {
            assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)));
            assert.ok(uv.getX(i) >= rect.u0 - 1e-6 && uv.getX(i) <= rect.u1 + 1e-6);
            assert.ok(uv.getY(i) >= rect.v0 - 1e-6 && uv.getY(i) <= rect.v1 + 1e-6);
            assert.equal(mask.getX(i), 1);
          }
          mapped.dispose();
        }
      }
      fallback.dispose(); geometry.dispose();
    }
    source.dispose();
  }
});

test('townNeutral gives mapped and legacy surfaces matching merge attributes', () => {
  const g = new THREE.BoxGeometry(1, 2, 3);
  g.deleteAttribute('uv');
  const neutral = townNeutral(g);
  assert.equal(neutral, g);
  assert.equal(g.getAttribute('uv').count, g.getAttribute('position').count);
  assert.equal(g.getAttribute('aTownWood').count, g.getAttribute('position').count);
  assert.ok(Array.from(g.getAttribute('aTownWood').array).every((v) => v === 0));
  assert.ok(Array.from(g.getAttribute('uv').array).every((v, i) => v === (i % 2 ? 0.125 : 0.875)));
  g.dispose();
});

test('townMaterial falls back without albedo and supports shared albedo without normal', () => {
  const fallback = new THREE.MeshBasicMaterial();
  assert.equal(townMaterial(null, null, fallback, {}), fallback);
  const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  let textureDisposals = 0;
  albedo.addEventListener('dispose', () => textureDisposals++);
  normal.addEventListener('dispose', () => textureDisposals++);
  let mat;
  try {
    mat = townMaterial(albedo, null, fallback, { vertPars: '', vertBody: '', fragPars: '', albedo: '' });
    assert.equal(mat.map, albedo);
    assert.equal(mat.normalMap, null);
    assert.equal(mat.userData.townWood.normal, null);
    mat.dispose(); mat = townMaterial(albedo, normal, fallback, { vertPars: '', vertBody: '', fragPars: '', albedo: '' });
    assert.equal(mat.map, albedo);
    assert.equal(mat.normalMap, normal);
    assert.equal(mat.normalScale.x, TOWN_NORMAL_STRENGTH);
    assert.equal(mat.normalScale.y, TOWN_NORMAL_STRENGTH);
    assert.equal(mat.userData.townWood.albedo, TOWN_ALBEDO_ID);
    assert.equal(mat.userData.townWood.normal, TOWN_NORMAL_ID);
    mat.dispose(); mat = null;
    // Materials do not own registry textures.
    assert.equal(textureDisposals, 0);
    assert.equal(albedo.image.data.length, 4);
    assert.equal(normal.image.data.length, 4);
  } finally { mat?.dispose(); albedo.dispose(); normal.dispose(); }
});

test('createProps preserves legacy and town prop geometry across atlas availability', () => {
  const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const prior = Object.getOwnPropertyDescriptor(assets, 'texture');
  const map = {
    props: [
      { kind: 'hut', x: 2, y: 0, z: 3, rot: 0.2, scale: 1 },
      { kind: 'stall', x: 4, y: 0, z: 5, rot: -0.4, scale: 1 },
      { kind: 'dockPost', x: 6, y: 0, z: 7, rot: 1.1, scale: 1 },
      { kind: 'crate', x: 8, y: 0, z: 9, rot: 0.8, scale: 1 },
    ], npcs: [], dock: { len: 4, halfWidth: 1, deckY: 0.8, base: { x: 0, z: 0 }, dir: { x: 0, z: 1 } },
    groundAt: () => 0,
    get rng() { throw new Error('rendering must not read simulation RNG'); },
  };
  const mapFields = () => JSON.stringify({ props: map.props, npcs: map.npcs, dock: map.dock });
  const baselineMap = mapFields();
  function build(atlasEnabled) {
    assets.texture = (id) => id === TOWN_ALBEDO_ID ? (atlasEnabled ? albedo : null) : id === TOWN_NORMAL_ID ? normal : null;
    const out = createProps(map), chunk = out.group.children.find((o) => o.name === 'propsChunk');
    assert.ok(chunk);
    return { out, chunk };
  }
  try {
    const off = build(false), on = build(true);
    for (const name of ['position', 'normal', 'color']) sameAttribute(off.chunk.geometry, on.chunk.geometry, name);
    assert.deepEqual(Array.from(off.chunk.geometry.index?.array || []), Array.from(on.chunk.geometry.index?.array || []));
    assert.deepEqual(off.chunk.matrix.toArray(), on.chunk.matrix.toArray());
    assert.deepEqual(off.chunk.userData.townWood, { mapped: false, normal: false, family: 'town-wood-v1' });
    assert.deepEqual(on.chunk.userData.townWood, { mapped: true, normal: true, family: 'town-wood-v1' });
    assert.equal(on.chunk.material.map, albedo);
    assert.equal(on.chunk.material.normalMap, normal);
    const uv = on.chunk.geometry.getAttribute('uv');
    const tiles = new Set();
    for (let i = 0; i < uv.count; i++) {
      const x = Math.min(3, Math.floor(uv.getX(i) * 4));
      const y = Math.min(2, Math.floor((1 - uv.getY(i)) * 4));
      tiles.add(TOWN_TILES[y * 4 + x]);
    }
    for (const role of ['planks', 'patched', 'floor', 'beam', 'timber', 'iron', 'corner', 'door', 'window']) {
      assert.ok(tiles.has(role), `town props use atlas role ${role}`);
    }
    assert.equal(mapFields(), baselineMap, 'map fields stay unchanged');
    // Two builds share registry textures; disposing prop materials leaves those textures live.
    off.chunk.material.dispose(); on.chunk.material.dispose();
    assert.equal(albedo.image.data.length, 4); assert.equal(normal.image.data.length, 4);
    off.chunk.geometry.dispose(); on.chunk.geometry.dispose();
  } finally {
    if (prior) Object.defineProperty(assets, 'texture', prior); else delete assets.texture;
    albedo.dispose(); normal.dispose();
  }
});
