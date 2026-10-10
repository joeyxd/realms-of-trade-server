import { t, onLocaleChange, translateData } from '../core/i18n.js';

const DEAD_ZONE = 0.12;
const ICONS = Object.freeze({
  wind: [{ d: 'M3 8h11c4 0 4-5 1-5-2 0-3 1-3 2' }, { d: 'M3 12h16c3 0 3 5 0 5-2 0-3-1-3-2' }, { d: 'M3 16h6' }],
  capture: [{ d: 'M4 12h5l3-4 3 8 3-4h2' }, { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } }],
  cargo: [{ d: 'm4 8 8-4 8 4v9l-8 4-8-4z' }, { d: 'm4 8 8 4 8-4M12 12v9M8 6l8 4' }],
  jettison: [{ d: 'M4 7h16M9 7V4h6v3m-9 0 1 13h8l1-13M10 11v5m4-5v5' }],
  map: [{ d: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15' }],
  crew: [{ tag: 'circle', attrs: { cx: '9', cy: '8', r: '3' } }, { tag: 'circle', attrs: { cx: '17', cy: '9', r: '2' } },
    { d: 'M3 20c0-4 2-6 6-6s6 2 6 6m0-5c3 0 5 1 6 4' }],
  center: [{ tag: 'circle', attrs: { cx: '12', cy: '12', r: '8' } }, { tag: 'circle', attrs: { cx: '12', cy: '12', r: '2' } },
    { d: 'M12 1v3m0 16v3M1 12h3m16 0h3' }],
  helm: [{ d: 'M3 12a9 9 0 0 1 18 0M12 3v9l6 4M4 16l3-2m13 2-3-2' }],
});

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function makeElement(doc, tag, className) {
  const element = doc.createElement(tag);
  element.className = className;
  return element;
}

function createIcon(doc, name) {
  const svg = doc.createElementNS?.('http://www.w3.org/2000/svg', 'svg') || doc.createElement('svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of ICONS[name] || ICONS.helm) {
    const element = doc.createElementNS?.('http://www.w3.org/2000/svg', shape.tag || 'path') || doc.createElement(shape.tag || 'path');
    if (shape.d) element.setAttribute('d', shape.d);
    for (const [key, value] of Object.entries(shape.attrs || {})) element.setAttribute(key, value);
    element.setAttribute('fill', 'none'); element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', '1.7'); element.setAttribute('stroke-linecap', 'round');
    element.setAttribute('stroke-linejoin', 'round'); svg.appendChild(element);
  }
  return svg;
}

/** Reusable, touch-first helm controls. Pointer state is local to this instance. */
export class TouchHelm {
  constructor(container, { onMove = () => {}, onLook = () => {}, onAction = () => {}, onGesture = () => {},
    actions = [], enabled = true, toLocal = null, layout = 'legacy', storageKey = null } = {}) {
    const doc = container?.ownerDocument;
    if (!container?.appendChild || !doc?.createElement) throw new TypeError('TouchHelm requires a DOM container');
    for (const callback of [onMove, onLook, onAction, onGesture]) if (typeof callback !== 'function')
      throw new TypeError('TouchHelm callbacks must be functions');
    this.container = container; this.doc = doc; this.callbacks = { onMove, onLook, onAction, onGesture };
    this.toLocal = typeof toLocal === 'function' ? toLocal : (x, y) => ({ x, y });
    this.layout = layout === 'reference' ? 'reference' : 'legacy'; this.storageKey = typeof storageKey === 'string' ? storageKey : null;
    this.bindings = [null, null, null]; this.preferredBindings = [null, null, null]; this.catalog = new Map(); this.pickerSlot = null; this.catalogSignature = ''; this.catalogIdsSignature = '';
    this.enabled = !!enabled; this.disposed = false; this.pointers = new Map(); this.sticks = new Map(); this.buttons = new Map();
    this.listeners = []; this.wrapper = makeElement(doc, 'div', 'naval-touch');
    if (this.layout === 'reference') this.wrapper.setAttribute('data-layout', 'reference');
    this.wrapper.setAttribute('aria-label', t('systems.touch.navControls'));
    this.wrapper.setAttribute('data-enabled', this.enabled ? 'true' : 'false');
    this.container.appendChild(this.wrapper);
    this.buildStick('move', t('systems.touch.move')); this.buildStick('look', t('systems.touch.camera'));
    this.actionRow = makeElement(doc, 'div', 'naval-touch-actions');
    this.actionRow.setAttribute('aria-label', t('systems.touch.navActions')); this.wrapper.appendChild(this.actionRow);
    this.slotButtons = [];
    if (this.layout === 'reference') this.buildReferenceInstrument();
    this.setActions(actions);
    this.listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden || this.doc.visibilityState === 'hidden') this.clear(); });
    const view = doc.defaultView || globalThis.window;
    if (view?.addEventListener) for (const type of ['blur', 'pagehide']) this.listen(view, type, () => this.clear());
    this.listen(this.doc, 'pointerup', (event) => this.finishPointer(event, true));
    this.listen(this.doc, 'pointercancel', (event) => this.finishPointer(event, false));
    this.listen(this.doc, 'lostpointercapture', (event) => this.finishPointer(event, false));
    this.listen(this.doc, 'pointermove', (event) => this.moveActionPointer(event));
    this.unsubscribeLocale = onLocaleChange(() => this.refreshLocale());
  }

  refreshLocale() {
    this.wrapper.setAttribute('aria-label', t('systems.touch.navControls'));
    this.actionRow.setAttribute('aria-label', t('systems.touch.navActions'));
    for (const [name, stick] of this.sticks) {
      const label = t(name === 'move' ? 'systems.touch.move' : 'systems.touch.camera');
      stick.pad.setAttribute('aria-label', t(name === 'move' ? 'systems.touch.moveHelp' : 'systems.touch.cameraHelp'));
      stick.pad.querySelector('.naval-touch-cue').textContent = name === 'move' ? t('systems.touch.moveCue') : t('systems.touch.cameraCue');
      stick.pad.querySelector('.naval-touch-caption').textContent = name === 'move' && this.layout === 'reference' ? t('systems.touch.helm') : label.toUpperCase();
    }
    for (const record of this.buttons.values()) {
      const label = translateData(record.action.label);
      record.button.setAttribute('aria-label', label); record.button.setAttribute('title', label);
      const text = record.button.querySelector?.('.naval-touch-action-label'); if (text) text.textContent = label;
    }
    if (this.instrument) {
      this.instrument.setAttribute('aria-label', t('systems.touch.instrument'));
      this.picker.setAttribute('aria-label', t('systems.touch.chooseSkill'));
      this.picker.querySelector('.naval-touch-picker-title').textContent = t('systems.touch.chooseSkill');
      this.picker.querySelector('.naval-touch-picker-cancel').textContent = t('systems.touch.cancel');
      this.renderBindings();
      this.refreshPickerOptions();
    }
  }

  listen(target, type, callback) { target.addEventListener(type, callback); this.listeners.push([target, type, callback]); }

  buildStick(name, label) {
    const pad = makeElement(this.doc, 'div', `naval-touch-stick naval-touch-stick-${name}`);
    const accessibleLabel = name === 'move' ? t('systems.touch.moveHelp') : t('systems.touch.cameraHelp');
    pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', accessibleLabel); pad.setAttribute('data-stick', name);
    const ring = makeElement(this.doc, 'div', 'naval-touch-ring'); ring.setAttribute('aria-hidden', 'true');
    const puck = makeElement(this.doc, 'div', 'naval-touch-puck'); puck.setAttribute('aria-hidden', 'true');
    const cue = makeElement(this.doc, 'span', `naval-touch-cue naval-touch-cue-${name}`);
    cue.textContent = name === 'move' ? t('systems.touch.moveCue') : t('systems.touch.cameraCue'); cue.setAttribute('aria-hidden', 'true');
    const caption = makeElement(this.doc, 'span', 'naval-touch-caption'); caption.textContent = name === 'move' ? t('systems.touch.move').toUpperCase() : t('systems.touch.camera').toUpperCase();
    if (this.layout === 'reference' && name === 'move') caption.textContent = t('systems.touch.helm').toUpperCase();
    pad.appendChild(ring); pad.appendChild(puck);
    if (this.layout === 'reference') {
      const icon = this.createReferencePadIcon(name); icon.setAttribute('class', `naval-touch-decal naval-touch-pad-icon naval-touch-pad-icon-${name}`);
      pad.appendChild(icon);
      const arrows = makeElement(this.doc, 'span', `naval-touch-pad-arrows naval-touch-pad-arrows-${name}`);
      arrows.textContent = name === 'move' ? '↑   ↓' : '↔'; arrows.setAttribute('aria-hidden', 'true'); pad.appendChild(arrows);
    }
    pad.appendChild(cue); pad.appendChild(caption); this.wrapper.appendChild(pad);
    const stick = { name, pad, puck, value: { x: 0, y: 0 }, pointerId: null, origin: null, radius: 38 };
    this.sticks.set(name, stick);
    this.listen(pad, 'pointerdown', (event) => this.startStick(event, stick));
    this.listen(pad, 'pointermove', (event) => this.moveStick(event, stick));
    return stick;
  }

  createReferencePadIcon(name) {
    const svg = this.doc.createElementNS?.('http://www.w3.org/2000/svg', 'svg') || this.doc.createElement('svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs) => { const node = this.doc.createElementNS?.('http://www.w3.org/2000/svg', tag) || this.doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); svg.appendChild(node); };
    if (name === 'move') {
      add('circle', { cx: 50, cy: 50, r: 44, fill: '#101817', stroke: '#050a09', 'stroke-width': 3 });
      add('circle', { cx: 50, cy: 50, r: 40, fill: '#174e52', stroke: '#d4ae69', 'stroke-width': 5 });
      add('circle', { cx: 50, cy: 50, r: 29, fill: '#8c5634', stroke: '#e0bf80', 'stroke-width': 4 });
      add('circle', { cx: 50, cy: 50, r: 9, fill: '#d8b36f', stroke: '#101817', 'stroke-width': 3 });
      const spokes = [[50, 12, 50, 41], [50, 59, 50, 88], [12, 50, 41, 50], [59, 50, 88, 50], [23, 23, 43, 43], [57, 57, 77, 77], [77, 23, 57, 43], [43, 57, 23, 77]];
      for (const [x1, y1, x2, y2] of spokes) add('path', { d: `M${x1} ${y1}L${x2} ${y2}`, stroke: '#101817', 'stroke-width': 9, 'stroke-linecap': 'round' });
      for (const [x1, y1, x2, y2] of spokes) add('path', { d: `M${x1} ${y1}L${x2} ${y2}`, stroke: '#dfbd7a', 'stroke-width': 5, 'stroke-linecap': 'round' });
    } else {
      add('circle', { cx: 50, cy: 50, r: 42, fill: '#123e47', stroke: '#d6b26c', 'stroke-width': 5 });
      add('path', { d: 'M18 42h12l6-8h28l6 8h12v29H18z', fill: 'none', stroke: '#e2c783', 'stroke-width': 5, 'stroke-linejoin': 'round' });
      add('circle', { cx: 50, cy: 56, r: 10, fill: 'none', stroke: '#e2c783', 'stroke-width': 5 });
    }
    return svg;
  }

  buildReferenceInstrument() {
    this.instrument = makeElement(this.doc, 'div', 'naval-touch-instrument');
    this.instrument.setAttribute('aria-label', t('systems.touch.instrument'));
    const slots = makeElement(this.doc, 'div', 'naval-touch-slots');
    for (let index = 0; index < 3; index++) {
      const button = makeElement(this.doc, 'button', 'naval-touch-slot naval-touch-action'); button.type = 'button';
      button.dataset.slot = String(index); button.setAttribute('data-slot', String(index));
      button.setAttribute('aria-label', t('systems.touch.skillEmpty', { slot: index + 1 }));
      const glyph = makeElement(this.doc, 'span', 'naval-touch-slot-icon'); glyph.setAttribute('aria-hidden', 'true'); button.appendChild(glyph);
      const label = makeElement(this.doc, 'span', 'naval-touch-slot-label'); label.textContent = '—'; button.appendChild(label);
      const shortcut = makeElement(this.doc, 'kbd', 'naval-touch-slot-key'); shortcut.setAttribute('aria-hidden', 'true'); button.appendChild(shortcut);
      const down = (event) => this.startSlot(event, index, button);
      const click = (event) => {
        if (this.ignoreLongPressCompatibilityClick(event)) return;
        if (this.enabled && !this.disposed && event.detail === 0) this.activateSlot(index);
      };
      button.addEventListener('pointerdown', down); button.addEventListener('click', click);
      this.slotButtons.push({ button, glyph, label, shortcut, listeners: [['pointerdown', down], ['click', click]] }); slots.appendChild(button);
    }
    this.instrument.appendChild(slots);
    const picker = makeElement(this.doc, 'div', 'naval-touch-picker'); picker.hidden = true; picker.setAttribute('aria-label', t('systems.touch.chooseSkill'));
    const title = makeElement(this.doc, 'div', 'naval-touch-picker-title'); title.textContent = t('systems.touch.chooseSkill'); picker.appendChild(title);
    this.pickerChoices = makeElement(this.doc, 'div', 'naval-touch-picker-choices'); picker.appendChild(this.pickerChoices);
    const cancel = makeElement(this.doc, 'button', 'naval-touch-picker-cancel'); cancel.type = 'button'; cancel.textContent = t('systems.touch.cancel');
    cancel.addEventListener('click', (event) => { if (this.ignoreLongPressCompatibilityClick(event)) return; this.closePicker(); }); picker.appendChild(cancel);
    this.instrument.appendChild(picker); this.picker = picker; this.wrapper.appendChild(this.instrument); this.loadBindings();
  }

  loadBindings() {
    if (!this.storageKey) return;
    try {
      const raw = this.doc.defaultView?.localStorage?.getItem(this.storageKey), parsed = JSON.parse(raw || 'null');
      if (Array.isArray(parsed)) this.preferredBindings = [0, 1, 2].map((i) => typeof parsed[i] === 'string' ? parsed[i] : null);
    } catch { /* Storage may be unavailable. */ }
  }

  persistBindings() {
    if (!this.storageKey) return;
    try { this.doc.defaultView?.localStorage?.setItem(this.storageKey, JSON.stringify(this.preferredBindings)); } catch { /* Best effort only. */ }
  }

  renderBindings() {
    if (!this.instrument) return;
    this.slotButtons.forEach(({ button, glyph, label, shortcut }, slot) => {
      const action = this.catalog.get(this.bindings[slot]);
      button.setAttribute('aria-disabled', action && action.disabled ? 'true' : 'false');
      button.setAttribute('data-unavailable', action && (action.disabled || action.available === false || action.unavailable === true) ? 'true' : 'false');
      if (action) { button.dataset.action = action.id; button.setAttribute('data-action', action.id); }
      else { delete button.dataset.action; button.removeAttribute?.('data-action'); }
      button.setAttribute('aria-label', action ? t('systems.touch.skillAction', { slot: slot + 1, action: translateData(action.label) }) : t('systems.touch.skillEmpty', { slot: slot + 1 }));
      label.textContent = action ? translateData(action.label) : '—'; glyph.replaceChildren?.();
      shortcut.textContent = action?.shortcut || '';
      if (action?.shortcut) button.setAttribute('aria-keyshortcuts', action.shortcut);
      else button.removeAttribute?.('aria-keyshortcuts');
      if (action) glyph.appendChild(createIcon(this.doc, action.icon || action.id));
    });
  }

  openPicker(slot) {
    if (!this.enabled || this.disposed || !this.picker || !Number.isInteger(slot)) return;
    this.pickerSlot = slot; this.picker.hidden = false; this.pickerChoices.replaceChildren?.();
    for (const [id, action] of this.catalog) {
      if (action.available === false || action.unavailable === true) continue;
      this.pickerChoices.appendChild(this.createPickerOption(slot, id, action));
    }
  }

  createPickerOption(slot, id, action) {
    const option = makeElement(this.doc, 'button', `naval-touch-picker-option${action.kind ? ` is-${action.kind}` : ''}`); option.type = 'button';
    const selected = this.bindings[slot] === id;
    option.dataset.bindId = id; option.dataset.kind = action.kind || 'action'; option.dataset.selected = selected ? 'true' : 'false';
    option.setAttribute('data-bind-id', id); option.setAttribute('aria-pressed', selected ? 'true' : 'false');
    option.appendChild(createIcon(this.doc, action.icon || id));
    const label = makeElement(this.doc, 'span', 'naval-touch-picker-label'); label.textContent = translateData(action.label); option.appendChild(label);
    option.addEventListener('click', (event) => { if (this.ignoreLongPressCompatibilityClick(event)) return; this.chooseBinding(slot, id); });
    return option;
  }

  refreshPickerOptions() {
    if (!this.picker || this.picker.hidden || this.pickerSlot == null) return;
    const slot = this.pickerSlot, existing = new Map([...this.pickerChoices.children].map((option) => [option.dataset.bindId, option]));
    for (const [id, action] of this.catalog) {
      const eligible = action.available !== false && action.unavailable !== true;
      let option = existing.get(id);
      if (!option && eligible) { option = this.createPickerOption(slot, id, action); this.pickerChoices.appendChild(option); continue; }
      if (!option) continue;
      option.disabled = !eligible; option.setAttribute('data-unavailable', eligible ? 'false' : 'true');
      option.setAttribute('class', `naval-touch-picker-option${action.kind ? ` is-${action.kind}` : ''}`);
      option.dataset.kind = action.kind || 'action';
      const selected = this.bindings[slot] === id;
      option.dataset.selected = selected ? 'true' : 'false'; option.setAttribute('aria-pressed', selected ? 'true' : 'false');
      const label = option.children?.[1]; if (label) label.textContent = translateData(action.label);
    }
  }

  closePicker() { if (this.picker) this.picker.hidden = true; this.pickerSlot = null; }

  ignoreLongPressCompatibilityClick(event) {
    const recent = this.recentLongPressRelease;
    if (!recent || Date.now() > recent.expiresAt) { this.recentLongPressRelease = null; return false; }
    if (Number.isFinite(event.pointerId) && Number.isFinite(recent.pointerId)) {
      if (event.pointerId !== recent.pointerId) return false;
      this.recentLongPressRelease = null;
      event.preventDefault?.(); event.stopImmediatePropagation?.(); return true;
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const point = this.toLocal(event.clientX, event.clientY);
    if (Math.hypot(point.x - recent.x, point.y - recent.y) > 18) return false;
    this.recentLongPressRelease = null;
    event.preventDefault?.(); event.stopImmediatePropagation?.(); return true;
  }

  chooseBinding(slot, id) {
    if (this.layout !== 'reference' || !Number.isInteger(slot) || slot < 0 || slot > 2 || !this.catalog.has(id)) return false;
    const action = this.catalog.get(id);
    if (action.available === false || action.unavailable === true) return false;
    const previous = this.preferredBindings[slot], other = this.preferredBindings.indexOf(id);
    this.preferredBindings[slot] = id; if (other >= 0 && other !== slot) this.preferredBindings[other] = previous;
    this.resolveBindings();
    this.closePicker(); this.renderBindings(); this.persistBindings(); return true;
  }

  activateSlot(slot) { const id = this.bindings[slot], action = this.catalog.get(id); if (action && !action.disabled && action.available !== false && action.unavailable !== true) this.callbacks.onAction(id); }

  startSlot(event, slot, button) {
    if (!this.enabled || this.disposed || button.disabled || event.pointerId == null ||
      (event.pointerType === 'mouse' && event.button !== 0) || this.pointers.has(event.pointerId)) return;
    const point = this.toLocal(event.clientX || 0, event.clientY || 0);
    const record = { kind: 'slot', slot, id: this.bindings[slot], element: button, start: point, moved: false, longPressed: false, timer: null };
    record.timer = setTimeout(() => {
      if (!this.enabled || this.disposed || record.moved || this.pointers.get(event.pointerId) !== record) return;
      record.longPressed = true; this.recentLongPressRelease = { pointerId: event.pointerId, x: point.x, y: point.y, expiresAt: Date.now() + 1500 };
      this.openPicker(slot);
    }, 500);
    this.pointers.set(event.pointerId, record); this.capture(button, event.pointerId); this.callbacks.onGesture(); event.preventDefault?.();
  }

  moveActionPointer(event) {
    const record = this.pointers.get(event.pointerId); if (!record || (record.kind !== 'slot' && record.kind !== 'action')) return;
    if (record.kind === 'slot' && !record.longPressed && !record.moved) {
      const point = this.toLocal(event.clientX || 0, event.clientY || 0);
      if (Math.hypot(point.x - record.start.x, point.y - record.start.y) > 10) { record.moved = true; clearTimeout(record.timer); }
    }
  }

  setActions(actions) {
    if (this.disposed) return;
    const clean = Array.isArray(actions) ? actions : [];
    if (this.layout === 'reference') {
      const next = new Map();
      for (const action of clean) if (action && typeof action.id === 'string' && action.id && typeof action.label === 'string' && !next.has(action.id))
        next.set(action.id, { ...action });
      const signature = JSON.stringify([...next].map(([id, action]) => [id, action.label, action.icon || '', action.kind || '', action.shortcut || '', !!action.disabled, action.available !== false, action.unavailable === true]));
      if (signature === this.catalogSignature) return;
      const idsSignature = JSON.stringify([...next.keys()].sort());
      const structuralChange = idsSignature !== this.catalogIdsSignature;
      if (structuralChange) { this.cancelActionPointers(); this.closePicker(); }
      this.catalog = next; this.catalogSignature = signature; this.catalogIdsSignature = idsSignature;
      this.resolveBindings(); this.renderBindings();
      this.refreshPickerOptions();
      return;
    }
    for (const [pointerId, pointer] of this.pointers) if (pointer.kind === 'action') this.pointers.delete(pointerId);
    for (const [id, button] of this.buttons) {
      this.unlistenButton(button); this.buttons.delete(id);
    }
    this.actionRow.replaceChildren?.();
    if (!this.actionRow.replaceChildren) while (this.actionRow.firstChild) this.actionRow.removeChild(this.actionRow.firstChild);
    for (const action of clean) {
      if (!action || typeof action.id !== 'string' || !action.id || typeof action.label !== 'string' || this.buttons.has(action.id)) continue;
      const button = makeElement(this.doc, 'button', 'naval-touch-action');
      const actionLabel = translateData(action.label);
      button.type = 'button'; button.setAttribute('aria-label', actionLabel); button.setAttribute('title', actionLabel);
      button.disabled = action.disabled === true; button.dataset.action = action.id;
      button.appendChild(createIcon(this.doc, action.icon || action.id));
      const text = makeElement(this.doc, 'span', 'naval-touch-action-label'); text.textContent = actionLabel; button.appendChild(text);
      const down = (event) => this.startAction(event, action.id, button);
      const click = (event) => { if (this.enabled && !this.disposed && !button.disabled && event.detail === 0) this.callbacks.onAction(action.id); };
      button.addEventListener('pointerdown', down); button.addEventListener('click', click);
      this.buttons.set(action.id, { button, action: { ...action }, listeners: [['pointerdown', down], ['click', click]] });
      this.actionRow.appendChild(button);
    }
  }

  resolveBindings() {
    const visible = [null, null, null], used = new Set();
    const eligible = (action) => action && action.available !== false && action.unavailable !== true;
    for (let slot = 0; slot < 3; slot++) {
      const id = this.preferredBindings[slot], action = this.catalog.get(id);
      if (id && eligible(action) && !used.has(id)) { visible[slot] = id; used.add(id); }
    }
    for (let slot = 0; slot < 3; slot++) if (!visible[slot]) {
      const fallback = [...this.catalog].find(([id, action]) => !used.has(id) && eligible(action))?.[0];
      if (fallback) { visible[slot] = fallback; used.add(fallback); }
    }
    this.bindings = visible;
  }

  unlistenButton(record) { for (const [type, callback] of record.listeners) record.button.removeEventListener(type, callback); }

  cancelActionPointers() {
    for (const [pointerId, record] of [...this.pointers]) if (record.kind === 'slot' || record.kind === 'action') {
      clearTimeout(record.timer); this.pointers.delete(pointerId);
      try { record.element.releasePointerCapture?.(pointerId); } catch { /* Capture may already be lost. */ }
    }
  }

  setActionState(id, { disabled, label } = {}) {
    if (this.layout === 'reference') {
      const action = this.catalog.get(id); if (!action || this.disposed) return false;
      if (disabled !== undefined) action.disabled = !!disabled;
      if (label !== undefined && typeof label === 'string') action.label = label;
      this.catalogSignature = '';
      this.setActions([...this.catalog.values()]); return true;
    }
    const record = this.buttons.get(id); if (!record || this.disposed) return false;
    if (disabled !== undefined) { record.action.disabled = !!disabled; record.button.disabled = !!disabled; }
    if (label !== undefined && typeof label === 'string') {
      record.action.label = label; const localized = translateData(label); record.button.setAttribute('aria-label', localized); record.button.setAttribute('title', localized);
      const text = record.button.querySelector?.('.naval-touch-action-label'); if (text) text.textContent = localized;
    }
    return true;
  }

  startStick(event, stick) {
    if (!this.enabled || this.disposed || stick.pointerId !== null || event.pointerId == null ||
        (event.pointerType === 'mouse' && event.button !== 0)) return;
    stick.pointerId = event.pointerId; this.pointers.set(event.pointerId, { kind: 'stick', name: stick.name, element: stick.pad });
    const rect = stick.pad.getBoundingClientRect?.() || { left: 0, top: 0, width: 104, height: 104 };
    stick.origin = this.toLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
    stick.radius = Math.max(1, Math.min(rect.width || 104, rect.height || 104) / 2 - 12);
    this.capture(stick.pad, event.pointerId); this.callbacks.onGesture(); this.moveStick(event, stick); event.preventDefault?.();
  }

  moveStick(event, stick) {
    if (stick.pointerId !== event.pointerId || !stick.origin || !this.enabled || this.disposed) return;
    const point = this.toLocal(event.clientX || 0, event.clientY || 0);
    const dx = point.x - stick.origin.x, dy = point.y - stick.origin.y;
    const length = Math.hypot(dx, dy), scale = length > stick.radius ? stick.radius / length : 1;
    let x = dx * scale / stick.radius, y = dy * scale / stick.radius;
    const magnitude = Math.hypot(x, y);
    if (magnitude <= DEAD_ZONE) x = y = 0;
    else { const adjusted = (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE); x = x / magnitude * adjusted; y = y / magnitude * adjusted; }
    stick.value = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
    stick.puck.style.transform = `translate(${(dx * scale).toFixed(2)}px, ${(dy * scale).toFixed(2)}px)`;
    (stick.name === 'move' ? this.callbacks.onMove : this.callbacks.onLook)(Object.freeze({ ...stick.value }));
    event.preventDefault?.();
  }

  startAction(event, id, button) {
    if (!this.enabled || this.disposed || button.disabled || event.pointerId == null ||
        (event.pointerType === 'mouse' && event.button !== 0) || this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { kind: 'action', id, element: button, cancelled: false });
    this.capture(button, event.pointerId); this.callbacks.onGesture(); event.preventDefault?.();
  }

  capture(element, pointerId) { try { element.setPointerCapture?.(pointerId); } catch { /* Capture may be unavailable. */ } }

  finishPointer(event, activate) {
    const record = this.pointers.get(event.pointerId); if (!record) return;
    this.pointers.delete(event.pointerId);
    if (record.kind === 'slot') {
      clearTimeout(record.timer);
      if (activate && record.longPressed) this.recentLongPressRelease = { ...this.recentLongPressRelease, pointerId: event.pointerId, expiresAt: Date.now() + 500 };
      if (activate && record.longPressed) this.recentLongPressRelease = { ...this.recentLongPressRelease, pointerId: event.pointerId, expiresAt: Date.now() + 1500 };
      if (activate && this.enabled && !this.disposed && !record.moved && !record.longPressed && !record.element.disabled) {
        const rect = record.element.getBoundingClientRect?.();
        const hasPosition = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
        const point = hasPosition ? this.toLocal(event.clientX, event.clientY) : null;
        const corners = rect ? [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]].map(([x, y]) => this.toLocal(x, y)) : [];
        const inside = !hasPosition || !rect || (point && point.x >= Math.min(...corners.map((p) => p.x)) && point.x <= Math.max(...corners.map((p) => p.x)) && point.y >= Math.min(...corners.map((p) => p.y)) && point.y <= Math.max(...corners.map((p) => p.y)));
        if (inside && record.id === this.bindings[record.slot]) this.activateSlot(record.slot);
      }
      return;
    }
    if (record.kind === 'stick') {
      const stick = this.sticks.get(record.name); if (stick?.pointerId === event.pointerId) {
        stick.pointerId = null; stick.origin = null; stick.value = { x: 0, y: 0 }; stick.puck.style.transform = 'translate(0px, 0px)';
        (stick.name === 'move' ? this.callbacks.onMove : this.callbacks.onLook)(Object.freeze({ x: 0, y: 0 }));
      }
    } else if (activate && this.enabled && !this.disposed && !record.element.disabled && !record.cancelled) {
      const rect = record.element.getBoundingClientRect?.();
      const hasPosition = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
      const point = hasPosition ? this.toLocal(event.clientX, event.clientY) : null;
      const corners = rect ? [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]]
        .map(([x, y]) => this.toLocal(x, y)) : [];
      const inside = !hasPosition || !rect || (point && point.x >= Math.min(...corners.map((p) => p.x)) &&
        point.x <= Math.max(...corners.map((p) => p.x)) && point.y >= Math.min(...corners.map((p) => p.y)) &&
        point.y <= Math.max(...corners.map((p) => p.y)));
      if (inside) this.callbacks.onAction(record.id);
    }
  }

  setEnabled(enabled) {
    if (this.disposed) return;
    const next = !!enabled; if (next === this.enabled) return;
    this.enabled = next; this.wrapper.setAttribute('data-enabled', next ? 'true' : 'false');
    if (!next) this.clear();
  }

  clear() {
    if (this.disposed) return;
    this.cancelActionPointers(); this.closePicker();
    for (const [pointerId, record] of [...this.pointers]) try { record.element.releasePointerCapture?.(pointerId); } catch { /* ignored */ }
    this.pointers.clear();
    for (const stick of this.sticks.values()) {
      stick.pointerId = null; stick.origin = null; stick.value = { x: 0, y: 0 }; stick.puck.style.transform = 'translate(0px, 0px)';
    }
    this.callbacks.onMove(Object.freeze({ x: 0, y: 0 })); this.callbacks.onLook(Object.freeze({ x: 0, y: 0 }));
  }

  diagnostics() {
    return Object.freeze({ enabled: this.enabled, disposed: this.disposed, pointers: this.pointers.size,
      move: Object.freeze({ ...this.sticks.get('move').value }), look: Object.freeze({ ...this.sticks.get('look').value }),
      actions: this.buttons.size, picker: !!this.picker && !this.picker.hidden, pickerSlot: this.pickerSlot,
      bindings: Object.freeze([...this.bindings]), preferredBindings: Object.freeze([...this.preferredBindings]), layout: this.layout });
  }

  dispose() {
    if (this.disposed) return;
    this.unsubscribeLocale?.();
    this.clear(); this.disposed = true; this.enabled = false;
    for (const [target, type, callback] of this.listeners) target.removeEventListener(type, callback);
    this.listeners.length = 0;
    for (const record of this.buttons.values()) this.unlistenButton(record);
    for (const record of this.slotButtons) for (const [type, callback] of record.listeners) record.button.removeEventListener(type, callback);
    this.slotButtons.length = 0;
    this.buttons.clear(); this.pointers.clear(); this.wrapper.remove?.();
  }
}
