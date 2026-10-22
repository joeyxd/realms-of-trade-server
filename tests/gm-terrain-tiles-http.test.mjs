// GM07b2b: draft terrain tiles over HTTP. POST /api/gm/terrain-tiles (frames of u32 LE length + MNT1 bytes, every
// tile checked against the map rules of the base revision), POST /api/gm/terrain-tiles/read, v5 save with
// tiles_missing and the same operation id after the upload, v5 load, v5 prepare with its stored tiles (GM07b2c), the readiness gate
// terrain_tiles_not_ready (v5 only) and the /status flag gmTerrainTiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDocument } from '../src/editor/document.js';
import { terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { decodeTile, encodeTile, TERRAIN_TILES_NOT_READY, TILE_VERTICES } from '../src/editor/terrainTiles.js';
import { paintTerrainDocument } from '../src/editor/terrainPaint.js';
import { createGmDraftHandler } from '../server/gmDraftHttp.mjs';
import { createGmDraftValidator, createGmTerrainTileValidator } from '../server/gmDraftValidation.mjs';
import { createMemoryGmDraftMethods } from '../server/gmDraftStore.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createGameServer } from '../server/index.mjs';

const BASE = 'terrain-s21-v1';
const GM = '50000000-0000-4000-8000-000000000001';
const PLAYER = '50000000-0000-4000-8000-000000000002';
const OP = '60000000-0000-4000-8000-000000000001';
const OP2 = '60000000-0000-4000-8000-000000000002';
const WORLD = 'tiles-http';
const map = generateWorld(GAME.seed);
const mask = terrainEditableMask(map);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const auth = (token = 'gm') => ({ authorization: `Bearer ${token}` });
const binary = (token = 'gm') => ({ ...auth(token), 'content-type': 'application/octet-stream' });
const json = (token = 'gm') => ({ ...auth(token), 'content-type': 'application/json' });

// A free editable vertex (map rules allow an edit there) and a protected one (base ground below 0.75 m), both off
// the outer ring, as tile key and local index.
function vertexWhere(test) {
  for (let j = 2; j < TERRAIN_GRID_SIZE - 2; j++) for (let i = 2; i < TERRAIN_GRID_SIZE - 2; i++) {
    const x = i - 280, z = j - 280, tx = Math.floor(x / 70), tz = Math.floor(z / 70), u = x - 70 * tx, v = z - 70 * tz;
    if (u < 1 || v < 1 || u > 68 || v > 68) continue;
    if (test(j * TERRAIN_GRID_SIZE + i, x, z)) return { tx, tz, n: v * 70 + u };
  }
  throw new Error('no vertex');
}
const free = vertexWhere((k) => mask[k] === 1);
const water = vertexWhere((k, x, z) => mask[k] === 0 && map.groundAt(x, z) < 0.5);

function tileAt(at, deltaMm, paint = 0) {
  const deltasMm = new Int32Array(TILE_VERTICES);
  deltasMm[at.n] = deltaMm;
  const weights = new Uint8Array(TILE_VERTICES);
  weights[at.n] = paint;
  return encodeTile({ tx: at.tx, tz: at.tz, deltasMm, channels: paint ? [{ id: 3, weights }] : [] }, BASE);
}
const tileA = tileAt(free, 1000), tileB = tileAt(free, 1500), tileC = tileAt(free, 2000, 40);

// The same content with int32 heights where int16 fits: decodes, but is not the canonical blob.
function widened(bytes) {
  const decoded = decodeTile(bytes, BASE);
  const out = new Uint8Array(12 + TILE_VERTICES * 4);
  out.set(bytes.subarray(0, 12)); out[10] = 2; out[11] = 0;
  const view = new DataView(out.buffer);
  for (let n = 0; n < TILE_VERTICES; n++) view.setInt32(12 + n * 4, decoded.deltasMm[n], true);
  return out;
}

function frames(list) {
  const body = Buffer.alloc(list.reduce((size, bytes) => size + 4 + bytes.length, 0));
  let offset = 0;
  for (const bytes of list) { body.writeUInt32LE(bytes.length, offset); body.set(bytes, offset + 4); offset += 4 + bytes.length; }
  return body;
}
function readFrames(buffer) {
  const list = [];
  for (let offset = 0; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset);
    list.push(new Uint8Array(buffer.subarray(offset + 4, offset + 4 + length)));
    offset += 4 + length;
  }
  return list;
}
const tilesDocument = (tiles) => createDocument({ seed: map.seed, baseRevision: BASE,
  terrain: { version: 3, tileSize: 70, tiles: [...tiles].sort((a, b) => a.tz - b.tz || a.tx - b.tx)
    .map(({ tx, tz, bytes }) => [tx, tz, sha(bytes), bytes.length]) } });
