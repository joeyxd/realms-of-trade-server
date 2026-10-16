import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { stepRaftWork } from '../src/sim/systems/raftProduction.js';
import { raftCmd } from '../src/sim/systems/raftEditor.js';
import { commerceCmd } from '../src/sim/systems/commerce.js';

const copy = (v) => structuredClone(v);
function fixture(options = {}) {
  const messages = new Map();
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send(id, msg) { const list = messages.get(id) || []; list.push(copy(msg)); messages.set(id, list); }, ...options });
  const transports = new Map(), clients = new Map();
  for (const id of [1, 2]) {
    server.connect(id);
    const snaps = [], events = [];
    const transport = { onMessage: (cb) => events.push(cb), onSnapshot: (cb) => snaps.push(cb), start() {},
      send: (m) => server.receive(id, copy(m)), sendInput: (_seq, cmd) => server.receive(id, { t: MSG.INPUTS, cmds: [copy(cmd)] }), flush() {},
      deliver() { for (const m of messages.get(id) || []) for (const cb of m.t === MSG.SNAPSHOT ? snaps : events) cb(m); messages.set(id, []); } };
    const client = new GameClient(transport, server.world.map, { emit() {} });
    clients.set(id, client); transports.set(id, transport);
    client.join(`Marino ${id}`, 0); transport.deliver();
  }
  const publish = () => { server.broadcastSnapshot(); for (const t of transports.values()) t.deliver(); };
  publish();
  const owner = clients.get(1).youServer, raft = publicRafts(server.world).find((r) => r.owner === owner);
  const helm = pilotPoint(raft, raft.helm), ecs = server.world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z; ecs.facing[owner] = helm.f;
  publish();
  return { server, clients, transports, messages, owner, raft, publish };
}

test('ordinary game admits the fixed helm and an observer sees the same moving raft and pilot', () => {
  const f = fixture(), captain = f.clients.get(1), observer = f.clients.get(2), w = f.server.world;
  const ship = w.rafts.get(f.raft.id).ship, original = copy(ship);
  const stranger = observer.youServer;
  assert.equal(f.server.playerCommand(f.server.clients.get(2), { type: 'navalPilot', op: 'mount', shipId: f.raft.id }), false);
  assert.equal(w.navalPilot.has(stranger), false);
  captain.mountNaval(f.raft.id); f.publish();
  assert.ok(captain.naval.active && captain.voyage.active);
  for (let i = 0; i < 90; i++) {
    assert.ok(captain.tickNaval({ throttle: 1, brake: 0, steer: .25, capture: false }));
    f.server.step(); f.publish();
  }
  const authoritative = publicRafts(w).find((r) => r.id === f.raft.id);
  const watched = observer.pred.rafts.find((r) => r.id === f.raft.id);
  assert.ok(Math.hypot(authoritative.x - f.raft.x, authoritative.z - f.raft.z) > 1);
  assert.deepEqual(watched, authoritative);
  const point = pilotPoint(authoritative, authoritative.pilot.anchor);
  assert.ok(Math.hypot(w.ecs.x[f.owner] - point.x, w.ecs.z[f.owner] - point.z) < 1e-8);
  assert.deepEqual({ ...ship, voyage: null }, original, 'sailing only updates its recovery pose, conserving ship, cargo and berth');
  assert.deepEqual(ship.voyage.pose, [authoritative.x, authoritative.z, authoritative.yaw]);
  assert.equal(w.rafts.size, 2);
  f.server.disconnect(1); f.server.disconnect(2);
});

test('voyage owns its blueprint and cargo even through trusted economy helpers', () => {
  const f = fixture(), w = f.server.world, ship = w.rafts.get(f.raft.id).ship;
  ship.hold.goods.madera = 3;
  f.clients.get(1).mountNaval(f.raft.id); f.publish();
  assert.ok(f.clients.get(1).naval.body.operational.rig.cargoMass > 0, 'real hold goods add sailing mass');
  const profile = copy(w.profiles.get(f.owner)), rev = ship.rev;
  const edit = raftCmd(w, f.owner, { type: 'raft', op: 'place', opId: 'at-sea', id: ship.id,
    expectedRev: rev, piece: ['foundation', 2, 0, 0, 0] });
  const cargo = commerceCmd(w, f.owner, { type: 'commerce', op: 'transfer', opId: 'at-sea', id: ship.id,
    expectedRev: rev, g: 'madera', n: 1, side: 'withdraw' });
  assert.equal(edit.ok, false); assert.equal(cargo.ok, false);
  stepRaftWork(w, 5);
  assert.deepEqual(w.profiles.get(f.owner), profile);
  f.server.disconnect(1); f.server.disconnect(2);
});

