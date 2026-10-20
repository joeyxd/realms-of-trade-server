// Owner-scoped player-character roster and isolated guest saves.
import { GAME } from '../data/meta.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOK_MAX = 4, MAX_LOCAL_SLOTS = 3;
const WEAPONS = new Set([0, 1]);
const clone = value => structuredClone(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 16;
const validSkin = value => Number.isInteger(value) && value >= 0 && value <= LOOK_MAX;
const validWeapon = value => WEAPONS.has(value);
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));

export class PlayerCharactersError extends Error {
  // l10nKey names the catalog entry the UI shows; message and code stay for logs and tests.
  constructor(code, message = code, l10nKey = 'roster.err.generic', l10nParams = undefined) {
    super(message); this.name = 'PlayerCharactersError'; this.code = code; this.l10nKey = l10nKey;
    if (l10nParams) this.l10nParams = l10nParams;
  }
}

const defaultStorage = () => {
  try { return globalThis.localStorage; } catch { return null; }
};
const randomId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new PlayerCharactersError('crypto', undefined, 'roster.err.generic');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

function checkedCharacter(raw) {
  const keys = ['id', 'slot', 'name', 'skin', 'weapon', 'lastPlayed'];
  if (!exactKeys(raw, keys) || !UUID.test(raw.id) || !Number.isInteger(raw.slot) || raw.slot < 0 || raw.slot > 2 ||
      !validName(raw.name) || !validSkin(raw.skin) || !validWeapon(raw.weapon) || typeof raw.lastPlayed !== 'boolean') {
    throw new PlayerCharactersError('response', 'La lista de personajes no tiene un formato válido.', 'roster.err.response');
  }
  return { id: raw.id.toLowerCase(), slot: raw.slot, name: raw.name.trim(), skin: raw.skin, weapon: raw.weapon, lastPlayed: raw.lastPlayed };
}

function checkedRoster(raw) {
  if (!exactKeys(raw, ['ok', 'characters', 'legacy', 'limit']) || raw.ok !== true || !Array.isArray(raw.characters) ||
      typeof raw.legacy !== 'boolean' || !Number.isInteger(raw.limit) || raw.limit !== 3 || raw.characters.length > raw.limit) {
    throw new PlayerCharactersError('response', 'No se pudo validar la lista de personajes.', 'roster.err.response');
  }
  const characters = raw.characters.map(checkedCharacter), ids = new Set(), slots = new Set();
  for (const character of characters) {
    if (ids.has(character.id) || slots.has(character.slot)) throw new PlayerCharactersError('response', 'La lista contiene personajes repetidos.', 'roster.err.response');
    ids.add(character.id); slots.add(character.slot);
  }
  return { characters, legacy: raw.legacy, limit: raw.limit };
}

function checkedCreated(raw) {
  if (!exactKeys(raw, ['ok', 'character']) || raw.ok !== true) throw new PlayerCharactersError('response', 'El servidor no confirmó el personaje.', 'roster.err.notConfirmed');
  return checkedCharacter(raw.character);
}

