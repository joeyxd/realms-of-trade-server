// GM07 terrain tiles (docs/briefs/gm07-terrain-tiles.md D1-D7): the domain table, tile math, the canonical MNT1
// tile blob and its sha256 identity, dense grid <-> tiles, and the document v2/v3/v4 -> v5 converter.
// Pure module: no DOM and no node: imports, it runs in the browser and in Node.
import { TERRAIN_GRID_SEGMENTS, TERRAIN_GRID_SIZE, TERRAIN_MATERIALS, TERRAIN_TILE_SIZE, compileTerrainGrid,
  createTerrainGrid, validateTerrain, validateTerrainGrid, validateTerrainGridForMap } from './terrainData.js';

export { terrainTileKey } from './terrainData.js';

export const TILE_SIZE = TERRAIN_TILE_SIZE;
export const TILE_VERTICES = TILE_SIZE * TILE_SIZE;
export const TILE_FORMAT_VERSION = 1;
export const TILE_HEADER_BYTES = 12;
export const TILE_MAX_CHANNELS = 8;
export const TILE_MAX_BYTES = 65536;
// The format holds material ids 1..255; validation accepts 1..4 (TERRAIN_MATERIALS) until GM10.
export const TILE_MAX_MATERIAL_ID = 255;
export const TERRAIN_TILES_VERSION = 3;
export const TILES_DOCUMENT_VERSION = 5;
export const MAX_DOCUMENT_TILES = 256;
// Until GM07b2 every path that would store, prepare, publish, activate or load a document v5 refuses it with this code.
export const TERRAIN_TILES_NOT_READY = 'terrain_tiles_not_ready';

const MAGIC = Object.freeze([0x4d, 0x4e, 0x54, 0x31]); // 'MNT1'
const INT16_LIMIT = 32767;
const SHA256 = /^[0-9a-f]{64}$/;
const HEX = Object.freeze(Array.from({ length: 256 }, (_, n) => n.toString(16).padStart(2, '0')));
const DOCUMENT_SCHEMA = 'marea.gm.map-draft'; // document.js DOCUMENT_SCHEMA (document.js imports this module)

function fail(code) { const error = new TypeError(`Invalid terrain tiles: ${code}`); error.code = code; throw error; }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Domains by base terrain revision (D2), the name a document carries in base.revision. The outer vertex ring of a
 * domain is not editable, and the far ring (x = maxX or z = maxZ) belongs to no tile. Cell 1 m.
 */
export const TERRAIN_DOMAINS = Object.freeze({
  'terrain-s21-v1': Object.freeze({ minX: -280, maxX: 280, minZ: -280, maxZ: 280, cell: 1 }),
});

export function terrainDomain(baseRevision) {
  if (typeof baseRevision !== 'string' || !Object.hasOwn(TERRAIN_DOMAINS, baseRevision)) fail('unknown_domain');
  return TERRAIN_DOMAINS[baseRevision];
}

const tileRanges = new WeakMap();
/** Tile keys of a domain: tx in [txMin, txMax], tz in [tzMin, tzMax] (terrain-s21-v1: -4..3 both, 64 tiles). */
export function terrainTileRange(baseRevision) {
  const domain = terrainDomain(baseRevision);
  let range = tileRanges.get(domain);
  if (!range) {
    range = Object.freeze({ txMin: Math.floor(domain.minX / TILE_SIZE), txMax: Math.floor((domain.maxX - 1) / TILE_SIZE),
      tzMin: Math.floor(domain.minZ / TILE_SIZE), tzMax: Math.floor((domain.maxZ - 1) / TILE_SIZE) });
    tileRanges.set(domain, range);
  }
  return range;
}

/** Editable vertex: integer coordinates inside the domain and off its outer ring. */
export function isEditableVertex(baseRevision, x, z) {
  const domain = terrainDomain(baseRevision);
  return Number.isInteger(x) && Number.isInteger(z) && x > domain.minX && x < domain.maxX && z > domain.minZ && z < domain.maxZ;
}

function checkTileKey(baseRevision, tx, tz) {
  const range = terrainTileRange(baseRevision);
  if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(tz) || tx < range.txMin || tx > range.txMax ||
      tz < range.tzMin || tz > range.tzMax) fail('tile_key');
}

function nonZero(values) {
  for (let n = 0; n < values.length; n++) if (values[n] !== 0) return true;
  return false;
}

