const DEAD_ZONE = 0.12;
const ICONS = Object.freeze({
  wind: [{ d: 'M3 8h11c4 0 4-5 1-5-2 0-3 1-3 2' }, { d: 'M3 12h16c3 0 3 5 0 5-2 0-3-1-3-2' }, { d: 'M3 16h6' }],
  capture: [{ d: 'M4 12h5l3-4 3 8 3-4h2' }, { tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } }],
  cargo: [{ d: 'm4 8 8-4 8 4v9l-8 4-8-4z' }, { d: 'm4 8 8 4 8-4M12 12v9M8 6l8 4' }],
  jettison: [{ d: 'M4 7h16M9 7V4h6v3m-9 0 1 13h8l1-13M10 11v5m4-5v5' }],
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
    actions = [], enabled = true } = {}) {
    const doc = container?.ownerDocument;
    if (!container?.appendChild || !doc?.createElement) throw new TypeError('TouchHelm requires a DOM container');
    for (const callback of [onMove, onLook, onAction, onGesture]) if (typeof callback !== 'function')
      throw new TypeError('TouchHelm callbacks must be functions');
    this.container = container; this.doc = doc; this.callbacks = { onMove, onLook, onAction, onGesture };
    this.enabled = !!enabled; this.disposed = false; this.pointers = new Map(); this.sticks = new Map(); this.buttons = new Map();
    this.listeners = []; this.wrapper = makeElement(doc, 'div', 'naval-touch');
    this.wrapper.setAttribute('aria-label', 'Controles táctiles de navegación');
    this.wrapper.setAttribute('data-enabled', this.enabled ? 'true' : 'false');
    this.container.appendChild(this.wrapper);
    this.buildStick('move', 'Movimiento'); this.buildStick('look', 'Cámara');
    this.actionRow = makeElement(doc, 'div', 'naval-touch-actions');
    this.actionRow.setAttribute('aria-label', 'Acciones de navegación'); this.wrapper.appendChild(this.actionRow);
    this.setActions(actions);
    this.listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden || this.doc.visibilityState === 'hidden') this.clear(); });
    const view = doc.defaultView || globalThis.window;
    if (view?.addEventListener) for (const type of ['blur', 'pagehide']) this.listen(view, type, () => this.clear());
    this.listen(this.doc, 'pointerup', (event) => this.finishPointer(event, true));
    this.listen(this.doc, 'pointercancel', (event) => this.finishPointer(event, false));
    this.listen(this.doc, 'lostpointercapture', (event) => this.finishPointer(event, false));
  }

  listen(target, type, callback) { target.addEventListener(type, callback); this.listeners.push([target, type, callback]); }

  buildStick(name, label) {
    const pad = makeElement(this.doc, 'div', `naval-touch-stick naval-touch-stick-${name}`);
    const accessibleLabel = name === 'move' ? `${label}: arriba avanza, abajo frena` : `${label}: desplaza para mirar`;
    pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', accessibleLabel); pad.setAttribute('data-stick', name);
    const ring = makeElement(this.doc, 'div', 'naval-touch-ring'); ring.setAttribute('aria-hidden', 'true');
    const puck = makeElement(this.doc, 'div', 'naval-touch-puck'); puck.setAttribute('aria-hidden', 'true');
    const cue = makeElement(this.doc, 'span', `naval-touch-cue naval-touch-cue-${name}`);
    cue.textContent = name === 'move' ? '↑ AVANZA  ·  ↓ FRENA' : '↔ CÁMARA'; cue.setAttribute('aria-hidden', 'true');
    const caption = makeElement(this.doc, 'span', 'naval-touch-caption'); caption.textContent = name === 'move' ? 'MOVIMIENTO' : 'CÁMARA';
    pad.appendChild(ring); pad.appendChild(puck); pad.appendChild(cue); pad.appendChild(caption); this.wrapper.appendChild(pad);
    const stick = { name, pad, puck, value: { x: 0, y: 0 }, pointerId: null, origin: null, radius: 38 };
    this.sticks.set(name, stick);
    this.listen(pad, 'pointerdown', (event) => this.startStick(event, stick));
    this.listen(pad, 'pointermove', (event) => this.moveStick(event, stick));
    return stick;
  }

  setActions(actions) {
    if (this.disposed) return;
    const clean = Array.isArray(actions) ? actions : [];
    for (const [pointerId, pointer] of this.pointers) if (pointer.kind === 'action') this.pointers.delete(pointerId);
    for (const [id, button] of this.buttons) {
      this.unlistenButton(button); this.buttons.delete(id);
    }
    this.actionRow.replaceChildren?.();
    if (!this.actionRow.replaceChildren) while (this.actionRow.firstChild) this.actionRow.removeChild(this.actionRow.firstChild);
    for (const action of clean) {
      if (!action || typeof action.id !== 'string' || !action.id || typeof action.label !== 'string' || this.buttons.has(action.id)) continue;
      const button = makeElement(this.doc, 'button', 'naval-touch-action');
      button.type = 'button'; button.setAttribute('aria-label', action.label); button.setAttribute('title', action.label);
      button.disabled = action.disabled === true; button.dataset.action = action.id;
      button.appendChild(createIcon(this.doc, action.icon || action.id));
      const text = makeElement(this.doc, 'span', 'naval-touch-action-label'); text.textContent = action.label; button.appendChild(text);
      const down = (event) => this.startAction(event, action.id, button);
      const click = (event) => { if (this.enabled && !this.disposed && !button.disabled && event.detail === 0) this.callbacks.onAction(action.id); };
      button.addEventListener('pointerdown', down); button.addEventListener('click', click);
      this.buttons.set(action.id, { button, action: { ...action }, listeners: [['pointerdown', down], ['click', click]] });
      this.actionRow.appendChild(button);
    }
  }

  unlistenButton(record) { for (const [type, callback] of record.listeners) record.button.removeEventListener(type, callback); }

  setActionState(id, { disabled, label } = {}) {
    const record = this.buttons.get(id); if (!record || this.disposed) return false;
    if (disabled !== undefined) { record.action.disabled = !!disabled; record.button.disabled = !!disabled; }
    if (label !== undefined && typeof label === 'string') {
      record.action.label = label; record.button.setAttribute('aria-label', label); record.button.setAttribute('title', label);
      const text = record.button.querySelector?.('.naval-touch-action-label'); if (text) text.textContent = label;
    }
    return true;
  }

  startStick(event, stick) {
    if (!this.enabled || this.disposed || stick.pointerId !== null || event.pointerId == null ||
        (event.pointerType === 'mouse' && event.button !== 0)) return;
    stick.pointerId = event.pointerId; this.pointers.set(event.pointerId, { kind: 'stick', name: stick.name, element: stick.pad });
    const rect = stick.pad.getBoundingClientRect?.() || { left: 0, top: 0, width: 104, height: 104 };
    stick.origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    stick.radius = Math.max(1, Math.min(rect.width || 104, rect.height || 104) / 2 - 12);
    this.capture(stick.pad, event.pointerId); this.callbacks.onGesture(); this.moveStick(event, stick); event.preventDefault?.();
  }

  moveStick(event, stick) {
    if (stick.pointerId !== event.pointerId || !stick.origin || !this.enabled || this.disposed) return;
    const dx = (event.clientX || 0) - stick.origin.x, dy = (event.clientY || 0) - stick.origin.y;
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
    if (record.kind === 'stick') {
      const stick = this.sticks.get(record.name); if (stick?.pointerId === event.pointerId) {
        stick.pointerId = null; stick.origin = null; stick.value = { x: 0, y: 0 }; stick.puck.style.transform = 'translate(0px, 0px)';
        (stick.name === 'move' ? this.callbacks.onMove : this.callbacks.onLook)(Object.freeze({ x: 0, y: 0 }));
      }
    } else if (activate && this.enabled && !this.disposed && !record.element.disabled && !record.cancelled) {
      const rect = record.element.getBoundingClientRect?.();
      const hasPosition = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
      const inside = !hasPosition || !rect || (event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom);
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
    this.pointers.clear();
    for (const stick of this.sticks.values()) {
      stick.pointerId = null; stick.origin = null; stick.value = { x: 0, y: 0 }; stick.puck.style.transform = 'translate(0px, 0px)';
    }
    this.callbacks.onMove(Object.freeze({ x: 0, y: 0 })); this.callbacks.onLook(Object.freeze({ x: 0, y: 0 }));
  }

  diagnostics() {
    return Object.freeze({ enabled: this.enabled, disposed: this.disposed, pointers: this.pointers.size,
      move: Object.freeze({ ...this.sticks.get('move').value }), look: Object.freeze({ ...this.sticks.get('look').value }),
      actions: this.buttons.size });
  }

  dispose() {
    if (this.disposed) return;
    this.clear(); this.disposed = true; this.enabled = false;
    for (const [target, type, callback] of this.listeners) target.removeEventListener(type, callback);
    this.listeners.length = 0;
    for (const record of this.buttons.values()) this.unlistenButton(record);
    this.buttons.clear(); this.pointers.clear(); this.wrapper.remove?.();
  }
}
