import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterView } from '../src/render/characters.js';
import { makeBones, joints } from '../src/render/charkit.js';
import { RaftLayer } from '../src/render/rafts.js';
import { poseNavalHelm } from '../src/render/navalHelmPose.js';
import { RAFT_ATLAS_RECTS } from '../src/render/raftMaterials.js';
import { LAB_FIXTURES } from '../tools/naval-lab/fixtures.js';

function testCharacterRig() {
  const R = { hip: 0.93, knee: 0.5, waist: 1, chest: 1.2, shY: 1.47, shX: 0.205,
    elbow: 1.15, wrist: 0.89, neck: 1.565, legX: 0.095 };
  const bones = makeBones(joints(R)), root = new THREE.Group();
  root.add(bones[0]);
  return { root, bones, built: { R }, armL: bones[9], foreL: bones[10], armR: bones[11], foreR: bones[12] };
}

function assertUvInAtlas(mesh, kind) {
  const rect = RAFT_ATLAS_RECTS[kind], uv = mesh.geometry.getAttribute('uv');
  assert.ok(uv?.count > 0, `${mesh.name} needs UVs`);
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= rect.u0 - 1e-6 && uv.getX(i) <= rect.u1 + 1e-6, `${mesh.name} U outside ${kind}`);
    assert.ok(uv.getY(i) >= rect.v0 - 1e-6 && uv.getY(i) <= rect.v1 + 1e-6, `${mesh.name} V outside ${kind}`);
  }
}

test('naval helm IK reaches both grips and clamps targets beyond arm reach', () => {
  const view = testCharacterRig();
  const gripWorld = { left: { x: 0.04, y: 1.08, z: 0.34 }, right: { x: -0.04, y: 1.08, z: 0.34 } };
  const result = poseNavalHelm(view, { active: true, gripWorld });
  assert.ok(result.handsWorld.left.error <= 0.08);
  assert.ok(result.handsWorld.right.error <= 0.08);
  const far = poseNavalHelm(view, { active: true, gripWorld: {
    left: { x: 0, y: 8, z: 0 }, right: { x: 0, y: 8, z: 0 },
  } });
  assert.equal(far.handsWorld.left.clamped, true);
  assert.equal(far.handsWorld.right.clamped, true);
  const before = view.armL.quaternion.clone();
  assert.deepEqual(poseNavalHelm(view, { active: false }), { active: false, handsWorld: null });
  assert.ok(view.armL.quaternion.angleTo(before) < 1e-9);
});

test('opt-in raft sailing rigs animate wind, boost and tiller while normal layers keep the fallback silhouette', () => {
  const scene = new THREE.Scene(), fixture = LAB_FIXTURES.find((entry) => entry.id === 'empty');
  const record = { id: 'helm-test', parts: fixture.parts, x: 4, y: 0.72, z: 3, yaw: 0, owner: 9 };
  const layer = new RaftLayer(scene, { skin: false, sailingRig: true });
  const fallback = new RaftLayer(new THREE.Scene(), { skin: false });
  try {
    layer.update([record], 0);
    fallback.update([record], 0);
    const view = layer.views.get(record.id), fallbackView = fallback.views.get(record.id);
    assert.ok(view.helm && !view.helm.visible);
    assert.equal(fallback.setSailing(record.id, { active: true, steer: 1, pilot: { x: 4, y: 0.72, z: 3, f: 0 } }), null);
    assert.equal(fallbackView.helm, undefined);
    const pilot = { x: 4, y: 0.72, z: 3, f: 0 };
    const first = layer.setSailing(record.id, { active: true, steer: 0, windYaw: Math.PI / 2, boost: 0.5, dt: 0.1, pilot });
    assert.equal(view.helm.visible, true);
    assert.ok(first.gripWorld.left && first.gripWorld.right && first.handleWorld);
    assert.ok(new THREE.Box3().setFromObject(view.helm.getObjectByName('raft:helm-lever-and-rudder')).min.y < 0,
      'the rudder must reach the water below the deck rather than stop on its planks');
    assert.ok(Math.abs(Math.hypot(first.gripWorld.left.x - first.gripWorld.right.x,
      first.gripWorld.left.y - first.gripWorld.right.y, first.gripWorld.left.z - first.gripWorld.right.z) - 0.08) < 1e-6);
    const second = layer.setSailing(record.id, { active: true, steer: 1, windYaw: -Math.PI / 2, boost: 1, dt: 0.1, pilot });
    assert.ok(Math.abs(second.steerAngle) > Math.abs(first.steerAngle));
    assert.ok(Math.abs(THREE.MathUtils.euclideanModulo(second.sailAngles[0] - first.sailAngles[0] + Math.PI,
      Math.PI * 2) - Math.PI) > 0.1);
    const stopped = layer.setSailing(record.id, { active: false, windYaw: 0, dt: 0.1, pilot });
    assert.equal(view.helm.visible, false);
    assert.equal(stopped.steerAngle, 0);
  } finally {
    layer.dispose(); fallback.dispose();
  }
});

