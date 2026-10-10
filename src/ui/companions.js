// Small authenticated companion status panel. Callbacks own all account and server authority.
const COPY = {
  es: {
    title: 'Mis compañeros', open: 'Abrir mis compañeros', close: 'Cerrar mis compañeros',
    refresh: 'Actualizar', refreshing: 'Actualizando…', stop: 'Detener', stopping: 'Deteniendo…', closePanel: 'Cerrar panel', configure: 'Ficha',
    signed_out: 'Inicia sesión para consultar tus compañeros.', loading: 'Consultando compañeros…',
    error: 'No se pudo consultar el estado. Inténtalo de nuevo.', offline: 'Sin conexión. Los compañeros no están disponibles.',
    setupNote: 'Aún no puedes configurar una conexión desde el juego.', configNote: 'La ficha guarda personalidad y objetivos. Conexión al modelo y memoria siguen pendientes.', sessionNote: 'La detención dura esta sesión del servidor; tras reiniciar, tendrás que detenerlo de nuevo.',
    serverDisabled: 'Los compañeros están desactivados en este servidor.', ready: 'Estado actualizado.',
    noCompanions: 'No hay compañeros vinculados a esta cuenta.', fallbackName: (n) => `Compañero ${n}`,
    online: 'En línea', offlineAgent: 'Desconectado',
    active: 'Activo', inactive: 'Inactivo', stopped: 'Detenido', stopFailed: 'No se pudo detener el compañero. Inténtalo de nuevo.',
    refreshFailed: 'No se pudo actualizar el estado. Inténtalo de nuevo.',
    timeout: 'La solicitud tardó demasiado. Puedes actualizar el estado o volver a detener al compañero.',
    stale_control: 'El estado del compañero cambió. Actualiza la lista antes de volver a intentarlo.',
  },
  en: {
    title: 'My companions', open: 'Open my companions', close: 'Close my companions',
    refresh: 'Refresh', refreshing: 'Refreshing…', stop: 'Stop', stopping: 'Stopping…', closePanel: 'Close panel', configure: 'Profile',
    signed_out: 'Sign in to view your companions.', loading: 'Checking companions…',
    error: 'Could not load status. Try again.', offline: 'Offline. Companions are unavailable.',
    setupNote: 'You cannot configure a connection from the game yet.', configNote: 'The profile saves personality and goals. Model connection and memory are still pending.', sessionNote: 'Stopping lasts for this server session; after a restart, you may need to stop the companion again.',
    serverDisabled: 'Companions are disabled on this server.', ready: 'Status updated.',
    noCompanions: 'No companions are linked to this account.', fallbackName: (n) => `Companion ${n}`,
    online: 'Online', offlineAgent: 'Offline',
    active: 'Active', inactive: 'Inactive', stopped: 'Stopped', stopFailed: 'Could not stop this companion. Try again.',
    refreshFailed: 'Could not refresh status. Try again.',
    timeout: 'The request took too long. Refresh status or try stopping the companion again.',
    stale_control: 'The companion state changed. Refresh the list before trying again.',
  },
};

let instanceSequence = 0;
const TERMINAL_STATES = new Set(['signed_out', 'offline']);
const PANEL_CSS = `.mn-companions{position:relative;z-index:20;pointer-events:auto;font:500 14px/1.4 system-ui,sans-serif;color:#f4ead6}.mn-companions button{font:inherit;color:inherit;cursor:pointer;pointer-events:auto}.mn-companions-toggle,.mn-companions-refresh,.mn-companions-stop,.mn-companions-close{border:1px solid #8c7656;border-radius:9px;background:#211d18;padding:9px 12px}.mn-companions-toggle:hover,.mn-companions-refresh:hover,.mn-companions-stop:hover,.mn-companions-close:hover{background:#393126}.mn-companions-panel{position:absolute;right:0;top:calc(100% + 8px);width:min(360px,calc(100cqw - 24px));max-height:min(calc(100cqh - 24px),520px);overflow:auto;padding:14px;border:1px solid #816d50;border-radius:14px;background:#171512;box-shadow:0 12px 32px #0009;pointer-events:auto}.mn-companions-header,.mn-companions-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.mn-companions-heading{display:flex;align-items:center;gap:8px}.mn-companions-header h2{margin:0;font-size:1.05rem}.mn-companions-close{width:34px;height:34px;flex:0 0 34px;padding:0;font-size:21px;line-height:1}.mn-companions-setup,.mn-companions-status{margin:12px 0;color:#d6c6aa}.mn-companions-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.mn-companions-row{padding:10px;border:1px solid #514736;border-radius:10px;background:#211e19}.mn-companions-info{display:grid;min-width:0;gap:3px}.mn-companions-name{overflow-wrap:anywhere}.mn-companions-details{color:#b7aa92;font-size:.88rem}.mn-companions button:focus-visible{outline:2px solid #e5c477;outline-offset:2px}.mn-companions button:disabled{opacity:.58;cursor:wait}@media(max-width:600px){.mn-companions-panel{position:fixed;right:12px;top:auto;bottom:12px;width:min(360px,calc(100cqw - 24px));max-height:calc(100cqh - 24px)}.mn-companions-row{align-items:flex-start}}`;
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
    }));
  return {
    status, enabled: Boolean(value.enabled), companions,
    pendingStop: typeof value.pendingStop === 'string' ? value.pendingStop : null,
    message: ['timeout', 'stale_control'].includes(value.message) ? value.message : null,
  };
}

