import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { captureCharacterFigure } from '../src/render/assets/characterFigure.js';
import { createCharacterReaction, localReactionDelta, reactionEligible, reactionEnvelope } from '../src/render/assets/characterReaction.js';
import { normalizeManifest } from '../src/render/assets/manifest.js';
import { bakeCharacter } from '../src/render/assets/rebind.js';
import { assets } from '../src/render/assets/registry.js';
import { CharacterView } from '../src/render/characters.js';
import { LOOKS } from '../src/render/charlooks.js';
import { ACT, STATE } from '../src/sim/ecs.js';

const glbPath = resolve('assets/models/buccaneer-v1-desktop.glb');
const manifestPath = resolve('assets/manifest.json');
const ROLES = ['spine', 'chest', 'head', 'armL', 'foreL', 'armR', 'foreR'];

async function loadBuccaneer() {
  const bytes = await readFile(glbPath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'NodeTextureStub',
    loadTexture(index) {
      const texture = new THREE.Texture();
      texture.name = `reaction-node-stub-${index}`;
      return Promise.resolve(texture);
    },
  }));
  return loader.parseAsync(arrayBuffer, '');
}

function bonePose(scene) {
  const out = {};
  scene.traverse((object) => {
    if (object.isBone) out[object.name] = [
      ...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray(),
    ];
  });
  return out;
}

function clipState(clip) {
  return clip.tracks.map((track) => ({
    name: track.name,
    times: Array.from(track.times),
    values: Array.from(track.values),
  }));
}

function fakeView() {
  const root = new THREE.Group();
  const view = { root, harvestPose: false };
  for (const role of [...ROLES, 'thighL', 'shinL', 'thighR', 'shinR']) {
    view[role] = new THREE.Bone();
    view[role].name = role;
    root.add(view[role]);
  }
  return view;
}

function resetView(view) {
  for (const role of [...ROLES, 'thighL', 'shinL', 'thighR', 'shinR']) view[role].quaternion.identity();
}

function changed(a, b, epsilon = 1e-5) {
  return a.angleTo(b) > epsilon;
}

test('local delta conjugates through a rotated parent rest frame', () => {
  const parentRest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.31, -0.47, 0.22));
  const parentDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0.42, 0.09));
  const childDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.56, -0.12, -0.37));
  const childRest = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.21, 0.16, 0.28));
  const local = localReactionDelta(parentDelta, childDelta, parentRest);

  // Independently construct the moved parent and child world orientations. Their relative
  // transform gives the child local pose implied by the world deltas.
  const parentWorldMoved = parentDelta.clone().multiply(parentRest);
  const childWorldMoved = childDelta.clone().multiply(parentRest).multiply(childRest);
  const impliedChildLocal = parentWorldMoved.invert().multiply(childWorldMoved);
  assert.ok(local.clone().multiply(childRest).angleTo(impliedChildLocal) < 1e-7,
    `local reconstruction error ${local.clone().multiply(childRest).angleTo(impliedChildLocal)}; actual=${local.clone().multiply(childRest).toArray()} implied=${impliedChildLocal.toArray()}`);
  assert.ok(local.angleTo(childDelta) > 0.05, 'non-identity parent rest must alter the local result');
});

test('reaction eligibility and envelope exclude invalid states and fade at clip boundaries', () => {
  for (const act of [ACT.IDLE, ACT.SHOOT, ACT.STAGGER]) {
    assert.equal(reactionEligible({ act, st: STATE.MOVE, dead: 0 }), true, `act ${act}`);
  }
  for (const state of [
    { act: ACT.IDLE, st: STATE.DASH, dead: 0 },
    { act: ACT.IDLE, st: STATE.SWIM, dead: 0 },
    { act: ACT.IDLE, st: STATE.MOVE, dead: 1 },
    { act: ACT.DEAD, st: STATE.MOVE, dead: 0 },
    { act: ACT.GUARD, st: STATE.MOVE, dead: 0 },
    { act: ACT.BLAST, st: STATE.MOVE, dead: 0 },
  ]) assert.equal(reactionEligible(state), false, JSON.stringify(state));
  assert.equal(reactionEligible({ act: ACT.IDLE, st: STATE.MOVE, dead: 0 }, true), false, 'harvesting pose suppresses reaction');

  const duration = 1.292;
  assert.equal(reactionEnvelope(0, duration), 0);
  assert.ok(reactionEnvelope(0.04, duration) > 0 && reactionEnvelope(0.04, duration) < 1);
  assert.equal(reactionEnvelope(0.08, duration), 1);
  assert.equal(reactionEnvelope(duration - 0.16, duration), 1);
  assert.ok(reactionEnvelope(duration - 0.08, duration) > 0 && reactionEnvelope(duration - 0.08, duration) < 1);
  assert.equal(reactionEnvelope(duration, duration), 0);
});

