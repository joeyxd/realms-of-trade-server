import { validateDocument } from './document.js';
import { createIndexedDbDraftSource, MAX_DRAFT_EXPORT_BYTES } from './draftStore.js';
import { verifyPreparedRevision } from './publicationArtifact.js';
import { MAX_DOCUMENT_TILES, TERRAIN_TILES_NOT_READY, TILE_MAX_BYTES, isTerrainTilesDocument, tileSha256 } from './terrainTiles.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => structuredClone(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
// GM07b2 S4/S5: one tile upload or read moves at most 64 tiles and 4 MiB of tile bytes.
export const TILE_REQUEST_LIMIT = 64;
export const TILE_REQUEST_BYTES = 4 * 1024 * 1024;
export class RemoteDraftError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'RemoteDraftError'; this.code = code; Object.assign(this, details); }
}

// The tiles a document v5 references, from `tiles` (sha256 -> bytes of the referenced length); null for v2-v4.
function documentTiles(document, tiles) {
  if (!isTerrainTilesDocument(document)) return null;
  const result = new Map();
  for (const [, , sha256, length] of document.terrain.tiles) {
    const bytes = tiles instanceof Map ? tiles.get(sha256) : undefined;
    if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new RemoteDraftError('local_tile_missing', { sha256 });
    result.set(sha256, bytes);
  }
  return result;
}

// Upload body: repeated (u32 little-endian length + bytes).
function encodeFrames(list) {
  const body = new Uint8Array(list.reduce((size, bytes) => size + 4 + bytes.length, 0)), view = new DataView(body.buffer);
  let offset = 0;
  for (const bytes of list) { view.setUint32(offset, bytes.length, true); body.set(bytes, offset + 4); offset += 4 + bytes.length; }
  return body;
}

// Read answer: exactly `count` frames, nothing after them.
function decodeFrames(body, count) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength), frames = [];
  let offset = 0;
  while (offset < body.length) {
    if (frames.length >= count || body.length - offset < 4) throw new RemoteDraftError('response');
    const length = view.getUint32(offset, true);
    offset += 4;
    if (length > TILE_MAX_BYTES || length > body.length - offset) throw new RemoteDraftError('response');
    frames.push(body.slice(offset, offset + length));
    offset += length;
  }
  if (frames.length !== count) throw new RemoteDraftError('response');
  return frames;
}

/** Explicit remote saves. Persist the exact attempt before sending; an abort is never an ACK. */
export class RemoteDraftClient {
  constructor({ auth, accountId, httpBase, localScope, source, fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 12000 }) {
    if (!UUID.test(accountId) || !localScope || !auth?.sessionIdentity) throw new RemoteDraftError('configuration');
    Object.assign(this, { auth, accountId, fetchImpl, timeoutMs });
    this.url = new URL('api/gm/draft', httpBase);
    this.tilesUrl = new URL('terrain-tiles', this.url);
    this.tilesReadUrl = new URL('terrain-tiles/read', this.url);
    this.key = `remote-pending:${localScope}`;
    this.source = source || createIndexedDbDraftSource();
    this.pending = null; this.scope = null; this.controller = null; this.epoch = 0; this.enabled = true;
    // GM07b2 S4: tiles known to be on the server, per world: filled by successful uploads and by the heads the server
    // answers with (a head's tiles stay referenced, so the collector keeps them). A replayed receipt adds nothing.
    this.serverTiles = new Map();
  }

  resume() { this.enabled = true; }
  cancel() { this.enabled = false; this.epoch++; this.controller?.abort(); this.controller = null; }

  _knownTiles() {
    const world = this.scope?.worldId;
    if (typeof world !== 'string') return new Set();
    let known = this.serverTiles.get(world);
    if (!known) this.serverTiles.set(world, known = new Set());
    return known;
  }

  _noteServerTiles(document) {
    if (!isTerrainTilesDocument(document)) return;
    const known = this._knownTiles();
    for (const reference of document.terrain.tiles) known.add(reference[2]);
  }