// Non-editable vertices hold 0 (D6) and every per-vertex weight sum stays <= 255 (D5). Local u = x - 70tx, v = z - 70tz.
function checkTileContent(domain, tx, tz, deltasMm, channels) {
  const u0 = Math.max(0, domain.minX + 1 - TILE_SIZE * tx), u1 = Math.min(TILE_SIZE - 1, domain.maxX - 1 - TILE_SIZE * tx);
  const v0 = Math.max(0, domain.minZ + 1 - TILE_SIZE * tz), v1 = Math.min(TILE_SIZE - 1, domain.maxZ - 1 - TILE_SIZE * tz);
  for (let v = 0, n = 0; v < TILE_SIZE; v++) for (let u = 0; u < TILE_SIZE; u++, n++) {
    let sum = 0, used = deltasMm !== null && deltasMm[n] !== 0;
    for (let c = 0; c < channels.length; c++) {
      const weight = channels[c].weights[n];
      sum += weight;
      if (weight !== 0) used = true;
    }
    if (used && (u < u0 || u > u1 || v < v0 || v > v1)) fail('tile_edge');
    if (sum > 255) fail('tile_weight_sum');
  }
}

const heightEncoding = largest => largest === 0 ? 0 : largest <= INT16_LIMIT ? 1 : 2;
const heightBytes = encoding => encoding === 0 ? 0 : encoding === 1 ? 2 : 4;

/**
 * Encode one tile as its canonical MNT1 blob (D6, little-endian). tile = { tx, tz, deltasMm: Int32Array(4900) or
 * null, channels: [{ id, weights: Uint8Array(4900) }] }, both planes z outer, x inner. The height encoding is the
 * smallest that fits; all-zero channels are dropped and the rest sorted by id, so the same content always gives the
 * same bytes. A tile with neither heights nor paint is refused (absent means base).
 */
export function encodeTile(tile, baseRevision) {
  const domain = terrainDomain(baseRevision);
  if (!tile || typeof tile !== 'object') fail('tile');
  const { tx, tz } = tile, deltasMm = tile.deltasMm ?? null, source = tile.channels ?? [];
  checkTileKey(baseRevision, tx, tz);
  if (deltasMm !== null && (!(deltasMm instanceof Int32Array) || deltasMm.length !== TILE_VERTICES)) fail('tile_heights');
  if (!Array.isArray(source)) fail('tile_channels');
  const ids = new Set(), channels = [];
  for (const channel of source) {
    if (!channel || !Number.isInteger(channel.id) || channel.id < 1 || channel.id > TILE_MAX_MATERIAL_ID) fail('tile_channel_id');
    if (!(channel.weights instanceof Uint8Array) || channel.weights.length !== TILE_VERTICES) fail('tile_channels');
    if (ids.has(channel.id)) fail('tile_channel_order');
    ids.add(channel.id);
    if (nonZero(channel.weights)) channels.push(channel);
  }
  channels.sort((a, b) => a.id - b.id);
  if (channels.length > TILE_MAX_CHANNELS) fail('tile_channel_count');
  let largest = 0;
  if (deltasMm !== null) for (let n = 0; n < TILE_VERTICES; n++) {
    const size = Math.abs(deltasMm[n]);
    if (size > largest) largest = size;
  }
  const encoding = heightEncoding(largest), count = channels.length;
  if (encoding === 0 && count === 0) fail('tile_empty');
  checkTileContent(domain, tx, tz, encoding === 0 ? null : deltasMm, channels);
  const bytes = new Uint8Array(TILE_HEADER_BYTES + count + TILE_VERTICES * (heightBytes(encoding) + count));
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  bytes[4] = TILE_FORMAT_VERSION; bytes[5] = TILE_SIZE;
  view.setInt16(6, tx, true); view.setInt16(8, tz, true);
  bytes[10] = encoding; bytes[11] = count;
  let offset = TILE_HEADER_BYTES;
  for (const channel of channels) bytes[offset++] = channel.id;
  if (encoding === 1) for (let n = 0; n < TILE_VERTICES; n++, offset += 2) view.setInt16(offset, deltasMm[n], true);
  else if (encoding === 2) for (let n = 0; n < TILE_VERTICES; n++, offset += 4) view.setInt32(offset, deltasMm[n], true);
  for (const channel of channels) { bytes.set(channel.weights, offset); offset += TILE_VERTICES; }
  return bytes;
}

/**
 * Decode a canonical MNT1 blob; every non-canonical blob is refused with its own code. Returns { tx, tz,
 * deltasMm: Int32Array(4900) (zeros when the tile has no heights), channels: [{ id, weights: Uint8Array(4900) }] }.
 * encodeTile(decodeTile(bytes)) gives the same bytes. Material ids 1..255 pass here; validation narrows them.
 */
