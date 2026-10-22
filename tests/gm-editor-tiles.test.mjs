// GM07b1b: the editor on tiles. Loading v2..v5 documents, strokes over the dense grid with dirty-tile validation,
// undo by tile bytes, IndexedDB version 2 with a tile store, export/import with tiles, and the "not yet" refusal of
// online prepare for a document v5 (online save: tests/gm-terrain-tiles-remote.test.mjs). Everything here runs without a DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDecoration, createDocument, createDocumentHistory, validateDocument } from '../src/editor/document.js';
import { compileTerrainMap, terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { convertDocumentToV5, gridToTiles } from '../src/editor/terrainTiles.js';
import { sculptTerrainDocument, sculptTerrainGrid } from '../src/editor/terrainSculpt.js';
import { paintTerrainDocument } from '../src/editor/terrainPaint.js';
import { TerrainSession, openTerrainDocument, tileReferences } from '../src/editor/terrainSession.js';
import { createIndexedDbDraftSource, DraftStore, DRAFT_DATABASE_VERSION, DRAFT_EXPORT_FORMAT, DRAFT_EXPORT_VERSION,
  readDraftExport, serializeDraftExport } from '../src/editor/draftStore.js';
import { RemoteDraftClient } from '../src/editor/remoteDraft.js';
import { createTemplate, instantiateTemplate, validateTemplate } from '../src/editor/templates.js';
import { WorldEditor } from '../src/editor/editor.js';
import { EditorStatus } from '../src/editor/messages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'terrain-s21-v1';
const map = generateWorld(GAME.seed);
const oldExport = await readFile(path.join(ROOT, 'docs/delivery/gm05a/local/final-visible-5/terrain-v3-export.json'), 'utf8');
const v3 = validateDocument(JSON.parse(oldExport).document);
const empty = () => createDocument({ seed: map.seed, baseRevision: BASE });
const coded = (code) => (error) => error?.code === code;
const bytesOf = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const gridBytes = (grid) => Buffer.concat([bytesOf(grid.deltasMm), bytesOf(grid.weights)]);
const tileOf = (k) => [Math.floor((k % TERRAIN_GRID_SIZE - 280) / 70), Math.floor((Math.floor(k / TERRAIN_GRID_SIZE) - 280) / 70)];

// The generated map has small editable areas (two of about 13,000 vertices). The open map keeps the generated heights,
// landmarks and resources but lifts the ground policy and drops props, routes and masks, so strokes over more than
// 20,000 vertices have room. Only the 20,000-vertex tests use it.
const openMap = { ...map, props: [], onDock: () => false, lawlessAt: () => false, pathInfo: () => null, trailInfo: () => null,
  masks: () => ({ arenaFloor: 0, lava: 0, volcanic: 0, path: 0 }), groundAt: (x, z) => Math.max(map.groundAt(x, z), 2) };

let editable;
function freeCenter(radius, skip = 0) {
  const mask = editable ??= terrainEditableMask(map);
  for (let j = radius + 2; j < 559 - radius; j++) for (let i = radius + 2; i < 559 - radius; i++) {
    let free = true;
    for (let dz = -radius - 1; dz <= radius + 1 && free; dz++) for (let dx = -radius - 1; dx <= radius + 1; dx++)
      if (!mask[(j + dz) * TERRAIN_GRID_SIZE + i + dx]) { free = false; break; }
    if (free && skip-- <= 0) return { x: i - 280, z: j - 280, k: j * TERRAIN_GRID_SIZE + i };
  }
  throw new Error('no free area');
}

let painted;
function paintedV4() {
  if (painted) return painted;
  const center = freeCenter(4, 40);
  let document = v3;
  for (const [material, strength] of [['sand', 1], ['rock', .5], ['dirt', .4]]) document = paintTerrainDocument({ map, document,
    baseRevision: BASE, points: [center, { x: center.x + 2, z: center.z + 1 }], radius: 3, strength, falloff: .5, material });
  assert.equal(document.version, 4);
  return (painted = document);
}

function session(opened, mapForSession = map) {
  const holder = {};
  holder.history = createDocumentHistory(opened.document, { tiles: opened.tiles });
  holder.terrain = new TerrainSession({ map: mapForSession, baseRevision: BASE, grid: opened.grid,
    references: tileReferences(opened.document), lookup: (sha256) => holder.history.tile(sha256) });
  return holder;
}

const raise = (document, points, options = {}) => ({ document, tool: 'raise', points, radius: 4, strength: 1, falloff: .5, ...options });

// An IndexedDB with versions, upgrades, multi-store transactions, getAll/getAllKeys/delete and atomic commit.
// Transactions of one database run one at a time.
function memoryIndexedDB() {
  const databases = new Map(), later = (fn) => setTimeout(fn, 0);
  function transaction(db, names, mode) {
    for (const name of names) if (!db.stores.has(name)) throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
    const working = new Map(names.map((name) => [name, new Map(db.stores.get(name))])), queue = [];
    let state = 'waiting', scheduled = false, release;
    const tx = { error: null, oncomplete: null, onabort: null, onerror: null, mode,
      objectStore(name) {
        const data = working.get(name);
        if (!data) throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
        const request = (op) => { const req = { result: undefined, error: null, onsuccess: null, onerror: null }; queue.push([op, req]); pump(); return req; };
        const writable = () => { if (mode !== 'readwrite') throw Object.assign(new Error('ReadOnlyError'), { name: 'ReadOnlyError' }); };
        return {
          get: (key) => request(() => structuredClone(data.get(key))),
          getAll: () => request(() => [...data.values()].map((value) => structuredClone(value))),
          getAllKeys: () => request(() => [...data.keys()]),
          put: (value, key) => { writable(); const copy = structuredClone(value); return request(() => { data.set(key, copy); return key; }); },
          delete: (key) => { writable(); return request(() => { data.delete(key); }); },
        };
      },
      abort() { finish(false); },
    };
    function pump() { if (state !== 'active' || scheduled) return; scheduled = true; later(step); }
    function step() {
      scheduled = false;
      if (state !== 'active') return;
      const item = queue.shift();
      if (!item) { finish(true); return; }
      const [op, req] = item;
      try { req.result = op(); } catch (error) { req.error = error; tx.error = error; req.onerror?.(); finish(false); return; }
      req.onsuccess?.();
      pump();
    }
    function finish(commit) {
      if (state === 'done' || state === 'aborted') return;
      state = commit ? 'done' : 'aborted';
      if (commit && mode === 'readwrite') for (const [name, data] of working) db.stores.set(name, data);
      later(() => {
        if (commit) tx.oncomplete?.();
        else { tx.error ||= Object.assign(new Error('AbortError'), { name: 'AbortError' }); tx.onabort?.(); }
        release();
      });
    }
    db.lock = db.lock.then(() => new Promise((resolve) => { release = resolve; state = 'active'; pump(); }));
    return tx;
  }
  const connection = (db) => ({
    get version() { return db.version; },
    objectStoreNames: { contains: (name) => db.stores.has(name) },
    createObjectStore(name) { if (db.stores.has(name)) throw new Error('ConstraintError'); db.stores.set(name, new Map()); return {}; },
    transaction: (names, mode = 'readonly') => transaction(db, [].concat(names), mode),
    close() {},
  });
  return {
    databases,
    open(name, version) {
      const request = { result: null, error: null, transaction: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        if (!databases.has(name)) databases.set(name, { version: 0, stores: new Map(), lock: Promise.resolve() });
        const db = databases.get(name), requested = version ?? Math.max(1, db.version);
        if (requested < db.version) { request.error = Object.assign(new Error('VersionError'), { name: 'VersionError' }); request.onerror?.(); return; }
        request.result = connection(db);
        if (requested > db.version) {
          const oldVersion = db.version;
          db.version = requested; request.transaction = { mode: 'versionchange' };
          request.onupgradeneeded?.({ oldVersion, newVersion: requested });
          request.transaction = null;
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
}

const done = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const committed = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
async function rawDatabase(indexedDB, name = 'marea-gm-drafts-v1') { return done(indexedDB.open(name)); }
async function storedTileKeys(indexedDB, name = 'marea-gm-drafts-v1') {
  const db = await rawDatabase(indexedDB, name), tx = db.transaction('tiles', 'readonly');
  return (await done(tx.objectStore('tiles').getAllKeys())).sort();
}

// --- Load ---

test('a v3 document loads as v5 with bit-identical compiled heights', async () => {
  assert.equal(v3.version, 3);
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: v3 });
  assert.equal(opened.converted, true);
  assert.equal(opened.document.version, 5);
  assert.deepEqual(opened.document.objects, v3.objects);
  const { terrain } = session(opened);
  const before = compileTerrainMap(map, v3.terrain), after = terrain.surface();
  assert.equal(Buffer.compare(bytesOf(after.heights), bytesOf(before.heights)), 0, 'bit-identical heights');
  for (const [index] of v3.terrain.samples.slice(0, 64)) {
    const x = index % TERRAIN_GRID_SIZE - 280 + .3, z = Math.floor(index / TERRAIN_GRID_SIZE) - 280 + .6;
    assert.equal(after.groundAt(x, z), before.groundAt(x, z));
  }
  assert.deepEqual(opened.document.terrain.tiles, (await gridToTiles(opened.grid, BASE)).tiles);
});

test('a v4 document loads as v5 with bit-identical heights and the same paint weights', async () => {
  const v4 = paintedV4();
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: v4 });
  assert.equal(opened.document.version, 5);
  const before = compileTerrainMap(map, v4.terrain), after = session(opened).terrain.surface();
  assert.equal(Buffer.compare(bytesOf(after.heights), bytesOf(before.heights)), 0);
  for (const [index, ...weights] of v4.terrain.materials) {
    assert.deepEqual([...opened.grid.weights.subarray(index * 4, index * 4 + 4)], weights);
    const x = index % TERRAIN_GRID_SIZE - 280 + .25, z = Math.floor(index / TERRAIN_GRID_SIZE) - 280 + .5;
    assert.deepEqual(after.materialWeightsAt(x, z), before.materialWeightsAt(x, z));
    assert.equal(after.materialAt(x, z), before.materialAt(x, z));
  }
});

test('a v2 document stays v2 until a terrain edit, which makes it v5', async () => {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: empty() });
  assert.equal(opened.document.version, 2);
  assert.equal(Object.hasOwn(opened.document, 'terrain'), false);
  const { history, terrain } = session(opened);
  assert.strictEqual(terrain.surface(), map, 'no tiles: the base map itself');
  const crate = createDecoration({ id: 'crate', assetId: 'prop:storage-crate', position: { x: 4, y: 2, z: 3 } });
  history.commit({ ...history.current(), objects: [crate] });
  assert.equal(history.current().version, 2, 'an object edit keeps v2');
  const center = freeCenter(4);
  const noop = await terrain.commit({ ...raise(history.current(), [center]), tool: 'erase' });
  assert.equal(noop.document.version, 2, 'a stroke that changes no vertex keeps v2');
  const result = await terrain.commit(raise(history.current(), [center]));
  assert.equal(result.document.version, 5);
  assert.deepEqual(result.document.objects, [crate]);
  history.commit(result.document, { tiles: result.tiles });
  assert.equal(history.current().version, 5);
  assert.ok(history.current().terrain.tiles.length >= 1);
});

