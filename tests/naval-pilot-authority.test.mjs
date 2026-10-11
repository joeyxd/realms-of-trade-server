import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from './helpers.mjs';
import { newProfile, attachProfile, installInventory } from '../src/sim/systems/inventory.js';
import { attachRafts, detachRafts, installRafts, prepareRaftProfile, publicRafts } from '../src/sim/systems/rafts.js';
import { installTrade } from '../src/sim/systems/trade.js';
import { World } from '../src/sim/world.js';
import { LocalServer } from '../src/net/localServer.js';

function addOwner(world, clientId, name = `Pilot ${clientId}`) {
  const owner = world.spawnPlayer({ name, clientId });
  const profile = newProfile();
  assert.equal(prepareRaftProfile(world, profile), true);
  attachProfile(world, owner, profile);
  attachRafts(world, owner, profile);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft' && s.at === 'aldea');
  const source = world.rafts.get(ship.id);
  assert.ok(source);
  return { world, owner, profile, ship, source };
}

function makeWorld(seed = map.seed) {
  const world = new World(seed, { map, server: true, navalPilot: true });
  installInventory(world, 'pilot-authority-test');
  installTrade(world);
  installRafts(world, 'pilot-authority-test');
  return addOwner(world, 71, 'Piloto');
}

function placeOnDeck(f, entity = f.owner, records = publicRafts(f.world)) {
  const { world, source } = f, ecs = world.ecs;
  world.raftDeck.update(records);
  const raft = records.find((r) => r.id === f.ship.id);
  assert.ok(raft);
  // Find a real deck tile, excluding the gangplank, using the same public collision query as gameplay.
  for (let x = raft.x - 24; x <= raft.x + 24; x += 0.5) {
    for (let z = raft.z - 24; z <= raft.z + 24; z += 0.5) {
      for (let y = raft.y - 1; y <= raft.y + 8; y += 0.5) {
        const surface = world.raftDeck.surface(x, z, y);
        if (surface?.id === f.ship.id && surface.kind === 'deck') {
          ecs.x[entity] = x; ecs.y[entity] = surface.y; ecs.z[entity] = z;
          ecs.vx[entity] = ecs.vz[entity] = 0;
          return { x, y: surface.y, z };
        }
      }
    }
  }
  assert.fail(`fixture did not find a deck tile near source ship ${source.entity}`);
}

const pose = (f, e = f.owner) => ({ x: f.world.ecs.x[e], y: f.world.ecs.y[e], z: f.world.ecs.z[e], f: f.world.ecs.facing[e] });
const sourcePose = (f) => pose(f, f.source.entity);
const profileBytes = (f) => JSON.stringify(f.profile);
const shipBytes = (f) => JSON.stringify(f.ship);
const axes = (epoch, seq, throttle = 0, brake = 0, steer = 0) => ({ epoch, seq, throttle, brake, steer });

test('pilot control is server-only and opt-in', () => {
  assert.equal(new World(map.seed, { map }).navalPilot, null);
  assert.equal(new World(map.seed, { map, server: true }).navalPilot, null);
  assert.throws(() => new World(map.seed, { map, navalPilot: true }), TypeError);
  const local = new LocalServer({ navigation: false, seed: map.seed, bots: 0, enemies: false });
  assert.equal(local.world.navalPilot, null, 'disabled navigation does not activate the pilot experiment');
});

test('mount requires the own deck, a live idle owner, and no guests; epochs fence mount and input', () => {
  const f = makeWorld(), other = addOwner(f.world, 72, 'Otro');
  assert.equal(f.world.navalPilot.mount(other.owner, f.ship.id), false, 'another owner cannot take the raft');
  assert.equal(f.world.navalPilot.mount(f.owner, 'forged:ship'), false);
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), false, 'standing ashore is not a mount request');

  const initial = placeOnDeck(f), guestAt = placeOnDeck({ ...f, owner: other.owner }, other.owner);
  assert.equal(f.world.raftDeck.surface(guestAt.x, guestAt.z, guestAt.y)?.kind, 'deck');
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), false, 'a guest on deck blocks this pilot-only slice');
  f.world.ecs.x[other.owner] = f.world.map.dock.base.x;
  f.world.ecs.z[other.owner] = f.world.map.dock.base.z;
  f.world.ecs.y[other.owner] = f.world.map.groundAt(f.world.ecs.x[other.owner], f.world.ecs.z[other.owner]);

  f.world.ecs.dashT[f.owner] = 0.2;
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), false, 'cannot mount during a dash');
  f.world.ecs.dashT[f.owner] = -1;
  f.world.ecs.castK[f.owner] = 1;
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), false, 'cannot mount while casting');
  f.world.ecs.castK[f.owner] = 0;
  f.world.ecs.atkStage[f.owner] = 1;
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), false, 'cannot mount while attacking');
  f.world.ecs.atkStage[f.owner] = 0;
  assert.deepEqual(pose(f), { ...initial, f: pose(f).f });

  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), true);
  const first = f.world.navalPilot.snapshot(f.owner);
  assert.equal(first.active, true);
  assert.equal(first.shipId, f.ship.id);
  assert.ok(first.epoch > 0);
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), false, 'owner cannot mount twice');
  assert.equal(f.world.navalPilot.leave(f.owner, first.epoch + 1), false, 'stale leave cannot release a newer seat');
  assert.equal(f.world.navalPilot.input(f.owner, axes(first.epoch + 1, 1, 1)), false);
  assert.equal(f.world.navalPilot.input(f.owner, { ...axes(first.epoch, 1, 1), extra: true }), false);
});

