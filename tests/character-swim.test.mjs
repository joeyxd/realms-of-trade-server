import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { captureCharacterFigure } from '../src/render/assets/characterFigure.js';
import { createCharacterSwim } from '../src/render/assets/characterSwim.js';
import { bakeCharacter } from '../src/render/assets/rebind.js';

const glbPath = resolve('assets/models/buccaneer-v1-desktop.glb');

async function loadSource() {
  const bytes = await readFile(glbPath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'NodeTextureStub',
    loadTexture(index) {
      const texture = new THREE.Texture();
      texture.name = `node-stub-${index}`;
      return Promise.resolve(texture);
    },
  }));
  return loader.parseAsync(arrayBuffer, '');
}

function nativeMesh(swim) {
  const mesh = swim.meshes.find((object) => object.isSkinnedMesh);
  assert.ok(mesh, 'native swim should return its SkinnedMesh');
  return mesh;
}

function poseOf(scene) {
  const pose = {};
  scene.traverse((object) => {
    if (!object.isBone) return;
    pose[object.name] = {
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
    };
  });
  return pose;
}

function assertFiniteVertices(mesh) {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const vertex = new THREE.Vector3();
  for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
    mesh.getVertexPosition(index, vertex);
    assert.ok(Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z), `vertex ${index} stays finite`);
  }
}

