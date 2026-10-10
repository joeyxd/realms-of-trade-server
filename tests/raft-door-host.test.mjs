import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { hmacSaves } from '../server/saves.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { doorPoint } from '../src/sim/naval/shelter.js';

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORLD = 'raft-door-host-test';
const DOOR = ['door', 0, 0, 0, 0];
const copy = (value) => structuredClone(value);

class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.emit('close'); }
  ping() {}
}

function connect(host, name) {
  const ws = new Socket();
  host.onConnection(ws, { headers: {}, socket: { remoteAddress: 'test' } });
  const id = host.nextId - 1;
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name })), false);
  const of = (type) => ws.messages.filter((message) => message.t === type);
  return { id, ws, of };
}

function profile(account, withDoor = false) {
  const value = newProfile();
  value.pirateId = `account:${account}`;
  const raft = value.eco.ships.find((ship) => ship.kind === 'raft');
  if (withDoor) raft.grid.parts.push([...DOOR]);
  return value;
}

function makeHost(store) {
  return new GameHost({ seed: 82, bots: 0, log: () => {}, store, saves: hmacSaves('raft-door-host-test'),
    resolvePlayer: async (_request, message) => message.name === 'Owner' ? OWNER : message.name === 'Guest' ? GUEST : null,
    initializeAccounts: true, worldId: WORLD });
}

async function openHost(t, store) {
  const h = makeHost(store);
  t.after(async () => {
    if (!h.closePromise) {
      try { await h.close(); } catch (error) { if (error.code !== 'flush') throw error; }
    }
  });
  await h.prepare();
  const owner = connect(h, 'Owner'), guest = connect(h, 'Guest');
  await Promise.all([...h.joins]);
  assert.equal(owner.of(MSG.WELCOME).length, 1);
  assert.equal(guest.of(MSG.WELCOME).length, 1);
  await h.profiles.flush();
  return { h, owner, guest, ownerEntity: h.server.clients.get(owner.id).entity,
    guestEntity: h.server.clients.get(guest.id).entity };
}

function doorTarget(h, guestEntity) {
  const raft = publicRafts(h.server.world).find((row) => row.owner !== guestEntity && row.partHealth?.some((p) => p.part[0] === 'door'));
  assert.ok(raft, 'owner account raft has its configured door');
  const point = doorPoint(raft, DOOR);
  // Stand on the deck beside the doorway, clear of the leaf's swing.
  const ecs = h.server.world.ecs;
  ecs.x[guestEntity] = point.x + Math.sin(raft.yaw) * 1.05;
  ecs.y[guestEntity] = point.y;
  ecs.z[guestEntity] = point.z + Math.cos(raft.yaw) * 1.05;
  return raft;
}

function command(raft, open, opId) {
  const door = raft.partHealth.find((part) => part.part[0] === 'door');
  return { t: 'cmd', type: 'raftDoor', id: raft.id, partId: door.id, expectedRev: raft.rev,
    expectedOpen: !open, open, opId };
}

test('guest door authorization is world-scoped to the owner and a denial leaves all raft state untouched', async (t) => {
  const store = { ...createMemoryStore(), durable: true };
  await store.initializeProfile(OWNER, profile(OWNER, true));
  await store.initializeProfile(GUEST, profile(GUEST));
  const { h, guest, ownerEntity, guestEntity } = await openHost(t, store);
  const raft = doorTarget(h, guestEntity);
  const world = h.server.world, guestConn = h.server.clients.get(guest.id);
  const beforeOwner = copy(world.profiles.get(ownerEntity)), beforeGuest = copy(world.profiles.get(guestEntity));
  const beforeRafts = copy(publicRafts(world)), beforeEvents = copy(world.events);
  const beforeDirty = [...world.profileDirty], beforeSaveAt = guestConn.saveAt;
  const beforeReceipts = world.raftDoorReceipts;
  let allowed = false;
  const access = h.server.commandAccess, calls = [];
  h.server.commandAccess = (...args) => { calls.push(args); return allowed && access(...args); };

  assert.equal(h.server.playerCommand(guestConn, command(raft, true, 'guest-denied')), false);
  assert.deepEqual(calls.map(([id, entity, plan]) => [id, entity, plan]), [
    [guest.id, guestEntity, { world: true, target: ownerEntity }],
  ]);
  assert.deepEqual(world.profiles.get(ownerEntity), beforeOwner);
  assert.deepEqual(world.profiles.get(guestEntity), beforeGuest);
  assert.deepEqual(publicRafts(world), beforeRafts);
  assert.deepEqual(world.events, beforeEvents);
  assert.deepEqual([...world.profileDirty], beforeDirty);
  assert.equal(guestConn.saveAt, beforeSaveAt);
  assert.equal(world.raftDoorReceipts, beforeReceipts, 'access denial does not allocate operation receipts');
  assert.deepEqual(raft.openDoors, []);

  allowed = true;
  assert.equal(h.server.playerCommand(guestConn, command(raft, true, 'guest-open')), true);
  h.server.flushEvents();
  await h.profiles.flush();
  const ownerShip = world.profiles.get(ownerEntity).eco.ships.find((ship) => ship.id === raft.id);
  const guestShip = world.profiles.get(guestEntity).eco.ships.find((ship) => ship.kind === 'raft');
  assert.deepEqual(ownerShip.openDoors, [raft.partHealth.find((part) => part.part[0] === 'door').id]);
  assert.equal(guestShip.openDoors, undefined, 'the guest profile never acquires the owner raft state');
  assert.equal(calls[1][2].world, true);
  assert.equal(calls[1][2].target, ownerEntity);

  const openAck = guest.ws.messages.flatMap((message) => message.ev ? [message.ev] : []).find((event) => event.type === 'raftDoor' && event.opId === 'guest-open');
  assert.equal(openAck?.ok, true);
  const savedOwner = await store.loadProfile(OWNER), savedGuest = await store.loadProfile(GUEST);
  const savedOwnerShip = savedOwner.data.eco.ships.find((ship) => ship.id === raft.id);
  const condition = copy(savedOwnerShip.condition);
  const doorId = savedOwnerShip.openDoors[0];
  assert.ok(condition.entries.some((entry) => entry[0] === doorId && entry[1] === 'door' && entry[6] > 0));
  assert.equal(savedGuest.data.eco.ships.find((ship) => ship.kind === 'raft').openDoors, undefined);

  await h.close();
  const again = await openHost(t, store);
  const reentered = publicRafts(again.h.server.world).find((row) => row.owner === again.ownerEntity);
  assert.deepEqual(reentered.openDoors, [DOOR]);
  assert.deepEqual(again.h.server.world.rafts.get(reentered.id).ship.openDoors, [doorId]);
  assert.deepEqual(again.h.server.world.rafts.get(reentered.id).ship.condition, condition,
    'reentry preserves the exact saved condition identity and HP entries');
});
