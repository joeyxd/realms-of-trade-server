import { createHash } from 'node:crypto';
import { validateDocument } from '../src/editor/document.js';
import { MAX_DOCUMENT_TILES, TERRAIN_DOMAINS, TERRAIN_DOMAIN_LIMITS, TERRAIN_TILES_NOT_READY, TERRAIN_DOMAINS_NOT_READY, TILE_MAX_BYTES, decodeTile, domainBounds,
  encodeTile, isTerrainTilesDocument } from '../src/editor/terrainTiles.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORLD = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_BYTES = 5 * 1024 * 1024;
// GM07b2 S3/S4: one tile put or get moves at most 64 tiles and 4 MiB of tile bytes; the SQL put and get RPCs take 16
// per call (Node splits larger batches).
export const MAX_TILE_BATCH = 64;
export const MAX_TILE_BATCH_BYTES = 4 * 1024 * 1024;
const RPC_TILE_BATCH = 16;
const MIN_TILE_BYTES = 13;
const clone = value => structuredClone(value);
const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');
const base64 = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');

export class GmDraftStoreError extends Error {
  constructor(code) { super(`GM draft store: ${code}`); this.name = 'GmDraftStoreError'; this.code = code; }
}

function checkedWorld(raw) {
  if (typeof raw !== 'string' || !WORLD.test(raw)) throw new GmDraftStoreError('scope');
  return raw;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let n = 0; n < a.length; n++) if (a[n] !== b[n]) return false;
  return true;
}

// S3: a tile is stored only as its canonical MNT1 blob: it decodes in a known terrain domain (key inside it) and
// re-encodes to the identical bytes. The world names no base revision, so any domain the code knows may claim it;
// the document validator later checks each referenced tile against the document's own base revision. GM11b3: a tile of a
// document v6 may lie anywhere in the D1 limits, so the widest domain they allow also claims it.
const LIMITS_DOMAIN = domainBounds({ minTx: TERRAIN_DOMAIN_LIMITS.min, maxTx: TERRAIN_DOMAIN_LIMITS.max,
  minTz: TERRAIN_DOMAIN_LIMITS.min, maxTz: TERRAIN_DOMAIN_LIMITS.max });
function checkedTile(raw) {
  if (!(raw instanceof Uint8Array) || raw.length > TILE_MAX_BYTES) throw new GmDraftStoreError('tile_invalid');
  const bytes = new Uint8Array(raw);
  for (const baseRevision of [...Object.keys(TERRAIN_DOMAINS), LIMITS_DOMAIN]) {
    let canonical = false;
    try { canonical = sameBytes(encodeTile(decodeTile(bytes, baseRevision), baseRevision), bytes); } catch { /* next domain */ }
    if (canonical) return { sha256: sha256Hex(bytes), bytes };
  }
  throw new GmDraftStoreError('tile_invalid');
}

// A put batch: at most 64 tiles and 4 MiB in total, every tile valid (one bad tile refuses the batch). Returns a Map
// sha256 -> private copy of the bytes, deduplicated, in first-seen order.
function checkedTileBatch(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_TILE_BATCH) throw new GmDraftStoreError('tile_batch');
  let total = 0;
  for (const bytes of raw) {
    if (!(bytes instanceof Uint8Array)) throw new GmDraftStoreError('tile_invalid');
    total += bytes.length;
  }
  if (total > MAX_TILE_BATCH_BYTES) throw new GmDraftStoreError('tile_batch');
  const tiles = new Map();
  for (const bytes of raw) {
    const tile = checkedTile(bytes);
    tiles.set(tile.sha256, tile.bytes);
  }
  return tiles;
}

function checkedTileHashes(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_TILE_BATCH) throw new GmDraftStoreError('tile_batch');
  for (const hash of raw) if (typeof hash !== 'string' || !SHA256.test(hash)) throw new GmDraftStoreError('tile_hash');
  return [...new Set(raw)];
}

const tileReferences = document => isTerrainTilesDocument(document) ? document.terrain.tiles : [];

