import assert from 'node:assert/strict';
import test from 'node:test';
import { TemplatePanel } from '../src/editor/templatePanel.js';
import { createTemplateLibrary } from '../src/editor/templates.js';

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.value = ''; this.hidden = false; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map((item) => item.textContent).join(''); }
  set className(value) { this._className = value; }
  get className() { return this._className || ''; }
  append(...items) { for (const item of items) { item.parentNode = this; this.children.push(item); } }
  appendChild(item) { this.append(item); return item; }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  querySelector(selector) {
    const attr = selector.match(/\[data-template-action="([^"]+)"\]/)?.[1];
    const visit = (node) => { for (const child of node.children) { if (attr && child.dataset.templateAction === attr) return child; const found = visit(child); if (found) return found; } return null; };
    return visit(this);
  }
  click() { this.clicked = true; }
  remove() { this.removed = true; }
}

function setup() {
  const previousDocument = globalThis.document, previousCrypto = globalThis.crypto;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const editor = { worldId: 'gm-1', map: { seed: 1 }, baseRevision: 'base-1', active: true,
    lang: 'en', _t: (en) => en, _selectedItems: () => [], history: { current: () => ({}) } };
  const root = new Element('root'), panel = new TemplatePanel(editor, root);
  return { editor, panel, root, restore: () => { globalThis.document = previousDocument; try { globalThis.crypto = previousCrypto; } catch { /* readonly in some Node versions */ } } };
}

test('late load cannot replace the current session library', async () => {
  const { panel, restore } = setup();
  try {
    let finish;
    panel.store = { load: () => new Promise((resolve) => { finish = resolve; }) };
    const loading = panel.start();
    panel.stop();
    finish({ revision: 4, library: createTemplateLibrary() });
    assert.equal(await loading, false);
    assert.equal(panel.revision, 0);
    assert.equal(panel.state, 'loading');
  } finally { restore(); }
});

test('failed compare-and-swap retains full candidate for export and explicit retry', async () => {
  const { panel, restore } = setup();
  try {
    const candidate = createTemplateLibrary();
    let attempts = 0;
    panel.store = { save: async (library, { expectedRevision }) => {
      attempts++;
      assert.equal(expectedRevision, 3);
      if (attempts === 1) throw Object.assign(new Error('temporary'), { code: 'template_indexeddb_write' });
      return { revision: 4, library };
    } };
    panel.state = 'ready'; panel.revision = 3; panel.started = true;
    assert.equal(await panel._persist(candidate, 'saved'), false);
    assert.equal(panel.pendingLibrary, candidate);
    assert.equal(JSON.parse(panel.export()).templates.length, 0);
    assert.equal(await panel.retrySave(), true);
    assert.equal(panel.pendingLibrary, null);
    assert.equal(panel.revision, 4);
    assert.equal(attempts, 2);
  } finally { restore(); }
});

test('stop and reopen keep the panel mounted and preserve a pending candidate', async () => {
  const { panel, root, editor, restore } = setup();
  try {
    const candidate = createTemplateLibrary();
    panel.started = true; panel.state = 'ready'; panel.pendingLibrary = candidate; panel.pendingRevision = 5;
    panel.stop();
    assert.equal(panel.element.removed, undefined);
    assert.equal(panel.pendingLibrary, candidate);
    panel.store = { load: async () => { throw new Error('must not discard the pending candidate'); } };
    await panel.start();
    assert.equal(panel.started, true);
    assert.equal(panel.pendingLibrary, candidate);
    assert.equal(panel.root, root);
    assert.equal(root.children.includes(panel.element), true);
  } finally { restore(); }
});

test('save, rename, delete, import, and retry are guarded while inactive, walking, or dragging', async () => {
  for (const state of [{ active: false }, { walkPreview: { active: true } }, { dragging: true }]) {
    const { panel, editor, restore } = setup();
    try {
      Object.assign(editor, state);
      panel.started = true; panel.state = 'ready'; panel.selectedTemplate = { id: 'selected' };
      panel.pendingLibrary = createTemplateLibrary(); panel.pendingRevision = 7;
      let saved = 0, read = 0;
      panel.store = { save: async () => { saved++; } };
      panel.file.files = [{ size: 1, text: async () => { read++; return '{}'; } }];
      assert.equal(await panel.saveSelection(), false);
      assert.equal(await panel.rename(), false);
      assert.equal(await panel.deleteSelected(), false);
      await panel._importFile();
      assert.equal(await panel.retrySave(), false);
      assert.equal(saved, 0);
      assert.equal(read, 0);
      assert.ok(panel.pendingLibrary);
    } finally { restore(); }
  }
});

test('failed initial load leaves controls readonly and a retry can recover', async () => {
  const { panel, restore } = setup();
  try {
    let calls = 0;
    panel.store = { load: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('corrupt'), { code: 'template_stored_library' });
      return { revision: 2, library: createTemplateLibrary() };
    } };
    assert.equal(await panel.start(), false);
    assert.equal(panel.state, 'corrupt');
    assert.equal(panel.actions.querySelector('[data-template-action="save"]').disabled, true);
    assert.equal(await panel.retryLoad(), true);
    assert.equal(panel.state, 'ready');
    assert.equal(panel.revision, 2);
    assert.equal(calls, 2);
  } finally { restore(); }
});
