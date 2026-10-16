import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RaftLayer } from '../src/render/rafts.js';
import { assets } from '../src/render/assets/registry.js';
import { RAFT_ATLAS_ID, RAFT_ATLAS_RECTS, surface } from '../src/render/raftMaterials.js';
import { createNavalRaftSkin, loadNavalRaftSkin, mapWoodBoardUV, WOOD_BOARD_RECTS } from '../tools/naval-lab/raft-skin.js';

const EPS = 1e-6;

function makeTexture(source, width = 2048, height = 2048) {
  const texture = new THREE.Texture();
  texture.image = { width, height };
  texture.userData.source = source;
  return texture;
}

function uvBounds(geometry) {
  const uv = geometry.getAttribute('uv');
  const bounds = { u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity };
  for (let i = 0; i < uv.count; i++) {
    bounds.u0 = Math.min(bounds.u0, uv.getX(i)); bounds.u1 = Math.max(bounds.u1, uv.getX(i));
    bounds.v0 = Math.min(bounds.v0, uv.getY(i)); bounds.v1 = Math.max(bounds.v1, uv.getY(i));
  }
  return bounds;
}

function assertInsideRect(geometry, rect) {
  const bounds = uvBounds(geometry);
  assert.ok(bounds.u0 >= rect.u0 - EPS && bounds.u1 <= rect.u1 + EPS, 'U escaped its board swatch');
  assert.ok(bounds.v0 >= rect.v0 - EPS && bounds.v1 <= rect.v1 + EPS, 'V escaped its board swatch');
}

function assertRectDifferent(a, b) {
  assert.ok(Math.abs(a.u0 - b.u0) > EPS || Math.abs(a.v0 - b.v0) > EPS ||
    Math.abs(a.u1 - b.u1) > EPS || Math.abs(a.v1 - b.v1) > EPS);
}