// tiles_missing lists sorted, unique, lowercase hashes, each one referenced by the saved document.
function checkedMissing(raw, document) {
  const referenced = new Set(tileReferences(document).map(reference => reference[2]));
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_DOCUMENT_TILES) throw new GmDraftStoreError('response');
  for (let n = 0; n < raw.length; n++) {
    if (typeof raw[n] !== 'string' || !SHA256.test(raw[n]) || !referenced.has(raw[n]) ||
        (n > 0 && raw[n] <= raw[n - 1])) throw new GmDraftStoreError('response');
  }
  return [...raw];
}

function checkedScope(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.world !== 'string' || !WORLD.test(raw.world) ||
      typeof raw.owner !== 'string' || !UUID.test(raw.owner)) throw new GmDraftStoreError('scope');
  return { world: raw.world, owner: raw.owner.toLowerCase() };
}

function checkedOperation(raw) {
  if (typeof raw !== 'string' || !UUID.test(raw) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(raw)) {
    throw new GmDraftStoreError('operation');
  }
  return raw.toLowerCase();
}

function checkedRevision(raw, max = 2147483646) {
  if (!Number.isSafeInteger(raw) || raw < 0 || raw > max) throw new GmDraftStoreError('revision');
  return raw;
}

function checkedDocument(raw) {
  // A document v5 holds tile references only (structural check here); its tiles live in the tile store (GM07b2).
  let document;
  try { document = validateDocument(raw); } catch { throw new GmDraftStoreError('document'); }
  // No stored tile is shorter than 13 bytes (SQL042 table and validator), so a shorter reference is refused in both
  // stores rather than answered with tiles_missing that no upload can satisfy.
  if (tileReferences(document).some(reference => reference[3] < MIN_TILE_BYTES)) throw new GmDraftStoreError('document');
  let encoded;
  try { encoded = JSON.stringify(document); } catch { throw new GmDraftStoreError('document'); }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) throw new GmDraftStoreError('document_size');
  return document;
}

function checkedHead(raw) {
  if (raw === null) return { revision: 0, document: null, savedAt: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 3 ||
      !Object.hasOwn(raw, 'revision') || !Object.hasOwn(raw, 'document') || !Object.hasOwn(raw, 'savedAt') ||
      !Number.isSafeInteger(raw.revision) || raw.revision < 1 || raw.revision > 2147483647 ||
      typeof raw.savedAt !== 'string' || !Number.isFinite(Date.parse(raw.savedAt))) throw new GmDraftStoreError('response');
  return { revision: raw.revision, document: checkedDocument(raw.document), savedAt: raw.savedAt };
}

function checkedSaveResult(raw, document) {
  if (raw?.ok === false && raw.why === 'conflict' && Number.isSafeInteger(raw.revision) && raw.revision >= 0) {
    return { ok: false, why: 'conflict', revision: raw.revision };
  }
  if (raw?.ok === false && raw.why === 'operation') return { ok: false, why: 'operation' };
  if (raw?.ok === false && raw.why === 'tiles_missing') {
    return { ok: false, why: 'tiles_missing', missing: checkedMissing(raw.missing, document) };
  }
  if (raw?.ok !== true || typeof raw.replay !== 'boolean') throw new GmDraftStoreError('response');
  return { ok: true, head: checkedHead(raw.head), replay: raw.replay };
}

function normalizedSave(raw) {
  const scope = checkedScope(raw);
  const operationId = checkedOperation(raw?.operationId);
  const expectedRevision = checkedRevision(raw?.expectedRevision);
  const document = checkedDocument(raw?.document);
  const request = { ...scope, expectedRevision, document };
  return { scope, operationId, expectedRevision, document, request };
}

