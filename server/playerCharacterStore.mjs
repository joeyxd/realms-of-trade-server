import { randomUUID } from 'node:crypto';
import { cleanName } from '../src/net/protocol.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const LEGACY_KEY = /^[0-9a-f]{64}$/;
const MODES = new Set(['new', 'legacy', 'import']);
const MAX_SLOTS = 3;

export class PlayerCharacterStoreError extends Error {
  constructor(code) { super(`player character store: ${code}`); this.name = 'PlayerCharacterStoreError'; this.code = code; }
}

const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

function ownerId(value) {
  if (typeof value !== 'string' || !UUID.test(value) || value === ZERO_UUID) throw new PlayerCharacterStoreError('identity');
  return value.toLowerCase();
}

function characterId(value) {
  if (typeof value !== 'string' || !UUID.test(value) || value === ZERO_UUID) throw new PlayerCharacterStoreError('identity');
  return value.toLowerCase();
}

function requestInput(raw) {
  if (!exact(raw, ['requestId', 'name', 'skin', 'weapon', 'mode']) ||
      typeof raw.requestId !== 'string' || !UUID.test(raw.requestId) || raw.requestId === ZERO_UUID ||
      !MODES.has(raw.mode) || !Number.isInteger(raw.skin) || raw.skin < 0 || raw.skin > 4 ||
      raw.weapon !== (raw.skin === 2 ? 1 : 0) || typeof raw.name !== 'string') {
    throw new PlayerCharacterStoreError('operation');
  }
  const name = cleanName(raw.name, '');
  if (!name || name.length < 1 || name.length > 16) throw new PlayerCharacterStoreError('name');
  return { requestId: raw.requestId.toLowerCase(), name, skin: raw.skin, weapon: raw.weapon, mode: raw.mode };
}

function cleanProfile(raw) {
  let copy;
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('profile');
    copy = JSON.parse(JSON.stringify(raw));
  } catch { throw new PlayerCharacterStoreError('profile'); }
  const safe = sanitizeProfile(copy);
  if (!safe || safe.v !== 1) throw new PlayerCharacterStoreError('profile');
  return safe;
}

function storedProfile(row) {
  if (row === null || row === undefined) return null;
  if (!row || typeof row !== 'object' || !row.data || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new PlayerCharacterStoreError('profile');
  }
  try {
    const safe = sanitizeProfile(structuredClone(row.data));
    if (!safe || safe.v !== 1) throw new Error('invalid');
  } catch { throw new PlayerCharacterStoreError('profile'); }
  return row;
}

function bindPirateId(profile, id) {
  const result = structuredClone(profile);
  result.pirateId = `account:${id}`;
  return result;
}

function checkedCharacter(raw) {
  const keys = ['id', 'slot', 'name', 'skin', 'weapon', 'lastPlayed'];
  if (!exact(raw, keys)) throw new PlayerCharacterStoreError('response');
  let id;
  try { id = characterId(raw.id); } catch { throw new PlayerCharacterStoreError('response'); }
  if (!Number.isInteger(raw.slot) || raw.slot < 0 || raw.slot >= MAX_SLOTS ||
      typeof raw.name !== 'string' || raw.name !== cleanName(raw.name, '') || raw.name.length < 1 || raw.name.length > 16 ||
      !Number.isInteger(raw.skin) || raw.skin < 0 || raw.skin > 4 || raw.weapon !== (raw.skin === 2 ? 1 : 0) ||
      typeof raw.lastPlayed !== 'boolean') throw new PlayerCharacterStoreError('response');
  return { id, slot: raw.slot, name: raw.name, skin: raw.skin, weapon: raw.weapon, lastPlayed: raw.lastPlayed };
}

function checkedList(raw) {
  if (!exact(raw, ['characters', 'legacy']) || !Array.isArray(raw.characters) || typeof raw.legacy !== 'boolean' ||
      raw.characters.length > MAX_SLOTS) throw new PlayerCharacterStoreError('response');
  const characters = raw.characters.map(checkedCharacter);
  const ids = new Set(), slots = new Set(); let selected = 0;
  for (const character of characters) {
    if (ids.has(character.id) || slots.has(character.slot)) throw new PlayerCharacterStoreError('response');
    ids.add(character.id); slots.add(character.slot); if (character.lastPlayed) selected++;
  }
  if (selected > 1) throw new PlayerCharacterStoreError('response');
  return { characters, legacy: raw.legacy };
}

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
const requestKey = (owner, id) => `${owner}:${id}`;

