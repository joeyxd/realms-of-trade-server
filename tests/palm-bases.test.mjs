import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { readGlb, summarize } from '../tools/glb.mjs';
import { PALM_BASE_IDS, PALM_BASE_LIMIT, PALM_BASE_STYLES, buildPalmBases, loadedPalmBaseGeometry, palmBaseGeometry } from '../src/render/palmBaseGeometry.js';
import { PALM_BASE_TEXTURE_IDS, palmBaseMaterials } from '../src/render/palmBaseMaterials.js';
import { PALM_TEXTURE_IDS } from '../src/render/palmMaterials.js';
import { U } from '../src/render/toon.js';

const EPS = 1e-6;

function assertGeometry(geo, label) {
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), c = geo.getAttribute('color');
  const uv = geo.getAttribute('uv'), flex = geo.getAttribute('aFlex');
  assert.ok(p?.count >= 3, `${label} has vertices`);
  assert.equal(p.count % 3, 0, `${label} is a triangle list`);
  for (const [attr, name, size] of [[n, 'normal', 3], [c, 'color', 3], [uv, 'UV', 2], [flex, 'flex', 1]]) {
    assert.equal(attr?.count, p.count, `${label} has one ${name} per vertex`);
    assert.equal(attr.itemSize, size, `${label} ${name} width is valid`);
  }
  for (let i = 0; i < p.count; i++) {
    for (const [attr, name] of [[p, 'position'], [n, 'normal'], [c, 'color'], [uv, 'UV'], [flex, 'flex']])
      for (let k = 0; k < attr.itemSize; k++) assert.ok(Number.isFinite(attr.getComponent(i, k)), `${label} ${name} ${i}:${k} is finite`);
    assert.ok(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > EPS, `${label} normal ${i} is nonzero`);
    for (let k = 0; k < 3; k++) assert.ok(c.getComponent(i, k) >= 0 && c.getComponent(i, k) <= 1, `${label} color is normalized`);
    for (let k = 0; k < 2; k++) assert.ok(uv.getComponent(i, k) >= 0 && uv.getComponent(i, k) <= 1, `${label} UV is bounded`);
  }
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c0 = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    assert.ok(new THREE.Triangle(a, b, c0).getArea() > EPS, `${label} triangle ${i / 3} is nondegenerate`);
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  assert.ok([...geo.boundingBox.min.toArray(), ...geo.boundingBox.max.toArray(), geo.boundingSphere.radius].every(Number.isFinite), `${label} bounds are finite`);
  assert.ok(geo.boundingBox.max.x > geo.boundingBox.min.x && geo.boundingBox.max.y > geo.boundingBox.min.y && geo.boundingBox.max.z > geo.boundingBox.min.z, `${label} bounds have volume`);
}

function loaderFixture() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 1], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  g.setAttribute('_flex', new THREE.Float32BufferAttribute([0, 0.3, 0.6], 1));
  g.setAttribute('_paint', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
  return g;
}

