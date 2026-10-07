import test from 'node:test';
import assert from 'node:assert/strict';
import { GameClient } from '../src/client/gameClient.js';
import { LocalServer } from '../src/net/localServer.js';
import { NavalPilotServer } from '../src/net/navalPilotServer.js';
import { MSG } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { publicRafts } from '../src/sim/systems/rafts.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const close = (a, b, label, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps,
  `${label}: expected ${b}, got ${a}`);

class QueuedTransport {
  constructor(server, id, inbox) {
    this.server = server; this.id = id; this.inbox = inbox; this.snapCbs = []; this.msgCbs = []; this.inputQueue = [];
  }
  onSnapshot(cb) { this.snapCbs.push(cb); }
  onMessage(cb) { this.msgCbs.push(cb); }
  send(message) { this.server.receive(this.id, copy(message)); }
  sendInput(_seq, command) { this.inputQueue.push(copy(command)); }
  flush() {
    if (!this.inputQueue.length) return;
    this.server.receive(this.id, { t: MSG.INPUTS, cmds: this.inputQueue });
    this.inputQueue = [];
  }
  start() {}
  deliver({ snapshots = true, messages = true } = {}) {
    const pending = this.inbox.get(this.id) || [];
    const keep = [];
    for (const message of pending) {
      if (message.t === MSG.SNAPSHOT) {
        if (!snapshots) { keep.push(message); continue; }
        for (const cb of this.snapCbs) cb(message);
      } else {
        if (!messages) { keep.push(message); continue; }
        for (const cb of this.msgCbs) cb(message);
      }
    }
    this.inbox.set(this.id, keep);
  }
  takeSnapshots() {
    const pending = this.inbox.get(this.id) || [], selected = pending.filter((m) => m.t === MSG.SNAPSHOT);
    this.inbox.set(this.id, pending.filter((m) => m.t !== MSG.SNAPSHOT));
    return selected;
  }
  deliverOne(message) {
    for (const cb of this.snapCbs) cb(message);
  }
}

function harness({ count = 1, serverFactory = (options) => new NavalPilotServer(options) } = {}) {
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
    client.start();
    client.join(`Pirata ${id}`, 0, 0);
    transport.deliver();
    transports.set(id, transport); clients.set(id, client);
  }
  server.broadcastSnapshot();
  for (const transport of transports.values()) transport.deliver();
  return { server, clients, transports };
}

function placeOnDeck(server, owner, shipId) {
  const w = server.world, ecs = w.ecs, records = publicRafts(w);
  w.raftDeck.update(records);
  const raft = records.find((record) => record.id === shipId);
  assert.ok(raft, `owner raft ${shipId} exists`);
  for (let x = raft.x - 24; x <= raft.x + 24; x += 0.5) {
    for (let z = raft.z - 24; z <= raft.z + 24; z += 0.5) {
      for (let y = raft.y - 1; y <= raft.y + 8; y += 0.5) {
        const surface = w.raftDeck.surface(x, z, y);
        if (surface?.id !== shipId || surface.kind !== 'deck') continue;
        ecs.x[owner] = x; ecs.y[owner] = surface.y; ecs.z[owner] = z;
        ecs.vx[owner] = ecs.vz[owner] = 0;
        return { x, y: surface.y, z, facing: ecs.facing[owner] };
      }
    }
  }
  assert.fail(`no traversable deck tile found for ${shipId}`);
}

function raftFor(server, owner) { return publicRafts(server.world).find((record) => record.owner === owner); }
function pilotPosition(server, owner) {
  const ecs = server.world.ecs;
  return { x: ecs.x[owner], y: ecs.y[owner], z: ecs.z[owner], f: ecs.facing[owner] };
}
function owner(client) { return client.youServer; }
function flushSnapshot(server, transports) {
  server.broadcastSnapshot();
  for (const transport of transports.values()) transport.deliver();
}

