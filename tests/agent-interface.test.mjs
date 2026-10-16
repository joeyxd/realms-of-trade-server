import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLabSession } from '../tools/agent/session.mjs';
import { LAB_LIMITS, labLimits, validGrant, validObservation, validEvidence, validateOrder } from '../tools/agent/contract.mjs';
import { fixtureScope, fixtureGrant, fixtureObservation, fixtureOrder, fixtureEvidence } from '../tools/agent/fixtures.mjs';

const neutral = { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 };
function lab(options = {}) {
  const session = new AgentLabSession({ grant: fixtureGrant(), ...options });
  assert.equal(session.observe(fixtureObservation(), 0).ok, true);
  return session;
}
function action(session, actionId = 'action-1') {
  return session.actions.find((a) => a.order.actionId === actionId);
}
function sent(session, order = fixtureOrder()) {
  assert.equal(session.accept(order, 0).ok, true);
  const input = session.step(0);
  assert.equal(session.markSent(order.actionId, { first: 1, last: 2 }, 0).ok, true);
  return input;
}
function reorder(value) {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorder(v)]));
  return value;
}

test('fixture factories provide independent copies and explicitly lab-only evidence', () => {
  const scope = fixtureScope();
  const grant = fixtureGrant({ scope: { sessionId: 'another-session' } });
  assert.equal(grant.scope.characterId, scope.characterId);
  assert.equal(grant.scope.sessionId, 'another-session');
  grant.capabilities.pop();
  assert.equal(fixtureGrant().capabilities.length, 3);
  const observation = fixtureObservation();
  observation.confirmed.entities[0].position.x = 900;
  assert.equal(fixtureObservation().confirmed.entities[0].position.x, 5);
  assert.equal(fixtureEvidence().source, 'fixture');
  assert.equal(fixtureEvidence().durability, 'not_applicable');
});

test('observe, accept, normal input, send, ACK and fixture receipt have distinct stages', () => {
  const session = lab();
  const result = session.accept(fixtureOrder(), 0);
  assert.equal(result.action.state, 'accepted');
  const input = session.step(10);
  assert.deepEqual(input, { ...neutral, mx: 1 });
  assert.deepEqual(Object.keys(input).sort(), ['ax', 'az', 'btn', 'mx', 'mz', 'prs']);
  assert.equal(session.markSent('action-1', { first: 1, last: 2 }, 10).ok, true);
  assert.equal(action(session).state, 'sent');
  session.step(20);
  assert.equal(action(session).state, 'executing');
  assert.equal(session.acknowledge('action-1', 2).ok, true);
  assert.equal(action(session).inputAck, 2);
  assert.equal(action(session).result, null);
  assert.equal(session.recordEvidence(fixtureEvidence()).ok, true);
  assert.equal(action(session).state, 'confirmed');
  assert.equal(action(session).result.source, 'fixture');
  assert.deepEqual(session.step(21), neutral);
});

test('ACK cannot create a result and must be within an emitted range', () => {
  const session = lab();
  session.accept(fixtureOrder(), 0);
  assert.equal(session.acknowledge('action-1', 1).why, 'invalid_ack');
  assert.equal(session.markSent('action-1', { first: 10, last: 12 }, 0).ok, true);
  for (const seq of [9, 13, -1, NaN, 1.5]) assert.equal(session.acknowledge('action-1', seq).ok, false);
  session.acknowledge('action-1', 12);
  session.acknowledge('action-1', 10);
  assert.equal(action(session).inputAck, 12);
  assert.equal(action(session).result, null);
  assert.notEqual(action(session).state, 'confirmed');
});

test('predicted targets and predicted health never grant authority or confirm an outcome', () => {
  const session = lab();
  const predicted = { position: { x: 80, y: 0, z: 80 }, hp: 0, maxHp: 100, dead: true };
  assert.equal(session.observe(fixtureObservation({ revision: 2, receivedAtMs: 1, predicted }), 1).ok, true);
  assert.equal(session.accept(fixtureOrder({ observationRevision: 2 }), 1).ok, true);
  assert.deepEqual(session.step(1), { ...neutral, mx: 1 });
  assert.equal(action(session).result, null);
  const empty = fixtureObservation({ revision: 3, receivedAtMs: 2, confirmed: { entities: [] }, predicted });
  session.observe(empty, 2);
  assert.equal(session.accept(fixtureOrder({ actionId: 'attack', type: 'attack_pve', observationRevision: 3 }), 2).why, 'target_unavailable');
  assert.equal(session.recordEvidence(fixtureEvidence({ source: 'prediction' })).why, 'invalid_evidence');
});

