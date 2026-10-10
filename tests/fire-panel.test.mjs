import test from 'node:test';
import assert from 'node:assert/strict';
import { newFirePanel } from '../src/ui/firePanel.js';

class Element {
  constructor() { this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.children = new Map(); this.isConnected = true; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); }
  appendChild(child) { child.parentNode = this; return child; }
  remove() { this.removed = true; this.isConnected = false; }
  focus() { this.focused = true; }
  querySelector(selector) { return this.children.get(selector) || null; }
  set innerHTML(value) {
    this._html = value;
    for (const match of value.matchAll(/class="([^"]+)"/g)) {
      for (const name of match[1].split(/\s+/)) if (!this.children.has(`.${name}`)) this.children.set(`.${name}`, new Element());
    }
  }
  click() { for (const fn of this.listeners.click || []) fn({ target: this }); }
}

class DocumentStub {
  constructor() { this.listeners = {}; }
  createElement() { return new Element(); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); }
  key(code) { for (const fn of this.listeners.keydown || []) fn({ code, key: code, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }); }
}

function fixture({ locale = 'es', wood = 1, holdWood = 0, enabled = true } = {}) {
  let clock = 0;
  const doc = new DocumentStub(), parent = new Element(); parent.ownerDocument = doc;
  const commands = [], toasts = [], opened = [];
  const client = { joined: true, youServer: 7, fire: { enabled, rev: 4, slots: [] },
    profile: { eco: { pack: { goods: { madera: wood } }, ships: [{ id: 'raft:1', hold: { goods: { madera: holdWood } } }] } },
    send(command) { commands.push(command); } };
  const panel = newFirePanel({ parent, client: () => client, locale: () => locale, toast: message => toasts.push(message),
    onOpen: target => opened.push(target), now: () => clock });
  return { panel, client, doc, parent, commands, toasts, opened, setTime(value) { clock = value; } };
}

test('hand slot has one visual fuel slot and sends an immutable one-wood craft-and-light intent', () => {
  const f = fixture();
  assert.equal(f.panel.open(), true);
  assert.equal(f.opened.length, 1);
  assert.equal(f.panel.load(), true);
  const command = f.commands[0];
  assert.deepEqual(Object.keys(command).sort(), ['expectedRev', 'kind', 'lit', 'op', 'opId', 'part', 'ship', 't', 'type'].sort());
  assert.deepEqual({ ...command, opId: 'id' }, { t: 'cmd', type: 'fire', op: 'load', opId: 'id', ship: '', part: 'hand', kind: 'handTorch', expectedRev: 4, lit: true });
  assert.equal(Object.isFrozen(command), true);
  assert.equal(f.client.profile.eco.pack.goods.madera, 1, 'the UI waits for server confirmation instead of mutating inventory');
  assert.equal(f.panel.loadButton.disabled, true);
  assert.equal(f.panel.acknowledge({ type: 'fire', op: 'load', opId: 'wrong', ok: true }), false);
  assert.equal(f.panel.pending.command, command);
  assert.equal(f.panel.acknowledge({ type: 'fire', op: 'set', opId: command.opId, ok: true }), false);
  assert.equal(f.panel.acknowledge({ type: 'fire', op: 'load', opId: command.opId, ok: true }), true);
  assert.equal(f.panel.pending, null);
  assert.equal(f.panel.$('.fire-status').textContent, 'Combustible cargado y fuego encendido.');
});

test('confirmed fire state controls load and toggle buttons; only one pending command is allowed', () => {
  const f = fixture(); f.panel.open(); f.panel.load();
  const load = f.commands[0];
  f.client.fire = { enabled: true, rev: 5, slots: [{ key: 'hand', kind: 'handTorch', seconds: 1188, lit: true }] };
  f.panel.acknowledge({ type: 'fire', op: 'load', opId: load.opId, ok: true }); f.panel.update();
  assert.equal(f.panel.loadButton.disabled, true);
  assert.equal(f.panel.toggleButton.hidden, false);
  assert.equal(f.panel.toggleButton.textContent, 'Apagar');
  assert.equal(f.panel.$('.fire-seconds').textContent, '19:48');
  assert.equal(f.panel.setLit(false), true);
  assert.equal(f.commands[1].op, 'set'); assert.equal(f.commands[1].lit, false); assert.equal(f.commands[1].expectedRev, 5);
  assert.equal(f.panel.setLit(true), false);
});

test('station uses pack plus raft hold as available stock and emits its stable composite key tuple', () => {
  const f = fixture({ wood: 0, holdWood: 1 });
  assert.equal(f.panel.open({ ship: 'raft:1', part: 'p_9', kind: 'torchFloor', name: '<b>Deck torch</b>' }), true);
  assert.equal(f.panel.$('.fire-title').textContent, '<b>Deck torch</b>', 'names are assigned as text, never parsed as HTML');
  assert.equal(f.panel.$('.fire-stock').textContent, 'Mochila: 0 · Bodega: 1 Madera');
  assert.equal(f.panel.load(), true);
  assert.equal(f.commands[0].ship, 'raft:1'); assert.equal(f.commands[0].part, 'p_9');
  assert.equal(f.commands[0].kind, 'torchFloor'); assert.equal(f.commands[0].lit, true);
  assert.equal(f.panel.$('.fire-load').textContent, 'Cargar y encender · 1 madera');
});

test('retry sends the exact same request once and times out without changing confirmed fuel', () => {
  const f = fixture(); f.panel.open(); f.panel.load();
  const command = f.commands[0];
  f.setTime(999); f.panel.update(); assert.equal(f.commands.length, 1);
  f.setTime(1000); f.panel.update(); assert.equal(f.commands.length, 2); assert.equal(f.commands[1], command);
  f.setTime(2500); f.panel.update(); assert.equal(f.commands.length, 2);
  f.setTime(5000); f.panel.update();
  assert.equal(f.panel.pending, null);
  assert.equal(f.panel.$('.fire-status').textContent, 'La conexión tarda. El servidor conserva el resultado de la solicitud.');
  assert.equal(f.client.profile.eco.pack.goods.madera, 1);
});

test('denials localize server recovery reasons and session changes reset the active request', () => {
  const f = fixture(); f.panel.open(); f.panel.load();
  const command = f.commands[0];
  assert.equal(f.panel.acknowledge({ type: 'fire', op: 'load', opId: command.opId, ok: false, why: 'goods' }), true);
  assert.equal(f.panel.$('.fire-status').textContent, 'Necesitas una madera en la mochila o bodega.');
  f.panel.load(); f.client.youServer = 8; f.panel.update();
  assert.equal(f.panel.pending, null); assert.equal(f.panel.active, false); assert.equal(f.panel.root.hidden, true);
});

test('English labels, disabled-world guard, active-only Escape, and dispose lifecycle', () => {
  const f = fixture({ locale: 'en', enabled: false });
  assert.equal(f.panel.open(), true);
  assert.equal(f.panel.load(), false);
  assert.equal(f.panel.loadButton.textContent, 'Craft & light · 1 wood');
  assert.equal(f.panel.loadButton.disabled, true);
  assert.equal((f.doc.listeners.keydown || []).length, 1);
  f.doc.key('Escape'); assert.equal(f.panel.active, false); assert.equal((f.doc.listeners.keydown || []).length, 0);
  f.panel.open(); f.panel.dispose();
  assert.equal(f.panel.root, null); assert.equal(f.panel.active, false); assert.equal((f.doc.listeners.keydown || []).length, 0);
});