/**
 * Owner companion status and stop panel.
 * getState() returns the documented state shape; onRefresh() requests a fresh snapshot;
 * onStop(characterKey, epoch) requests stop for that already-provisioned companion at the
 * displayed epoch. Neither callback
 * receives secrets. The owner/account identity remains the parent surface's responsibility.
 */
export class CompanionsUI {
  constructor(parent, { getState = () => null, onRefresh = () => {}, onStop = () => {}, onVisibilityChange = () => {}, lang = 'es' } = {}) {
    if (!parent?.append) throw new TypeError('CompanionsUI requiere un elemento contenedor.');
    this.parent = parent;
    this.getState = getState;
    this.onRefresh = onRefresh;
    this.onStop = onStop;
    this.onVisibilityChange = onVisibilityChange;
    this.lang = lang === 'en' ? 'en' : 'es';
    this.visible = false;
    this.state = normalize(typeof getState === 'function' ? getState() : null);
    this.localPendingStop = new Set();
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
      const button = event.target?.closest?.('[data-stop-key]');
      if (button) this.stop(button.dataset.stopKey);
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
    if (!characterKey || this.localPendingStop.has(characterKey) || this.state.pendingStop || !this.state.enabled) return;
    const row = this.state.companions.find((item) => item.characterKey === characterKey);
    if (!row || row.stopped) return;
    this.localPendingStop.add(characterKey);
    this.localError = '';
    this.render();
    try { await this.onStop(characterKey, row.epoch); }
    catch { this.localError = 'stopFailed'; }
    finally { this.localPendingStop.delete(characterKey); this.render(); }
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
    const focusedStopKey = focusedElement?.dataset?.stopKey || null;
    const focusedConfigKey = focusedElement?.dataset?.configKey || null;
    this.title.textContent = text.title;
    this.toggleButton.textContent = text.title;
    this.closeButton.textContent = '×';
    this.closeButton.setAttribute('aria-label', text.closePanel);
    this.closeButton.title = text.closePanel;
    this.setupNote.textContent = this.configEditor ? `${text.configNote} ${text.setupNote}` : text.setupNote;
    this.sessionNote.textContent = text.sessionNote;
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
    this.configureButtons = [];
    this.state.companions.forEach((companion, index) => {
      const item = node('li', 'mn-companions-row');
      const info = node('div', 'mn-companions-info');
      const name = node('strong', 'mn-companions-name', companion.name || text.fallbackName(index + 1));
      const runState = companion.stopped ? text.stopped : companion.active ? text.active : text.inactive;
      const details = node('span', 'mn-companions-details', `${companion.online ? text.online : text.offlineAgent} · ${runState}`);
      info.append(name, details);
      item.append(info);
      if (this.configEditor && this.state.enabled) {
        const configure = node('button', 'mn-companions-stop', text.configure);
        configure.type = 'button'; configure.dataset.configKey = companion.characterKey;
        configure.disabled = this.state.status !== 'ready';
        configure.setAttribute('aria-label', `${text.configure}: ${companion.name || text.fallbackName(index + 1)}`);
        item.append(configure); this.configureButtons.push(configure);
      }
      const pending = this.localPendingStop.has(companion.characterKey) || this.state.pendingStop === companion.characterKey;
      const canStop = this.state.enabled && !companion.stopped;
      if (canStop) {
        const button = node('button', 'mn-companions-stop', pending ? text.stopping : text.stop);
        button.type = 'button';
        button.dataset.stopKey = companion.characterKey;
        button.disabled = pending || Boolean(this.state.pendingStop) || this.state.status !== 'ready';
        button.setAttribute('aria-label', `${pending ? text.stopping : text.stop}: ${companion.name || text.fallbackName(index + 1)}`);
        item.append(button);
        this.stopButtons.push(button);
      }
      this.list.append(item);
    });
    const configuring = this.configEditor?.isOpen === true;
    for (const el of [this.setupNote, this.sessionNote, this.status, this.list, this.refreshButton]) el.hidden = configuring;
    if (focusedConfigKey && !configuring) {
      (this.configureButtons.find(button => button.dataset.configKey === focusedConfigKey && !button.disabled) || this.closeButton).focus?.({ preventScroll: true });
    } else if (focusedStopKey) {
      const replacement = this.stopButtons.find((button) => button.dataset.stopKey === focusedStopKey && !button.disabled);
      (replacement || this.closeButton).focus?.({ preventScroll: true });
    } else if (focusedElement === this.refreshButton && this.refreshButton.disabled) {
      this.closeButton.focus?.({ preventScroll: true });
    }
  }

  focusables() {
    if (this.panel.querySelectorAll) return [...this.panel.querySelectorAll('button,input,textarea,select,[tabindex]')]
      .filter(el => !el.disabled && el.tabIndex !== -1 && !el.hidden && el.getClientRects().length > 0);
    return [this.closeButton, this.refreshButton, ...(this.configureButtons || []), ...(this.stopButtons || [])].filter((button) => button && !button.disabled && !button.hidden);
  }
}