test('strict envelopes reject malformed, hidden and non-fixture input', () => {
  assert.equal(validGrant(fixtureGrant()), true);
  assert.equal(validObservation(fixtureObservation()), true);
  assert.equal(validEvidence(fixtureEvidence()), true);
  const malformedGrant = fixtureGrant(); delete malformedGrant.scope.ownerId;
  assert.throws(() => new AgentLabSession({ grant: malformedGrant }), /invalid grant/);
  assert.throws(() => new AgentLabSession({ grant: fixtureGrant({ capabilities: ['move', 'move'] }) }), /invalid grant/);
  const session = lab();
  const missing = fixtureOrder(); delete missing.args;
  for (const order of [null, {}, missing, fixtureOrder({ extra: true }), fixtureOrder({ v: 999 }), fixtureOrder({ actionId: 'bad id' })]) {
    assert.equal(session.accept(order, 0).why, 'invalid_order');
  }
  for (const obs of [fixtureObservation({ extra: 1 }), fixtureObservation({ source: 'server' }), fixtureObservation({ confirmed: { self: { hp: NaN } } })]) {
    assert.equal(session.observe(obs, 0).why, 'invalid_observation');
  }
  const privateChat = fixtureObservation({ revision: 2, chat: [{ id: 'message-1', channel: 'whisper', sender: 'someone', recipient: 'other', text: 'private', tick: 10 }] });
  assert.equal(session.observe(privateChat, 0).why, 'invalid_observation');
});

test('unsupported capability and owner-forbidden action are different failures', () => {
  const session = lab({ grant: fixtureGrant({ capabilities: ['move'] }) });
  assert.equal(session.accept(fixtureOrder({ type: 'commerce' }), 0).why, 'unsupported');
  assert.equal(session.accept(fixtureOrder({ type: 'aim' }), 0).why, 'forbidden');
  assert.equal(session.accept(fixtureOrder({ type: 'attack_pve' }), 0).why, 'forbidden');
  assert.equal(session.accept(fixtureOrder(), 0).ok, true);
});

test('an action must reference the current session and control revision', () => {
  const session = lab();
  for (const overrides of [{ scope: { sessionId: 'old-session' } }, { scope: { ownerId: 'other' } },
    { scope: { characterId: 'other' } }, { scope: { worldId: 'other' } }, { controlRevision: 0 }]) {
    assert.equal(session.accept(fixtureOrder(overrides), 0).why, 'control_mismatch');
  }
  assert.equal(session.observe(fixtureObservation({ controlRevision: 0 }), 0).why, 'control_mismatch');
});

test('observation revisions, ticks, received times and maximum age enforce freshness', () => {
  const session = lab();
  assert.equal(session.accept(fixtureOrder({ observationRevision: 0 }), 0).why, 'stale_observation');
  assert.equal(session.observe(fixtureObservation({ revision: 2, receivedAtMs: 1 }), 0).why, 'stale_observation');
  assert.equal(session.observe(fixtureObservation({ revision: 1 }), 0).why, 'stale_observation');
  assert.equal(session.observe(fixtureObservation({ revision: 2, tick: 9 }), 0).why, 'stale_observation');
  assert.equal(session.accept(fixtureOrder(), LAB_LIMITS.maxObservationAgeMs + 1).why, 'stale_observation');
  assert.equal(session.observe(fixtureObservation({ revision: 2, receivedAtMs: 0 }), 1501).why, 'stale_observation');
  assert.equal(session.observe(fixtureObservation({ revision: 2, tick: 11, receivedAtMs: 1501 }), 1501).ok, true);
  assert.equal(session.accept(fixtureOrder({ observationRevision: 2 }), 1501).ok, true);
});

test('grant expiry stops active emission and never resumes the lab', () => {
  const session = lab({ grant: fixtureGrant({ expiresAtMs: 50 }) });
  sent(session);
  assert.deepEqual(session.step(50), neutral);
  assert.equal(action(session).state, 'uncertain');
  assert.equal(action(session).why, 'expired');
  assert.equal(session.grant.controlRevision, 2);
  assert.equal(session.accept(fixtureOrder({ actionId: 'late' }), 50).why, 'stopped');
  const fresh = lab({ grant: fixtureGrant({ expiresAtMs: 10 }) });
  assert.equal(fresh.accept(fixtureOrder(), 10).why, 'authorization_expired');
});