test('a document v5 without its tiles, or with a tampered tile, is refused with a code', async () => {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: v3 });
  await assert.rejects(openTerrainDocument({ map, baseRevision: BASE, document: opened.document }), coded('tile_missing'));
  const [, , sha256] = opened.document.terrain.tiles[0];
  const tampered = new Map(opened.tiles), bytes = opened.tiles.get(sha256).slice();
  bytes[40] ^= 1; tampered.set(sha256, bytes);
  await assert.rejects(openTerrainDocument({ map, baseRevision: BASE, document: opened.document, tiles: tampered }), coded('tile_hash'));
  // The editor wiring: the refusal throws before any history or session changes.
  const editor = Object.assign(Object.create(WorldEditor.prototype), { map, baseRevision: BASE, history: 'previous', terrain: 'previous' });
  await assert.rejects(editor._openTerrain(opened.document, new Map()), coded('tile_missing'));
  assert.equal(editor.history, 'previous');
  assert.equal(editor.terrain, 'previous');
});

// --- Strokes ---

test('flatten raises ground 150 m above base where allowed (beyond the old 12 m); above +200 m is refused', async (t) => {
  const center = freeCenter(4, 3), base = map.heights[center.k];
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: empty() });
  const { history, terrain } = session(opened);
  const tall = { ...raise(history.current(), [center]), tool: 'flatten', level: base + 150 };
  assert.throws(() => sculptTerrainDocument({ map, baseRevision: BASE, ...tall }), coded('delta_limit'), 'the v3 path keeps its 12 m cap');
  const result = await terrain.commit(tall);
  history.commit(result.document, { tiles: result.tiles });
  assert.equal(terrain.grid.deltasMm[center.k], Math.round((Math.fround(base + 150) - base) * 1000));
  assert.ok(terrain.grid.deltasMm[center.k] > 12000 * 12);
  assert.equal(result.map.heights[center.k], Math.fround(base + 150));
  assert.equal(result.map.groundAt(center.x, center.z), result.map.heights[center.k]);
  t.diagnostic(`flatten r4 to ${(base + 150).toFixed(2)} m: stroke ${result.timings.stroke.toFixed(1)} ms, validate ${result.timings.validate.toFixed(1)} ms, ` +
    `compile ${result.timings.compile.toFixed(1)} ms, encode ${result.timings.encode.toFixed(1)} ms, hash ${result.timings.hash.toFixed(1)} ms`);

  const top = await terrain.commit({ ...tall, document: history.current(), level: 199.9 });
  history.commit(top.document, { tiles: top.tiles });
  assert.ok(Math.abs(top.map.heights[center.k] - 199.9) < 1e-4);
  const grid = gridBytes(terrain.grid), references = structuredClone(terrain.references), surface = terrain.surface();
  const over = raise(history.current(), [center], { strength: 1 });
  assert.throws(() => terrain.preview(over), coded('height_range'));
  await assert.rejects(terrain.commit(over), coded('height_range'));
  assert.equal(Buffer.compare(gridBytes(terrain.grid), grid), 0, 'the refused stroke leaves the grid byte-identical');
  assert.deepEqual(terrain.references, references);
  assert.strictEqual(terrain.surface(), surface);
  assert.throws(() => sculptTerrainGrid({ map, surface, grid: terrain.grid, baseRevision: BASE, ...tall, document: history.current(), level: 200.01 }),
    coded('parameters'));
  assert.throws(() => sculptTerrainGrid({ map, surface, grid: terrain.grid, baseRevision: BASE, ...tall, document: history.current(), level: .7 }),
    coded('parameters'));
});

