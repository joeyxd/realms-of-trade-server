import { createTemplateLibrary, MAX_TEMPLATE_BYTES, parseTemplateLibrary, validateTemplate, validateTemplateLibrary } from './templates.js';

export const MAX_TEMPLATE_REVISION = 2147483647;
const clone = (value) => structuredClone(value);
const fail = (code, details = {}) => { throw Object.assign(new Error(`GM template store: ${code}`), { name: 'TemplateStoreError', code: `template_${code}`, ...details }); };

export class TemplateConflictError extends Error {
  constructor(expectedRevision, currentRevision) {
    super('GM template store: revision_conflict');
    this.name = 'TemplateConflictError'; this.code = 'template_revision_conflict';
    this.expectedRevision = expectedRevision; this.currentRevision = currentRevision;
  }
}

export function createIndexedDbTemplateSource({ indexedDB = globalThis.indexedDB, databaseName = 'marea-gm-templates-v1' } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') fail('indexeddb_unavailable');
  let databasePromise;
  const database = () => {
    if (!databasePromise) {
      let cachedPromise;
      const opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        let settled = false;
        const rejectOnce = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        request.onupgradeneeded = () => {
          if (settled) { request.result?.close?.(); return; }
          const db = request.result;
          if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates');
        };
        request.onsuccess = () => {
          const db = request.result;
          if (settled) { db?.close?.(); return; }
          settled = true;
          db.onversionchange = () => {
            db.close();
            if (databasePromise === cachedPromise) databasePromise = null;
          };
          resolve(db);
        };
        request.onerror = () => rejectOnce(Object.assign(new Error('GM template IndexedDB open failed'), {
          code: 'template_indexeddb_open', cause: request.error || undefined,
        }));
        request.onblocked = () => rejectOnce(Object.assign(new Error('template_indexeddb_blocked'), { code: 'template_indexeddb_blocked' }));
      });
      cachedPromise = opening.catch((error) => {
        if (databasePromise === cachedPromise) databasePromise = null;
        throw error;
      });
      databasePromise = cachedPromise;
    }
    return databasePromise;
  };
  return Object.freeze({
    async read(key) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('templates', 'readonly'), request = transaction.objectStore('templates').get(key);
        request.onsuccess = () => resolve(request.result === undefined ? null : clone(request.result));
        request.onerror = () => reject(request.error || Object.assign(new Error('template_indexeddb_read'), { code: 'template_indexeddb_read' }));
        transaction.onabort = () => reject(transaction.error || Object.assign(new Error('template_indexeddb_read'), { code: 'template_indexeddb_read' }));
      });
    },
    async compareAndSwap(key, expectedRevision, nextRecord) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('templates', 'readwrite'), store = transaction.objectStore('templates'), request = store.get(key);
        let conflict = false;
        request.onsuccess = () => {
          if ((request.result?.revision ?? 0) !== expectedRevision) { conflict = true; transaction.abort(); return; }
          store.put(clone(nextRecord), key);
        };
        request.onerror = () => { try { transaction.abort(); } catch { /* already complete */ } };
        transaction.oncomplete = () => resolve(true);
        transaction.onabort = () => conflict ? resolve(false) : reject(transaction.error || request.error || Object.assign(new Error('template_indexeddb_write'), { code: 'template_indexeddb_write' }));
        transaction.onerror = () => { if (!conflict) reject(transaction.error || Object.assign(new Error('template_indexeddb_write'), { code: 'template_indexeddb_write' })); };
      });
    },
  });
}

function checkedRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 ||
      !Number.isSafeInteger(raw.revision) || raw.revision < 1 || raw.revision > MAX_TEMPLATE_REVISION || !Object.hasOwn(raw, 'library')) fail('stored_record');
  let library;
  try { library = validateTemplateLibrary(raw.library); } catch { fail('stored_library'); }
  return { revision: raw.revision, library };
}

export class TemplateStore {
  constructor({ worldId, source = createIndexedDbTemplateSource() } = {}) {
    if (typeof worldId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(worldId)) fail('world_id');
    if (!source || typeof source.read !== 'function' || typeof source.compareAndSwap !== 'function') fail('source');
    this.key = `library:${worldId}`;
    this.source = source;
  }

  async load() {
    const raw = await this.source.read(this.key);
    if (raw === null) return { revision: 0, library: createTemplateLibrary() };
    return clone(checkedRecord(raw));
  }

  async save(library, { expectedRevision } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > MAX_TEMPLATE_REVISION) fail('expected_revision');
    if (expectedRevision === MAX_TEMPLATE_REVISION) fail('revision_exhausted');
    let checked;
    try { checked = validateTemplateLibrary(library); } catch { fail('library'); }
    if (new TextEncoder().encode(JSON.stringify(checked)).byteLength > MAX_TEMPLATE_BYTES) fail('size');
    // Refuse malformed records before attempting a CAS so a corrupt library is never replaced.
    const raw = await this.source.read(this.key);
    const currentRevision = raw === null ? 0 : checkedRecord(raw).revision;
    if (currentRevision !== expectedRevision) throw new TemplateConflictError(expectedRevision, currentRevision);
    const next = { revision: expectedRevision + 1, library: checked };
    const saved = await this.source.compareAndSwap(this.key, expectedRevision, next);
    if (!saved) {
      const current = await this.load();
      throw new TemplateConflictError(expectedRevision, current.revision);
    }
    return clone(next);
  }

  async export() {
    const { library } = await this.load();
    const serialized = JSON.stringify(library);
    if (new TextEncoder().encode(serialized).byteLength > MAX_TEMPLATE_BYTES) fail('size');
    return serialized;
  }

  async import(serialized, { expectedRevision, makeId } = {}) {
    const incoming = parseTemplateLibrary(serialized), current = await this.load();
    if (typeof makeId !== 'function') fail('id_factory');
    const imported = incoming.templates.map((template) => validateTemplate({ ...template, id: makeId() }));
    return this.save(createTemplateLibrary([...current.library.templates, ...imported]), { expectedRevision });
  }
}

export function createTemplateStore(options) { return new TemplateStore(options); }