test('move and aim arguments are finite, bounded, exact and require a short horizon', () => {
  const session = lab();
  for (const args of [{ durationMs: 0 }, { durationMs: 1001 }, { durationMs: 1.5 }, { durationMs: Infinity }]) {
    assert.equal(session.accept(fixtureOrder({ args }), 0).why, 'invalid_horizon');
  }
  for (const args of [{ mx: 1, mz: 1 }, { mx: NaN }, { mz: -2 }, { extra: true }]) {
    assert.equal(session.accept(fixtureOrder({ args }), 0).why, 'invalid_args');
  }
  assert.equal(session.accept(fixtureOrder({ type: 'aim', args: { ax: Infinity } }), 0).why, 'invalid_args');
  assert.equal(session.accept(fixtureOrder({ args: { durationMs: 1000 } }), 0).ok, true);
});

test('confirmed live PvE targets are required and attack is one pulse per action', () => {
  const session = lab();
  const order = fixtureOrder({ type: 'attack_pve' });
  assert.equal(session.accept(order, 0).ok, true);
  assert.deepEqual(session.step(0), { ...neutral, ax: 5, az: 8, prs: 2 });
  assert.deepEqual(session.step(1), { ...neutral, ax: 5, az: 8 });
  for (const entity of [{ ...fixtureObservation().confirmed.entities[0], kind: 'player' },
    { ...fixtureObservation().confirmed.entities[0], hp: 0 }]) {
    const rejected = lab();
    rejected.observe(fixtureObservation({ revision: 2, confirmed: { entities: [entity] } }), 0);
    assert.equal(rejected.accept(fixtureOrder({ type: 'attack_pve', observationRevision: 2 }), 0).why, 'target_unavailable');
  }
});

test('lost targets and reused numeric entity IDs cancel old lifecycle orders', () => {
  for (const transmitted of [false, true]) for (const entities of [[],
    [{ ...fixtureObservation().confirmed.entities[0], ref: { entityId: 7, life: 'enemy-life-2' } }]]) {
    const session = lab();
    const order = fixtureOrder({ type: 'attack_pve' });
    if (transmitted) sent(session, order); else session.accept(order, 0);
    session.observe(fixtureObservation({ revision: 2, tick: 11, receivedAtMs: 1, confirmed: { entities } }), 1);
    assert.equal(action(session).state, transmitted ? 'uncertain' : 'cancelled');
    assert.equal(action(session).why, 'target_unavailable');
    assert.deepEqual(session.step(2), neutral);
  }
});

test('stop requires the owner and preserves already sent uncertainty', () => {
  const session = lab();
  sent(session);
  const previous = session.actions;
  assert.deepEqual(session.stop('other-owner', 1), { ok: false, why: 'owner_mismatch' });
  assert.deepEqual(session.actions, previous);
  assert.equal(session.grant.controlRevision, 1);
  const result = session.stop('owner-1', 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.input, neutral);
  assert.equal(action(session).state, 'uncertain');
  assert.equal(session.observation, null);
  assert.deepEqual(session.step(2), neutral);
  assert.equal(session.markSent('action-1', { first: 3, last: 3 }, 2).why, 'inactive_action');
});

test('death and disconnect neutralize inputs and distinguish unsent from sent work', () => {
  for (const reason of ['death', 'disconnect']) for (const transmitted of [false, true]) {
    const session = lab();
    if (transmitted) sent(session); else session.accept(fixtureOrder(), 0);
    const result = session.interrupt(reason, 1);
    assert.deepEqual(result.input, neutral);
    assert.equal(action(session).state, transmitted ? 'uncertain' : 'cancelled');
    assert.equal(action(session).why, reason);
    assert.deepEqual(session.step(2), neutral);
    assert.equal(session.observe(fixtureObservation({ revision: 2, receivedAtMs: 2 }), 2).why, 'stopped');
  }
});

