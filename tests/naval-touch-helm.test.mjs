import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchHelm } from '../tools/naval-lab/touch-helm.js';

class FakeEvent extends Event {
  constructor(type, props = {}) {
    super(type, { cancelable: true });
    for (const [key, value] of Object.entries(props)) Object.defineProperty(this, key, { configurable: true, value });
  }
}

class FakeElement extends EventTarget {
  constructor(tag, ownerDocument) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.attributes = {};
    this.dataset = {}; this.style = {}; this.disabled = false; this.className = ''; this.parentNode = null;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...children) { for (const old of this.children) old.parentNode = null; this.children = []; for (const child of children) this.appendChild(child); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  setPointerCapture(id) { this.captured = id; }
  releasePointerCapture(id) { if (this.captured === id) this.captured = null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 104, height: 104 }; }
  querySelector(selector) { return selector === '.naval-touch-action-label' ? this.children.find((c) => c.className === 'naval-touch-action-label') : null; }
}

class FakeDocument extends EventTarget {
  constructor() { super(); this.hidden = false; this.visibilityState = 'visible'; this.defaultView = new EventTarget(); }
  createElement(tag) { return new FakeElement(tag, this); }
  createElementNS(_ns, tag) { return new FakeElement(tag, this); }
}

function harness(options = {}) {
  const { localStorage, ...helmOptions } = options;
  const document = new FakeDocument(), container = new FakeElement('main', document), moves = [], looks = [], actions = [], gestures = [];
  if (localStorage) document.defaultView.localStorage = localStorage;
  const helm = new TouchHelm(container, { onMove: (value) => moves.push(value), onLook: (value) => looks.push(value),
    onAction: (value) => actions.push(value), onGesture: () => gestures.push(true), ...helmOptions });
  const stick = (name) => helm.sticks.get(name).pad;
  const send = (target, type, props) => target.dispatchEvent(new FakeEvent(type, props));
  const end = (type, pointerId) => send(document, type, { pointerId });
  return { document, container, helm, moves, looks, actions, gestures, stick, send, end };
}

test('two sticks own separate pointers and emit bounded independent analog values', () => {
  const h = harness();
  h.send(h.stick('move'), 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 52, clientY: 52 });
  h.send(h.stick('look'), 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 52, clientY: 52 });
  h.send(h.stick('move'), 'pointermove', { pointerId: 1, clientX: 1000, clientY: -1000 });
  h.send(h.stick('look'), 'pointermove', { pointerId: 2, clientX: -1000, clientY: 1000 });
  assert.ok(h.moves.at(-1).x > 0 && h.moves.at(-1).y < 0);
  assert.ok(h.looks.at(-1).x < 0 && h.looks.at(-1).y > 0);
  assert.ok(Math.abs(Math.hypot(h.moves.at(-1).x, h.moves.at(-1).y) - 1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(h.looks.at(-1).x, h.looks.at(-1).y) - 1) < 1e-9);
  assert.equal(h.helm.diagnostics().pointers, 2);
  h.end('pointerup', 1); h.end('pointerup', 2);
  assert.deepEqual(h.moves.at(-1), { x: 0, y: 0 }); assert.deepEqual(h.looks.at(-1), { x: 0, y: 0 });
  h.helm.dispose();
});