export function decodeTile(bytes, baseRevision) {
  const domain = terrainDomain(baseRevision);
  if (!(bytes instanceof Uint8Array)) fail('tile_blob');
  if (bytes.length > TILE_MAX_BYTES) fail('tile_too_large');
  if (bytes.length < TILE_HEADER_BYTES) fail('tile_truncated');
  for (let n = 0; n < MAGIC.length; n++) if (bytes[n] !== MAGIC[n]) fail('tile_magic');
  if (bytes[4] !== TILE_FORMAT_VERSION) fail('tile_version');
  if (bytes[5] !== TILE_SIZE) fail('tile_size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tx = view.getInt16(6, true), tz = view.getInt16(8, true), encoding = bytes[10], count = bytes[11];
  checkTileKey(baseRevision, tx, tz);
  if (encoding > 2) fail('tile_height_encoding');
  if (count > TILE_MAX_CHANNELS) fail('tile_channel_count');
  if (bytes.length < TILE_HEADER_BYTES + count) fail('tile_truncated');
  for (let c = 0; c < count; c++) {
    const id = bytes[TILE_HEADER_BYTES + c];
    if (id < 1) fail('tile_channel_id');
    if (c > 0 && id <= bytes[TILE_HEADER_BYTES + c - 1]) fail('tile_channel_order');
  }
  const expected = TILE_HEADER_BYTES + count + TILE_VERTICES * (heightBytes(encoding) + count);
  if (bytes.length < expected) fail('tile_truncated');
  if (bytes.length > expected) fail('tile_trailing');
  if (encoding === 0 && count === 0) fail('tile_empty');
  const deltasMm = new Int32Array(TILE_VERTICES);
  let offset = TILE_HEADER_BYTES + count, largest = 0;
  if (encoding === 1) for (let n = 0; n < TILE_VERTICES; n++, offset += 2) {
    const value = view.getInt16(offset, true), size = Math.abs(value);
    deltasMm[n] = value;
    if (size > largest) largest = size;
  } else if (encoding === 2) for (let n = 0; n < TILE_VERTICES; n++, offset += 4) {
    const value = view.getInt32(offset, true), size = Math.abs(value);
    deltasMm[n] = value;
    if (size > largest) largest = size;
  }
  if (encoding !== heightEncoding(largest)) fail('tile_height_canonical');
  const channels = [];
  for (let c = 0; c < count; c++, offset += TILE_VERTICES) {
    const weights = bytes.slice(offset, offset + TILE_VERTICES);
    if (!nonZero(weights)) fail('tile_channel_empty');
    channels.push({ id: bytes[TILE_HEADER_BYTES + c], weights });
  }
  checkTileContent(domain, tx, tz, encoding === 0 ? null : deltasMm, channels);
  return { tx, tz, deltasMm, channels };
}

/** Tile identity: lowercase sha256 hex of the blob bytes. Async (Web Crypto, Node 24 and browsers). */
export async function tileSha256(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('tile_blob');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let n = 0; n < digest.length; n++) hex += HEX[digest[n]];
  return hex;
}

/**
 * Structural check of the tile references of a document v5 (D7): [[tx, tz, sha256, bytes], ...] sorted by tz then
 * tx, unique, inside the domain of the base revision, at most 256, lowercase sha256 hex, bytes in 1..65536.
 * Synchronous; no blob is read. Returns a copy.
 */
export function validateTileReferences(tiles, baseRevision) {
  const range = terrainTileRange(baseRevision), width = range.txMax - range.txMin + 1;
  if (!Array.isArray(tiles)) fail('tiles');
  if (tiles.length > MAX_DOCUMENT_TILES) fail('tile_limit');
  let previous = -1;
  return tiles.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 4) fail('tile_entry');
    const [tx, tz, sha256, bytes] = entry;
    checkTileKey(baseRevision, tx, tz);
    const order = (tz - range.tzMin) * width + tx - range.txMin;
    if (order <= previous) fail('tile_order');
    previous = order;
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) fail('tile_sha256');
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > TILE_MAX_BYTES) fail('tile_bytes');
    return [tx, tz, sha256, bytes];
  });
}

/** The terrain of a document v5: { version: 3, tileSize: 70, tiles }. Structural only (document.js uses it). */
export function validateTerrainTiles(raw, baseRevision) {
  if (!record(raw) || Object.keys(raw).length !== 3 || raw.version !== TERRAIN_TILES_VERSION ||
      raw.tileSize !== TILE_SIZE || !Array.isArray(raw.tiles)) fail('format');
  return { version: TERRAIN_TILES_VERSION, tileSize: TILE_SIZE, tiles: validateTileReferences(raw.tiles, baseRevision) };
}

