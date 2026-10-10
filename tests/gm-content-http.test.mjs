import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createDecoration, createDocument } from '../src/editor/document.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import catalog from '../assets/editor/catalog.json' with { type: 'json' };
import manifest from '../assets/manifest.json' with { type: 'json' };

const GM = '30000000-0000-4000-8000-000000000001';
const PLAYER = '30000000-0000-4000-8000-000000000002';
const WORLD = 'gm-content-http-integration';
const SAVE_OP = '40000000-0000-4000-8000-000000000001';
const ACTIVATE_OP = '40000000-0000-4000-8000-000000000002';
const ROLLBACK_OP = '40000000-0000-4000-8000-000000000003';

function fakeLock() {
  return { async run(callback) { return callback({ assertHeld() {} }); } };
}

function connect(url) {
  const ws = new WebSocket(url), messages = [], waiters = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data); messages.push(message);
    for (const waiter of [...waiters]) if (waiter.predicate(message)) {
      waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message);
    }
  };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { ws, messages, opened,
    send(message) { ws.send(JSON.stringify(message)); },
    wait(predicate, timeoutMs = 5000) {
      const found = messages.find(predicate); if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.push(waiter);
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('WebSocket message timeout'));
        }, timeoutMs);
        waiter.resolve = (message) => { clearTimeout(timer); resolve(message); };
      });
    },
    async close() {
      if (ws.readyState === WebSocket.CLOSED) return;
      await new Promise((resolve) => { ws.addEventListener('close', resolve, { once: true }); ws.close(); });
    },
  };
}

async function fixture(run) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-content-http-'));
  const memory = createMemoryStore();
  let resolveCalls = 0, profileLoads = 0;
  // This memory-backed adapter is labelled durable only to exercise the production admission gate.
  // It is isolated to this test and writes no external database.
  const store = { ...memory, durable: true,
    async loadProfile(...args) { profileLoads++; return memory.loadProfile(...args); },
  };
  const resolvePlayer = async (_request, hello) => {
    resolveCalls++;
    return hello.token === 'gm' ? GM : hello.token === 'player' ? PLAYER : null;
  };
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 12345, bots: 0, dev: false, log() {},
    worldId: WORLD, worldSaveMs: 60_000, store, resolvePlayer, gmAccountIds: [GM], gmDraftsAllowMemory: true,
    gmContentDirectory: path.join(temp, 'durable-content'), gmContentLock: fakeLock() });
  const port = await app.listen(), httpBase = `http://127.0.0.1:${port}`;
  try { await run({ app, httpBase, wsUrl: `ws://127.0.0.1:${port}/ws`, memory,
    counts: () => ({ resolveCalls, profileLoads }), resetCounts: () => { resolveCalls = 0; profileLoads = 0; } }); }
  finally { await app.close(); await rm(temp, { recursive: true, force: true }); }
}

const auth = (token = 'gm') => ({ authorization: `Bearer ${token}` });
const json = (token = 'gm') => ({ ...auth(token), 'content-type': 'application/json' });
async function activate(url, operationId, expectedGeneration, revisionId, token = 'gm') {
  return fetch(`${url}/api/gm/activate`, { method: 'POST', headers: json(token),
    body: JSON.stringify({ operationId, expectedGeneration, revisionId }) });
}

async function registerCrate(httpBase, seed) {
  const crate = [...catalog.assets, ...manifest.assets].find((asset) => asset.id === 'prop:storage-crate');
  assert.ok(crate, 'integrated storage-crate catalog entry exists');
  const document = createDocument({ seed, baseRevision: 'terrain-s21-v1', objects: [createDecoration({
    id: 'published-crate', assetId: crate.id, position: { x: 180, y: 0, z: 180 },
  })] });
  const saved = await fetch(`${httpBase}/api/gm/draft`, { method: 'PUT', headers: json(), body: JSON.stringify({
    operationId: SAVE_OP, expectedRevision: 0, document,
  }) });
  assert.equal(saved.status, 200, await saved.clone().text());
  const prepared = await fetch(`${httpBase}/api/gm/prepare`, { method: 'POST', headers: json(),
    body: JSON.stringify({ expectedRevision: 1 }) });
  assert.equal(prepared.status, 200, await prepared.clone().text());
  return (await prepared.json()).preparation.revision;
}