test('a refused stroke leaves the grid byte-identical: protected places and the outer ring', async () => {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: paintedV4() });
  const { history, terrain } = session(opened);
  const grid = gridBytes(terrain.grid), references = structuredClone(terrain.references);
  const spawn = map.landmarks.spawn;
  for (const edit of [raise(history.current(), [spawn]), { ...raise(history.current(), [spawn]), tool: 'paint', material: 'rock' },
    raise(history.current(), [{ x: -279.5, z: 0 }], { radius: 3 })]) {
    let code;
    try { await terrain.commit(edit); } catch (error) { code = error.code; }
    assert.ok(['protected_ground', 'protected_route', 'protected_area'].includes(code), `${edit.tool}: ${code}`);
    assert.throws(() => terrain.preview(edit), (error) => error.code === code);
    assert.equal(Buffer.compare(gridBytes(terrain.grid), grid), 0, 'byte-identical grid');
    assert.deepEqual(terrain.references, references);
  }
  assert.throws(() => sculptTerrainDocument({ map, baseRevision: BASE, ...raise(paintedV4(), [spawn]) }),
    (error) => ['protected_ground', 'protected_route', 'protected_area'].includes(error.code), 'the v3/v4 path refuses it too');
});

test('grid strokes keep the stroke semantics of the v3/v4 path (same tiles after conversion)', async () => {
  const center = freeCenter(7, 20), v4 = paintedV4();
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: v4 });
  const edits = [
    { tool: 'raise', points: [center, { x: center.x + 3, z: center.z + 2 }], radius: 3, strength: .6, falloff: .3 },
    { tool: 'smooth', points: [center], radius: 4, strength: .8, falloff: .5 },
    { tool: 'flatten', points: [center], radius: 3, strength: .5, falloff: .5, level: 6.5, shape: 'square', rotation: 30 },
    { tool: 'ramp', points: [{ x: center.x - 3, z: center.z }, { x: center.x + 3, z: center.z + 1 }], radius: 2, falloff: .4 },
    { tool: 'paint', points: [center, { x: center.x + 2, z: center.z }], radius: 3, strength: .7, falloff: .5, material: 'dirt', shape: 'ellipse', aspect: .5, rotation: 45 },
    { tool: 'erase', points: [center], radius: 2, strength: .5, falloff: .5 },
  ];
  let legacy = v4, document = opened.document;
  const { history, terrain } = session(opened);
  for (const edit of edits) {
    legacy = ['paint', 'erase'].includes(edit.tool) ? paintTerrainDocument({ map, document: legacy, baseRevision: BASE, ...edit })
      : sculptTerrainDocument({ map, document: legacy, baseRevision: BASE, ...edit });
    const result = await terrain.commit({ document, ...edit });
    history.commit(result.document, { tiles: result.tiles });
    document = history.current();
    const expected = await convertDocumentToV5(legacy);
    assert.deepEqual(document, expected.document, `${edit.tool}: same document v5 (tiles, objects, base overrides)`);
    assert.deepEqual(document.terrain.tiles, (await gridToTiles(terrain.grid, BASE)).tiles, 'incremental tiles equal a full encode');
  }
});

