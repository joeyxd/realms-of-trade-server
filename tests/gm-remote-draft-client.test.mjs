import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteDraftClient } from '../src/editor/remoteDraft.js';
import { createDocument, createDecoration } from '../src/editor/document.js';

const GM = '10000000-0000-4000-8000-000000000001';
const scope = { worldId: 'marea-negra', seed: 42, baseRevision: 'terrain-s21-v1' };
const doc = (label = 'one') => createDocument({ seed: scope.seed, baseRevision: scope.baseRevision,
  objects: [createDecoration({ id: label, assetId: 'prop:storage-crate', position: { x: 1, y: 0, z: 2 } })] });
const clone = (value) => value === undefined ? undefined : structuredClone(value);

class MemoryCas {
  value = null;
  failWrite = false;
  async read() { return clone(this.value); }
  async compareAndSwap(_key, expected, next) {
    if (this.failWrite) throw new Error('quota');
    const revision = this.value?.revision ?? 0;
    if (revision !== expected) return false;
    this.value = clone(next); return true;
  }
}

function auth() {
  return { state: { signedIn: true, accountId: GM }, async sessionIdentity() { return { accountId: GM, token: 'ephemeral-token' }; } };
}

function response({ head = { revision: 0, document: null, savedAt: null }, durable = true,
  responseScope = scope, replay = false, status = 200, code = null } = {}) {
  const body = status >= 400 ? { ok: false, code, revision: head.revision } :
    { ok: true, durable, scope: responseScope, head, ...(replay ? { replay: true } : {}) };
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return clone(body); } };
}

function makeClient({ source = new MemoryCas(), authState = auth(), fetchImpl, localScope = 'tab-a' } = {}) {
  return { source, authState, client: new RemoteDraftClient({ auth: authState, accountId: GM,
    httpBase: 'https://game.invalid/', localScope, source, fetchImpl }) };
}

test('save records exact attempt before PUT and keeps credentials out of recovery storage', async () => {
  const source = new MemoryCas(); let observed;
  const { client } = makeClient({ source, fetchImpl: async (_url, init) => {
    if (init.method === 'GET') return response();
    observed = { persisted: await source.read(), init };
    const operation = JSON.parse(init.body);
    return response({ head: { revision: 1, document: operation.document, savedAt: '2026-10-10T12:00:00Z' } });
  } });
  await client.inspect();
  const saved = await client.save(doc(), 0);
  assert.equal(observed.persisted.operation.operationId, JSON.parse(observed.init.body).operationId);
  assert.deepEqual(observed.persisted.operation.document, doc());
  assert.equal(observed.persisted.operation.expectedRevision, 0);
  assert.match(observed.init.headers.authorization, /^Bearer ephemeral-token$/);
  assert.doesNotMatch(JSON.stringify(observed.persisted), /ephemeral-token|authorization/i);
  assert.equal(saved.durable, true);
  assert.equal((await source.read()).operation, null);
});

test('fresh client retries the exact UUID and payload after a committed PUT lost its response', async () => {
  const source = new MemoryCas(); const operations = new Map(); const calls = [];
  let remoteHead = { revision: 0, document: null, savedAt: null };
  const fetchImpl = async (_url, init) => {
    if (init.method === 'GET') return response({ head: remoteHead });
    const op = JSON.parse(init.body); calls.push(clone(op));
    const prior = operations.get(op.operationId);
    if (!prior) {
      const committed = { revision: 1, document: op.document, savedAt: '2026-10-10T12:00:00Z' };
      operations.set(op.operationId, committed);
      remoteHead = committed;
      throw new Error('connection closed after commit');
    }
    return response({ head: prior, replay: true });
  };
  const first = makeClient({ source, fetchImpl }); await first.client.inspect();
  await assert.rejects(first.client.save(doc(), 0), { code: 'unavailable' });
  const persisted = await source.read(); assert.ok(persisted.operation);
  const second = makeClient({ source, fetchImpl });
  const inspected = await second.client.inspect();
  assert.equal(inspected.head.revision, 1);
  const retried = await second.client.retry();
  assert.equal(retried.replay, true);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal((await source.read()).operation, null);
});

test('guaranteed remote CAS conflict clears only its attempt and leaves caller draft intact', async () => {
  const source = new MemoryCas(); let localDraft = doc('preserve');
  const { client } = makeClient({ source, fetchImpl: async (_url, init) => init.method === 'GET'
    ? response() : response({ head: { revision: 7, document: doc('remote'), savedAt: 'then' }, status: 409, code: 'gm_draft_conflict' }) });
  await client.inspect();
  await assert.rejects(client.save(localDraft, 0), { code: 'gm_draft_conflict' });
  assert.deepEqual(localDraft, doc('preserve'));
  assert.equal((await source.read()).operation, null);
  assert.equal(client.pending, null);
});

