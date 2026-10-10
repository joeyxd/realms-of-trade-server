// Procedural surface-swim/treading targets for the existing humanoid rig.
const TAU = Math.PI * 2;

export function swimPose(time = 0) {
  const phase = (Number.isFinite(time) ? time : 0) * TAU * 0.72;
  const stroke = Math.sin(phase), scull = Math.cos(phase);
  return Object.freeze({
    thighL: -0.22 + 0.18 * stroke, thighR: 0.22 - 0.18 * stroke,
    shinL: 0.18 + 0.16 * Math.max(0, stroke), shinR: 0.18 + 0.16 * Math.max(0, -stroke),
    armL: -0.24 + 0.12 * scull, armR: -0.24 - 0.12 * scull,
    foreL: -0.72 - 0.10 * scull, foreR: -0.72 + 0.10 * scull,
    armLZ: 0.34, armRZ: -0.34, hips: 0.05 * stroke,
  });
}

export function applySwimPose(view, dt, time = view?.t || 0) {
  if (!view) return null;
  const pose = swimPose(time), ease = Math.min(1, Math.max(0, dt) * 12);
  const joints = ['thighL', 'thighR', 'shinL', 'shinR', 'armL', 'armR', 'foreL', 'foreR'];
  for (const name of joints) view[name].rotation.x += (pose[name] - view[name].rotation.x) * ease;
  view.armL.rotation.z += (pose.armLZ - view.armL.rotation.z) * ease;
  view.armR.rotation.z += (pose.armRZ - view.armR.rotation.z) * ease;
  view.hips.rotation.x += (pose.hips - view.hips.rotation.x) * ease;
  return pose;
}
