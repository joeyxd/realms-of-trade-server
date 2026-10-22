import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDecoration, createDocument, validateDocument } from '../src/editor/document.js';
import { compileTerrainGrid, compileTerrainMap, createTerrainGrid, terrainEditableMask, terrainTileKey,
  validateTerrainForMap, validateTerrainGridForMap, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { convertDocumentToV5, decodeTile, encodeTile, gridToTiles, terrainDomain, terrainTileRange, terrainToGrid,
  tilesToGrid, tileSha256, validateTerrainTilesForMap, verifyTileBlobs, isEditableVertex,
  TERRAIN_TILES_NOT_READY, TILE_VERTICES } from '../src/editor/terrainTiles.js';
import { paintTerrainDocument } from '../src/editor/terrainPaint.js';
import { applyScatter, planScatter, scatterParameters } from '../src/editor/scatterBrush.js';
import { installGmContent, projectGmContent } from '../src/editor/contentProjection.js';
import { loadGmWorldContent } from '../src/editor/activeContent.js';
import { validateGmPublication } from '../src/editor/publicationValidation.js';
import { createGmDraftHandler } from '../server/gmDraftHttp.mjs';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';
import { createMemoryGmDraftMethods } from '../server/gmDraftStore.mjs';
import { createGmContentRegistry } from '../server/gmContentRegistry.mjs';
import { PREPARATION_SCHEMA, PREPARATION_VERSION } from '../src/editor/publicationArtifact.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'terrain-s21-v1';
const MAGIC = [0x4d, 0x4e, 0x54, 0x31];
const map = generateWorld(GAME.seed);
const exported = JSON.parse(await readFile(path.join(ROOT,
  'docs/delivery/gm05a/local/final-visible-5/terrain-v3-export.json'), 'utf8')).document;
const notReady = (error) => error?.code === TERRAIN_TILES_NOT_READY;
const coded = (code) => (error) => error?.code === code;
const vertex = (x, z) => (z + 280) * TERRAIN_GRID_SIZE + x + 280;
const local = (u, v) => v * 70 + u;
const bufferOf = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

function plane(entries = []) {
  const weights = new Uint8Array(TILE_VERTICES);
  for (const [n, value] of entries) weights[n] = value;
  return weights;
}

function heights(entries = []) {
  const deltas = new Int32Array(TILE_VERTICES);
  for (const [n, value] of entries) deltas[n] = value;
  return deltas;
}

// Writes an MNT1 blob field by field without any canonical check, to build refused blobs.
function rawTile({ magic = MAGIC, version = 1, size = 70, tx = 0, tz = 0, encoding = 0, ids = [], deltas = null,
  planes = [] } = {}) {
  const width = encoding === 2 ? 4 : 2;
  const bytes = new Uint8Array(12 + ids.length + (deltas ? deltas.length * width : 0) + planes.length * TILE_VERTICES);
  const view = new DataView(bytes.buffer);
  bytes.set(magic, 0); bytes[4] = version; bytes[5] = size;
  view.setInt16(6, tx, true); view.setInt16(8, tz, true);
  bytes[10] = encoding; bytes[11] = ids.length; bytes.set(ids, 12);
  let offset = 12 + ids.length;
  if (deltas) for (const value of deltas) {
    if (width === 4) view.setInt32(offset, value, true); else view.setInt16(offset, value, true);
    offset += width;
  }
  for (const weights of planes) { bytes.set(weights, offset); offset += TILE_VERTICES; }
  return bytes;
}

function roundTrip(bytes) {
  const decoded = decodeTile(bytes, BASE);
  assert.equal(Buffer.compare(Buffer.from(encodeTile(decoded, BASE)), Buffer.from(bytes)), 0, 'encode(decode(b)) is b');
  return decoded;
}

function codeOf(run) {
  try { run(); return 'ok'; } catch (error) { if (!error?.code) throw error; return error.code; }
}

let editable;
function editableMask() { return editable ??= terrainEditableMask(map); }
function freeVertex(skip = 0) {
  const mask = editableMask();
  for (let k = 0, seen = 0; k < mask.length; k++) if (mask[k] && seen++ >= skip) return k;
  throw new Error('no editable vertex');
}
const tileOf = (k) => {
  const x = k % TERRAIN_GRID_SIZE - 280, z = Math.floor(k / TERRAIN_GRID_SIZE) - 280;
  return [Math.floor(x / 70), Math.floor(z / 70)];
};

let paintedDocument;
function paintedV4() {
  if (paintedDocument) return paintedDocument;
  let document = validateDocument(exported);
  const strokes = [['sand', 1], ['rock', .5], ['dirt', .4]];
  outer: for (let z = -240; z <= 240; z += 6) for (let x = -240; x <= 240; x += 6) {
    if (map.groundAt(x, z) < 3) continue;
    try {
      let next = document;
      for (const [material, strength] of strokes) next = paintTerrainDocument({ map, document: next, baseRevision: BASE,
        points: [{ x, z }, { x: x + 3, z: z + 1 }], radius: 3, strength, falloff: .5, material });
      document = next;
      break outer;
    } catch { /* Try the next dry, unprotected point. */ }
  }
  assert.equal(document.version, 4, 'the GM05a export plus GM05b paint strokes is a document v4');
  assert.ok(document.terrain.samples.length > 0 && document.terrain.materials.length > 0);
  const families = new Set(document.terrain.materials.flatMap(([, ...weights]) => weights.flatMap((w, c) => w ? [c] : [])));
  assert.ok(families.size >= 3, 'several paint channels');
  paintedDocument = document;
  return document;
}

async function assertConvertedIdentity(original) {
  const converted = await convertDocumentToV5(original);
  assert.equal(converted.document.version, 5);
  assert.equal(JSON.stringify(validateDocument(converted.document)), JSON.stringify(converted.document));
  assert.deepEqual(converted.document.objects, original.objects);
  assert.deepEqual(converted.document.baseOverrides, original.baseOverrides);
  const source = { tiles: converted.document.terrain.tiles, blobs: converted.blobs };
  assert.equal(await verifyTileBlobs(source), true);
  const grid = tilesToGrid(source, BASE);
  const before = compileTerrainMap(map, original.terrain), after = compileTerrainGrid(map, grid);
  assert.equal(Buffer.compare(bufferOf(after.heights), bufferOf(before.heights)), 0, 'compiled heights are bit-identical');
  const expectedWeights = new Uint8Array(TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE * 4);
  for (const [index, ...weights] of original.terrain.materials || []) expectedWeights.set(weights, index * 4);
  assert.equal(Buffer.compare(bufferOf(grid.weights), bufferOf(expectedWeights)), 0, 'paint weights are identical');
  assert.equal(after.gmTerrain, before.gmTerrain);
  assert.equal(after.fullsegments, before.fullsegments);
  // Samplers agree around every edited vertex (5 x 5) and on a coarse lattice over the whole map.
  const probes = new Set();
  for (const [index] of [...original.terrain.samples, ...(original.terrain.materials || [])]) {
    const i = index % TERRAIN_GRID_SIZE, j = Math.floor(index / TERRAIN_GRID_SIZE);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) probes.add((j + dz) * TERRAIN_GRID_SIZE + i + dx);
  }
  for (let j = 3; j < 560; j += 23) for (let i = 3; i < 560; i += 23) probes.add(j * TERRAIN_GRID_SIZE + i);
  for (const k of probes) for (const offset of [0, .25, .5]) {
    const x = k % TERRAIN_GRID_SIZE - 280 + offset, z = Math.floor(k / TERRAIN_GRID_SIZE) - 280 + offset / 2;
    assert.deepEqual(after.materialWeightsAt(x, z), before.materialWeightsAt(x, z));
    assert.equal(after.materialAt(x, z), before.materialAt(x, z));
    assert.equal(after.groundAt(x, z), before.groundAt(x, z));
    assert.equal(after.heightAt(x, z), before.heightAt(x, z));
  }
  assert.equal(codeOf(() => validateTerrainGridForMap(map, grid)), codeOf(() => validateTerrainForMap(map, original.terrain)),
    'the v5 grid validates where the original validates');
  return { converted, grid };
}

