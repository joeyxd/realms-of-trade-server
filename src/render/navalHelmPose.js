import * as THREE from 'three';

const EPSILON = 1e-5;

function finitePoint(point) {
  return point && ['x', 'y', 'z'].every((key) => Number.isFinite(point[key]));
}

function wristOffset(view) {
  const arm = view.built?.R;
  if (Number.isFinite(arm?.wrist) && Number.isFinite(arm?.elbow)) return arm.wrist - arm.elbow;
  const upper = view.foreL?.position?.length?.() || 0.3;
  return -upper * 0.8;
}

function poseArm(view, side, target) {
  const arm = side === 'left' ? view.armL : view.armR;
  const fore = side === 'left' ? view.foreL : view.foreR;
  if (!arm?.parent || !fore || !finitePoint(target)) return null;

  view.root.updateMatrixWorld(true);
  const shoulder = arm.getWorldPosition(new THREE.Vector3());
  const elbowBefore = fore.getWorldPosition(new THREE.Vector3());
  const upperLength = shoulder.distanceTo(elbowBefore);
  const offset = wristOffset(view);
  fore.updateWorldMatrix(true, false);
  const worldScale = fore.getWorldScale(new THREE.Vector3());
  const lowerLength = Math.abs(offset) * worldScale.y;
  if (!(upperLength > EPSILON) || !(lowerLength > EPSILON)) return null;

  const ray = new THREE.Vector3(target.x, target.y, target.z).sub(shoulder);
  const rawDistance = ray.length();
  if (!(rawDistance > EPSILON)) return null;
  const reach = Math.max(Math.abs(upperLength - lowerLength) + EPSILON,
    Math.min(upperLength + lowerLength - EPSILON, rawDistance));
  const direction = ray.multiplyScalar(1 / rawDistance);
  const clampedTarget = shoulder.clone().addScaledVector(direction, reach);
  const requestedTarget = new THREE.Vector3(target.x, target.y, target.z);

  const rootRotation = view.root.getWorldQuaternion(new THREE.Quaternion());
  const bend = new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(rootRotation);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < EPSILON) {
    bend.set(0, 1, 0).addScaledVector(direction, -direction.y);
  }
  bend.normalize();

  const cosine = THREE.MathUtils.clamp((upperLength * upperLength + reach * reach - lowerLength * lowerLength) /
    (2 * upperLength * reach), -1, 1);
  const elbowTarget = shoulder.clone().addScaledVector(direction, upperLength * cosine)
    .addScaledVector(bend, upperLength * Math.sqrt(Math.max(0, 1 - cosine * cosine)));

  arm.parent.updateWorldMatrix(true, false);
  const parentRotation = arm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const armVector = fore.position.clone().normalize();
  const desiredArmVector = elbowTarget.clone().sub(shoulder).applyQuaternion(parentRotation).normalize();
  arm.quaternion.setFromUnitVectors(armVector, desiredArmVector);
  view.root.updateMatrixWorld(true);

  fore.parent.updateWorldMatrix(true, false);
  const targetInParent = fore.parent.worldToLocal(clampedTarget.clone());
  const wristVector = new THREE.Vector3(0, offset, 0);
  const desiredWristVector = targetInParent.sub(fore.position).normalize();
  fore.quaternion.setFromUnitVectors(wristVector.clone().normalize(), desiredWristVector);
  view.root.updateMatrixWorld(true);

  const hand = fore.localToWorld(wristVector.clone());
  return { x: hand.x, y: hand.y, z: hand.z, error: hand.distanceTo(requestedTarget),
    clampedTargetWorld: { x: clampedTarget.x, y: clampedTarget.y, z: clampedTarget.z }, clamped: rawDistance > reach };
}

// Call after CharacterView.update so the next ordinary character update restores its walk pose.
export function poseNavalHelm(view, { active = false, gripWorld = null } = {}) {
  if (!view?.root || !view.armL || !view.armR || !view.foreL || !view.foreR)
    throw new TypeError('A live CharacterView is required to pose the naval helm.');
  if (!active) return { active: false, handsWorld: null };
  if (!finitePoint(gripWorld?.left) || !finitePoint(gripWorld?.right))
    throw new TypeError('Both world-space helm grips are required.');
  const handsWorld = {
    left: poseArm(view, 'left', gripWorld.left),
    right: poseArm(view, 'right', gripWorld.right),
  };
  return { active: true, handsWorld };
}