export class PlayerCharacters {
  constructor({ baseUrl = '', getIdentity = () => null, storage, savePrefix = `${GAME.saveKey}.save.`,
    fetchImpl = globalThis.fetch?.bind(globalThis), makeRequestId = randomId, timeoutMs = 9000 } = {}) {
    if (typeof getIdentity !== 'function' || typeof makeRequestId !== 'function' || typeof savePrefix !== 'string') {
      throw new TypeError('PlayerCharacters requiere getIdentity y savePrefix válidos.');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('PlayerCharacters requiere fetch.');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.getIdentity = getIdentity; this.storage = storage ?? defaultStorage(); this.savePrefix = savePrefix;
    this.fetchImpl = fetchImpl; this.makeRequestId = makeRequestId; this.timeoutMs = timeoutMs;
    this.mode = null; this.scope = null; this.accountId = null; this.guestKey = null;
    this.characters = []; this.selectedId = null; this.legacy = false; this.legacySave = '';
    this.limit = MAX_LOCAL_SLOTS; this.current = { name: 'Grumete', skin: 0, weapon: 'sable' };
  }

  _storage() { if (!this.storage) throw new PlayerCharactersError('storage', 'El almacenamiento local no está disponible.', 'roster.err.storageUnavailable'); return this.storage; }
  _get(key) { try { return this._storage().getItem(key); } catch (error) { throw new PlayerCharactersError('storage', 'No se pudo leer el personaje guardado.', 'roster.err.storageRead'); } }
  _set(key, value) { try { this._storage().setItem(key, value); } catch { throw new PlayerCharactersError('storage', 'No se pudo guardar el personaje.', 'roster.err.storageWrite'); } }
  _remove(key) { try { this._storage().removeItem(key); } catch { throw new PlayerCharactersError('storage', 'No se pudo cerrar la sesión del personaje.', 'roster.err.storageClose'); } }

  _localManifestKey(guestKey) { return `${GAME.saveKey}.characters.guest.${encodeURIComponent(guestKey)}`; }
  _selectedKey(scope) { return `${GAME.saveKey}.characters.selected.${encodeURIComponent(scope)}`; }
  _pendingKey(scope) { return `${GAME.saveKey}.characters.pending.${encodeURIComponent(scope)}`; }
  _guestSaveKey(id, guestKey = this.guestKey) { return `${this.savePrefix}${encodeURIComponent(guestKey)}.character.${id}`; }
  _apiUrl() {
    if (!this.baseUrl) throw new PlayerCharactersError('configuration', 'No se configuró el servidor de personajes.', 'roster.err.noServer');
    return `${this.baseUrl}/api/characters`;
  }

  _identity(raw) {
    if (raw == null) return null;
    if (!isRecord(raw) || typeof raw.accountId !== 'string' || !UUID.test(raw.accountId) || typeof raw.token !== 'string' || !raw.token) {
      throw new PlayerCharactersError('identity', 'La sesión de cuenta no es válida.', 'roster.err.session');
    }
    return { accountId: raw.accountId.toLowerCase(), token: raw.token };
  }

  _resetMemory() {
    this.mode = null; this.scope = null; this.accountId = null; this.guestKey = null;
    this.characters = []; this.selectedId = null; this.legacy = false; this.legacySave = '';
  }

  clearScope() { this._resetMemory(); }

  async _request(method, identity, body = undefined) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this._apiUrl(), {
        method, headers: { accept: 'application/json', authorization: `Bearer ${identity.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      let data;
      try { data = await response.json(); } catch { throw new PlayerCharactersError('response', 'El servidor devolvió una respuesta ilegible.', 'roster.err.response'); }
      return { response, data };
    } catch (error) {
      if (error instanceof PlayerCharactersError) throw error;
      throw new PlayerCharactersError(controller.signal.aborted ? 'timeout' : 'network',
        controller.signal.aborted ? 'El servidor tardó demasiado. Inténtalo de nuevo.' : 'No se pudo conectar con el servidor.',
        controller.signal.aborted ? 'roster.err.timeout' : 'roster.err.network');
    } finally { clearTimeout(timer); }
  }

  async _assertIdentity(accountId) {
    let raw;
    try { raw = await this.getIdentity(); } catch { raw = null; }
    const current = this._identity(raw);
    if (!current || current.accountId !== accountId) {
      this._resetMemory();
      throw new PlayerCharactersError('scope_changed', 'La cuenta cambió. Vuelve a cargar sus personajes.', 'roster.err.scopeChanged');
    }
    return current;
  }

  _choose(characters, key) {
    let cached = null;
    if (key) { try { cached = this._get(key); } catch { /* Durable account selection remains on the server. */ } }
    const selected = characters.find(c => c.lastPlayed) || characters.find(c => c.id === cached) || characters[0] || null;
    this.selectedId = selected?.id ?? null;
    if (key && selected) { try { this._set(key, selected.id); } catch { /* The current session still owns this selection. */ } }
    return selected ? clone(selected) : null;
  }

  async load({ guestKey = 'solo', legacySave = '', current = {} } = {}) {
    let identity;
    try { identity = this._identity(await this.getIdentity()); }
    catch (error) { this._resetMemory(); throw error; }
    this._resetMemory();
    this.current = {
      name: validName(current.name) ? current.name.trim() : 'Grumete',
      skin: validSkin(current.skin) ? current.skin : 0,
      weapon: validWeapon(current.weapon) ? current.weapon : 0,
    };
    this.legacySave = typeof legacySave === 'string' ? legacySave : '';
    if (identity) {
      this.mode = 'account'; this.accountId = identity.accountId;
      let base;
      try { base = new URL(this._apiUrl(), globalThis.location?.href || 'http://localhost/'); }
      catch { throw new PlayerCharactersError('configuration', 'La dirección del servidor no es válida.', 'roster.err.noServer'); }
      this.scope = `account:${base.origin}${base.pathname}:${identity.accountId}`;
      const pending = this._readPending();
      if (pending) {
        // A lost HTTP response must resolve the original request before another slot is offered.
        const retry = await this._request('POST', identity, { requestId: pending.requestId, ...pending.body });
        await this._assertIdentity(identity.accountId);
        if (retry.response.ok) { checkedCreated(retry.data); this._remove(this._pendingKey(this.scope)); }
        else if (retry.response.status >= 400 && retry.response.status < 500) this._remove(this._pendingKey(this.scope));
        else throw new PlayerCharactersError(retry.data?.code || 'unavailable', 'No se pudo resolver la creación pendiente. Vuelve a intentarlo.', 'roster.err.pendingUnresolved');
      }
      const { response, data } = await this._request('GET', identity);
      await this._assertIdentity(identity.accountId);
      if (!response.ok) throw new PlayerCharactersError(data?.code || 'unavailable', 'No se pudo cargar la lista guardada.', 'roster.err.loadFailed');
      const roster = checkedRoster(data);
      this.characters = roster.characters; this.legacy = roster.legacy; this.limit = roster.limit;
      const selected = this._choose(this.characters, this._selectedKey(this.scope));
      return this.snapshot(selected);
    }
    if (typeof guestKey !== 'string' || !guestKey.trim() || guestKey.length > 180) throw new PlayerCharactersError('guest_key', undefined, 'roster.err.generic');
    this.mode = 'guest'; this.guestKey = guestKey.trim(); this.scope = `guest:${this.guestKey}`;
    const key = this._localManifestKey(this.guestKey), encoded = this._get(key);
    const manifest = encoded == null ? { v: 1, characters: [], selectedId: null, legacyRegistered: false }
      : this._parseManifest(encoded);
    if (encoded == null) this._saveManifest(manifest);
    this.characters = manifest.characters;
    this.legacy = !manifest.legacyRegistered && !!this.legacySave;
    this.limit = MAX_LOCAL_SLOTS;
    const cached = manifest.selectedId;
    let selected = this.characters.find(c => c.id === cached) || this.characters.find(c => c.lastPlayed) || this.characters[0] || null;
    this.selectedId = selected?.id ?? null;
    if (selected) this._saveManifest({ ...manifest, selectedId: selected.id });
    return this.snapshot(selected ? clone(selected) : null);
  }

  _parseManifest(encoded) {
    let raw;
    try { raw = JSON.parse(encoded); } catch { throw new PlayerCharactersError('storage', 'La lista local está dañada; el guardado original se conserva.', 'roster.err.localDamaged'); }
    if (!exactKeys(raw, ['v', 'characters', 'selectedId', 'legacyRegistered']) || raw.v !== 1 ||
        !Array.isArray(raw.characters) || raw.characters.length > MAX_LOCAL_SLOTS ||
        !(raw.selectedId === null || typeof raw.selectedId === 'string') || typeof raw.legacyRegistered !== 'boolean') {
      throw new PlayerCharactersError('storage', 'La lista local no tiene un formato válido; el guardado original se conserva.', 'roster.err.localDamaged');
    }
    const characters = raw.characters.map(entry => {
      if (!exactKeys(entry, ['id', 'slot', 'name', 'skin', 'weapon', 'lastPlayed', 'source']) || !UUID.test(entry.id) ||
          !Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot >= MAX_LOCAL_SLOTS || !validName(entry.name) ||
          !validSkin(entry.skin) || !validWeapon(entry.weapon) || typeof entry.lastPlayed !== 'boolean' ||
          !['new', 'legacy', 'import'].includes(entry.source)) {
        throw new PlayerCharactersError('storage', 'Un personaje local no tiene un formato válido; el guardado original se conserva.', 'roster.err.localDamaged');
      }
      return { ...entry, id: entry.id.toLowerCase(), name: entry.name.trim() };
    });
    if (new Set(characters.map(c => c.id)).size !== characters.length || new Set(characters.map(c => c.slot)).size !== characters.length) {
      throw new PlayerCharactersError('storage', 'La lista local contiene personajes repetidos.', 'roster.err.localDamaged');
    }
    return { v: 1, characters, selectedId: raw.selectedId, legacyRegistered: raw.legacyRegistered };
  }

  _saveManifest(manifest) { this._set(this._localManifestKey(this.guestKey), JSON.stringify(manifest)); }

  snapshot(selected = undefined) {
    const choice = selected === undefined ? this.selected() : selected;
    return { mode: this.mode, characters: clone(this.characters), selected: choice ? clone(choice) : null,
      legacy: this.legacy, legacySave: this.legacySave,
      limit: this.limit, guestKey: this.guestKey, current: { ...this.current } };
  }

  selected() { return clone(this.characters.find(character => character.id === this.selectedId) || null); }

  select(id) {
    const character = this.characters.find(entry => entry.id === id);
    if (!character) return null;
    this.selectedId = character.id;
    if (this.mode === 'account') this._set(this._selectedKey(this.scope), character.id);
    else if (this.mode === 'guest') {
      const manifest = this._parseManifest(this._get(this._localManifestKey(this.guestKey)));
      const characters = manifest.characters.map(entry => ({ ...entry, lastPlayed: entry.id === character.id }));
      this.characters = characters;
      this._saveManifest({ ...manifest, characters, selectedId: character.id });
    }
    return clone(character);
  }

  selectedSave() {
    if (this.mode !== 'guest') return '';
    const character = this.selected();
    return character ? (this._get(this._guestSaveKey(character.id)) || '') : '';
  }

  localSave(guestKey, legacy = '') {
    const raw = this._get(this._localManifestKey(guestKey));
    if (!raw) return legacy;
    const manifest = this._parseManifest(raw), character = manifest.characters.find(c => c.id === manifest.selectedId);
    if (!character) return legacy;
    // Read the guest export without replacing the active account scope.
    return this._get(this._guestSaveKey(character.id, guestKey)) || '';
  }

  save(blob) {
    if (typeof blob !== 'string') throw new PlayerCharactersError('save', undefined, 'roster.err.generic');
    if (this.mode !== 'guest') return false;
    const character = this.selected();
    if (!character) throw new PlayerCharactersError('no_character', 'Elige o crea un personaje antes de guardar.', 'roster.err.noCharacter');
    this._set(this._guestSaveKey(character.id), blob);
    return true;
  }

  backupSelectedSave() {
    if (this.mode !== 'guest') return false;
    const character = this.selected(), blob = character ? this._get(this._guestSaveKey(character.id)) : null;
    if (!blob) return false;
    this._set(`${this._guestSaveKey(character.id)}.old`, blob);
    return true;
  }

  async create({ name, skin, mode = 'new', save = undefined } = {}) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!validName(cleanName) || !validSkin(skin) || !['new', 'legacy', 'import'].includes(mode)) {
      throw new PlayerCharactersError('invalid_request', 'Escribe un nombre y elige un aspecto válido.', 'roster.err.invalidRequest');
    }
    if (this.mode === 'account') return this._createAccount({ name: cleanName, skin, mode, save });
    if (this.mode !== 'guest') throw new PlayerCharactersError('not_loaded', 'Primero carga la lista de personajes.', 'roster.err.notLoaded');
    return this._createGuest({ name: cleanName, skin, mode, save });
  }

  async _createAccount(input) {
    const { mode } = input;
    const body = { name: input.name, skin: input.skin, mode,
      ...(mode === 'import' ? { save: typeof input.save === 'string' ? input.save : this.legacySave } : {}) };
    if (mode === 'import' && (!body.save || body.save !== this.legacySave)) throw new PlayerCharactersError('import_unavailable', undefined, 'roster.err.generic');
    let pending = this._readPending();
    if (pending) {
      if (JSON.stringify(pending.body) !== JSON.stringify(body)) throw new PlayerCharactersError('pending', 'Hay una creación pendiente. Repite la misma opción para resolverla.', 'roster.err.pending');
    } else {
      if (this.characters.length >= this.limit) throw new PlayerCharactersError('limit', 'Ya ocupaste las tres plazas.', 'roster.err.limit');
      if (mode === 'new' && this.legacy) throw new PlayerCharactersError('legacy_required', 'Confirma primero el personaje que ya estaba guardado.', 'roster.err.legacyRequired');
      if (mode === 'legacy' && (!this.legacy || this.characters.length !== 0)) throw new PlayerCharactersError('legacy_unavailable', undefined, 'roster.err.generic');
      if (mode === 'import' && (this.characters.length !== 0 || !this.legacySave)) throw new PlayerCharactersError('import_unavailable', undefined, 'roster.err.generic');
      const requestId = this.makeRequestId();
      if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new PlayerCharactersError('request_id', undefined, 'roster.err.generic');
      pending = { requestId: requestId.toLowerCase(), body };
      this._set(this._pendingKey(this.scope), JSON.stringify(pending));
    }
    const identity = this._identity(await this.getIdentity());
    if (!identity || identity.accountId !== this.accountId) { this._resetMemory(); throw new PlayerCharactersError('scope_changed', undefined, 'roster.err.generic'); }
    const payload = { requestId: pending.requestId, ...pending.body };
    let created = null, lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      let response, data;
      try { ({ response, data } = await this._request('POST', identity, payload)); }
      catch (error) { lastError = error; if (attempt === 0 && ['network', 'timeout'].includes(error.code)) continue; throw error; }
      if (!response.ok) {
        if (attempt === 0 && response.status >= 500) { lastError = new PlayerCharactersError('unavailable', undefined, 'roster.err.generic'); continue; }
        if (response.status >= 400 && response.status < 500) this._remove(this._pendingKey(this.scope));
        throw new PlayerCharactersError(data?.code || 'unavailable', 'No se pudo crear el personaje.', 'roster.err.createFailed');
      }
      created = checkedCreated(data); break;
    }
    if (!created) throw lastError || new PlayerCharactersError('unavailable', undefined, 'roster.err.generic');
    await this._assertIdentity(this.accountId);
    this._remove(this._pendingKey(this.scope));
    this.characters = [...this.characters.filter(character => character.id !== created.id), created].sort((a, b) => a.slot - b.slot);
    this.legacy = false; this.selectedId = created.id;
    this._set(this._selectedKey(this.scope), created.id);
    return clone(created);
  }

  _readPending() {
    const encoded = this._get(this._pendingKey(this.scope));
    if (encoded == null) return null;
    try {
      const raw = JSON.parse(encoded);
      if (!exactKeys(raw, ['requestId', 'body']) || !UUID.test(raw.requestId) || !isRecord(raw.body)) return null;
      return raw;
    } catch { return null; }
  }

  _createGuest({ name, skin, mode, save }) {
    const key = this._localManifestKey(this.guestKey);
    const encoded = this._get(key);
    const manifest = encoded == null ? { v: 1, characters: [], selectedId: null, legacyRegistered: false }
      : this._parseManifest(encoded);
    if (manifest.characters.length >= MAX_LOCAL_SLOTS) throw new PlayerCharactersError('limit', 'Ya ocupaste las tres plazas.', 'roster.err.limit');
    if (mode === 'new' && this.legacy && !manifest.legacyRegistered) throw new PlayerCharactersError('legacy_required', 'Conserva primero tu partida guardada.', 'roster.err.legacyRequired');
    if (mode === 'legacy' && (!this.legacy || manifest.legacyRegistered)) throw new PlayerCharactersError('legacy_unavailable', undefined, 'roster.err.generic');
    if (mode === 'import') throw new PlayerCharactersError('import_unavailable', 'La importación de cuenta solo está disponible al iniciar sesión.', 'roster.err.importLocalOnly');
    const id = this.makeRequestId();
    if (typeof id !== 'string' || !UUID.test(id)) throw new PlayerCharactersError('request_id', undefined, 'roster.err.generic');
    const usedSlots = new Set(manifest.characters.map(character => character.slot));
    const slot = [0, 1, 2].find(candidate => !usedSlots.has(candidate));
    if (slot === undefined) throw new PlayerCharactersError('limit', undefined, 'roster.err.generic');
    const character = { id: id.toLowerCase(), slot, name, skin, weapon: skin === 2 ? 1 : 0, lastPlayed: true,
      source: mode === 'legacy' ? 'legacy' : 'new' };
    let initialSave = '';
    if (mode === 'legacy') {
      if (!this.legacySave) throw new PlayerCharactersError('legacy_unavailable', undefined, 'roster.err.generic');
      initialSave = this.legacySave;
    } else if (typeof save === 'string' && save) initialSave = save;
    const perCharacterSave = this._guestSaveKey(character.id);
    if (initialSave) this._set(perCharacterSave, initialSave);
    const characters = [...manifest.characters.map(entry => ({ ...entry, lastPlayed: false })), character];
    this._saveManifest({ v: 1, characters, selectedId: character.id,
      legacyRegistered: manifest.legacyRegistered || mode === 'legacy' });
    this.characters = characters; this.selectedId = character.id; this.legacy = false;
    return clone(character);
  }
}
