import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionPairingUI } from '../src/ui/companionPairing.js';

class MockElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const item of nodes) { this.children.push(item); item.parentNode = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  focus() { this.focused = true; }
}
class FakeClient {
  constructor() { this.state = { status: 'offline', enabled: false, code: null, expiresAtMs: null, message: '' }; this.listeners = new Set(); this.loads = 0; this.issues = 0; this.revokes = 0; this.controllerUrl = 'wss://realm.example/ws'; }
  snapshot() { return structuredClone(this.state); }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  publish(value) { this.state = { ...this.state, ...structuredClone(value) }; for (const fn of this.listeners) fn(this.snapshot()); }
  load() { this.loads++; this.publish({ status: 'loading', code: null, expiresAtMs: null }); return true; }
  issue() { this.issues++; this.publish({ status: 'loading' }); return true; }
  revoke() { this.revokes++; this.publish({ status: 'loading', code: null, expiresAtMs: null }); return true; }
}
function setup({ lang = 'es', onClose = () => {} } = {}) {
  const previous = globalThis.document;
  globalThis.document = { head: new MockElement('head'), getElementById: () => null, createElement: tag => new MockElement(tag) };
  const parent = new MockElement('section'), client = new FakeClient();
  const ui = new CompanionPairingUI(parent, { client, lang, onClose });
  return { ui, parent, client, restore: () => { globalThis.document = previous; } };
}

test('opens by loading pairing state and explains allow-first, one-use privacy, and the local CLI guide', () => {
  const { ui, client, restore } = setup();
  try {
    assert.equal(ui.open(), true); assert.equal(client.loads, 1);
    client.publish({ status: 'ready', enabled: false });
    assert.match(ui.allowNote.textContent, /Permitir conexión/); assert.match(ui.disabledNote.textContent, /apagada/);
    assert.equal(ui.generateButton.disabled, true);
    assert.match(ui.guide.textContent, /prompt privado/);
    assert.match(ui.command.textContent, /node tools\/agent\/pair-companion\.mjs --url wss:\/\/realm\.example\/ws/);
    assert.match(ui.command.textContent, /--max-calls 8 --max-tokens 262144/);
    assert.doesNotMatch(ui.command.textContent, /--code(?:=|\s)|credential|secret/i);
    const tags = []; const walk = item => { tags.push(item.tagName); item.children.forEach(walk); }; walk(ui.container);
    assert.equal(tags.includes('input'), false); assert.equal(tags.includes('textarea'), false);
  } finally { restore(); }
});

test('only explicit user actions issue or revoke and code has copy plus visible expiry controls', async () => {
  const { ui, client, restore } = setup();
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    ui.open(); client.publish({ status: 'ready', enabled: true });
    assert.equal(client.issues, 0); assert.equal(ui.generateButton.disabled, false);
    ui.generateButton.listeners.click[0](); assert.equal(client.issues, 1);
    const code = 'b'.repeat(64); const expiresAtMs = Date.now() + 60_000;
    client.publish({ status: 'ready', enabled: true, code, expiresAtMs });
    assert.equal(ui.codePanel.hidden, false); assert.equal(ui.codeText.textContent, code);
    assert.match(ui.expiry.textContent, /Caduca/); assert.equal(ui.revokeButton.hidden, false);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { assert.equal(value, code); } } } });
    ui.copyButton.listeners.click[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.status.textContent, 'Código copiado.');
    ui.revokeButton.listeners.click[0](); assert.equal(client.revokes, 1);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
    restore();
  }
});

test('revoke stays available for an enabled connection without a local code and reload recovers uncertain state', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); client.publish({ status: 'ready', enabled: true, code: null, expiresAtMs: null });
    assert.equal(ui.revokeButton.hidden, false); assert.match(ui.revokeNote.textContent, /todos los códigos.*sesiones/i);
    ui.revokeButton.listeners.click[0](); assert.equal(client.revokes, 1);
    client.publish({ status: 'uncertain', enabled: true, code: null, expiresAtMs: null, message: 'uncertain' });
    assert.equal(ui.reloadButton.hidden, false); ui.reloadButton.listeners.click[0](); assert.equal(client.loads, 2);
  } finally { restore(); }
});

test('language switching, disconnect reset, and back preserve parent-owned close flow', () => {
  let closed = 0; const { ui, client, restore } = setup({ onClose: () => closed++ });
  try {
    ui.open(); client.publish({ status: 'ready', enabled: true, code: 'c'.repeat(64), expiresAtMs: Date.now() + 60_000 });
    ui.setLanguage('en'); assert.equal(ui.title.textContent, 'Connect on my PC'); assert.match(ui.allowNote.textContent, /First/);
    client.publish({ status: 'offline', enabled: false, code: null, expiresAtMs: null });
    assert.equal(ui.isOpen, false); assert.equal(ui.codeText.textContent, ''); assert.equal(ui.codePanel.hidden, true);
    ui.open(); ui.backButton.listeners.click[0](); assert.equal(ui.isOpen, false); assert.equal(closed, 1);
    const css = globalThis.document.head.children[0].textContent;
    assert.match(css, /min-height:44px/); assert.match(css, /@media\(max-width:600px\)/);
    assert.doesNotMatch(css, /max-height|min-height:84px/);
  } finally { restore(); }
});