test('mount is session-bound; forged owner fields cannot control another session and pilot ACK advances on tick', () => {
  const h = harness({ count: 2 }), { server, clients, transports } = h;
  const a = clients.get(1), b = clients.get(2), ea = owner(a), eb = owner(b);
  const raftA = raftFor(server, ea), raftB = raftFor(server, eb);
  placeOnDeck(server, ea, raftA.id);
  a.mountNaval(raftA.id);
  const mounted = server.world.navalPilot.snapshot(ea);
  assert.equal(mounted.active, true);
  assert.equal(server.world.navalPilot.snapshot(eb).active, false);

  const beforeA = mounted.body.pose, beforeB = raftFor(server, eb);
  server.receive(2, { t: MSG.SHIP_INPUT, owner: ea, epoch: mounted.epoch, seq: 1, throttle: 1, brake: 0, steer: 0 });
  assert.equal(server.world.navalPilot.snapshot(ea).ack, 0, 'another session cannot steer the named owner');
  assert.deepEqual(server.world.navalPilot.snapshot(eb), { epoch: 0, active: false });

  // The authenticated owner may include a forged target field; the adapter ignores it and binds the input to ea.
  server.receive(1, { t: MSG.SHIP_INPUT, owner: eb, epoch: mounted.epoch, seq: 1, throttle: 1, brake: 0, steer: 0 });
  server.receive(1, { t: MSG.SHIP_INPUT, owner: eb, epoch: mounted.epoch, seq: 2, throttle: 1, brake: 0, steer: 0.2 });
  assert.equal(server.world.navalPilot.snapshot(ea).ack, 0, 'axes are received but not yet acknowledged');
  assert.equal(server.world.navalPilot.snapshot(eb).ack, undefined);
  server.step();
  const afterA = server.world.navalPilot.snapshot(ea);
  assert.equal(afterA.ack, 2, 'latest coalesced input is acknowledged when the fixed tick applies it');
  assert.ok(afterA.body.pose.x !== beforeA.x || afterA.body.pose.z !== beforeA.z || afterA.body.pose.yaw !== beforeA.yaw);
  assert.deepEqual(raftFor(server, eb), beforeB, 'the forged target raft remains untouched');

  flushSnapshot(server, transports);
  assert.equal(a.naval.ack, 2);
});

test('pilot prediction keeps player and deck on the same anchor across a land-input replay and snapshot correction', () => {
  const { server, clients, transports } = harness();
  const client = clients.get(1), transport = transports.get(1), e = owner(client);
  const raft = raftFor(server, e), standing = placeOnDeck(server, e, raft.id);
  server.broadcastSnapshot(); transport.deliver();

  // Park one ordinary client command before mounting. The server later consumes it while mounted;
  // reconciliation must clear it and restore the pilot's attached point after replay.
  client.tickInput({ mx: 0, mz: 1, ax: standing.x, az: standing.z + 4, btn: 0, prs: 0, w: 0 });
  client.mountNaval(raft.id);
  const mounted = server.world.navalPilot.snapshot(e);
  assert.equal(mounted.active, true);
  transport.flush();
  server.step();
  server.broadcastSnapshot(); transport.deliver();
  assert.equal(client.naval.active, true);
  assert.equal(client.pending.length, 0, 'land commands are retired on mount reconciliation');
  assert.equal(client.naval.ack, 0, 'ordinary movement ACK remains separate from the pilot ACK');

  const local = {};
  client.tickNaval({ throttle: 0.9, brake: 0, steer: 0.25 });
  client.localState(1, local);
  const predictedRaft = client.renderRafts().find((r) => r.id === raft.id);
  const attached = pilotPoint(predictedRaft, predictedRaft.pilot.anchor);
  for (const key of ['x', 'y', 'z', 'f']) close(local[key], attached[key], `predicted local ${key}`);
  close(client.pred.raftDeck.surface(local.x, local.z, local.y)?.y, local.y, 'predicted deck supports pilot');

  server.step();
  const authoritative = server.world.navalPilot.snapshot(e);
  server.broadcastSnapshot(); transport.deliver();
  assert.equal(client.naval.ack, authoritative.ack);
  client.localState(1, local);
  const reconciledRaft = client.renderRafts().find((r) => r.id === raft.id);
  const reconciledPoint = pilotPoint(reconciledRaft, reconciledRaft.pilot.anchor);
  for (const key of ['x', 'y', 'z', 'f']) close(local[key], reconciledPoint[key], `reconciled local ${key}`);
});

