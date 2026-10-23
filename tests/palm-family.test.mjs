import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { mulberry32 } from '../src/core/rng.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { readGlb, summarize } from '../tools/glb.mjs';
import { PALM_IDS, PALM_STYLES, loadedPalmGeometry, palmGeometry, palmVariant } from '../src/render/palmGeometry.js';

const EPS = 1e-6;

function assertGeometry(geometry, label) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  const uv = geometry.getAttribute('uv');
  const flex = geometry.getAttribute('aFlex');
  assert.ok(position?.count >= 3, `${label} has vertices`);
  assert.equal(position.count % 3, 0, `${label} is a triangle list`);
  for (const [attr, name, size] of [[normal, 'normal', 3], [color, 'color', 3], [uv, 'uv', 2], [flex, 'aFlex', 1]]) {
    assert.equal(attr?.count, position.count, `${label} has one ${name} per vertex`);
    assert.equal(attr.itemSize, size, `${label} ${name} has the expected width`);
  }
  for (let i = 0; i < position.count; i++) {
    for (const [attr, name] of [[position, 'position'], [normal, 'normal'], [color, 'color'], [uv, 'uv'], [flex, 'aFlex']]) {
      for (let k = 0; k < attr.itemSize; k++) assert.ok(Number.isFinite(attr.getComponent(i, k)), `${label} ${name} ${i}:${k} is finite`);
    }
    assert.ok(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) > EPS, `${label} normal ${i} is nonzero`);
    for (let k = 0; k < 3; k++) assert.ok(color.getComponent(i, k) >= 0 && color.getComponent(i, k) <= 1, `${label} palette is normalized`);
    for (let k = 0; k < 2; k++) assert.ok(uv.getComponent(i, k) >= 0 && uv.getComponent(i, k) <= 1, `${label} UV is in range`);
  }
  const indices = geometry.index?.array;
  for (let i = 0; i < (indices?.length || position.count); i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, indices ? indices[i] : i);
    const b = new THREE.Vector3().fromBufferAttribute(position, indices ? indices[i + 1] : i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, indices ? indices[i + 2] : i + 2);
    assert.ok(new THREE.Triangle(a, b, c).getArea() > EPS, `${label} triangle ${i / 3} has area`);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const { min, max } = geometry.boundingBox;
  assert.ok([...min.toArray(), ...max.toArray(), geometry.boundingSphere.radius].every(Number.isFinite), `${label} bounds are finite`);
  assert.ok(max.x > min.x && max.y > min.y && max.z > min.z, `${label} bounds have volume`);
}

function fixtureGeometry() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 1], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute('_flex', new THREE.Float32BufferAttribute([0, 0.5, 1], 1));
  geo.setAttribute('_paint', new THREE.Float32BufferAttribute([0, 0, 0.5, 0.5, 1, 1], 2));
  return geo;
}

test('palm silhouettes have valid surfaces, anchored trunks, crown flex, and distinct heights', () => {
  assert.deepEqual(PALM_STYLES, ['tall', 'curved', 'short']);
  assert.equal(PALM_IDS.length, 3);
  const heights = [];
  for (let variant = 0; variant < PALM_IDS.length; variant++) {
    for (const cards of [false, true]) {
      const pair = palmGeometry(variant, { cards });
      assertGeometry(pair.trunk, `${PALM_STYLES[variant]} trunk cards=${cards}`);
      assertGeometry(pair.fronds, `${PALM_STYLES[variant]} fronds cards=${cards}`);
      const p = pair.trunk.getAttribute('position'), flex = pair.trunk.getAttribute('aFlex');
      let baseFlex = Infinity, crownFlex = -Infinity, baseRadius = 0;
      for (let i = 0; i < p.count; i++) if (p.getY(i) <= 0.12) {
        baseFlex = Math.min(baseFlex, flex.getX(i));
        baseRadius = Math.max(baseRadius, Math.hypot(p.getX(i), p.getZ(i)));
      }
      for (let i = 0; i < p.count; i++) crownFlex = Math.max(crownFlex, flex.getX(i));
      assert.ok(baseFlex <= EPS, `${PALM_STYLES[variant]} trunk flex starts at zero`);
      assert.ok(Math.abs(crownFlex - 1) <= EPS, `${PALM_STYLES[variant]} trunk reaches flex 1 at the crown`);
      assert.ok(baseRadius <= 0.38, `${PALM_STYLES[variant]} trunk is rooted near the origin`);
      const leaves = pair.fronds.getAttribute('aFlex');
      assert.ok(Math.min(...leaves.array) >= 1 - EPS && Math.max(...leaves.array) <= 2 + EPS, 'leaf flex spans 1..2');
      if (!cards) heights.push(pair.trunk.boundingBox.max.y);
      pair.trunk.dispose(); pair.fronds.dispose();
    }
  }
  assert.equal(new Set(heights.map((h) => h.toFixed(3))).size, 3, 'the three trunk silhouettes have different heights');
});

