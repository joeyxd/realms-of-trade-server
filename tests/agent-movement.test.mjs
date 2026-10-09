import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { AgentLabSession } from '../tools/agent/session.mjs';

function setup({ grant: grantOverrides = {}, limits = {} } = {}) {
  const grant = fixtureGrant({ capabilities: ['move'], ...grantOverrides });
  const session = new AgentLabSession({ grant, limits });
  let revision = 0, tick = 0, nowMs = 0;
  const observe = ({ position = { x: 0, y: 0, z: 0 }, entities = [], predicted = null, dead = false, at = nowMs,
    scope = grant.scope, controlRevision = grant.controlRevision } = {}) => {
    nowMs = Math.max(nowMs, at);
    revision++; tick++;
    const observation = fixtureObservation({ scope, controlRevision, revision, tick, receivedAtMs: at,
      confirmed: { self: { position, hp: dead ? 0 : 100, maxHp: 100, dead }, entities }, predicted });
    return session.observe(observation, nowMs);
  };
  observe();
  const order = (actionId, type, args, overrides = {}) => ({ v: 1, actionId, scope: grant.scope,
    controlRevision: grant.controlRevision, observationRevision: session.observation.revision,
    type, args, ...overrides });
  const setTime = (value) => { nowMs = value; };
  return { grant, session, observe, order, setTime, get time() { return nowMs; } };
}

const player = (entityId = 9, life = 'player-life-a', position = { x: 10, y: 0, z: 0 }) => ({
  ref: { entityId, life }, kind: 'player', position, hp: 100,
});
const nav = (session, actionId) => session.actions.find((action) => action.order.actionId === actionId).navigation;