export function createMemoryPlayerCharacterMethods({ loadProfile, initializeProfile, uuid = randomUUID } = {}) {
  if (typeof loadProfile !== 'function' || typeof initializeProfile !== 'function' || typeof uuid !== 'function') {
    throw new PlayerCharacterStoreError('configuration');
  }
  const rosters = new Map(), selected = new Map(), requests = new Map();
  let tail = Promise.resolve();

  async function locked(work) {
    let release;
    const previous = tail;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  function rowView(owner, row) {
    return checkedCharacter({ ...row, lastPlayed: selected.get(owner) === row.id });
  }

  async function listPlayerCharacters(rawOwner) {
    const owner = ownerId(rawOwner), roster = rosters.get(owner) ?? [];
    let hasOldProfile = false;
    try { hasOldProfile = !!storedProfile(await loadProfile(owner)); }
    catch (error) { if (error instanceof PlayerCharacterStoreError && error.code === 'profile') throw error; throw new PlayerCharacterStoreError('unavailable'); }
    return checkedList({ characters: roster.map(row => rowView(owner, row)).sort((a, b) => a.slot - b.slot),
      legacy: hasOldProfile && !roster.some(row => row.id === owner) });
  }

  async function createPlayerCharacter(rawOwner, rawRequest, rawProfile, rawLegacyKey = null) {
    const owner = ownerId(rawOwner), input = requestInput(rawRequest), key = requestKey(owner, input.requestId);
    const profile = input.mode === 'legacy' ? null : cleanProfile(rawProfile);
    if (input.mode === 'import' && (typeof rawLegacyKey !== 'string' || !LEGACY_KEY.test(rawLegacyKey))) {
      throw new PlayerCharacterStoreError('legacy_key');
    }
    if (input.mode !== 'import' && rawLegacyKey !== null) throw new PlayerCharacterStoreError('operation');
    return locked(async () => {
      const prior = requests.get(key);
      if (prior) {
        if (!same(prior.input, input) || prior.legacyKey !== rawLegacyKey) throw new PlayerCharacterStoreError('operation');
        const current = (rosters.get(owner) ?? []).find(row => row.id === prior.characterId);
        if (!current) throw new PlayerCharacterStoreError('response');
        return rowView(owner, current);
      }

      const roster = rosters.get(owner) ?? [];
      if (roster.length >= MAX_SLOTS) throw new PlayerCharacterStoreError('limit');
      const oldRow = storedProfile(await loadProfile(owner));
      const registeredLegacy = roster.some(row => row.id === owner);
      if (input.mode === 'new' && oldRow && !registeredLegacy) throw new PlayerCharacterStoreError('legacy_required');
      if (input.mode === 'legacy') {
        if (!oldRow) throw new PlayerCharacterStoreError('legacy_missing');
        if (registeredLegacy) throw new PlayerCharacterStoreError('conflict');
      }
      if (input.mode === 'import' && (oldRow || roster.length)) throw new PlayerCharacterStoreError('conflict');
      let id = input.mode === 'legacy' || input.mode === 'import' ? owner : null;
      if (id && roster.some(row => row.id === id)) throw new PlayerCharacterStoreError('conflict');
      const occupied = new Set(roster.map(row => row.slot));
      const slot = input.mode === 'legacy' || input.mode === 'import' ? 0 : [0, 1, 2].find(value => !occupied.has(value));
      if (slot === undefined || occupied.has(slot)) throw new PlayerCharacterStoreError('limit');
      if (!id) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const candidate = characterId(uuid());
          if (candidate !== owner && !(roster.some(row => row.id === candidate))) { id = candidate; break; }
        }
        if (!id) throw new PlayerCharacterStoreError('response');
      }

      if (input.mode === 'legacy') {
        storedProfile(await loadProfile(owner)); // Registration never rewrites the legacy JSON or revision.
      } else {
        const existing = storedProfile(await loadProfile(id));
        if (existing) throw new PlayerCharacterStoreError('conflict');
        const expectedProfile = bindPirateId(profile, id);
        let initialized;
        try { initialized = await initializeProfile(id, expectedProfile, input.mode === 'import' ? rawLegacyKey : null); }
        catch (error) {
          if (error?.code === 'legacy_used') throw new PlayerCharacterStoreError('legacy_used');
          throw new PlayerCharacterStoreError('unavailable');
        }
        if (!initialized || !initialized.data || !Number.isSafeInteger(initialized.version) || initialized.version < 1) {
          throw new PlayerCharacterStoreError('response');
        }
        storedProfile(initialized);
        if (initialized.version !== 1 || !same(initialized.data, expectedProfile)) throw new PlayerCharacterStoreError('conflict');
      }

      const record = { id, slot, name: input.name, skin: input.skin, weapon: input.weapon };
      rosters.set(owner, [...roster, record]);
      selected.set(owner, id);
      requests.set(key, { input, legacyKey: rawLegacyKey, characterId: id });
      return rowView(owner, record);
    });
  }

  async function selectPlayerCharacter(rawOwner, rawId) {
    const owner = ownerId(rawOwner), id = characterId(rawId);
    return locked(async () => {
      const row = (rosters.get(owner) ?? []).find(character => character.id === id);
      if (!row) throw new PlayerCharacterStoreError('forbidden');
      selected.set(owner, id);
      return rowView(owner, row);
    });
  }

  return {
    async checkPlayerCharacters() { return { version: 1 }; },
    listPlayerCharacters,
    createPlayerCharacter,
    selectPlayerCharacter,
  };
}

