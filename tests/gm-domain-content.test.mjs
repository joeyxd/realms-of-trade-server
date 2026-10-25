// GM11b3 (docs/briefs/gm11-world-growth-zones.md, GM11b design; ticket T-1025-22): a document v6 is prepared over its own
// domain (content.terrain version 2 names the domain), the budget measures that domain, the registry retains the tiles,
// and neither the server nor the client installs a world whose extent differs from the running map (terrain_domain_runtime).
// v5 content keeps its shape and its revision id. Pure: no three.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../src/sim/worldgen.js';
import { baseMapForDomain } from '../src/sim/baseMapForDomain.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { createDocument } from '../src/editor/document.js';
import { terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { compileTerrainTiles, domainBounds, encodeTile, TILE_VERTICES } from '../src/editor/terrainTiles.js';
import { canonicalJson } from '../src/editor/publicationArtifact.js';
import { gmContentHash, loadGmWorldContent } from '../src/editor/activeContent.js';
import { WORLD_LOAD_LIMITS, WORLD_OVER_LOAD_BUDGET, worldLoadBudget } from '../src/editor/worldLoad.js';
import { resourceLayout } from '../src/data/resources.js';
import { createGmDraftValidator } from '../server/gmDraftValidation.mjs';
import { createGmPublicationService } from '../server/gmPublication.mjs';
import { createGmContentRegistry } from '../server/gmContentRegistry.mjs';
import { createGmContentService } from '../server/gmContent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'terrain-s21-v1', WORLD = 'domain-content-world';
const DOMAIN = { minTx: -12, maxTx: 3, minTz: -4, maxTz: 3 }; // 16 x 8 tiles: x -840..280, z -280..280
const LOCK = { async run(callback) { return callback({ assertHeld() {} }); } };
const map = generateWorld(GAME.seed), mask = terrainEditableMask(map), layout = resourceLayout(map);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonSha = (value) => sha(Buffer.from(canonicalJson(value)));
const KEYS_V1 = ['format', 'heightsSha256', 'materialsSha256', 'tileSize', 'tiles', 'version'];
const KEYS_V2 = ['domain', ...KEYS_V1];

// Built on the code before GM11b3 (git archive HEAD of the parent commit) from the two v5 documents below, same fixture.
const PINNED_V5 = Object.freeze({ empty: '31676038aac04df9ce7cdc0b9991cc56551209eb44a7c052e8aa2818026058c5',
  tile: '2754e9e48ff7a2825f5c59e92747bbdbd23d12d90c9bd98c16224d21d2bd4d7c' });

// One single-vertex tile at a free editable vertex (land above 2 m, clear of resource sites), as the player test.
function freeVertex() {
  for (let j = 20; j < TERRAIN_GRID_SIZE - 20; j += 7) for (let i = 20; i < TERRAIN_GRID_SIZE - 20; i += 7) {
    const x = i - 280, z = j - 280, tx = Math.floor(x / 70), tz = Math.floor(z / 70), u = x - 70 * tx, v = z - 70 * tz;
    if (u < 2 || v < 2 || u > 67 || v > 67 || mask[j * TERRAIN_GRID_SIZE + i] !== 1 || map.groundAt(x, z) < 2) continue;
    if (layout.nodes.some((node) => Math.hypot(node.x - x, node.z - z) < 12) ||
        layout.bench && Math.hypot(layout.bench.x - x, layout.bench.z - z) < 12) continue;
    return { tx, tz, n: v * 70 + u };
  }
  throw new Error('no free vertex');
}
const at = freeVertex(), deltasMm = new Int32Array(TILE_VERTICES);
deltasMm[at.n] = 1000;
const bytes = encodeTile({ tx: at.tx, tz: at.tz, deltasMm, channels: [] }, BASE);
const blobs = new Map([[sha(bytes), bytes]]);
const tiles = [[at.tx, at.tz, sha(bytes), bytes.length]];
const v5 = (list = tiles) => createDocument({ seed: map.seed, baseRevision: BASE, terrain: { version: 3, tileSize: 70, tiles: list } });
const v6 = () => createDocument({ seed: map.seed, baseRevision: BASE, terrain: { version: 4, tileSize: 70, domain: DOMAIN, tiles } });

const validateReferences = createGmDraftValidator({ map, baseRevision: BASE, manifest: { assets: [] }, editorCatalog: { assets: [] } });
const service = (loadLimits) => createGmPublicationService({ root: ROOT, map, baseRevision: BASE, worldId: WORLD, validateReferences,
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, ...(loadLimits ? { loadLimits } : {}) });
const publication = service();
await publication.prepare();

function float32LeSha(values) {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  for (let k = 0; k < values.length; k++) view.setFloat32(k * 4, values[k], true);
  return sha(new Uint8Array(view.buffer));
}

let prepared;
const grownRevision = async () => prepared ??= (await publication.build({ document: v6(), draftRevision: 7, tiles: blobs })).revision;

test('a v5 publication keeps its content shape and its revision id', async () => {
  const empty = (await publication.build({ document: v5([]), draftRevision: 1, tiles: new Map() })).revision;
  const one = (await publication.build({ document: v5(), draftRevision: 7, tiles: blobs })).revision;
  for (const revision of [empty, one]) {
    assert.deepEqual(Object.keys(revision.content.terrain).sort(), KEYS_V1);
    assert.equal(revision.content.terrain.version, 1);
    assert.ok(!Object.hasOwn(revision.content.terrain, 'domain'));
    assert.equal(revision.revisionId, jsonSha(revision.content));
  }
  assert.equal(empty.revisionId, PINNED_V5.empty);
  assert.equal(one.revisionId, PINNED_V5.tile);
});

test('a v6 publication prepares over its domain: content.terrain version 2 with the exact key set', async () => {
  const revision = await grownRevision(), terrain = revision.content.terrain;
  assert.equal(revision.content.document.version, 6);
  assert.deepEqual(Object.keys(terrain).sort(), KEYS_V2);
  assert.deepEqual(Object.keys(terrain), ['format', 'version', 'tileSize', 'domain', 'tiles', 'heightsSha256', 'materialsSha256']);
  assert.equal(terrain.format, 'marea.gm.terrain-tiles');
  assert.equal(terrain.version, 2);
  assert.equal(terrain.tileSize, 70);
  assert.deepEqual(terrain.domain, DOMAIN);
  assert.deepEqual(terrain.tiles, tiles);
  assert.ok(!Object.hasOwn(terrain, 'gridSize'));
  assert.equal(revision.revisionId, jsonSha(revision.content));
  // The hashes are those of the terrain compiled over the domain, which holds 1,121 x 561 vertices.
  const world = baseMapForDomain(map.seed, domainBounds(DOMAIN));
  const compiled = compileTerrainTiles(world, { tiles, blobs }, domainBounds(DOMAIN));
  assert.equal(compiled.heights.length, 1121 * 561);
  assert.equal(terrain.heightsSha256, float32LeSha(compiled.heights));
  assert.equal(terrain.materialsSha256, sha(compiled.terrain.weights));
  assert.equal(compiled.terrain.weights.length, 1121 * 561 * 4);
  // The same tile on the same world is the same terrain on the square: vertex for vertex.
  const square = compileTerrainTiles(map, { tiles, blobs }, BASE);
  for (let j = 0; j < 561; j++) for (let i = 0; i < 561; i++) {
    if (compiled.heights[j * 1121 + i + 560] !== square.heights[j * 561 + i]) assert.fail(`height differs at ${i},${j}`);
  }
  // The meter measures the document's domain: 628,881 vertices of 1,000,000.
  const budget = worldLoadBudget({ minX: -280, maxX: 280, minZ: -280, maxZ: 280, cell: 1 }, v6());
  assert.equal(budget.vertices, 1121 * 561);
  assert.equal(budget.level, 'ok');
  assert.equal(worldLoadBudget(domainBounds({ minTx: -4, maxTx: 3, minTz: -4, maxTz: 3 }), v5()).vertices, 561 * 561);
});

test('a v6 over the single-load budget is refused at prepare, a v5 under it is not', async () => {
  const small = { ...WORLD_LOAD_LIMITS, vertices: 400_000 };
  const tight = service(small);
  await tight.prepare();
  assert.equal(worldLoadBudget(domainBounds({ minTx: -4, maxTx: 3, minTz: -4, maxTz: 3 }), v5(), small).level, 'near');
  const built = await tight.build({ document: v5(), draftRevision: 7, tiles: blobs });
  assert.equal(built.report.valid, true);
  const refused = await tight.build({ document: v6(), draftRevision: 7, tiles: blobs });
  assert.equal(refused.revision, null);
  assert.equal(refused.report.valid, false);
  assert.ok(refused.report.issues.some((issue) => issue.code === WORLD_OVER_LOAD_BUDGET));
});

let template;
async function seeded(directory) {
  template ??= (async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'gm-domain-seed-'));
    const registry = createGmContentRegistry({ directory: folder, root: ROOT, worldId: WORLD, lock: LOCK });
    await registry.prepare();
    await registry.retain((await publication.build({ document: createDocument({ seed: map.seed, baseRevision: BASE }), draftRevision: 1 })).revision);
    return folder;
  })();
  await cp(path.join(await template, 'blobs'), path.join(directory, 'blobs'), { recursive: true });
  return directory;
}
const temps = [];
after(async () => { for (const folder of [...temps, ...(template ? [await template] : [])]) await rm(folder, { recursive: true, force: true }); });

