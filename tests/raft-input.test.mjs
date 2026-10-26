import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';
import { BTN } from '../src/sim/systems/movement.js';

// Exercise the real input handlers without a renderer or a copied keyboard implementation.
test('build context consumes R as rotation, preserves movement and clears combat at each boundary', () => {
  const listeners = new Map(), canvasListeners = new Map();
  const original = globalThis.addEventListener;
  globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
  const canvas = { addEventListener: (name, fn) => canvasListeners.set(name, fn) };
  const slots = () => ({ down: {}, up: {}, held: {} });
  const key = (code, extra = {}) => ({ code, preventDefault() {}, ...extra });
  try {
    const input = new Input(canvas); input.enabled = true;
    let rotates = 0;
    input.onHotkey('KeyR', () => { if (!input.buildContext) return false; rotates++; return true; });
    listeners.get('keydown')(key('KeyR'));
    assert.equal(input.consumeSlots(slots()).down.r, true, 'R remains a skill outside building');
    canvasListeners.get('pointerdown')({ pointerType: 'mouse', button: 2 });
    assert.ok(input.held & BTN.GUARD, 'RMB still guards outside building');
    input.setBuildContext(true);
    assert.equal(input.held, 0); assert.equal(input.consumePresses(), 0);
    listeners.get('keydown')(key('KeyR'));
    listeners.get('keydown')(key('KeyW'));
    listeners.get('keydown')(key('KeyJ'));
    canvasListeners.get('pointerdown')({ pointerType: 'mouse', button: 0 });
    input.press(BTN.DASH); input.pressInteract(); input.slotDown('q', 'touch');
    assert.equal(rotates, 1);
    assert.deepEqual(input.axes({}), { x: 0, y: 1 });
    assert.equal(input.consumePresses(), 0); assert.equal(input.held, 0);
    assert.equal(input.consumeInteract(), false);
    const activeSlots = input.consumeSlots(slots());
    assert.deepEqual(activeSlots.down, { q: false, e: false, r: false, g: false });
    input.setBuildContext(false);
    assert.deepEqual(input.axes({}), { x: 0, y: 0 });
    assert.equal(input.consumePresses(), 0); assert.equal(input.held, 0);
    listeners.get('keyup')(key('KeyR'));
    assert.equal(input.consumeSlots(slots()).up.r, false, 'release after building does not cast');
    listeners.get('keydown')(key('KeyR'));
    assert.equal(input.consumeSlots(slots()).down.r, true);
  } finally { globalThis.addEventListener = original; }
});

test('a gamepad button held across construction must be released before it can attack again', () => {
  const originalListener = globalThis.addEventListener, originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const pad = { connected: true, buttons, axes: [0, 0, 0, 0] };
  globalThis.addEventListener = () => {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  try {
    const input = new Input({ addEventListener() {} }); input.enabled = true;
    buttons[7].pressed = true; input.pollPad();
    assert.ok(input.consumePresses() & BTN.ATTACK);
    input.setBuildContext(true); input.pollPad();
    input.setBuildContext(false); input.pollPad(); input.pollPad();
    assert.equal(input.consumePresses(), 0); assert.equal(input.held, 0);
    buttons[7].pressed = false; input.pollPad();
    buttons[7].pressed = true; input.pollPad();
    assert.ok(input.consumePresses() & BTN.ATTACK); assert.ok(input.held & BTN.ATTACK);
  } finally {
    globalThis.addEventListener = originalListener;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});
