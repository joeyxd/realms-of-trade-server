import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { hmacSaves } from '../server/saves.mjs';
import { publicRafts } from '../src/sim/systems/rafts.js';
import { pilotPoint } from '../src/sim/naval/pilotGeometry.js';
import { goodMass } from '../src/sim/economy/cargo.js';
import { RAFT_LOAD } from '../src/data/raftparts.js';

const copy = (value) => structuredClone(value);

function fixture({ seed = 71, ...options } = {}) {
  const messages = new Map();
  const server = new LocalServer({ seed, bots: 0, enemies: false, dev: false,
    send(id, message) {
      const list = messages.get(id) || [];
      list.push(copy(message)); messages.set(id, list);
    }, ...options });
  return { server, messages };
}

function join(server, id, save = '') {
  server.connect(id);
  server.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: `Resource ${id}`, skin: 0, weapon: 0, save });
  const entity = server.clients.get(id)?.entity;
  assert.ok(entity, 'the fresh or signed profile joins the real LocalServer');
  return entity;
}

function stand(server, entity, point) {
  const ecs = server.world.ecs;
  ecs.x[entity] = point.x; ecs.y[entity] = point.y; ecs.z[entity] = point.z;
  ecs.vx[entity] = ecs.vz[entity] = ecs.kbx[entity] = ecs.kbz[entity] = 0;
  ecs.moveMag[entity] = 0; ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.castK[entity] = ecs.castLock[entity] = ecs.atkStage[entity] = 0;
  ecs.regenT[entity] = 100; // A calm, stationary player fixture on the generated map.
}

function resourceMessage(server, messages, id, command) {
  server.receive(id, { t: MSG.CMD, type: 'resource', ...command });
  server.flushEvents();
  return [...(messages.get(id) || [])].reverse().find((m) => m.t === MSG.EVENT
    && m.ev?.type === 'resource' && m.ev.opId === command.opId)?.ev || null;
}

function latestSave(messages, id) {
  return [...(messages.get(id) || [])].reverse().find((m) => m.t === MSG.SAVE)?.blob || '';
}

test('resource snapshots expose the same public node catalogue without profile cargo or gold', () => {
  const f = fixture();
  const a = join(f.server, 1), b = join(f.server, 2);
  const pa = f.server.world.profiles.get(a), pb = f.server.world.profiles.get(b);
  pa.gold = 9876; pa.eco.pack.goods = { perlas: 2 };
  pb.gold = 1234; pb.eco.pack.goods = { hierro: 1 };
  f.server.broadcastSnapshot();
  const snap = (id) => [...f.messages.get(id)].reverse().find((m) => m.t === MSG.SNAPSHOT && m.resources);
  const resourcesA = snap(1).resources, resourcesB = snap(2).resources;
  assert.deepEqual(resourcesA, resourcesB, 'both clients receive the same seeded public node state');
  assert.ok(resourcesA.nodes.length > 0 && resourcesA.bench);
  for (const node of resourcesA.nodes) {
    const keys = ['id', 'kind', 'ready', 'rev', 'wait', 'x', 'y', 'z'];
    if (node.kind === 'palm') keys.push('hits', 'propIndex', 'remaining', 'rot', 'scale');
    if (node.kind === 'rock' || node.kind === 'iron_ore') keys.push('hits', 'remaining');
    assert.deepEqual(Object.keys(node).sort(), keys.sort());
    assert.equal(Object.hasOwn(node, 'goods'), false);
    assert.equal(Object.hasOwn(node, 'gold'), false);
  }
  assert.equal(Object.hasOwn(resourcesA, 'profile'), false);
  assert.equal(Object.hasOwn(resourcesA, 'gold'), false);
  assert.equal(Object.hasOwn(resourcesA, 'cargo'), false);
  f.server.disconnect(1); f.server.disconnect(2);
});

test('two players contesting one actual node get one gather and one revision denial', () => {
  const f = fixture(), owners = [join(f.server, 11), join(f.server, 12)];
  const node = [...f.server.world.resources.nodes.values()].find((n) => n.kind === 'wood');
  assert.ok(node, 'seed 71 supplies an actual generated wood node');
  owners.forEach((owner) => stand(f.server, owner, node));
  const first = resourceMessage(f.server, f.messages, 11,
    { op: 'gather', node: node.id, expectedRev: 1, opId: 'same-node-a' });
  const second = resourceMessage(f.server, f.messages, 12,
    { op: 'gather', node: node.id, expectedRev: 1, opId: 'same-node-b' });
  assert.equal(first?.ok, true);
  assert.equal(first.good, 'tronco');
  assert.equal(second?.ok, false);
  assert.equal(second.why, 'revision');
  assert.equal(f.server.world.profiles.get(owners[0]).eco.pack.goods.tronco, 1);
  assert.equal(f.server.world.profiles.get(owners[1]).eco.pack.goods.tronco, undefined);
  assert.equal(node.rev, 2);
  f.server.disconnect(11); f.server.disconnect(12);
});

