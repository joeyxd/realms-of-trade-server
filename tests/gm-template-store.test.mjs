import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecoration, createDocument } from '../src/editor/document.js';
import { createTemplate, createTemplateLibrary, MAX_TEMPLATES, MAX_TEMPLATE_BYTES } from '../src/editor/templates.js';
import { TemplateStore, MAX_TEMPLATE_REVISION, createIndexedDbTemplateSource } from '../src/editor/templateStore.js';

const base = { seed: 42, revision: 'terrain-a' };
const empty = createTemplateLibrary();
const at = (x) => ({ position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 });
const sample = (id = 'tpl-a', name = 'Crate') => {
  const object = createDecoration({ id: 'source', assetId: 'prop:crate', position: { x: 0, y: 0, z: 0 } });
  const document = createDocument({ seed: base.seed, baseRevision: base.revision, objects: [object] });
  return createTemplate({ id, name, document, items: [{ ...object, base: false, hidden: false }] });
};
function memorySource(initial = null, { failWrite = null } = {}) {
  const records = new Map(initial ? [['library:world-a', structuredClone(initial)]] : []);
  return { records,
    async read(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
    async compareAndSwap(key, expected, next) {
      if (failWrite) throw failWrite;
      if ((records.get(key)?.revision ?? 0) !== expected) return false;
      records.set(key, structuredClone(next)); return true;
    } };
}
function fakeIndexedDB({ first = 'error' } = {}) {
  const requests = [], databases = [];
  return { requests, databases, open() {
    const request = { result: null, error: null };
    requests.push(request);
    if (requests.length === 1 && first === 'error') queueMicrotask(() => {
      request.error = Object.assign(new Error('temporary open failure'), { name: 'UnknownError' });
      request.onerror?.();
    });
    else if (requests.length === 1 && first === 'blocked') queueMicrotask(() => request.onblocked?.());
    else queueMicrotask(() => {
      const db = { objectStoreNames: { contains: () => true }, transaction() {
        return { objectStore() { return { get() { const read = {}; queueMicrotask(() => { read.result = undefined; read.onsuccess?.(); }); return read; } }; } };
      }, close() { this.closed = true; } };
      databases.push(db); request.result = db; request.onsuccess?.();
    });
    return request;
  } };
}

test('IndexedDB open error clears cached rejection so the same source can retry', async () => {
  const indexedDB = fakeIndexedDB({ first: 'error' }), source = createIndexedDbTemplateSource({ indexedDB });
  await assert.rejects(source.read('library:world-a'), { code: 'template_indexeddb_open' });
  assert.equal(await source.read('library:world-a'), null);
  assert.equal(indexedDB.requests.length, 2);
});

test('blocked IndexedDB open retries and closes a late successful connection', async () => {
  const indexedDB = fakeIndexedDB({ first: 'blocked' }), source = createIndexedDbTemplateSource({ indexedDB });
  await assert.rejects(source.read('library:world-a'), { code: 'template_indexeddb_blocked' });
  assert.equal(await source.read('library:world-a'), null);
  const stale = { close() { this.closed = true; } };
  const blockedRequest = indexedDB.requests[0]; blockedRequest.result = stale; blockedRequest.onsuccess();
  assert.equal(stale.closed, true);
  assert.equal(indexedDB.requests.length, 2);
});

test('template store loads empty, saves and exports immutable revisioned libraries', async () => {
  const source = memorySource(), store = new TemplateStore({ worldId: 'world-a', source });
  const initial = await store.load();
  assert.deepEqual(initial, { revision: 0, library: empty });
  const library = createTemplateLibrary([sample()]);
  const saved = await store.save(library, { expectedRevision: 0 });
  assert.equal(saved.revision, 1);
  library.templates[0].name = 'mutated caller';
  assert.equal((await store.load()).library.templates[0].name, 'Crate');
  assert.deepEqual(JSON.parse(await store.export()).templates[0].name, 'Crate');
});

test('shared-source concurrent writers use CAS and report current revision without overwriting winner', async () => {
  const source = memorySource(), first = new TemplateStore({ worldId: 'world-a', source }), second = new TemplateStore({ worldId: 'world-a', source });
  const [a, b] = await Promise.allSettled([
    first.save(createTemplateLibrary([sample('tpl-a', 'A')]), { expectedRevision: 0 }),
    second.save(createTemplateLibrary([sample('tpl-b', 'B')]), { expectedRevision: 0 }),
  ]);
  assert.equal([a, b].filter((result) => result.status === 'fulfilled').length, 1);
  const loser = [a, b].find((result) => result.status === 'rejected');
  assert.equal(loser.reason.code, 'template_revision_conflict');
  assert.equal(loser.reason.expectedRevision, 0);
  assert.equal(loser.reason.currentRevision, 1);
  assert.equal((await first.load()).library.templates.length, 1);
});

test('additive import validates first, gives imported templates fresh IDs, and saves as one revision', async () => {
  const store = new TemplateStore({ worldId: 'world-a', source: memorySource() });
  await store.save(createTemplateLibrary([sample('tpl-existing')]), { expectedRevision: 0 });
  const incoming = JSON.stringify(createTemplateLibrary([sample('tpl-incoming')]));
  const imported = await store.import(incoming, { expectedRevision: 1, makeId: () => 'tpl-new' });
  assert.equal(imported.revision, 2);
  assert.deepEqual(imported.library.templates.map((entry) => entry.id), ['tpl-existing', 'tpl-new']);
  await assert.rejects(store.import(incoming, { expectedRevision: 2, makeId: () => 'tpl-existing' }), { code: 'template_duplicate_template' });
  assert.equal((await store.load()).revision, 2);
});

test('store refuses invalid scope, corrupt stored data, quota errors, size overflow, and revision exhaustion', async () => {
  assert.throws(() => new TemplateStore({ worldId: 'bad world', source: memorySource() }), { code: 'template_world_id' });
  const corruptSource = memorySource({ revision: 1, library: { schema: 'broken' } });
  const corrupt = new TemplateStore({ worldId: 'world-a', source: corruptSource });
  await assert.rejects(corrupt.load(), { code: 'template_stored_library' });
  await assert.rejects(corrupt.save(empty, { expectedRevision: 1 }), { code: 'template_stored_library' });
  assert.deepEqual(corruptSource.records.get('library:world-a'), { revision: 1, library: { schema: 'broken' } });

  const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  const failed = new TemplateStore({ worldId: 'world-a', source: memorySource(null, { failWrite: quota }) });
  await assert.rejects(failed.save(createTemplateLibrary([sample()]), { expectedRevision: 0 }), (error) => error === quota);
  const maxName = createTemplateLibrary([sample('tpl-big', 'x'.repeat(64))]);
  // Oversize through a valid bounded library by using many legal names and members is covered by serialized input limit.
  await assert.rejects(failed.import(' '.repeat(MAX_TEMPLATE_BYTES + 1), { expectedRevision: 0, makeId: () => 'x' }), { code: 'template_size' });
  assert.equal(MAX_TEMPLATES, 32);
  assert.equal(maxName.templates.length, 1);
  const maxRevision = new TemplateStore({ worldId: 'world-a', source: memorySource({ revision: MAX_TEMPLATE_REVISION, library: empty }) });
  await assert.rejects(maxRevision.save(empty, { expectedRevision: MAX_TEMPLATE_REVISION }), { code: 'template_revision_exhausted' });
});

test('library is bounded and failed saves leave source record intact', async () => {
  const over = Array.from({ length: MAX_TEMPLATES + 1 }, (_, i) => sample(`tpl-${i}`, `Name ${i}`));
  assert.throws(() => createTemplateLibrary(over), { code: 'template_library_limit' });
  const source = memorySource({ revision: 1, library: createTemplateLibrary([sample()]) });
  const store = new TemplateStore({ worldId: 'world-a', source });
  await assert.rejects(store.save(createTemplateLibrary([sample('tpl-b')]), { expectedRevision: 0 }), { code: 'template_revision_conflict' });
  assert.deepEqual((await store.load()).library.templates.map((entry) => entry.id), ['tpl-a']);
});