test('one sculpt stroke changes more than 20,000 vertices, touching only its dirty tiles', async (t) => {
  const opened = await openTerrainDocument({ map: openMap, baseRevision: BASE, document: empty() });
  const { history, terrain } = session(opened, openMap);
  const points = [{ x: 100, z: -250 }, { x: 250, z: -250 }, { x: 250, z: -210 }, { x: 100, z: -210 }, { x: 100, z: -170 },
    { x: 250, z: -170 }, { x: 250, z: -130 }, { x: 100, z: -130 }];
  const result = await terrain.commit({ document: history.current(), tool: 'raise', points, radius: 24, strength: 1, falloff: .5 });
  history.commit(result.document, { tiles: result.tiles });
  let changed = 0;
  const touched = new Set();
  for (let k = 0; k < terrain.grid.deltasMm.length; k++) if (terrain.grid.deltasMm[k] !== 0) { changed++; touched.add(tileOf(k).join(',')); }
  assert.ok(changed > 20000, `${changed} vertices`);
  assert.deepEqual([...touched].sort(), [...result.dirtyTiles].sort());
  assert.deepEqual(history.current().terrain.tiles, (await gridToTiles(terrain.grid, BASE)).tiles);
  t.diagnostic(`${changed} vertices in ${result.dirtyTiles.length} tiles: stroke ${result.timings.stroke.toFixed(1)} ms, validate ` +
    `${result.timings.validate.toFixed(1)} ms, compile ${result.timings.compile.toFixed(1)} ms, encode ${result.timings.encode.toFixed(1)} ms, ` +
    `hash ${result.timings.hash.toFixed(1)} ms`);
});

test('one paint stroke covers more than 20,000 vertices', async () => {
  const opened = await openTerrainDocument({ map: openMap, baseRevision: BASE, document: empty() });
  const { history, terrain } = session(opened, openMap);
  const points = [{ x: 100, z: -250 }, { x: 250, z: -250 }, { x: 250, z: -205 }, { x: 100, z: -205 }, { x: 100, z: -160 },
    { x: 250, z: -160 }, { x: 250, z: -120 }, { x: 100, z: -120 }];
  const result = await terrain.commit({ document: history.current(), tool: 'paint', material: 'sand', points, radius: 24, strength: 1, falloff: .5 });
  history.commit(result.document, { tiles: result.tiles });
  let paintedVertices = 0;
  for (let k = 0; k < TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE; k++) if (terrain.grid.weights[k * 4 + 2] !== 0) paintedVertices++;
  assert.ok(paintedVertices > 20000, `${paintedVertices} vertices`);
  assert.equal(history.current().version, 5);
  assert.ok(terrain.surface().materialAt(175, -190) === 'sand');
});