test('World ticks move the public raft and anchored pilot together while saved source remains moored', () => {
  const f = makeWorld();
  placeOnDeck(f);
  const savedProfile = profileBytes(f), savedShip = shipBytes(f), savedPose = sourcePose(f);
  const publicBefore = publicRafts(f.world).find((r) => r.id === f.ship.id);
  assert.ok(publicBefore);
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), true);
  const mounted = f.world.navalPilot.snapshot(f.owner);
  const deckBefore = f.world.raftDeck.surface(f.world.ecs.x[f.owner], f.world.ecs.z[f.owner], f.world.ecs.y[f.owner]);
  assert.equal(deckBefore?.id, f.ship.id);
  assert.equal(deckBefore?.kind, 'deck');

  assert.equal(f.world.navalPilot.input(f.owner, axes(mounted.epoch, 1, 1)), true);
  assert.equal(f.world.navalPilot.input(f.owner, axes(mounted.epoch, 1, 0, 1)), false, 'duplicate sequence is stale');
  assert.equal(f.world.navalPilot.input(f.owner, axes(mounted.epoch, 0, 1)), false, 'old sequence is stale');
  const ackBefore = f.world.navalPilot.snapshot(f.owner).ack;
  const initialBody = f.world.navalPilot.snapshot(f.owner).body;
  const landBefore = pose(f);
  f.world.applyCommand(f.owner, { seq: 1, moveX: 0, moveZ: 1, atk: 1, cast: 1, dash: 1 });
  assert.deepEqual(pose(f), landBefore, 'generic land/combat input is parked while mounted');
  assert.equal(f.world.navalPilot.snapshot(f.owner).ack, ackBefore);
  assert.equal(f.world.navalPilot.snapshot(f.owner).body, initialBody, 'helm input advances only at World tick');

  for (let i = 0; i < 12; i++) f.world.stepWorld();
  const moved = f.world.navalPilot.snapshot(f.owner);
  assert.equal(moved.active, true);
  assert.equal(moved.ack, 1);
  assert.ok(moved.body.state.tick >= 12);
  const projected = f.world.navalPilot.project(publicRafts(f.world));
  const raft = projected.find((r) => r.id === f.ship.id);
  assert.ok(raft.pilot && raft.pilot.owner === f.owner && raft.pilot.epoch === moved.epoch);
  assert.notEqual(raft.z, publicBefore.z, 'published raft projection follows the moving naval body');
  assert.deepEqual([raft.x, raft.y, raft.z, raft.yaw], [moved.body.pose.x, moved.body.pose.y, moved.body.pose.z, moved.body.pose.yaw]);
  assert.deepEqual(raft.parts, moved.body.operational.parts.map((p) => [...p]));
  const pilot = pose(f), liveDeck = f.world.raftDeck;
  liveDeck.update(projected);
  assert.equal(liveDeck.surface(pilot.x, pilot.z, pilot.y)?.id, f.ship.id, 'pilot retains support on projected moving deck');
  assert.equal(profileBytes(f), savedProfile);
  assert.equal(shipBytes(f), savedShip);
  assert.deepEqual(sourcePose(f), savedPose, 'public ECS source raft stays at its durable mooring');
  const source = f.world.rafts.get(f.ship.id), ecs = f.world.ecs;
  assert.deepEqual([ecs.x[source.entity], ecs.y[source.entity], ecs.z[source.entity], ecs.facing[source.entity]],
    [savedPose.x, savedPose.y, savedPose.z, savedPose.f], 'canonical ECS source raft stays moored');

  assert.equal(f.world.navalPilot.leave(f.owner, moved.epoch), true);
  assert.equal(f.world.navalPilot.snapshot(f.owner).active, false);
  assert.deepEqual(sourcePose(f), savedPose);
  const returned = publicRafts(f.world).find((r) => r.id === f.ship.id);
  assert.equal(returned.pilot, undefined, 'leaving removes the transient pilot projection');
  assert.equal(f.world.raftDeck.surface(f.world.ecs.x[f.owner], f.world.ecs.z[f.owner], f.world.ecs.y[f.owner]), null,
    'leave rescues the pilot to dock and restores the moored deck projection');
});

