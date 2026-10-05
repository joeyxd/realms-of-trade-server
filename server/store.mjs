// M5's server-only storage contract. Memory exercises the same optimistic writes as Postgres;
// it does not survive a process restart. Account identity must come from a trusted host resolver.
import { createClient } from '@supabase/supabase-js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_KEY = /^[0-9a-f]{64}$/;
const MAX_VERSION = 2147483647;
export class StoreError extends Error {
  constructor(code) { super(`Storage: ${code}`); this.name = 'StoreError'; this.code = code; }
}
export function playerKey(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new StoreError('identity');
  return id.toLowerCase();
}
function key(value, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new StoreError('key');
  return value;
}
function version(value, min = 0, max = MAX_VERSION) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new StoreError('version');
  return value;
}
function json(value, maxBytes = 2 * 1024 * 1024) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoreError('data');
  try {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > maxBytes) throw new Error('large');
    return JSON.parse(encoded);
  } catch { throw new StoreError('data'); }
}
function profile(value) {
  const p = sanitizeProfile(json(value, 128 * 1024));
  if (!p) throw new StoreError('profile');
  return p;
}
function legacyKey(value) {
  if (typeof value !== 'string' || !LEGACY_KEY.test(value)) throw new StoreError('legacy_key');
  return value;
}
const conflict = () => ({ ok: false, why: 'conflict' });

export function createMemoryStore() {
  const profiles = new Map(), worlds = new Map(), uniques = new Map(), legacyImports = new Map();
  const load = (map, id) => map.has(id) ? structuredClone(map.get(id)) : null;
  const save = (map, id, data, expected) => {
    const current = map.get(id);
    if ((current?.version ?? 0) !== expected) return conflict();
    map.set(id, { data, version: expected + 1 });
    return { ok: true, version: expected + 1 };
  };
  return {
    kind: 'memory', durable: false,
    async loadProfile(id) { return load(profiles, playerKey(id)); },
    async saveProfile(id, data, expected) { return save(profiles, playerKey(id), profile(data), version(expected, 0, MAX_VERSION - 1)); },
    async initializeProfile(id, data, importedKey = null) {
      id = playerKey(id);
      data = profile(data);
      if (importedKey !== null) importedKey = legacyKey(importedKey);
      const existing = profiles.get(id);
      if (existing) return structuredClone(existing);
      if (importedKey !== null && legacyImports.has(importedKey) && legacyImports.get(importedKey) !== id) {
        throw new StoreError('legacy_used');
      }
      profiles.set(id, { data, version: 1 });
      if (importedKey !== null) legacyImports.set(importedKey, id);
      return { data: structuredClone(data), version: 1 };
    },
    async legacyClaimed(importedKey) { return legacyImports.has(legacyKey(importedKey)); },
    async loadWorld(id) { return load(worlds, key(id)); },
    async saveWorld(id, data, expected) { return save(worlds, key(id), json(data), version(expected, 0, MAX_VERSION - 1)); },
    async claimUnique(uid, kind, holder) {
      key(uid, 160); key(kind); holder = playerKey(holder);
      const current = uniques.get(uid);
      if (current && current.kind !== kind) return { ok: false, why: 'kind' };
      if (current?.holder && current.holder !== holder) return { ok: false, why: 'occupied' };
      if (current?.holder === holder) return { ok: true, version: current.version };
      const next = (current?.version ?? 0) + 1;
      version(next);
      uniques.set(uid, { kind, holder, version: next });
      return { ok: true, version: next };
    },
    async releaseUnique(uid, holder, generation) {
      key(uid, 160); holder = playerKey(holder); version(generation, 1);
      const current = uniques.get(uid);
      if (!current || current.holder !== holder || current.version !== generation) return conflict();
      version(current.version + 1);
      current.holder = null; current.version++;
      return { ok: true, version: current.version };
    },
  };
}

export function createSupabaseStore(client) {
  if (!client || typeof client.rpc !== 'function') throw new StoreError('configuration');
  async function rpc(name, args, duplicateCode = null) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) {
        if (duplicateCode && result?.error?.code === duplicateCode) throw new StoreError('legacy_used');
        throw new Error('rpc');
      }
      return result.data;
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError('unavailable'); // Never forward credential-bearing provider errors.
    }
  }
  function record(raw, sanitize) {
    if (raw === null) return null;
    if (!raw || typeof raw !== 'object') throw new StoreError('response');
    return { data: sanitize(raw.data), version: version(raw.version, 1) };
  }
  function written(raw, reasons = ['conflict']) {
    if (raw?.ok === true) return { ok: true, version: version(raw.version, 1) };
    if (raw?.ok === false && reasons.includes(raw.why)) return { ok: false, why: raw.why };
    throw new StoreError('response');
  }
  return {
    kind: 'supabase', durable: true,
    async loadProfile(id) { return record(await rpc('mn_load_profile', { p_player_id: playerKey(id) }), profile); },
    async initializeProfile(id, data, importedKey = null) {
      if (importedKey !== null) importedKey = legacyKey(importedKey);
      const raw = await rpc('mn_initialize_profile', {
        p_player_id: playerKey(id), p_data: profile(data), p_legacy_key: importedKey,
      }, 'MNL01');
      if (!raw) throw new StoreError('response');
      return record(raw, profile);
    },
    async legacyClaimed(importedKey) {
      const result = await rpc('mn_legacy_claimed', { p_legacy_key: legacyKey(importedKey) });
      if (typeof result !== 'boolean') throw new StoreError('response');
      return result;
    },
    async saveProfile(id, data, expected) {
      return written(await rpc('mn_save_profile', { p_player_id: playerKey(id), p_data: profile(data), p_expected_version: version(expected, 0, MAX_VERSION - 1) }));
    },
    async loadWorld(id) { return record(await rpc('mn_load_world', { p_world: key(id) }), json); },
    async saveWorld(id, data, expected) {
      return written(await rpc('mn_save_world', { p_world: key(id), p_data: json(data), p_expected_version: version(expected, 0, MAX_VERSION - 1) }));
    },
    async claimUnique(uid, kind, holder) {
      return written(await rpc('mn_claim_unique', { p_uid: key(uid, 160), p_kind: key(kind), p_holder: playerKey(holder) }), ['kind', 'occupied']);
    },
    async releaseUnique(uid, holder, generation) {
      return written(await rpc('mn_release_unique', { p_uid: key(uid, 160), p_holder: playerKey(holder), p_version: version(generation, 1) }));
    },
  };
}

// Configuration is explicit until P2 supplies verified account identity. Partial credentials are an
// error, never an implicit fall back to memory. The service client must never receive a user's JWT.
export function storeFromEnv(env = process.env, factory = createClient) {
  const url = env.SUPABASE_URL, serviceKey = env.SUPABASE_SERVICE_KEY;
  if (!url && !serviceKey) return createMemoryStore();
  if (typeof url !== 'string' || typeof serviceKey !== 'string' || !serviceKey.trim()) throw new StoreError('configuration');
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('url');
    const client = factory(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
    });
    return createSupabaseStore(client);
  } catch { throw new StoreError('configuration'); }
}
