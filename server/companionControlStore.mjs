const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORLD = /^[A-Za-z0-9:_-]{1,100}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const MAX_REVISION = 2147483647;

const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

export class CompanionControlStoreError extends Error {
  constructor(code) { super(`companion control store: ${code}`); this.name = 'CompanionControlStoreError'; this.code = code; }
}

function scope(raw) {
  if (!exact(raw, ['world', 'owner', 'character']) ||
      typeof raw.world !== 'string' || !WORLD.test(raw.world) ||
      typeof raw.owner !== 'string' || !UUID.test(raw.owner) || raw.owner === ZERO_UUID ||
      typeof raw.character !== 'string' || !UUID.test(raw.character) || raw.character === ZERO_UUID ||
      raw.owner === raw.character) throw new TypeError('invalid companion control scope');
  return { world: raw.world, owner: raw.owner, character: raw.character };
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_REVISION) {
    throw new TypeError('invalid companion control revision');
  }
  return value;
}

function head(raw) {
  if (!exact(raw, ['revision', 'stopped', 'savedAt']) ||
      !Number.isSafeInteger(raw.revision) || raw.revision < 0 || raw.revision > MAX_REVISION) {
    throw new CompanionControlStoreError('response');
  }
  if (raw.revision === 0) {
    if (raw.stopped !== true || raw.savedAt !== null) throw new CompanionControlStoreError('response');
    return { revision: 0, stopped: true, savedAt: null };
  }
  if (typeof raw.stopped !== 'boolean' || typeof raw.savedAt !== 'string' || raw.savedAt.length > 64 ||
      !Number.isFinite(Date.parse(raw.savedAt))) throw new CompanionControlStoreError('response');
  return { revision: raw.revision, stopped: raw.stopped, savedAt: raw.savedAt };
}

function scopeKey(value) { return JSON.stringify([value.world, value.owner, value.character]); }
const initialHead = () => ({ revision: 0, stopped: true, savedAt: null });

export function createMemoryCompanionControlMethods() {
  const rows = new Map();
  const loadCompanionControl = async raw => {
    const input = scope(raw), row = rows.get(scopeKey(input));
    return row ? structuredClone(row) : initialHead();
  };
  const saveCompanionControl = async raw => {
    if (!exact(raw, ['world', 'owner', 'character', 'expectedRevision', 'stopped']) || typeof raw.stopped !== 'boolean') {
      throw new TypeError('invalid companion control save');
    }
    const input = scope({ world: raw.world, owner: raw.owner, character: raw.character });
    const expected = expectedRevision(raw.expectedRevision), key = scopeKey(input);
    const current = rows.get(key) ?? initialHead();
    if (current.revision === expected + 1 && current.stopped === raw.stopped) {
      return { ok: true, replay: true, head: structuredClone(current) };
    }
    if (current.revision !== expected) return { ok: false, why: 'conflict', head: structuredClone(current) };
    const next = { revision: expected + 1, stopped: raw.stopped, savedAt: new Date().toISOString() };
    rows.set(key, next);
    return { ok: true, replay: false, head: structuredClone(next) };
  };
  return { async checkCompanionControl() { return { version: 1 }; }, loadCompanionControl, saveCompanionControl };
}

export function createSupabaseCompanionControlMethods(client) {
  if (!client || typeof client.rpc !== 'function') throw new CompanionControlStoreError('configuration');
  async function rpc(name, args) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) throw new Error('rpc');
      return result.data;
    } catch { throw new CompanionControlStoreError('unavailable'); }
  }
  return {
    async checkCompanionControl() {
      const raw = await rpc('mn_companion_control_ready', {});
      if (!exact(raw, ['version']) || raw.version !== 1) throw new CompanionControlStoreError('response');
      return { version: 1 };
    },
    async loadCompanionControl(raw) {
      const input = scope(raw);
      return head(await rpc('mn_load_companion_control', {
        p_world: input.world, p_owner: input.owner, p_character: input.character,
      }));
    },
    async saveCompanionControl(raw) {
      if (!exact(raw, ['world', 'owner', 'character', 'expectedRevision', 'stopped']) || typeof raw.stopped !== 'boolean') {
        throw new TypeError('invalid companion control save');
      }
      const input = scope({ world: raw.world, owner: raw.owner, character: raw.character });
      const revision = expectedRevision(raw.expectedRevision);
      const result = await rpc('mn_save_companion_control', {
        p_world: input.world, p_owner: input.owner, p_character: input.character,
        p_expected_revision: revision, p_stopped: raw.stopped,
      });
      if (exact(result, ['ok', 'why', 'head']) && result.ok === false && result.why === 'conflict') {
        return { ok: false, why: 'conflict', head: head(result.head) };
      }
      if (exact(result, ['ok', 'replay', 'head']) && result.ok === true && typeof result.replay === 'boolean') {
        return { ok: true, replay: result.replay, head: head(result.head) };
      }
      throw new CompanionControlStoreError('response');
    },
  };
}
