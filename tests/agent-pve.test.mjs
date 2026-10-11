import test from 'node:test';
import assert from 'node:assert/strict';
import { PveBody } from '../tools/agent/pve-body.mjs';
import { AgentLabSession } from '../tools/agent/session.mjs';
import { fixtureGrant, fixtureObservation } from '../tools/agent/fixtures.mjs';
import { validObservation, validateOrder } from '../tools/agent/contract.mjs';
import { BTN } from '../src/sim/systems/movement.js';
import { tuning } from '../src/data/tuning.js';

const combat = (overrides = {}) => ({ weapon: 0, attackStage: 0, stagger: 0, castLock: 0,
  guardStamina: 60, potions: 1, potionCooldown: 0, playerNearby: false, guardRaised: false, ...overrides });
const player = (entityId, life, position, hp = 100) => ({ ref: { entityId, life }, kind: 'player', position, hp });
const enemy = (entityId, life, position, hp = 40) => ({ ref: { entityId, life }, kind: 'enemy', position, hp });
const confirmed = ({ position = { x: 0, y: 0, z: 0 }, hp = 100, entities = [], combat: state = combat() } = {}) => ({
  self: { position, hp, maxHp: 100, dead: hp <= 0 }, entities, combat: state,
});
const args = (mode = 'aggressive', extra = {}) => ({ mode, protect: null, retreatHpFraction: 0.3,
  allowPotion: false, durationMs: 10000, ...extra });
const makeBody = (mode, { origin = { x: 0, y: 0, z: 0 }, options = {}, overrides = {} } = {}) =>
  new PveBody({ args: args(mode, overrides), position: origin, nowMs: 0, ...options });
const bodyPveOrder = (session, actionId, bodyArgs, overrides = {}) => ({
  v: 1, actionId, scope: session.grant.scope, controlRevision: session.grant.controlRevision,
  observationRevision: session.observation.revision, type: 'body_pve', args: bodyArgs, ...overrides,
});

function sessionSetup({ capabilities = ['body_pve', 'move', 'aim', 'attack_pve'], limits = {} } = {}) {
  const grant = fixtureGrant({ capabilities });
  const session = new AgentLabSession({ grant, limits });
  let revision = 0, tick = 0, nowMs = 0;
  const observe = ({ at = nowMs, ...overrides } = {}) => {
    nowMs = Math.max(nowMs, at); revision++; tick++;
    const incoming = overrides.confirmed ?? {};
    const base = confirmed();
    const confirmedValue = { ...base, ...incoming,
      self: { ...base.self, ...incoming.self },
      entities: incoming.entities ?? base.entities,
      combat: incoming.combat ?? base.combat };
    const observation = fixtureObservation({ ...overrides, revision, tick, receivedAtMs: at, confirmed: confirmedValue });
    return session.observe(observation, nowMs);
  };
  assert.equal(observe().ok, true);
  return { grant, session, observe, setTime(value) { nowMs = value; } };
}

test('aggressive target choice is deterministic and breaks equal-distance ties by entity id', () => {
  const run = () => {
    const body = makeBody('aggressive');
    const seen = confirmed({ entities: [enemy(8, 'z-life', { x: 3, y: 0, z: 0 }),
      enemy(4, 'a-life', { x: -3, y: 0, z: 0 })] });
    return body.step(seen, 10, { emit: true });
  };
  const first = run();
  assert.deepEqual(first, run());
  assert.deepEqual(first.body.target, { entityId: 4, life: 'a-life' });
  assert.equal(first.prs & BTN.ATTACK, 0);
  assert.equal(first.mx, -1);
});