test('open and lush palm bases have rooted trunks and upward leaf rosettes in both geometry modes', () => {
  assert.deepEqual(PALM_BASE_STYLES, ['open', 'lush']);
  assert.equal(PALM_BASE_IDS.length, PALM_BASE_STYLES.length);
  for (let variant = 0; variant < PALM_BASE_STYLES.length; variant++) for (const cards of [false, true]) {
    const pair = palmBaseGeometry(variant, { cards });
    assertGeometry(pair.roots, `${PALM_BASE_STYLES[variant]} roots`);
    assertGeometry(pair.leaves, `${PALM_BASE_STYLES[variant]} leaves`);
    const rp = pair.roots.getAttribute('position'), rf = pair.roots.getAttribute('aFlex');
    assert.ok(Math.max(...rf.array) <= EPS, 'root geometry stays rigid under wind');
    assert.ok(rp.getY(0) < 0.4, 'root geometry remains close to the ground anchor');
    assert.ok(pair.roots.boundingBox.min.x < 0 && pair.roots.boundingBox.max.x > 0 && pair.roots.boundingBox.min.z < 0 && pair.roots.boundingBox.max.z > 0,
      'roots spread around the trunk origin');
    const lf = pair.leaves.getAttribute('aFlex'), ln = pair.leaves.getAttribute('normal');
    assert.ok(Math.min(...lf.array) >= -EPS && Math.max(...lf.array) <= 0.62 + EPS, 'base leaves use a low, bounded flex range');
    assert.ok(Math.min(...ln.array.filter((_, i) => i % 3 === 1)) > 0.3, 'leaf surface normals face mostly upward');
    const ruv = pair.roots.getAttribute('uv'), luv = pair.leaves.getAttribute('uv');
    for (let i = 0; i < ruv.count; i++) {
      assert.ok(ruv.getX(i) >= 1 / 64 - EPS && ruv.getX(i) <= 1 / 64 + 15 / 32 + EPS, 'root UV stays in S05 trunk tile');
      assert.ok(ruv.getY(i) >= 0.5 + 1 / 64 - EPS && ruv.getY(i) <= 0.5 + 1 / 64 + 15 / 32 + EPS, 'root UV stays in top-left atlas tile');
    }
    for (let i = 0; i < luv.count; i++) {
      const x = luv.getX(i), left = x < 0.5 ? 0 : 0.5;
      assert.ok(x >= left + 1 / 64 - EPS && x <= left + 1 / 64 + 15 / 32 + EPS, 'leaf UV stays inset within one half-width tile');
      assert.ok(luv.getY(i) >= 1 / 32 - EPS && luv.getY(i) <= 31 / 32 + EPS, 'leaf UV stays within the vertical texture inset');
    }
    pair.roots.dispose(); pair.leaves.dispose();
  }
  assert.throws(() => palmBaseGeometry(2), /Unknown palm base variant/);
});

test('loaded palm base geometry clones custom flex data and rejects incomplete model pairs', () => {
  const sources = [loaderFixture(), loaderFixture()];
  const originalFlex = sources.map((g) => g.getAttribute('_flex'));
  const loaded = loadedPalmBaseGeometry({ parts: sources.map((geo) => ({ geo })) });
  assert.ok(loaded);
  for (const [i, g] of [loaded.roots, loaded.leaves].entries()) {
    assert.deepEqual([...g.getAttribute('aFlex').array], [...originalFlex[i].array]);
    assert.equal(g.getAttribute('_flex'), undefined);
    assert.equal(g.getAttribute('_paint'), undefined);
    assertGeometry(g, `loaded base part ${i}`);
    g.dispose();
    assert.strictEqual(sources[i].getAttribute('_flex'), originalFlex[i], 'source custom flex remains attached');
    assert.equal(sources[i].getAttribute('aFlex'), undefined, 'render flex is not written onto source');
  }
  assert.equal(loadedPalmBaseGeometry(null), null);
  assert.equal(loadedPalmBaseGeometry({ parts: [{ geo: sources[0] }] }), null);
  const missingFlex = loaderFixture(); missingFlex.deleteAttribute('_flex');
  assert.equal(loadedPalmBaseGeometry({ parts: [{ geo: sources[0] }, { geo: missingFlex }] }), null);
  const malformed = loaderFixture();
  malformed.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1], 1));
  assert.equal(loadedPalmBaseGeometry({ parts: [{ geo: sources[0] }, { geo: malformed }] }), null, 'malformed item size is rejected even when vertex count matches');
  [...sources, missingFlex, malformed].forEach((g) => g.dispose());
});

function placementMap(props, patch = {}) {
  const map = {
    seed: 71, props, heightAt: () => 0.8, materialAt: () => 'sand',
    masks: () => ({ path: 0, volcanic: 0, arenaFloor: 0, lava: 0 }), onDock: () => false,
    landmarks: {}, npcs: [], racks: [], ...patch,
  };
  Object.defineProperty(map, 'rng', { get() { throw new Error('base placement must not consume world RNG'); } });
  return map;
}

function palm(x = 0, z = 0) { return { kind: 'palm', x, z, y: 0.8, h: 6, scale: 1, rot: 0 }; }

