import { FIRE_KIND_SECONDS, FIRE_KINDS } from '../data/fire.js';

const RETRY_MS = 1000;
const TIMEOUT_MS = 5000;
const HAND = Object.freeze({ ship: '', part: 'hand', kind: 'handTorch' });
const STATION_KINDS = new Set(['lantern', 'torchFloor', 'torchWall', 'campfire', 'grill']);
const call = (fn, fallback) => { try { return typeof fn === 'function' ? fn() : fallback; } catch { return fallback; } };
const langOf = locale => String(call(locale, 'es')).toLowerCase().startsWith('en') ? 'en' : 'es';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(value);
const validTarget = target => !!target && typeof target === 'object' && !Array.isArray(target) &&
  (target.ship === '' && target.part === 'hand' && target.kind === 'handTorch' ||
   validId(target.ship) && validId(target.part) && STATION_KINDS.has(target.kind));
const slotKey = target => target?.ship === '' ? 'hand' : JSON.stringify([target.ship, target.part]);
const validRows = rows => Array.isArray(rows) ? rows.filter(row => row && typeof row.key === 'string' &&
  FIRE_KINDS.includes(row.kind) && Number.isSafeInteger(row.seconds) && row.seconds >= 0 && typeof row.lit === 'boolean') : [];
const durationLabel = seconds => {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safe / 60), rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

const COPY = {
  es: {
    title: 'Fuego', close: 'Cerrar fuego', fuelLabel: 'Combustible', fuel: 'Este fuego ya tiene combustible.', empty: 'Vacío', wood: 'Madera',
    craft: 'Crear y encender · 1 madera', load: 'Cargar y encender · 1 madera', turnOn: 'Encender', turnOff: 'Apagar',
    lit: 'Encendido', unlit: 'Apagado', remaining: 'Tiempo restante', noRefill: 'Sin recarga automática.',
    pack: 'Mochila', hold: 'Bodega', waiting: 'Esperando confirmación…', delayed: 'La conexión tarda. El servidor conserva el resultado de la solicitud.',
    loaded: 'Combustible cargado y fuego encendido.', on: 'Fuego encendido.', off: 'Fuego apagado.',
    account_required: 'Vincula una cuenta para guardar el combustible.', goods: 'Necesitas una madera en la mochila o bodega.',
    fuel: 'Este fuego ya tiene combustible.', full: 'El espacio de combustible ya está ocupado.', empty: 'No queda combustible.',
    revision: 'El estado cambió. Espera a que se actualice y vuelve a intentarlo.', revisionLimit: 'La revisión llegó a su límite; vuelve a entrar.',
    owner: 'No puedes usar el fuego de esa balsa.', far: 'Acércate al fuego.', condition: 'Ese fuego ya no está disponible.',
    busy: 'Espera a que termine tu acción actual.', dead: 'No puedes usar fuego mientras estás derrotado.',
    storage: 'No se pudo guardar el combustible. Vuelve a conectar.', duplicate: 'La solicitud ya se usó para otra acción.',
    command: 'La solicitud de fuego no se pudo validar.', disabled: 'El combustible todavía no está disponible en este mundo.',
    generic: 'No se pudo completar la acción de fuego.', handTorch: 'Antorcha de mano', lantern: 'Farol',
    torchFloor: 'Antorcha de suelo', torchWall: 'Antorcha de pared', campfire: 'Fogata', grill: 'Parrilla',
  },
  en: {
    title: 'Fire', close: 'Close fire', fuelLabel: 'Fuel', fuel: 'This fire already has fuel.', empty: 'Empty', wood: 'Wood',
    craft: 'Craft & light · 1 wood', load: 'Load & light · 1 wood', turnOn: 'Light', turnOff: 'Extinguish',
    lit: 'Lit', unlit: 'Unlit', remaining: 'Time remaining', noRefill: 'No automatic refills.',
    pack: 'Pack', hold: 'Hold', waiting: 'Waiting for confirmation…', delayed: 'The connection is taking longer. The server retains the request result.',
    loaded: 'Fuel loaded and fire lit.', on: 'Fire lit.', off: 'Fire extinguished.',
    account_required: 'Link an account to save fuel.', goods: 'You need one wood in your pack or hold.',
    fuel: 'This fire already has fuel.', full: 'The fuel slot is occupied.', empty: 'No fuel remains.',
    revision: 'The state changed. Wait for it to update, then try again.', revisionLimit: 'The revision limit was reached; rejoin the world.',
    owner: 'You cannot use that raft’s fire.', far: 'Move closer to the fire.', condition: 'That fire is no longer available.',
    busy: 'Wait until your current action ends.', dead: 'You cannot use fire while defeated.',
    storage: 'Fuel could not be saved. Reconnect to continue.', duplicate: 'This request was already used for another action.',
    command: 'The fire request could not be validated.', disabled: 'Fuel is not available in this world yet.',
    generic: 'The fire action could not be completed.', handTorch: 'Hand torch', lantern: 'Lantern',
    torchFloor: 'Floor torch', torchWall: 'Wall torch', campfire: 'Campfire', grill: 'Grill',
  },
};