function rpcError(error, name) {
  if (error instanceof PlayerCharacterStoreError) throw error;
  const code = error?.code;
  if (name === 'mn_create_player_character') {
    if (code === 'PCS01') throw new PlayerCharacterStoreError('limit');
    if (code === 'PCS02') throw new PlayerCharacterStoreError('operation');
    if (code === 'PCS03') throw new PlayerCharacterStoreError('legacy_required');
    if (code === 'PCS04') throw new PlayerCharacterStoreError('legacy_missing');
    if (code === 'PCS05') throw new PlayerCharacterStoreError('legacy_used');
    if (code === 'PCS06') throw new PlayerCharacterStoreError('conflict');
  }
  if (name === 'mn_select_player_character' && code === 'PCS07') throw new PlayerCharacterStoreError('forbidden');
  throw new PlayerCharacterStoreError('unavailable');
}

export function createSupabasePlayerCharacterMethods(client) {
  if (!client || typeof client.rpc !== 'function') throw new PlayerCharacterStoreError('configuration');
  async function rpc(name, args) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) rpcError(result?.error, name);
      return result.data;
    } catch (error) { rpcError(error, name); }
  }
  return {
    async checkPlayerCharacters() {
      const raw = await rpc('mn_player_characters_ready', {});
      if (!exact(raw, ['version']) || raw.version !== 1) throw new PlayerCharacterStoreError('response');
      return { version: 1 };
    },
    async listPlayerCharacters(rawOwner) {
      const owner = ownerId(rawOwner), raw = await rpc('mn_list_player_characters', { p_owner: owner });
      return checkedList(raw);
    },
    async createPlayerCharacter(rawOwner, rawRequest, rawProfile, rawLegacyKey = null) {
      const owner = ownerId(rawOwner), input = requestInput(rawRequest);
      const profile = input.mode === 'legacy' ? null : cleanProfile(rawProfile);
      if (input.mode === 'import' && (typeof rawLegacyKey !== 'string' || !LEGACY_KEY.test(rawLegacyKey))) {
        throw new PlayerCharacterStoreError('legacy_key');
      }
      if (input.mode !== 'import' && rawLegacyKey !== null) throw new PlayerCharacterStoreError('operation');
      const id = input.mode === 'new' ? characterId(randomUUID()) : owner;
      const raw = await rpc('mn_create_player_character', { p_owner: owner, p_character_id: id,
        p_request: input, p_profile: profile === null ? null : bindPirateId(profile, id), p_legacy_key: rawLegacyKey });
      if (!exact(raw, ['ok', 'replay', 'character']) || raw.ok !== true || typeof raw.replay !== 'boolean') {
        throw new PlayerCharacterStoreError('response');
      }
      return checkedCharacter(raw.character);
    },
    async selectPlayerCharacter(rawOwner, rawId) {
      const owner = ownerId(rawOwner), id = characterId(rawId);
      return checkedCharacter(await rpc('mn_select_player_character', { p_owner: owner, p_character_id: id }));
    },
  };
}
