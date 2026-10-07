import test from 'node:test';
import assert from 'node:assert/strict';
import { GameClient } from '../src/client/gameClient.js';
import { LocalServer } from '../src/net/localServer.js';
import { NavalPilotServer } from '../src/net/navalPilotServer.js';
import { MSG } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { DT, INTERP_DELAY } from '../src/data/tuning.js';
import { RAFT } from '../src/data/raftparts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { publicRafts } from '../src/sim/systems/rafts.js';

const copy = (value) => structuredClone(value);
const close = (a, b, label, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps,
  `${label}: expected ${b}, got ${a}`);

class QueuedTransport {
  constructor(server, id, inbox) {
    this.server = server; this.id = id; this.inbox = inbox; this.snapCbs = []; this.msgCbs = [];
  }
  onSnapshot(cb) { this.snapCbs.push(cb); }
  onMessage(cb) { this.msgCbs.push(cb); }
  send(message) { this.server.receive(this.id, copy(message)); }
  sendInput(_seq, _command) {}
  start() {}
  deliver() {
    const messages = this.inbox.get(this.id) || [];
    this.inbox.set(this.id, []);
    for (const message of messages) {
      const callbacks = message.t === MSG.SNAPSHOT ? this.snapCbs : this.msgCbs;
      if (message.t === MSG.SNAPSHOT) this.lastSnapshot = message;
      for (const callback of callbacks) callback(message);
    }
  }
  takeSnapshots() {
    const messages = this.inbox.get(this.id) || [];
    const selected = messages.filter((message) => message.t === MSG.SNAPSHOT);
    this.inbox.set(this.id, messages.filter((message) => message.t !== MSG.SNAPSHOT));
    return selected;
  }
  deliverOne(snapshot) { this.lastSnapshot = snapshot; for (const callback of this.snapCbs) callback(snapshot); }
}

function harness({ count = 2, serverFactory = (options) => new NavalPilotServer(options) } = {}) {
  const inbox = new Map();
  const server = serverFactory({ seed: GAME.seed, send: (id, message) => {
    if (!inbox.has(id)) inbox.set(id, []);
    inbox.get(id).push(copy(message));
  } });
  const clients = new Map(), transports = new Map();
  for (let id = 1; id <= count; id++) {
    inbox.set(id, []);
    server.connect(id);
    const transport = new QueuedTransport(server, id, inbox);
    const client = new GameClient(transport, server.world.map, { emit() {} });
    client.start(); client.join(`Grumete ${id}`, 0, 0);
    transport.deliver();
    clients.set(id, client); transports.set(id, transport);
  }
  server.broadcastSnapshot();
  for (const transport of transports.values()) transport.deliver();
  return { server, clients, transports };
}

const entity = (client) => client.youServer;
const ownRaft = (server, owner) => publicRafts(server.world).find((raft) => raft.owner === owner);

function placeOnCell(server, player, raft, cellIndex) {
  server.world.raftDeck.update(publicRafts(server.world));
  const foundations = raft.parts.filter((part) => part[0] === 'foundation');
  assert.ok(foundations[cellIndex], `raft has foundation cell ${cellIndex}`);
  const part = foundations[cellIndex];
  const candidate = pilotPoint(raft, { x: (part[1] + 0.5) * RAFT.cell, y: 0,
    z: (part[2] + 0.5) * RAFT.cell, f: 0 });
  const surface = server.world.raftDeck.surface(candidate.x, candidate.z, candidate.y);
  assert.equal(surface?.id, raft.id, 'selected local cell has real raft support');
  assert.equal(surface.kind, 'deck');
  const ecs = server.world.ecs;
  ecs.x[player] = candidate.x; ecs.y[player] = surface.y; ecs.z[player] = candidate.z;
  ecs.facing[player] = candidate.f;
  ecs.vx[player] = ecs.vz[player] = ecs.kbx[player] = ecs.kbz[player] = 0;
  return { x: candidate.x, y: surface.y, z: candidate.z, f: candidate.f };
}

function publish(h) {
  h.server.broadcastSnapshot();
  for (const transport of h.transports.values()) transport.deliver();
}

function advance(h, hold = null) {
  assert.equal(h.server.step(), true, 'server admits the fixed tick');
  h.server.broadcastSnapshot();
  for (const transport of h.transports.values()) if (transport !== hold) transport.deliver();
}

function inviteBoardAndMount(h) {
  const owner = h.clients.get(1), guest = h.clients.get(2);
  const ownerId = entity(owner), guestId = entity(guest), raft = ownRaft(h.server, ownerId);
  placeOnCell(h.server, ownerId, raft, 0);
  placeOnCell(h.server, guestId, raft, 2);
  owner.inviteNaval(raft.id, guestId);
  guest.boardNaval(raft.id);
  assert.equal(h.server.world.navalPilot.walking(guestId), true, 'guest accepted the owner invite');
  owner.mountNaval(raft.id);
  assert.equal(h.server.world.navalPilot.has(ownerId), true, 'owner controls the raft');
  publish(h);
  return { owner, guest, ownerId, guestId, raftId: raft.id };
}

