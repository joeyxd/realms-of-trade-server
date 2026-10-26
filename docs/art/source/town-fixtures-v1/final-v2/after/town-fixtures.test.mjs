import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assets } from '../src/render/assets/registry.js';
import { bbox, cone, cyl, merge, part, rbox } from '../src/render/geo.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID, TOWN_NORMAL_STRENGTH, townRect } from '../src/render/townMaterials.js';
import { townLanternGeometry, townSignGeometry, townSignInk, townSignMaterial, townSignPostGeometry } from '../src/render/townFixtures.js';
import { createProps } from '../src/render/props.js';

function assertAttributeEqual(a, b, name) {
  assert.deepEqual(Array.from(a.getAttribute(name).array), Array.from(b.getAttribute(name).array), `${name} remains byte-for-byte stable`);
}

function legacyLanternGeometry() {
  const pieces = [
    part(cyl(.07, .09, 2.2, 6), 0x8a5a2e, { pos: [0, 1.1, 0] }),
    part(rbox(.5, .06, .06, .02), 0x8a5a2e, { pos: [.2, 2.15, 0] }),
    part(rbox(.34, .06, .34, .02), 0x3a2a20, { pos: [.42, 1.95, 0] }),
    part(cone(.24, .18, 4), 0x3a2a20, { pos: [.42, 2.07, 0], rot: [0, Math.PI / 4, 0] }),
  ];
  const geometry = merge(pieces);
  pieces.forEach((piece) => piece.dispose());
  return geometry;
}

test('mapped lantern keeps its legacy vertex paint and shape before the 80-triangle cage', () => {
  const legacy = legacyLanternGeometry(), mapped = townLanternGeometry(true), fallback = townLanternGeometry(false);
  try {
    const baseVertices = legacy.getAttribute('position').count;
    for (const name of ['position', 'normal', 'color']) {
      assert.deepEqual(Array.from(mapped.getAttribute(name).array.slice(0, baseVertices * mapped.getAttribute(name).itemSize)),
        Array.from(legacy.getAttribute(name).array), `legacy lantern ${name} prefix is unchanged`);
      assertAttributeEqual(fallback, legacy, name);
    }
    assert.equal(mapped.getAttribute('position').count - baseVertices, 80 * 3);
    legacy.computeBoundingBox(); mapped.computeBoundingBox();
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(mapped.boundingBox.min[axis] >= legacy.boundingBox.min[axis] - 1e-6);
      assert.ok(mapped.boundingBox.max[axis] <= legacy.boundingBox.max[axis] + 1e-6);
    }
    const uv = mapped.getAttribute('uv'), mask = mapped.getAttribute('aTownWood');
    assert.equal(uv.count, mapped.getAttribute('position').count);
    assert.equal(mask.count, uv.count);
    assert.ok(Array.from(uv.array).every(Number.isFinite));
    const roles = new Map(['timber', 'beam'].map((role) => [role, townRect(role)]));
    let timber = 0, beam = 0, neutral = 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i), mappedRole = [...roles].find(([, r]) => u >= r.u0 - 1e-6 && u <= r.u1 + 1e-6 && v >= r.v0 - 1e-6 && v <= r.v1 + 1e-6)?.[0];
      if (mask.getX(i) === 0) neutral++;
      else if (mappedRole === 'timber') timber++;
      else if (mappedRole === 'beam') beam++;
      else assert.fail(`mapped lantern wood vertex has no timber or beam atlas tile at ${i}`);
    }
    assert.ok(timber > 0 && beam > 0 && neutral > 0, 'pole and crossbeam use wood while hood/cage stays neutral');
    assert.deepEqual(mapped.userData.townFixtures, { family: 'town-fixtures-v1', kind: 'lantern', mapped: true, addedTriangles: 80, texturesDownloaded: 0 });
  } finally { legacy.dispose(); mapped.dispose(); fallback.dispose(); }
});

test('signpost mapping changes UV attributes only', () => {
  const mapped = townSignPostGeometry(true), fallback = townSignPostGeometry(false);
  try {
    for (const name of ['position', 'normal', 'color']) assertAttributeEqual(mapped, fallback, name);
    const uv = mapped.getAttribute('uv'), mask = mapped.getAttribute('aTownWood');
    assert.equal(uv.count, mapped.getAttribute('position').count);
    assert.ok(Array.from(uv.array).every(Number.isFinite));
    assert.ok(Array.from(mask.array).every((value) => value === 1));
  } finally { mapped.dispose(); fallback.dispose(); }
});

