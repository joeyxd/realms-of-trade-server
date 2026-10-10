import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionConfigUI } from '../src/ui/companionConfig.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config = (personality = 'Brisa, serena.') => ({ v: 1, personality, goals: [
  { id: 'stay-safe', status: 'active', text: 'Proteger a la tripulación.', constraints: ['No atacar humanos.'] },
] });
const head = (revision, value = config()) => revision === 0
  ? { revision: 0, config: null, savedAt: null }
  : { revision, config: value, savedAt: '2026-10-10T12:00:00.000Z' };

class MockElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map((child) => child.textContent).join(''); }
  append(...nodes) { for (const item of nodes) { this.children.push(item); item.parentNode = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  querySelectorAll(selector) {
    if (selector !== '[data-focus-key]') return [];
    const all = [];
    const walk = (node) => { for (const child of node.children) { if (child.dataset?.focusKey) all.push(child); walk(child); } };
    walk(this); return all;
  }
  focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; }
}

class FakeClient {
  constructor() { this.state = { status: 'offline', characterKey: null, head: null, durable: false, message: '' }; this.listeners = new Set(); this.loads = []; this.saves = []; this.loadAllowed = true; }
  snapshot() { return structuredClone(this.state); }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  publish(state) { this.state = { ...this.state, ...structuredClone(state) }; for (const fn of this.listeners) fn(this.snapshot()); }
  load(characterKey) { if (!this.loadAllowed) return false; this.loads.push(characterKey); this.publish({ status: 'loading', characterKey, message: '' }); return true; }
  save(value) { this.saves.push(structuredClone(value)); this.publish({ status: 'saving', message: '' }); return true; }
}

function setup({ lang = 'es', onClose = () => {} } = {}) {
  const previous = globalThis.document;
  globalThis.document = { head: new MockElement('head'), activeElement: null,
    getElementById: () => null, createElement: (tag) => new MockElement(tag) };
  const parent = new MockElement('section'); const client = new FakeClient();
  const ui = new CompanionConfigUI(parent, { client, lang, onClose });
  return { ui, parent, client, restore: () => { globalThis.document = previous; } };
}
const find = (root, className) => {
  if (root.className === className) return root;
  for (const child of root.children) { const found = find(child, className); if (found) return found; }
  return null;
};
const input = (element, value) => { element.value = value; element.listeners.input?.forEach((fn) => fn({ target: element })); };

test('edit/save conflict preserves the draft until explicit reload replaces it', () => {
  const { ui, client, restore } = setup();
  try {
    assert.equal(ui.open(CHARACTER, 'Brisa'), true);
    assert.deepEqual(client.loads, [CHARACTER]);
    client.publish({ status: 'ready', characterKey: CHARACTER, head: head(1), durable: true, message: '' });
    input(ui.personality, 'Borrador privado');
    const beforeGoals = ui.draft.goals.length;
    ui.addButton.listeners.click[0]();
    assert.equal(ui.draft.goals.length, beforeGoals + 1);
    const newGoal = ui.draft.goals.at(-1);
    const goalText = ui.container.querySelectorAll('[data-focus-key]').find((el) => el.dataset.focusKey === `goal-text:${newGoal.id}`);
    input(goalText, 'Revisar la ruta antes de zarpar.');
    const constraints = ui.container.querySelectorAll('[data-focus-key]').find((el) => el.dataset.focusKey === `goal-constraints:${newGoal.id}`);
    input(constraints, 'No cruzar la tormenta.\n  Esperar confirmación.');
    assert.deepEqual(newGoal.constraints, ['No cruzar la tormenta.', 'Esperar confirmación.']);
    assert.equal(ui.save(), true);
    assert.equal(client.saves.length, 1);
    assert.equal(client.saves[0].personality, 'Borrador privado');
    client.publish({ status: 'conflict', characterKey: CHARACTER, head: head(2, config('Versión remota')), durable: true, message: 'conflict' });
    assert.equal(ui.status.textContent, 'Otra sesión guardó cambios. Tu borrador se conserva; puedes cargar la versión del servidor.');
    assert.equal(ui.personality.value, 'Borrador privado');
    assert.equal(ui.saveButton.disabled, true);
    ui.reloadButton.listeners.click[0]();
    assert.equal(client.loads.length, 2);
    assert.equal(ui.personality.value, 'Borrador privado', 'draft remains visible while the reload is pending');
    client.publish({ status: 'ready', characterKey: CHARACTER, head: head(2, config('Versión remota')), durable: true, message: '' });
    assert.equal(ui.personality.value, 'Versión remota');
    assert.equal(ui.draft.goals.length, 1);
  } finally { restore(); }
});