test('body attacks only in range, honors busy combat state and applies mode cadence to emitted pulses', () => {
  const target = enemy(7, 'e-life', { x: 1, y: 0, z: 0 });
  const body = makeBody('aggressive');
  const first = body.step(confirmed({ entities: [target] }), 0, { emit: true });
  assert.equal(first.prs & BTN.ATTACK, BTN.ATTACK);
  assert.equal(first.btn & BTN.GUARD, 0, 'attack pulse does not overlap the guard hold');
  assert.equal(body.step(confirmed({ entities: [target] }), 449, { emit: true }).prs & BTN.ATTACK, 0);
  assert.equal(body.step(confirmed({ entities: [target] }), 450, { emit: true }).prs & BTN.ATTACK, BTN.ATTACK);
  for (const field of ['attackStage', 'stagger', 'castLock']) {
    const busy = makeBody('aggressive').step(confirmed({ entities: [target], combat: combat({ [field]: 1 }) }), 0, { emit: true });
    assert.equal(busy.prs & BTN.ATTACK, 0, `${field} prevents an attack pulse`);
  }
  const distant = makeBody('aggressive').step(confirmed({ entities: [enemy(9, 'far', { x: 3, y: 0, z: 0 })] }), 0, { emit: true });
  assert.equal(distant.prs & BTN.ATTACK, 0);
});

test('aim uses absolute world coordinates when the controlled body is away from the origin', () => {
  const body = makeBody('aggressive', { origin: { x: 20, y: 0, z: 30 } });
  const out = body.step(confirmed({ position: { x: 20, y: 0, z: 30 },
    entities: [enemy(7, 'e-life', { x: 21, y: 0, z: 31 })] }), 1);
  assert.deepEqual({ ax: out.ax, az: out.az }, { ax: 21, az: 31 });
});

test('non-emitting observation steps do not consume attack or potion pulse cadence', () => {
  const target = enemy(7, 'e-life', { x: 1, y: 0, z: 0 });
  const body = makeBody('aggressive');
  assert.equal(body.step(confirmed({ entities: [target] }), 0).prs, 0);
  assert.equal(body.step(confirmed({ entities: [target] }), 1, { emit: true }).prs & BTN.ATTACK, BTN.ATTACK);

  const potion = makeBody('support', { overrides: { protect: { entityId: 2, life: 'p-life' }, allowPotion: true },
    origin: { x: -1, y: 0, z: 0 } });
  const low = confirmed({ hp: 20, entities: [player(2, 'p-life', { x: 0, y: 0, z: 0 })] });
  assert.equal(potion.step(low, 0).prs & BTN.POTION, 0);
  assert.equal(potion.step(low, 1, { emit: true }).prs & BTN.POTION, BTN.POTION);
});

test('player proximity suppresses PvE attacks while preserving guard input', () => {
  const target = enemy(7, 'e-life', { x: 1, y: 0, z: 0 });
  const out = makeBody('aggressive').step(confirmed({ entities: [target], combat: combat({ playerNearby: true }) }), 0, { emit: true });
  assert.equal(out.prs & BTN.ATTACK, 0);
  assert.ok(out.btn & BTN.GUARD);
  assert.equal(out.body.attackSuppressed, true);
});

test('defensive mode holds its anchor and guards a nearby enemy while aggressive mode approaches', () => {
  const threat = enemy(3, 'threat', { x: 3, y: 0, z: 0 });
  const seen = confirmed({ entities: [threat] });
  const defense = makeBody('defensive').step(seen, 0, { emit: true });
  const offense = makeBody('aggressive').step(seen, 0, { emit: true });
  assert.equal(defense.mx, 0);
  assert.ok(defense.btn & BTN.GUARD);
  assert.equal(defense.body.status, 'guarding');
  assert.ok(offense.mx > 0);
  assert.equal(offense.body.status, 'approaching');
});

