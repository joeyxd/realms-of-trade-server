// Operational condition is separate from the blueprint and encoded into trusted profile saves.
// Refit keeps surviving instance identities and damage; only paid placement creates a new instance.
import { RAFT_PARTS } from '../../data/raftparts.js';
import { createNavalStructure, hullIntegrity, liveStructureParts } from './structure.js';
import { sanitizeOpenDoors } from './shelter.js';
import { sanitizeLitLanterns } from './lantern.js';

const same = (a, b) => a?.[0] === b?.[0] && a.slice(1, 4).every((v, i) => v === b[i + 1]) && (a[4] || 0) === (b[4] || 0);
const MAX_NEXT = 1e9;
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(id);

export function encodeRaftCondition(structure, nextId) {
  hullIntegrity(structure);
  if (!Number.isSafeInteger(nextId) || nextId < 1 || nextId > MAX_NEXT) throw new TypeError('Invalid raft identity counter');
  return { v: 1, next: nextId, entries: structure.entries.map((p) => [p.id, ...p.part, p.hp]) };
}

// Missing legacy condition starts intact. A present damaged/corrupt record never grants free repair:
// preserve valid tuple-bound entries and make unmatched pieces repairable wrecks with fresh identities.
export function sanitizeRaftCondition(raw, parts) {
  if (raw == null) return null;
  const rows = raw?.v === 1 && Array.isArray(raw.entries) ? raw.entries.slice(0, 600) : [];
  const ids = new Set(), used = new Set();
  let next = Number.isSafeInteger(raw?.next) && raw.next >= 1 && raw.next <= MAX_NEXT ? raw.next : 1;
  for (const row of rows) if (Array.isArray(row) && validId(row[0])) {
    const n = /(?:^|:)p(\d+)$/.exec(row[0]);
    if (n && Number(n[1]) < MAX_NEXT) next = Math.max(next, Number(n[1]) + 1);
  }
  const reserved = new Set(rows.filter(Array.isArray).map((r) => r[0]).filter(validId));
  const entries = parts.map((part) => {
    const i = rows.findIndex((r, k) => !used.has(k) && Array.isArray(r) && r.length === 7 && same(r.slice(1, 6), part));
    const row = rows[i];
    if (i >= 0) used.add(i);
    const valid = row && validId(row[0]) && !ids.has(row[0]) && typeof row[6] === 'number' &&
      Number.isFinite(row[6]) && row[6] >= 0 && row[6] <= RAFT_PARTS[part[0]].hp;
    let id = valid ? row[0] : null;
    if (!id) {
      // Corrupt counters at the ceiling are rebased only when generating a missing identity.
      if (next >= MAX_NEXT) next = 1;
      do { id = `p${next++}`; } while (ids.has(id) || reserved.has(id));
    }
    ids.add(id);
    return [id, ...part, valid ? row[6] : 0];
  });
  return { v: 1, next, entries };
}

export function restoreRaftCondition(raw, parts) {
  const saved = sanitizeRaftCondition(raw, parts);
  if (!saved) return refitRaftCondition({ conditionNext: 1 }, parts);
  const fresh = createNavalStructure(saved.entries.map((r) => ({ id: r[0], part: r.slice(1, 6) })));
  const structure = Object.freeze({ version: 1, entries: Object.freeze(fresh.entries.map((entry, i) =>
    Object.freeze({ ...entry, hp: saved.entries[i][6] }))) });
  return { structure, nextId: saved.next };
}

export function persistRaftCondition(source) {
  if (source.condition) source.ship.condition = encodeRaftCondition(source.condition, source.conditionNext);
  if (Object.hasOwn(source.ship, 'openDoors')) {
    const open = sanitizeOpenDoors(source.ship.openDoors, source.ship.condition);
    if (open.length) source.ship.openDoors = open;
    else delete source.ship.openDoors;
  }
  if (Object.hasOwn(source.ship, 'litLanterns')) {
    const lit = sanitizeLitLanterns(source.ship.litLanterns, source.ship.condition);
    if (lit.length) source.ship.litLanterns = lit;
    else delete source.ship.litLanterns;
  }
}

export function refitRaftCondition(source, parts, { reinforceIndex = -1 } = {}) {
  const previous = source.condition?.entries || [], used = new Set();
  if (source.condition) hullIntegrity(source.condition);
  let nextId = source.conditionNext || 1;
  const reserved = new Set(previous.map((p) => p.id));
  const entries = parts.map((part, index) => {
    let old = previous.find((p) => !used.has(p.id) && same(p.part, part));
    if (!old && index === reinforceIndex && part[0] === 'reinforcedFoundation')
      old = previous.find((p) => !used.has(p.id) && same(p.part, ['foundation', ...part.slice(1)]));
    if (old) used.add(old.id);
    let id = old?.id;
    if (!id) {
      if (nextId >= MAX_NEXT - 600) throw new RangeError('Raft identity counter exhausted');
      do { id = `p${nextId++}`; } while (reserved.has(id));
      reserved.add(id);
    }
    return { id, part, old };
  });
  const fresh = createNavalStructure(entries);
  const structure = Object.freeze({ version: 1, entries: Object.freeze(fresh.entries.map((entry, i) => {
    const old = entries[i].old;
    // Copy unchanged HP exactly; a subtract-and-reapply cycle introduces rounding on unrelated edits.
    const hp = !old ? entry.hp : old.part[0] === entry.part[0] ? old.hp : entry.maxHp * (old.hp / old.maxHp);
    return Object.freeze({ ...entry, hp });
  })) });
  hullIntegrity(structure);
  return { structure, nextId };
}

export function activeRaftParts(source) {
  return source.condition ? liveStructureParts(source.condition) : source.ship.grid.parts;
}

export function raftConditionEntry(source, index) {
  const part = source.ship.grid.parts[index];
  if (!part) return null;
  return source.condition?.entries.find((p) => same(p.part, part)) ||
    { id: null, part, hp: RAFT_PARTS[part[0]].hp, maxHp: RAFT_PARTS[part[0]].hp };
}