test('MNT1 round trip: heights as int16', () => {
  const tile = { tx: 0, tz: 0, deltasMm: heights([[0, 32767], [1, -32767], [4899, 1]]), channels: [] };
  const bytes = encodeTile(tile, BASE);
  assert.equal(bytes.length, 12 + TILE_VERTICES * 2);
  assert.deepEqual([...bytes.slice(0, 12)], [...MAGIC, 1, 70, 0, 0, 0, 0, 1, 0]);
  const decoded = roundTrip(bytes);
  assert.deepEqual([decoded.tx, decoded.tz, decoded.channels], [0, 0, []]);
  assert.deepEqual(decoded.deltasMm, tile.deltasMm);
});

test('MNT1 round trip: heights as int32 when a delta exceeds 32,767 mm', () => {
  for (const big of [32768, -32768, 190000, -2000000]) {
    const bytes = encodeTile({ tx: -2, tz: 3, deltasMm: heights([[local(5, 6), big], [local(6, 6), 7]]) }, BASE);
    assert.equal(bytes[10], 2);
    assert.equal(bytes.length, 12 + TILE_VERTICES * 4);
    assert.deepEqual([...bytes.slice(6, 10)], [0xfe, 0xff, 3, 0]);
    const decoded = roundTrip(bytes);
    assert.equal(decoded.deltasMm[local(5, 6)], big);
    assert.equal(decoded.deltasMm[local(6, 6)], 7);
  }
});

test('MNT1 round trip: paint only, canonical channel order, empty channels dropped', () => {
  const sand = plane([[10, 200]]), grass = plane([[10, 55], [11, 3]]);
  const bytes = encodeTile({ tx: 1, tz: -1, deltasMm: null,
    channels: [{ id: 3, weights: sand }, { id: 2, weights: plane() }, { id: 1, weights: grass }] }, BASE);
  assert.equal(bytes[10], 0);
  assert.equal(bytes[11], 2);
  assert.deepEqual([...bytes.slice(12, 14)], [1, 3]);
  assert.equal(bytes.length, 12 + 2 + 2 * TILE_VERTICES);
  const same = encodeTile({ tx: 1, tz: -1, deltasMm: heights(), channels: [{ id: 1, weights: grass }, { id: 3, weights: sand }] }, BASE);
  assert.equal(Buffer.compare(Buffer.from(same), Buffer.from(bytes)), 0, 'same content, same bytes');
  const decoded = roundTrip(bytes);
  assert.deepEqual(decoded.channels.map(({ id }) => id), [1, 3]);
  assert.deepEqual(decoded.channels[1].weights, sand);
});

