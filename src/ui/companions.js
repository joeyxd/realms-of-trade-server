// Small authenticated companion status panel. Callbacks own all account and server authority.
const COPY = {
  es: {
    title: 'Mis compañeros', open: 'Abrir mis compañeros', close: 'Cerrar mis compañeros',
    refresh: 'Actualizar', refreshing: 'Actualizando…', stop: 'Detener', confirmStop: 'Confirmar detención', stopping: 'Deteniendo…', resume: 'Permitir conexión', resuming: 'Guardando…', closePanel: 'Cerrar panel', configure: 'Ficha',
    signed_out: 'Inicia sesión para consultar tus compañeros.', loading: 'Consultando compañeros…',
    error: 'No se pudo consultar el estado. Inténtalo de nuevo.', offline: 'Sin conexión. Los compañeros no están disponibles.',
    setupNote: 'Aún no puedes configurar una conexión desde el juego.', configNote: 'La ficha guarda personalidad y objetivos. Conexión al modelo y memoria siguen pendientes.', sessionNote: 'Este compañero usa una detención de sesión; tras reiniciar el servidor, puede volver a conectarse.', durableNote: 'La detención se conserva entre sesiones. Permitir conexión requiere que el controlador vuelva a conectarse; no inicia al compañero automáticamente.',
    serverDisabled: 'Los compañeros están desactivados en este servidor.', ready: 'Estado actualizado.',
    noCompanions: 'No hay compañeros vinculados a esta cuenta.', fallbackName: (n) => `Compañero ${n}`,
    online: 'En línea', offlineAgent: 'Desconectado',
    active: 'Activo', inactive: 'Inactivo', stopped: 'Detenido', stopFailed: 'No se pudo detener el compañero. Inténtalo de nuevo.', resumeFailed: 'No se pudo permitir la conexión. Actualiza el estado antes de volver a intentarlo.',
    savedStopped: 'Detención guardada', defaultStopped: 'Detenido por defecto', savedRunning: 'Conexión permitida guardada', localStop: 'Detención local sin confirmar', controlPending: 'Control durable pendiente; aún no está confirmado', controlUnavailable: 'Control durable no disponible; actualizar para consultar de nuevo',
    refreshFailed: 'No se pudo actualizar el estado. Inténtalo de nuevo.',
    timeout: 'La solicitud tardó demasiado; el resultado durable es incierto. Actualiza para confirmar antes de volver a intentarlo.',
    stale_control: 'El estado del compañero cambió. Actualiza la lista antes de volver a intentarlo.',
    conflict: 'El control cambió en otro lugar. Actualiza antes de volver a intentarlo.', unavailable: 'El control durable no está disponible. Actualiza para consultar de nuevo.',
    busy: 'El control está ocupado. Actualiza antes de volver a intentarlo.', durable_control_required: 'Este compañero requiere control durable. Actualiza el estado antes de continuar.',
  },
  en: {
    title: 'My companions', open: 'Open my companions', close: 'Close my companions',
    refresh: 'Refresh', refreshing: 'Refreshing…', stop: 'Stop', confirmStop: 'Confirm stop', stopping: 'Stopping…', resume: 'Allow connection', resuming: 'Saving…', closePanel: 'Close panel', configure: 'Profile',
    signed_out: 'Sign in to view your companions.', loading: 'Checking companions…',
    error: 'Could not load status. Try again.', offline: 'Offline. Companions are unavailable.',
    setupNote: 'You cannot configure a connection from the game yet.', configNote: 'The profile saves personality and goals. Model connection and memory are still pending.', sessionNote: 'This companion uses a session stop; it may reconnect after the server restarts.', durableNote: 'The stop is preserved between sessions. Allowing a connection requires the controller to reconnect; it does not start the companion automatically.',
    serverDisabled: 'Companions are disabled on this server.', ready: 'Status updated.',
    noCompanions: 'No companions are linked to this account.', fallbackName: (n) => `Companion ${n}`,
    online: 'Online', offlineAgent: 'Offline',
    active: 'Active', inactive: 'Inactive', stopped: 'Stopped', stopFailed: 'Could not stop this companion. Try again.', resumeFailed: 'Could not allow the connection. Refresh status before trying again.',
    savedStopped: 'Saved stop', defaultStopped: 'Stopped by default', savedRunning: 'Connection allowed and saved', localStop: 'Local stop not confirmed', controlPending: 'Durable control pending; not confirmed yet', controlUnavailable: 'Durable control unavailable; refresh to check again',
    refreshFailed: 'Could not refresh status. Try again.',
    timeout: 'The request took too long; the durable result is uncertain. Refresh to confirm before trying again.',
    stale_control: 'The companion state changed. Refresh the list before trying again.',
    conflict: 'Control changed elsewhere. Refresh before trying again.', unavailable: 'Durable control is unavailable. Refresh to check again.',
    busy: 'Control is busy. Refresh before trying again.', durable_control_required: 'This companion requires durable control. Refresh status before continuing.',
  },
};

