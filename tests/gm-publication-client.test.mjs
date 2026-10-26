import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RemoteDraftClient, RemoteDraftError } from '../src/editor/remoteDraft.js';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { canonicalJson, PREPARATION_SCHEMA, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';

const ACCOUNT = '50000000-0000-4000-8000-000000000001';
const SCOPE = { worldId: 'gm-client-test', seed: 321, baseRevision: 'terrain-s21-v1' };
const HEAD_REVISION = 12;
const digest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const document = createDocument({ seed: SCOPE.seed, baseRevision: SCOPE.baseRevision, objects: [createDecoration({
  id: 'client-crate', assetId: 'prop:storage-crate', position: { x: 12, y: 1, z: 14 }, collider: 'none',
})] });

function artifact(doc = document) {
  const validation = { valid: true, issues: [], summary: { edits: 1, errors: 0, warnings: 1, totalIssues: 1, omittedIssues: 0 } };
  const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId: SCOPE.worldId, sourceRevision: HEAD_REVISION,
    document: structuredClone(doc), documentHash: digest(doc), runtime: { sha256: 'a'.repeat(64), files: [], gameVersion: 'test', protocolVersion: 1 },
    assets: [], collision: { count: 0, sha256: 'b'.repeat(64) }, validation };
  return { schema: PREPARATION_SCHEMA, version: 1, revisionId: digest(content), content };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return structuredClone(body); } };
}

function memoryCas(initial = null) {
  let value = initial === null ? null : structuredClone(initial);
  const writes = [];
  return {
    writes,
    async read(key) { assert.equal(key, 'remote-pending:local-gm-scope'); return value === null ? null : structuredClone(value); },
    async compareAndSwap(key, expectedRevision, next) {
      assert.equal(key, 'remote-pending:local-gm-scope');
      const current = value?.revision ?? 0;
      if (current !== expectedRevision) return false;
      value = structuredClone(next); writes.push(structuredClone(next)); return true;
    },
    snapshot() { return value === null ? null : structuredClone(value); },
  };
}

function authFixture() {
  return { state: { signedIn: true, accountId: ACCOUNT }, async sessionIdentity() { return { accountId: ACCOUNT, token: 'fixture-token' }; } };
}

function getBody() { return { ok: true, durable: false, scope: SCOPE,
  head: { revision: HEAD_REVISION, document, savedAt: '2026-10-10T12:00:00.000Z' } }; }

function postBody(revision = artifact(), { headRevision = HEAD_REVISION } = {}) {
  return { ok: true, durable: false, scope: SCOPE, headRevision,
    preparation: { report: revision.content.validation, revision } };
}

function client({ source = memoryCas(), fetchImpl, auth = authFixture() } = {}) {
  return { source, auth, value: new RemoteDraftClient({ auth, accountId: ACCOUNT, httpBase: 'https://marea.test/',
    localScope: 'local-gm-scope', source, fetchImpl }) };
}

test('inspect pins scope, then prepare POST uses its expected revision and verifies the returned artifact', async () => {
  const calls = [], { value, source } = client({ fetchImpl: async (url, init) => {
    calls.push({ url: String(url), ...init });
    return response(200, init.method === 'GET' ? getBody() : postBody());
  } });
  const inspected = await value.inspect();
  assert.deepEqual(inspected.scope, SCOPE);
  const result = await value.prepareRevision(HEAD_REVISION, document);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://marea.test/api/gm/prepare');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].headers.authorization, 'Bearer fixture-token');
  assert.deepEqual(JSON.parse(calls[1].body), { expectedRevision: HEAD_REVISION });
  assert.equal(calls[1].headers['content-type'], 'application/json');
  assert.deepEqual(result.scope, SCOPE);
  assert.equal(result.headRevision, HEAD_REVISION);
  assert.equal(result.preparation.revision.revisionId, artifact().revisionId);
  assert.equal(source.writes.length, 0);
});

test('pending draft operation blocks preparation before a POST', async () => {
  const pending = { revision: 2, operation: { operationId: '50000000-0000-4000-8000-000000000002', expectedRevision: 0, document } };
  const source = memoryCas(pending), calls = [];
  const { value } = client({ source, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), ...init }); return response(200, getBody());
  } });
  await value.inspect();
  await assert.rejects(value.prepareRevision(HEAD_REVISION, document), (error) => error instanceof RemoteDraftError && error.code === 'pending');
  assert.equal(calls.length, 1);
  assert.equal(source.writes.length, 0);
  assert.deepEqual(source.snapshot(), pending);
});

test('409 conflict leaves local state and pending CAS record untouched', async () => {
  const source = memoryCas(), calls = [];
  const { value } = client({ source, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), ...init });
    return response(init.method === 'GET' ? 200 : 409, init.method === 'GET' ? getBody() : { ok: false, code: 'gm_draft_conflict', revision: 13 });
  } });
  await value.inspect();
  await assert.rejects(value.prepareRevision(HEAD_REVISION, document), (error) => error.code === 'gm_draft_conflict' && error.status === 409);
  assert.equal(calls.length, 2);
  assert.equal(value.pending, null);
  assert.equal(source.writes.length, 0);
  assert.equal(source.snapshot(), null);
});

test('late successful response after cancel is ignored', async () => {
  let release, started;
  const began = new Promise((resolve) => { started = resolve; });
  const pendingResponse = new Promise((resolve) => { release = resolve; });
  const { value } = client({ fetchImpl: async (_url, init) => {
    if (init.method === 'GET') return response(200, getBody());
    started(); return pendingResponse;
  } });
  await value.inspect();
  const attempt = value.prepareRevision(HEAD_REVISION, document);
  await began;
  value.cancel();
  release(response(200, postBody()));
  await assert.rejects(attempt, (error) => error instanceof RemoteDraftError && ['auth', 'cancelled'].includes(error.code));
});

test('late successful response after sign-out is ignored', async () => {
  let release, started;
  const began = new Promise((resolve) => { started = resolve; });
  const pendingResponse = new Promise((resolve) => { release = resolve; });
  const auth = authFixture();
  const { value } = client({ auth, fetchImpl: async (_url, init) => {
    if (init.method === 'GET') return response(200, getBody());
    started(); return pendingResponse;
  } });
  await value.inspect();
  const attempt = value.prepareRevision(HEAD_REVISION, document);
  await began;
  auth.state = { signedIn: false, accountId: null };
  release(response(200, postBody()));
  await assert.rejects(attempt, (error) => error instanceof RemoteDraftError && error.code === 'auth');
});

test('wrong artifact hash returns no preparation artifact', async () => {
  const broken = artifact(); broken.revisionId = '0'.repeat(64);
  const { value } = client({ fetchImpl: async (_url, init) => response(200, init.method === 'GET' ? getBody() : postBody(broken)) });
  await value.inspect();
  await assert.rejects(value.prepareRevision(HEAD_REVISION, document), (error) =>
    error instanceof RemoteDraftError && ['response', 'unavailable'].includes(error.code));
});

test('wrong returned head revision or scope is rejected as a response', async () => {
  for (const body of [postBody(artifact(), { headRevision: HEAD_REVISION + 1 }),
    { ...postBody(), scope: { ...SCOPE, worldId: 'other-world' } }]) {
    const { value } = client({ fetchImpl: async (_url, init) => response(200, init.method === 'GET' ? getBody() : body) });
    await value.inspect();
    await assert.rejects(value.prepareRevision(HEAD_REVISION, document), (error) => error.code === 'response');
  }
});
