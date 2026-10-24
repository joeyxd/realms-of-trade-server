// GM07b1b (docs/briefs/gm07-terrain-tiles.md D4, D7, D8): the editor's terrain on tiles. A session owns the dense grid
// of the current document, its tile references and its compiled map. A stroke changes the grid only inside the tiles
// it touches, validates those tiles, and re-encodes and hashes only them; undo and redo decode only the tiles whose
// reference differs. Tile bytes are shared with the undo history (document.js createDocumentHistory).
// Pure module: no DOM; it runs in the browser and in Node.
import { validateDocument } from './document.js';
import { compileTerrainGrid, createTerrainGrid, TERRAIN_GRID_SEGMENTS, TERRAIN_GRID_SIZE, TERRAIN_MATERIALS,
  terrainTileKey, validateTerrainForMap, validateTerrainGridForMap } from './terrainData.js';
import { convertDocumentToV5, decodeTile, encodeTile, isTerrainTilesDocument, tilesToGrid, tileSha256, verifyTileBlobs,
  TERRAIN_TILES_VERSION, TILE_SIZE, TILE_VERTICES, TILES_DOCUMENT_VERSION } from './terrainTiles.js';
import { followGround, sculptTerrainGrid } from './terrainSculpt.js';
import { paintTerrainGrid } from './terrainPaint.js';
import { regionTerrainGrid } from './terrainRegion.js';

const HALF = TERRAIN_GRID_SEGMENTS / 2;
const fail = (code) => { const error = new TypeError(`Terrain session: ${code}`); error.code = code; throw error; };
const now = () => globalThis.performance?.now?.() ?? Date.now();
const keyOf = (reference) => terrainTileKey(reference[0], reference[1]);
const copyReferences = (references) => references.map((reference) => reference.slice());

/** Tile references of a document: those of a v5, none for a v2. A v3/v4 is opened (converted) first. */
export function tileReferences(document) {
  if (isTerrainTilesDocument(document)) return document.terrain.tiles;
  if (document?.terrain !== undefined) fail('document_version');
  return [];
}

function sameReferences(a, b) {
  if (a.length !== b.length) return false;
  for (let n = 0; n < a.length; n++)
    if (a[n][0] !== b[n][0] || a[n][1] !== b[n][1] || a[n][2] !== b[n][2] || a[n][3] !== b[n][3]) return false;
  return true;
}

/**
 * Open a document for editing. A v3/v4 is checked with today's rules and converted to v5 (convertDocumentToV5);
 * a v2 stays v2 with an empty grid; a v5 needs every referenced tile in `tiles` (length, sha256 and canonical decode)
 * and a whole grid that passes the edit rules. Returns { document, tiles: Map of the referenced tiles, grid, converted }.
 */
export async function openTerrainDocument({ map, baseRevision, document, tiles = null }) {
  const doc = validateDocument(document);
  if (doc.base.revision !== baseRevision) fail('base_mismatch');
  if (doc.version === 3 || doc.version === 4) {
    validateTerrainForMap(map, doc.terrain);
    const converted = await convertDocumentToV5(doc);
    const grid = tilesToGrid({ tiles: converted.document.terrain.tiles, blobs: converted.blobs }, baseRevision);
    return { document: converted.document, tiles: converted.blobs, grid, converted: true };
  }
  if (!isTerrainTilesDocument(doc)) return { document: doc, tiles: new Map(), grid: createTerrainGrid(), converted: false };
  const blobs = new Map();
  for (const [, , sha256] of doc.terrain.tiles) {
    const bytes = tiles instanceof Map ? tiles.get(sha256) : undefined;
    if (bytes === undefined) fail('tile_missing');
    blobs.set(sha256, bytes);
  }
  const source = { tiles: doc.terrain.tiles, blobs };
  await verifyTileBlobs(source);
  const grid = tilesToGrid(source, baseRevision);
  validateTerrainGridForMap(map, grid);
  return { document: doc, tiles: blobs, grid, converted: false };
}

// Tile (tx, tz) owns grid rows j = 70tz + v + 280 and columns i = 70tx + u + 280 (D1).
const tileRow = (tx, tz, v) => (TILE_SIZE * tz + v + HALF) * TERRAIN_GRID_SIZE + TILE_SIZE * tx + HALF;

