import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { givePearl } from '../src/sim/systems/pearls.js';
import { PEARL } from '../src/data/pearls.js';

function fixture() {
  const server = new LocalServer({ seed: 91, bots: 0, enemies: false, send() {} });
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Route' });
  const client = server.clients.get(1), world = server.world;
  const pearl = givePearl(world, client.entity, 'brasa');
  world.ecs.regenT[client.entity] = PEARL.calm + 1;
  world.ecs.dashT[client.entity] = -1;
  world.events.length = 0;
  return { server, client, world, pearl };
}

test('default pearl command still uses the existing immediate gameplay helper', () => {
  const { server, client, world, pearl } = fixture();
  assert.equal(server.onPearlCommand, null);
  assert.equal(server.playerCommand(client, { type: 'pearl', op: 'leave', uid: pearl.uid }), true);
  assert.equal(world.profiles.get(client.entity).pearls.bag.length, 0);
  assert.equal([...world.drops.values()].filter(d => d.pearl?.uid === pearl.uid).length, 1);
});

test('without the common mount, give retains the existing bag-only gameplay route', () => {
  const { server, client, world, pearl } = fixture();
  server.connect(2);
  server.receive(2, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Receiver' });
  const receiver = server.clients.get(2), ecs = world.ecs;
  ecs.x[receiver.entity] = ecs.x[client.entity]; ecs.z[receiver.entity] = ecs.z[client.entity];
  ecs.regenT[receiver.entity] = PEARL.calm + 1; ecs.dashT[receiver.entity] = -1;
  assert.equal(server.onPearlCommand, null);
  assert.equal(server.playerCommand(client, { type: 'pearl', op: 'give', uid: pearl.uid, target: receiver.entity }), true);
  assert.equal(world.profiles.get(client.entity).pearls.bag.length, 0);
  assert.equal(world.profiles.get(receiver.entity).pearls.bag.filter(q => q.uid === pearl.uid).length, 1);
});

test('without the common mount, swallow retains its bound-until-death gameplay rule', () => {
  const { server, client, world, pearl } = fixture();
  assert.equal(server.onPearlCommand, null);
  assert.equal(server.playerCommand(client, { type: 'pearl', op: 'swallow', uid: pearl.uid }), true);
  const before = structuredClone(world.profiles.get(client.entity));
  assert.equal(before.pearls.swallowed.uid, pearl.uid);
  server.playerCommand(client, { type: 'pearl', op: 'swallow', uid: pearl.uid, confirm: true });
  assert.equal(world.events.at(-1).why, 'bound');
  server.playerCommand(client, { type: 'pearl', op: 'spit' });
  assert.equal(world.events.at(-1).why, 'bound');
  assert.deepEqual(world.profiles.get(client.entity), before);
  assert.equal(world.drops.size, 0);
});

test('mounted false, true and async command decisions never fall through to a local pearl mutation', async () => {
  const { server, client, world, pearl } = fixture();
  const before = structuredClone(world.profiles.get(client.entity));
  const command = { t: MSG.CMD, type: 'pearl', op: 'leave', uid: pearl.uid };
  for (const decision of [false, true]) {
    server.onPearlCommand = (id, entity, raw) => {
      assert.equal(id, 1); assert.equal(entity, client.entity); assert.equal(raw, command);
      return decision;
    };
    assert.equal(server.playerCommand(client, command), decision);
  }
  server.onPearlCommand = async () => { throw new Error('late command'); };
  assert.throws(() => server.playerCommand(client, command), TypeError);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(world.profiles.get(client.entity), before);
  assert.equal(world.drops.size, 0);
  assert.equal(world.events.length, 0);
});

test('command access rejection precedes the receipted dispatch hook', () => {
  const { server, client, world, pearl } = fixture();
  let called = false;
  server.onPearlCommand = () => { called = true; return true; };
  server.commandAccess = () => false;
  assert.equal(server.playerCommand(client, { type: 'pearl', op: 'leave', uid: pearl.uid }), false);
  assert.equal(called, false);
  assert.equal(world.profiles.get(client.entity).pearls.bag.length, 1);
  assert.equal(world.drops.size, 0);
});
