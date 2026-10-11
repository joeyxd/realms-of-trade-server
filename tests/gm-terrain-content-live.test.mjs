import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createDocument } from '../src/editor/document.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { gmContentHash, loadGmWorldContent } from '../src/editor/activeContent.js';
import { validateTerrainForMap } from '../src/editor/terrainData.js';
import { resourceLayout } from '../src/data/resources.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';

const GM = '30000000-0000-4000-8000-000000000001';
const PLAYER = '30000000-0000-4000-8000-000000000002';
const WORLD = 'gm-terrain-content-live';
const SAVE_OP = '40000000-0000-4000-8000-000000000011';
const ROLLBACK_OP = '40000000-0000-4000-8000-000000000012';
const BASE = 'terrain-s21-v1';

function fakeLock() { return { async run(callback) { return callback({ assertHeld() {} }); } }; }
function auth(token = 'gm') { return { authorization: `Bearer ${token}` }; }
function json(token = 'gm') { return { ...auth(token), 'content-type': 'application/json' }; }
function candidateTerrain(map) {
  for (let z = -280; z <= 280; z++) for (let x = -280; x <= 280; x++) {
    const index = (z + map.half) * 561 + x + map.half;
    for (const delta of [12000, 1000, -1000]) {
      const terrain = { version: 1, samples: [[index, delta]] };
      try { validateTerrainForMap(map, terrain); return { terrain, x, z, index, delta }; }
      catch { /* find a safe dry sample on this deterministic seed */ }
    }
  }
  throw new Error('No safe terrain sample found in fixture map');
}

async function savePrepareRegister(httpBase, seed, terrain) {
  const document = createDocument({ seed, baseRevision: BASE, terrain });
  const saved = await fetch(`${httpBase}/api/gm/draft`, { method: 'PUT', headers: json(), body: JSON.stringify({
    operationId: SAVE_OP, expectedRevision: 0, document,
  }) });
  assert.equal(saved.status, 200, await saved.clone().text());
  const prepared = await fetch(`${httpBase}/api/gm/prepare`, { method: 'POST', headers: json(),
    body: JSON.stringify({ expectedRevision: 1 }) });
  assert.equal(prepared.status, 200, await prepared.clone().text());
  const revision = (await prepared.json()).preparation.revision;
  const registered = await fetch(`${httpBase}/api/gm/revisions`, { method: 'POST', headers: json(),
    body: JSON.stringify({ expectedRevision: 1, revisionId: revision.revisionId }) });
  assert.equal(registered.status, 200, await registered.clone().text());
  return revision;
}

async function hello(url, content) {
  const socket = new WebSocket(url), messages = [];
  const opened = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  await opened;
  const welcome = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WELCOME timeout')), 5000);
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data); messages.push(message);
      if (message.t === MSG.WELCOME) { clearTimeout(timeout); resolve(message); }
      if (message.t === MSG.ERROR) { clearTimeout(timeout); reject(Object.assign(new Error(message.code), { code: message.code })); }
    };
  });
  socket.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Terrain', skin: 0, weapon: 0,
    token: 'player', content }));
  try { return { socket, message: await welcome }; }
  catch (error) { socket.close(); throw error; }
}