test('MNT1 round trip: heights plus 8 channels, and the 58,820-byte maximum', () => {
  const ids = [1, 2, 3, 4, 9, 17, 128, 255];
  const channels = ids.map((id, c) => ({ id, weights: plane([[c, 31], [100 + c, 1], [4899, 31]]) }));
  const bytes = encodeTile({ tx: 3, tz: 3, deltasMm: heights([[0, -1234], [4899, 32000]]), channels }, BASE);
  assert.equal(bytes.length, 12 + 8 + TILE_VERTICES * (2 + 8));
  const decoded = roundTrip(bytes);
  assert.deepEqual(decoded.channels.map(({ id }) => id), ids);
  const largest = encodeTile({ tx: 3, tz: 3, deltasMm: heights([[0, 100000]]), channels }, BASE);
  assert.equal(largest.length, 58820);
  roundTrip(largest);
});

test('decodeTile refuses a wrong magic, format version or tile size', () => {
  const channel = [plane([[0, 9]])];
  assert.throws(() => decodeTile(rawTile({ magic: [0x4d, 0x4e, 0x54, 0x32], ids: [1], planes: channel }), BASE), coded('tile_magic'));
  assert.throws(() => decodeTile(rawTile({ version: 2, ids: [1], planes: channel }), BASE), coded('tile_version'));
  assert.throws(() => decodeTile(rawTile({ size: 64, ids: [1], planes: channel }), BASE), coded('tile_size'));
  roundTrip(rawTile({ ids: [1], planes: channel }));
});

test('decodeTile refuses missing and trailing bytes', () => {
  const good = rawTile({ ids: [1], planes: [plane([[0, 9]])] });
  assert.throws(() => decodeTile(good.slice(0, 11), BASE), coded('tile_truncated'));
  assert.throws(() => decodeTile(good.slice(0, good.length - 1), BASE), coded('tile_truncated'));
  const longer = new Uint8Array(good.length + 1); longer.set(good);
  assert.throws(() => decodeTile(longer, BASE), coded('tile_trailing'));
  const missingIds = good.slice(0, 12); missingIds[11] = 3;
  assert.throws(() => decodeTile(missingIds, BASE), coded('tile_truncated'));
});

test('decodeTile refuses a height encoding that is not the smallest that fits', () => {
  const channel = { ids: [1], planes: [plane([[0, 9]])] };
  assert.throws(() => decodeTile(rawTile({ ...channel, encoding: 1, deltas: heights() }), BASE), coded('tile_height_canonical'));
  assert.throws(() => decodeTile(rawTile({ encoding: 2, deltas: heights([[0, 32767]]) }), BASE), coded('tile_height_canonical'));
  assert.throws(() => decodeTile(rawTile({ encoding: 1, deltas: heights([[0, -32768]]) }), BASE), coded('tile_height_canonical'));
  assert.throws(() => decodeTile(rawTile({ encoding: 3, deltas: heights([[0, 5]]) }), BASE), coded('tile_height_encoding'));
  roundTrip(rawTile({ encoding: 1, deltas: heights([[0, 32767]]) }));
  roundTrip(rawTile({ encoding: 2, deltas: heights([[0, -32768]]) }));
});

test('decodeTile refuses channel ids out of order, repeated or outside 1..255', () => {
  const two = [plane([[0, 1]]), plane([[1, 1]])];
  assert.throws(() => decodeTile(rawTile({ ids: [2, 1], planes: two }), BASE), coded('tile_channel_order'));
  assert.throws(() => decodeTile(rawTile({ ids: [4, 4], planes: two }), BASE), coded('tile_channel_order'));
  assert.throws(() => decodeTile(rawTile({ ids: [0], planes: [two[0]] }), BASE), coded('tile_channel_id'));
  assert.throws(() => encodeTile({ tx: 0, tz: 0, channels: [{ id: 256, weights: two[0] }] }, BASE), coded('tile_channel_id'));
  assert.throws(() => encodeTile({ tx: 0, tz: 0, channels: [{ id: 2, weights: two[0] }, { id: 2, weights: two[1] }] }, BASE),
    coded('tile_channel_order'));
  roundTrip(rawTile({ ids: [1, 255], planes: two }));
});

test('decodeTile and encodeTile refuse more than 8 channels', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9], planes = ids.map((_, c) => plane([[c, 1]]));
  assert.throws(() => decodeTile(rawTile({ ids, planes }), BASE), coded('tile_channel_count'));
  assert.throws(() => encodeTile({ tx: 0, tz: 0, channels: ids.map((id, c) => ({ id, weights: planes[c] })) }, BASE),
    coded('tile_channel_count'));
});

test('decodeTile refuses a channel whose 4,900 weights are all 0', () => {
  assert.throws(() => decodeTile(rawTile({ ids: [1, 2], planes: [plane([[0, 9]]), plane()] }), BASE), coded('tile_channel_empty'));
});