/** GM08: the grid vertex bounds ({ i0, j0, i1, j1 }) of tiles by key ('tx,tz', as sync returns them); null for none. */
export function tileKeysRegion(keys) {
  let region = null;
  for (const key of keys) {
    const [tx, tz] = key.split(',').map(Number), i0 = TILE_SIZE * tx + HALF, j0 = TILE_SIZE * tz + HALF;
    const i1 = Math.min(TERRAIN_GRID_SEGMENTS, i0 + TILE_SIZE - 1), j1 = Math.min(TERRAIN_GRID_SEGMENTS, j0 + TILE_SIZE - 1);
    region = region ? { i0: Math.min(region.i0, i0), j0: Math.min(region.j0, j0), i1: Math.max(region.i1, i1), j1: Math.max(region.j1, j1) }
      : { i0, j0, i1, j1 };
  }
  return region;
}

// Write a decoded tile into its region of the grid; null clears the region (absent means base).
function writeTile(grid, tx, tz, tile) {
  const { deltasMm, weights } = grid;
  for (let v = 0, n = 0; v < TILE_SIZE; v++) {
    const row = tileRow(tx, tz, v);
    for (let u = 0; u < TILE_SIZE; u++, n++) {
      const k = row + u;
      deltasMm[k] = tile ? tile.deltasMm[n] : 0;
      weights.fill(0, k * 4, k * 4 + 4);
    }
  }
  if (tile) for (const channel of tile.channels) {
    const plane = channel.weights, family = channel.id - 1;
    for (let v = 0, n = 0; v < TILE_SIZE; v++) {
      const row = tileRow(tx, tz, v);
      for (let u = 0; u < TILE_SIZE; u++, n++) weights[(row + u) * 4 + family] = plane[n];
    }
  }
}

// The canonical MNT1 blob of one grid tile, exactly as gridToTiles encodes it; null when the tile holds nothing.
function encodeGridTile(grid, tx, tz, baseRevision) {
  const { deltasMm, weights } = grid, deltas = new Int32Array(TILE_VERTICES);
  const planes = TERRAIN_MATERIALS.map(() => new Uint8Array(TILE_VERTICES));
  const [grass, dirt, sand, rock] = planes;
  let used = false;
  for (let v = 0, n = 0; v < TILE_SIZE; v++) {
    const row = tileRow(tx, tz, v);
    for (let u = 0; u < TILE_SIZE; u++, n++) {
      const k = row + u, w = k * 4;
      deltas[n] = deltasMm[k];
      grass[n] = weights[w]; dirt[n] = weights[w + 1]; sand[n] = weights[w + 2]; rock[n] = weights[w + 3];
      if (deltas[n] !== 0 || grass[n] !== 0 || dirt[n] !== 0 || sand[n] !== 0 || rock[n] !== 0) used = true;
    }
  }
  return used ? encodeTile({ tx, tz, deltasMm: deltas,
    channels: planes.map((plane, c) => ({ id: c + 1, weights: plane })) }, baseRevision) : null;
}

const PAINT_TOOLS = new Set(['paint', 'erase']);

/**
 * The editing state of one document: the grid, its tile references and its compiled map (cached). `lookup(sha256)`
 * returns tile bytes held by the history. edit = { document, tool, points, radius, strength, falloff, shape, aspect,
 * rotation, level, material, flow }, or a region operation { document, tool, region, level, amount, passes, strength,
 * material } (terrainRegion.js): the edit always starts from edit.document, whatever the grid held before.
 */
export class TerrainSession {
  constructor({ map, baseRevision, grid = createTerrainGrid(), references = [], lookup = () => undefined }) {
    if (!map || typeof baseRevision !== 'string') throw new TypeError('TerrainSession requires a base map and revision');
    this.map = map; this.baseRevision = baseRevision; this.grid = grid; this.lookup = lookup;
    this.references = copyReferences(references); this.compiled = null; this.pending = false;
  }

  /** The compiled map of the grid: the base map when no tile is referenced. */
  surface() {
    if (!this.compiled) this.compiled = this.references.length ? compileTerrainGrid(this.map, this.grid) : this.map;
    return this.compiled;
  }

