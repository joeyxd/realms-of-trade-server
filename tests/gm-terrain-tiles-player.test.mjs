// GM07b2d (docs/briefs/gm07b2-server.md S10): a published world whose document is v5 (terrain tiles) reaches the players.
// The server serves the ACTIVE revision's tiles on GET|HEAD /api/world/terrain-tiles/<sha256> (public, immutable, ETag,
// gzip) and the browser loader fetches, verifies, compiles and installs them before the scene builds. One real game
// server (memory stores) publishes a small fixture of single-vertex tiles through the GM routes; the loader and the
// route run against it.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { createDocument } from '../src/editor/document.js';
import { terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { encodeTile, TILE_VERTICES } from '../src/editor/terrainTiles.js';
import { installGmContent, projectGmContent } from '../src/editor/contentProjection.js';
import { gmContentHash, loadGmWorldContent } from '../src/editor/activeContent.js';
import { resourceLayout } from '../src/data/resources.js';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';

const BASE = 'terrain-s21-v1', WORLD = 'gm-terrain-tiles-player';
const GM = '30000000-0000-4000-8000-000000000011';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const operation = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = { authorization: 'Bearer gm', 'content-type': 'application/json' };
const map = generateWorld(GAME.seed), mask = terrainEditableMask(map), layout = resourceLayout(map);

// Single-vertex tiles at free editable vertices of distinct tiles (land above 2 m, clear of resource sites).
function freeVertices(count) {
  const seen = new Set(), found = [];
  for (let j = 20; j < TERRAIN_GRID_SIZE - 20; j += 7) for (let i = 20; i < TERRAIN_GRID_SIZE - 20; i += 7) {
    const x = i - 280, z = j - 280, tx = Math.floor(x / 70), tz = Math.floor(z / 70), u = x - 70 * tx, v = z - 70 * tz;
    if (u < 2 || v < 2 || u > 67 || v > 67 || seen.has(`${tx},${tz}`) || mask[j * TERRAIN_GRID_SIZE + i] !== 1 || map.groundAt(x, z) < 2) continue;
    if (layout.nodes.some((node) => Math.hypot(node.x - x, node.z - z) < 12) ||
        layout.bench && Math.hypot(layout.bench.x - x, layout.bench.z - z) < 12) continue;
    seen.add(`${tx},${tz}`); found.push({ tx, tz, n: v * 70 + u });
    if (found.length === count) return found;
  }
  throw new Error('not enough free vertices');
}
function tileAt(at, deltaMm, paint = 0) {
  const deltasMm = new Int32Array(TILE_VERTICES), weights = new Uint8Array(TILE_VERTICES);
  deltasMm[at.n] = deltaMm; weights[at.n] = paint;
  return encodeTile({ tx: at.tx, tz: at.tz, deltasMm, channels: paint ? [{ id: 3, weights }] : [] }, BASE);
}
const tilesDocument = (tiles) => createDocument({ seed: map.seed, baseRevision: BASE, terrain: { version: 3, tileSize: 70,
  tiles: tiles.map(({ at, bytes }) => [at.tx, at.tz, sha(bytes), bytes.length]).sort((a, b) => a[1] - b[1] || a[0] - b[0]) } });
const vertices = freeVertices(10);
const tilesA = vertices.map((at, k) => ({ at, bytes: tileAt(at, 1000, k % 2 ? 40 : 0) }));
const tilesB = vertices.slice(0, 2).map((at) => ({ at, bytes: tileAt(at, 1500) }));
const frames = (list) => {
  const body = Buffer.alloc(list.reduce((size, { bytes }) => size + 4 + bytes.length, 0));
  let offset = 0;
  for (const { bytes } of list) { body.writeUInt32LE(bytes.length, offset); body.set(bytes, offset + 4); offset += 4 + bytes.length; }
  return body;
};

let shared;
after(async () => { if (shared) { await shared.app.close(); await rm(shared.temp, { recursive: true, force: true }); } });

// One game server for the whole file; `publish` uploads, saves, prepares, registers and activates a v5 document.
async function serving() {
  if (shared) return shared;
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-terrain-tiles-player-'));
  const memory = createMemoryStore();
  const store = { ...memory, durable: true, async checkGmTerrainTiles() { return { version: 1 }; } };
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, dev: false, log() {}, worldId: WORLD,
    worldSaveMs: 60_000, store, resolvePlayer: async (_request, hello) => hello.token === 'gm' ? GM : null, gmAccountIds: [GM],
    gmDraftsAllowMemory: true, gmContentDirectory: path.join(temp, 'content'),
    gmContentLock: { async run(callback) { return callback({ assertHeld() {} }); } } });
  const httpBase = `http://127.0.0.1:${await app.listen()}`;
  let head = 0, operations = 0, generation = 0;
  const post = async (route, body, expected = 200) => {
    const response = await fetch(`${httpBase}${route}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  };
  shared = { app, temp, httpBase,
    async publish(document, tiles) {
      const upload = await fetch(`${httpBase}/api/gm/terrain-tiles`, { method: 'POST',
        headers: { authorization: 'Bearer gm', 'content-type': 'application/octet-stream' }, body: frames(tiles) });
      assert.equal(upload.status, 200, await upload.clone().text());
      const saved = await fetch(`${httpBase}/api/gm/draft`, { method: 'PUT', headers: json,
        body: JSON.stringify({ operationId: operation(++operations), expectedRevision: head, document }) });
      assert.equal(saved.status, 200, await saved.clone().text());
      head++;
      const { preparation } = await post('/api/gm/prepare', { expectedRevision: head });
      assert.equal(preparation.report.valid, true, JSON.stringify(preparation.report));
      await post('/api/gm/revisions', { expectedRevision: head, revisionId: preparation.revision.revisionId });
      await shared.activate(preparation.revision.revisionId);
      return preparation.revision;
    },
    async activate(revisionId) {
      await post('/api/gm/activate', { operationId: operation(100 + ++operations), expectedGeneration: generation, revisionId });
      generation++;
    } };
  return shared;
}

const clientMaps = () => { const base = generateWorld(GAME.seed); return { base, client: { ...base } }; };
const load = (httpBase, maps, fetchImpl) => loadGmWorldContent({ httpBase: `${httpBase}/`, map: maps.client, baseMap: maps.base,
  gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, ...(fetchImpl ? { fetchImpl } : {}) });
const tilePath = '/api/world/terrain-tiles/';

// A raw request: node:http keeps the body as the server sent it (fetch would gunzip it).
function raw(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject); request.end();
  });
}

let revisionA;
test('a v5 revision is published and activated through the GM routes (fixture of 10 single-vertex tiles)', async () => {
  const { app } = await serving();
  revisionA = await shared.publish(tilesDocument(tilesA), tilesA);
  assert.equal(app.gmContent.snapshot().revisionId, revisionA.revisionId);
  assert.equal(revisionA.content.terrain.tiles.length, 10);
});

test('the loader fetches every tile through the route, verifies and installs the compiled terrain, then reinstalls it with the same tiles', async () => {
  const { httpBase } = await serving(), maps = clientMaps(), urls = [];
  const result = await load(httpBase, maps, (url, init) => { urls.push(String(url)); return fetch(url, init); });
  const hashes = revisionA.content.terrain.tiles.map((reference) => reference[2]);
  assert.deepEqual(urls.filter((url) => url.includes(tilePath)).sort(), hashes.map((hash) => `${httpBase}${tilePath}${hash}`).sort());
  assert.equal(result.revisionId, revisionA.revisionId);
  assert.ok(result.tiles instanceof Map && result.tiles.size === 10);
  for (const { bytes } of tilesA) assert.deepEqual(result.tiles.get(sha(bytes)), bytes);
  const document = revisionA.content.document;
  const compiled = projectGmContent(generateWorld(GAME.seed), document, BASE, { tiles: result.tiles });
  assert.deepEqual(maps.client.heights, compiled.heights);
  assert.deepEqual(maps.client.terrain.weights, compiled.terrain.weights);
  assert.notDeepEqual(maps.client.heights, maps.base.heights, 'the terrain changed');
  assert.deepEqual(maps.client.gmContentIdentity, { generation: 1, revisionId: revisionA.revisionId });
  // main.js reinstalls the document after the GM editor closes: the same verified tiles Map rebuilds the same terrain.
  installGmContent(maps.client, maps.base, null, BASE);
  assert.deepEqual(maps.client.heights, maps.base.heights);
  installGmContent(maps.client, maps.base, document, BASE, { tiles: result.tiles });
  assert.deepEqual(maps.client.heights, compiled.heights);
  // The base answer and a v2-v4 loader keep their shape: tiles is null.
  const baseOnly = await loadGmWorldContent({ httpBase: `${httpBase}/`, map: { ...maps.base }, baseMap: maps.base,
    gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, generation: 0, revisionId: null, revision: null })) });
  assert.equal(baseOnly.tiles, null);
});

test('a tampered tile byte, a wrong length, a missing tile, a tampered heights or materials hash and a tampered metadata each reject with content_terrain', async (t) => {
  const { httpBase } = await serving();
  const [first] = revisionA.content.terrain.tiles, hash = first[2];
  const tileResponse = async (url, init, change) => {
    const real = await fetch(url, init);
    if (!String(url).endsWith(hash)) return real;
    return change(new Uint8Array(await real.arrayBuffer()));
  };
  // A tampered content.terrain needs a revision id that still verifies, so the id is recomputed over the changed content.
  const contentResponse = (change) => async (url, init) => {
    if (!String(url).includes(tilePath)) {
      const body = await (await fetch(url, init)).json(), revision = structuredClone(body.revision);
      change(revision.content.terrain);
      revision.revisionId = body.revisionId = await gmContentHash(revision.content);
      return new Response(JSON.stringify({ ...body, revision }));
    }
    return fetch(url, init);
  };
  const flip = (hex) => (hex[0] === 'a' ? 'b' : 'a') + hex.slice(1);
  const cases = {
    'tile byte': (url, init) => tileResponse(url, init, (bytes) => { bytes[bytes.length - 1] ^= 1; return new Response(bytes); }),
    'tile length': (url, init) => tileResponse(url, init, (bytes) => new Response(bytes.subarray(0, bytes.length - 1))),
    'tile 404': (url, init) => tileResponse(url, init, () => new Response('gone', { status: 404 })),
    'tile network': (url, init) => tileResponse(url, init, () => { throw new TypeError('connection reset'); }),
    'heightsSha256': contentResponse((terrain) => { terrain.heightsSha256 = flip(terrain.heightsSha256); }),
    'materialsSha256': contentResponse((terrain) => { terrain.materialsSha256 = flip(terrain.materialsSha256); }),
    'extra key': contentResponse((terrain) => { terrain.extra = 1; }),
    'format': contentResponse((terrain) => { terrain.format = 'other'; }),
    'tiles list': contentResponse((terrain) => { terrain.tiles = terrain.tiles.slice(1); }),
  };
  // The cause each case must name, so a rejection by another check cannot pass for it.
  const causes = { 'tile byte': /hash/, 'tile length': /length/, 'tile 404': /answered 404/, 'tile network': /fetch failed.*connection reset/,
    heightsSha256: /heights hash/, materialsSha256: /materials hash/, 'extra key': /metadata/, format: /metadata/, 'tiles list': /metadata/ };
  for (const [name, fetchImpl] of Object.entries(cases)) await t.test(name, async () => {
    const maps = clientMaps();
    await assert.rejects(load(httpBase, maps, fetchImpl), { code: 'content_terrain', message: causes[name] });
    assert.equal(maps.client.gmContentIdentity, undefined, 'nothing installed');
    assert.equal(maps.client.heights, maps.base.heights);
  });
});

test('the loader keeps at most 6 tile requests in flight', async () => {
  const { httpBase } = await serving(), maps = clientMaps();
  let flying = 0, peak = 0, total = 0;
  await load(httpBase, maps, async (url, init) => {
    if (!String(url).includes(tilePath)) return fetch(url, init);
    flying++; total++; peak = Math.max(peak, flying);
    try { await new Promise((resolve) => setTimeout(resolve, 15)); return await fetch(url, init); } finally { flying--; }
  });
  assert.equal(total, 10);
  assert.equal(peak, 6);
});

test('the route serves an active tile with immutable cache headers, an ETag, 304, gzip and identity bodies and HEAD without a body', async (t) => {
  const { httpBase, app } = await serving();
  const { bytes } = tilesA[1], hash = sha(bytes), url = `${httpBase}${tilePath}${hash}`;
  assert.deepEqual(app.gmContent.terrainTile(hash), bytes);
  assert.equal(app.gmContent.terrainTile('0'.repeat(64)), null);

  const plain = await raw(url, { headers: { 'accept-encoding': 'identity' } });
  assert.equal(plain.status, 200);
  assert.deepEqual(new Uint8Array(plain.body), bytes);
  assert.equal(plain.headers['content-type'], 'application/octet-stream');
  assert.equal(plain.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(plain.headers.etag, `"${hash}"`);
  assert.equal(plain.headers.vary, 'accept-encoding');
  assert.equal(plain.headers['x-content-type-options'], 'nosniff');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers['content-length'], String(bytes.length));

  const zipped = await raw(url, { headers: { 'accept-encoding': 'br, gzip;q=0.8' } });
  assert.equal(zipped.status, 200);
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.headers.etag, `"${hash}"`);
  assert.deepEqual(new Uint8Array(gunzipSync(zipped.body)), bytes);
  assert.equal(zipped.headers['content-length'], String(zipped.body.length));
  t.diagnostic(`test tile: ${bytes.length} bytes raw, ${zipped.body.length} bytes gzip (ratio ${(zipped.body.length / bytes.length).toFixed(3)})`);
  assert.deepEqual(new Uint8Array((await raw(url, { headers: { 'accept-encoding': 'gzip;q=0' } })).body), bytes, 'q=0 refuses gzip');
  // The fetch of a browser (default Accept-Encoding) reads the exact bytes after its own gunzip.
  assert.deepEqual(new Uint8Array(await (await fetch(url)).arrayBuffer()), bytes);

  for (const header of [`"${hash}"`, `W/"${hash}"`, `"x", "${hash}"`, '*']) {
    const cached = await raw(url, { headers: { 'if-none-match': header, 'accept-encoding': 'gzip' } });
    assert.equal(cached.status, 304, header);
    assert.equal(cached.body.length, 0);
    assert.equal(cached.headers.etag, `"${hash}"`);
    assert.equal(cached.headers['cache-control'], 'public, max-age=31536000, immutable');
  }
  assert.equal((await raw(url, { headers: { 'if-none-match': '"other"' } })).status, 200);

  const head = await raw(url, { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-encoding'], 'gzip');
  assert.equal(head.headers['content-length'], String(zipped.body.length));
  assert.equal(head.headers.etag, `"${hash}"`);
});

test('the route answers 404 with no-store for a malformed or unknown hash and 405 for another method', async () => {
  const { httpBase } = await serving();
  const known = sha(tilesA[0].bytes);
  for (const hash of ['xyz', 'A'.repeat(64), known.toUpperCase(), 'a'.repeat(63), `${known}0`, 'f'.repeat(64), '', `${known}/x`]) {
    const answer = await raw(`${httpBase}${tilePath}${hash}`);
    assert.equal(answer.status, 404, hash);
    assert.equal(answer.headers['cache-control'], 'no-store');
    assert.equal(answer.headers['content-type'], undefined);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const answer = await raw(`${httpBase}${tilePath}${known}`, { method });
    assert.equal(answer.status, 405, method);
    assert.equal(answer.headers.allow, 'GET, HEAD');
  }
});

test('after activating another revision the old hashes answer 404 at once, and a rollback to the base serves none', async () => {
  const { httpBase, app } = await serving();
  const oldHash = sha(tilesA[1].bytes), newHash = sha(tilesB[0].bytes);
  assert.equal((await raw(`${httpBase}${tilePath}${oldHash}`, { headers: { 'accept-encoding': 'gzip' } })).status, 200);
  assert.equal((await raw(`${httpBase}${tilePath}${newHash}`)).status, 404, 'not active yet');
  const revisionB = await shared.publish(tilesDocument(tilesB), tilesB);
  for (const { bytes } of tilesA) assert.equal((await raw(`${httpBase}${tilePath}${sha(bytes)}`, { headers: { 'accept-encoding': 'gzip' } })).status, 404);
  assert.equal(app.gmContent.terrainTile(oldHash), null);
  const served = await raw(`${httpBase}${tilePath}${newHash}`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(served.status, 200);
  assert.deepEqual(new Uint8Array(gunzipSync(served.body)), tilesB[0].bytes);
  assert.equal(app.gmContent.snapshot().revisionId, revisionB.revisionId);
  await shared.activate(null);
  assert.equal((await raw(`${httpBase}${tilePath}${newHash}`)).status, 404);
  assert.equal(app.gmContent.terrainTile(newHash), null);
  // The old revision comes back with its own tiles.
  await shared.activate(revisionA.revisionId);
  assert.equal((await raw(`${httpBase}${tilePath}${oldHash}`)).status, 200);
  assert.equal((await raw(`${httpBase}${tilePath}${newHash}`)).status, 404);
});

test('a server without a content service answers 404 for the tile route', async () => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 12345, bots: 0, dev: false, log() {}, store: createMemoryStore() });
  const base = `http://127.0.0.1:${await app.listen()}`;
  try { assert.equal((await raw(`${base}${tilePath}${'a'.repeat(64)}`)).status, 404); }
  finally { await app.close(); }
});