test('command access denial leaves node, pack, cooldown, revision, and save schedule untouched', () => {
  let allowed = false;
  const f = fixture({ commandAccess: () => allowed }), owner = join(f.server, 21);
  const node = [...f.server.world.resources.nodes.values()].find((n) => n.kind === 'wood');
  stand(f.server, owner, node);
  const profile = f.server.world.profiles.get(owner), client = f.server.clients.get(21);
  const before = { node: copy(node), pack: copy(profile.eco.pack), tradeRev: profile.eco.tradeRev,
    cooldown: f.server.world.resources.cooldowns.get(owner), saveAt: client.saveAt };
  const denied = resourceMessage(f.server, f.messages, 21,
    { op: 'gather', node: node.id, expectedRev: node.rev, opId: 'access-denied' });
  assert.equal(denied, null, 'transport access denies before resource helper or receipt mutation');
  assert.deepEqual(node, before.node);
  assert.deepEqual(profile.eco.pack, before.pack);
  assert.equal(profile.eco.tradeRev, before.tradeRev);
  assert.equal(f.server.world.resources.cooldowns.get(owner), before.cooldown);
  assert.equal(client.saveAt, before.saveAt);
  allowed = true;
  const retry = resourceMessage(f.server, f.messages, 21,
    { op: 'gather', node: node.id, expectedRev: node.rev, opId: 'access-denied' });
  assert.equal(retry?.ok, true, 'the same operation can be retried after access returns');
  assert.equal(profile.eco.pack.goods.tronco, 1);
  f.server.disconnect(21);
});

test('gather, craft, and raft construction persist through a signed save and reload', () => {
  const saves = hmacSaves('resource-loop-server-test-only-secret');
  const initial = newProfile(); initial.gold = 246;
  const f = fixture({ saves }), owner = join(f.server, 31, saves.store(initial));
  const profile = f.server.world.profiles.get(owner);
  const node = [...f.server.world.resources.nodes.values()].find((n) => n.kind === 'wood');
  assert.ok(node);
  stand(f.server, owner, node);
  const gathered = resourceMessage(f.server, f.messages, 31,
    { op: 'gather', node: node.id, expectedRev: node.rev, opId: 'loop-gather' });
  assert.equal(gathered?.ok, true);
  assert.equal(profile.eco.pack.goods.tronco, 1);
  f.server.step();
  let blob = latestSave(f.messages, 31);
  assert.ok(blob && saves.load(blob)?.eco.pack.goods.tronco === 1,
    'a successful gather schedules an immediate signed profile save');

  for (let i = 0; i < 31; i++) f.server.step();
  stand(f.server, owner, f.server.world.resources.bench);
  const crafted = resourceMessage(f.server, f.messages, 31,
    { op: 'craft', recipe: 'madera', expectedRev: profile.eco.tradeRev, opId: 'loop-craft' });
  assert.equal(crafted?.ok, true);
  assert.equal(profile.eco.pack.goods.tronco, undefined);
  assert.equal(profile.eco.pack.goods.madera, 1);
  f.server.step();

  const source = [...f.server.world.rafts.values()].find((r) => r.owner === owner);
  const ship = source.ship, ecs = f.server.world.ecs, c = Math.cos(ecs.facing[source.entity]), s = Math.sin(ecs.facing[source.entity]);
  ecs.x[owner] = ecs.x[source.entity] + c + s; ecs.z[owner] = ecs.z[source.entity] - s + c;
  ecs.y[owner] = ecs.y[source.entity]; ecs.regenT[owner] = 100;
  const placed = { t: MSG.CMD, type: 'raft', op: 'place', id: ship.id, expectedRev: ship.rev,
    opId: 'loop-build', piece: ['railing', 0, 0, 0, 0] };
  f.server.receive(31, placed); f.server.flushEvents();
  const edit = [...f.messages.get(31)].reverse().find((m) => m.t === MSG.EVENT && m.ev?.type === 'raftEdit'
    && m.ev.opId === placed.opId)?.ev;
  assert.equal(edit?.ok, true, 'the real raft editor consumes the crafted wood');
  assert.ok(ship.grid.parts.some((part) => part[0] === 'railing'));
  assert.equal(profile.eco.pack.goods.madera, undefined);
  assert.equal(profile.gold, 246, 'resource gathering and construction do not spend gold');
  f.server.step(); blob = latestSave(f.messages, 31);
  const saved = saves.load(blob);
  assert.ok(saved, 'the final save is signed and valid');
  assert.equal(saved.gold, 246);
  assert.equal(saved.eco.pack.goods.madera, undefined);
  assert.ok(saved.eco.ships[0].grid.parts.some((part) => part[0] === 'railing'));

  f.server.disconnect(31);
  const reopened = fixture({ saves }), nextOwner = join(reopened.server, 32, blob);
  const restored = reopened.server.world.profiles.get(nextOwner);
  assert.equal(restored.gold, 246);
  assert.equal(restored.eco.pack.goods.madera, undefined);
  assert.ok(restored.eco.ships[0].grid.parts.some((part) => part[0] === 'railing'));
  reopened.server.disconnect(32);
});

