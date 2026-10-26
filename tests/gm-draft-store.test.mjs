import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryGmDraftMethods } from '../server/gmDraftStore.mjs';

const owner = 'a1b2c3d4-e5f6-4789-8123-123456789abc';
const operation = n => `b1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const document = (revision = 'map-v1', seed = 42) => ({ schema: 'marea.gm.map-draft', version: 2,
  base: { seed, revision }, objects: [], baseOverrides: [] });

test('memory GM draft store identifies itself as non-durable and loads an empty head', async () => {
  const store = createMemoryGmDraftMethods();
  assert.deepEqual(await store.checkGmDrafts(), { version: 1 });
  assert.deepEqual(await store.loadGmDraft({ world: 'salty-shore', owner }), { revision: 0, document: null, savedAt: null });
});

test('memory GM draft store CAS permits one concurrent writer and preserves exact replay', async () => {
  const store = createMemoryGmDraftMethods();
  const base = { world: 'salty-shore', owner, expectedRevision: 0, document: document() };
  const [first, second] = await Promise.all([
    store.saveGmDraft({ ...base, operationId: operation(1) }),
    store.saveGmDraft({ ...base, operationId: operation(2) }),
  ]);
  assert.equal([first, second].filter(result => result.ok).length, 1);
  const winner = first.ok ? { ...base, operationId: operation(1) } : { ...base, operationId: operation(2) };
  const saved = first.ok ? first : second;
  assert.equal(saved.head.revision, 1);
  assert.deepEqual(await store.saveGmDraft(winner), { ...saved, replay: true });
  assert.deepEqual(await store.saveGmDraft({ ...winner, document: document('other-map') }), { ok: false, why: 'operation' });
  const loser = first.ok ? { ...base, operationId: operation(2) } : { ...base, operationId: operation(1) };
  const conflict = first.ok ? second : first;
  assert.deepEqual(await store.saveGmDraft(loser), conflict);
  assert.deepEqual(await store.saveGmDraft({ ...loser, document: document('other-map') }), { ok: false, why: 'operation' });
  assert.deepEqual(await store.loadGmDraft({ world: 'salty-shore', owner }), saved.head);
});

test('memory GM draft store rejects malformed scope, document version and oversized documents', async () => {
  const store = createMemoryGmDraftMethods();
  await assert.rejects(store.loadGmDraft({ world: 'bad world', owner }), { code: 'scope' });
  await assert.rejects(store.saveGmDraft({ world: 'salty-shore', owner, operationId: operation(3),
    expectedRevision: 0, document: { ...document(), version: 1 } }), { code: 'document' });
  await assert.rejects(store.saveGmDraft({ world: 'salty-shore', owner, operationId: operation(4),
    expectedRevision: 0, document: { ...document(), objects: [{ id: 'x', assetId: 'a', transform: {
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, collider: 'none', extra: 'x'.repeat(5 * 1024 * 1024) }] } }),
  error => error.code === 'document' || error.code === 'document_size');
});
