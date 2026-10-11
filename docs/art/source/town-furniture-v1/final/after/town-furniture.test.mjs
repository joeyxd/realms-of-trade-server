import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assets } from '../src/render/assets/registry.js';
import { ResourceNodes } from '../src/render/resourceNodes.js';
import { createProps } from '../src/render/props.js';
import { TOWN_ALBEDO_ID, TOWN_NORMAL_ID, TOWN_NORMAL_STRENGTH, townRect } from '../src/render/townMaterials.js';
import { townFurnitureMaterial, townWorkbenchGeometry } from '../src/render/townFurniture.js';

function withTownTextures(textures, fn) {
  const prior = Object.getOwnPropertyDescriptor(assets, 'texture');
  assets.texture = (id) => textures[id] || null;
  try { return fn(); }
  finally { if (prior) Object.defineProperty(assets, 'texture', prior); else delete assets.texture; }
}

function sameAttribute(a, b, name) {
  assert.deepEqual(Array.from(a.getAttribute(name).array), Array.from(b.getAttribute(name).array), `${name} preserved`);
}

test('workbench is a compact mapped bake with finite role UVs and neutral tool metal', () => {
  const geometry = townWorkbenchGeometry();
  try {
    geometry.computeBoundingBox();
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    const wood = geometry.getAttribute('aTownWood');
    assert.ok(geometry.index === null || geometry.index.count / 3 <= 300);
    assert.ok(position.count / 3 <= 300, 'merged workbench stays within the triangle budget');
    assert.equal(uv.count, position.count); assert.equal(wood.count, position.count);
    const bounds = geometry.boundingBox || (geometry.computeBoundingBox(), geometry.boundingBox);
    assert.ok(bounds.min.x >= -0.75 && bounds.min.x <= -0.73);
    assert.ok(bounds.max.x >= 0.73 && bounds.max.x <= 0.75);
    assert.ok(bounds.min.z >= -0.34 && bounds.min.z <= -0.32);
    assert.ok(bounds.max.z >= 0.38 && bounds.max.z <= 0.39);
    assert.ok(bounds.max.y > 0.97 && bounds.max.y < 0.99);
    assert.ok(bounds.max.y < 1.35, 'workbench remains below the old floating gem');
    const seen = new Set(); let neutral = 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      assert.ok(Number.isFinite(u) && Number.isFinite(v));
      assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1);
      if (wood.getX(i) === 0) neutral++;
      else {
        for (const role of ['floor', 'beam', 'timber']) {
          const r = townRect(role);
          if (u >= r.u0 - 1e-6 && u <= r.u1 + 1e-6 && v >= r.v0 - 1e-6 && v <= r.v1 + 1e-6) seen.add(role);
        }
      }
    }
    for (const role of ['floor', 'beam', 'timber']) assert.ok(seen.has(role), `mapped ${role} role is present`);
    assert.ok(neutral > 0, 'vise and hammer keep their native metal colour');
    assert.equal(geometry.userData.townFurniture.texturesAdded, 0);
  } finally { geometry.dispose(); }
});

test('workbench material shares atlas paint, keeps the 0.18 normal and masks shader sampling without alpha', () => {
  const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  let material;
  try {
    material = townFurnitureMaterial(albedo, normal);
    assert.equal(material.map, albedo); assert.equal(material.normalMap, normal);
    assert.equal(material.normalScale.x, TOWN_NORMAL_STRENGTH); assert.equal(material.normalScale.y, TOWN_NORMAL_STRENGTH);
    assert.deepEqual(material.userData.townFurniture, { family: 'town-furniture-v1', normalStrength: 0.18 });
    const shader = { uniforms: {}, vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <normal_fragment_maps>\n}' };
    material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /attribute float aTownWood/);
    assert.match(shader.vertexShader, /vTownWood = aTownWood/);
    assert.match(shader.fragmentShader, /vTownWood > 0\.5/);
    assert.match(shader.fragmentShader, /#include <normal_fragment_maps>/);
    assert.doesNotMatch(shader.fragmentShader, /alphaTest|discard/);
    material.dispose(); material = null;
    material = townFurnitureMaterial(albedo, null);
    assert.equal(material.map, albedo); assert.equal(material.normalMap, null);
    assert.equal(material.userData.townFurniture.normalStrength, 0);
    material.dispose(); material = null;
    assert.equal(albedo.image.data.length, 4); assert.equal(normal.image.data.length, 4);
    assert.equal(townFurnitureMaterial(null, normal), null, 'without shared albedo, caller uses the legacy fallback');
  } finally { material?.dispose(); albedo.dispose(); normal.dispose(); }
});

