// GM07b2c (docs/briefs/gm07b2-server.md S6, S7, S8, S11): a document v5 (terrain tiles) is prepared from the tiles
// the draft store holds (read once), its content.terrain names the tiles and hashes the compiled bytes, the content
// registry retains the tile blobs, activation and boot install the compiled map after the burial check, and the
// updater check rebuilds an active v5 revision from the registry directory alone. v3/v4 revisions keep their rule.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { createDecoration, createDocument, validateDocument } from '../src/editor/document.js';
import { canScatterAt, compileTerrainMap, createTerrainGrid, terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { compileTerrainTiles, convertDocumentToV5, encodeTile, gridToTiles, TILE_VERTICES } from '../src/editor/terrainTiles.js';
import { paintTerrainDocument } from '../src/editor/terrainPaint.js';
import { installGmContent } from '../src/editor/contentProjection.js';
import { canonicalJson, derivedContentHashes, PREPARATION_VERSION } from '../src/editor/publicationArtifact.js';
import { resourceLayout } from '../src/data/resources.js';
import { createGmDraftHandler } from '../server/gmDraftHttp.mjs';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';
import { createMemoryGmDraftMethods } from '../server/gmDraftStore.mjs';
import { createGmContentRegistry } from '../server/gmContentRegistry.mjs';
import { createGmContentService } from '../server/gmContent.mjs';
import { checkGmContentRelease } from '../server/gmContentCheck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'terrain-s21-v1', WORLD = 'tiles-publication-world';
const GM = '10000000-0000-4000-8000-000000000001';
const LOCK = { async run(callback) { return callback({ assertHeld() {} }); } };
const BUDGET = 1024 * 1024 * 1024;
const map = generateWorld(GAME.seed);
const exported = JSON.parse(await readFile(path.join(ROOT,
  'docs/delivery/gm05a/local/final-visible-5/terrain-v3-export.json'), 'utf8')).document;
const validateReferences = createGmDraftValidator({ map, baseRevision: BASE,
  manifest: JSON.parse(await readFile(path.join(ROOT, 'assets/manifest.json'), 'utf8')),
  editorCatalog: JSON.parse(await readFile(path.join(ROOT, 'assets/editor/catalog.json'), 'utf8')) });
const publication = createGmPublicationService({ root: ROOT, map, baseRevision: BASE, worldId: WORLD, validateReferences,
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
await publication.prepare();

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonSha = (value) => sha(Buffer.from(canonicalJson(value)));
const bufferOf = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const vertex = (x, z) => (z + 280) * TERRAIN_GRID_SIZE + x + 280;
const operation = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S7_KEYS = ['format', 'heightsSha256', 'materialsSha256', 'tileSize', 'tiles', 'version'];

// Built by 272d389 (before GM07b2c) from the same two documents: the v3/v4 terrain hash rule and document hash.
const PINNED = Object.freeze({
  v3: { documentHash: 'bab8fb54e8576eace4e9f475ce39f0408ff477536e1e77e9ec16250b116a7a6c',
    terrain: { gridSize: 561, sha256: 'ca730c5a51b45957b1b5fdeeed5ef9420963dd9788a5d750d27b02ab1d0a62cb' } },
  v4: { documentHash: '3ffa40c35cdef2949f64556e65361ccc9162a9ba0d06e8ed640066dc0e110468',
    terrain: { gridSize: 561, sha256: 'ca730c5a51b45957b1b5fdeeed5ef9420963dd9788a5d750d27b02ab1d0a62cb',
      materialsSha256: '0ae378bf703468d1195b582a82ceefbe8b843600d520060c8711078b4207f85c' } },
});

// S7 recomputed here, independently of the build: each height as a float32 written little-endian through a DataView.
function float32LeSha(values) {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  for (let k = 0; k < values.length; k++) view.setFloat32(k * 4, values[k], true);
  return sha(new Uint8Array(view.buffer));
}

function paintWeights(terrain) {
  const weights = new Uint8Array(TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE * 4);
  for (const [index, ...values] of terrain.materials || []) weights.set(values, index * 4);
  return weights;
}

let paintedDocument;
// The GM05a export plus GM05b paint strokes (as tests/gm-terrain-tiles.test.mjs): a document v4.
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
  assert.equal(document.version, 4);
  assert.ok(document.terrain.samples.length > 0 && document.terrain.materials.length > 0);
  paintedDocument = document;
  return document;
}

let editable;
const editableMask = () => editable ??= terrainEditableMask(map);

// A resource-valid point whose 7 x 7 vertex box is editable, so a tile can raise the ground under it.
function editableSite() {
  const mask = editableMask(), baseline = resourceLayout({ ...map, gmResources: [] });
  for (let z = -240; z <= 240; z += 3) for (let x = -240; x <= 240; x += 3) {
    let free = true;
    for (let dz = -3; dz <= 3 && free; dz++) for (let dx = -3; dx <= 3; dx++) if (!mask[vertex(x + dx, z + dz)]) { free = false; break; }
    const y = map.groundAt(x, z);
    if (!free || !(y > 1) || map.onDock?.(x, z) || map.lawlessAt?.(x, z) || !canScatterAt(map, x, z, 1)) continue;
    const dx = map.groundAt(x + 1, z) - map.groundAt(x - 1, z), dz = map.groundAt(x, z + 1) - map.groundAt(x, z - 1);
    if (Math.hypot(dx, dz) / 2 > 0.55) continue;
    if (baseline.nodes.some((node) => Math.hypot(x - node.x, z - node.z) < 6) ||
        baseline.bench && Math.hypot(x - baseline.bench.x, z - baseline.bench.z) < 7) continue;
    return { x, y, z };
  }
  throw new Error('no editable resource site');
}

// Tiles that raise every editable vertex of the (2r+1)^2 box around a point by deltaMm.
async function raised(at, radius, deltaMm) {
  const mask = editableMask(), grid = createTerrainGrid();
  for (let z = at.z - radius; z <= at.z + radius; z++) for (let x = at.x - radius; x <= at.x + radius; x++) {
    if (mask[vertex(x, z)]) grid.deltasMm[vertex(x, z)] = deltaMm;
  }
  return gridToTiles(grid, BASE);
}

const tilesOf = (objects, tiles) => createDocument({ seed: map.seed, baseRevision: BASE, objects,
  terrain: { version: 3, tileSize: 70, tiles } });

function obstacleStore({ ground = [], checkpoint = 'spawn' } = {}) {
  const profiles = [{ accountId: '00000000-0000-4000-8000-000000000001',
    profile: { ...(checkpoint ? { cp: checkpoint } : {}), eco: { ships: [] } } }];
  return { durable: true,
    async listGmContentProfiles({ after, limit }) { return profiles.filter((row) => !after || row.accountId > after).slice(0, limit); },
    async listPearlGround(worldId, { afterUid, limit }) {
      return ground.filter((row) => row.world === worldId && (!afterUid || row.uid > afterUid)).slice(0, limit);
    },
    async listCurrentDeathDrops() { return []; } };
}

function gameFixture(store) {
  return { store, server: { world: { map: { ...map } } }, closing: false, switching: false,
    healthy() { return !this.closing; },
    beginContentSwitch() {
      if (this.switching) throw Object.assign(new Error('gm_content_busy'), { code: 'gm_content_busy' });
      this.switching = true;
      return () => { this.switching = false; };
    },
    closeContentSpectators() {}, fenceWorld(code) { this.fenced = code; this.closing = true; } };
}

const contentService = (directory, game) => createGmContentService({ directory, root: ROOT, worldId: WORLD, baseMap: map,
  baseRevision: BASE, game, publication, lock: LOCK });

// Every schema 2 revision retains the release files of its audit record (runtime and manifest files, about 500).
// They are retained once into a template and copied into each new registry directory, so a test only writes (and
// fsyncs) what it adds. A registry accepts blobs that no revision references (it has no blob GC).
let template;
async function seeded(directory) {
  template ??= (async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'gm-tiles-seed-'));
    const registry = createGmContentRegistry({ directory: folder, root: ROOT, worldId: WORLD, lock: LOCK });
    await registry.prepare();
    const plain = createDocument({ seed: map.seed, baseRevision: BASE });
    await registry.retain((await publication.build({ document: plain, draftRevision: 1 })).revision);
    return folder;
  })();
  await cp(path.join(await template, 'blobs'), path.join(directory, 'blobs'), { recursive: true });
  return directory;
}
after(async () => { if (template) await rm(await template, { recursive: true, force: true }); });

