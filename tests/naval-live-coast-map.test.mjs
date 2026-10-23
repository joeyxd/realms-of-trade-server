import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';

const copy = (value) => structuredClone(value);

function liveFixture() {
  const messages = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send(_id, message) { messages.push(copy(message)); } });
  server.connect(1);
  const snapshots = [], events = [];
  const transport = {
    onMessage(callback) { events.push(callback); },
    onSnapshot(callback) { snapshots.push(callback); },
    start() {},
    send(message) { server.receive(1, copy(message)); },
    sendInput(_seq, command) { server.receive(1, { t: MSG.INPUTS, cmds: [copy(command)] }); },
    flush() {},
    deliver() {
      for (const message of messages.splice(0))
        for (const callback of message.t === MSG.SNAPSHOT ? snapshots : events) callback(message);
    },
  };
  const client = new GameClient(transport, server.world.map, { emit() {} });
  client.join('Navegante', 0); transport.deliver();
  const publish = () => { server.broadcastSnapshot(); transport.deliver(); };
  publish();
  const owner = client.youServer;
  const raft = publicRafts(server.world).find((row) => row.owner === owner);
  const helm = pilotPoint(raft, raft.helm), ecs = server.world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z; ecs.facing[owner] = helm.f;
  publish();
  return { server, client, owner, raft, publish };
}

function wrap(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

test('GAME.seed raft sails from dock to real walkable coast, lands, parks, and reboards', (t) => {
  const f = liveFixture(), { server, client, owner, raft, publish } = f, world = server.world;
  t.after(() => server.disconnect(1));
  assert.equal(world.map.seed, GAME.seed);
  const source = world.rafts.get(raft.id).ship, savedShip = copy(source);
  const mapGroundAt = world.map.groundAt, mapOnDock = world.map.onDock;

  client.mountNaval(raft.id); publish();
  assert.ok(client.naval.active && client.voyage.active);
  const epoch = client.naval.epoch;
  const target = { x: 104, z: 113 };
  assert.ok(mapGroundAt.call(world.map, target.x, target.z) < 0.15, 'the route starts toward actual water beside the seed coast');
  let reached = false;
  for (let tick = 0; tick < 720; tick++) {
    const pose = client.naval.body.pose;
    const distance = Math.hypot(target.x - pose.x, target.z - pose.z);
    const heading = Math.atan2(target.x - pose.x, target.z - pose.z);
    const steer = Math.max(-1, Math.min(1, 2 * wrap(heading - pose.yaw)));
    const throttle = distance > 7 ? 1 : 0;
    const brake = distance > 7 ? 0 : 1;
    assert.ok(client.tickNaval({ throttle, brake, steer }), 'the fixed-tick helm accepts the route input');
    server.step(); publish();
    if (client.voyage.canLand && Math.hypot(client.naval.body.state.vx, client.naval.body.state.vz) <= 0.8) {
      reached = true; break;
    }
  }

  assert.ok(reached, 'the raft leaves the berth, brakes, and reaches real land within the bounded route');
  assert.ok(client.voyage.visited);
  assert.ok(client.voyage.distanceHome >= 20);
  const landing = client.voyage.landing;
  assert.ok(landing && mapGroundAt.call(world.map, landing.x, landing.z) >= 0.2);
  assert.equal(mapOnDock.call(world.map, landing.x, landing.z), false);
  assert.equal(world.map.groundAt, mapGroundAt, 'the real map ground query remains installed');
  assert.equal(world.map.onDock, mapOnDock, 'the real dock geometry remains installed');
  assert.ok(Math.hypot(landing.x - target.x, landing.z - target.z) < 8);

  client.send({ t: MSG.CMD, type: 'navalPilot', op: 'land', epoch }); publish();
  assert.equal(client.voyage.phase, 'shore');
  assert.equal(client.naval.active, false);
  const parked = publicRafts(world).find((row) => row.id === raft.id);
  for (let tick = 0; tick < 60; tick++) { server.step(); publish(); }
  const still = publicRafts(world).find((row) => row.id === raft.id);
  assert.deepEqual([still.x, still.y, still.z, still.yaw], [parked.x, parked.y, parked.z, parked.yaw]);

  client.send({ t: MSG.CMD, type: 'navalPilot', op: 'reboard', shipId: raft.id }); publish();
  assert.ok(client.naval.active);
  assert.notEqual(client.naval.epoch, epoch);
  assert.deepEqual({ ...source, voyage: null }, savedShip, 'the real voyage saves position while conserving blueprint and cargo');
});