const referenceOf = (bytes) => { const { tx, tz } = decodeTile(bytes, BASE); return { tx, tz, bytes }; };

function fixture({ ready = true } = {}) {
  const memory = createMemoryGmDraftMethods(), calls = { put: 0, get: 0, save: 0 }, builds = [];
  const store = { durable: true, ...memory,
    async checkGmTerrainTiles() { if (!store.tilesReady) throw new Error('SQL042 absent'); return { version: 1 }; },
    async putTerrainTiles(input) { calls.put++; return memory.putTerrainTiles(input); },
    async getTerrainTiles(input) { calls.get++; return memory.getTerrainTiles(input); },
    async saveGmDraft(input) { calls.save++; return memory.saveGmDraft(input); },
    tilesReady: ready };
  const handler = createGmDraftHandler({ store, resolvePlayer: async (_req, { token }) => token === 'gm' ? GM : token === 'player' ? PLAYER : null,
    accountIds: [GM], worldId: WORLD, seed: map.seed, baseRevision: BASE,
    validateReferences: createGmDraftValidator({ map, baseRevision: BASE, manifest: [], editorCatalog: [] }),
    validateTile: createGmTerrainTileValidator({ map, baseRevision: BASE }),
    // GM07b2c: the build gets the tiles prepare read from the store; this stub answers a report without revision.
    publication: { async prepare() {}, async build(input) {
      builds.push(input);
      return { report: { valid: false, issues: [{ severity: 'error', code: 'stub' }],
        summary: { edits: 0, errors: 1, warnings: 0, totalIssues: 1, omittedIssues: 0 } }, revision: null };
    } } });
  return { handler, store, memory, calls, builds };
}

async function serve(handler, run) {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    void handler.handle(req, res, { prepareRevision: path === '/api/gm/prepare',
      uploadTiles: path === '/api/gm/terrain-tiles', readTiles: path === '/api/gm/terrain-tiles/read' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const upload = (url, body, headers = binary()) => fetch(`${url}/api/gm/terrain-tiles`, { method: 'POST', headers, body });
const read = (url, hashes, headers = json()) => fetch(`${url}/api/gm/terrain-tiles/read`, { method: 'POST', headers,
  body: JSON.stringify({ hashes }) });
const put = (url, document, operationId = OP, expectedRevision = 0) => fetch(`${url}/api/gm/draft`, { method: 'PUT',
  headers: json(), body: JSON.stringify({ operationId, expectedRevision, document }) });
const stored = async (memory, list) => (await memory.getTerrainTiles({ world: WORLD, hashes: list.map(sha) })).size;

test('the fixture tiles are what they claim: a free vertex passes the map rules, a protected one does not', () => {
  const validate = createGmTerrainTileValidator({ map, baseRevision: BASE });
  for (const bytes of [tileA, tileB, tileC]) assert.deepEqual(validate(bytes), { tx: free.tx, tz: free.tz });
  assert.throws(() => validate(tileAt(water, 1000)), (error) => error.code === 'tile_invalid' && /^protected_/.test(error.reason));
  assert.throws(() => validate(tileAt(free, 250000)), (error) => error.code === 'tile_invalid' && error.reason === 'height_range');
  assert.throws(() => validate(widened(tileA)), (error) => error.code === 'tile_invalid' && error.reason === 'tile_height_canonical');
});

test('upload needs GM auth and POST, reads frames in order and answers the hashes in request order', async () => {
  const { handler, memory, calls } = fixture();
  assert.equal(await handler.prepare(), true);
  await serve(handler, async (url) => {
    const guest = await upload(url, frames([tileA]), { 'content-type': 'application/octet-stream' });
    assert.equal(guest.status, 401);
    const player = await upload(url, frames([tileA]), binary('player'));
    assert.equal(player.status, 403);
    const method = await fetch(`${url}/api/gm/terrain-tiles`, { headers: auth() });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('allow'), 'POST');
    const type = await upload(url, frames([tileA]), json());
    assert.equal(type.status, 415);
    assert.equal(calls.put, 0);
    assert.equal(await stored(memory, [tileA]), 0);

    const response = await upload(url, frames([tileC, tileA, tileB, tileA]));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true, stored: 3, hashes: [sha(tileC), sha(tileA), sha(tileB), sha(tileA)] });
    assert.equal(await stored(memory, [tileA, tileB, tileC]), 3);
  });
});