test('decodeTile and encodeTile refuse a per-vertex weight sum over 255', () => {
  const planes = [plane([[7, 200]]), plane([[7, 56]])];
  assert.throws(() => decodeTile(rawTile({ ids: [1, 2], planes }), BASE), coded('tile_weight_sum'));
  assert.throws(() => encodeTile({ tx: 0, tz: 0, channels: [{ id: 1, weights: planes[0] }, { id: 2, weights: planes[1] }] }, BASE),
    coded('tile_weight_sum'));
  roundTrip(rawTile({ ids: [1, 2], planes: [plane([[7, 200]]), plane([[7, 55]])] }));
});

test('decodeTile and encodeTile refuse heights or weights at a non-editable vertex', () => {
  // Tile (-4, 0) starts on the x = -280 ring; tile (0, -4) on the z = -280 ring.
  assert.throws(() => decodeTile(rawTile({ tx: -4, encoding: 1, deltas: heights([[local(0, 5), 10]]) }), BASE), coded('tile_edge'));
  assert.throws(() => decodeTile(rawTile({ tz: -4, ids: [1], planes: [plane([[local(5, 0), 10]])] }), BASE), coded('tile_edge'));
  assert.throws(() => encodeTile({ tx: -4, tz: 0, deltasMm: heights([[local(0, 5), 10]]) }, BASE), coded('tile_edge'));
  roundTrip(rawTile({ tx: -4, tz: -4, encoding: 1, deltas: heights([[local(1, 1), 10]]) }));
  assert.equal(isEditableVertex(BASE, -280, 0), false);
  assert.equal(isEditableVertex(BASE, -279, -279), true);
  assert.equal(isEditableVertex(BASE, 279, 279), true);
  assert.equal(isEditableVertex(BASE, 280, 0), false);
});

test('decodeTile refuses an empty tile, a blob over 65,536 bytes and a key outside the domain', () => {
  assert.throws(() => decodeTile(rawTile(), BASE), coded('tile_empty'));
  assert.throws(() => encodeTile({ tx: 0, tz: 0, deltasMm: heights(), channels: [{ id: 1, weights: plane() }] }, BASE), coded('tile_empty'));
  const huge = new Uint8Array(65537); huge.set(rawTile({ ids: [1], planes: [plane([[0, 1]])] }));
  assert.throws(() => decodeTile(huge, BASE), coded('tile_too_large'));
  assert.throws(() => decodeTile(rawTile({ tx: 4, ids: [1], planes: [plane([[0, 1]])] }), BASE), coded('tile_key'));
  assert.throws(() => decodeTile([...rawTile({ ids: [1], planes: [plane([[0, 1]])] })], BASE), coded('tile_blob'));
  assert.throws(() => decodeTile(rawTile({ ids: [1], planes: [plane([[0, 1]])] }), 'gm05b-material-test'), coded('unknown_domain'));
});

test('tile identity is the lowercase sha256 hex of the blob bytes', async () => {
  const bytes = encodeTile({ tx: -1, tz: 2, deltasMm: heights([[100, 2500]]), channels: [{ id: 2, weights: plane([[100, 80]]) }] }, BASE);
  assert.equal(await tileSha256(bytes), createHash('sha256').update(bytes).digest('hex'));
  assert.match(await tileSha256(bytes), /^[0-9a-f]{64}$/);
});

test('domain table: terrain-s21-v1 has tiles -4..3 and other revisions have no domain', () => {
  assert.deepEqual(terrainDomain(BASE), { minX: -280, maxX: 280, minZ: -280, maxZ: 280, cell: 1 });
  assert.ok(Object.isFrozen(terrainDomain(BASE)));
  assert.deepEqual({ ...terrainTileRange(BASE) }, { txMin: -4, txMax: 3, tzMin: -4, tzMax: 3 });
  for (const revision of ['gm05b-material-test', 'constructor', '', null]) assert.throws(() => terrainDomain(revision), coded('unknown_domain'));
  assert.equal(terrainTileKey(-4, 3), '-4,3');
});

test('converter: the GM05a v3 export compiles bit-identically and validates as the original', async () => {
  const original = validateDocument(exported);
  assert.equal(original.version, 3);
  assert.equal(codeOf(() => validateTerrainForMap(map, original.terrain)), 'ok');
  const { converted } = await assertConvertedIdentity(original);
  assert.ok(converted.document.terrain.tiles.length >= 1);
  const again = await convertDocumentToV5(original);
  assert.deepEqual(again.document, converted.document, 'deterministic');
});

test('converter: a painted v4 document compiles to identical heights and paint weights', async () => {
  const original = paintedV4();
  const { converted } = await assertConvertedIdentity(original);
  assert.ok(converted.document.terrain.tiles.length >= 2);
  const v2 = await convertDocumentToV5(createDocument({ seed: map.seed, baseRevision: BASE }));
  assert.deepEqual(v2.document.terrain, { version: 3, tileSize: 70, tiles: [] });
  assert.equal(v2.blobs.size, 0);
});