  /**
   * Bring the grid to a document's tiles, decoding only the tiles whose reference differs. Every needed tile is
   * checked before the grid changes. Returns the keys of the rewritten tiles.
   */
  sync(document, extra = null) {
    const wanted = tileReferences(document);
    if (sameReferences(wanted, this.references)) return [];
    const current = new Map(this.references.map((reference) => [keyOf(reference), reference]));
    const next = new Map(wanted.map((reference) => [keyOf(reference), reference]));
    const writes = [];
    for (const key of new Set([...current.keys(), ...next.keys()])) {
      const before = current.get(key), after = next.get(key);
      if (before && after && before[2] === after[2]) continue;
      if (!after) { writes.push([before[0], before[1], null]); continue; }
      const bytes = extra instanceof Map && extra.has(after[2]) ? extra.get(after[2]) : this.lookup(after[2]);
      if (!(bytes instanceof Uint8Array)) fail('tile_missing');
      if (bytes.length !== after[3]) fail('tile_length');
      const tile = decodeTile(bytes, this.baseRevision);
      if (tile.tx !== after[0] || tile.tz !== after[1]) fail('tile_key_mismatch');
      if (tile.channels.some((channel) => channel.id > TERRAIN_MATERIALS.length)) fail('unknown_material');
      writes.push([after[0], after[1], tile]);
    }
    for (const [tx, tz, tile] of writes) writeTile(this.grid, tx, tz, tile);
    this.references = copyReferences(wanted); this.compiled = null;
    return writes.map(([tx, tz]) => terrainTileKey(tx, tz));
  }

  /** sync(document), then the compiled map. */
  surfaceFor(document, extra = null) { this.sync(document, extra); return this.surface(); }

  _patch(edit) {
    const input = { ...edit, map: this.map, grid: this.grid, baseRevision: this.baseRevision };
    // GM08b: an edit with a region (rectangle or lasso) is one region operation instead of a stroke.
    if (edit.region) return regionTerrainGrid({ ...input, surface: this.surface() });
    return PAINT_TOOLS.has(edit.tool) ? paintTerrainGrid(input) : sculptTerrainGrid({ ...input, surface: this.surface() });
  }

  // Write a patch into the grid and keep the old values; the outer ring is never editable (base ocean, D2).
  _apply(patch) {
    const { indices } = patch, keys = new Set(), region = { i0: Infinity, j0: Infinity, i1: -1, j1: -1 };
    for (const k of indices) {
      const i = k % TERRAIN_GRID_SIZE, j = (k - i) / TERRAIN_GRID_SIZE;
      if (i === 0 || j === 0 || i === TERRAIN_GRID_SEGMENTS || j === TERRAIN_GRID_SEGMENTS) fail('protected_ground');
      keys.add(terrainTileKey(Math.floor((i - HALF) / TILE_SIZE), Math.floor((j - HALF) / TILE_SIZE)));
      region.i0 = Math.min(region.i0, i); region.i1 = Math.max(region.i1, i);
      region.j0 = Math.min(region.j0, j); region.j1 = Math.max(region.j1, j);
    }
    const { deltasMm, weights } = this.grid, heights = !!patch.deltasMm;
    const old = heights ? new Int32Array(indices.length) : new Uint8Array(indices.length * 4);
    for (let n = 0; n < indices.length; n++) {
      const k = indices[n];
      if (heights) { old[n] = deltasMm[k]; deltasMm[k] = patch.deltasMm[n]; continue; }
      for (let c = 0; c < 4; c++) { old[n * 4 + c] = weights[k * 4 + c]; weights[k * 4 + c] = patch.weights[n * 4 + c]; }
    }
    return { indices, old, heights, dirtyTiles: [...keys], region };
  }

  _revert({ indices, old, heights }) {
    const { deltasMm, weights } = this.grid;
    for (let n = 0; n < indices.length; n++) {
      const k = indices[n];
      if (heights) deltasMm[k] = old[n];
      else for (let c = 0; c < 4; c++) weights[k * 4 + c] = old[n * 4 + c];
    }
  }