test('confirmed death interrupts even when prediction appears healthy', () => {
  const session = lab();
  sent(session);
  const obs = fixtureObservation({ revision: 2, tick: 11, receivedAtMs: 1,
    confirmed: { self: { hp: 0, dead: true } }, predicted: fixtureObservation().confirmed.self });
  assert.equal(session.observe(obs, 1).why, 'dead');
  assert.equal(action(session).state, 'uncertain');
  assert.equal(action(session).why, 'death');
  assert.deepEqual(session.step(2), neutral);
});

test('late decisions are rejected but an original fixture receipt resolves uncertainty without restarting input', () => {
  const session = lab();
  sent(session);
  session.stop('owner-1', 1);
  assert.equal(session.accept(fixtureOrder({ actionId: 'late-model-answer' }), 2).why, 'stopped');
  assert.equal(session.recordEvidence(fixtureEvidence({ controlRevision: 2 })).why, 'evidence_mismatch');
  assert.equal(session.recordEvidence(fixtureEvidence()).ok, true);
  assert.equal(action(session).state, 'confirmed');
  assert.deepEqual(session.step(3), neutral);
  assert.equal(session.markSent('action-1', { first: 3, last: 3 }, 3).why, 'inactive_action');
});

test('superseding an action retires its inputs while late original evidence stays correlated', () => {
  const session = lab();
  sent(session);
  const next = fixtureOrder({ actionId: 'action-2', type: 'aim' });
  assert.equal(session.accept(next, 1).ok, true);
  assert.equal(action(session).state, 'uncertain');
  assert.equal(action(session).why, 'superseded');
  assert.equal(session.markSent('action-1', { first: 3, last: 3 }, 1).why, 'inactive_action');
  session.recordEvidence(fixtureEvidence());
  assert.deepEqual(session.step(2), { ...neutral, ax: 5, az: 8 });
  assert.equal(action(session, 'action-2').state, 'accepted');
  const unsent = lab();
  unsent.accept(fixtureOrder(), 0);
  unsent.accept(next, 1);
  assert.equal(action(unsent).state, 'cancelled');
});

test('action horizon ends emission; a fresh observation permits testing result timeout independently', () => {
  const session = lab();
  sent(session);
  assert.deepEqual(session.step(100), neutral);
  assert.equal(action(session).result, null);
  session.observe(fixtureObservation({ revision: 2, tick: 20, receivedAtMs: 3000 }), 3000);
  assert.deepEqual(session.step(3100), neutral);
  assert.equal(action(session).state, 'uncertain');
  assert.equal(action(session).why, 'result_timeout');
  assert.equal(session.recordEvidence(fixtureEvidence({ tick: 21 })).ok, true);
  assert.deepEqual(session.step(3101), neutral);
  const unsent = lab();
  unsent.accept(fixtureOrder(), 0);
  assert.deepEqual(unsent.step(100), neutral);
  assert.equal(action(unsent).state, 'cancelled');
  assert.equal(action(unsent).why, 'not_sent');
});

test('stale observations close emission instead of carrying a retained move', () => {
  const session = lab({ limits: { maxObservationAgeMs: 10 } });
  sent(session);
  assert.deepEqual(session.step(11), neutral);
  assert.equal(action(session).state, 'uncertain');
  assert.equal(action(session).why, 'stale_observation');
  session.observe(fixtureObservation({ revision: 2, tick: 11, receivedAtMs: 12 }), 12);
  assert.deepEqual(session.step(12), neutral);
});

test('duplicate IDs replay equivalent reordered objects without a second attack pulse; changed arguments conflict', () => {
  const session = lab();
  const order = fixtureOrder({ type: 'attack_pve' });
  sent(session, order);
  const retry = session.accept(reorder(order), 1);
  assert.equal(retry.ok, true);
  assert.equal(retry.replay, true);
  assert.equal(session.actions.length, 1);
  assert.deepEqual(session.step(1), { ...neutral, ax: 5, az: 8 });
  assert.equal(session.accept(fixtureOrder({ type: 'attack_pve', args: { durationMs: 200 } }), 2).why, 'action_id_conflict');
  session.recordEvidence(fixtureEvidence());
  assert.equal(session.accept(order, 3).replay, true);
  assert.deepEqual(session.step(3), neutral);
});

