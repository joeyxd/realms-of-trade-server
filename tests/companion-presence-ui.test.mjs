import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionPresenceUI } from '../src/ui/companionPresence.js';

class MockElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const child of nodes) { this.children.push(child); child.parentNode = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  remove() { this.removed = true; }
}
class FakeClient {
  constructor() { this.state = { status: 'offline', enabled: false, presence: null, message: '' }; this.listeners = new Set(); this.loads = []; this.commands = []; }
  snapshot() { return structuredClone(this.state); }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  set(state) { this.state = { ...this.state, ...structuredClone(state) }; for (const fn of this.listeners) fn(this.snapshot()); }
  load(options) { this.loads.push(options); return true; }
  command(op) { this.commands.push(op); return true; }
}
function setup(lang = 'es', onCommand) {
  const old = globalThis.document;
  globalThis.document = { head: new MockElement('head'), getElementById: () => null, createElement: tag => new MockElement(tag) };
  const parent = new MockElement('section'); const client = new FakeClient();
  const ui = new CompanionPresenceUI(parent, { client, lang, onCommand });
  return { ui, parent, client, restore: () => { globalThis.document = old; } };
}

test('initial panel explains the anchor and safe-zone limits without issuing an automatic command', () => {
  const { ui, client, restore } = setup();
  try {
    assert.equal(ui.title.textContent, 'Presencia en Salty Shore');
    assert.equal(ui.anchorNote.textContent, 'Primero vuelve al punto de llegada de Salty Shore.');
    assert.match(ui.safeNote.textContent, /no habilita combate ni recolección/);
    assert.equal(ui.buttons.join.hidden, true, 'actions stay hidden until host enablement is received');
    assert.deepEqual(client.commands, []);
    assert.equal(client.loads.length, 0);
  } finally { ui.destroy(); restore(); }
});

test('enabled presence actions forward only operation names and disable during mutation', () => {
  const calls = []; const { ui, client, restore } = setup('es', op => calls.push(op));
  try {
    const presence = { characterKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Brisa', status: 'present', order: 'wait', revision: 4, entity: 7, reason: null };
    client.set({ status: 'ready', enabled: true, presence });
    assert.equal(ui.buttons.join.hidden, false);
    assert.equal(ui.buttons.join.disabled, true, 'a present body cannot be invoked again');
    ui.buttons.follow.listeners.click[0]();
    assert.deepEqual(calls, ['follow']);
    assert.equal(client.commands.length, 0, 'provided callback receives the op instead of entity data');
    client.set({ status: 'mutating' }); assert.equal(ui.buttons.wait.disabled, true);
    ui.refreshButton.listeners.click[0](); assert.deepEqual(client.loads, [{ refresh: true }]);
  } finally { ui.destroy(); restore(); }
});

test('disabled host keeps the received state visible and recovery prevents every action in both languages', () => {
  const { ui, client, restore } = setup();
  try {
    const presence = { characterKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Brisa', status: 'recovery', order: 'return', revision: 5, entity: null, reason: 'restart' };
    client.set({ status: 'ready', enabled: false, presence });
    assert.match(ui.hostNote.textContent, /apagado/);
    assert.match(ui.stateText.textContent, /Brisa/);
    assert.match(ui.stateText.textContent, /no se invocará de nuevo/);
    assert.equal(ui.actions.hidden, true);
    ui.setLanguage('en');
    assert.equal(ui.title.textContent, 'Presence at Salty Shore');
    assert.match(ui.hostNote.textContent, /is off/);
    assert.match(ui.stateText.textContent, /will not be summoned again/);
    client.set({ status: 'ready', enabled: true, presence });
    assert.equal(ui.buttons.join.disabled, true);
    assert.equal(ui.buttons.retire.disabled, true);
  } finally { ui.destroy(); restore(); }
});