  async _pendingRecord() {
    let record;
    try { record = await this.source.read(this.key); }
    catch { throw new RemoteDraftError('local_recovery_unavailable'); }
    if (record === null) return { revision: 0, operation: null };
    if (!Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision >= 2147483647 ||
        !Object.hasOwn(record, 'operation')) throw new RemoteDraftError('local_recovery_invalid');
    if (record.operation !== null) {
      const op = record.operation;
      if (!UUID.test(op?.operationId) || !Number.isSafeInteger(op.expectedRevision) || op.expectedRevision < 0 ||
          op.expectedRevision >= 2147483647) throw new RemoteDraftError('local_recovery_invalid');
      try { op.document = validateDocument(op.document); } catch { throw new RemoteDraftError('local_recovery_invalid'); }
    }
    return record;
  }

  // A v5 attempt is written with its tiles: the IndexedDB tile store keeps every tile a pending operation references,
  // so a retry after a reload still has the bytes to upload.
  async _replacePending(record, operation, tiles = null) {
    try {
      const next = { revision: record.revision + 1, operation };
      if (!await (tiles ? this.source.compareAndSwap(this.key, record.revision, next, { tiles })
        : this.source.compareAndSwap(this.key, record.revision, next))) {
        throw new RemoteDraftError('local_attempt_conflict');
      }
    } catch (error) { throw error instanceof RemoteDraftError ? error : new RemoteDraftError('local_recovery_unavailable'); }
    this.pending = clone(operation);
  }

  // The tile bytes stored with the pending record (empty when the source keeps no tiles).
  async _pendingTiles() {
    if (typeof this.source.readWithTiles !== 'function') return new Map();
    try { return (await this.source.readWithTiles(this.key)).tiles; }
    catch { throw new RemoteDraftError('local_recovery_unavailable'); }
  }

  async _clearPending(operation) {
    const record = await this._pendingRecord();
    if (record.operation === null) { this.pending = null; return; }
    if (!same(record.operation, operation)) throw new RemoteDraftError('local_attempt_conflict');
    await this._replacePending(record, null);
  }

  _checkIdentity() {
    if (!this.enabled || !this.auth.state?.signedIn || this.auth.state.accountId !== this.accountId) throw new RemoteDraftError('auth');
  }

  _head(head) {
    if (!head || !Number.isSafeInteger(head.revision) || head.revision < 0 || head.revision > 2147483647 ||
        (head.revision === 0 ? head.document !== null || head.savedAt !== null : typeof head.savedAt !== 'string')) {
      throw new RemoteDraftError('response');
    }
    return { revision: head.revision, document: head.revision ? validateDocument(head.document) : null, savedAt: head.savedAt };
  }