let instanceSequence = 0;
const TERMINAL_STATES = new Set(['signed_out', 'offline']);
const MAX_REVISION = 2147483647;
function normalizeControl(control) {
  const valid = control && typeof control === 'object' && !Array.isArray(control)
    && Object.keys(control).length === 4 && ['status', 'revision', 'stopped', 'savedAt'].every(key => Object.hasOwn(control, key))
    && ['ready', 'pending', 'unavailable'].includes(control.status)
    && Number.isInteger(control.revision) && control.revision >= 0 && control.revision <= MAX_REVISION
    && typeof control.stopped === 'boolean'
    && (control.savedAt === null || (typeof control.savedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(control.savedAt)
      && Number.isFinite(Date.parse(control.savedAt)) && new Date(control.savedAt).toISOString() === control.savedAt))
    && !(control.revision === 0 && (control.stopped !== true || control.savedAt !== null))
    && !(control.revision > 0 && control.savedAt === null);
  return valid ? { status: control.status, revision: control.revision, stopped: control.stopped, savedAt: control.savedAt } : null;
}
const PANEL_CSS = `.mn-companions{position:relative;z-index:20;pointer-events:auto;font:500 14px/1.4 system-ui,sans-serif;color:#f4ead6}.mn-companions button{font:inherit;color:inherit;cursor:pointer;pointer-events:auto}.mn-companions-toggle,.mn-companions-refresh,.mn-companions-stop,.mn-companions-close{min-height:44px;box-sizing:border-box;border:1px solid #8c7656;border-radius:9px;background:#211d18;padding:9px 12px}.mn-companions-toggle:hover,.mn-companions-refresh:hover,.mn-companions-stop:hover,.mn-companions-close:hover{background:#393126}.mn-companions-panel{position:absolute;right:0;top:calc(100% + 8px);width:min(360px,calc(100cqw - 24px));max-height:min(calc(100cqh - 24px),520px);overflow:auto;padding:14px;border:1px solid #816d50;border-radius:14px;background:#171512;box-shadow:0 12px 32px #0009;pointer-events:auto}.mn-companions-header,.mn-companions-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.mn-companions-heading{display:flex;align-items:center;gap:8px}.mn-companions-header h2{margin:0;font-size:1.05rem}.mn-companions-close{width:44px;height:44px;flex:0 0 44px;padding:0;font-size:21px;line-height:1}.mn-companions-setup,.mn-companions-status{margin:12px 0;color:#d6c6aa}.mn-companions-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.mn-companions-row{padding:10px;border:1px solid #514736;border-radius:10px;background:#211e19}.mn-companions-info{display:grid;min-width:0;gap:3px}.mn-companions-actions{display:grid;flex:0 0 auto;gap:6px}.mn-companions-name{overflow-wrap:anywhere}.mn-companions-details{color:#b7aa92;font-size:.88rem}.mn-companions button:focus-visible{outline:2px solid #e5c477;outline-offset:2px}.mn-companions button:disabled{opacity:.58;cursor:wait}@media(max-width:600px){.mn-companions-panel{position:fixed;right:12px;top:auto;bottom:12px;width:min(360px,calc(100cqw - 24px));max-height:calc(100cqh - 24px)}.mn-companions-row{align-items:flex-start}}`;
const PORTAL_CSS = `.mn-companions-panel{position:fixed;z-index:50;inset:0;margin:auto;transform:none;width:min(420px,calc(100cqw - 24px));height:fit-content;max-height:calc(100cqh - 24px);box-sizing:border-box;font:500 14px/1.4 system-ui,sans-serif;color:#f4ead6}.mn-companions-panel button{font:inherit;color:inherit;cursor:pointer;pointer-events:auto}.mn-companions-panel button:focus-visible{outline:2px solid #e5c477;outline-offset:2px}.mn-companions-panel button:disabled{opacity:.58;cursor:wait}`;

