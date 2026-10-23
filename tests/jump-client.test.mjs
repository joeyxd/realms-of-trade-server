// PT06 part 2: the jump on the client. The controls (core/input.js): with the jump on, Space / A / the touch button jump
// and stay held for the variable height, Shift / B dash; off keeps today's Space = dash. The touch button (ui/touch.js)
// sits in the reserved slot, hidden until the server says the jump is on. The render state (client/gameClient.js)
// carries the jump stage and the floor under the body, for the pose and the shadow. The copy exists in both languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';
import { TouchControls } from '../src/ui/touch.js';
import { BTN } from '../src/sim/systems/movement.js';
import { JUMP_STAGE, airStage } from '../src/sim/systems/jump.js';
import { DT } from '../src/data/tuning.js';
import { clientAndServer, map } from './helpers.mjs';
import runtime from '../src/i18n/runtime.js';
import entry from '../src/i18n/entry.js';

const key = (code) => ({ code, preventDefault() {} });

// The real handlers, captured without a browser (as raft-input.test.mjs does).
function makeInput() {
  const listeners = new Map();
  const original = globalThis.addEventListener;
  globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
  try {
    const input = new Input({ addEventListener() {} });
    input.enabled = true;
    return { input, down: (c) => listeners.get('keydown')(key(c)), up: (c) => listeners.get('keyup')(key(c)) };
  } finally { globalThis.addEventListener = original; }
}

function withPad(fn) {
  const originalListener = globalThis.addEventListener, originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const pad = { connected: true, buttons, axes: [0, 0, 0, 0] };
  globalThis.addEventListener = () => {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  try {
    const input = new Input({ addEventListener() {} }); input.enabled = true;
    fn(input, buttons);
  } finally {
    globalThis.addEventListener = originalListener;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
}

test('airStage: the four air actions and the steep slide lift the body; ground and landing do not', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(airStage), [false, true, true, true, true, false, true]);
  assert.equal(airStage(JUMP_STAGE.LANDING), false);
});

test('keyboard: jump off keeps Space = dash and Shift idle; on, Space jumps and holds the bit, Shift dashes', () => {
  const { input, down, up } = makeInput();
  down('Space'); assert.equal(input.consumePresses(), BTN.DASH); assert.equal(input.held & BTN.JUMP, 0); up('Space');
  down('ShiftLeft'); assert.equal(input.consumePresses(), 0, 'Shift does nothing with the jump off'); up('ShiftLeft');
  input.setJump(true);
  down('Space');
  assert.equal(input.consumePresses(), BTN.JUMP, 'the press');
  assert.equal(input.held & BTN.JUMP, BTN.JUMP, 'held while Space is down (the variable height)');
  assert.equal(input.consumePresses(), 0, 'a press is one edge');
  up('Space'); assert.equal(input.held & BTN.JUMP, 0);
  down('ShiftRight'); assert.equal(input.consumePresses(), BTN.DASH, 'Shift dashes'); up('ShiftRight');
  down('KeyF'); assert.equal(input.consumePresses() & BTN.INTERACT, BTN.INTERACT, 'the other keys are untouched'); up('KeyF');
  down('Space'); input.setJump(false);
  assert.equal(input.held & BTN.JUMP, 0, 'switching the jump off drops a held jump bit');
  input.consumePresses(); up('Space');
  down('Space'); assert.equal(input.consumePresses(), BTN.DASH, 'and Space is a dash again'); up('Space');
});

test('gamepad: off, A dashes and B only cancels; on, A jumps (held) and B dashes, except while an area is being aimed', () => {
  withPad((input, b) => {
    b[0].pressed = true; input.pollPad();
    assert.equal(input.consumePresses(), BTN.DASH); assert.equal(input.held & BTN.JUMP, 0);
    b[0].pressed = false; input.pollPad();
    b[1].pressed = true; input.pollPad(); assert.equal(input.consumePresses(), 0, 'B is no press with the jump off');
    b[1].pressed = false; input.pollPad();
    input.setJump(true);
    b[0].pressed = true; input.pollPad();
    assert.equal(input.consumePresses(), BTN.JUMP, 'A jumps'); assert.equal(input.held & BTN.JUMP, BTN.JUMP, 'A held = jump held');
    input.pollPad(); assert.equal(input.consumePresses(), 0, 'one edge');
    b[0].pressed = false; input.pollPad(); assert.equal(input.held & BTN.JUMP, 0);
    b[1].pressed = true; input.pollPad(); assert.equal(input.consumePresses(), BTN.DASH, 'B dashes');
    b[1].pressed = false; input.pollPad();
    input.previewing = true;
    b[1].pressed = true; input.pollPad();
    assert.equal(input.consumePresses(), 0, 'B while aiming an area cancels it instead of dashing');
    assert.equal(input.cancelEdge, true);
    b[1].pressed = false; input.pollPad();
    b[7].pressed = true; input.pollPad(); assert.ok(input.consumePresses() & BTN.ATTACK, 'RT still attacks'); assert.ok(input.held & BTN.ATTACK);
  });
});

