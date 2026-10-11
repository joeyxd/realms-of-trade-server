import { randomUUID } from 'node:crypto';
import { companionCreationConfig, validateCompanionPreset, validateCompanionRecord, exactCreationKeys } from '../src/net/companionCreation.js';
import { validateCompanionConfig } from '../src/net/companionConfig.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORLD = /^[A-Za-z0-9:_-]{1,100}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const exact = (value, keys) => exactCreationKeys(value, keys);

export class CompanionCreationStoreError extends Error {
  constructor(code) { super(`companion creation store: ${code}`); this.name = 'CompanionCreationStoreError'; this.code = code; }
}

function scope(raw, keys) {
  if (!exact(raw, keys) || typeof raw.world !== 'string' || !WORLD.test(raw.world) ||
      typeof raw.owner !== 'string' || !UUID.test(raw.owner) || raw.owner === ZERO_UUID) {
    throw new TypeError('invalid companion creation scope');
  }
  return { world: raw.world, owner: raw.owner };
}

function input(raw) {
  if (!exact(raw, ['world', 'owner', 'creationId', 'preset', 'config']) ||
      typeof raw.creationId !== 'string' || !UUID.test(raw.creationId) || raw.creationId === ZERO_UUID) {
    throw new TypeError('invalid companion creation');
  }
  const { world, owner } = scope({ world: raw.world, owner: raw.owner }, ['world', 'owner']);
  const preset = validateCompanionPreset(raw.preset), config = validateCompanionConfig(raw.config);
  if (!same(companionCreationConfig(preset), config)) throw new TypeError('invalid companion creation config');
  return { world, owner, creationId: raw.creationId, preset, config };
}

function result(raw) {
  if (exact(raw, ['ok', 'replay', 'record']) && raw.ok === true && typeof raw.replay === 'boolean') {
    try { return { ok: true, replay: raw.replay, record: validateCompanionRecord(raw.record) }; }
    catch { throw new CompanionCreationStoreError('response'); }
  }
  if (exact(raw, ['ok', 'why', 'record']) && raw.ok === false && ['conflict', 'limit'].includes(raw.why)) {
    try { return { ok: false, why: raw.why, record: raw.record === null ? null : validateCompanionRecord(raw.record) }; }
    catch { throw new CompanionCreationStoreError('response'); }
  }
  throw new CompanionCreationStoreError('response');
}

function record(raw) {
  try { return validateCompanionRecord(raw); }
  catch { throw new CompanionCreationStoreError('response'); }
}

const scopeKey = (world, owner) => JSON.stringify([world, owner]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createMemoryCompanionCreationMethods({ now = () => new Date().toISOString(), characterId = randomUUID } = {}) {
  if (typeof now !== 'function' || typeof characterId !== 'function') throw new TypeError('invalid companion creation runtime');
  const records = new Map();
  let tail = Promise.resolve();
  const loadCompanionCreation = async raw => {
    const { world, owner } = scope(raw, ['world', 'owner']);
    const record = records.get(scopeKey(world, owner));
    return record ? structuredClone(record) : null;
  };
  const createCompanion = async raw => {
    const checked = input(raw), key = scopeKey(checked.world, checked.owner);
    let release;
    const previous = tail;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if ([...records.values()].some(record => record.characterKey === checked.owner)) {
        throw new CompanionCreationStoreError('response');
      }
      const current = records.get(key);
      if (current) {
        if (current.creationId === checked.creationId && same(current.preset, checked.preset) &&
            same(current.configuration.config, checked.config)) {
          return { ok: true, replay: true, record: structuredClone(current) };
        }
        return { ok: false, why: current.creationId === checked.creationId ? 'conflict' : 'limit', record: structuredClone(current) };
      }
      if ([...records.keys()].filter(existing => JSON.parse(existing)[0] === checked.world).length >= 64) {
        return { ok: false, why: 'limit', record: null };
      }
      let characterKey = characterId();
      if (typeof characterKey !== 'string' || !UUID.test(characterKey) || characterKey === ZERO_UUID || characterKey === checked.owner ||
          [...records.values()].some(record => record.characterKey === characterKey) ||
          [...records.keys()].some(existing => JSON.parse(existing)[1] === characterKey)) {
        throw new CompanionCreationStoreError('response');
      }
      const createdAt = now();
      const configuration = { revision: 1, config: structuredClone(checked.config), savedAt: createdAt };
      const control = { revision: 1, stopped: true, savedAt: createdAt };
      const record = validateCompanionRecord({ characterKey, creationId: checked.creationId, preset: checked.preset,
        createdAt, configuration, control });
      records.set(key, structuredClone(record));
      return { ok: true, replay: false, record: structuredClone(record) };
    } finally { release(); }
  };
  return { async checkCompanionCreation() { return { version: 1 }; }, loadCompanionCreation, createCompanion };
}

export function createSupabaseCompanionCreationMethods(client) {
  if (!client || typeof client.rpc !== 'function') throw new CompanionCreationStoreError('configuration');
  async function rpc(name, args) {
    try {
      const response = await client.rpc(name, args);
      if (!response || response.error) {
        if (name === 'mn_create_companion' && ['CCN02', 'CCN03'].includes(response?.error?.code)) {
          return { ok: false, why: response.error.code === 'CCN02' ? 'limit' : 'conflict', record: null };
        }
        throw new Error('rpc');
      }
      return response.data;
    } catch (error) {
      if (error instanceof CompanionCreationStoreError) throw error;
      throw new CompanionCreationStoreError('unavailable');
    }
  }
  return {
    async checkCompanionCreation() {
      const raw = await rpc('mn_companion_creation_ready', {});
      if (!exact(raw, ['version']) || raw.version !== 1) throw new CompanionCreationStoreError('response');
      return { version: 1 };
    },
    async loadCompanionCreation(raw) {
      const input = scope(raw, ['world', 'owner']);
      const value = await rpc('mn_load_companion_creation', { p_world: input.world, p_owner: input.owner });
      return value === null ? null : record(value);
    },
    async createCompanion(raw) {
      const checked = input(raw);
      const value = await rpc('mn_create_companion', { p_world: checked.world, p_owner: checked.owner,
        p_creation_id: checked.creationId, p_preset: checked.preset, p_config: checked.config });
      return result(value);
    },
  };
}