test('a 24 m stroke commits by dirty tiles; commits are serialized', async (t) => {
  const opened = await openTerrainDocument({ map: openMap, baseRevision: BASE, document: empty() });
  const { history, terrain } = session(opened, openMap);
  const edit = { document: history.current(), tool: 'raise', points: [{ x: 175, z: -175 }], radius: 24, strength: 1, falloff: .5 };
  const pending = terrain.commit(edit);
  assert.throws(() => terrain.preview(edit), coded('busy'));
  await assert.rejects(terrain.commit(edit), coded('busy'));
  const result = await pending;
  history.commit(result.document, { tiles: result.tiles });
  assert.ok(result.dirtyTiles.length >= 1 && result.dirtyTiles.length <= 4);
  const timings = [];
  for (let n = 0; n < 5; n++) {
    const next = await terrain.commit({ ...edit, document: history.current(), points: [{ x: 175 + n * 3, z: -175 }], strength: .2 });
    history.commit(next.document, { tiles: next.tiles });
    timings.push(next.timings);
  }
  const median = (key) => timings.map((row) => row[key]).sort((a, b) => a - b)[2];
  t.diagnostic(`24 m raise commit (median of 5): validate ${median('validate').toFixed(2)} ms, encode ${median('encode').toFixed(2)} ms, ` +
    `hash ${median('hash').toFixed(2)} ms, compile ${median('compile').toFixed(2)} ms, stroke ${median('stroke').toFixed(2)} ms`);
});

// --- Undo ---

test('undo and redo restore the exact tile hashes and grid bytes', async (t) => {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: v3 });
  const { history, terrain } = session(opened);
  const center = freeCenter(4, 10);
  const states = [{ document: history.current(), grid: gridBytes(terrain.grid), heights: Buffer.from(bytesOf(terrain.surface().heights)) }];
  for (const edit of [raise(null, [center], { strength: .8 }), { tool: 'paint', points: [center], radius: 4, strength: 1, falloff: .5, material: 'rock' },
    { tool: 'lower', points: [{ x: center.x + 2, z: center.z }], radius: 3, strength: .3, falloff: .5 }]) {
    const result = await terrain.commit({ ...edit, document: history.current() });
    history.commit(result.document, { tiles: result.tiles });
    states.push({ document: history.current(), grid: gridBytes(terrain.grid), heights: Buffer.from(bytesOf(terrain.surface().heights)) });
  }
  const check = async (state) => {
    const document = history.current();
    const start = performance.now();
    const surface = terrain.surfaceFor(document);
    const ms = performance.now() - start;
    assert.deepEqual(document, state.document);
    assert.equal(Buffer.compare(gridBytes(terrain.grid), state.grid), 0, 'grid bytes');
    assert.equal(Buffer.compare(bytesOf(surface.heights), state.heights), 0, 'compiled heights');
    assert.deepEqual(document.terrain.tiles, (await gridToTiles(terrain.grid, BASE)).tiles, 'exact tile hashes');
    return ms;
  };
  const undo = [];
  for (let n = states.length - 2; n >= 0; n--) { history.undo(); undo.push(await check(states[n])); }
  assert.equal(history.canUndo(), false);
  for (let n = 1; n < states.length; n++) { history.redo(); await check(states[n]); }
  assert.equal(history.canRedo(), false);
  t.diagnostic(`undo (sync changed tiles + compile): ${undo.map((ms) => ms.toFixed(1)).join(', ')} ms`);
});

test('the history byte budget drops the oldest entries and releases their tiles', async () => {
  const opened = await openTerrainDocument({ map: openMap, baseRevision: BASE, document: empty() });
  const holder = {};
  holder.terrain = new TerrainSession({ map: openMap, baseRevision: BASE, grid: opened.grid, lookup: (sha256) => holder.history.tile(sha256) });
  // Five strokes, each inside a tile of its own; each snapshot below references only its stroke's tile.
  const centers = [[100, -250], [175, -250], [250, -250], [100, -180], [175, -180]], singles = [];
  let document = opened.document;
  for (const [x, z] of centers) {
    const result = await holder.terrain.commit({ document, tool: 'raise', points: [{ x, z }], radius: 4, strength: 1, falloff: .5 });
    document = result.document;
    assert.equal(result.tiles.size, 1);
    const [sha256, bytes] = [...result.tiles][0];
    const reference = document.terrain.tiles.find((entry) => entry[2] === sha256);
    singles.push({ document: { ...document, terrain: { ...document.terrain, tiles: [reference] } }, tiles: result.tiles, sha256, bytes: bytes.length });
  }
  const budget = Math.floor(singles[0].bytes * 2.5);
  holder.history = createDocumentHistory(opened.document, { tiles: opened.tiles, tileBytes: budget });
  for (const single of singles) holder.history.commit(single.document, { tiles: single.tiles });
  assert.ok(holder.history.tileBytes() <= budget, `${holder.history.tileBytes()} <= ${budget}`);
  assert.equal(holder.history.entryCount(), 2, 'the oldest entries were dropped');
  for (const single of singles.slice(0, 3)) assert.equal(holder.history.tile(single.sha256), undefined, 'their tiles are released');
  for (const single of singles.slice(3)) assert.ok(holder.history.tile(single.sha256) instanceof Uint8Array);
  assert.deepEqual(holder.history.current(), singles[4].document);
  assert.deepEqual(holder.history.undo(), singles[3].document);
  assert.equal(holder.history.canUndo(), false);
  holder.terrain.surfaceFor(holder.history.current());
  assert.deepEqual((await gridToTiles(holder.terrain.grid, BASE)).tiles, singles[3].document.terrain.tiles, 'grid restored from the held tile');
  // A retained (saved) document keeps its tiles while history moves on.
  const keep = createDocumentHistory(opened.document, { tiles: opened.tiles, tileBytes: 1 });
  keep.commit(singles[0].document, { tiles: singles[0].tiles });
  keep.retain(singles[0].document);
  keep.commit(singles[1].document, { tiles: singles[1].tiles });
  assert.equal(keep.entryCount(), 1);
  assert.ok(keep.tile(singles[0].sha256) instanceof Uint8Array, 'saved tiles stay');
  keep.retain(singles[1].document);
  assert.equal(keep.tile(singles[0].sha256), undefined);
  assert.throws(() => keep.commit(singles[3].document), coded('tile_missing'));
  assert.deepEqual(keep.current(), singles[1].document, 'a commit without its tiles changes nothing');
});

