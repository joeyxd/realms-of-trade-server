import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeManifest, selectTextureSource } from '../src/render/assets/manifest.js';
import { LOOKS } from '../src/render/charlooks.js';
import { mapBones } from '../src/render/assets/bonemap.js';
import { readGlb, summarize } from '../tools/glb.mjs';

const root = resolve('.');
const file = (relative) => resolve(root, relative);
const bytes = async (relative) => readFile(file(relative));
const digest = (data) => createHash('sha256').update(data).digest('hex');
const evidence = JSON.parse(await readFile(file('docs/art/buccaneer-v1/asset-evidence.json'), 'utf8'));
const sourceGlbPath = 'docs/art/source/buccaneer-v1/male anime+character+3d+model.glb';
const sourcePortraitPath = 'docs/art/source/buccaneer-v1/pirate_avatar_alpha.png';
const desktopGlbPath = 'assets/models/buccaneer-v1-desktop.glb';
const mobileGlbPath = 'assets/models/buccaneer-v1-mobile.glb';
const desktopPortraitPath = 'assets/ui/portraits/buccaneer-v1-desktop.webp';
const mobilePortraitPath = 'assets/ui/portraits/buccaneer-v1-mobile.webp';

function imageBytes(glb, imageIndex) {
  const image = glb.json.images[imageIndex];
  assert.ok(image && Number.isInteger(image.bufferView), 'image must be embedded in a GLB bufferView');
  const view = glb.json.bufferViews[image.bufferView];
  const start = view.byteOffset || 0;
  return glb.bin.subarray(start, start + view.byteLength);
}

function baseColorBytes(glb) {
  const material = glb.json.materials?.[0];
  const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  assert.ok(Number.isInteger(textureIndex), 'GLB material must bind an albedo texture');
  const imageIndex = glb.json.textures?.[textureIndex]?.source;
  assert.ok(Number.isInteger(imageIndex), 'albedo texture must reference an image');
  return imageBytes(glb, imageIndex);
}

function jpegDimensions(data) {
  assert.equal(data.readUInt16BE(0), 0xffd8, 'embedded albedo must be a JPEG');
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) { offset++; continue; }
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    assert.ok(offset + 2 <= data.length, 'truncated JPEG segment');
    const length = data.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= data.length, 'invalid JPEG segment length');
    if (frameMarkers.has(marker)) {
      assert.ok(length >= 7, 'truncated JPEG frame header');
      return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error('JPEG has no supported frame header');
}

function webpDimensions(data) {
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.toString('ascii', 8, 12), 'WEBP');
  assert.equal(data.toString('ascii', 12, 16), 'VP8L', 'portrait derivative must use lossless WebP');
  assert.equal(data[20], 0x2f, 'invalid VP8L signature');
  return {
    width: 1 + data[21] + ((data[22] & 0x3f) << 8),
    height: 1 + ((data[22] >> 6) | (data[23] << 2) | ((data[24] & 0x0f) << 10)),
  };
}

function viewPayload(glb, viewIndex) {
  const view = glb.json.bufferViews[viewIndex];
  assert.ok(view, `missing bufferView ${viewIndex}`);
  const start = view.byteOffset || 0;
  return glb.bin.subarray(start, start + view.byteLength);
}

function assertAccessorPreserved(source, sourceIndex, derived, derivedIndex, label) {
  const before = source.json.accessors[sourceIndex], after = derived.json.accessors[derivedIndex];
  assert.ok(before && after, `${label}: missing accessor`);
  for (const key of ['count', 'type', 'componentType', 'normalized', 'byteOffset', 'min', 'max']) {
    assert.deepEqual(after[key], before[key], `${label}: accessor ${key} changed`);
  }
  assert.equal(after.bufferView !== undefined, before.bufferView !== undefined, `${label}: accessor view presence changed`);
  if (before.bufferView !== undefined) {
    assert.deepEqual(viewPayload(derived, after.bufferView), viewPayload(source, before.bufferView), `${label}: accessor bytes changed`);
    const beforeView = source.json.bufferViews[before.bufferView], afterView = derived.json.bufferViews[after.bufferView];
    assert.equal(afterView.byteStride, beforeView.byteStride, `${label}: buffer stride changed`);
    assert.equal(afterView.target, beforeView.target, `${label}: buffer target changed`);
  }
  assert.deepEqual(after.sparse, before.sparse, `${label}: sparse accessor changed`);
}

function assertGeometryAndSkinPreserved(source, derived, label) {
  assert.deepEqual(derived.json.nodes, source.json.nodes, `${label}: node hierarchy/transforms changed`);
  assert.equal(derived.json.meshes?.length, source.json.meshes?.length, `${label}: mesh count changed`);
  for (let meshIndex = 0; meshIndex < source.json.meshes.length; meshIndex++) {
    const before = source.json.meshes[meshIndex], after = derived.json.meshes[meshIndex];
    assert.equal(after.primitives.length, before.primitives.length, `${label}: primitive count changed`);
    for (let primitiveIndex = 0; primitiveIndex < before.primitives.length; primitiveIndex++) {
      const oldPrimitive = before.primitives[primitiveIndex], newPrimitive = after.primitives[primitiveIndex];
      assert.deepEqual(Object.keys(newPrimitive.attributes).sort(), Object.keys(oldPrimitive.attributes).sort(), `${label}: vertex semantics changed`);
      for (const [semantic, oldAccessor] of Object.entries(oldPrimitive.attributes)) {
        assertAccessorPreserved(source, oldAccessor, derived, newPrimitive.attributes[semantic], `${label}: ${semantic}`);
      }
      assert.equal(newPrimitive.indices !== undefined, oldPrimitive.indices !== undefined, `${label}: index accessor presence changed`);
      if (oldPrimitive.indices !== undefined) assertAccessorPreserved(source, oldPrimitive.indices, derived, newPrimitive.indices, `${label}: indices`);
    }
  }
  assert.deepEqual(derived.json.skins?.map(({ name, joints, skeleton }) => ({ name, joints, skeleton })),
    source.json.skins?.map(({ name, joints, skeleton }) => ({ name, joints, skeleton })), `${label}: skin/joint binding changed`);
  for (let skinIndex = 0; skinIndex < source.json.skins.length; skinIndex++) {
    const before = source.json.skins[skinIndex], after = derived.json.skins[skinIndex];
    assert.equal(after.inverseBindMatrices !== undefined, before.inverseBindMatrices !== undefined, `${label}: inverse-bind presence changed`);
    if (before.inverseBindMatrices !== undefined) {
      assertAccessorPreserved(source, before.inverseBindMatrices, derived, after.inverseBindMatrices, `${label}: inverse-bind matrices`);
    }
  }
}

