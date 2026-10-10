import test from 'node:test';
import assert from 'node:assert/strict';
import { map } from './helpers.mjs';
import { World } from '../src/sim/world.js';
import { newProfile, attachProfile, installInventory } from '../src/sim/systems/inventory.js';
import { installTrade } from '../src/sim/systems/trade.js';
import { attachRafts, installRafts, prepareRaftProfile, publicRafts } from '../src/sim/systems/rafts.js';
import { NavalPilot } from '../src/sim/naval/pilot.js';
import { createTrialBody } from '../src/sim/naval/trialBody.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { RAFT } from '../src/data/raftparts.js';
import { findRaftBoardingPoint, findRaftWaterExit } from '../src/sim/naval/swimBoarding.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { GameClient } from '../src/client/gameClient.js';

function fixture() {
  const w = new World(map.seed, { map, server: true, navalTrial: true });
  installInventory(w, 'naval-swim-test'); installTrade(w); installRafts(w, 'naval-swim-test');
  const owner = w.spawnPlayer({ name: 'Capitana', clientId: 41 }), profile = newProfile();
  assert.equal(prepareRaftProfile(w, profile), true);
  attachProfile(w, owner, profile); attachRafts(w, owner, profile);
  const source = [...w.rafts.values()].find((r) => r.owner === owner), ship = source.ship;
  const pose = { x: w.ecs.x[source.entity], y: w.ecs.y[source.entity], z: w.ecs.z[source.entity], yaw: w.ecs.facing[source.entity] };
  let body = createTrialBody(ship.grid.parts, pose, 'naval-swim-test:body'), parked = false;
  const sourceRev = ship.rev;
  w.navalTrial = {
    start(e, id) { return e === owner && id === ship.id ? {} : null; },
    snapshot() { return ship.rev === sourceRev ? { ack: 0, body } : null; },
    input() { return true; }, releaseControl() { return true; },
    park(_handle, value) { parked = value; return true; }, stop() { return true; },
    refreshPayload() { return true; },
  };
  const pilot = w.navalPilot = new NavalPilot(w, { live: true });
  const waterMap = { ...w.map, groundAt: () => -2, onDock: () => false, colliders: [], queryColliders: () => [] };
  w.map = waterMap; w.raftDeck.map = waterMap;
  const raft = publicRafts(w).find((r) => r.owner === owner), helm = pilotPoint(raft, raft.helm);
  w.ecs.x[owner] = helm.x; w.ecs.y[owner] = helm.y; w.ecs.z[owner] = helm.z; w.ecs.facing[owner] = helm.f;
  w.raftDeck.update(publicRafts(w));
  return { w, owner, pilot, ship, source, pose, get body() { return body; }, setBody(v) { body = v; }, isParked: () => parked };
}

test('own slow live voyage exits only through a reachable exposed level-zero edge and reboards as a walker', () => {
  const f = fixture(), { w, owner, pilot, ship } = f;
  assert.equal(pilot.mount(owner, ship.id), true);
  const naval = pilot.snapshot(owner), beforeStamina = w.ecs.swimStamina[owner];
  assert.equal(pilot.voyageSnapshot(owner).canSwim, true);
  assert.equal(pilot.swim(owner, naval.epoch), true);
  assert.equal(pilot.voyageSnapshot(owner).swimming, true);
  assert.equal(pilot.voyageSnapshot(owner).phase, 'shore');
  assert.equal(f.isParked(), true);
  assert.equal(w.ecs.swim[owner], 1);
  assert.equal(w.ecs.swimStamina[owner], beforeStamina, 'entering water does not refill stamina');
  assert.equal(pilot.snapshot(owner).active, false);

  const water = pilot.voyageSnapshot(owner);
  assert.equal(water.canReboard, true);
  assert.equal(pilot.reboard(owner, ship.id), true);
  assert.equal(f.isParked(), false);
  assert.equal(w.ecs.swim[owner], 0);
  assert.equal(w.ecs.swimStamina[owner], beforeStamina, 'reboarding does not refill stamina');
  assert.equal(pilot.walking(owner), true, 'the owner boards the deck as a walker');
  assert.equal(pilot.snapshot(owner).active, true);
  assert.equal(pilot.voyageSnapshot(owner).swimming, false);
});

test('water reboarding rejects distant swimmers, active actions, changed blueprints, and foreign raft IDs', () => {
  const f = fixture(), { w, owner, pilot, ship } = f;
  assert.equal(pilot.mount(owner, ship.id), true);
  assert.equal(pilot.swim(owner, pilot.snapshot(owner).epoch), true);
  const x = w.ecs.x[owner], z = w.ecs.z[owner];
  w.ecs.x[owner] += 20;
  assert.equal(pilot.reboard(owner, ship.id), false);
  w.ecs.x[owner] = x; w.ecs.z[owner] = z;
  w.ecs.atkStage[owner] = 1;
  assert.equal(pilot.reboard(owner, ship.id), false);
  w.ecs.atkStage[owner] = 0;
  assert.equal(pilot.reboard(owner, 'foreign:raft'), false);
  ship.rev++;
  assert.equal(pilot.reboard(owner, ship.id), false);
});

