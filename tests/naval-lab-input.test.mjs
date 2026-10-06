import test from 'node:test';
import assert from 'node:assert/strict';
import { NavalLabInput } from '../tools/naval-lab/input.js';

class FakeEvent extends Event {
  constructor(type, properties = {}) {
    super(type, { cancelable: true });
    for (const [key, value] of Object.entries(properties)) {
      Object.defineProperty(this, key, { configurable: true, value });
    }
  }
}

class FakeTarget extends EventTarget {
  constructor() {
    super();
    this.hidden = false;
    this.visibilityState = 'visible';
    this.defaultView = new EventTarget();
  }

  querySelectorAll() { return this.pilotButtons || []; }
  send(type, properties = {}) { this.dispatchEvent(new FakeEvent(type, properties)); }
}

class FakeButton extends EventTarget {
  constructor(pilot) {
    super();
    this.dataset = { pilot };
    this.captured = [];
  }

  setPointerCapture(pointerId) { this.captured.push(pointerId); }
  send(type, properties = {}) { this.dispatchEvent(new FakeEvent(type, properties)); }
}

const key = (target, type, value, properties = {}) => target.send(type, {
  key: value,
  code: ({ w: 'KeyW', s: 'KeyS', a: 'KeyA', d: 'KeyD', Escape: 'Escape' })[value] || value,
  ...properties,
});

test('keyboard controls hold, release, resolve opposing directions, and Escape clears', () => {
  const root = new FakeTarget();
  const input = new NavalLabInput(root);

  key(root, 'keydown', 'w');
  key(root, 'keydown', 'ArrowDown');
  key(root, 'keydown', 'a');
  key(root, 'keydown', 'd');
  assert.deepEqual(input.poll(), { throttle: 1, brake: 1, steer: 0 });
  key(root, 'keyup', 'a');
  assert.deepEqual(input.poll(), { throttle: 1, brake: 1, steer: 1 });
  key(root, 'keydown', 'Escape');
  assert.deepEqual(input.poll(), { throttle: 0, brake: 0, steer: 0 });
  key(root, 'keyup', 'w');
  assert.deepEqual(input.poll(), { throttle: 0, brake: 0, steer: 0 });
  input.dispose();
});

test('form fields suppress commands, releases still work, and R/J callbacks ignore repeats', () => {
  const root = new FakeTarget();
  let resets = 0;
  let jettisons = 0;
  const input = new NavalLabInput(root, { onReset: () => resets++, onJettison: () => jettisons++ });
  const form = { tagName: 'INPUT' };

  key(root, 'keydown', 'w');
  key(root, 'keydown', 'r', { target: form });
  key(root, 'keydown', 'j', { target: form });
  assert.equal(resets, 0);
  assert.equal(jettisons, 0);
  key(root, 'keyup', 'w', { target: form });
  assert.equal(input.poll().throttle, 0);

  key(root, 'keydown', 'r');
  key(root, 'keydown', 'r', { repeat: true });
  key(root, 'keydown', 'j');
  key(root, 'keydown', 'j', { repeat: true });
  assert.equal(resets, 1);
  assert.equal(jettisons, 1);
  const codeOnlyReset = new FakeEvent('keydown', { code: 'KeyR' });
  root.dispatchEvent(codeOnlyReset);
  assert.equal(resets, 2);
  assert.equal(codeOnlyReset.defaultPrevented, true);
  const codeOnlyJettison = new FakeEvent('keydown', { code: 'KeyJ' });
  root.dispatchEvent(codeOnlyJettison);
  assert.equal(jettisons, 2);
  assert.equal(codeOnlyJettison.defaultPrevented, true);
  const editable = { isContentEditable: true };
  key(root, 'keydown', 'r', { target: editable });
  assert.equal(resets, 2);
  input.dispose();
});

test('touch buttons track independent pointers and release on cancel or lost capture', () => {
  const root = new FakeTarget();
  const throttle = new FakeButton('throttle');
  const left = new FakeButton('left');
  const right = new FakeButton('right');
  root.pilotButtons = [throttle, left, right];
  const input = new NavalLabInput(root);

  throttle.send('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
  left.send('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false });
  right.send('pointerdown', { pointerId: 3, pointerType: 'touch', isPrimary: false });
  assert.deepEqual(input.poll(), { throttle: 1, brake: 0, steer: 0 });
  assert.deepEqual(throttle.captured, [1]);

  root.send('pointercancel', { pointerId: 2 });
  assert.deepEqual(input.poll(), { throttle: 1, brake: 0, steer: 1 });
  root.send('lostpointercapture', { pointerId: 3 });
  assert.deepEqual(input.poll(), { throttle: 1, brake: 0, steer: 0 });

  left.send('pointerdown', { pointerId: 4, pointerType: 'mouse', button: 2, isPrimary: true });
  left.send('pointerdown', { pointerId: 5, pointerType: 'mouse', button: 0, isPrimary: false });
  assert.deepEqual(input.poll(), { throttle: 1, brake: 0, steer: 0 });
  root.send('pointerup', { pointerId: 1 });
  assert.deepEqual(input.poll(), { throttle: 0, brake: 0, steer: 0 });
  input.dispose();
});

test('blur and hidden visibility clear held inputs; first connected standard gamepad supplies analog controls', () => {
  const root = new FakeTarget();
  const pads = [
    { connected: false, axes: [1], buttons: [] },
    { connected: true, mapping: 'xinput', axes: [-1], buttons: [{ value: 1 }] },
    { connected: true, mapping: 'standard', axes: [0.16], buttons: Array.from({ length: 8 }, (_, index) => ({ value: index === 7 ? 0.4 : index === 6 ? 0.7 : 0 })) },
    { connected: true, mapping: 'standard', axes: [-1], buttons: [{ value: 1 }] },
  ];
  const input = new NavalLabInput(root, { getGamepads: () => pads });
  key(root, 'keydown', 'w');
  assert.deepEqual(input.poll(), { throttle: 1, brake: 0.7, steer: 0.16 });
  root.defaultView.dispatchEvent(new Event('blur'));
  assert.equal(input.poll().throttle, 0.4);

  root.hidden = true;
  root.send('visibilitychange');
  assert.deepEqual(input.poll(), { throttle: 0.4, brake: 0.7, steer: 0.16 });
  input.dispose();
});

test('non-finite gamepad values become zero and finite values are clamped', () => {
  const root = new FakeTarget();
  const pads = [{
    connected: true,
    mapping: 'standard',
    axes: [Infinity],
    buttons: Array.from({ length: 8 }, (_, index) => ({
      value: index === 7 ? 2 : index === 6 ? -1 : 0,
    })),
  }];
  const input = new NavalLabInput(root, { getGamepads: () => pads });
  assert.deepEqual(input.poll(), { throttle: 1, brake: 0, steer: 0 });
  pads[0].axes[0] = -2;
  pads[0].buttons[7].value = NaN;
  pads[0].buttons[6].value = Infinity;
  assert.deepEqual(input.poll(), { throttle: 0, brake: 0, steer: -1 });
  input.dispose();
});

test('dispose removes handlers and clears all state', () => {
  const root = new FakeTarget();
  const button = new FakeButton('brake');
  root.pilotButtons = [button];
  const input = new NavalLabInput(root);
  key(root, 'keydown', 's');
  button.send('pointerdown', { pointerId: 8, pointerType: 'touch' });
  input.dispose();
  key(root, 'keydown', 'w');
  button.send('pointerdown', { pointerId: 9, pointerType: 'touch' });
  assert.deepEqual(input.poll(), { throttle: 0, brake: 0, steer: 0 });
});