function opId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function newFirePanel(options) { return new FirePanel(options); }

export class FirePanel {
  constructor({ parent, client = () => null, locale = () => 'es', toast = () => {}, onOpen = () => {}, onClose = () => {}, now = () => performance.now() } = {}) {
    this.parent = parent; this.client = client; this.localeSource = locale; this.toast = toast; this.onOpen = onOpen; this.onClose = onClose; this.now = now;
    this.active = false; this.pending = null; this.target = null; this.owner = null; this.entity = null; this.renderKey = '';
    this.statusKey = ''; this.statusReason = '';
    const doc = parent?.ownerDocument || globalThis.document;
    if (!doc?.createElement || !parent?.appendChild) return;
    this.doc = doc;
    this.root = doc.createElement('section');
    this.root.className = 'fire-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'false');
    this.root.innerHTML = `<header class="fire-head"><div><small class="fire-kicker"></small><h2 class="fire-title"></h2></div><button type="button" class="fire-close"></button></header>
      <section class="fire-slot"><div class="fire-slot-copy"><b class="fire-kind"></b><span class="fire-state"></span></div><div class="fire-time"><small class="fire-time-label"></small><strong class="fire-seconds"></strong></div></section>
      <p class="fire-stock"></p><p class="fire-note"></p><p class="fire-status" aria-live="polite"></p>
      <div class="fire-actions"><button type="button" class="fire-load"></button><button type="button" class="fire-toggle"></button></div>`;
    parent.appendChild(this.root);
    this.$ = selector => this.root.querySelector(selector);
    this.closeButton = this.$('.fire-close'); this.loadButton = this.$('.fire-load'); this.toggleButton = this.$('.fire-toggle');
    this.closeButton.addEventListener('click', () => this.close());
    this.loadButton.addEventListener('click', () => this.load());
    this.toggleButton.addEventListener('click', () => this.setLit(!this.currentSlot()?.lit));
    this.keyListener = event => {
      if (this.active && (event.code === 'Escape' || event.key === 'Escape')) {
        event.preventDefault(); event.stopPropagation(); this.close();
      }
    };
    this.render();
  }

  locale() { return langOf(this.localeSource); }
  copy() { return COPY[this.locale()]; }
  key(target = this.target) { return slotKey(target); }
  fireState() { return this.client?.()?.fire || null; }
  currentSlot() {
    const key = this.key(), rows = validRows(this.fireState()?.slots);
    return rows.find(row => row.key === key && row.kind === this.target?.kind) || { key, kind: this.target?.kind, seconds: 0, lit: false };
  }
  currentProfile() { return this.client?.()?.profile || null; }
  currentShip() {
    if (!this.target?.ship) return null;
    return this.currentProfile()?.eco?.ships?.find(ship => ship?.id === this.target.ship) || null;
  }
  stock() {
    const profile = this.currentProfile();
    const pack = Number.isSafeInteger(profile?.eco?.pack?.goods?.madera) ? profile.eco.pack.goods.madera : 0;
    const hold = Number.isSafeInteger(this.currentShip()?.hold?.goods?.madera) ? this.currentShip().hold.goods.madera : 0;
    return { pack, hold, total: pack + (this.target?.ship ? hold : 0) };
  }
  isEnabled() { return this.fireState()?.enabled === true; }
  isCurrentSession() {
    const c = this.client?.();
    return !!(c?.joined && c.youServer && c === this.owner && c.youServer === this.entity);
  }

  open(target = HAND) {
    if (!validTarget(target) || !this.root) return false;
    const c = this.client?.();
    if (!c?.joined || !c.youServer) return false;
    if (this.owner && (this.owner !== c || this.entity !== c.youServer)) this.resetSession();
    this.owner = c; this.entity = c.youServer;
    this.target = { ship: target.ship, part: target.part, kind: target.kind, ...(typeof target.name === 'string' ? { name: target.name.slice(0, 80) } : {}) };
    this.active = true; this.root.hidden = false; this.attachEscape();
    try { this.onOpen?.(this.target); } catch { /* UI focus/context hooks are optional. */ }
    this.render();
    this.closeButton.focus?.({ preventScroll: true });
    return true;
  }

  attachEscape() { this.doc?.addEventListener?.('keydown', this.keyListener); }
  detachEscape() { this.doc?.removeEventListener?.('keydown', this.keyListener); }
  close() {
    const wasActive = this.active;
    this.active = false; if (this.root) this.root.hidden = true;
    this.detachEscape(); this.render();
    if (wasActive) this.onClose?.();
  }
  resetSession() {
    this.pending = null; this.owner = null; this.entity = null; this.target = null;
    this.close();
  }
  dispose() {
    this.resetSession(); this.root?.remove?.(); this.root = null; this.$ = null;
  }

