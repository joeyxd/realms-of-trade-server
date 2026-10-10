import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { gmEditableBaseProps } from '../src/editor/baseIdentity.js';
import { canonicalJson, PREPARATION_SCHEMA, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';
import { createIndexedDbDraftSource } from '../src/editor/draftStore.js';
import { GmContentClient } from '../src/editor/contentClient.js';
import { gmContentHash, loadGmWorldContent } from '../src/editor/activeContent.js';
import { projectGmContent } from '../src/editor/contentProjection.js';
import { resourceLayout } from '../src/data/resources.js';

const ACCOUNT = '50000000-0000-4000-8000-000000000001';
const WORLD = 'marea-negra';
const digest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const copy = (value) => value === undefined ? undefined : structuredClone(value);

function memoryIndexedDB() {
  const databases = new Map();
  return {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let database = databases.get(name), upgrade = false;
        if (!database) {
          upgrade = true;
          const stores = new Map();
          database = { objectStoreNames: { contains: (store) => stores.has(store) },
            createObjectStore(store) { stores.set(store, new Map()); },
            transaction(storeName) {
              const data = stores.get(storeName);
              if (!data) throw new Error('missing object store');
              let aborted = false, pending = 0, completed = false;
              const tx = { oncomplete: null, onabort: null, error: null,
                abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
                objectStore() { return {
                  get(key) {
                    const req = { result: undefined, onsuccess: null, onerror: null };
                    pending++;
                    setTimeout(() => {
                      if (!aborted) { req.result = copy(data.get(key)); req.onsuccess?.(); }
                      pending--;
                      queueMicrotask(() => { if (!aborted && pending === 0 && !completed) { completed = true; tx.oncomplete?.(); } });
                    }, 0);
                    return req;
                  },
                  put(value, key) { data.set(key, copy(value)); },
                }; },
              };
              return tx;
            },
          };
          databases.set(name, database);
        }
        request.result = database;
        if (upgrade) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function authFixture({ identity = ACCOUNT } = {}) {
  return { state: { signedIn: true, accountId: ACCOUNT },
    async sessionIdentity() { return { accountId: identity, token: 'short-lived-token' }; } };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return copy(body); } };
}

function clientFixture({ indexedDB = memoryIndexedDB(), auth = authFixture(), fetchImpl, name = 'gm-content-client-test', source: suppliedSource } = {}) {
  const source = suppliedSource || createIndexedDbDraftSource({ indexedDB, databaseName: name });
  const client = new GmContentClient({ auth, accountId: ACCOUNT, httpBase: 'https://game.test/', localScope: 'tab-main', source, fetchImpl });
  return { client, source, auth, indexedDB };
}

test('IndexedDB pending activation survives lost response and retries the exact operation after client restart', async () => {
  const indexedDB = memoryIndexedDB(), remoteOperations = new Map(), calls = [];
  const revisionId = 'a'.repeat(64);
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), 'https://game.test/api/gm/activate');
    assert.equal(init.method, 'POST');
    assert.equal(init.cache, 'no-store');
    const operation = JSON.parse(init.body); calls.push(copy(operation));
    assert.match(init.headers.authorization, /^Bearer short-lived-token$/);
    assert.ok(init.signal instanceof AbortSignal);
    const prior = remoteOperations.get(operation.operationId);
    if (prior) return jsonResponse(200, prior);
    const committed = { ok: true, generation: operation.expectedGeneration + 1, revisionId: operation.revisionId };
    remoteOperations.set(operation.operationId, committed);
    throw new Error('connection dropped after durable commit');
  };
  const first = clientFixture({ indexedDB, fetchImpl });
  await assert.rejects(first.client.activate(revisionId, 0), /connection dropped after durable commit/);
  const persisted = await first.source.read('content-pending:tab-main');
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.operation.expectedGeneration, 0);
  assert.equal(persisted.operation.revisionId, revisionId);
  assert.doesNotMatch(JSON.stringify(persisted), /short-lived-token|authorization/i);

  const restarted = clientFixture({ indexedDB, fetchImpl, name: 'gm-content-client-test' });
  const result = await restarted.client.retry();
  assert.equal(result.generation, 1);
  assert.equal(result.revisionId, revisionId);
  assert.deepEqual(calls[1], calls[0]);
  assert.deepEqual(await restarted.source.read('content-pending:tab-main'), { revision: 2, operation: null });
});