test('converter refuses a v1/v2 sample on the outer ring and a base revision without a domain', async () => {
  for (const index of [0, 5, 560, 561 * 7, 561 * 7 + 560, 561 * 560 + 3]) {
    assert.throws(() => terrainToGrid({ version: 1, samples: [[index, 500]] }), coded('sample_edge'));
    assert.throws(() => terrainToGrid({ version: 2, samples: [], materials: [[index, 255, 0, 0, 0]] }), coded('sample_edge'));
  }
  const elsewhere = createDocument({ seed: 1, baseRevision: 'gm05b-material-test', terrain: { version: 1, samples: [[100000, 5]] } });
  await assert.rejects(convertDocumentToV5(elsewhere), coded('unknown_domain'));
  await assert.rejects(convertDocumentToV5({ ...validateDocument(exported), version: 5 }), coded('document_version'));
});

test('tiles to grid refuses a missing blob, a wrong length or key; verifyTileBlobs refuses a wrong hash', async () => {
  const grid = createTerrainGrid(), k = vertex(10, 20);
  grid.deltasMm[k] = 900;
  const { tiles, blobs } = await gridToTiles(grid, BASE);
  assert.deepEqual(tiles.map(([tx, tz]) => [tx, tz]), [[0, 0]]);
  assert.deepEqual(tilesToGrid({ tiles, blobs }, BASE).deltasMm, grid.deltasMm);
  assert.throws(() => tilesToGrid({ tiles, blobs: new Map() }, BASE), coded('tile_missing'));
  assert.throws(() => tilesToGrid({ tiles: [[0, 0, tiles[0][2], tiles[0][3] + 1]], blobs }, BASE), coded('tile_length'));
  assert.throws(() => tilesToGrid({ tiles: [[1, 0, tiles[0][2], tiles[0][3]]], blobs }, BASE), coded('tile_key_mismatch'));
  const wrong = 'f'.repeat(64);
  await assert.rejects(verifyTileBlobs({ tiles: [[0, 0, wrong, tiles[0][3]]], blobs: new Map([[wrong, blobs.get(tiles[0][2])]]) }),
    coded('tile_hash'));
});

test('grid height range: compiled heights below -40 m or above +200 m are refused, the 12 m cap does not apply', async () => {
  const k = freeVertex(), base = map.heights[k], grid = createTerrainGrid();
  grid.deltasMm[k] = Math.round((-40.5 - base) * 1000);
  assert.throws(() => validateTerrainGridForMap(map, grid), coded('height_range'));
  grid.deltasMm[k] = Math.round((200.5 - base) * 1000);
  assert.throws(() => validateTerrainGridForMap(map, grid), coded('height_range'));
  grid.deltasMm[k] = Math.round((199.5 - base) * 1000);
  assert.equal(validateTerrainGridForMap(map, grid), grid);
  assert.ok(grid.deltasMm[k] > 12000 * 10);
  const { tiles, blobs } = await gridToTiles(grid, BASE);
  assert.equal(blobs.get(tiles[0][2])[10], 2, 'int32 heights');
  const compiled = compileTerrainGrid(map, grid);
  assert.equal(compiled.heights[k], Math.fround(base + grid.deltasMm[k] / 1000));
});

test('material id 5 is refused with unknown_material until GM10', async () => {
  const k = freeVertex(10), [tx, tz] = tileOf(k), x = k % TERRAIN_GRID_SIZE - 280, z = Math.floor(k / TERRAIN_GRID_SIZE) - 280;
  const weights = plane([[local(x - 70 * tx, z - 70 * tz), 120]]);
  const bytes = encodeTile({ tx, tz, channels: [{ id: 5, weights }] }, BASE);
  assert.deepEqual(decodeTile(bytes, BASE).channels.map(({ id }) => id), [5], 'the format holds ids 1..255');
  const source = { tiles: [[tx, tz, await tileSha256(bytes), bytes.length]], blobs: new Map([[await tileSha256(bytes), bytes]]) };
  assert.throws(() => tilesToGrid(source, BASE), coded('unknown_material'));
  assert.throws(() => validateTerrainTilesForMap(map, source, BASE), coded('unknown_material'));
  const four = encodeTile({ tx, tz, channels: [{ id: 4, weights }] }, BASE), hash = await tileSha256(four);
  const grid = validateTerrainTilesForMap(map, { tiles: [[tx, tz, hash, four.length]], blobs: new Map([[hash, four]]) }, BASE);
  assert.equal(grid.weights[k * 4 + 3], 120);
});

test('protected vertices are refused by the grid with the code terrain v1/v2 gives', () => {
  const points = [map.landmarks.spawn, map.landmarks.village, map.landmarks.dockBase, map.landmarks.dockEnd,
    map.landmarks.arena, map.landmarks.volcano, ...map.landmarks.path, ...Object.values(map.checkpoints), { x: -250, z: -250 }];
  const seen = new Set(), grid = createTerrainGrid();
  const indices = points.map((p) => vertex(Math.round(p.x), Math.round(p.z)));
  for (let k = vertex(-270, -270); k < vertex(270, 270); k += 2003) {
    const i = k % TERRAIN_GRID_SIZE;
    if (i > 0 && i < 560) indices.push(k);
  }
  for (const k of indices) for (const delta of [1500, -1500]) {
    const sparse = codeOf(() => validateTerrainForMap(map, { version: 1, samples: [[k, delta]] }));
    grid.deltasMm[k] = delta;
    assert.equal(codeOf(() => validateTerrainGridForMap(map, grid)), sparse, `height at ${k}`);
    assert.equal(codeOf(() => validateTerrainGridForMap(map, grid, { dirtyTiles: [terrainTileKey(...tileOf(k))] })), sparse);
    grid.deltasMm[k] = 0;
    seen.add(sparse);
  }
  for (const k of indices.slice(0, 20)) {
    const sparse = codeOf(() => validateTerrainForMap(map, { version: 2, samples: [], materials: [[k, 0, 0, 255, 0]] }));
    grid.weights[k * 4 + 2] = 255;
    assert.equal(codeOf(() => validateTerrainGridForMap(map, grid)), sparse, `paint at ${k}`);
    grid.weights[k * 4 + 2] = 0;
  }
  for (const code of ['protected_ground', 'protected_route', 'protected_area', 'ok']) assert.ok(seen.has(code), code);
});