export function createMemoryGmDraftMethods() {
  // Tiles by world and sha256 (bytes). No collector here: memory tiles live as long as the process, which only
  // development and tests use; SQL042 bounds the durable table instead.
  const heads = new Map(), receipts = new Map(), tiles = new Map();
  const key = ({ world, owner }) => `${world}\0${owner}`;
  const tileKey = (world, sha256) => `${world}\0${sha256}`;
  const canonical = value => JSON.stringify(value);
  const missingTiles = (world, document) => [...new Set(tileReferences(document)
    .filter(([, , sha256, bytes]) => tiles.get(tileKey(world, sha256))?.length !== bytes)
    .map(reference => reference[2]))].sort();
  return Object.freeze({
    async checkGmDrafts() { return { version: 1 }; },
    async checkGmTerrainTiles() { return { version: 1 }; },
    async checkGmTerrainDomains() { return { version: 1 }; },
    async putTerrainTiles(raw) {
      const world = checkedWorld(raw?.world), batch = checkedTileBatch(raw?.tiles);
      for (const [sha256, bytes] of batch) tiles.set(tileKey(world, sha256), bytes);
      return { ok: true, stored: batch.size };
    },
    async getTerrainTiles(raw) {
      const world = checkedWorld(raw?.world), hashes = checkedTileHashes(raw?.hashes), result = new Map();
      for (const sha256 of hashes) {
        const bytes = tiles.get(tileKey(world, sha256));
        if (bytes) result.set(sha256, new Uint8Array(bytes));
      }
      return result;
    },
    async loadGmDraft(raw) {
      const scope = checkedScope(raw);
      return checkedHead(heads.get(key(scope)) ?? null);
    },
    async saveGmDraft(raw) {
      const input = normalizedSave(raw), receipt = receipts.get(input.operationId), text = canonical(input.request);
      if (receipt) {
        if (receipt.text !== text) return { ok: false, why: 'operation' };
        return receipt.result.ok ? { ...clone(receipt.result), replay: true } : clone(receipt.result);
      }
      // As SQL042: missing tiles answer before any receipt, so the same operation id succeeds after the upload.
      const missing = missingTiles(input.scope.world, input.document);
      if (missing.length > 0) return { ok: false, why: 'tiles_missing', missing };
      const id = key(input.scope), current = heads.get(id) ?? null;
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        const result = { ok: false, why: 'conflict', revision: currentRevision };
        receipts.set(input.operationId, { text, result: clone(result) });
        return result;
      }
      const head = { revision: currentRevision + 1, document: clone(input.document), savedAt: new Date().toISOString() };
      const result = { ok: true, head: clone(head), replay: false };
      heads.set(id, head);
      receipts.set(input.operationId, { text, result: clone(result) });
      return result;
    },
  });
}