test('uncertain save keeps the draft, and logout clears private editor data', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(CHARACTER, 'Brisa');
    client.publish({ status: 'ready', characterKey: CHARACTER, head: head(1), durable: true, message: '' });
    input(ui.personality, 'Keep this draft');
    client.publish({ status: 'uncertain', characterKey: CHARACTER, head: head(1), durable: true, message: 'uncertain' });
    assert.equal(ui.personality.value, 'Keep this draft');
    assert.match(ui.status.textContent, /before saving again|antes de guardar otra vez/);
    client.publish({ status: 'signed_out', characterKey: null, head: null, durable: false, message: '' });
    assert.equal(ui.isOpen, false);
    assert.equal(ui.draft, null);
    assert.equal(ui.personality.value, '');
  } finally { restore(); }
});

test('form mutations are locked while a save is in flight', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(CHARACTER, 'Brisa');
    client.publish({ status: 'ready', characterKey: CHARACTER, head: head(1), durable: true, message: '' });
    input(ui.personality, 'Accepted draft');
    const goal = ui.draft.goals[0];
    assert.equal(ui.save(), true);
    assert.equal(ui.personality.disabled, true);
    assert.equal(ui.addButton.disabled, true);
    const goalControls = ui.container.querySelectorAll('[data-focus-key]');
    assert.ok(goalControls.filter((item) => item.dataset.focusKey.startsWith('goal-')).every((item) => item.disabled));
    assert.equal(ui.addGoal(), false);
    ui.removeGoal(goal.id);
    assert.equal(ui.draft.goals.length, 1);
    const staleInput = goalControls.find((item) => item.dataset.focusKey === `goal-text:${goal.id}`);
    input(staleInput, 'late edit after save began');
    assert.notEqual(goal.text, 'late edit after save began');
    client.publish({ status: 'ready', characterKey: CHARACTER, head: head(2, config('Accepted draft')), durable: true, message: '' });
    assert.equal(ui.status.textContent, 'Configuración guardada.');
    assert.equal(ui.draft.personality, 'Accepted draft');
  } finally { restore(); }
});

test('open reports a busy save and later reload recovers without showing another character config', () => {
  const { ui, client, restore } = setup();
  try {
    client.publish({ status: 'saving', characterKey: CHARACTER, head: head(1), durable: true, message: '' });
    client.loadAllowed = false;
    ui.open('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Nube');
    assert.equal(ui.isOpen, true);
    assert.equal(ui.draft, null);
    assert.equal(ui.head, null);
    assert.equal(ui.status.textContent, 'Hay otro guardado en curso. Espera y vuelve a cargar la ficha.');
    assert.equal(ui.reloadButton.disabled, false);
    client.loadAllowed = true;
    ui.reloadButton.listeners.click[0]();
    assert.equal(client.loads.length, 1);
    client.publish({ status: 'ready', characterKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      head: head(2, config('Nube')), durable: true, message: '' });
    assert.equal(ui.personality.value, 'Nube');
  } finally { restore(); }
});

test('localized labels preserve keyboard focus and mobile controls stay comfortably sized', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(CHARACTER, 'Brisa');
    client.publish({ status: 'ready', characterKey: CHARACTER, head: head(1), durable: true, message: '' });
    ui.personality.focus();
    ui.setLanguage('en');
    assert.equal(ui.title.textContent, 'Configure Brisa');
    assert.equal(ui.personalityLabelText.textContent, 'Personality');
    assert.equal(globalThis.document.activeElement.dataset.focusKey, 'personality');
    const css = globalThis.document.head.children[0].textContent;
    assert.match(css, /min-height:44px/);
    assert.match(css, /@media\(max-width:600px\)/);
    assert.match(css, /70cqh/);
    client.publish({ status: 'ready', characterKey: CHARACTER, head: head(0), durable: false, message: '' });
    assert.match(ui.durableNote.textContent, /has not confirmed durable storage/);
    assert.match(ui.usageNote.textContent, /does not activate inference/);
    assert.equal(ui.saveButton.disabled, true);
  } finally { restore(); }
});

test('back returns to the caller without nested dialog semantics', () => {
  const closed = []; const { ui, restore } = setup({ onClose: () => closed.push(true) });
  try {
    ui.open(CHARACTER, 'Brisa');
    assert.equal(ui.container.attributes.role, undefined);
    ui.backButton.listeners.click[0]();
    assert.equal(ui.isOpen, false);
    assert.deepEqual(closed, [true]);
  } finally { restore(); }
});
