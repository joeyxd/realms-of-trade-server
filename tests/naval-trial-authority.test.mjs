import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from './helpers.mjs';
import { C, KIND } from '../src/sim/ecs.js';
import { newProfile, attachProfile, installInventory } from '../src/sim/systems/inventory.js';
import { attachRafts, detachRafts, installRafts, prepareRaftProfile, publicRafts } from '../src/sim/systems/rafts.js';
import { installTrade } from '../src/sim/systems/trade.js';
import { World } from '../src/sim/world.js';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';
import { buildNavalRig } from '../src/sim/naval/handling.js';
import { LocalServer } from '../src/net/localServer.js';

function makeTrialWorld(seed = map.seed, clientId = 71, worldMap = map) {
  const world = new World(seed, { map: worldMap, server: true, navalTrial: true });
  installInventory(world, 'trial-authority-test');
  installTrade(world);
  installRafts(world, 'trial-authority-test');
  const owner = world.spawnPlayer({ name: 'Piloto', clientId });
  const profile = newProfile();
  assert.equal(prepareRaftProfile(world, profile), true);
  attachProfile(world, owner, profile);
  attachRafts(world, owner, profile);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft' && s.at === 'aldea');
  const source = world.rafts.get(ship.id);
  assert.ok(source, 'fixture attaches a real moored ECS ship');
  ship.hold.goods.madera = 5;
  return { world, owner, profile, ship, source, trial: world.navalTrial };
}

function addOwner(world, clientId) {
  const owner = world.spawnPlayer({ name: `Piloto${clientId}`, clientId });
  const profile = newProfile();
  assert.equal(prepareRaftProfile(world, profile), true);
  attachProfile(world, owner, profile);
  attachRafts(world, owner, profile);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft' && s.at === 'aldea');
  const source = world.rafts.get(ship.id);
  assert.ok(source);
  return { world, owner, profile, ship, source, trial: world.navalTrial };
}

const axes = (seq, throttle = 0, brake = 0, steer = 0) => ({ seq, throttle, brake, steer });
const start = (f) => f.trial.start(f.owner, f.ship.id);
const profileBytes = (p) => JSON.stringify(p);
const publicBytes = (w) => JSON.stringify(publicRafts(w));
const deckBytes = (w) => JSON.stringify([...w.raftDeck.entries]);
const shipPose = (f) => {
  const { ecs } = f.world, e = f.source.entity;
  return [ecs.x[e], ecs.y[e], ecs.z[e], ecs.facing[e]];
};

test('trials are opt-in and reject client worlds', () => {
  assert.equal(new World(map.seed, { map }).navalTrial, null);
  assert.equal(new World(map.seed, { map, server: true }).navalTrial, null);
  assert.throws(() => new World(map.seed, { map, navalTrial: true }), TypeError);
  const local = new LocalServer({ seed: map.seed, bots: 0, enemies: false });
  assert.equal(local.world.navalTrial, null, 'the ordinary local server does not activate the trial API');
});

test('opaque handles bind owner and ship; forged handles and invalid control axes are rejected', () => {
  const f = makeTrialWorld(), other = f.world.spawnPlayer({ name: 'Otro', clientId: 72 });
  const handle = start(f);
  assert.ok(handle && Object.isFrozen(handle));
  assert.deepEqual(Object.keys(handle), []);
  assert.equal(f.trial.size, 1);
  assert.equal(f.trial.start(other, f.ship.id), null, 'another player cannot take this moored ship');
  assert.equal(f.trial.start(f.owner, 'forged:ship'), null);
  const forged = {};
  assert.equal(f.trial.snapshot(forged), null);
  assert.equal(f.trial.input(forged, axes(1, 1)), false);
  assert.equal(f.trial.queueDamage(forged, 'trial:1:p1', 10), false);
  assert.equal(f.trial.stop(forged), false);
  for (const command of [
    axes(0, 1), axes(1, NaN), axes(1, -0.1), axes(1, 0, 1.1), axes(1, 0, 0, 1.1),
    { ...axes(1), extra: true }, [1, 0, 0, 0], axes(NAVAL_TRIAL.maxSequence + 1),
  ]) assert.equal(f.trial.input(handle, command), false);
  assert.equal(f.trial.input(handle, axes(NAVAL_TRIAL.maxSequence)), true, 'the maximum supported sequence is valid');
  assert.equal(f.trial.snapshot(handle).ack, 0);
});

