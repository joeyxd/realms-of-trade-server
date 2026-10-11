// Trusted voyage saves restore only a stationary vessel in the same generated island.
// Input, velocity, seats, invitations, cooldowns and world ticks never survive a reconnect.
import { createNavalCoast } from './coastGeometry.js';
import { navalCoastOverlaps } from './coastContact.js';
import { hullIntegrity, liveStructureParts } from './structure.js';
import { RAFT } from '../../data/raftparts.js';

export function sanitizeRaftVoyage(raw) {
  if (!raw || raw.v !== 1 || !Number.isSafeInteger(raw.seed) || raw.seed < 0 || raw.seed > 0xffffffff ||
      !Array.isArray(raw.pose) || raw.pose.length !== 3 || raw.pose.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
      Math.abs(raw.pose[0]) > 1e6 || Math.abs(raw.pose[1]) > 1e6 || Math.abs(raw.pose[2]) > Math.PI * 2) return null;
  return { v: 1, seed: raw.seed, pose: [...raw.pose] };
}

export function encodeRaftVoyage(world, pose) {
  const yaw = Math.abs(pose.yaw) <= Math.PI ? pose.yaw : Math.atan2(Math.sin(pose.yaw), Math.cos(pose.yaw));
  const value = sanitizeRaftVoyage({ v: 1, seed: world.seed,
    pose: [pose.x, pose.z, yaw] });
  if (!value) throw new TypeError('Invalid committed raft voyage');
  return value;
}

export function restoredRaftPose(world, ship, structure) {
  const saved = sanitizeRaftVoyage(ship.voyage);
  if (!saved || saved.seed !== world.seed || hullIntegrity(structure).disabled) return null;
  const [x, z, yaw] = saved.pose, c = Math.cos(yaw), s = Math.sin(yaw), limit = world.map.half - 2;
  // Validate the whole conserved blueprint, not just the remaining flotation.
  if (!ship.grid.parts.every((p) => [0, RAFT.cell].every((dx) => [0, RAFT.cell].every((dz) => {
    const lx = p[1] * RAFT.cell + dx, lz = p[2] * RAFT.cell + dz;
    return Math.abs(x + c * lx + s * lz) < limit && Math.abs(z - s * lx + c * lz) < limit;
  })))) return null;
  const pose = { x, y: 0.72, z, yaw };
  if (navalCoastOverlaps(pose, liveStructureParts(structure), createNavalCoast(world.map))) return null;
  return pose;
}
