import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { readGlb } from '../tools/glb.mjs';
import { normalizeManifest, fitBox, selectTextureSource } from '../src/render/assets/manifest.js';
import { assets } from '../src/render/assets/registry.js';
import { createProps, LANTERN_GLASS } from '../src/render/props.js';
import { LocalLights, LANTERN_LIGHT_OFFSET } from '../src/render/lights.js';
import { townLanternGeometry } from '../src/render/townFixtures.js';

const ROOT = new URL('../', import.meta.url);
const manifest = normalizeManifest(JSON.parse(readFileSync(new URL('assets/manifest.json', ROOT), 'utf8')));
const PROPS = { campfire: 'campfire-ring', crate: 'crate-stack', fence: 'fence-rope', board: 'notice-board',
  planter: 'planter-flowers', stallTarp: 'stall-tarp', lantern: 'lantern-post' };
const near = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);

// Desktop baseColor WebP medians: sRGB -> linear Rec.709, union of UV triangles rasterised at texel centres, no padding.
// SHA256 binds each measurement to its exact desktop GLB; textures were decoded with Pillow in a throwaway Node tool.
const LUMINANCE = {
  barrel: [0.06588367844232203, '42bc07f3765073d9e1ae7fe386b2f7a0584d519619ea33eb911deeccd0d03328'],
  'campfire-ring': [0.07308221131840867, 'a9e41c76c9ccab93de40528aa30ba78bff304dc6c8bd3dfe7a5853da3c93b38d'],
  'crate-stack': [0.028036940184368815, '521de033ab34e16d48b4bd5c69fe4c979259224064367649e9ce8a12e45fef49'],
  'fence-rope': [0.04628924140745818, 'dd9d6b513b0c175f81a56257ddd7fbd45d729e653a2caefa584a497a4731f434'],
  'notice-board': [0.03860980920690823, '3b29dca6329f247b491192da4d6b56a5f66c580fb206d14ea654c1d5bcc0dce2'],
  'planter-flowers': [0.03593846364807612, 'a56ee149494caa7013861b6e54638c2d0bc365f8c438ad68b4759c1c3f780f8c'],
  'stall-tarp': [0.02926862099065331, '1268bbf0915d5432b8d6cdf2f30d636c75ec3244ca60befb86d8eb31b431f469'],
  'lantern-post': [0.037942239725358685, 'a9b242760c1d4c9b102ae437bbe0a17ef6d668cba03756ddfbaff31325cd770d'],
};

function accessor(glb, id) {
  const a = glb.json.accessors[id], view = glb.json.bufferViews[a.bufferView];
  const count = { SCALAR: 1, VEC3: 3 }[a.type];
  const [bytes, method] = { 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] }[a.componentType];
  const data = new DataView(glb.bin.buffer, glb.bin.byteOffset, glb.bin.byteLength);
  const stride = view.byteStride || count * bytes, base = (view.byteOffset || 0) + (a.byteOffset || 0);
  return Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: count }, (_, k) => data[method](base + i * stride + k * bytes, true)));
}

// Decode real geometry without a browser/texture loader; bake the glTF hierarchy and manifest rotation like the registry.
function modelData(entry, mobile = false) {
  const glb = readGlb(readFileSync(new URL('assets/' + selectTextureSource(entry, mobile), ROOT)));
  const parts = [], box = new THREE.Box3();
  function visit(id, parent) {
    const node = glb.json.nodes[id];
    const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
      new THREE.Vector3(...(node.translation || [0, 0, 0])), new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])),
      new THREE.Vector3(...(node.scale || [1, 1, 1])));
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) for (const p of glb.json.meshes[node.mesh].primitives) {
      const geo = new THREE.BufferGeometry().setAttribute('position',
        new THREE.Float32BufferAttribute(accessor(glb, p.attributes.POSITION).flat(), 3));
      if (p.indices !== undefined) geo.setIndex(accessor(glb, p.indices).flat());
      geo.applyMatrix4(world);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      box.union(geo.boundingBox);
      parts.push({ geo, mat: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }) });
    }
    for (const child of node.children || []) visit(child, world);
  }
  const rotation = new THREE.Matrix4().makeRotationY(entry.rotY * Math.PI / 180);
  for (const id of glb.json.scenes[glb.json.scene || 0].nodes) visit(id, rotation);
  return { parts, min: box.min.toArray(), max: box.max.toArray() };
}
const models = new Map();
for (const name of [...Object.values(PROPS), 'storage-crate']) {
  const e = manifest.entries.get('prop:' + name);
  for (const mobile of [false, true]) models.set(e.id + ':' + mobile, modelData(e, mobile));
}
const dataFor = (id, mobile = false) => models.get(id + ':' + mobile);
const propMap = (props) => ({ props, npcs: [], groundAt: () => 0, size: 0, masks: () => ({ lava: 0 }),
  landmarks: { arena: { x: 50, z: 50 }, arenaR: 1 },
  dock: { len: 0, halfWidth: 0, deckY: 0, base: { x: 0, z: 9 }, dir: { x: 0, z: 1 } } });
