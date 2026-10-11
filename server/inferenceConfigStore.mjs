import { MAX_INFERENCE_CONFIG_BYTES, MAX_INFERENCE_CEILING, validateInferenceConfig, validateInferenceHead } from '../src/net/inferenceConfig.js';
import { MAX_CONFIG_REVISION } from '../src/net/companionConfig.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORLD = /^[A-Za-z0-9:_-]{1,100}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

export class InferenceConfigStoreError extends Error {
  constructor(code) { super(`inference config store: ${code}`); this.name = 'InferenceConfigStoreError'; this.code = code; }
}

function scope(raw) {
  if (!exact(raw, ['world', 'owner']) || typeof raw.world !== 'string' || !WORLD.test(raw.world) ||
      typeof raw.owner !== 'string' || !UUID.test(raw.owner) || raw.owner === ZERO_UUID) {
    throw new TypeError('invalid inference config scope');
  }
  return { world: raw.world, owner: raw.owner };
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_CONFIG_REVISION) {
    throw new TypeError('invalid inference config revision');
  }
  return value;
}

function head(raw) {
  try { return validateInferenceHead(raw); }
  catch { throw new InferenceConfigStoreError('response'); }
}

function scopeKey(value) { return JSON.stringify([value.world, value.owner]); }
const sameConfig = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function createMemoryInferenceConfigMethods() {
  const rows = new Map();
  const loadInferenceConfig = async raw => {
    const input = scope(raw), row = rows.get(scopeKey(input));
    return row ? structuredClone(row) : { revision: 0, config: null, savedAt: null };
  };
  const saveInferenceConfig = async raw => {
    if (!exact(raw, ['world', 'owner', 'expectedRevision', 'config'])) {
      throw new TypeError('invalid inference config save');
    }
    const input = scope({ world: raw.world, owner: raw.owner });
    const expected = expectedRevision(raw.expectedRevision), config = validateInferenceConfig(raw.config);
    if (Buffer.byteLength(JSON.stringify(config), 'utf8') > MAX_INFERENCE_CONFIG_BYTES) {
      throw new TypeError('invalid inference config');
    }
    const key = scopeKey(input), current = rows.get(key) ?? { revision: 0, config: null, savedAt: null };
    if (current.revision === expected + 1 && sameConfig(current.config, config)) {
      return { ok: true, replay: true, head: structuredClone(current) };
    }
    if (current.revision !== expected) return { ok: false, why: 'conflict', head: structuredClone(current) };
    const next = { revision: expected + 1, config: structuredClone(config), savedAt: new Date().toISOString() };
    rows.set(key, next);
    return { ok: true, replay: false, head: structuredClone(next) };
  };
  return { async checkInferenceConfig() { return { version: 1 }; }, loadInferenceConfig, saveInferenceConfig };
}

export function createSupabaseInferenceConfigMethods(client) {
  if (!client || typeof client.rpc !== 'function') throw new InferenceConfigStoreError('configuration');
  async function rpc(name, args) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) throw new Error('rpc');
      return result.data;
    } catch { throw new InferenceConfigStoreError('unavailable'); }
  }
  return {
    async checkInferenceConfig() {
      const raw = await rpc('mn_inference_config_ready', {});
      if (!exact(raw, ['version']) || raw.version !== 1) throw new InferenceConfigStoreError('response');
      return { version: 1 };
    },
    async loadInferenceConfig(raw) {
      const input = scope(raw);
      return head(await rpc('mn_load_inference_config', { p_world: input.world, p_owner: input.owner }));
    },
    async saveInferenceConfig(raw) {
      if (!exact(raw, ['world', 'owner', 'expectedRevision', 'config'])) {
        throw new TypeError('invalid inference config save');
      }
      const input = scope({ world: raw.world, owner: raw.owner });
      const revision = expectedRevision(raw.expectedRevision), config = validateInferenceConfig(raw.config);
      if (Buffer.byteLength(JSON.stringify(config), 'utf8') > MAX_INFERENCE_CONFIG_BYTES ||
          config.ceilingNanoUsd > MAX_INFERENCE_CEILING) throw new TypeError('invalid inference config');
      const result = await rpc('mn_save_inference_config', {
        p_world: input.world, p_owner: input.owner, p_expected_revision: revision, p_config: config,
      });
      if (exact(result, ['ok', 'why', 'head']) && result.ok === false && result.why === 'conflict') {
        return { ok: false, why: 'conflict', head: head(result.head) };
      }
      if (exact(result, ['ok', 'replay', 'head']) && result.ok === true && typeof result.replay === 'boolean') {
        const saved = head(result.head);
        if (saved.revision !== revision + 1 || !sameConfig(saved.config, config)) throw new InferenceConfigStoreError('response');
        return { ok: true, replay: result.replay, head: saved };
      }
      throw new InferenceConfigStoreError('response');
    },
  };
}