test('the registry retains a v6 revision with its tiles; the server refuses to activate it (terrain_domain_runtime)', async () => {
  const revision = await grownRevision();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gm-domain-content-'));
  temps.push(directory);
  await seeded(directory);
  const registry = createGmContentRegistry({ directory, root: ROOT, worldId: WORLD, lock: LOCK });
  await registry.prepare();
  await assert.rejects(registry.retain(revision), { code: 'dependency' });
  await registry.retain(revision, { tiles: blobs });
  const loaded = await registry.loadWithTiles(revision.revisionId);
  assert.equal(loaded.revision.revisionId, revision.revisionId);
  assert.deepEqual([...loaded.tiles.keys()], tiles.map((tile) => tile[2]));
  // A domain in the content that is not the document's is not a retainable revision.
  const forged = structuredClone(revision);
  forged.content.terrain.domain = { ...DOMAIN, minTx: -11 };
  forged.revisionId = jsonSha(forged.content);
  await assert.rejects(registry.retain(forged, { tiles: blobs }), { code: 'artifact' });

  const game = { store: null, server: { world: { map: { ...map } } }, closing: false, switching: false,
    healthy() { return !this.closing; }, beginContentSwitch() { this.switching = true; return () => { this.switching = false; }; },
    closeContentSpectators() {}, fenceWorld(code) { this.fenced = code; this.closing = true; } };
  const content = createGmContentService({ directory, root: ROOT, worldId: WORLD, baseMap: map, baseRevision: BASE, game, publication, lock: LOCK });
  await content.prepare();
  await content.register(revision, { tiles: blobs });
  await assert.rejects(content.activate({ operationId: 'activate-grown', expectedGeneration: 0, revisionId: revision.revisionId }),
    { code: 'terrain_domain_runtime' });
  assert.equal((await content.list()).active.revisionId, null);
  assert.equal(game.switching, false);
  assert.equal(game.fenced, undefined);
});

