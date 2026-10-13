import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mulberry32 } from '../../src/core/rng.js';
import { PEARL } from '../../src/data/pearls.js';
import { KIND } from '../../src/sim/ecs.js';
import { groundOperation } from '../../server/pearlGround.mjs';
import { fixture, joinPlayer, turn, deferred, injectStep, OWNER } from './ground-pearl-mint-host.mjs';

export { turn, deferred, OWNER };
export const RECEIVER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const THIRD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const selector = player => ({ clientId: player.clientId, entity: player.entity });
export const hasPearl = (world, player, uid) => !!world.profiles.get(player.entity)?.pearls.bag.some(q => q.uid === uid);

export function calm(world, ...players) {
  for (const { entity } of players) {
    world.ecs.regenT[entity] = PEARL.calm + 1; world.ecs.castK[entity] = 0;
    world.ecs.atkStage[entity] = 0; world.ecs.dashT[entity] = -1;
  }
}

export async function setup(t, options = {}) {
  const f = await fixture(t, { ...options, accounts: { receiver: RECEIVER, third: THIRD } });
  const host = f.host, source = await joinPlayer(host), world = host.server.world;
  const point = world.map.cala;
  world.ecs.x[source.entity] = point.x; world.ecs.z[source.entity] = point.z;
  const enemy = world.spawnEnemy('sentinel', point.x + 3, point.z);
  world.lootRng = mulberry32(5);
  injectStep(host, () => world.killEnemy(enemy, source.entity));
  host.server.step();
  for (let i = 0; i < 100 && ![...world.drops.values()].some(d => d.kind === 'pearl'); i++) {
    host.server.step(); await turn();
  }
  const drop = [...world.drops.values()].find(d => d.kind === 'pearl'); assert.ok(drop);
  while (world.tick < drop.pickAt) { host.server.step(); await turn(); }
  world.ecs.x[source.entity] = drop.x; world.ecs.z[source.entity] = drop.z;
  const pickup = host.groundPearls.pickup({ dropId: drop.id, receiver: selector(source) });
  for (let i = 0; i < 100 && world.drops.has(drop.id); i++) {
    host.server.step(); await turn(); await host.groundAuthority.settle();
  }
  await pickup.result;
  for (let e = 1; e < world.ecs.cap; e++) if (world.ecs.kind[e] === KIND.ENEMY) {
    world.ecs.alive[e] = 0; world.ecs.brain[e] = null;
  }
  let receiverUid = null;
  if (options.receiverPearl) {
    const row = await f.currentStore().loadProfile(RECEIVER), data = structuredClone(row.data);
    receiverUid = 'give-host-receiver-owned'; data.pearls.bag.push({ uid: receiverUid, kind: 'brasa' });
    const operationId = randomUUID(), operation = groundOperation({ operationId, uid: receiverUid, kind: 'brasa',
      world: host.worldState.id, ground: null, from: null, to: RECEIVER, expectedVersion: 0,
      profiles: [{ id: RECEIVER, expectedVersion: row.version, data }] }).request;
    const task = host.groundAuthority.stageFamily({ operationId, family: 'ground', operation }, () => true);
    await host.groundAuthority.settle(); host.server.step();
    const registered = await task;
    assert.equal(registered.ok, true);
  }
  const receiver = await joinPlayer(host, 'receiver'), third = await joinPlayer(host, 'third');
  for (const player of [receiver, third]) {
    world.ecs.x[player.entity] = world.ecs.x[source.entity] + 0.3;
    world.ecs.z[player.entity] = world.ecs.z[source.entity];
  }
  calm(world, source, receiver, third);
  assert.ok(hasPearl(world, source, drop.pearl.uid));
  return { ...f, host, world, source, receiver, third, uid: drop.pearl.uid, receiverUid };
}

export async function finish(host, operation) {
  await host.groundAuthority.settle();
  assert.equal(host.server.step(), true);
  return operation.result;
}
