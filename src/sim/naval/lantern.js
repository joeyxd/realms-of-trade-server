// Instance-bound light service. Legacy/new lamps start off; the blueprint stays unchanged.
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';
import { readFire, remainingFire } from '../economy/fire.js';
import { fireClockSeconds } from '../../data/fire.js';
export const FIRE_PARTS = Object.freeze(['lantern', 'torchFloor', 'torchWall', 'campfire', 'grill']);

export const LANTERN_REACH = 1.7;
const MAX_PARTS = 600;
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(id);
const validPart = (part) => Array.isArray(part) && part.length === 5 && FIRE_PARTS.includes(part[0]) &&
  part.slice(1).every(Number.isSafeInteger) && part[3] >= 0 && part[3] < RAFT.levels && part[4] >= 0 && part[4] <= 3;
const key = (part) => validPart(part) ? JSON.stringify(part) : '';

export function sanitizeLitLanterns(raw, conditionEncoded) {
  if (!Array.isArray(raw) || !Array.isArray(conditionEncoded?.entries)) return [];
  const rows = conditionEncoded.entries.slice(0, MAX_PARTS), counts = new Map();
  for (const row of rows) if (Array.isArray(row) && validId(row[0]))
    counts.set(row[0], (counts.get(row[0]) || 0) + 1);
  const living = new Set(rows.filter((row) => Array.isArray(row) && row.length === 7 && validId(row[0]) &&
    counts.get(row[0]) === 1 && validPart(row.slice(1, 6)) && typeof row[6] === 'number' &&
    Number.isFinite(row[6]) && row[6] > 0 && row[6] <= RAFT_PARTS[row[1]].hp).map((row) => row[0]));
  return [...new Set(raw.slice(0, MAX_PARTS).filter((id) => living.has(id)))].sort();
}

export function litLanternParts(source, w = null) {
  if (w?.fireEnabled) {
    const state = readFire(w.profiles.get(source.owner)?.fire), now = fireClockSeconds(w.economy.hours);
    return (source.condition?.entries || []).filter(entry => {
      const slot = state.slots[JSON.stringify([source.ship.id, entry.id])];
      return validPart(entry.part) && entry.hp > 0 && slot?.kind === entry.part[0] && slot.lit && remainingFire(slot, now) > 0;
    }).map(entry => [...entry.part]);
  }
  const ids = new Set(Array.isArray(source?.ship?.litLanterns) ? source.ship.litLanterns : []);
  return (source?.condition?.entries || []).slice(0, MAX_PARTS).filter((entry) => entry && validId(entry.id) &&
    ids.has(entry.id) && validPart(entry.part) && Number.isFinite(entry.hp) && entry.hp > 0)
    .map((entry) => [...entry.part]);
}

export function isLanternLit(parts, part) {
  const target = key(part);
  return !!target && Array.isArray(parts) && parts.some((candidate) => key(candidate) === target);
}

// Interaction is measured at the floor below the lamp, not at its luminous core.
export function lanternPoint(record, part) {
  if (!validPart(part) || !record || ![record.x, record.y, record.z, record.yaw].every(Number.isFinite)) return null;
  const x = (part[1] + 0.5) * RAFT.cell, z = (part[2] + 0.5) * RAFT.cell;
  const c = Math.cos(record.yaw), s = Math.sin(record.yaw);
  return { x: record.x + c * x + s * z, y: record.y + part[3] * RAFT.levelHeight,
    z: record.z - s * x + c * z };
}

export function lanternDistance(record, part, position) {
  const point = lanternPoint(record, part);
  if (!point || !position || ![position.x, position.y, position.z].every(Number.isFinite) ||
      Math.abs(position.y - point.y) > 0.6) return Infinity;
  return Math.hypot(position.x - point.x, position.z - point.z);
}