test('account identity mismatch stops before network and preserves the durable pending operation', async () => {
  let requests = 0;
  const f = clientFixture({ auth: authFixture({ identity: '60000000-0000-4000-8000-000000000001' }),
    fetchImpl: async () => { requests++; return jsonResponse(200, {}); } });
  await assert.rejects(f.client.activate(null, 0), { code: 'auth' });
  assert.equal(requests, 0);
  const stored = await f.source.read('content-pending:tab-main');
  assert.ok(stored.operation);
  assert.equal(stored.operation.revisionId, null);
});

test('local CAS loss prevents sending an operation that was not durably recorded', async () => {
  let requests = 0;
  const base = createIndexedDbDraftSource({ indexedDB: memoryIndexedDB(), databaseName: 'gm-content-cas-conflict' });
  const source = { read: (...args) => base.read(...args), async compareAndSwap() { return false; } };
  const f = clientFixture({ source: source, fetchImpl: async () => { requests++; return jsonResponse(200, {}); } });
  await assert.rejects(f.client.activate('c'.repeat(64), 4), { code: 'local_attempt_conflict' });
  assert.equal(requests, 0);
  assert.equal(await base.read('content-pending:tab-main'), null);
});

test('identity change while session identity is resolving keeps the recorded operation for recovery', async () => {
  let resolveIdentity, requests = 0;
  const auth = authFixture();
  auth.sessionIdentity = () => new Promise((resolve) => { resolveIdentity = resolve; });
  const f = clientFixture({ auth, name: 'gm-content-identity-race', fetchImpl: async () => { requests++; return jsonResponse(200, {}); } });
  const pending = f.client.activate('d'.repeat(64), 6);
  while (!resolveIdentity) await new Promise((resolve) => setTimeout(resolve, 0));
  auth.state = { signedIn: true, accountId: '60000000-0000-4000-8000-000000000001' };
  resolveIdentity({ accountId: ACCOUNT, token: 'short-lived-token' });
  await assert.rejects(pending, { code: 'auth' });
  assert.equal(requests, 0);
  const stored = await f.source.read('content-pending:tab-main');
  assert.equal(stored.revision, 1);
  assert.equal(stored.operation.expectedGeneration, 6);
  assert.equal(stored.operation.revisionId, 'd'.repeat(64));
});

test('cancel and sign-out after a durable commit preserve the exact attempt for later retry', async (t) => {
  for (const mode of ['cancel', 'signout']) {
    await t.test(mode, async () => {
      let finish, started;
      const began = new Promise((resolve) => { started = resolve; });
      const auth = authFixture();
      const f = clientFixture({ auth, name: `gm-content-client-${mode}`, fetchImpl: async (_url, init) => {
        started();
        const op = JSON.parse(init.body);
        return new Promise((resolve) => { finish = () => resolve(jsonResponse(200,
          { ok: true, generation: op.expectedGeneration + 1, revisionId: op.revisionId })); });
      } });
      const pending = f.client.activate('b'.repeat(64), 3);
      await began;
      const before = await f.source.read('content-pending:tab-main');
      if (mode === 'cancel') f.client.cancel();
      else auth.state = { signedIn: false, accountId: null };
      finish();
      await assert.rejects(pending, (error) => mode === 'cancel' ? ['auth', 'cancelled'].includes(error.code) : error.code === 'auth');
      assert.deepEqual((await f.source.read('content-pending:tab-main')).operation, before.operation);
    });
  }
});

