import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../src/net/protocol.js';
import { mulberry32 } from '../src/core/rng.js';
import { PEARL } from '../src/data/pearls.js';
import { KIND } from '../src/sim/ecs.js';
import { fixture, joinPlayer, turn, deferred, injectStep } from './helpers/ground-pearl-mint-host.mjs';

const copy = structuredClone;
const pearls = world => [...world.drops.values()].filter(drop => drop.kind === 'pearl');

async function seedOwnedPearl(f, host, player, uid = 'leave-host-pearl') {
  // Create a genuine durable pearl through the existing sentinel route, then pick it up.
  const world = host.server.world, point = world.map.cala;
  world.ecs.x[player.entity] = point.x; world.ecs.z[player.entity] = point.z;
  const sentinel = world.spawnEnemy('sentinel', point.x + 3, point.z);
  world.lootRng = mulberry32(5);
  injectStep(host, () => world.killEnemy(sentinel, player.entity));
  host.server.step();
  for (let i = 0; i < 100 && !pearls(world).length; i++) { host.server.step(); await turn(); }
  const drop = pearls(world)[0];
  assert.ok(drop, 'sentinel creates a pearl through the mounted mint lane');
  const pearlUid = drop.pearl.uid;
  while (world.tick < drop.pickAt) { host.server.step(); await turn(); }
  world.ecs.x[player.entity] = drop.x; world.ecs.z[player.entity] = drop.z;
  const pickup = f.pearls.pickup({ dropId: drop.id, receiver: { clientId: player.clientId, entity: player.entity } });
  for (let i = 0; i < 100 && world.drops.has(drop.id); i++) { host.server.step(); await turn(); await host.groundAuthority.settle(); }
  await pickup.result;
  const ecs = world.ecs, entity = player.entity;
  ecs.regenT[entity] = PEARL.calm + 1; ecs.castK[entity] = 0; ecs.atkStage[entity] = 0; ecs.dashT[entity] = -1;
  for (let other = 1; other < ecs.cap; other++) if (other !== entity && ecs.kind[other] === KIND.ENEMY) {
    ecs.alive[other] = 0; ecs.brain[other] = null;
  }
  assert.equal(world.profiles.get(player.entity).pearls.bag.some(pearl => pearl.uid === pearlUid), true);
  return pearlUid;
}

async function stepUntil(host, predicate, label) {
  for (let i = 0; i < 100 && !predicate(); i++) { host.server.step(); await turn(); }
  assert.ok(predicate(), `${label} did not complete; leave=${JSON.stringify(host.groundPearls.status())}`);
}