test('dirty-tile validation gives the same result as full validation on the same grid', async () => {
  const original = paintedV4(), grid = terrainToGrid(original.terrain);
  const { tiles } = await gridToTiles(grid, BASE);
  const dirty = tiles.map(([tx, tz]) => terrainTileKey(tx, tz));
  assert.equal(codeOf(() => validateTerrainGridForMap(map, grid)), 'ok');
  assert.equal(codeOf(() => validateTerrainGridForMap(map, grid, { dirtyTiles: dirty })), 'ok');
  assert.equal(codeOf(() => validateTerrainGridForMap(map, grid, { dirtyTiles: [...dirty].reverse() })), 'ok');
  // Two refused vertices in different tiles: both modes report the first one in vertex order.
  const found = [], probe = createTerrainGrid();
  for (let k = vertex(-200, -200); k < vertex(200, 200) && found.length < 2; k += 1009) {
    probe.deltasMm[k] = 2000;
    const code = codeOf(() => validateTerrainGridForMap(map, probe));
    probe.deltasMm[k] = 0;
    if (code !== 'ok' && found.every((other) => other.code !== code && String(other.tile) !== String(tileOf(k))))
      found.push({ k, code, tile: tileOf(k) });
  }
  const [a, b] = found, first = a.k, second = b.k;
  assert.ok(first < second);
  assert.notDeepEqual(a.tile, b.tile);
  grid.deltasMm[first] = 2000; grid.deltasMm[second] = 2000;
  const keys = [...dirty, terrainTileKey(...b.tile), terrainTileKey(...a.tile)];
  assert.equal(codeOf(() => validateTerrainGridForMap(map, grid)), a.code);
  assert.equal(codeOf(() => validateTerrainGridForMap(map, grid, { dirtyTiles: keys })), a.code);
  assert.equal(codeOf(() => validateTerrainGridForMap(map, grid, { dirtyTiles: [...keys].reverse() })), a.code);
  assert.equal(codeOf(() => validateTerrainGridForMap(map, grid, { dirtyTiles: [terrainTileKey(...b.tile)] })), b.code);
  assert.throws(() => validateTerrainGridForMap(map, grid, { dirtyTiles: ['4,0'] }), coded('tile_key'));
  assert.throws(() => validateTerrainGridForMap(map, grid, { dirtyTiles: ['x'] }), coded('tile_key'));
});

test('the outer vertex ring of a grid is refused (grid_edge)', async () => {
  for (const k of [vertex(-280, 0), vertex(280, 10), vertex(5, -280), vertex(-3, 280)]) {
    const grid = createTerrainGrid(); grid.weights[k * 4] = 10;
    assert.throws(() => validateTerrainGridForMap(map, grid, { dirtyTiles: ['0,0'] }), coded('grid_edge'));
    assert.throws(() => compileTerrainGrid(map, grid), coded('grid_edge'));
    await assert.rejects(gridToTiles(grid, BASE), coded('grid_edge'));
  }
});

test('document v5 parse accepts sorted tile references and refuses the rest', () => {
  const hash = (n) => n.toString(16).padStart(64, '0');
  const v5 = (tiles, baseRevision = BASE) => ({ schema: 'marea.gm.map-draft', version: 5, base: { seed: 7, revision: baseRevision },
    objects: [], baseOverrides: [], terrain: { version: 3, tileSize: 70, tiles } });
  const sorted = [[3, -4, hash(1), 4913], [-4, -3, hash(2), 9812], [-1, -3, hash(3), 65536], [2, 3, hash(4), 1]];
  assert.deepEqual(validateDocument(v5(sorted)), v5(sorted));
  assert.deepEqual(validateDocument(v5([])).terrain.tiles, []);
  assert.throws(() => validateDocument(v5([sorted[1], sorted[0]])), coded('tile_order'));
  assert.throws(() => validateDocument(v5([sorted[0], sorted[0]])), coded('tile_order'));
  assert.throws(() => validateDocument(v5([[4, 0, hash(1), 10]])), coded('tile_key'));
  assert.throws(() => validateDocument(v5([[0, -5, hash(1), 10]])), coded('tile_key'));
  assert.throws(() => validateDocument(v5([[0, 0, hash(1).toUpperCase().replace(/0/g, 'A'), 10]])), coded('tile_sha256'));
  assert.throws(() => validateDocument(v5([[0, 0, hash(1).slice(1), 10]])), coded('tile_sha256'));
  assert.throws(() => validateDocument(v5(Array.from({ length: 257 }, (_, n) => [n % 8 - 4, Math.floor(n / 8) - 4, hash(n), 9]))),
    coded('tile_limit'));
  assert.throws(() => validateDocument(v5([[0, 0, hash(1), 65537]])), coded('tile_bytes'));
  assert.throws(() => validateDocument(v5([[0, 0, hash(1), 0]])), coded('tile_bytes'));
  assert.throws(() => validateDocument(v5([[0, 0, hash(1)]])), coded('tile_entry'));
  assert.throws(() => validateDocument(v5([], 'gm05b-material-test')), coded('unknown_domain'));
  assert.throws(() => validateDocument({ ...v5([]), terrain: { version: 1, samples: [] } }), coded('terrain_version'));
  assert.throws(() => validateDocument({ ...v5([]), terrain: { version: 3, tileSize: 64, tiles: [] } }), coded('format'));
  assert.throws(() => validateDocument({ ...v5([]), version: 4 }), coded('format'));
});