// --- IndexedDB ---

test('IndexedDB upgrade from a version 1 database keeps its records and adds tiles', async () => {
  const indexedDB = memoryIndexedDB(), name = 'marea-gm-drafts-v1';
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts');
  const v1 = await done(request);
  const records = { 'draft:old-world': { revision: 4, document: v3 }, 'recovery:old-world': { revision: 2, tombstone: true },
    'remote-pending:tab': { revision: 3, operation: null }, 'content-pending:tab': { revision: 1, operation: null } };
  const write = v1.transaction('drafts', 'readwrite');
  for (const [key, value] of Object.entries(records)) write.objectStore('drafts').put(value, key);
  await committed(write);
  assert.equal(indexedDB.databases.get(name).version, 1);

  const source = createIndexedDbDraftSource({ indexedDB, databaseName: name });
  for (const [key, value] of Object.entries(records)) assert.equal(JSON.stringify(await source.read(key)), JSON.stringify(value));
  const db = indexedDB.databases.get(name);
  assert.equal(db.version, DRAFT_DATABASE_VERSION);
  assert.equal(DRAFT_DATABASE_VERSION, 2);
  assert.deepEqual([...db.stores.keys()].sort(), ['drafts', 'tiles']);
  assert.equal(db.stores.get('tiles').size, 0);
  const store = new DraftStore({ worldId: 'old-world', source });
  const loaded = await store.load();
  assert.deepEqual(loaded, { revision: 4, document: v3 }, 'a v3 record loads as stored');
  assert.equal((await source.read('draft:old-world')).document.version, 3, 'not rewritten on load');
  assert.equal((await openTerrainDocument({ map, baseRevision: BASE, document: loaded.document })).document.version, 5);
});

test('save stores the referenced tiles in one transaction and drops tiles no record references', async () => {
  const indexedDB = memoryIndexedDB(), source = createIndexedDbDraftSource({ indexedDB });
  const store = new DraftStore({ worldId: 'tiles-world', source });
  const { history, terrain } = session(await openTerrainDocument({ map, baseRevision: BASE, document: empty() }));
  const center = freeCenter(7, 30);
  const firstStroke = await terrain.commit(raise(history.current(), [center]));
  history.commit(firstStroke.document, { tiles: firstStroke.tiles });
  const opened = { document: history.current(), tiles: history.tilesOf() };
  const first = await store.save(opened.document, { expectedRevision: 0, tiles: opened.tiles });
  assert.equal(first.revision, 1);
  assert.deepEqual(await storedTileKeys(indexedDB), [...opened.tiles.keys()].sort());
  const stroke = await terrain.commit(raise(history.current(), [{ x: center.x + 2, z: center.z }], { strength: .5 }));
  history.commit(stroke.document, { tiles: stroke.tiles });
  const dropped = opened.document.terrain.tiles.filter((ref) => !stroke.document.terrain.tiles.some((other) => other[2] === ref[2])).map((ref) => ref[2]);
  assert.ok(dropped.length >= 1, 'the stroke replaced at least one tile');
  await assert.rejects(store.save(stroke.document, { expectedRevision: 1 }), coded('document_tile_missing'));
  // A recovery record referencing the old tiles keeps them alive.
  await store.saveRecovery(opened.document, { expectedRevision: 1, tiles: opened.tiles });
  const second = await store.save(stroke.document, { expectedRevision: 1, tiles: history.tilesOf(stroke.document) });
  assert.equal(second.revision, 2);
  const held = new Set([...stroke.document.terrain.tiles, ...opened.document.terrain.tiles].map((ref) => ref[2]));
  assert.deepEqual(await storedTileKeys(indexedDB), [...held].sort());
  await store.clearRecovery({ expectedRevision: 1 });
  await store.save(stroke.document, { expectedRevision: 2, tiles: history.tilesOf(stroke.document) });
  assert.deepEqual(await storedTileKeys(indexedDB), stroke.document.terrain.tiles.map((ref) => ref[2]).sort(), 'unreferenced tiles dropped');
  for (const sha256 of dropped) assert.equal((await storedTileKeys(indexedDB)).includes(sha256), false);
  const loaded = await store.load();
  assert.deepEqual(loaded.document, stroke.document);
  assert.deepEqual([...loaded.tiles.keys()].sort(), stroke.document.terrain.tiles.map((ref) => ref[2]).sort());
  // Back to a document without terrain: every tile goes.
  await store.save(empty(), { expectedRevision: 3 });
  assert.deepEqual(await storedTileKeys(indexedDB), []);
});

