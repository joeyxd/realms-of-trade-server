// Shared shelter-door state and interaction geometry. Open state belongs to a stable live part ID;
// the blueprint tuple remains unchanged so construction, condition, and collision keep one shape.
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';

export const DOOR_REACH = 1.7;
const FLOOR_TOLERANCE = 0.6;
const MAX_PARTS = 600;
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(id);
const validPart = (part) => Array.isArray(part) && part.length === 5 && part[0] === 'door' &&
  part.slice(1).every(Number.isSafeInteger) && part[3] >= 0 && part[3] < RAFT.levels && part[4] >= 0 && part[4] <= 3;
const tupleKey = (part) => validPart(part) ? JSON.stringify(part) : '';

// Persist only IDs that still identify a unique, living door in the encoded condition.
export function sanitizeOpenDoors(raw, conditionEncoded) {
  if (!Array.isArray(raw) || !Array.isArray(conditionEncoded?.entries)) return [];
  const rows = conditionEncoded.entries.slice(0, MAX_PARTS);
  const counts = new Map();
  for (const row of rows) if (Array.isArray(row) && validId(row[0]))
    counts.set(row[0], (counts.get(row[0]) || 0) + 1);
  const doors = new Set();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 7 || !validId(row[0]) || counts.get(row[0]) !== 1 ||
        !validPart(row.slice(1, 6)) || typeof row[6] !== 'number' || !Number.isFinite(row[6]) ||
        row[6] <= 0 || row[6] > RAFT_PARTS.door.hp) continue;
    doors.add(row[0]);
  }
  return [...new Set(raw.slice(0, MAX_PARTS).filter((id) => typeof id === 'string' && doors.has(id)))].sort();
}

// Read operational state without changing either the source or its saved profile.
export function openDoorParts(source) {
  const entries = source?.condition?.entries;
  const open = new Set(Array.isArray(source?.ship?.openDoors) ? source.ship.openDoors : []);
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, MAX_PARTS).filter((entry) => entry && validId(entry.id) && open.has(entry.id) &&
    validPart(entry.part) && typeof entry.hp === 'number' && Number.isFinite(entry.hp) && entry.hp > 0)
    .map((entry) => [...entry.part]);
}

// Door identity is its exact five-field blueprint tuple; the life of an instance is its condition ID.
export function doorKey(part) { return tupleKey(part); }

export function isDoorOpen(parts, part) {
  const key = tupleKey(part);
  return !!key && Array.isArray(parts) && parts.some((candidate) => tupleKey(candidate) === key);
}

function edge(part) {
  if (!validPart(part)) return null;
  const [, x, z, level, direction] = part;
  const x0 = x * RAFT.cell, z0 = z * RAFT.cell;
  if (direction === 0) return [[x0, z0], [x0 + RAFT.cell, z0]];
  if (direction === 1) return [[x0 + RAFT.cell, z0], [x0 + RAFT.cell, z0 + RAFT.cell]];
  if (direction === 2) return [[x0, z0 + RAFT.cell], [x0 + RAFT.cell, z0 + RAFT.cell]];
  return [[x0, z0], [x0, z0 + RAFT.cell]];
}

function worldPoint(record, x, z, level) {
  const c = Math.cos(record.yaw), s = Math.sin(record.yaw);
  return { x: record.x + c * x + s * z, y: record.y + level * RAFT.levelHeight,
    z: record.z - s * x + c * z };
}

export function doorPoint(record, part) {
  const segment = edge(part);
  if (!segment || !record || ![record.x, record.y, record.z, record.yaw].every(Number.isFinite)) return null;
  const [[ax, az], [bx, bz]] = segment;
  return worldPoint(record, (ax + bx) / 2, (az + bz) / 2, part[3]);
}

// Distance to the door edge in the same deck band; another floor level is never interactable.
export function doorDistance(record, part, position) {
  const segment = edge(part);
  if (!segment || !record || !position || ![record.x, record.y, record.z, record.yaw,
    position.x, position.y, position.z].every(Number.isFinite)) return Infinity;
  const [[ax, az], [bx, bz]] = segment;
  const a = worldPoint(record, ax, az, part[3]), b = worldPoint(record, bx, bz, part[3]);
  if (Math.abs(position.y - a.y) > FLOOR_TOLERANCE) return Infinity;
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(position.x - a.x - t * dx, position.z - a.z - t * dz);
}