test('native swim captures both source clips and strips only runtime Hips Z root motion', async () => {
  const gltf = await loadSource();
  const entry = {
    id: 'char:buccaneer-v1',
    figureAnimation: 'idle',
    swimAnimation: 'swim',
    height: 2.12,
    swimOffsetY: 0.17,
    toon: { sat: 0.8, bright: 1, posterize: 0, alphaTest: 0, normal: false, rim: 1, comic: false, flat: false },
  };
  const sourcePose = poseOf(gltf.scene);
  const captured = captureCharacterFigure(gltf, entry);
  assert.ok(captured);
  assert.equal(captured.clip.name, 'idle');
  assert.equal(captured.swimClip.name, 'swim');
  assert.deepEqual(poseOf(captured.scene), sourcePose, 'capturing clips must preserve source rest pose');

  const sourceClipState = captured.swimClip.tracks.map((track) => ({
    name: track.name,
    times: Array.from(track.times),
    values: Array.from(track.values),
  }));
  const bake = bakeCharacter(gltf.scene, entry);
  assert.equal(bake.tris, 9164);
  assert.equal(Object.keys(bake.J).length, 15, 'gameplay bake remains the existing 15-bone rig');
  assert.deepEqual(poseOf(captured.scene), sourcePose, 'baking gameplay must not mutate the captured native scene');
  const bakedSourcePose = poseOf(gltf.scene);

  const shared = {
    glow: { value: 0.7 },
    flash: { value: new THREE.Vector4(0.2, 0.3, 0.4, 0.5) },
  };
  const first = createCharacterSwim(captured, bake, entry, entry.height, shared);
  const second = createCharacterSwim(captured, bake, entry, entry.height, shared);
  assert.equal(first.nativeSwim, true);
  assert.equal(first.meshes.length, 1);
  const firstMesh = nativeMesh(first), secondMesh = nativeMesh(second);
  assert.equal(firstMesh.skeleton.bones.length, 65);
  assert.notEqual(firstMesh.skeleton, secondMesh.skeleton, 'each swimmer owns an independent skeleton');
  for (let i = 0; i < firstMesh.skeleton.bones.length; i++) {
    assert.notEqual(firstMesh.skeleton.bones[i], secondMesh.skeleton.bones[i], `bone ${i} is clone-local`);
  }
  assert.equal(firstMesh.geometry, secondMesh.geometry, 'immutable source geometry remains shared');
  assert.equal(firstMesh.material.map, secondMesh.material.map, 'albedo texture remains shared');
  assert.equal(firstMesh.material.userData.glow, shared.glow);
  assert.equal(firstMesh.material.userData.flash, shared.flash);
  assert.equal(firstMesh.frustumCulled, false);
  assert.equal(firstMesh.castShadow, true);
  assert.equal(firstMesh.receiveShadow, true);

  const fitted = first.root.children[0];
  assert.ok(Math.abs(fitted.scale.x - entry.height * bake.normalization.scale) < 1e-8);
  assert.ok(Math.abs(fitted.rotation.y - bake.normalization.rotationY) < 1e-8);
  for (let axis = 0; axis < 3; axis++) {
    const expected = bake.normalization.offset[axis] * fitted.scale.x + (axis === 1 ? 0.17 : 0);
    assert.ok(Math.abs(fitted.position.toArray()[axis] - expected) < 1e-8);
  }

  const action = first.mixer._actions.find((candidate) => candidate._clip.name === 'swim');
  assert.ok(action, 'swim action must be active on the native mixer');
  const runtimeHipsTrack = action._clip.tracks.find((track) => /(?:mixamorig)?hips/i.test(track.name) && track.name.endsWith('.position'));
  const sourceHipsTrack = captured.swimClip.tracks.find((track) => /(?:mixamorig)?hips/i.test(track.name) && track.name.endsWith('.position'));
  assert.ok(runtimeHipsTrack);
  assert.ok(sourceHipsTrack);
  const runtimeValues = runtimeHipsTrack.values;
  const sourceValues = sourceHipsTrack.values;
  const frozenZ = sourceValues[2];
  for (let index = 0; index < runtimeValues.length; index += 3) {
    assert.equal(runtimeValues[index + 2], frozenZ, `runtime hips z key ${index / 3} stays at its first value`);
    assert.equal(runtimeValues[index + 1], sourceValues[index + 1], `runtime hips bob key ${index / 3} is preserved`);
    assert.equal(runtimeValues[index], sourceValues[index], `runtime hips x key ${index / 3} is preserved`);
  }
  assert.deepEqual(captured.swimClip.tracks.map((track) => ({
    name: track.name,
    times: Array.from(track.times),
    values: Array.from(track.values),
  })), sourceClipState, 'runtime root-motion removal must not mutate the captured/source clip');

  const otherPose = poseOf(second.root);
  const firstPoseAtZero = poseOf(first.root);
  first.advance(0.1);
  assert.notDeepEqual(poseOf(first.root), firstPoseAtZero, 'native swim changes its skeleton when advanced');
  assert.deepEqual(poseOf(second.root), otherPose, 'advancing one swimmer does not advance another');
  assert.deepEqual(poseOf(captured.scene), sourcePose, 'advancing does not mutate the captured scene');
  assert.deepEqual(poseOf(gltf.scene), bakedSourcePose, 'advancing native swim does not mutate the baked gameplay rig');
  assertFiniteVertices(firstMesh);

  const hips = firstMesh.skeleton.bones.find((bone) => /(?:mixamorig)?hips/i.test(bone.name));
  assert.ok(hips);
  const rootZAtStart = hips.position.z;
  for (let step = 0; step < Math.ceil(captured.swimClip.duration / 0.1); step++) first.advance(0.1);
  assert.ok(action.time < 0.2, 'LoopRepeat should wrap after a full swim clip');
  assert.ok(Math.abs(hips.position.z - rootZAtStart) < 1e-5, 'looping swim should not accumulate Hips root Z drift');
  assertFiniteVertices(firstMesh);

  first.advance(0.08);
  first.reset();
  assert.ok(first.mixer.time < 1e-8, 'reset returns the mixer to time zero');
  assert.ok(action.time < 1e-8, 'reset returns the swim action to its first frame');
  assertFiniteVertices(firstMesh);
});

test('native swim requires an actual source clip and shared character uniforms', async () => {
  const gltf = await loadSource();
  const captured = captureCharacterFigure(gltf, { figureAnimation: 'idle', swimAnimation: 'swim' });
  const bake = bakeCharacter(gltf.scene, { height: 2.12 });
  assert.throws(() => createCharacterSwim({ scene: captured.scene }, bake, {}, 2.12, { glow: {}, flash: {} }), /source scene and clip/);
  assert.throws(() => createCharacterSwim(captured, bake, {}, 2.12, null), /shared character glow and flash/);
});
