import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { readGlb, summarize } from '../tools/glb.mjs';
import { SHRUB_IDS, SHRUB_STYLES, shrubGeometry, loadedShrubGeometry } from '../src/render/shrubGeometry.js';
import { SHRUB_LIMIT, shrubSite, buildShrubs } from '../src/render/shrubPlacement.js';
import { SHRUB_TEXTURE_IDS, shrubMaterials } from '../src/render/shrubMaterials.js';
import { U } from '../src/render/toon.js';

const EPS = 1e-6;

function assertGeometry(geo, label) {
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), c = geo.getAttribute('color');
  const uv = geo.getAttribute('uv'), flex = geo.getAttribute('aFlex'), paint = geo.getAttribute('aPaint');
  assert.ok(p?.count >= 3, `${label} has vertices`);
  for (const [attr, name, size] of [[n, 'normal', 3], [c, 'color', 3], [uv, 'UV', 2], [flex, 'flex', 1], [paint, 'paint', 2]]) {
    assert.equal(attr?.count, p.count, `${label} has one ${name} per vertex`);
    assert.equal(attr.itemSize, size, `${label} ${name} width is valid`);
  }
  for (let i = 0; i < p.count; i++) {
    for (const [attr, name] of [[p, 'position'], [n, 'normal'], [c, 'color'], [uv, 'UV'], [flex, 'flex'], [paint, 'paint']])
      for (let k = 0; k < attr.itemSize; k++) assert.ok(Number.isFinite(attr.getComponent(i, k)), `${label} ${name} ${i}:${k} is finite`);
    assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-4, `${label} normals are unit length`);
    for (let k = 0; k < 3; k++) assert.ok(c.getComponent(i, k) >= 0 && c.getComponent(i, k) <= 1, `${label} colors are normalized`);
    assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1, `${label} UV stays in atlas`);
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  assert.ok([...geo.boundingBox.min.toArray(), ...geo.boundingBox.max.toArray(), geo.boundingSphere.radius].every(Number.isFinite));
  if (geo.index) {
    const index = geo.index;
    for (let i = 0; i < index.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, index.getX(i));
      const b = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 1));
      const c = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 2));
      assert.ok(new THREE.Triangle(a, b, c).getArea() > EPS, `${label} has no degenerate triangles`);
    }
  }
  return geo;
}

function mapFixture(patch = {}) {
  const map = {
    seed: 71, half: 60, props: [], heightAt: () => 1, materialAt: () => 'grass',
    masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }), onDock: () => false,
    landmarks: {}, npcs: [], racks: [], enemySpawns: [], ...patch,
  };
  Object.defineProperty(map, 'rng', { get() { throw new Error('cosmetic shrub placement must not consume world RNG'); } });
  return map;
}

test('three procedural shrubs keep geometry, UVs, flex, and atlas holes valid in both modes', () => {
  assert.deepEqual(SHRUB_STYLES, ['round', 'low', 'tall']);
  assert.equal(SHRUB_IDS.length, SHRUB_STYLES.length);
  for (let variant = 0; variant < SHRUB_STYLES.length; variant++) for (const cards of [false, true]) {
    const pair = shrubGeometry(variant, { cards });
    for (const [part, geo] of Object.entries(pair)) assertGeometry(geo, `${SHRUB_STYLES[variant]} ${part}`);
    const bounds = pair.leaves.boundingBox, positions = pair.leaves.getAttribute('position');
    let radialExtent = 0;
    for (let i = 0; i < positions.count; i++) radialExtent = Math.max(radialExtent, Math.hypot(positions.getX(i), positions.getZ(i)));
    assert.ok(radialExtent <= 1.2, 'procedural canopy fits the placement footprint');
    assert.ok(bounds.max.y <= 2.4 && bounds.min.y >= 0, 'canopy stays within a compact silhouette budget');
    const stemFlex = pair.stems.getAttribute('aFlex');
    assert.ok([...stemFlex.array].every((v) => v === 0), 'woody stems remain rigid');
    const leafFlex = pair.leaves.getAttribute('aFlex');
    assert.ok(Math.min(...leafFlex.array) >= 0 && Math.max(...leafFlex.array) <= 1, 'leaf wind flex stays bounded');
    const uv = pair.leaves.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const x = uv.getX(i), y = uv.getY(i), tileX = x < 0.5 ? 0 : 0.5, tileY = y < 0.5 ? 0 : 0.5;
      assert.ok(x >= tileX + 8 / 512 - EPS && x <= tileX + 248 / 512 + EPS, 'leaf UV stays inside one horizontal atlas tile');
      assert.ok(y >= tileY + 8 / 512 - EPS && y <= tileY + 248 / 512 + EPS, 'leaf UV stays inside one vertical atlas tile');
    }
    pair.stems.dispose(); pair.leaves.dispose();
  }
  assert.throws(() => shrubGeometry(3), /Unknown shrub variant/);
});

