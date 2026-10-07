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
  getAttribute(key) { return this.attributes[key] ?? null; }
  setPointerCapture(id) { this.captured = id; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 104, height: 104 }; }
  querySelector(selector) { return selector === '.naval-touch-action-label' ? this.children.find((c) => c.className === 'naval-touch-action-label') : null; }
}

class FakeDocument extends EventTarget {
  constructor() { super(); this.hidden = false; this.visibilityState = 'visible'; this.defaultView = new EventTarget(); }
  createElement(tag) { return new FakeElement(tag, this); }
  createElementNS(_ns, tag) { return new FakeElement(tag, this); }
}

function harness(options = {}) {
  const document = new FakeDocument(), container = new FakeElement('main', document), moves = [], looks = [], actions = [], gestures = [];
  const helm = new TouchHelm(container, { onMove: (value) => moves.push(value), onLook: (value) => looks.push(value),
    onAction: (value) => actions.push(value), onGesture: () => gestures.push(true), ...options });
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
