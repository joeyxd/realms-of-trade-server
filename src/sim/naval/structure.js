// Immutable operational damage for a naval blueprint. Damage stays separate from the
// saved blueprint and economy so a destroyed piece never refunds materials or cargo.
import { RAFT, RAFT_PARTS } from '../../data/raftparts.js';

const MAX_PARTS = 600;
const MAX_COORD = 12;
const HIT_RADIUS = 1.5;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

function fail(message) { throw new TypeError(message); }

function copyPart(raw) {
  if (!Array.isArray(raw) || (raw.length !== 4 && raw.length !== 5)) fail('Invalid naval part tuple');
  const [type, x, z, level, rawDir = 0] = raw;
  const def = typeof type === 'string' ? RAFT_PARTS[type] : null;
  const dir = rawDir;
  if (!def || !finite(def.hp) || def.hp <= 0) fail('Unknown naval part or HP');
  if (![x, z, level, dir].every(Number.isSafeInteger) || Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD ||
      level < 0 || level >= RAFT.levels || dir < 0 || dir > 3) fail('Invalid naval part coordinates');
  if ((def.layer === 'base' && level !== 0) || (type === 'net' && level !== 0)) fail('Invalid naval part level');
  return Object.freeze([type, x, z, level, dir]);
}

function freezeEntry(entry) {
  return Object.freeze({ id: entry.id, part: entry.part, maxHp: entry.maxHp, hp: entry.hp });
}

function makeStructure(entries) {
  return Object.freeze({ version: 1, entries: Object.freeze(entries.map(freezeEntry)) });
}

function assertStructure(structure) {
  if (!structure || structure.version !== 1 || !Array.isArray(structure.entries) || structure.entries.length > MAX_PARTS)
    fail('Invalid naval structure');
}

function compareIds(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

export function createNavalStructure(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_PARTS) fail('Invalid naval structure entries');
  const ids = new Set();
  const clean = entries.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' ||
        !/^[a-zA-Z0-9:_-]{1,100}$/.test(raw.id) || ids.has(raw.id)) fail('Invalid or duplicate naval part ID');
    ids.add(raw.id);
    const part = copyPart(raw.part);
    const maxHp = RAFT_PARTS[part[0]].hp;
    return { id: raw.id, part, maxHp, hp: maxHp };
  });
  return makeStructure(clean);
}

export function applyPartDamage(structure, id, amount) {
  assertStructure(structure);
  if (typeof id !== 'string' || !finite(amount) || amount < 0) fail('Invalid naval part damage');
  const index = structure.entries.findIndex((entry) => entry.id === id);
  if (index < 0) fail('Unknown naval part ID');
  const target = structure.entries[index];
  if (!finite(target.hp) || !finite(target.maxHp) || target.maxHp <= 0 || target.hp < 0 || target.hp > target.maxHp)
    fail('Invalid naval part HP');
  const damage = Math.min(target.hp, amount);
  if (damage === 0) return { structure, event: null };
  const hp = target.hp - damage;
  const entries = structure.entries.slice();
  entries[index] = { ...target, hp };
  return {
    structure: makeStructure(entries),
    event: Object.freeze({ partId: target.id, type: target.part[0], damage, destroyed: hp === 0 }),
  };
}

export function hullIntegrity(structure) {
  assertStructure(structure);
  let hp = 0, maxHp = 0, total = 0, liveFloats = 0;
  for (const entry of structure.entries) {
    if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.part)) fail('Invalid naval structure entry');
    if (!finite(entry.hp) || !finite(entry.maxHp) || entry.maxHp <= 0 || entry.hp < 0 || entry.hp > entry.maxHp)
      fail('Invalid naval part HP');
    if (RAFT_PARTS[entry.part[0]]?.floats) {
      total++;
      maxHp += entry.maxHp;
      hp += entry.hp;
      if (entry.hp > 0) liveFloats++;
    }
  }
  return Object.freeze({ hp, maxHp, fraction: maxHp > 0 ? hp / maxHp : 0,
    destroyed: hp <= 0, total, disabled: liveFloats === 0 });
}

export function liveStructureParts(structure) {
  assertStructure(structure);
  return Object.freeze(structure.entries.filter((entry) => entry.hp > 0)
    .map((entry) => entry.part));
}

function distanceToFloat(entry, x, z) {
  const [type, gx, gz] = entry.part;
  const def = RAFT_PARTS[type];
  if (!def?.floats) return Infinity;
  const [width, depth] = def.size || [1, 1];
  const minX = gx * RAFT.cell, minZ = gz * RAFT.cell;
  const maxX = minX + width * RAFT.cell, maxZ = minZ + depth * RAFT.cell;
  const dx = Math.max(minX - x, 0, x - maxX);
  const dz = Math.max(minZ - z, 0, z - maxZ);
  return Math.hypot(dx, dz);
}

export function hitHullAt(structure, hit) {
  assertStructure(structure);
  if (!hit || !finite(hit.x) || !finite(hit.z) || !finite(hit.damage) || hit.damage < 0)
    fail('Invalid hull impact');
  let selected = null, nearest = Infinity;
  for (const entry of structure.entries) {
    if (entry.hp <= 0 || !RAFT_PARTS[entry.part?.[0]]?.floats) continue;
    const distance = distanceToFloat(entry, hit.x, hit.z);
    if (distance <= HIT_RADIUS && (distance < nearest || (distance === nearest && (!selected || compareIds(entry.id, selected.id) < 0)))) {
      selected = entry;
      nearest = distance;
    }
  }
  if (!selected || hit.damage === 0) return { structure, event: null };
  return applyPartDamage(structure, selected.id, hit.damage);
}
