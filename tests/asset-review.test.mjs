import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetReviewStore, DECISIONS, REVIEW_TASKS, REVIEW_SCHEMA } from '../src/editor/assetReview.js';

const scope = { accountId: 'account-7', serverId: 'server-a' };
const entry = { id: 'aw-pilot-01', sourceRevision: 'snapshot-a' };
const draft = (overrides = {}) => ({ decision: 'unreviewed', tasks: ['materials'], notes: 'Revisar materiales', use: 'material de referencia', collection: 'Construcción', ...overrides });
const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
};

test('scope, decisions and tasks are explicit and reviews are account/server scoped', () => {
  assert.deepEqual(DECISIONS.map((item) => item.id), ['unreviewed', 'use', 'adapt', 'reserve', 'reject', 'inspect']);
  assert.deepEqual(REVIEW_TASKS.map((item) => item.id), ['retexture', 'optimize', 'rig', 'pivot', 'materials', 'dependencies', 'mobile']);
  assert.throws(() => new AssetReviewStore({ scope: { accountId: 'a' }, storage: null }), /accountId y serverId/);
  const storage = memoryStorage();
  const first = new AssetReviewStore({ scope, storage });
  assert.equal(first.save(entry, draft()).ok, true);
  const otherScope = new AssetReviewStore({ scope: { accountId: 'account-8', serverId: 'server-a' }, storage });
  assert.equal(otherScope.get(entry), null);
  assert.equal(first.document.schema, REVIEW_SCHEMA);
});

test('records preserve revision history and source changes make old reviews historical', () => {
  const storage = memoryStorage();
  const store = new AssetReviewStore({ scope, storage, now: () => new Date('2026-10-14T18:00:00.000Z') });
  const first = store.save(entry, draft(), { expectedRevision: 0 });
  assert.equal(first.ok, true);
  assert.equal(store.get(entry).revision, 1);
  const second = store.save(entry, draft({ decision: 'use', tasks: ['materials', 'mobile'], notes: 'Visto' }), { expectedRevision: 1 });
  assert.equal(second.ok, true);
  assert.equal(second.record.history.length, 1);
  assert.equal(second.record.history[0].decision, 'unreviewed');
  assert.deepEqual(second.record.history[0].tasks, ['materials']);
  assert.equal(second.record.history[0].use, 'material de referencia');
  assert.equal(second.record.history[0].collection, 'Construcción');
  assert.equal(second.record.history[0].notes, 'Revisar materiales');
  assert.equal(store.get({ ...entry, sourceRevision: 'snapshot-b' }), null);
  assert.equal(store.getHistory({ id: entry.id }).length, 1);
  assert.equal(JSON.parse(store.export()).records[0].sourceRevision, 'snapshot-a');
});

test('second tab detects same-record conflicts and merges independent asset reviews', () => {
  const storage = memoryStorage();
  const tabA = new AssetReviewStore({ scope, storage });
  const tabB = new AssetReviewStore({ scope, storage });
  assert.equal(tabA.save(entry, draft()).ok, true);
  const conflict = tabB.save(entry, draft(), { expectedRevision: 0 });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'conflict');
  assert.equal(conflict.actualRevision, 1);
  assert.equal(tabB.document.revision, 0, 'the losing tab keeps its local view until reload');
  const otherAsset = tabB.save({ id: 'aw-pilot-02', sourceRevision: 'snapshot-a' }, draft(), { expectedRevision: 0 });
  assert.equal(otherAsset.ok, true, 'independent asset drafts can merge across tabs');
});

test('storage corruption and quota failures are visible while session export stays available', () => {
  const storage = memoryStorage();
  const seed = new AssetReviewStore({ scope, storage });
  storage.values.set(seed.key, '{broken');
  const corrupt = new AssetReviewStore({ scope, storage });
  const failed = corrupt.save(entry, draft());
  assert.equal(failed.ok, false);
  assert.match(failed.error, /No se pudo leer el borrador guardado/);
  assert.equal(JSON.parse(corrupt.export()).records.length, 0);

  let allowWrite = false;
  const quota = { getItem: () => null, setItem: () => { if (!allowWrite) throw new Error('quota exceeded'); } };
  const memoryOnly = new AssetReviewStore({ scope, storage: quota });
  const result = memoryOnly.save(entry, draft());
  assert.equal(result.ok, false);
  assert.match(result.error, /quota exceeded/);
  assert.equal(memoryOnly.get(entry).decision, 'unreviewed');
  assert.equal(JSON.parse(memoryOnly.export()).records.length, 1);
  allowWrite = true;
  const retry = memoryOnly.save(entry, draft({ decision: 'use' }), { expectedRevision: 0 });
  assert.equal(retry.ok, true);
  assert.equal(retry.persisted, true);
  assert.equal(memoryOnly.get(entry).decision, 'use');
});

test('imports merge transactionally and reject scope, replacement and conflicting records', () => {
  const storage = memoryStorage();
  const source = new AssetReviewStore({ scope, storage });
  assert.equal(source.save(entry, draft()).ok, true);
  const serialized = source.export();
  const target = new AssetReviewStore({ scope, storage: memoryStorage() });
  const imported = target.import(serialized);
  assert.equal(imported.ok, true);
  assert.equal(target.get(entry).decision, 'unreviewed');
  assert.equal(target.import(serialized).ok, true);
  assert.equal(target.import(serialized, { mode: 'replace' }).ok, false);

  const different = new AssetReviewStore({ scope, storage: memoryStorage() });
  different.save(entry, draft({ decision: 'reject' }));
  const before = target.export();
  const conflict = target.import(different.export());
  assert.equal(conflict.ok, false);
  assert.equal(target.export(), before);

  const wrongScope = new AssetReviewStore({ scope: { accountId: 'other', serverId: 'server-a' }, storage: memoryStorage() });
  assert.equal(target.import(wrongScope.export()).ok, false);
});

test('validates input sizes, enum values and prototype-like import fields', () => {
  const store = new AssetReviewStore({ scope, storage: memoryStorage() });
  assert.equal(store.save(entry, draft({ decision: '__proto__' })).ok, false);
  assert.equal(store.save(entry, draft({ notes: 'x'.repeat(5001) })).ok, false);
  const payload = JSON.parse(store.export());
  payload['__proto__'] = { polluted: true };
  assert.equal(store.import(JSON.stringify(payload)).ok, true);
  assert.equal({}.polluted, undefined);
});

test('no-storage writes remain exportable but are never reported as persisted', () => {
  const store = new AssetReviewStore({ scope, storage: null });
  const result = store.save(entry, draft());
  assert.equal(result.ok, false);
  assert.equal(result.persisted, false);
  assert.equal(result.recoverable, true);
  assert.equal(JSON.parse(store.export()).records.length, 1);
});

test('import preserves pending drafts as recoverable output and never silently merges them', () => {
  const source = new AssetReviewStore({ scope, storage: memoryStorage() });
  source.save(entry, draft());
  const bundle = JSON.parse(source.export());
  bundle.pendingDrafts = [{ assetId: entry.id, sourceRevision: entry.sourceRevision, variantId: 'base', expectedRevision: 1, ...draft({ decision: 'adapt' }) }];
  const target = new AssetReviewStore({ scope, storage: memoryStorage() });
  const before = target.export();
  const result = target.import(JSON.stringify(bundle));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'pending_drafts');
  assert.equal(result.recoverableDrafts.length, 1);
  assert.equal(target.export(), before);
});
