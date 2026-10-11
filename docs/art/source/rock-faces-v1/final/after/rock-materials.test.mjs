import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assets } from '../src/render/assets/registry.js';
import { createVegetation } from '../src/render/vegetation.js';
import { COAST_ROCK_ID } from '../src/render/coastRockGeometry.js';
import { isNaturalRock, naturalRockMaterial, ROCK_PALETTE } from '../src/render/rockMaterials.js';

const EPS = 1e-6;

function masksAt(x) {
  if (x === 1) return { path: 0, volcanic: 0.2, arenaFloor: 0, lava: 0 };
  if (x === 2) return { path: 0, volcanic: 0, arenaFloor: 0.1, lava: 0 };
  if (x === 3) return { path: 0, volcanic: 0, arenaFloor: 0, lava: 0.1 };
  return { path: 0, volcanic: 0, arenaFloor: 0, lava: 0 };
}

function mapFixture() {
  const props = [
    { kind: 'rock', x: 0, z: 0, y: 1, scale: 1.2, rot: 0.35, v: 0.2 },
    { kind: 'rock', x: 1, z: 0, y: 1, scale: 0.9, rot: 0.7, v: 0.8 },
    { kind: 'rock', x: 2, z: 0, y: 1, scale: 1.1, rot: 1.1, v: 0.7 },
    { kind: 'rock', x: 3, z: 0, y: 1, scale: 0.8, rot: 1.5, v: 0.9 },
    { kind: 'rock', x: 4, z: 0, y: 1, scale: 1, rot: 0.5, v: 0.4 },
  ];
  const map = {
    seed: 814, half: 6, props, landmarks: {}, npcs: [], racks: [], enemySpawns: [],
    heightAt: () => 1,
    materialAt: (x) => x === 4 ? 'sand' : 'grass',
    masks: masksAt,
    onDock: () => false,
  };
  Object.defineProperty(map, 'rng', { configurable: true, get() { throw new Error('rock material is cosmetic and must not consume world RNG'); } });
  return map;
}

function geometryState(geometry) {
  return {
    index: geometry.index ? [...geometry.index.array] : null,
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attr]) => [name, [...attr.array]])),
    groups: geometry.groups.map((item) => ({ ...item })),
  };
}

function restoreMethod(object, name, descriptor) {
  if (descriptor) Object.defineProperty(object, name, descriptor);
  else delete object[name];
}

function rockGroup(root, name) {
  return root.children.find((child) => child.name === name);
}

test('natural rock material exposes a shared painted palette without adding a texture', () => {
  const material = naturalRockMaterial('test-rock-paint');
  try {
    assert.ok(material instanceof THREE.MeshToonMaterial);
    assert.equal(material.vertexColors, true);
    assert.notEqual(material.flatShading, true, 'lighting continues to use the existing smooth surface normals');
    assert.deepEqual(material.userData.rockPaint.palette, ROCK_PALETTE);
    assert.equal(material.userData.rockPaint.family, 'rock-faces-v1');
    assert.equal(material.userData.rockPaint.texturesAdded, 0);
    assert.equal(material.userData.rockPaint.paintedFaces, true);
    assert.deepEqual(material.userData.rockPaint.wetHeight, [0.02, 0.42]);
    for (const [name, expected] of Object.entries(ROCK_PALETTE)) {
      const uniform = material.userData.rockPaint.uniforms[`mnRock${name[0].toUpperCase()}${name.slice(1)}`];
      assert.ok(uniform?.value?.isColor, `${name} is supplied as a color uniform`);
      assert.equal(uniform.value.getHex(), expected);
    }
  } finally {
    material.dispose();
  }
});

