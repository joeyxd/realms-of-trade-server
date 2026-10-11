import { t, text as ltext, rich, attr, setText, setDataText, translateData, dataText, getLocale, onLocaleChange, initI18n } from '../core/i18n.js';
// Mobile controls (M4.6): tinted-glass buttons in a thumb arc at the bottom right, one colour per function.
// A floating joystick on the left half; on the right ATK (hold: the pistols keep firing), GUARDIA (hold), DASH,
// the contextual action button and the weapon's Q / E / R. Q, E and R can be dragged to aim: a tap uses the
// auto-aim, dragging shows an aim line (the body turns to it) and releasing casts there; dragging back onto
// the button cancels. Pointer events arrive in screen coordinates: the joystick and the aim line are placed
// with stage.toLocal and every drag delta goes through stage.vec (the stage may be rotated).
// Size: --tb = the setting (0.85 / 1 / 1.18) x auto (follows the stage height), set on the root.
import { BTN } from '../sim/systems/movement.js';
import { stage } from './stage.js';

// Icons: 24x24 line art. Every path is drawn twice (ink under-stroke, white stroke) so it reads on any
// background. Styled in hud.css (`#touch .tbtn svg`).
const ico = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true"><g class="u">${p}</g><g class="f">${p}</g></svg>`;
export const ICONS = {
  comet: ico('<circle cx="16" cy="16" r="6"/><path d="M2 3l12 5M3 8l6 4M8 2l6 6"/><circle cx="16" cy="16" r="2"/>'),
  iceanchor: ico('<path d="M12 2.5v19M4 7l16 11M20 7L4 18"/><path d="M5 18l-2 3 5-.5M19 18l2 3-5-.5M12 2.5L9.5 6h5z"/>'),
  mastbolt: ico('<path d="M14.5 2.5L5.5 14h6l-1 8 8-12h-6z"/><path d="M3 6l2 1M20 4l1-2M20 20l2 1"/>'),
  inkcloud: ico('<path d="M6 18a4 4 0 0 1-.3-8A6.3 6.3 0 0 1 18 8a4.5 4.5 0 0 1 .8 9H6z"/><path d="M7 14c1.8-1.7 2.8 1.7 4.6 0s2.8 1.7 4.6 0 2.5 1 3.8-.4"/>'),
  sword: ico('<path d="M20 4L11 13"/><path d="M7.5 11.5l5 5"/><path d="M10 14L5.5 18.5"/><path d="M4.5 19.5h.01"/>'),
  pistol: ico('<path d="M3 8h17v4h-7.5L11 19H7l1.5-7H3z"/><path d="M4.5 8V5.5H7"/>'),
  shield: ico('<path d="M12 3l8 3v6c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6z"/><path d="M12 7.5v9"/>'),
  dash: ico('<path d="M13 5.5l6.5 6.5-6.5 6.5"/><path d="M3.5 8.5h6M2.5 12.5h8M4.5 16.5h6"/>'),
  thrust: ico('<path d="M4 20L19 5"/><path d="M11 5h8v8"/><path d="M6.5 13.5l4 4"/>'),
  crescent: ico('<path d="M4.5 18C7.5 9 15 4.5 21 4.5c-4.5 3-7.5 7.5-8.2 13.5-2.2-1.5-5.2-1.5-8.3 0z"/><path d="M2.5 13h4"/>'),
  spiral: ico('<path d="M12 12a1 1 0 0 1 1-1 2 2 0 0 1 2 2 3.5 3.5 0 0 1-3.5 3.5 5 5 0 0 1-5-5 6.5 6.5 0 0 1 6.5-6.5 8 8 0 0 1 8 8"/>'),
  burst: ico('<circle cx="6.5" cy="12" r="2.5"/><path d="M11.5 12L21 5M11.5 12H22M11.5 12L21 19"/>'),
  cloud: ico('<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 18z"/>'),
  rain: ico('<path d="M6.5 3.5L5 8.5M12 2.5L10.5 7.5M17.5 3.5L16 8.5M9.5 10.5L8 15.5M15 10.5L13.5 15.5"/><ellipse cx="12" cy="20" rx="8" ry="2.5"/>'),
  flask: ico('<path d="M9 3h6"/><path d="M10 3v6L5 18.5a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7.5 15h9"/>'),
  talk: ico('<path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 10.5h.01M12 10.5h.01M16 10.5h.01"/>'),
  chest: ico('<path d="M4 11V9.5A4.5 4.5 0 0 1 8.5 5h7A4.5 4.5 0 0 1 20 9.5V11z"/><path d="M4 11v8h16v-8"/><path d="M12 11v4"/>'),
  axe: ico('<path d="m5 21 10-16 3 2L8 23z"/><path d="M13 4 8 2 3 8l7 5 5-6"/><path d="m4 8 6 4"/>'),
  mine: ico('<path d="m5 21 9-15 2 1-9 15z"/><path d="M3 9c4-7 12-8 18-3l-1 2c-5-3-10-2-14 2z"/><path d="m18 17 2-2 2 3-2 3-3-1z"/>'),
  swap: ico('<path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/>'),
  rune: ico('<path d="M8 3v18M8 9l9-5M8 15l9-5"/>'),
  ship: ico('<path d="M3 16h18l-3 4H6z"/><path d="M12 3v13"/><path d="M12 4.5l7 9.5h-7z"/><path d="M10.5 7L5 14h5.5"/>'),
  spout: ico('<path d="M7.5 3c3 .8 6 .8 9 0-1 3-2.5 4.6-3 7 .7 2.4.7 4.8 0 7.2h-3c-.7-2.4-.7-4.8 0-7.2-.5-2.4-2-4-3-7z"/><path d="M2.5 21c2-1.5 4-1.5 6.3 0s4.3 1.5 6.4 0 4.3-1.5 6.3 0"/>'),
  leap: ico('<path d="M3 20.5C5.5 8.5 16 6.5 21 18.5" stroke-dasharray="2.4 2.4"/><path d="M9.5 3.5h4.5v5l3.5 1.5v3h-8z"/>'),
  helm: ico('<circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="1.7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8"/>'),
  lock: ico('<path d="M5.5 11h13v9.5h-13z"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/><path d="M12 15v2"/>'),
};

