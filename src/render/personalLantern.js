import { RAFT } from '../data/raftparts.js';

// Shared hand-held torch placement for its character prop and matching local-light source.
export const PERSONAL_LANTERN_LOCAL = Object.freeze({ x: 0.35, y: 1.1, z: 0.35 });

const RAFT_FIRE_KINDS = new Set(['lantern', 'torchFloor', 'torchWall', 'campfire', 'grill']);

export function isRaftFireTuple(part) {
  return Array.isArray(part) && part.length === 5 && RAFT_FIRE_KINDS.has(part[0]) &&
    part.slice(1).every(Number.isSafeInteger) && part[3] >= 0 && part[3] < RAFT.levels && part[4] >= 0 && part[4] <= 3;
}

// Position of the visible flame, in world space. Wall directions follow raft edge directions:
// 0 north, 1 east, 2 south, 3 west.
export function raftFirePoint(record, part) {
  if (!isRaftFireTuple(part) || !record || ![record.x, record.y, record.z, record.yaw].every(Number.isFinite)) return null;
  const [kind, ix, iz, level, direction] = part;
  const cell = RAFT.cell, x0 = ix * cell, z0 = iz * cell;
  let x = x0 + cell / 2, z = z0 + cell / 2;
  let height = kind === 'campfire' ? 0.64 : kind === 'grill' ? 1.2 : kind === 'torchWall' ? 2.13 : kind === 'lantern' ? 1.24 : 1.62;
  if (kind === 'torchWall') {
    // Match the torch/bracket center on the inner face of the mounted wall fixture.
    const inset = 0.32;
    if (direction === 0) z = z0 + inset;
    else if (direction === 1) x = x0 + cell - inset;
    else if (direction === 2) z = z0 + cell - inset;
    else x = x0 + inset;
  }
  const c = Math.cos(record.yaw), s = Math.sin(record.yaw);
  return { x: record.x + c * x + s * z, y: record.y + level * RAFT.levelHeight + height,
    z: record.z - s * x + c * z };
}

export function personalLanternPoint({ x, y, z, f = 0 } = {}) {
  if (![x, y, z, f].every(Number.isFinite)) return null;
  const c = Math.cos(f), s = Math.sin(f);
  const p = PERSONAL_LANTERN_LOCAL;
  return { x: x + p.x * c + p.z * s, y: y + p.y, z: z - p.x * s + p.z * c };
}