test('painted sign boards preserve both legacy sizes, face the post, and ink only +Z', () => {
  const legacy = [false, true].map((cala) => {
    const geometry = new THREE.BoxGeometry(1.5, cala ? 1.45 : 1.1, .1).toNonIndexed();
    geometry.translate(0, 0, .16);
    return geometry;
  });
  const boards = [false, true].map((cala) => townSignGeometry(cala));
  try {
    for (let k = 0; k < boards.length; k++) {
      const board = boards[k], source = legacy[k], uv = board.getAttribute('uv'), ink = board.getAttribute('aSignInk'), normal = board.getAttribute('normal');
      assert.equal(board.getAttribute('position').count / 3, 12);
      assertAttributeEqual(board, source, 'position');
      assert.deepEqual(board.boundingBox, null);
      board.computeBoundingBox(); source.computeBoundingBox();
      assert.deepEqual(board.boundingBox.min.toArray(), source.boundingBox.min.toArray());
      assert.deepEqual(board.boundingBox.max.toArray(), source.boundingBox.max.toArray());
      assert.equal(uv.count, board.getAttribute('position').count);
      assert.ok(Array.from(uv.array).every(Number.isFinite));
      assert.equal(ink.count, uv.count);
      let faceInk = 0, plainWood = 0;
      const positiveZ = [];
      for (let i = 0; i < ink.count; i++) {
        const paintedFace = normal.getZ(i) > .5;
        assert.equal(ink.getZ(i), paintedFace ? 1 : 0);
        if (paintedFace) { faceInk++; positiveZ.push(i); } else plainWood++;
      }
      assert.equal(faceInk, 6, 'only the two triangles on the +Z face receive glyph ink');
      assert.ok(plainWood > 0, 'back and edge faces keep plain planks');
      const x = board.getAttribute('position'), ys = positiveZ.map((i) => x.getY(i)), xs = positiveZ.map((i) => x.getX(i));
      const us = positiveZ.map((i) => uv.getX(i)), vs = positiveZ.map((i) => uv.getY(i));
      const covariance = (a, b) => a.reduce((sum, value, j) => sum + (value - a.reduce((m, n) => m + n, 0) / a.length) * (b[j] - b.reduce((m, n) => m + n, 0) / b.length), 0);
      assert.notEqual(Math.sign(covariance(ys, us)), 0, 'quarter-turn maps plank U along sign height');
      assert.notEqual(Math.sign(covariance(xs, vs)), 0, 'quarter-turn maps plank V along sign width');
    }
  } finally { legacy.forEach((g) => g.dispose()); boards.forEach((g) => g.dispose()); }
});

test('sign ink material shares atlas inputs and keeps the glyph shader variant stable', () => {
  const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1), normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const ink = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const withNormal = townSignMaterial(albedo, normal, ink), withoutNormal = townSignMaterial(albedo, null, ink);
  try {
    assert.equal(withNormal.map, albedo); assert.equal(withNormal.normalMap, normal);
    assert.equal(withNormal.normalScale.x, TOWN_NORMAL_STRENGTH); assert.equal(withNormal.normalScale.y, TOWN_NORMAL_STRENGTH);
    assert.equal(withNormal.userData.townFixtures.normalStrength, .18);
    assert.equal(withoutNormal.map, albedo); assert.equal(withoutNormal.normalMap, null);
    assert.equal(withoutNormal.userData.townFixtures.normalStrength, 0);
    assert.equal(withNormal.userData.townFixtures.ink, ink);
    assert.equal(withNormal.customProgramCacheKey(), withoutNormal.customProgramCacheKey());
    const shader = { uniforms: {}, vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}', fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n}' };
    withNormal.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /attribute vec3 aSignInk/);
    assert.match(shader.vertexShader, /vSignInk = aSignInk/);
    assert.match(shader.fragmentShader, /uniform sampler2D mnSignInk/);
    assert.match(shader.fragmentShader, /letters\.a \* vSignInk\.z/);
    assert.equal(shader.uniforms.mnSignInk.value, ink);
  } finally { withNormal.dispose(); withoutNormal.dispose(); albedo.dispose(); normal.dispose(); ink.dispose(); }
});

test('createProps attaches mapped town signs and fixtures without downloading textures or reading map RNG', () => {
  const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1), normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const priorTexture = Object.getOwnPropertyDescriptor(assets, 'texture');
  const priorCreateElement = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (target[key] = () => {}) , set: (target, key, value) => (target[key] = value, true) });
  globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
  const map = {
    props: [
      { kind: 'lantern', x: 1, y: 0, z: 2, rot: 0, scale: 1 },
      { kind: 'sign', x: 3, y: 0, z: 4, rot: 0, scale: 1 },
    ], npcs: [], dock: { len: 2, halfWidth: 1, deckY: .8, base: { x: 0, z: 0 }, dir: { x: 0, z: 1 } },
    groundAt: () => 0,
    get rng() { throw new Error('render props must not read simulation RNG'); },
  };
  assets.texture = (id) => id === TOWN_ALBEDO_ID ? albedo : id === TOWN_NORMAL_ID ? normal : null;
  try {
    const out = createProps(map), sign = out.group.children.find((child) => child.name === 'townSign');
    assert.ok(sign?.isMesh);
    assert.equal(sign.userData.townFixtures.mapped, true);
    assert.equal(sign.material.map, albedo);
    assert.equal(sign.material.normalMap, normal);
    const chunk = out.group.children.find((child) => child.name === 'propsChunk');
    assert.ok(chunk);
    assert.ok(chunk.geometry.getAttribute('uv'));
    assert.ok(chunk.geometry.getAttribute('aTownWood'));
    assert.equal(chunk.userData.townWood.mapped, true);
    assert.equal(townSignInk(false).name, 'town-sign:caldera-ink');
    assert.equal(map.props.length, 2);
    out.group.traverse((child) => { child.geometry?.dispose(); if (child.material && !Array.isArray(child.material)) child.material.dispose(); });
  } finally {
    if (priorTexture) Object.defineProperty(assets, 'texture', priorTexture); else delete assets.texture;
    if (priorCreateElement) Object.defineProperty(globalThis, 'document', priorCreateElement); else delete globalThis.document;
    albedo.dispose(); normal.dispose();
  }
});