test('selector leave reserves and persists an owned pearl, then applies only at the common tick boundary', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async raw => {
    if (raw.request?.family === 'ground' && raw.request.operation?.to === null && raw.request.operation?.ground) {
      entered.resolve(copy(raw)); await release.promise;
    }
  } });
  const host = f.host, player = await joinPlayer(host), world = host.server.world;
  const uid = await seedOwnedPearl(f, host, player);
  try {
    world.ecs.xp[player.entity] = 123;
    const beforeMessages = player.socket.messages.length;
    f.armCommitHook();
    const operation = host.groundPearls.leave({ source: { clientId: player.clientId, entity: player.entity }, uid });
    const raw = await entered.promise;
    assert.equal(raw.request.family, 'ground');
    assert.equal(raw.request.operation.uid, uid);
    assert.equal(raw.request.operation.expectedVersion, 2, 'pickup generation advances before leaving');
    assert.equal(raw.request.operation.profiles[0].data.xp, 123, 'prior ECS progress is settled inside the reservation');
    assert.equal(world.profiles.get(player.entity).pearls.bag.some(pearl => pearl.uid === uid), true);
    assert.equal(pearls(world).some(drop => drop.pearl.uid === uid), false);
    assert.equal(world.pearlLedger.get(uid)?.place, 'profile');
    assert.equal(player.socket.messages.length, beforeMessages, 'the held completion publishes no leave event');
    const heldTick = world.tick;
    assert.equal(host.server.step(), false); assert.equal(world.tick, heldTick);
    release.resolve(); await host.groundAuthority.settle();
    assert.equal(pearls(world).some(drop => drop.pearl.uid === uid), false, 'SQL completion waits for beforeTick');
    assert.equal(host.server.step(), true);
    const drop = pearls(world).find(value => value.pearl.uid === uid);
    assert.ok(drop);
    assert.deepEqual(world.pearlLedger.get(uid), { owner: '', entity: 0, place: 'ground', drop: drop.id });
    assert.equal(world.profiles.get(player.entity).pearls.bag.some(pearl => pearl.uid === uid), false);
    assert.equal((await f.currentStore().loadUnique(uid)).holder, null);
    assert.ok((await f.currentStore().loadProfile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).data.xp >= 123);
    await operation.result;
    assert.equal(host.groundPearls.status().pending, 0);
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('real CMD pearl leave is routed only when mounted; malformed give, swallow, combat, unknown, spit and sell fail closed', async t => {
  const f = await fixture(t), host = f.host, player = await joinPlayer(host), world = host.server.world;
  const uid = await seedOwnedPearl(f, host, player);
  try {
    const send = msg => player.socket.emit('message', Buffer.from(JSON.stringify(msg)), false);
    const before = copy(world.profiles.get(player.entity));
    const isLeave = tx => tx.request?.family === 'ground' && tx.request.operation?.uid === uid &&
      tx.request.operation?.from === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' && tx.request.operation?.to === null;
    const count = f.transactions.filter(isLeave).length;
    for (const msg of [
      { t: MSG.CMD, type: 'pearl', op: 'give', uid },
      { t: MSG.CMD, type: 'pearl', op: 'swallow', uid },
      { t: MSG.CMD, type: 'pearl', op: 'spit', uid },
      { t: MSG.CMD, type: 'pearl', op: 'sell', uid },
      { t: MSG.CMD, type: 'pearl', op: 'mystery', uid },
    ]) send(msg);
    await turn();
    assert.deepEqual(world.profiles.get(player.entity), before);
    assert.equal(f.transactions.filter(isLeave).length, count, 'denied commands create no leave SQL receipt');
    assert.throws(() => host.groundPearls.leave({ source: { clientId: player.clientId, entity: player.entity }, uid: 'unknown' }),
      { code: 'unknown' });

    world.ecs.regenT[player.entity] = 0;
    send({ t: MSG.CMD, type: 'pearl', op: 'leave', uid });
    await turn();
    assert.deepEqual(world.profiles.get(player.entity), before, 'combat rejects the real leave command');
    assert.equal(f.transactions.filter(isLeave).length, count);
    world.ecs.regenT[player.entity] = PEARL.calm + 1;

    send({ t: MSG.CMD, type: 'pearl', op: 'leave', uid });
    await stepUntil(host, () => !world.profiles.get(player.entity).pearls.bag.some(pearl => pearl.uid === uid), 'CMD leave');
    assert.equal(pearls(world).filter(drop => drop.pearl.uid === uid).length, 1);
    assert.equal(f.transactions.filter(isLeave).length, count + 1);
  } finally { await host.close().catch(() => {}); }
});

test('shutdown fences a SQL committed leave until recovery', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async raw => {
    if (raw.request?.family === 'ground' && raw.request.operation?.from && raw.request.operation?.to === null) {
      entered.resolve(); await release.promise;
    }
  } });
  const host = f.host, player = await joinPlayer(host), world = host.server.world, uid = await seedOwnedPearl(f, host, player);
  f.armCommitHook();
  try {
    const operation = host.groundPearls.leave({ source: { clientId: player.clientId, entity: player.entity }, uid });
    await entered.promise;
    const liveProfile = world.profiles.get(player.entity);
    release.resolve(); await host.groundAuthority.settle();
    await assert.rejects(host.close(), { code: 'flush' });
    await assert.rejects(operation.result);
    assert.equal(pearls(world).some(drop => drop.pearl.uid === uid), false);
    assert.equal(world.profiles.has(player.entity), false, 'shutdown removes the live profile');
    assert.equal(liveProfile.pearls.bag.some(pearl => pearl.uid === uid), true, 'detached preflight profile remains unchanged');
    assert.equal(host.unsavedProfiles.get(player.clientId)?.data.pearls.bag.some(pearl => pearl.uid === uid), true,
      'shutdown retains the detached profile only as recovery diagnostics');
    assert.equal((await f.currentStore().loadUnique(uid)).holder, null);
    assert.equal((await f.currentStore().loadProfile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).data.pearls.bag.some(pearl => pearl.uid === uid), false);
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('a normally applied leave hydrates as one source after restart and can be picked up once', async t => {
  const f = await fixture(t), first = f.host, player = await joinPlayer(first), firstWorld = first.server.world;
  const uid = await seedOwnedPearl(f, first, player);
  const leave = first.groundPearls.leave({ source: { clientId: player.clientId, entity: player.entity }, uid });
  for (let i = 0; i < 100 && first.groundPearls.status().pending; i++) { first.server.step(); await turn(); }
  first.server.step(); await leave.result;
  const firstDrop = pearls(firstWorld).find(drop => drop.pearl.uid === uid); assert.ok(firstDrop);
  const restarted = await f.restart(), host = restarted.host, world = host.server.world;
  assert.equal(host.groundPearls.status().ready, true);
  assert.equal(pearls(world).filter(drop => drop.pearl.uid === uid).length, 1);
  assert.equal((await f.currentStore().loadProfile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).data.pearls.bag.some(pearl => pearl.uid === uid), false);
  while (world.tick < pearls(world)[0].pickAt) { host.server.step(); await turn(); }
  const receiver = await joinPlayer(host);
  world.ecs.x[receiver.entity] = firstDrop.x; world.ecs.z[receiver.entity] = firstDrop.z;
  const drop = pearls(world).find(value => value.pearl.uid === uid);
  const pickup = host.groundPearls.pickup({ dropId: drop.id, receiver: { clientId: receiver.clientId, entity: receiver.entity } });
  for (let i = 0; i < 100 && world.drops.has(drop.id); i++) { host.server.step(); await turn(); await host.groundAuthority.settle(); }
  await pickup.result;
  assert.equal(pearls(world).filter(value => value.pearl.uid === uid).length, 0);
  assert.equal(world.profiles.get(receiver.entity).pearls.bag.filter(pearl => pearl.uid === uid).length, 1);
  assert.equal((await f.currentStore().loadProfile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).data.pearls.bag.filter(pearl => pearl.uid === uid).length, 1);
  await host.close();
});

test('disconnect and shutdown fence a retained leave receipt before gameplay apply', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async raw => {
    if (raw.request?.family === 'ground' && raw.request.operation?.from && raw.request.operation?.to === null) {
      entered.resolve(); await release.promise;
    }
  } });
  const host = f.host, player = await joinPlayer(host), world = host.server.world, uid = await seedOwnedPearl(f, host, player);
  try {
    f.armCommitHook();
    const operation = host.groundPearls.leave({ source: { clientId: player.clientId, entity: player.entity }, uid });
    await entered.promise;
    const liveProfile = world.profiles.get(player.entity);
    player.socket.close();
    release.resolve(); await host.groundAuthority.settle();
    await assert.rejects(operation.result);
    assert.equal(pearls(world).some(drop => drop.pearl.uid === uid), false);
    assert.equal(world.profiles.has(player.entity), false, 'disconnection removes the live profile');
    assert.equal(liveProfile.pearls.bag.some(pearl => pearl.uid === uid), true, 'detached preflight profile remains unchanged');
    assert.equal(host.unsavedProfiles.get(player.clientId)?.data.pearls.bag.some(pearl => pearl.uid === uid), true,
      'disconnect retains the detached profile only as recovery diagnostics');
    assert.equal((await f.currentStore().loadUnique(uid)).holder, null,
      'disconnect before apply leaves the committed result recoverable');
    assert.equal((await f.currentStore().loadProfile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).data.pearls.bag.some(pearl => pearl.uid === uid), false);
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('taking over the common completion callback prevents a retained leave from applying', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async raw => {
    if (raw.request?.family === 'ground' && raw.request.operation?.from && raw.request.operation?.to === null) {
      entered.resolve(); await release.promise;
    }
  } });
  const host = f.host, player = await joinPlayer(host), world = host.server.world, uid = await seedOwnedPearl(f, host, player);
  try {
    f.armCommitHook();
    host.groundPearls.leave({ source: { clientId: player.clientId, entity: player.entity }, uid });
    await entered.promise;
    const liveProfile = world.profiles.get(player.entity);
    host.server.afterTick = () => true;
    release.resolve(); await host.groundAuthority.settle();
    assert.equal(host.server.step(), false);
    assert.equal(host.groundAuthority.status().failed, true);
    assert.equal(pearls(world).some(drop => drop.pearl.uid === uid), false);
    assert.equal(host.closing, true, 'owner takeover fences this host');
    assert.equal(world.profiles.has(player.entity), false, 'fencing detaches the live profile');
    assert.equal(liveProfile.pearls.bag.some(pearl => pearl.uid === uid), true, 'owner takeover leaves the detached preflight profile unchanged');
    assert.equal(host.unsavedProfiles.get(player.clientId)?.data.pearls.bag.some(pearl => pearl.uid === uid), true);
    assert.equal((await f.currentStore().loadUnique(uid)).holder, null);
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

for (const hookMode of ['null', 'replacement']) {
  test(`mounted leave command fences a ${hookMode} pearl hook before legacy mutation`, async t => {
    const f = await fixture(t), host = f.host, player = await joinPlayer(host), world = host.server.world;
    const uid = await seedOwnedPearl(f, host, player);
    try {
      const liveProfile = world.profiles.get(player.entity), beforeProfile = copy(liveProfile);
      const beforeLedger = copy([...world.pearlLedger]), beforeDrops = copy([...world.drops]);
      const beforeEvents = copy(world.events), beforeMessages = player.socket.messages.length;
      const beforeTransactions = f.transactions.length;
      const beforeUnique = await f.currentStore().loadUnique(uid);
      const beforeLocation = await f.currentStore().loadPearlLocation(uid);
      let replacementCalls = 0;
      if (hookMode === 'null') host.server.onPearlCommand = null;
      else host.server.onPearlCommand = () => { replacementCalls++; return true; };

      const command = { t: MSG.CMD, type: 'pearl', op: 'leave', uid };
      if (hookMode === 'null') {
        player.socket.emit('message', Buffer.from(JSON.stringify(command)), false);
      } else {
        assert.equal(host.server.playerCommand(host.server.clients.get(player.clientId), command), false,
          'the direct player-command path denies a replacement callback');
      }

      assert.equal(host.closing, true, 'ownership drift fences the mounted host');
      assert.equal(replacementCalls, 0, 'an unowned replacement callback never receives the command');
      assert.deepEqual(liveProfile, beforeProfile, 'the preflight profile was not changed by legacy leave');
      assert.deepEqual([...world.pearlLedger], beforeLedger);
      assert.deepEqual([...world.drops], beforeDrops);
      assert.deepEqual(world.events, beforeEvents, 'no leave/unloot/loot event was published');
      const denied = player.socket.messages.slice(beforeMessages);
      assert.equal(denied.length, 1, 'the client receives only the ordinary busy denial');
      assert.deepEqual(denied[0].ev, { type: 'commandDenied', to: player.entity, e: player.entity, why: 'busy' });
      assert.equal(f.transactions.length, beforeTransactions, 'no SQL transaction was staged');

      await turn();
      assert.equal(world.profiles.has(player.entity), false, 'the fenced host detaches the live profile');
      assert.deepEqual(await f.currentStore().loadUnique(uid), beforeUnique);
      assert.deepEqual(await f.currentStore().loadPearlLocation(uid), beforeLocation);
      assert.equal(host.unsavedProfiles.get(player.clientId)?.data.pearls.bag.some(pearl => pearl.uid === uid), true,
        'the fenced preflight profile remains available only as recovery diagnostics');
    } finally { await host.close().catch(() => {}); }
  });
}

