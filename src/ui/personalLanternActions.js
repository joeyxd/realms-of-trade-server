const RETRY_MS = 1000;
const TIMEOUT_MS = 5000;

const COPY = {
  es: { on: 'Encender luz', off: 'Apagar luz', pendingOn: 'Encendiendo…', pendingOff: 'Apagando…',
    lit: 'Luz encendida.', dark: 'Luz apagada.', delayed: 'La conexión tarda. La luz sigue bajo control del servidor.',
    command: 'No se pudo validar la solicitud de luz.', fireOn: 'Encender antorcha', fireOff: 'Apagar antorcha',
    firePendingOn: 'Encendiendo antorcha…', firePendingOff: 'Apagando antorcha…', fireLit: 'Antorcha encendida.',
    fireDark: 'Antorcha apagada.', fireEmpty: 'Crear antorcha (20 min)', fireDelayed: 'La conexión tarda. El combustible sigue bajo control del servidor.',
    fireDenied: 'No se pudo completar la acción de la antorcha.', goods: 'Necesitas una madera en la mochila.' },
  en: { on: 'Light lantern', off: 'Extinguish lantern', pendingOn: 'Lighting…', pendingOff: 'Extinguishing…',
    lit: 'Lantern lit.', dark: 'Lantern extinguished.', delayed: 'The connection is taking longer. The light remains under server control.',
    command: 'The light request could not be validated.', fireOn: 'Light torch', fireOff: 'Extinguish torch',
    firePendingOn: 'Lighting torch…', firePendingOff: 'Extinguishing torch…', fireLit: 'Torch lit.',
    fireDark: 'Torch extinguished.', fireEmpty: 'Craft torch (20 min)', fireDelayed: 'The connection is taking longer. Fuel remains under server control.',
    fireDenied: 'The torch action could not be completed.', goods: 'You need one wood in your pack.' },
};

const isDead = (entity, player) => !!entity?.dying || entity?.r?.act === 6 || entity?.r?.hp <= 0 || !!player?.dead;
const handFire = client => Array.isArray(client?.fire?.slots)
  ? client.fire.slots.find(slot => slot?.key === 'hand' && slot.kind === 'handTorch' && Number.isSafeInteger(slot.seconds) && slot.seconds >= 0 && typeof slot.lit === 'boolean')
  : null;
const timer = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, '0')}`;
const fireReason = (why, copy) => ({ goods: copy.goods, fuel: copy.fireDenied, full: copy.fireDenied,
  revision: copy.fireDenied, revisionLimit: copy.fireDenied, owner: copy.fireDenied, far: copy.fireDenied,
  condition: copy.fireDenied, busy: copy.fireDenied, dead: copy.fireDenied, account_required: copy.fireDenied,
  storage: copy.fireDenied, duplicate: copy.fireDenied, command: copy.fireDenied, disabled: copy.fireDenied })[why] || copy.fireDenied;

// Session-owned starter lantern. The button reflects only confirmed entity state; a click sends intent.
export class PersonalLanternActions {
  constructor({ client, parent, player = () => null, enabled = () => true, locale = () => 'es', toast = () => {}, openFuel = null, now = () => performance.now() }) {
    Object.assign(this, { client, parent, player, enabled, locale, toast, openFuel, now });
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
        const wasFire = this.pending.fire === true;
        this.pending = null;
        this.toast(wasFire ? this.copy.fireDelayed : this.copy.delayed);
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
    if (!entity || isDead(entity, this.player())) return false;
    if (c.fire?.enabled === true) { const slot = handFire(c); return !!slot?.lit && slot.seconds > 0; }
    return c.personalLantern === true;
  }

  toggle() {
    this.update();
    const c = this.client();
    if (this.pending || !this.enabled() || c !== this.owner || !c?.joined || c.youServer !== this.entity || isDead(c.entities?.get(c.youServer), this.player())) return false;
    if (c.fire?.enabled === true) {
      const slot = handFire(c);
      if (!slot || slot.seconds <= 0) {
        try { this.openFuel?.({ ship: '', part: 'hand', kind: 'handTorch' }); } catch { /* The panel hook is optional. */ }
        return typeof this.openFuel === 'function';
      }
      if (!Number.isSafeInteger(c.fire.rev) || c.fire.rev < 0) return false;
      const command = Object.freeze({ t: 'cmd', type: 'fire', op: 'set', opId: globalThis.crypto.randomUUID(),
        ship: '', part: 'hand', kind: 'handTorch', expectedRev: c.fire.rev, lit: !slot.lit });
      this.pending = { command, sentAt: this.now(), retried: false, fire: true };
      try { c.send(command); } catch { this.pending = null; this.render(); return false; }
      this.render(); return true;
    }
    const command = Object.freeze({ t: 'cmd', type: 'personalLantern', lit: !this.state(), opId: globalThis.crypto.randomUUID() });
    this.pending = { command, sentAt: this.now(), retried: false };
    try { c.send(command); } catch { this.pending = null; this.render(); return false; }
    this.render();
    return true;
  }

  acknowledge(ev) {
    this.update();
    const pending = this.pending;
    if (ev?.type === 'fire' && pending?.fire && ev.op === 'set' && ev.opId === pending.command.opId) {
      this.pending = null;
      if (ev.ok === true) this.toast(pending.command.lit ? this.copy.fireLit : this.copy.fireDark);
      else this.toast(fireReason(ev.why, this.copy));
      this.render(); return true;
    }
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
    const fuelEnabled = c?.fire?.enabled === true;
    const fire = fuelEnabled ? handFire(c) : null;
    const lit = visible && (fuelEnabled ? !!fire?.lit && fire.seconds > 0 : c.personalLantern === true);
    const progress = this.pending && (this.pending.fire
      ? (this.pending.command.lit ? this.copy.firePendingOn : this.copy.firePendingOff)
      : (this.pending.command.lit ? this.copy.pendingOn : this.copy.pendingOff));
    const label = fuelEnabled
      ? progress || (fire?.seconds > 0 ? (lit ? this.copy.fireOff : this.copy.fireOn) : this.copy.fireEmpty)
      : progress || (lit ? this.copy.off : this.copy.on);
    const locale = this.locale() === 'en' ? 'en' : 'es';
    const text = fuelEnabled
      ? `${locale === 'en' ? 'Torch' : 'Antorcha'} N${fire?.seconds > 0 ? ` · ${timer(fire.seconds)}` : ''}`
      : locale === 'en' ? 'Lantern N' : 'Farol N';
    const key = `${visible}|${lit}|${!!progress}|${label}|${text}|${locale}`;
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