// A GM, the memory draft store (its tile reads recorded), the content service and the draft routes over HTTP.
async function publishing(run, { ground = [], checkpoint = 'spawn', wrapStore = (store) => store, timeoutMs = 10_000 } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-tiles-publication-'));
  const directory = path.join(temp, 'content'), memory = createMemoryGmDraftMethods(), reads = [];
  const store = wrapStore({ durable: true, ...memory,
    async getTerrainTiles(input) { reads.push([...input.hashes]); return memory.getTerrainTiles(input); } });
  const game = gameFixture(obstacleStore({ ground, checkpoint }));
  const content = contentService(await seeded(directory), game);
  await content.prepare();
  const handler = createGmDraftHandler({ store, resolvePlayer: async (_req, { token }) => token === 'gm' ? GM : null,
    accountIds: [GM], worldId: WORLD, seed: map.seed, baseRevision: BASE, validateReferences, publication, content, timeoutMs });
  assert.equal(await handler.prepare(), true);
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    void handler.handle(req, res, { prepareRevision: route === '/api/gm/prepare', registerRevision: route === '/api/gm/revisions' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let head = 0, operations = 0, activations = 0;
  const post = async (route, body) => {
    const started = performance.now();
    const response = await fetch(`${url}${route}`, { method: 'POST', body: JSON.stringify(body),
      headers: { authorization: 'Bearer gm', 'content-type': 'application/json' } });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), bytes: Buffer.byteLength(text), ms: performance.now() - started };
  };
  const api = { temp, directory, memory, reads, game, content,
    // Stores the tiles in the draft store (as the upload route does) and the document as the next head.
    async save(document, blobs = new Map()) {
      if (blobs.size) assert.equal((await memory.putTerrainTiles({ world: WORLD, tiles: [...blobs.values()] })).ok, true);
      const saved = await memory.saveGmDraft({ world: WORLD, owner: GM, operationId: operation(++operations), expectedRevision: head, document });
      assert.equal(saved.ok, true, JSON.stringify(saved));
      head = saved.head.revision;
      return head;
    },
    prepare: () => post('/api/gm/prepare', { expectedRevision: head }),
    register: (revisionId) => post('/api/gm/revisions', { expectedRevision: head, revisionId }),
    async activate(revisionId) {
      const listed = await content.list();
      return content.activate({ operationId: `activate-${++activations}`, expectedGeneration: listed.active.generation, revisionId });
    },
  };
  try { await run(api); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
}

function prepared(answer) {
  assert.equal(answer.status, 200, JSON.stringify(answer.body).slice(0, 400));
  assert.equal(answer.body.preparation.report.valid, true, JSON.stringify(answer.body.preparation.report));
  return answer.body.preparation.revision;
}

test('v5 prepare reads its tiles from the store once and answers tiles_missing when one is absent', async () => {
  const { document, blobs } = await convertDocumentToV5(paintedV4());
  const hashes = document.terrain.tiles.map((reference) => reference[2]);
  assert.ok(hashes.length >= 2);
  await publishing(async (api) => {
    await api.save(document, blobs);
    const revision = prepared(await api.prepare());
    assert.deepEqual(api.reads, [hashes], 'one read of every referenced tile (at most 64 per call)');
    assert.equal(revision.version, PREPARATION_VERSION);
    assert.deepEqual(revision.content.document, document);
    assert.equal(revision.revisionId, jsonSha(revision.content));
  });
  const hidden = hashes[1];
  await publishing(async (api) => {
    await api.save(document, blobs);
    for (const answer of [await api.prepare(), await api.register('a'.repeat(64))]) {
      assert.equal(answer.status, 409);
      assert.deepEqual(answer.body, { ok: false, code: 'tiles_missing', why: 'tiles_missing', missing: [hidden] });
    }
    assert.deepEqual(await readdir(path.join(api.directory, 'revisions')), [], 'nothing retained');
    const retained = await readdir(path.join(api.directory, 'blobs'));
    assert.equal(hashes.some((hash) => retained.includes(hash)), false);
  }, { wrapStore: (store) => ({ ...store, async getTerrainTiles(input) {
    const found = await store.getTerrainTiles(input);
    found.delete(hidden);
    return found;
  } }) });
});

test('content.terrain of a v5 is the S7 contract: its key set, the document tiles and the hashes of the compiled bytes', async (t) => {
  const { document, blobs } = await convertDocumentToV5(paintedV4());
  const revision = (await publication.build({ document, draftRevision: 7, tiles: blobs })).revision;
  const terrain = revision.content.terrain;
  assert.deepEqual(Object.keys(terrain).sort(), S7_KEYS);
  assert.equal(terrain.format, 'marea.gm.terrain-tiles');
  assert.equal(terrain.version, 1);
  assert.equal(terrain.tileSize, 70);
  assert.deepEqual(terrain.tiles, document.terrain.tiles);
  const compiled = compileTerrainTiles(map, { tiles: document.terrain.tiles, blobs }, BASE);
  assert.equal(compiled.heights.length, TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE);
  assert.equal(terrain.heightsSha256, float32LeSha(compiled.heights));
  assert.equal(compiled.terrain.weights.length, TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE * 4);
  assert.equal(terrain.materialsSha256, sha(compiled.terrain.weights));
  assert.notEqual(terrain.heightsSha256, jsonSha(Array.from(compiled.heights)), 'not the canonical-JSON rule of v3/v4 (D9)');
  assert.equal(revision.revisionId, jsonSha(revision.content));
  assert.ok(Buffer.byteLength(JSON.stringify(revision.content.document)) < 2 * 1024 * 1024);
  t.diagnostic(`v5 content.terrain (painted v4 converted): ${JSON.stringify(terrain)}`);

  // A v5 without tiles (a converted v2) hashes the base heights and an all-zero weight grid.
  const empty = createDocument({ seed: map.seed, baseRevision: BASE, terrain: { version: 3, tileSize: 70, tiles: [] } });
  const plain = (await publication.build({ document: empty, draftRevision: 1, tiles: new Map() })).revision.content.terrain;
  assert.deepEqual(plain, { format: 'marea.gm.terrain-tiles', version: 1, tileSize: 70, tiles: [],
    heightsSha256: float32LeSha(map.heights), materialsSha256: sha(new Uint8Array(TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE * 4)) });
  // The build needs the bytes of every referenced tile, each hashing to its reference.
  await assert.rejects(publication.build({ document, draftRevision: 7 }), { code: 'gm_terrain_invalid', reason: 'tile_blobs' });
  const [first] = document.terrain.tiles;
  const wrong = new Map(blobs); wrong.set(first[2], new Uint8Array(first[3]));
  await assert.rejects(publication.build({ document, draftRevision: 7, tiles: wrong }), { code: 'gm_terrain_invalid', reason: 'tile_hash' });
});

test('a v5 tile that moves the ground under a resource, buries an object or breaks a whole-map rule is refused at prepare', async () => {
  const at = editableSite();
  const palm = createDecoration({ id: 'gm-01234567-89ab-4cde-8012-3456789abcde', assetId: 'prop:gm-resource-palm-v1',
    position: at, collider: 'none' });
  const crate = createDecoration({ id: 'buried-crate', assetId: 'prop:storage-crate', position: at, collider: 'none' });
  const lift = await raised(at, 3, 3000), bury = await raised(at, 3, 30000);
  // A tile with a height delta on a protected vertex (base ground under 0.75 m). It decodes canonically, so the store
  // takes it; the upload route would refuse it, and the whole-map check at prepare does.
  let shore = null;
  for (let z = -250; z <= 250 && !shore; z += 5) for (let x = -250; x <= 250; x += 5) if (map.groundAt(x, z) < 0) { shore = { x, z }; break; }
  const tx = Math.floor(shore.x / 70), tz = Math.floor(shore.z / 70), deltasMm = new Int32Array(TILE_VERTICES);
  deltasMm[(shore.z - 70 * tz) * 70 + shore.x - 70 * tx] = 500;
  const protectedTile = encodeTile({ tx, tz, deltasMm, channels: [] }, BASE);
  const protectedRef = [tx, tz, sha(protectedTile), protectedTile.length];

  await publishing(async (api) => {
    for (const object of [palm, crate]) {
      await api.save(tilesOf([object], []));
      prepared(await api.prepare());
    }
    await api.save(tilesOf([palm], lift.tiles), lift.blobs);
    let answer = await api.prepare();
    assert.equal(answer.status, 200);
    assert.equal(answer.body.preparation.revision, null);
    assert.equal(answer.body.preparation.report.valid, false);
    assert.ok(answer.body.preparation.report.issues.some((issue) => issue.severity === 'error' &&
      issue.code === 'resource_ground_height' && issue.objectId === palm.id), JSON.stringify(answer.body.preparation.report));

    await api.save(tilesOf([crate], bury.tiles), bury.blobs);
    answer = await api.prepare();
    assert.equal(answer.body.preparation.revision, null);
    assert.ok(answer.body.preparation.report.issues.some((issue) => issue.severity === 'error' &&
      issue.code === 'unsupported_height' && issue.objectId === crate.id), JSON.stringify(answer.body.preparation.report));

    await api.save(tilesOf([], [protectedRef]), new Map([[protectedRef[2], protectedTile]]));
    answer = await api.prepare();
    assert.equal(answer.status, 400);
    assert.deepEqual(answer.body, { ok: false, code: 'document', reason: 'protected_ground' });
    assert.equal((await api.register('b'.repeat(64))).status, 400);
    assert.deepEqual(await readdir(path.join(api.directory, 'revisions')), []);
  });
});

test('the GM05a v3 export and a painted v4, converted to v5, prepare and activate through the burial check with their original heights and weights', async () => {
  for (const original of [validateDocument(exported), paintedV4()]) {
    const { document, blobs } = await convertDocumentToV5(original);
    const before = compileTerrainMap(map, original.terrain), weights = paintWeights(original.terrain);
    const edited = original.terrain.samples.map(([index]) => ({ x: index % TERRAIN_GRID_SIZE - 280,
      z: Math.floor(index / TERRAIN_GRID_SIZE) - 280 }));
    let quiet = null;
    for (let z = -200; z <= 200 && !quiet; z += 10) for (let x = -200; x <= 200; x += 10) {
      if (map.groundAt(x, z) > 1 && edited.every((p) => Math.hypot(p.x - x, p.z - z) > 20)) { quiet = { x, z }; break; }
    }
    const [index] = original.terrain.samples.reduce((best, sample) => Math.abs(sample[1]) > Math.abs(best[1]) ? sample : best);
    const buried = { x: index % TERRAIN_GRID_SIZE - 280, z: Math.floor(index / TERRAIN_GRID_SIZE) - 280 };
    const ground = [];
    await publishing(async (api) => {
      await api.save(document, blobs);
      const revision = prepared(await api.prepare());
      assert.equal(revision.content.terrain.heightsSha256, float32LeSha(before.heights), 'the heights of the original');
      assert.equal(revision.content.terrain.materialsSha256, sha(weights), 'the weights of the original');
      assert.equal((await api.register(revision.revisionId)).status, 200);
      // The burial check refuses it while a saved pearl lies on its edited ground; nothing is installed.
      ground.push({ uid: 'pearl-0', world: WORLD, ground: buried });
      await assert.rejects(api.activate(revision.revisionId), { code: 'gm_content_occupied' });
      assert.equal(api.game.server.world.map.heights, map.heights, 'the base map stays installed');
      assert.equal((await api.content.list()).active.revisionId, null);
      // With the pearl and a player checkpoint away from the edit, the check passes.
      ground.splice(0, ground.length, { uid: 'pearl-1', world: WORLD, ground: quiet });
      const result = await api.activate(revision.revisionId);
      assert.equal(result.ok, true);
      assert.equal(result.active.revisionId, revision.revisionId);
      const active = api.game.server.world.map;
      assert.equal(Buffer.compare(bufferOf(active.heights), bufferOf(before.heights)), 0, 'installed heights are bit-identical');
      assert.equal(Buffer.compare(bufferOf(active.terrain.weights), bufferOf(weights)), 0, 'installed weights are identical');
      const reference = installGmContent({ ...map }, map, original, BASE);
      for (const p of [...edited.slice(0, 40), quiet]) for (const offset of [0, .3, .5]) {
        const x = p.x + offset, z = p.z + offset / 2;
        assert.equal(active.groundAt(x, z), reference.groundAt(x, z));
        assert.equal(active.materialAt(x, z), reference.materialAt(x, z));
        assert.deepEqual(active.materialWeightsAt(x, z), reference.materialWeightsAt(x, z));
      }
      assert.equal(active.terrainResources !== undefined, reference.terrainResources !== undefined);
      assert.equal(api.game.fenced, undefined);
    }, { ground });
  }
});

// The same tile with its heights as int32 although they fit int16: it decodes to the same tile but is not canonical.
function int32Copy(bytes) {
  assert.equal(bytes[10], 1, 'an int16 tile');
  const count = bytes[11], header = 12 + count, source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint8Array(header + TILE_VERTICES * (4 + count)), target = new DataView(out.buffer);
  out.set(bytes.subarray(0, header)); out[10] = 2;
  for (let n = 0; n < TILE_VERTICES; n++) target.setInt32(header + n * 4, source.getInt16(header + n * 2, true), true);
  out.set(bytes.subarray(header + TILE_VERTICES * 2), header + TILE_VERTICES * 4);
  return out;
}

async function used(directory) {
  let total = 0;
  for (const folder of ['blobs', 'revisions']) for (const name of await readdir(path.join(directory, folder))) {
    total += (await stat(path.join(directory, folder, name))).size;
  }
  return total;
}

test('the registry keeps each tile once, counts tile bytes in its budget and refuses missing, corrupt and non-canonical tiles', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-tiles-registry-'));
  const directory = path.join(temp, 'content'), blobDir = path.join(directory, 'blobs'), revisionDir = path.join(directory, 'revisions');
  try {
    const registry = createGmContentRegistry({ directory: await seeded(directory), root: ROOT, worldId: WORLD, lock: LOCK });
    await registry.prepare();
    const { document, blobs } = await convertDocumentToV5(paintedV4());
    const first = (await publication.build({ document, draftRevision: 1, tiles: blobs })).revision;
    const second = (await publication.build({ document, draftRevision: 2, tiles: blobs })).revision;
    assert.notEqual(first.revisionId, second.revisionId);
    assert.deepEqual(first.content.terrain, second.content.terrain);

    // Without its tile bytes a v5 revision is refused before anything is written (tiles never come from the release).
    const release = (await readdir(blobDir)).sort();
    await assert.rejects(registry.retain(first), { code: 'dependency' });
    assert.deepEqual((await readdir(blobDir)).sort(), release);
    assert.deepEqual(await readdir(revisionDir), []);
    await registry.retain(first, { tiles: blobs });
    const stored = (await readdir(blobDir)).sort();
    for (const [hash, bytes] of blobs) assert.equal(Buffer.compare(await readFile(path.join(blobDir, hash)), Buffer.from(bytes)), 0);
    // The second revision shares every tile: it needs no source and adds no blob.
    await registry.retain(second);
    assert.deepEqual((await readdir(blobDir)).sort(), stored);
    assert.equal((await readdir(revisionDir)).length, 2);
    const loaded = await registry.loadWithTiles(second.revisionId);
    assert.deepEqual([...loaded.tiles.keys()].sort(), [...blobs.keys()].sort());
    for (const [hash, bytes] of blobs) assert.equal(Buffer.compare(Buffer.from(loaded.tiles.get(hash)), Buffer.from(bytes)), 0);

    // Budget: a third revision brings tiles of its own (its release files are already retained). With a filler
    // that leaves one byte too few for its tiles plus its record it is refused; one byte less filler and it fits.
    const third = await raised(editableSite(), 3, 2000);
    const revision3 = (await publication.build({ document: tilesOf([], third.tiles), draftRevision: 3, tiles: third.blobs })).revision;
    const tileBytes = [...third.blobs.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    assert.ok(tileBytes > 0 && third.tiles.every((reference) => !stored.includes(reference[2])));
    const filler = path.join(blobDir, 'filler'), fill = BUDGET - await used(directory) - tileBytes - Buffer.byteLength(canonicalJson(revision3)) + 1;
    const handle = await open(filler, 'w');
    try { await handle.truncate(fill); } finally { await handle.close(); }
    await assert.rejects(registry.retain(revision3, { tiles: third.blobs }), { code: 'gm_content_limit' });
    const shrink = await open(filler, 'r+');
    try { await shrink.truncate(fill - 1); } finally { await shrink.close(); }
    await registry.retain(revision3, { tiles: third.blobs });
    await rm(filler);

    // A corrupted tile blob fails every load of a revision that references it.
    const victim = path.join(blobDir, document.terrain.tiles[0][2]), intact = await readFile(victim);
    const broken = Buffer.from(intact); broken[broken.length - 1] ^= 1;
    await writeFile(victim, broken);
    await assert.rejects(registry.load(first.revisionId), { code: 'dependency' });
    await assert.rejects(registry.loadWithTiles(second.revisionId), { code: 'dependency' });
    await writeFile(victim, intact);
    await registry.load(first.revisionId);

    // A non-canonical tile with the right hash: refused as a retain source, and refused on load from disk.
    const reference = document.terrain.tiles.find(([, , hash]) => blobs.get(hash)[10] === 1);
    const odd = int32Copy(blobs.get(reference[2])), oddHash = sha(odd);
    const forged = structuredClone(first);
    const forgedRef = forged.content.document.terrain.tiles.find((entry) => entry[2] === reference[2]);
    forgedRef[2] = oddHash; forgedRef[3] = odd.length;
    forged.content.terrain.tiles = structuredClone(forged.content.document.terrain.tiles);
    forged.revisionId = jsonSha(forged.content);
    await assert.rejects(registry.retain(forged, { tiles: new Map([...blobs, [oddHash, odd]]) }), { code: 'dependency' });
    assert.equal((await readdir(blobDir)).includes(oddHash), false);
    await writeFile(path.join(blobDir, oddHash), odd);
    await writeFile(path.join(revisionDir, `${forged.revisionId}.json`), canonicalJson(forged));
    await assert.rejects(registry.load(forged.revisionId), { code: 'dependency' });
    // A v5 revision without the S7 terrain is no artifact.
    const bare = structuredClone(first); delete bare.content.terrain.materialsSha256; bare.revisionId = jsonSha(bare.content);
    await assert.rejects(registry.retain(bare, { tiles: blobs }), { code: 'artifact' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('active v3 and v4 revisions rebuilt with this code keep their revisionId and derived hashes', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-tiles-legacy-'));
  try {
    for (const [name, original] of [['v3', validateDocument(exported)], ['v4', paintedV4()]]) {
      const revision = (await publication.build({ document: original, draftRevision: 3 })).revision;
      assert.equal(original.version, name === 'v3' ? 3 : 4);
      assert.deepEqual(revision.content.terrain, PINNED[name].terrain, 'the content.terrain built before GM07b2c');
      assert.equal(revision.content.documentHash, PINNED[name].documentHash);
      // The old rule, recomputed here: canonical JSON of the compiled heights and of the sparse materials.
      const compiled = compileTerrainMap(map, original.terrain);
      assert.equal(revision.content.terrain.sha256, jsonSha(Array.from(compiled.heights)));
      if (name === 'v4') assert.equal(revision.content.terrain.materialsSha256, jsonSha(original.terrain.materials));
      assert.equal(revision.revisionId, jsonSha(revision.content));
      const directory = await seeded(path.join(temp, name));
      const registry = createGmContentRegistry({ directory, root: ROOT, worldId: WORLD, lock: LOCK });
      await registry.prepare();
      await registry.retain(revision);
      await registry.withLock(() => registry.switch({ operationId: `legacy-${name}`, expectedGeneration: 0, revisionId: revision.revisionId }));
      // The updater check rebuilds the active revision from the registry with this code: same id, same derived hashes.
      assert.equal(await checkGmContentRelease({ directory, root: ROOT }), true);
      const rebuilt = (await publication.build({ document: original, draftRevision: 3, version: revision.version })).revision;
      assert.equal(rebuilt.revisionId, revision.revisionId);
      assert.equal(canonicalJson(derivedContentHashes(rebuilt.content)), canonicalJson(derivedContentHashes(revision.content)));
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('whole map: every editable dry vertex raised 30 m prepares under 2 MiB and 10 s, registers, activates, boots and passes the updater check', async (t) => {
  const mask = editableMask(), grid = createTerrainGrid();
  let raisedVertices = 0;
  for (let k = 0; k < mask.length; k++) if (mask[k]) { grid.deltasMm[k] = 30000; raisedVertices++; }
  const { tiles, blobs } = await gridToTiles(grid, BASE);
  const document = tilesOf([], tiles), tileBytes = [...blobs.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  const compiled = compileTerrainTiles(map, { tiles, blobs }, BASE);
  // No player checkpoint: a raise of the whole map may move the ground under one, which is the burial check's job.
  await publishing(async (api) => {
    await api.save(document, blobs);
    const cpuBefore = process.cpuUsage();
    const answer = await api.prepare();
    const revision = prepared(answer);
    const documentBytes = Buffer.byteLength(JSON.stringify(revision.content.document));
    const revisionBytes = Buffer.byteLength(JSON.stringify(revision));
    const cpu = process.cpuUsage(cpuBefore), cpuMs = (cpu.user + cpu.system) / 1000;
    assert.ok(cpuMs < 10_000, `prepare used ${cpuMs} ms of CPU (${answer.ms} ms wall)`);
    assert.ok(documentBytes < 2 * 1024 * 1024 && answer.bytes < 2 * 1024 * 1024, `${documentBytes} / ${answer.bytes} bytes`);
    assert.deepEqual(api.reads, [tiles.map((reference) => reference[2])]);
    assert.equal(revision.content.terrain.heightsSha256, float32LeSha(compiled.heights));
    assert.equal((await api.register(revision.revisionId)).status, 200);
    let started = performance.now();
    assert.equal((await api.activate(revision.revisionId)).ok, true);
    const activationMs = performance.now() - started;
    assert.equal(Buffer.compare(bufferOf(api.game.server.world.map.heights), bufferOf(compiled.heights)), 0);

    // The server install alone, from the registry tiles.
    const registry = createGmContentRegistry({ directory: api.directory, root: ROOT, worldId: WORLD, lock: LOCK });
    await registry.prepare();
    const retained = await registry.loadWithTiles(revision.revisionId);
    assert.equal(retained.tiles.size, tiles.length);
    started = performance.now();
    const installed = installGmContent({ ...map }, map, retained.revision.content.document, BASE, { tiles: retained.tiles });
    const installMs = performance.now() - started;
    assert.equal(Buffer.compare(bufferOf(installed.heights), bufferOf(compiled.heights)), 0);

    // A server boot: a new content service on the same directory installs the active v5 from the registry.
    const boot = gameFixture(obstacleStore({ checkpoint: null }));
    started = performance.now();
    await contentService(api.directory, boot).prepare();
    const bootMs = performance.now() - started;
    assert.equal(Buffer.compare(bufferOf(boot.server.world.map.heights), bufferOf(compiled.heights)), 0);
    assert.equal(Buffer.compare(bufferOf(boot.server.world.map.terrain.weights), bufferOf(compiled.terrain.weights)), 0);

    // The updater check: in process, then as the CLI the updater runs (no store, no network, the directory only).
    started = performance.now();
    assert.equal(await checkGmContentRelease({ directory: api.directory, root: ROOT }), true);
    const checkMs = performance.now() - started;
    const candidate = createGmPublicationService({ root: ROOT, map: generateWorld(GAME.seed), baseRevision: BASE, worldId: WORLD,
      validateReferences, gameVersion: 'candidate', protocolVersion: PROTOCOL_VERSION + 1 });
    await candidate.prepare();
    const rebuilt = (await candidate.build({ document: retained.revision.content.document,
      draftRevision: retained.revision.content.sourceRevision, tiles: retained.tiles })).revision;
    assert.equal(rebuilt.revisionId, revision.revisionId);
    assert.equal(canonicalJson(derivedContentHashes(rebuilt.content)), canonicalJson(derivedContentHashes(revision.content)));
    started = performance.now();
    const cli = spawnSync(process.execPath, [path.join(ROOT, 'server/gmContentCheck.mjs')], { cwd: ROOT, encoding: 'utf8',
      timeout: 120_000, env: { ...process.env, MN_GM_CONTENT_DIR: api.directory } });
    const cliMs = performance.now() - started;
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /content compatible/);
    // A tile changed on disk makes the check fail: it reads the retained bytes.
    const victim = path.join(api.directory, 'blobs', tiles[0][2]), intact = await readFile(victim);
    await writeFile(victim, Buffer.concat([intact.subarray(0, intact.length - 1), Buffer.from([intact[intact.length - 1] ^ 1])]));
    await assert.rejects(checkGmContentRelease({ directory: api.directory, root: ROOT }), { code: 'dependency' });
    await writeFile(victim, intact);

    t.diagnostic(`whole map: raised vertices ${raisedVertices}; tiles ${tiles.length}; tile bytes ${tileBytes}; ` +
      `prepared document ${documentBytes} bytes, prepared revision ${revisionBytes} bytes, prepare response ${answer.bytes} bytes`);
    t.diagnostic(`prepare ${answer.ms.toFixed(1)} ms (HTTP, store read + build); activation ${activationMs.toFixed(1)} ms; ` +
      `server install ${installMs.toFixed(1)} ms; boot ${bootMs.toFixed(1)} ms; check rebuild ${checkMs.toFixed(1)} ms in process, ` +
      `${cliMs.toFixed(1)} ms as the CLI`);
  }, { checkpoint: null, timeoutMs: 60_000 });
});