test('guard requires minimum stamina unless already raised, then continues with positive stamina', () => {
  const threat = enemy(3, 'threat', { x: 3, y: 0, z: 0 });
  const below = makeBody('defensive').step(confirmed({ entities: [threat],
    combat: combat({ guardStamina: tuning.guard.minRaise - 1 }) }), 0);
  assert.equal(below.btn & BTN.GUARD, 0);
  const raised = makeBody('defensive').step(confirmed({ entities: [threat],
    combat: combat({ guardStamina: 1, guardRaised: true }) }), 0);
  assert.ok(raised.btn & BTN.GUARD);
  const empty = makeBody('defensive').step(confirmed({ entities: [threat],
    combat: combat({ guardStamina: 0, guardRaised: true }) }), 0);
  assert.equal(empty.btn & BTN.GUARD, 0);
});

test('defensive mode counterattacks only inside range and uses its slower cadence', () => {
  const target = enemy(3, 'threat', { x: 1, y: 0, z: 0 });
  const body = makeBody('defensive');
  assert.equal(body.step(confirmed({ entities: [target] }), 0, { emit: true }).prs & BTN.ATTACK, BTN.ATTACK);
  assert.equal(body.step(confirmed({ entities: [target] }), 799, { emit: true }).prs & BTN.ATTACK, 0);
  assert.equal(body.step(confirmed({ entities: [target] }), 800, { emit: true }).prs & BTN.ATTACK, BTN.ATTACK);
});

test('support follows its living player and moves to an interception point for a nearby enemy', () => {
  const protect = player(2, 'p-life', { x: 0, y: 0, z: 0 });
  const threat = enemy(3, 'threat', { x: 5, y: 0, z: 0 });
  const body = makeBody('support', { origin: { x: -3, y: 0, z: 0 }, overrides: { protect: protect.ref } });
  const intercept = body.step(confirmed({ position: { x: -3, y: 0, z: 0 }, entities: [protect, threat] }), 0);
  assert.equal(intercept.body.target.entityId, 3);
  assert.equal(intercept.body.status, 'approaching');
  assert.ok(intercept.mx > 0, 'body moves between the player and the enemy');
  assert.equal(intercept.body.protect.life, 'p-life');
  const arrived = body.step(confirmed({ position: { x: 2, y: 0, z: 0 }, entities: [protect, threat] }), 1);
  assert.equal(arrived.body.status, 'guarding');
  assert.equal(arrived.mx, 0);
  assert.equal(Math.hypot(2 - protect.position.x, protect.position.z), 2);

  const follow = makeBody('support', { origin: { x: -5, y: 0, z: 0 }, overrides: { protect: protect.ref } })
    .step(confirmed({ position: { x: -5, y: 0, z: 0 }, entities: [protect] }), 0);
  assert.equal(follow.body.status, 'following');
  assert.ok(follow.mx > 0);
});

test('support cancels when protected player is absent, dead or has a different life', () => {
  for (const protect of [null, player(2, 'new-life', { x: 0, y: 0, z: 0 }),
    { ...player(2, 'p-life', { x: 0, y: 0, z: 0 }), hp: 0 }]) {
    const body = makeBody('support', { overrides: { protect: { entityId: 2, life: 'p-life' } } });
    const out = body.step(confirmed({ entities: protect ? [protect] : [] }), 1);
    assert.equal(out.body.status, 'cancelled');
    assert.equal(out.body.why, 'protect_unavailable');
    assert.deepEqual({ mx: out.mx, mz: out.mz, btn: out.btn, prs: out.prs }, { mx: 0, mz: 0, btn: 0, prs: 0 });
  }
});

test('low health starts retreat with hysteresis, guards, and consumes only an authorized ready potion', () => {
  const threat = enemy(7, 'e-life', { x: 2, y: 0, z: 0 });
  const body = makeBody('aggressive', { overrides: { allowPotion: true } });
  const low = confirmed({ hp: 20, entities: [threat] });
  const first = body.step(low, 0, { emit: true });
  assert.equal(first.body.status, 'retreating');
  assert.ok(first.mx < 0);
  assert.ok(first.btn & BTN.GUARD);
  assert.ok(first.prs & BTN.POTION);
  assert.equal(body.step(confirmed({ hp: 35, entities: [threat] }), 100, { emit: true }).body.status, 'retreating');
  assert.equal(body.step(confirmed({ hp: 41, entities: [threat] }), 200, { emit: true }).body.status, 'approaching');
});