test('opt-in sail and helm meshes stay inside their semantic atlas swatches and dispose their caches', () => {
  const scene = new THREE.Scene(), fixture = LAB_FIXTURES.find((entry) => entry.id === 'empty');
  const layer = new RaftLayer(scene, { skin: false, sailingRig: true });
  layer.atlas = new THREE.Texture();
  try {
    layer.update([{ id: 'atlas-helm-test', parts: fixture.parts, x: 0, y: 0.72, z: 0, yaw: 0 }], 0);
    const view = layer.views.get('atlas-helm-test');
    for (const [name, kind] of [
      ['raft:sail-cloth-moving', 'cloth'], ['raft:sail-yards', 'wood'], ['raft:sail-moving-ropes', 'rope'],
      ['raft:sail-moving-eyelets', 'iron'], ['raft:helm-post', 'wood'], ['raft:helm-bearing', 'iron'],
      ['raft:helm-lever-and-rudder', 'wood'],
    ]) assertUvInAtlas(view.visual.getObjectByName(name) || view.helm.getObjectByName(name), kind);
    assert.ok(view.sails[0].pivot.getObjectByName('raft:sail-moving-ropes'));
    assert.ok(view.sails[0].pivot.getObjectByName('raft:sail-moving-eyelets'));
    assert.equal(view.helm.children.length, 3);
  } finally {
    layer.dispose();
  }
  assert.equal(layer.views.size, 0);
  assert.equal(layer.shapes.size, 0);
});

test('real CharacterView reaches the opt-in helm grips over a yawed and heeled raft', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) }) };
  const scene = new THREE.Scene(), fixture = LAB_FIXTURES.find((entry) => entry.id === 'empty');
  const layer = new RaftLayer(scene, { skin: false, sailingRig: true });
  const record = { id: 'real-character-helm', parts: fixture.parts, x: 4, y: 0.72, z: 3, yaw: 1.1, owner: 9 };
  let character;
  try {
    layer.update([record], 0.7);
    const raft = layer.views.get(record.id);
    raft.visual.rotation.z = 0.1;
    raft.visual.updateMatrixWorld(true);
    const pilotFoot = raft.visual.localToWorld(new THREE.Vector3(3, 0, 1));
    const pilot = { x: pilotFoot.x, y: pilotFoot.y, z: pilotFoot.z, f: 1.1 };
    const sailing = layer.setSailing(record.id, { active: true, steer: 0.55, windYaw: -0.4,
      boost: 0.6, dt: 1 / 60, pilot });
    character = new CharacterView(0, { sword: false });
    character.update(1 / 60, { ...pilot, vx: 0, vz: 0, st: 0, wade: 0, act: 0, actT: 0 });
    const pose = poseNavalHelm(character, { active: true, gripWorld: sailing.gripWorld });
    assert.equal(pose.handsWorld.left.clamped, false);
    assert.equal(pose.handsWorld.right.clamped, false);
    assert.ok(pose.handsWorld.left.error < 0.08);
    assert.ok(pose.handsWorld.right.error < 0.08);
    assert.deepEqual(character.mesh.scale.toArray(), [1, 1, 1]);
  } finally {
    if (character) character.root.clear();
    layer.dispose();
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});