test('delayed old snapshots and old mount epochs cannot reattach the client', () => {
  const { server, clients, transports } = harness();
  const client = clients.get(1), transport = transports.get(1), e = owner(client);
  const raft = raftFor(server, e);
  placeOnDeck(server, e, raft.id);
  client.mountNaval(raft.id);
  server.broadcastSnapshot();
  const first = transport.takeSnapshots().at(-1);
  assert.equal(first.naval.active, true);
  transport.deliverOne(first);
  const epoch1 = first.naval.epoch;

  client.leaveNaval();
  server.broadcastSnapshot(); transport.deliver();
  assert.equal(client.naval.active, false);
  assert.equal(server.world.navalPilot.snapshot(e).active, false);

  placeOnDeck(server, e, raft.id);
  client.mountNaval(raft.id);
  server.broadcastSnapshot();
  const current = transport.takeSnapshots();
  const latestMountSnapshot = current.at(-1);
  transport.deliverOne(latestMountSnapshot);
  assert.ok(latestMountSnapshot.naval.epoch > epoch1);
  assert.equal(client.naval.epoch, latestMountSnapshot.naval.epoch);
  assert.equal(client.naval.active, true);

  server.broadcastSnapshot();
  const latest = transport.takeSnapshots().at(-1);
  transport.deliverOne(latest);
  assert.equal(latest.naval.epoch, latestMountSnapshot.naval.epoch);
  assert.equal(client.naval.epoch, latest.naval.epoch);
  assert.equal(client.naval.active, true);

  const older = copy(first);
  transport.deliverOne(older);
  assert.equal(client.naval.epoch, latest.naval.epoch, 'globally stale delivery does not roll back the mount');
  assert.equal(client.naval.active, true);

  // Make an old-epoch packet appear newer in global time so the naval epoch fence is exercised directly.
  const staleEpoch = copy(latest);
  staleEpoch.tick += 1;
  staleEpoch.naval = copy(first.naval);
  staleEpoch.naval.body.state.tick = staleEpoch.tick;
  transport.deliverOne(staleEpoch);
  assert.equal(client.naval.epoch, latest.naval.epoch);
  assert.equal(client.naval.active, true);
  assert.equal(client.lastSnapshotTick, latest.tick, 'rejected naval packet does not advance snapshot cursor');
});

test('two clients receive the same moving raft and remote pilot view remains attached', () => {
  const { server, clients, transports } = harness({ count: 2 });
  const a = clients.get(1), b = clients.get(2), ea = owner(a), eb = owner(b);
  const raftA = raftFor(server, ea);
  placeOnDeck(server, ea, raftA.id);
  server.broadcastSnapshot();
  for (const transport of transports.values()) transport.deliver();
  a.mountNaval(raftA.id);
  let state = server.world.navalPilot.snapshot(ea);
  server.receive(1, { t: MSG.SHIP_INPUT, epoch: state.epoch, seq: 1, throttle: 1, brake: 0, steer: 0.3 });
  server.step();
  server.broadcastSnapshot();
  for (const transport of transports.values()) transport.deliver();

  state = server.world.navalPilot.snapshot(ea);
  server.receive(1, { t: MSG.SHIP_INPUT, epoch: state.epoch, seq: 2, throttle: 1, brake: 0, steer: 0.3 });
  server.step();
  server.broadcastSnapshot();
  for (const transport of transports.values()) transport.deliver();

  const ra = a.renderRafts().find((r) => r.id === raftA.id);
  const rb = b.renderRafts().find((r) => r.id === raftA.id);
  assert.ok(ra?.pilot && rb?.pilot, 'both clients see public pilot metadata');
  for (const key of ['x', 'y', 'z', 'yaw']) close(ra[key], rb[key], `shared raft ${key}`);
  assert.ok(ra.parts.length > 0 && rb.parts.length > 0);

  b.update(0, 0);
  const remote = b.entities.get(ea);
  assert.ok(remote?.ready, 'remote pilot entity has snapshot samples');
  const expected = pilotPoint(rb, rb.pilot.anchor);
  for (const key of ['x', 'y', 'z', 'f']) close(remote.r[key], expected[key], `remote pilot ${key}`);
  assert.ok(server.world.ecs.alive[eb], 'the observing client remains an ordinary player');
});

