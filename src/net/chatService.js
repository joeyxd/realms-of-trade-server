// Session-scoped chat reuses the normal transport. Routing reads authoritative positions but never
// writes simulation events, RNG, profiles or saves. Whispers address a connection, not a recycled ECS id.
import { MSG } from './protocol.js';
import { chatConfig } from '../data/chat.js';

const channels = new Set(['world', 'local', 'whisper']);
const requestId = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
const identity = (p) => ({ id: p.id, entity: p.entity, name: p.name });

function cleanText(text, max) {
  if (typeof text !== 'string' || text.length > max * 4) return null;
  const cleaned = text.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return cleaned && Array.from(cleaned).length <= max ? cleaned : null;
}

export class ChatService {
  constructor({ peers, send, now = () => performance.now(), config = {} }) {
    this.config = chatConfig(config);
    this.peers = peers;
    this.send = send;
    this.now = now;
    this.sessions = new Map();
    this.namespace = globalThis.crypto.randomUUID();
    this.serial = 0;
  }

  members() {
    return this.peers().filter((p) => this.sessions.has(p.clientId))
      .map((p) => ({ ...p, id: this.sessions.get(p.clientId).id }));
  }

  join(clientId) {
    this.sessions.set(clientId, { id: globalThis.crypto.randomUUID(), tokens: this.config.burst,
      at: this.now(), receipts: new Map(), history: [] });
    this.publishState();
  }

  leave(clientId) {
    if (this.sessions.delete(clientId)) this.publishState();
  }

  publishState() {
    const peers = this.members();
    for (const p of peers) this.send(p.clientId, { t: MSG.CHAT_STATE, self: p.id,
      peers: peers.map(identity), config: this.config, history: this.sessions.get(p.clientId).history.slice() });
  }

  receive(clientId, msg, tick) {
    const id = requestId(msg.id) ? msg.id : null;
    const result = (ok, code, extra = {}) => this.send(clientId,
      { t: MSG.CHAT_RESULT, requestId: id, ok, ...(code ? { code } : {}), ...extra });
    const state = this.sessions.get(clientId), peers = this.members();
    const sender = peers.find((p) => p.clientId === clientId);
    if (!state || !sender) { result(false, 'session'); return; }
    if (!this.config.enabled) { result(false, 'disabled'); return; }
    if (!id) { result(false, 'invalid'); return; }
    if (!channels.has(msg.channel)) { result(false, 'channel'); return; }
    const text = cleanText(msg.text, this.config.maxLength);
    if (!text || (msg.channel === 'whisper' && typeof msg.target !== 'string') ||
        (msg.channel !== 'whisper' && msg.target !== undefined && msg.target !== null)) {
      result(false, 'invalid'); return;
    }
    const fingerprint = JSON.stringify([msg.channel, text, msg.channel === 'whisper' ? msg.target : null]);
    const previous = state.receipts.get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) { result(false, 'conflict'); return; }
      result(true, null, { messageId: previous.messageId, duplicate: true }); return;
    }
    let target = null;
    if (msg.channel === 'whisper') {
      target = peers.find((p) => p.id === msg.target);
      if (!target || target.id === sender.id) { result(false, 'recipient'); return; }
    }
    const now = this.now();
    state.tokens = Math.min(this.config.burst, state.tokens + Math.max(0, now - state.at) * this.config.refillPerSecond / 1000);
    state.at = Math.max(state.at, now);
    if (state.tokens < 1) { result(false, 'rate'); return; }
    state.tokens--;
    const recipients = msg.channel === 'world' ? peers : msg.channel === 'whisper' ? [sender, target] :
      peers.filter((p) => p.id === sender.id ||
        Math.hypot(p.x - sender.x, p.y - sender.y, p.z - sender.z) <= this.config.localRadius);
    const messageId = `${this.namespace}:${++this.serial}`;
    const message = { t: MSG.CHAT_MESSAGE, id: messageId, requestId: id, channel: msg.channel,
      sender: identity(sender), ...(target ? { target: identity(target) } : {}), text, tick };
    state.receipts.set(id, { fingerprint, messageId });
    while (state.receipts.size > this.config.receiptLimit) state.receipts.delete(state.receipts.keys().next().value);
    for (const peer of recipients) {
      const history = this.sessions.get(peer.clientId).history;
      history.push(message);
      if (history.length > this.config.historyLimit) history.shift();
      this.send(peer.clientId, message);
    }
    result(true, null, { messageId });
  }
}