test('potion needs explicit permission, a low-health threshold, stock and ready server cooldown', () => {
  const protect = player(2, 'p-life', { x: 0, y: 0, z: 0 });
  const low = confirmed({ hp: 20, entities: [protect] });
  for (const state of [combat({ potions: 0 }), combat({ potionCooldown: 2 })]) {
    const out = makeBody('support', { overrides: { protect: protect.ref, allowPotion: true } })
      .step({ ...low, combat: state }, 0, { emit: true });
    assert.equal(out.prs & BTN.POTION, 0);
  }
  const denied = makeBody('support', { overrides: { protect: protect.ref, allowPotion: false } })
    .step(low, 0, { emit: true });
  assert.equal(denied.prs & BTN.POTION, 0);

  const body = makeBody('support', { overrides: { protect: protect.ref, allowPotion: true } });
  const ready = { ...low, combat: combat({ potions: 2, potionCooldown: 0 }) };
  assert.ok(body.step(ready, 0, { emit: true }).prs & BTN.POTION);
  assert.equal(body.step(ready, 1200, { emit: true }).prs & BTN.POTION, 0,
    'same observed inventory/cooldown signature cannot cause a duplicate use');
  const rateBody = makeBody('support', { overrides: { protect: protect.ref, allowPotion: true } });
  assert.ok(rateBody.step(ready, 0, { emit: true }).prs & BTN.POTION);
  const spent = { ...low, combat: combat({ potions: 1, potionCooldown: 0 }) };
  assert.equal(rateBody.step(spent, 500, { emit: true }).prs & BTN.POTION, 0, 'inventory change cannot bypass the 1s local rate');
  assert.ok(rateBody.step(spent, 1000, { emit: true }).prs & BTN.POTION);
  assert.equal(rateBody.step({ ...low, combat: combat({ potions: 0, potionCooldown: 4 }) }, 4000, { emit: true }).prs & BTN.POTION, 0);
});

test('watchdog starts only after emitted movement and observed progress restarts its window', () => {
  const body = makeBody('aggressive', { options: { blockedAfterMs: 1500 } });
  const target = enemy(7, 'e-life', { x: 8, y: 0, z: 0 });
  const seen = confirmed({ entities: [target] });
  body.step(seen, 0);
  body.step(seen, 1500);
  assert.notEqual(body.snapshot.status, 'blocked', 'unemitted inputs cannot start the watchdog');
  body.step(seen, 1501, { emit: true });
  body.emitted(1501);
  body.step(confirmed({ position: { x: 0.2, y: 0, z: 0 }, entities: [target] }), 2500);
  body.emitted(2500);
  assert.notEqual(body.snapshot.status, 'blocked');
  const stopped = body.step(confirmed({ position: { x: 0.2, y: 0, z: 0 }, entities: [target] }), 4001);
  assert.equal(stopped.body.status, 'blocked');
  assert.equal(stopped.body.why, 'no_observed_progress');
  assert.equal(body.step(seen, 4002, { emit: true }).prs, 0, 'blocked bodies remain neutral');
});

test('body cancellation, death, missing combat and unsupported weapon always return neutral', () => {
  const body = makeBody('aggressive');
  assert.equal(body.step(confirmed(), 0).body.status, 'holding');
  const missingCombat = confirmed(); delete missingCombat.combat;
  assert.equal(makeBody('aggressive').step(missingCombat, 0).body.why, 'combat_observation_missing');
  const dead = makeBody('aggressive').step(confirmed({ hp: 0 }), 0);
  assert.equal(dead.body.why, 'dead');
  const unsupported = makeBody('aggressive').step(confirmed({ combat: combat({ weapon: 2 }) }), 0);
  assert.equal(unsupported.body.why, 'unsupported_weapon');
  const cancelled = makeBody('aggressive');
  cancelled.cancel('superseded');
  assert.equal(cancelled.step(confirmed(), 1, { emit: true }).body.why, 'superseded');
  const expired = makeBody('aggressive', { overrides: { durationMs: 10 } }).step(confirmed(), 10);
  assert.equal(expired.body.why, 'duration_elapsed');
});