test('leave, disconnect and default-off LocalServer preserve the saved mooring and close transient bodies', () => {
  const { server, clients, transports } = harness();
  const client = clients.get(1), e = owner(client), raft = raftFor(server, e);
  placeOnDeck(server, e, raft.id);
  const ship = server.world.rafts.get(raft.id).ship, sourceBytes = JSON.stringify(ship);
  client.mountNaval(raft.id);
  server.step();
  server.broadcastSnapshot(); transports.get(1).deliver();
  assert.equal(server.world.navalTrial.size, 1);

  client.leaveNaval();
  assert.equal(server.world.navalTrial.size, 0);
  assert.equal(server.world.navalPilot.snapshot(e).active, false);
  assert.equal(JSON.stringify(ship), sourceBytes, 'the saved ship definition stays unchanged');
  assert.equal(publicRafts(server.world).find((r) => r.id === raft.id).pilot, undefined);
  assert.deepEqual({ x: server.world.ecs.x[server.world.rafts.get(raft.id).entity],
    y: server.world.ecs.y[server.world.rafts.get(raft.id).entity], z: server.world.ecs.z[server.world.rafts.get(raft.id).entity] },
  { x: raft.x, y: raft.y, z: raft.z }, 'source entity remains at its original berth');

  placeOnDeck(server, e, raft.id);
  client.mountNaval(raft.id);
  assert.equal(server.world.navalTrial.size, 1);
  server.disconnect(1);
  assert.equal(server.world.navalTrial.size, 0, 'disconnect removes the transient body');
  assert.equal(server.world.navalPilot.size, 0);
  assert.equal(JSON.stringify(ship), sourceBytes);

  const ordinary = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, send() {} });
  assert.equal(ordinary.world.navalPilot, null);
  assert.equal(ordinary.world.navalTrial, null);
});

test('private command gate denies mount and fatal World-step faults fence the dedicated harness without retry', () => {
  const denied = harness({ serverFactory: (options) => new NavalPilotServer({ ...options, commandAccess: () => false }) });
  const client = denied.clients.get(1), e = owner(client), raft = raftFor(denied.server, e);
  placeOnDeck(denied.server, e, raft.id);
  client.mountNaval(raft.id);
  assert.equal(denied.server.world.navalPilot.has(e), false);
  assert.equal(denied.server.world.navalTrial.size, 0);
  assert.equal(client.naval.active, false);

  const broken = harness();
  const server = broken.server, originalTick = server.world.tick;
  server.world.navalTrial.step = () => { throw new Error('injected bounded trial failure'); };
  assert.throws(() => server.step(), /injected bounded trial failure/);
  assert.ok(server.navalFault instanceof Error);
  assert.equal(server.tickAllowed(), false);
  assert.equal(server.step(), false, 'fenced harness does not retry a partially consumed pump tick');
  assert.equal(server.world.tick, originalTick);
  assert.equal(server.timer, null);
});

test('held M5 ticks publish cached pilot heartbeats without source checks or player movement', () => {
  let admitted = true;
  const { server, clients, transports } = harness({ serverFactory: (options) =>
    new NavalPilotServer({ ...options, beforeTick: () => admitted }) });
  const client = clients.get(1), transport = transports.get(1), e = owner(client), raft = raftFor(server, e);
  placeOnDeck(server, e, raft.id);
  client.mountNaval(raft.id);
  server.step(); server.broadcastSnapshot(); transport.deliver();
  const cached = copy(server.world.navalPilot.snapshot(e)), standing = pilotPosition(server, e);
  // A source change will invalidate this private copy, but only in an admitted World tick.
  server.world.rafts.get(raft.id).ship.rev++;
  admitted = false;
  assert.equal(server.step(), false);
  server.broadcastSnapshot(); transport.deliver();
  server.broadcastSnapshot(); transport.deliver();
  assert.deepEqual(server.world.navalPilot.snapshot(e), cached);
  assert.deepEqual(pilotPosition(server, e), standing);
  assert.equal(server.world.navalPilot.size, 1);
  assert.equal(client.naval.active, true);
  admitted = true;
  server.step(); server.broadcastSnapshot(); transport.deliver();
  assert.equal(server.world.navalPilot.size, 0);
  assert.equal(client.naval.active, false);
  assert.equal(server.world.navalTrial.size, 0);
});

test('unchanged naval heartbeat still installs same-tick public changes from another owner', () => {
  const { server, clients, transports } = harness({ count: 2 });
  const client = clients.get(1), e = owner(client), raft = raftFor(server, e);
  placeOnDeck(server, e, raft.id);
  client.mountNaval(raft.id);
  server.broadcastSnapshot(); transports.get(1).deliver();
  const before = client.naval.body, state = copy(server.world.navalPilot.snapshot(e));
  const other = raftFor(server, owner(clients.get(2)));
  server.world.rafts.get(other.id).ship.n = 'Otro plano confirmado en este tick';
  server.broadcastSnapshot(); transports.get(1).deliver();
  assert.equal(client.naval.body, before, 'duplicate body leaves unacknowledged prediction untouched');
  assert.deepEqual(server.world.navalPilot.snapshot(e), state);
  assert.equal(client.pred.rafts.find((r) => r.id === other.id).name, 'Otro plano confirmado en este tick');
});