  // The stroke's document: decorations follow a sculpted ground (as sculptTerrainDocument), terrain as references.
  _document(edit, before, after, references, sculpted) {
    const doc = validateDocument(edit.document);
    const { baseOverrides, objects } = sculpted ? followGround(doc, this.map, this.baseRevision, before, after) : doc;
    return validateDocument({ schema: doc.schema, version: TILES_DOCUMENT_VERSION, base: doc.base, objects, baseOverrides,
      terrain: { version: TERRAIN_TILES_VERSION, tileSize: TILE_SIZE, tiles: references } });
  }

  /**
   * The stroke as it would commit, without hashing: { document (terrain references not updated yet), map, region }.
   * `region` (as commit's, GM08) bounds the changed vertices against `region.from`, the map the stroke started from;
   * absent when nothing changes. The grid is back to its bytes before the call when this returns or throws.
   */
  preview(edit) {
    if (this.pending) fail('busy');
    this.sync(edit.document);
    const before = this.surface(), patch = this._patch(edit);
    if (!patch.indices.length) return { document: validateDocument(edit.document), map: before };
    const applied = this._apply(patch);
    try {
      validateTerrainGridForMap(this.map, this.grid, { dirtyTiles: applied.dirtyTiles });
      const after = compileTerrainGrid(this.map, this.grid);
      return { document: this._document(edit, before, after, this.references, applied.heights), map: after,
        region: { ...applied.region, from: before } };
    } finally { this._revert(applied); }
  }

  /**
   * Commit one stroke: patch, validate the dirty tiles, compile, then encode and hash only the dirty tiles. Returns
   * { document v5, tiles: Map of the new blobs, map, dirtyTiles, region, timings (ms) }; `region` holds the grid
   * bounds of the changed vertices (i0, j0, i1, j1, inclusive) and `from`, the compiled map they changed (GM07c).
   * A refusal leaves the grid with the same bytes as before. One commit at a time: a second call while one is
   * pending fails with busy.
   */
  async commit(edit) {
    if (this.pending) fail('busy');
    this.pending = true;
    const timings = {};
    let applied = null, previous = { compiled: this.compiled, references: this.references };
    try {
      this.sync(edit.document);
      previous = { compiled: this.surface(), references: this.references };
      let start = now();
      const patch = this._patch(edit);
      timings.stroke = now() - start;
      if (!patch.indices.length) return { document: validateDocument(edit.document), tiles: new Map(),
        map: previous.compiled, dirtyTiles: [], timings };
      applied = this._apply(patch);
      start = now();
      validateTerrainGridForMap(this.map, this.grid, { dirtyTiles: applied.dirtyTiles });
      timings.validate = now() - start;
      start = now();
      const after = compileTerrainGrid(this.map, this.grid);
      timings.compile = now() - start;
      const draft = this._document(edit, previous.compiled, after, previous.references, applied.heights);
      start = now();
      const encoded = applied.dirtyTiles.map((key) => {
        const [tx, tz] = key.split(',').map(Number);
        return [tx, tz, encodeGridTile(this.grid, tx, tz, this.baseRevision)];
      });
      timings.encode = now() - start;
      start = now();
      const hashes = await Promise.all(encoded.map(([, , bytes]) => bytes ? tileSha256(bytes) : null));
      timings.hash = now() - start;
      const byKey = new Map(previous.references.map((reference) => [keyOf(reference), reference])), tiles = new Map();
      encoded.forEach(([tx, tz, bytes], n) => {
        const key = terrainTileKey(tx, tz);
        if (!bytes) { byKey.delete(key); return; }
        byKey.set(key, [tx, tz, hashes[n], bytes.length]);
        tiles.set(hashes[n], bytes);
      });
      const references = [...byKey.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const document = validateDocument({ ...draft, terrain: { ...draft.terrain, tiles: references } });
      this.references = copyReferences(references); this.compiled = after;
      return { document, tiles, map: after, dirtyTiles: applied.dirtyTiles,
        region: { ...applied.region, from: previous.compiled }, timings };
    } catch (error) {
      if (applied) this._revert(applied);
      this.references = previous.references; this.compiled = previous.compiled;
      throw error;
    } finally { this.pending = false; }
  }
}
