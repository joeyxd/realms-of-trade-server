import assert from 'node:assert/strict';
import test from 'node:test';
import { WorldEditor } from '../src/editor/editor.js';
import { createDocument } from '../src/editor/document.js';
import { EditorStatus, editorMessage } from '../src/editor/messages.js';

test('a pending draft save persists successfully without hiding a rejected terrain edit', async () => {
  const document = createDocument({ seed: 42, baseRevision: 'terrain-a' });
  let finish;
  const editor = Object.create(WorldEditor.prototype);
  Object.assign(editor, {
    history: { current: () => document }, dirty: true, revision: 3, saveTask: null,
    status: new EditorStatus(null), _clearRecovery: async () => {}, _updateButtons: () => {},
    store: { save: () => new Promise(resolve => { finish = resolve; }) },
  });
  editor._setStatus(editorMessage('Saving', 'Guardando'), 'saving');
  const saving = editor.saveNow();
  const rejected = editorMessage('Protected ground', 'Suelo protegido');
  editor._setStatus(rejected, 'error');
  finish({ revision: 4, document });
  assert.equal(await saving, true);
  assert.equal(editor.revision, 4);
  assert.equal(editor.dirty, false);
  assert.equal(editor.status.kind, 'error');
  assert.equal(editor.status.message, rejected);
});