test('ResourceNodes uses one mapped body and preserves node readiness, placement and identities across updates', () => {
  const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1), normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const scene = new THREE.Scene();
  try {
    withTownTextures({ [TOWN_ALBEDO_ID]: albedo, [TOWN_NORMAL_ID]: normal }, () => {
      const nodes = new ResourceNodes(scene);
      const snapshot = { nodes: [{ id: 'wood-1', kind: 'wood', x: 4, y: 2, z: 7, rev: 3, ready: true }], bench: { x: 1, y: 2, z: 3 } };
      nodes.update(snapshot, { x: 0, z: 0 }, 2);
      const record = nodes.records.get('wood-1'), bench = nodes.bench;
      const body = bench.children.find((child) => child.name === 'townWorkbench');
      assert.ok(body); assert.equal(bench.children.length, 2, 'mapped bench has one body plus its marker gem');
      assert.equal(body.geometry, nodes.benchGeometry); assert.equal(body.material, nodes.benchPaint);
      const nodeGeometry = record.mesh.geometry, nodeMaterial = record.mesh.material;
      const nodePosition = record.group.position.toArray();
      const readyVisible = record.mesh.visible;
      nodes.update(snapshot, { x: 4, z: 7 }, 3);
      assert.equal(nodes.bench, bench); assert.equal(bench.children[0], body);
      assert.equal(record.mesh.geometry, nodeGeometry); assert.equal(record.mesh.material, nodeMaterial);
      assert.deepEqual(record.group.position.toArray(), nodePosition); assert.equal(record.mesh.visible, readyVisible);
      assert.deepEqual(bench.position.toArray(), [1, 2, 3]);
      nodes.update({ nodes: [], bench: null }, { x: 0, z: 0 }, 4);
      assert.equal(nodes.bench.visible, false); assert.equal(nodes.records.size, 0);
    });
  } finally { albedo.dispose(); normal.dispose(); }
});

test('no-atlas workbench matches the saved legacy top, four legs, gem and visibility anchor', () => {
  const scene = new THREE.Scene();
  withTownTextures({}, () => {
    const nodes = new ResourceNodes(scene);
    nodes.update({ nodes: [], bench: { x: -8, y: 1.5, z: 12 } }, { x: -8, z: 12 }, 0);
    const bench = nodes.bench;
    assert.equal(bench.children.length, 6);
    const [top, ...rest] = bench.children;
    assert.equal(top.geometry, nodes.planks); assert.equal(top.material, nodes.paint);
    assert.deepEqual(top.position.toArray(), [0, 0.6, 0]); assert.deepEqual(top.scale.toArray(), [1, 0.8, 0.7]);
    const legs = rest.slice(0, 4);
    assert.ok(legs.every((leg) => leg.geometry === nodes.leg && leg.material === nodes.legPaint));
    assert.deepEqual(legs.map((leg) => leg.position.toArray()), [
      [-0.6, 0.3, -0.25], [-0.6, 0.3, 0.25], [0.6, 0.3, -0.25], [0.6, 0.3, 0.25],
    ]);
    const gem = rest[4];
    assert.equal(gem.geometry, nodes.diamond); assert.equal(gem.material, nodes.gold);
    assert.deepEqual(gem.position.toArray(), [0, 1.35, 0]);
    assert.deepEqual(bench.position.toArray(), [-8, 1.5, 12]); assert.equal(bench.visible, true);
    nodes.update({ nodes: [], bench: { x: -8, y: 1.5, z: 12 } }, { x: 30, z: 12 }, 0);
    assert.equal(bench.visible, false, 'distance 38 remains outside the existing cutoff');
    nodes.update({ nodes: [], bench: { x: -8, y: 1.5, z: 12 } }, { x: 29.99, z: 12 }, 0);
    assert.equal(bench.visible, true);
  });
});

test('tattoo stall atlas integration preserves its baked mesh and never reads simulation RNG', () => {
  const albedo = new THREE.DataTexture(new Uint8Array(4), 1, 1), normal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const ctx = new Proxy({}, { get: (_target, key) => key === 'createLinearGradient' || key === 'createRadialGradient'
    ? () => ({ addColorStop() {} }) : () => {} });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const map = { props: [], npcs: [{ id: 'tattoo', x: 10, z: 20, facing: 0.4 }], groundAt: () => 0,
    dock: { len: 0, halfWidth: 0, deckY: 0, base: { x: 0, z: 0 }, dir: { x: 0, z: 1 } },
    get rng() { throw new Error('rendering must not read simulation RNG'); } };
  function build(mapped) {
    return withTownTextures(mapped ? { [TOWN_ALBEDO_ID]: albedo, [TOWN_NORMAL_ID]: normal } : {}, () => {
      const out = createProps(map);
      return { out, chunk: out.group.children.find((child) => child.name === 'propsChunk') };
    });
  }
  try {
    const plain = build(false), painted = build(true);
    assert.ok(plain.chunk && painted.chunk);
    for (const name of ['position', 'normal', 'color']) sameAttribute(plain.chunk.geometry, painted.chunk.geometry, name);
    assert.deepEqual(Array.from(plain.chunk.geometry.index?.array || []), Array.from(painted.chunk.geometry.index?.array || []));
    assert.deepEqual(plain.chunk.matrix.toArray(), painted.chunk.matrix.toArray());
    assert.equal(painted.chunk.material.map, albedo); assert.equal(painted.chunk.material.normalMap, normal);
    assert.equal(painted.chunk.geometry.getAttribute('aTownWood').count, painted.chunk.geometry.getAttribute('position').count);
    plain.chunk.geometry.dispose(); painted.chunk.geometry.dispose();
    plain.chunk.material.dispose(); painted.chunk.material.dispose();
    plain.out.group.traverse((o) => { if (o.geometry && o.name !== 'propsChunk') o.geometry.dispose(); if (o.material && o.name !== 'propsChunk') o.material.dispose(); });
    painted.out.group.traverse((o) => { if (o.geometry && o.name !== 'propsChunk') o.geometry.dispose(); if (o.material && o.name !== 'propsChunk') o.material.dispose(); });
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else delete globalThis.document;
    albedo.dispose(); normal.dispose();
  }
});