test('boarding geometry enforces the 1.5 unit climb range and rejects caller range expansion', () => {
  const f = fixture(), raft = publicRafts(f.w).find((r) => r.owner === f.owner);
  const pose = { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw }, parts = raft.parts.map((p) => [...p]);
  const edge = findRaftWaterExit(f.w, { shipId: raft.id, pose, parts,
    from: pilotPoint(pose, { ...raft.helm, y: 0 }), radius: 0.4 });
  assert.ok(edge);
  const far = { x: edge.deck.x + 5, y: edge.y, z: edge.deck.z };
  assert.equal(findRaftBoardingPoint(f.w, { shipId: raft.id, pose, parts, from: far, radius: 0.4 }), null);
  assert.equal(findRaftBoardingPoint(f.w, { shipId: raft.id, pose, parts, from: edge.water,
    radius: 0.4, maxDistance: 2.5 }), null, 'caller cannot expand the climb range');
});

test('water exit cannot reach an exposed edge more than 1.5 units from the owner', () => {
  const f = fixture(), raft = publicRafts(f.w).find((r) => r.owner === f.owner);
  const pose = { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw };
  const parts = [];
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) parts.push(['foundation', x, z, 0]);
  f.w.raftDeck.update([{ ...raft, parts }]);
  const center = pilotPoint(pose, { x: 2.5 * RAFT.cell, y: 0, z: 2.5 * RAFT.cell, f: 0 });
  assert.equal(findRaftWaterExit(f.w, { shipId: raft.id, pose, parts,
    from: { x: center.x, y: pose.y, z: center.z }, radius: 0.4 }), null);
});

test('failed walker creation restores the swimmer and preserves drowning grace', () => {
  const f = fixture(), { w, owner, pilot, ship } = f;
  assert.equal(pilot.mount(owner, ship.id), true);
  assert.equal(pilot.swim(owner, pilot.snapshot(owner).epoch), true);
  const epoch = pilot.snapshot(owner).epoch, prior = w.ecs.swimDrown[owner], speed = w.ecs.speed[owner];
  w.ecs.swimDrown[owner] = 1.25;
  w.ecs.speed[owner] = Number.NaN; // DeckWalkEngine rejects this after the climb geometry succeeds.
  assert.equal(pilot.reboard(owner, ship.id), false);
  assert.equal(pilot.snapshot(owner).epoch, epoch);
  assert.equal(w.ecs.swim[owner], 1);
  assert.equal(w.ecs.swimDrown[owner], 1.25);
  assert.equal(pilot.voyageSnapshot(owner).swimming, true);
  w.ecs.speed[owner] = speed;
});

test('restored voyage rebinds its ship revision and blueprint before the owner can swim', () => {
  const f = fixture(), { w, owner, pilot, ship, source } = f;
  ship.voyage = { pose: [f.pose.x + 1, f.pose.z, f.pose.yaw], hull: { hp: 1, max: 1 } };
  const shoreMap = { ...w.map, groundAt: () => 0.6, onDock: () => false };
  w.map = shoreMap; w.raftDeck.map = shoreMap;
  assert.equal(pilot.restore(owner, ship.id), true);
  const recovery = pilot.voyageSnapshot(owner);
  assert.ok(recovery.landing);
  w.ecs.x[owner] = recovery.landing.x; w.ecs.y[owner] = recovery.landing.y; w.ecs.z[owner] = recovery.landing.z;
  assert.equal(pilot.reboard(owner, ship.id), true);
  const waterMap = { ...shoreMap, groundAt: () => -2 };
  w.map = waterMap; w.raftDeck.map = waterMap; w.raftDeck.update(publicRafts(w));
  assert.equal(pilot.swim(owner, pilot.snapshot(owner).epoch), true);
  assert.equal(pilot.voyageSnapshot(owner).swimming, true);
  assert.equal(source.ship.rev, ship.rev);
});

