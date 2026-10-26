// GM07b2b: the editor client of draft terrain tiles, against a fake fetch. A save uploads only the tiles the server is
// not known to hold (batches of 64 tiles / 4 MiB), retries once with the same operation id on tiles_missing and fails
// cleanly on a second one; a pending v5 attempt keeps its tiles in IndexedDB across a reload; a remote v5 head opens
// with the local tiles plus those read from the server, each checked, and a bad tile leaves the current design as is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { createDocument } from '../src/editor/document.js';
import { terrainEditableMask, TERRAIN_GRID_SIZE } from '../src/editor/terrainData.js';
import { decodeTile, encodeTile, TILE_VERTICES } from '../src/editor/terrainTiles.js';
import { openTerrainDocument } from '../src/editor/terrainSession.js';
import { createIndexedDbDraftSource, DraftStore } from '../src/editor/draftStore.js';
import { RemoteDraftClient } from '../src/editor/remoteDraft.js';
import { RemoteDraftPanel } from '../src/editor/remotePanel.js';

const BASE = 'terrain-s21-v1';
const GM = '10000000-0000-4000-8000-000000000001';
const map = generateWorld(GAME.seed);
const scope = { worldId: 'tiles-remote', seed: map.seed, baseRevision: BASE };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const coded = (code) => (error) => error?.code === code;
const clone = (value) => value === undefined ? undefined : structuredClone(value);

// Valid MNT1 tiles: one raised vertex at the first free editable vertex of distinct tiles.
const spots = [];
{
  const mask = terrainEditableMask(map), seen = new Set();
  for (let k = 0; k < mask.length && spots.length < 4; k++) {
    if (!mask[k]) continue;
    const i = k % TERRAIN_GRID_SIZE, j = (k - i) / TERRAIN_GRID_SIZE, x = i - 280, z = j - 280;
    const tx = Math.floor(x / 70), tz = Math.floor(z / 70), u = x - 70 * tx, v = z - 70 * tz;
    if (u < 1 || v < 1 || u > 68 || v > 68 || seen.has(`${tx},${tz}`)) continue;
    seen.add(`${tx},${tz}`); spots.push({ tx, tz, n: v * 70 + u });
  }
}
function tileAt(at, deltaMm) {
  const deltasMm = new Int32Array(TILE_VERTICES);
  deltasMm[at.n] = deltaMm;
  return encodeTile({ tx: at.tx, tz: at.tz, deltasMm, channels: [] }, BASE);
}
const [A, B, C, D] = spots.map((at, n) => tileAt(at, 1000 * (n + 1)));
const tilesOf = (...list) => new Map(list.map((bytes) => [sha(bytes), bytes]));
function v5(list) {
  const references = list.map((bytes) => { const { tx, tz } = decodeTile(bytes, BASE); return [tx, tz, sha(bytes), bytes.length]; })
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return createDocument({ seed: map.seed, baseRevision: BASE, terrain: { version: 3, tileSize: 70, tiles: references } });
}

