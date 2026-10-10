import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecoration,
  createDecoration,
  createDocument,
  createDocumentHistory,
  DocumentValidationError,
  removeDecoration,
  updateDecoration,
  validateDocument,
} from '../src/editor/document.js';
import {
  DraftConflictError,
  DraftStore,
  DraftStoreError,
} from '../src/editor/draftStore.js';

const sourceDoc = () => createDocument({ seed: 99282957, baseRevision: 'terrain-s21', objects: [] });
const rock = (id = 'decor-rock-1') => createDecoration({
  id,
  assetId: 'prop.rock.small',
  position: { x: 12, y: 2.4, z: -7 },
  rotation: { x: 0, y: Math.PI / 2, z: 0 },
  scale: 1.25,
  collider: { type: 'circle', radius: 1.5 },
});

class MemoryDraftSource {
  records = new Map();
  async read(key) { const value = this.records.get(key); return value ? structuredClone(value) : null; }
  async compareAndSwap(key, expectedRevision, nextRecord) {
    const currentRevision = this.records.get(key)?.revision ?? 0;
    if (currentRevision !== expectedRevision) return false;
    this.records.set(key, structuredClone(nextRecord));
    return true;
  }
}

test('document v1 validates stable decorative instances and round-trips canonically', () => {
  const doc = addDecoration(sourceDoc(), rock());
  const json = JSON.stringify(doc);
  assert.deepEqual(validateDocument(JSON.parse(json)), doc);
  assert.deepEqual(doc.base, { seed: 99282957, revision: 'terrain-s21' });
  assert.equal(doc.objects[0].id, 'decor-rock-1');
  assert.equal(doc.objects[0].collider.type, 'circle');
});

test('document rejects non-finite/out-of-bounds transforms, malformed IDs, duplicates, and invalid colliders', () => {
  const base = sourceDoc();
  assert.throws(() => createDecoration({ id: '../escape', assetId: 'rock', position: { x: 0, y: 0, z: 0 } }), DocumentValidationError);
  assert.throws(() => createDecoration({ id: 'ok', assetId: '../asset', position: { x: 0, y: 0, z: 0 } }), DocumentValidationError);
  assert.throws(() => createDecoration({ id: 'ok', assetId: 'rock', position: { x: Number.NaN, y: 0, z: 0 } }), DocumentValidationError);
  assert.throws(() => createDecoration({ id: 'ok', assetId: 'rock', position: { x: 281, y: 0, z: 0 } }), DocumentValidationError);
  assert.throws(() => createDecoration({ id: 'ok', assetId: 'rock', position: { x: 0, y: 0, z: 0 }, scale: 0 }), DocumentValidationError);
  assert.throws(() => createDecoration({ id: 'ok', assetId: 'rock', position: { x: 0, y: 0, z: 0 }, collider: { type: 'box' } }), DocumentValidationError);
  assert.throws(() => addDecoration(addDecoration(base, rock()), rock()), DocumentValidationError);
  assert.throws(() => validateDocument({ ...base, objects: [{ ...rock(), extra: true }] }), DocumentValidationError);
});