// What a skill in Q / E looks like on its button: [icon, label] (the arts as in KITS; the tattoos, M4.7).
const SKILL_FACE = {
  lunge: ['thrust', 'touch.lunge'], wave: ['crescent', 'touch.blade'], blast: ['burst', 'touch.blast'], blink: ['cloud', 'touch.smoke'],
  tromba: ['spout', 'touch.spout'], leap: ['leap', 'touch.board'], wheel: ['helm', 'touch.wheel'],
};
// What each weapon puts on the ATK / Q / E / R buttons: [icon, label].
const KITS = {
  sable: { atk: ['sword', 'ATK'], q: ['thrust', 'touch.lunge'], e: ['crescent', 'touch.blade'], r: ['spiral', 'touch.storm'] },
  pistolas: { atk: ['pistol', 'touch.fire'], q: ['burst', 'touch.blast'], e: ['cloud', 'touch.smoke'], r: ['rain', 'touch.rain'] },
};

const face = (icon, label) => `<span class="ico">${ICONS[icon]}</span>${label == null ? '' : `<span class="lbl">${label?.startsWith('touch.') ? ltext(label) : label}</span>`}`;
const BUZZ = { 't-dash': 9, 't-pot': 12, 't-act': 7, 't-parry': 6 }; // ms
const SWEEP_INK = 'rgb(10 6 24 / 0.58)';
const cone = (deg) => `conic-gradient(transparent 0deg ${deg}deg, ${SWEEP_INK} ${deg}deg 360deg)`;

