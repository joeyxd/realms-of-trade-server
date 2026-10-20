const COPY = {
  es: {
    title: 'Conectar en mi PC', back: 'Volver', allowFirst: 'Primero, usa «Permitir conexión» en el panel existente de este compañero. Después genera aquí un código de emparejamiento. Permitir conexión no inicia al compañero por sí solo.',
    privateCode: 'Código privado de un solo uso. Caduca en cinco minutos; pégalo en la entrada privada del controlador local. No lo compartas.',
    revokeHelp: 'Revocar conexión invalida todos los códigos de emparejamiento y las sesiones del controlador.',
    generate: 'Generar código de emparejamiento', generating: 'Generando…', revoke: 'Revocar conexión', reload: 'Recargar estado', copy: 'Copiar código', copied: 'Código copiado.', copyFailed: 'No se pudo copiar. Selecciona el código y cópialo manualmente.',
    codeLabel: 'Código de emparejamiento', expiry: 'Caduca', disabled: 'La conexión está apagada. Vuelve al panel existente y permite la conexión antes de generar el código.',
    guide: 'En esta PC, instala o abre el controlador local y ejecútalo con el endpoint seguro del mundo. Luego pega el código en su prompt privado; nunca lo incluyas en argumentos, enlaces, logs ni archivos.',
    command: url => `node tools/agent/pair-companion.mjs --url ${url || 'wss://TU-MUNDO/ws'} --directory RUTA_LOCAL --base-url http://127.0.0.1:8080/v1 --model qwen3.8-flash-next-coder-iq1_m --max-calls 8 --max-tokens 262144`,
    signed_out: 'Inicia sesión para emparejar un controlador local.', offline: 'Conéctate al mundo para emparejar un controlador local.', loading: 'Consultando el emparejamiento…', ready: 'Estado actualizado.', error: 'No se pudo completar la solicitud. Inténtalo de nuevo.', uncertain: 'No se pudo confirmar la operación. Actualiza el estado antes de generar otro código.',
    forbidden: 'Esta cuenta no puede emparejar el compañero.', invalid_request: 'La solicitud no es válida.', unavailable: 'El servicio de emparejamiento no está disponible.', busy: 'Hay otra operación en curso.', stopped: 'El compañero está detenido. Permite la conexión en el panel existente antes de emparejar.', not_created: 'Todavía no hay un compañero creado para esta cuenta.', timeout: 'La consulta tardó demasiado.',
    presence_body_required: 'Invoca primero a tu compañero.',
  },
  en: {
    title: 'Connect on my PC', back: 'Back', allowFirst: 'First, use “Allow connection” in this companion’s existing panel. Then generate a pairing code here. Allowing a connection does not start the companion by itself.',
    privateCode: 'Private, one-use code. It expires in five minutes; paste it into the local controller’s private input. Do not share it.',
    revokeHelp: 'Revoking the connection invalidates every pairing code and controller session.',
    generate: 'Generate pairing code', generating: 'Generating…', revoke: 'Revoke connection', reload: 'Reload status', copy: 'Copy code', copied: 'Code copied.', copyFailed: 'Could not copy. Select the code and copy it manually.',
    codeLabel: 'Pairing code', expiry: 'Expires', disabled: 'Connection is off. Return to the existing panel and allow the connection before generating a code.',
    guide: 'On this PC, install or open the local controller and start it with the safe world endpoint. Then paste the code into its private prompt; never put it in arguments, links, logs, or files.',
    command: url => `node tools/agent/pair-companion.mjs --url ${url || 'wss://YOUR-WORLD/ws'} --directory LOCAL_PATH --base-url http://127.0.0.1:8080/v1 --model qwen3.8-flash-next-coder-iq1_m --max-calls 8 --max-tokens 262144`,
    signed_out: 'Sign in to pair a local controller.', offline: 'Connect to the world to pair a local controller.', loading: 'Checking pairing…', ready: 'Status updated.', error: 'The request could not be completed. Try again.', uncertain: 'The operation could not be confirmed. Reload status before generating another code.',
    forbidden: 'This account cannot pair the companion.', invalid_request: 'The request is invalid.', unavailable: 'The pairing service is unavailable.', busy: 'Another operation is in progress.', stopped: 'The companion is stopped. Allow the connection in its existing panel before pairing.', not_created: 'This account does not have a created companion yet.', timeout: 'The request took too long.',
    presence_body_required: 'Summon your companion first.',
  },
};