function withModels(mobile, fn) {
  const prior = { man: assets.man, state: assets.state };
  assets.man = manifest;
  assets.state = new Map([...Object.values(PROPS), 'storage-crate'].map((name) =>
    ['prop:' + name, { state: 'ok', data: dataFor('prop:' + name, mobile) }]));
  try { return fn(); } finally { Object.assign(assets, prior); }
}
const placements = Object.keys(PROPS).map((kind, i) => ({ kind, x: i * 4, y: 0.3, z: -3, rot: 0.7, scale: 1 }));
placements.push({ kind: 'crate', x: -4, y: 0, z: 5, rot: 0, scale: 1 });

// Actual procedural bounding boxes captured through createProps; no copied nominal kit sizes.
function kitTargets() {
  const targets = new Map(), original = assets.instanced;
  return withModels(false, () => {
    assets.instanced = (id, matrices, target) => { targets.set(id, target); return new THREE.Group(); };
    try { createProps(propMap(placements)); } finally { assets.instanced = original; }
    return targets;
  });
}
const targets = kitTargets();
const fitted = (name, mobile = false) => {
  const e = manifest.entries.get('prop:' + name), d = dataFor(e.id, mobile);
  return fitBox(d.min, d.max, e, targets.get(e.id));
};

test('VR06: all seven prop bindings survive validation; crate keeps both variants and mobile sources', () => {
  assert.deepEqual(manifest.errors, []);
  for (const [kind, name] of Object.entries(PROPS)) {
    const id = 'prop:' + name, e = manifest.entries.get(id);
    assert.deepEqual(manifest.byPropAll.get(kind), kind === 'crate' ? ['prop:storage-crate', id] : [id]);
    assert.equal(e.rotY, kind === 'lantern' ? 22 : 0);
    assert.match(selectTextureSource(e, true), /-v2-mobile\.glb$/);
    assert.equal(e.yOffset, 0);
    assert.equal(e.scale, 1, 'only uniform fitting');
  }
});

test('VR06: grades follow measured UV-covered medians on the exact desktop assets', () => {
  for (const [name, [median, hash]] of Object.entries(LUMINANCE)) {
    const e = manifest.entries.get('prop:' + name);
    assert.equal(createHash('sha256').update(readFileSync(new URL('assets/' + e.src, ROOT))).digest('hex'), hash);
    if (name === 'barrel') continue;
    assert.equal(e.toon.bright, Math.round(Math.max(1, Math.min(4, LUMINANCE.barrel[0] / median)) * 10) / 10);
    assert.equal(e.toon.sat, name === 'planter-flowers' ? 1.3 : 1.15);
  }
});

test('VR06: desktop and mobile fit the decided sizes, centred and grounded', () => {
  // Measured GLB bounds fitted against the real kits (w x h x d), independently checked against both derivatives.
  const expected = { 'campfire-ring': [2.256914, 0.522170, 2.239205], 'crate-stack': [0.788183, 1, 0.698677],
    'fence-rope': [2.431082, 1.692318, 0.520505], 'notice-board': [1.61, 1.457484, 0.701633],
    'planter-flowers': [0.967204, 0.9, 0.845702], 'stall-tarp': [2.620354, 2.516843, 2.043202],
    'lantern-post': [1.314412, 2.6, 0.606586] };
  for (const name of Object.values(PROPS)) for (const mobile of [false, true]) {
    const d = dataFor('prop:' + name, mobile), f = fitted(name, mobile);
    for (let k = 0; k < 3; k++) near((d.max[k] - d.min[k]) * f.s, expected[name][k], 0.002, name + ' size');
    near(d.min[1] * f.s + f.y, 0, 1e-6, name + ' grounded');
    near((d.min[0] + d.max[0]) / 2 * f.s + f.x, 0, 1e-6, name + ' centre x');
    near((d.min[2] + d.max[2]) / 2 * f.s + f.z, 0, 1e-6, name + ' centre z');
  }
  const board = dataFor('prop:notice-board'), planter = dataFor('prop:planter-flowers');
  assert.ok((board.max[0] - board.min[0]) * 1.9 / (board.max[1] - board.min[1]) > 1.8);
  assert.equal(manifest.entries.get('prop:notice-board').fit, 'proc');
  const proc = fitBox(planter.min, planter.max, { fit: 'proc' }, targets.get('prop:planter-flowers'));
  assert.ok((planter.max[1] - planter.min[1]) * proc.s < 0.8);
});