function loadedFixture() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 1], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute('_flex', new THREE.Float32BufferAttribute([0, 0.3, 0.6], 1));
  geo.setAttribute('_paint', new THREE.Float32BufferAttribute([0, 0, 0, 0.5, 1, 1], 2));
  return geo;
}

test('loaded shrub model pairs clone custom wind and paint attributes and fail closed', () => {
  const sources = [loadedFixture(), loadedFixture()];
  const loaded = loadedShrubGeometry({ parts: sources.map((geo) => ({ geo })) });
  assert.ok(loaded);
  for (const [i, geo] of [loaded.stems, loaded.leaves].entries()) {
    assertGeometry(geo, `loaded shrub part ${i}`);
    assert.deepEqual([...geo.getAttribute('aFlex').array], [...sources[i].getAttribute('_flex').array]);
    assert.deepEqual([...geo.getAttribute('aPaint').array], [...sources[i].getAttribute('_paint').array]);
    assert.equal(geo.getAttribute('_flex'), undefined); assert.equal(geo.getAttribute('_paint'), undefined);
    assert.equal(sources[i].getAttribute('aFlex'), undefined, 'loader leaves source attributes untouched');
    geo.dispose();
  }
  assert.equal(loadedShrubGeometry(null), null);
  assert.equal(loadedShrubGeometry({ parts: [{ geo: sources[0] }] }), null);
  const bad = loadedFixture(); bad.deleteAttribute('_paint');
  assert.equal(loadedShrubGeometry({ parts: [{ geo: sources[0] }, { geo: bad }] }), null);
  const malformed = loadedFixture(); malformed.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1], 1));
  assert.equal(loadedShrubGeometry({ parts: [{ geo: sources[0] }, { geo: malformed }] }), null, 'malformed UV shape is rejected');
  [...sources, bad, malformed].forEach((geo) => geo.dispose());
});

test('shrub sites reject unsafe terrain, masks, landmarks, docks, access, and solid props', () => {
  const unsafe = [
    ['water', mapFixture({ materialAt: () => 'water' })],
    ['path mask', mapFixture({ masks: () => ({ path: 0.16, volcanic: 0, arenaFloor: 0, lava: 0 }) })],
    ['arena floor', mapFixture({ masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0.11, lava: 0 }) })],
    ['dock', mapFixture({ onDock: () => true })],
    ['steep slope', mapFixture({ heightAt: (x) => 1 + x })],
    ['village core', mapFixture({ landmarks: { village: { x: 0, z: 0 } } })],
    ['spawn', mapFixture({ landmarks: { spawn: { x: 0, z: 0 } } })],
    ['dock approach', mapFixture({ landmarks: { dockBase: { x: -10, z: 0 }, dockEnd: { x: 10, z: 0 } } })],
    ['NPC access', mapFixture({ npcs: [{ x: 0, z: 0, r: 0.5 }] })],
    ['building footprint', mapFixture({ props: [{ kind: 'hut', x: 0, z: 0, r: 2 }] })],
  ];
  for (const [label, map] of unsafe) assert.equal(shrubSite(map, 0, 0, 1), null, `${label} is excluded`);
  const safe = shrubSite(mapFixture(), 0, 0, 1);
  assert.ok(safe);
  assert.ok(Math.abs(safe.y - 0.95) < EPS, 'placement sinks slightly into terrain');
  assert.ok(Math.abs(Math.hypot(safe.nx, safe.ny, safe.nz) - 1) < 1e-6 && safe.ny > 0.9, 'placement has an upward unit terrain normal');
});