test('input ranges are validated and extended contiguously; expiry cannot transmit', () => {
  const session = lab();
  session.accept(fixtureOrder(), 0);
  for (const range of [{ first: 3, last: 2 }, { first: -1, last: 1 }, { first: 1, last: 2, other: 0 }, { first: NaN, last: 2 }]) {
    assert.equal(session.markSent('action-1', range, 0).why, 'invalid_input_range');
  }
  assert.equal(session.markSent('action-1', { first: 1, last: 2 }, 0).ok, true);
  assert.equal(session.markSent('action-1', { first: 4, last: 4 }, 1).why, 'invalid_input_range');
  assert.equal(session.markSent('action-1', { first: 3, last: 4 }, 1).ok, true);
  assert.deepEqual(action(session).inputRange, { first: 1, last: 4 });
  assert.equal(session.markSent('action-1', { first: 5, last: 5 }, 100).why, 'emission_expired');
  assert.equal(action(session).state, 'uncertain');
});

test('evidence rejects wrong source, scope, action ID, authorization and baseline tick', () => {
  const session = lab();
  sent(session);
  const malformed = fixtureEvidence(); delete malformed.durability;
  for (const evidence of [malformed, fixtureEvidence({ source: 'server' }), fixtureEvidence({ durability: 'durable' }), fixtureEvidence({ extra: true })]) {
    assert.equal(session.recordEvidence(evidence).why, 'invalid_evidence');
  }
  for (const overrides of [{ scope: { sessionId: 'other' } }, { scope: { characterId: 'other' } },
    { actionId: 'missing' }, { controlRevision: 0 }, { tick: 9 }]) {
    assert.equal(session.recordEvidence(fixtureEvidence(overrides)).why, 'evidence_mismatch');
  }
  assert.equal(action(session).result, null);
  const unsent = lab();
  unsent.accept(fixtureOrder(), 0);
  assert.equal(unsent.recordEvidence(fixtureEvidence()).why, 'evidence_mismatch');
});

test('partial fixture evidence retains uncertainty, receipts deduplicate and terminal results close', () => {
  const session = lab();
  sent(session);
  const partial = fixtureEvidence({ evidenceId: 'partial-1', outcome: 'partial', effect: 'A partial effect only.' });
  assert.equal(session.recordEvidence(partial).ok, true);
  assert.equal(action(session).effects.length, 1);
  assert.equal(action(session).result, null);
  assert.equal(session.recordEvidence(reorder(partial)).replay, true);
  assert.equal(session.recordEvidence({ ...partial, effect: 'Different effect.' }).why, 'evidence_id_conflict');
  const receipt = fixtureEvidence();
  assert.equal(session.recordEvidence(receipt).ok, true);
  assert.equal(session.recordEvidence(reorder(receipt)).replay, true);
  assert.equal(session.recordEvidence({ ...receipt, outcome: 'rejected' }).why, 'evidence_id_conflict');
  assert.equal(session.recordEvidence(fixtureEvidence({ evidenceId: 'new-result' })).why, 'result_closed');
  assert.equal(action(session).state, 'confirmed');
  assert.equal(action(session).effects.length, 1);
});

test('rejected fixture outcomes close work and do not hide their code', () => {
  const session = lab();
  sent(session);
  assert.equal(session.recordEvidence(fixtureEvidence({ outcome: 'rejected', code: 'blocked', effect: null })).ok, true);
  assert.equal(action(session).state, 'rejected');
  assert.equal(action(session).result.code, 'blocked');
  assert.deepEqual(session.step(1), neutral);
});

test('action, observation and partial-effect capacity limits prevent unbounded retained state', () => {
  const session = lab({ limits: { maxActions: 2, maxEntities: 1, maxChat: 1, maxEffects: 1 } });
  sent(session);
  assert.equal(session.recordEvidence(fixtureEvidence({ outcome: 'partial' })).ok, true);
  assert.equal(session.recordEvidence(fixtureEvidence({ outcome: 'partial', evidenceId: 'receipt-2' })).why, 'effect_capacity');
  session.accept(fixtureOrder({ actionId: 'action-2' }), 1);
  assert.equal(session.accept(fixtureOrder({ actionId: 'action-3' }), 2).why, 'action_capacity');
  assert.equal(session.actions.length, 2);
  const entity = fixtureObservation().confirmed.entities[0];
  assert.equal(session.observe(fixtureObservation({ revision: 2, confirmed: { entities: [entity, { ...entity, ref: { entityId: 8, life: 'life-8' } }] } }), 2).why, 'invalid_observation');
  const message = { id: 'chat-1', channel: 'world', sender: 'agent-1', recipient: null, text: 'hello', tick: 10 };
  assert.equal(session.observe(fixtureObservation({ revision: 2, chat: [message, { ...message, id: 'chat-2' }] }), 2).why, 'invalid_observation');
  assert.equal(session.accept(fixtureOrder(), 2).replay, true);
});