test('go_to normalizes diagonal input and arrives only from a confirmed position', () => {
  const { session, observe, order, setTime } = setup();
  const accepted = session.accept(order('diagonal', 'go_to', { x: 3, z: 4, tolerance: 0.5, durationMs: 5000 }), 0);
  assert.equal(accepted.ok, true);
  assert.equal(nav(session, 'diagonal').status, 'moving');
  const input = session.step(1);
  assert.ok(Math.abs(input.mx - 0.6) < 1e-12);
  assert.ok(Math.abs(input.mz - 0.8) < 1e-12);
  assert.ok(Math.abs(Math.hypot(input.mx, input.mz) - 1) < 1e-12);

  assert.equal(session.markSent('diagonal', { first: 1, last: 1 }, 2).ok, true);
  setTime(20);
  assert.equal(observe({ position: { x: 3, y: 70, z: 4 }, at: 20 }).ok, true);
  assert.equal(nav(session, 'diagonal').status, 'arrived', 'vertical difference does not affect planar arrival');
  assert.equal(session.actions.find((a) => a.order.actionId === 'diagonal').result, null,
    'fixture navigation does not claim a confirmed action effect');
  assert.deepEqual(session.step(21), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
});

test('follow approaches a referenced player and holds inside its outer band without backing away', () => {
  const { session, observe, order } = setup();
  const target = player();
  observe({ entities: [target], at: 0 });
  assert.equal(session.accept(order('follow', 'follow', { target: target.ref, distance: 3, tolerance: 0.5, durationMs: 9000 }), 0).ok, true);
  const toward = session.step(1);
  assert.deepEqual({ mx: toward.mx, mz: toward.mz }, { mx: 1, mz: 0 });
  assert.equal(session.markSent('follow', { first: 1, last: 1 }, 2).ok, true);
  observe({ position: { x: 6.6, y: 0, z: 0 }, entities: [target], at: 10 });
  assert.equal(nav(session, 'follow').status, 'holding');
  assert.deepEqual(session.step(11), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
  observe({ position: { x: 7.8, y: 0, z: 0 }, entities: [target], at: 20 });
  assert.equal(nav(session, 'follow').status, 'holding', 'being closer than the requested distance still holds');
  assert.deepEqual(session.step(21), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
});

test('keep_distance backs away when too close and holds inside its distance band', () => {
  const { session, observe, order } = setup();
  const target = player(9, 'keep-life', { x: 1, y: 0, z: 0 });
  observe({ entities: [target], at: 0 });
  assert.equal(session.accept(order('space', 'keep_distance', { target: target.ref, distance: 4, tolerance: 0.5, durationMs: 9000 }), 0).ok, true);
  const away = session.step(1);
  assert.deepEqual({ mx: away.mx, mz: away.mz }, { mx: -1, mz: 0 });
  session.markSent('space', { first: 1, last: 1 }, 2);
  observe({ position: { x: -3.2, y: 0, z: 0 }, entities: [target], at: 10 });
  assert.equal(nav(session, 'space').status, 'holding');
  assert.deepEqual(session.step(11), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
});

test('identical observations and times produce identical movement decisions', () => {
  const run = () => {
    const { session, order } = setup();
    session.accept(order('repeatable', 'go_to', { x: 5, z: 5, tolerance: 0.5, durationMs: 4000 }), 0);
    return [session.step(1), session.actions, session.step(2)];
  };
  assert.deepEqual(run(), run());
});

test('movement watchdog blocks sent work without progress; unsent work stays cancellable', () => {
  const sent = setup({ limits: { movementBlockedAfterMs: 1500, movementMinProgressMm: 150 } });
  assert.equal(sent.session.accept(sent.order('sent-goal', 'go_to', { x: 8, z: 0, tolerance: 0.5, durationMs: 5000 }), 0).ok, true);
  assert.equal(sent.session.markSent('sent-goal', { first: 1, last: 1 }, 0).ok, true);
  sent.setTime(1500);
  assert.equal(sent.observe({ position: { x: 0, y: 0, z: 0 }, at: 1500 }).ok, true);
  assert.equal(nav(sent.session, 'sent-goal').status, 'blocked');
  assert.equal(sent.session.actions.find((a) => a.order.actionId === 'sent-goal').state, 'uncertain');

  const unsent = setup({ limits: { movementBlockedAfterMs: 1500, movementMinProgressMm: 150 } });
  unsent.session.accept(unsent.order('unsent-goal', 'go_to', { x: 8, z: 0, tolerance: 0.5, durationMs: 5000 }), 0);
  unsent.setTime(1500);
  unsent.observe({ position: { x: 0, y: 0, z: 0 }, at: 1500 });
  assert.equal(nav(unsent.session, 'unsent-goal').status, 'moving', 'the progress watchdog starts only after emission');
  assert.equal(unsent.session.cancel('unsent-goal', 1500).action.state, 'cancelled');
  assert.equal(nav(unsent.session, 'unsent-goal').status, 'cancelled');
  assert.equal(unsent.session.actions.find((a) => a.order.actionId === 'unsent-goal').state, 'cancelled');
});

test('confirmed progress resets the watchdog; movement remains active while progress continues', () => {
  const { session, observe, order, setTime } = setup({ limits: { movementBlockedAfterMs: 1500, movementMinProgressMm: 150 } });
  session.accept(order('progress', 'go_to', { x: 8, z: 0, tolerance: 0.5, durationMs: 6000 }), 0);
  session.markSent('progress', { first: 1, last: 1 }, 0);
  setTime(1400);
  assert.equal(observe({ position: { x: 0.2, y: 0, z: 0 }, at: 1400 }).ok, true);
  assert.equal(nav(session, 'progress').status, 'moving');
  setTime(2800);
  assert.equal(observe({ position: { x: 0.4, y: 0, z: 0 }, at: 2800 }).ok, true);
  assert.equal(nav(session, 'progress').status, 'moving');
});

test('follow and keep_distance stop at their horizon; sent work stays uncertain and neutral', () => {
  for (const [type, target, distance] of [
    ['follow', player(9, 'follow-horizon', { x: 10, y: 0, z: 0 }), 3],
    ['keep_distance', player(9, 'keep-horizon', { x: 10, y: 0, z: 0 }), 4],
  ]) {
    const current = setup();
    current.observe({ entities: [target], at: 0 });
    assert.equal(current.session.accept(current.order(`horizon-${type}`, type, {
      target: target.ref, distance, tolerance: 0.5, durationMs: 50,
    }), 0).ok, true);
    assert.equal(current.session.markSent(`horizon-${type}`, { first: 1, last: 1 }, 0).ok, true);
    assert.notDeepEqual(current.session.step(49), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
    // No new observation is needed for the duration fence to stop future input.
    assert.deepEqual(current.session.step(50), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
    const action = current.session.actions.find((entry) => entry.order.actionId === `horizon-${type}`);
    assert.equal(action.navigation.status, 'cancelled');
    assert.equal(action.navigation.why, 'duration_elapsed');
    assert.equal(action.state, 'uncertain');
    assert.equal(action.result, null);
  }

  const stopped = setup();
  const target = player(9, 'stop-horizon', { x: 10, y: 0, z: 0 });
  stopped.observe({ entities: [target], at: 0 });
  stopped.session.accept(stopped.order('stop-follow', 'follow', {
    target: target.ref, distance: 3, tolerance: 0.5, durationMs: 5000,
  }), 0);
  stopped.session.markSent('stop-follow', { first: 1, last: 1 }, 0);
  stopped.session.interrupt('stop', 1);
  const action = stopped.session.actions.find((entry) => entry.order.actionId === 'stop-follow');
  assert.equal(action.navigation.status, 'cancelled');
  assert.equal(action.navigation.why, 'stop');
  assert.equal(action.state, 'uncertain');
  assert.deepEqual(stopped.session.step(2), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
});

test('navigation freshness stays tied to confirmed snapshots and prediction cannot predeclare arrival', () => {
  const context = setup();
  const goal = { x: 8, y: 0, z: 0 };
  context.observe({ predicted: { position: goal, hp: 100, maxHp: 100, dead: false }, at: 0 });
  assert.equal(context.session.accept(context.order('freshness', 'go_to', {
    x: goal.x, z: goal.z, tolerance: 0.5, durationMs: 5000,
  }), 0).ok, true);
  assert.equal(nav(context.session, 'freshness').status, 'moving');
  assert.equal(nav(context.session, 'freshness').observedAtMs, 0);
  assert.equal(nav(context.session, 'freshness').observationTick, context.session.observation.tick);
  assert.equal(nav(context.session, 'freshness').source, 'fixture');
  context.session.markSent('freshness', { first: 1, last: 1 }, 0);
  context.session.step(10);
  context.session.step(20);
  assert.equal(nav(context.session, 'freshness').status, 'moving');
  assert.equal(nav(context.session, 'freshness').observedAtMs, 0, 'pump time does not refresh snapshot time');
  assert.equal(nav(context.session, 'freshness').observationTick, context.session.observation.tick);
});

test('malformed movement arguments, unauthorized scopes, ranges, and horizons are rejected', () => {
  const { session, order, grant } = setup();
  const valid = { x: 5, z: 0, tolerance: 0.5, durationMs: 2000 };
  let index = 0;
  const reject = (args, override = {}) => session.accept(order(`bad-${++index}`, 'go_to', args, override), 0);
  assert.equal(reject({ ...valid, extra: true }).why, 'invalid_args');
  assert.equal(reject({ ...valid, tolerance: 0.1 }).why, 'invalid_args');
  assert.equal(reject({ ...valid, durationMs: 30001 }).why, 'invalid_horizon');
  assert.equal(reject({ ...valid, x: 65 }).why, 'destination_out_of_range');
  assert.equal(reject(valid, { scope: { ...grant.scope, sessionId: 'other-session' } }).why, 'control_mismatch');

  const noMove = setup({ grant: { capabilities: [] } });
  assert.equal(noMove.session.accept(noMove.order('forbidden', 'go_to', valid), 0).why, 'forbidden');
  assert.throws(() => new AgentLabSession({ grant, limits: { movementMinProgressMm: 0 } }), /invalid/);
});

test('target identity and life are validated; cancellation and supersession clear the old controller', () => {
  const { session, observe, order } = setup();
  const target = player(9, 'life-one', { x: 8, y: 0, z: 0 });
  observe({ entities: [target], at: 0 });
  assert.equal(session.accept(order('old-follow', 'follow', { target: target.ref, distance: 2, tolerance: 0.5, durationMs: 8000 }), 0).ok, true);
  assert.deepEqual({ ...session.step(1), navigation: undefined },
    { mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, navigation: undefined });
  assert.equal(session.accept(order('replacement', 'go_to', { x: 0, z: 5, tolerance: 0.5, durationMs: 8000 }), 2).ok, true);
  assert.equal(nav(session, 'old-follow').status, 'cancelled');
  assert.equal(session.actions.find((a) => a.order.actionId === 'old-follow').why, 'superseded');
  assert.deepEqual({ ...session.step(3), navigation: undefined },
    { mx: 0, mz: 1, ax: 0, az: 0, btn: 0, prs: 0, navigation: undefined });

  const targetChange = setup();
  targetChange.observe({ entities: [target], at: 0 });
  targetChange.session.accept(targetChange.order('changed-life', 'follow', {
    target: target.ref, distance: 2, tolerance: 0.5, durationMs: 8000,
  }), 0);
  targetChange.observe({ position: { x: 0, y: 0, z: 0 }, entities: [player(9, 'life-two')], at: 1 });
  assert.equal(nav(targetChange.session, 'changed-life').status, 'cancelled');
  assert.equal(targetChange.session.actions.find((a) => a.order.actionId === 'changed-life').why, 'target_unavailable');
});

test('stale observation and death cancel navigation without manufacturing a result', () => {
  const stale = setup();
  stale.session.accept(stale.order('stale', 'go_to', { x: 8, z: 0, tolerance: 0.5, durationMs: 5000 }), 0);
  stale.session.markSent('stale', { first: 1, last: 1 }, 0);
  stale.setTime(1601);
  assert.deepEqual(stale.session.step(1601), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
  assert.equal(nav(stale.session, 'stale').status, 'cancelled');
  assert.equal(stale.session.actions.find((a) => a.order.actionId === 'stale').state, 'uncertain');
  assert.equal(stale.session.actions.find((a) => a.order.actionId === 'stale').result, null);

  const dead = setup();
  dead.session.accept(dead.order('death', 'go_to', { x: 8, z: 0, tolerance: 0.5, durationMs: 5000 }), 0);
  dead.session.markSent('death', { first: 1, last: 1 }, 0);
  assert.equal(dead.observe({ dead: true, at: 1 }).why, 'dead');
  assert.equal(nav(dead.session, 'death').status, 'cancelled');
  assert.equal(dead.session.actions.find((a) => a.order.actionId === 'death').state, 'uncertain');
  assert.equal(dead.session.actions.find((a) => a.order.actionId === 'death').result, null);
});
