// Keyboard / mouse / touch input. Produces raw axes (screen-relative) and press edges that the
// fixed tick consumes, plus UI hotkeys dispatched immediately.
import { BTN } from '../sim/systems/movement.js';

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const PRESS_KEYS = { Space: BTN.DASH, KeyF: BTN.INTERACT, KeyQ: BTN.Q, KeyE: BTN.E, KeyR: BTN.R };
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F3', 'F4']);

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.pressed = 0;
    this.held = 0;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, moved: false };
    this.wheel = 0;
    this.joy = { active: false, x: 0, y: 0 };
    this.enabled = false;
    this.hotkeys = new Map();
    this.lastDevice = 'keyboard';
    this.interactEdge = false;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      const hk = this.hotkeys.get(e.code);
      if (hk && !e.repeat) hk(e);
      if (e.repeat) return;
      this.keys.add(e.code);
      if (PRESS_KEYS[e.code] && this.enabled) { this.pressed |= PRESS_KEYS[e.code]; }
      if (e.code === 'KeyF' && this.enabled) this.interactEdge = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.held = 0; });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = true; this.lastDevice = 'mouse'; }
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || !this.enabled) return;
      if (e.button === 0) { this.pressed |= BTN.ATTACK; this.held |= BTN.ATTACK; }
      if (e.button === 2) { this.pressed |= BTN.PARRY; this.held |= BTN.PARRY; }
    });
    addEventListener('pointerup', (e) => {
      if (e.button === 0) this.held &= ~BTN.ATTACK;
      if (e.button === 2) this.held &= ~BTN.PARRY;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  onHotkey(code, fn) { this.hotkeys.set(code, fn); }

  // Screen-relative movement axes: x = right, y = up. Normalized (8 directions on keys).
  axes(out) {
    let x = 0, y = 0;
    if (this.enabled) {
      for (const k of this.keys) { const m = MOVE_KEYS[k]; if (m) { x += m[0]; y += m[1]; } }
      if (this.joy.active) { x += this.joy.x; y += this.joy.y; }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    out.x = x; out.y = y;
    return out;
  }

  pressDash() { if (this.enabled) this.pressed |= BTN.DASH; }
  pressInteract() { if (this.enabled) { this.pressed |= BTN.INTERACT; this.interactEdge = true; } }

  consumeInteract() {
    const v = this.interactEdge;
    this.interactEdge = false;
    return v;
  }

  consumePresses() {
    const p = this.pressed;
    this.pressed = 0;
    return p;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
