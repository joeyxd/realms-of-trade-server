// Render only live messages already delivered to this session and audience by the server.
import { t } from '../core/i18n.js';

const MAX_SEEN = 200;
const MAX_TEXT_POINTS = 180;

function validEntity(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function visibleText(text) {
  const points = Array.from(String(text ?? ''));
  if (points.length <= MAX_TEXT_POINTS) return points.join('');
  return `${points.slice(0, MAX_TEXT_POINTS - 1).join('')}…`;
}

function lifeFor(text) {
  const count = Array.from(text).length;
  return Math.max(5000, Math.min(8000, 5000 + count * (3000 / MAX_TEXT_POINTS)));
}

export class ChatBubbles {
  constructor({ show, remove, clear } = {}) {
    this.callbacks = { show, remove, clear };
    this.self = null;
    this.enabled = false;
    this.peers = new Map();
    this.visible = new Set();
    this.seen = new Set();
    this.seenOrder = [];
    this.localRadius = 24;
  }

  onState(state) {
    const self = typeof state?.self === 'string' && state.self ? state.self : null;
    const enabled = state?.config?.enabled === true;
    const peers = Array.isArray(state?.peers) ? state.peers : [];
    const validPeers = new Map();
    for (const peer of peers) {
      if (typeof peer?.id !== 'string' || !peer.id || !validEntity(peer.entity)) continue;
      const hasName = typeof peer.name === 'string' && Boolean(peer.name);
      validPeers.set(peer.id, {
        id: peer.id,
        entity: peer.entity,
        name: hasName ? peer.name : t('chat.someone'),
        nameKey: hasName ? null : 'chat.someone',
      });
    }

    if (!enabled || !self || !validPeers.has(self) || self !== this.self || !this.enabled) {
      this._clearAll();
      this.seen.clear();
      this.seenOrder = [];
    } else {
      for (const [id, oldPeer] of this.peers) {
        const nextPeer = validPeers.get(id);
        if (!nextPeer || nextPeer.entity !== oldPeer.entity) this._remove(oldPeer.entity);
      }
    }

    this.self = self;
    this.enabled = enabled && Boolean(self && validPeers.has(self));
    this.peers = this.enabled ? validPeers : new Map();
    const radius = state?.config?.localRadius;
    this.localRadius = Number.isFinite(radius) && radius >= 1 && radius <= 200 ? radius : 24;
  }

  onMessage(message) {
    if (!this.enabled || !this.self || !message || typeof message.id !== 'string' || !message.id) return;
    if (typeof message.text !== 'string' || !message.text.trim()) return;
    const channel = message.channel;
    if (channel !== 'local' && channel !== 'whisper') return;
    const sender = message.sender;
    const currentSender = typeof sender?.id === 'string' ? this.peers.get(sender.id) : null;
    if (!currentSender || currentSender.entity !== sender.entity || !validEntity(sender.entity)) return;

    const own = sender.id === this.self;
    let label;
    let labelKey;
    let labelParams = {};
    let labelNameKey = null;
    if (channel === 'whisper') {
      const target = message.target;
      const currentTarget = typeof target?.id === 'string' ? this.peers.get(target.id) : null;
      if (!currentTarget || currentTarget.entity !== target.entity || !validEntity(target.entity)) return;
      if (!own && target.id !== this.self) return;
      const peer = own ? currentTarget : currentSender;
      labelKey = own ? 'chatBubble.whisper_you' : 'chatBubble.whisper_to_you';
      labelParams = { name: peer.name };
      labelNameKey = peer.nameKey;
      label = t(labelKey, labelParams);
    } else {
      labelKey = own ? 'chatBubble.local_you' : 'chatBubble.local_sender';
      if (!own) {
        labelParams = { name: currentSender.name };
        labelNameKey = currentSender.nameKey;
      }
      label = t(labelKey, labelParams);
    }

    if (this.seen.has(message.id)) return;
    const text = visibleText(message.text);
    this.seen.add(message.id);
    this.seenOrder.push(message.id);
    if (this.seenOrder.length > MAX_SEEN) this.seen.delete(this.seenOrder.shift());

    const presentation = {
      text,
      channel,
      label,
      own,
      range: this.localRadius,
      labelKey,
      labelParams,
      labelNameKey,
    };
    this.callbacks.show?.(currentSender.entity, presentation, lifeFor(text));
    this.visible.add(currentSender.entity);
  }

  forgetEntity(entity) {
    if (!validEntity(entity)) return;
    for (const [id, peer] of this.peers) {
      if (peer.entity === entity) this.peers.delete(id);
    }
    this._remove(entity);
  }

  disconnected() {
    this._clearAll();
    this.self = null;
    this.enabled = false;
    this.peers.clear();
    this.seen.clear();
    this.seenOrder = [];
  }

  _remove(entity) {
    if (!this.visible.delete(entity)) return;
    this.callbacks.remove?.(entity);
  }

  _clearAll() {
    if (this.visible.size) this.callbacks.clear?.();
    this.visible.clear();
  }
}
