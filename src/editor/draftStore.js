import { documentDomain, validateDocument } from './document.js';
import { isTerrainTilesDocument, tilesToGrid, verifyTileBlobs } from './terrainTiles.js';

export const DRAFT_EXPORT_FORMAT = 'marea.gm.draft-export';
// Version 2 (GM07 D8) carries the tiles a document v5 references: { "<sha256>": "<base64>" }. Version 1 still imports.
export const DRAFT_EXPORT_VERSION = 2;
const LEGACY_EXPORT_VERSION = 1;
export const MAX_DRAFT_EXPORT_BYTES = 5 * 1024 * 1024;
// Version 1 held the `drafts` store; version 2 adds `tiles` (sha256 -> tile bytes) and keeps every record.
export const DRAFT_DATABASE_VERSION = 2;

const clone = (value) => structuredClone(value);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

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

// The tile hashes a stored record references: its document, or the document of a pending remote operation.
function recordTileHashes(record) {
  const hashes = [];
  for (const document of [record?.document, record?.operation?.document]) {
    if (isTerrainTilesDocument(document) && Array.isArray(document.terrain?.tiles))
      for (const reference of document.terrain.tiles) if (typeof reference?.[2] === 'string') hashes.push(reference[2]);
  }
  return hashes;
}

// Inside a readwrite transaction over drafts and tiles, after the record put: store each tile of `tiles` the records
// reference and the store lacks, then delete every stored tile no record references.
function storeTiles(transaction, tiles) {
  const stored = transaction.objectStore('tiles');
  const records = transaction.objectStore('drafts').getAll(), keys = stored.getAllKeys();
  keys.onsuccess = () => {
    const referenced = new Set(), present = new Set(keys.result);
    for (const record of records.result) for (const sha256 of recordTileHashes(record)) referenced.add(sha256);
    for (const [sha256, bytes] of tiles) if (referenced.has(sha256) && !present.has(sha256)) stored.put(bytes, sha256);
    for (const sha256 of present) if (!referenced.has(sha256)) stored.delete(sha256);
  };
}