test('uploads over 64 tiles or 4 MiB, a truncated frame, a non-canonical tile and a map-rule breach store nothing', async () => {
  const { handler, memory, calls } = fixture();
  assert.equal(await handler.prepare(), true);
  const refused = async (response, status, body) => {
    assert.equal(response.status, status);
    const answer = await response.json();
    for (const [key, value] of Object.entries(body)) assert.deepEqual(answer[key], value, key);
    assert.equal(answer.ok, false);
    return answer;
  };
  await serve(handler, async (url) => {
    const many = Array.from({ length: 65 }, (_, n) => tileAt(free, 1000 + n));
    await refused(await upload(url, frames(many)), 400, { code: 'tile_batch' });
    const oversize = Buffer.alloc(64 * 4 + 4 * 1024 * 1024 + 1);
    await refused(await upload(url, oversize), 413, { code: 'size' });
    // Without content-length (chunked) the reader stops at the same bound.
    const chunked = await new Promise((resolve, reject) => {
      const request = http.request(`${url}/api/gm/terrain-tiles`, { method: 'POST', headers: binary() }, (response) => {
        const parts = []; response.on('data', (part) => parts.push(part));
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(parts).toString()) }));
      });
      request.on('error', reject);
      const piece = Buffer.alloc(256 * 1024);
      for (let n = 0; n < 17; n++) request.write(piece);
      request.end();
    });
    assert.equal(chunked.status, 413);
    assert.deepEqual(chunked.body, { ok: false, code: 'size' });
    const truncated = Buffer.concat([frames([tileA]), Buffer.from([100, 0, 0, 0, 1, 2, 3])]);
    await refused(await upload(url, truncated), 400, { code: 'input' });
    await refused(await upload(url, Buffer.alloc(0)), 400, { code: 'input' });
    await refused(await upload(url, frames([tileA, widened(tileB)])), 400, { code: 'tile_invalid', index: 1,
      reason: 'tile_height_canonical' });
    const protectedAnswer = await refused(await upload(url, frames([tileA, tileAt(water, 1000)])), 400,
      { code: 'tile_invalid', index: 1 });
    assert.match(protectedAnswer.reason, /^protected_/);
    await refused(await upload(url, frames([tileB, tileAt(free, 250000)])), 400,
      { code: 'tile_invalid', index: 1, reason: 'height_range' });
    // A tile of another domain key outside the map is no MNT1 tile of this base either.
    const outside = new Uint8Array(tileA); new DataView(outside.buffer).setInt16(6, 9, true);
    await refused(await upload(url, frames([outside])), 400, { code: 'tile_invalid', reason: 'tile_key' });
  });
  assert.equal(calls.put, 0);
  assert.equal(await stored(memory, [tileA, tileB]), 0);
  const many = Array.from({ length: 65 }, (_, n) => tileAt(free, 1000 + n));
  assert.equal(await stored(memory, many.slice(0, 64)) + await stored(memory, many.slice(64)), 0);
});

test('read answers frames in request order and 404 tiles_missing with the list; it shares the rate limit', async () => {
  const { handler } = fixture();
  assert.equal(await handler.prepare(), true);
  await serve(handler, async (url) => {
    assert.equal((await upload(url, frames([tileA, tileB, tileC]))).status, 200);
    const response = await read(url, [sha(tileC), sha(tileA), sha(tileB)]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const list = readFrames(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(list.map((bytes) => sha(bytes)), [sha(tileC), sha(tileA), sha(tileB)]);
    assert.deepEqual(list[0], tileC);

    const absent = sha(tileAt(free, 2500));
    const missing = await read(url, [sha(tileA), absent]);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { ok: false, code: 'tiles_missing', why: 'tiles_missing', missing: [absent] });
    assert.equal((await read(url, [sha(tileA), sha(tileA)])).status, 400);
    assert.equal((await read(url, ['A'.repeat(64)])).status, 400);
    assert.equal((await read(url, Array.from({ length: 65 }, (_, n) => n.toString(16).padStart(64, '0')))).status, 400);
    assert.equal((await read(url, [sha(tileA)], auth())).status, 415);
    assert.equal((await read(url, [sha(tileA)], { 'content-type': 'application/json' })).status, 401);
  });

  // One budget of 30 requests per 60 s per account counts uploads, reads and drafts alike.
  const rate = fixture();
  assert.equal(await rate.handler.prepare(), true);
  await serve(rate.handler, async (url) => {
    for (let n = 0; n < 10; n++) assert.equal((await upload(url, frames([tileA]))).status, 200);
    for (let n = 0; n < 10; n++) assert.equal((await read(url, [sha(tileA)])).status, 200);
    for (let n = 0; n < 10; n++) assert.equal((await fetch(`${url}/api/gm/draft`, { headers: auth() })).status, 200);
    const uploadLimited = await upload(url, frames([tileB]));
    assert.equal(uploadLimited.status, 429);
    assert.deepEqual(await uploadLimited.json(), { ok: false, code: 'gm_draft_rate' });
    assert.equal((await read(url, [sha(tileA)])).status, 429);
  });
  assert.equal(await stored(rate.memory, [tileB]), 0);
});

test('v5 save answers 409 tiles_missing, then the same operation id saves after the upload; load returns it; prepare reads its tiles', async () => {
  const { handler, calls, builds } = fixture();
  assert.equal(await handler.prepare(), true);
  const document = tilesDocument([referenceOf(tileC)]);
  await serve(handler, async (url) => {
    const missing = await put(url, document);
    assert.equal(missing.status, 409);
    assert.deepEqual(await missing.json(), { ok: false, code: 'tiles_missing', why: 'tiles_missing', missing: [sha(tileC)] });
    assert.equal((await upload(url, frames([tileC]))).status, 200);
    const saved = await put(url, document);
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.replay, false);
    assert.equal(body.head.revision, 1);
    assert.deepEqual(body.head.document, document);
    const replay = await put(url, document);
    assert.equal((await replay.json()).replay, true);

    const loaded = await fetch(`${url}/api/gm/draft`, { headers: auth() });
    assert.equal(loaded.status, 200);
    const head = (await loaded.json()).head;
    assert.equal(head.revision, 1);
    assert.deepEqual(head.document, document);

    const reads = calls.get;
    const prepare = await fetch(`${url}/api/gm/prepare`, { method: 'POST', headers: json(), body: JSON.stringify({ expectedRevision: 1 }) });
    assert.equal(prepare.status, 200);
    assert.equal((await prepare.json()).preparation.revision, null);
    assert.equal(calls.get, reads + 1, 'one store read for the tiles');
    assert.equal(builds.length, 1);
    assert.deepEqual([...builds[0].tiles.keys()], [sha(tileC)]);
    assert.equal(Buffer.compare(Buffer.from(builds[0].tiles.get(sha(tileC))), Buffer.from(tileC)), 0);

    // The structure is still checked: a tile reference outside the map is no document.
    const bad = structuredClone(document); bad.terrain.tiles[0][0] = 9;
    assert.equal((await put(url, bad, OP2, 1)).status, 400);
  });
  assert.equal(calls.save, 3);
});