test('a second tab with a stale remote head conflicts without replacing local work', async () => {
  const source = new MemoryCas(); let remote = { revision: 0, document: null, savedAt: null };
  const fetchImpl = async (_url, init) => {
    if (init.method === 'GET') return response({ head: remote });
    const op = JSON.parse(init.body);
    if (op.expectedRevision !== remote.revision) return response({ head: remote, status: 409, code: 'gm_draft_conflict' });
    remote = { revision: remote.revision + 1, document: op.document, savedAt: 'now' };
    return response({ head: remote });
  };
  const tabA = makeClient({ source, fetchImpl, localScope: 'tab-a' }).client;
  const tabB = makeClient({ source: new MemoryCas(), fetchImpl, localScope: 'tab-b' }).client;
  await tabA.inspect(); await tabB.inspect();
  await tabA.save(doc('a'), 0);
  const preserved = doc('b');
  await assert.rejects(tabB.save(preserved, 0), { code: 'gm_draft_conflict' });
  assert.deepEqual(preserved, doc('b'));
  assert.equal((await tabB.source.read()).operation, null);
});

test('local recovery quota failure blocks PUT', async () => {
  const source = new MemoryCas(); source.failWrite = true; let puts = 0;
  const { client } = makeClient({ source, fetchImpl: async (_url, init) => {
    if (init.method === 'PUT') puts++;
    return response();
  } });
  await client.inspect();
  await assert.rejects(client.save(doc(), 0), { code: 'local_recovery_unavailable' });
  assert.equal(puts, 0);
});

test('cancel or signout during an in-flight PUT is not accepted and preserves the exact attempt', async () => {
  const source = new MemoryCas(); let finishPut; let putStarted;
  const started = new Promise((resolve) => { putStarted = resolve; });
  const fetchImpl = async (_url, init) => {
    if (init.method === 'GET') return response();
    putStarted();
    return new Promise((resolve) => { finishPut = () => resolve(response({
      head: { revision: 1, document: JSON.parse(init.body).document, savedAt: 'now' },
    })); });
  };
  const authState = auth(); const { client } = makeClient({ source, authState, fetchImpl });
  await client.inspect();
  const pendingSave = client.save(doc(), 0); await started;
  const attempt = (await source.read()).operation; assert.ok(attempt);
  client.cancel(); authState.state = { signedIn: false, accountId: '' };
  finishPut();
  await assert.rejects(pendingSave, (error) => ['auth', 'cancelled'].includes(error.code));
  assert.deepEqual((await source.read()).operation, attempt);
});

test('wrong scope and malformed success head retain the pending attempt', async () => {
  const source = new MemoryCas(); let putReply = null;
  const { client } = makeClient({ source, fetchImpl: async (_url, init) => init.method === 'GET'
    ? response() : putReply });
  await client.inspect();
  putReply = response({ responseScope: { ...scope, worldId: 'other-world' },
    head: { revision: 1, document: doc(), savedAt: 'now' } });
  await assert.rejects(client.save(doc(), 0), { code: 'response' });
  const exactAttempt = (await source.read()).operation; assert.ok(exactAttempt);
  client.cancel(); client.resume();
  putReply = response({ head: { revision: 2, document: doc(), savedAt: 'now' } });
  await assert.rejects(client.retry(), { code: 'response' });
  assert.deepEqual((await source.read()).operation, exactAttempt);
});

test('retry replay receipt and current inspected head remain separately visible; non-durable ACK is explicit', async () => {
  const source = new MemoryCas(); const old = { revision: 1, document: doc('old'), savedAt: 'old-time' };
  const current = { revision: 2, document: doc('new'), savedAt: 'new-time' };
  let mode = 'initial';
  const fetchImpl = async (_url, init) => {
    if (init.method === 'GET') return response({ head: mode === 'current' ? current : { revision: 0, document: null, savedAt: null } });
    const op = JSON.parse(init.body);
    if (mode === 'initial') { mode = 'current'; throw new Error('lost response'); }
    return response({ head: old, replay: true, durable: false });
  };
  const { client } = makeClient({ source, fetchImpl }); await client.inspect();
  await assert.rejects(client.save(doc('old'), 0), { code: 'unavailable' });
  const inspection = await client.inspect();
  assert.equal(inspection.head.revision, 2);
  const receipt = await client.retry();
  assert.equal(receipt.head.revision, 1);
  assert.equal(receipt.replay, true);
  assert.equal(receipt.durable, false);
  assert.equal(inspection.head.revision, 2);
  assert.equal((await source.read()).operation, null);
});