test('LocalServer receives swim and reboard commands and snapshots the parked and walking states', () => {
  const messages = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send(_id, msg) { messages.push(structuredClone(msg)); } });
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Navegante', save: '' });
  const events = [], snapshots = [], transport = { onMessage: (cb) => events.push(cb), onSnapshot: (cb) => snapshots.push(cb), start() {},
    send: (m) => server.receive(1, structuredClone(m)), sendInput: (_seq, cmd) => server.receive(1, { t: MSG.INPUTS, cmds: [structuredClone(cmd)] }), flush() {} };
  const client = new GameClient(transport, server.world.map, { emit() {} });
  const deliver = () => { for (const m of messages.splice(0)) for (const cb of m.t === MSG.SNAPSHOT ? snapshots : events) cb(m); };
  deliver();
  const owner = client.youServer, w = server.world, raft = publicRafts(w).find((r) => r.owner === owner);
  const helm = pilotPoint(raft, raft.helm);
  w.map.groundAt = () => -2; w.map.onDock = () => false; w.map.queryColliders = () => []; w.map.colliders = [];
  w.raftDeck.map = w.map;
  w.ecs.x[owner] = helm.x; w.ecs.y[owner] = helm.y; w.ecs.z[owner] = helm.z; w.ecs.facing[owner] = helm.f;
  w.raftDeck.update(publicRafts(w));
  server.receive(1, { t: MSG.CMD, type: 'navalPilot', op: 'mount', shipId: raft.id });
  server.step(); server.broadcastSnapshot(); deliver();
  assert.ok(client.naval.active);
  const epoch = client.naval.epoch;
  server.receive(1, { t: MSG.CMD, type: 'navalPilot', op: 'swim', epoch });
  server.step(); server.broadcastSnapshot(); deliver();
  assert.equal(client.voyage.swimming, true);
  assert.equal(client.voyage.canReboard, true);
  assert.equal(client.naval.active, false);
  assert.equal(w.ecs.swim[owner], 1);
  server.receive(1, { t: MSG.CMD, type: 'navalPilot', op: 'reboard', shipId: raft.id });
  assert.equal(w.navalPilot.walking(owner), true, 'received reboard command commits walker before next tick');
  server.step(); server.broadcastSnapshot(); deliver();
  assert.equal(w.ecs.swim[owner], 0);
  assert.ok(client.pred.rafts.find((r) => r.id === raft.id)?.crew.some((c) => c.entity === owner && c.mode === 'walk'));
  assert.equal(w.navalPilot.walking(owner), true);
  assert.equal(client.naval.active, true);
  assert.ok(publicRafts(w).find((r) => r.id === raft.id).crew.some((c) => c.entity === owner && c.mode === 'walk'));
  server.disconnect(1);
});

test('geometry rejects high-floor drops and edges blocked by railings', () => {
  const f = fixture(), raft = publicRafts(f.w).find((r) => r.owner === f.owner);
  const parts = raft.parts.map((p) => [...p]);
  const pose = { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw };
  const center = pilotPoint(pose, { ...raft.helm, y: 0 });
  const from = { x: center.x, y: raft.y + RAFT.levelHeight, z: center.z };
  const upperParts = [...parts, ['floor', 1, 0, 1]];
  f.w.raftDeck.update([{ ...raft, parts: upperParts }]);
  assert.equal(f.w.raftDeck.surface(from.x, from.z, from.y)?.y, from.y, 'fixture is genuinely standing on level one');
  assert.equal(findRaftWaterExit(f.w, { shipId: raft.id, pose, parts: upperParts, from, radius: 0.4 }), null,
    'an upper floor cannot turn into a water teleport');

  const withRails = [...parts,
    ['railing', 0, 0, 0, 0], ['railing', 1, 0, 0, 0],
    ['railing', 0, 1, 0, 2], ['railing', 1, 1, 0, 2],
    ['railing', 0, 0, 0, 3], ['railing', 0, 1, 0, 3],
    ['railing', 1, 0, 0, 1], ['railing', 1, 1, 0, 1]];
  f.w.raftDeck.update([{ ...raft, parts: withRails }]);
  const deckCenter = pilotPoint(pose, { ...raft.helm, y: 0 });
  const deckFrom = { x: deckCenter.x, y: raft.y, z: deckCenter.z };
  assert.equal(findRaftWaterExit(f.w, { shipId: raft.id, pose, parts: withRails, from: deckFrom, radius: 0.4 }), null,
    'a railing blocks every water exit');
});

test('boarding geometry only returns exposed base-deck points in deep water', () => {
  const f = fixture(), raft = publicRafts(f.w).find((r) => r.owner === f.owner);
  const pose = { x: raft.x, y: raft.y, z: raft.z, yaw: raft.yaw };
  const parts = raft.parts.map((p) => [...p]);
  const helm = pilotPoint(pose, { ...raft.helm, y: 0 });
  const exit = findRaftWaterExit(f.w, { shipId: raft.id, pose, parts,
    from: { x: helm.x, y: raft.y, z: helm.z }, radius: 0.4 });
  assert.ok(exit);
  assert.ok(Math.hypot(exit.water.x - exit.deck.x, exit.water.z - exit.deck.z) < 1.5);
  const board = findRaftBoardingPoint(f.w, { shipId: raft.id, pose, parts,
    from: { x: exit.water.x, y: exit.y, z: exit.water.z }, radius: 0.4 });
  assert.ok(board);
  assert.equal(f.w.raftDeck.surface(board.deck.x, board.deck.z, pose.y).id, raft.id);
});