const node = (tag, className = '', text = '') => { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; };
let instanceSequence = 0;
const CSS = `.mn-companion-pairing{display:grid;gap:12px;min-width:0;width:100%;max-width:100%;box-sizing:border-box}.mn-companion-pairing[hidden],.mn-companion-pairing [hidden]{display:none!important}.mn-companion-pairing>*{min-width:0;overflow-wrap:anywhere}.mn-companion-pairing-header,.mn-companion-pairing-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.mn-companion-pairing-header h3{margin:0;font-size:1.05rem}.mn-companion-pairing button{min-height:44px;border:1px solid #8c7656;border-radius:9px;background:#29241e;color:#f4ead6;padding:9px 12px;font:600 14px/1.3 system-ui,sans-serif;cursor:pointer}.mn-companion-pairing button:disabled{opacity:.6;cursor:wait}.mn-companion-pairing button:focus-visible{outline:2px solid #e5c477;outline-offset:2px}.mn-companion-pairing-status,.mn-companion-pairing-note{margin:0;color:#d6c6aa}.mn-companion-pairing-code{display:grid;gap:8px;padding:12px;border:1px solid #806b45;border-radius:10px;background:#211e19}.mn-companion-pairing-code-value{font:600 15px/1.5 ui-monospace,monospace;letter-spacing:.04em;user-select:all;overflow-wrap:anywhere}.mn-companion-pairing-guide{display:grid;gap:8px;padding:12px;border:1px solid #514736;border-radius:10px;background:#211e19}.mn-companion-pairing-command{display:block;white-space:pre-wrap;overflow-wrap:anywhere;padding:9px;border-radius:7px;background:#171512;color:#f4ead6;font:500 12px/1.5 ui-monospace,monospace}.mn-companion-pairing-actions{flex-wrap:wrap}@media(max-width:600px){.mn-companion-pairing-header,.mn-companion-pairing-actions{align-items:stretch;flex-direction:column}.mn-companion-pairing-header button,.mn-companion-pairing-actions button{width:100%}}`;