test('natural rock eligibility preserves path use and excludes volcanic, arena, and lava masks', () => {
  const map = { masks: masksAt };
  assert.equal(isNaturalRock(map, { kind: 'rock', x: 0, z: 0 }), true);
  assert.equal(isNaturalRock(map, { kind: 'rock', x: 1, z: 0 }), false, 'volcanic boundary stays on legacy paint');
  assert.equal(isNaturalRock(map, { kind: 'rock', x: 2, z: 0 }), false, 'arena boundary stays on legacy paint');
  assert.equal(isNaturalRock(map, { kind: 'rock', x: 3, z: 0 }), false, 'lava boundary stays on legacy paint');
  assert.equal(isNaturalRock(map, { kind: 'tree', x: 0, z: 0 }), false);
  assert.equal(isNaturalRock({ masks: () => ({ ...masksAt(0), path: 1 }) }, { kind: 'rock', x: 0, z: 0 }), true,
    'the cosmetic paint does not introduce a path placement rule');
});

test('rock paint uniforms are per material while the material key remains part of the shader variant', () => {
  const first = naturalRockMaterial('natural-rock-a');
  const second = naturalRockMaterial('natural-rock-b');
  try {
    assert.notEqual(first.customProgramCacheKey(), second.customProgramCacheKey());
    const a = first.userData.rockPaint.uniforms.mnRockBase.value;
    const b = second.userData.rockPaint.uniforms.mnRockBase.value;
    assert.notEqual(a, b, 'separate material instances do not share mutable color uniforms');
    a.set(0, 0, 0);
    assert.equal(b.getHex(), ROCK_PALETTE.base, 'changing one material uniform leaves the other palette intact');
  } finally {
    first.dispose(); second.dispose();
  }
});

test('vegetation paints only eligible rocks and preserves source geometry and every rock transform', () => {
  const source = new THREE.BoxGeometry(1.2, 0.8, 1.1, 2, 2, 2);
  const sourceBefore = geometryState(source);
  const oldData = Object.getOwnPropertyDescriptor(assets, 'data');
  assets.data = (id) => id === COAST_ROCK_ID ? { parts: [{ geo: source }] } : null;
  const map = mapFixture();
  const propsBefore = structuredClone(map.props);
  let rendered;
  try {
    rendered = createVegetation(map);
    assert.deepEqual(map.props, propsBefore, 'render construction leaves world props unchanged');
    assert.deepEqual(geometryState(source), sourceBefore, 'coast model source remains unchanged');
    assert.deepEqual(rendered.group.userData.rockFaces, {
      family: 'rock-faces-v1', natural: 2, coastal: 1, legacy: 3, texturesAdded: 0, cosmetic: true,
    });

    const natural = rockGroup(rendered.group, 'rocks0').children[0];
    const legacy = rockGroup(rendered.group, 'volcanicRocks1').children[0];
    const coastal = rockGroup(rendered.group, 'coastRocks0').children[0];
    assert.ok(natural.material.userData.rockPaint, 'eligible procedural rock gets the shared natural paint');
    assert.ok(coastal.material.userData.rockPaint, 'existing S02 coast rock uses the same natural paint');
    assert.equal(coastal.material, natural.material);
    assert.equal(legacy.material.userData.rockPaint, undefined, 'volcanic, arena, and lava rocks retain legacy paint');

    const naturalMatrix = new THREE.Matrix4();
    natural.getMatrixAt(0, naturalMatrix);
    const expectedNatural = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 1, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2 * 0.4 - 0.2, 0.35, 0.2 * 0.3 - 0.15)),
      new THREE.Vector3(1.2, 1.2 * (0.8 + 0.2 * 0.4), 1.2),
    );
    assert.ok(naturalMatrix.elements.every((value, index) => Math.abs(value - expectedNatural.elements[index]) <= EPS),
      'procedural rock keeps its preexisting position, rotation, and scale');

    const coastMatrix = new THREE.Matrix4();
    coastal.getMatrixAt(0, coastMatrix);
    const expectedCoast = new THREE.Matrix4().compose(new THREE.Vector3(4, 1 - 0.035, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5), new THREE.Vector3(1, 1, 1));
    assert.ok(coastMatrix.elements.every((value, index) => Math.abs(value - expectedCoast.elements[index]) <= EPS),
      'S02 coast placement remains at its sampled base with the same yaw and scale');
  } finally {
    if (rendered) rendered.group.traverse((object) => {
      if (object.isMesh || object.isInstancedMesh) {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
      }
    });
    restoreMethod(assets, 'data', oldData);
    source.dispose();
  }
});
