import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { createDecoration, createDocument } from '../src/editor/document.js';
import { GAME } from '../src/data/meta.js';
import manifest from '../assets/manifest.json' with { type: 'json' };
import editorCatalog from '../assets/editor/catalog.json' with { type: 'json' };

const GM = '30000000-0000-4000-8000-000000000001';
const PLAYER = '30000000-0000-4000-8000-000000000002';
const WORLD = 'gm-draft-server-integration';
const OP = '40000000-0000-4000-8000-000000000001';
const TRANSFORM = { position: { x: 1, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };

async function withServer(options, run) {
  const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 12345, bots: 0, dev: false,
    worldId: WORLD, saveSecret: 'gm-draft-integration-only', log() {}, ...options });
  const port = await server.listen();
  try { await run(`http://127.0.0.1:${port}`, server); }
  finally { await server.close(); }
}
const headers = (token = 'gm') => ({ authorization: `Bearer ${token}` });
function jsonHeaders(token = 'gm') { return { ...headers(token), 'content-type': 'application/json' }; }

test('mounted remote drafts use GM auth and content store without changing gameplay world or profiles', async () => {
  const store = createMemoryStore();
  const resolver = async (_req, { token }) => token === 'gm' ? GM : token === 'player' ? PLAYER : null;
  await withServer({ store, resolvePlayer: resolver, gmAccountIds: [GM], gmDraftsAllowMemory: true }, async (url, app) => {
    assert.equal(app.game.healthy(), true);
    const health = await fetch(`${url}/health`); assert.equal(health.status, 200);
    const beforeWorld = await store.loadWorld(WORLD);
    const beforeProfile = await store.loadProfile(GM);
    const beforeMap = { seed: app.game.server.world.seed, props: structuredClone(app.game.server.world.map.props),
      colliders: structuredClone(app.game.server.world.map.colliders) };

    const denied = await fetch(`${url}/api/gm/draft`, { headers: headers('player') });
    assert.equal(denied.status, 403);
    const inspect = await fetch(`${url}/api/gm/draft`, { headers: headers() });
    assert.equal(inspect.status, 200);
    const empty = await inspect.json();
    assert.equal(empty.durable, false);
    assert.equal(empty.head.revision, 0);
    assert.equal(empty.scope.worldId, WORLD);
    assert.equal(empty.scope.seed, beforeMap.seed);

    const asset = editorCatalog.assets.find((entry) => entry.kind === 'model');
    assert.ok(asset && manifest.assets.some((entry) => entry.id === asset.id) || editorCatalog.assets.some((entry) => entry.id === asset?.id));
    const eligibleRock = gmEditableBaseProps(app.game.server.world.map, 'terrain-s21-v1').find((entry) => entry.prop.kind === 'rock' && !entry.coastal);
    assert.ok(eligibleRock, 'generated map contains an editable non-coastal rock');
    const document = createDocument({ seed: beforeMap.seed, baseRevision: 'terrain-s21-v1',
      objects: [createDecoration({ id: 'integration-model', assetId: asset.id, position: { x: 1, y: 0, z: 2 } })],
      baseOverrides: [{ id: eligibleRock.id, transform: TRANSFORM, hidden: true }] });
    const saved = await fetch(`${url}/api/gm/draft`, { method: 'PUT', headers: jsonHeaders(),
      body: JSON.stringify({ operationId: OP, expectedRevision: 0, document }) });
    assert.equal(saved.status, 200, await saved.clone().text());
    const savedBody = await saved.json();
    assert.equal(savedBody.head.revision, 1);
    assert.equal(savedBody.durable, false);
    assert.deepEqual(savedBody.head.document, document);

    const loaded = await fetch(`${url}/api/gm/draft`, { headers: headers() });
    assert.deepEqual((await loaded.json()).head.document, document);
    assert.deepEqual(await store.loadWorld(WORLD), beforeWorld);
    assert.deepEqual(await store.loadProfile(GM), beforeProfile);
    assert.deepEqual({ seed: app.game.server.world.seed, props: app.game.server.world.map.props,
      colliders: app.game.server.world.map.colliders }, beforeMap);
    assert.equal(app.game.healthy(), true);
  });
});

test('GM draft readiness failure leaves the mounted game healthy and rejects writes', async () => {
  const base = createMemoryStore(); let writes = 0;
  const store = { ...base, durable: true,
    async checkGmDrafts() { throw new Error('SQL020 private provider detail'); },
    async saveGmDraft(...args) { writes++; return base.saveGmDraft(...args); },
  };
  const resolver = async (_req, { token }) => token === 'gm' ? GM : null;
  await withServer({ store, resolvePlayer: resolver, gmAccountIds: [GM] }, async (url, app) => {
    assert.equal(app.game.healthy(), true);
    assert.equal((await fetch(`${url}/health`)).status, 200);
    const unavailable = await fetch(`${url}/api/gm/draft`, { headers: headers() });
    assert.equal(unavailable.status, 503);
    const body = await unavailable.text();
    assert.equal(body, JSON.stringify({ ok: false, code: 'gm_drafts_unavailable' }));
    assert.doesNotMatch(body, /SQL020|private provider detail/);
    const attemptedWrite = await fetch(`${url}/api/gm/draft`, { method: 'PUT', headers: jsonHeaders(),
      body: JSON.stringify({ operationId: OP, expectedRevision: 0, document: createDocument({ seed: 12345, baseRevision: 'terrain-s21-v1' }) }) });
    assert.equal(attemptedWrite.status, 503);
    assert.equal(writes, 0);
    assert.equal(app.game.healthy(), true);
  });
});