test('wood UV mapping selects bounded board variants and preserves box and cylinder orientation', () => {
  assert.equal(WOOD_BOARD_RECTS.length, 4);
  for (let i = 1; i < WOOD_BOARD_RECTS.length; i++) assertRectDifferent(WOOD_BOARD_RECTS[i - 1], WOOD_BOARD_RECTS[i]);

  for (let variant = 0; variant < WOOD_BOARD_RECTS.length; variant++) {
    const box = new THREE.BoxGeometry(2, 1, 3);
    assert.equal(mapWoodBoardUV(box, 'wood', { grain: 'box', variant }), true);
    assertInsideRect(box, WOOD_BOARD_RECTS[variant]);
    box.dispose();
  }

  const normalVariant = new THREE.BoxGeometry(2, 1, 3);
  const wrapVariant = new THREE.BoxGeometry(2, 1, 3);
  const lastVariant = new THREE.BoxGeometry(2, 1, 3);
  assert.equal(mapWoodBoardUV(normalVariant, 'wood', { grain: 'box', variant: 0 }), true);
  assert.equal(mapWoodBoardUV(wrapVariant, 'wood', { grain: 'box', variant: 4 }), true);
  assert.equal(mapWoodBoardUV(lastVariant, 'wood', { grain: 'box', variant: -1 }), true);
  assert.deepEqual([...wrapVariant.attributes.uv.array], [...normalVariant.attributes.uv.array], 'variant 4 wraps to the first board');
  assertInsideRect(lastVariant, WOOD_BOARD_RECTS[3]);

  const top = [];
  const pos = normalVariant.getAttribute('position'), uv = normalVariant.getAttribute('uv');
  const normals = normalVariant.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - 0.5) < EPS && normals.getY(i) > 0.999) {
    top.push({ x: pos.getX(i), z: pos.getZ(i), u: uv.getX(i), v: uv.getY(i) });
  }
  const sameX = top.flatMap((a, i) => top.slice(i + 1).filter((b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) > 1).map((b) => [a, b]))[0];
  const sameZ = top.flatMap((a, i) => top.slice(i + 1).filter((b) => Math.abs(a.z - b.z) < EPS && Math.abs(a.x - b.x) > 1).map((b) => [a, b]))[0];
  assert.ok(sameX && sameZ, 'box top face should expose both board axes');
  assert.ok(Math.abs(sameX[0].u - sameX[1].u) > EPS, 'the longer local Z axis runs along texture U');
  assert.ok(Math.abs(sameX[0].v - sameX[1].v) < EPS);
  assert.ok(Math.abs(sameZ[0].v - sameZ[1].v) > EPS, 'local X maps across texture V');
  assert.ok(Math.abs(sameZ[0].u - sameZ[1].u) < EPS);

  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
  const raw = cylinder.getAttribute('uv').array.slice();
  const sideNormal = cylinder.getAttribute('normal');
  const variant = 2, rect = WOOD_BOARD_RECTS[variant];
  assert.equal(mapWoodBoardUV(cylinder, 'wood', { grain: 'cylinder', variant }), true);
  assertInsideRect(cylinder, rect);
  let sideChecked = false, capChecked = false;
  for (let i = 0; i < sideNormal.count; i++) {
    const beforeU = raw[i * 2], beforeV = raw[i * 2 + 1];
    const actualU = cylinder.attributes.uv.getX(i), actualV = cylinder.attributes.uv.getY(i);
    if (Math.abs(sideNormal.getY(i)) < 0.999) {
      assert.ok(Math.abs(actualU - (rect.u0 + beforeV * (rect.u1 - rect.u0))) < EPS);
      assert.ok(Math.abs(actualV - (rect.v0 + beforeU * (rect.v1 - rect.v0))) < EPS);
      sideChecked = true;
    } else {
      assert.ok(Math.abs(actualU - (rect.u0 + beforeU * (rect.u1 - rect.u0))) < EPS);
      assert.ok(Math.abs(actualV - (rect.v0 + beforeV * (rect.v1 - rect.v0))) < EPS);
      capChecked = true;
    }
  }
  assert.ok(sideChecked && capChecked, 'cylinder sides rotate their UV axes while caps retain theirs');

  const wrongKind = new THREE.BoxGeometry(1, 1, 1), originalUvs = [...wrongKind.attributes.uv.array];
  assert.equal(mapWoodBoardUV(wrongKind, 'rope', { variant: 1 }), false);
  assert.deepEqual([...wrongKind.attributes.uv.array], originalUvs);
  for (const geometry of [normalVariant, wrapVariant, lastVariant, cylinder, wrongKind]) geometry.dispose();
});