/** True for a document v5 (terrain tiles). */
export function isTerrainTilesDocument(document) {
  return document !== null && typeof document === 'object' && document.version === TILES_DOCUMENT_VERSION;
}

/** The refusal of a document v5 by every store, prepare, publish, activate and load path until GM07b2. */
export function terrainTilesNotReady() {
  const error = new TypeError(`Terrain tiles are not ready: ${TERRAIN_TILES_NOT_READY}`);
  error.code = TERRAIN_TILES_NOT_READY;
  return error;
}

// The dense grid is the runtime 561 x 561 grid (D12): only a domain of exactly that extent maps onto it.
function gridDomain(baseRevision) {
  const domain = terrainDomain(baseRevision), half = TERRAIN_GRID_SEGMENTS / 2;
  if (domain.cell !== 1 || domain.minX !== -half || domain.maxX !== half || domain.minZ !== -half ||
      domain.maxZ !== half) fail('domain_grid');
  return domain;
}

/**
 * Grid -> { tiles, blobs }: tiles are the document v5 references [tx, tz, sha256, bytes] sorted by tz then tx, blobs a
 * Map sha256 -> Uint8Array. A tile with no height delta and no weight is absent. Async (sha256).
 */
export async function gridToTiles(grid, baseRevision) {
  const domain = gridDomain(baseRevision), range = terrainTileRange(baseRevision);
  validateTerrainGrid(grid);
  const { deltasMm, weights } = grid, offset = -domain.minX;
  const deltas = new Int32Array(TILE_VERTICES);
  const planes = TERRAIN_MATERIALS.map(() => new Uint8Array(TILE_VERTICES));
  const [grass, dirt, sand, rock] = planes;
  const encoded = [], keys = [];
  for (let tz = range.tzMin; tz <= range.tzMax; tz++) for (let tx = range.txMin; tx <= range.txMax; tx++) {
    let used = false;
    for (let v = 0, n = 0; v < TILE_SIZE; v++) {
      const row = (TILE_SIZE * tz + v + offset) * TERRAIN_GRID_SIZE + TILE_SIZE * tx + offset;
      for (let u = 0; u < TILE_SIZE; u++, n++) {
        const k = row + u, w = k * 4;
        deltas[n] = deltasMm[k];
        grass[n] = weights[w]; dirt[n] = weights[w + 1]; sand[n] = weights[w + 2]; rock[n] = weights[w + 3];
        if (deltas[n] !== 0 || grass[n] !== 0 || dirt[n] !== 0 || sand[n] !== 0 || rock[n] !== 0) used = true;
      }
    }
    if (!used) continue;
    encoded.push(encodeTile({ tx, tz, deltasMm: deltas,
      channels: planes.map((plane, c) => ({ id: c + 1, weights: plane })) }, baseRevision));
    keys.push(tx, tz);
  }
  const hashes = await Promise.all(encoded.map(tileSha256));
  const tiles = [], blobs = new Map();
  for (let n = 0; n < encoded.length; n++) {
    tiles.push([keys[n * 2], keys[n * 2 + 1], hashes[n], encoded[n].length]);
    blobs.set(hashes[n], encoded[n]);
  }
  return { tiles, blobs };
}

/**
 * { tiles, blobs } -> grid. Synchronous: checks the references, then decodes every blob (canonical form, its key
 * equal to the reference, its length equal to the reference); hashes are checked by verifyTileBlobs. Channels with
 * ids other than 1..4 are refused until GM10 (unknown_material).
 */
