import assert from 'node:assert/strict';
import test from 'node:test';
import { WorldEditor } from '../src/editor/editor.js';
import { createDecoration, createDocument } from '../src/editor/document.js';
import { createTemplate } from '../src/editor/templates.js';

test('a real editor mixed selection can be captured without changing document objects', () => {
  const object = createDecoration({ id: 'crate', assetId: 'prop:storage-crate', position: { x: 4, y: 2, z: 3 } });
  const document = createDocument({ seed: 42, baseRevision: 'terrain-a', objects: [object] });
  const before = structuredClone(document);
  const base = { id: 'base:rock:1:abcdef', transform: { position: { x: 2, y: 1, z: 3 },
    rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, collider: 'none' };
  const editor = Object.create(WorldEditor.prototype);
  editor.history = { current: () => document };
  editor.selectedIds = new Set(['crate', base.id]);
  editor.baseLayer = new Map([[base.id, base]]);
  const template = createTemplate({ id: 'mixed', name: 'Mixed scene', document, items: editor._selectedItems() });
  assert.deepEqual(template.objects.map(item => item.assetId), [object.assetId, base.id]);
  assert.deepEqual(template.objects.map(item => item.transform.position), [{ x: 1, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }]);
  assert.deepEqual(document, before);
});
