import test from 'node:test';
import assert from 'node:assert/strict';
import { RAFT_LOAD, RAFT_PARTS, RAFT_REINFORCEMENT, STARTER_RAFT } from '../src/data/raftparts.js';
import { newHold, goodMass, goodVolume, load } from '../src/sim/economy/cargo.js';
import { raftCapacity, holdLoadIncreases } from '../src/sim/economy/raftCapacity.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { raftCmd } from '../src/sim/systems/raftEditor.js';
import { newRaft, raftStats } from '../src/sim/economy/raft.js';
import { stepRaftWork } from '../src/sim/systems/raftProduction.js';
import { map } from './helpers.mjs';

const replaceFirstFoundation = (part) => STARTER_RAFT.map((tuple, index) =>
  index === 0 ? [part, ...tuple.slice(1)] : [...tuple]);
const copy = (value) => structuredClone(value);

function serverFixture() {
  const messages = new Map();
  const server = new LocalServer({ seed: 92, bots: 0, enemies: false, navigation: true,
    send(id, message) {
      const rows = messages.get(id) || [];
      rows.push(copy(message)); messages.set(id, rows);
    } });
  return { server, messages };
}

function join(server, id, profile) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Carga ${id}`, skin: 0, weapon: 0, save: '' }, profile);
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity);
  return entity;
}

function placeAtHelm(server, entity, ship) {
  const record = publicRafts(server.world).find((raft) => raft.id === ship.id);
  assert.ok(record?.helm);
  const point = pilotPoint(record, record.helm), ecs = server.world.ecs;
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z; ecs.facing[entity] = point.f;
  ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0; ecs.vx[entity] = ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1;
}

function command(server, id, type, fields) {
  server.receive(id, { t: MSG.CMD, type, ...fields });
  server.flushEvents();
}

function eventFor(messages, id, type, opId) {
  return (messages.get(id) || []).filter((row) => row.t === MSG.EVENT && row.ev?.type === type
    && (!opId || row.ev.opId === opId)).at(-1)?.ev;
}

test('reinforced foundation increases structural headroom without adding flotation', () => {
  assert.deepEqual(RAFT_REINFORCEMENT, { madera: 1, hierro: 1 });
  assert.equal(RAFT_PARTS.foundation.structuralCapacity, 10);
  assert.equal(RAFT_PARTS.foundation.weight, 4);
  assert.equal(RAFT_PARTS.foundation.hp, 60);
  assert.equal(RAFT_PARTS.reinforcedFoundation.structuralCapacity, 14);
  assert.equal(RAFT_PARTS.reinforcedFoundation.weight, 5);
  assert.equal(RAFT_PARTS.reinforcedFoundation.hp, 90);
  assert.equal(RAFT_PARTS.reinforcedFoundation.floats, RAFT_PARTS.foundation.floats);

  const hold = newHold(20), pack = newHold(20);
  const basic = raftCapacity(STARTER_RAFT, hold, pack);
  const reinforced = raftCapacity(replaceFirstFoundation('reinforcedFoundation'), hold, pack);
  assert.equal(reinforced.buoyancy, basic.buoyancy, 'reinforcement does not invent flotation');
  assert.equal(reinforced.structuralLimit, basic.structuralLimit + 4);
  assert.equal(reinforced.dryMass, basic.dryMass + 1);
  assert.equal(reinforced.totalLimit, Math.min(reinforced.structuralLimit, reinforced.safeDisplacement));
  assert.ok(reinforced.cargoMax > basic.cargoMax, 'the stronger structure raises usable load unless flotation is already the bottleneck');
  assert.equal(reinforced.crewMass, RAFT_LOAD.crewMass, 'one owner pilot is included by default');
});

test('safe displacement, crew, guest backpacks, and hold excess are accounted independently of volume', () => {
  assert.equal(RAFT_LOAD.safeFraction, 0.9);
  assert.equal(RAFT_LOAD.crewMass, 3);
  assert.equal(RAFT_LOAD.heavyFraction, 0.85);
  const hold = newHold(20), pack = newHold(20);
  load(hold, 'piedra', 1);
  load(pack, 'lona', 1);
  const solo = raftCapacity(STARTER_RAFT, hold, pack);
  const crewed = raftCapacity(STARTER_RAFT, hold, pack, null,
    { crewCount: 2, guestMass: goodMass('hierro') });
  assert.equal(solo.safeDisplacement, solo.buoyancy * 0.9);
  assert.equal(solo.holdVolume, goodVolume('piedra'));
  assert.equal(solo.packVolume, goodVolume('lona'));
  assert.equal(solo.cargoMass, goodMass('piedra') + goodMass('lona'));
  assert.equal(crewed.crewMass, 6, 'each consenting pilot/passenger reserves three mass units');
  assert.equal(crewed.guestMass, goodMass('hierro'));
  assert.equal(crewed.totalMass, solo.totalMass + 3 + goodMass('hierro'));
  assert.equal(crewed.holdVolume, solo.holdVolume);
  assert.equal(crewed.packVolume, solo.packVolume);

  const below = newHold(20), atLimit = newHold(20), beyond = newHold(20);
  load(atLimit, 'hierro', 2);
  load(beyond, 'hierro', 3);
  assert.equal(holdLoadIncreases(STARTER_RAFT, below, atLimit), false);
  assert.equal(holdLoadIncreases(STARTER_RAFT, atLimit, beyond), true,
    'the hold admission helper rejects a larger excess, even when volume separately fits');
  assert.equal(holdLoadIncreases(STARTER_RAFT, beyond, atLimit), false,
    'unloading is allowed to reduce an existing overage');
  assert.equal(holdLoadIncreases(STARTER_RAFT, beyond, beyond), false);
});

test('reinforcement command is atomic, charges its incremental materials, and replays its receipt once', () => {
  const { server, messages } = serverFixture();
  const profile = newProfile(), ship = profile.eco.ships.find((item) => item.kind === 'raft');
  ship.hold.goods = { madera: 1 };
  profile.eco.pack.goods = { hierro: 1 };
  const owner = join(server, 31, profile);
  placeAtHelm(server, owner, ship);
  const piece = [...ship.grid.parts[0]], rev = ship.rev, before = server.world.navalPilot.loadCapacity(ship.id);
  const fields = { op: 'reinforce', id: ship.id, index: 0, piece, expectedRev: rev, opId: 'reinforce-one' };

  command(server, 31, 'raft', fields);
  const accepted = eventFor(messages, 31, 'raftEdit', fields.opId);
  assert.equal(accepted?.ok, true, JSON.stringify(accepted));
  assert.equal(ship.grid.parts[0][0], 'reinforcedFoundation');
  assert.deepEqual(ship.grid.parts[0].slice(1), piece.slice(1), 'reinforcement substitutes the same cell without moving it');
  assert.equal(ship.rev, rev + 1);
  assert.equal(ship.hold.goods.madera, undefined, 'bodega pays the wood part of the incremental cost');
  assert.equal(profile.eco.pack.goods.hierro, undefined, 'the backpack pays the remaining iron');
  assert.ok(server.world.navalPilot.loadCapacity(ship.id).cargoMax > before.cargoMax);

  command(server, 31, 'raft', fields);
  const replay = eventFor(messages, 31, 'raftEdit', fields.opId);
  assert.equal(replay?.ok, true, 'an identical opId returns its accepted receipt');
  assert.equal(ship.rev, rev + 1, 'replay does not reinforce or debit twice');
  assert.equal(ship.grid.parts.filter(([kind]) => kind === 'reinforcedFoundation').length, 1);
  command(server, 31, 'raft', { ...fields, expectedRev: ship.rev, index: 1, piece: [...ship.grid.parts[1]] });
  assert.equal(eventFor(messages, 31, 'raftEdit', fields.opId)?.why, 'duplicate',
    'reusing an accepted receipt key for a different tuple cannot reinforce another cell');
  assert.equal(ship.rev, rev + 1);
  assert.equal(ship.grid.parts.filter(([kind]) => kind === 'reinforcedFoundation').length, 1);
  server.disconnect(31);
});

test('refused save preflight leaves the reinforcement plan and both inventories unchanged', () => {
  const { server } = serverFixture();
  const profile = newProfile(), ship = profile.eco.ships.find((item) => item.kind === 'raft');
  ship.hold.goods = { madera: 1 };
  profile.eco.pack.goods = { hierro: 1 };
  const owner = join(server, 32, profile);
  placeAtHelm(server, owner, ship);
  const fields = { op: 'reinforce', id: ship.id, index: 0, piece: [...ship.grid.parts[0]],
    expectedRev: ship.rev, opId: 'reinforce-save-reject' };
  const before = JSON.stringify({ rev: ship.rev, parts: ship.grid.parts, hold: ship.hold, pack: profile.eco.pack });
  const rejected = raftCmd(server.world, owner, { type: 'raft', ...fields }, () => false);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.why, 'saveSize');
  assert.equal(JSON.stringify({ rev: ship.rev, parts: ship.grid.parts, hold: ship.hold, pack: profile.eco.pack }), before,
    'failed preflight commits neither the upgraded piece nor material debits');
  server.disconnect(32);
});

test('new overloaded departure is denied before trial creation and preserves legacy goods', () => {
  const { server, messages } = serverFixture();
  const profile = newProfile(), ship = profile.eco.ships.find((item) => item.kind === 'raft');
  ship.hold.goods = { hierro: 2 };
  profile.eco.pack.goods = { hierro: 3 };
  const owner = join(server, 33, profile);
  placeAtHelm(server, owner, ship);
  const goodsBefore = { hold: copy(ship.hold.goods), pack: copy(profile.eco.pack.goods) };
  const load = server.world.navalPilot.loadCapacity(ship.id);
  assert.equal(load.status, 'overloaded');
  assert.ok(load.overMass > 0);

  command(server, 33, 'navalPilot', { op: 'mount', shipId: ship.id });
  assert.equal(server.world.navalPilot.snapshot(owner).active, false, 'over-limit departure is refused');
  assert.deepEqual(ship.hold.goods, goodsBefore.hold);
  assert.deepEqual(profile.eco.pack.goods, goodsBefore.pack);
  assert.equal(server.world.navalTrial.snapshot(ship.id), null, 'refusal creates no running trial body');
  server.broadcastSnapshot();
  const snapshot = (messages.get(33) || []).filter((row) => row.t === MSG.SNAPSHOT).at(-1);
  assert.equal(snapshot.capacity.status, 'overloaded');
  assert.equal(snapshot.capacity.overMass, load.overMass, 'the private reading explains the blocked departure');
  server.disconnect(33);
});

test('boarding evaluates the consenting guest backpack, then carries its ballast as private crew mass', () => {
  const { server, messages } = serverFixture();
  const ownerProfile = newProfile(), ship = ownerProfile.eco.ships.find((item) => item.kind === 'raft');
  const guestProfile = newProfile();
  guestProfile.eco.pack.goods = { hierro: 3 };
  const owner = join(server, 34, ownerProfile), guest = join(server, 35, guestProfile);
  placeAtHelm(server, owner, ship);
  command(server, 34, 'navalPilot', { op: 'mount', shipId: ship.id });
  const mounted = server.world.navalPilot.snapshot(owner);
  assert.equal(mounted.active, true);
  for (let seq = 1; seq <= 3; seq++) {
    server.receive(34, { t: MSG.SHIP_INPUT, epoch: mounted.epoch, seq, throttle: 1, brake: 0, steer: 0, capture: false });
    assert.equal(server.step(), true);
  }
  const movingBody = server.world.navalPilot.snapshot(owner).body;
  assert.ok(Math.hypot(movingBody.state.vx, movingBody.state.vz) > 0,
    'the test boards a passenger after real authoritative sailing ticks');
  const raftNow = publicRafts(server.world).find((row) => row.id === ship.id);
  const guestPoint = pilotPoint(raftNow, raftNow.helm), ecs = server.world.ecs;
  ecs.x[guest] = guestPoint.x; ecs.y[guest] = guestPoint.y; ecs.z[guest] = guestPoint.z; ecs.facing[guest] = guestPoint.f;
  ecs.regenT[guest] = 100; ecs.moveMag[guest] = 0; ecs.vx[guest] = ecs.vz[guest] = 0; ecs.dashT[guest] = -1;
  server.world.raftDeck.update(publicRafts(server.world));

  command(server, 34, 'navalPilot', { op: 'invite', shipId: ship.id, target: guest });
  command(server, 35, 'navalPilot', { op: 'board', shipId: ship.id });
  assert.equal(server.world.navalPilot.walking(guest), false, 'a backpack that makes the crew overloaded is rejected');
  assert.equal(eventFor(messages, 35, 'navalPilot')?.why, 'capacity');

  guestProfile.eco.pack.goods = { hierro: 2 };
  command(server, 35, 'navalPilot', { op: 'board', shipId: ship.id });
  assert.equal(server.world.navalPilot.walking(guest), true, 'the same consent invite can be accepted with safe ballast');
  const payload = server.world.navalPilot.payload(ship.id);
  assert.deepEqual(payload, { crewCount: 2, crewMass: 6, guestMass: 12 });
  assert.equal(server.world.navalPilot.loadCapacity(ship.id).status, 'heavy',
    'an admitted but high ballast load triggers the 85% warning without blocking boarding');

  const beforeBoard = server.world.navalPilot.snapshot(owner);
  assert.equal(beforeBoard.active, true, 'the guest boards an already moving raft');
  const afterBoard = server.world.navalPilot.snapshot(owner);
  assert.equal(afterBoard.active, true, 'the owner keeps pilot authority while the passenger boards underway');
  assert.deepEqual(afterBoard.body.pose, beforeBoard.body.pose, 'loading ballast does not teleport a moving hull');
  for (const key of ['yaw', 'vx', 'vz', 'omega', 'tick'])
    assert.equal(afterBoard.body.state[key], beforeBoard.body.state[key], `boarding preserves ${key}`);
  assert.deepEqual(afterBoard.body.activity, beforeBoard.body.activity);
  assert.deepEqual(afterBoard.body.structure, beforeBoard.body.structure, 'payload refresh preserves hull health');
  assert.equal(afterBoard.ack, beforeBoard.ack, 'payload refresh does not rewrite input acknowledgements');
  const ownerCapacity = (messages.get(34) || []).filter((row) => row.t === MSG.SNAPSHOT).at(-1)?.capacity;
  const guestCapacity = (messages.get(35) || []).filter((row) => row.t === MSG.SNAPSHOT).at(-1)?.capacity;
  assert.equal(ownerCapacity.guestMass, 12);
  assert.equal(ownerCapacity.crewMass, 6);
  assert.equal(ownerCapacity.totalMass, server.world.navalPilot.snapshot(owner).body.operational.rig.mass);
  assert.notEqual(guestCapacity?.id, ship.id, 'the passenger receives no owner capacity projection');
  assert.ok(!JSON.stringify((messages.get(34) || []).filter((row) => row.t === MSG.SNAPSHOT).at(-1)).includes('hierro'),
    'private capacity stays numeric and does not reveal the guest inventory identity');

  const deckEpoch = server.world.navalPilot.deckSnapshot(guest).epoch;
  assert.equal(server.world.navalPilot.leaveDeck(guest, deckEpoch + 1), false, 'a stale leave cannot detach the passenger');
  const beforeLeave = server.world.navalPilot.snapshot(owner);
  assert.equal(server.world.navalPilot.leaveDeck(guest, deckEpoch), true);
  assert.deepEqual(server.world.navalPilot.payload(ship.id), { crewCount: 1, crewMass: 3, guestMass: 0 });
  const afterLeave = server.world.navalPilot.snapshot(owner);
  assert.deepEqual(afterLeave.body.pose, beforeLeave.body.pose);
  for (const key of ['yaw', 'vx', 'vz', 'omega', 'tick'])
    assert.equal(afterLeave.body.state[key], beforeLeave.body.state[key], `unboarding preserves ${key}`);
  assert.deepEqual(afterLeave.body.structure, beforeLeave.body.structure);
  assert.equal(afterLeave.ack, beforeLeave.ack);
  assert.equal(afterLeave.body.operational.rig.cargoMass,
    RAFT_LOAD.crewMass,
    'leaving the deck removes only the admitted guest ballast from the live rig');
  server.disconnect(34); server.disconnect(35);
});

test('cargo deposit cannot increase a hold overage, while withdrawal remains available to rearrange goods', () => {
  const { server, messages } = serverFixture();
  const profile = newProfile(), ship = profile.eco.ships.find((item) => item.kind === 'raft');
  ship.grid = newRaft([...ship.grid.parts, ['storage', 0, 1, 0, 0]]);
  ship.hold.cap = raftStats(ship.grid).hold;
  ship.hold.goods = { hierro: 2, madera: 1 };
  profile.eco.pack.goods = { lona: 1 };
  const owner = join(server, 36, profile);
  placeAtHelm(server, owner, ship);
  const before = { hold: copy(ship.hold.goods), pack: copy(profile.eco.pack.goods), rev: ship.rev,
    tradeRev: profile.eco.tradeRev };

  command(server, 36, 'commerce', { op: 'transfer', id: ship.id, expectedRev: ship.rev,
    g: 'lona', n: 1, side: 'deposit', opId: 'deposit-over-limit' });
  const denied = eventFor(messages, 36, 'commerce', 'deposit-over-limit');
  assert.equal(denied?.ok, false);
  assert.equal(denied?.why, 'capacity');
  assert.deepEqual(ship.hold.goods, before.hold);
  assert.deepEqual(profile.eco.pack.goods, before.pack);
  assert.equal(ship.rev, before.rev);
  assert.equal(profile.eco.tradeRev, before.tradeRev);

  command(server, 36, 'commerce', { op: 'transfer', id: ship.id, expectedRev: ship.rev,
    g: 'madera', n: 1, side: 'withdraw', opId: 'withdraw-over-limit' });
  const withdrawn = eventFor(messages, 36, 'commerce', 'withdraw-over-limit');
  assert.equal(withdrawn?.ok, true, 'moving mass out of the hold is permitted even while the vessel remains overloaded');
  assert.equal(ship.hold.goods.madera, undefined);
  assert.equal(profile.eco.pack.goods.madera, 1);
  assert.equal(withdrawn.capacity.cargoMass, goodMass('hierro') * 2 + goodMass('madera') + goodMass('lona'),
    'redistribution does not pretend to remove cargo from the vessel');
  server.disconnect(36);
});

test('production defers an output lot that would increase hold overload without partial work or consumption', () => {
  const { server } = serverFixture();
  const profile = newProfile(), ship = profile.eco.ships.find((item) => item.kind === 'raft');
  ship.grid = newRaft([...ship.grid.parts, ['storage', 0, 1, 0, 0], ['net', 1, 0, 0, 0]]);
  ship.hold.cap = raftStats(ship.grid).hold;
  ship.hold.goods = { hierro: 2, madera: 1 };
  const owner = join(server, 37, profile);
  const active = server.world.rafts.get(ship.id);
  const before = { goods: copy(ship.hold.goods), work: copy(ship.grid.work), rev: ship.rev,
    tradeRev: profile.eco.tradeRev };

  stepRaftWork(server.world, 1 / 6);
  assert.deepEqual(ship.hold.goods, before.goods, 'the six-fish net lot is withheld as a unit if its output worsens excess');
  assert.deepEqual(ship.grid.work, before.work, 'blocked output does not commit fractional progress');
  assert.equal(ship.rev, before.rev);
  assert.equal(profile.eco.tradeRev, before.tradeRev);
  assert.equal(active.productionBlocked, 'capacity');
  assert.equal(server.world.navalPilot.locked(owner), false);
  server.disconnect(37);
});
