const RETRY_MS = 1000;
const TIMEOUT_MS = 5000;

const COPY = {
  es: { on: 'Encender luz', off: 'Apagar luz', pendingOn: 'Encendiendo…', pendingOff: 'Apagando…',
    lit: 'Luz encendida.', dark: 'Luz apagada.', delayed: 'La conexión tarda. La luz sigue bajo control del servidor.',
    command: 'No se pudo validar la solicitud de luz.' },
  en: { on: 'Light lantern', off: 'Extinguish lantern', pendingOn: 'Lighting…', pendingOff: 'Extinguishing…',
    lit: 'Lantern lit.', dark: 'Lantern extinguished.', delayed: 'The connection is taking longer. The light remains under server control.',
    command: 'The light request could not be validated.' },
};

const isDead = (entity, player) => !!entity?.dying || entity?.r?.act === 6 || entity?.r?.hp <= 0 || !!player?.dead;

// Session-owned starter lantern. The button reflects only confirmed entity state; a click sends intent.
export class PersonalLanternActions {
  constructor({ client, parent, player = () => null, enabled = () => true, locale = () => 'es', toast = () => {}, now = () => performance.now() }) {
    Object.assign(this, { client, parent, player, enabled, locale, toast, now });
    this.pending = null;
    this.owner = null;
    this.entity = 0;
    this.button = null;
    this.renderKey = '';
    if (parent?.ownerDocument) this.mount(parent.ownerDocument);
  }

  get copy() { return COPY[this.locale()] || COPY.es; }

  mount(doc) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.id = 'personal-lantern';
    button.className = 'personal-lantern interactive';
    button.setAttribute('aria-pressed', 'false');
    button.hidden = true;
    button.addEventListener('click', () => this.toggle());
    this.parent.appendChild(button);
    this.button = button;
    this.render();
  }

  reset() {
    this.pending = null;
    this.owner = null;
    this.entity = 0;
    this.render();
  }

  dispose() {
    this.reset();
    this.button?.remove?.();
    this.button = null;
    this.renderKey = '';
  }

  update() {
    const c = this.client();
    const valid = !!(c?.joined && c.youServer && c.entities?.get(c.youServer) && !isDead(c.entities.get(c.youServer), this.player()));
    if (!valid || c !== this.owner || c.youServer !== this.entity) {
      this.reset();
      if (valid) { this.owner = c; this.entity = c.youServer; }
    }
    if (this.pending) {
      const elapsed = this.now() - this.pending.sentAt;
      if (elapsed >= TIMEOUT_MS) {
        this.pending = null;
        this.toast(this.copy.delayed);
      } else if (!this.pending.retried && elapsed >= RETRY_MS) {
        this.pending.retried = true;
        try { c.send(this.pending.command); } catch { /* Retry the same intent only once. */ }
      }
    }
    this.render();
  }

  state() {
    const c = this.client();
    if (c !== this.owner || !c?.joined || c.youServer !== this.entity) return false;
    const entity = c.entities?.get(c.youServer);
    return !!entity && !isDead(entity, this.player()) && c.personalLantern === true;
  }

  toggle() {
    this.update();
    const c = this.client();
    if (this.pending || !this.enabled() || c !== this.owner || !c?.joined || c.youServer !== this.entity || isDead(c.entities?.get(c.youServer), this.player())) return false;
    const command = Object.freeze({ t: 'cmd', type: 'personalLantern', lit: !this.state(), opId: globalThis.crypto.randomUUID() });
    this.pending = { command, sentAt: this.now(), retried: false };
    try { c.send(command); } catch { this.pending = null; this.render(); return false; }
    this.render();
    return true;
  }

  acknowledge(ev) {
    this.update();
    const pending = this.pending;
    if (!ev || ev.type !== 'personalLantern' || !pending || ev.opId !== pending.command.opId) return false;
    this.pending = null;
    if (ev.ok === true) this.toast(pending.command.lit ? this.copy.lit : this.copy.dark);
    else this.toast(this.copy.command);
    this.render();
    return true;
  }

  render() {
    if (!this.button) return;
    const c = this.client?.();
    const entity = c?.entities?.get(c.youServer);
    const visible = !!(c?.joined && c.youServer && this.enabled() && c === this.owner && c.youServer === this.entity && entity && !isDead(entity, this.player()));
    const lit = visible && c.personalLantern === true;
    const progress = this.pending && (this.pending.command.lit ? this.copy.pendingOn : this.copy.pendingOff);
    const label = progress || (lit ? this.copy.off : this.copy.on);
    const locale = this.locale() === 'en' ? 'en' : 'es';
    const text = locale === 'en' ? 'Lantern N' : 'Farol N';
    const key = `${visible}|${lit}|${!!progress}|${label}|${locale}`;
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.button.hidden = !visible;
    this.button.disabled = !!this.pending;
    this.button.setAttribute('aria-pressed', String(lit));
    this.button.setAttribute('aria-label', `${label} (N)`);
    this.button.title = `${label} (N)`;
    this.button.textContent = text;
  }
}