function node(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function normalize(state) {
  const value = state && typeof state === 'object' ? state : {};
  const status = ['signed_out', 'loading', 'ready', 'error', 'offline'].includes(value.status) ? value.status : 'loading';
  const companions = TERMINAL_STATES.has(status) || !Array.isArray(value.companions) ? [] : value.companions
    .filter((row) => row && typeof row === 'object' && typeof row.characterKey === 'string' && row.characterKey.length > 0)
    .map((row) => ({
      characterKey: row.characterKey.slice(0, 120), online: Boolean(row.online), active: Boolean(row.active),
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 64) : null,
      epoch: Number.isSafeInteger(row.epoch) && row.epoch > 0 ? row.epoch : null,
      stopped: Boolean(row.stopped),
      capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((x) => typeof x === 'string').slice(0, 12) : [],
      ...(Object.hasOwn(row, 'control') ? { control: normalizeControl(row.control) || { status: 'unavailable', revision: 0, stopped: true, savedAt: null } } : {}),
    }));
  return {
    status, enabled: Boolean(value.enabled), companions,
    pendingStop: typeof value.pendingStop === 'string' ? value.pendingStop : null,
    pendingOp: ['stop', 'resume'].includes(value.pendingOp) ? value.pendingOp : null,
    pendingCharacter: typeof value.pendingCharacter === 'string' ? value.pendingCharacter
      : typeof value.pendingStop === 'string' ? value.pendingStop : null,
    message: ['timeout', 'stale_control', 'conflict', 'unavailable', 'busy', 'durable_control_required', 'forbidden', 'invalid_request', 'disabled'].includes(value.message) ? value.message : null,
  };
}

/**
 * Owner companion status and stop/resume panel.
 * getState() returns the documented state shape; onRefresh() requests a fresh snapshot;
 * onStop(characterKey, epoch) requests stop for that already-provisioned companion at the
 * displayed epoch. Durable stop/resume uses the client's displayed control revision. Neither callback
 * receives secrets. The owner/account identity remains the parent surface's responsibility.
 */
