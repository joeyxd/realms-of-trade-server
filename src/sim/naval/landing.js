// Deterministic shoreline landing search used by the live-voyage pilot.
import { canStand } from '../systems/movement.js';
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
import { tuning } from '../../data/tuning.js';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

function distanceToHull(x, z, pose, parts) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  let best = Infinity;
  for (const part of parts) {
    if (RAFT_PARTS[part[0]]?.layer !== 'base') continue;
    const dx = x - pose.x, dz = z - pose.z;
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const qx = Math.max(part[1] * RAFT.cell, Math.min((part[1] + 1) * RAFT.cell, lx));
    const qz = Math.max(part[2] * RAFT.cell, Math.min((part[2] + 1) * RAFT.cell, lz));
    best = Math.min(best, Math.hypot(lx - qx, lz - qz));
  }
  return Math.max(0, best);
}

function nearestHullPoint(x, z, pose, parts) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  let best = null, bestD = Infinity;
  for (const part of parts) {
    if (RAFT_PARTS[part[0]]?.layer !== 'base') continue;
    const dx = x - pose.x, dz = z - pose.z;
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const qx = Math.max(part[1] * RAFT.cell, Math.min((part[1] + 1) * RAFT.cell, lx));
    const qz = Math.max(part[2] * RAFT.cell, Math.min((part[2] + 1) * RAFT.cell, lz));
    const wx = pose.x + c * qx + s * qz, wz = pose.z - s * qx + c * qz;
    const d = Math.hypot(x - wx, z - wz);
    if (d < bestD) { bestD = d; best = { x: wx, z: wz }; }
  }
  return best;
}

function clearDryShorePath(world, x, z, pose, parts) {
  const edge = nearestHullPoint(x, z, pose, parts);
  if (!edge) return false;
  const dx = edge.x - x, dz = edge.z - z, length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / 0.35));
  let previousY = world.map.groundAt(x, z), previousDry = true;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, sx = x + dx * t, sz = z + dz * t, y = world.map.groundAt(sx, sz);
    if (y < 0.2) { previousDry = false; continue; }
    if (!canStand(world, sx, sz) || (previousDry && Math.abs(y - previousY) / (length / steps) > tuning.world.maxSlope)) return false;
    previousDry = true; previousY = y;
  }
  return true;
}

export function distanceToNavalHull(x, z, pose, parts) {
  if (![x, z, pose?.x, pose?.y, pose?.z, pose?.yaw].every(finite) || !Array.isArray(parts)) return Infinity;
  return distanceToHull(x, z, pose, parts);
}

// Search a fixed half-meter lattice, ordered by distance then coordinates. Requiring dry ground,
// ordinary movement support, and a nearby live foundation prevents arbitrary shore teleports.
export function nearestNavalLanding(world, pose, parts, radius = 6) {
  if (!world?.map || !pose || ![pose.x, pose.y, pose.z, pose.yaw, radius].every(finite) ||
      !Array.isArray(parts) || radius < 0 || radius > 12) return null;
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), corners = [];
  for (const part of parts) if (RAFT_PARTS[part[0]]?.layer === 'base') {
    for (const dx of [0, RAFT.cell]) for (const dz of [0, RAFT.cell])
      corners.push({ x: pose.x + c * (part[1] * RAFT.cell + dx) + s * (part[2] * RAFT.cell + dz),
        z: pose.z - s * (part[1] * RAFT.cell + dx) + c * (part[2] * RAFT.cell + dz) });
  }
  if (!corners.length) return null;
  const minX = Math.min(...corners.map((p) => p.x)) - radius, maxX = Math.max(...corners.map((p) => p.x)) + radius;
  const minZ = Math.min(...corners.map((p) => p.z)) - radius, maxZ = Math.max(...corners.map((p) => p.z)) + radius;
  const candidates = [];
  const step = 0.5;
  for (let z = minZ; z <= maxZ + 1e-9; z += step) for (let x = minX; x <= maxX + 1e-9; x += step) {
    const y = world.map.groundAt(x, z);
    if (world.map.onDock(x, z) || y < 0.2 || world.raftDeck?.surface(x, z) || !canStand(world, x, z)) continue;
    const d = distanceToHull(x, z, pose, parts);
    if (d > radius || !clearDryShorePath(world, x, z, pose, parts)) continue;
    const dx = x - pose.x, dz = z - pose.z;
    candidates.push({ x, z, y, d, radial: dx * dx + dz * dz });
  }
  candidates.sort((a, b) => a.radial - b.radial || a.x - b.x || a.z - b.z);
  const p = candidates[0];
  return p ? Object.freeze({ x: p.x, y: p.y, z: p.z, distance: p.d }) : null;
}

export function isNavalLandingValid(world, pose, parts, point, radius = 6) {
  if (!world?.map || !pose || !point || ![pose.x, pose.y, pose.z, pose.yaw, point.x, point.y, point.z, radius].every(finite) ||
      !Array.isArray(parts) || radius < 0 || radius > 12) return false;
  return !world.map.onDock(point.x, point.z) && !world.raftDeck?.surface(point.x, point.z) &&
    world.map.groundAt(point.x, point.z) >= 0.2 && canStand(world, point.x, point.z) &&
    distanceToHull(point.x, point.z, pose, parts) <= radius && clearDryShorePath(world, point.x, point.z, pose, parts);
}

