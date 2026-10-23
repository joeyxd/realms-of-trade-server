// Real browser QA for GM07b2d (T-1022-40): a fresh guest player loads a whole-map terrain-tile (v5) revision.
// A local game server publishes a v5 document that edits every tile that can hold an edit through the GM routes (upload, draft, prepare,
// register, activate); a fresh Chrome context then boots as a guest and must fetch every tile from the immutable tile
// route, verify and compile them, and show the compiled heights. The evidence records bytes, timings and cache outcome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { createDocument } from '../src/editor/document.js';
import { createTerrainGrid, terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { compileTerrainTiles, gridToTiles } from '../src/editor/terrainTiles.js';

const out = resolve(process.env.MN_GM07_QA_OUTPUT || '.scratch/t1022-40/gm07-player-load');
const evidencePath = resolve(out, 'evidence.json');
const GM = '77777777-7777-4777-8777-777777777777';
const BASE = 'terrain-s21-v1', WORLD = 'gm07-player-load-qa';
const TILE_PATH = '/api/world/terrain-tiles/';
const evidence = { schema: 'gm07-player-load/v1', version: GAME.version, protocolVersion: PROTOCOL_VERSION, node: process.version,
  browser: null, screenshots: [], checks: [], errors: [], publish: {}, load: {}, secondNavigation: {} };
let game, browser, context, page, tempDirectory, phase = 'initializing';

async function check(name, fn) { await fn(); evidence.checks.push(name); console.log(`PASS ${name}`); }
const round = (value) => Math.round(value * 10) / 10;

// A smooth ground swell on every editable vertex (1 to 3 m), so each tile holds its own bytes. The edit policy keeps
// the ocean and every protected vertex at zero, so only the tiles over dry ground (25 of the 64 on this seed) can hold one.
function wholeMapGrid(map) {
  const mask = terrainEditableMask(map), grid = createTerrainGrid();
  for (let j = 0; j < TERRAIN_GRID_SIZE; j++) for (let i = 0; i < TERRAIN_GRID_SIZE; i++) {
    const k = j * TERRAIN_GRID_SIZE + i, x = i - 280, z = j - 280;
    if (mask[k]) grid.deltasMm[k] = Math.round(2000 + 1000 * Math.sin(x / 23) * Math.cos(z / 31));
  }
  return { grid, mask };
}

// The editable vertex nearest to each target, one per target (the targets lie in different tiles).
function editedPoints(mask, targets) {
  return targets.map(([tx, tz]) => {
    let best = null;
    for (let j = 0; j < TERRAIN_GRID_SIZE; j++) for (let i = 0; i < TERRAIN_GRID_SIZE; i++) {
      const k = j * TERRAIN_GRID_SIZE + i;
      if (!mask[k]) continue;
      const distance = Math.hypot(i - 280 - tx, j - 280 - tz);
      if (!best || distance < best.distance) best = { index: k, x: i - 280, z: j - 280, distance };
    }
    return { index: best.index, x: best.x, z: best.z };
  });
}

// The upload body: repeated u32 little-endian length + tile bytes.
function frames(list) {
  const body = Buffer.alloc(list.reduce((size, bytes) => size + 4 + bytes.length, 0));
  let offset = 0;
  for (const bytes of list) { body.writeUInt32LE(bytes.length, offset); body.set(bytes, offset + 4); offset += 4 + bytes.length; }
  return body;
}

try {
  phase = 'local_server_and_publication';
  await mkdir(out, { recursive: true });
  // The content registry lives inside this folder (the QA writes nowhere else) and is removed at the end.
  tempDirectory = await mkdtemp(resolve(out, 'registry-'));
  const store = { ...createMemoryStore(), durable: true, async checkGmTerrainTiles() { return { version: 1 }; } };
  game = createGameServer({ port: 0, host: '127.0.0.1', seed: GAME.seed, bots: 0, dev: false, log: () => {}, worldId: WORLD,
    worldSaveMs: 60_000, store, resolvePlayer: async (_req, hello) => hello.token === 'gm' ? GM : null, gmAccountIds: [GM],
    gmDraftsAllowMemory: true, gmContentDirectory: resolve(tempDirectory, 'content'),
    gmContentLock: { async run(callback) { return callback({ assertHeld() {} }); } } });
  const origin = `http://127.0.0.1:${await game.listen()}`;
  // Every tile request that reaches the server, by navigation (1 = the first load, 2 = the second one).
  let visit = 1;
  const serverTiles = [];
  game.server.on('request', (req, res) => {
    const path = new URL(req.url, origin).pathname;
    if (path.startsWith(TILE_PATH)) res.on('finish', () => serverTiles.push({ visit, sha256: path.slice(TILE_PATH.length), status: res.statusCode }));
  });
  const status = await (await fetch(`${origin}/status`, { cache: 'no-store' })).json();
  assert.equal(status.version, GAME.version);

  const map = generateWorld(GAME.seed);
  const { grid, mask } = wholeMapGrid(map);
  const { tiles, blobs } = await gridToTiles(grid, BASE);
  const rawBytes = tiles.reduce((sum, reference) => sum + reference[3], 0);
  const document = createDocument({ seed: map.seed, baseRevision: BASE, terrain: { version: 3, tileSize: 70, tiles } });
  const compiled = compileTerrainTiles(map, { tiles, blobs }, BASE);
  const editableTiles = new Set();
  for (let k = 0; k < mask.length; k++) if (mask[k]) {
    const i = k % TERRAIN_GRID_SIZE - 280, j = Math.floor(k / TERRAIN_GRID_SIZE) - 280;
    editableTiles.add(`${Math.floor(i / 70)},${Math.floor(j / 70)}`);
  }
  assert.equal(tiles.length, editableTiles.size, 'the fixture edits every tile that can hold an edit');
  const tileCount = tiles.length;
  evidence.mapTiles = 64; evidence.editableTiles = editableTiles.size;
  const points = editedPoints(mask, [[-200, -200], [10, -30], [190, 180]]);
  for (const point of points) assert.notEqual(compiled.heights[point.index], map.heights[point.index], 'the point is edited');

  const post = async (route, body, method = 'POST') => {
    const started = performance.now();
    const response = await fetch(`${origin}${route}`, { method, body: JSON.stringify(body),
      headers: { authorization: 'Bearer gm', 'content-type': 'application/json' } });
    const text = await response.text();
    assert.equal(response.status, 200, `${route} answered ${response.status}: ${text.slice(0, 300)}`);
    return { body: JSON.parse(text), ms: round(performance.now() - started) };
  };
  let started = performance.now();
  const upload = await fetch(`${origin}/api/gm/terrain-tiles`, { method: 'POST',
    headers: { authorization: 'Bearer gm', 'content-type': 'application/octet-stream' }, body: frames(tiles.map((reference) => blobs.get(reference[2]))) });
  assert.equal(upload.status, 200, await upload.clone().text());
  const uploadMs = round(performance.now() - started);
  const saved = await post('/api/gm/draft', { operationId: '50000000-0000-4000-8000-000000000001', expectedRevision: 0, document }, 'PUT');
  const prepared = await post('/api/gm/prepare', { expectedRevision: 1 });
  assert.equal(prepared.body.preparation.report.valid, true, JSON.stringify(prepared.body.preparation.report).slice(0, 400));
  const revision = prepared.body.preparation.revision;
  const registered = await post('/api/gm/revisions', { expectedRevision: 1, revisionId: revision.revisionId });
  const activated = await post('/api/gm/activate', { operationId: '50000000-0000-4000-8000-000000000002', expectedGeneration: 0, revisionId: revision.revisionId });
  evidence.publish = { tiles: tiles.length, rawBytes, uploadMs, saveMs: saved.ms, prepareMs: prepared.ms, registerMs: registered.ms, activateMs: activated.ms,
    revisionId: revision.revisionId };
  assert.equal(game.gmContent.snapshot().revisionId, revision.revisionId);

  phase = 'browser_setup';
  const playwrightPath = resolve(process.env.MN_PLAYWRIGHT || '../realms-of-trade-server/.scratch/pilot-browser/node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=default', '--enable-webgl', '--ignore-gpu-blocklist'] });
  evidence.browser = `Chrome ${browser.version()}`;
  // A new context holds no cache and no storage: this is a first-time player.
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const cdnPattern = /https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(three@0\.160\.0|gsap@3\.12\.5)\/(.*)/;
  const cdnHandler = async (route) => {
    const match = route.request().url().match(/(three@0\.160\.0|gsap@3\.12\.5)\/([^?#]*)/);
    const file = match && resolve(match[1].startsWith('three') ? 'node_modules/three' : (process.env.MN_GSAP || '.scratch/gsap-local/package'), match[2]);
    if (!file || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
  };
  await context.route(cdnPattern, cdnHandler);
  page = await context.newPage();
  page.on('pageerror', (error) => evidence.errors.push(`pageerror:${error.name}:${error.message}`));
  const marks = { content: null, lastTile: null, tiles: [] };
  page.on('response', (response) => { if (new URL(response.url()).pathname === '/api/world/content' && marks.content === null) marks.content = performance.now(); });
  page.on('requestfinished', (request) => {
    if (!new URL(request.url()).pathname.startsWith(TILE_PATH)) return;
    marks.lastTile = performance.now();
    marks.tiles.push((async () => {
      const response = await request.response(), sizes = await request.sizes(), headers = await response.allHeaders();
      return { sha256: new URL(request.url()).pathname.slice(TILE_PATH.length), status: response.status(),
        contentEncoding: headers['content-encoding'] ?? null, cacheControl: headers['cache-control'] ?? null,
        transferredBytes: sizes.responseBodySize };
    })());
  });
  const ready = async () => {
    await page.waitForFunction(() => window.__mn, null, { timeout: 90000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('fade')).display === 'none');
    await page.waitForFunction(() => document.querySelector('#btn-play') && !document.querySelector('#btn-play').disabled);
  };

  phase = 'first_visit_fresh_guest';
  const t0 = performance.now();
  await page.goto(`${origin}/?q=high&tod=day`, { waitUntil: 'domcontentloaded' });
  await ready();
  const readyMs = round(performance.now() - t0);
  const records = await Promise.all(marks.tiles);
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(out, 'world-loaded.png'), animations: 'disabled' });
  evidence.screenshots.push('world-loaded.png');

  const referenced = tiles.map((reference) => reference[2]);
  const loaded = await page.evaluate(({ indexes }) => ({ revisionId: __mn.gmContent.revisionId, generation: __mn.gmContent.generation,
    tiles: [...__mn.gmContent.tiles.keys()], heights: indexes.map((index) => __mn.map.heights[index]), gmTerrain: __mn.map.gmTerrain === true,
    errors: [...__mn.errors] }), { indexes: points.map((point) => point.index) });
  await check('the_fresh_guest_loads_the_activated_revision_with_every_referenced_tile_and_the_compiled_heights', async () => {
    assert.equal(loaded.revisionId, revision.revisionId);
    assert.equal(loaded.gmTerrain, true);
    assert.deepEqual([...loaded.tiles].sort(), [...referenced].sort());
    assert.deepEqual(loaded.heights, points.map((point) => compiled.heights[point.index]));
    assert.deepEqual(loaded.errors, []);
  });
  await check('every_tile_request_went_to_the_tile_route_once_with_status_200_gzip_and_immutable_cache', async () => {
    assert.equal(records.length, tileCount);
    assert.deepEqual(records.map((record) => record.sha256).sort(), [...referenced].sort());
    for (const record of records) {
      assert.equal(record.status, 200, record.sha256);
      assert.equal(record.contentEncoding, 'gzip', record.sha256);
      assert.match(record.cacheControl ?? '', /immutable/, record.sha256);
    }
  });
  const transferredBytes = records.reduce((sum, record) => sum + record.transferredBytes, 0);
  evidence.load = { tiles: records.length, rawBytes, transferredBytes, ratio: Math.round(transferredBytes / rawBytes * 1000) / 1000,
    msContentToLastTile: round(marks.lastTile - marks.content), msToReady: readyMs, msContentToReady: round(t0 + readyMs - marks.content),
    editedPoints: points.map((point, n) => ({ ...point, height: loaded.heights[n], baseHeight: map.heights[point.index] })) };
  assert.equal(serverTiles.filter((tile) => tile.visit === 1).length, tileCount, 'the server answered each tile once');

  // Playwright turns the HTTP cache off while a route is installed (reads, not writes), and the CDN route above is the
  // only one. Drop it, then open a second document in the same context and run the game's own loader in it: the tiles
  // it asks for must come from the cache the first visit filled, or be revalidated with a 304.
  phase = 'second_navigation_same_context';
  await context.unroute(cdnPattern, cdnHandler);
  visit = 2;
  await page.goto(`${origin}/status`, { waitUntil: 'domcontentloaded' });
  const reload = await page.evaluate(async ({ base, path }) => {
    const [{ loadGmWorldContent }, { generateWorld }, { GAME }, { PROTOCOL_VERSION }] = await Promise.all([
      import('/src/editor/activeContent.js'), import('/src/sim/worldgen.js'), import('/src/data/meta.js'), import('/src/net/protocol.js')]);
    const baseMap = generateWorld(GAME.seed), map = { ...baseMap };
    const content = await loadGmWorldContent({ httpBase: base, map, baseMap, gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
    return { revisionId: content.revisionId, tiles: content.tiles.size,
      resources: performance.getEntriesByType('resource').filter((entry) => entry.name.includes(path))
        .map((entry) => ({ transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize })) };
  }, { base: `${origin}/`, path: TILE_PATH });
  const second = serverTiles.filter((tile) => tile.visit === 2);
  const byStatus = {};
  for (const tile of second) byStatus[tile.status] = (byStatus[tile.status] ?? 0) + 1;
  // A resource that cost no bytes on the wire came from the HTTP cache; one that cost headers only was revalidated.
  const fromCache = reload.resources.filter((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0).length;
  const revalidated = reload.resources.filter((entry) => entry.transferSize > 0 && entry.transferSize < entry.encodedBodySize).length;
  const outcome = second.length === 0 ? 'http_cache' : second.every((tile) => tile.status === 304) ? 'revalidated_304' : 'network_200';
  evidence.secondNavigation = { outcome, document: '/status, then loadGmWorldContent of the game', tileResources: reload.resources.length,
    resourceFromCache: fromCache, resourceRevalidated: revalidated, serverTileRequests: second.length, serverStatuses: byStatus,
    revisionId: reload.revisionId, tiles: reload.tiles };
  await check('the_second_navigation_gets_every_tile_from_the_http_cache_or_a_304', async () => {
    assert.equal(reload.revisionId, revision.revisionId);
    assert.equal(reload.tiles, tileCount);
    assert.equal(reload.resources.length, tileCount);
    assert.ok(second.every((tile) => tile.status === 304), `the server must not resend a tile: ${JSON.stringify(byStatus)}`);
    assert.ok(outcome === 'http_cache' ? fromCache === tileCount : second.length === tileCount, JSON.stringify(evidence.secondNavigation));
  });

  assert.deepEqual(evidence.errors, []);
  phase = 'complete';
} catch (error) {
  evidence.phase = phase;
  evidence.errors.push(error?.stack || String(error)); process.exitCode = 1;
  if (page) try { await page.screenshot({ path: resolve(out, 'failure.png'), animations: 'disabled' }); } catch { /* Keep the original failure. */ }
} finally {
  try { await context?.close(); } catch { /* Preserve the first failure. */ }
  try { await browser?.close(); } catch { /* Preserve the first failure. */ }
  try { await game?.close(); } catch { /* The server may not have finished starting. */ }
  try { if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true }); } catch { /* Best effort. */ }
  try { await mkdir(out, { recursive: true }); await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n'); }
  catch (error) { console.error(`Could not write GM07 player-load evidence: ${error.message}`); process.exitCode = 1; }
}
