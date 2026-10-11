import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PortraitStudio } from '../src/render/characters.js';
import { U } from '../src/render/toon.js';
import { captureCharacterFigure, createCharacterFigure } from '../src/render/assets/characterFigure.js';
import { normalizeManifest } from '../src/render/assets/manifest.js';
import { bakeCharacter } from '../src/render/assets/rebind.js';
import { BONES } from '../src/render/charkit.js';
import { LOOKS } from '../src/render/charlooks.js';

const root = resolve('.');
const glbPath = resolve(root, 'assets/models/buccaneer-v1-desktop.glb');
const manifestPath = resolve(root, 'assets/manifest.json');

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

function skeletonOf(figure) {
  let mesh = null;
  figure.root.traverse((object) => { if (!mesh && object.isSkinnedMesh) mesh = object; });
  assert.ok(mesh, 'figure scene must contain a SkinnedMesh');
  return mesh;
}

function close(a, b, epsilon = 1e-6) {
  assert.ok(Math.abs(a - b) <= epsilon, `${a} differs from ${b} by more than ${epsilon}`);
}

async function loadBuccaneer() {
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

function fakeRenderer(failurePoint) {
  const renderer = {
    autoClear: false,
    clearColor: new THREE.Color(0x234567),
    clearAlpha: 0.37,
    target: { name: 'previous-render-target' },
    clearCalls: 0,
    renderCalls: 0,
    readCalls: 0,
    getClearColor(out) { return out.copy(this.clearColor); },
    getClearAlpha() { return this.clearAlpha; },
    getRenderTarget() { return this.target; },
    setRenderTarget(target) { this.target = target; },
    setClearColor(color, alpha) {
      this.clearColor = color?.isColor ? color.clone() : new THREE.Color(color);
      this.clearAlpha = alpha;
    },
    clear() { this.clearCalls++; },
    render() {
      this.renderCalls++;
      if (failurePoint === 'render') throw new Error('fake render failure');
    },
    readRenderTargetPixels() {
      this.readCalls++;
      if (failurePoint === 'read') throw new Error('fake readback failure');
    },
  };
  return renderer;
}

test('native Buccaneer figure captures the real idle before bake, clones its Mixamo skeleton, and leaves gameplay rig alone', async () => {
  const gltf = await loadBuccaneer();
  const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifest = normalizeManifest(rawManifest, { looks: LOOKS.map((look) => look.name) });
  assert.deepEqual(manifest.errors, []);
  const entry = manifest.entries.get('char:buccaneer-v1');
  assert.ok(entry);
  assert.equal(entry.figureAnimation, 'idle');
  const look = LOOKS[2];
  assert.equal(look.name, 'Bucanero');

  const sourcePose = poseOf(gltf.scene);
  const captured = captureCharacterFigure(gltf, entry);
  assert.ok(captured);
  assert.equal(captured.clip.name, 'idle');
  assert.notEqual(captured.scene, gltf.scene);
  assert.deepEqual(poseOf(captured.scene), sourcePose, 'capture must preserve the source rest pose');

  const bake = bakeCharacter(gltf.scene, entry);
  assert.equal(bake.tris, 9164);
  assert.equal(Object.keys(bake.J).length, BONES.length);
  assert.equal(BONES.length, 15, 'gameplay remains on the existing 15-bone rig');
  assert.notDeepEqual(poseOf(gltf.scene), sourcePose, 'bake should pose its own source scene for the gameplay mesh');
  const bakedGameplayPose = poseOf(gltf.scene);
  assert.deepEqual(poseOf(captured.scene), sourcePose, 'bake must not mutate the captured native figure');
  assert.ok(bake.normalization.scale > 0);
  assert.ok(Number.isFinite(bake.normalization.rotationY));
  assert.ok(bake.normalization.offset.every(Number.isFinite));

  const height = 2.12;
  const first = createCharacterFigure(captured, bake, entry, look, height);
  const second = createCharacterFigure(captured, bake, entry, look, height);
  assert.equal(first.nativeIdle, true);
  assert.equal(first.height, height);
  assert.equal(first.ext.id, entry.id);
  const fitted = first.root.children[0];
  close(fitted.scale.x, height * bake.normalization.scale);
  close(fitted.rotation.y, bake.normalization.rotationY);
  for (let axis = 0; axis < 3; axis++) close(fitted.position.toArray()[axis], bake.normalization.offset[axis] * fitted.scale.x);

  const firstMesh = skeletonOf(first), secondMesh = skeletonOf(second);
  assert.equal(firstMesh.skeleton.bones.length, 65);
  assert.equal(secondMesh.skeleton.bones.length, 65);
  assert.notEqual(firstMesh.skeleton, secondMesh.skeleton);
  for (let index = 0; index < firstMesh.skeleton.bones.length; index++) {
    assert.notEqual(firstMesh.skeleton.bones[index], secondMesh.skeleton.bones[index], `bone ${index} must be clone-local`);
  }
  assert.equal(firstMesh.geometry, secondMesh.geometry, 'cloned figures may share immutable geometry');
  assert.equal(firstMesh.material.map, secondMesh.material.map, 'toon materials should retain the shared albedo texture');
  assert.equal(firstMesh.material.map, captured.scene.getObjectByProperty('isSkinnedMesh', true).material.map);

  const capturedBeforeAdvance = poseOf(captured.scene);
  const untouchedFigurePose = poseOf(second.root);
  const animatedPoseAtZero = poseOf(first.root);
  assert.notDeepEqual(animatedPoseAtZero.mixamorigLeftArm.quaternion, sourcePose.mixamorigLeftArm.quaternion,
    'AnimationMixer.update(0) must apply the idle first frame instead of showing the T/rest pose');
  first.advance(0.08);
  assert.notDeepEqual(poseOf(first.root), animatedPoseAtZero, 'advancing idle should animate the native skeleton');
  assert.deepEqual(poseOf(second.root), untouchedFigurePose, 'advancing one mixer must not move another figure');
  assert.deepEqual(poseOf(captured.scene), capturedBeforeAdvance, 'advancing a figure must not mutate its captured source');
  assert.deepEqual(poseOf(gltf.scene), bakedGameplayPose, 'advancing a native figure must not mutate the baked gameplay rig');

  firstMesh.updateMatrixWorld(true);
  firstMesh.skeleton.update();
  const vertex = new THREE.Vector3();
  for (let index = 0; index < firstMesh.geometry.attributes.position.count; index++) {
    firstMesh.getVertexPosition(index, vertex);
    assert.ok(Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z), `vertex ${index} is finite`);
  }

  const mixerTime = first.mixer.time;
  first.advance(10);
  close(first.mixer.time - mixerTime, 0.1, 1e-8, 'preview delta must clamp to 0.1 seconds');
  const clampedTime = first.mixer.time;
  first.advance(-1);
  close(first.mixer.time, clampedTime, 1e-8, 'negative preview delta must clamp to zero');

  const reference = createCharacterFigure(captured, bake, entry, look, height);
  reference.advance(0.05);
  const referencePose = poseOf(reference.root);
  first.mixer.setTime(captured.clip.duration - 0.05);
  first.advance(0.1);
  const loopedAction = first.mixer.existingAction(captured.clip);
  assert.ok(loopedAction.time >= 0 && loopedAction.time < 0.1, 'idle action must wrap at its clip end');
  const loopedPose = poseOf(first.root);
  for (const [name, transform] of Object.entries(referencePose)) {
    assert.ok(loopedPose[name], `missing looped bone ${name}`);
    for (let axis = 0; axis < 4; axis++) close(loopedPose[name].quaternion[axis], transform.quaternion[axis], 2e-5,
      `${name} should return to the corresponding early-loop pose without a visible seam`);
  }
});