test('without SQL042 a v5 save, upload and read answer terrain_tiles_not_ready while a v4 save still works', async () => {
  const { handler, calls } = fixture({ ready: false });
  assert.equal(await handler.prepare(), true);
  let center = null;
  for (let k = 0; k < mask.length && !center; k++) {
    const i = k % TERRAIN_GRID_SIZE, j = (k - i) / TERRAIN_GRID_SIZE;
    if (i < 8 || j < 8 || i > 552 || j > 552) continue;
    let open = true;
    for (let dz = -6; dz <= 6 && open; dz++) for (let dx = -6; dx <= 6; dx++) if (!mask[k + dz * TERRAIN_GRID_SIZE + dx]) { open = false; break; }
    if (open) center = { x: i - 280, z: j - 280 };
  }
  const v4 = paintTerrainDocument({ map, document: createDocument({ seed: map.seed, baseRevision: BASE }), baseRevision: BASE,
    points: [center, { x: center.x + 1, z: center.z }], radius: 2, strength: 1, falloff: .5, material: 'sand' });
  assert.equal(v4.version, 4);
  await serve(handler, async (url) => {
    for (const response of [await put(url, tilesDocument([referenceOf(tileA)])), await upload(url, frames([tileA])),
      await read(url, [sha(tileA)])]) {
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, code: TERRAIN_TILES_NOT_READY });
    }
    const saved = await put(url, v4, OP2);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).head.document.version, 4);
  });
  assert.deepEqual(calls, { put: 0, get: 0, save: 1 });
});

test('the game server mounts the tile routes and /status reports gmTerrainTiles true and false', async () => {
  for (const ready of [true, false]) {
    const store = createMemoryStore();
    if (!ready) store.checkGmTerrainTiles = async () => { throw new Error('SQL042 absent'); };
    const server = createGameServer({ port: 0, host: '127.0.0.1', seed: map.seed, bots: 0, worldId: WORLD, store,
      resolvePlayer: async (_req, { token }) => token === 'gm' ? GM : null, gmAccountIds: [GM], gmDraftsAllowMemory: true,
      saveSecret: 'gm-terrain-tiles-http-only', log() {} });
    const port = await server.listen();
    try {
      const url = `http://127.0.0.1:${port}`;
      const status = await (await fetch(`${url}/status`)).json();
      assert.equal(status.storage.gmTerrainTiles, ready);
      const response = await upload(url, frames([tileA]));
      if (ready) {
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).hashes, [sha(tileA)]);
        const back = await read(url, [sha(tileA)]);
        assert.deepEqual(readFrames(Buffer.from(await back.arrayBuffer())), [tileA]);
      } else {
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { ok: false, code: TERRAIN_TILES_NOT_READY });
      }
    } finally { await server.close(); }
  }
});