// The client loader against a stubbed /api/world/content: a revision prepared by the real service.
const clientMaps = () => { const base = generateWorld(GAME.seed); return { base, client: { ...base } }; };
function contentFetch(revision, tileBytes = blobs) {
  return async (url) => {
    const route = String(url);
    if (route.endsWith('api/world/content')) return { ok: true, json: async () => ({ ok: true, generation: 1, revisionId: revision.revisionId, revision }) };
    const hash = route.split('/').pop(), body = tileBytes.get(hash);
    return body ? { ok: true, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) } : { ok: false, status: 404 };
  };
}
const load = (revision, fetchImpl = contentFetch(revision)) => {
  const maps = clientMaps();
  return loadGmWorldContent({ httpBase: 'http://127.0.0.1:1/', map: maps.client, baseMap: maps.base, gameVersion: GAME.version,
    protocolVersion: PROTOCOL_VERSION, fetchImpl });
};

test('the client refuses version 2 content whose domain differs from the running map\'s bounds (terrain_domain_runtime)', async () => {
  const revision = await grownRevision();
  await assert.rejects(load(revision), { code: 'terrain_domain_runtime' });
  // The loader still installs a v5 revision of the same tile: the content shape of v5 is read as before.
  const one = (await publication.build({ document: v5(), draftRevision: 7, tiles: blobs })).revision;
  const maps = clientMaps();
  const loaded = await loadGmWorldContent({ httpBase: 'http://127.0.0.1:1/', map: maps.client, baseMap: maps.base, gameVersion: GAME.version,
    protocolVersion: PROTOCOL_VERSION, fetchImpl: contentFetch(one) });
  assert.equal(loaded.revisionId, one.revisionId);
  assert.equal(maps.client.heights.length, TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE);
});

test('version 2 content with a missing, invalid or canonical domain is refused as content_terrain', async () => {
  const revision = await grownRevision();
  const forge = (change) => {
    const forged = structuredClone(revision);
    change(forged.content.terrain);
    forged.revisionId = jsonSha(forged.content);
    return forged;
  };
  const missing = forge((terrain) => { delete terrain.domain; });
  const invalid = forge((terrain) => { terrain.domain = { ...DOMAIN, minTx: -65 }; });
  const canonical = forge((terrain) => { terrain.domain = { minTx: -4, maxTx: 3, minTz: -4, maxTz: 3 }; });
  const other = forge((terrain) => { terrain.domain = { ...DOMAIN, minTx: -11 }; });
  const downgraded = forge((terrain) => { terrain.version = 1; });
  for (const forged of [missing, invalid, canonical, other, downgraded]) {
    await assert.rejects(load(forged), { code: 'content_terrain' }, JSON.stringify(forged.content.terrain.domain));
  }
  assert.equal(typeof gmContentHash, 'function');
});