function frames(list) {
  const body = new Uint8Array(list.reduce((size, bytes) => size + 4 + bytes.length, 0)), view = new DataView(body.buffer);
  let offset = 0;
  for (const bytes of list) { view.setUint32(offset, bytes.length, true); body.set(bytes, offset + 4); offset += 4 + bytes.length; }
  return body;
}
function unframe(body) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const list = [];
  for (let offset = 0; offset < bytes.length;) {
    const length = view.getUint32(offset, true);
    list.push(bytes.slice(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  return list;
}

// The draft and tile routes of gmDraftHttp.mjs, in memory: the contract as the client sees it.
function fakeServer() {
  const server = { tiles: new Map(), head: { revision: 0, document: null, savedAt: null }, receipts: new Map(), requests: [],
    failUploads: false, keepMissing: false, wrong: new Map() };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null },
    async json() { return clone(body); } });
  server.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/api/gm/draft' && init.method === 'GET') {
      server.requests.push({ kind: 'get' });
      return reply(200, { ok: true, durable: true, scope, head: server.head });
    }
    if (path === '/api/gm/draft' && init.method === 'PUT') {
      const operation = JSON.parse(init.body);
      server.requests.push({ kind: 'put', operationId: operation.operationId });
      const receipt = server.receipts.get(operation.operationId);
      if (receipt) return reply(200, { ok: true, durable: true, scope, head: receipt, replay: true });
      const missing = [...new Set((operation.document.terrain?.tiles ?? []).map((reference) => reference[2]))]
        .filter((hash) => server.keepMissing || !server.tiles.has(hash)).sort();
      if (operation.document.version === 5 && missing.length) return reply(409, { ok: false, code: 'tiles_missing', why: 'tiles_missing', missing });
      if (server.head.revision !== operation.expectedRevision) return reply(409, { ok: false, code: 'gm_draft_conflict', revision: server.head.revision });
      server.head = { revision: server.head.revision + 1, document: operation.document, savedAt: '2026-10-22T10:00:00.000Z' };
      server.receipts.set(operation.operationId, server.head);
      return reply(200, { ok: true, durable: true, scope, head: server.head, replay: false });
    }
    if (path === '/api/gm/terrain-tiles' && init.method === 'POST') {
      assert.equal(init.headers['content-type'], 'application/octet-stream');
      const list = unframe(init.body), hashes = list.map(sha);
      server.requests.push({ kind: 'upload', hashes, bytes: list.reduce((size, bytes) => size + bytes.length, 0) });
      if (server.failUploads) throw new TypeError('network');
      for (const bytes of list) server.tiles.set(sha(bytes), bytes);
      return reply(200, { ok: true, stored: new Set(hashes).size, hashes });
    }
    if (path === '/api/gm/terrain-tiles/read' && init.method === 'POST') {
      const { hashes } = JSON.parse(init.body);
      server.requests.push({ kind: 'read', hashes });
      const missing = hashes.filter((hash) => !server.tiles.has(hash));
      if (missing.length) return reply(404, { ok: false, code: 'tiles_missing', why: 'tiles_missing', missing });
      const body = frames(hashes.map((hash) => server.wrong.get(hash) ?? server.tiles.get(hash)));
      return { ok: true, status: 200, headers: { get: (name) => name === 'content-length' ? String(body.length) : null },
        async arrayBuffer() { return body.buffer.slice(0); } };
    }
    throw new Error(`unexpected ${init.method} ${path}`);
  };
  server.kinds = () => server.requests.map((request) => request.kind);
  server.uploads = () => server.requests.filter((request) => request.kind === 'upload').map((request) => [...request.hashes].sort());
  server.puts = () => server.requests.filter((request) => request.kind === 'put').map((request) => request.operationId);
  return server;
}

class MemoryCas {
  value = null;
  async read() { return clone(this.value); }
  async compareAndSwap(_key, expected, next) {
    if ((this.value?.revision ?? 0) !== expected) return false;
    this.value = clone(next); return true;
  }
}
function makeClient({ source = new MemoryCas(), fetchImpl, localScope = 'tab-a' } = {}) {
  const auth = { state: { signedIn: true, accountId: GM }, async sessionIdentity() { return { accountId: GM, token: 'token' }; } };
  return new RemoteDraftClient({ auth, accountId: GM, httpBase: 'https://game.invalid/', localScope, source, fetchImpl });
}
const sorted = (...list) => list.map(sha).sort();

// The in-memory IndexedDB of tests/gm-editor-tiles.test.mjs (copied: test files share no helper module).
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
async function rawDatabase(indexedDB, name = 'marea-gm-drafts-v1') { return done(indexedDB.open(name)); }
async function storedTileKeys(indexedDB, name = 'marea-gm-drafts-v1') {
  const db = await rawDatabase(indexedDB, name), tx = db.transaction('tiles', 'readonly');
  return (await done(tx.objectStore('tiles').getAllKeys())).sort();
}

test('a v5 save uploads only the tiles the server is not known to hold, then saves; a loaded head counts as known', async () => {
  const server = fakeServer(), client = makeClient({ fetchImpl: server.fetch });
  await client.inspect();
  const first = await client.save(v5([A, B]), 0, { tiles: tilesOf(A, B) });
  assert.equal(first.head.revision, 1);
  assert.deepEqual(server.kinds(), ['get', 'upload', 'put']);
  assert.deepEqual(server.uploads(), [sorted(A, B)]);
  await client.save(v5([A, B, C]), 1, { tiles: tilesOf(A, B, C) });
  assert.deepEqual(server.uploads(), [sorted(A, B), sorted(C)]);
  // An unchanged terrain sends no tile at all.
  await client.save(v5([A, B, C]), 2, { tiles: tilesOf(A, B, C) });
  assert.equal(server.uploads().length, 2);

  // A fresh client (another tab) learns A, B and C from the head it loads.
  const fresh = makeClient({ fetchImpl: server.fetch, localScope: 'tab-b' });
  await fresh.inspect();
  await fresh.save(v5([A, B, C, D]), 3, { tiles: tilesOf(A, B, C, D) });
  assert.deepEqual(server.uploads().at(-1), sorted(D));
  assert.equal(server.uploads().length, 3);
  assert.equal(server.head.revision, 4);
  for (const bytes of [A, B, C, D]) assert.deepEqual(server.tiles.get(sha(bytes)), bytes);
});

