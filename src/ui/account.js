// Small title-screen account panel; credentials stay in the form and never enter game settings.
export class AccountPanel {
  constructor(parent, auth, { hasLegacySave = () => false, onChange = null } = {}) {
    this.auth = auth;
    this.hasLegacySave = hasLegacySave;
    this.onChange = onChange;
    this.boarding = false;
    this.import = false;
    this.notice = '';
    this.container = parent?.matches?.('.title-actions') ? parent : parent?.querySelector?.('.title-actions');
    if (!this.container) throw new Error('AccountPanel requiere el contenedor .title-actions');

    this.launch = document.createElement('div');
    this.launch.className = 'account-launch';
    this.launch.innerHTML = '<button type="button" class="account-open" aria-haspopup="dialog">Cuenta</button><span class="account-status" aria-live="polite"></span>';
    (this.container.querySelector('.title-net') || this.container).append(this.launch);
    this.openButton = this.launch.querySelector('.account-open');
    this.status = this.launch.querySelector('.account-status');

    this.overlay = document.createElement('div');
    this.overlay.className = 'account-overlay';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" tabindex="-1">
        <header class="account-dialog-head"><h2 id="account-title">Tu cuenta</h2><button class="account-close" type="button" aria-label="Cerrar">×</button></header>
        <p class="account-copy">Inicia sesión para usar tu cuenta en línea.</p>
        <form class="account-form" novalidate>
          <label>Correo electrónico<input name="email" type="email" autocomplete="email" required></label>
          <label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label>
          <div class="account-buttons"><button type="submit" data-action="login">Iniciar sesión</button><button type="submit" data-action="signup">Crear cuenta</button></div>
        </form>
        <div class="account-signed" hidden><p class="account-email"></p><button class="account-logout" type="button">Cerrar sesión</button></div>
        <div class="account-import" hidden><label><input class="account-import-toggle" type="checkbox"><span>Importar mi partida anterior (solo si la cuenta es nueva)</span></label><p>Si la cuenta ya tiene partida, prevalece esa partida; no se combinan datos.</p></div>
        <p class="account-feedback" role="status" aria-live="polite"></p>
        <button class="account-guest" type="button">Jugar como invitado</button>
        <p class="account-guest-note">Elige «Jugar como invitado» para continuar sin cuenta.</p>
      </section>`;
    document.body.append(this.overlay);

    this.dialog = this.overlay.querySelector('.account-dialog');
    this.form = this.overlay.querySelector('.account-form');
    this.feedback = this.overlay.querySelector('.account-feedback');
    this.importToggle = this.overlay.querySelector('.account-import-toggle');
    this.openButton.addEventListener('click', () => this.open());
    this.overlay.querySelector('.account-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('pointerdown', (event) => { if (event.target === this.overlay) this.close(); });
    this.overlay.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key === 'Tab') {
        const focusable = [...this.dialog.querySelectorAll('button, input')]
          .filter((control) => !control.disabled && !control.closest('[hidden]'));
        const first = focusable[0], last = focusable.at(-1);
        if (!first) { event.preventDefault(); this.dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    });
    this.form.addEventListener('keydown', (event) => event.stopPropagation());
    this.form.addEventListener('submit', (event) => { event.preventDefault(); event.stopPropagation(); this.submit(event.submitter?.dataset.action || 'login'); });
    this.overlay.querySelector('.account-logout').addEventListener('click', () => this.logout());
    this.importToggle.addEventListener('change', () => {
      this.import = this.importToggle.checked;
      this.emitChange();
    });
    this.overlay.querySelector('.account-guest').addEventListener('click', () => {
      if (this.boarding || this.auth.state.busy) return;
      this.auth.useGuest();
      this.close();
    });
    this.unsubscribe = auth.subscribe((state) => { this.render(state); this.emitChange(); });
  }

  importRequested() {
    return Boolean(this.auth.state.signedIn && this.hasLegacySave() && this.import);
  }

  emitChange() {
    if (this.onChange) this.onChange({ state: { ...this.auth.state }, importRequested: this.importRequested() });
  }

  render(state) {
    const importVisible = Boolean(state.signedIn && this.hasLegacySave());
    if (!importVisible) this.import = false;
    this.importToggle.checked = this.import;
    this.overlay.querySelector('.account-import').hidden = !importVisible;
    this.overlay.querySelector('.account-form').hidden = state.signedIn || !state.enabled;
    this.overlay.querySelector('.account-signed').hidden = !state.signedIn;
    this.overlay.querySelector('.account-copy').textContent = state.signedIn
      ? 'Tu sesión de cuenta está activa en este navegador.'
      : state.enabled ? 'Inicia sesión o crea una cuenta para usar tu personaje en línea.' : 'Este servidor no ofrece cuentas en este momento.';
    this.overlay.querySelector('.account-email').textContent = state.email || 'Sesión iniciada';
    this.overlay.querySelector('.account-guest-note').hidden = Boolean(state.signedIn);
    this.status.textContent = state.signedIn ? state.email : (state.guestChoice ? 'Invitado · esta sesión' : state.error || (state.enabled ? 'Selecciona cuenta o invitado' : 'Cuentas no disponibles; selecciona invitado.'));
    this.feedback.textContent = this.notice || state.error;
    this.setControlsDisabled(this.boarding || state.busy);
  }

  setControlsDisabled(disabled) {
    this.openButton.disabled = Boolean(disabled);
    for (const control of this.overlay.querySelectorAll('button, input')) control.disabled = Boolean(disabled);
  }

  open() {
    if (this.boarding) return;
    this.notice = '';
    this.overlay.hidden = false;
    this.render(this.auth.state);
    this.dialog.focus({ preventScroll: true });
  }

  close() {
    this.form.elements.password.value = '';
    if (this.overlay.hidden) return;
    this.overlay.hidden = true;
    this.openButton.focus({ preventScroll: true });
  }

  hide() {
    this.close();
  }

  setBoarding(on) {
    this.boarding = Boolean(on);
    if (this.boarding) this.close();
    this.setControlsDisabled(this.boarding || this.auth.state.busy);
  }

  async submit(action) {
    if (this.boarding || this.auth.state.busy || !this.auth.state.enabled) return;
    const email = this.form.elements.email.value;
    const password = this.form.elements.password.value;
    this.notice = '';
    try {
      const result = action === 'signup' ? await this.auth.signup(email, password) : await this.auth.login(email, password);
      if (result.ok && result.confirmationPending) this.notice = 'Revisa tu correo para confirmar la cuenta.';
    } finally {
      this.form.elements.password.value = '';
      this.render(this.auth.state);
    }
  }

  async logout() {
    this.notice = '';
    await this.auth.logout();
    this.render(this.auth.state);
  }

  destroy() {
    this.form.elements.password.value = '';
    this.unsubscribe?.();
    this.launch.remove();
    this.overlay.remove();
  }
}
