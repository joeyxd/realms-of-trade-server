// Pure private-fire fuel state. Callers supply authoritative world game-seconds; wall time is never read.
import { FIRE_KINDS, FIRE_MAX_REV, FIRE_MAX_SLOTS, FIRE_SECONDS } from '../../data/fire.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, expected) => {
  if (!plain(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && descriptor.enumerable === true && own(descriptor, 'value');
  });
};
const validKind = (kind) => typeof kind === 'string' && own(FIRE_SECONDS, kind);

function validSlotKey(key) {
  if (key === 'hand') return true;
  if (typeof key !== 'string' || key.length > 256) return false;
  try {
    const pair = JSON.parse(key);
    return Array.isArray(pair) && pair.length === 2 && pair.every((part) =>
      typeof part === 'string' && part.length >= 1 && part.length <= 120 && /^[A-Za-z0-9:_-]+$/.test(part)) &&
      JSON.stringify(pair) === key;
  } catch { return false; }
}

function cleanSlot(raw) {
  if (!exactKeys(raw, ['kind', 'seconds', 'since', 'lit']) || !validKind(raw.kind) ||
      !Number.isSafeInteger(raw.seconds) || raw.seconds < 0 || raw.seconds > FIRE_SECONDS[raw.kind] ||
      typeof raw.since !== 'number' || !Number.isFinite(raw.since) || raw.since < 0 ||
      typeof raw.lit !== 'boolean' || (!raw.lit && raw.since !== 0)) throw new TypeError('fire state');
  return { kind: raw.kind, seconds: raw.seconds, since: raw.since, lit: raw.lit };
}

export function newFire() {
  return { v: 1, rev: 0, slots: {} };
}

// Missing fields are accepted for legacy profiles; present state must match this version exactly.
export function readFire(raw) {
  if (raw === undefined) return newFire();
  if (!exactKeys(raw, ['v', 'rev', 'slots']) || raw.v !== 1 ||
      !Number.isSafeInteger(raw.rev) || raw.rev < 0 || raw.rev > FIRE_MAX_REV || !plain(raw.slots))
    throw new TypeError('fire state');
  const keys = Object.keys(raw.slots);
  if (keys.length > FIRE_MAX_SLOTS) throw new TypeError('fire slots');
  const slots = {};
  for (const key of keys) {
    if (!validSlotKey(key)) throw new TypeError('fire slot key');
    const descriptor = Object.getOwnPropertyDescriptor(raw.slots, key);
    if (!descriptor || descriptor.enumerable !== true || !own(descriptor, 'value')) throw new TypeError('fire slot');
    Object.defineProperty(slots, key, { value: cleanSlot(descriptor.value), enumerable: true, writable: true, configurable: true });
  }
  return { v: 1, rev: raw.rev, slots };
}

function validNow(nowSec) {
  if (typeof nowSec !== 'number' || !Number.isFinite(nowSec) || nowSec < 0) throw new TypeError('fire clock');
}

// Returns whole remaining simulation seconds, rounding down so switching cannot create fuel.
export function remainingFire(slot, nowSec) {
  validNow(nowSec);
  const clean = cleanSlot(slot);
  if (!clean.lit) return clean.seconds;
  if (nowSec < clean.since) throw new TypeError('fire clock precedes state');
  return Math.max(0, Math.min(clean.seconds, Math.floor(clean.seconds - (nowSec - clean.since))));
}

function changedState(state, slots) {
  if (state.rev >= FIRE_MAX_REV) return { state, why: 'revisionLimit' };
  return { state: { v: 1, rev: state.rev + 1, slots }, why: '' };
}

// load creates one full unit only into an empty/exhausted slot; set toggles existing fuel without replenishing it.
export function changeFireSlot(rawState, key, { op, lit, kind } = {}, nowSec) {
  const state = readFire(rawState);
  validNow(nowSec);
  if (!validSlotKey(key)) return { state, why: 'slot' };
  if (!['load', 'set'].includes(op)) return { state, why: 'command' };
  const slots = { ...state.slots };
  const current = slots[key];

  if (op === 'load') {
    if (!validKind(kind)) return { state, why: 'kind' };
    if (!current && Object.keys(slots).length >= FIRE_MAX_SLOTS) return { state, why: 'full' };
    if (current && remainingFire(current, nowSec) > 0) return { state, why: 'occupied' };
    if (current?.kind === kind && current.seconds === FIRE_SECONDS[kind] && !current.lit) return { state, why: '' };
    if (lit !== undefined && typeof lit !== 'boolean') return { state, why: 'command' };
    slots[key] = { kind, seconds: FIRE_SECONDS[kind], since: lit ? nowSec : 0, lit: lit === true };
    return changedState(state, slots);
  }

  if (typeof lit !== 'boolean') return { state, why: 'command' };
  if (!current) return { state, why: 'empty' };
  if (kind !== undefined && kind !== current.kind) return { state, why: 'kind' };
  const remaining = remainingFire(current, nowSec);
  if (lit && remaining === 0) return { state, why: 'empty' };
  if (current.lit === lit && remaining > 0) return { state, why: '' };
  if (lit) slots[key] = { kind: current.kind, seconds: remaining, since: nowSec, lit: true };
  else slots[key] = { kind: current.kind, seconds: remaining, since: 0, lit: false };
  return changedState(state, slots);
}

// Client-facing projection contains detached plain data and never exposes the stored start timestamp.
export function fireRows(rawState, nowSec) {
  const state = readFire(rawState);
  validNow(nowSec);
  return Object.keys(state.slots).sort().map((key) => {
    const slot = state.slots[key], seconds = remainingFire(slot, nowSec);
    return { key, kind: slot.kind, seconds, lit: slot.lit && seconds > 0 };
  });
}

export const projectFireStatus = fireRows;
