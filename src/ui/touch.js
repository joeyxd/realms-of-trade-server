// Mobile controls: floating joystick on the left half; ATK, PARRY, DASH, R and ACTION buttons on the right.
import { BTN } from '../sim/systems/movement.js';

export class TouchControls {
  constructor(root, input) {
    this.root = root;
    this.input = input;
    root.innerHTML = `<div class="joy-zone"></div><div class="joy"><i></i></div>
      <button class="tbtn t-dash" aria-label="Dash"><span class="sweep"></span><span class="lbl">DASH</span><span class="pips"></span></button>
      <button class="tbtn t-act" aria-label="Interactuar">F</button>
      <button class="tbtn t-atk" aria-label="Atacar">ATK</button>
      <button class="tbtn t-parry" aria-label="Parry">PARRY</button>
      <button class="tbtn t-r" aria-label="Riposte">R</button>`;
    const zone = root.querySelector('.joy-zone'), joy = root.querySelector('.joy'), knob = joy.querySelector('i');
    let pid = null, ox = 0, oy = 0;
    const R = 52;
    zone.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId; ox = e.clientX; oy = e.clientY;
      joy.style.display = 'block';
      joy.style.left = ox + 'px'; joy.style.top = oy + 'px';
      knob.style.transform = '';
      zone.setPointerCapture(pid);
      input.joy.active = true; input.joy.x = 0; input.joy.y = 0;
      input.lastDevice = 'touch'; input.aimDevice = 'touch';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const dead = 0.12;
      const m = Math.min(1, l / R);
      const k = m < dead ? 0 : (m - dead) / (1 - dead);
      input.joy.x = l > 0 ? (dx / Math.max(l, 1e-6)) * k : 0;
      input.joy.y = l > 0 ? (-dy / Math.max(l, 1e-6)) * k : 0;
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      joy.style.display = 'none';
      input.joy.active = false; input.joy.x = 0; input.joy.y = 0;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    root.querySelector('.t-dash').addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressDash(); });
    root.querySelector('.t-act').addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressInteract(); });
    root.querySelector('.t-atk').addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(BTN.ATTACK); });
    root.querySelector('.t-parry').addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(BTN.PARRY); });
    root.querySelector('.t-r').addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(BTN.R); });
  }
  setDash(charges, max, recharge01) {
    if (!this.dashBtn) {
      this.dashBtn = this.root.querySelector('.t-dash');
      this.pips = this.dashBtn.querySelector('.pips');
      this.sweep = this.dashBtn.querySelector('.sweep');
      this.lastKey = '';
    }
    const key = charges + '/' + max;
    if (key !== this.lastKey) {
      this.pips.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < charges ? '' : 'empty'}"></i>`).join('');
      this.lastKey = key;
    }
    const deg = charges < max ? Math.round(recharge01 * 360) : 360;
    this.sweep.style.background = deg >= 360 ? '' : `conic-gradient(transparent 0deg ${deg}deg, rgba(10,6,24,0.55) ${deg}deg 360deg)`;
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
}