test('radial dead zone is neutral and positive stick y means braking', () => {
  const h = harness();
  h.send(h.stick('move'), 'pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 52, clientY: 52 });
  h.send(h.stick('move'), 'pointermove', { pointerId: 4, clientX: 55, clientY: 55 });
  assert.deepEqual(h.moves.at(-1), { x: 0, y: 0 });
  h.send(h.stick('move'), 'pointermove', { pointerId: 4, clientX: 52, clientY: 98 });
  assert.equal(h.moves.at(-1).y, 1);
  h.end('pointercancel', 4);
  assert.deepEqual(h.moves.at(-1), { x: 0, y: 0 }); h.helm.dispose();
});

test('cancel, lost capture, blur and hidden page neutralize without tap-stuck state and can rearm', () => {
  const h = harness();
  h.send(h.stick('move'), 'pointerdown', { pointerId: 8, pointerType: 'touch', clientX: 52, clientY: 52 });
  h.send(h.stick('move'), 'pointermove', { pointerId: 8, clientX: 52, clientY: 10 });
  h.end('pointercancel', 8); assert.deepEqual(h.moves.at(-1), { x: 0, y: 0 });
  h.send(h.stick('move'), 'pointerdown', { pointerId: 9, pointerType: 'touch', clientX: 52, clientY: 52 });
  h.send(h.stick('move'), 'pointermove', { pointerId: 9, clientX: 52, clientY: 10 });
  h.document.defaultView.dispatchEvent(new Event('blur')); assert.deepEqual(h.moves.at(-1), { x: 0, y: 0 });
  h.send(h.stick('look'), 'pointerdown', { pointerId: 10, pointerType: 'touch', clientX: 52, clientY: 52 });
  h.document.hidden = true; h.document.visibilityState = 'hidden'; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.helm.diagnostics().pointers, 0); assert.deepEqual(h.looks.at(-1), { x: 0, y: 0 });
  h.document.hidden = false; h.document.visibilityState = 'visible';
  h.send(h.stick('look'), 'pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 52, clientY: 52 });
  h.send(h.stick('look'), 'pointermove', { pointerId: 11, clientX: 90, clientY: 52 });
  assert.ok(h.looks.at(-1).x > 0); h.end('lostpointercapture', 11); assert.deepEqual(h.looks.at(-1), { x: 0, y: 0 });
  h.helm.dispose();
});

test('actions have keyboard clicks, pointer taps, disabled state, and disposal removes live controls', () => {
  const h = harness({ actions: [{ id: 'capture', label: 'Capturar', icon: 'wind' }, { id: 'jettison', label: 'Soltar', icon: 'cargo', disabled: true },
    { id: 'walk', label: 'Caminar', icon: 'crew' }] });
  const capture = h.helm.buttons.get('capture').button, jettison = h.helm.buttons.get('jettison').button;
  capture.getBoundingClientRect = () => ({ left: 0, top: 0, right: 60, bottom: 60 });
  assert.equal(capture.getAttribute('aria-label'), 'Capturar'); assert.ok(capture.children[0].tagName === 'SVG');
  for (const id of ['capture', 'jettison', 'walk']) {
    const shapes = h.helm.buttons.get(id).button.children[0].children;
    assert.ok(shapes.length > 0);
    assert.ok(shapes.every((shape) => !shape.getAttribute('d')?.startsWith('<')));
  }
  assert.equal(h.helm.sticks.get('move').pad.children.at(-1).textContent, 'MOVIMIENTO');
  assert.equal(h.helm.sticks.get('move').pad.children.at(-2).textContent, '↑ AVANZA  ·  ↓ FRENA');
  assert.match(h.helm.sticks.get('move').pad.getAttribute('aria-label'), /arriba avanza, abajo frena/);
  h.send(capture, 'pointerdown', { pointerId: 14, pointerType: 'touch' }); h.end('pointercancel', 14);
  assert.deepEqual(h.actions, [], 'a canceled action contacts do not fire');
  h.send(capture, 'pointerdown', { pointerId: 15, pointerType: 'touch' });
  h.send(h.document, 'pointerup', { pointerId: 15, clientX: 30, clientY: 30 });
  assert.deepEqual(h.actions, ['capture']);
  capture.dispatchEvent(new FakeEvent('click', { detail: 0 })); assert.deepEqual(h.actions, ['capture', 'capture']);
  h.send(capture, 'pointerdown', { pointerId: 18, pointerType: 'touch' });
  h.send(h.document, 'pointerup', { pointerId: 18, clientX: 90, clientY: 30 }); assert.equal(h.actions.length, 2);
  h.send(jettison, 'pointerdown', { pointerId: 16, pointerType: 'touch' }); h.end('pointerup', 16);
  assert.equal(h.actions.length, 2);
  h.helm.setActionState('jettison', { disabled: false, label: 'Aligerar' });
  assert.equal(jettison.getAttribute('aria-label'), 'Aligerar'); assert.equal(jettison.disabled, false);
  h.send(capture, 'pointerdown', { pointerId: 19, pointerType: 'touch' }); h.helm.setActions([]);
  h.end('pointerup', 19); assert.equal(h.actions.length, 2, 'removed action pointers are canceled');
  h.helm.setEnabled(false); assert.equal(h.helm.diagnostics().enabled, false);
  h.helm.setEnabled(true); h.helm.dispose(); assert.equal(h.helm.diagnostics().disposed, true);
  assert.equal(h.container.children.length, 0);
  h.send(capture, 'pointerdown', { pointerId: 17, pointerType: 'touch' }); h.end('pointerup', 17);
  assert.equal(h.actions.length, 2);
});

test('reference layout long press opens an available-action picker without firing and rebinds a slot', async () => {
  const h = harness({ layout: 'reference', actions: [{ id: 'gust', label: 'Ráfaga', icon: 'wind' },
    { id: 'capture', label: 'Captura', icon: 'capture' }, { id: 'land', label: 'Atracar', disabled: true }] });
  const slot = h.helm.slotButtons[0].button;
  assert.equal(h.helm.wrapper.getAttribute('data-layout'), 'reference');
  assert.equal(h.helm.slotButtons.length, 3);
  assert.deepEqual(h.helm.diagnostics().bindings, ['gust', 'capture', 'land']);
  h.send(slot, 'pointerdown', { pointerId: 40, pointerType: 'touch', clientX: 20, clientY: 20 });
  await new Promise((resolve) => setTimeout(resolve, 530));
  assert.equal(h.helm.diagnostics().picker, true);
  h.end('pointerup', 40);
  assert.deepEqual(h.actions, [], 'opening and releasing the picker never executes the old binding');
  assert.deepEqual(h.helm.pickerChoices.children.map((option) => option.dataset.bindId), ['gust', 'capture', 'land']);
  assert.equal(h.helm.chooseBinding(0, 'capture'), true);
  assert.deepEqual(h.helm.diagnostics().bindings, ['capture', 'gust', 'land'], 'duplicate bindings swap instead of duplicating an action');
  h.send(slot, 'pointerdown', { pointerId: 41, pointerType: 'touch', clientX: 20, clientY: 20 }); h.end('pointerup', 41);
  assert.deepEqual(h.actions, ['capture']);
  h.helm.dispose();
});

test('long-press release compatibility click cannot activate the old slot or hit the newly opened picker after a long hold', async () => {
  const h = harness({ layout: 'reference', actions: [{ id: 'capture', label: 'Captura' }, { id: 'center', label: 'Centrar' }] });
  h.helm.chooseBinding(0, 'capture');
  const slot = h.helm.slotButtons[0].button;
  h.send(slot, 'pointerdown', { pointerId: 42, pointerType: 'touch', clientX: 20, clientY: 20 });
  await new Promise((resolve) => setTimeout(resolve, 2200));
  h.end('pointerup', 42);
  h.end('lostpointercapture', 42);
  assert.equal(h.helm.diagnostics().picker, true, 'pointer release and later lost capture leave the picker open');
  h.send(h.helm.picker.children.at(-1), 'click', { detail: 1, pointerId: 42 });
  assert.equal(h.helm.diagnostics().picker, true, 'a retargeted compatibility click at the held location cannot hit Cancel');
  assert.deepEqual(h.actions, [], 'compatibility clicks never execute the former slot action');
  h.helm.dispose();
});

test('reference action movement cancels a hold, while a picker leaves independent sticks live and disabling clears all', async () => {
  const h = harness({ layout: 'reference', actions: [{ id: 'gust', label: 'Ráfaga' }, { id: 'capture', label: 'Captura' }] });
  const slot = h.helm.slotButtons[0].button;
  h.send(slot, 'pointerdown', { pointerId: 50, pointerType: 'touch', clientX: 20, clientY: 20 });
  h.send(h.document, 'pointermove', { pointerId: 50, clientX: 32, clientY: 20 });
  await new Promise((resolve) => setTimeout(resolve, 520)); h.end('pointerup', 50);
  assert.equal(h.helm.diagnostics().picker, false); assert.deepEqual(h.actions, []);

  h.send(h.stick('move'), 'pointerdown', { pointerId: 51, pointerType: 'touch', clientX: 52, clientY: 52 });
  h.send(h.stick('move'), 'pointermove', { pointerId: 51, clientX: 52, clientY: 8 });
  h.send(slot, 'pointerdown', { pointerId: 52, pointerType: 'touch', clientX: 20, clientY: 20 });
  await new Promise((resolve) => setTimeout(resolve, 520));
  assert.equal(h.moves.at(-1).y, -1, 'opening the picker does not steal an independent movement pointer');
  assert.equal(h.helm.sticks.get('move').pointerId, 51);
  h.end('pointerup', 52); h.helm.setEnabled(false);
  assert.equal(h.helm.diagnostics().picker, false); assert.equal(h.helm.diagnostics().pointers, 0);
  assert.deepEqual(h.looks.at(-1), { x: 0, y: 0 }); h.helm.dispose();
});

test('reference catalog changes close picker and retain only available bindings', () => {
  const h = harness({ layout: 'reference', actions: [{ id: 'gust', label: 'Ráfaga' }, { id: 'capture', label: 'Captura' }] });
  h.helm.openPicker(1); assert.equal(h.helm.diagnostics().picker, true);
  h.helm.setActions([{ id: 'capture', label: 'Capturar' }, { id: 'dock', label: 'Atracar' }]);
  assert.equal(h.helm.diagnostics().picker, false);
  assert.deepEqual(h.helm.diagnostics().bindings, ['capture', 'dock', null]);
  h.helm.setActions([{ id: 'capture', label: 'Capturar', disabled: true }, { id: 'dock', label: 'Atracar' }]);
  assert.deepEqual(h.helm.diagnostics().bindings, ['capture', 'dock', null], 'cooldown keeps the saved slot binding');
  h.helm.dispose();
});

test('reference shortcut follows the action when a slot is rebound or its metadata changes', () => {
  const h = harness({ layout: 'reference', actions: [{ id: 'capture', label: 'Ráfaga', shortcut: 'Q' },
    { id: 'bag', label: 'Mochila', shortcut: 'I' }, { id: 'center', label: 'Centrar', shortcut: 'V' }] });
  const slot = h.helm.slotButtons[0];
  assert.equal(slot.shortcut.textContent, 'Q');
  assert.equal(slot.button.getAttribute('aria-keyshortcuts'), 'Q');
  h.helm.chooseBinding(0, 'center');
  assert.equal(slot.shortcut.textContent, 'V');
  assert.equal(slot.button.getAttribute('aria-keyshortcuts'), 'V');
  h.helm.setActions([{ id: 'capture', label: 'Ráfaga', shortcut: 'Q' }, { id: 'bag', label: 'Mochila', shortcut: 'I' },
    { id: 'center', label: 'Centrar' }]);
  assert.equal(slot.shortcut.textContent, '');
  assert.equal(slot.button.getAttribute('aria-keyshortcuts'), null);
  assert.deepEqual(h.actions, [], 'binding and metadata changes never execute an action');
  h.helm.dispose();
});

test('metadata-only catalog updates preserve a held slot and picker without replacing pressed options', async () => {
  const h = harness({ layout: 'reference', actions: [{ id: 'capture', label: 'Captura' }, { id: 'gust', label: 'Ráfaga' }] });
  const slot = h.helm.slotButtons[0].button;
  h.send(slot, 'pointerdown', { pointerId: 58, pointerType: 'touch', clientX: 20, clientY: 20 });
  h.helm.setActions([{ id: 'capture', label: 'Captura lista', disabled: true }, { id: 'gust', label: 'Ráfaga' }]);
  await new Promise((resolve) => setTimeout(resolve, 530));
  assert.equal(h.helm.diagnostics().picker, true, 'disabled/label changes do not cancel a long press');
  const option = h.helm.pickerChoices.children[0];
  h.helm.setActions([{ id: 'capture', label: 'Captura lista', disabled: false }, { id: 'gust', label: 'Viento' }]);
  assert.equal(h.helm.diagnostics().picker, true, 'metadata changes keep the picker open');
  assert.equal(h.helm.pickerChoices.children[0], option, 'an option under the pointer is retained');
  assert.equal(option.children[1].textContent, 'Captura lista');
  h.end('pointerup', 58);
  assert.equal(h.helm.diagnostics().picker, true);
  assert.deepEqual(h.actions, []);
  h.helm.dispose();
});

test('a tap cannot activate a different fallback if its bound action becomes unavailable before release', () => {
  const h = harness({ layout: 'reference', actions: [{ id: 'capture', label: 'Captura' }, { id: 'bag', label: 'Mochila', kind: 'item' }] });
  const slot = h.helm.slotButtons[0].button;
  assert.equal(slot.dataset.action, 'capture');
  h.send(slot, 'pointerdown', { pointerId: 59, pointerType: 'touch', clientX: 20, clientY: 20 });
  h.helm.setActions([{ id: 'capture', label: 'Captura', available: false }, { id: 'bag', label: 'Mochila', kind: 'item' }]);
  assert.equal(slot.dataset.action, 'bag', 'the visible fallback updates while preserving the held pointer record');
  h.end('pointerup', 59);
  assert.deepEqual(h.actions, [], 'release does not activate the new fallback action');
  h.helm.dispose();
});

test('cooldown binding remains equipped and can be reassigned by long press without casting', async () => {
  const h = harness({ layout: 'reference', actions: [{ id: 'capture', label: 'Captura', disabled: true }, { id: 'gust', label: 'Ráfaga' }] });
  assert.equal(h.helm.chooseBinding(2, 'capture'), true);
  const slot = h.helm.slotButtons[2].button;
  assert.equal(slot.disabled, false, 'native disabled state must not block rebinding while cooling down');
  assert.equal(slot.getAttribute('aria-disabled'), 'true');
  assert.equal(slot.getAttribute('data-unavailable'), 'true');
  h.send(slot, 'pointerdown', { pointerId: 61, pointerType: 'touch', clientX: 20, clientY: 20 });
  await new Promise((resolve) => setTimeout(resolve, 520)); h.end('pointerup', 61);
  assert.equal(h.helm.diagnostics().picker, true);
  assert.deepEqual(h.actions, [], 'cooldown binding is not cast on tap or long-release');
  assert.deepEqual(h.helm.pickerChoices.children.map((option) => option.dataset.bindId), ['capture', 'gust']);
  assert.equal(h.helm.pickerChoices.children[0].children[0].tagName, 'SVG', 'picker offers the action icon');
  assert.equal(h.helm.pickerChoices.children[0].dataset.selected, 'true');
  assert.equal(h.helm.chooseBinding(2, 'gust'), true);
  assert.deepEqual(h.helm.diagnostics().bindings, ['capture', null, 'gust']);
  h.helm.dispose();
});

test('reference bindings persist best effort and ignore IDs absent from the live catalog', () => {
  const storage = new Map();
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const first = harness({ layout: 'reference', storageKey: 'naval-test', localStorage, actions: [{ id: 'gust', label: 'Ráfaga' }, { id: 'capture', label: 'Captura' }] });
  first.helm.chooseBinding(0, 'capture'); first.helm.dispose();

  const second = harness({ layout: 'reference', storageKey: 'naval-test', localStorage, actions: [{ id: 'gust', label: 'Ráfaga' }, { id: 'capture', label: 'Captura' }] });
  second.helm.setActions([{ id: 'gust', label: 'Ráfaga' }]);
  assert.deepEqual(second.helm.diagnostics().bindings, ['gust', null, null]);
  assert.deepEqual(second.helm.diagnostics().preferredBindings, ['capture', null, null]);
  second.helm.dispose();
});

test('startup with an empty catalog and temporary shore actions preserves saved naval bindings through return aboard', () => {
  const storage = new Map([['naval-roundtrip', JSON.stringify(['capture', 'mode', null])]]);
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const h = harness({ layout: 'reference', storageKey: 'naval-roundtrip', localStorage, actions: [] });
  assert.deepEqual(h.helm.diagnostics().preferredBindings, ['capture', 'mode', null]);
  assert.deepEqual(h.helm.diagnostics().bindings, [null, null, null]);
  h.helm.setActions([{ id: 'bag', label: 'Mochila', kind: 'item', icon: 'cargo' }, { id: 'map', label: 'Mapa', icon: 'map' }, { id: 'center', label: 'Centrar', icon: 'center' }]);
  assert.deepEqual(h.helm.diagnostics().bindings, ['bag', 'map', 'center']);
  assert.deepEqual(h.helm.diagnostics().preferredBindings, ['capture', 'mode', null]);
  assert.equal(storage.get('naval-roundtrip'), JSON.stringify(['capture', 'mode', null]), 'catalog fallback never overwrites preferences');
  h.helm.setActions([{ id: 'capture', label: 'Ráfaga', icon: 'wind' }, { id: 'mode', label: 'Timón', icon: 'helm' },
    { id: 'bag', label: 'Mochila', kind: 'item', icon: 'cargo' }]);
  assert.deepEqual(h.helm.diagnostics().bindings, ['capture', 'mode', 'bag']);
  assert.equal(h.helm.slotButtons[0].button.dataset.action, 'capture');
  assert.equal(h.helm.slotButtons[1].button.getAttribute('data-action'), 'mode');
  h.helm.dispose();
});