test('a guest arriving after mount releases the pilot and rescues both players to the dock', () => {
  const f = makeWorld(), guest = addOwner(f.world, 73, 'Visitante');
  placeOnDeck(f);
  const source = sourcePose(f);
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), true);
  const pilotState = f.world.navalPilot.snapshot(f.owner);
  const moving = f.world.navalPilot.project(publicRafts(f.world));
  placeOnDeck({ ...f, ship: f.ship }, guest.owner, moving);
  assert.equal(f.world.raftDeck.surface(f.world.ecs.x[guest.owner], f.world.ecs.z[guest.owner], f.world.ecs.y[guest.owner])?.id, f.ship.id);
  f.world.stepWorld();
  assert.equal(f.world.navalPilot.snapshot(f.owner).active, false);
  assert.equal(f.world.navalTrial.size, 0);
  assert.equal(f.world.navalPilot.size, 0);
  for (const e of [f.owner, guest.owner]) {
    const dock = f.world.map.dock;
    assert.ok(Math.hypot(f.world.ecs.x[e] - dock.base.x, f.world.ecs.z[e] - dock.base.z) <= dock.len + 2,
      'released occupants are returned within dock bounds');
  }
  assert.deepEqual(sourcePose(f), source);
  assert.equal(f.world.navalPilot.leave(f.owner, pilotState.epoch), false);
});

test('detach, source invalidation, death, and close clear transient authority without changing saved ship data', () => {
  const mutations = [
    (f) => { f.ship.rev++; },
    (f) => { f.world.ecs.hp[f.owner] = 0; f.world.ecs.dead[f.owner] = 1; },
  ];
  for (const mutate of mutations) {
    const f = makeWorld(); placeOnDeck(f);
    assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), true);
    const epoch = f.world.navalPilot.snapshot(f.owner).epoch;
    mutate(f);
    const bytes = shipBytes(f);
    f.world.stepWorld();
    assert.equal(f.world.navalPilot.snapshot(f.owner).active, false);
    assert.equal(f.world.navalPilot.size, 0);
    assert.equal(f.world.navalTrial.size, 0);
    assert.equal(f.world.navalPilot.leave(f.owner, epoch), false);
    assert.equal(shipBytes(f), bytes, 'runtime release does not persist movement or cargo changes');
  }

  const f = makeWorld(); placeOnDeck(f);
  assert.equal(f.world.navalPilot.mount(f.owner, f.ship.id), true);
  const epoch = f.world.navalPilot.snapshot(f.owner).epoch;
  detachRafts(f.world, f.owner);
  assert.equal(f.world.navalPilot.size, 0, 'raft detachment releases pilot before recycling source ECS');
  assert.equal(f.world.navalTrial.size, 0);
  assert.equal(f.world.navalPilot.snapshot(f.owner).active, false);
  assert.equal(f.world.navalPilot.leave(f.owner, epoch), false);

  const closed = makeWorld(); placeOnDeck(closed);
  assert.equal(closed.world.navalPilot.mount(closed.owner, closed.ship.id), true);
  closed.world.navalPilot.close();
  assert.equal(closed.world.navalPilot.size, 0);
  assert.equal(closed.world.navalTrial.size, 0);
  assert.equal(closed.world.navalPilot.mount(closed.owner, closed.ship.id), false);
});

test('pilot mount is refused at the four-body trial cap', () => {
  const first = makeWorld();
  placeOnDeck(first);
  assert.equal(first.world.navalPilot.mount(first.owner, first.ship.id), true);
  for (let i = 0; i < 3; i++) {
    const next = addOwner(first.world, 80 + i, `Pilot ${i}`);
    placeOnDeck(next);
    assert.equal(first.world.navalPilot.mount(next.owner, next.ship.id), true);
  }
  const capped = addOwner(first.world, 90, 'Capped');
  placeOnDeck(capped);
  assert.equal(first.world.navalPilot.mount(capped.owner, capped.ship.id), false);
  assert.equal(first.world.navalPilot.size, 4);
  assert.equal(first.world.navalTrial.size, 4);
});