test('the authority accepts at most 32 independently moored trial bodies', () => {
  const largeMap = { ...map, half: 2000 };
  const first = makeTrialWorld(largeMap.seed, 1, largeMap);
  assert.ok(start(first));
  for (let clientId = 2; clientId <= NAVAL_TRIAL.maxBodies; clientId++) {
    const next = addOwner(first.world, clientId);
    assert.ok(first.trial.start(next.owner, next.ship.id), `body ${clientId} starts`);
  }
  const capped = addOwner(first.world, NAVAL_TRIAL.maxBodies + 1);
  assert.equal(first.trial.size, 32);
  assert.equal(first.trial.start(capped.owner, capped.ship.id), null);
});

test('axes coalesce by sequence and ack/body advance only on the World fixed tick', () => {
  const f = makeTrialWorld(), handle = start(f);
  const before = f.trial.snapshot(handle).body;
  assert.equal(f.trial.input(handle, axes(1, 0.25, 0, -0.5)), true);
  assert.equal(f.trial.input(handle, axes(2, 1, 0, 0.75)), true);
  assert.equal(f.trial.input(handle, axes(2, 0, 1, 0)), false, 'duplicate sequence is stale');
  assert.equal(f.trial.input(handle, axes(1, 0, 1, 0)), false, 'older sequence is stale');
  assert.equal(f.trial.snapshot(handle).ack, 0);
  assert.equal(f.trial.snapshot(handle).body, before, 'input cannot mutate the detached body outside a tick');
  assert.equal(before.state.tick, 0);
  f.world.stepWorld();
  const after = f.trial.snapshot(handle);
  assert.equal(after.ack, 2);
  assert.equal(after.controlActive, true);
  assert.equal(after.body.state.tick, 1);
  assert.ok(after.body.state.vz > 0, 'the latest coalesced throttle advanced the detached body');
});

test('stale axes time out after 15 ticks and the trial switches to braking', () => {
  const f = makeTrialWorld(), handle = start(f);
  assert.equal(f.trial.input(handle, axes(1, 1)), true);
  for (let i = 0; i < NAVAL_TRIAL.inputTimeoutTicks; i++) f.world.stepWorld();
  const beforeTimeout = f.trial.snapshot(handle);
  assert.equal(beforeTimeout.controlActive, true);
  assert.equal(beforeTimeout.ack, 1);
  const speedBefore = Math.hypot(beforeTimeout.body.state.vx, beforeTimeout.body.state.vz);
  assert.ok(speedBefore > 0);
  f.world.stepWorld();
  const afterTimeout = f.trial.snapshot(handle);
  assert.equal(afterTimeout.controlActive, false);
  assert.equal(afterTimeout.ack, 1, 'timeout does not invent a new acknowledgement');
  assert.ok(Math.hypot(afterTimeout.body.state.vx, afterTimeout.body.state.vz) < speedBefore,
    'timeout uses the neutral braking command');
});

