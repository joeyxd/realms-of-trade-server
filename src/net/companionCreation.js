// Private preparation contract; a record is identity and documents, never a gameplay grant.
import { DEFAULT_COMPANION_DRAFT, validateCompanionDraft, buildCompanionDocuments, randomizeCompanionDraft } from './companionTemplates.js';
import { companionId, validateCompanionConfigHead } from './companionConfig.js';

export const exactCreationKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const KEYS = ['v', 'name', 'role', 'personality', 'traits', 'skin'];
function validateCompanionControlHead(raw) {
  if (!exactCreationKeys(raw, ['revision', 'stopped', 'savedAt']) || !Number.isInteger(raw.revision)
    || raw.revision < 1 || raw.revision > 2147483647 || typeof raw.stopped !== 'boolean'
    || typeof raw.savedAt !== 'string' || raw.savedAt.length > 64 || !Number.isFinite(Date.parse(raw.savedAt))) {
    throw new TypeError('invalid_companion_control');
  }
  return { revision: raw.revision, stopped: raw.stopped, savedAt: new Date(raw.savedAt).toISOString() };
}
export function companionPreset(draft) { return Object.fromEntries(KEYS.map(key => [key, structuredClone(draft[key])])); }
export const DEFAULT_COMPANION_PRESET = Object.freeze(companionPreset(DEFAULT_COMPANION_DRAFT));
export function validateCompanionPreset(raw) {
  if (!exactCreationKeys(raw, KEYS)) throw new TypeError('invalid_companion_preset');
  const checked = validateCompanionDraft({ ...structuredClone(raw), modelId: 'local-model',
    baseUrl: 'http://127.0.0.1:8080/v1', thinkingMode: 'server_default' });
  return companionPreset(checked);
}
export function randomCompanionPreset(seed, overrides = {}) {
  return companionPreset(randomizeCompanionDraft({ seed, ...overrides }));
}
export function companionCreationConfig(preset) {
  const checked = validateCompanionPreset(preset);
  const docs = buildCompanionDocuments({ ...checked, modelId: 'local-model', baseUrl: 'http://127.0.0.1:8080/v1',
    thinkingMode: 'server_default' }, { ownerId: 'template-owner', characterId: 'template-character', worldId: 'template-world' });
  return { v: 1, personality: docs.personality, goals: JSON.parse(docs.objectives).goals };
}
export function validateCompanionRecord(raw) {
  if (!exactCreationKeys(raw, ['characterKey', 'creationId', 'preset', 'createdAt', 'configuration', 'control'])
    || !companionId(raw.characterKey) || !companionId(raw.creationId)
    || typeof raw.createdAt !== 'string' || raw.createdAt.length > 64 || !Number.isFinite(Date.parse(raw.createdAt))) {
    throw new TypeError('invalid_companion_record');
  }
  const preset = validateCompanionPreset(raw.preset), configuration = validateCompanionConfigHead(raw.configuration),
    control = validateCompanionControlHead(raw.control);
  if (configuration.revision < 1 || control.revision < 1) throw new TypeError('invalid_companion_record');
  return { characterKey: raw.characterKey, creationId: raw.creationId, preset, createdAt: raw.createdAt, configuration, control };
}
