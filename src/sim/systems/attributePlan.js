// UNMOUNTED INV02a pure plan only. Returning ok does not mean storage committed, durable, or replay-safe.
// Do not connect to gameplay until M5 adds serialized durable acknowledgement and replay semantics.
import { tuning } from '../../data/tuning.js';
import { ATTR, attrPoints, readAttrField } from '../../data/attributes.js';
import { CARRY, carryLimits, readCarryField } from '../../data/carry.js';
import { GOODS } from '../../data/goods.js';
import { holdMass, holdUsed } from '../economy/cargo.js';

const MAX_REV_BEFORE_INCREMENT = 2147483645;
const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INVALID_CLONE = Symbol('unsupported canonical profile');
const objectLike = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function plain(raw) {
  if (!objectLike(raw)) return false;
  try {
    const proto = Object.getPrototypeOf(raw);
    return proto === Object.prototype || proto === null;
  } catch { return false; }
}

function ownData(raw, key) {
  try {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    return d?.enumerable && Object.hasOwn(d, 'value') ? { present: true, value: d.value } : { present: false };
  } catch { return { present: false }; }
}

function exactKeys(raw, keys) {
  if (!plain(raw)) return false;
  try {
    const own = Reflect.ownKeys(raw);
    return own.length === keys.length && keys.every((key) => {
      const d = Object.getOwnPropertyDescriptor(raw, key);
      return d?.enumerable && Object.hasOwn(d, 'value');
    });
  } catch { return false; }
}

function parseCommand(command) {
  if (!plain(command)) return null;
  const opField = ownData(command, 'op');
  if (!opField.present) return null;
  const op = opField.value;
  const keys = op === 'assign'
    ? ['type', 'op', 'opId', 'expectedRev', 'stat', 'n']
    : op === 'reset' ? ['type', 'op', 'opId', 'expectedRev'] : null;
  if (!keys || !exactKeys(command, keys)) return null;
  const values = Object.fromEntries(keys.map((key) => [key, ownData(command, key).value]));
  if (values.type !== 'attributes' || typeof values.opId !== 'string' || !OP_ID.test(values.opId) ||
      !Number.isSafeInteger(values.expectedRev) || values.expectedRev < 0 || values.expectedRev > MAX_REV_BEFORE_INCREMENT) return null;
  if (op === 'assign' && (values.stat !== 'carga' || !Number.isSafeInteger(values.n) || values.n < 1 || values.n > ATTR.maxPoints)) return null;
  return values;
}

function error(why, profile) { return { ok: false, why, profile }; }

// The source must be a plain JSON DTO. Read descriptors instead of properties so accessors never run.
function cloneCanonical(value, active = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID_CLONE;
  if (!objectLike(value) && !Array.isArray(value)) return INVALID_CLONE;
  if (active.has(value)) return INVALID_CLONE;
  active.add(value);
  try {
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (proto !== Array.prototype) return INVALID_CLONE;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value)) return INVALID_CLONE;
      const out = new Array(lengthDescriptor.value), keys = Reflect.ownKeys(value);
      if (keys.length !== lengthDescriptor.value + 1) return INVALID_CLONE;
      for (let i = 0; i < lengthDescriptor.value; i++) {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d?.enumerable || !Object.hasOwn(d, 'value')) return INVALID_CLONE;
        const copied = cloneCanonical(d.value, active);
        if (copied === INVALID_CLONE) return INVALID_CLONE;
        out[i] = copied;
      }
      return out;
    }
    if (proto !== Object.prototype && proto !== null) return INVALID_CLONE;
    const out = Object.create(proto), keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (typeof key !== 'string') return INVALID_CLONE;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d?.enumerable || !Object.hasOwn(d, 'value')) return INVALID_CLONE;
      const copied = cloneCanonical(d.value, active);
      if (copied === INVALID_CLONE) return INVALID_CLONE;
      Object.defineProperty(out, key, { value: copied, enumerable: true, writable: true, configurable: true });
    }
    return out;
  } catch { return INVALID_CLONE; }
  finally { active.delete(value); }
}

