import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';
import { newRaft } from '../src/sim/economy/raft.js';
import { createNavalStructure } from '../src/sim/naval/structure.js';
import { encodeRaftCondition } from '../src/sim/naval/condition.js';
import { skillIndex } from '../src/data/tattoos.js';
import { doorPoint, DOOR_REACH } from '../src/sim/naval/shelter.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { hmacSaves } from '../server/saves.mjs';

const door = ['door', 0, 0, 0, 0];
const copy = (value) => structuredClone(value);

function shelteredProfile() {
  const profile = newProfile();
  const ship = profile.eco.ships.find((candidate) => candidate.kind === 'raft');
  ship.grid = newRaft([...ship.grid.parts, door, ['roof', 0, 0, 0, 0]]);
  const structure = createNavalStructure(ship.grid.parts.map((part, index) => ({ id: `piece${index + 1}`, part })));
  ship.condition = encodeRaftCondition(structure, ship.grid.parts.length + 1);
  ship.openDoors = [];
  return profile;
}

function setup({ saves = hmacSaves('raft-door-test-key'), ownerSave = undefined } = {}) {
  const messages = new Map();
  const server = new LocalServer({ seed: 118, bots: 0, enemies: false, saves,
    send(id, message) {
      const list = messages.get(id) || [];
      list.push(copy(message)); messages.set(id, list);
    },
    ...(ownerSave ? { onSave: ownerSave } : {}),
  });
  const join = (clientId, save = '') => {
    server.connect(clientId);
    server.receive(clientId, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Door ${clientId}`, skin: 0, weapon: 0, save });
    const entity = server.clients.get(clientId).entity;
    assert.ok(entity, `client ${clientId} joined`);
    return entity;
  };
  const owner = join(1, saves.store(shelteredProfile()));
  const guest = join(2);
  const source = [...server.world.rafts.values()].find((entry) => entry.owner === owner);
  assert.ok(source, 'owner raft attached');
  const liveDoor = source.condition.entries.find((entry) => entry.part[0] === 'door' && entry.hp > 0);
  assert.ok(liveDoor, 'fixture has a living stable door instance');
  return { server, messages, saves, owner, guest, source, liveDoor };
}

function positionNear(server, entity, source, distance = 1.1) {
  const record = publicRafts(server.world).find((raft) => raft.id === source.ship.id);
  const point = doorPoint(record, source.condition.entries.find((entry) => entry.part[0] === 'door').part);
  const normalX = Math.sin(record.yaw), normalZ = Math.cos(record.yaw);
  const ecs = server.world.ecs;
  ecs.x[entity] = point.x + normalX * distance;
  ecs.y[entity] = point.y;
  ecs.z[entity] = point.z + normalZ * distance;
  return point;
}

function latestDoor(messages, clientId, opId) {
  return (messages.get(clientId) || []).slice().reverse().find((message) => message.t === MSG.EVENT &&
    message.ev?.type === 'raftDoor' && (!opId || message.ev.opId === opId))?.ev || null;
}

function request(server, messages, clientId, source, liveDoor, fields) {
  const connectionId = server.clientOf(clientId);
  server.receive(connectionId, { t: MSG.CMD, type: 'raftDoor', id: source.ship.id, partId: liveDoor.id,
    expectedRev: source.ship.rev, ...fields });
  server.flushEvents();
  return latestDoor(messages, connectionId, fields.opId);
}

test('nearby owner and guest can open, close, and reopen a door with explicit idempotent state', () => {
  const { server, messages, owner, guest, source, liveDoor } = setup();
  positionNear(server, owner, source);
  positionNear(server, guest, source, -1.1);
  const rev = source.ship.rev;
  const opening = { open: true, expectedOpen: false, opId: 'guest-open-1' };
  const first = request(server, messages, guest, source, liveDoor, opening);
  assert.ok(first, 'guest request receives a private acknowledgement');
  assert.equal(first?.ok, true); assert.equal(first.changed, true); assert.equal(first.open, true);
  assert.deepEqual(source.ship.openDoors, [liveDoor.id]);
  assert.equal(source.ship.rev, rev, 'door use leaves the construction revision unchanged');

  const staleState = request(server, messages, guest, source, liveDoor,
    { open: false, expectedOpen: false, opId: 'guest-stale-expected-state' });
  assert.equal(staleState?.ok, false); assert.equal(staleState.why, 'revision');
  assert.deepEqual(source.ship.openDoors, [liveDoor.id], 'expectedOpen fences a command from a stale snapshot');

  const retry = request(server, messages, guest, source, liveDoor, opening);
  assert.equal(retry?.ok, true); assert.equal(retry.changed, false); assert.equal(retry.replay, true);
  assert.deepEqual(source.ship.openDoors, [liveDoor.id], 'retry does not toggle back closed');
  const conflict = request(server, messages, guest, source, liveDoor, { ...opening, open: false, expectedOpen: true });
  assert.equal(conflict?.ok, false); assert.equal(conflict.why, 'duplicate');
  assert.deepEqual(source.ship.openDoors, [liveDoor.id]);

  const closing = request(server, messages, owner, source, liveDoor,
    { open: false, expectedOpen: true, opId: 'owner-close-1' });
  assert.equal(closing?.ok, true); assert.equal(closing.open, false);
  assert.deepEqual(source.ship.openDoors || [], []);
  const reopen = request(server, messages, guest, source, liveDoor,
    { open: true, expectedOpen: false, opId: 'guest-reopen-1' });
  assert.equal(reopen?.ok, true); assert.deepEqual(source.ship.openDoors, [liveDoor.id]);
});

test('closing is refused when a body or an active leap landing occupies the leaf path', () => {
  const { server, messages, owner, guest, source, liveDoor } = setup();
  const leaf = positionNear(server, owner, source, 0);
  positionNear(server, guest, source);
  assert.equal(request(server, messages, owner, source, liveDoor,
    { open: true, expectedOpen: false, opId: 'open-for-occupants' })?.ok, true);

  const ecs = server.world.ecs;
  ecs.x[guest] = leaf.x; ecs.y[guest] = leaf.y; ecs.z[guest] = leaf.z;
  const bodyBlocked = request(server, messages, owner, source, liveDoor,
    { open: false, expectedOpen: true, opId: 'close-with-body' });
  assert.equal(bodyBlocked?.ok, false); assert.equal(bodyBlocked.why, 'occupied');
  assert.deepEqual(source.ship.openDoors, [liveDoor.id]);

  positionNear(server, guest, source);
  ecs.skQ[guest] = skillIndex('leap'); ecs.castK[guest] = 1;
  ecs.lpX1[guest] = leaf.x; ecs.lpZ1[guest] = leaf.z;
  const landingBlocked = request(server, messages, owner, source, liveDoor,
    { open: false, expectedOpen: true, opId: 'close-with-leap-landing' });
  assert.equal(landingBlocked?.ok, false); assert.equal(landingBlocked.why, 'occupied');
  assert.deepEqual(source.ship.openDoors, [liveDoor.id]);
});

test('wrong, far, other-floor, dead, and destroyed-door requests are rejected', () => {
  const { server, messages, owner, source, liveDoor } = setup();
  positionNear(server, owner, source);
  const wrong = request(server, messages, owner, source, { ...liveDoor, id: 'wrong-door' },
    { open: true, expectedOpen: false, opId: 'wrong-door' });
  assert.equal(wrong?.ok, false); assert.equal(wrong.why, 'condition');

  const ecs = server.world.ecs, original = { x: ecs.x[owner], y: ecs.y[owner], z: ecs.z[owner] };
  ecs.x[owner] += 100;
  const far = request(server, messages, owner, source, liveDoor,
    { open: true, expectedOpen: false, opId: 'far-door' });
  assert.equal(far?.ok, false); assert.equal(far.why, 'far');
  ecs.x[owner] = original.x; ecs.z[owner] = original.z; ecs.y[owner] = original.y + 2.6;
  const otherFloor = request(server, messages, owner, source, liveDoor,
    { open: true, expectedOpen: false, opId: 'other-floor-door' });
  assert.equal(otherFloor?.ok, false); assert.equal(otherFloor.why, 'far');
  ecs.y[owner] = original.y;

  ecs.dead[owner] = 1;
  const dead = request(server, messages, owner, source, liveDoor,
    { open: true, expectedOpen: false, opId: 'dead-door' });
  assert.equal(dead?.ok, false); assert.equal(dead.why, 'condition');
  ecs.dead[owner] = 0;

  source.condition = { ...source.condition, entries: source.condition.entries.map((entry) => entry.id === liveDoor.id
    ? { ...entry, hp: 0 } : entry) };
  const destroyed = request(server, messages, owner, source, liveDoor,
    { open: true, expectedOpen: false, opId: 'destroyed-door' });
  assert.equal(destroyed?.ok, false); assert.equal(destroyed.why, 'condition');
  assert.deepEqual(source.ship.openDoors || [], []);
});

test('save-size refusal leaves owner profile, open state, and collision geometry unchanged', () => {
  const { server, messages, owner, guest, source, liveDoor } = setup();
  positionNear(server, owner, source); positionNear(server, guest, source);
  const profileBefore = copy(server.world.profiles.get(owner));
  const publicBefore = copy(publicRafts(server.world).find((record) => record.id === source.ship.id));
  const blockedBefore = server.world.raftDeck.blocked(
    doorPoint(publicBefore, liveDoor.part).x, doorPoint(publicBefore, liveDoor.part).z,
    doorPoint(publicBefore, liveDoor.part).y, server.world.ecs.radius[guest]);
  server.saves.store = () => 'x'.repeat(131073);
  const refused = request(server, messages, guest, source, liveDoor,
    { open: true, expectedOpen: false, opId: 'too-large-save' });
  assert.equal(refused?.ok, false); assert.equal(refused.why, 'saveSize');
  assert.deepEqual(server.world.profiles.get(owner), profileBefore);
  assert.deepEqual(publicRafts(server.world).find((record) => record.id === source.ship.id), publicBefore);
  assert.equal(server.world.raftDeck.blocked(
    doorPoint(publicBefore, liveDoor.part).x, doorPoint(publicBefore, liveDoor.part).z,
    doorPoint(publicBefore, liveDoor.part).y, server.world.ecs.radius[guest]), blockedBefore);
});

test('guest door use persists through the owner save, profile sanitization, and reentry', () => {
  const saves = hmacSaves('raft-door-reentry-key'), { server, messages, owner, guest, source, liveDoor } = setup({ saves });
  positionNear(server, guest, source);
  const result = request(server, messages, guest, source, liveDoor,
    { open: true, expectedOpen: false, opId: 'guest-durable-open' });
  assert.equal(result?.ok, true);
  const ownerSave = (messages.get(1) || []).slice().reverse().find((message) => message.t === MSG.SAVE)?.blob;
  assert.ok(ownerSave, 'guest interaction writes the owning player save');
  const decoded = saves.load(ownerSave);
  assert.deepEqual(decoded.eco.ships[0].openDoors, [liveDoor.id]);
  assert.deepEqual(sanitizeProfile(decoded).eco.ships[0].openDoors, [liveDoor.id]);

  server.disconnect(1);
  server.connect(3);
  server.receive(3, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Door return', skin: 0, weapon: 0, save: ownerSave });
  const returned = server.clients.get(3).entity;
  const returnedShip = server.world.profiles.get(returned).eco.ships[0];
  const returnedSource = server.world.rafts.get(returnedShip.id);
  assert.deepEqual(returnedShip.openDoors, [liveDoor.id]);
  assert.ok(publicRafts(server.world).find((record) => record.id === returnedShip.id).openDoors.some((part) =>
    JSON.stringify(part) === JSON.stringify(liveDoor.part)));
  assert.equal(returnedSource.ship.rev, source.ship.rev, 'door state preserves the ship blueprint revision');
});

test('accepted no-op door intents retain their identity and non-string operation IDs cannot mutate state', () => {
  const { server, messages, owner, source, liveDoor } = setup();
  positionNear(server, owner, source);
  const intent = { open: false, expectedOpen: false, opId: 'already-closed' };
  const first = request(server, messages, owner, source, liveDoor, intent);
  assert.equal(first.ok, true); assert.equal(first.changed, false);
  const retry = request(server, messages, owner, source, liveDoor, intent);
  assert.equal(retry.replay, true); assert.equal(retry.changed, false);
  const reused = request(server, messages, owner, source, liveDoor, { ...intent, open: true });
  assert.equal(reused.ok, false); assert.equal(reused.why, 'duplicate');
  const profileBefore = copy(server.world.profiles.get(owner));
  request(server, messages, owner, source, liveDoor, { open: true, expectedOpen: false, opId: 123 });
  const bad = latestDoor(messages, 1);
  assert.equal(bad?.ok, false); assert.equal(bad.why, 'command'); assert.equal(bad.opId, '');
  assert.deepEqual(server.world.profiles.get(owner), profileBefore);
});

test('paused and tick-blocked sessions cannot operate doors; disconnect retires session receipts', () => {
  const { server, messages, owner, guest, source, liveDoor } = setup();
  positionNear(server, guest, source);
  const before = copy(server.world.profiles.get(owner)), client = server.clients.get(2);
  client.paused = true;
  request(server, messages, guest, source, liveDoor, { open: true, expectedOpen: false, opId: 'paused-open' });
  client.paused = false; server.tickBlocked = true;
  request(server, messages, guest, source, liveDoor, { open: true, expectedOpen: false, opId: 'blocked-open' });
  assert.equal(latestDoor(messages, 2), null);
  assert.deepEqual(server.world.profiles.get(owner), before);
  assert.equal(server.world.raftDoorReceipts?.has(guest) || false, false);
  server.tickBlocked = false;
  const accepted = request(server, messages, guest, source, liveDoor, { open: true, expectedOpen: false, opId: 'normal-open' });
  assert.equal(accepted.ok, true); assert.equal(server.world.raftDoorReceipts.has(guest), true);
  server.disconnect(2);
  assert.equal(server.world.raftDoorReceipts.has(guest), false, 'a reused entity slot cannot inherit door receipts');
});