test('load verifies the tiles and refuses a missing or tampered tile with its code', async () => {
  const indexedDB = memoryIndexedDB(), source = createIndexedDbDraftSource({ indexedDB });
  const store = new DraftStore({ worldId: 'verify-world', source });
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: paintedV4() });
  await store.save(opened.document, { expectedRevision: 0, tiles: opened.tiles });
  const loaded = await store.load();
  assert.equal(loaded.revision, 1);
  assert.deepEqual(loaded.document, opened.document);
  for (const [sha256, bytes] of opened.tiles) assert.equal(Buffer.compare(Buffer.from(loaded.tiles.get(sha256)), Buffer.from(bytes)), 0);
  const [, , victim] = opened.document.terrain.tiles[0];
  const db = await rawDatabase(indexedDB);
  const tamper = db.transaction('tiles', 'readwrite');
  const bytes = opened.tiles.get(victim).slice(); bytes[100] ^= 4;
  tamper.objectStore('tiles').put(bytes, victim);
  await committed(tamper);
  await assert.rejects(store.load(), coded('stored_tile_invalid'));
  const remove = db.transaction('tiles', 'readwrite');
  remove.objectStore('tiles').delete(victim);
  await committed(remove);
  await assert.rejects(store.load(), coded('stored_tile_missing'));
  await store.saveRecovery(opened.document, { expectedRevision: 1, tiles: opened.tiles });
  assert.ok((await store.loadRecovery()).tiles.has(victim), 'a recovery save restores the tile it references');
  assert.deepEqual((await store.load()).document, opened.document);
});

// --- Export and import ---

test('export and import round trip of a document v5 with its tiles; missing, extra or bad tiles are refused', async () => {
  const indexedDB = memoryIndexedDB(), source = createIndexedDbDraftSource({ indexedDB });
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: paintedV4() });
  const first = new DraftStore({ worldId: 'export-a', source }), second = new DraftStore({ worldId: 'export-b', source });
  await first.save(opened.document, { expectedRevision: 0, tiles: opened.tiles });
  const serialized = await first.export(), envelope = JSON.parse(serialized);
  assert.deepEqual(Object.keys(envelope), ['format', 'version', 'document', 'tiles']);
  assert.equal(envelope.format, DRAFT_EXPORT_FORMAT);
  assert.equal(envelope.version, DRAFT_EXPORT_VERSION);
  assert.equal(DRAFT_EXPORT_VERSION, 2);
  assert.deepEqual(Object.keys(envelope.tiles), opened.document.terrain.tiles.map((ref) => ref[2]));
  for (const [sha256, text] of Object.entries(envelope.tiles)) assert.equal(text, Buffer.from(opened.tiles.get(sha256)).toString('base64'));
  assert.equal(serializeDraftExport(opened.document, opened.tiles), serialized, 'the editor and the store write the same envelope');
  const imported = await second.import(serialized, { expectedRevision: 0 });
  assert.deepEqual(imported.document, opened.document);
  for (const [sha256, bytes] of opened.tiles) assert.equal(Buffer.compare(Buffer.from(imported.tiles.get(sha256)), Buffer.from(bytes)), 0);
  assert.deepEqual((await second.load()).document, opened.document);

  const target = new DraftStore({ worldId: 'export-c', source });
  const variant = (change) => { const copy = structuredClone(envelope); change(copy); return JSON.stringify(copy); };
  const [, , sha256] = opened.document.terrain.tiles[0];
  const flipped = Buffer.from(envelope.tiles[sha256], 'base64'); flipped[64] ^= 8;
  const refusals = [
    ['import_tile_missing', variant((copy) => { delete copy.tiles[sha256]; })],
    ['import_tile_extra', variant((copy) => { copy.tiles['0'.repeat(64)] = envelope.tiles[sha256]; })],
    ['import_tile_invalid', variant((copy) => { copy.tiles[sha256] = flipped.toString('base64'); })],
    ['import_tile_invalid', variant((copy) => { copy.tiles[sha256] = envelope.tiles[sha256].slice(0, -4); })],
    ['import_tile_invalid', variant((copy) => { copy.tiles[sha256] = ' ' + envelope.tiles[sha256]; })],
    ['import_format', variant((copy) => { delete copy.tiles; })],
    ['import_format', variant((copy) => { delete copy.tiles; copy.version = 1; })],
  ];
  for (const [code, text] of refusals) await assert.rejects(target.import(text, { expectedRevision: 0 }), coded(code), code);
  assert.deepEqual(await target.load(), { revision: 0, document: null }, 'a refused import stores nothing');
});