/** Private local-controller pairing subview within the existing companions panel. */
export class CompanionPairingUI {
  constructor(parent, { client, lang = 'es', onClose = () => {} } = {}) {
    if (!parent?.append || !client?.load || !client?.issue || !client?.revoke || !client?.subscribe) {
      throw new TypeError('CompanionPairingUI requiere parent y client.');
    }
    this.parent = parent; this.client = client; this.lang = lang === 'en' ? 'en' : 'es'; this.onClose = onClose;
    this.active = false; this.state = client.snapshot?.() || { status: 'offline', enabled: false, code: null, expiresAtMs: null, message: '' };
    const id = ++instanceSequence;
    this.container = node('section', 'mn-companion-pairing'); this.container.hidden = true;
    this.container.setAttribute('aria-labelledby', `mn-companion-pairing-title-${id}`);
    this.title = node('h3'); this.title.id = `mn-companion-pairing-title-${id}`;
    this.backButton = node('button', 'mn-companion-pairing-back'); this.backButton.type = 'button';
    this.backButton.addEventListener('click', () => { this.close(); this.onClose(); });
    const header = node('header', 'mn-companion-pairing-header'); header.append(this.title, this.backButton);
    this.status = node('p', 'mn-companion-pairing-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.allowNote = node('p', 'mn-companion-pairing-note');
    this.disabledNote = node('p', 'mn-companion-pairing-note');
    this.bodyNote = node('p', 'mn-companion-pairing-note'); this.bodyNote.hidden = true;
    this.revokeNote = node('p', 'mn-companion-pairing-note');
    this.codePanel = node('section', 'mn-companion-pairing-code'); this.codePanel.hidden = true;
    this.codeHeading = node('strong'); this.codeNote = node('p', 'mn-companion-pairing-note'); this.codeText = node('code', 'mn-companion-pairing-code-value');
    this.expiry = node('p', 'mn-companion-pairing-note'); this.copyButton = node('button'); this.copyButton.type = 'button';
    this.copyButton.addEventListener('click', () => this.copyCode());
    this.codePanel.append(this.codeHeading, this.codeNote, this.codeText, this.expiry, this.copyButton);
    this.guide = node('section', 'mn-companion-pairing-guide'); this.guideText = node('p', 'mn-companion-pairing-note'); this.command = node('code', 'mn-companion-pairing-command');
    this.guide.append(this.guideText, this.command);
    this.generateButton = node('button'); this.generateButton.type = 'button'; this.generateButton.addEventListener('click', () => this.generate());
    this.revokeButton = node('button'); this.revokeButton.type = 'button'; this.revokeButton.addEventListener('click', () => this.revoke());
    this.reloadButton = node('button'); this.reloadButton.type = 'button'; this.reloadButton.addEventListener('click', () => this.reload());
    const actions = node('footer', 'mn-companion-pairing-actions'); actions.append(this.generateButton, this.revokeButton, this.reloadButton);
    this.container.append(header, this.status, this.allowNote, this.disabledNote, this.bodyNote, this.revokeNote, this.codePanel, this.guide, actions);
    this.element = this.container; parent.append(this.container); this.installStyles();
    this.unsubscribe = client.subscribe(state => this.onClientState(state));
    this.render();
  }
  get isOpen() { return this.active; }
  installStyles() { if (!document.head || document.getElementById?.('mn-companion-pairing-style')) return; const style = node('style'); style.id = 'mn-companion-pairing-style'; style.textContent = CSS; document.head.append(style); }
  text() { return COPY[this.lang]; }
  setLanguage(lang) { this.lang = lang === 'en' ? 'en' : 'es'; this.render(); }
  open() {
    this.active = true; this.state = this.client.snapshot?.() || this.state; this.container.hidden = false; this.render();
    if (!this.client.load()) { this.statusKey = 'busy'; this.render(); return false; }
    return true;
  }
  close() { if (!this.active) return false; this.active = false; this.container.hidden = true; return true; }
  reset() {
    this.active = false; this.state = { ...this.state, code: null, expiresAtMs: null };
    this.container.hidden = true; this.codeText.textContent = ''; this.expiry.textContent = ''; this.status.textContent = '';
    this.statusKey = ''; this.codePanel.hidden = true; return false;
  }
  onClientState(state) {
    this.state = state;
    if (state.status === 'signed_out' || state.status === 'offline') { this.reset(); this.state = state; return; }
    this.statusKey = ['error', 'uncertain'].includes(state.status) ? state.message || state.status : '';
    if (this.active) this.render();
  }
  // With body presence on, a code is useful only while the companion's body is in the world.
  needsBody() { return this.client.bodyGate?.()?.present === false; }
  generate() { if (!this.active || this.state.status !== 'ready' || !this.state.enabled || this.needsBody()) return false; this.statusKey = ''; return this.client.issue(); }
  revoke() { if (!this.active || this.state.status !== 'ready' || !this.state.enabled) return false; this.statusKey = ''; return this.client.revoke(); }
  reload() {
    if (!this.active || !['error', 'uncertain'].includes(this.state.status)) return false;
    this.statusKey = ''; return this.client.load();
  }
  async copyCode() {
    if (!this.state.code || !this.active) return false;
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await globalThis.navigator.clipboard.writeText(this.state.code); this.statusKey = 'copied';
    } catch { this.statusKey = 'copyFailed'; }
    this.render(); return this.statusKey === 'copied';
  }
  render() {
    const c = this.text(); this.title.textContent = c.title; this.backButton.textContent = c.back;
    this.allowNote.textContent = c.allowFirst; this.disabledNote.textContent = c.disabled;
    this.revokeNote.textContent = c.revokeHelp;
    this.guideText.textContent = c.guide; this.command.textContent = c.command(this.client.controllerUrl || '');
    this.generateButton.textContent = this.state.status === 'loading' ? c.generating : c.generate;
    this.revokeButton.textContent = c.revoke; this.reloadButton.textContent = c.reload; this.copyButton.textContent = c.copy;
    this.status.textContent = this.statusKey ? c[this.statusKey] || c.error : c[this.state.status] || c.error;
    const busy = ['loading'].includes(this.state.status), needsBody = this.needsBody();
    this.generateButton.disabled = busy || this.state.status !== 'ready' || !this.state.enabled || needsBody;
    this.bodyNote.textContent = c.presence_body_required;
    this.bodyNote.hidden = !needsBody || this.state.status !== 'ready' || !this.state.enabled || Boolean(this.state.code);
    this.generateButton.hidden = Boolean(this.state.code);
    this.revokeButton.hidden = this.state.status !== 'ready' || !this.state.enabled; this.revokeButton.disabled = busy;
    this.revokeNote.hidden = this.revokeButton.hidden;
    this.reloadButton.hidden = !['error', 'uncertain'].includes(this.state.status); this.reloadButton.disabled = busy;
    this.disabledNote.hidden = this.state.status !== 'ready' || this.state.enabled;
    this.codePanel.hidden = !this.state.code;
    if (this.state.code) {
      this.codeHeading.textContent = c.codeLabel; this.codeText.textContent = this.state.code;
      this.codeNote.textContent = c.privateCode;
      this.expiry.textContent = `${c.expiry}: ${new Date(this.state.expiresAtMs).toLocaleString(this.lang === 'es' ? 'es-MX' : 'en-US')}`;
      this.copyButton.textContent = c.copy;
    } else { this.codeText.textContent = ''; this.expiry.textContent = ''; }
  }
  destroy() { this.unsubscribe?.(); this.reset(); }
}