test('shrub scatter is deterministic, capped, clear of props, and does not mutate world inputs', () => {
  const map = mapFixture({ half: 165, seed: 99282957, props: [
    { kind: 'bush', x: -35, z: 18, y: 1, scale: 1, rot: 0.4 },
    { kind: 'palm', x: 12, z: -8, y: 1, h: 6, scale: 1, rot: 0.2 },
    { kind: 'hut', x: 30, z: 30, r: 3 },
  ] });
  const before = structuredClone(map.props);
  const first = buildShrubs(map), second = buildShrubs(map);
  assert.ok(first.length > 0);
  assert.deepEqual(first, second);
  assert.ok(first.length <= SHRUB_LIMIT);
  assert.equal(buildShrubs(map, { limit: 12 }).length, 12);
  assert.deepEqual(map.props, before, 'placement leaves props unchanged');
  assert.deepEqual(buildShrubs({ ...map, props: [...map.props].reverse() }), first, 'source prop ordering does not change selected shrubs');
  for (const shrub of first) {
    for (const key of ['x', 'y', 'z', 'nx', 'ny', 'nz', 'rot', 'scale', 'radius']) assert.ok(Number.isFinite(shrub[key]), `${key} is finite`);
    assert.ok(shrub.scale >= 0.55 && shrub.scale <= 1.05);
    assert.ok(Math.abs(shrub.radius - shrub.scale * 1.2) < EPS);
    assert.ok(Math.abs(Math.hypot(shrub.nx, shrub.ny, shrub.nz) - 1) < 1e-6 && shrub.ny > 0.9);
    assert.ok(shrub.variant >= 0 && shrub.variant < SHRUB_STYLES.length);
    if (shrub.source === 'existing') assert.ok(map.props.includes(shrub.original), 'safe legacy bush retains original prop reference');
  }
  for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++)
    assert.ok(Math.hypot(first[i].x - first[j].x, first[i].z - first[j].z) >= first[i].radius + first[j].radius + 0.2 - EPS, 'shrub footprints do not overlap');
});

test('seeded world shrub placement stays deterministic and within its cap', () => {
  const map = generateWorld(20261007), before = structuredClone(map.props);
  const first = buildShrubs(map);
  assert.ok(first.length > 0 && first.length <= SHRUB_LIMIT);
  assert.deepEqual(buildShrubs({ ...map, props: [...map.props].reverse() }), first);
  assert.deepEqual(map.props, before);
});

test('shrub materials keep wood separate and pair painted alpha and normal fallbacks', () => {
  const color = new THREE.Texture(), normal = new THREE.Texture(), sway = { value: 0.24 };
  const byId = new Map([[SHRUB_TEXTURE_IDS[0], color], [SHRUB_TEXTURE_IDS[1], normal]]);
  const registry = { texture: (id) => byId.get(id) || null };
  const mats = shrubMaterials(registry, sway);
  assert.equal(mats.stems.vertexColors, true, 'warm stem paint comes from geometry colors');
  assert.equal(mats.stems.map, null, 'leaf atlas is not applied to stems');
  assert.equal(mats.painted, true); assert.equal(mats.normal, true);
  assert.deepEqual(mats.textures, SHRUB_TEXTURE_IDS);
  assert.equal(mats.leaves.map, color); assert.equal(mats.leaves.normalMap, normal);
  assert.equal(mats.leaves.alphaTest, 0.35); assert.equal(mats.leafNm.map, color);
  assert.equal(mats.leafDepth.map, color); assert.equal(mats.leafDepth.alphaTest, 0.35);
  assert.ok(Math.abs(mats.leaves.normalScale.x - 0.16) < EPS && Math.abs(mats.leaves.normalScale.y - 0.16) < EPS);
  const nm = { uniforms: {}, vertexShader: THREE.ShaderLib.normal.vertexShader, fragmentShader: THREE.ShaderLib.normal.fragmentShader };
  mats.leafNm.onBeforeCompile(nm);
  assert.strictEqual(nm.uniforms.mnPalmCut.value, color);
  assert.match(nm.fragmentShader, /texture2D\(mnPalmCut, vPalmCutUV\)\.a < 0\.35\) discard/);
  const depth = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  mats.leafDepth.onBeforeCompile(depth);
  assert.strictEqual(depth.uniforms.mnSwayAmt, sway);
  assert.strictEqual(depth.uniforms.mnTime, U.mnTime);
  assert.match(depth.vertexShader, /step\(1\.5, aFlex\)/);

  const noColor = shrubMaterials({ texture: (id) => id === SHRUB_TEXTURE_IDS[1] ? normal : null }, sway);
  assert.equal(noColor.painted, false); assert.equal(noColor.normal, false);
  assert.equal(noColor.leaves.vertexColors, true); assert.equal(noColor.leaves.map, null); assert.equal(noColor.leaves.normalMap, null);
  assert.equal(noColor.leaves.alphaTest, 0); assert.equal(noColor.leafDepth.map, null); assert.equal(noColor.leafDepth.alphaTest, 0);
  const flatColor = shrubMaterials({ texture: (id) => id === SHRUB_TEXTURE_IDS[0] ? color : null }, sway);
  assert.equal(flatColor.painted, true); assert.equal(flatColor.normal, false);
  assert.equal(flatColor.leaves.map, color); assert.equal(flatColor.leaves.normalMap, null);
  assert.equal(flatColor.leaves.alphaTest, 0.35); assert.equal(flatColor.leafDepth.map, color);
  for (const value of [color, normal]) value.dispose();
  for (const value of [mats, noColor, flatColor]) for (const key of ['stems', 'stemNm', 'stemDepth', 'leaves', 'leafNm', 'leafDepth']) value[key].dispose();
});