test('invalid configuration is rejected and time never runs backward', () => {
  for (const limits of [{ unknown: 1 }, { maxHorizonMs: 0 }, { maxActions: Infinity }, { maxEffects: -1 }]) {
    assert.throws(() => labLimits(limits), /invalid lab limits/);
  }
  const session = lab();
  session.step(10);
  for (const call of [() => session.observe(fixtureObservation({ revision: 2 }), 9),
    () => session.accept(fixtureOrder(), 9), () => session.step(9),
    () => session.markSent('action-1', { first: 1, last: 1 }, 9), () => session.interrupt('disconnect', 9)]) {
    assert.throws(call, /nonmonotonic lab clock/);
  }
  assert.throws(() => session.step(NaN), /nonmonotonic lab clock/);
  assert.throws(() => session.interrupt('unknown', 10), /invalid interruption/);
  assert.deepEqual(session.step(10), neutral);
});

test('constructor input, observation, orders, receipts and getters are detached from external mutation', () => {
  const grant = fixtureGrant();
  const session = new AgentLabSession({ grant });
  grant.scope.ownerId = 'intruder'; grant.capabilities.length = 0;
  const observation = fixtureObservation();
  session.observe(observation, 0);
  observation.confirmed.self.hp = 0;
  const order = fixtureOrder();
  session.accept(order, 0);
  order.args.mx = -1;
  assert.deepEqual(session.step(0), { ...neutral, mx: 1 });
  session.markSent('action-1', { first: 1, last: 1 }, 0);
  const evidence = fixtureEvidence();
  session.recordEvidence(evidence);
  evidence.effect = 'tampered';
  const exposedGrant = session.grant; exposedGrant.scope.ownerId = 'intruder';
  const exposedObservation = session.observation; exposedObservation.confirmed.entities.length = 0;
  const exposedActions = session.actions; exposedActions[0].order.args.mx = -1; exposedActions[0].result.effect = 'tampered';
  assert.equal(session.grant.scope.ownerId, 'owner-1');
  assert.equal(session.observation.confirmed.entities.length, 1);
  assert.equal(action(session).order.args.mx, 1);
  assert.equal(action(session).result.effect, fixtureEvidence().effect);
});

test('the same simulated observations and decisions reproduce input and result history', () => {
  function run() {
    const session = lab();
    const inputs = [sent(session, fixtureOrder({ type: 'attack_pve' })), session.step(1)];
    session.acknowledge('action-1', 2);
    session.recordEvidence(fixtureEvidence({ outcome: 'partial', evidenceId: 'partial' }));
    session.accept(fixtureOrder({ actionId: 'move-2' }), 2);
    inputs.push(session.step(2));
    session.markSent('move-2', { first: 3, last: 3 }, 2);
    session.recordEvidence(fixtureEvidence());
    session.interrupt('disconnect', 3);
    inputs.push(session.step(4));
    return { inputs, grant: session.grant, observation: session.observation, actions: session.actions };
  }
  assert.deepEqual(run(), run());
});

test('pure order validation expresses dead state without deriving it from prediction', () => {
  const observation = fixtureObservation({ confirmed: { self: { hp: 0, dead: true } } });
  const result = validateOrder(fixtureOrder(), { grant: fixtureGrant(), observation, nowMs: 0 });
  assert.equal(result.why, 'dead');
});

test('malformed cyclic retries reject without crashing or changing the previous action', () => {
  const session = lab();
  sent(session);
  const prior = session.actions;
  const malformed = fixtureOrder();
  malformed.extra = malformed;
  assert.equal(session.accept(malformed, 1).why, 'invalid_order');
  assert.deepEqual(session.actions, prior);
});

test('pure validation rejects missing grants and malformed observations safely', () => {
  assert.equal(validateOrder(fixtureOrder(), { grant: null, observation: null, nowMs: 0 }).why, 'invalid_grant');
  assert.equal(validateOrder(fixtureOrder(), { grant: fixtureGrant(), observation: {}, nowMs: 0 }).why, 'stale_observation');
});
