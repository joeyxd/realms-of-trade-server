import { defaultEffectDocument, effectParameters, FLIPBOOK_PARAMETERS, getEffect } from './effectLibrary.js';

const SCHEMA = 'marea.skill-presentation';
export const MAX_SKILL_DOCUMENT_BYTES = 16 * 1024;
const HEX = /^#[0-9a-f]{6}$/;

export const SKILL_PARAMETERS = Object.freeze([
  Object.freeze({ key: 'scale', min: 0.5, max: 1.5, step: 0.01, default: 1 }),
  Object.freeze({ key: 'height', min: 0.5, max: 1.75, step: 0.01, default: 1 }),
  Object.freeze({ key: 'duration', min: 0.5, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'density', min: 0, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'spread', min: 0.5, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'speed', min: 0.5, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'brightness', min: 0.5, max: 1.5, step: 0.01, default: 1 }),
  Object.freeze({ key: 'deep', type: 'color', default: '#1f86c0' }),
  Object.freeze({ key: 'foam', type: 'color', default: '#dff7ff' }),
]);

export const DEFAULT_SKILL_DOCUMENT = Object.freeze({
  schema: SCHEMA, version: 1, skill: 'tromba', effect: 'tromba-current-v1',
  parameters: Object.freeze({ scale: 1, height: 1, duration: 1, density: 1, spread: 1, speed: 1, brightness: 1, deep: '#1f86c0', foam: '#dff7ff' }),
});

const isPlainObject = (value) => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, expected) => {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every((key) => typeof key === 'string' && expected.includes(key)) &&
    expected.every((key) => Object.hasOwn(value, key));
};

function validateParameters(parameters, metadata) {
  if (!exactKeys(parameters, metadata.map(({ key }) => key))) return { ok: false, why: 'parameters' };
  for (const meta of metadata) {
    const next = parameters[meta.key];
    if (meta.type === 'color') {
      if (typeof next !== 'string' || !HEX.test(next)) return { ok: false, why: 'color' };
    } else if (typeof next !== 'number' || !Number.isFinite(next) || next < meta.min || next > meta.max) {
      return { ok: false, why: 'range' };
    }
  }
  return { ok: true };
}

/** Validate either the unchanged Tromba v1 contract or a registered ready flipbook v2 contract. */
export function validateSkillDocument(value) {
  if (!isPlainObject(value)) return { ok: false, why: 'shape' };
  if (value.version === 1) {
    if (!exactKeys(value, ['schema', 'version', 'skill', 'effect', 'parameters'])) return { ok: false, why: 'shape' };
    if (value.schema !== SCHEMA || value.version !== 1 || value.skill !== 'tromba' || value.effect !== 'tromba-current-v1') return { ok: false, why: 'identity' };
    return validateParameters(value.parameters, SKILL_PARAMETERS);
  }
  if (value.version !== 2) return { ok: false, why: 'version' };
  if (!exactKeys(value, ['schema', 'version', 'skill', 'effect', 'parameters'])) return { ok: false, why: 'shape' };
  const effect = getEffect(value.effect);
  return validateFlipbookDocument(value, effect, effect ? effectParameters(effect.id) : FLIPBOOK_PARAMETERS);
}

/** Validate a v2 descriptor against a closed registry entry and its parameter schema. */
export function validateFlipbookDocument(value, effect, metadata = FLIPBOOK_PARAMETERS) {
  if (!exactKeys(value, ['schema', 'version', 'skill', 'effect', 'parameters'])) return { ok: false, why: 'shape' };
  if (value.schema !== SCHEMA || value.version !== 2 || value.skill !== 'preview' || typeof value.effect !== 'string') return { ok: false, why: 'identity' };
  if (!effect?.ready || effect.id !== value.effect || effect.adapter !== 'flipbook-v1') return { ok: false, why: 'effect' };
  return validateParameters(value.parameters, metadata);
}

/** Return a detached validated document copy. */
export function cloneSkillDocument(value = DEFAULT_SKILL_DOCUMENT) {
  if (!validateSkillDocument(value).ok) throw new Error('Invalid skill document');
  return {
    schema: SCHEMA, version: value.version, skill: value.version === 1 ? 'tromba' : 'preview',
    effect: value.effect, parameters: { ...value.parameters },
  };
}

export function createDefaultSkillDocument(effectId = DEFAULT_SKILL_DOCUMENT.effect) {
  const value = defaultEffectDocument(effectId);
  if (!value) throw new Error('Effect is not ready for editing');
  return cloneSkillDocument(value);
}

/** Parse bounded UTF-8 JSON and reject unknown, unregistered, or unsafe fields. */
export function parseSkillDocument(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_SKILL_DOCUMENT_BYTES) {
    throw new Error('Invalid skill document');
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid skill document'); }
  if (!validateSkillDocument(value).ok) throw new Error('Invalid skill document');
  return cloneSkillDocument(value);
}
