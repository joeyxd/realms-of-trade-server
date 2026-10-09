// Optional wallet proof panel. The wallet service owns provider and request state.
export class WalletPanel {
  constructor(parent, wallet) {
    if (!parent?.querySelector || !wallet?.subscribe) throw new TypeError('WalletPanel requiere un contenedor y un servicio de wallet');
    this.wallet = wallet;
    this.blocked = false;
    this.localError = '';
    this.state = { enabled: false, busy: false, phase: 'disabled', chainId: null, address: '', message: '', link: null, error: '' };

    this.section = document.createElement('section');
    this.section.className = 'wallet-panel';
    this.section.setAttribute('aria-labelledby', 'wallet-panel-title');
    this.title = document.createElement('h3');
    this.title.id = 'wallet-panel-title';
    this.title.textContent = 'Wallet opcional';
    this.statement = document.createElement('p');
    this.statement.className = 'wallet-panel-note';
    this.statement.textContent = 'Vincula tu dirección a esta cuenta. La firma demuestra que la controlas y no autoriza compras ni transferencias.';
    this.status = document.createElement('p');
    this.status.className = 'wallet-panel-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.identity = document.createElement('p');
    this.identity.className = 'wallet-panel-identity';
    this.review = document.createElement('div');
    this.review.className = 'wallet-panel-review';
    this.review.hidden = true;
    this.reviewIntro = document.createElement('p');
    this.reviewMessage = document.createElement('pre');
    this.reviewMessage.tabIndex = 0;
    this.reviewMessage.setAttribute('aria-label', 'Mensaje completo para firmar');
    this.review.append(this.reviewIntro, this.reviewMessage);
    this.error = document.createElement('p');
    this.error.className = 'wallet-panel-error';
    this.error.setAttribute('role', 'status');
    this.error.setAttribute('aria-live', 'polite');
    this.error.hidden = true;
    this.actions = document.createElement('div');
    this.actions.className = 'wallet-panel-actions';
    this.connectButton = this.makeButton('Conectar wallet', 'wallet-panel-connect');
    this.signButton = this.makeButton('Firmar y vincular', 'wallet-panel-sign');
    this.cancelButton = this.makeButton('Cerrar intento', 'wallet-panel-cancel');
    this.refreshButton = this.makeButton('Consultar vínculo', 'wallet-panel-refresh');
    this.actions.append(this.connectButton, this.signButton, this.cancelButton, this.refreshButton);
    this.section.append(this.title, this.statement, this.status, this.identity, this.review, this.error, this.actions);
    const ready = parent.querySelector('.account-ready');
    if (ready) parent.insertBefore(this.section, ready);
    else parent.append(this.section);

    this.connectButton.addEventListener('click', () => this.invoke('prepare'));
    this.signButton.addEventListener('click', () => this.invoke('sign'));
    this.cancelButton.addEventListener('click', () => this.invoke('cancel'));
    this.refreshButton.addEventListener('click', () => this.invoke('refresh'));
    this.unsubscribe = wallet.subscribe((state) => {
      if (!state || typeof state !== 'object') return;
      this.state = state;
      this.render();
    });
  }

  makeButton(label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
  }

  setBlocked(blocked) {
    this.blocked = Boolean(blocked);
    this.render();
  }

  async invoke(method) {
    if (this.blocked || !this.state.enabled) return;
    this.localError = '';
    this.render();
    try {
      await this.wallet[method]();
    } catch {
      // Service errors are intentionally not exposed; the service state uses fixed Spanish messages.
      this.localError = 'No se pudo completar esta acción. Puedes consultar el vínculo e intentarlo de nuevo.';
    }
    this.render();
  }

  render() {
    const focused = document.activeElement;
    const state = this.state;
    const enabled = Boolean(state.enabled);
    const busy = Boolean(state.busy);
    const review = state.phase === 'review';
    const linked = state.phase === 'linked' || Boolean(state.link);
    this.section.hidden = !enabled;
    this.section.setAttribute('aria-busy', String(busy));
    if (!enabled) return;

    const phaseLabels = {
      idle: 'Sin vínculo', connecting: 'Conectando wallet…', loading: 'Consultando vínculo…',
      review: 'Revisa la prueba antes de firmar', signing: 'Esperando la firma…',
      confirming: 'Confirmando vínculo…', linked: 'Wallet vinculada', disabled: 'Wallet no disponible',
    };
    this.status.textContent = phaseLabels[state.phase] || 'Wallet lista';
    this.identity.replaceChildren();
    const address = state.link?.address || state.address;
    const chainId = state.link?.chainId ?? state.chainId;
    if (address) this.identity.append(this.identityLine('Dirección', address));
    if (chainId !== null && chainId !== undefined && chainId !== '') this.identity.append(this.identityLine('Red (ID)', String(chainId)));

    this.review.hidden = !review;
    this.reviewIntro.textContent = review
      ? `Revisa dirección y red. Cerrar este intento no cierra una solicitud abierta en tu wallet ni elimina el mensaje pendiente; puedes retomarlo con la misma dirección hasta que caduque.`
      : '';
    this.reviewMessage.textContent = review && typeof state.message === 'string' ? state.message : '';
    const errorText = state.error || this.localError;
    this.error.textContent = errorText || '';
    this.error.hidden = !errorText;

    this.connectButton.hidden = linked || review || busy;
    this.signButton.hidden = !review;
    this.cancelButton.hidden = !(review || busy);
    this.refreshButton.hidden = false;
    const locked = this.blocked || busy;
    this.connectButton.disabled = locked;
    this.signButton.disabled = locked;
    this.refreshButton.disabled = locked;
    this.cancelButton.disabled = this.blocked;
    // Keep keyboard navigation inside the dossier when an action disappears after a state change.
    if (this.section.contains(focused) && (focused.disabled || focused.closest('[hidden]'))) {
      const next = [this.signButton, this.connectButton, this.cancelButton, this.refreshButton]
        .find((button) => !button.disabled && !button.hidden);
      next?.focus({ preventScroll: true });
    }
  }

  identityLine(label, value) {
    const line = document.createElement('span');
    line.className = 'wallet-panel-identity-line';
    const caption = document.createElement('b');
    caption.textContent = `${label}: `;
    const content = document.createElement('span');
    content.textContent = value;
    line.append(caption, content);
    return line;
  }

  destroy() {
    this.unsubscribe?.();
    this.section.remove();
  }
}
