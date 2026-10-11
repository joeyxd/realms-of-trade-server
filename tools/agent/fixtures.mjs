// Reusable L00 fixtures are declarations for a local lab, never server receipts.
import { AGENT_INTERFACE_VERSION, LAB_CAPABILITIES } from './contract.mjs';

const copy = (value) => structuredClone(value);
const merge = (base, override) => override && typeof override === 'object' && !Array.isArray(override)
  ? { ...base, ...override } : override;

export function fixtureScope(overrides = {}) {
  return copy({ ownerId: 'owner-1', characterId: 'agent-1', worldId: 'lab-world', sessionId: 'lab-session-1', ...overrides });
}

export function fixtureGrant(overrides = {}) {
  const grant = { v: AGENT_INTERFACE_VERSION, scope: fixtureScope(), controlRevision: 1,
    expiresAtMs: 100000, capabilities: [...LAB_CAPABILITIES], ...overrides };
  if (Object.hasOwn(overrides, 'scope')) grant.scope = merge(fixtureScope(), overrides.scope);
  return copy(grant);
}

export function fixtureObservation(overrides = {}) {
  const self = { position: { x: 0, y: 0, z: 0 }, hp: 100, maxHp: 100, dead: false };
  const confirmed = { self, entities: [{ ref: { entityId: 7, life: 'enemy-life-1' }, kind: 'enemy',
    position: { x: 5, y: 0, z: 8 }, hp: 40 }] };
  const observation = { v: AGENT_INTERFACE_VERSION, scope: fixtureScope(), controlRevision: 1,
    revision: 1, tick: 10, receivedAtMs: 0, source: 'fixture', confirmed,
    predicted: null, chat: [], historyGap: 0, ...overrides };
  if (Object.hasOwn(overrides, 'scope')) observation.scope = merge(fixtureScope(), overrides.scope);
  if (Object.hasOwn(overrides, 'confirmed')) {
    observation.confirmed = merge(confirmed, overrides.confirmed);
    if (overrides.confirmed && Object.hasOwn(overrides.confirmed, 'self')) {
      observation.confirmed.self = merge(self, overrides.confirmed.self);
    }
  }
  return copy(observation);
}

export function fixtureOrder(overrides = {}) {
  const type = overrides.type ?? 'move';
  const args = type === 'attack_pve' ? { target: { entityId: 7, life: 'enemy-life-1' }, durationMs: 100 }
    : type === 'aim' ? { ax: 5, az: 8, durationMs: 100 }
      : { mx: 1, mz: 0, durationMs: 100 };
  const order = { v: AGENT_INTERFACE_VERSION, actionId: 'action-1', scope: fixtureScope(),
    controlRevision: 1, observationRevision: 1, type, args, ...overrides };
  if (Object.hasOwn(overrides, 'scope')) order.scope = merge(fixtureScope(), overrides.scope);
  if (Object.hasOwn(overrides, 'args')) order.args = merge(args, overrides.args);
  return copy(order);
}

export function fixtureEvidence(overrides = {}) {
  const evidence = { v: AGENT_INTERFACE_VERSION, actionId: 'action-1', scope: fixtureScope(),
    controlRevision: 1, source: 'fixture', evidenceId: 'receipt-1', tick: 11,
    outcome: 'confirmed', code: 'observed', effect: 'Fixture confirms the observed result.',
    durability: 'not_applicable', ...overrides };
  if (Object.hasOwn(overrides, 'scope')) evidence.scope = merge(fixtureScope(), overrides.scope);
  return copy(evidence);
}
