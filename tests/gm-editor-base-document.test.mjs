import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDocument, createDocumentHistory, DocumentValidationError, removeBaseOverride,
  setBaseOverride, validateDocument,
} from '../src/editor/document.js';
import { DraftStore } from '../src/editor/draftStore.js';

const baseDoc = () => createDocument({ seed: 42, baseRevision: 'terrain-a' });
const transform = (x = 2) => ({
  position: { x, y: 0, z: -3 },
  rotation: { x: 0, y: Math.PI / 2, z: 0 },
  scale: 1,
});
const override = (id = 'base:rock:14:abcdef123456') => ({ id, transform: transform(), hidden: false });
const legacy = () => ({
  schema: 'marea.gm.map-draft', version: 1,
  base: { seed: 42, revision: 'terrain-a' },
  objects: [{ id: 'decor-a', assetId: 'prop.tree', transform: transform(), collider: 'none' }],
});

class MemoryDraftSource {
  records = new Map();
  async read(key) { const value = this.records.get(key); return value ? structuredClone(value) : null; }
  async compareAndSwap(key, expectedRevision, nextRecord) {
    if ((this.records.get(key)?.revision ?? 0) !== expectedRevision) return false;
    this.records.set(key, structuredClone(nextRecord));
    return true;
  }
}

test('v1 documents migrate to canonical v2 without changing decoration data', () => {
  const old = legacy();
  const migrated = validateDocument(old);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.baseOverrides, []);
  assert.deepEqual(migrated.objects, old.objects);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(migrated))), migrated);
  assert.throws(() => validateDocument({ ...old, extra: true }), DocumentValidationError);
  assert.throws(() => validateDocument({ ...old, version: 3 }), DocumentValidationError);
});

test('override upsert, hide, removal, and history undo/redo preserve immutable states', () => {
  const initial = baseDoc();
  const moved = setBaseOverride(initial, { ...override(), transform: transform(10) });
  const hidden = setBaseOverride(moved, { ...override(), hidden: true });
  assert.deepEqual(initial.baseOverrides, []);
  assert.equal(moved.baseOverrides[0].transform.position.x, 10);
  assert.equal(hidden.baseOverrides[0].hidden, true);
  const history = createDocumentHistory(initial);
  history.commit(moved);
  history.commit(hidden);
  assert.equal(history.undo().baseOverrides[0].hidden, false);
  assert.equal(history.redo().baseOverrides[0].hidden, true);
  assert.deepEqual(removeBaseOverride(hidden, override().id).baseOverrides, []);
  assert.throws(() => removeBaseOverride(initial, override().id), DocumentValidationError);
});

test('v2 rejects malformed overrides, unknown fields, duplicates, and combined capacity overflow', () => {
  const doc = baseDoc();
  const valid = override();
  const withOverride = { ...doc, baseOverrides: [valid] };
  for (const bad of [
    { ...valid, extra: 1 },
    { ...valid, id: 'base:tree:14:abcdef' },
    { ...valid, id: 'base:rock:-1:abcdef' },
    { ...valid, hidden: 0 },
    { ...valid, transform: { ...transform(), scale: Infinity } },
    { ...valid, transform: { ...transform(), position: { ...transform().position, x: 281 } } },
  ]) assert.throws(() => validateDocument({ ...doc, baseOverrides: [bad] }), DocumentValidationError);
  assert.throws(() => validateDocument({ ...doc, baseOverrides: [valid, valid] }), DocumentValidationError);
  assert.throws(() => validateDocument({ ...doc, objects: [{ id: valid.id, assetId: 'tree', transform: transform(), collider: 'none' }], baseOverrides: [valid] }), DocumentValidationError);
  assert.throws(() => validateDocument({ ...doc, baseOverrides: [valid], extra: 1 }), DocumentValidationError);
  assert.throws(() => validateDocument({ ...doc, objects: Array(5000).fill({ id: 'decor', assetId: 'tree', transform: transform(), collider: 'none' }), baseOverrides: [valid] }), DocumentValidationError);
});

test('draft stores migrate and round-trip v1 through save, load, recovery, and export/import', async () => {
  const source = new MemoryDraftSource();
  source.records.set('draft:old-world', { revision: 1, document: legacy() });
  const first = new DraftStore({ worldId: 'old-world', source });
  const second = new DraftStore({ worldId: 'new-world', source });
  const loaded = await first.load();
  assert.equal(loaded.document.version, 2);
  assert.equal(loaded.document.objects[0].id, 'decor-a');
  assert.deepEqual(loaded.document.baseOverrides, []);
  const edited = setBaseOverride(loaded.document, override());
  const saved = await first.save(edited, { expectedRevision: loaded.revision });
  assert.deepEqual((await first.load()).document, edited);
  const recovered = await first.saveRecovery(edited, { expectedRevision: saved.revision });
  assert.deepEqual((await first.loadRecovery()).document, edited);
  const imported = await second.import(await first.export(), { expectedRevision: 0 });
  assert.deepEqual(imported.document, edited);
  assert.deepEqual(recovered.document.baseOverrides, edited.baseOverrides);
});
