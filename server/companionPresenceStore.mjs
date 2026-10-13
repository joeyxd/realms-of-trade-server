const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORLD = /^[A-Za-z0-9:_-]{1,100}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const MAX_REVISION = 2147483647;

const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

export class CompanionPresenceStoreError extends Error {
  constructor(code) { super(`companion presence store: ${code}`); this.name = 'CompanionPresenceStoreError'; this.code = code; }
}

function scope(raw) {
  if (!exact(raw, ['world', 'owner', 'character']) || typeof raw.world !== 'string' || !WORLD.test(raw.world) ||
      typeof raw.owner !== 'string' || !UUID.test(raw.owner) || raw.owner === ZERO_UUID ||
      typeof raw.character !== 'string' || !UUID.test(raw.character) || raw.character === ZERO_UUID || raw.owner === raw.character) {
    throw new TypeError('invalid companion presence scope');
  }
  return { world: raw.world, owner: raw.owner, character: raw.character };
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_REVISION) throw new TypeError('invalid companion presence revision');
  return value;
}

function runId(value) {
  if (typeof value !== 'string' || !UUID.test(value) || value === ZERO_UUID) throw new TypeError('invalid companion presence run id');
  return value;
}

function head(raw) {
  if (!exact(raw, ['revision', 'active', 'runId', 'savedAt']) || !Number.isSafeInteger(raw.revision) ||
      raw.revision < 0 || raw.revision > MAX_REVISION) throw new CompanionPresenceStoreError('response');
  if (raw.revision === 0) {
    if (raw.active !== false || raw.runId !== null || raw.savedAt !== null) throw new CompanionPresenceStoreError('response');
    return { revision: 0, active: false, runId: null, savedAt: null };
  }
  if (typeof raw.active !== 'boolean' || typeof raw.runId !== 'string' || !UUID.test(raw.runId) || raw.runId === ZERO_UUID ||
      typeof raw.savedAt !== 'string' || raw.savedAt.length > 64 || !Number.isFinite(Date.parse(raw.savedAt))) {
    throw new CompanionPresenceStoreError('response');
  }
  return { revision: raw.revision, active: raw.active, runId: raw.runId, savedAt: raw.savedAt };
}

const initialHead = () => ({ revision: 0, active: false, runId: null, savedAt: null });
const keyOf = value => JSON.stringify([value.world, value.owner, value.character]);

export function createMemoryCompanionPresenceMethods() {
  const rows = new Map();
  const loadCompanionPresence = async raw => {
    const input = scope(raw);
    return structuredClone(rows.get(keyOf(input)) ?? initialHead());
  };
  const saveCompanionPresence = async raw => {
    if (!exact(raw, ['world', 'owner', 'character', 'expectedRevision', 'active', 'runId']) || typeof raw.active !== 'boolean') {
      throw new TypeError('invalid companion presence save');
    }
    const input = scope({ world: raw.world, owner: raw.owner, character: raw.character });
    const expected = revision(raw.expectedRevision), id = runId(raw.runId), key = keyOf(input);
    const current = rows.get(key) ?? initialHead();
    if (current.revision === expected + 1 && current.active === raw.active && current.runId === id) {
      return { ok: true, replay: true, head: structuredClone(current) };
    }
    if (current.revision !== expected) return { ok: false, why: 'conflict', head: structuredClone(current) };
    const validStart = raw.active && !current.active && current.runId !== id;
    const validClose = !raw.active && current.active && current.runId === id;
    if (!validStart && !validClose) return { ok: false, why: 'conflict', head: structuredClone(current) };
    const next = { revision: expected + 1, active: raw.active, runId: id, savedAt: new Date().toISOString() };
    rows.set(key, next);
    return { ok: true, replay: false, head: structuredClone(next) };
  };
  return { async checkCompanionPresence() { return { version: 1 }; }, loadCompanionPresence, saveCompanionPresence };
}

export function createSupabaseCompanionPresenceMethods(client) {
  if (!client || typeof client.rpc !== 'function') throw new CompanionPresenceStoreError('configuration');
  async function rpc(name, args) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) throw new Error('rpc');
      return result.data;
    } catch { throw new CompanionPresenceStoreError('unavailable'); }
  }
  return {
    async checkCompanionPresence() {
      const raw = await rpc('mn_companion_presence_ready', {});
      if (!exact(raw, ['version']) || raw.version !== 1) throw new CompanionPresenceStoreError('response');
      return { version: 1 };
    },
    async loadCompanionPresence(raw) {
      const input = scope(raw);
      return head(await rpc('mn_load_companion_presence', {
        p_world: input.world, p_owner: input.owner, p_character: input.character,
      }));
    },
    async saveCompanionPresence(raw) {
      if (!exact(raw, ['world', 'owner', 'character', 'expectedRevision', 'active', 'runId']) || typeof raw.active !== 'boolean') {
        throw new TypeError('invalid companion presence save');
      }
      const input = scope({ world: raw.world, owner: raw.owner, character: raw.character });
      const expected = revision(raw.expectedRevision), id = runId(raw.runId);
      const result = await rpc('mn_save_companion_presence', {
        p_world: input.world, p_owner: input.owner, p_character: input.character,
        p_expected_revision: expected, p_active: raw.active, p_run_id: id,
      });
      if (exact(result, ['ok', 'why', 'head']) && result.ok === false && result.why === 'conflict') {
        return { ok: false, why: 'conflict', head: head(result.head) };
      }
      if (exact(result, ['ok', 'replay', 'head']) && result.ok === true && typeof result.replay === 'boolean') {
        const saved = head(result.head);
        if (saved.revision !== expected + 1 || saved.active !== raw.active || saved.runId !== id) {
          throw new CompanionPresenceStoreError('response');
        }
        return { ok: true, replay: result.replay, head: saved };
      }
      throw new CompanionPresenceStoreError('response');
    },
  };
}