  update() {
    const c = this.client?.();
    const valid = !!(c?.joined && c.youServer);
    if (!valid || c !== this.owner || c.youServer !== this.entity) {
      if (this.pending || this.active || this.owner) this.resetSession();
      if (valid) { this.owner = c; this.entity = c.youServer; }
    }
    if (this.pending) {
      const elapsed = this.now() - this.pending.sentAt;
      if (elapsed >= TIMEOUT_MS) {
        this.pending = null; this.setStatus('delayed');
      } else if (!this.pending.retried && elapsed >= RETRY_MS) {
        this.pending.retried = true;
        try { c.send(this.pending.command); } catch { /* Retry this immutable request only once. */ }
      }
    }
    this.render();
  }

  makeCommand(op, lit) {
    const target = this.target, fire = this.fireState();
    if (!target || !Number.isSafeInteger(fire?.rev) || fire.rev < 0) return null;
    return Object.freeze({ t: 'cmd', type: 'fire', op, opId: opId(), ship: target.ship, part: target.part,
      kind: target.kind, expectedRev: fire.rev, lit });
  }
  send(op, lit) {
    const c = this.client?.();
    if (!this.active || !this.isCurrentSession() || this.pending || !this.isEnabled() || !c?.send) return false;
    const command = this.makeCommand(op, lit);
    if (!command) return false;
    this.pending = { command, sentAt: this.now(), retried: false };
    try { c.send(command); }
    catch { this.pending = null; this.setStatus('generic'); this.render(); return false; }
    this.setStatus('waiting'); this.render(); return true;
  }
  load() {
    const slot = this.currentSlot(), stock = this.stock();
    if (slot.seconds > 0 || stock.total < 1) return false;
    return this.send('load', true);
  }
  setLit(lit) {
    const slot = this.currentSlot();
    if (slot.seconds <= 0 || slot.lit === lit) return false;
    return this.send('set', !!lit);
  }
  setStatus(key, reason = '') {
    this.statusKey = key || '';
    this.statusReason = reason || '';
    if (this.root) {
      const c = this.copy();
      this.$('.fire-status').textContent = this.statusReason ? c[this.statusReason] || c.generic : c[this.statusKey] || '';
    }
  }

  acknowledge(ev) {
    this.updateClockOnly();
    const pending = this.pending;
    if (!ev || ev.type !== 'fire' || !pending || ev.opId !== pending.command.opId || ev.op !== pending.command.op) return false;
    this.pending = null;
    const c = this.copy();
    if (ev.ok === true) this.setStatus(pending.command.op === 'load' ? 'loaded' : pending.command.lit ? 'on' : 'off');
    else this.setStatus('', ev.why || 'generic');
    this.render(); return true;
  }
  updateClockOnly() {
    const c = this.client?.();
    if (!c?.joined || c !== this.owner || c.youServer !== this.entity) this.resetSession();
  }

  render() {
    if (!this.root || !this.target) return;
    const c = this.copy(), slot = this.currentSlot(), stock = this.stock(), enabled = this.isEnabled();
    const pending = !!this.pending, hasFuel = slot.seconds > 0;
    this.$('.fire-kicker').textContent = c.fuelLabel;
    this.$('.fire-title').textContent = this.target.name || c[this.target.kind] || c.title;
    this.$('.fire-kind').textContent = `${c[this.target.kind] || this.target.kind} · ${hasFuel ? durationLabel(slot.seconds) : c.empty}`;
    this.$('.fire-state').textContent = slot.lit && hasFuel ? c.lit : c.unlit;
    this.$('.fire-time-label').textContent = c.remaining;
    this.$('.fire-seconds').textContent = durationLabel(slot.seconds);
    this.$('.fire-stock').textContent = this.target.ship
      ? `${c.pack}: ${stock.pack} · ${c.hold}: ${stock.hold} ${c.wood}`
      : `${c.pack}: ${stock.pack} ${c.wood}`;
    this.$('.fire-note').textContent = c.noRefill;
    this.$('.fire-load').textContent = this.target.ship ? c.load : c.craft;
    this.$('.fire-load').disabled = pending || !enabled || hasFuel || stock.total < 1;
    this.$('.fire-toggle').hidden = !hasFuel;
    this.$('.fire-toggle').textContent = slot.lit ? c.turnOff : c.turnOn;
    this.$('.fire-toggle').disabled = pending || !enabled || !hasFuel;
    this.$('.fire-close').textContent = '×';
    this.$('.fire-close').setAttribute('aria-label', c.close);
    if (!enabled && this.active && !pending) this.setStatus('disabled');
    this.$('.fire-status').textContent = this.statusReason ? c[this.statusReason] || c.generic : c[this.statusKey] || '';
    this.root.hidden = !this.active;
  }
}

export { FIRE_KIND_SECONDS, durationLabel, validTarget };
