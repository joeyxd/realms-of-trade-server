import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const CAPABILITIES = Object.freeze(['move', 'aim', 'attack_pve', 'body_pve', 'chat', 'inventory_read', 'market_read']);
const TYPES = new Set(['move', 'aim', 'attack_pve', 'go_to', 'follow', 'keep_distance', 'body_pve']);
const PRIORITIES = Object.freeze(['reflex', 'goal', 'direct']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORLD_ID = /^[a-zA-Z0-9:_-]{1,100}$/;
const OPAQUE_ID = /^[a-zA-Z0-9:_-]{1,100}$/;
const REF_ID = /^[a-zA-Z0-9:_-]{1,100}$/;
const copy = (value) => structuredClone(value);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => {
  if (!plain(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  return own.length === keys.length && own.every((key) => typeof key === 'string' && keys.includes(key) &&
    Object.hasOwn(descriptors[key], 'value')) && keys.every((key) => Object.hasOwn(descriptors, key));
};
const safeTime = (value) => Number.isSafeInteger(value) && value >= 0;
const finite = (value, bound = 1e6) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= bound;
const ref = (value) => exact(value, ['entityId', 'life']) && Number.isSafeInteger(value.entityId) &&
  value.entityId >= 0 && typeof value.life === 'string' && REF_ID.test(value.life);

function canonicalUuid(value) { return typeof value === 'string' && UUID.test(value); }

function dataObject(value, allowedKeys, label) {
  if (!plain(value)) throw new TypeError(`invalid ${label}`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !allowedKeys.includes(key) ||
      !Object.hasOwn(descriptors[key], 'value'))) throw new TypeError(`invalid ${label}`);
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function validateArgs(type, args) {
  if (!plain(args)) return false;
  const durationField = Object.getOwnPropertyDescriptor(args, 'durationMs');
  if (!durationField || !Object.hasOwn(durationField, 'value')) return false;
  const duration = durationField.value;
  const maxDuration = ['go_to', 'follow', 'keep_distance', 'body_pve'].includes(type) ? 30000 : 1000;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > maxDuration) return false;
  switch (type) {
    case 'move': return exact(args, ['mx', 'mz', 'durationMs']) && finite(args.mx, 1) && finite(args.mz, 1) &&
      Math.hypot(args.mx, args.mz) <= 1.000001;
    case 'aim': return exact(args, ['ax', 'az', 'durationMs']) && finite(args.ax) && finite(args.az);
    case 'attack_pve': return exact(args, ['target', 'durationMs']) && ref(args.target);
    case 'go_to': return exact(args, ['x', 'z', 'tolerance', 'durationMs']) && finite(args.x) && finite(args.z) &&
      finite(args.tolerance, 64) && args.tolerance >= 0.25 && args.tolerance <= 2;
    case 'follow':
    case 'keep_distance': return exact(args, ['target', 'distance', 'tolerance', 'durationMs']) && ref(args.target) &&
      finite(args.distance, 16) && args.distance >= 0.5 && args.distance <= 16 &&
      finite(args.tolerance, 16) && args.tolerance >= 0 && args.tolerance < args.distance;
    case 'body_pve': return exact(args, ['mode', 'protect', 'retreatHpFraction', 'allowPotion', 'durationMs']) &&
      ['aggressive', 'defensive', 'support'].includes(args.mode) &&
      finite(args.retreatHpFraction, 1) && args.retreatHpFraction >= 0.1 && args.retreatHpFraction <= 0.8 &&
      typeof args.allowPotion === 'boolean' &&
      (args.mode === 'support' ? ref(args.protect) : args.protect === null);
    default: return false;
  }
}

function requiredCapabilities(type) {
  if (type === 'move' || type === 'go_to' || type === 'follow' || type === 'keep_distance') return ['move'];
  if (type === 'aim') return ['aim'];
  if (type === 'attack_pve') return ['attack_pve'];
  if (type === 'body_pve') return ['body_pve', 'move', 'aim', 'attack_pve'];
  return null;
}

function snapshot(record) { return record ? copy(record.state) : null; }

export class AgentControl {
  #worldId;
  #ttlMs;
  #now;
  #sessionId;
  #bindings = new Map();
  #clients = new Map();
  #characters = new Map();
  #revision = 0;
  #lastTime = -1;

  constructor(config = {}, options = {}) {
    const setup = dataObject(config, ['worldId', 'bindings', 'ttlMs'], 'agent control configuration');
    const runtime = dataObject(options, ['now', 'sessionId'], 'agent control runtime');
    const { worldId, bindings, ttlMs = 300000 } = setup;
    const now = runtime.now ?? (() => Math.floor(performance.timeOrigin + performance.now()));
    const sessionId = runtime.sessionId ?? randomUUID;
    if (typeof worldId !== 'string' || !WORLD_ID.test(worldId) || !Array.isArray(bindings) || bindings.length > 64 ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 3600000 || typeof now !== 'function' ||
        typeof sessionId !== 'function') throw new TypeError('invalid agent control configuration');
    const characters = new Set();
    const owners = new Set();
    const normalized = [];
    for (const raw of bindings) {
      const binding = dataObject(raw, ['ownerId', 'characterId', 'capabilities'], 'agent binding');
      if (Object.keys(binding).length !== 3 || !canonicalUuid(binding.ownerId) || !canonicalUuid(binding.characterId) ||
          binding.ownerId === binding.characterId || !Array.isArray(binding.capabilities) ||
          new Set(binding.capabilities).size !== binding.capabilities.length ||
          binding.capabilities.some((capability) => !CAPABILITIES.includes(capability))) {
        throw new TypeError('invalid agent binding');
      }
      if (characters.has(binding.characterId)) throw new TypeError('duplicate agent character');
      characters.add(binding.characterId); owners.add(binding.ownerId);
      normalized.push({ ownerId: binding.ownerId, characterId: binding.characterId,
        capabilities: [...binding.capabilities].sort() });
    }
    if (normalized.some(({ characterId }) => owners.has(characterId))) throw new TypeError('managed character cannot be an owner');
    if (!WORLD_ID.test(worldId)) throw new TypeError('invalid agent control world');
    this.#worldId = worldId;
    this.#ttlMs = ttlMs;
    this.#now = now;
    this.#sessionId = sessionId;
    for (const binding of normalized) this.#bindings.set(binding.characterId, { ...binding, disabled: false });
  }

  binding(identity) {
    const binding = this.#bindings.get(identity);
    return !!binding;
  }

  admit(identity, clientId, entity) {
    const binding = this.#bindings.get(identity);
    if (!binding) return { ok: false, why: 'unmapped' };
    if (binding.disabled) return { ok: false, why: 'disabled' };
    if (this.#clients.has(clientId)) return { ok: false, why: 'occupied' };
    const current = this.#characters.get(binding.characterId);
    if (current?.state.state === 'active') return { ok: false, why: 'occupied' };
    if (!Number.isSafeInteger(clientId) || clientId < 0 || !Number.isSafeInteger(entity) || entity < 0) {
      return { ok: false, why: 'unmapped' };
    }
    const time = this.#time();
    const sessionId = this.#newSessionId();
    const state = {
      grant: { v: 1, scope: { ownerId: binding.ownerId, characterId: binding.characterId,
        worldId: this.#worldId, sessionId }, controlRevision: this.#nextRevision(),
        expiresAtMs: this.#expiry(time), capabilities: [...binding.capabilities] },
      state: 'active', why: null, taskRevision: 0, task: null,
    };
    const record = { clientId, entity, binding, state, actionIds: new Set() };
    this.#clients.set(clientId, record);
    this.#characters.set(binding.characterId, record);
    return { ok: true, state: snapshot(record) };
  }

  byClient(clientId) { return snapshot(this.#clients.get(clientId)); }
  byCharacter(characterId) { return snapshot(this.#characters.get(characterId)); }

  authorize(clientId, epoch, taskRevision = null) {
    const record = this.#clients.get(clientId);
    const time = this.#time();
    if (!record || record.state.state !== 'active' || record.state.grant.controlRevision !== epoch ||
        time >= record.state.grant.expiresAtMs) return false;
    if (taskRevision !== null && (record.state.taskRevision !== taskRevision || !record.state.task ||
        time >= record.state.task.expiresAtMs)) return false;
    return true;
  }

  task(clientId, request) { return this.#setTask(clientId, request, null); }

  direct(ownerId, characterId, request) {
    const binding = this.#bindings.get(characterId);
    if (!binding || binding.ownerId !== ownerId) return { ok: false, why: 'unmapped' };
    const record = this.#characters.get(characterId);
    let epoch;
    try {
      const input = dataObject(request, ['epoch', 'expectedTaskRevision', 'actionId', 'type', 'args'], 'direct agent task');
      if (Reflect.ownKeys(input).length !== 5) return { ok: false, why: 'invalid_task' };
      epoch = input.epoch;
    }
    catch { return { ok: false, why: 'invalid_task' }; }
    if (!record || record.binding !== binding || !this.authorize(record.clientId, epoch)) {
      return { ok: false, why: 'disabled' };
    }
    return this.#setTask(record.clientId, request, 'direct');
  }

  #setTask(clientId, request, forcedPriority) {
    const record = this.#clients.get(clientId);
    const allowed = forcedPriority === null
      ? ['epoch', 'expectedTaskRevision', 'actionId', 'type', 'args', 'priority']
      : ['epoch', 'expectedTaskRevision', 'actionId', 'type', 'args'];
    let input;
    try { input = dataObject(request, allowed, 'agent task'); } catch { return { ok: false, why: 'invalid_task' }; }
    if (Reflect.ownKeys(input).length !== allowed.length ||
        !Number.isSafeInteger(input.epoch) || !Number.isSafeInteger(input.expectedTaskRevision) ||
        input.expectedTaskRevision < 0 || typeof input.actionId !== 'string' || !OPAQUE_ID.test(input.actionId) ||
        typeof input.type !== 'string' || !TYPES.has(input.type) || !validateArgs(input.type, input.args)) {
      return { ok: false, why: 'invalid_task' };
    }
    const priority = forcedPriority || input.priority;
    if (!PRIORITIES.includes(priority) || (forcedPriority === null && priority === 'direct')) {
      return { ok: false, why: 'invalid_task' };
    }
    if (!record || !this.authorize(clientId, input.epoch)) return { ok: false, why: 'disabled' };
    const state = record.state;
    if (state.taskRevision !== input.expectedTaskRevision) return { ok: false, state: snapshot(record), why: 'stale_task' };
    const required = requiredCapabilities(input.type);
    if (!required || required.some((capability) => !record.binding.capabilities.includes(capability))) {
      return { ok: false, state: snapshot(record), why: 'forbidden' };
    }
    const now = this.#time();
    if (record.actionIds.has(input.actionId)) return { ok: false, state: snapshot(record), why: 'action_id_conflict' };
    if (record.actionIds.size >= 256) return { ok: false, state: snapshot(record), why: 'action_limit' };
    if (state.task && state.task.expiresAtMs > now && PRIORITIES.indexOf(priority) < PRIORITIES.indexOf(state.task.priority)) {
      return { ok: false, state: snapshot(record), why: 'priority' };
    }
    if (now + input.args.durationMs > Number.MAX_SAFE_INTEGER) return { ok: false, state: snapshot(record), why: 'invalid_task' };
    state.taskRevision++;
    record.actionIds.add(input.actionId);
    state.task = { actionId: input.actionId, type: input.type, args: copy(input.args), priority,
      expiresAtMs: Math.min(now + input.args.durationMs, state.grant.expiresAtMs) };
    return { ok: true, state: snapshot(record) };
  }

  cancel(clientId, request = {}) {
    const record = this.#clients.get(clientId);
    let input;
    try { input = dataObject(request, ['epoch', 'expectedTaskRevision'], 'agent cancellation'); }
    catch { return { ok: false, why: 'stale_task' }; }
    if (Reflect.ownKeys(input).length !== 2) return { ok: false, why: 'stale_task' };
    return this.#cancelTask(record, input);
  }

  cancelOwner(ownerId, characterId, request = {}) {
    const binding = this.#bindings.get(characterId);
    if (!binding || binding.ownerId !== ownerId) return { ok: false, why: 'unmapped' };
    let input;
    try { input = dataObject(request, ['epoch', 'expectedTaskRevision'], 'owner agent cancellation'); }
    catch { return { ok: false, why: 'stale_task' }; }
    if (Reflect.ownKeys(input).length !== 2) return { ok: false, why: 'stale_task' };
    const record = this.#characters.get(characterId);
    if (!record || record.binding !== binding) return { ok: false, why: 'disabled' };
    return this.#cancelTask(record, input, true);
  }

  #cancelTask(record, { epoch, expectedTaskRevision }, allowDirect = false) {
    if (!record || !this.authorize(record.clientId, epoch) || !Number.isSafeInteger(expectedTaskRevision) ||
        expectedTaskRevision !== record.state.taskRevision) {
      return { ok: false, ...(record ? { state: snapshot(record) } : {}), why: 'stale_task' };
    }
    if (!allowDirect && record.state.task?.priority === 'direct') {
      return { ok: false, state: snapshot(record), why: 'priority' };
    }
    record.state.task = null;
    record.state.taskRevision++;
    return { ok: true, state: snapshot(record) };
  }

  revoke(ownerId, characterId, reason = 'stop') {
    const binding = this.#bindings.get(characterId);
    if (!binding || binding.ownerId !== ownerId) return null;
    if (typeof reason !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(reason)) return null;
    binding.disabled = true;
    let record = this.#characters.get(characterId);
    if (!record) {
      const time = this.#time();
      const sessionId = this.#newSessionId();
      record = { clientId: null, entity: null, binding, actionIds: new Set(), state: {
        grant: { v: 1, scope: { ownerId, characterId, worldId: this.#worldId, sessionId },
          controlRevision: this.#nextRevision(), expiresAtMs: time, capabilities: [...binding.capabilities] },
        state: 'revoked', why: reason, taskRevision: 1, task: null,
      } };
      this.#characters.set(characterId, record);
      return snapshot(record);
    }
    this.#retire(record, reason, true);
    return snapshot(record);
  }

  retire(clientId, reason = 'disconnect') {
    const record = this.#clients.get(clientId);
    if (!record) return null;
    this.#retire(record, reason, false);
    return snapshot(record);
  }

  #retire(record, reason, disabled) {
    record.state.grant.controlRevision = this.#nextRevision();
    record.state.grant.expiresAtMs = this.#time();
    record.state.task = null;
    record.state.taskRevision++;
    record.state.state = 'revoked';
    record.state.why = reason;
    record.binding.disabled ||= disabled;
    if (this.#clients.get(record.clientId) === record) this.#clients.delete(record.clientId);
  }

  resume(ownerId, characterId) {
    const binding = this.#bindings.get(characterId);
    if (!binding || binding.ownerId !== ownerId) return false;
    const record = this.#characters.get(characterId);
    if (record?.state.state === 'active') return false;
    binding.disabled = false;
    return true;
  }

  sweep() {
    const transitions = [];
    const time = this.#time();
    for (const record of this.#characters.values()) {
      if (record.state.state !== 'active') continue;
      if (time >= record.state.grant.expiresAtMs) {
        this.#retire(record, 'expired', false);
        transitions.push(snapshot(record));
      } else if (record.state.task && time >= record.state.task.expiresAtMs) {
        record.state.task = null;
        record.state.taskRevision++;
        transitions.push(snapshot(record));
      }
    }
    return transitions;
  }

  #time() {
    const value = this.#now();
    if (!safeTime(value) || value < this.#lastTime) throw new TypeError('invalid agent control clock');
    this.#lastTime = value;
    return value;
  }

  #newSessionId() {
    const value = this.#sessionId();
    if (!canonicalUuid(value) || [...this.#characters.values()].some((entry) => entry.state.grant.scope.sessionId === value)) {
      throw new TypeError('invalid agent control session id');
    }
    return value;
  }

  #expiry(time) {
    const expiry = time + this.#ttlMs;
    if (!Number.isSafeInteger(expiry)) throw new RangeError('agent control expiry overflow');
    return expiry;
  }

  #nextRevision() {
    if (this.#revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('agent control revision exhausted');
    return ++this.#revision;
  }
}