test('PortraitStudio.shoot restores renderer, shader, and scene state when render or readback throws', () => {
  for (const failurePoint of ['render', 'read']) {
    const renderer = fakeRenderer(failurePoint);
    const originalColor = renderer.clearColor.clone();
    const originalAlpha = renderer.clearAlpha;
    const originalAutoClear = renderer.autoClear;
    const originalTarget = renderer.target;
    const originalUniforms = {
      cloud: U.mnCloud.value,
      lights: U.mnLightCount.value,
      glow: U.mnGlowOut.value,
      fill: U.mnCharFill.value.clone(),
    };
    const studio = Object.create(PortraitStudio.prototype);
    studio.r = renderer;
    studio.scene = new THREE.Scene();
    const parent = new THREE.Group();
    const rootObject = new THREE.Group();
    parent.add(rootObject);
    const view = { root: rootObject };

    assert.throws(() => studio.shoot(view, {}, { name: 'temporary-target' }, new Uint8Array(4), 1, 1), new RegExp(`fake ${failurePoint}`));
    assert.equal(renderer.target, originalTarget, `${failurePoint}: render target restored`);
    assert.ok(renderer.clearColor.equals(originalColor), `${failurePoint}: clear color restored`);
    assert.equal(renderer.clearAlpha, originalAlpha, `${failurePoint}: clear alpha restored`);
    assert.equal(renderer.autoClear, originalAutoClear, `${failurePoint}: autoClear restored`);
    assert.equal(U.mnCloud.value, originalUniforms.cloud, `${failurePoint}: cloud uniform restored`);
    assert.equal(U.mnLightCount.value, originalUniforms.lights, `${failurePoint}: light count restored`);
    assert.equal(U.mnGlowOut.value, originalUniforms.glow, `${failurePoint}: glow uniform restored`);
    assert.ok(U.mnCharFill.value.equals(originalUniforms.fill), `${failurePoint}: character fill restored`);
    assert.equal(rootObject.parent, parent, `${failurePoint}: original root parent restored`);
    assert.ok(parent.children.includes(rootObject), `${failurePoint}: root restored to its parent children`);
    assert.ok(!studio.scene.children.includes(rootObject), `${failurePoint}: root removed from portrait scene`);
    assert.equal(renderer.renderCalls, 1);
    assert.equal(renderer.readCalls, failurePoint === 'read' ? 1 : 0);
  }
});