  async _request(method, operation = null, { expectedDocument = null } = {}) {
    if (this.controller) throw new RemoteDraftError('busy');
    const epoch = this.epoch, controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this._checkIdentity();
      const identity = await this.auth.sessionIdentity();
      if (identity.accountId !== this.accountId || epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('auth');
      const response = await this.fetchImpl(method === 'POST' ? new URL('prepare', this.url) : this.url, { method, headers: {
        authorization: `Bearer ${identity.token}`, ...(operation ? { 'content-type': 'application/json' } : {}),
      }, cache: 'no-store', signal: controller.signal, ...(operation ? { body: JSON.stringify(operation) } : {}) });
      this._checkIdentity();
      if (epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('cancelled');
      const length = Number(response.headers?.get?.('content-length'));
      if (length > MAX_DRAFT_EXPORT_BYTES + 1024 * 1024) throw new RemoteDraftError('response');
      const body = await response.json();
      this._checkIdentity();
      if (epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('cancelled');
      if (!response.ok) {
        throw new RemoteDraftError(body?.code || 'unavailable', { status: response.status, currentRevision: body?.revision,
          ...(Array.isArray(body?.missing) ? { missing: body.missing } : {}) });
      }
      const scope = body?.scope;
      if (body.ok !== true || typeof body.durable !== 'boolean' || !scope || typeof scope.worldId !== 'string' ||
          !Number.isSafeInteger(scope.seed) || typeof scope.baseRevision !== 'string' || (method !== 'GET' && this.scope && !same(scope, this.scope))) {
        throw new RemoteDraftError('response');
      }
      if (method === 'POST') {
        const preparation = body.preparation, report = preparation?.report;
        if (body.headRevision !== operation.expectedRevision || typeof report?.valid !== 'boolean' ||
            !Array.isArray(report.issues) || report.issues.length > 200 ||
            report.issues.some((issue) => !['error', 'warning'].includes(issue.severity) || typeof issue.code !== 'string') ||
            !Number.isSafeInteger(report.summary?.errors) || !Number.isSafeInteger(report.summary?.warnings) ||
            report.summary.errors < 0 || report.summary.warnings < 0 || report.valid !== (report.summary.errors === 0)) throw new RemoteDraftError('response');
        if (report.valid) {
          await verifyPreparedRevision(preparation.revision, { scope, draftRevision: body.headRevision, document: expectedDocument });
          if (!same(report, preparation.revision.content.validation)) throw new RemoteDraftError('response');
        } else if (preparation.revision !== null) throw new RemoteDraftError('response');
        this._checkIdentity();
        if (epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('cancelled');
        return { preparation, durable: body.durable, scope: clone(scope), headRevision: body.headRevision };
      }
      const head = this._head(body.head);
      if (method === 'PUT' && head.document && (head.document.base.seed !== scope.seed || head.document.base.revision !== scope.baseRevision)) {
        throw new RemoteDraftError('response');
      }
      this.scope = clone(scope);
      if (method === 'GET' || body.replay !== true) this._noteServerTiles(head.document);
      return { head, durable: body.durable, scope: clone(scope), replay: body.replay === true };
    } catch (error) {
      throw error instanceof RemoteDraftError ? error : new RemoteDraftError('unavailable');
    } finally { clearTimeout(timer); if (this.controller === controller) this.controller = null; }
  }

  // A terrain tile request (S4 upload answers JSON, S5 read answers frames), with the identity, cancellation and
  // timeout rules of _request. An error answer becomes RemoteDraftError(code, { status, missing? }).
  async _tileRequest(url, body, contentType, answer, maxBytes) {
    if (this.controller) throw new RemoteDraftError('busy');
    const epoch = this.epoch, controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this._checkIdentity();
      const identity = await this.auth.sessionIdentity();
      if (identity.accountId !== this.accountId || epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('auth');
      const response = await this.fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${identity.token}`,
        'content-type': contentType }, cache: 'no-store', signal: controller.signal, body });
      this._checkIdentity();
      if (epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('cancelled');
      const length = Number(response.headers?.get?.('content-length'));
      if (length > maxBytes) throw new RemoteDraftError('response');
      if (!response.ok) {
        let refusal = null;
        try { refusal = await response.json(); } catch { /* no JSON body */ }
        throw new RemoteDraftError(typeof refusal?.code === 'string' ? refusal.code : 'unavailable', { status: response.status,
          ...(Array.isArray(refusal?.missing) ? { missing: refusal.missing } : {}) });
      }
      const result = answer === 'bytes' ? new Uint8Array(await response.arrayBuffer()) : await response.json();
      if (answer === 'bytes' && result.length > maxBytes) throw new RemoteDraftError('response');
      this._checkIdentity();
      if (epoch !== this.epoch || controller.signal.aborted) throw new RemoteDraftError('cancelled');
      return result;
    } catch (error) {
      throw error instanceof RemoteDraftError ? error : new RemoteDraftError('unavailable');
    } finally { clearTimeout(timer); if (this.controller === controller) this.controller = null; }
  }

  // S4: upload the tiles of `hashes` in requests of at most 64 tiles and 4 MiB; each confirmed one joins the server
  // set. A hash without local bytes fails local_tile_missing; a server hash other than the reference fails tile_hash.
  async _uploadTiles(hashes, tiles) {
    const batches = [];
    let batch = [], bytesInBatch = 0;
    for (const sha256 of new Set(hashes)) {
      const bytes = tiles instanceof Map ? tiles.get(sha256) : undefined;
      if (!(bytes instanceof Uint8Array)) throw new RemoteDraftError('local_tile_missing', { sha256 });
      if (batch.length === TILE_REQUEST_LIMIT || bytesInBatch + bytes.length > TILE_REQUEST_BYTES) {
        batches.push(batch); batch = []; bytesInBatch = 0;
      }
      batch.push([sha256, bytes]); bytesInBatch += bytes.length;
    }
    if (batch.length) batches.push(batch);
    for (const entries of batches) {
      const answer = await this._tileRequest(this.tilesUrl, encodeFrames(entries.map((entry) => entry[1])),
        'application/octet-stream', 'json', 64 * 1024);
      if (answer?.ok !== true || !Number.isSafeInteger(answer.stored) || !Array.isArray(answer.hashes) ||
          answer.hashes.length !== entries.length) throw new RemoteDraftError('response');
      if (answer.hashes.some((hash, n) => hash !== entries[n][0])) throw new RemoteDraftError('tile_hash');
      const known = this._knownTiles();
      for (const [sha256] of entries) known.add(sha256);
    }
  }

  /**
   * S5: every tile of a remote document v5, to open it. Tiles already in the local tile store are taken from there;
   * the rest are read from the server in batches of 64, each checked (length and sha256) before use and kept in the
   * local tile store. Returns a Map sha256 -> bytes. A missing tile (tiles_missing) or a wrong hash (tile_hash)
   * rejects, so the caller opens nothing and the current document stays.
   */
  async headTiles(document) {
    this._checkIdentity();
    const checked = validateDocument(document);
    if (!isTerrainTilesDocument(checked)) return new Map();
    const lengths = new Map(checked.terrain.tiles.map((reference) => [reference[2], reference[3]]));
    let local = new Map();
    if (typeof this.source.readTiles === 'function') {
      try { local = await this.source.readTiles([...lengths.keys()]); } catch { local = new Map(); }
    }
    const tiles = new Map(), wanted = [];
    for (const [sha256, length] of lengths) {
      const bytes = local.get(sha256);
      if (bytes instanceof Uint8Array && bytes.length === length) tiles.set(sha256, bytes);
      else wanted.push(sha256);
    }
    const fetched = new Map();
    for (let n = 0; n < wanted.length; n += TILE_REQUEST_LIMIT) {
      const hashes = wanted.slice(n, n + TILE_REQUEST_LIMIT);
      const body = await this._tileRequest(this.tilesReadUrl, JSON.stringify({ hashes }), 'application/json', 'bytes',
        hashes.length * (4 + TILE_MAX_BYTES));
      const frames = decodeFrames(body, hashes.length);
      for (let k = 0; k < hashes.length; k++) {
        if (frames[k].length !== lengths.get(hashes[k]) || await tileSha256(frames[k]) !== hashes[k]) {
          throw new RemoteDraftError('tile_hash', { sha256: hashes[k] });
        }
        fetched.set(hashes[k], frames[k]);
      }
    }
    if (fetched.size > 0 && typeof this.source.putTiles === 'function') {
      // The editor also writes them with the next local save of the opened draft, which keeps them referenced.
      try { await this.source.putTiles(fetched); } catch { /* the bytes still open the draft */ }
    }
    for (const [sha256, bytes] of fetched) tiles.set(sha256, bytes);
    return tiles;
  }

  async inspect() {
    this.pending = clone((await this._pendingRecord()).operation);
    return this._request('GET');
  }

  async prepareRevision(expectedRevision, document) {
    this._checkIdentity();
    const epoch = this.epoch;
    const checked = validateDocument(document);
    // GM07b2: a document v5 (terrain tiles) is saved online but not prepared until GM07b2c; refused before any request.
    if (isTerrainTilesDocument(checked)) throw new RemoteDraftError(TERRAIN_TILES_NOT_READY);
    if (!this.scope || checked.base.seed !== this.scope.seed || checked.base.revision !== this.scope.baseRevision ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > 2147483647) throw new RemoteDraftError('base');
    this.pending = clone((await this._pendingRecord()).operation);
    if (this.pending !== null) throw new RemoteDraftError('pending');
    if (epoch !== this.epoch) throw new RemoteDraftError('cancelled');
    return this._request('POST', { expectedRevision }, { expectedDocument: checked });
  }

  /** Save a design; a document v5 needs `tiles` (sha256 -> bytes) holding every tile it references. */
  async save(document, expectedRevision, { tiles = null } = {}) {
    this._checkIdentity();
    const epoch = this.epoch;
    const checked = validateDocument(document);
    if (!this.scope || checked.base.seed !== this.scope.seed || checked.base.revision !== this.scope.baseRevision ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647) throw new RemoteDraftError('base');
    if (new TextEncoder().encode(JSON.stringify(checked)).byteLength > MAX_DRAFT_EXPORT_BYTES) throw new RemoteDraftError('document_limit');
    // Checked before anything is recorded: a v5 attempt is sent only with every tile it references.
    const local = documentTiles(checked, tiles);
    const record = await this._pendingRecord();
    if (record.operation !== null) throw new RemoteDraftError('pending');
    const operation = { operationId: globalThis.crypto.randomUUID(), expectedRevision, document: checked };
    await this._replacePending(record, operation, local);
    if (epoch !== this.epoch) throw new RemoteDraftError('cancelled');
    return this._sendPending(operation, local);
  }

  async retry() {
    this._checkIdentity();
    const epoch = this.epoch;
    const operation = (await this._pendingRecord()).operation;
    if (!operation) throw new RemoteDraftError('no_pending');
    this.pending = clone(operation);
    const tiles = isTerrainTilesDocument(operation.document) ? await this._pendingTiles() : null;
    if (epoch !== this.epoch) throw new RemoteDraftError('cancelled');
    return this._sendPending(operation, tiles);
  }

  // GM07b2 S4: before the PUT of a v5, upload the referenced tiles the server is not known to hold (those this browser
  // has). On tiles_missing upload the listed tiles and retry once with the same operation id; a second tiles_missing
  // is an error.
  async _putWithTiles(operation, tiles) {
    const known = this._knownTiles();
    const referenced = new Set(operation.document.terrain.tiles.map((reference) => reference[2]));
    await this._uploadTiles([...referenced].filter((sha256) => !known.has(sha256) && tiles?.get(sha256) instanceof Uint8Array), tiles);
    try { return await this._request('PUT', operation); }
    catch (error) {
      if (error.code !== 'tiles_missing') throw error;
      const missing = error.missing;
      if (!Array.isArray(missing) || missing.length < 1 || missing.length > MAX_DOCUMENT_TILES ||
          missing.some((sha256) => typeof sha256 !== 'string' || !SHA256.test(sha256) || !referenced.has(sha256))) {
        throw new RemoteDraftError('response');
      }
      for (const sha256 of missing) this._knownTiles().delete(sha256);
      await this._uploadTiles(missing, tiles);
      return this._request('PUT', operation);
    }
  }

  async _sendPending(operation, tiles = null) {
    try {
      const result = isTerrainTilesDocument(operation.document) ? await this._putWithTiles(operation, tiles)
        : await this._request('PUT', operation);
      if (result.head.revision !== operation.expectedRevision + 1 || !same(result.head.document, operation.document)) throw new RemoteDraftError('response');
      await this._clearPending(operation);
      return result;
    } catch (error) {
      // These statuses guarantee rejection. Timeouts/provider/transport errors retain the exact attempt.
      // A v5 attempt also ends when the server takes no tiles (SQL042 absent: no v5 was ever saved), when a tile it
      // needs is not in this browser, or when a local tile does not hash to its reference: none can complete later.
      if ([400, 409, 413, 429].includes(error.status) ||
          [TERRAIN_TILES_NOT_READY, 'local_tile_missing', 'tile_hash'].includes(error.code)) await this._clearPending(operation);
      throw error;
    }
  }
}