function comparePosition(actual, expected, label) {
  for (const key of ['x', 'y', 'z', 'f']) close(actual[key], expected[key], `${label} ${key}`);
}

test('owner and passenger walking stay attached to their rendered raft as it moves and turns', () => {
  const h = harness(), { server, clients } = h;
  const { owner, guest, ownerId, guestId, raftId } = inviteBoardAndMount(h);
  assert.equal(owner.naval.active, true);
  assert.equal(owner.deck.active, false, 'helm owner is not a deck walker yet');
  assert.equal(guest.deck.active, true);
  assert.equal(guest.naval.active, false);

  const before = ownRaft(server, ownerId);
  for (let i = 0; i < 10; i++) {
    owner.tickNaval({ throttle: 1, brake: 0, steer: 0.25 });
    advance(h);
  }
  const after = ownRaft(server, ownerId);
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z, after.yaw - before.yaw) > 1e-4,
    'authoritative helm input moved the raft');

  owner.walkNaval();
  advance(h);
  assert.equal(owner.deck.active, true);
  assert.equal(owner.naval.active, true, 'owner keeps the voyage stream while walking');
  assert.equal(guest.deck.active, true);
  for (let i = 0; i < 3; i++) {
    owner.tickDeck({ mx: 0, mz: 0.35 });
    guest.tickDeck({ mx: 0.35, mz: 0 });
    advance(h);
  }
  assert.ok(Math.hypot(owner.deck.state.x - 1, owner.deck.state.z - 1) > 1e-4, 'owner walks in local deck space');
  assert.ok(Math.hypot(guest.deck.state.x - 1, guest.deck.state.z - 3) > 1e-4, 'guest walks in local deck space');

  const guestSamples = guest.raftSamples.get(raftId).filter((sample) => sample.record.pilot?.epoch === owner.naval.epoch);
  assert.ok(guestSamples.length >= 2, 'guest has multiple public samples for the same moving raft epoch');
  const a = guestSamples.at(-2), b = guestSamples.at(-1), targetTick = (a.tick + b.tick) / 2;
  for (const client of clients.values()) client.serverOffset = (targetTick + INTERP_DELAY / DT) * DT - client.clock;
  const ownerRaft = owner.renderRafts().find((record) => record.id === raftId);
  const guestRaft = guest.renderRafts().find((record) => record.id === raftId);
  assert.ok(ownerRaft && guestRaft);
  assert.ok(Number.isFinite(guestRaft.x) && Number.isFinite(guestRaft.yaw), 'guest renders an interpolated pose');

  const ownerLocal = owner.localState(1, {}), guestLocal = guest.localState(1, {});
  comparePosition(ownerLocal, owner.deck.position(ownerRaft, 1), 'owner on rendered raft');
  comparePosition(guestLocal, guest.deck.position(guestRaft, 1), 'guest on rendered raft');

  owner.update(0, 0); guest.update(0, 0);
  const remoteGuest = owner.entities.get(guestId), remoteOwner = guest.entities.get(ownerId);
  const ownerCrew = ownerRaft.crew.find((member) => member.entity === guestId);
  const guestCrew = guestRaft.crew.find((member) => member.entity === ownerId);
  assert.ok(ownerCrew && guestCrew, 'both public raft views include the remote walker anchors');
  comparePosition(remoteGuest.r, pilotPoint(ownerRaft, ownerCrew.anchor), 'remote guest on owner rendered raft');
  comparePosition(remoteOwner.r, pilotPoint(guestRaft, guestCrew.anchor), 'remote owner on guest rendered raft');
});

test('deck ACK replay, delayed snapshots, leave epochs, and helm mode are fenced', () => {
  const h = harness(), { guest, ownerId, guestId, raftId } = inviteBoardAndMount(h);
  const transport = h.transports.get(2), previousEpoch = guest.deck.epoch;
  guest.tickDeck({ mx: 0.25, mz: 0 });
  advance(h, transport);
  const first = transport.takeSnapshots().at(-1);
  guest.tickDeck({ mx: 0, mz: 0.25 });
  advance(h, transport);
  const second = transport.takeSnapshots().at(-1);
  assert.ok(second.deck.ack > first.deck.ack);
  transport.deliverOne(first);
  assert.equal(guest.deck.ack, first.deck.ack);
  assert.deepEqual(guest.deck.pending.map((command) => command.seq), [second.deck.ack],
    'the still-unacknowledged local walk step is replayed after the delayed ACK');
  transport.deliverOne(second);
  assert.equal(guest.deck.ack, second.deck.ack);
  assert.deepEqual(guest.deck.pending, []);
  const oldEpochSnapshot = copy(second);

  guest.leaveDeck();
  publish(h);
  assert.equal(guest.deck.active, false);
  placeOnCell(h.server, guestId, ownRaft(h.server, ownerId), 2);
  h.clients.get(1).inviteNaval(raftId, guestId);
  guest.boardNaval(raftId);
  publish(h);
  assert.equal(guest.deck.active, true);
  assert.ok(guest.deck.epoch > previousEpoch);
  const current = transport.lastSnapshot;
  assert.ok(current?.deck.active);
  const acceptedTick = guest.lastSnapshotTick;

  const staleEpoch = copy(current);
  staleEpoch.tick = acceptedTick + 1;
  staleEpoch.deck = oldEpochSnapshot.deck;
  staleEpoch.deck.tick = staleEpoch.tick;
  transport.deliverOne(staleEpoch);
  assert.equal(guest.deck.epoch, current.deck.epoch, 'older deck epoch cannot reattach after reboarding');
  assert.equal(guest.lastSnapshotTick, acceptedTick, 'rejected private state does not advance the snapshot cursor');

  const wrongMode = copy(current);
  wrongMode.tick = acceptedTick + 1;
  wrongMode.deck.tick = wrongMode.tick;
  wrongMode.deck.mode = 'helm';
  transport.deliverOne(wrongMode);
  assert.equal(guest.deck.active, true);
  assert.equal(guest.deck.epoch, current.deck.epoch);
  assert.equal(guest.lastSnapshotTick, acceptedTick, 'helm is represented by the naval stream, never deck walk');
});