test('storage holds reject new naval input and transitions without advancing ACK, pose or profile', () => {
  let allowed = true;
  const f = fixture({ tickAccess: () => allowed, commandAccess: () => allowed });
  const captain = f.clients.get(1), w = f.server.world;
  captain.mountNaval(f.raft.id); f.publish();
  const state = copy(w.navalPilot.snapshot(f.owner)), profile = copy(w.profiles.get(f.owner));
  allowed = false; assert.equal(f.server.step(), false);
  f.server.receive(1, { t: MSG.SHIP_INPUT, epoch: state.epoch, seq: 100, throttle: 1, brake: 0, steer: 1, capture: true });
  assert.equal(f.server.playerCommand(f.server.clients.get(1), { type: 'navalPilot', op: 'walk', epoch: state.epoch }), false);
  f.publish();
  assert.deepEqual(w.navalPilot.snapshot(f.owner), state);
  assert.deepEqual(w.profiles.get(f.owner), profile);
  allowed = true; f.server.step(); f.publish();
  assert.equal(w.navalPilot.snapshot(f.owner).ack, 0, 'held input was not buffered for later thrust');
  f.server.disconnect(1); f.server.disconnect(2);
});

test('pause cancels a queued helm command and reconnect restores one conserved ship at its berth', () => {
  const saved = new Map(), f = fixture({ onSave: (id, p) => saved.set(id, copy(p)) });
  const w = f.server.world, captain = f.clients.get(1);
  captain.mountNaval(f.raft.id); f.publish();
  const epoch = captain.naval.epoch;
  f.server.receive(1, { t: MSG.SHIP_INPUT, epoch, seq: 1, throttle: 1, brake: 0, steer: 1 });
  f.server.receive(1, { t: MSG.CMD, type: 'pause', on: true });
  f.server.step();
  assert.equal(w.navalPilot.snapshot(f.owner).ack, 0);
  const before = copy(w.profiles.get(f.owner).eco);
  f.server.disconnect(1);
  assert.equal(w.navalTrial.size, 0); assert.equal(w.navalPilot.size, 0);
  assert.deepEqual(saved.get(1).eco, before);
  f.server.connect(3);
  f.server.receive(3, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Vuelve', save: JSON.stringify(saved.get(1)) });
  const e = f.server.clients.get(3).entity, raft = publicRafts(w).find((r) => r.owner === e);
  assert.equal(raft.id, f.raft.id);
  assert.deepEqual([raft.x, raft.y, raft.z, raft.yaw], [f.raft.x, f.raft.y, f.raft.z, f.raft.yaw]);
  assert.equal(w.profiles.get(e).eco.ships.length, before.ships.length);
  f.server.disconnect(2); f.server.disconnect(3);
});

test('admitted voyage parks the same body ashore, resumes with a fresh epoch and conserves its cargo', () => {
  const f = fixture(), captain = f.clients.get(1), w = f.server.world;
  const ship = w.rafts.get(f.raft.id).ship, original = copy(ship);
  captain.mountNaval(f.raft.id); f.publish();
  const firstEpoch = captain.naval.epoch;
  for (let i = 0; i < 1500 && !captain.voyage.visited; i++) {
    assert.ok(captain.tickNaval({ throttle: 1, brake: 0, steer: 0 }));
    f.server.step(); f.publish();
  }
  assert.ok(captain.voyage.visited, 'real admitted thrust departs at least 20 m from the saved berth');
  for (let i = 0; i < 300 && Math.hypot(captain.naval.body.state.vx, captain.naval.body.state.vz) > .5; i++) {
    captain.tickNaval({ throttle: 0, brake: 1, steer: 0 }); f.server.step(); f.publish();
  }
  const raft = publicRafts(w).find(r => r.id === ship.id), shore = pilotPoint(raft, { x: 5, y: 0, z: 2, f: 0 });
  // A tiny walkable shoreline is the landing fixture; body motion/park/control/epochs use the real Trial.
  w.map.groundAt = (x, z) => Math.hypot(x - shore.x, z - shore.z) < 1.5 ? .6 : -2;
  w.map.onDock = () => false; w.map.queryColliders = () => []; w.map.colliders = [];
  f.publish(); assert.ok(captain.voyage.canLand);
  captain.send({ t: MSG.CMD, type: 'navalPilot', op: 'land', epoch: firstEpoch }); f.publish();
  assert.equal(captain.voyage.phase, 'shore'); assert.equal(captain.naval.active, false);
  const parked = copy(publicRafts(w).find(r => r.id === ship.id));
  for (let i = 0; i < 120; i++) { f.server.step(); f.publish(); }
  const still = publicRafts(w).find(r => r.id === ship.id);
  assert.deepEqual([still.x, still.y, still.z, still.yaw], [parked.x, parked.y, parked.z, parked.yaw]);
  assert.ok(w.navalPilot.locked(f.owner)); assert.deepEqual({ ...ship, voyage: null }, original);
  captain.send({ t: MSG.CMD, type: 'navalPilot', op: 'reboard', shipId: ship.id }); f.publish();
  assert.ok(captain.naval.active); assert.notEqual(captain.naval.epoch, firstEpoch);
  assert.equal(w.navalPilot.input(f.owner, { epoch: firstEpoch, seq: 99999, throttle: 1, brake: 0, steer: 0 }), false);
  assert.ok(captain.tickNaval({ throttle: 1, brake: 0, steer: 0 })); f.server.step(); f.publish();
  assert.ok(captain.naval.ack > 0, 'new epoch accepts its own restarted input sequence');
  assert.deepEqual({ ...ship, voyage: null }, original);
  f.server.disconnect(1); f.server.disconnect(2);
});
