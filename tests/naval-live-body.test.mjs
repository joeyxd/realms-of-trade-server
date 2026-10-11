import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from '../src/data/meta.js';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';
import { NAVAL_NAVIGATION } from '../src/data/navalNavigation.js';
import { NavalPilotPrediction } from '../src/client/navalPilotPrediction.js';
import { World } from '../src/sim/world.js';
import { newProfile, attachProfile, installInventory } from '../src/sim/systems/inventory.js';
import { installTrade } from '../src/sim/systems/trade.js';
import { attachRafts, installRafts, prepareRaftProfile } from '../src/sim/systems/rafts.js';
import { NavalTrial } from '../src/sim/naval/trial.js';
import { createTrialBody, damageTrialBody, refreshTrialPayload, stepTrialBody } from '../src/sim/naval/trialBody.js';
import { navalPose } from '../src/sim/naval/handling.js';
import { map } from './helpers.mjs';
import { goodMass } from '../src/sim/economy/cargo.js';
import { RAFT_LOAD } from '../src/data/raftparts.js';
import { raftCapacity } from '../src/sim/economy/raftCapacity.js';

function liveFixture({ tick = 0 } = {}) {
  const w = new World(GAME.seed, { map, server: true, navalTrial: true });
  installInventory(w, 'naval-live-body'); installTrade(w); installRafts(w, 'naval-live-body');
  const owner = w.spawnPlayer({ name: 'Capitana', clientId: 71 }), profile = newProfile();
  profile.eco.pack.goods.madera = 1;
  assert.equal(prepareRaftProfile(w, profile), true);
  attachProfile(w, owner, profile); attachRafts(w, owner, profile);
  const source = [...w.rafts.values()].find((record) => record.owner === owner);
  source.ship.hold.goods.hierro = 2;
  w.ecs.x[owner] = w.ecs.x[source.entity]; w.ecs.y[owner] = w.ecs.y[source.entity] + 0.72;
  w.ecs.z[owner] = w.ecs.z[source.entity];
  w.tick = tick;
  w.navalTrial = new NavalTrial(w, { coast: true, navigation: true });
  return { w, owner, profile, source, trial: w.navalTrial };
}

test('navigation body freezes actual hold and carried-pack ballast and damage rebuild retains it', () => {
  const f = liveFixture(), { trial, owner, source, profile } = f;
  const handle = trial.start(owner, source.ship.id);
  assert.ok(handle);
  const body = trial.snapshot(handle).body;
  assert.equal(body.navigation, true);
  assert.equal(body.cargo.length, 3, 'the owner pilot is a separate ballast entry from hold and backpack goods');
  const initialMass = goodMass('madera') + 2 * goodMass('hierro');
  assert.equal(body.operational.rig.cargoMass, initialMass + RAFT_LOAD.crewMass,
    'wood, dense iron, and the pilot use catalog mass rather than storage volume');
  assert.ok(Object.isFrozen(body.cargo) && body.cargo.every(Object.isFrozen));
  const sail = body.structure.entries.find((entry) => entry.part[0] === 'sail');
  const damaged = damageTrialBody(body, sail.id, 4).body;
  assert.equal(damaged.operational.rig.cargoMass, initialMass + RAFT_LOAD.crewMass);
  assert.deepEqual(damaged.cargo, body.cargo);

  profile.eco.pack.goods.madera = 2;
  assert.equal(trial.snapshot(handle), null, 'source cargo mutation invalidates the captured voyage');
  assert.equal(trial.size, 0);
});

test('parked voyage ticks preserve pose, clear velocity, and unpark starts a fresh input sequence', () => {
  const f = liveFixture(), { trial, owner, source, w } = f;
  const handle = trial.start(owner, source.ship.id);
  assert.ok(handle);
  assert.equal(trial.input(handle, { seq: 1, throttle: 1, brake: 0, steer: 0 }), true);
  trial.step();
  const beforePark = trial.snapshot(handle).body.pose;
  assert.equal(trial.park(handle, true), true);
  const parked = trial.snapshot(handle);
  assert.equal(parked.parked, true);
  assert.equal(trial.input(handle, { seq: 2, throttle: 1, brake: 0, steer: 0 }), false);
  w.tick++;
  trial.step();
  const afterTick = trial.snapshot(handle);
  assert.deepEqual(afterTick.body.pose, beforePark);
  assert.deepEqual(afterTick.body.state && { vx: afterTick.body.state.vx, vz: afterTick.body.state.vz, omega: afterTick.body.state.omega },
    { vx: 0, vz: 0, omega: 0 });
  assert.equal(trial.park(handle, false), true);
  assert.equal(trial.snapshot(handle).ack, 0);
  assert.equal(trial.input(handle, { seq: 1, throttle: 0.5, brake: 0, steer: 0 }), true);
});