test('documents v3 and v4 parse and serialize byte-identically; a tile terrain serializes as version 5', async () => {
  for (const document of [exported, paintedV4()]) {
    const text = JSON.stringify(document);
    assert.equal(JSON.stringify(validateDocument(JSON.parse(text))), text);
    assert.equal(JSON.stringify(createDocument({ seed: document.base.seed, baseRevision: document.base.revision,
      objects: document.objects, baseOverrides: document.baseOverrides, terrain: document.terrain })), text);
  }
  const { document } = await convertDocumentToV5(paintedV4());
  const made = createDocument({ seed: document.base.seed, baseRevision: BASE, objects: document.objects,
    baseOverrides: document.baseOverrides, terrain: document.terrain });
  assert.equal(made.version, 5);
  assert.equal(JSON.stringify(made), JSON.stringify(document));
  assert.equal(JSON.stringify(validateDocument(JSON.parse(JSON.stringify(made)))), JSON.stringify(made));
});

const GM = '10000000-0000-4000-8000-000000000001';
const OPERATION = '20000000-0000-4000-8000-000000000001';
const tilesDocument = (seed = 42) => createDocument({ seed, baseRevision: BASE, terrain: { version: 3, tileSize: 70, tiles: [] } });

function draftHandler(head) {
  const calls = { validate: 0, save: 0, build: 0 };
  const store = { durable: true, async checkGmDrafts() { return { version: 1 }; },
    async loadGmDraft() { return head ?? { revision: 0, document: null, savedAt: null }; },
    async saveGmDraft() { calls.save++; throw new Error('a document v5 must not reach the store'); } };
  const publication = { async prepare() {}, async build() { calls.build++; throw new Error('a document v5 must not be built'); } };
  const handler = createGmDraftHandler({ store, resolvePlayer: async (_req, { token }) => token === 'gm' ? GM : null,
    accountIds: [GM], worldId: 'tiles-world', seed: 42, baseRevision: BASE, publication,
    validateReferences: (value) => { calls.validate++; return value; } });
  return { handler, calls };
}