test('skin configures albedo and normal data separately and degrades safely when either map is missing', () => {
  const albedo = makeTexture('/raft/albedo.webp');
  const normal = makeTexture('/raft/normal.webp');
  const profile = createNavalRaftSkin({ albedo, normal });
  const wood = profile.material(surface('wood', 0xb5803f));
  assert.ok(wood);
  assert.strictEqual(wood.map, albedo);
  assert.strictEqual(wood.normalMap, normal);
  assert.equal(albedo.colorSpace, THREE.SRGBColorSpace);
  assert.equal(normal.colorSpace, THREE.NoColorSpace);
  assert.equal(albedo.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(normal.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(albedo.anisotropy, 4);
  assert.equal(normal.anisotropy, 4);
  assert.equal(wood.normalScale.x, 0.28);
  assert.equal(wood.normalScale.y, 0.28);

  profile.setRelief('flat');
  assert.equal(wood.normalMap, null);
  profile.setRelief('soft');
  assert.strictEqual(wood.normalMap, normal);
  assert.equal(wood.normalScale.y, 0.28);
  profile.setRelief('flipped');
  assert.strictEqual(wood.normalMap, normal);
  assert.equal(wood.normalScale.y, -0.28);
  assert.throws(() => profile.setRelief('unknown'), /Unknown raft relief mode/);
  profile.dispose();

  const onlyAlbedo = createNavalRaftSkin({ albedo: makeTexture('/raft/albedo-only.webp') });
  const flatWood = onlyAlbedo.material(surface('wood', 0xb5803f));
  const onlyAlbedoGeometry = new THREE.BoxGeometry(1, 1, 1);
  assert.equal(onlyAlbedo.mapUV(onlyAlbedoGeometry, 'wood', { grain: 'box', variant: 1 }), true);
  assert.equal(flatWood.normalMap, null);
  onlyAlbedo.setRelief('flipped');
  assert.equal(onlyAlbedo.diagnostics().relief, 'flat');
  assert.equal(flatWood.normalMap, null);
  onlyAlbedoGeometry.dispose();
  onlyAlbedo.dispose();

  const onlyNormal = createNavalRaftSkin({ normal: makeTexture('/raft/normal-only.webp') });
  const sample = new THREE.BoxGeometry(1, 1, 1), before = [...sample.attributes.uv.array];
  assert.equal(onlyNormal.mapUV(sample, 'wood', { grain: 'box', variant: 0 }), false);
  assert.deepEqual([...sample.attributes.uv.array], before, 'missing albedo leaves UVs available to the shared-atlas fallback');
  assert.equal(onlyNormal.material(surface('wood', 0xb5803f)), null);
  onlyNormal.dispose();
  sample.dispose();
});

test('mobile loader requests only its mobile albedo and keeps relief flat', async () => {
  const requested = [];
  const texture = makeTexture('mobile-albedo', 512, 512);
  const skin = await loadNavalRaftSkin({ mobile: true, loadTexture: async (url) => { requested.push(url); return texture; } });
  assert.deepEqual(requested, ['/assets/textures/raft/wood-boards-v2-mobile.webp']);
  assert.equal(skin.diagnostics().mobile, true);
  assert.deepEqual(skin.diagnostics().normal, null);
  assert.equal(skin.diagnostics().relief, 'flat');
  const material = skin.material(surface('wood', 0xb5803f));
  assert.strictEqual(material.map, texture);
  assert.equal(material.normalMap, null);
  skin.setRelief('soft');
  assert.equal(skin.diagnostics().relief, 'flat');
  skin.dispose();

  const desktopCalls = [];
  const desktopAlbedo = makeTexture('desktop-albedo');
  const missingNormal = await loadNavalRaftSkin({ mobile: false, loadTexture: async (url) => {
    desktopCalls.push(url);
    if (url.includes('-normal.')) throw new Error('normal unavailable');
    return desktopAlbedo;
  } });
  assert.deepEqual(desktopCalls, [
    '/assets/textures/raft/wood-boards-v2.webp',
    '/assets/textures/raft/wood-boards-v2-normal.webp',
  ]);
  assert.equal(missingNormal.diagnostics().relief, 'flat');
  assert.equal(missingNormal.diagnostics().normal, null);
  assert.equal(missingNormal.material(surface('wood', 0xb5803f)).normalMap, null);
  missingNormal.dispose();
});

test('RaftLayer caches local wood and cloth overrides without changing registry atlas or fallback surfaces', () => {
  const atlas = makeTexture('shared-registry-atlas', 1024, 1024);
  const atlasBefore = {
    image: atlas.image, colorSpace: atlas.colorSpace, wrapS: atlas.wrapS, wrapT: atlas.wrapT,
    repeat: atlas.repeat.clone(), anisotropy: atlas.anisotropy, minFilter: atlas.minFilter,
    magFilter: atlas.magFilter, userData: { ...atlas.userData },
  };
  const albedo = makeTexture('lab-albedo');
  const normal = makeTexture('lab-normal');
  let albedoDisposals = 0, normalDisposals = 0;
  albedo.addEventListener('dispose', () => albedoDisposals++);
  normal.addEventListener('dispose', () => normalDisposals++);
  const textureMethod = Object.getOwnPropertyDescriptor(assets, 'texture');
  const oldTexture = assets.texture;
  const restoreTexture = () => {
    if (textureMethod) Object.defineProperty(assets, 'texture', textureMethod);
    else delete assets.texture;
  };
  const atlasTexture = function (id) { return id === RAFT_ATLAS_ID ? atlas : oldTexture.call(this, id); };
  Object.defineProperty(assets, 'texture', { configurable: true, writable: true, value: atlasTexture });

  const baseLayer = new RaftLayer(new THREE.Scene());
  const skin = createNavalRaftSkin({ albedo, normal });
  const labLayer = new RaftLayer(new THREE.Scene(), { surfaceSkin: skin });
  try {
    const wood = surface('wood', 0xb5803f);
    const baseWood = baseLayer.material(wood), labWood = labLayer.material(wood);
    assert.strictEqual(baseWood, baseLayer.material(wood), 'base materials remain cached by layer');
    assert.strictEqual(labWood, labLayer.material(wood), 'local override is cached by layer');
    assert.notStrictEqual(baseWood, labWood);
    assert.strictEqual(baseWood.map, atlas);
    assert.strictEqual(labWood.map, albedo);
    assert.strictEqual(labWood.normalMap, normal);
    assert.ok(labWood.customProgramCacheKey().includes('naval-author-boards-v2'));

    const cloth = surface('cloth', 0xe8d39d);
    const baseCloth = baseLayer.material(cloth), labCloth = labLayer.material(cloth);
    assert.strictEqual(baseCloth.map, atlas);
    assert.strictEqual(labCloth.map, atlas);
    assert.ok(labCloth.customProgramCacheKey().includes('naval-weathered-cloth-v2'));
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <gradientmap_pars_fragment>\n#include <clipping_planes_fragment>\n#include <dithering_fragment>' };
    labCloth.onBeforeCompile(shader);
    assert.match(shader.fragmentShader, /mnClothGrey/);

    for (const spec of [surface('rope', 0xc69b51), surface('iron', 0x626b72)]) {
      const base = baseLayer.material(spec), local = labLayer.material(spec);
      assert.strictEqual(local.map, atlas, `${spec.kind} retains shared atlas mapping`);
      assert.ok(local.customProgramCacheKey().includes('public-raft-comic-v1'));
      assert.notStrictEqual(local, base);
    }

    const source = new THREE.BoxGeometry(2, 1, 3), sourceUV = [...source.attributes.uv.array];
    const labClone = source.clone(), baseClone = source.clone();
    assert.equal(labLayer.mapSurfaceUV(labClone, 'wood', { grain: 'box', variant: 2 }), true);
    assert.equal(baseLayer.mapSurfaceUV(baseClone, 'wood', { grain: 'box', variant: 2 }), true);
    assertInsideRect(labClone, WOOD_BOARD_RECTS[2]);
    assertInsideRect(baseClone, RAFT_ATLAS_RECTS.wood);
    assert.deepEqual([...source.attributes.uv.array], sourceUV, 'mapping changes only the cloned lab geometry');
    source.dispose(); labClone.dispose(); baseClone.dispose();

    assert.equal(skin.diagnostics().woodMaterials, 1);
    assert.deepEqual(atlasBefore, {
      image: atlas.image, colorSpace: atlas.colorSpace, wrapS: atlas.wrapS, wrapT: atlas.wrapT,
      repeat: atlas.repeat.clone(), anisotropy: atlas.anisotropy, minFilter: atlas.minFilter,
      magFilter: atlas.magFilter, userData: { ...atlas.userData },
    });
    assert.equal(albedo.colorSpace, THREE.SRGBColorSpace);
    assert.equal(normal.colorSpace, THREE.NoColorSpace);
  } finally {
    baseLayer.dispose();
    labLayer.dispose();
    assert.equal(skin.diagnostics().woodMaterials, 0, 'disposing the layer releases its cached override material');
    assert.equal(albedoDisposals, 0, 'layer does not own local texture sources');
    assert.equal(normalDisposals, 0, 'layer does not own local texture sources');
    skin.dispose();
    assert.equal(albedoDisposals, 1);
    assert.equal(normalDisposals, 1);
    restoreTexture();
    atlas.dispose();
  }
});