export function createSupabaseGmDraftMethods(client) {
  if (!client || typeof client.rpc !== 'function') throw new GmDraftStoreError('configuration');
  async function rpc(name, args, codes = null) {
    try {
      const result = await client.rpc(name, args);
      if (!result || result.error) {
        if (result?.error?.code === 'MNG01') throw new GmDraftStoreError('operation');
        const code = codes && Object.hasOwn(codes, result?.error?.code) ? codes[result.error.code] : null;
        if (code) throw new GmDraftStoreError(code);
        throw new Error('rpc');
      }
      return result.data;
    } catch (error) {
      if (error instanceof GmDraftStoreError) throw error;
      throw new GmDraftStoreError('unavailable');
    }
  }
  async function checkGmTerrainTiles() {
    let raw;
    try { raw = await rpc('mn_gm_terrain_tiles_ready', {}); } catch { throw new GmDraftStoreError('unavailable'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || raw.version !== 1) {
      throw new GmDraftStoreError('unavailable');
    }
    return { version: 1 };
  }
  // S9: every v5 save, tile put and tile get probes SQL042 first (the v4 probe pattern); without it they fail with
  // terrain_tiles_not_ready while v2-v4 drafts keep working.
  async function requireTerrainTiles() {
    try { await checkGmTerrainTiles(); } catch { throw new GmDraftStoreError(TERRAIN_TILES_NOT_READY); }
  }
  async function checkGmTerrainDomains() {
    let raw;
    try { raw = await rpc('mn_gm_terrain_domains_ready', {}); } catch { throw new GmDraftStoreError('unavailable'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || raw.version !== 1) {
      throw new GmDraftStoreError('unavailable');
    }
    return { version: 1 };
  }
  async function requireTerrainDomains() {
    try { await requireTerrainTiles(); await checkGmTerrainDomains(); }
    catch { throw new GmDraftStoreError(TERRAIN_DOMAINS_NOT_READY); }
  }
  return Object.freeze({
    async checkGmDrafts() {
      const raw = await rpc('mn_gm_drafts_ready', {});
      if (!raw || Object.keys(raw).length !== 1 || raw.version !== 1) throw new GmDraftStoreError('response');
      return { version: 1 };
    },
    checkGmTerrainTiles,
    checkGmTerrainDomains,
    async putTerrainTiles(raw) {
      const world = checkedWorld(raw?.world), batch = checkedTileBatch(raw?.tiles);
      if (batch.size === 0) return { ok: true, stored: 0 };
      await requireTerrainTiles();
      // Bytes travel as base64 text (supabase-js sends JSON), at most 16 tiles per RPC call.
      const entries = [...batch].map(([sha256, bytes]) => ({ sha256, b64: base64(bytes) }));
      let stored = 0;
      for (let n = 0; n < entries.length; n += RPC_TILE_BATCH) {
        const chunk = entries.slice(n, n + RPC_TILE_BATCH);
        const result = await rpc('mn_put_gm_terrain_tiles', { p_world: world, p_tiles: chunk }, { MNG03: 'tile_invalid' });
        if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 2 ||
            result.ok !== true || result.stored !== chunk.length) throw new GmDraftStoreError('response');
        stored += result.stored;
      }
      return { ok: true, stored };
    },
    async getTerrainTiles(raw) {
      const world = checkedWorld(raw?.world), hashes = checkedTileHashes(raw?.hashes);
      if (hashes.length === 0) return new Map();
      await requireTerrainTiles();
      // At most 16 hashes per RPC call: 16 tiles of 64 KiB are about 1.4 MB of base64 per answer.
      const found = new Map();
      for (let n = 0; n < hashes.length; n += RPC_TILE_BATCH) {
        const chunk = hashes.slice(n, n + RPC_TILE_BATCH), wanted = new Set(chunk);
        const data = await rpc('mn_get_gm_terrain_tiles', { p_world: world, p_hashes: chunk });
        if (!Array.isArray(data) || data.length > chunk.length) throw new GmDraftStoreError('response');
        for (const entry of data) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 2 ||
              !wanted.has(entry.sha256) || found.has(entry.sha256) || typeof entry.b64 !== 'string' ||
              entry.b64.length > Math.ceil(TILE_MAX_BYTES / 3) * 4 || !BASE64.test(entry.b64)) {
            throw new GmDraftStoreError('response');
          }
          // Node re-hashes every tile it is given back; the bytes must be the ones the hash names.
          const bytes = new Uint8Array(Buffer.from(entry.b64, 'base64'));
          if (bytes.length > TILE_MAX_BYTES || sha256Hex(bytes) !== entry.sha256) throw new GmDraftStoreError('response');
          found.set(entry.sha256, bytes);
        }
      }
      const result = new Map();
      for (const sha256 of hashes) if (found.has(sha256)) result.set(sha256, found.get(sha256));
      return result;
    },
    async loadGmDraft(raw) {
      const scope = checkedScope(raw);
      return checkedHead(await rpc('mn_load_gm_draft', { p_world: scope.world, p_owner: scope.owner }));
    },
    async saveGmDraft(raw) {
      const input = normalizedSave(raw);
      if (input.document.version === 4) {
        const ready = await rpc('mn_gm_material_drafts_ready', {});
        if (ready?.version !== 1 || ready?.terrainVersion !== 2 || Object.keys(ready).length !== 2) throw new GmDraftStoreError('unavailable');
      }
      if (input.document.version === 6) await requireTerrainDomains();
      else if (isTerrainTilesDocument(input.document)) await requireTerrainTiles();
      const result = await rpc('mn_save_gm_draft', { p_operation_id: input.operationId, p_request: input.request });
      return checkedSaveResult(result, input.document);
    },
  });
}