function webpDimensions(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (chunk === 'VP8L') {
    assert.equal(bytes[20], 0x2f, 'lossless WebP has its format signature');
    return [1 + bytes[21] + ((bytes[22] & 0x3f) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)];
  }
  throw new Error(`unsupported shrub WebP encoding ${chunk}`);
}

test('registered shrub models meet the static two-part GLB payload budget', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
  const entries = SHRUB_IDS.map((id) => manifest.assets.find((asset) => asset.id === id));
  assert.ok(entries.every(Boolean), 'all three shrub variants are registered');
  for (const entry of entries) {
    assert.equal(entry.kind, 'model');
    const bytes = fs.readFileSync(new URL(`../assets/${entry.src}`, import.meta.url));
    assert.ok(bytes.length <= 100 * 1024, `${entry.id} stays below 100 KiB`);
    const parsed = readGlb(bytes), info = summarize(parsed);
    assert.ok(info.tris > 0 && info.tris <= 700, `${entry.id} stays below 700 triangles`);
    assert.deepEqual(info.images, [], `${entry.id} keeps shared atlas textures external`);
    assert.deepEqual(info.skins, [], `${entry.id} remains static geometry`);
    const primitives = (parsed.json.meshes || []).flatMap((mesh) => mesh.primitives || []);
    assert.equal(primitives.length, 2, `${entry.id} provides stems and leaves`);
    for (const primitive of primitives) {
      for (const [semantic, size] of [['POSITION', 3], ['NORMAL', 3], ['COLOR_0', 3], ['TEXCOORD_0', 2], ['_FLEX', 1], ['_PAINT', 2]]) {
        const accessorId = primitive.attributes[semantic];
        assert.ok(accessorId !== undefined, `${entry.id} includes ${semantic}`);
        const accessor = parsed.json.accessors[accessorId];
        assert.equal(accessor.type, size === 1 ? 'SCALAR' : `VEC${size}`, `${entry.id} ${semantic} has the expected shape`);
        assert.equal(accessor.componentType, 5126, `${entry.id} ${semantic} uses finite float payloads`);
      }
    }
  }
});

test('shrub albedo and normal registrations select paired PC and smaller mobile atlases', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
  const textures = SHRUB_TEXTURE_IDS.map((id) => manifest.assets.find((asset) => asset.id === id));
  assert.ok(textures.every(Boolean), 'both shrub atlases are registered');
  const receipt = JSON.parse(fs.readFileSync(new URL('../docs/art/source/shrub-runtime-v1/textures-receipt.json', import.meta.url), 'utf8'));
  const derivatives = new Map(receipt.derivatives.map((item) => [item.file, item]));
  const totals = { pc: 0, mobile: 0 };
  for (const [index, entry] of textures.entries()) {
    assert.equal(entry.kind, 'tex');
    if (index === 1) assert.equal(entry.data, true, 'normal atlas is registered as linear data');
    assert.ok(entry.mobileSrc, 'device-sized texture has a mobile variant');
    const pairSizes = [];
    for (const [key, tier] of [['src', 'pc'], ['mobileSrc', 'mobile']]) {
      const relative = `assets/${entry[key]}`, bytes = fs.readFileSync(new URL(`../${relative}`, import.meta.url));
      const derivative = derivatives.get(relative);
      assert.ok(derivative, `${relative} is recorded in the source receipt`);
      assert.equal(bytes.length, derivative.bytes, `${relative} matches its recorded byte budget`);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      assert.equal(digest, derivative.sha256, `${relative} matches the recorded content hash`);
      const dimensions = webpDimensions(bytes);
      assert.deepEqual(dimensions, derivative.dimensions, `${relative} decodes to its recorded dimensions`);
      pairSizes.push(dimensions);
      totals[tier] += bytes.length;
    }
    assert.deepEqual(pairSizes[0], [512, 512], 'PC atlas retains full tile detail');
    assert.deepEqual(pairSizes[1], [256, 256], 'mobile atlas uses the lower-resolution variant');
  }
  assert.ok(totals.mobile < totals.pc, 'mobile pair uses fewer downloaded bytes than PC pair');
  assert.match(receipt.alpha, /albedo alpha used for both maps/i, 'texture recipe records the albedo alpha as the cutout authority');
  assert.equal(receipt.uv.textureLoaderFlipY, true);
});