export class TouchControls {
  constructor(root, input) {
    this.root = root;
    this.input = input;
    this.user = 1; this.tb = 1; this.locked = {}; this.lbls = {};
    root.innerHTML = `<div class="joy-zone"></div><div class="joy-rest"></div><div class="joy"><i></i></div><div class="aimline"><i></i></div>
      <div class="t-cluster">
        <button class="tbtn t-atk" data-l10n-aria-label="touch.attack" aria-label="${attr('touch.attack')}">${face('sword', 'ATK')}</button>
        <button class="tbtn t-dash" aria-label="Dash"><span class="sweep"></span>${face('dash', 'DASH')}<span class="pips"></span></button>
        <button class="tbtn t-parry" data-l10n-aria-label="touch.guard" aria-label="${attr('touch.guard')}">${face('shield', 'touch.guardFace')}</button>
        <button class="tbtn t-skill t-q" data-l10n-aria-label="touch.q" aria-label="${attr('touch.q')}"><span class="sweep"></span>${face('thrust', 'touch.lunge')}</button>
        <button class="tbtn t-skill t-e" data-l10n-aria-label="touch.e" aria-label="${attr('touch.e')}"><span class="sweep"></span>${face('crescent', 'touch.blade')}</button>
        <button class="tbtn t-skill t-r" data-l10n-aria-label="touch.r" aria-label="${attr('touch.r')}"><span class="sweep"></span>${face('spiral', 'touch.storm')}</button>
        <button class="tbtn t-skill t-g" data-l10n-aria-label="touch.pearl" aria-label="${attr('touch.pearl')}" hidden><span class="sweep"></span>${face('comet', 'touch.comet')}</button>
        <button class="tbtn t-pot" data-l10n-aria-label="touch.potion" aria-label="${attr('touch.potion')}"><span class="sweep"></span>${face('flask', null)}<b class="cnt">0</b></button>
        <button class="tbtn t-act" data-l10n-aria-label="touch.interact" aria-label="${attr('touch.interact')}" hidden>${face('talk', '')}</button>
      </div>`;
    this.update();
    stage.onChange(() => this.update());
    // Pressed look: `.on` from pointerdown until the finger lifts (or the touch is cancelled).
    // Haptics: a short tick on the buttons that are not spammed (ATK is not), a stronger one when a skill casts.
    this.haptics = true;
    for (const b of root.querySelectorAll('.tbtn')) {
      const off = () => b.classList.remove('on');
      const ms = Object.entries(BUZZ).find(([c]) => b.classList.contains(c))?.[1] || 0;
      b.addEventListener('pointerdown', (e) => { b.classList.add('on'); if (ms) this.buzz(ms); try { b.setPointerCapture(e.pointerId); } catch { /* synthetic id */ } });
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    }
    const zone = root.querySelector('.joy-zone'), joy = root.querySelector('.joy'), knob = joy.querySelector('i');
    let pid = null, ox = 0, oy = 0; // ox, oy: where the thumb landed (screen px)
    zone.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId; ox = e.clientX; oy = e.clientY;
      const at = stage.toLocal(ox, oy); // the base sits at the thumb, in stage px (the zone is the stage's left half)
      joy.style.display = 'block'; root.classList.add('stick');
      joy.style.left = at.x + 'px'; joy.style.top = at.y + 'px';
      knob.style.transform = '';
      zone.setPointerCapture(pid);
      input.joy.active = true; input.joy.x = 0; input.joy.y = 0;
      input.lastDevice = 'touch'; input.aimDevice = 'touch';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      let { x: dx, y: dy } = stage.vec(e.clientX - ox, e.clientY - oy);
      const R = 52 * this.tb, l = Math.hypot(dx, dy);
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
      joy.style.display = 'none'; root.classList.remove('stick');
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
    // Draggable skills. dir / self: the press goes out on release, aimed by the drag (or auto-aimed on a tap). An area
    // (ground) and a charge go through the aim controller (client/aimcast.js) as a held slot: the area marker follows
    // the drag (its length = the distance) and shows while the finger is down, a charge starts on touch; releasing
    // casts / throws, dragging back to the button cancels an area.
    const line = root.querySelector('.aimline');
    this.kinds = { q: 'dir', e: 'dir', r: 'self', g: 'dir' };
    const drag = (sel, bit, slot) => {
      const b = root.querySelector(sel);
      let id = null, sx = 0, sy = 0, far = false, held = false;
      const show = (dx, dy, cancel) => {
        const r = b.getBoundingClientRect(), l = Math.hypot(dx, dy);
        const c = stage.toLocal(r.left + r.width / 2, r.top + r.height / 2); // the rect is in screen px
        line.style.display = 'block';
        line.style.left = c.x + 'px'; line.style.top = c.y + 'px';
        line.style.width = l + 'px';
        line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        line.classList.toggle('cancel', cancel);
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); id = e.pointerId; sx = e.clientX; sy = e.clientY; far = false; b.setPointerCapture(id); input.aimDevice = 'touch';
        const k = this.kinds[slot];
        held = (k === 'ground' || k === 'charge') && !b.classList.contains('locked');
        if (held) { input.touchAim = null; input.slotDown(slot, 'touch'); if (k === 'charge') this.buzz(12); }
      });
      b.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const { x: dx, y: dy } = stage.vec(e.clientX - sx, e.clientY - sy), l = Math.hypot(dx, dy);
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
        if (held) {
          held = false;
          const aimedH = far && input.touchAim;
          if (this.kinds[slot] === 'ground' && (cancelled || (far && !aimedH))) input.cancelAim();
          else this.buzz(bit === BTN.R ? 24 : 12);
          input.slotUp(slot, 'touch');
          if (aimedH) input.touchAim.release = true;
          else input.touchAim = null;
          return;
        }
        const aimed = far && input.touchAim;
        if (cancelled || (far && !aimed)) { input.touchAim = null; return; }
        input.press(bit);
        if (!b.classList.contains('locked')) this.buzz(bit === BTN.R ? 24 : 12);
        if (aimed) input.touchAim.release = true; // used by the next command, then dropped
      };
      b.addEventListener('pointerup', (e) => up(e, false));
      b.addEventListener('pointercancel', (e) => up(e, true));
    };
    drag('.t-q', BTN.Q, 'q'); drag('.t-e', BTN.E, 'e'); drag('.t-r', BTN.R, 'r');
    drag('.t-g', BTN.G, 'g');
    const q = (sel) => root.querySelector(sel);
    this.atkBtn = q('.t-atk'); this.qBtn = q('.t-q'); this.eBtn = q('.t-e'); this.rBtn = q('.t-r');
    this.potBtn = q('.t-pot'); this.actBtn = q('.t-act');
    this.gBtn = q('.t-g');
    this.btns = { atk: this.atkBtn, q: this.qBtn, e: this.eBtn, r: this.rBtn, g: this.gBtn };
  }

  // --tb = the user's setting x an automatic factor that follows the stage height (small phones shrink, tall grow).
  update() {
    const h = stage.h || 420, auto = Math.min(1.15, Math.max(0.78, h / 420));
    // The arc is 18 + 310 tb tall: on a short stage it must not climb into the top-right HUD buttons (top 54 px).
    this.tb = Math.min(this.user * auto, Math.max(0.78, (h - 72) / 310));
    this.root.style.setProperty('--tb', this.tb.toFixed(3));
  }

  // The settings' touchSize (0.85 / 1 / 1.18), live.
  setHaptics(on) { this.haptics = !!on; }
  buzz(ms) { if (this.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* blocked */ } }

  setScale(v) {
    this.user = Math.min(1.4, Math.max(0.6, +v || 1));
    this.update();
  }

  // Icon + label of a button; a locked skill shows the padlock in place of its label.
  setFace(key, [icon, label]) {
    const b = this.btns[key];
    if (this.lbls[key] === getLocale() + icon + label) return;
    this.lbls[key] = getLocale() + icon + label;
    b.querySelector('.ico').innerHTML = ICONS[icon];
    b.querySelector('.lbl').innerHTML = this.locked[key] ? ICONS.lock : label.startsWith('touch.') ? ltext(label) : label;
    b.querySelector('.lbl').dataset.t = label;
  }

  setWeapon(kind) {
    if (kind + getLocale() === this.weapon) return;
    this.weapon = kind + getLocale();
    const K = KITS[kind] || KITS.sable;
    for (const k of ['atk', 'r']) this.setFace(k, K[k]);
  }

  // What Q / E hold (M4.7): ids; «Parpadeo» (the Abordaje's form A) gets its own label.
  setSlots(q, e, qForm = 0, eForm = 0) {
    const face = (id, form) => (id === 'leap' && form === 1 ? ['leap', 'touch.blink'] : SKILL_FACE[id] || SKILL_FACE.lunge);
    this.setFace('q', face(q, qForm));
    this.setFace('e', face(e, eForm));
  }

  // A quick ring pulse when something comes off cooldown.
  setPearl(id, cd01) {
    this.gBtn.hidden = id === 'none';
    this.kinds.g = id === 'iceanchor' || id === 'inkcloud' ? 'ground' : id === 'mastbolt' ? 'charge' : 'dir';
    if (this.pearlFace !== id + getLocale()) {
      this.pearlFace = id + getLocale();
      const icon = id === 'inkcloud' ? 'inkcloud' : id === 'iceanchor' ? 'iceanchor' : id === 'mastbolt' ? 'mastbolt' : 'comet';
      const label = id === 'inkcloud' ? t('touch.cloud') : id === 'iceanchor' ? t('touch.anchor') : id === 'mastbolt' ? t('touch.bolt') : t('touch.comet');
      this.gBtn.querySelector('.ico').innerHTML = ICONS[icon];
      this.gBtn.querySelector('.lbl').textContent = label;
      this.gBtn.setAttribute('aria-label', id === 'inkcloud' ? translateData('Nube de tinta') : id === 'iceanchor' ? translateData('Ancla de hielo') : id === 'mastbolt' ? translateData('Rayo de mástil') : translateData('Cometa'));
      this.gBtn.style.setProperty('--c', id === 'inkcloud' ? '170 112 237' : id === 'iceanchor' ? '131 221 255' : id === 'mastbolt' ? '255 223 59' : '255 121 59');
    }
    const k = Math.round(Math.max(0, Math.min(1, cd01)) * 40);
    if (this.gBtn.dataset.k === String(k)) return;
    const was = +this.gBtn.dataset.k || 0;
    this.gBtn.dataset.k = String(k);
    this.gBtn.querySelector('.sweep').style.background = k > 0 ? cone(Math.round((1 - k / 40) * 360)) : '';
    if (was > 0 && !k) this.flash(this.gBtn);
  }

  flash(b) {
    b.classList.remove('ready-flash');
    void b.offsetWidth; // restart the animation
    b.classList.add('ready-flash');
    clearTimeout(b._ft);
    b._ft = setTimeout(() => b.classList.remove('ready-flash'), 350);
  }

  // q, e: cooldown left 0..1; rReady: the RIPOSTE meter is full.
  setCooldowns(q, e, rReady) {
    for (const [b, f] of [[this.qBtn, q], [this.eBtn, e]]) {
      const k = Math.round(Math.max(0, f) * 40);
      if (b.dataset.k === String(k)) continue;
      const was = +b.dataset.k || 0;
      b.dataset.k = String(k);
      b.querySelector('.sweep').style.background = k > 0 ? cone(Math.round((1 - k / 40) * 360)) : '';
      if (was > 0 && k === 0) this.flash(b);
    }
    this.rBtn.classList.toggle('ready', !!rReady);
  }

  setDash(charges, max, recharge01) {
    if (!this.dashBtn) {
      this.dashBtn = this.root.querySelector('.t-dash');
      this.pips = this.dashBtn.querySelector('.pips');
      this.sweep = this.dashBtn.querySelector('.sweep');
      this.lastKey = ''; this.lastCharges = charges;
    }
    const key = charges + '/' + max;
    if (key !== this.lastKey) {
      this.pips.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < charges ? '' : 'empty'}"></i>`).join('');
      this.lastKey = key;
      if (charges > this.lastCharges) this.flash(this.dashBtn); // a charge is back
      this.lastCharges = charges;
    }
    const deg = charges < max ? Math.round(recharge01 * 360) : 360;
    this.sweep.style.background = deg >= 360 ? '' : cone(deg);
  }

  // Potions (M4): how many, and the cooldown 0..1.
  setPotions(n, cd01 = 0) {
    const key = n + ':' + Math.round(cd01 * 20);
    if (key === this.potKey) return;
    const was = this.potCd > 0;
    this.potKey = key; this.potCd = cd01;
    const b = this.potBtn;
    b.querySelector('.cnt').textContent = String(n);
    b.classList.toggle('empty', n <= 0);
    b.querySelector('.sweep').style.background = cd01 > 0 ? cone(Math.round((1 - cd01) * 360)) : '';
    if (was && cd01 <= 0 && n > 0) this.flash(b);
  }

  // Locked skills (mastery): {q, e, r} → greyed out, with the padlock instead of the label.
  setLocks(need) {
    for (const k of ['q', 'e', 'r']) {
      const on = !!need[k];
      if (on === !!this.locked[k]) continue;
      this.locked[k] = on;
      const b = this.btns[k], l = b.querySelector('.lbl');
      b.classList.toggle('locked', on);
      l.innerHTML = on ? ICONS.lock : l.dataset.t?.startsWith('touch.') ? ltext(l.dataset.t) : (l.dataset.t || '');
    }
  }

  // The contextual button: null (hidden) or { verb, icon } (talk, open, swap...); it pops in when it appears.
  setAction(a) {
    const b = this.actBtn, key = a ? a.icon + '|' + a.verb : '';
    if (key === this.actKey) return;
    const was = this.actKey;
    this.actKey = key;
    if (!a) { b.hidden = true; b.classList.remove('on', 'pop'); return; }
    b.querySelector('.ico').innerHTML = ICONS[a.icon] || '';
    b.querySelector('.lbl').textContent = a.verb;
    b.setAttribute('aria-label', a.verb);
    if (!was) { b.hidden = false; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
}