test('base placement is deterministic, bounded, anchored to terrain, and rejects unsafe footprints', () => {
  const palms = Array.from({ length: 8 }, (_, i) => palm(i * 8, (i % 2) * 8));
  const map = placementMap(palms);
  const before = structuredClone(map.props);
  const first = buildPalmBases(map), second = buildPalmBases(map);
  assert.ok(first.length > 0, 'valid open ground admits some palm bases');
  assert.deepEqual(first, second);
  assert.deepEqual(buildPalmBases({ ...map, props: [...map.props].reverse() }), first, 'prop ordering cannot affect chosen instances');
  assert.deepEqual(map.props, before, 'placement does not rewrite the source props');
  assert.ok(first.length <= PALM_BASE_LIMIT);
  assert.equal(buildPalmBases(map, { limit: 3 }).length, 3, 'caller limit caps the accepted instances');
  for (const p of first) {
    for (const key of ['x', 'y', 'z', 'rot', 'scale', 'nx', 'ny', 'nz']) assert.ok(Number.isFinite(p[key]), `${key} is finite`);
    assert.ok(p.scale > 0 && p.scale <= 1.4);
    assert.ok(Math.abs(p.y - 0.7) < EPS, 'roots are sunk by a small amount into the sampled ground');
    assert.ok(Math.abs(Math.hypot(p.nx, p.ny, p.nz) - 1) < 1e-5 && p.ny > 0.9, 'placement carries an upward terrain normal');
  }

  const excluded = [
    ['water', placementMap([palm()], { materialAt: () => 'water' })],
    ['path mask', placementMap([palm()], { masks: () => ({ path: 0.17, volcanic: 0, arenaFloor: 0, lava: 0 }) })],
    ['volcanic mask', placementMap([palm()], { masks: () => ({ path: 0, volcanic: 0.16, arenaFloor: 0, lava: 0 }) })],
    ['dock', placementMap([palm()], { onDock: () => true })],
    ['steep terrain', placementMap([palm()], { heightAt: (x) => 0.8 + 0.4 * x })],
    ['nearby NPC', placementMap([palm()], { npcs: [{ x: 2.5, z: 0, r: 0.5 }] })],
  ];
  for (const [label, unsafe] of excluded) assert.deepEqual(buildPalmBases(unsafe), [], `${label} excludes the whole footprint`);
});

test('generated-world palm bases stay capped and coordinate-ranked when the prop list is reordered', () => {
  const map = generateWorld(20261007);
  const palms = map.props.filter((p) => p.kind === 'palm');
  const before = structuredClone(map.props);
  assert.equal(palms.length, 239, 'seeded island keeps its current palm placement contract');
  const selected = buildPalmBases(map);
  assert.equal(selected.length, PALM_BASE_LIMIT);
  assert.deepEqual(buildPalmBases({ ...map, props: [...map.props].reverse() }), selected);
  assert.deepEqual(map.props, before);
});