test('damage is staged to the World tick, has private trial IDs, and disabling floats retains the saved ship', () => {
  const f = makeTrialWorld(), handle = start(f), initial = f.trial.snapshot(handle).body;
  const floatIds = initial.structure.entries.filter((entry) => entry.part[0] === 'foundation').map((entry) => entry.id);
  assert.equal(floatIds.length, 4);
  assert.ok(floatIds.every((id) => id.startsWith('trial:1:p')));
  assert.equal(f.trial.queueDamage(handle, 'part:1', 60), false, 'source blueprint IDs are not trial capabilities');
  for (const id of floatIds) assert.equal(f.trial.queueDamage(handle, id, 60), true);
  assert.equal(f.trial.snapshot(handle).body, initial, 'queued damage has not mutated the current snapshot');
  assert.ok(initial.structure.entries.filter((entry) => entry.part[0] === 'foundation').every((entry) => entry.hp === 60));
  const savedProfile = profileBytes(f.profile), savedShip = JSON.stringify(f.ship), savedPose = shipPose(f);
  const savedPublic = publicBytes(f.world), savedDeck = deckBytes(f.world);
  f.world.stepWorld();
  const snapshot = f.trial.snapshot(handle), body = snapshot.body;
  assert.equal(body.operational.disabled, true);
  assert.equal(body.operational.rig, null);
  assert.equal(body.operational.parts.length, 2, 'destroyed foundations are filtered from the live trial rig');
  assert.ok(body.structure.entries.filter((entry) => entry.part[0] === 'foundation').every((entry) => entry.hp === 0));
  assert.deepEqual(body.state, { ...body.state, vx: 0, vz: 0, omega: 0 });
  assert.equal(profileBytes(f.profile), savedProfile);
  assert.equal(JSON.stringify(f.ship), savedShip, 'trial damage cannot change durable HP, revision, hull or cargo');
  assert.deepEqual(shipPose(f), savedPose);
  assert.equal(publicBytes(f.world), savedPublic, 'no moving trial body enters the public raft snapshot');
  assert.equal(deckBytes(f.world), savedDeck, 'the public walk deck is not rebuilt or moved');
  assert.equal(f.world.events.some((event) => String(event.type).toLowerCase().includes('navaltrial')), false);
});

test('repeated actual World runs produce identical private trial snapshots', () => {
  const run = () => {
    const f = makeTrialWorld(9901), handle = start(f), out = [];
    for (let seq = 1; seq <= 8; seq++) {
      assert.equal(f.trial.input(handle, axes(seq, seq < 5 ? 0.8 : 0.2, 0, seq % 2 ? 0.2 : -0.2)), true);
      if (seq === 4) assert.equal(f.trial.queueDamage(handle, f.trial.snapshot(handle).body.structure.entries[0].id, 12), true);
      f.world.stepWorld();
      out.push(JSON.stringify(f.trial.snapshot(handle)));
    }
    return out;
  };
  assert.deepEqual(run(), run());
});

test('a failed multi-body World step commits no axes or damage and retries the same tick exactly once', () => {
  const scenario = () => {
    const first = makeTrialWorld();
    const bot = first.world.spawnPlayer({ name: 'Bot testigo', bot: true });
    const ecs = first.world.ecs, waypoint = first.world.map.botWaypoints[0];
    ecs.x[bot] = waypoint.x - 4;
    ecs.z[bot] = waypoint.z;
    ecs.y[bot] = first.world.map.groundAt(ecs.x[bot], ecs.z[bot]);
    Object.assign(ecs.bot[bot], { wait: 0, target: 0, walk: 0.7, nextDash: 999, stuck: 0 });

    const firstHandle = start(first);
    const firstBody = first.trial.snapshot(firstHandle).body;
    const damagedId = firstBody.structure.entries.find((entry) => entry.part[0] === 'foundation').id;
    assert.equal(first.trial.input(firstHandle, axes(1, 1)), true);
    assert.equal(first.trial.queueDamage(firstHandle, damagedId, 40), true);

    const second = addOwner(first.world, 72), rig = buildNavalRig(second.ship.grid.parts);
    const shipEntity = second.source.entity;
    assert.equal(ecs.kind[shipEntity], KIND.SHIP);
    assert.equal(ecs.mask[shipEntity] & (C.POS | C.VEHICLE), C.POS | C.VEHICLE);
    ecs.facing[shipEntity] = Math.PI / 2;
    ecs.x[shipEntity] = 1e9 - rig.cz - 0.00001;
    const secondHandle = second.trial.start(second.owner, second.ship.id);
    assert.ok(secondHandle);
    assert.equal(second.trial.input(secondHandle, axes(1, 1)), true);
    const secondBody = second.trial.snapshot(secondHandle).body;
    assert.ok(secondBody.state.x < 1e9);
    return { first, firstHandle, firstBody, damagedId, secondHandle, secondBody, bot };
  };

  const failed = scenario(), control = scenario();
  const { first, firstHandle, firstBody, damagedId, secondHandle, secondBody, bot } = failed;
  const botBefore = [first.world.ecs.x[bot], first.world.ecs.z[bot]];
  const rngBefore = first.world.rng.state();
  assert.deepEqual(botBefore, [control.first.world.ecs.x[control.bot], control.first.world.ecs.z[control.bot]]);

  assert.throws(() => first.world.stepWorld(), TypeError, 'the second candidate crosses the supported state bound');
  assert.equal(first.world.tick, 0, 'failed world step did not advance the fixed tick');
  assert.equal(first.trial.snapshot(firstHandle).body, firstBody);
  assert.equal(first.trial.snapshot(firstHandle).ack, 0);
  assert.equal(firstBody.structure.entries.find((entry) => entry.id === damagedId).hp, 60);
  assert.equal(first.trial.snapshot(secondHandle).body, secondBody);
  assert.equal(first.trial.snapshot(secondHandle).ack, 0);
  assert.deepEqual([first.world.ecs.x[bot], first.world.ecs.z[bot]], botBefore,
    'other World systems did not move the bot before trial preparation failed');
  assert.equal(first.world.rng.state(), rngBefore, 'failed preparation did not consume World RNG');

  assert.equal(first.trial.stop(secondHandle), true);
  assert.equal(control.first.trial.stop(control.secondHandle), true);
  control.first.world.stepWorld();
  first.world.stepWorld();
  const committed = first.trial.snapshot(firstHandle);
  assert.equal(first.world.tick, 1);
  assert.equal(committed.ack, 1);
  assert.equal(committed.body.state.tick, 1);
  assert.equal(committed.body.structure.entries.find((entry) => entry.id === damagedId).hp, 20,
    'the staged 40 damage is applied once on retry');
  assert.notDeepEqual([first.world.ecs.x[bot], first.world.ecs.z[bot]], botBefore,
    'the bot advances once after the failed source is removed');
  assert.deepEqual([first.world.ecs.x[bot], first.world.ecs.z[bot]],
    [control.first.world.ecs.x[control.bot], control.first.world.ecs.z[control.bot]],
    'retry matches one successful fixed tick in the otherwise identical World');
  assert.equal(first.world.rng.state(), control.first.world.rng.state());
});