test('onSnapshot commits neither private stream when either the deck or naval stream is invalid', () => {
  const h = harness(), { owner, raftId } = inviteBoardAndMount(h);
  owner.walkNaval();
  advance(h);
  assert.equal(owner.deck.active, true);
  assert.equal(owner.naval.active, true);
  const transport = h.transports.get(1), valid = transport.lastSnapshot;
  const deckBefore = owner.deck, navalBefore = owner.naval, raftsBefore = owner.pred.rafts;
  const cursor = owner.lastSnapshotTick;

  const badDeck = copy(valid);
  badDeck.deck.state.x = 257;
  transport.deliverOne(badDeck);
  assert.equal(owner.deck, deckBefore);
  assert.equal(owner.naval, navalBefore);
  assert.equal(owner.pred.rafts, raftsBefore);
  assert.equal(owner.lastSnapshotTick, cursor);

  const badNaval = copy(valid);
  badNaval.naval.wind.strength = 2;
  transport.deliverOne(badNaval);
  assert.equal(owner.deck, deckBefore);
  assert.equal(owner.naval, navalBefore);
  assert.equal(owner.pred.rafts, raftsBefore);
  assert.equal(owner.lastSnapshotTick, cursor);
  assert.equal(owner.deck.shipId, raftId);
});

test('held heartbeat updates unrelated public raft data without advancing the crew walker', () => {
  let admitted = true;
  const h = harness({ serverFactory: (options) => new NavalPilotServer({ ...options, beforeTick: () => admitted }) });
  const { guest, guestId } = inviteBoardAndMount(h);
  const otherRaft = ownRaft(h.server, entity(h.clients.get(2)));
  const before = copy(h.server.world.navalPilot.deckSnapshot(guestId));
  guest.tickDeck({ mx: 0.2, mz: 0 });
  const predicted = guest.deck.state;
  const seq = guest.deck.seq;
  admitted = false;
  assert.equal(h.server.step(), false, 'the fixed tick is held');
  h.server.world.rafts.get(otherRaft.id).ship.n = 'Plano actualizado durante heartbeat';
  h.server.broadcastSnapshot();
  h.transports.get(2).deliver();
  const after = h.server.world.navalPilot.deckSnapshot(guestId);
  assert.equal(after.ack, before.ack);
  assert.deepEqual(after.state, before.state, 'the server walker did not advance without an admitted tick');
  assert.equal(guest.deck.state, predicted, 'duplicate same-tick heartbeat preserves local prediction');
  assert.equal(guest.deck.seq, seq);
  assert.equal(guest.pred.rafts.find((raft) => raft.id === otherRaft.id).name,
    'Plano actualizado durante heartbeat', 'outer public snapshot still installs independent updates');
});

test('ordinary LocalServer snapshots and commands never activate private naval walk state', () => {
  const h = harness({ count: 1, serverFactory: (options) => new LocalServer({ ...options, bots: 0, enemies: false }) });
  const client = h.clients.get(1), server = h.server;
  assert.equal(server.world.navalPilot, null);
  assert.equal(server.world.navalTrial, null);
  const raft = ownRaft(server, entity(client));
  client.inviteNaval(raft.id, entity(client));
  client.boardNaval(raft.id);
  client.walkNaval();
  client.tickDeck({ mx: 1, mz: 0 });
  publish(h);
  assert.equal(client.naval.active, false);
  assert.equal(client.deck.active, false);
  assert.equal(client.tickDeck({ mx: 0, mz: 1 }), false);
  const latest = h.transports.get(1).lastSnapshot;
  assert.equal(Object.hasOwn(latest, 'naval'), false);
  assert.equal(Object.hasOwn(latest, 'deck'), false);
});