test('tile uploads split at 64 tiles and at 4 MiB of tile bytes', async () => {
  const server = fakeServer(), client = makeClient({ fetchImpl: server.fetch });
  await client.inspect();
  const small = Array.from({ length: 130 }, (_, n) => Uint8Array.of(n & 255, n >> 8, 7));
  await client._uploadTiles(small.map(sha), tilesOf(...small));
  assert.deepEqual(server.requests.filter((request) => request.kind === 'upload').map((request) => request.hashes.length), [64, 64, 2]);
  const big = Array.from({ length: 10 }, (_, n) => { const bytes = new Uint8Array(1024 * 1024); bytes[0] = n; return bytes; });
  await client._uploadTiles(big.map(sha), tilesOf(...big));
  const bigUploads = server.requests.filter((request) => request.kind === 'upload').slice(3);
  assert.deepEqual(bigUploads.map((request) => request.hashes.length), [4, 4, 2]);
  assert.ok(bigUploads.every((request) => request.bytes <= 4 * 1024 * 1024));
  assert.equal(server.tiles.size, 140);
});

test('tiles_missing uploads the listed tiles and retries once with the same operation id', async () => {
  const server = fakeServer();
  server.tiles = tilesOf(A, B);
  server.head = { revision: 1, document: v5([A, B]), savedAt: '2026-10-22T09:00:00.000Z' };
  const client = makeClient({ fetchImpl: server.fetch });
  await client.inspect();
  // The collector took A after the head moved on elsewhere: this client still believes the server holds it.
  server.tiles.delete(sha(A));
  const saved = await client.save(v5([A, B, C]), 1, { tiles: tilesOf(A, B, C) });
  assert.equal(saved.head.revision, 2);
  assert.deepEqual(server.kinds(), ['get', 'upload', 'put', 'upload', 'put']);
  assert.deepEqual(server.uploads(), [sorted(C), sorted(A)]);
  const [firstPut, secondPut] = server.puts();
  assert.equal(firstPut, secondPut);
  assert.equal(client.pending, null);
});

test('a second tiles_missing, or a tile this browser lacks, fails with its own code and ends the attempt', async () => {
  const source = new MemoryCas(), server = fakeServer(), client = makeClient({ source, fetchImpl: server.fetch });
  await client.inspect();
  server.keepMissing = true;
  await assert.rejects(client.save(v5([A]), 0, { tiles: tilesOf(A) }), (error) => error.code === 'tiles_missing' && error.status === 409);
  assert.deepEqual(server.kinds(), ['get', 'upload', 'put', 'upload', 'put']);
  assert.equal(new Set(server.puts()).size, 1);
  assert.equal(source.value.operation, null);
  assert.equal(client.pending, null);

  // Without every referenced tile nothing is sent or recorded.
  server.keepMissing = false;
  const before = server.requests.length;
  await assert.rejects(client.save(v5([A, B]), 0, { tiles: tilesOf(A) }), coded('local_tile_missing'));
  await assert.rejects(client.save(v5([A]), 0), coded('local_tile_missing'));
  assert.equal(server.requests.length, before);
  assert.equal(source.value.operation, null);

  // A pending attempt whose tile is gone from this browser (a source without a tile store) cannot complete.
  const operation = { operationId: '20000000-0000-4000-8000-000000000009', expectedRevision: 0, document: v5([B]) };
  source.value = { revision: source.value.revision + 1, operation };
  await assert.rejects(client.retry(), coded('local_tile_missing'));
  assert.deepEqual(server.kinds().slice(before), ['put']);
  assert.equal(source.value.operation, null);
});