test('personal cargo may change ashore and is recaptured on reboard while ship hold stays locked', () => {
  const f = liveFixture(), { trial, owner, source, profile, w } = f;
  const handle = trial.start(owner, source.ship.id);
  assert.ok(handle);
  assert.equal(trial.park(handle, true), true);
  profile.eco.pack.goods.madera = 2;
  w.tick++;
  trial.step();
  const ashore = trial.snapshot(handle);
  assert.ok(ashore, 'ordinary personal inventory changes do not invalidate a parked voyage');
  assert.equal(ashore.body.operational.rig.cargoMass, goodMass('madera') + 2 * goodMass('hierro') + RAFT_LOAD.crewMass,
    'shore changes do not alter vessel ballast before reboarding, and the pilot stays aboard');
  assert.equal(trial.park(handle, false), true);
  const reboarded = trial.snapshot(handle);
  assert.equal(reboarded.body.operational.rig.cargoMass, 2 * goodMass('madera') + 2 * goodMass('hierro') + RAFT_LOAD.crewMass,
    'reboarding freezes the new pack mass and retained pilot ballast into the body');
  assert.equal(reboarded.parked, false);
  profile.eco.pack.goods.madera = 3;
  assert.equal(trial.snapshot(handle), null, 'personal cargo cannot change silently while aboard');

  const g = liveFixture(), second = g.trial.start(g.owner, g.source.ship.id);
  assert.ok(second);
  assert.equal(g.trial.park(second, true), true);
  g.source.ship.hold.goods.hierro++;
  assert.equal(g.trial.snapshot(second), null, 'ship cargo remains locked even ashore');
});

test('reboarding after structural damage keeps cargo intact and reports the resulting overload', () => {
  const f = liveFixture(), { trial, owner, source, profile, w } = f;
  const handle = trial.start(owner, source.ship.id);
  assert.ok(handle);
  const foundation = trial.snapshot(handle).body.structure.entries.find((entry) => entry.part[0] === 'foundation');
  assert.ok(foundation);
  assert.equal(trial.queueDamage(handle, foundation.id, foundation.maxHp), true);
  trial.step();
  const damaged = trial.snapshot(handle).body;
  assert.equal(damaged.operational.disabled, false);
  assert.ok(damaged.operational.parts.filter((part) => part[0] === 'foundation').length >= 3);

  assert.equal(trial.park(handle, true), true, 'the damaged but operational vessel can put its owner ashore');
  const savedGoods = structuredClone(source.ship.hold.goods);
  profile.eco.pack.goods.madera = 2;
  assert.equal(trial.park(handle, false), true, 'new shore cargo does not trap the player ashore at reboard');
  const resumed = trial.snapshot(handle).body;
  const capacity = raftCapacity(resumed.operational.parts, source.ship.hold, profile.eco.pack, resumed.operational.rig);
  assert.equal(capacity.status, 'overloaded', 'the damaged live rig reports the load safely rather than rejecting reboard');
  assert.ok(capacity.overMass > 0);
  assert.deepEqual(source.ship.hold.goods, savedGoods, 'damage and reboard do not trim or rewrite the saved hold');
  assert.equal(resumed.operational.rig.cargoMass,
    goodMass('madera') * 2 + 2 * goodMass('hierro') + RAFT_LOAD.crewMass);
});

test('underway crew ballast refresh preserves the world pose, velocity, tick, activity, and damaged structure', () => {
  const f = liveFixture(), handle = f.trial.start(f.owner, f.source.ship.id);
  assert.ok(handle);
  let body = f.trial.snapshot(handle).body;
  const foundation = body.structure.entries.find((entry) => entry.part[0] === 'foundation');
  body = damageTrialBody(body, foundation.id, 7).body;
  body = stepTrialBody(body, { throttle: 0.6, brake: 0, steer: 0 }, body.wind);
  assert.ok(Math.hypot(body.state.vx, body.state.vz) > 0, 'fixture is moving before crew changes');
  assert.ok(body.structure.entries.find((entry) => entry.id === foundation.id).hp < foundation.maxHp);
  const preserved = { pose: structuredClone(body.pose), state: structuredClone(body.state),
    rig: body.operational.rig, activity: structuredClone(body.activity), structure: structuredClone(body.structure) };

  const refreshed = refreshTrialPayload(body, [...body.cargo, { mass: RAFT_LOAD.crewMass, x: 0, z: 0, height: 0 }]);
  assert.deepEqual(refreshed.pose, preserved.pose);
  for (const key of ['yaw', 'vx', 'vz', 'omega', 'tick'])
    assert.equal(refreshed.state[key], preserved.state[key], `ballast changes preserve ${key}`);
  const originBefore = navalPose(preserved.state, preserved.rig), originAfter = navalPose(refreshed.state, refreshed.operational.rig);
  for (const key of ['x', 'z', 'yaw'])
    assert.ok(Math.abs(originAfter[key] - originBefore[key]) < 1e-8, `rebase preserves hull origin ${key}`);
  assert.deepEqual(refreshed.activity, preserved.activity);
  assert.deepEqual(refreshed.structure, preserved.structure, 'refreshing crew ballast cannot heal or replace damaged pieces');
  assert.equal(refreshed.operational.rig.cargoMass, body.operational.rig.cargoMass + RAFT_LOAD.crewMass);
});