test('terrain draft saves, prepares, activates, reloads exact heights, admits matching peer, and rolls back to legacy', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-terrain-live-'));
  const store = { ...createMemoryStore(), durable: true };
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 12345, bots: 0, dev: false, log() {}, worldId: WORLD,
    worldSaveMs: 60_000, store, resolvePlayer: async (_request, hello) => hello.token === 'gm' ? GM : hello.token === 'player' ? PLAYER : null,
    gmAccountIds: [GM], gmDraftsAllowMemory: true, gmContentDirectory: path.join(temp, 'durable-content'), gmContentLock: fakeLock() });
  const port = await app.listen(), httpBase = `http://127.0.0.1:${port}`, wsUrl = `ws://127.0.0.1:${port}/ws`;
  let peer = null;
  try {
    const seed = app.game.server.world.seed, base = generateWorld(seed), sample = candidateTerrain(base);
    const before = base.groundAt(sample.x, sample.z);
    const revision = await savePrepareRegister(httpBase, seed, sample.terrain);
    assert.deepEqual(Object.keys(revision.content.terrain).sort(), ['gridSize', 'sha256']);
    assert.equal(revision.content.terrain.gridSize, 561);

    const activated = await fetch(`${httpBase}/api/gm/activate`, { method: 'POST', headers: json(), body: JSON.stringify({
      operationId: '40000000-0000-4000-8000-000000000013', expectedGeneration: 0, revisionId: revision.revisionId,
    }) });
    assert.equal(activated.status, 200, await activated.clone().text());
    assert.equal(app.game.server.world.map.heights[sample.index], Math.fround(base.heights[sample.index] + sample.delta / 1000));
    peer = await hello(wsUrl, { generation: 1, revisionId: revision.revisionId });
    assert.deepEqual(peer.message.content, { generation: 1, revisionId: revision.revisionId });
    await new Promise((resolve) => { peer.socket.onclose = resolve; peer.socket.close(); });
    peer = null;

    const clientBase = generateWorld(seed), clientMap = { ...clientBase };
    const activeBody = await (await fetch(`${httpBase}/api/world/content`)).json();
    const forged = structuredClone(activeBody);
    forged.revision.content.terrain.sha256 = '0'.repeat(64);
    forged.revision.revisionId = await gmContentHash(forged.revision.content);
    forged.revisionId = forged.revision.revisionId;
    const guardedBase = generateWorld(seed), guardedMap = { ...guardedBase };
    await assert.rejects(loadGmWorldContent({ httpBase: `${httpBase}/`, map: guardedMap, baseMap: guardedBase,
      gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
      fetchImpl: async () => ({ ok: true, json: async () => forged }) }), { code: 'content_terrain' });
    assert.equal(guardedMap.heights[sample.index], guardedBase.heights[sample.index]);

    const loaded = await loadGmWorldContent({ httpBase: `${httpBase}/`, map: clientMap, baseMap: clientBase,
      gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
    assert.equal(loaded.revisionId, revision.revisionId);
    assert.equal(clientMap.heights[sample.index], app.game.server.world.map.heights[sample.index]);
    assert.equal(clientMap.groundAt(sample.x, sample.z), app.game.server.world.map.groundAt(sample.x, sample.z));
    assert.deepEqual(resourceLayout(clientMap), resourceLayout(clientBase));

    const v2Save = await fetch(`${httpBase}/api/gm/draft`, { method: 'PUT', headers: json(), body: JSON.stringify({
      operationId: '40000000-0000-4000-8000-000000000014', expectedRevision: 1,
      document: createDocument({ seed, baseRevision: BASE }),
    }) });
    assert.equal(v2Save.status, 200, await v2Save.clone().text());
    const v2PreparedResponse = await fetch(`${httpBase}/api/gm/prepare`, { method: 'POST', headers: json(),
      body: JSON.stringify({ expectedRevision: 2 }) });
    assert.equal(v2PreparedResponse.status, 200, await v2PreparedResponse.clone().text());
    const v2Revision = (await v2PreparedResponse.json()).preparation.revision;
    assert.equal(v2Revision.content.document.version, 2);
    assert.equal(v2Revision.content.terrain, undefined);

    const rolledBack = await fetch(`${httpBase}/api/gm/activate`, { method: 'POST', headers: json(), body: JSON.stringify({
      operationId: ROLLBACK_OP, expectedGeneration: 1, revisionId: null,
    }) });
    assert.equal(rolledBack.status, 200, await rolledBack.clone().text());
    assert.equal(app.game.server.world.map.heights[sample.index], base.heights[sample.index]);
    const legacyBase = generateWorld(seed), legacyMap = { ...legacyBase };
    const legacy = await loadGmWorldContent({ httpBase: `${httpBase}/`, map: legacyMap, baseMap: legacyBase,
      gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
    assert.equal(legacy.revisionId, null);
    assert.equal(legacyMap.heights[sample.index], base.heights[sample.index]);
    assert.equal(legacyMap.groundAt(sample.x, sample.z), before);
  } finally {
    if (peer) await new Promise((resolve) => { peer.socket.onclose = resolve; peer.socket.close(); });
    await app.close();
    await rm(temp, { recursive: true, force: true });
  }
});