test('base materials reuse S05 trunk passes and keep leaf color, alpha, normal, and wind fallbacks paired', () => {
  const color = new THREE.Texture(), normal = new THREE.Texture(), sway = { value: 0.24 };
  const byId = new Map([[PALM_BASE_TEXTURE_IDS[0], color], [PALM_BASE_TEXTURE_IDS[1], normal]]);
  const existing = { trunk: { id: 'trunk-material' }, trunkNm: { id: 'trunk-normal' }, trunkDepth: { id: 'trunk-depth' } };
  const mats = palmBaseMaterials({ texture: (id) => byId.get(id) || null }, sway, existing);
  assert.strictEqual(mats.roots, existing.trunk);
  assert.strictEqual(mats.rootNm, existing.trunkNm);
  assert.strictEqual(mats.rootDepth, existing.trunkDepth);
  assert.equal(mats.painted, true); assert.equal(mats.normal, true);
  assert.deepEqual(mats.textures, PALM_BASE_TEXTURE_IDS);
  assert.equal(mats.leaves.map, color); assert.equal(mats.leaves.normalMap, normal);
  assert.equal(mats.leafNm.map, color); assert.equal(mats.leafNm.alphaTest, 0.35);
  const nm = { uniforms: {}, vertexShader: THREE.ShaderLib.normal.vertexShader, fragmentShader: THREE.ShaderLib.normal.fragmentShader };
  mats.leafNm.onBeforeCompile(nm);
  assert.strictEqual(nm.uniforms.mnPalmCut.value, color);
  assert.match(nm.fragmentShader, /texture2D\(mnPalmCut, vPalmCutUV\)\.a < 0\.35\) discard/);
  const depth = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  mats.leafDepth.onBeforeCompile(depth);
  assert.strictEqual(depth.uniforms.mnTime, U.mnTime); assert.strictEqual(depth.uniforms.mnSwayAmt, sway);
  assert.match(depth.vertexShader, /step\(1\.5, aFlex\)/);

  const noColor = palmBaseMaterials({ texture: (id) => id === PALM_BASE_TEXTURE_IDS[1] ? normal : null }, sway, existing);
  assert.equal(noColor.painted, false); assert.equal(noColor.normal, false);
  assert.equal(noColor.leaves.vertexColors, true); assert.equal(noColor.leaves.map, null); assert.equal(noColor.leaves.normalMap, null);
  assert.equal(noColor.leaves.alphaTest, 0); assert.equal(noColor.leafDepth.map, null); assert.equal(noColor.leafDepth.alphaTest, 0);
  const flatColor = palmBaseMaterials({ texture: (id) => id === PALM_BASE_TEXTURE_IDS[0] ? color : null }, sway, existing);
  assert.equal(flatColor.painted, true); assert.equal(flatColor.normal, false);
  assert.equal(flatColor.leaves.map, color); assert.equal(flatColor.leaves.normalMap, null, 'color remains active without a normal map');
  assert.equal(flatColor.leaves.alphaTest, 0.35); assert.equal(flatColor.leafDepth.map, color);
  color.dispose(); normal.dispose();
});

test('registered palm base GLBs meet the compact two-part model contract when delivered', (t) => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
  const entries = PALM_BASE_IDS.map((id) => manifest.assets.find((asset) => asset.id === id));
  assert.ok(entries.every(Boolean), 'both palm-base model variants are registered');
  for (const entry of entries) {
    assert.equal(entry.kind, 'model');
    const bytes = fs.readFileSync(new URL(`../assets/${entry.src}`, import.meta.url));
    assert.ok(bytes.length <= 80 * 1024, `${entry.id} is at most 80 KiB`);
    const parsed = readGlb(bytes), info = summarize(parsed);
    assert.ok(info.tris > 0 && info.tris <= 600, `${entry.id} stays within 600 triangles`);
    assert.deepEqual(info.images, [], `${entry.id} keeps shared textures external`);
    assert.deepEqual(info.skins, [], `${entry.id} is static geometry`);
    const primitives = (parsed.json.meshes || []).flatMap((mesh) => mesh.primitives || []);
    assert.equal(primitives.length, 2, `${entry.id} contains roots and leaves`);
    for (const primitive of primitives) {
      for (const attr of ['POSITION', 'NORMAL', 'COLOR_0', 'TEXCOORD_0', '_FLEX'])
        assert.ok(primitive.attributes[attr] !== undefined, `${entry.id} includes ${attr}`);
      const json = parsed.json;
      const normal = json.accessors[primitive.attributes.NORMAL];
      assert.equal(normal.componentType, 5126, `${entry.id} normals use float32 for reliable shader input`);
      for (const [name, accessorId] of Object.entries(primitive.attributes)) {
        const accessor = json.accessors[accessorId], view = json.bufferViews[accessor.bufferView];
        const componentBytes = accessor.componentType === 5126 || accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
        const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
        const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
        const stride = view.byteStride || componentBytes * components;
        assert.equal(start % 4, 0, `${entry.id} ${name} starts on a four-byte boundary`);
        assert.equal(stride % 4, 0, `${entry.id} ${name} has a four-byte-aligned effective stride`);
        if (name === 'COLOR_0' || name === '_FLEX') assert.equal(accessor.normalized, true, `${entry.id} ${name} compact byte data is normalized`);
      }
    }
  }
});
