import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from './helpers.mjs';
import { NAVAL_TRIAL } from '../src/data/navalTrial.js';
import { RAFT } from '../src/data/raftparts.js';
import { newProfile, attachProfile, installInventory } from '../src/sim/systems/inventory.js';
import { attachRafts, detachRafts, installRafts, prepareRaftProfile, publicRafts } from '../src/sim/systems/rafts.js';
import { installTrade } from '../src/sim/systems/trade.js';
import { World } from '../src/sim/world.js';
import { NavalPilotServer } from '../src/net/navalPilotServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { newRaft } from '../src/sim/economy/raft.js';

function addOwner(world, clientId, name = `Crew ${clientId}`) {
  const owner = world.spawnPlayer({ name, clientId }), profile = newProfile();
  assert.equal(prepareRaftProfile(world, profile), true);
  attachProfile(world, owner, profile); attachRafts(world, owner, profile);
  const ship = profile.eco.ships.find((s) => s.kind === 'raft' && s.at === 'aldea');
  assert.ok(world.rafts.get(ship.id));
  return { owner, profile, ship, source: world.rafts.get(ship.id) };
}

function makeWorld() {
  const world = new World(map.seed, { map, server: true, navalPilot: true });
  installInventory(world, 'crew-authority-test'); installTrade(world); installRafts(world, 'crew-authority-test');
  return { world, ...addOwner(world, 71, 'Capitana') };
}

function placeOnDeck(world, entity, shipId, tile = 0, records = publicRafts(world)) {
  world.raftDeck.update(records);
  const raft = records.find((r) => r.id === shipId);
  assert.ok(raft, `raft ${shipId} is public`);
  const floors = raft.parts.filter((p) => p[0] === 'foundation' || p[0] === 'floor');
  for (const part of floors) {
    const lx = (part[1] + 0.5) * RAFT.cell, lz = (part[2] + 0.5) * RAFT.cell;
    const c = Math.cos(raft.yaw), s = Math.sin(raft.yaw);
    const x = raft.x + c * lx + s * lz, z = raft.z - s * lx + c * lz;
    const surface = world.raftDeck.surface(x, z, raft.y + part[3] * RAFT.levelHeight);
    if (surface?.id !== shipId || surface.kind !== 'deck') continue;
    if (tile-- > 0) continue;
    world.ecs.x[entity] = x; world.ecs.y[entity] = surface.y; world.ecs.z[entity] = z;
    world.ecs.vx[entity] = world.ecs.vz[entity] = world.ecs.kbx[entity] = world.ecs.kbz[entity] = 0;
    world.ecs.moveMag[entity] = 0;
    return { x, y: surface.y, z, f: world.ecs.facing[entity] };
  }
  assert.fail(`no open foundation tile found for ${shipId}`);
}

const position = (world, e) => ({ x: world.ecs.x[e], y: world.ecs.y[e], z: world.ecs.z[e], f: world.ecs.facing[e] });
const raftOf = (world, shipId) => publicRafts(world).find((r) => r.id === shipId);
const raftForOwner = (world, owner) => publicRafts(world).find((r) => r.owner === owner);
const profileBytes = (profile) => JSON.stringify(profile);
const shipBytes = (ship) => JSON.stringify(ship);
const shipInput = (epoch, seq, throttle = 0, brake = 0, steer = 0) => ({ epoch, seq, throttle, brake, steer });

