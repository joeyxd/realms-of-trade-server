const SCHEMA = 'marea.skill-presentation';
const VERSION = 1;
const MAX_BYTES = 16 * 1024;
const HEX = /^#[0-9a-f]{6}$/;
const KEYS = Object.freeze(['scale', 'height', 'duration', 'density', 'spread', 'speed', 'brightness', 'deep', 'foam']);

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

const DEFAULT_PARAMETERS = Object.freeze({
  scale: 1, height: 1, duration: 1, density: 1, spread: 1, speed: 1, brightness: 1,
  deep: '#1f86c0', foam: '#dff7ff',
});

export const DEFAULT_SKILL_DOCUMENT = Object.freeze({
  schema: SCHEMA,
  version: VERSION,
  skill: 'tromba',
  effect: 'tromba-current-v1',
  parameters: DEFAULT_PARAMETERS,
});

const isPlainObject = (value) => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, expected) => {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every((key) => typeof key === 'string' && expected.includes(key)) &&
    expected.every((key) => Object.hasOwn(value, key));
};

/** Validate the closed, versioned Tromba presentation contract. */
export function validateSkillDocument(value) {
  const rootKeys = ['schema', 'version', 'skill', 'effect', 'parameters'];
  if (!exactKeys(value, rootKeys)) return { ok: false, why: 'shape' };
  if (value.schema !== SCHEMA || value.version !== VERSION || value.skill !== 'tromba' || value.effect !== 'tromba-current-v1') {
    return { ok: false, why: 'identity' };
  }
  const parameters = value.parameters;
  if (!exactKeys(parameters, KEYS)) return { ok: false, why: 'parameters' };
  for (const meta of SKILL_PARAMETERS) {
    const next = parameters[meta.key];
    if (meta.type === 'color') {
      if (typeof next !== 'string' || !HEX.test(next)) return { ok: false, why: 'color' };
    } else if (typeof next !== 'number' || !Number.isFinite(next) || next < meta.min || next > meta.max) {
      return { ok: false, why: 'range' };
    }
  }
  return { ok: true };
}

/** Return a detached document copy after validating the complete document. */
export function cloneSkillDocument(value = DEFAULT_SKILL_DOCUMENT) {
  if (!validateSkillDocument(value).ok) throw new Error('Invalid skill document');
  return {
    schema: SCHEMA, version: VERSION, skill: 'tromba', effect: 'tromba-current-v1',
    parameters: { ...value.parameters },
  };
}

/** Parse bounded UTF-8 JSON and reject any unknown or unsafe fields. */
export function parseSkillDocument(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    throw new Error('Invalid skill document');
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid skill document'); }
  if (!validateSkillDocument(value).ok) throw new Error('Invalid skill document');
  return cloneSkillDocument(value);
}
