import { t, getLocale } from '../core/i18n.js';
import { BTN } from '../sim/systems/movement.js';
import { atlasIcon, escHtml } from './kit.js';

const GOODS = ['pescado', 'galleta', 'fruta', 'agua', 'ron', 'coco'];
const SKILLS = ['q', 'e', 'r', 'g'];
const defaults = () => [{ k: 'potion' }, { k: 'drink' }, ...Array(6).fill(null)];
export function sanitizeSlots(raw) {
  try {
    if (typeof raw === 'string') raw = JSON.parse(raw);
    const slots = raw?.slots ?? raw;
    if (!Array.isArray(slots) || slots.length !== 8) return defaults();
    return Array.from(slots, entry => {
      if (entry === null) return null;
      if (entry?.k === 'potion' || entry?.k === 'drink') return { k: entry.k };
      if (entry?.k === 'eat' && GOODS.includes(entry.good)) return { k: 'eat', good: entry.good };
      if (entry?.k === 'skill' && SKILLS.includes(entry.slot)) return { k: 'skill', slot: entry.slot };
      throw new Error('slot');
    });
  } catch { return defaults(); }
}
export function quickOptions(state = {}) {
  return [{ k: 'potion' }, ...(state.canteen != null ? [{ k: 'drink' }] : []),
    ...GOODS.filter(good => state.goods?.[good] >= 1).map(good => ({ k: 'eat', good })),
    ...SKILLS.filter(slot => slot !== 'g' || state.pearl).map(slot => ({ k: 'skill', slot }))];
}
const entryKey = entry => entry ? entry.good || entry.slot || entry.k : 'empty';
const label = entry => t('touch.quick.' + entryKey(entry));

