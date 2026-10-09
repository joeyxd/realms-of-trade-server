// Agent envelope contract. A valid envelope is not proof of server authorization.
export const AGENT_INTERFACE_VERSION = 1;
export const LAB_LIMITS = Object.freeze({
  maxObservationAgeMs: 1500, maxHorizonMs: 1000, resultTimeoutMs: 3000,
  maxEntities: 64, maxChat: 32, maxActions: 256, maxEffects: 16,
  maxTaskHorizonMs: 30000, movementBlockedAfterMs: 1500, movementMinProgressMm: 150,
});
export const LAB_CAPABILITIES = Object.freeze(['move', 'aim', 'attack_pve']);
export const NETWORK_CAPABILITIES = Object.freeze([...LAB_CAPABILITIES, 'chat', 'body_pve']);
export const MOVEMENT_TYPES = Object.freeze(['go_to', 'follow', 'keep_distance']);

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(v);
export const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const position = (v) => exact(v, ['x', 'y', 'z']) && ['x', 'y', 'z'].every((k) => finite(v[k]));
const ref = (v) => exact(v, ['entityId', 'life']) && integer(v.entityId) && id(v.life);
export const sameScope = (a, b) => ['ownerId', 'characterId', 'worldId', 'sessionId'].every((k) => a?.[k] === b?.[k]);
export const validScope = (v) => exact(v, ['ownerId', 'characterId', 'worldId', 'sessionId']) && Object.values(v).every(id);
export function canonicalJson(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (typeof value !== 'object' || seen.has(value)) throw new TypeError('invalid JSON value');
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = `[${value.map((v) => canonicalJson(v, seen)).join(',')}]`;
  else result = `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}

export function labLimits(overrides = {}) {
  if (!object(overrides) || Object.keys(overrides).some((k) => !Object.hasOwn(LAB_LIMITS, k))) throw new TypeError('invalid lab limits');
  const limits = { ...LAB_LIMITS, ...overrides };
  if (Object.values(limits).some((v) => !Number.isSafeInteger(v) || v <= 0 || v > 1e6)) throw new TypeError('invalid lab limits');
  return Object.freeze(limits);
}

export function validGrant(v) {
  return exact(v, ['v', 'scope', 'controlRevision', 'expiresAtMs', 'capabilities']) &&
    v.v === AGENT_INTERFACE_VERSION && validScope(v.scope) && integer(v.controlRevision) &&
    integer(v.expiresAtMs) && Array.isArray(v.capabilities) && v.capabilities.length <= NETWORK_CAPABILITIES.length &&
    new Set(v.capabilities).size === v.capabilities.length && v.capabilities.every((c) => NETWORK_CAPABILITIES.includes(c));
}

function validSelf(v) {
  return exact(v, ['position', 'hp', 'maxHp', 'dead']) && position(v.position) &&
    finite(v.hp) && finite(v.maxHp) && v.hp >= 0 && v.maxHp > 0 && v.hp <= v.maxHp &&
    typeof v.dead === 'boolean' && v.dead === (v.hp === 0);
}
function validEntity(v) {
  return exact(v, ['ref', 'kind', 'position', 'hp']) && ref(v.ref) &&
    ['player', 'npc', 'enemy'].includes(v.kind) && position(v.position) && (v.hp === null || (finite(v.hp) && v.hp >= 0));
}
function validChat(v, source) {
  return exact(v, ['id', 'channel', 'sender', 'recipient', 'text', 'tick']) && id(v.id) && id(v.sender) &&
    ['world', 'local', 'whisper'].includes(v.channel) && (v.recipient === null || id(v.recipient)) &&
    (v.channel === 'whisper' ? v.recipient !== null : v.recipient === null) &&
    typeof v.text === 'string' && v.text.length > 0 && [...v.text].length <= (source === 'server' ? 1000 : 280) && integer(v.tick);
}
export function validCombat(v) {
  return exact(v, ['weapon', 'attackStage', 'stagger', 'castLock', 'guardStamina', 'potions', 'potionCooldown', 'playerNearby', 'guardRaised']) &&
    integer(v.weapon) && v.weapon <= 5 && integer(v.attackStage) && v.attackStage <= 3 &&
    ['stagger', 'castLock', 'guardStamina', 'potionCooldown'].every((k) => finite(v[k]) && v[k] >= 0) &&
    integer(v.potions) && v.potions <= 5 && typeof v.playerNearby === 'boolean' && typeof v.guardRaised === 'boolean';
}
export function validObservation(v, limits = LAB_LIMITS, source = 'fixture') {
  return exact(v, ['v', 'scope', 'controlRevision', 'revision', 'tick', 'receivedAtMs', 'source', 'confirmed', 'predicted', 'chat', 'historyGap']) &&
    v.v === AGENT_INTERFACE_VERSION && validScope(v.scope) && integer(v.controlRevision) && integer(v.revision) &&
    integer(v.tick) && integer(v.receivedAtMs) && ['fixture', 'server'].includes(source) && v.source === source &&
    (exact(v.confirmed, ['self', 'entities']) || (exact(v.confirmed, ['self', 'entities', 'combat']) && validCombat(v.confirmed.combat))) &&
    validSelf(v.confirmed.self) && Array.isArray(v.confirmed.entities) &&
    v.confirmed.entities.length <= limits.maxEntities && v.confirmed.entities.every(validEntity) &&
    new Set(v.confirmed.entities.map((e) => e.ref.entityId)).size === v.confirmed.entities.length &&
    (v.predicted === null || validSelf(v.predicted)) && Array.isArray(v.chat) && v.chat.length <= limits.maxChat &&
    v.chat.every((m) => validChat(m, source)) && v.chat.every((m) => m.channel !== 'whisper' || m.sender === v.scope.characterId || m.recipient === v.scope.characterId) &&
    integer(v.historyGap);
}

export function validateOrder(order, { grant, observation, nowMs, limits = LAB_LIMITS, source = 'fixture' }) {
  const fail = (why) => ({ ok: false, state: 'rejected', why });
  if (!exact(order, ['v', 'actionId', 'scope', 'controlRevision', 'observationRevision', 'type', 'args']) ||
      order.v !== AGENT_INTERFACE_VERSION || !id(order.actionId) || !validScope(order.scope) ||
      !integer(order.controlRevision) || !integer(order.observationRevision) || !object(order.args)) return fail('invalid_order');
  if (!validGrant(grant)) return fail('invalid_grant');
  if (!sameScope(order.scope, grant.scope) || order.controlRevision !== grant.controlRevision) return fail('control_mismatch');
  if (!integer(nowMs) || nowMs >= grant.expiresAtMs) return fail('authorization_expired');
  if (!validObservation(observation, limits, source) || !sameScope(observation.scope, grant.scope) || observation.controlRevision !== grant.controlRevision ||
      order.observationRevision !== observation.revision || observation.receivedAtMs > nowMs ||
      nowMs - observation.receivedAtMs > limits.maxObservationAgeMs) return fail('stale_observation');
  if (observation.confirmed.self.dead) return fail('dead');
  const movement = MOVEMENT_TYPES.includes(order.type);
  const body = order.type === 'body_pve';
  if (!LAB_CAPABILITIES.includes(order.type) && !movement && !body) return fail('unsupported');
  if (body ? !['body_pve', 'move', 'aim', 'attack_pve'].every((c) => grant.capabilities.includes(c)) :
      !grant.capabilities.includes(movement ? 'move' : order.type)) return fail('forbidden');
  const args = order.args;
  if (!Number.isSafeInteger(args.durationMs) || args.durationMs < 1 || args.durationMs > (movement || body ? limits.maxTaskHorizonMs : limits.maxHorizonMs)) return fail('invalid_horizon');
  if (body) {
    if (!exact(args, ['mode', 'protect', 'retreatHpFraction', 'allowPotion', 'durationMs']) ||
        !['aggressive', 'defensive', 'support'].includes(args.mode) || !finite(args.retreatHpFraction) ||
        args.retreatHpFraction < 0.1 || args.retreatHpFraction > 0.8 || typeof args.allowPotion !== 'boolean' ||
        (args.mode === 'support' ? !ref(args.protect) : args.protect !== null)) return fail('invalid_args');
    if (!validCombat(observation.confirmed.combat)) return fail('combat_unavailable');
    if (observation.confirmed.combat.weapon !== 0) return fail('unsupported_weapon');
    if (args.mode === 'support' && !observation.confirmed.entities.some((e) => e.kind === 'player' && e.hp > 0 &&
        e.ref.entityId === args.protect.entityId && e.ref.life === args.protect.life)) return fail('target_unavailable');
  }
  if (movement) {
    if (!finite(args.tolerance) || args.tolerance < 0.25 || args.tolerance > 2) return fail('invalid_args');
    if (order.type === 'go_to') {
      if (!exact(args, ['x', 'z', 'tolerance', 'durationMs']) || !finite(args.x) || !finite(args.z)) return fail('invalid_args');
      const self = observation.confirmed.self.position;
      if (Math.hypot(args.x - self.x, args.z - self.z) > 64) return fail('destination_out_of_range');
    } else {
      if (!exact(args, ['target', 'distance', 'tolerance', 'durationMs']) || !ref(args.target) ||
          !finite(args.distance) || args.distance < 0.5 || args.distance > 16 || args.tolerance >= args.distance) return fail('invalid_args');
      if (!observation.confirmed.entities.some((e) => e.kind === 'player' && e.hp !== 0 &&
          e.ref.entityId === args.target.entityId && e.ref.life === args.target.life)) return fail('target_unavailable');
    }
  }
  if (order.type === 'move' && (!exact(args, ['mx', 'mz', 'durationMs']) || !finite(args.mx) || !finite(args.mz) ||
      Math.abs(args.mx) > 1 || Math.abs(args.mz) > 1 || Math.hypot(args.mx, args.mz) > 1.000001)) return fail('invalid_args');
  if (order.type === 'aim' && (!exact(args, ['ax', 'az', 'durationMs']) || !finite(args.ax) || !finite(args.az))) return fail('invalid_args');
  if (order.type === 'attack_pve') {
    if (!exact(args, ['target', 'durationMs']) || !ref(args.target)) return fail('invalid_args');
    const target = observation.confirmed.entities.find((e) => e.ref.entityId === args.target.entityId && e.ref.life === args.target.life);
    if (!target || target.kind !== 'enemy' || target.hp === 0) return fail('target_unavailable');
  }
  return { ok: true };
}

export function validEvidence(v, source = 'fixture') {
  return exact(v, ['v', 'actionId', 'scope', 'controlRevision', 'source', 'evidenceId', 'tick', 'outcome', 'code', 'effect', 'durability']) &&
    v.v === AGENT_INTERFACE_VERSION && id(v.actionId) && validScope(v.scope) && integer(v.controlRevision) &&
    ['fixture', 'server'].includes(source) && v.source === source && id(v.evidenceId) && integer(v.tick) && ['partial', 'confirmed', 'rejected'].includes(v.outcome) &&
    id(v.code) && (v.effect === null || (typeof v.effect === 'string' && v.effect.length <= 500)) && v.durability === 'not_applicable';
}
