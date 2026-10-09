import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { goodMass, goodVolume } from '../src/sim/economy/cargo.js';

const copy = (value) => structuredClone(value);

function fixture() {
  const messages = new Map();
  const server = new LocalServer({ seed: 71, bots: 0, enemies: false, dev: false,
    send(id, message) {
      const list = messages.get(id) || [];
      list.push(copy(message)); messages.set(id, list);
    } });
  return { server, messages };
}

function join(server, id, profile = newProfile()) {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Capacity ${id}`, skin: 0, weapon: 0, save: '' }, profile);
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity);
  return entity;
}

function standOnRaft(server, entity, record, x = 1, z = 1) {
  const ecs = server.world.ecs, c = Math.cos(ecs.facing[record.entity]), s = Math.sin(ecs.facing[record.entity]);
  ecs.x[entity] = ecs.x[record.entity] + c * x + s * z;
  ecs.z[entity] = ecs.z[record.entity] - s * x + c * z;
  ecs.y[entity] = ecs.y[record.entity];
  ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0; ecs.vx[entity] = ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1;
}

function snapshots(messages, id) {
  return messages.get(id).filter((m) => m.t === MSG.SNAPSHOT);
}
function latestSnapshot(messages, id) { return snapshots(messages, id).at(-1); }
function reply(messages, id, opId) {
  return messages.get(id).filter((m) => m.t === MSG.EVENT && m.ev?.opId === opId).at(-1)?.ev;
}
function command(server, id, type, fields) {
  server.receive(id, { t: MSG.CMD, type, ...fields });
  server.flushEvents();
}

test('LocalServer capacity is owner-private, detached, and refreshed by an authoritative cargo transfer', () => {
  const { server, messages } = fixture();
  const profileA = newProfile(), raftA = profileA.eco.ships.find((s) => s.kind === 'raft');
  raftA.hold.goods = { lona: 1 };
  profileA.eco.pack.goods = { piedra: 1 };
  const ownerA = join(server, 1, profileA), ownerB = join(server, 2, newProfile());
  const sourceA = server.world.rafts.get(raftA.id);
  standOnRaft(server, ownerA, sourceA);
  server.broadcastSnapshot();

  const snapA = latestSnapshot(messages, 1), snapB = latestSnapshot(messages, 2);
  assert.equal(snapA.capacity.mode, 'port');
  assert.equal(snapA.capacity.holdVolume, 2);
  assert.equal(snapA.capacity.packVolume, 2);
  assert.equal(snapA.capacity.holdMass, 1);
  assert.equal(snapA.capacity.packMass, 4);
  assert.equal(snapA.capacity.cargoMass, 5);
  assert.equal(snapB.capacity.holdMass, 0);
  assert.equal(snapB.capacity.packMass, 0, 'each connection receives its own capacity projection');
  assert.ok(!JSON.stringify(snapA.capacity).includes('lona'));
  assert.ok(!JSON.stringify(snapA.capacity).includes('piedra'));
  assert.ok(!JSON.stringify(snapB.rafts).includes('goods'), 'public raft rows never expose cargo identities or counts');
  assert.equal(reply(messages, 2, 'capacity-read'), undefined, 'owner-only commerce reads are not broadcast');

  snapA.capacity.holdMass = 999;
  server.broadcastSnapshot();
  assert.equal(latestSnapshot(messages, 1).capacity.holdMass, 1, 'a caller cannot mutate authority through a prior snapshot');

  command(server, 1, 'commerce', { op: 'cargo', id: raftA.id, opId: 'capacity-read' });
  const initialRead = reply(messages, 1, 'capacity-read');
  assert.ok(initialRead?.ok);
  assert.equal(initialRead.capacity.holdFree, 4);
  assert.equal(initialRead.capacity.packFree, 8);

  command(server, 1, 'commerce', { op: 'transfer', id: raftA.id, expectedRev: raftA.rev,
    g: 'piedra', n: 1, side: 'deposit', opId: 'capacity-deposit' });
  const transfer = reply(messages, 1, 'capacity-deposit');
  assert.ok(transfer?.ok);
  assert.equal(transfer.capacity.holdVolume, 4);
  assert.equal(transfer.capacity.holdFree, 2);
  assert.equal(transfer.capacity.packVolume, 0);
  assert.equal(transfer.capacity.holdMass, 5);
  assert.equal(transfer.capacity.packMass, 0);
  assert.equal(transfer.capacity.cargoMass, 5, 'transfer conserves total cargo mass');
  assert.equal(transfer.capacity.raftRev, raftA.rev);
  server.broadcastSnapshot();
  assert.deepEqual(latestSnapshot(messages, 1).capacity, transfer.capacity,
    'owner snapshot and commerce read agree after the accepted transfer');
  assert.equal(latestSnapshot(messages, 2).capacity.cargoMass, 0, 'another owner gets no measurements from A’s cargo');

  server.disconnect(1); server.disconnect(2);
});

test('sailing capacity agrees with the authoritative live rig for heavy cargo after mount', () => {
  const { server, messages } = fixture();
  const profile = newProfile(), ship = profile.eco.ships.find((s) => s.kind === 'raft');
  ship.hold.goods = { hierro: 1, lona: 1 };
  profile.eco.pack.goods = { piedra: 1 };
  const owner = join(server, 7, profile);
  const raft = server.world.rafts.get(ship.id);
  const projected = publicRafts(server.world).find((r) => r.id === ship.id);
  const helm = pilotPoint(projected, projected.helm);
  const ecs = server.world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z; ecs.facing[owner] = helm.f;
  ecs.regenT[owner] = 100; ecs.moveMag[owner] = 0; ecs.vx[owner] = ecs.vz[owner] = 0;
  ecs.dashT[owner] = -1;
  command(server, 7, 'navalPilot', { op: 'mount', shipId: ship.id });
  assert.ok(server.world.navalPilot.snapshot(owner).active, 'the owner can mount a conventionally loaded raft');
  const body = server.world.navalPilot.snapshot(owner).body;
  const cap = latestSnapshot(messages, 7).capacity;
  const expectedCargoMass = goodMass('hierro') + goodMass('lona') + goodMass('piedra');
  assert.equal(goodVolume('hierro'), 3);
  assert.equal(goodMass('hierro'), 6);
  assert.equal(expectedCargoMass, 11);
  assert.equal(body.operational.rig.cargoMass, expectedCargoMass + 3,
    'the authoritative sailing rig includes the reserved pilot ballast');
  assert.equal(cap.mode, 'sailing');
  assert.equal(cap.holdVolume, 5);
  assert.equal(cap.packVolume, 2);
  assert.equal(cap.holdMass, 7);
  assert.equal(cap.packMass, 4);
  assert.equal(cap.cargoMass, expectedCargoMass,
    'the owner cargo reading excludes crew ballast while using the live damaged rig');
  assert.equal(cap.crewMass, 3);
  assert.equal(cap.totalMass, body.operational.rig.mass);
  server.disconnect(7);
});

test('legacy cargo above safe carrying limit remains saved and visible but blocks a new departure', () => {
  const { server, messages } = fixture();
  const profile = newProfile(), ship = profile.eco.ships.find((s) => s.kind === 'raft');
  ship.hold.goods = { hierro: 10 };
  const owner = join(server, 9, profile);
  const raft = server.world.rafts.get(ship.id), projected = publicRafts(server.world).find((r) => r.id === ship.id);
  const helm = pilotPoint(projected, projected.helm), ecs = server.world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z; ecs.facing[owner] = helm.f;
  ecs.regenT[owner] = 100; ecs.moveMag[owner] = 0; ecs.vx[owner] = ecs.vz[owner] = 0; ecs.dashT[owner] = -1;
  const beforeGoods = copy(raft.ship.hold.goods);

  command(server, 9, 'navalPilot', { op: 'mount', shipId: ship.id });
  const mounted = server.world.navalPilot.snapshot(owner);
  assert.equal(mounted.active, false, 'a new departure is denied above the structural and safety limits');
  assert.deepEqual(raft.ship.hold.goods, beforeGoods, 'mount preserves the full legacy hold contents');
  const capacity = latestSnapshot(messages, 9).capacity;
  assert.equal(capacity.mode, 'port');
  assert.equal(capacity.holdVolume, goodVolume('hierro') * 10);
  assert.equal(capacity.holdMass, goodMass('hierro') * 10);
  assert.equal(capacity.status, 'overloaded');
  assert.ok(capacity.overMass > 0, 'overload is an authoritative reading that explains the departure block');
  assert.equal(server.world.navalTrial.size, 0, 'refusal does not create a trial body');
  assert.deepEqual(raft.ship.hold.goods, beforeGoods);
  server.disconnect(9);
});