test('GM content HTTP enforces auth and methods, binds registration to the exact saved head, and activates generation 0 to 1', async () => {
  await fixture(async ({ httpBase, app }) => {
    const unauthenticated = await fetch(`${httpBase}/api/gm/revisions`);
    assert.equal(unauthenticated.status, 401);
    const forbidden = await fetch(`${httpBase}/api/gm/revisions`, { headers: auth('player') });
    assert.equal(forbidden.status, 403);
    const badGet = await fetch(`${httpBase}/api/gm/revisions`, { method: 'PUT', headers: auth() });
    assert.equal(badGet.status, 405); assert.equal(badGet.headers.get('allow'), 'GET, POST');
    const badActivate = await fetch(`${httpBase}/api/gm/activate`, { method: 'GET', headers: auth() });
    assert.equal(badActivate.status, 405); assert.equal(badActivate.headers.get('allow'), 'POST');
    const before = await fetch(`${httpBase}/api/gm/revisions`, { headers: auth() });
    assert.equal(before.status, 200); assert.equal((await before.json()).active.generation, 0);

    const revision = await registerCrate(httpBase, app.game.server.world.seed);
    const mismatch = await fetch(`${httpBase}/api/gm/revisions`, { method: 'POST', headers: json(),
      body: JSON.stringify({ expectedRevision: 1, revisionId: 'f'.repeat(64) }) });
    assert.equal(mismatch.status, 409); assert.equal((await mismatch.json()).code, 'gm_content_changed');
    assert.equal((await (await fetch(`${httpBase}/api/gm/revisions`, { headers: auth() })).json()).revisions.length, 0);

    const registered = await fetch(`${httpBase}/api/gm/revisions`, { method: 'POST', headers: json(),
      body: JSON.stringify({ expectedRevision: 1, revisionId: revision.revisionId }) });
    assert.equal(registered.status, 200, await registered.clone().text());
    assert.equal((await registered.json()).revisions[0].revisionId, revision.revisionId);
    const activated = await activate(httpBase, ACTIVATE_OP, 0, revision.revisionId);
    assert.equal(activated.status, 200, await activated.clone().text());
    assert.deepEqual(await activated.json(), { ok: true, generation: 1, revisionId: revision.revisionId,
      replay: false, active: { generation: 1, revisionId: revision.revisionId } });
    const content = await (await fetch(`${httpBase}/api/world/content`)).json();
    assert.equal(content.generation, 1); assert.equal(content.revisionId, revision.revisionId);
  });
});

test('stale HELLO is rejected before auth/profile I/O, current HELLO receives matching WELCOME, and occupied activation is busy', async () => {
  await fixture(async ({ httpBase, wsUrl, app, counts, resetCounts }) => {
    const revision = await registerCrate(httpBase, app.game.server.world.seed);
    const registered = await fetch(`${httpBase}/api/gm/revisions`, { method: 'POST', headers: json(),
      body: JSON.stringify({ expectedRevision: 1, revisionId: revision.revisionId }) });
    assert.equal(registered.status, 200, await registered.clone().text());
    const activated = await activate(httpBase, ACTIVATE_OP, 0, revision.revisionId);
    assert.equal(activated.status, 200, await activated.clone().text());
    resetCounts();

    const stale = connect(wsUrl); await stale.opened;
    stale.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Viejo', skin: 0, weapon: 0, token: 'invalid',
      content: { generation: 0, revisionId: null } });
    const denied = await stale.wait((message) => message.t === MSG.ERROR && message.code === 'content_revision');
    assert.equal(denied.code, 'content_revision');
    assert.deepEqual(counts(), { resolveCalls: 0, profileLoads: 0 });
    await stale.close();

    const current = connect(wsUrl); await current.opened;
    current.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Navegante', skin: 0, weapon: 0, token: 'player',
      content: { generation: 1, revisionId: revision.revisionId } });
    const welcome = await current.wait((message) => message.t === MSG.WELCOME);
    assert.deepEqual(welcome.content, { generation: 1, revisionId: revision.revisionId });
    assert.deepEqual(counts(), { resolveCalls: 1, profileLoads: 1 });

    const occupied = await activate(httpBase, ROLLBACK_OP, 1, null);
    assert.equal(occupied.status, 409); assert.deepEqual(await occupied.json(), { ok: false, code: 'gm_content_busy' });
    assert.equal(app.gmContent.snapshot().generation, 1);
    await current.close();
  });
});

test('default server accepts a HELLO without content identity and welcomes with the base identity', async () => {
  const store = createMemoryStore();
  const app = createGameServer({ port: 0, host: '127.0.0.1', seed: 12345, bots: 0, dev: false, log() {}, store,
    resolvePlayer: async (_request, hello) => hello.token === 'player' ? PLAYER : null });
  const port = await app.listen();
  const client = connect(`ws://127.0.0.1:${port}/ws`);
  try {
    await client.opened;
    client.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Base', skin: 0, weapon: 0, token: 'player' });
    const welcome = await client.wait((message) => message.t === MSG.WELCOME);
    assert.deepEqual(welcome.content, { generation: 0, revisionId: null });
  } finally {
    await client.close();
    await app.close();
  }
});