test('empty trial accepts a skipped World tick, but an active body still requires consecutive ticks', () => {
  const f = liveFixture(), { trial, owner, source, w } = f;
  w.tick = 12;
  assert.doesNotThrow(() => trial.step());
  const handle = trial.start(owner, source.ship.id);
  assert.ok(handle);
  w.tick = 13;
  assert.doesNotThrow(() => trial.step());
  w.tick = 15;
  assert.throws(() => trial.step(), /Nonconsecutive naval World tick/);
});

test('local current frame rotates the deterministic lane into world coordinates', () => {
  const flowOrigin = { x: 100, z: 200, yaw: Math.PI / 2 };
  // Four foundations put the COM two units forward/right of the blueprint origin.
  const parts = [['foundation', 0, 0, 0], ['foundation', 1, 0, 0], ['foundation', 0, 1, 0], ['foundation', 1, 1, 0]];
  const body = createTrialBody(parts, { x: 122, y: 0.72, z: 202, yaw: Math.PI / 2 }, 'flow-check', 0,
    { navigation: true, cargo: [], flowOrigin, wind: { yaw: 0, strength: 0 } });
  assert.ok(body.flow.strength > 1, 'body at local current lane sees its current');
  assert.ok(body.flow.x > body.flow.strength * 0.9 && Math.abs(body.flow.z) < body.flow.strength * 0.2,
    'local +z lane current rotates mostly along world +x');
  const next = stepTrialBody(body, { throttle: 0, brake: 0, steer: 0 }, { yaw: 0, strength: 0 });
  assert.ok(next.state.x > body.state.x, 'current advances the body along the rotated world vector');
});

test('capture is one attempt per gust, and only committed tick emits one server event', () => {
  const f = liveFixture({ tick: NAVAL_NAVIGATION.windowStart }), { trial, owner, source, w } = f;
  const handle = trial.start(owner, source.ship.id);
  assert.ok(handle);
  assert.equal(trial.input(handle, { seq: 1, throttle: 1, brake: 0, steer: 0, capture: true }), true);
  w.events.length = 0;
  trial.step();
  const events = w.events.filter((event) => event.type === 'navalGust');
  assert.equal(events.length, 1);
  assert.equal(events[0].to, owner);
  assert.ok(['angle', 'miss', 'capture', 'perfect'].includes(events[0].event));
  assert.equal(events[0].tick, NAVAL_NAVIGATION.windowStart + 1);
  w.tick++;
  trial.step();
  assert.equal(w.events.filter((event) => event.type === 'navalGust').length, 1,
    'held capture input cannot replay a result for the same gust');
});

test('prediction forwards a capture edge and neutral input never repeats it', () => {
  const pose = { x: 8, y: 0.72, z: 8, yaw: 0 };
  const parts = [['foundation', 0, 0, 0], ['foundation', 1, 0, 0], ['foundation', 0, 1, 0], ['foundation', 1, 1, 0], ['sail', 0, 0, 0]];
  const body = createTrialBody(parts, pose, 'prediction-live', NAVAL_NAVIGATION.windowStart,
    { navigation: true, cargo: [], flowOrigin: { x: 0, z: 0, yaw: 0 }, wind: NAVAL_TRIAL.wind });
  const prediction = new NavalPilotPrediction();
  assert.equal(prediction.acceptSnapshot({ epoch: 3, active: true, ack: 0, shipId: 'ship-a', body,
    anchor: { x: 0, y: 0, z: 0, f: 0 }, wind: NAVAL_TRIAL.wind }), 'accepted');
  const command = prediction.step({ throttle: 1, brake: 0, steer: 0, capture: true });
  assert.equal(command.capture, true);
  assert.equal(prediction.body.activity.lastAttempt, body.gust.id);
  const neutral = prediction.neutral();
  assert.equal(Object.hasOwn(neutral, 'capture'), false);
  assert.equal(prediction.body.activity.lastAttempt, body.gust.id);
});