test('VR06: adjacent fence segments overlap their end posts at the unchanged 2 u pitch', () => {
  // Horizontal triangle intersections at model y=0.05: left/right post x intervals, including node translation.
  const left = [-0.4862799995936172, -0.28519450636180194], right = [0.31407517756883635, 0.48759195601707994];
  const postWidth = right[1] - right[0], f = fitted('fence-rope');
  near(manifest.entries.get('prop:fence-rope').size, 2 + postWidth * f.s, 1e-6, 'width = pitch + fitted post');
  const overlap = Math.min(right[1] * f.s, 2 + left[1] * f.s) - Math.max(right[0] * f.s, 2 + left[0] * f.s);
  assert.ok(overlap > postWidth * f.s * 0.9, 'posts merge into one continuous join');
});

test('VR06: fitted lamp centre matches the exported light within 0.08 u on both variants', () => {
  const kit = townLanternGeometry();
  kit.computeBoundingBox();
  const size = kit.boundingBox.getSize(new THREE.Vector3()), target = { w: Math.max(size.x, size.z), h: size.y };
  for (const mobile of [false, true]) {
    const d = dataFor(LANTERN_GLASS.id, mobile), e = manifest.entries.get(LANTERN_GLASS.id);
    const f = fitBox(d.min, d.max, e, target);
    const centre = LANTERN_GLASS.c.map((v, k) => v * f.s + [f.x, f.y, f.z][k]);
    assert.ok(Math.hypot(...centre.map((v, k) => v - LANTERN_LIGHT_OFFSET[k])) < 0.08);
    // Post shaft centre measured at y=0.3..0.5 in the source: the rotated arm points along +x.
    const shaft = new THREE.Vector3(-0.143826, 0.4, -0.067165).applyAxisAngle(new THREE.Vector3(0, 1, 0), e.rotY * Math.PI / 180);
    assert.ok(LANTERN_GLASS.c[0] - shaft.x > 0.25);
    near(LANTERN_GLASS.c[2], shaft.z, 0.015, 'arm along +x');
  }
  kit.dispose();
});

test('VR06: glass boxes sit at the real pane surfaces and leave the centre strap clear', () => {
  const meshes = dataFor(LANTERN_GLASS.id).parts.map(p => new THREE.Mesh(p.geo, p.mat));
  for (const pane of LANTERN_GLASS.panes) for (const band of LANTERN_GLASS.bands) {
    const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), pane.rotY * Math.PI / 180);
    const c = new THREE.Vector3(pane.x, band.y, pane.z);
    const hit = new THREE.Raycaster(c.clone().add(n), n.clone().negate()).intersectObjects(meshes)[0];
    assert.ok(hit, 'the glow is on the hanging lamp geometry');
    const protrusion = hit.distance - 1 + LANTERN_GLASS.depth / 2;
    assert.ok(protrusion >= 0 && protrusion < 0.004, 'at the opaque glass surface, under the raised frame');
    assert.ok(band.y + band.h / 2 < 0.62 || band.y - band.h / 2 > 0.64, 'centre strap remains uncovered');
  }
});

test('VR06: createProps instances all seven models and aligns batched glass with rotated/scaled lights', () => {
  for (const mobile of [false, true]) withModels(mobile, () => {
    const props = placements.map(p => ({ ...p, scale: p.kind === 'lantern' ? 1.25 : p.scale }));
    const map = propMap(props), out = createProps(map);
    assert.ok(!out.group.getObjectByName('propsChunk'), 'no procedural stand-ins remain');
    for (const name of [...Object.values(PROPS), 'storage-crate']) {
      const group = out.group.getObjectByName('prop:' + name);
      assert.ok(group?.children.every(o => o.isInstancedMesh && o.count === 1), name + ' real instancing');
    }
    const glow = out.group.children.find(o => o.material === out.glassMat);
    assert.equal(glow.geometry.attributes.position.count, 6 * 2 * 36, 'two glass bands on six faces, no procedural glass');
    glow.geometry.computeBoundingBox();
    const centre = glow.geometry.boundingBox.getCenter(new THREE.Vector3());
    const light = new LocalLights(map).sources.find(s => s.kind === 'lantern');
    assert.ok(centre.distanceTo(new THREE.Vector3(light.x, light.y, light.z)) < 0.02, 'scale and rotation match');
    assert.ok(!out.group.getObjectByName('hutWindows'), 'only lantern glass receives new emission');
  });
});

test('VR06: unloaded lantern preserves the original procedural glass position', () => {
  assert.deepEqual(assets.propIds('lantern'), []);
  const out = createProps(propMap([{ kind: 'lantern', x: 0, y: 0, z: 0, rot: 0, scale: 1 }]));
  assert.ok(out.group.getObjectByName('propsChunk'));
  const glow = out.group.children.find(o => o.material === out.glassMat);
  assert.equal(glow.geometry.attributes.position.count, 36);
  glow.geometry.computeBoundingBox();
  const c = glow.geometry.boundingBox.getCenter(new THREE.Vector3());
  [0.42, 1.78, 0].forEach((v, k) => near(c.getComponent(k), v, 1e-6, 'procedural glass'));
});
