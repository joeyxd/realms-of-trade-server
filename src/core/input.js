// Keyboard / mouse / touch / gamepad input. Produces raw axes (screen-relative), held buttons and press
// edges that the fixed tick consumes, plus UI hotkeys dispatched immediately.
// Gamepad (standard mapping): left stick moves, right stick aims, RT sword / shoot, LT guard, A dash,
// X interact, RB Q, LB E, Y R, D-pad up potion (M4), Start pause, Select the bag (hotkey 'PadSelect').
import { BTN } from '../sim/systems/movement.js';
import { stage } from '../ui/stage.js';

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
// J / K: attack and guard without a mouse (they aim at the nearest threat or enemy). Both can be held.
const PRESS_KEYS = { Space: BTN.DASH, KeyF: BTN.INTERACT, KeyQ: BTN.Q, KeyE: BTN.E, KeyR: BTN.R, KeyJ: BTN.ATTACK, KeyK: BTN.GUARD, Digit1: BTN.POTION, Numpad1: BTN.POTION };
const HOLD_KEYS = { KeyJ: BTN.ATTACK, KeyK: BTN.GUARD };
// Standard gamepad buttons → command bits (held ones also count as held).
const PAD_PRESS = [[7, BTN.ATTACK, true], [6, BTN.GUARD, true], [0, BTN.DASH, false], [2, BTN.INTERACT, false], [5, BTN.Q, false], [4, BTN.E, false], [3, BTN.R, false], [12, BTN.POTION, false]];
const PAD_DEAD = 0.18;
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F3', 'F4']);

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.pressed = 0;
    this.mouseHeld = 0; this.keyHeld = 0; this.padHeld = 0; this.touchHeld = 0;
    this.touchAim = null; // a touch skill button being dragged: {x, y (screen dir, y up), k 0..1, release}
    // Gamepad: sticks after the dead zone (screen-relative, y up), aim = right stick tilted.
    this.pad = { active: false, mx: 0, my: 0, ax: 0, ay: 0, aim: false, prev: [] };
    this.mouse = { x: stage.w / 2, y: stage.h / 2, moved: false }; // stage px (rotated on an upright phone)
    this.wheel = 0;
    this.joy = { active: false, x: 0, y: 0 };
    this.enabled = false;
    this.hotkeys = new Map();
    this.lastDevice = 'keyboard';
    // Who aims: 'mouse' (cursor), 'gamepad' (right stick), 'keys' (J/K, auto-aim) or 'touch' (auto-aim).
    // Walking with WASD does not change it: mouse + keyboard keeps aiming with the cursor.
    this.aimDevice = 'keys';
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
      if (HOLD_KEYS[e.code]) { this.keyHeld |= HOLD_KEYS[e.code]; this.aimDevice = 'keys'; }
      if (e.code === 'KeyF' && this.enabled) this.interactEdge = true;
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); if (HOLD_KEYS[e.code]) this.keyHeld &= ~HOLD_KEYS[e.code]; });
    addEventListener('blur', () => { this.keys.clear(); this.mouseHeld = this.keyHeld = this.touchHeld = 0; });
    // The cursor aims anywhere on the page (over the HUD too); clicks only count on the canvas.
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') { const p = stage.toLocal(e.clientX, e.clientY); this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.moved = true; this.lastDevice = 'mouse'; this.aimDevice = 'mouse'; }
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || !this.enabled) return;
      this.aimDevice = 'mouse';
      if (e.button === 0) { this.pressed |= BTN.ATTACK; this.mouseHeld |= BTN.ATTACK; }
      if (e.button === 2) { this.pressed |= BTN.GUARD; this.mouseHeld |= BTN.GUARD; }
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouseHeld &= ~BTN.ATTACK;
      if (e.button === 2) this.mouseHeld &= ~BTN.GUARD;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  onHotkey(code, fn) { this.hotkeys.set(code, fn); }

  // Buttons held right now (mouse, J/K, gamepad triggers, touch GUARD), as command bits.
  get held() { return this.enabled ? this.mouseHeld | this.keyHeld | this.padHeld | this.touchHeld : 0; }

  // Read the first connected gamepad (call once per fixed tick, before axes()).
  pollPad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let g = null;
    for (const p of pads) if (p && p.connected) { g = p; break; }
    const P = this.pad;
    if (!g) { P.active = false; P.aim = false; this.padHeld = 0; return; }
    const stick = (x, y) => {
      const l = Math.hypot(x, y);
      if (l < PAD_DEAD) return [0, 0];
      const k = Math.min(1, (l - PAD_DEAD) / (1 - PAD_DEAD)) / l;
      return [x * k, -y * k];
    };
    [P.mx, P.my] = stick(g.axes[0] || 0, g.axes[1] || 0);
    [P.ax, P.ay] = stick(g.axes[2] || 0, g.axes[3] || 0);
    P.aim = Math.hypot(P.ax, P.ay) > 0.3;
    const down = (i) => { const b = g.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
    let held = 0, any = P.aim || Math.hypot(P.mx, P.my) > 0;
    for (const [i, bit, hold] of PAD_PRESS) {
      const d = down(i);
      if (d) { any = true; if (hold) held |= bit; }
      if (d && !P.prev[i] && this.enabled) { this.pressed |= bit; if (bit === BTN.INTERACT) this.interactEdge = true; }
      P.prev[i] = d;
    }
    const start = down(9);
    if (start && !P.prev[9]) { const hk = this.hotkeys.get('Escape'); if (hk) hk({ code: 'Escape' }); }
    P.prev[9] = start;
    const select = down(8);
    if (select && !P.prev[8]) { const hk = this.hotkeys.get('PadSelect'); if (hk) hk({ code: 'PadSelect' }); }
    P.prev[8] = select;
    this.padHeld = held;
    P.active = any || P.active;
    if (any) { this.lastDevice = 'gamepad'; this.aimDevice = 'gamepad'; }
  }

  // Screen-relative movement axes: x = right, y = up. Normalized (8 directions on keys).
  axes(out) {
    let x = 0, y = 0;
    if (this.enabled) {
      for (const k of this.keys) { const m = MOVE_KEYS[k]; if (m) { x += m[0]; y += m[1]; } }
      if (this.joy.active) { x += this.joy.x; y += this.joy.y; }
      if (this.pad.active) { x += this.pad.mx; y += this.pad.my; }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    out.x = x; out.y = y;
    return out;
  }

  pressDash() { if (this.enabled) this.pressed |= BTN.DASH; }
  press(bit) { if (this.enabled) { this.pressed |= bit; this.lastDevice = 'touch'; this.aimDevice = 'touch'; } }
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
