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
      const terrain = { version: 2, samples: [[index, delta]], materials: [[index, 255, 0, 0, 0]] };
      try { validateTerrainForMap(map, terrain); return { terrain, x, z, index, delta }; }
      catch { /* find a safe dry sample on this deterministic seed */ }
    }
  }
  throw new Error('No safe terrain sample found in fixture map');
}

async function savePrepareRegister(httpBase, seed, terrain, { operationId = SAVE_OP, expectedRevision = 0 } = {}) {
  const document = createDocument({ seed, baseRevision: BASE, terrain });
  const saved = await fetch(`${httpBase}/api/gm/draft`, { method: 'PUT', headers: json(), body: JSON.stringify({
    operationId, expectedRevision, document,
  }) });
  assert.equal(saved.status, 200, await saved.clone().text());
  const prepared = await fetch(`${httpBase}/api/gm/prepare`, { method: 'POST', headers: json(),
    body: JSON.stringify({ expectedRevision: expectedRevision + 1 }) });
  assert.equal(prepared.status, 200, await prepared.clone().text());
  const revision = (await prepared.json()).preparation.revision;
  const registered = await fetch(`${httpBase}/api/gm/revisions`, { method: 'POST', headers: json(),
    body: JSON.stringify({ expectedRevision: expectedRevision + 1, revisionId: revision.revisionId }) });
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

test('painted v4 terrain draft saves, prepares, activates, loads for clients, admits matching peer, and rolls back', async () => {
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
    assert.equal(revision.content.document.version, 4);
    assert.deepEqual(Object.keys(revision.content.terrain).sort(), ['gridSize', 'materialsSha256', 'sha256']);
    assert.equal(revision.content.terrain.gridSize, 561);

    const activated = await fetch(`${httpBase}/api/gm/activate`, { method: 'POST', headers: json(), body: JSON.stringify({
      operationId: '40000000-0000-4000-8000-000000000013', expectedGeneration: 0, revisionId: revision.revisionId,
    }) });
    assert.equal(activated.status, 200, await activated.clone().text());
    assert.equal(app.game.server.world.map.heights[sample.index], Math.fround(base.heights[sample.index] + sample.delta / 1000));
    assert.deepEqual(app.game.server.world.map.materialWeightsAt(sample.x, sample.z), [1, 0, 0, 0]);
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

    const forgedMaterials = structuredClone(activeBody);
    forgedMaterials.revision.content.terrain.materialsSha256 = '0'.repeat(64);
    forgedMaterials.revision.revisionId = await gmContentHash(forgedMaterials.revision.content);
    forgedMaterials.revisionId = forgedMaterials.revision.revisionId;
    const guardedMaterialBase = generateWorld(seed), guardedMaterialMap = { ...guardedMaterialBase };
    await assert.rejects(loadGmWorldContent({ httpBase: `${httpBase}/`, map: guardedMaterialMap, baseMap: guardedMaterialBase,
      gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
      fetchImpl: async () => ({ ok: true, json: async () => forgedMaterials }) }), { code: 'content_terrain' });

    const loaded = await loadGmWorldContent({ httpBase: `${httpBase}/`, map: clientMap, baseMap: clientBase,
      gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
    assert.equal(loaded.revisionId, revision.revisionId);
    assert.equal(clientMap.heights[sample.index], app.game.server.world.map.heights[sample.index]);
    assert.equal(clientMap.groundAt(sample.x, sample.z), app.game.server.world.map.groundAt(sample.x, sample.z));
    assert.deepEqual(clientMap.materialWeightsAt(sample.x, sample.z), [1, 0, 0, 0]);
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
    assert.equal(app.game.server.world.map.materialWeightsAt, undefined);
    const legacyBase = generateWorld(seed), legacyMap = { ...legacyBase };
    const legacy = await loadGmWorldContent({ httpBase: `${httpBase}/`, map: legacyMap, baseMap: legacyBase,
      gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
    assert.equal(legacy.revisionId, null);
    assert.equal(legacyMap.heights[sample.index], base.heights[sample.index]);
    assert.equal(legacyMap.groundAt(sample.x, sample.z), before);
    assert.equal(legacyMap.materialWeightsAt, undefined);

    const heightOnly = { version: 1, samples: [[sample.index, sample.delta]] };
    const heightRevision = await savePrepareRegister(httpBase, seed, heightOnly, {
      operationId: '40000000-0000-4000-8000-000000000015', expectedRevision: 2,
    });
    assert.equal(heightRevision.content.document.version, 3);
    assert.deepEqual(Object.keys(heightRevision.content.terrain).sort(), ['gridSize', 'sha256']);
    const heightActivated = await fetch(`${httpBase}/api/gm/activate`, { method: 'POST', headers: json(), body: JSON.stringify({
      operationId: '40000000-0000-4000-8000-000000000016', expectedGeneration: 2, revisionId: heightRevision.revisionId,
    }) });
    assert.equal(heightActivated.status, 200, await heightActivated.clone().text());
    const heightPeer = await hello(wsUrl, { generation: 3, revisionId: heightRevision.revisionId });
    assert.deepEqual(heightPeer.message.content, { generation: 3, revisionId: heightRevision.revisionId });
    await new Promise((resolve) => { heightPeer.socket.onclose = resolve; heightPeer.socket.close(); });
    const heightClientBase = generateWorld(seed), heightClientMap = { ...heightClientBase };
    const heightLoaded = await loadGmWorldContent({ httpBase: `${httpBase}/`, map: heightClientMap, baseMap: heightClientBase,
      gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION });
    assert.equal(heightLoaded.revisionId, heightRevision.revisionId);
    assert.equal(heightClientMap.heights[sample.index], app.game.server.world.map.heights[sample.index]);
    assert.deepEqual(heightClientMap.materialWeightsAt(sample.x, sample.z), [0, 0, 0, 0]);
    const heightRollback = await fetch(`${httpBase}/api/gm/activate`, { method: 'POST', headers: json(), body: JSON.stringify({
      operationId: '40000000-0000-4000-8000-000000000017', expectedGeneration: 3, revisionId: null,
    }) });
    assert.equal(heightRollback.status, 200, await heightRollback.clone().text());
  } finally {
    if (peer) await new Promise((resolve) => { peer.socket.onclose = resolve; peer.socket.close(); });
    await app.close();
    await rm(temp, { recursive: true, force: true });
  }
});
