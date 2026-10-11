import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionCreationUI } from '../src/ui/companionCreation.js';
import { DEFAULT_COMPANION_PRESET, companionCreationConfig } from '../src/net/companionCreation.js';

const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SAVED_AT = '2026-10-11T12:00:00.000Z';
const savedRecord = () => ({ characterKey: CHARACTER, creationId: CREATION, preset: structuredClone(DEFAULT_COMPANION_PRESET), createdAt: SAVED_AT,
  configuration: { revision: 1, config: companionCreationConfig(DEFAULT_COMPANION_PRESET), savedAt: SAVED_AT },
  control: { revision: 1, stopped: true, savedAt: SAVED_AT } });

class MockElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const item of nodes) { this.children.push(item); item.parentNode = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  querySelectorAll(selector) {
    const all = []; const matches = node => selector === '[data-focus-key]' ? !!node.dataset?.focusKey
      : selector === 'input[data-field="trait"]' ? node.tagName === 'input' && node.dataset?.field === 'trait'
        : selector === '[data-field]' ? !!node.dataset?.field : false;
    const walk = node => { for (const child of node.children) { if (matches(child)) all.push(child); walk(child); } };
    walk(this); return all;
  }
  focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; }
}

class FakeClient {
  constructor() { this.state = { status: 'offline', record: null, available: false, durable: false, message: '' }; this.listeners = new Set(); this.loads = 0; this.creates = []; this.retries = 0; }
  snapshot() { return structuredClone(this.state); }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  publish(value) { this.state = { ...this.state, ...structuredClone(value) }; for (const fn of this.listeners) fn(this.snapshot()); }
  load() { this.loads++; this.publish({ status: 'loading', message: '' }); return true; }
  create(preset) { this.creates.push(structuredClone(preset)); this.publish({ status: 'creating', message: '' }); return true; }
  retry() { this.retries++; return true; }
}

function setup({ lang = 'es', onClose = () => {} } = {}) {
  const previous = globalThis.document;
  globalThis.document = { head: new MockElement('head'), activeElement: null, getElementById: () => null,
    createElement: tag => new MockElement(tag) };
  const parent = new MockElement('section'), client = new FakeClient();
  const ui = new CompanionCreationUI(parent, { client, lang, onClose });
  return { ui, parent, client, restore: () => { globalThis.document = previous; } };
}
const find = (root, className) => root.className === className ? root : root.children.map(child => find(child, className)).find(Boolean) || null;
const input = (element, value) => { element.value = value; element.listeners.input?.forEach(fn => fn({ target: element })); };

test('wizard loads durable availability, previews documents, and requires explicit confirmation', () => {
  const { ui, client, restore } = setup();
  try {
    assert.equal(ui.open(), true); assert.equal(client.loads, 1);
    client.publish({ status: 'ready', available: true, durable: true, record: null });
    input(ui.nameInput.input, 'Brisa Faro');
    ui.reviewButton.listeners.click[0]();
    assert.equal(ui.reviewing, true); assert.match(ui.reviewPersonality.textContent, /Brisa Faro/);
    assert.ok(ui.reviewGoals.children.length > 0);
    assert.equal(ui.createButton.disabled, true);
    ui.confirmInput.checked = true; ui.confirmInput.listeners.change[0]();
    assert.equal(ui.createButton.disabled, false);
    ui.createButton.listeners.click[0]();
    assert.equal(client.creates.length, 1); assert.equal(client.creates[0].name, 'Brisa Faro');
  } finally { restore(); }
});

test('saved owner row is read-only and shows identity, stopped status, and stored documents', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); client.publish({ status: 'ready', available: true, durable: true, record: savedRecord() });
    assert.equal(ui.form.hidden, true); assert.equal(ui.reviewPanel.hidden, true); assert.equal(ui.saved.hidden, false);
    assert.match(ui.identity.textContent, new RegExp(CHARACTER)); assert.match(ui.savedStatus.textContent, /Detenido/);
    assert.match(ui.savedPersonality.textContent, /Brisa/); assert.equal(ui.savedGoals.children.length, 1);
    assert.match(ui.nextStep.textContent, /emparejar.*entrar al mundo/i);
    assert.doesNotMatch(ui.saved.textContent, /127\.0\.0\.1|qwen|gasto|spend/i);
  } finally { restore(); }
});

test('unavailable backend leaves reload and back usable and never enables creation', () => {
  let closed = 0; const { ui, client, restore } = setup({ onClose: () => closed++ });
  try {
    ui.open(); client.publish({ status: 'ready', available: false, durable: false, record: null });
    assert.match(ui.status.textContent, /no está disponible/); assert.equal(ui.createButton.disabled, true);
    assert.equal(ui.reloadButton.hidden, false); ui.reloadButton.listeners.click[0](); assert.equal(client.loads, 2);
    ui.backButton.listeners.click[0](); assert.equal(ui.isOpen, false); assert.equal(closed, 1);
  } finally { restore(); }
});

test('randomize, language switch, and mobile layout preserve a single scroll area', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); client.publish({ status: 'ready', available: true, durable: true, record: null });
    const before = structuredClone(ui.draft); assert.equal(ui.randomize(), true);
    assert.ok(ui.draft.role); assert.ok(ui.draft.personality); assert.ok(ui.draft.traits.length <= 3); assert.notDeepEqual(ui.draft, before);
    ui.setLanguage('en'); assert.equal(ui.title.textContent, 'Create companion'); assert.equal(ui.nameInput.title.textContent, 'Name');
    assert.ok(ui.looks.textContent.includes('Corsair'));
    const css = globalThis.document.head.children[0].textContent;
    assert.match(css, /min-height:44px/); assert.match(css, /@media\(max-width:600px\)/);
    assert.doesNotMatch(css, /max-height:min\(70cqh|overflow:auto/);
    client.publish({ status: 'signed_out', record: null, available: false, durable: false });
    assert.equal(ui.isOpen, false); assert.equal(ui.draft, null); assert.equal(ui.nameInput.input.value, '');
  } finally { restore(); }
});

test('trait changes preserve keyboard focus and sign-out clears every saved private field without changing offline state', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); client.publish({ status: 'ready', available: true, durable: true, record: null });
    const trait = ui.traits.querySelectorAll('input[data-field="trait"]')[2]; trait.checked = true; trait.focus();
    ui.onChoiceChange({ target: trait });
    assert.equal(globalThis.document.activeElement.dataset.focusKey, 'trait:kind');
    assert.ok(ui.draft.traits.includes('kind'));
    client.publish({ status: 'ready', available: true, durable: true, record: savedRecord() });
    assert.match(ui.identity.textContent, new RegExp(CHARACTER));
    client.publish({ status: 'signed_out', record: null, available: false, durable: false });
    assert.equal(ui.state.status, 'signed_out'); assert.equal(ui.isOpen, false); assert.equal(ui.draft, null);
    assert.equal(ui.roleSelect.select.children.length, 0); assert.equal(ui.personalitySelect.select.children.length, 0);
    assert.equal(ui.confirmInput.checked, false);
    for (const field of [ui.identity, ui.savedStatus, ui.savedName, ui.nextStep, ui.savedHeading,
      ui.savedPersonalityTitle, ui.savedPersonality, ui.savedGoalsTitle]) assert.equal(field.textContent, '');
    assert.equal(ui.savedGoals.children.length, 0);
    client.publish({ status: 'offline', record: null, available: false, durable: false });
    assert.equal(ui.state.status, 'offline', 'reset preserves the transport state provided by the client');
  } finally { restore(); }
});