test('old exports (version 1) of v3 and v4 documents still import, and open converted', async () => {
  const indexedDB = memoryIndexedDB(), source = createIndexedDbDraftSource({ indexedDB });
  const legacyV4 = JSON.stringify({ format: DRAFT_EXPORT_FORMAT, version: 1, document: paintedV4() });
  for (const [label, serialized, expected] of [['v3', oldExport, v3], ['v4', legacyV4, paintedV4()]]) {
    const parsed = await readDraftExport(serialized);
    assert.deepEqual(parsed.document, expected);
    assert.equal(parsed.tiles.size, 0);
    const store = new DraftStore({ worldId: `legacy-${label}`, source });
    const saved = await store.import(serialized, { expectedRevision: 0 });
    assert.deepEqual(saved, { revision: 1, document: expected }, `${label} is stored as imported`);
    const opened = await openTerrainDocument({ map, baseRevision: BASE, document: saved.document });
    assert.equal(opened.document.version, 5);
    assert.equal(Buffer.compare(bytesOf(session(opened).terrain.surface().heights), bytesOf(compileTerrainMap(map, expected.terrain).heights)), 0);
  }
});

test('the editor refuses an import with a missing tile and keeps its current draft', async () => {
  const opened = await openTerrainDocument({ map, baseRevision: BASE, document: paintedV4() });
  const envelope = JSON.parse(serializeDraftExport(opened.document, opened.tiles));
  delete envelope.tiles[opened.document.terrain.tiles[0][2]];
  const serialized = JSON.stringify(envelope);
  const store = new DraftStore({ worldId: 'editor-import', source: createIndexedDbDraftSource({ indexedDB: memoryIndexedDB() }) });
  const history = createDocumentHistory(v3);
  const editor = Object.assign(Object.create(WorldEditor.prototype), { map, baseRevision: BASE, active: true, session: 1, store,
    history, revision: 0, lang: 'en', status: new EditorStatus(null, 'en'), importInput: { value: 'x' } });
  await editor._importFileForSession({ size: serialized.length, text: async () => serialized }, 1);
  assert.strictEqual(editor.history, history);
  assert.deepEqual(editor.history.current(), v3);
  assert.equal(editor.lastError.code, 'import_tile_missing');
  assert.equal(editor.status.kind, 'error');
  assert.match(editor.status.message.en, /lacks a terrain tile/);
  assert.match(editor.status.message.es, /bloque de terreno/);
  assert.deepEqual(await store.load(), { revision: 0, document: null });
});

// --- Online: prepare (GM07b2c) ---

test('online prepare of a document v5 is sent (GM07b2c) while a save without its tiles refuses before any request', async () => {
  const GM = '10000000-0000-4000-8000-000000000001';
  let requests = 0;
  const source = { value: null, async read() { return structuredClone(this.value); },
    async compareAndSwap(_key, expected, next) { if ((this.value?.revision ?? 0) !== expected) return false; this.value = structuredClone(next); return true; } };
  const client = new RemoteDraftClient({ auth: { state: { signedIn: true, accountId: GM },
    async sessionIdentity() { return { accountId: GM, token: 'token' }; } }, accountId: GM, httpBase: 'https://game.invalid/',
  localScope: 'tab', source, fetchImpl: async () => { requests++; throw new Error('no request expected'); } });
  const { document } = await openTerrainDocument({ map, baseRevision: BASE, document: v3 });
  client.scope = { worldId: 'marea-negra', seed: map.seed, baseRevision: BASE };
  // GM07b2b: a v5 is saved online with every tile it references; without them nothing is sent or recorded.
  await assert.rejects(client.save(document, 0), coded('local_tile_missing'));
  assert.equal(requests, 0);
  assert.equal(source.value, null, 'no pending attempt is recorded');
  // The server reads the tiles of a v5 head from its draft store: the client sends the prepare (here it fails).
  await assert.rejects(client.prepareRevision(1, document), coded('unavailable'));
  assert.equal(requests, 1);
});

// --- Object range ---

test('object y 256 is accepted in documents and by the editor clamp; template relative y 320 is accepted', () => {
  const low = createDecoration({ id: 'low', assetId: 'prop:storage-crate', position: { x: 4, y: -64, z: 3 } });
  const high = createDecoration({ id: 'high', assetId: 'prop:storage-crate', position: { x: 4, y: 256, z: 5 } });
  const document = createDocument({ seed: map.seed, baseRevision: BASE, objects: [low, high] });
  assert.equal(validateDocument(document).objects[1].transform.position.y, 256);
  const editor = Object.assign(Object.create(WorldEditor.prototype), { snapEnabled: false, map, draftMap: { groundAt: () => 300 } });
  assert.equal(editor._placementPoint({ x: 1, z: 2 }).y, 256);
  editor.draftMap = { groundAt: () => -90 };
  assert.equal(editor._placementPoint({ x: 1, z: 2 }).y, -64);
  const template = createTemplate({ id: 'tall', name: 'Tall', document,
    items: document.objects.map((item) => ({ ...item, base: false, hidden: false })) });
  assert.deepEqual(template.objects.map((item) => item.transform.position.y), [0, 320]);
  assert.deepEqual(validateTemplate(template), template);
  const placed = instantiateTemplate(createDocument({ seed: map.seed, baseRevision: BASE }), template,
    { position: { x: 0, y: -64, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, (() => { let n = 0; return () => `t-${++n}`; })());
  assert.deepEqual(placed.document.objects.map((item) => item.transform.position.y), [-64, 256]);
  const over = structuredClone(template); over.objects[1].transform.position.y = 320.5;
  assert.throws(() => validateTemplate(over), coded('template_transform'));
});
