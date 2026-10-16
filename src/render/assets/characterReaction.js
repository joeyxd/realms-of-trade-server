// Additive source-clip motion on the existing gameplay rig; no extra visible mesh or root movement.
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { mapBones } from './bonemap.js';
import { ACT } from '../../sim/ecs.js';

const IDENTITY = new THREE.Quaternion();
const PARENTS = { spine: null, chest: 'spine', head: 'chest', armL: 'chest', foreL: 'armL', armR: 'chest', foreR: 'armR' };
const finiteQuaternion = (q) => q.toArray().every(Number.isFinite) && q.lengthSq() > 1e-10;
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// Convert relative world motion to a local additive delta in the target parent's rest basis.
// Our procedural rig's rest rotations are identity; accepting a basis makes the convention explicit.
export function localReactionDelta(parentDelta, childDelta, parentRest = IDENTITY, out = new THREE.Quaternion()) {
  return out.copy(parentRest).invert().multiply(parentDelta.clone().invert()).multiply(childDelta).multiply(parentRest).normalize();
}

export function reactionEligible(state, harvesting = false) {
  return !!state && !harvesting && !state.dead && state.st !== 1 && state.st !== 2 &&
    [ACT.IDLE, ACT.SHOOT, ACT.STAGGER].includes(state.act | 0);
}

export function reactionEnvelope(time, duration) {
  if (!Number.isFinite(time) || time <= 0 || time >= duration) return 0;
  return smooth(time / .08) * smooth((duration - time) / .16);
}

export function createCharacterReaction(source, bake, entry) {
  if (!source?.scene || !source.reactionClip || !(source.reactionClip.duration > 0)) {
    throw new Error('source scene and reaction clip are required');
  }
  const scene = clone(source.scene), bones = [];
  scene.traverse((object) => { if (object.isBone) bones.push(object); });
  const indices = new Map(bones.map((bone, index) => [bone, index]));
  const parents = bones.map((bone) => indices.get(bone.parent) ?? -1);
  const mapping = mapBones(bones.map((bone) => bone.name), parents, entry.bones).map;
  for (const role of Object.keys(PARENTS)) {
    if (!bones[mapping[role]]) throw new Error(`reaction bone not found: ${role}`);
  }
  const clip = source.reactionClip.clone(), mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play(); mixer.setTime(0); scene.updateMatrixWorld(true);
  // Deliberate neutral reference: source tracks are absolute; only motion after frame zero is additive.
  const restInverse = {}, deltas = {}, local = {};
  for (const role of Object.keys(PARENTS)) {
    restInverse[role] = bones[mapping[role]].getWorldQuaternion(new THREE.Quaternion()).invert();
    deltas[role] = new THREE.Quaternion(); local[role] = new THREE.Quaternion();
  }
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bake.normalization.rotationY);
  const inverseYaw = yaw.clone().invert(), blend = new THREE.Quaternion();
  const applied = new Map();
  const restore = () => { for (const [bone, quaternion] of applied) bone.quaternion.copy(quaternion); applied.clear(); };
  let elapsed = 0, strength = 1, active = false, weight = 0;
  const cancel = () => { restore(); active = false; weight = 0; elapsed = 0; };
  return {
    mixer, duration: clip.duration,
    get active() { return active; }, get time() { return elapsed; }, get weight() { return weight; },
    restart(amount = 1) {
      restore();
      strength = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
      elapsed = 0; weight = 0; active = strength > 0;
      action.reset().setLoop(THREE.LoopOnce, 1).play(); mixer.setTime(0);
    },
    cancel, restore,
    apply(view, delta, state) {
      restore();
      if (!reactionEligible(state, !!view.harvestPose)) { cancel(); return false; }
      if (!active) return false;
      elapsed += Number.isFinite(delta) ? Math.max(0, Math.min(.1, delta)) : 0;
      if (elapsed >= clip.duration) { cancel(); return false; }
      mixer.setTime(elapsed); scene.updateMatrixWorld(true);
      weight = reactionEnvelope(elapsed, clip.duration) * strength;
      const arms = Math.hypot(state.vx || 0, state.vz || 0) < .2 && (state.act | 0) !== ACT.SHOOT;
      // Validate every sampled transform before changing the gameplay pose, so failures leave it intact.
      for (const role of Object.keys(PARENTS)) {
        bones[mapping[role]].getWorldQuaternion(deltas[role]).multiply(restInverse[role]);
        deltas[role].premultiply(yaw).multiply(inverseYaw).normalize();
        if (!finiteQuaternion(deltas[role])) throw new Error(`invalid reaction transform: ${role}`);
      }
      for (const [role, parent] of Object.entries(PARENTS)) {
        localReactionDelta(parent ? deltas[parent] : IDENTITY, deltas[role], IDENTITY, local[role]);
        if (!view[role]?.quaternion || !finiteQuaternion(view[role].quaternion)) throw new Error(`invalid gameplay reaction bone: ${role}`);
      }
      for (const role of Object.keys(PARENTS)) {
        if (!arms && (role.startsWith('arm') || role.startsWith('fore'))) continue;
        blend.copy(IDENTITY).slerp(local[role], weight);
        applied.set(view[role], view[role].quaternion.clone());
        view[role].quaternion.premultiply(blend).normalize();
      }
      return weight > 0;
    },
    dispose() { restore(); cancel(); mixer.stopAllAction(); mixer.uncacheRoot(scene); },
  };
}
