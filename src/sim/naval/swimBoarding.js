// Read-only geometry for the narrow raft-to-water and water-to-raft transitions.
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
import { tuning } from '../../data/tuning.js';

const EPS = 1e-8;
const STEP = 0.2;
const WATER_OFFSET = 0.35;
export const SWIM_BOARDING_RANGE = 1.5;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

function worldPoint(pose, x, z) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return { x: pose.x + c * x + s * z, z: pose.z - s * x + c * z };
}

function localPoint(pose, x, z) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), dx = x - pose.x, dz = z - pose.z;
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

function deepWater(world, x, z) {
  return !world.map.onDock(x, z) && world.map.groundAt(x, z) <=
    tuning.world.waterLevel - tuning.world.wadeMax - 0.05;
}

function staticClear(world, x, z, radius) {
  const colliders = world.map.queryColliders(x, z, radius + 0.25);
  for (let i = 0; i < colliders.length; i++) {
    const c = world.map.colliders[colliders[i]], dx = x - c.x, dz = z - c.z, r = radius + c.r;
    if (dx * dx + dz * dz < r * r - EPS) return false;
  }
  return true;
}

function lineClear(world, a, b, y, radius, { requireDeck = false, shipId = null } = {}) {
  const length = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(length / STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    if (world.raftDeck?.blocked(x, z, y, radius) || !staticClear(world, x, z, radius)) return false;
    if (requireDeck) {
      const surface = world.raftDeck?.surface(x, z, y);
      if (surface?.id !== shipId || surface.kind !== 'deck' || Math.abs(surface.y - y) > 0.1) return false;
    }
  }
  return true;
}

function exposedEdges(pose, parts, radius) {
  const bases = new Set(parts.filter((p) => RAFT_PARTS[p[0]]?.layer === 'base' && p[3] === 0)
    .map((p) => `${p[1]},${p[2]}`));
  const edges = [];
  const directions = [
    { dx: 0, dz: -1, side: 'north' }, { dx: 1, dz: 0, side: 'east' },
    { dx: 0, dz: 1, side: 'south' }, { dx: -1, dz: 0, side: 'west' },
  ];
  for (const [id, cx, cz, level] of parts) {
    if (RAFT_PARTS[id]?.layer !== 'base' || level !== 0) continue;
    for (const d of directions) {
      if (bases.has(`${cx + d.dx},${cz + d.dz}`)) continue;
      const midX = (cx + 0.5) * RAFT.cell, midZ = (cz + 0.5) * RAFT.cell;
      const edgeLocal = { x: midX + d.dx * RAFT.cell / 2, z: midZ + d.dz * RAFT.cell / 2 };
      const deck = worldPoint(pose, edgeLocal.x - d.dx * (radius + 0.12), edgeLocal.z - d.dz * (radius + 0.12));
      const water = worldPoint(pose, edgeLocal.x + d.dx * WATER_OFFSET, edgeLocal.z + d.dz * WATER_OFFSET);
      edges.push({ deck, water, edge: worldPoint(pose, edgeLocal.x, edgeLocal.z), side: d.side });
    }
  }
  return edges;
}

// Finds a reachable level-zero exit from the player's current deck point into real deep water.
export function findRaftWaterExit(world, { shipId, pose, parts, from, radius = 0.45 }) {
  if (!world?.map || !world.raftDeck || !Array.isArray(parts) || !pose || !from ||
      ![pose.x, pose.y, pose.z, pose.yaw, from.x, from.z, radius].every(finite) || radius < 0.05 || radius > 2)
    return null;
  const current = world.raftDeck.surface(from.x, from.z, from.y);
  if (current?.id !== shipId || current.kind !== 'deck' || Math.abs(current.y - pose.y) > 0.1) return null;
  let best = null;
  for (const edge of exposedEdges(pose, parts, radius)) {
    if (!deepWater(world, edge.water.x, edge.water.z) || world.raftDeck.surface(edge.water.x, edge.water.z, from.y)) continue;
    if (!lineClear(world, from, edge.deck, pose.y, radius, { requireDeck: true, shipId }) ||
        !lineClear(world, edge.deck, edge.water, pose.y, radius)) continue;
    const distance = Math.hypot(from.x - edge.deck.x, from.z - edge.deck.z);
    if (distance > SWIM_BOARDING_RANGE) continue;
    if (!best || distance < best.distance) best = { ...edge, distance };
  }
  return best ? Object.freeze({ ...best, y: tuning.world.waterLevel - tuning.swim.bodyDepth }) : null;
}

// Finds a climb point only when a swimmer is close to an exposed level-zero edge and the
// straight, sampled route is clear of raft walls/rails, stairs, and static world colliders.
export function findRaftBoardingPoint(world, { shipId, pose, parts, from, radius = 0.45, maxDistance = SWIM_BOARDING_RANGE }) {
  if (!world?.map || !world.raftDeck || !Array.isArray(parts) || !pose || !from ||
      ![pose.x, pose.y, pose.z, pose.yaw, from.x, from.y, from.z, radius, maxDistance].every(finite) ||
      radius < 0.05 || radius > 2 || maxDistance < 0 || maxDistance > SWIM_BOARDING_RANGE || !deepWater(world, from.x, from.z)) return null;
  let best = null;
  for (const edge of exposedEdges(pose, parts, radius)) {
    const distance = Math.hypot(from.x - edge.deck.x, from.z - edge.deck.z);
    if (distance > maxDistance || Math.abs(from.y - (tuning.world.waterLevel - tuning.swim.bodyDepth)) > 0.3 ||
        !deepWater(world, edge.water.x, edge.water.z) ||
        !lineClear(world, from, edge.deck, pose.y, radius, { requireDeck: false })) continue;
    const surface = world.raftDeck.surface(edge.deck.x, edge.deck.z, pose.y);
    if (surface?.id !== shipId || surface.kind !== 'deck' || Math.abs(surface.y - pose.y) > 0.1) continue;
    if (!best || distance < best.distance) best = { ...edge, distance, y: surface.y };
  }
  return best ? Object.freeze(best) : null;
}

