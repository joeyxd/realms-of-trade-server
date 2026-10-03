// Mobile controls: floating joystick on the left half; on the right ATK (hold: the pistols keep firing),
// GUARDIA (hold), DASH, the action button and the weapon's Q / E / R. Q, E and R can be dragged to aim:
// a tap uses the auto-aim, dragging shows an aim line (the body turns to it) and releasing casts there;
// dragging back onto the button cancels.
import { BTN } from '../sim/systems/movement.js';

const LABELS = { sable: { atk: 'ATK', q: 'ESTOC', e: 'HOJA' }, pistolas: { atk: 'FUEGO', q: 'DESC', e: 'HUMO' } };

export class TouchControls {
  constructor(root, input) {
    this.root = root;
    this.input = input;
    root.innerHTML = `<div class="joy-zone"></div><div class="joy"><i></i></div><div class="aimline"><i></i></div>
      <button class="tbtn t-dash" aria-label="Dash"><span class="sweep"></span><span class="lbl">DASH</span><span class="pips"></span></button>
      <button class="tbtn t-act" aria-label="Interactuar">F</button>
      <button class="tbtn t-atk" aria-label="Atacar"><span class="lbl">ATK</span></button>
      <button class="tbtn t-parry" aria-label="Guardia (mantener)">GUARDIA</button>
      <button class="tbtn t-skill t-q" aria-label="Habilidad Q"><span class="sweep"></span><span class="lbl">Q</span></button>
      <button class="tbtn t-skill t-e" aria-label="Habilidad E"><span class="sweep"></span><span class="lbl">E</span></button>
      <button class="tbtn t-skill t-r" aria-label="Riposte"><span class="sweep"></span><span class="lbl">R</span></button>
      <button class="tbtn t-pot" aria-label="Poción"><span class="sweep"></span><span class="lbl">🧪</span><b class="cnt">0</b></button>`;
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
    root.querySelector('.t-pot').addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(BTN.POTION); });
    // Held buttons: a press now, the held bit while the finger stays down.
    const hold = (sel, bit) => {
      const b = root.querySelector(sel);
      let id = null;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; b.setPointerCapture(id); input.press(bit); input.touchHeld |= bit; });
      const up = (e) => { if (e.pointerId !== id) return; id = null; input.touchHeld &= ~bit; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    };
    hold('.t-atk', BTN.ATTACK);
    hold('.t-parry', BTN.GUARD);
    // Draggable skills.
    const line = root.querySelector('.aimline');
    const drag = (sel, bit) => {
      const b = root.querySelector(sel);
      let id = null, sx = 0, sy = 0, far = false;
      const show = (dx, dy, cancel) => {
        const r = b.getBoundingClientRect(), l = Math.hypot(dx, dy);
        line.style.display = 'block';
        line.style.left = r.left + r.width / 2 + 'px'; line.style.top = r.top + r.height / 2 + 'px';
        line.style.width = l + 'px';
        line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        line.classList.toggle('cancel', cancel);
      };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; sx = e.clientX; sy = e.clientY; far = false; b.setPointerCapture(id); input.aimDevice = 'touch'; });
      b.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const dx = e.clientX - sx, dy = e.clientY - sy, l = Math.hypot(dx, dy);
        if (l > 22) far = true;
        if (!far) return;
        const cancel = l < 22;
        input.touchAim = cancel ? null : { x: dx / l, y: -dy / l, k: Math.min(1, l / 150), release: false };
        show(dx, dy, cancel);
      });
      const up = (e, cancelled) => {
        if (e.pointerId !== id) return;
        id = null;
        line.style.display = 'none';
        const aimed = far && input.touchAim;
        if (cancelled || (far && !aimed)) { input.touchAim = null; return; }
        input.press(bit);
        if (aimed) input.touchAim.release = true; // used by the next command, then dropped
      };
      b.addEventListener('pointerup', (e) => up(e, false));
      b.addEventListener('pointercancel', (e) => up(e, true));
    };
    drag('.t-q', BTN.Q); drag('.t-e', BTN.E); drag('.t-r', BTN.R);
    this.atkLbl = root.querySelector('.t-atk .lbl');
    this.qBtn = root.querySelector('.t-q'); this.eBtn = root.querySelector('.t-e'); this.rBtn = root.querySelector('.t-r');
  }

  setWeapon(kind) {
    if (kind === this.weapon) return;
    this.weapon = kind;
    const L = LABELS[kind] || LABELS.sable;
    this.atkLbl.textContent = L.atk;
    this.qBtn.querySelector('.lbl').textContent = L.q;
    this.eBtn.querySelector('.lbl').textContent = L.e;
  }

  // q, e: cooldown left 0..1; rReady: the RIPOSTE meter is full.
  setCooldowns(q, e, rReady) {
    for (const [b, f] of [[this.qBtn, q], [this.eBtn, e]]) {
      const k = Math.round(Math.max(0, f) * 40);
      if (b.dataset.k === String(k)) continue;
      b.dataset.k = String(k);
      const deg = Math.round((1 - k / 40) * 360);
      b.querySelector('.sweep').style.background = k > 0 ? `conic-gradient(transparent 0deg ${deg}deg, rgba(10,6,24,0.6) ${deg}deg 360deg)` : '';
    }
    this.rBtn.classList.toggle('ready', !!rReady);
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

  // Potions (M4): how many, and the cooldown 0..1.
  setPotions(n, cd01 = 0) {
    const key = n + ':' + Math.round(cd01 * 20);
    if (key === this.potKey) return;
    this.potKey = key;
    const b = this.root.querySelector('.t-pot');
    b.querySelector('.cnt').textContent = String(n);
    b.classList.toggle('empty', n <= 0);
    const deg = Math.round((1 - cd01) * 360);
    b.querySelector('.sweep').style.background = cd01 > 0 ? `conic-gradient(transparent 0deg ${deg}deg, rgba(10,6,24,0.6) ${deg}deg 360deg)` : '';
  }
  // Locked skills (mastery): {q, e, r} → greyed out.
  setLocks(need) {
    for (const k of ['q', 'e', 'r']) this.root.querySelector('.t-' + k).classList.toggle('locked', !!need[k]);
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
}
