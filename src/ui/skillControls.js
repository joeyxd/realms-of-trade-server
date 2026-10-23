import { TREES, nodeById } from '../data/skillTree.js';

// SK04b: the client side of the skill operation (PLAN-SKILLS.md 3.3). It sends `assign` (one rank of one node) and
// `reset` (one tree) and never changes the profile itself: the server answers with the new profile and an ack.
// Pending, ack validation, retry and status follow AttributeControls; there is no points receipt to compare, so a
// success ack only fixes the revision the canonical profile must reach.

const RETRY_MS = 5000;
const METADATA = ['to', 'durable', 'replay', 'historical'];
const CORE = ['type', 'op', 'opId', 'ok', 'why', 'rev'];

function ownData(object, key) {
  try {
    const descriptor = object && Object.getOwnPropertyDescriptor(object, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
      ? { present: true, value: descriptor.value }
      : { present: !!descriptor, value: undefined };
  } catch {
    return { present: true, value: undefined };
  }
}

const plain = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
};

export class SkillControls {
  constructor({ profile, enabled, submit, onChange, now = () => performance.now(), id = () => crypto.randomUUID() }) {
    Object.assign(this, { profile, enabled, submit, onChange, now, id });
    this.pending = null;
    this.statusKey = 'idle';
    this.statusWhy = '';
    this.lastRenderSignature = '';
  }

  _enabled() {
    try {
      return (typeof this.enabled === 'function' ? this.enabled() : this.enabled) === true;
    } catch {
      return false;
    }
  }

  // The profile's economic revision (eco.tradeRev), or null when the profile cannot be trusted.
  _revision() {
    try {
      const profile = typeof this.profile === 'function' ? this.profile() : this.profile;
      if (!profile || typeof profile !== 'object') return null;
      const revision = ownData(ownData(profile, 'eco').value, 'tradeRev').value;
      return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
    } catch {
      return null;
    }
  }

  _deny(why) {
    this.statusKey = 'denial';
    this.statusWhy = why;
    this.update();
    return false;
  }

  /** `act('assign', { tree, node })` spends one rank; `act('reset', { tree })` resets a tree. True when a command was sent. */
  act(operation, { tree, node } = {}) {
    if (operation === 'retry') return this.retry();
    if (operation !== 'assign' && operation !== 'reset') return false;
    if (this.pending) return false;
    if (!this._enabled()) return this._deny('disabled');
    const known = typeof tree === 'string' && TREES.some((entry) => entry.id === tree && !entry.hidden);
    if (!known || (operation === 'assign' && (typeof node !== 'string' || nodeById(node)?.tree !== tree))) return this._deny('command');
    const revision = this._revision();
    if (revision === null) return this._deny('profile');

    const opId = this.id();
    const command = Object.freeze(operation === 'assign'
      ? { type: 'skills', op: 'assign', opId, expectedRev: revision, tree, node }
      : { type: 'skills', op: 'reset', opId, expectedRev: revision, tree });
    this.pending = { command, sentAt: this.now(), ack: null };
    this.statusKey = 'waiting';
    this.statusWhy = '';
    try {
      this.submit(command);
    } catch {
      // The send outcome is unknown; preserve the immutable command.
    }
    this.update();
    return true;
  }

  retry() {
    if (!this.pending || !this._enabled() || this.now() - this.pending.sentAt < RETRY_MS) return false;
    try {
      this.submit(this.pending.command);
    } catch {
      // The send outcome is unknown; preserve the immutable command.
    }
    this.pending.sentAt = this.now();
    this.statusKey = 'waiting';
    this.statusWhy = '';
    this.update();
    return true;
  }

  /** The server ack. True only for an ack of the pending command with the exact shape. */
  onResult(event) {
    const pending = this.pending;
    if (!pending || !plain(event)) return false;

    let result;
    try {
      const keys = Reflect.ownKeys(event);
      if (keys.some((key) => typeof key !== 'string')) return false;
      result = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(event, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
        result[key] = descriptor.value;
      }
    } catch {
      return false;
    }

    const command = pending.command;
    if (result.type !== 'skills' || result.op !== command.op || result.opId !== command.opId ||
        typeof result.ok !== 'boolean' || typeof result.why !== 'string' || !Number.isSafeInteger(result.rev) || result.rev < 0) return false;
    const keys = Object.keys(result);
    if (CORE.some((key) => !keys.includes(key)) || keys.some((key) => !CORE.includes(key) && !METADATA.includes(key)) ||
        keys.some((key) => METADATA.includes(key) && !(key === 'to' ? Number.isSafeInteger(result[key]) : typeof result[key] === 'boolean'))) return false;

    if (result.ok) {
      if (result.why !== '' || result.rev !== command.expectedRev + 1) return false;
      pending.ack = { rev: result.rev, durable: result.durable === true };
      this.statusKey = 'waiting';
      this.statusWhy = '';
    } else {
      // A denial may carry rev 0 (the authority does not know the revision); it is not compared with expectedRev.
      this.pending = null;
      this.statusKey = 'denial';
      this.statusWhy = result.why;
    }
    this.update();
    return true;
  }

  // True while a command is pending with no ack and was last sent at least RETRY_MS ago (the Carga rule, attributeControls.js:260).
  _retryReady() {
    return !!this.pending && !this.pending.ack && this._enabled() && this.now() - this.pending.sentAt >= RETRY_MS;
  }

  /** Per frame and on every profile: resolves the pending command once the profile reached the acked revision. */
  update() {
    if (this.pending?.ack) {
      const revision = this._revision();
      if (revision !== null && revision >= this.pending.ack.rev) {
        this.statusKey = this.pending.ack.durable ? 'synced' : 'sessionOnly';
        this.statusWhy = '';
        this.pending = null;
      }
    }
    const signature = JSON.stringify([
      this._revision(), this.pending && [this.pending.command.opId, this.pending.sentAt, this.pending.ack],
      this.statusKey, this.statusWhy, this._enabled(), this._retryReady(),
    ]);
    if (signature !== this.lastRenderSignature) {
      this.lastRenderSignature = signature;
      this.onChange?.();
    }
  }

  resetSession() {
    this.pending = null;
    this.statusKey = 'idle';
    this.statusWhy = '';
    this.update();
  }

  /** What the sheet draws; the sheet never reads this object's internals. */
  view() {
    const command = this.pending?.command;
    return {
      enabled: this._enabled(), busy: !!this.pending, retryReady: this._retryReady(), statusKey: this.statusKey, statusWhy: this.statusWhy,
      pendingOp: command?.op ?? null, pendingTree: command?.tree ?? null, pendingNode: command?.node ?? null,
    };
  }
}
