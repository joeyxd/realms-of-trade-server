// Optional wallet proof panel. The wallet service owns provider and request state.
import { t, onLocaleChange, messageKey } from '../core/i18n.js';
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
    this.title.textContent = t('wallet.title');
    this.statement = document.createElement('p');
    this.statement.className = 'wallet-panel-note';
    this.statement.textContent = t('wallet.statement');
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
    this.reviewMessage.setAttribute('aria-label', t('wallet.reviewLabel'));
    this.review.append(this.reviewIntro, this.reviewMessage);
    this.error = document.createElement('p');
    this.error.className = 'wallet-panel-error';
    this.error.setAttribute('role', 'status');
    this.error.setAttribute('aria-live', 'polite');
    this.error.hidden = true;
    this.actions = document.createElement('div');
    this.actions.className = 'wallet-panel-actions';
    this.connectButton = this.makeButton(t('wallet.connect'), 'wallet-panel-connect');
    this.signButton = this.makeButton(t('wallet.sign'), 'wallet-panel-sign');
    this.cancelButton = this.makeButton(t('wallet.cancel'), 'wallet-panel-cancel');
    this.refreshButton = this.makeButton(t('wallet.refresh'), 'wallet-panel-refresh');
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
    this.unsubscribeLocale = onLocaleChange(() => this.render());
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
      // Service errors are intentionally not exposed to the interface.
      this.localError = 'wallet.actionError';
    }
    this.render();
  }

  render() {
    const focused = document.activeElement;
    const state = this.state;
    this.title.textContent = t('wallet.title');
    this.statement.textContent = t('wallet.statement');
    this.reviewMessage.setAttribute('aria-label', t('wallet.reviewLabel'));
    const enabled = Boolean(state.enabled);
    const busy = Boolean(state.busy);
    const review = state.phase === 'review';
    const linked = state.phase === 'linked' || Boolean(state.link);
    this.section.hidden = !enabled;
    this.section.setAttribute('aria-busy', String(busy));
    if (!enabled) return;

    this.connectButton.textContent = t('wallet.connect');
    this.signButton.textContent = t('wallet.sign');
    this.cancelButton.textContent = t('wallet.cancel');
    this.refreshButton.textContent = t('wallet.refresh');

    this.status.textContent = t(`wallet.phase.${state.phase}`) || t('wallet.phase.ready');
    this.identity.replaceChildren();
    const address = state.link?.address || state.address;
    const chainId = state.link?.chainId ?? state.chainId;
    if (address) this.identity.append(this.identityLine(t('wallet.identity.address'), address));
    if (chainId !== null && chainId !== undefined && chainId !== '') this.identity.append(this.identityLine(t('wallet.identity.chain'), String(chainId)));

    this.review.hidden = !review;
    this.reviewIntro.textContent = review
      ? t('wallet.reviewIntro')
      : '';
    // Show the exact challenge being signed. Translating it would change the signed bytes.
    this.reviewMessage.textContent = review && typeof state.message === 'string' ? state.message : '';
    const errorText = state.errorKey ? t(state.errorKey) : this.localError ? t(this.localError)
      : state.error ? t(messageKey(state.error) || 'wallet.error.provider') : '';
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
    this.unsubscribeLocale?.();
    this.section.remove();
  }
}
