// Imported world props with variants (T-1018-34): the two stilt huts and the market stall.
// Headless, no WebGL: the manifest contract, the registry's variant lookup, the deterministic hut split, the lit
// windows on the imported huts, and the procedural fallback while the models are absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Assets, assets } from '../src/render/assets/registry.js';
import { normalizeManifest } from '../src/render/assets/manifest.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createProps, propVariants } from '../src/render/props.js';
import { readGlb } from '../tools/glb.mjs';

const ROOT = new URL('../', import.meta.url);
const manifestJson = JSON.parse(readFileSync(new URL('assets/manifest.json', ROOT), 'utf8'));
const SHINGLE = 'prop:hut-stilt-shingle', THATCH = 'prop:hut-stilt-thatch', STALL = 'prop:market-stall-awning';

// POSITION vertices of a GLB (root nodes without a transform: asserted).
function glbPositions(path) {
  const { json, bin } = readGlb(readFileSync(new URL(path, ROOT)));
  for (const n of json.nodes || []) {
    assert.ok(!n.matrix && !n.translation?.some((v) => v) && !n.scale?.some((v) => v !== 1) && !n.rotation?.some((v, i) => v !== [0, 0, 0, 1][i]),
      'the model nodes carry no transform');
  }
  const out = [];
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    const acc = json.accessors[prim.attributes.POSITION], view = json.bufferViews[acc.bufferView];
    assert.equal(acc.componentType, 5126, 'float32 positions');
    const stride = view.byteStride || 12, base = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < acc.count; i++) out.push([0, 4, 8].map((o) => dv.getFloat32(base + i * stride + o, true)));
  }
  return out;
}

const rotateY = (p, deg) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; // three.js Object3D.rotation.y
};

function villageHuts() {
  const map = generateWorld(1337);
  const huts = map.props.filter((p) => p.kind === 'hut');
  assert.equal(huts.length, 6, 'six village huts');
  return { map, huts };
}

function propMap(props) {
  return { props, npcs: [], groundAt: () => 0, dock: { len: 0, halfWidth: 0, deckY: 0, base: { x: 0, z: 9 }, dir: { x: 0, z: 1 } } };
}

function withAssets(overrides, fn) {
  const prior = new Map(Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(assets, key)]));
  Object.assign(assets, overrides);
  try { return fn(); }
  finally { for (const [key, d] of prior) { if (d) Object.defineProperty(assets, key, d); else delete assets[key]; } }
}

function dispose(group) {
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}

test('manifest: two hut variants and one stall, each turned to the game forward, no registry errors', () => {
  const m = normalizeManifest(manifestJson);
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.byPropAll.get('hut'), [SHINGLE, THATCH]);
  assert.equal(m.byProp.get('hut'), SHINGLE, 'propId keeps the first variant');
  assert.deepEqual(m.byPropAll.get('stall'), [STALL]);
  for (const id of [SHINGLE, THATCH, STALL]) {
    const e = m.entries.get(id);
    assert.equal(e.kind, 'prop', id);
    assert.equal(e.fit, 'proc', id);
    assert.equal(e.rotY, -90, `${id}: the GLB front is +x, rotY -90 turns it to the game's +z`);
  }
});

test('the hut GLBs have their steps on +x (the front the manifest rotY turns to +z)', () => {
  for (const file of ['assets/models/prop-hut-stilt-shingle-v2-desktop.glb', 'assets/models/prop-hut-stilt-thatch-v2-desktop.glb']) {
    const pts = glbPositions(file);
    const lowest = (side) => Math.min(...pts.filter((p) => (side > 0 ? p[0] > 0.48 : p[0] < -0.48)).map((p) => p[1]));
    assert.ok(lowest(1) < -0.3, `${file}: the steps reach the ground on +x`);
    assert.ok(lowest(-1) > -0.1, `${file}: the back (-x) is only the roof overhang`);
    // After rotY -90 that front is +z.
    const front = pts.filter((p) => p[0] > 0.48).map((p) => rotateY(p, -90));
    assert.ok(front.every((p) => p[2] > 0.47), `${file}: the front lands on +z`);
  }
});