export function tilesToGrid(source, baseRevision) {
  const domain = gridDomain(baseRevision);
  if (!source || typeof source !== 'object') fail('tile_blobs');
  const references = validateTileReferences(source.tiles, baseRevision);
  if (!(source.blobs instanceof Map)) fail('tile_blobs');
  const grid = createTerrainGrid(), { deltasMm, weights } = grid, offset = -domain.minX;
  for (const [tx, tz, sha256, length] of references) {
    const bytes = source.blobs.get(sha256);
    if (bytes === undefined) fail('tile_missing');
    if (!(bytes instanceof Uint8Array)) fail('tile_blob');
    if (bytes.length !== length) fail('tile_length');
    const tile = decodeTile(bytes, baseRevision);
    if (tile.tx !== tx || tile.tz !== tz) fail('tile_key_mismatch');
    for (const channel of tile.channels) if (channel.id > TERRAIN_MATERIALS.length) fail('unknown_material');
    for (let v = 0, n = 0; v < TILE_SIZE; v++) {
      const row = (TILE_SIZE * tz + v + offset) * TERRAIN_GRID_SIZE + TILE_SIZE * tx + offset;
      for (let u = 0; u < TILE_SIZE; u++, n++) deltasMm[row + u] = tile.deltasMm[n];
    }
    for (const channel of tile.channels) {
      const plane = channel.weights, family = channel.id - 1;
      for (let v = 0, n = 0; v < TILE_SIZE; v++) {
        const row = (TILE_SIZE * tz + v + offset) * TERRAIN_GRID_SIZE + TILE_SIZE * tx + offset;
        for (let u = 0; u < TILE_SIZE; u++, n++) weights[(row + u) * 4 + family] = plane[n];
      }
    }
  }
  return grid;
}

/** Check that every referenced blob is present, has the referenced length and hashes to its sha256. Async. */
export async function verifyTileBlobs(source) {
  if (!source || typeof source !== 'object' || !Array.isArray(source.tiles) || !(source.blobs instanceof Map)) fail('tile_blobs');
  for (const reference of source.tiles) {
    if (!Array.isArray(reference) || reference.length !== 4) fail('tile_entry');
    const bytes = source.blobs.get(reference[2]);
    if (bytes === undefined) fail('tile_missing');
    if (!(bytes instanceof Uint8Array)) fail('tile_blob');
    if (bytes.length !== reference[3]) fail('tile_length');
    if (await tileSha256(bytes) !== reference[2]) fail('tile_hash');
  }
  return true;
}

/** Compile tiles over a base map: tilesToGrid, then compileTerrainGrid (terrainData.js). */
export function compileTerrainTiles(baseMap, source, baseRevision) {
  return compileTerrainGrid(baseMap, tilesToGrid(source, baseRevision));
}

/** Validate tiles for a base map: tilesToGrid, then validateTerrainGridForMap. Returns the grid. */
export function validateTerrainTilesForMap(baseMap, source, baseRevision, options) {
  return validateTerrainGridForMap(baseMap, tilesToGrid(source, baseRevision), options);
}

const onOuterRing = index => {
  const i = index % TERRAIN_GRID_SIZE, j = (index - i) / TERRAIN_GRID_SIZE;
  return i === 0 || j === 0 || i === TERRAIN_GRID_SEGMENTS || j === TERRAIN_GRID_SEGMENTS;
};

/** Terrain v1/v2 (sparse) -> grid, exact: the same deltas and weights at the same index. Sync. */
export function terrainToGrid(terrain) {
  const checked = validateTerrain(terrain), grid = createTerrainGrid();
  for (const sample of checked.samples) {
    if (onOuterRing(sample[0])) fail('sample_edge');
    grid.deltasMm[sample[0]] = sample[1];
  }
  for (const entry of checked.materials || []) {
    if (onOuterRing(entry[0])) fail('sample_edge');
    const w = entry[0] * 4;
    grid.weights[w] = entry[1]; grid.weights[w + 1] = entry[2]; grid.weights[w + 2] = entry[3]; grid.weights[w + 3] = entry[4];
  }
  return grid;
}

/**
 * A document v2/v3/v4 as returned by validateDocument -> { document: v5, blobs }. Pure and deterministic: objects and
 * base overrides are copied unchanged, the terrain becomes tile references (none for v2), blobs a Map sha256 -> bytes.
 */
export async function convertDocumentToV5(document) {
  if (!record(document) || document.schema !== DOCUMENT_SCHEMA || ![2, 3, 4].includes(document.version)) fail('document_version');
  const revision = document.base?.revision;
  gridDomain(revision);
  let grid;
  if (document.version === 2) {
    if (document.terrain !== undefined) fail('terrain_version');
    grid = createTerrainGrid();
  } else {
    if (document.terrain?.version !== (document.version === 4 ? 2 : 1)) fail('terrain_version');
    grid = terrainToGrid(document.terrain);
  }
  const { tiles, blobs } = await gridToTiles(grid, revision);
  return { document: { schema: DOCUMENT_SCHEMA, version: TILES_DOCUMENT_VERSION,
    base: { seed: document.base.seed, revision }, objects: structuredClone(document.objects),
    baseOverrides: structuredClone(document.baseOverrides),
    terrain: { version: TERRAIN_TILES_VERSION, tileSize: TILE_SIZE, tiles } }, blobs };
}