export function createIndexedDbDraftSource({ indexedDB = globalThis.indexedDB, databaseName = 'marea-gm-drafts-v1' } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') throw new DraftStoreError('indexeddb_unavailable');
  let databasePromise;
  const database = () => {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, DRAFT_DATABASE_VERSION);
        let settled = false;
        const refuse = (error) => { if (settled) return; settled = true; databasePromise = null; reject(error); };
        request.onupgradeneeded = () => {
          // Create what is missing only: a version 1 database keeps its `drafts` records untouched.
          const db = request.result;
          if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
          if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles');
        };
        request.onsuccess = () => {
          const db = request.result;
          // An open that was already refused (blocked) completes later: close it, the next access opens again.
          if (settled) { db.close?.(); return; }
          settled = true;
          // Let a newer tab upgrade the database; this tab reopens on its next access.
          db.onversionchange = () => { db.close?.(); databasePromise = null; };
          resolve(db);
        };
        request.onerror = () => refuse(request.error || new DraftStoreError('indexeddb_open'));
        // A tab still running the version 1 code holds the database open: the upgrade waits for it.
        request.onblocked = () => refuse(new DraftStoreError('indexeddb_blocked'));
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
    /** A record and the tiles it references, read in one transaction: { value, tiles: Map } (absent tiles left out). */
    async readWithTiles(key) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['drafts', 'tiles'], 'readonly'), tiles = new Map();
        const request = transaction.objectStore('drafts').get(key);
        request.onsuccess = () => {
          for (const sha256 of recordTileHashes(request.result)) {
            const read = transaction.objectStore('tiles').get(sha256);
            read.onsuccess = () => { if (read.result instanceof Uint8Array) tiles.set(sha256, read.result); };
          }
        };
        transaction.oncomplete = () => resolve({ value: request.result === undefined ? null : clone(request.result), tiles });
        transaction.onabort = () => reject(transaction.error || new DraftStoreError('indexeddb_read'));
        transaction.onerror = () => reject(transaction.error || new DraftStoreError('indexeddb_read'));
      });
    },
    /** Tile bytes by sha256 from the tile store: a Map of the present ones (GM07b2: a remote head opens with them). */
    async readTiles(hashes) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('tiles', 'readonly'), store = transaction.objectStore('tiles'), tiles = new Map();
        for (const sha256 of new Set(hashes)) {
          const read = store.get(sha256);
          read.onsuccess = () => { if (read.result instanceof Uint8Array) tiles.set(sha256, read.result); };
        }
        transaction.oncomplete = () => resolve(tiles);
        transaction.onabort = () => reject(transaction.error || new DraftStoreError('indexeddb_read'));
        transaction.onerror = () => reject(transaction.error || new DraftStoreError('indexeddb_read'));
      });
    },
    /**
     * Store tile bytes (a Map sha256 -> bytes) beside the records, e.g. tiles read from the server. Records are not
     * touched; the next write with tiles drops them again unless a record references them by then.
     */
    async putTiles(tiles) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('tiles', 'readwrite'), store = transaction.objectStore('tiles');
        for (const [sha256, bytes] of tiles) store.put(bytes, sha256);
        transaction.oncomplete = () => resolve(true);
        transaction.onabort = () => reject(transaction.error || new DraftStoreError('indexeddb_write'));
        transaction.onerror = () => reject(transaction.error || new DraftStoreError('indexeddb_write'));
      });
    },
    /**
     * Revision CAS of one record. With { tiles } (a Map sha256 -> bytes) the same transaction also stores the tiles the
     * record references and the store lacks, then drops every tile no record references.
     */
    async compareAndSwap(key, expectedRevision, nextRecord, { tiles } = {}) {
      const db = await database(), withTiles = tiles instanceof Map;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(withTiles ? ['drafts', 'tiles'] : 'drafts', 'readwrite');
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
          if (withTiles) storeTiles(transaction, tiles);
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

/**
 * The tiles a document v5 references, checked: present with the referenced length and, unless `verify` is false,
 * the sha256 and a canonical MNT1 blob of its key. Codes `<prefix>_tile_missing` and `<prefix>_tile_invalid`.
 * Null for documents without tiles. Loads and imports verify; a save trusts the editor's content-addressed tiles,
 * so its cost stays with the tiles it writes.
 */
export async function checkDocumentTiles(document, tiles, { prefix = 'document', verify = true } = {}) {
  if (!isTerrainTilesDocument(document)) return null;
  const blobs = new Map(), references = document.terrain.tiles;
  for (const [, , sha256, length] of references) {
    const bytes = tiles instanceof Map ? tiles.get(sha256) : undefined;
    if (bytes === undefined) throw new DraftStoreError(`${prefix}_tile_missing`, { sha256 });
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new DraftStoreError(`${prefix}_tile_invalid`, { sha256 });
    blobs.set(sha256, bytes);
  }
  if (!verify) return blobs;
  try {
    await verifyTileBlobs({ tiles: references, blobs });
    tilesToGrid({ tiles: references, blobs }, documentDomain(document)); // GM11b3: a v6 decodes over its own domain
  } catch (error) { throw new DraftStoreError(`${prefix}_tile_invalid`, { reason: error?.code }); }
  return blobs;
}

function toBase64(bytes) {
  let binary = '';
  for (let n = 0; n < bytes.length; n += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(n, n + 0x8000));
  return btoa(binary);
}

// Canonical base64 only (the text the encoder writes), else null.
function fromBase64(text) {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  let binary;
  try { binary = atob(text); } catch { return null; }
  const bytes = new Uint8Array(binary.length);
  for (let n = 0; n < binary.length; n++) bytes[n] = binary.charCodeAt(n);
  return toBase64(bytes) === text ? bytes : null;
}

/** The export envelope of a document and the tiles it references (every one is required). */
export function serializeDraftExport(document, tiles = null, space = undefined) {
  const encoded = {};
  if (isTerrainTilesDocument(document)) for (const [, , sha256] of document.terrain.tiles) {
    const bytes = tiles instanceof Map ? tiles.get(sha256) : undefined;
    if (!(bytes instanceof Uint8Array)) throw new DraftStoreError('tile_missing', { sha256 });
    encoded[sha256] = toBase64(bytes);
  }
  return JSON.stringify({ format: DRAFT_EXPORT_FORMAT, version: DRAFT_EXPORT_VERSION, document, tiles: encoded }, null, space);
}

/**
 * Parse and check an export: version 2 (with tiles) or version 1 (no tiles, documents v1..v4). Every tile of a v5 is
 * checked; a missing, extra or bad tile is refused with its code. Returns { document, tiles: Map }.
 */
export async function readDraftExport(serialized) {
  if (typeof serialized !== 'string' || serialized.length > MAX_DRAFT_EXPORT_BYTES) {
    throw new DraftStoreError('import_size');
  }
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { throw new DraftStoreError('import_json'); }
  const legacy = parsed?.version === LEGACY_EXPORT_VERSION;
  if (!isRecord(parsed) || parsed.format !== DRAFT_EXPORT_FORMAT || (!legacy && parsed.version !== DRAFT_EXPORT_VERSION) ||
      Object.keys(parsed).length !== (legacy ? 3 : 4) || !Object.hasOwn(parsed, 'document') ||
      (!legacy && !isRecord(parsed.tiles))) {
    throw new DraftStoreError('import_format');
  }
  let document;
  try { document = validateDocument(parsed.document); } catch { throw new DraftStoreError('document'); }
  if (legacy) {
    if (isTerrainTilesDocument(document)) throw new DraftStoreError('import_format');
    return { document, tiles: new Map() };
  }
  const referenced = new Set(isTerrainTilesDocument(document) ? document.terrain.tiles.map((reference) => reference[2]) : []);
  for (const sha256 of Object.keys(parsed.tiles)) if (!referenced.has(sha256)) throw new DraftStoreError('import_tile_extra', { sha256 });
  const tiles = new Map();
  for (const sha256 of referenced) {
    if (!Object.hasOwn(parsed.tiles, sha256)) throw new DraftStoreError('import_tile_missing', { sha256 });
    const bytes = fromBase64(parsed.tiles[sha256]);
    if (!bytes) throw new DraftStoreError('import_tile_invalid', { sha256 });
    tiles.set(sha256, bytes);
  }
  return { document, tiles: await checkDocumentTiles(document, tiles, { prefix: 'import' }) ?? new Map() };
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
    // A source with readWithTiles keeps tile bytes beside the records (IndexedDB version 2).
    this.tileSource = typeof source.readWithTiles === 'function';
  }

  async _read(key) {
    if (this.tileSource) return this.source.readWithTiles(key);
    return { value: await this.source.read(key), tiles: new Map() };
  }

  // Draft and recovery writes carry the referenced tiles; the store keeps them and drops unreferenced ones.
  async _write(key, expectedRevision, record, tiles) {
    if (!this.tileSource) {
      if (tiles?.size) throw new DraftStoreError('source');
      return this.source.compareAndSwap(key, expectedRevision, record);
    }
    return this.source.compareAndSwap(key, expectedRevision, record, { tiles: tiles || new Map() });
  }

  async _checkedDocument(document, tiles) {
    let checkedDocument;
    try { checkedDocument = validateDocument(document); }
    catch { throw new DraftStoreError('document'); }
    const blobs = await checkDocumentTiles(checkedDocument, tiles, { verify: false });
    if (blobs && !this.tileSource) throw new DraftStoreError('source');
    return { checkedDocument, blobs };
  }

  async load() {
    const { value: raw, tiles } = await this._read(this.key);
    if (raw === null) return { revision: 0, document: null };
    const record = clone(checkedRecord(raw));
    const blobs = await checkDocumentTiles(record.document, tiles, { prefix: 'stored' });
    return blobs ? { ...record, tiles: blobs } : record;
  }

  async save(document, { expectedRevision, tiles } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647) {
      throw new DraftStoreError('expected_revision');
    }
    const { checkedDocument, blobs } = await this._checkedDocument(document, tiles);
    const next = { revision: expectedRevision + 1, document: checkedDocument };
    const saved = await this._write(this.key, expectedRevision, next, blobs);
    if (!saved) {
      const current = await this.source.read(this.key);
      throw new DraftConflictError(expectedRevision, current === null ? 0 : checkedRecord(current).revision);
    }
    return blobs ? { ...clone(next), tiles: new Map(blobs) } : clone(next);
  }

  async loadRecovery() {
    const { value: raw, tiles } = await this._read(this.recoveryKey);
    if (raw === null) return null;
    const record = checkedRecoveryStorageRecord(raw);
    if (record.tombstone) return null;
    const blobs = await checkDocumentTiles(record.document, tiles, { prefix: 'stored' });
    return blobs ? { ...clone(record), tiles: blobs } : clone(record);
  }

  async saveRecovery(document, { expectedRevision, tiles } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 2147483647) {
      throw new DraftStoreError('expected_revision');
    }
    const { checkedDocument, blobs } = await this._checkedDocument(document, tiles);

    const raw = await this.source.read(this.recoveryKey);
    const current = raw === null ? null : checkedRecoveryStorageRecord(raw);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision >= 2147483647) throw new DraftStoreError('revision_exhausted');
    const next = { revision: currentRevision + 1, document: checkedDocument, expectedRevision };
    const saved = await this._write(this.recoveryKey, currentRevision, next, blobs);
    if (!saved) {
      const latest = await this.source.read(this.recoveryKey);
      const latestRevision = latest === null ? 0 : checkedRecoveryStorageRecord(latest).revision;
      throw new DraftConflictError(currentRevision, latestRevision);
    }
    return blobs ? { ...clone(next), tiles: new Map(blobs) } : clone(next);
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
    const { document, tiles } = await this.load();
    if (!document) throw new DraftStoreError('empty');
    return serializeDraftExport(document, tiles);
  }

  async import(serialized, { expectedRevision } = {}) {
    const { document, tiles } = await readDraftExport(serialized);
    return this.save(document, { expectedRevision, tiles });
  }
}

export function createDraftStore(options) { return new DraftStore(options); }
