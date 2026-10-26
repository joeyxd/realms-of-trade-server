// Private configuration only. A saved ceiling is not an admitted generation or a spend ledger.
import { companionId, MAX_CONFIG_REVISION } from './companionConfig.js';

export const MAX_INFERENCE_CEILING = 1000000000000;
export const MAX_INFERENCE_CONFIG_BYTES = 16384;
export const inferenceReference = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
export const inferenceModel = v => typeof v === 'string' && /^[A-Za-z0-9._:/-]{1,160}$/.test(v)
  && !v.includes('://') && !/sk-[A-Za-z0-9_-]{16,}/i.test(v);
export const inferenceExact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const ceiling = n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_INFERENCE_CEILING;
const fail = () => { throw new TypeError('invalid_inference_config'); };
const ordered = (rows, key) => rows.every((r, i) => i === 0 || rows[i - 1][key] < r[key]);

export function validateInferenceConfig(value) {
  if (!inferenceExact(value, ['v', 'ceilingNanoUsd', 'connections', 'companions']) || value.v !== 1
      || !ceiling(value.ceilingNanoUsd) || !Array.isArray(value.connections) || value.connections.length > 8
      || !Array.isArray(value.companions) || value.companions.length > 16) fail();
  const connections = value.connections.map(r => {
    if (!inferenceExact(r, ['id', 'ceilingNanoUsd']) || !inferenceReference(r.id)
        || !ceiling(r.ceilingNanoUsd) || r.ceilingNanoUsd > value.ceilingNanoUsd) fail();
    return { id: r.id, ceilingNanoUsd: r.ceilingNanoUsd };
  });
  const companions = value.companions.map(r => {
    if (!inferenceExact(r, ['character', 'connectionId', 'modelId']) || !companionId(r.character)
        || !inferenceReference(r.connectionId) || !inferenceModel(r.modelId)
        || !connections.some(c => c.id === r.connectionId)) fail();
    return { character: r.character, connectionId: r.connectionId, modelId: r.modelId };
  });
  if (!ordered(connections, 'id') || !ordered(companions, 'character')) fail();
  const result = { v: 1, ceilingNanoUsd: value.ceilingNanoUsd, connections, companions };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_INFERENCE_CONFIG_BYTES) fail();
  return result;
}

export function validateInferenceHead(value) {
  if (!inferenceExact(value, ['revision', 'config', 'savedAt']) || !Number.isSafeInteger(value.revision)
      || value.revision < 0 || value.revision > MAX_CONFIG_REVISION) fail();
  if (value.revision === 0) {
    if (value.config !== null || value.savedAt !== null) fail();
    return { revision: 0, config: null, savedAt: null };
  }
  if (typeof value.savedAt !== 'string' || value.savedAt.length > 64 || !Number.isFinite(Date.parse(value.savedAt))) fail();
  return { revision: value.revision, config: validateInferenceConfig(value.config), savedAt: value.savedAt };
}

export function validateInferenceCatalog(value) {
  if (!Array.isArray(value) || value.length > 8) fail();
  const rows = value.map(r => {
    if (!inferenceExact(r, ['id', 'label', 'providerId', 'maxCeilingNanoUsd', 'models']) || !inferenceReference(r.id)
        || !inferenceReference(r.providerId) || typeof r.label !== 'string' || !/^[\p{L}\p{N} ._-]{1,64}$/u.test(r.label)
        || !ceiling(r.maxCeilingNanoUsd) || !Array.isArray(r.models) || r.models.length < 1 || r.models.length > 32
        || r.models.some(m => !inferenceModel(m)) || new Set(r.models).size !== r.models.length) fail();
    return { id: r.id, label: r.label, providerId: r.providerId,
      maxCeilingNanoUsd: r.maxCeilingNanoUsd, models: [...r.models] };
  });
  if (!ordered(rows, 'id')) fail();
  return rows;
}

// Decimal USD input is converted with integer arithmetic; blank never implies a budget.
export function parseInferenceUsd(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,3})(\.[0-9]{1,9})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  return n <= BigInt(MAX_INFERENCE_CEILING) ? Number(n) : null;
}
export function formatInferenceUsd(n) {
  if (!ceiling(n)) return '';
  const whole = Math.floor(n / 1000000000), fraction = String(n % 1000000000).padStart(9, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}
