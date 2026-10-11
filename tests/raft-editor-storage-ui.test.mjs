import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTISAN } from '../src/data/artisan.js';
import { RaftEditor, knowsRaftStorage, raftPlacementReason, storageEditorReason } from '../src/ui/raftEditor.js';

const profile = (knowledge = []) => ({ progression: { v: 1, practice: { logging: 60 }, milestones: [], knowledge } });

test('storage placement stays locked until the validated recipe is in current progression', () => {
  assert.equal(knowsRaftStorage(profile()), false);
  assert.equal(raftPlacementReason(profile(), [], [ARTISAN.part, 0, 0, 0]), 'knowledge');
  assert.equal(knowsRaftStorage(profile([ARTISAN.lesson])), true);
  assert.equal(raftPlacementReason(profile([ARTISAN.lesson]), [], [ARTISAN.part, 0, 0, 0]), 'deck');
  assert.equal(raftPlacementReason(profile(), [], ['crate', 0, 0, 0]), 'deck');
});

test('corrupt progression fails closed and the storage gate explains how to unlock it bilingually', () => {
  assert.equal(knowsRaftStorage({ progression: { v: 1, practice: { logging: 60 }, milestones: [], knowledge: ['unknown'] } }), false);
  assert.match(storageEditorReason('knowledge', 'es'), /artesana del banco/);
  assert.match(storageEditorReason('knowledge', 'en'), /workbench artisan/);
  assert.match(storageEditorReason('goods', 'es'), /materiales/);
  assert.match(storageEditorReason('goods', 'en'), /enough materials/);
});

test('storage palette label follows the document locale after a live locale change', () => {
  const original = globalThis.document, classes = new Map();
  const span = { textContent: '' };
  const button = { title: '', dataset: {}, setAttribute(name, value) { this[name] = value; },
    querySelector() { return span; }, classList: { toggle(name, value) { classes.set(name, value); } } };
  const editor = Object.create(RaftEditor.prototype);
  editor.$ = () => button; editor.profile = () => profile();
  globalThis.document = { documentElement: { lang: 'es' } };
  try {
    editor.syncStoragePalette(); assert.equal(span.textContent, 'Bodega');
    globalThis.document.documentElement.lang = 'en'; editor.syncStoragePalette();
    assert.equal(span.textContent, 'Storage');
    assert.match(button.title, /workbench artisan/);
  } finally { globalThis.document = original; }
});

function pendingEditor(profile, rev = 4) {
  const editor = Object.create(RaftEditor.prototype);
  editor.active = false; editor.launcher = { hidden: false }; editor.profile = () => profile;
  editor.$ = () => null;
  editor.context = () => ({ record: { id: 'raft-a', rev }, ship: { rev }, profile });
  editor.pending = { id: 'op-a', expectedRev: 4, op: 'place', sentAt: 0,
    message: { id: 'raft-a', opId: 'op-a', piece: [ARTISAN.part, 2, 2, 0] } };
  editor.lastResult = ''; editor.quote = null; editor.quotePending = null;
  return editor;
}

test('closed editor accepts a durable receipt but waits for current snapshot and profile confirmation', () => {
  const p = profile(), editor = pendingEditor(p, 5);
  editor.onResult({ type: 'raftEdit', op: 'place', id: 'raft-a', opId: 'op-a', ok: true, durable: true, rev: 5 });
  assert.equal(editor.pending.ack, true);
  assert.equal(editor.pending.durable, true);
  editor.update();
  assert.ok(editor.pending, 'raft revision alone cannot confirm a recipe unlock');
  p.progression.knowledge = [ARTISAN.lesson];
  editor.update();
  assert.equal(editor.pending, null);
  assert.match(editor.lastResult, /perfil/i);
});

test('historical storage receipts never project an old revision or unlock without current authority', () => {
  const p = profile(), editor = pendingEditor(p, 5);
  editor.onResult({ type: 'raftEdit', op: 'place', id: 'raft-a', opId: 'op-a', ok: true, durable: true, rev: 1, historical: true });
  assert.equal(editor.pending.resultRev, 5);
  editor.update();
  assert.ok(editor.pending, 'historical receipt does not unlock without current profile knowledge');
  p.progression.knowledge = [ARTISAN.lesson];
  editor.update();
  assert.equal(editor.pending, null);
});