test('real Bucanero hit clip retargets additively without moving legs/root or mutating captured source', async () => {
  const gltf = await loadBuccaneer();
  const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifest = normalizeManifest(raw, { looks: LOOKS.map((look) => look.name) });
  assert.deepEqual(manifest.errors, []);
  const entry = manifest.entries.get('char:buccaneer-v1');
  assert.ok(entry);
  assert.equal(entry.reactionAnimation, 'hit_to_body_01');

  const sourcePose = bonePose(gltf.scene);
  const captured = captureCharacterFigure(gltf, entry);
  assert.ok(captured?.reactionClip);
  assert.equal(captured.reactionClip.name, 'hit_to_body_01');
  assert.ok(Math.abs(captured.reactionClip.duration - 1.292) < 0.01);
  assert.notEqual(captured.scene, gltf.scene);
  assert.deepEqual(bonePose(captured.scene), sourcePose, 'capturing the reaction keeps the original neutral skeleton');
  const sourceTracks = clipState(captured.reactionClip);

  const bake = bakeCharacter(gltf.scene, entry);
  assert.equal(bake.tris, 9164);
  const gameplayPose = bonePose(gltf.scene);
  assert.deepEqual(bonePose(captured.scene), sourcePose, 'the gameplay bake must not pose the reaction clone');

  const reaction = createCharacterReaction(captured, bake, entry);
  assert.equal(reaction.duration, captured.reactionClip.duration);
  const view = fakeView();
  view.root.position.set(4, 2, -3);
  const rootAtStart = view.root.position.clone();
  const visibleChildrenAtStart = [...view.root.children];
  const legsAtStart = ['thighL', 'shinL', 'thighR', 'shinR'].map((role) => view[role].quaternion.clone());
  const neutralPose = bonePose(captured.scene);

  reaction.restart(0.8);
  assert.equal(reaction.active, true);
  assert.equal(reaction.time, 0);
  const eligibleIdle = { act: ACT.IDLE, st: STATE.MOVE, dead: 0, vx: 0, vz: 0 };
  assert.equal(reaction.apply(view, 0.28, eligibleIdle), true);
  assert.ok(reaction.weight > 0.79 && reaction.weight <= 0.8);
  assert.ok(['spine', 'chest', 'head'].some((role) => changed(view[role].quaternion, new THREE.Quaternion())),
    'the real clip changes at least one torso/head target');
  assert.ok(['armL', 'foreL', 'armR', 'foreR'].some((role) => changed(view[role].quaternion, new THREE.Quaternion())),
    'stationary idle also receives arm motion');
  assert.ok(view.root.position.equals(rootAtStart), 'reaction is rotation-only; root motion is not imported');
  assert.deepEqual(view.root.children, visibleChildrenAtStart, 'the reaction adds no visible mesh or draw-call child');
  ['thighL', 'shinL', 'thighR', 'shinR'].forEach((role, i) => assert.ok(view[role].quaternion.equals(legsAtStart[i]), `${role} is untouched`));

  const repeatedView = fakeView(), referenceView = fakeView();
  const base = new Map();
  for (const role of ROLES) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, -0.13, 0.05));
    repeatedView[role].quaternion.copy(q); referenceView[role].quaternion.copy(q); base.set(role, q.clone());
  }
  const referenceReaction = createCharacterReaction(captured, bake, entry);
  reaction.restart(); referenceReaction.restart();
  reaction.apply(repeatedView, 0.1, eligibleIdle);
  reaction.apply(repeatedView, 0.1, eligibleIdle); // no external reset between calls
  referenceReaction.apply(referenceView, 0.1, eligibleIdle);
  referenceReaction.restore(); // CharacterView restores before rebuilding its procedural pose
  referenceReaction.apply(referenceView, 0.1, eligibleIdle);
  for (const role of ROLES) assert.ok(repeatedView[role].quaternion.angleTo(referenceView[role].quaternion) < 1e-6,
    `${role} must use a fresh procedural base instead of accumulating reaction deltas`);
  reaction.restore();
  for (const role of ROLES) assert.ok(repeatedView[role].quaternion.angleTo(base.get(role)) < 1e-8,
    `${role} restore returns exactly to its pre-reaction procedural quaternion`);
  referenceReaction.dispose();

  // CharacterView rebuilds its procedural pose each frame before applying this additive layer.
  resetView(view);
  reaction.restart();
  assert.equal(reaction.time, 0, 'a new hit restarts the clip');
  assert.equal(reaction.apply(view, 0.28, { ...eligibleIdle, vx: 1 }), true);
  assert.ok(changed(view.chest.quaternion, new THREE.Quaternion()) || changed(view.head.quaternion, new THREE.Quaternion()),
    'torso/head continue while moving');
  for (const role of ['armL', 'foreL', 'armR', 'foreR']) assert.ok(view[role].quaternion.equals(new THREE.Quaternion()), `${role} stays procedural while moving`);

  resetView(view);
  reaction.restart();
  assert.equal(reaction.apply(view, 0.28, { ...eligibleIdle, act: ACT.SHOOT }), true);
  assert.ok(changed(view.chest.quaternion, new THREE.Quaternion()) || changed(view.head.quaternion, new THREE.Quaternion()),
    'torso/head remain reactive during a pistol shot');
  for (const role of ['armL', 'foreL', 'armR', 'foreR']) assert.ok(view[role].quaternion.equals(new THREE.Quaternion()), `${role} stays aimed while firing`);

  // End on a freshly reconstructed procedural pose, as CharacterView does each frame.
  reaction.restart();
  for (let i = 0; i < 13; i++) {
    resetView(view);
    reaction.apply(view, 0.1, eligibleIdle);
  }
  assert.equal(reaction.active, false, 'the one-shot stops at the clip end');
  assert.equal(reaction.time, 0);
  assert.ok(ROLES.every((role) => view[role].quaternion.equals(new THREE.Quaternion())), 'final envelope returns to the procedural pose');

  for (const invalid of [
    { ...eligibleIdle, st: STATE.DASH }, { ...eligibleIdle, st: STATE.SWIM },
    { ...eligibleIdle, dead: 1 }, { ...eligibleIdle, act: ACT.BLAST },
  ]) {
    reaction.restart();
    assert.equal(reaction.apply(view, 0.1, invalid), false, 'invalid state cancels without applying the clip');
    assert.equal(reaction.active, false);
  }
  reaction.restart(); view.harvestPose = true;
  assert.equal(reaction.apply(view, 0.1, eligibleIdle), false, 'harvesting cancels reaction');
  assert.equal(reaction.active, false);

  assert.deepEqual(bonePose(captured.scene), neutralPose, 'sampling the private mixer leaves the shared captured scene unchanged');
  assert.deepEqual(clipState(captured.reactionClip), sourceTracks, 'the source animation buffers remain immutable');
  assert.deepEqual(bonePose(gltf.scene), gameplayPose, 'sampling never mutates the baked gameplay source');
  reaction.dispose();
  assert.equal(reaction.active, false);
});

test('missing reaction asset leaves CharacterView on the procedural hit fallback', () => {
  const original = assets.characterReaction;
  const view = Object.create(CharacterView.prototype);
  Object.assign(view, { hitK: 0, hitDir: 1, reactionUnavailable: false });
  try {
    assets.characterReaction = () => null;
    assert.doesNotThrow(() => view.hit(0.7, -1));
    assert.equal(view.hitK, 0.7);
    assert.equal(view.hitDir, -1);
    assert.equal(view.reactionUnavailable, true);
    assert.equal(view.reaction, null);
  } finally {
    assets.characterReaction = original;
  }
});