function pilotServer({ beforeTick = null } = {}) {
  const server = new NavalPilotServer({ seed: map.seed, beforeTick: beforeTick || undefined, send() {} });
  const join = (id) => {
    server.connect(id);
    server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Tripulante ${id}`, skin: 0, weapon: 0, save: '' });
    return server.clients.get(id).entity;
  };
  return { server, join };
}

test('boarding requires an owner invite, passenger consent, live deck support, and a fresh frame lease', () => {
  const f = makeWorld(), guest = addOwner(f.world, 72), stranger = addOwner(f.world, 73);
  const w = f.world, shipId = f.ship.id;
  placeOnDeck(w, f.owner, shipId, 0); placeOnDeck(w, guest.owner, shipId, 1);
  assert.equal(w.navalPilot.board(guest.owner, shipId), false, 'no invitation means no boarding');
  assert.equal(w.navalPilot.invite(guest.owner, shipId, stranger.owner), false, 'a non-owner cannot issue an invite');
  assert.equal(w.navalPilot.invite(f.owner, 'forged:raft', guest.owner), false);
  assert.equal(w.navalPilot.invite(f.owner, shipId, guest.owner), true);
  assert.equal(w.navalPilot.board(guest.owner, shipId), true);
  assert.equal(w.navalPilot.aboard(guest.owner), true);
  const deck = w.navalPilot.deckSnapshot(guest.owner);
  assert.equal(deck.active, true);
  assert.equal(w.navalPilot.board(guest.owner, shipId), false, 'the invite is consumed');
  assert.equal(w.navalPilot.deckInput(guest.owner, { epoch: deck.epoch - 1, seq: 1, mx: 1, mz: 0 }), false);
  assert.equal(w.navalPilot.deckInput(guest.owner, { epoch: deck.epoch, seq: 1, mx: 1, mz: 0 }), true);
  assert.equal(w.navalPilot.deckInput(guest.owner, { epoch: deck.epoch, seq: 1, mx: 0, mz: 1 }), false, 'duplicate frame sequence is stale');
  assert.equal(w.navalPilot.leaveDeck(guest.owner, deck.epoch + 1), false);
  assert.equal(w.navalPilot.leaveDeck(guest.owner, deck.epoch), true);
  assert.equal(w.navalPilot.deckInput(guest.owner, { epoch: deck.epoch, seq: 2, mx: 0, mz: 1 }), false,
    'a released frame lease cannot be replayed');

  placeOnDeck(w, guest.owner, shipId, 1);
  placeOnDeck(w, stranger.owner, shipId, 2);
  assert.equal(w.navalPilot.mount(f.owner, shipId), false, 'an unregistered person on deck still blocks helm mount');
  assert.equal(w.navalPilot.invite(f.owner, shipId, guest.owner), true);
  assert.equal(w.navalPilot.board(guest.owner, shipId), true);
  assert.equal(w.navalPilot.invite(f.owner, shipId, stranger.owner), true);
  assert.equal(w.navalPilot.board(stranger.owner, shipId), true);
  assert.equal(w.navalPilot.mount(f.owner, shipId), true, 'registered crew can remain aboard as the owner takes helm');
});

test('a turning helm carries a walking passenger in the same local frame without changing saved ship data', () => {
  const f = makeWorld(), guest = addOwner(f.world, 72), w = f.world, shipId = f.ship.id;
  placeOnDeck(w, f.owner, shipId, 0); placeOnDeck(w, guest.owner, shipId, 3);
  assert.equal(w.navalPilot.invite(f.owner, shipId, guest.owner), true);
  assert.equal(w.navalPilot.board(guest.owner, shipId), true);
  assert.equal(w.navalPilot.mount(f.owner, shipId), true);
  const helm = w.navalPilot.snapshot(f.owner), initialDeck = w.navalPilot.deckSnapshot(guest.owner);
  const profile = profileBytes(f.profile), savedShip = shipBytes(f.ship), sourcePosition = position(w, f.source.entity);
  const previousYaw = helm.body.pose.yaw;
  for (let seq = 1; seq <= 6; seq++) {
    assert.equal(w.navalPilot.input(f.owner, shipInput(helm.epoch, seq, 1, 0, 0.7)), true);
    assert.equal(w.navalPilot.deckInput(guest.owner, { epoch: initialDeck.epoch, seq, mx: 0, mz: 1 }), true);
    w.stepWorld();
  }
  const currentHelm = w.navalPilot.snapshot(f.owner), currentDeck = w.navalPilot.deckSnapshot(guest.owner);
  assert.notEqual(currentHelm.body.pose.yaw, previousYaw, 'helm steering changes the boat heading');
  assert.ok(currentDeck.state.z > initialDeck.state.z + 0.15, 'passenger input advances local position');
  const raft = raftOf(w, shipId), expected = pilotPoint(raft, currentDeck.state), guestPosition = position(w, guest.owner);
  for (const key of ['x', 'y', 'z', 'f']) assert.ok(Math.abs(guestPosition[key] - expected[key]) < 1e-8, `${key} uses current hull pose`);
  assert.equal(profileBytes(f.profile), profile);
  assert.equal(shipBytes(f.ship), savedShip);
  assert.deepEqual(position(w, f.source.entity), sourcePosition, 'canonical source raft stays moored');
});

test('owner can leave helm to walk, retains naval authority, and takes helm at the walked frame', () => {
  const f = makeWorld(), w = f.world, shipId = f.ship.id;
  placeOnDeck(w, f.owner, shipId);
  assert.equal(w.navalPilot.mount(f.owner, shipId), true);
  const helm = w.navalPilot.snapshot(f.owner);
  assert.equal(w.navalPilot.walk(f.owner, helm.epoch), true);
  const walk = w.navalPilot.deckSnapshot(f.owner);
  assert.equal(w.navalPilot.aboard(f.owner), true);
  assert.equal(w.navalPilot.input(f.owner, shipInput(helm.epoch, 1, 1, 0, 0.5)), false,
    'walking mode cannot apply thrust or steering');
  assert.equal(w.navalPilot.deckInput(f.owner, { epoch: walk.epoch, seq: 1, mx: 1, mz: 0 }), true);
  w.stepWorld();
  const walked = w.navalPilot.deckSnapshot(f.owner).state;
  assert.ok(walked.x > walk.state.x, 'owner can move on deck between controls');
  assert.equal(w.navalPilot.helm(f.owner, helm.epoch), true);
  assert.equal(w.navalPilot.deckSnapshot(f.owner).active, false);
  const resumed = w.navalPilot.snapshot(f.owner);
  assert.equal(resumed.active, true);
  assert.deepEqual(resumed.anchor, { x: walked.x, y: walked.y, z: walked.z, f: walked.f });
  assert.equal(w.navalPilot.deckInput(f.owner, { epoch: walk.epoch, seq: 2, mx: 0, mz: 1 }), false,
    'old walk lease cannot move the helm seat');
  assert.equal(w.navalPilot.input(f.owner, shipInput(helm.epoch, 1, 0.5, 0, 0)), true,
    'helm accepts movement again after the owner retakes it');
});

test('packet floods coalesce to one committed walk step and stale controls time out safely', () => {
  const f = makeWorld(), w = f.world, shipId = f.ship.id;
  placeOnDeck(w, f.owner, shipId);
  assert.equal(w.navalPilot.mount(f.owner, shipId), true);
  const helm = w.navalPilot.snapshot(f.owner);
  assert.equal(w.navalPilot.walk(f.owner, helm.epoch), true);
  const before = w.navalPilot.deckSnapshot(f.owner), start = { x: before.state.x, z: before.state.z };
  for (let seq = 1; seq <= 100; seq++)
    assert.equal(w.navalPilot.deckInput(f.owner, { epoch: before.epoch, seq, mx: 0, mz: 1 }), true);
  w.stepWorld();
  const applied = w.navalPilot.deckSnapshot(f.owner);
  assert.equal(applied.ack, 100);
  assert.ok(Math.hypot(applied.state.x - start.x, applied.state.z - start.z) <= w.ecs.speed[f.owner] / 60 + 1e-8,
    'all queued packets produce at most one fixed walk step');
  for (let i = 0; i < NAVAL_TRIAL.inputTimeoutTicks + 3; i++) w.stepWorld();
  const timedOut = w.navalPilot.deckSnapshot(f.owner);
  assert.equal(timedOut.ack, 100, 'timeout does not invent a newer acknowledged command');
  for (let i = 0; i < 20; i++) w.stepWorld();
  const coasted = w.navalPilot.deckSnapshot(f.owner);
  assert.equal(coasted.state.vx, 0); assert.equal(coasted.state.vz, 0);
  assert.ok(coasted.state.z > timedOut.state.z, 'the bounded residual velocity coasts after timeout');
  const settled = { x: coasted.state.x, z: coasted.state.z };
  for (let i = 20; i < 40; i++) w.stepWorld();
  const still = w.navalPilot.deckSnapshot(f.owner);
  assert.deepEqual({ x: still.state.x, z: still.state.z }, settled, 'timed out control stops without replay');
});

test('death, disconnect, source edits, and owner detach release only live leases without reviving anyone', () => {
  {
    const f = makeWorld(), guest = addOwner(f.world, 72), w = f.world, shipId = f.ship.id;
    placeOnDeck(w, f.owner, shipId, 0); placeOnDeck(w, guest.owner, shipId, 1);
    assert.equal(w.navalPilot.invite(f.owner, shipId, guest.owner), true);
    assert.equal(w.navalPilot.board(guest.owner, shipId), true);
    const epoch = w.navalPilot.deckSnapshot(guest.owner).epoch;
    w.ecs.hp[guest.owner] = 0; w.ecs.dead[guest.owner] = 1;
    w.stepWorld();
    assert.equal(w.navalPilot.deckSnapshot(guest.owner).active, false);
    assert.equal(w.ecs.hp[guest.owner], 0); assert.equal(w.ecs.dead[guest.owner], 1);
    assert.equal(w.navalPilot.deckInput(guest.owner, { epoch, seq: 1, mx: 1, mz: 0 }), false);
  }
  {
    const { server, join } = pilotServer(), owner = join(1), guest = join(2), shipId = raftForOwner(server.world, owner).id;
    placeOnDeck(server.world, owner, shipId, 0); placeOnDeck(server.world, guest, shipId, 1);
    assert.equal(server.world.navalPilot.invite(owner, shipId, guest), true);
    assert.equal(server.world.navalPilot.board(guest, shipId), true);
    const lease = server.world.navalPilot.deckSnapshot(guest).epoch;
    server.disconnect(2);
    assert.equal(server.world.navalPilot.deckSnapshot(guest).active, false);
    assert.equal(server.world.ecs.alive[guest], 0, 'server disconnect destroys the entity after lease cleanup');
    assert.equal(server.world.navalPilot.deckInput(guest, { epoch: lease, seq: 1, mx: 0, mz: 1 }), false);
  }
  {
    const f = makeWorld(), guest = addOwner(f.world, 72), w = f.world, shipId = f.ship.id;
    placeOnDeck(w, f.owner, shipId, 0); placeOnDeck(w, guest.owner, shipId, 1);
    assert.equal(w.navalPilot.invite(f.owner, shipId, guest.owner), true);
    assert.equal(w.navalPilot.board(guest.owner, shipId), true);
    const lease = w.navalPilot.deckSnapshot(guest.owner).epoch;
    f.ship.rev++;
    w.stepWorld();
    assert.equal(w.navalPilot.deckSnapshot(guest.owner).active, false, 'source revision invalidates the passenger lease');
    assert.equal(w.navalPilot.deckInput(guest.owner, { epoch: lease, seq: 1, mx: 0, mz: 1 }), false);
  }
  {
    const f = makeWorld(), guest = addOwner(f.world, 72), w = f.world, shipId = f.ship.id;
    placeOnDeck(w, f.owner, shipId, 0); placeOnDeck(w, guest.owner, shipId, 1);
    assert.equal(w.navalPilot.invite(f.owner, shipId, guest.owner), true);
    assert.equal(w.navalPilot.board(guest.owner, shipId), true);
    assert.equal(w.navalPilot.mount(f.owner, shipId), true);
    const lease = w.navalPilot.deckSnapshot(guest.owner).epoch;
    detachRafts(w, f.owner);
    assert.equal(w.navalPilot.deckSnapshot(guest.owner).active, false);
    assert.equal(w.navalPilot.snapshot(f.owner).active, false);
    assert.equal(w.navalPilot.deckInput(guest.owner, { epoch: lease, seq: 1, mx: 0, mz: 1 }), false);
    assert.ok(w.ecs.alive[guest.owner] && w.ecs.hp[guest.owner] > 0, 'unaffected passenger stays alive');
    assert.equal(w.raftDeck.surface(w.ecs.x[guest.owner], w.ecs.z[guest.owner], w.ecs.y[guest.owner]), null,
      'passenger is rescued after source removal');
  }
});

test('M5-held ticks publish cached crew frames without applying movement or ACKs', () => {
  let admitted = true;
  const { server, join } = pilotServer({ beforeTick: () => admitted }), owner = join(1), guest = join(2);
  const w = server.world, shipId = raftForOwner(w, owner).id;
  placeOnDeck(w, owner, shipId, 0); placeOnDeck(w, guest, shipId, 1);
  assert.equal(w.navalPilot.invite(owner, shipId, guest), true);
  assert.equal(w.navalPilot.board(guest, shipId), true);
  const before = w.navalPilot.deckSnapshot(guest), standing = position(w, guest), tick = w.tick;
  assert.equal(w.navalPilot.deckInput(guest, { epoch: before.epoch, seq: 1, mx: 1, mz: 0 }), true);
  admitted = false;
  assert.equal(server.step(), false);
  server.broadcastSnapshot(); server.broadcastSnapshot();
  assert.equal(w.tick, tick);
  assert.deepEqual(w.navalPilot.deckSnapshot(guest).state, before.state);
  assert.equal(w.navalPilot.deckSnapshot(guest).ack, before.ack);
  assert.deepEqual(position(w, guest), standing);
  admitted = true;
  assert.equal(server.step(), true);
  const committed = w.navalPilot.deckSnapshot(guest);
  assert.equal(committed.ack, 1);
  assert.notDeepEqual(committed.state, before.state, 'queued movement is applied once at the next admitted tick');
});

test('returning to walk accepts a position inside an internally destroyed wall while saved blueprint stays intact', () => {
  const f = makeWorld(), w = f.world;
  f.ship.grid = newRaft([...f.ship.grid.parts, ['wall', 1, 0, 0, 1]]);
  const savedProfile = profileBytes(f.profile), savedShip = shipBytes(f.ship), shipId = f.ship.id;
  w.raftDeck.update(publicRafts(w));
  placeOnDeck(w, f.owner, shipId, 1);

  let trialHandle = null;
  const start = w.navalTrial.start.bind(w.navalTrial);
  w.navalTrial.start = (...args) => { trialHandle = start(...args); return trialHandle; };
  assert.equal(w.navalPilot.mount(f.owner, shipId), true);
  const helm = w.navalPilot.snapshot(f.owner), wall = helm.body.structure.entries.find((entry) => entry.part[0] === 'wall');
  assert.ok(wall, 'trial structure contains the wall piece');
  assert.equal(w.navalTrial.queueDamage(trialHandle, wall.id, 1e6), true, 'wall damage enters through the validated trial API');
  w.stepWorld();
  const damaged = w.navalPilot.snapshot(f.owner);
  assert.equal(damaged.body.operational.parts.some((part) => part[0] === 'wall'), false,
    'the damaged wall is absent from the walkable operational geometry');
  assert.ok(f.ship.grid.parts.some((part) => part[0] === 'wall'), 'the saved blueprint retains the original wall');

  assert.equal(w.navalPilot.walk(f.owner, helm.epoch), true);
  let deck = w.navalPilot.deckSnapshot(f.owner);
  for (let seq = 1; seq <= 30; seq++) {
    assert.equal(w.navalPilot.deckInput(f.owner, { epoch: deck.epoch, seq, mx: 1, mz: 0 }), true);
    w.stepWorld();
  }
  deck = w.navalPilot.deckSnapshot(f.owner);
  assert.ok(deck.state.x > 3.55 && deck.state.x < 4,
    `owner stands within the former wall clearance while supported: local x=${deck.state.x}`);
  assert.equal(w.navalPilot.helm(f.owner, helm.epoch), true);
  assert.equal(w.navalPilot.walk(f.owner, helm.epoch), true,
    'taking helm and walking again uses the broken wall-free operational deck');
  assert.equal(profileBytes(f.profile), savedProfile);
  assert.equal(shipBytes(f.ship), savedShip);
});