test('source identity, revision, parts, session and live ECS ship changes fence an active capability', () => {
  const mutations = [
    (f) => { f.ship.rev++; },
    (f) => { f.ship.grid.parts[0][1] = 1; },
    (f) => { f.world.profiles.set(f.owner, structuredClone(f.profile)); },
    (f) => { f.world.ecs.clientId[f.owner]++; },
    (f) => { f.world.ecs.destroy(f.source.entity); },
  ];
  for (const mutate of mutations) {
    const f = makeTrialWorld(), handle = start(f);
    mutate(f);
    assert.equal(f.trial.snapshot(handle), null);
    assert.equal(f.trial.size, 0);
    assert.equal(f.trial.input(handle, axes(1, 1)), false);
    assert.equal(f.trial.queueDamage(handle, 'trial:1:p1', 12), false);
  }
});

test('stop, detach, ECS recycle and close invalidate handles permanently', () => {
  const f = makeTrialWorld(), first = start(f), removedEntity = f.source.entity;
  assert.equal(f.trial.stop(first), true);
  assert.equal(f.trial.stop(first), false);
  assert.equal(f.trial.snapshot(first), null);
  assert.equal(f.trial.size, 0);
  const second = start(f);
  detachRafts(f.world, f.owner);
  assert.equal(f.trial.size, 0);
  assert.equal(f.trial.snapshot(second), null);
  assert.equal(f.trial.input(second, axes(1, 1)), false);
  attachRafts(f.world, f.owner, f.profile);
  const recycled = f.world.rafts.get(f.ship.id);
  assert.ok(recycled);
  assert.equal(recycled.entity, removedEntity, 'the ECS reuses the detached ship slot');
  const third = start(f);
  assert.ok(third && third !== second);
  assert.equal(f.trial.snapshot(second), null, 'reusing an ECS index cannot resurrect an old capability');
  f.trial.close();
  assert.equal(f.trial.size, 0);
  assert.equal(f.trial.snapshot(third), null);
  assert.equal(f.trial.start(f.owner, f.ship.id), null);
});