async function activeRevision(baseMap, document) {
  const baseRevision = 'terrain-s21-v1', projection = projectGmContent(baseMap, document, baseRevision);
  const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId: WORLD, sourceRevision: 1,
    base: { seed: baseMap.seed >>> 0, revision: baseRevision,
      propsHash: await gmContentHash(baseMap.props), collidersHash: await gmContentHash(baseMap.colliders),
      resourcesHash: await gmContentHash(resourceLayout(baseMap)) },
    document, documentHash: await gmContentHash(document),
    runtime: { sha256: digest('runtime'), files: [], gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION },
    assets: [], baselineAssets: [], collision: { count: projection.colliders.length, sha256: await gmContentHash(projection.colliders) },
    validation: { valid: true, issues: [], summary: { edits: document.objects.length, errors: 0, warnings: 0, totalIssues: 0, omittedIssues: 0 } } };
  return { schema: PREPARATION_SCHEMA, version: 1, revisionId: await gmContentHash(content), content };
}

function visualDocument(map) {
  return createDocument({ seed: map.seed, baseRevision: 'terrain-s21-v1', objects: [createDecoration({ id: 'visual', assetId: 'prop:crate',
    position: { x: 180, y: 1, z: 180 } })] });
}

function baselineFor(map, alter = () => {}) {
  const baseline = { props: structuredClone(map.props), colliders: structuredClone(map.colliders), resources: structuredClone(resourceLayout(map)) };
  alter(baseline);
  return baseline;
}

function withBaseline(map, baseline) {
  return { ...map, props: structuredClone(baseline.props), colliders: structuredClone(baseline.colliders),
    terrainResources: structuredClone(baseline.resources) };
}

function activeResponse(revision, baseline, generation = 1) {
  return { ok: true, generation, revisionId: revision.revisionId, revision, baseline };
}

test('active world content verifies canonical revision, base fingerprints and collision hash before use', async () => {
  const base = generateWorld(778899), document = visualDocument(base), revision = await activeRevision(base, document);
  const map = { ...base };
  let request;
  const response = jsonResponse(200, { ok: true, generation: 7, revisionId: revision.revisionId, revision });
  const result = await loadGmWorldContent({ httpBase: 'https://game.test/', map, baseMap: base,
    gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, fetchImpl: async (url, init) => {
      request = { url: String(url), ...init }; return response;
    } });
  assert.equal(request.url, 'https://game.test/api/world/content');
  assert.equal(request.cache, 'no-store');
  assert.equal(result.generation, 7);
  assert.deepEqual(map.gmContentIdentity, { generation: 7, revisionId: revision.revisionId });
  assert.deepEqual(map.colliders, projectGmContent(base, document).colliders);
  assert.notEqual(map.queryColliders, base.queryColliders);
});

test('server baseline absorbs tiny cross-runtime geometry drift and preserves its exact base identities', async () => {
  const clientBase = generateWorld(778898), baseline = baselineFor(clientBase);
  const entry = gmEditableBaseProps(clientBase, 'terrain-s21-v1')[0];
  assert.ok(entry);
  const drift = 2e-8;
  baseline.props[entry.index].x += drift;
  for (const collider of baseline.colliders) if (collider.x === entry.prop.x && collider.z === entry.prop.z && collider.r === entry.prop.r) collider.x += drift;
  const serverBase = withBaseline(clientBase, baseline), serverEntry = gmEditableBaseProps(serverBase, 'terrain-s21-v1')
    .find((item) => item.index === entry.index);
  assert.notEqual(serverEntry.id, entry.id, 'the fixture drift would change an identity before authoritative baseline install');
  const document = visualDocument(serverBase), revision = await activeRevision(serverBase, document), map = { ...clientBase };
  const result = await loadGmWorldContent({ httpBase: 'https://game.test/', map, baseMap: clientBase,
    gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
    fetchImpl: async () => jsonResponse(200, activeResponse(revision, baseline, 9)) });
  assert.equal(result.generation, 9);
  assert.deepEqual(clientBase.props, baseline.props);
  assert.deepEqual(map.props, baseline.props);
  assert.equal(gmEditableBaseProps(clientBase, 'terrain-s21-v1').find((item) => item.index === entry.index).id, serverEntry.id);
  assert.deepEqual(map.colliders, projectGmContent(serverBase, document).colliders);
  assert.deepEqual(map.gmContentIdentity, { generation: 9, revisionId: revision.revisionId });
});