export class QuickBar {
  constructor(root, { input, touch, freshwater, enabled = () => true }) {
    Object.assign(this, { input, touch, freshwater, enabled, state: {}, picking: null });
    this.doc = root.ownerDocument;
    this.root = this.doc.createElement('div'); this.root.className = 'touch-quick';
    this.root.innerHTML = '<div class="quick-row"></div><div class="quick-picker" hidden></div>';
    root.appendChild(this.root);
    this.row = this.root.querySelector('.quick-row'); this.picker = this.root.querySelector('.quick-picker');
    this.buttons = Array.from({ length: 8 }, (_, i) => {
      const b = this.doc.createElement('button'); b.type = 'button'; b.className = 'tbtn quick-slot';
      this.row.appendChild(b); this.bind(b, i); return b;
    });
    this.toggle = this.doc.createElement('button'); this.toggle.type = 'button'; this.toggle.className = 'tbtn quick-toggle';
    this.row.appendChild(this.toggle);
    this.toggle.addEventListener('click', () => { this.cancel(); this.open = !this.open; this.closePicker(); this.save(); this.refresh(); });
    this.doc.addEventListener('pointerdown', e => { if (!this.root.contains(e.target)) this.closePicker(); }, true);
    this.doc.defaultView?.addEventListener('blur', () => this.cancel());
    this.setCharacter('guest');
  }
  setCharacter(id) {
    const key = 'mn.quickbar.v1.' + (id || 'guest');
    if (key === this.key) return;
    this.cancel(); this.closePicker(); this.key = key;
    let stored = null;
    try { stored = JSON.parse(this.doc.defaultView.localStorage.getItem(key)); } catch { /* Storage is optional. */ }
    this.slots = sanitizeSlots(stored); this.open = stored?.open === true; this.refresh();
  }
  save() {
    try { this.doc.defaultView.localStorage.setItem(this.key, JSON.stringify({ slots: this.slots, open: this.open })); } catch { /* Storage is optional. */ }
  }
  skill(entry) {
    if (entry?.k !== 'skill') return null;
    const b = this.touch.btns[entry.slot];
    return { icon: b.querySelector('.ico').innerHTML, locked: b.hidden || b.classList.contains('locked'), kind: this.touch.kinds[entry.slot] };
  }
  icon(entry) {
    return entry?.k === 'skill' ? this.skill(entry).icon : entry ? atlasIcon(entry.k === 'eat' ? entry.good : entry.k === 'drink' ? 'agua' : 'potion') : '';
  }
  bind(b, i) {
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (this.gesture || !this.enabled()) return;
      const entry = this.slots[i], skill = this.skill(entry);
      const g = this.gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, b, entry, start: Date.now() };
      b.setPointerCapture(e.pointerId); b.classList.add('on'); this.closePicker();
      if (skill && !skill.locked && (skill.kind === 'ground' || skill.kind === 'charge')) {
        g.held = entry.slot; this.input.aimDevice = 'touch'; this.input.touchAim = null; this.input.slotDown(g.held, 'touch');
      }
      g.timer = setTimeout(() => {
        if (this.gesture !== g) return;
        this.cancelHeld(g); g.long = true;
        if (this.enabled()) this.openPicker(i);
      }, 500);
    });
    b.addEventListener('pointermove', e => {
      const g = this.gesture;
      if (g?.id === e.pointerId && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12) this.cancel();
    });
    b.addEventListener('pointerup', e => {
      const g = this.gesture; if (g?.id !== e.pointerId) return;
      const tap = !g.long && Date.now() - g.start < 500 && Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 12 && this.enabled();
      if (tap && !this.skill(g.entry)?.locked) {
        if (g.held) { this.input.slotUp(g.held, 'touch'); g.held = null; }
        else if (!g.entry) this.openPicker(i);
        else if (g.entry.k === 'potion') this.input.press(BTN.POTION);
        else if (g.entry.k === 'drink') this.freshwater.quickDrink();
        else if (g.entry.k === 'eat') this.freshwater.quickEat(g.entry.good);
        else { this.input.aimDevice = 'touch'; this.input.press(BTN[g.entry.slot.toUpperCase()]); }
      }
      this.cancel();
    });
    for (const ev of ['pointercancel', 'lostpointercapture']) b.addEventListener(ev, e => { if (this.gesture?.id === e.pointerId) this.cancel(); });
  }
  cancelHeld(g) {
    if (g.held) { this.input.cancelAim(); this.input.slotUp(g.held, 'touch'); g.held = null; }
  }
  cancel() {
    const g = this.gesture; if (!g) return;
    this.gesture = null; clearTimeout(g.timer); this.cancelHeld(g); g.b.classList.remove('on');
    try { g.b.releasePointerCapture(g.id); } catch { /* The browser may have released capture already. */ }
  }
  closePicker() { this.picking = null; this.picker.hidden = true; }
  openPicker(i) { this.picking = i; this.pickerKey = null; this.renderPicker(); }
  renderPicker() {
    if (this.picking == null) return;
    const options = quickOptions(this.state), key = JSON.stringify([getLocale(), options.map(e => [e, this.icon(e)]), !!this.slots[this.picking]]);
    if (key === this.pickerKey) return;
    this.pickerKey = key; this.picker.hidden = false;
    this.picker.setAttribute('aria-label', t('touch.quick.picker'));
    this.picker.replaceChildren();
    for (const entry of [...options, ...(this.slots[this.picking] ? [null] : [])]) {
      const b = this.doc.createElement('button'); b.type = 'button';
      b.innerHTML = `<span class="ico">${this.icon(entry)}</span><span>${escHtml(entry ? label(entry) : t('touch.quick.clear'))}</span>`;
      b.addEventListener('click', () => { this.slots[this.picking] = entry; this.closePicker(); this.save(); this.refresh(); });
      this.picker.appendChild(b);
    }
  }
  refresh() { this.renderKey = null; this.update(this.state); }
  update(state) {
    this.state = state;
    if (!this.enabled()) { this.cancel(); if (this.picking != null) this.closePicker(); }
    const views = this.slots.map(entry => {
      const skill = this.skill(entry), count = !entry || skill ? null : entry.k === 'potion' ? state.potions || 0 : entry.k === 'drink' ? state.canteen || 0 : state.goods?.[entry.good] || 0;
      return { icon: this.icon(entry), count, dim: skill ? skill.locked : entry && count < 1, label: label(entry) };
    });
    const key = JSON.stringify([getLocale(), this.open, views]);
    if (key !== this.renderKey) {
      this.renderKey = key; this.root.classList.toggle('expanded', this.open);
      this.row.setAttribute('aria-label', t('touch.quick.bar'));
      this.buttons.forEach((b, i) => {
        const v = views[i]; b.hidden = !this.open && i >= 4; b.classList.toggle('empty', !!v.dim);
        b.setAttribute('aria-label', v.label);
        b.innerHTML = `<span class="ico">${v.icon}</span>${this.slots[i]?.k === 'skill' ? `<span class="lbl">${escHtml(v.label)}</span>` : ''}${v.count == null ? '' : `<b class="cnt">${v.count}</b>`}`;
      });
      this.toggle.textContent = t(this.open ? 'touch.quick.minus' : 'touch.quick.plus');
      this.toggle.setAttribute('aria-label', t(this.open ? 'touch.quick.fold' : 'touch.quick.expand'));
      this.toggle.setAttribute('aria-expanded', String(this.open));
    }
    this.renderPicker();
  }
}