function inspectProfile(profile) {
  if (!plain(profile)) return { why: 'profile' };
  const cloned = cloneCanonical(profile);
  if (cloned === INVALID_CLONE) return { why: 'profile' };
  const levelField = ownData(profile, 'lvl');
  if (!levelField.present || !Number.isSafeInteger(levelField.value) || levelField.value < 1 || levelField.value > tuning.stats.maxLevel) {
    return { why: 'profile' };
  }
  const level = levelField.value;
  const attrField = readAttrField(profile);
  if (attrField.present && !attrField.value) return { why: 'profile' };
  const attr = attrField.value || { v: ATTR.version, carga: 0, re: 0 };
  if (attr.carga > level - 1) return { why: 'profile' };

  const carryField = readCarryField(profile);
  if (!carryField.present || !carryField.value) return { why: 'carry' };
  const carry = carryField.value;
  const ecoField = ownData(profile, 'eco');
  if (!ecoField.present || !plain(ecoField.value)) return { why: 'profile' };
  const revField = ownData(ecoField.value, 'tradeRev'), packField = ownData(ecoField.value, 'pack');
  if (!revField.present || !Number.isSafeInteger(revField.value) || revField.value < 0 || revField.value > 2147483646 ||
      !packField.present || !exactKeys(packField.value, ['cap', 'maxMass', 'goods'])) return { why: 'profile' };
  const pack = packField.value;
  const capField = ownData(pack, 'cap'), massField = ownData(pack, 'maxMass'), goodsField = ownData(pack, 'goods');
  if (!capField.present || capField.value !== CARRY.backpacks[carry.backpack] || !massField.present ||
      !Number.isSafeInteger(massField.value) || !goodsField.present || !plain(goodsField.value)) return { why: 'carry' };

  const limits = carryLimits(carry, level);
  const recordedMaxMass = attrField.present ? 50 + 5 * attr.carga : limits?.maxMass;
  if (!limits || massField.value !== recordedMaxMass) return { why: 'carry' };

  // Validate keys/counts before calling hold helpers; this keeps getters and unknown goods out of the calculation.
  try {
    for (const key of Reflect.ownKeys(goodsField.value)) {
      if (typeof key !== 'string' || !Object.hasOwn(GOODS, key)) return { why: 'profile' };
      const d = Object.getOwnPropertyDescriptor(goodsField.value, key);
      if (!d?.enumerable || !Object.hasOwn(d, 'value') || !Number.isSafeInteger(d.value) || d.value <= 0) return { why: 'profile' };
    }
    const used = holdUsed(pack), mass = holdMass(pack);
    if (!Number.isFinite(used) || used < 0 || used > capField.value || !Number.isFinite(mass) || mass < 0) return { why: 'carry' };
    return { level, attrField, attr, carry, pack, eco: ecoField.value, tradeRev: revField.value, clone: cloned,
      volume: limits.volume, mass };
  } catch { return { why: 'profile' }; }
}

function resultPoints(level, attr) {
  const status = attrPoints({ lvl: level, attr }, level);
  return { earned: status.earned, invested: status.invested, available: status.available, resetsLeft: status.resetsLeft };
}

function resultLimits(volume, carga) {
  const comfortableMass = 40 + 4 * carga;
  return { volume, comfortableMass, maxMass: 50 + 5 * carga };
}

/** Pure, unmounted validation/planning for a single Carga allocation or its one free reset. */
export function planAttributeChange(profile, command) {
  const parsed = parseCommand(command);
  if (!parsed) return error('command', profile);
  const source = inspectProfile(profile);
  if (source.why) return error(source.why, profile);
  if (source.tradeRev > MAX_REV_BEFORE_INCREMENT) return error('limit', profile);
  if (parsed.expectedRev !== source.tradeRev) return error('conflict', profile);

  const earned = source.level - 1;
  let nextAttr = { ...source.attr };
  if (parsed.op === 'assign') {
    if (parsed.n > earned - source.attr.carga) return error('points', profile);
    nextAttr.carga += parsed.n;
  } else {
    if (source.attr.carga <= 0) return error('empty', profile);
    if (source.attr.re >= ATTR.freeResets) return error('used', profile);
    if (source.mass > 50 + 1e-9) return error('heavy', profile);
    nextAttr.carga = 0;
    nextAttr.re = 1;
  }

  const limits = resultLimits(source.volume, nextAttr.carga);
  if (source.mass > limits.maxMass + 1e-9) return error('heavy', profile);

  const next = source.clone;
  next.attr = nextAttr;
  next.eco.pack.maxMass = limits.maxMass;
  next.eco.tradeRev = source.tradeRev + 1;
  return { ok: true, why: '', profile: next, points: resultPoints(source.level, nextAttr), limits };
}