test('fresh-client verification rejects significant baseline geometry drift before installation', async () => {
  const clientBase = generateWorld(778897), baseline = baselineFor(clientBase);
  baseline.colliders[0].r += 0.25;
  const serverBase = withBaseline(clientBase, baseline), document = visualDocument(serverBase);
  const revision = await activeRevision(serverBase, document), map = { ...clientBase };
  const originalProps = structuredClone(map.props), originalColliders = structuredClone(map.colliders);
  await assert.rejects(loadGmWorldContent({ httpBase: 'https://game.test/', map, baseMap: clientBase,
    gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
    fetchImpl: async () => jsonResponse(200, activeResponse(revision, baseline)) }), /content_base/);
  assert.deepEqual(map.props, originalProps);
  assert.deepEqual(map.colliders, originalColliders);
  assert.equal(map.gmContentIdentity, undefined);
});

test('a near baseline with a mismatched server fingerprint is rejected', async () => {
  const base = generateWorld(778896), revision = await activeRevision(base, visualDocument(base));
  const forgedBaseline = baselineFor(base);
  forgedBaseline.props[0].x += 2e-8;
  const map = { ...base }, originalProps = structuredClone(map.props);
  await assert.rejects(loadGmWorldContent({ httpBase: 'https://game.test/', map, baseMap: base,
    gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
    fetchImpl: async () => jsonResponse(200, activeResponse(revision, forgedBaseline)) }), /content_base/);
  assert.deepEqual(map.props, originalProps);
  assert.equal(map.gmContentIdentity, undefined);
});

test('strict base fingerprints reject props, collider and resource drift before changing the active map', async (t) => {
  const base = generateWorld(778900), document = visualDocument(base), revision = await activeRevision(base, document);
  const mutations = [
    (copy) => { copy.props[0].x += 0.25; },
    (copy) => { copy.colliders[0].r += 0.25; },
    (copy) => { copy.terrainResources.nodes[0].x += 0.25; },
  ];
  for (const [index, mutate] of mutations.entries()) await t.test(`fingerprint-${index}`, async () => {
    const changedBase = { ...base, props: base.props.map((p) => ({ ...p })), colliders: base.colliders.map((c) => ({ ...c })),
      landmarks: { ...base.landmarks, spawn: { ...base.landmarks.spawn } } };
    mutate(changedBase);
    const map = { ...changedBase }, before = structuredClone(map.colliders);
    await assert.rejects(loadGmWorldContent({ httpBase: 'https://game.test/', map, baseMap: changedBase,
      gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, fetchImpl: async () => jsonResponse(200,
        { ok: true, generation: 1, revisionId: revision.revisionId, revision }) }), /content_base/);
    assert.deepEqual(map.colliders, before);
    assert.equal(map.gmContentIdentity, undefined);
  });
});

test('server-selected base identity accepts only null revision bodies and exact runtime version', async (t) => {
  const base = generateWorld(778901), map = { ...base };
  const baseResult = await loadGmWorldContent({ httpBase: 'https://game.test/', map, baseMap: base,
    gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION,
    fetchImpl: async () => jsonResponse(200, { ok: true, generation: 0, revisionId: null, revision: null }) });
  assert.equal(baseResult.revision, null);
  assert.deepEqual(map.gmContentIdentity, { generation: 0, revisionId: null });

  const revision = await activeRevision(base, visualDocument(base)), incompatible = structuredClone(revision);
  incompatible.content.runtime.gameVersion = 'older-release';
  incompatible.revisionId = await gmContentHash(incompatible.content);
  const freshMap = { ...base };
  await assert.rejects(loadGmWorldContent({ httpBase: 'https://game.test/', map: freshMap, baseMap: base,
    gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION, fetchImpl: async () => jsonResponse(200,
      { ok: true, generation: 1, revisionId: incompatible.revisionId, revision: incompatible }) }), /content_incompatible/);
  assert.equal(freshMap.gmContentIdentity, undefined);
});
