import { validateDocument } from './document.js';

export const DRAFT_EXPORT_FORMAT = 'marea.gm.draft-export';
export const DRAFT_EXPORT_VERSION = 1;
export const MAX_DRAFT_EXPORT_BYTES = 5 * 1024 * 1024;

const clone = (value) => structuredClone(value);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class DraftStoreError extends Error {
  constructor(code, details = {}) {
    super(`GM draft store: ${code}`);
    this.name = 'DraftStoreError';
    this.code = code;
    Object.assign(this, details);
  }
}

export class DraftConflictError extends DraftStoreError {
  constructor(expectedRevision, currentRevision) {
    super('revision_conflict', { expectedRevision, currentRevision });
    this.name = 'DraftConflictError';
  }
}

export function createIndexedDbDraftSource({ indexedDB = globalThis.indexedDB, databaseName = 'marea-gm-drafts-v1' } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') throw new DraftStoreError('indexeddb_unavailable');
  let databasePromise;
  const database = () => {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new DraftStoreError('indexeddb_open'));
        request.onblocked = () => reject(new DraftStoreError('indexeddb_blocked'));
      });
    }
    return databasePromise;
  };
  return Object.freeze({
    async read(key) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readonly');
        const request = transaction.objectStore('drafts').get(key);
        request.onsuccess = () => resolve(request.result === undefined ? null : clone(request.result));
        request.onerror = () => reject(request.error || new DraftStoreError('indexeddb_read'));
        transaction.onabort = () => reject(transaction.error || new DraftStoreError('indexeddb_read'));
      });
    },
    async compareAndSwap(key, expectedRevision, nextRecord) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readwrite');
        const store = transaction.objectStore('drafts');
        const request = store.get(key);
        let conflict = false;
        request.onsuccess = () => {
          const currentRevision = request.result?.revision ?? 0;
          if (currentRevision !== expectedRevision) {
            conflict = true;
            transaction.abort();
            return;
          }
          store.put(clone(nextRecord), key);
        };
        request.onerror = () => { try { transaction.abort(); } catch { /* already complete */ } };
        transaction.oncomplete = () => resolve(true);
        transaction.onabort = () => {
          if (conflict) resolve(false);
          else reject(transaction.error || request.error || new DraftStoreError('indexeddb_write'));
        };
        transaction.onerror = () => {
          if (!conflict) reject(transaction.error || new DraftStoreError('indexeddb_write'));
        };
      });
    },
  });
}

function checkedRecord(raw) {
  if (!isRecord(raw) || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || raw.revision > 2147483647) {
    throw new DraftStoreError('stored_record');
  }
  try { return { revision: raw.revision, document: validateDocument(raw.document) }; }
  catch { throw new DraftStoreError('stored_document'); }
}

function checkedRecoveryStorageRecord(raw) {
  if (!isRecord(raw) || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || raw.revision > 2147483647) {
    throw new DraftStoreError('stored_record');
  }
  if (raw.tombstone === true && Object.keys(raw).length === 2 && raw.document === undefined) {
    return { revision: raw.revision, tombstone: true };
  }
  if (Object.keys(raw).length !== 3 || !Object.hasOwn(raw, 'document') || !Object.hasOwn(raw, 'expectedRevision')) {
    throw new DraftStoreError('stored_record');
  }
  if (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0 || raw.expectedRevision > 2147483647) {
    throw new DraftStoreError('stored_record');
  }
  try {
    return { revision: raw.revision, document: validateDocument(raw.document), expectedRevision: raw.expectedRevision };
  } catch { throw new DraftStoreError('stored_document'); }
}

export class DraftStore {
  constructor({ worldId, source = createIndexedDbDraftSource() }) {
    if (typeof worldId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(worldId)) {
      throw new DraftStoreError('world_id');
    }
    if (!source || typeof source.read !== 'function' || typeof source.compareAndSwap !== 'function') {
      throw new DraftStoreError('source');
    }
    this.key = `draft:${worldId}`;
    this.recoveryKey = `recovery:${worldId}`;
    this.source = source;
  }

  async load() {
    const raw = await this.source.read(this.key);
    if (raw === null) return { revision: 0, document: null };
    const record = checkedRecord(raw);
    return clone(record);
  }

  async save(document, { expectedRevision } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647) {
      throw new DraftStoreError('expected_revision');
    }
    let checkedDocument;
    try { checkedDocument = validateDocument(document); }
    catch { throw new DraftStoreError('document'); }
    const next = { revision: expectedRevision + 1, document: checkedDocument };
    const saved = await this.source.compareAndSwap(this.key, expectedRevision, next);
    if (!saved) {
      const current = await this.load();
      throw new DraftConflictError(expectedRevision, current.revision);
    }
    return clone(next);
  }

  async loadRecovery() {
    const raw = await this.source.read(this.recoveryKey);
    if (raw === null) return null;
    const record = checkedRecoveryStorageRecord(raw);
    if (record.tombstone) return null;
    return clone(record);
  }

  async saveRecovery(document, { expectedRevision } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 2147483647) {
      throw new DraftStoreError('expected_revision');
    }
    let checkedDocument;
    try { checkedDocument = validateDocument(document); }
    catch { throw new DraftStoreError('document'); }

    const raw = await this.source.read(this.recoveryKey);
    const current = raw === null ? null : checkedRecoveryStorageRecord(raw);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision >= 2147483647) throw new DraftStoreError('revision_exhausted');
    const next = { revision: currentRevision + 1, document: checkedDocument, expectedRevision };
    const saved = await this.source.compareAndSwap(this.recoveryKey, currentRevision, next);
    if (!saved) {
      const latest = await this.source.read(this.recoveryKey);
      const latestRevision = latest === null ? 0 : checkedRecoveryStorageRecord(latest).revision;
      throw new DraftConflictError(currentRevision, latestRevision);
    }
    return clone(next);
  }

  async clearRecovery({ expectedRevision } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647) {
      throw new DraftStoreError('expected_revision');
    }
    const raw = await this.source.read(this.recoveryKey);
    const current = raw === null ? null : checkedRecoveryStorageRecord(raw);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectedRevision) throw new DraftConflictError(expectedRevision, currentRevision);
    const tombstone = { revision: expectedRevision + 1, tombstone: true };
    const saved = await this.source.compareAndSwap(this.recoveryKey, expectedRevision, tombstone);
    if (!saved) {
      const latest = await this.source.read(this.recoveryKey);
      const latestRevision = latest === null ? 0 : checkedRecoveryStorageRecord(latest).revision;
      throw new DraftConflictError(expectedRevision, latestRevision);
    }
    return { revision: tombstone.revision, document: null };
  }

  async export() {
    const { document } = await this.load();
    if (!document) throw new DraftStoreError('empty');
    return JSON.stringify({ format: DRAFT_EXPORT_FORMAT, version: DRAFT_EXPORT_VERSION, document });
  }

  async import(serialized, { expectedRevision } = {}) {
    if (typeof serialized !== 'string' || serialized.length > MAX_DRAFT_EXPORT_BYTES) {
      throw new DraftStoreError('import_size');
    }
    let parsed;
    try { parsed = JSON.parse(serialized); } catch { throw new DraftStoreError('import_json'); }
    if (!isRecord(parsed) || Object.keys(parsed).length !== 3 || parsed.format !== DRAFT_EXPORT_FORMAT ||
        parsed.version !== DRAFT_EXPORT_VERSION || !Object.hasOwn(parsed, 'document')) {
      throw new DraftStoreError('import_format');
    }
    return this.save(parsed.document, { expectedRevision });
  }
}

export function createDraftStore(options) { return new DraftStore(options); }