test('Bucanero manifest binds only look 2 and selects one desktop/mobile character and portrait variant', async () => {
  assert.equal(LOOKS[2]?.name, 'Bucanero');
  const raw = JSON.parse(await readFile(file('assets/manifest.json'), 'utf8'));
  const manifest = normalizeManifest(raw, { looks: LOOKS.map((look) => look.name) });
  assert.deepEqual(manifest.errors, []);

  const character = manifest.entries.get('char:buccaneer-v1');
  assert.ok(character);
  assert.deepEqual(character.looks, ['Bucanero']);
  assert.equal(manifest.byLook.get(LOOKS[2].name), character.id);
  assert.equal(manifest.byLook.size, 1);
  assert.equal(character.src, 'models/buccaneer-v1-desktop.glb');
  assert.equal(selectTextureSource(character, false), desktopGlbPath.slice('assets/'.length));
  assert.equal(character.mobileSrc, 'models/buccaneer-v1-mobile.glb');
  assert.equal(selectTextureSource(character, true), mobileGlbPath.slice('assets/'.length));

  const portrait = manifest.entries.get('tex:portrait-buccaneer-v1');
  assert.ok(portrait);
  assert.equal(LOOKS[2].portraitTexture, portrait.id);
  assert.equal(selectTextureSource(portrait, false), 'ui/portraits/buccaneer-v1-desktop.webp');
  assert.equal(selectTextureSource(portrait, true), 'ui/portraits/buccaneer-v1-mobile.webp');

  for (const [path, expected] of [[desktopGlbPath, [1024, 1024]], [mobileGlbPath, [512, 512]]]) {
    const glb = readGlb(await bytes(path));
    const { width, height } = jpegDimensions(baseColorBytes(glb));
    assert.deepEqual([width, height], expected, `${path}: wrong embedded albedo resolution`);
  }
  for (const [path, expected] of [[desktopPortraitPath, [512, 512]], [mobilePortraitPath, [256, 256]]]) {
    const image = await bytes(path);
    const { width, height } = webpDimensions(image);
    assert.deepEqual([width, height], expected, `${path}: wrong portrait resolution`);
  }
});

test('source and both runtime GLBs retain the 9,164-triangle Mixamo skin without source clips or unused PBR maps', async () => {
  const source = readGlb(await bytes(sourceGlbPath));
  const sourceSummary = summarize(source);
  assert.equal(sourceSummary.tris, 9164);
  assert.equal(sourceSummary.skins.length, 1);
  assert.equal(sourceSummary.skins[0].joints.length, 65);
  assert.deepEqual(sourceSummary.animations, ['swim', 'run', 'hit_to_body_01', 'idle']);
  const mapping = mapBones(sourceSummary.skins[0].joints, sourceSummary.skins[0].parents);
  assert.deepEqual(mapping.missing, []);

  for (const path of [desktopGlbPath, mobileGlbPath]) {
    const glb = readGlb(await bytes(path));
    const summary = summarize(glb);
    assert.equal(summary.tris, 9164, `${path}: triangle count changed`);
    assert.equal(summary.skins.length, 1, `${path}: skin count changed`);
    assert.equal(summary.skins[0].joints.length, 65, `${path}: joint count changed`);
    assert.deepEqual(mapBones(summary.skins[0].joints, summary.skins[0].parents).missing, [], `${path}: Mixamo bone map incomplete`);
    assert.deepEqual(summary.animations, [], `${path}: runtime GLB retained source animation clips`);
    for (const material of glb.json.materials || []) {
      assert.equal(material.normalTexture, undefined, `${path}: runtime material retained normal map`);
      assert.equal(material.pbrMetallicRoughness?.metallicRoughnessTexture, undefined, `${path}: runtime material retained metallic/roughness map`);
    }
    assertGeometryAndSkinPreserved(source, glb, path);
  }
});

test('preserved originals and generated runtime files match their SHA-256 evidence', async () => {
  const entries = [
    ...Object.entries(evidence.originals),
    ...Object.entries(evidence.derived),
  ];
  for (const [path, record] of entries) {
    const data = await bytes(path);
    assert.equal(data.byteLength, record.bytes, `${path}: byte length differs from evidence`);
    assert.equal(digest(data), record.sha256, `${path}: SHA-256 differs from evidence`);
  }

  const portraitPng = await bytes(sourcePortraitPath);
  assert.equal(portraitPng.toString('hex', 0, 8), '89504e470d0a1a0a', 'preserved portrait must be a PNG');
  assert.deepEqual([portraitPng.readUInt32BE(16), portraitPng.readUInt32BE(20)], [1600, 1600]);
});
