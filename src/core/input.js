// Keyboard / mouse / touch / gamepad input. Produces raw axes (screen-relative), held buttons and press
// edges that the fixed tick consumes, plus UI hotkeys dispatched immediately.
// Gamepad (standard mapping): left stick moves, right stick aims, RT sword / shoot, LT guard, A dash,
// X interact, RB Q, LB E, Y R, B cancels an area being aimed, D-pad up potion (M4), Start pause, Select the bag
// (hotkey 'PadSelect').
// The skill slots Q / E / R are not presses here: their down / up edges and held state per source (keys, pad,
// touch) go to the aim controller (client/aimcast.js) through consumeSlots(), which decides when the press goes out.
// While it shows an area (`previewing`), RMB cancels it instead of raising the guard (swallowed until released).
import { BTN } from '../sim/systems/movement.js';
import { stage } from '../ui/stage.js';

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
// J / K: attack and guard without a mouse (they aim at the nearest threat or enemy). Both can be held.
const PRESS_KEYS = { Space: BTN.DASH, KeyF: BTN.INTERACT, KeyJ: BTN.ATTACK, KeyK: BTN.GUARD, Digit1: BTN.POTION, Numpad1: BTN.POTION };
const HOLD_KEYS = { KeyJ: BTN.ATTACK, KeyK: BTN.GUARD };
const SLOT_KEYS = { KeyQ: 'q', KeyE: 'e', KeyR: 'r', KeyG: 'g' };
const PAD_SLOTS = [[5, 'q'], [4, 'e'], [3, 'r'], [13, 'g']]; // D-pad down: pearl power.
const SRC = ['key', 'pad', 'touch'];
// Standard gamepad buttons → command bits (held ones also count as held).
const PAD_PRESS = [[7, BTN.ATTACK, true], [6, BTN.GUARD, true], [0, BTN.DASH, false], [2, BTN.INTERACT, false], [12, BTN.POTION, false]];
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
    this.buildContext = false;
    this.padBlocked = new Set();
    this.hotkeys = new Map();
    this.lastDevice = 'keyboard';
    // Who aims: 'mouse' (cursor), 'gamepad' (right stick), 'keys' (J/K, auto-aim) or 'touch' (auto-aim).
    // Walking with WASD does not change it: mouse + keyboard keeps aiming with the cursor.
    this.aimDevice = 'keys';
    this.interactEdge = false;
    // Skill slots: edges since the last fixed tick and what each source holds; the cancel edge; RMB swallowed.
    const emptySlots = () => ({ q: false, e: false, r: false, g: false });
    this.slots = { down: emptySlots(), up: emptySlots() };
    this.slotSrc = { key: emptySlots(), pad: emptySlots(), touch: emptySlots() };
    this.cancelEdge = false;
    this.previewing = false;
    this.swallowRmb = false;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      const hk = this.hotkeys.get(e.code);
      if (hk && !e.repeat && hk(e) === true) { e.preventDefault(); return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.buildContext) return;
      if (PRESS_KEYS[e.code] && this.enabled) { this.pressed |= PRESS_KEYS[e.code]; }
      if (HOLD_KEYS[e.code]) { this.keyHeld |= HOLD_KEYS[e.code]; this.aimDevice = 'keys'; }
      if (SLOT_KEYS[e.code] && this.enabled) this.slotDown(SLOT_KEYS[e.code], 'key');
      if (e.code === 'KeyF' && this.enabled) this.interactEdge = true;
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (HOLD_KEYS[e.code]) this.keyHeld &= ~HOLD_KEYS[e.code];
      if (SLOT_KEYS[e.code]) this.slotUp(SLOT_KEYS[e.code], 'key');
    });
    addEventListener('blur', () => {
      this.keys.clear(); this.mouseHeld = this.keyHeld = this.touchHeld = 0;
      for (const s of SRC) for (const k in this.slotSrc[s]) this.slotSrc[s][k] = false; // the controller drops what was held
    });
    // The cursor aims anywhere on the page (over the HUD too); clicks only count on the canvas.
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') { const p = stage.toLocal(e.clientX, e.clientY); this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.moved = true; this.lastDevice = 'mouse'; this.aimDevice = 'mouse'; }
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || !this.enabled || this.buildContext) return;
      this.aimDevice = 'mouse';
      if (e.button === 0) { this.pressed |= BTN.ATTACK; this.mouseHeld |= BTN.ATTACK; }
      if (e.button === 2 && this.previewing) { this.cancelEdge = true; this.swallowRmb = true; return; } // cancels the area
      if (e.button === 2) { this.pressed |= BTN.GUARD; this.mouseHeld |= BTN.GUARD; }
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouseHeld &= ~BTN.ATTACK;
      if (e.button === 2) { this.mouseHeld &= ~BTN.GUARD; this.swallowRmb = false; }
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  onHotkey(code, fn) { this.hotkeys.set(code, fn); }

  // Construction preserves movement, but never carries a combat press across its boundary.
  setBuildContext(active) {
    this.buildContext = !!active;
    this.clearActions();
  }

  clearActions() {
    this.keys.clear();
    this.pressed = this.mouseHeld = this.keyHeld = this.padHeld = this.touchHeld = 0;
    this.interactEdge = this.cancelEdge = this.previewing = this.swallowRmb = false;
    this.touchAim = null;
    this.joy.active = false; this.joy.x = this.joy.y = 0;
    for (const src of SRC) for (const slot in this.slotSrc[src]) this.slotSrc[src][slot] = false;
    for (const slot in this.slots.down) this.slots.down[slot] = this.slots.up[slot] = false;
    this.pad.prev.forEach((down, i) => { if (down) this.padBlocked.add(i); });
  }

  // Buttons held right now (mouse, J/K, gamepad triggers, touch GUARD), as command bits.
  get held() { return this.enabled && !this.buildContext ? this.mouseHeld | this.keyHeld | this.padHeld | this.touchHeld : 0; }

  // A slot key going down / up from a source ('key' | 'pad' | 'touch'). Held = any source holds it.
  slotDown(slot, src) {
    if (!this.enabled || this.buildContext || this.slotSrc[src][slot]) return;
    this.slotSrc[src][slot] = true; this.slots.down[slot] = true;
    if (src === 'touch') { this.lastDevice = 'touch'; this.aimDevice = 'touch'; }
  }
  slotUp(slot, src) {
    if (!this.slotSrc[src][slot]) return;
    this.slotSrc[src][slot] = false;
    if (!this.slotHeld(slot)) this.slots.up[slot] = true;
  }
  slotHeld(slot) { return this.enabled && !this.buildContext && (this.slotSrc.key[slot] || this.slotSrc.pad[slot] || this.slotSrc.touch[slot]); }
  // The edges since the last call and what is held now (one fixed tick's input for the aim controller).
  consumeSlots(out) {
    for (const k of ['q', 'e', 'r', 'g']) {
      out.down[k] = this.slots.down[k]; out.up[k] = this.slots.up[k]; out.held[k] = this.slotHeld(k);
      this.slots.down[k] = this.slots.up[k] = false;
    }
    out.cancel = this.cancelEdge; this.cancelEdge = false;
    return out;
  }
  cancelAim() { this.cancelEdge = true; }

  // Read the first connected gamepad (call once per fixed tick, before axes()).
  pollPad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let g = null;
    for (const p of pads) if (p && p.connected) { g = p; break; }
    const P = this.pad;
    if (!g) {
      P.active = false; P.aim = false; this.padHeld = 0;
      for (const [i, slot] of PAD_SLOTS) if (P.prev[i]) { P.prev[i] = false; this.slotUp(slot, 'pad'); }
      return;
    }
    const stick = (x, y) => {
      const l = Math.hypot(x, y);
      if (l < PAD_DEAD) return [0, 0];
      const k = Math.min(1, (l - PAD_DEAD) / (1 - PAD_DEAD)) / l;
      return [x * k, -y * k];
    };
    [P.mx, P.my] = stick(g.axes[0] || 0, g.axes[1] || 0);
    [P.ax, P.ay] = stick(g.axes[2] || 0, g.axes[3] || 0);
    P.aim = Math.hypot(P.ax, P.ay) > 0.3;
    const down = (i) => {
      const b = g.buttons[i], d = !!b && (b.pressed || b.value > 0.5);
      if (!d) this.padBlocked.delete(i);
      if (this.padBlocked.has(i)) return false;
      return d;
    };
    let held = 0, any = P.aim || Math.hypot(P.mx, P.my) > 0;
    for (const [i, bit, hold] of PAD_PRESS) {
      const d = down(i);
      if (d) { any = true; if (hold && !this.buildContext) held |= bit; }
      if (d && !P.prev[i] && this.enabled && !this.buildContext) { this.pressed |= bit; if (bit === BTN.INTERACT) this.interactEdge = true; }
      P.prev[i] = d;
    }
    const start = down(9);
    if (start && !P.prev[9]) { const hk = this.hotkeys.get('Escape'); if (hk) hk({ code: 'Escape' }); }
    P.prev[9] = start;
    const select = down(8);
    if (select && !P.prev[8]) { const hk = this.hotkeys.get('PadSelect'); if (hk) hk({ code: 'PadSelect' }); }
    P.prev[8] = select;
    for (const [i, slot] of PAD_SLOTS) {
      const d = down(i);
      if (d) any = true;
      if (d && !P.prev[i]) this.slotDown(slot, 'pad'); else if (!d && P.prev[i]) this.slotUp(slot, 'pad');
      P.prev[i] = d;
    }
    const b = down(1);
    if (b && !P.prev[1] && this.previewing) this.cancelEdge = true;
    P.prev[1] = b;
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

  pressDash() { if (this.enabled && !this.buildContext) this.pressed |= BTN.DASH; }
  press(bit) { if (this.enabled && !this.buildContext) { this.pressed |= bit; this.lastDevice = 'touch'; this.aimDevice = 'touch'; } }
  pressInteract() { if (this.enabled && !this.buildContext) { this.pressed |= BTN.INTERACT; this.interactEdge = true; } }

  consumeInteract() {
    const v = this.interactEdge;
    this.interactEdge = false;
    return v;
  }

  consumePresses() {
    const p = this.pressed;
    this.pressed = 0;
    return this.buildContext ? 0 : p;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
