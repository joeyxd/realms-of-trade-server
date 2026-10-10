import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../src/core/i18n.js';
import { ARTISAN } from '../src/data/artisan.js';
import { RaftEditor, raftPlacementReason, storageEditorReason } from '../src/ui/raftEditor.js';

function node() {
  return { textContent: '', innerHTML: '', hidden: false, disabled: false, value: '', options: [], attrs: {}, dataset: {},
    classList: { toggle() {} }, setAttribute(name, value) { this.attrs[name] = String(value); }, addEventListener() {}, querySelector() { return node(); } };
}

function presentationEditor() {
  const selectors = [
    '.re-head > b', '.re-close', '[data-mode="place"]', '[data-mode="repair"]', '[data-mode="reinforce"]', '[data-mode="remove"]',
    '.re-pieces', '.re-repair-list', '.re-level-label', '.re-level', '.re-rotate', '.re-retry', '.re-cycle', '.re-route',
    '.re-details', '.re-shelter-help', '.re-capacity', '.re-supplies', '.re-status', '.re-action', '.re-remove-choice span',
  ];
  const nodes = new Map(selectors.map((selector) => [selector, node()]));
  nodes.get('.re-level').options = [node(), node(), node()];
  const editor = Object.create(RaftEditor.prototype);
  editor.$ = (selector) => nodes.get(selector) || node();
  editor.root = { classList: { toggle() {} }, querySelectorAll: () => [] };
  editor.ghost = { visible: false };
  editor.launcher = node(); editor.active = false; editor.mode = 'place'; editor.selected = 'foundation'; editor.level = 0; editor.dir = 0;
  editor.target = null; editor.pending = null; editor.lastResult = ''; editor.lastResultKey = ''; editor.lastResultParams = {};
  editor.context = () => null; editor.syncStoragePalette = () => {}; editor.gridParts = () => [];
  editor.placementForecast = () => null; editor.removalTarget = () => null; editor.reinforcementTarget = () => null;
  editor.repairTarget = () => null; editor.damagedEntries = () => []; editor.conditionFor = () => false;
  editor.repairAffordable = () => false; editor.profile = () => null; editor.signature = () => 'fixture';
  return { editor, nodes };
}

test('raft editor localizes common, repair and storage presentation while retaining pending intent', (t) => {
  const oldDocument = globalThis.document, previous = oldDocument?.documentElement?.lang || 'es';
  t.after(() => { setLocale(previous); globalThis.document = oldDocument; });
  globalThis.document = { documentElement: { lang: 'en' } };
  setLocale('en');
  const { editor, nodes } = presentationEditor();
  editor.refreshLocale(); editor.renderPalette(); editor.render();
  assert.equal(nodes.get('.re-head > b').textContent, 'DECK SHIPYARD');
  assert.equal(nodes.get('[data-mode="place"]').textContent, 'Build');
  assert.match(nodes.get('.re-pieces').innerHTML, /Foundation/);
  assert.match(nodes.get('.re-details').innerHTML, /Cost:/);
  const commonCommand = Object.freeze({ type: 'raft', op: 'place', id: 'raft-a', opId: 'place-1', piece: ['foundation', 2, 2, 0, 0] });
  const pending = { id: 'place-1', message: commonCommand, sentAt: performance.now(), op: 'place' };
  editor.pending = pending; editor.mode = 'repair'; editor.render();
  assert.match(nodes.get('.re-details').innerHTML, /Choose a damaged part/);
  assert.match(nodes.get('.re-status').textContent, /Repair/);
  editor.selected = ARTISAN.part; editor.pending = { ...pending, message: Object.freeze({ ...commonCommand, piece: [ARTISAN.part, 2, 2, 0, 0] }) };
  const storagePending = editor.pending, storageCommand = storagePending.message;
  editor.mode = 'place'; editor.knowsStorage = () => false; editor.render();
  assert.match(nodes.get('.re-details').innerHTML, /Hold/);
  assert.match(nodes.get('.re-shelter-help').textContent, /workbench artisan/);
  assert.equal(editor.pending, storagePending);
  assert.equal(editor.pending.message, storageCommand);
  assert.equal(editor.pending.message.opId, 'place-1');
  assert.equal(raftPlacementReason({ progression: { knowledge: [] } }, [], [ARTISAN.part, 2, 2, 0, 0]), 'knowledge');
  assert.match(storageEditorReason('knowledge', 'en'), /workbench artisan/);
});

test('raft editor translates a matched common denial and ignores a reply with another operation ID', (t) => {
  const previous = globalThis.document?.documentElement?.lang || 'es';
  t.after(() => setLocale(previous));
  globalThis.document = { documentElement: { lang: 'en' } };
  setLocale('en');
  const { editor } = presentationEditor();
  const message = Object.freeze({ type: 'raft', op: 'repair', id: 'raft-a', opId: 'repair-1' });
  editor.pending = { id: 'repair-1', expectedRev: 3, op: 'repair', message, sentAt: performance.now() };
  editor.onResult({ type: 'raftDenied', id: 'raft-a', opId: 'other-op', op: 'repair', why: 'busy' });
  assert.equal(editor.pending.message, message);
  editor.onResult({ type: 'raftDenied', id: 'raft-a', opId: 'repair-1', op: 'repair', why: 'busy' });
  assert.equal(editor.pending, null);
  assert.equal(editor.lastResult, 'Stop before editing.');
});
