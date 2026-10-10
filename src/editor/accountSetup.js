const SETUP_PARAM = 'account-setup';
const MIN_PASSWORD_LENGTH = 12;

function node(tag, className, text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function setupRequested() {
  return new URL(globalThis.location.href).searchParams.get(SETUP_PARAM) === '1';
}

function removeSetupParam() {
  const url = new URL(globalThis.location.href);
  url.searchParams.delete(SETUP_PARAM);
  globalThis.history.replaceState(globalThis.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/** One-shot password setup prompt for an already signed-in account. */
export function mountAccountSetup({ auth, parent = document.body } = {}) {
  if (!setupRequested()) return null;
  if (!auth || typeof auth.subscribe !== 'function' || typeof parent?.append !== 'function') {
    throw new TypeError('mountAccountSetup requires auth and a DOM parent');
  }
  const fragment = new URLSearchParams(globalThis.location.hash.slice(1));
  let setupToken = fragment.get('gm_setup_token');
  if (setupToken !== null) {
    fragment.delete('gm_setup_token');
    const url = new URL(globalThis.location.href);
    globalThis.history.replaceState(globalThis.history.state, '', `${url.pathname}${url.search}${fragment.size ? '#' + fragment.toString() : ''}`);
  }

  const style = node('style');
  style.textContent = `
    .gm-account-setup-status { position: fixed; z-index: 1601; top: max(16px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); max-width: min(560px, calc(100vw - 28px)); padding: 12px 16px; border: 2px solid #172228; border-radius: 10px; color: #102026; background: #c5f2df; box-shadow: 4px 4px 0 #172228; font: 700 14px/1.4 system-ui, sans-serif; text-align: center; }
    .gm-account-setup-status[hidden], .gm-account-setup-overlay[hidden] { display: none !important; }
    .gm-account-setup-status { pointer-events: none; }
    .gm-account-setup-overlay { position: fixed; z-index: 1600; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(5 12 16 / 78%); font: 14px/1.45 system-ui, sans-serif; }
    .gm-account-setup-card { width: min(460px, 100%); padding: 24px; border: 2px solid #111b22; border-radius: 14px; color: #172228; background: #f5edda; box-shadow: 7px 7px 0 #e7a941; }
    .gm-account-setup-card h1 { margin: 0 0 8px; font-size: clamp(22px, 5vw, 30px); line-height: 1.1; }
    .gm-account-setup-card p { margin: 0 0 16px; color: #45545a; }
    .gm-account-setup-field { display: grid; gap: 5px; margin: 12px 0; font-weight: 700; }
    .gm-account-setup-field input { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid #64757a; border-radius: 7px; color: #132027; background: #fffdf7; font: inherit; }
    .gm-account-setup-field input:focus-visible, .gm-account-setup-card button:focus-visible { outline: 3px solid #147b84; outline-offset: 2px; }
    .gm-account-setup-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .gm-account-setup-card button { min-height: 42px; padding: 8px 13px; border: 1px solid #172228; border-radius: 7px; color: #f9f4e7; background: #203e43; font: 800 13px/1.25 system-ui, sans-serif; cursor: pointer; }
    .gm-account-setup-card button[data-action="cancel"] { color: #172228; background: transparent; }
    .gm-account-setup-card button:disabled { opacity: .55; cursor: wait; }
    .gm-account-setup-message { min-height: 1.4em; margin: 12px 0 0 !important; color: #9c3329 !important; font-weight: 700; }
    @media (prefers-reduced-motion: reduce) { .gm-account-setup-card { scroll-behavior: auto; } }
  `;

  const overlay = node('div', 'gm-account-setup-overlay');
  overlay.hidden = true;
  const card = node('section', 'gm-account-setup-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'gm-account-setup-title');
  const title = node('h1', '', 'Configura tu contraseña / Set your password');
  title.id = 'gm-account-setup-title';
  const description = node('p', '', 'Crea una contraseña nueva para tu cuenta. Debe tener al menos 12 caracteres. / Create a new password for your account. Use at least 12 characters.');
  const form = node('form', '');
  form.noValidate = true;

  const passwordLabel = node('label', 'gm-account-setup-field', 'Contraseña nueva / New password');
  const password = node('input', '');
  password.type = 'password'; password.name = 'new-password'; password.autocomplete = 'new-password';
  password.required = true; password.minLength = MIN_PASSWORD_LENGTH;
  passwordLabel.append(password);

  const confirmLabel = node('label', 'gm-account-setup-field', 'Confirma la contraseña / Confirm password');
  const confirmation = node('input', '');
  confirmation.type = 'password'; confirmation.name = 'confirm-password'; confirmation.autocomplete = 'new-password';
  confirmation.required = true; confirmation.minLength = MIN_PASSWORD_LENGTH;
  confirmLabel.append(confirmation);

  const message = node('p', 'gm-account-setup-message');
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const actions = node('div', 'gm-account-setup-actions');
  const submit = node('button', '', 'Guardar contraseña / Save password');
  submit.type = 'submit'; submit.dataset.action = 'submit';
  const cancel = node('button', '', 'Ahora no / Not now');
  cancel.type = 'button'; cancel.dataset.action = 'cancel';
  actions.append(submit, cancel);
  form.append(passwordLabel, confirmLabel, message, actions);
  card.append(title, description, form);
  overlay.append(card);
  const success = node('div', 'gm-account-setup-status', 'Contraseña guardada / Password saved');
  success.hidden = true; success.setAttribute('role', 'status'); success.setAttribute('aria-live', 'polite');
  parent.append(style, overlay, success);

  let signedIn = false;
  let accountId = '';
  let busy = false;
  let dismissed = false;
  let completed = false;
  let disposed = false;
  let wasVisible = false;
  let statusTimer = null;
  let linkPending = setupToken !== null;

  const render = (state = auth.state) => {
    signedIn = state?.signedIn === true;
    accountId = signedIn ? String(state.accountId || '') : '';
    if (!signedIn) {
      password.value = '';
      confirmation.value = '';
      message.textContent = '';
    }
    const enabled = signedIn && !!accountId && !busy && !completed && !linkPending;
    password.disabled = !enabled;
    confirmation.disabled = !enabled;
    submit.disabled = !enabled;
    cancel.disabled = busy;
    overlay.hidden = !signedIn || dismissed || completed || linkPending;
    if (!overlay.hidden && !wasVisible) password.focus({ preventScroll: true });
    wasVisible = !overlay.hidden;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!signedIn || !accountId || busy || completed) return;
    const submittedAccount = accountId;
    const nextPassword = password.value;
    const confirmPassword = confirmation.value;
    if ([...nextPassword].length < MIN_PASSWORD_LENGTH) {
      message.textContent = 'Usa al menos 12 caracteres. / Use at least 12 characters.';
      password.focus();
      return;
    }
    if (nextPassword !== confirmPassword) {
      message.textContent = 'Las contraseñas no coinciden. / The passwords do not match.';
      confirmation.focus();
      return;
    }

    busy = true; message.textContent = ''; render();
    try {
      const client = await auth.ensureClient();
      if (disposed || !signedIn || auth.state?.signedIn !== true || auth.state?.accountId !== submittedAccount) return;
      const { error } = await client.auth.updateUser({ password: nextPassword });
      if (error) throw error;
      if (disposed || auth.state?.signedIn !== true || auth.state?.accountId !== submittedAccount) return;
      completed = true;
      try { removeSetupParam(); } catch { /* The password update succeeded even if URL cleanup is unavailable. */ }
      overlay.hidden = true;
      wasVisible = false;
      success.hidden = false;
      statusTimer = setTimeout(() => { if (!disposed) success.hidden = true; }, 3500);
    } catch {
      if (auth.state?.signedIn === true && auth.state?.accountId === submittedAccount) {
        message.textContent = 'No se pudo guardar la contraseña. Inténtalo de nuevo. / Could not save the password. Please try again.';
      }
    } finally {
      // Drop the input values immediately; never persist or log credentials here.
      password.value = '';
      confirmation.value = '';
      busy = false;
      render();
    }
  };

  const onCancel = () => {
    if (busy) return;
    dismissed = true; overlay.hidden = true; wasVisible = false;
    password.value = ''; confirmation.value = ''; message.textContent = '';
  };
  form.addEventListener('submit', onSubmit);
  cancel.addEventListener('click', onCancel);
  const unsubscribe = auth.subscribe(render);

  return {
    async consumeLink() {
      if (!linkPending || disposed) return;
      try {
        if (!/^[a-f0-9]{64}$/i.test(setupToken || '')) throw new Error('link');
        const client = await auth.ensureClient();
        const result = await client.auth.verifyOtp({ token_hash: setupToken, type: 'recovery' });
        if (result.error || !result.data?.session?.access_token) throw new Error('link');
        if (disposed) return;
        auth.publish({ guestChoice: false }); auth.applySession(result.data.session);
      } catch {
        dismissed = true; success.hidden = false;
        success.textContent = 'El enlace caducó o no es válido. Solicita uno nuevo. / The link expired or is invalid. Request a new one.';
      } finally { setupToken = null; linkPending = false; if (!disposed) render(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(statusTimer);
      unsubscribe?.();
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      password.value = '';
      confirmation.value = '';
      style.remove(); overlay.remove(); success.remove();
    },
  };
}