test('combat observation is optional for L02a observations, but exact when present', () => {
  const legacy = fixtureObservation();
  assert.equal(validObservation(legacy), true);
  const withCombat = fixtureObservation({ confirmed: { combat: combat() } });
  assert.equal(validObservation(withCombat), true);
  for (const invalid of [combat({ extra: true }), combat({ weapon: 'sable' }), combat({ playerNearby: 1 })]) {
    assert.equal(validObservation(fixtureObservation({ confirmed: { combat: invalid } })), false);
  }
});

test('body_pve validation requires the full capability set, exact arguments, valid mode/protect and horizon', () => {
  const { session, grant } = sessionSetup();
  const observation = session.observation;
  const order = (capabilities, bodyArgs, type = 'body_pve') => validateOrder(bodyPveOrder(session, 'validate', bodyArgs, { type }), {
    grant: fixtureGrant({ capabilities }), observation, nowMs: 0,
  });
  const valid = args('aggressive');
  assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'], valid).ok, true);
  for (const missing of ['body_pve', 'move', 'aim', 'attack_pve']) {
    assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'].filter((item) => item !== missing), valid).why, 'forbidden');
  }
  assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'], args('support')).why, 'invalid_args');
  assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'], args('defensive', { protect: { entityId: 2, life: 'x' } })).why, 'invalid_args');
  assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'], args('aggressive', { protect: {} })).why, 'invalid_args');
  assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'], args('aggressive', { retreatHpFraction: 0.09 })).why, 'invalid_args');
  assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'], args('aggressive', { allowPotion: 1 })).why, 'invalid_args');
  assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'], args('aggressive', { durationMs: 30001 })).why, 'invalid_horizon');
  assert.equal(order(['body_pve', 'move', 'aim', 'attack_pve'], args('aggressive', { durationMs: 500 }), 'attack_pve').why, 'invalid_args');
  const orderValue = bodyPveOrder(session, 'combat-check', valid);
  assert.equal(validateOrder(orderValue, { grant, observation: fixtureObservation(), nowMs: 0 }).why, 'combat_unavailable');
  assert.equal(validateOrder(orderValue, { grant,
    observation: fixtureObservation({ confirmed: { combat: combat({ weapon: 1 }) } }), nowMs: 0 }).why, 'unsupported_weapon');
});

