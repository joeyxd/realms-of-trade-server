import { MAX_CONFIG_BYTES, MAX_CONFIG_REVISION, validateCompanionConfig } from '../src/net/companionConfig.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORLD = /^[A-Za-z0-9:_-]{1,100}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

export class CompanionConfigStoreError extends Error {
  constructor(code) { super(`companion config store: ${code}`); this.name = 'CompanionConfigStoreError'; this.code = code; }
}

function scope(raw) {
  if (!exact(raw, ['world', 'owner', 'character']) ||
      typeof raw.world !== 'string' || !WORLD.test(raw.world) ||
      typeof raw.owner !== 'string' || !UUID.test(raw.owner) || raw.owner === ZERO_UUID ||
      typeof raw.character !== 'string' || !UUID.test(raw.character) || raw.character === ZERO_UUID ||
      raw.owner === raw.character) throw new TypeError('invalid companion config scope');
  return { world: raw.world, owner: raw.owner, character: raw.character };
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_CONFIG_REVISION) {
    throw new TypeError('invalid companion config revision');
  }
  return value;
}

function head(raw) {
  if (!exact(raw, ['revision', 'config', 'savedAt']) ||
      !Number.isSafeInteger(raw.revision) || raw.revision < 0 || raw.revision > MAX_CONFIG_REVISION) {
    throw new CompanionConfigStoreError('response');
  }
  if (raw.revision === 0) {
    if (raw.config !== null || raw.savedAt !== null) throw new CompanionConfigStoreError('response');
    return { revision: 0, config: null, savedAt: null };
  }
  let config;
  try { config = validateCompanionConfig(raw.config); } catch { throw new CompanionConfigStoreError('response'); }
  if (typeof raw.savedAt !== 'string' || raw.savedAt.length > 64 || !Number.isFinite(Date.parse(raw.savedAt))) {
    throw new CompanionConfigStoreError('response');
  }
  return { revision: raw.revision, config, savedAt: raw.savedAt };
}

function scopeKey(value) { return JSON.stringify([value.world, value.owner, value.character]); }
function sameConfig(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createMemoryCompanionConfigMethods() {
  const rows = new Map();
  const loadCompanionConfig = async (raw) => {
    const input = scope(raw), row = rows.get(scopeKey(input));
    return row ? structuredClone(row) : { revision: 0, config: null, savedAt: null };
  };
  const saveCompanionConfig = async (raw) => {
    if (!exact(raw, ['world', 'owner', 'character', 'expectedRevision', 'config'])) {
      throw new TypeError('invalid companion config save');
    }
    const input = scope({ world: raw.world, owner: raw.owner, character: raw.character });
    const expected = expectedRevision(raw.expectedRevision), config = validateCompanionConfig(raw.config);
    const key = scopeKey(input), current = rows.get(key) ?? { revision: 0, config: null, savedAt: null };
    if (current.revision === expected + 1 && sameConfig(current.config, config)) {
      return { ok: true, replay: true, head: structuredClone(current) };
    }
    if (current.revision !== expected) return { ok: false, why: 'conflict', head: structuredClone(current) };
    const next = { revision: expected + 1, config: structuredClone(config), savedAt: new Date().toISOString() };
    rows.set(key, next);
    return { ok: true, replay: false, head: structuredClone(next) };
  };
  return { async checkCompanionConfig() { return { version: 1 }; }, loadCompanionConfig, saveCompanionConfig };
}

export function createSupabaseCompanionConfigMethods(client) {
  if (!client || typeof client.rpc !== 'function') throw new CompanionConfigStoreError('configuration');
  async function rpc(name, args) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) throw new Error('rpc');
      return result.data;
    } catch { throw new CompanionConfigStoreError('unavailable'); }
  }
  return {
    async checkCompanionConfig() {
      const raw = await rpc('mn_companion_config_ready', {});
      if (!exact(raw, ['version']) || raw.version !== 1) {
        throw new CompanionConfigStoreError('response');
      }
      return { version: 1 };
    },
    async loadCompanionConfig(raw) {
      const input = scope(raw);
      return head(await rpc('mn_load_companion_config', {
        p_world: input.world, p_owner: input.owner, p_character: input.character,
      }));
    },
    async saveCompanionConfig(raw) {
      if (!exact(raw, ['world', 'owner', 'character', 'expectedRevision', 'config'])) {
        throw new TypeError('invalid companion config save');
      }
      const input = scope({ world: raw.world, owner: raw.owner, character: raw.character });
      const revision = expectedRevision(raw.expectedRevision), config = validateCompanionConfig(raw.config);
      // Rechecking the byte bound here keeps this RPC contract explicit if the shared validator evolves.
      if (Buffer.byteLength(JSON.stringify(config), 'utf8') > MAX_CONFIG_BYTES) throw new TypeError('invalid companion config');
      const result = await rpc('mn_save_companion_config', {
        p_world: input.world, p_owner: input.owner, p_character: input.character,
        p_expected_revision: revision, p_config: config,
      });
      if (exact(result, ['ok', 'why', 'head']) && result.ok === false && result.why === 'conflict') {
        return { ok: false, why: 'conflict', head: head(result.head) };
      }
      if (exact(result, ['ok', 'replay', 'head']) && result.ok === true && typeof result.replay === 'boolean') {
        return { ok: true, replay: result.replay, head: head(result.head) };
      }
      throw new CompanionConfigStoreError('response');
    },
  };
}