async function serve(handler, run) {
  const server = http.createServer((req, res) => {
    void handler.handle(req, res, { prepareRevision: new URL(req.url, 'http://localhost').pathname === '/api/gm/prepare' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('draft HTTP save and prepare of a document v5 answer terrain_tiles_not_ready; the memory store saves it', async () => {
  const headers = { authorization: 'Bearer gm', 'content-type': 'application/json' };
  const saving = draftHandler();
  assert.equal(await saving.handler.prepare(), true);
  await serve(saving.handler, async (url) => {
    const response = await fetch(`${url}/api/gm/draft`, { method: 'PUT', headers,
      body: JSON.stringify({ operationId: OPERATION, expectedRevision: 0, document: tilesDocument() }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: TERRAIN_TILES_NOT_READY });
  });
  assert.deepEqual(saving.calls, { validate: 0, save: 0, build: 0 });

  const preparing = draftHandler({ revision: 1, document: tilesDocument(), savedAt: '2026-10-21T12:00:00.000Z' });
  assert.equal(await preparing.handler.prepare(), true);
  await serve(preparing.handler, async (url) => {
    const response = await fetch(`${url}/api/gm/prepare`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 1 }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: TERRAIN_TILES_NOT_READY });
  });
  assert.deepEqual(preparing.calls, { validate: 0, save: 0, build: 0 });

  const validate = createGmDraftValidator({ map, baseRevision: BASE, manifest: [], editorCatalog: [] });
  assert.throws(() => validate(tilesDocument(map.seed)), notReady);
  const publication = createGmPublicationService({ root: ROOT, map, baseRevision: BASE, worldId: 'tiles-world',
    validateReferences: () => { throw new Error('a document v5 must not be validated'); }, gameVersion: 'test', protocolVersion: 1 });
  await assert.rejects(publication.build({ document: tilesDocument(map.seed), draftRevision: 1 }), notReady);
  // GM07b2a: the store itself holds a document v5 now (tile references; tiles in its tile store); the draft route
  // and the validator above keep refusing it until GM07b2b.
  const store = createMemoryGmDraftMethods();
  const stored = await store.saveGmDraft({ world: 'tiles-world', owner: GM, operationId: OPERATION, expectedRevision: 0,
    document: tilesDocument() });
  assert.equal(stored.ok, true);
  assert.deepEqual(stored.head.document, tilesDocument());
});

test('player install, publication validation, world content load and the registry refuse a document v5', async () => {
  const document = tilesDocument(map.seed), active = { untouched: true };
  assert.throws(() => projectGmContent(map, document, BASE), notReady);
  assert.throws(() => installGmContent(active, map, document, BASE), notReady);
  assert.deepEqual(active, { untouched: true });
  assert.throws(() => validateGmPublication({ map, document, baseRevision: BASE }), notReady);
  const revisionId = 'a'.repeat(64);
  const body = { ok: true, generation: 1, revisionId, revision: { revisionId, version: PREPARATION_VERSION, content: { document } } };
  await assert.rejects(loadGmWorldContent({ httpBase: 'http://localhost/', map: {}, baseMap: map, gameVersion: 'test', protocolVersion: 1,
    fetchImpl: async () => ({ ok: true, json: async () => body }) }), notReady);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gm-terrain-tiles-'));
  try {
    const registry = createGmContentRegistry({ directory, root: ROOT, worldId: 'tiles-world',
      lock: { async run(callback) { return callback({ assertHeld() {} }); } } });
    await registry.prepare();
    await assert.rejects(registry.retain({ schema: PREPARATION_SCHEMA, version: 1, revisionId,
      content: { worldId: 'tiles-world', document, assets: [], baselineAssets: [], runtime: { files: [] } } }), notReady);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('object y range is [-64, 256]: y 200 validates, y 257 does not; scatter follows it', () => {
  const at = (y) => createDecoration({ id: `tall-${y}`, assetId: 'prop:storage-crate', position: { x: 0, y, z: 0 } });
  for (const y of [-64, 100.5, 200, 256]) assert.equal(at(y).transform.position.y, y);
  for (const y of [257, -64.5]) assert.throws(() => at(y), coded('position'));
  const document = createDocument({ seed: 7, baseRevision: BASE, objects: [at(200)] });
  assert.equal(validateDocument(document).objects[0].transform.position.y, 200);
  const scatter = (ground) => planScatter({ map: { half: 100, groundAt: () => ground }, document: createDocument({ seed: 7, baseRevision: BASE }),
    assetId: 'model:decorative-palm-v1', points: [{ x: 0, z: 0 }], parameters: scatterParameters({ radius: 6, strength: 1, spacing: 3, seed: 5 }),
    metrics: { triangles: 100, primitives: 2, radius: .4 }, isAllowed: () => true });
  const high = scatter(200);
  assert.ok(high.placements.length > 0);
  let n = 0;
  assert.ok(applyScatter(createDocument({ seed: 7, baseRevision: BASE }), high, () => `palm-${++n}`).document.objects.every(
    (item) => item.transform.position.y === 200));
  assert.equal(scatter(257).placements.length, 0);
});

test('whole map: every free editable vertex raised by 30 m validates, encodes and stays small', async (t) => {
  const mask = editableMask(), grid = createTerrainGrid();
  let raised = 0;
  for (let k = 0; k < mask.length; k++) if (mask[k]) { grid.deltasMm[k] = 30000; raised++; }
  const fresh = generateWorld(GAME.seed);
  let start = performance.now();
  validateTerrainGridForMap(fresh, grid);
  const coldValidation = performance.now() - start;
  start = performance.now();
  assert.equal(validateTerrainGridForMap(map, grid), grid);
  const validation = performance.now() - start;
  start = performance.now();
  const { tiles, blobs } = await gridToTiles(grid, BASE);
  const encoding = performance.now() - start;
  start = performance.now();
  const decoded = tilesToGrid({ tiles, blobs }, BASE);
  const decoding = performance.now() - start;
  assert.equal(Buffer.compare(bufferOf(decoded.deltasMm), bufferOf(grid.deltasMm)), 0);
  start = performance.now();
  const compiled = compileTerrainGrid(map, grid);
  const compiling = performance.now() - start;
  assert.equal(compiled.gmTerrain, true);
  let raw = 0, gzip = 0;
  for (const [, , hash, bytes] of tiles) {
    assert.ok(bytes <= 65536);
    assert.equal(blobs.get(hash).length, bytes);
    raw += bytes; gzip += gzipSync(blobs.get(hash)).length;
  }
  const document = createDocument({ seed: map.seed, baseRevision: BASE, terrain: { version: 3, tileSize: 70, tiles } });
  const json = Buffer.byteLength(JSON.stringify(document));
  assert.ok(json < 64 * 1024, `${json} bytes`);
  assert.ok(raised > 10000);
  t.diagnostic(`raised vertices ${raised}; tiles ${tiles.length}; tile bytes raw ${raw}, gzip ${gzip} (per tile, summed); ` +
    `document v5 JSON ${json} bytes`);
  t.diagnostic(`encode (gridToTiles, encode + sha256) ${encoding.toFixed(1)} ms; decode (tilesToGrid) ${decoding.toFixed(1)} ms; ` +
    `full validation ${validation.toFixed(1)} ms warm, ${coldValidation.toFixed(1)} ms on a fresh map; compile ${compiling.toFixed(1)} ms`);
});
