// Comic account dossier. Auth owns the session; the title owns the current name and appearance.
const CREST = `<svg viewBox="0 0 160 160" aria-hidden="true" focusable="false"><path d="M24 126 127 23l11 12L36 139Zm0-91 12-12 103 103-12 13Z" fill="#edf6eb" stroke="#161626" stroke-width="7"/><path d="M43 58c0-47 74-47 74 0v27l-17 15v20H60v-20L43 85Z" fill="#fff1bd" stroke="#161626" stroke-width="8" stroke-linejoin="round"/><path d="m43 53 70-22 13 19-81 24Z" fill="#ed5b41" stroke="#161626" stroke-width="7"/><path d="m59 73 16 5-9 13-12-5Zm27 6 17-8 2 17-14 3Z" fill="#161626"/><path d="m79 88-8 12h16Z" fill="#161626"/><path d="M71 111v10m17-10v10" stroke="#161626" stroke-width="5"/><path d="m18 21 13 2-2 13-12-3Zm115 117 10-12 10 11-11 10Z" fill="#ffc53b" stroke="#161626" stroke-width="4"/></svg>`;

export class AccountPanel {
  constructor(parent, auth, { hasLegacySave = () => false, onChange = null, looks = [],
    getCharacter = () => ({ name: 'Grumete', skin: 0 }), onCharacterChange = null, onReady = null } = {}) {
    Object.assign(this, { auth, hasLegacySave, onChange, looks, getCharacter, onCharacterChange, onReady });
    this.boarding = false; this.import = false; this.mode = 'login';
    this.notice = ''; this.noticeTone = ''; this.confirmationEmail = ''; this.portraits = new Map();
    this.container = parent?.matches?.('.title-actions') ? parent : parent?.querySelector?.('.title-actions');
    if (!this.container) throw new Error('AccountPanel requiere el contenedor .title-actions');
    this.launch = document.createElement('div'); this.launch.className = 'account-launch';
    this.launch.innerHTML = '<button type="button" class="account-open" aria-haspopup="dialog"><span aria-hidden="true">✦</span> Cuenta</button><span class="account-status" aria-live="polite"></span>';
    (this.container.querySelector('.title-net') || this.container).append(this.launch);
    this.openButton = this.launch.querySelector('.account-open'); this.status = this.launch.querySelector('.account-status');
    this.overlay = document.createElement('div'); this.overlay.className = 'account-overlay'; this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title" tabindex="-1">
        <header class="account-masthead">
          <span class="account-brand">MAREA <b>NEGRA</b></span>
          <div class="account-steps" aria-label="Pasos"><span class="account-step-account">01 <b>CUENTA</b></span><i aria-hidden="true">→</i><span class="account-step-pirate">02 <b>PIRATA</b></span></div>
          <button class="account-close" type="button" aria-label="Cerrar">×</button>
        </header>
        <div class="account-layout">
          <aside class="account-cover" aria-hidden="true">
            <div class="account-cover-label">ISLA DE LA CALDERA</div><div class="account-crest">${CREST}</div>
            <h3>EL MAR<br> NO HACE<br> <em>HÉROES.</em></h3><div class="account-cover-mobile">HAZ TU LEYENDA.</div><div class="account-cover-tag">LOS HACES TÚ.</div>
            <p>Tu botín. Tu tripulación.<br>Tu próxima leyenda.</p><span class="account-issue">TRIPULACIÓN ABIERTA / Nº 01</span>
          </aside>
          <div class="account-content">
            <span class="account-kicker">TU AVENTURA EMPIEZA AQUÍ</span><h2 id="account-title">VUELVE A<br>LA MAREA.</h2>
            <p class="account-copy">Entra en tu cuenta y recupera tu aventura.</p>
            <div class="account-tabs" role="group" aria-label="Acceso a la cuenta">
              <button class="account-tab" data-mode="login" type="button" aria-pressed="true">Iniciar sesión</button>
              <button class="account-tab" data-mode="signup" type="button" aria-pressed="false">Crear cuenta</button>
            </div>
            <form class="account-form" novalidate>
              <label class="account-field"><span>Correo electrónico</span><input name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="tu@correo.com" required></label>
              <label class="account-field"><span>Contraseña</span><span class="account-password"><input name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required><button class="account-password-toggle" type="button" aria-label="Mostrar contraseña" aria-pressed="false">VER</button></span></label>
              <label class="account-field account-confirm-field" hidden><span>Repite la contraseña</span><input name="confirmPassword" type="password" autocomplete="new-password" placeholder="Una vez más"></label>
              <p class="account-password-hint" hidden>Elige una contraseña segura y guárdala para volver a bordo.</p>
              <button class="account-submit" type="submit" data-action="login"><span>¡VOLVER A BORDO!</span><i aria-hidden="true">→</i></button>
            </form>
            <div class="account-confirmation" hidden>
              <span class="account-mail-mark" aria-hidden="true">✉</span><h3>¡CORREO A LA VISTA!</h3>
              <p>Abre el enlace de confirmación que enviamos a <b class="account-confirmation-email"></b>.</p>
              <p class="account-confirmation-note">Revisa también spam. Después vuelve e inicia sesión.</p>
              <button class="account-confirmation-login account-primary" type="button">VOLVER A INICIAR SESIÓN →</button>
              <button class="account-resend account-text-button" type="button">Enviar otro correo de confirmación</button>
            </div>
            <div class="account-signed" hidden>
              <div class="account-character-preview"><div class="account-character-art"><img class="account-character-portrait" alt="" hidden><span aria-hidden="true">✦</span></div><div><span class="account-character-label">TU ASPECTO PARA ESTA PARTIDA</span><h3 class="account-character-look"></h3><p>Una cuenta. Tu aventura continúa.</p></div></div>
              <label class="account-field"><span>Nombre del pirata</span><input name="characterName" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Grumete"></label>
              <div class="account-crew-grid" role="group" aria-label="Aspecto del pirata"></div>
              <div class="account-import" hidden><label><input class="account-import-toggle" type="checkbox"><span>Traer mi partida anterior</span></label><p>Solo al crear el primer personaje. Si ya tienes partida, continuarás con ella.</p></div>
              <button class="account-ready account-primary" type="button">¡ZARPAR! <i aria-hidden="true">→</i></button>
              <div class="account-signed-footer"><p class="account-email"></p><button class="account-logout account-text-button" type="button">Cambiar cuenta</button></div>
            </div>
            <p class="account-feedback" role="status" aria-live="polite" hidden></p>
            <footer class="account-guest-footer"><button class="account-guest account-text-button" type="button">Seguir como invitado <span aria-hidden="true">↗</span></button><p class="account-guest-note">También puedes explorar sin una cuenta.</p></footer>
          </div>
        </div>
      </section>`;
    document.body.append(this.overlay);
    this.dialog = this.overlay.querySelector('.account-dialog'); this.form = this.overlay.querySelector('.account-form');
    this.feedback = this.overlay.querySelector('.account-feedback'); this.importToggle = this.overlay.querySelector('.account-import-toggle');
    this.characterName = this.overlay.querySelector('[name=characterName]'); this.buildLooks();
    this.openButton.addEventListener('click', () => this.open());
    this.overlay.querySelector('.account-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('pointerdown', (event) => { if (event.target === this.overlay) this.close(); });
    // Handle keys at the overlay so Escape/Tab also work from inside either form.
    this.overlay.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key !== 'Tab') return;
      const controls = [...this.dialog.querySelectorAll('button, input')].filter((control) => !control.disabled && !control.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); this.dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    this.form.addEventListener('submit', (event) => { event.preventDefault(); this.submit(); });
    this.overlay.querySelectorAll('.account-tab').forEach((tab) => tab.addEventListener('click', () => this.setMode(tab.dataset.mode)));
    this.overlay.querySelector('.account-password-toggle').addEventListener('click', () => {
      const show = this.form.elements.password.type === 'password'; this.form.elements.password.type = show ? 'text' : 'password'; this.renderPasswordToggle(show);
    });
    this.overlay.querySelector('.account-confirmation-login').addEventListener('click', () => this.setMode('login', true));
    this.overlay.querySelector('.account-resend').addEventListener('click', () => this.resend());
    this.overlay.querySelector('.account-logout').addEventListener('click', () => this.logout());
    this.characterName.addEventListener('input', () => this.changeCharacter({ name: this.characterName.value.slice(0, 16) }));
    this.characterName.addEventListener('change', () => { if (!this.characterName.value.trim()) this.changeCharacter({ name: 'Grumete' }); this.renderCharacter(); });
    this.overlay.querySelector('.account-ready').addEventListener('click', () => {
      if (this.boarding || this.auth.state.busy || !this.auth.state.signedIn) return;
      if (!this.characterName.value.trim()) this.changeCharacter({ name: 'Grumete' });
      this.close(); this.onReady?.();
    });
    this.importToggle.addEventListener('change', () => { this.import = this.importToggle.checked; this.emitChange(); });
    this.overlay.querySelector('.account-guest').addEventListener('click', () => {
      if (this.boarding || this.auth.state.busy) return; this.auth.useGuest(); this.close();
    });
    this.wasSignedIn = false;
    this.unsubscribe = auth.subscribe((state) => { this.render(state); this.emitChange(); });
  }

  buildLooks() {
    const grid = this.overlay.querySelector('.account-crew-grid');
    for (const look of this.looks) {
      const button = document.createElement('button'); button.className = 'account-look'; button.type = 'button'; button.dataset.skin = look.id;
      button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', look.name);
      button.innerHTML = '<span class="account-look-art"><img alt="" hidden><i aria-hidden="true">✦</i></span><span class="account-look-name"></span>';
      button.querySelector('.account-look-name').textContent = look.name;
      if (look.color) button.style.setProperty('--look-color', look.color);
      button.addEventListener('click', () => { this.changeCharacter({ skin: look.id }); this.renderCharacter(); }); grid.append(button);
    }
  }

  setPortraits(render) {
    for (const look of this.looks) {
      const canvas = render(look.id); if (!canvas) continue;
      const image = canvas.toDataURL(); this.portraits.set(look.id, image);
      const thumb = this.overlay.querySelector(`.account-look[data-skin="${look.id}"] img`); thumb.src = image; thumb.hidden = false;
    }
    this.renderCharacter();
  }

  changeCharacter(patch) { this.onCharacterChange?.(patch); }
  renderCharacter() {
    const character = this.getCharacter(), look = this.looks.find((item) => item.id === character.skin) || this.looks[0];
    if (document.activeElement !== this.characterName) this.characterName.value = character.name || 'Grumete';
    this.overlay.querySelector('.account-character-look').textContent = look?.name || 'Pirata';
    for (const button of this.overlay.querySelectorAll('.account-look')) button.setAttribute('aria-pressed', String(Number(button.dataset.skin) === look?.id));
    const portrait = this.overlay.querySelector('.account-character-portrait'), src = this.portraits.get(look?.id); portrait.hidden = !src; if (src) portrait.src = src;
  }

  setMode(mode, focus = false) {
    if (this.auth.state.busy || this.boarding) return;
    this.mode = mode === 'signup' ? 'signup' : 'login'; this.notice = ''; this.noticeTone = ''; this.confirmationEmail = '';
    this.auth.dismissError();
    this.clearPasswords(); this.render(this.auth.state); if (focus) this.form.elements.password.focus({ preventScroll: true });
  }
  importRequested() { return Boolean(this.auth.state.signedIn && this.hasLegacySave() && this.import); }
  emitChange() { this.onChange?.({ state: { ...this.auth.state }, importRequested: this.importRequested() }); }

  render(state) {
    const signed = state.signedIn;
    if (signed) this.confirmationEmail = '';
    if (!signed && this.wasSignedIn) { this.mode = 'login'; this.notice = ''; this.noticeTone = ''; }
    const confirming = !signed && Boolean(this.confirmationEmail), signup = this.mode === 'signup', importVisible = Boolean(signed && this.hasLegacySave());
    if (!importVisible) this.import = false; this.importToggle.checked = this.import;
    this.overlay.querySelector('.account-import').hidden = !importVisible;
    this.form.hidden = signed || confirming || !state.enabled;
    this.overlay.querySelector('.account-tabs').hidden = signed || confirming || !state.enabled;
    this.overlay.querySelector('.account-confirmation').hidden = !confirming; this.overlay.querySelector('.account-signed').hidden = !signed;
    this.dialog.dataset.screen = signed ? 'pirate' : confirming ? 'confirmation' : signup ? 'signup' : 'login'; this.dialog.setAttribute('aria-busy', String(state.busy));
    this.overlay.querySelector('#account-title').innerHTML = signed ? 'ELIGE TU<br> PIRATA.' : confirming ? 'REVISA TU<br> CORREO.' : signup ? 'ESCRIBE TU<br> LEYENDA.' : 'VUELVE A<br> LA MAREA.';
    this.overlay.querySelector('.account-kicker').textContent = signed ? '02 / LISTO PARA LA AVENTURA' : confirming ? 'UN ÚLTIMO PASO' : '01 / TU PASAJE A LA ISLA';
    this.overlay.querySelector('.account-copy').textContent = signed ? 'Elige nombre y aspecto antes de zarpar.' : confirming ? 'Tu pasaje está casi listo.' : state.enabled ? signup ? 'Crea una cuenta. El resto es historia.' : 'Entra en tu cuenta y recupera tu aventura.' : 'Las cuentas no están disponibles ahora. Puedes explorar como invitado.';
    for (const tab of this.overlay.querySelectorAll('.account-tab')) tab.setAttribute('aria-pressed', String(tab.dataset.mode === this.mode));
    this.overlay.querySelector('.account-confirm-field').hidden = !signup; this.form.elements.confirmPassword.required = signup;
    this.form.elements.password.autocomplete = signup ? 'new-password' : 'current-password'; this.overlay.querySelector('.account-password-hint').hidden = !signup;
    const submit = this.overlay.querySelector('.account-submit'); submit.dataset.action = this.mode;
    submit.querySelector('span').textContent = state.busy ? 'UN MOMENTO…' : signup ? '¡CREAR MI CUENTA!' : '¡VOLVER A BORDO!';
    this.overlay.querySelector('.account-email').textContent = state.email || 'Sesión iniciada'; this.overlay.querySelector('.account-confirmation-email').textContent = this.confirmationEmail;
    this.overlay.querySelector('.account-guest-footer').hidden = signed;
    this.status.textContent = signed ? state.email : state.guestChoice ? 'Invitado · esta sesión' : state.error || (state.enabled ? 'Tu aventura te espera' : 'Cuentas no disponibles');
    this.feedback.textContent = this.notice || state.error || ''; this.feedback.hidden = !this.feedback.textContent; this.feedback.dataset.tone = this.notice ? this.noticeTone : 'error';
    this.renderCharacter(); this.setControlsDisabled(this.boarding || state.busy);
    if (state.busy && !this.overlay.hidden) this.dialog.focus({ preventScroll: true });
    if (signed && !state.busy && !this.wasSignedIn && !this.overlay.hidden) this.characterName.focus({ preventScroll: true });
    if (!state.busy) this.wasSignedIn = signed;
  }

  renderPasswordToggle(show) {
    const button = this.overlay.querySelector('.account-password-toggle'); button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña'); button.textContent = show ? 'OCULTAR' : 'VER';
  }
  clearPasswords() {
    this.form.elements.password.value = ''; this.form.elements.confirmPassword.value = ''; this.form.elements.password.type = 'password';
    this.renderPasswordToggle(false); this.form.elements.confirmPassword.setCustomValidity('');
  }
  setControlsDisabled(disabled) { this.openButton.disabled = Boolean(disabled); for (const control of this.overlay.querySelectorAll('button, input')) control.disabled = Boolean(disabled); }
  open() {
    if (this.boarding || this.auth.state.busy) return; this.notice = ''; this.noticeTone = ''; this.overlay.hidden = false; this.render(this.auth.state);
    const focus = this.auth.state.signedIn ? this.characterName : this.confirmationEmail || !this.auth.state.enabled ? this.dialog : this.form.elements.email; focus.focus({ preventScroll: true });
  }
  close() { this.clearPasswords(); if (this.overlay.hidden) return; this.overlay.hidden = true; this.openButton.focus({ preventScroll: true }); }
  hide() { this.close(); }
  setBoarding(on) { this.boarding = Boolean(on); if (this.boarding) this.close(); this.setControlsDisabled(this.boarding || this.auth.state.busy); }

  async submit() {
    if (this.boarding || this.auth.state.busy || !this.auth.state.enabled) return;
    const email = this.form.elements.email, password = this.form.elements.password, confirm = this.form.elements.confirmPassword;
    email.value = email.value.trim(); confirm.setCustomValidity(''); this.notice = ''; this.noticeTone = 'error';
    if (!email.validity.valid || !password.value || (this.mode === 'signup' && !confirm.value)) {
      this.notice = 'Revisa el correo y completa los campos.'; this.render(this.auth.state); this.form.reportValidity(); return;
    }
    if (this.mode === 'signup' && password.value !== confirm.value) {
      this.notice = 'Las contraseñas no coinciden.'; confirm.setCustomValidity(this.notice); this.render(this.auth.state); confirm.focus(); return;
    }
    try {
      const result = this.mode === 'signup' ? await this.auth.signup(email.value, password.value) : await this.auth.login(email.value, password.value);
      if (result.ok && result.confirmationPending) { this.confirmationEmail = email.value; this.notice = 'Revisa tu correo para confirmar la cuenta.'; this.noticeTone = 'success'; }
    } finally {
      this.clearPasswords(); this.render(this.auth.state);
      if (!this.overlay.hidden && this.confirmationEmail) this.overlay.querySelector('.account-confirmation-login').focus({ preventScroll: true });
      else if (!this.overlay.hidden && !this.auth.state.signedIn) password.focus({ preventScroll: true });
    }
  }
  async resend() {
    if (!this.confirmationEmail || this.auth.state.busy || this.boarding) return; this.notice = '';
    const result = await this.auth.resend(this.confirmationEmail); if (result.ok) { this.notice = 'Correo enviado. Abre el enlace para confirmar tu cuenta.'; this.noticeTone = 'success'; } this.render(this.auth.state);
  }
  async logout() {
    this.notice = ''; this.noticeTone = ''; this.clearPasswords(); const result = await this.auth.logout(); this.render(this.auth.state); if (result.ok) this.form.elements.email.focus({ preventScroll: true });
  }
  destroy() { this.clearPasswords(); this.unsubscribe?.(); this.launch.remove(); this.overlay.remove(); }
}