test('parked coastal voyage permits real shore gathering, blocks crafting, then reboards with refreshed cargo mass', () => {
  const messages = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send(_id, message) { messages.push(copy(message)); } });
  server.connect(1);
  const snapshots = [], events = [];
  const transport = {
    onMessage(callback) { events.push(callback); }, onSnapshot(callback) { snapshots.push(callback); }, start() {},
    send(message) { server.receive(1, copy(message)); },
    sendInput(_seq, command) { server.receive(1, { t: MSG.INPUTS, cmds: [copy(command)] }); },
    flush() {},
    deliver() {
      for (const message of messages.splice(0))
        for (const callback of message.t === MSG.SNAPSHOT ? snapshots : events) callback(message);
    },
  };
  const client = new GameClient(transport, server.world.map, { emit() {} });
  client.join('Coastal gatherer', 0); transport.deliver();
  const publish = () => { server.broadcastSnapshot(); transport.deliver(); };
  publish();
  const owner = client.youServer, raft = publicRafts(server.world).find((row) => row.owner === owner);
  const source = server.world.rafts.get(raft.id);
  const helm = pilotPoint(raft, raft.helm), ecs = server.world.ecs;
  ecs.x[owner] = helm.x; ecs.y[owner] = helm.y; ecs.z[owner] = helm.z; ecs.facing[owner] = helm.f;
  publish();
  const map = server.world.map, originalGroundAt = map.groundAt, originalOnDock = map.onDock;
  assert.equal(map.seed, GAME.seed);
  client.mountNaval(raft.id); publish();
  const initialMass = client.naval.body;
  const epoch = client.naval.epoch;
  const target = { x: 104, z: 113 };
  assert.ok(originalGroundAt.call(map, target.x, target.z) < 0.15);
  let reached = false;
  for (let tick = 0; tick < 720; tick++) {
    const pose = client.naval.body.pose, distance = Math.hypot(target.x - pose.x, target.z - pose.z);
    const heading = Math.atan2(target.x - pose.x, target.z - pose.z);
    let delta = heading - pose.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    assert.ok(client.tickNaval({ throttle: distance > 7 ? 1 : 0, brake: distance > 7 ? 0 : 1,
      steer: Math.max(-1, Math.min(1, 2 * delta)) }));
    server.step(); publish();
    if (client.voyage.canLand && Math.hypot(client.naval.body.state.vx, client.naval.body.state.vz) <= 0.8) { reached = true; break; }
  }
  assert.ok(reached, 'the authoritative voyage reaches real seed coastline without changing map queries');
  client.send({ t: MSG.CMD, type: 'navalPilot', op: 'land', epoch }); publish();
  assert.equal(client.voyage.phase, 'shore');
  assert.equal(map.groundAt, originalGroundAt); assert.equal(map.onDock, originalOnDock);

  const node = client.resources.nodes.find((n) => n.kind === 'wood');
  assert.ok(node);
  stand(server, owner, node); // Actual generated node and terrain; fixture only places the idle player there.
  const gather = { t: MSG.CMD, type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev, opId: 'shore-gather' };
  client.send(gather); server.step(); publish();
  assert.equal(server.world.profiles.get(owner).eco.pack.goods.tronco, 1,
    'the shore player may gather while the same voyage remains parked');
  assert.equal(client.voyage.active, true);
  for (let i = 0; i < 31; i++) server.step();
  const bench = client.resources.bench;
  stand(server, owner, bench);
  const beforeCraft = copy(server.world.profiles.get(owner).eco.pack);
  client.send({ t: MSG.CMD, type: 'resource', op: 'craft', recipe: 'madera',
    expectedRev: server.world.profiles.get(owner).eco.tradeRev, opId: 'shore-craft-denied' });
  server.flushEvents();
  const denial = [...messages].reverse().find((m) => m.t === MSG.EVENT && m.ev?.type === 'resource'
    && m.ev.opId === 'shore-craft-denied')?.ev;
  assert.equal(denial?.ok, false); assert.equal(denial.why, 'busy');
  assert.deepEqual(server.world.profiles.get(owner).eco.pack, beforeCraft);

  stand(server, owner, client.voyage.landing);
  client.send({ t: MSG.CMD, type: 'navalPilot', op: 'reboard', shipId: raft.id }); publish();
  assert.ok(client.naval.active);
  const resumed = client.naval.body.operational.rig;
  assert.equal(resumed.cargoMass, goodMass('tronco') + RAFT_LOAD.crewMass,
    'the live body retains the owner pilot reserve as well as gathered cargo');
  assert.equal(server.world.rafts.get(raft.id).ship.hold.goods.madera, undefined);
  assert.equal(server.world.profiles.get(owner).eco.pack.goods.tronco, 1);
  assert.deepEqual(source.ship.hold.goods, {});
  assert.equal(initialMass.operational.rig.cargoMass, RAFT_LOAD.crewMass,
    'the initial sailing rig already contains the pilot reserve before any goods are carried');
  server.disconnect(1);
});