test('AgentSession attaches body decisions only to fresh confirmed snapshots and preserves sent uncertainty', () => {
  const { session, observe } = sessionSetup();
  const bodyArgs = args('aggressive');
  const order = bodyPveOrder(session, 'body-action', bodyArgs);
  assert.equal(session.accept(order, 0).ok, true);
  const accepted = session.actions.find((action) => action.order.actionId === 'body-action');
  assert.equal(accepted.body.source, 'fixture');
  assert.equal(accepted.body.observationTick, session.observation.tick);
  assert.equal(accepted.body.observedAtMs, session.observation.receivedAtMs);
  const output = session.step(10);
  assert.equal(typeof output.btn, 'number');
  assert.ok(accepted.body);
  assert.equal(session.markSent('body-action', { first: 1, last: 1 }, 10).ok, true);
  assert.equal(observe({ at: 20, confirmed: { self: { position: { x: 0, y: 0, z: 0 } } } }).ok, true);
  const updated = session.actions.find((action) => action.order.actionId === 'body-action');
  assert.equal(updated.state, 'sent', 'a fresh accepted snapshot keeps the body task active');
  assert.equal(updated.body.observationTick, session.observation.tick);
  assert.equal(updated.body.observedAtMs, session.observation.receivedAtMs);
  session.cancel('body-action', 21);
  assert.equal(session.actions.find((action) => action.order.actionId === 'body-action').state, 'uncertain');
  assert.equal(session.actions.find((action) => action.order.actionId === 'body-action').result, null);
  assert.deepEqual(session.step(22), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
});

test('AgentSession supersedes, times out and dies without fabricating a body result', () => {
  const superseded = sessionSetup();
  const first = bodyPveOrder(superseded.session, 'first-body', args('aggressive'));
  assert.equal(superseded.session.accept(first, 0).ok, true);
  superseded.session.step(1);
  superseded.session.markSent('first-body', { first: 1, last: 1 }, 1);
  const replacement = { v: 1, actionId: 'plain-move', scope: superseded.grant.scope,
    controlRevision: superseded.grant.controlRevision, observationRevision: superseded.session.observation.revision,
    type: 'move', args: { mx: 0, mz: 0, durationMs: 100 } };
  assert.equal(superseded.session.accept(replacement, 2).ok, true);
  assert.equal(superseded.session.actions.find((action) => action.order.actionId === 'first-body').state, 'uncertain');

  const timeout = sessionSetup();
  assert.equal(timeout.session.accept(bodyPveOrder(timeout.session, 'timed', args('aggressive', { durationMs: 10 })), 0).ok, true);
  timeout.session.step(1); timeout.session.markSent('timed', { first: 1, last: 1 }, 1);
  assert.deepEqual(timeout.session.step(10), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
  assert.equal(timeout.session.actions.find((action) => action.order.actionId === 'timed').state, 'uncertain');

  const dead = sessionSetup();
  assert.equal(dead.session.accept(bodyPveOrder(dead.session, 'dies', args('aggressive')), 0).ok, true);
  dead.session.step(1); dead.session.markSent('dies', { first: 1, last: 1 }, 1);
  assert.equal(dead.observe({ at: 2, confirmed: { self: { hp: 0, dead: true } } }).why, 'dead');
  assert.equal(dead.session.actions.find((action) => action.order.actionId === 'dies').state, 'uncertain');
});

test('stale confirmed state stops an emitted body and retains uncertainty', () => {
  const stale = sessionSetup();
  assert.equal(stale.session.accept(bodyPveOrder(stale.session, 'stale-body', args('aggressive')), 0).ok, true);
  stale.session.step(1);
  assert.equal(stale.session.markSent('stale-body', { first: 1, last: 1 }, 1).ok, true);
  assert.deepEqual(stale.session.step(1501), { mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0 });
  const action = stale.session.actions.find((entry) => entry.order.actionId === 'stale-body');
  assert.equal(action.state, 'uncertain');
  assert.equal(action.body.status, 'cancelled');
  assert.equal(action.body.why, 'stale_observation');
  assert.equal(action.result, null);
});

test('prediction cannot change the body decision while confirmed combat and entities stay fixed', () => {
  const protect = player(2, 'p-life', { x: 0, y: 0, z: 0 });
  const threat = enemy(3, 'threat', { x: 1, y: 0, z: 0 });
  const grant = fixtureGrant({ capabilities: ['body_pve', 'move', 'aim', 'attack_pve'] });
  const run = (predicted) => {
    const session = new AgentLabSession({ grant });
    const observation = fixtureObservation({ confirmed: { self: { position: { x: 0, y: 0, z: 0 } },
      entities: [protect, threat], combat: combat() }, predicted });
    assert.equal(session.observe(observation, 0).ok, true);
    assert.equal(session.accept(bodyPveOrder(session, 'support-body', args('support', { protect: protect.ref })), 0).ok, true);
    return session.step(1);
  };
  assert.deepEqual(run(null), run({ position: { x: 100, y: 0, z: 100 }, hp: 1, maxHp: 100, dead: false }));
});