test('decoration edits are immutable and history undo/redo follows committed versions', () => {
  const initial = addDecoration(sourceDoc(), rock());
  const moved = updateDecoration(initial, 'decor-rock-1', { transform: {
    position: { x: 15, y: 2.4, z: -7 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1.25,
  } });
  const removed = removeDecoration(moved, 'decor-rock-1');
  assert.equal(initial.objects[0].transform.position.x, 12);
  const history = createDocumentHistory(initial, { limit: 4 });
  history.commit(moved);
  history.commit(removed);
  assert.equal(history.current().objects.length, 0);
  assert.equal(history.canUndo(), true);
  assert.equal(history.undo().objects[0].transform.position.x, 15);
  assert.equal(history.undo().objects[0].transform.position.x, 12);
  assert.equal(history.canUndo(), false);
  assert.equal(history.redo().objects[0].transform.position.x, 15);
  const branched = addDecoration(history.current(), createDecoration({ id: 'tree-1', assetId: 'prop.tree', position: { x: 3, y: 0, z: 4 } }));
  history.commit(branched);
  assert.equal(history.canRedo(), false);
});

test('draft saves use revision CAS across two store instances and reject stale tab writes', async () => {
  const source = new MemoryDraftSource();
  const tabA = new DraftStore({ worldId: 'salty-shore', source });
  const tabB = new DraftStore({ worldId: 'salty-shore', source });
  const starting = await tabA.load();
  assert.deepEqual(starting, { revision: 0, document: null });
  const [a, b] = await Promise.allSettled([
    tabA.save(addDecoration(sourceDoc(), rock()), { expectedRevision: 0 }),
    tabB.save(sourceDoc(), { expectedRevision: 0 }),
  ]);
  assert.equal([a, b].filter((result) => result.status === 'fulfilled').length, 1);
  const conflict = [a, b].find((result) => result.status === 'rejected');
  assert.ok(conflict.reason instanceof DraftConflictError);
  assert.equal(conflict.reason.currentRevision, 1);
});

test('draft export/import round-trip keeps the document and still requires the target revision', async () => {
  const source = new MemoryDraftSource();
  const first = new DraftStore({ worldId: 'salty-shore', source });
  const target = new DraftStore({ worldId: 'private-test', source });
  const expected = addDecoration(sourceDoc(), rock());
  await first.save(expected, { expectedRevision: 0 });
  const exported = await first.export();
  const imported = await target.import(exported, { expectedRevision: 0 });
  assert.equal(imported.revision, 1);
  assert.deepEqual(imported.document, expected);
  await assert.rejects(target.import(exported, { expectedRevision: 0 }), DraftConflictError);
  await assert.rejects(target.import('{broken', { expectedRevision: 1 }), (error) => error instanceof DraftStoreError && error.code === 'import_json');
});

test('recovery is isolated from the normal draft and preserves the original draft revision', async () => {
  const source = new MemoryDraftSource();
  const store = new DraftStore({ worldId: 'salty-shore', source });
  const savedDraft = await store.save(addDecoration(sourceDoc(), rock()), { expectedRevision: 0 });
  const recoveryDocument = addDecoration(sourceDoc(), rock('decor-rock-recovery'));
  const savedRecovery = await store.saveRecovery(recoveryDocument, { expectedRevision: savedDraft.revision });

  assert.deepEqual(savedRecovery, { revision: 1, document: recoveryDocument, expectedRevision: 1 });
  assert.deepEqual(await store.loadRecovery(), savedRecovery);
  assert.deepEqual(await store.load(), savedDraft);
  assert.equal(source.records.has('draft:salty-shore'), true);
  assert.equal(source.records.has('recovery:salty-shore'), true);
});

test('concurrent recovery writes use CAS and leave the winning document intact', async () => {
  const source = new MemoryDraftSource();
  const tabA = new DraftStore({ worldId: 'salty-shore', source });
  const tabB = new DraftStore({ worldId: 'salty-shore', source });
  const docA = addDecoration(sourceDoc(), rock('recovery-a'));
  const docB = addDecoration(sourceDoc(), rock('recovery-b'));
  const [a, b] = await Promise.allSettled([
    tabA.saveRecovery(docA, { expectedRevision: 4 }),
    tabB.saveRecovery(docB, { expectedRevision: 4 }),
  ]);
  assert.equal([a, b].filter((result) => result.status === 'fulfilled').length, 1);
  const winner = [a, b].find((result) => result.status === 'fulfilled').value;
  const conflict = [a, b].find((result) => result.status === 'rejected');
  assert.ok(conflict.reason instanceof DraftConflictError);
  assert.equal(conflict.reason.currentRevision, 1);
  assert.deepEqual(await tabA.loadRecovery(), winner);
  assert.equal((await tabA.loadRecovery()).expectedRevision, 4);
});

test('recovery clear uses its record revision and cannot clear a newer concurrent save', async () => {
  const source = new MemoryDraftSource();
  const tabA = new DraftStore({ worldId: 'salty-shore', source });
  const tabB = new DraftStore({ worldId: 'salty-shore', source });
  const first = await tabA.saveRecovery(addDecoration(sourceDoc(), rock('recovery-first')), { expectedRevision: 2 });
  const newer = await tabB.saveRecovery(addDecoration(sourceDoc(), rock('recovery-newer')), { expectedRevision: 2 });
  assert.equal(newer.revision, first.revision + 1);

  await assert.rejects(tabA.clearRecovery({ expectedRevision: first.revision }), (error) =>
    error instanceof DraftConflictError && error.currentRevision === newer.revision);
  assert.deepEqual(await tabA.loadRecovery(), newer);

  const cleared = await tabA.clearRecovery({ expectedRevision: newer.revision });
  assert.deepEqual(cleared, { revision: newer.revision + 1, document: null });
  assert.equal(await tabB.loadRecovery(), null);
  assert.equal((await tabB.load()).document, null);
});