test('touch: pressJump is a press plus the held bit until releaseJump; a disabled input ignores it', () => {
  const { input } = makeInput();
  input.setJump(true);
  input.pressJump();
  assert.equal(input.consumePresses(), BTN.JUMP); assert.equal(input.held & BTN.JUMP, BTN.JUMP);
  assert.equal(input.aimDevice, 'touch');
  input.releaseJump(); assert.equal(input.held & BTN.JUMP, 0);
  input.enabled = false; input.pressJump(); assert.equal(input.consumePresses(), 0);
});

// ui/touch.js on a fake DOM (as touch-layout.test.mjs does).
class FakeEl extends EventTarget {
  constructor() {
    super();
    this.props = {}; this.style = { setProperty: (k, v) => { this.props[k] = v; } };
    this.dataset = {}; this.children = {}; this.hidden = false;
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return on; } };
  }
  setPointerCapture() {} releasePointerCapture() {}
  setAttribute(k, v) { this[k] = String(v); }
  querySelector(sel) { return (this.children[sel] ||= new FakeEl()); }
  querySelectorAll() { return []; }
}

test('the touch jump button: hidden until setJump(true); its pointerdown presses, its lift releases', () => {
  const calls = [];
  const input = { joy: {}, press() {}, pressDash() {}, pressInteract() {}, cancelAim() {}, slotDown() {}, slotUp() {}, pressJump: () => calls.push('press'), releaseJump: () => calls.push('release') };
  const root = new FakeEl();
  const touch = new TouchControls(root, input);
  const btn = root.querySelector('.t-jump');
  assert.equal(touch.jumpBtn, btn);
  assert.equal(btn.hidden, true, 'hidden by default: production has no jump');
  assert.ok(root.innerHTML.includes('class="tbtn t-jump"') && root.innerHTML.includes('hidden'), 'the button is in the cluster, hidden');
  touch.setJump(true); assert.equal(btn.hidden, false);
  btn.dispatchEvent(new Event('pointerdown'));
  btn.dispatchEvent(new Event('pointerup'));
  btn.dispatchEvent(new Event('pointerdown'));
  btn.dispatchEvent(new Event('pointercancel'));
  assert.deepEqual(calls, ['press', 'release', 'press', 'release']);
  touch.setJump(false); assert.equal(btn.hidden, true);
});

test('the render state: in a lab jump the stage is JUMP, the vertical speed is set and the floor under the body is the terrain', () => {
  const { server, client, deliver } = clientAndServer(() => [-150, -140], { jump: 'lab' });
  const pe = client.pred.ecs, ce = client.youLocal;
  const out = {};
  client.localState(0, out);
  assert.equal(out.jmp, JUMP_STAGE.GROUND); assert.equal(out.gy, out.y, 'on the ground the floor is the body');
  let seen = false;
  for (let i = 0; i < 120 && !seen; i++) {
    client.update(DT);
    const inAir = pe.jmpAct[ce] >= 1 && pe.jmpAct[ce] <= 4;
    client.tickInput({ mx: 0, mz: 0, ax: pe.x[ce] + 5, az: pe.z[ce], btn: BTN.JUMP, prs: i === 5 ? BTN.JUMP : 0 });
    server.step(); deliver();
    client.localState(0, out);
    if (inAir && out.y - out.gy > 1) {
      seen = true;
      assert.equal(out.jmp, JUMP_STAGE.JUMP);
      assert.ok(Math.abs(out.gy - map.groundAt(out.x, out.z)) < 1e-6, 'gy is the terrain under the body');
      assert.ok(Number.isFinite(out.jmpVy) && out.jmpVy !== 0, 'jmpVy travels with the state');
    }
  }
  assert.ok(seen, 'the body rose more than 1 u above its floor');
});

test('the copy exists in both languages: the touch button and the controls row', () => {
  for (const k of ['touch.jump', 'touch.jumpFace']) { assert.equal(runtime[k].length, 2, k); assert.ok(runtime[k].every((s) => s.length > 0), k); }
  for (const k of ['controls.jump', 'controls.key.shift']) { assert.equal(entry[k].length, 2, k); assert.ok(entry[k].every((s) => s.length > 0), k); }
  assert.equal(runtime['touch.jumpFace'][0], 'SALTO');
});
