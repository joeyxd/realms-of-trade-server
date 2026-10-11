import { t, text as ltext, rich, attr, setText, setDataText, translateData, dataText, getLocale, onLocaleChange, initI18n, messageKey, setAttributeText } from '../core/i18n.js';
// Compact multiplayer chat UI. The host owns delivery, channel eligibility and rate limits.
import { GAME } from '../data/meta.js';

const MAX_LOG = 100;
const MAX_PENDING_MS = 6000;

const CHANNELS = new Set(['world', 'local', 'whisper']);

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Decorative paths are local UI assets; message content always stays in text nodes.
function icon(name) {
  const paths = {
    chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z M8 11h8 M8 15h5',
    send: 'M22 2 9 15 M22 2l-7 20-6-7-7-6 20-7Z',
    close: 'M6 6l12 12 M6 18 18 6',
    retry: 'M20 7v5h-5 M20 12a8 8 0 1 0-2.4 5.7',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mn-chat-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] || paths.chat);
  svg.append(path);
  return svg;
}

function safeText(value, limit = 160) {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function errorText(code) {
  const messages = {
    RATE_LIMIT: t('chat.rate'),
    rate: t('chat.rate'),
    OFFLINE: t('chat.offline'),
    TOO_LONG: t('chat.long'),
    INVALID_TARGET: t('chat.targetGone'),
    recipient: t('chat.targetGone'),
    INVALID_CHANNEL: t('chat.channelGone'),
    channel: t('chat.channelGone'),
    disabled: t('chat.disabled'),
    invalid: t('chat.invalid'),
    conflict: t('chat.conflict'),
    session: t('chat.sessionGone'),
  };
  return messages[code] || t('chat.failed');
}

export class ChatPanel {
  constructor(root, { send, enabled = () => true, onFocus = () => {} } = {}) {
    if (!root || typeof root.append !== 'function') throw new TypeError('ChatPanel necesita un elemento raíz.');
    if (typeof send !== 'function') throw new TypeError('ChatPanel necesita la función send.');
    this.root = root;
    this.send = send;
    this.enabled = enabled;
    this.onFocus = onFocus;
    this.state = null;
    this.maxPoints = 300;
    this.visible = false;
    this.opened = false;
    this.connected = true;
    this.unread = 0;
    this.entries = [];
    this.seenIds = new Set();
    this.pending = null;
    this.timer = null;
    this.focused = false;

    this.container = element('section', 'mn-chat');
    setAttributeText(this.container, 'aria-label', 'chat.game');
    this.container.dataset.channel = 'local';
    this.toggle = element('button', 'mn-chat-toggle');
    this.toggle.type = 'button';
    setAttributeText(this.toggle, 'aria-label', 'chat.open');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.badge = element('span', 'mn-chat-badge');
    this.badge.setAttribute('aria-hidden', 'true');
    this.toggle.append(icon('chat'), element('span', 'mn-chat-toggle-label', 'Chat'), this.badge);

    this.panel = element('div', 'mn-chat-panel');
    this.panel.hidden = true;
    const header = element('header', 'mn-chat-header');
    const heading = element('div', 'mn-chat-heading');
    heading.append(element('span', 'mn-chat-eyebrow', GAME.title), setText(element('strong', ''), 'chat.messages'));
    header.append(heading);
    this.closeButton = element('button', 'mn-chat-close');
    this.closeButton.type = 'button';
    setAttributeText(this.closeButton, 'aria-label', 'chat.close');
    setAttributeText(this.closeButton, 'title', 'chat.closeTip');
    this.closeButton.append(icon('close'));
    header.append(this.closeButton);

    this.log = element('ol', 'mn-chat-log');
    this.log.setAttribute('role', 'log');
    setAttributeText(this.log, 'aria-label', 'chat.conversation');
    this.log.setAttribute('aria-live', 'polite');
    this.log.setAttribute('aria-relevant', 'additions');
    const conversation = element('div', 'mn-chat-conversation');
    this.empty = element('div', 'mn-chat-empty');
    this.empty.append(icon('chat'), setText(element('strong', ''), 'chat.empty'),
      setText(element('small', ''), 'chat.channels'));
    conversation.append(this.log, this.empty);

    this.status = element('p', 'mn-chat-status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.form = element('form', 'mn-chat-form');
    this.channel = element('select', 'mn-chat-channel');
    setAttributeText(this.channel, 'aria-label', 'chat.channel');
    for (const [value, label] of [['world', t('chat.world')], ['local', t('chat.local')], ['whisper', t('chat.whisper')]]) {
      const option = setText(element('option', ''), `chat.${value}`);
      option.value = value;
      this.channel.append(option);
    }
    this.channel.value = 'local';
    this.target = element('select', 'mn-chat-target');
    setAttributeText(this.target, 'aria-label', 'chat.recipient');
    this.target.hidden = true;

    this.input = element('input', 'mn-chat-input');
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.maxLength = this.maxPoints * 2;
    setAttributeText(this.input, 'placeholder', 'chat.placeholder');
    setAttributeText(this.input, 'aria-label', 'chat.write');

    this.sendButton = element('button', 'mn-chat-send'); this.sendButton.append(setText(element('span', ''), 'chat.send'));
    this.sendButton.type = 'submit';
    setAttributeText(this.sendButton, 'aria-label', 'chat.sendLabel');
    this.sendButton.append(icon('send'));
    this.retryButton = element('button', 'mn-chat-retry'); this.retryButton.append(setText(element('span', ''), 'chat.retry'));
    this.retryButton.type = 'button';
    this.retryButton.hidden = true;
    setAttributeText(this.retryButton, 'aria-label', 'chat.retryLabel');
    this.retryButton.prepend(icon('retry'));
    const routing = element('div', 'mn-chat-routing');
    routing.append(this.channel, this.target);
    const compose = element('div', 'mn-chat-compose');
    compose.append(this.input, this.sendButton, this.retryButton);
    this.form.append(routing, compose);
    this.panel.append(header, conversation, this.status, this.form);
    this.container.append(this.toggle, this.panel);
    root.append(this.container);

    this.toggle.addEventListener('click', () => this.opened ? this.close() : this.open());
    this.closeButton.addEventListener('click', () => this.close());
    this.channel.addEventListener('change', () => this.updateRecipientVisibility());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.stop(event);
      this.submit();
    });
    this.retryButton.addEventListener('click', () => this.retry());
    this.input.addEventListener('focus', () => this.setFocused(true));
    this.input.addEventListener('blur', () => this.setFocused(false));
    this.panel.addEventListener('keydown', (event) => {
      this.stop(event);
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        this.toggle.focus({ preventScroll: true });
      }
    });
    // Keep game keyboard handlers from seeing text, selection or composition input.
    for (const type of ['keyup', 'keypress', 'input', 'beforeinput', 'compositionstart', 'compositionend']) {
      this.panel.addEventListener(type, (event) => this.stop(event));
    }
    // Keep the latest line visible when a phone rotates or the compact panel changes height.
    this.logResize = new ResizeObserver(() => {
      if (this.opened) this.log.scrollTop = this.log.scrollHeight;
    });
    this.logResize.observe(this.log);
    this.setVisible(false);
    onLocaleChange(() => { const scroll = this.log.scrollTop; this.renderLog(); this.log.scrollTop = scroll; this.updateUnread(); setAttributeText(this.toggle, 'aria-label', this.opened ? 'chat.close' : this.unread ? 'chat.unread' : 'chat.open', {count:this.unread}); });
  }

  get typing() { return this.focused; }

  stop(event) { event.stopPropagation(); }

  setFocused(value) {
    const next = !!value;
    if (this.focused === next) return;
    this.focused = next;
    this.onFocus(next);
  }

  setVisible(playing) {
    this.visible = !!playing;
    this.container.hidden = !this.visible;
    if (!this.visible) this.close();
    this.updateControls();
  }

  open() {
    if (!this.visible || !this.allowed()) return false;
    this.opened = true;
    this.panel.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    setAttributeText(this.toggle, 'aria-label', 'chat.close');
    this.unread = 0;
    this.updateUnread();
    this.updateControls();
    this.input.focus({ preventScroll: true });
    return true;
  }

  close() {
    this.opened = false;
    if (this.panel) this.panel.hidden = true;
    if (this.toggle) {
      this.toggle.setAttribute('aria-expanded', 'false');
      setAttributeText(this.toggle,'aria-label',this.opened?'chat.close':this.unread?'chat.unread':'chat.open',{count:this.unread});
    }
    if (this.input && document.activeElement === this.input) this.input.blur();
    this.setFocused(false);
  }

  onState(state) {
    this.connected = true;
    const nextState = state && typeof state === 'object' ? state : null;
    const previousSelf = this.state?.self;
    const sessionChanged = !!previousSelf && nextState?.self !== previousSelf;
    if (sessionChanged) {
      this.clearTimer();
      this.pending = null;
      this.entries = [];
      this.seenIds.clear();
      this.unread = 0;
      this.log.replaceChildren();
      this.empty.hidden = false;
      this.updateUnread();
      this.setStatus(t('chat.changed'));
    }
    this.state = nextState;
    const configured = Number(this.state?.config?.maxLength);
    this.maxPoints = Number.isFinite(configured) && configured > 0 ? Math.min(2000, Math.floor(configured)) : 300;
    // HTML maxlength counts UTF-16 code units; leave room for supplementary Unicode code points.
    this.input.maxLength = this.maxPoints * 2;
    this.rebuildRecipients();
    if (Array.isArray(this.state?.history)) {
      for (const message of this.state.history.slice(-MAX_LOG)) this.onMessage(message, { fromHistory: true });
    }
    if (this.state?.config?.enabled === false) this.setStatus(t('chat.disabled'));
    else if (this.pending?.uncertain) this.setStatus(t('chat.unconfirmed'));
    else if (sessionChanged) this.setStatus(t('chat.changed'));
    this.updateControls();
  }

  rebuildRecipients() {
    const selected = this.target.value;
    const self = this.state?.self;
    const peers = Array.isArray(this.state?.peers) ? this.state.peers : [];
    const fragment = document.createDocumentFragment();
    const placeholder = setText(element('option', ''), 'chat.choose');
    placeholder.value = '';
    fragment.append(placeholder);
    for (const peer of peers) {
      if (!peer || typeof peer.id !== 'string' || !peer.id || peer.id === self) continue;
      const option = element('option', '', safeText(peer.name || t('chat.player',{id:peer.entity??''}), 80));
      option.value = peer.id;
      fragment.append(option);
    }
    this.target.replaceChildren(fragment);
    if ([...this.target.options].some((option) => option.value === selected)) this.target.value = selected;
    this.updateRecipientVisibility();
  }

  updateRecipientVisibility() {
    const whisper = this.channel.value === 'whisper';
    this.container.dataset.channel = this.channel.value;
    this.target.hidden = !whisper;
    this.target.required = whisper;
  }

  onMessage(message, { fromHistory = false } = {}) {
    if (!message || typeof message !== 'object' || !CHANNELS.has(message.channel)) return;
    const self = this.state?.self;
    if (message.channel === 'whisper' && (!self || (message.sender?.id !== self && message.target?.id !== self))) return;
    const messageId = safeText(message.id, 100);
    if (messageId && this.seenIds.has(messageId)) return;
    if (messageId) {
      this.seenIds.add(messageId);
      if (this.seenIds.size > 200) this.seenIds.delete(this.seenIds.values().next().value);
    }
    const sender = message.sender && typeof message.sender === 'object' ? message.sender : {};
    const own = !!self && sender.id === self;
    const label = safeText(sender.name || t('chat.someone'), 80);
    const targetName = safeText(message.target?.name, 80);
    const text = safeText(message.text, 2000);
    if (!text) return;
    const entry = {
      channel: message.channel,
      own,
      label,
      incomingWhisper: message.channel === 'whisper' && !own,
      target: message.channel === 'whisper' ? targetName : '',
      text,
      tick: Number.isFinite(message.tick) ? message.tick : null,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_LOG) this.entries.splice(0, this.entries.length - MAX_LOG);
    this.renderLog();
    if (!fromHistory && !own && !this.opened) {
      this.unread++;
      this.updateUnread();
    }
  }

  renderLog() {
    const fragment = document.createDocumentFragment();
    for (const entry of this.entries) {
      const row = element('li', `mn-chat-line mn-chat-${entry.channel}${entry.own ? ' is-own' : ''}`);
      const meta = element('span', 'mn-chat-meta', entry.channel === 'world' ? t('chat.world') : entry.channel === 'local' ? t('chat.local') : t('chat.whisper'));
      const label = entry.own ? t('chat.you') : entry.label;
      const target = entry.incomingWhisper ? t('chat.toYou') : entry.target;
      const who = element('strong', 'mn-chat-who', target ? `${label} → ${target}` : label);
      const body = element('span', 'mn-chat-text', entry.text);
      row.append(meta, who, body);
      fragment.append(row);
    }
    this.log.replaceChildren(fragment);
    this.empty.hidden = this.entries.length > 0;
    this.log.scrollTop = this.log.scrollHeight;
  }

  submit() {
    if (!this.allowed() || !this.connected) {
      if (this.state?.config?.enabled === false) {
        this.setStatus(t('chat.disabled'));
        return;
      }
      this.setStatus(t('chat.offline'));
      return;
    }
    if (this.pending) {
      this.setStatus(this.pending.uncertain ? t('chat.pending') : t('chat.wait'));
      return;
    }
    const text = this.input.value.trim().normalize('NFC');
    if (!text) return;
    if (Array.from(text.normalize('NFC')).length > this.maxPoints) {
      this.setStatus(t('chat.long'));
      return;
    }
    const channel = this.channel.value;
    if (!CHANNELS.has(channel)) return;
    const payload = { channel, text, id: crypto.randomUUID() };
    if (channel === 'whisper') {
      const target = this.target.value;
      const known = this.state?.peers?.some((peer) => peer?.id === target && peer.id !== this.state.self);
      if (!target || !known) {
        this.setStatus(t('chat.chooseAvailable'));
        return;
      }
      payload.target = target;
    }
    this.input.value = '';
    this.transmit(payload);
  }

  transmit(payload) {
    this.pending = { payload, uncertain: false };
    this.setStatus(t('chat.sending'), 'pending');
    this.updateControls();
    try {
      this.send(payload);
    } catch {
      this.pending.uncertain = true;
      this.connected = false;
      this.setStatus(t('chat.unknown'), 'warning');
      this.updateControls();
      return;
    }
    // A synchronous adapter may deliver a result during send().
    if (this.pending?.payload.id !== payload.id) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (!this.pending) return;
      this.pending.uncertain = true;
      this.setStatus(t('chat.noAck'), 'warning');
      this.updateControls();
    }, MAX_PENDING_MS);
  }

  retry() {
    if (!this.pending?.uncertain || !this.connected || !this.allowed()) return;
    const { payload } = this.pending;
    this.pending.uncertain = false;
    this.transmit(payload);
  }

  onResult(result) {
    if (!result || typeof result !== 'object' || !this.pending || result.requestId !== this.pending.payload.id) return;
    this.clearTimer();
    if (result.ok) {
      this.pending = null;
      this.setStatus(result.duplicate ? t('chat.duplicate') : t('chat.confirmed'), 'success');
    } else {
      this.pending = null;
      this.setStatus(errorText(safeText(result.code, 40)), 'error');
    }
    this.updateControls();
  }

  disconnected() {
    this.connected = false;
    this.clearTimer();
    if (this.pending) {
      this.pending.uncertain = true;
      this.setStatus(t('chat.disconnectedPending'), 'warning');
    } else {
      this.setStatus(t('chat.disconnected'), 'warning');
    }
    this.updateControls();
  }

  setStatus(text, tone = 'neutral') {
    const key = messageKey(text);
    if(key) setText(this.status,key); else { delete this.status.dataset.l10nKey; this.status.textContent = safeText(text, 220); }
    this.status.dataset.tone = tone;
  }

  updateUnread() {
    this.badge.textContent = this.unread ? String(Math.min(this.unread, 99)) : '';
    this.badge.hidden = !this.unread;
    setAttributeText(this.toggle, 'aria-label', this.opened ? 'chat.close' : this.unread ? 'chat.unread' : 'chat.open', { count: this.unread });
  }

  updateControls() {
    const blocked = !this.connected || !this.allowed() || !!this.pending;
    this.toggle.disabled = !this.visible || !this.allowed();
    this.sendButton.disabled = blocked;
    this.sendButton.hidden = !!this.pending?.uncertain;
    this.retryButton.hidden = !this.pending?.uncertain;
    this.retryButton.disabled = !this.pending?.uncertain || !this.connected || !this.allowed();
  }

  allowed() { return this.enabled() && this.state?.config?.enabled !== false; }

  clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
