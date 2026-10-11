// Pure transforms between a raft's local frame and the pilot's world pose.
// Raft local +Z is forward; local +X is right. Collision uses only this rigid pose.
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
const TAU = Math.PI * 2;

// A real, deterministic helm station on an unobstructed base tile. The stern-most free tile wins;
// the same anchor is used by the renderer, boarding prompt and server admission.
export function liveHelmAnchor(parts) {
  if (!Array.isArray(parts)) return null;
  const candidates = parts.filter((p) => RAFT_PARTS[p[0]]?.layer === 'base' && p[3] === 0 &&
    !parts.some((q) => q !== p && q[1] === p[1] && q[2] === p[2] && q[3] === 0 &&
      (RAFT_PARTS[q[0]]?.layer === 'tile' || q[0] === 'pillar' || q[0] === 'stairs')));
  candidates.sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  const p = candidates[0];
  return p ? Object.freeze({ x: (p[1] + .5) * RAFT.cell, y: 0, z: (p[2] + .5) * RAFT.cell, f: 0 }) : null;
}

function finiteFields(value, fields, label) {
  if (!value || typeof value !== 'object' || fields.some((key) => !Number.isFinite(value[key]))) {
    throw new TypeError(`${label} must contain finite ${fields.join(', ')}`);
  }
}

function wrapAngle(angle) {
  // Keep headings in [-pi, pi], including stable handling of values beyond one turn.
  const wrapped = ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return wrapped === -Math.PI && angle > 0 ? Math.PI : wrapped;
}

export function pilotLocal(pose, point) {
  finiteFields(pose, ['x', 'y', 'z', 'yaw'], 'pose');
  finiteFields(point, ['x', 'y', 'z', 'f'], 'point');
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const dx = point.x - pose.x, dz = point.z - pose.z;
  return Object.freeze({
    x: c * dx - s * dz,
    y: point.y - pose.y,
    z: s * dx + c * dz,
    f: wrapAngle(point.f - pose.yaw),
  });
}

export function pilotPoint(pose, anchor) {
  finiteFields(pose, ['x', 'y', 'z', 'yaw'], 'pose');
  finiteFields(anchor, ['x', 'y', 'z', 'f'], 'anchor');
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return Object.freeze({
    x: pose.x + c * anchor.x + s * anchor.z,
    y: pose.y + anchor.y,
    z: pose.z - s * anchor.x + c * anchor.z,
    f: wrapAngle(pose.yaw + anchor.f),
  });
}

export function interpolatePilotPose(a, b, alpha) {
  finiteFields(a, ['x', 'y', 'z', 'yaw'], 'pose a');
  finiteFields(b, ['x', 'y', 'z', 'yaw'], 'pose b');
  if (!Number.isFinite(alpha)) throw new TypeError('alpha must be finite');
  const t = Math.max(0, Math.min(1, alpha));
  const delta = wrapAngle(b.yaw - a.yaw);
  return Object.freeze({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: wrapAngle(a.yaw + delta * t),
  });
}