test('registry: propIds lists the loaded variants in manifest order and propId keeps the first', () => {
  const reg = new Assets();
  reg.man = normalizeManifest(manifestJson);
  const loaded = (id) => reg.state.set(id, { state: 'ok', data: { parts: [{}], min: [-0.5, 0, -0.4], max: [0.5, 0.76, 0.4] } });
  assert.deepEqual(reg.propIds('hut'), []);
  assert.equal(reg.propId('hut'), null);
  loaded(THATCH);
  assert.deepEqual(reg.propIds('hut'), [THATCH], 'a missing first variant leaves the second');
  loaded(SHINGLE);
  assert.deepEqual(reg.propIds('hut'), [SHINGLE, THATCH]);
  assert.equal(reg.propId('hut'), SHINGLE);
  loaded(STALL);
  assert.deepEqual(reg.propIds('stall'), [STALL]);
  assert.deepEqual(reg.propIds('crate'), []);
  const fit = reg.fitted(SHINGLE, { w: 5.5, h: 5.7 });
  assert.ok(fit && fit.s > 0 && Math.abs(fit.min[1]) < 1e-9, 'the fitted model stands on y = 0');
  assert.equal(reg.fitted('prop:nope'), null);
});

test('hut split: deterministic, order independent, both models used by the six village huts', () => {
  const { huts } = villageHuts();
  const a = propVariants(huts, 2);
  assert.deepEqual(propVariants(huts, 2), a, 'same input, same split');
  const count = [0, 0];
  for (const v of a) count[v]++;
  assert.ok(count[0] >= 2 && count[1] >= 2, `both models at least twice: ${count}`);
  // The pick follows the hut's position, not its place in the list.
  const reversed = [...huts].reverse();
  const b = propVariants(reversed, 2);
  huts.forEach((h, i) => assert.equal(b[reversed.indexOf(h)], a[i], `hut ${i} keeps its model`));
  assert.deepEqual(propVariants(huts, 1), huts.map(() => 0));
  assert.deepEqual(propVariants([], 2), []);
});

test('createProps splits the huts between the two models and lights their windows', () => {
  const { huts } = villageHuts();
  const counts = new Map(), fitCalls = [];
  withAssets({
    propIds: (kind) => (kind === 'hut' ? [SHINGLE, THATCH] : []),
    propId: (kind) => (kind === 'hut' ? SHINGLE : null),
    fitted: (id) => { fitCalls.push(id); return { s: 7, x: 0, y: 2.7, z: -0.5 }; },
    instanced: (id, matrices) => { counts.set(id, (counts.get(id) || 0) + matrices.length); const g = new THREE.Group(); g.name = id; return g; },
  }, () => {
    const out = createProps(propMap(huts.map((h) => ({ ...h }))));
    try {
      const split = propVariants(huts, 2);
      const nShingle = split.filter((v) => v === 0).length, nThatch = split.length - nShingle;
      assert.equal(counts.get(SHINGLE), nShingle);
      assert.equal(counts.get(THATCH), nThatch);
      assert.equal(nShingle + nThatch, 6);
      assert.ok(counts.get(SHINGLE) >= 2 && counts.get(THATCH) >= 2);
      const win = out.group.getObjectByName('hutWindows');
      assert.ok(win, 'the window glow exists for imported huts');
      const boxes = win.geometry.getAttribute('position').count / 36;
      assert.equal(boxes, 3 * nShingle + 2 * nThatch, 'shingle: front + two sides; thatch: front + one side');
      assert.equal(fitCalls.filter((id) => id === SHINGLE).length, 1, 'the fit is looked up once per model');
    } finally { dispose(out.group); }
  });
});

test('createProps still builds the procedural hut, stall and window glow while no model is loaded', () => {
  const { huts } = villageHuts();
  const props = [...huts.map((h) => ({ ...h })), { kind: 'stall', x: -95, y: 0, z: 9, rot: Math.PI * 1.25, scale: 1 }];
  assert.equal(assets.propIds('hut').length, 0, 'no model state in this process');
  const out = createProps(propMap(props));
  try {
    assert.ok(out.group.getObjectByName('hutWindows'), 'procedural huts keep their lit windows');
    assert.ok(out.group.children.some((c) => c.name === 'propsChunk'), 'the procedural props are baked');
    assert.ok(!out.group.children.some((c) => /^prop:/.test(c.name)), 'no imported instances');
  } finally { dispose(out.group); }
});