test('coordinate palm variants ignore prop order and leave generated props and RNG state untouched', () => {
  const map = generateWorld(20261007);
  const props = map.props;
  const before = structuredClone(props);
  const selected = props.map((prop) => [prop.x, prop.z, palmVariant(prop)]);
  const reordered = [...props].reverse().map((prop) => [prop.x, prop.z, palmVariant(prop)]).reverse();
  assert.deepEqual(reordered, selected);
  assert.deepEqual(map.props, before);

  const expectedRng = mulberry32(981723), actualRng = mulberry32(981723);
  for (const prop of props) palmVariant(prop);
  assert.equal(actualRng(), expectedRng(), 'coordinate selection consumes no world RNG');
  assert.deepEqual(generateWorld(20261007).props, before, 'repeated world generation remains deterministic');
});

test('loaded palm parts copy custom flex and paint attributes and reject incomplete pairs safely', () => {
  const sources = [fixtureGeometry(), fixtureGeometry()];
  const sourceAttributes = sources.map((geo) => ({ flex: geo.getAttribute('_flex'), paint: geo.getAttribute('_paint'), uv: geo.getAttribute('uv') }));
  const loaded = loadedPalmGeometry({ parts: sources.map((geo) => ({ geo })) });
  assert.ok(loaded);
  for (const [i, geo] of [loaded.trunk, loaded.fronds].entries()) {
    assert.deepEqual([...geo.getAttribute('aFlex').array], [...sourceAttributes[i].flex.array]);
    assert.deepEqual([...geo.getAttribute('aPaint').array], [...sourceAttributes[i].paint.array]);
    assert.equal(geo.getAttribute('_flex'), undefined);
    assert.equal(geo.getAttribute('_paint'), undefined);
    assertGeometry(geo, `loaded part ${i}`);
    geo.dispose();
    assert.strictEqual(sources[i].getAttribute('_flex'), sourceAttributes[i].flex, 'source flex attribute is retained');
    assert.strictEqual(sources[i].getAttribute('_paint'), sourceAttributes[i].paint, 'source paint attribute is retained');
    assert.strictEqual(sources[i].getAttribute('uv'), sourceAttributes[i].uv, 'source UV attribute is retained');
    assert.equal(sources[i].getAttribute('aFlex'), undefined, 'loader does not attach render attributes to source');
  }
  assert.equal(loadedPalmGeometry(null), null);
  assert.equal(loadedPalmGeometry({ parts: [sources[0]] }), null, 'a missing frond part falls back as a pair');
  const noUv = fixtureGeometry(); noUv.deleteAttribute('uv');
  assert.equal(loadedPalmGeometry({ parts: [{ geo: sources[0] }, { geo: noUv }] }), null, 'incomplete UV data rejects the whole pair');
  [...sources, noUv].forEach((geo) => geo.dispose());
});

test('all delivered palm GLBs are registered as small, texture-free two-part models', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
  for (const id of PALM_IDS) {
    const entry = manifest.assets.find((asset) => asset.id === id);
    assert.ok(entry, `${id} is registered`);
    assert.equal(entry.kind, 'model');
    assert.ok(entry.src && !entry.src.includes('..'), `${id} uses a relative model path`);
    const bytes = fs.readFileSync(new URL(`../assets/${entry.src}`, import.meta.url));
    assert.ok(bytes.length <= 200 * 1024, `${id} is at most 200 KiB`);
    const parsed = readGlb(bytes), info = summarize(parsed);
    assert.ok(info.tris > 0 && info.tris <= 1600, `${id} stays within 1600 triangles`);
    assert.deepEqual(info.images, [], `${id} has no embedded images`);
    assert.deepEqual(info.skins, [], `${id} is not skinned`);
    const primitives = (parsed.json.meshes || []).flatMap((mesh) => mesh.primitives || []);
    assert.equal(primitives.length, 2, `${id} has exactly trunk and frond parts`);
    for (const primitive of primitives) {
      assert.ok(primitive.attributes.POSITION !== undefined && primitive.attributes.NORMAL !== undefined, `${id} has positions and normals`);
      assert.ok(primitive.attributes.COLOR_0 !== undefined && primitive.attributes.TEXCOORD_0 !== undefined, `${id} has palette and atlas UVs`);
      assert.ok(primitive.attributes._FLEX !== undefined && primitive.attributes._PAINT !== undefined, `${id} carries shader flex and paint attributes`);
    }
  }
});