export class CompanionsUI {
  constructor(parent, { getState = () => null, onRefresh = () => {}, onStop = () => {}, onResume = () => {}, onVisibilityChange = () => {}, lang = 'es' } = {}) {
    if (!parent?.append) throw new TypeError('CompanionsUI requiere un elemento contenedor.');
    this.parent = parent;
    this.getState = getState;
    this.onRefresh = onRefresh;
    this.onStop = onStop;
    this.onResume = onResume;
    this.onVisibilityChange = onVisibilityChange;
    this.lang = lang === 'en' ? 'en' : 'es';
    this.visible = false;
    this.state = normalize(typeof getState === 'function' ? getState() : null);
    this.localPendingStop = new Set();
    this.localPendingControl = new Map();
    this.refreshPending = false;
    this.localError = '';

    this.container = node('section', 'mn-companions');
    this.installStyles();
    const id = `mn-companions-title-${++instanceSequence}`;
    this.container.setAttribute('aria-labelledby', id);
    this.toggleButton = node('button', 'mn-companions-toggle');
    this.toggleButton.type = 'button';
    this.toggleButton.setAttribute('aria-expanded', 'false');
    this.toggleButton.setAttribute('aria-controls', `mn-companions-panel-${instanceSequence}`);
    this.panel = node('div', 'mn-companions-panel');
    this.panel.id = `mn-companions-panel-${instanceSequence}`;
    this.panel.hidden = true;
    const header = node('header', 'mn-companions-header');
    this.title = node('h2', '', '');
    this.title.id = id;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', id);
    this.status = node('p', 'mn-companions-status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.list = node('ul', 'mn-companions-list');
    this.refreshButton = node('button', 'mn-companions-refresh');
    this.refreshButton.type = 'button';
    this.closeButton = node('button', 'mn-companions-close');
    this.closeButton.type = 'button';
    this.closeButton.addEventListener('click', () => this.close());
    const heading = node('div', 'mn-companions-heading');
    heading.append(this.title, this.closeButton);
    header.append(heading, this.refreshButton);
    this.setupNote = node('p', 'mn-companions-setup');
    this.sessionNote = node('p', 'mn-companions-setup');
    this.panel.append(header, this.setupNote, this.sessionNote, this.status, this.list);
    this.container.append(this.toggleButton);
    parent.append(this.container);
    this.portal = document.getElementById?.('ui') || parent;
    this.portal.append(this.panel);
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.refreshButton.addEventListener('click', () => this.refresh());
    this.handlePanelKeydown = (event) => {
      event.stopPropagation();
      if (event.key === 'Tab' && this.isOpen) {
        const buttons = this.focusables();
        const first = buttons[0], last = buttons.at(-1);
        const targetIsInside = buttons.includes(event.target);
        if (event.shiftKey && (!targetIsInside || event.target === first)) {
          event.preventDefault();
          last?.focus?.({ preventScroll: true });
        } else if (!event.shiftKey && (!targetIsInside || event.target === last)) {
          event.preventDefault();
          first?.focus?.({ preventScroll: true });
        }
      }
      if (event.key === 'Escape' && this.isOpen) {
        event.preventDefault();
        this.close();
      }
    };
    this.container.addEventListener('keydown', (event) => event.stopPropagation());
    this.panel.addEventListener('keydown', this.handlePanelKeydown);
    this.panel.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-control-key]');
      if (button) button.dataset.controlOp === 'resume' ? this.resume(button.dataset.controlKey) : this.stop(button.dataset.controlKey);
      const configure = event.target?.closest?.('[data-config-key]');
      if (configure) this.openConfiguration(configure.dataset.configKey);
    });
    this.setState(this.state);
    this.setVisible(false);
    this.render();
  }

  get isOpen() { return !this.panel.hidden; }

  installStyles() {
    if (!document.head || document.getElementById?.('mn-companions-style')) return;
    const style = node('style');
    style.id = 'mn-companions-style';
    style.textContent = PANEL_CSS + PORTAL_CSS;
    document.head.append(style);
  }

  setLanguage(lang) {
    this.lang = lang === 'en' ? 'en' : 'es';
    this.render();
  }

  setState(state) {
    this.state = normalize(state);
    if (TERMINAL_STATES.has(this.state.status)) {
      this.localPendingStop.clear();
      this.localPendingControl.clear();
      this.localError = '';
      this.refreshPending = false;
      this.configEditor?.reset();
    }
    this.render();
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.container.hidden = !this.visible;
    if (!this.visible) this.close();
  }

  toggle() { return this.isOpen ? this.close() : this.open(); }

  open() {
    if (!this.visible) return false;
    if (this.isOpen) return true;
    this.panel.hidden = false;
    this.toggleButton.setAttribute('aria-expanded', 'true');
    this.render();
    this.onVisibilityChange(true);
    this.closeButton.focus?.({ preventScroll: true });
    return true;
  }

  close() {
    const wasOpen = this.isOpen;
    this.panel.hidden = true;
    this.toggleButton.setAttribute('aria-expanded', 'false');
    this.configEditor?.close();
    if (wasOpen) {
      this.onVisibilityChange(false);
      if (this.visible) this.toggleButton.focus?.({ preventScroll: true });
    }
    return false;
  }

  async refresh() {
    if (this.refreshPending || !this.visible || this.state.status === 'signed_out' || this.state.status === 'offline') return;
    this.refreshPending = true;
    this.localError = '';
    this.render();
    try { await this.onRefresh(); }
    catch { this.localError = 'refreshFailed'; }
    finally { this.refreshPending = false; this.render(); }
  }

  async stop(characterKey) {
    if (!characterKey || this.localPendingControl.has(characterKey) || this.state.pendingStop || this.state.pendingOp || !this.state.enabled) return;
    const row = this.state.companions.find((item) => item.characterKey === characterKey);
    if (!row || (row.control && row.control.status !== 'ready')
      || (row.stopped && (!row.control || row.control.stopped === true))) return;
    this.localPendingStop.add(characterKey);
    this.localPendingControl.set(characterKey, 'stop');
    this.localError = '';
    this.render();
    try { await this.onStop(characterKey, row.epoch); }
    catch { this.localError = 'stopFailed'; }
    finally { this.localPendingStop.delete(characterKey); this.localPendingControl.delete(characterKey); this.render(); }
  }

  async resume(characterKey) {
    if (!characterKey || this.localPendingControl.has(characterKey) || this.state.pendingOp || !this.state.enabled) return;
    const row = this.state.companions.find((item) => item.characterKey === characterKey);
    if (!row?.stopped || row.control?.status !== 'ready') return;
    this.localPendingControl.set(characterKey, 'resume');
    this.localError = '';
    this.render();
    try { await this.onResume(characterKey, row.epoch); }
    catch { this.localError = 'resumeFailed'; }
    finally { this.localPendingControl.delete(characterKey); this.render(); }
  }

  setConfigurationEditor(editor) { this.configEditor = editor; this.render(); }
  openConfiguration(characterKey) {
    const row = this.state.companions.find(item => item.characterKey === characterKey);
    if (!this.configEditor || !row || this.state.status !== 'ready' || !this.state.enabled) return;
    this.configurationKey = characterKey;
    this.configEditor.open(characterKey, row.name || COPY[this.lang].fallbackName(this.state.companions.indexOf(row) + 1));
    this.render();
    this.configEditor.backButton?.focus?.({ preventScroll: true });
  }
  closeConfiguration() {
    this.configEditor?.close(); this.render();
    (this.configureButtons?.find(button => button.dataset.configKey === this.configurationKey) || this.closeButton).focus?.({ preventScroll: true });
  }

  render() {
    const text = COPY[this.lang];
    const focusedElement = document.activeElement;
    const focusedControlKey = focusedElement?.dataset?.controlKey || focusedElement?.dataset?.stopKey || null;
    const focusedControlOp = focusedElement?.dataset?.controlOp || null;
    const focusedConfigKey = focusedElement?.dataset?.configKey || null;
    this.title.textContent = text.title;
    this.toggleButton.textContent = text.title;
    this.closeButton.textContent = '×';
    this.closeButton.setAttribute('aria-label', text.closePanel);
    this.closeButton.title = text.closePanel;
    this.setupNote.textContent = this.configEditor ? `${text.configNote} ${text.setupNote}` : text.setupNote;
    const hasDurable = this.state.companions.some((companion) => companion.control);
    const hasLegacy = this.state.companions.some((companion) => !companion.control);
    this.sessionNote.textContent = [hasLegacy ? text.sessionNote : '', hasDurable ? text.durableNote : ''].filter(Boolean).join(' ');
    this.toggleButton.setAttribute('aria-label', this.isOpen ? text.close : text.open);
    this.refreshButton.textContent = this.refreshPending ? text.refreshing : text.refresh;
    this.refreshButton.disabled = this.refreshPending || !this.visible || ['signed_out', 'offline', 'loading'].includes(this.state.status);
    const status = this.state.message
      ? text[this.state.message]
      : this.state.status === 'ready'
        ? (!this.state.enabled ? text.serverDisabled : this.state.companions.length === 0 ? text.noCompanions : text.ready)
        : text[this.state.status] || text.loading;
    this.status.textContent = this.localError ? text[this.localError] : status;
    this.list.replaceChildren();
    this.stopButtons = [];
    this.resumeButtons = [];
    this.controlButtons = [];
    this.configureButtons = [];
    this.state.companions.forEach((companion, index) => {
      const item = node('li', 'mn-companions-row');
      const info = node('div', 'mn-companions-info');
      const name = node('strong', 'mn-companions-name', companion.name || text.fallbackName(index + 1));
      const runState = companion.stopped ? text.stopped : companion.active ? text.active : text.inactive;
      const detailParts = [companion.online ? text.online : text.offlineAgent, runState];
      if (companion.control) {
        if (companion.stopped && companion.control.stopped !== true) detailParts.push(text.localStop);
        if (companion.control.status === 'pending') detailParts.push(text.controlPending);
        else if (companion.control.status === 'unavailable') detailParts.push(text.controlUnavailable);
        else if (companion.control.stopped && companion.control.revision === 0) detailParts.push(text.defaultStopped);
        else if (companion.control.stopped) detailParts.push(text.savedStopped);
        else detailParts.push(text.savedRunning);
      }
      const details = node('span', 'mn-companions-details', detailParts.join(' · '));
      info.append(name, details);
      item.append(info);
      if (this.configEditor && this.state.enabled) {
        const configure = node('button', 'mn-companions-stop', text.configure);
        configure.type = 'button'; configure.dataset.configKey = companion.characterKey;
        configure.disabled = this.state.status !== 'ready';
        configure.setAttribute('aria-label', `${text.configure}: ${companion.name || text.fallbackName(index + 1)}`);
        item.append(configure); this.configureButtons.push(configure);
      }
      const pendingOp = this.localPendingControl.get(companion.characterKey)
        || (this.state.pendingCharacter === companion.characterKey ? this.state.pendingOp : null)
        || (this.state.pendingStop === companion.characterKey ? 'stop' : null);
      const durableReady = !companion.control || companion.control.status === 'ready';
      const canStop = this.state.enabled && durableReady && (!companion.stopped || (companion.control && companion.control.stopped !== true));
      const canResume = this.state.enabled && companion.control?.status === 'ready' && companion.stopped;
      const actions = node('div', 'mn-companions-actions');
      const localStopUnconfirmed = companion.control?.status === 'ready' && companion.stopped && companion.control.stopped !== true;
      for (const action of [canStop ? 'stop' : null, canResume ? 'resume' : null].filter(Boolean)) {
        const pending = pendingOp === action || Boolean(this.state.pendingOp);
        const actionText = action === 'resume'
          ? (pending ? text.resuming : text.resume)
          : (pending ? text.stopping : localStopUnconfirmed ? text.confirmStop : text.stop);
        const button = node('button', `mn-companions-stop${action === 'resume' ? ' mn-companions-resume' : ''}`, actionText);
        button.type = 'button';
        button.dataset.controlKey = companion.characterKey;
        button.dataset.controlOp = action;
        if (action === 'stop') button.dataset.stopKey = companion.characterKey;
        button.disabled = pending || Boolean(this.state.pendingStop) || this.state.status !== 'ready';
        button.setAttribute('aria-label', `${actionText}: ${companion.name || text.fallbackName(index + 1)}`);
        actions.append(button);
        this.controlButtons.push(button);
        if (action === 'stop') this.stopButtons.push(button);
        else this.resumeButtons.push(button);
      }
      if (actions.children.length) item.append(actions);
      this.list.append(item);
    });
    const configuring = this.configEditor?.isOpen === true;
    for (const el of [this.setupNote, this.sessionNote, this.status, this.list, this.refreshButton]) el.hidden = configuring;
    if (focusedConfigKey && !configuring) {
      (this.configureButtons.find(button => button.dataset.configKey === focusedConfigKey && !button.disabled) || this.closeButton).focus?.({ preventScroll: true });
    } else if (focusedControlKey) {
      const replacement = this.controlButtons.find((button) => button.dataset.controlKey === focusedControlKey
        && (!focusedControlOp || button.dataset.controlOp === focusedControlOp) && !button.disabled);
      (replacement || this.closeButton).focus?.({ preventScroll: true });
    } else if (focusedElement === this.refreshButton && this.refreshButton.disabled) {
      this.closeButton.focus?.({ preventScroll: true });
    }
  }

  focusables() {
    if (this.panel.querySelectorAll) return [...this.panel.querySelectorAll('button,input,textarea,select,[tabindex]')]
      .filter(el => !el.disabled && el.tabIndex !== -1 && !el.hidden && el.getClientRects().length > 0);
    return [this.closeButton, this.refreshButton, ...(this.configureButtons || []), ...(this.controlButtons || [])].filter((button) => button && !button.disabled && !button.hidden);
  }
}