test('a pending v5 attempt keeps its tiles in IndexedDB and a reloaded client retries it with them', async () => {
  const indexedDB = memoryIndexedDB(), server = fakeServer();
  const source = createIndexedDbDraftSource({ indexedDB });
  const first = makeClient({ source, fetchImpl: server.fetch });
  await first.inspect();
  server.failUploads = true;
  const document = v5([A, B]);
  await assert.rejects(first.save(document, 0, { tiles: tilesOf(A, B) }), coded('unavailable'));
  const pending = (await source.read('remote-pending:tab-a')).operation;
  assert.deepEqual(pending.document, document);
  // The editor then autosaves another design: that tile write drops every tile no record references.
  const store = new DraftStore({ worldId: scope.worldId, source });
  await store.save(v5([C]), { expectedRevision: 0, tiles: tilesOf(C) });
  assert.deepEqual(await storedTileKeys(indexedDB), sorted(A, B, C));

  // Reload: a new source and client on the same database find the attempt and its bytes.
  server.failUploads = false;
  const second = makeClient({ source: createIndexedDbDraftSource({ indexedDB }), fetchImpl: server.fetch });
  await second.inspect();
  assert.equal(second.pending.operationId, pending.operationId);
  const result = await second.retry();
  assert.equal(result.head.revision, 1);
  assert.deepEqual(server.uploads().at(-1), sorted(A, B));
  assert.deepEqual(server.tiles.get(sha(A)), A);
  assert.deepEqual(server.tiles.get(sha(B)), B);
  assert.deepEqual(server.puts().at(-1), pending.operationId);
  assert.equal((await source.read('remote-pending:tab-a')).operation, null);
});

test('a remote v5 head reads only the tiles missing locally, checks them and keeps them in the local tile store', async () => {
  const indexedDB = memoryIndexedDB(), source = createIndexedDbDraftSource({ indexedDB }), server = fakeServer();
  server.tiles = tilesOf(A, B, C);
  server.head = { revision: 1, document: v5([A, B, C]), savedAt: '2026-10-22T09:00:00.000Z' };
  await source.putTiles(tilesOf(A));
  const client = makeClient({ source, fetchImpl: server.fetch });
  await client.inspect();
  const tiles = await client.headTiles(server.head.document);
  const reads = server.requests.filter((request) => request.kind === 'read');
  assert.equal(reads.length, 1);
  assert.deepEqual([...reads[0].hashes].sort(), sorted(B, C));
  assert.deepEqual(tiles, tilesOf(A, B, C));
  assert.deepEqual(await source.readTiles(sorted(B, C)), tilesOf(B, C));
  // A second open finds everything locally.
  await client.headTiles(server.head.document);
  assert.equal(server.requests.filter((request) => request.kind === 'read').length, 1);
  // A missing tile answers tiles_missing.
  server.head = { revision: 2, document: v5([A, D]), savedAt: '2026-10-22T09:30:00.000Z' };
  await assert.rejects(client.headTiles(server.head.document), (error) => error.code === 'tiles_missing' &&
    error.status === 404 && error.missing[0] === sha(D));
});

test('a wrong tile hash aborts a remote load and leaves the current document untouched; a good head opens', async () => {
  const indexedDB = memoryIndexedDB(), source = createIndexedDbDraftSource({ indexedDB }), server = fakeServer();
  server.tiles = tilesOf(A, B);
  server.head = { revision: 1, document: v5([A, B]), savedAt: '2026-10-22T09:00:00.000Z' };
  server.wrong.set(sha(B), C);
  const client = makeClient({ source, fetchImpl: server.fetch });
  const head = (await client.inspect()).head;
  const current = createDocument({ seed: map.seed, baseRevision: BASE });
  const editor = { map, baseRevision: BASE, active: true, commits: [], saved: 0, terrainTask: null,
    history: { current: () => clone(current) }, assets: { data: () => ({}) }, transform: { detach() {} }, _clearGhost() {},
    async _openTerrain(document, tiles) { return openTerrainDocument({ map, baseRevision: BASE, document, tiles }); },
    async _hydrate() {}, _commit(document, { tiles }) { this.commits.push({ document, tiles }); },
    async saveNow() { this.saved++; return true; } };
  const panel = Object.assign(Object.create(RemoteDraftPanel.prototype), { editor, client, head, reviewDocument: current,
    generation: 1, state: 'ready', contentBusy: false, remoteScope: scope, error: '', render() {} });
  await panel.load();
  assert.equal(panel.error, 'tile_hash');
  assert.equal(panel.state, 'ready');
  assert.deepEqual(editor.commits, []);
  assert.equal(editor.saved, 0);
  assert.deepEqual(editor.history.current(), current);
  assert.equal((await source.readTiles([sha(B)])).size, 0, 'a refused tile is not kept');

  server.wrong.clear();
  await panel.load();
  assert.equal(panel.error, '');
  assert.equal(editor.commits.length, 1);
  assert.deepEqual(editor.commits[0].document, head.document);
  assert.deepEqual(editor.commits[0].tiles, tilesOf(A, B));
  assert.equal(editor.saved, 1);
});
