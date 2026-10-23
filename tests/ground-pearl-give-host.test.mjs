import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../src/net/protocol.js';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { setup, selector, hasPearl, calm, finish, deferred, turn, OWNER, RECEIVER } from './helpers/ground-pearl-give-host.mjs';

const copy = structuredClone;
const gift = f => ({ source: selector(f.source), receiver: selector(f.receiver), uid: f.uid });
const isGive = raw => raw.request?.family === 'ground' && raw.request.operation?.from && raw.request.operation?.to;
const send = (player, command) => player.socket.emit('message', Buffer.from(JSON.stringify(command)), false);

test('give reserves both accounts before IO and applies the two-profile receipt only at drain', async t => {
  const entered = deferred(), release = deferred();
  const f = await setup(t, { receiverPearl: true,
    commitHook: async raw => { if (isGive(raw)) { entered.resolve(copy(raw)); await release.promise; } } });
  const { host, world, source, receiver, third, uid } = f;
  try {
    world.ecs.xp[source.entity] = 123; world.ecs.xp[receiver.entity] = 234;
    const sourceMessages = source.socket.messages.length, receiverMessages = receiver.socket.messages.length;
    const initialClock = copy(host.groundAuthority.status().clock), version = host.worldState.version;
    f.armCommitHook();
    const operation = host.groundPearls.give(gift(f));
    const gate = pearlMutationGate(host.profiles);
    for (const lanes of [{ accounts: [OWNER] }, { accounts: [RECEIVER] }, { uids: [uid] }, { uids: [f.receiverUid] }])
      assert.throws(() => gate.assertAvailable(lanes), { code: 'busy' }, 'reservation exists synchronously before IO');
    assert.throws(() => host.groundPearls.give({ ...gift(f), receiver: selector(third) }), { code: 'busy' });
    const raw = await entered.promise, op = raw.request.operation;
    assert.equal(op.from, OWNER); assert.equal(op.to, RECEIVER); assert.equal(op.ground, null);
    assert.equal(op.expectedVersion, 2, 'the prior pickup generation is read from SQL');
    assert.deepEqual(op.profiles.map(p => p.id), [OWNER, RECEIVER]);
    assert.equal(op.profiles[0].data.xp, 123); assert.equal(op.profiles[1].data.xp, 234);
    assert.equal(raw.request.expectedWorldVersion, version);
    assert.equal(raw.request.clock.expectedVersion, initialClock.version);
    assert.equal(raw.request.clock.tick, raw.request.worldData.resources.tick);
    assert.ok(hasPearl(world, source, uid)); assert.equal(hasPearl(world, receiver, uid), false);
    assert.equal(source.socket.messages.length, sourceMessages); assert.equal(receiver.socket.messages.length, receiverMessages);
    const tick = world.tick; assert.equal(host.server.step(), false); assert.equal(world.tick, tick);
    release.resolve(); await host.groundAuthority.settle();
    assert.ok(hasPearl(world, source, uid), 'SQL completion alone does not project gameplay');
    assert.equal(host.server.step(), true); await operation.result;
    assert.equal(hasPearl(world, source, uid), false); assert.ok(hasPearl(world, receiver, uid));
    assert.equal(world.drops.size, 0);
    assert.deepEqual(world.pearlLedger.get(uid), { owner: `account:${RECEIVER}`, entity: receiver.entity, place: 'profile' });
    assert.deepEqual(await f.currentStore().loadUnique(uid), { kind: `pearl:${op.kind}`, holder: RECEIVER, version: 3 });
    assert.deepEqual(await f.currentStore().loadPearlLocation(uid), { world: raw.request.world, ground: null, version: 3 });
    for (const row of op.profiles) {
      const durable = await f.currentStore().loadProfile(row.id);
      assert.equal(durable.version, row.expectedVersion + 1); assert.deepEqual(durable.data, row.data);
    }
    const allMessages = source.socket.messages.slice(sourceMessages).concat(receiver.socket.messages.slice(receiverMessages));
    assert.equal(allMessages.filter(m => m.ev?.type === 'pearlChanged' && m.ev.op === 'give').length, 1);
    assert.equal(allMessages.filter(m => m.ev?.type === 'pickup' && m.ev.pearl?.uid === uid).length, 1);
    gate.assertAvailable({ accounts: [OWNER, RECEIVER], uids: [uid] });
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('real give command validates selectors and never accepts client authority fields', async t => {
  const f = await setup(t), { host, source, receiver, world, uid } = f;
  try {
    const command = { t: MSG.CMD, type: 'pearl', op: 'give', uid, target: receiver.entity };
    const before = copy([...world.profiles]), count = f.transactions.length;
    for (const extra of [{ price: 1 }, { holder: OWNER }, { expectedVersion: 2 }, { operationId: 'client' }, { profile: {} }])
      send(source, { ...command, ...extra });
    for (const target of [source.entity, 0, -1, receiver.entity + 0.1, String(receiver.entity), 999999])
      send(source, { ...command, target });
    await turn(); assert.deepEqual([...world.profiles], before); assert.equal(f.transactions.length, count);
    send(source, command);
    await host.groundAuthority.settle(); assert.equal(host.server.step(), true);
    assert.ok(hasPearl(world, receiver, uid)); assert.equal(hasPearl(world, source, uid), false);
    assert.equal(f.transactions.filter(isGive).length, 1);
  } finally { await host.close().catch(() => {}); }
});

test('prior autosaves for both accounts settle under the give reservation', async t => {
  const f = await setup(t), { host, world, source, receiver, uid } = f;
  const original = host.store.saveProfile, entered = deferred(), release = deferred();
  let held = false;
  host.store.saveProfile = async (...args) => {
    if (!held && args[0] === OWNER) { held = true; entered.resolve(); await release.promise; }
    return original(...args);
  };
  try {
    world.ecs.xp[source.entity] = 11; world.ecs.xp[receiver.entity] = 22;
    host.profiles.save(source.clientId, capturePearlProfile(world, source.entity));
    await entered.promise;
    host.profiles.save(receiver.clientId, capturePearlProfile(world, receiver.entity));
    world.ecs.xp[source.entity] = 33; world.ecs.xp[receiver.entity] = 44;
    const operation = host.groundPearls.give(gift(f)); release.resolve();
    await finish(host, operation);
    const raw = f.transactions.find(isGive);
    assert.equal(raw.request.operation.profiles[0].data.xp, 33);
    assert.equal(raw.request.operation.profiles[1].data.xp, 44);
    assert.ok(hasPearl(world, receiver, uid));
  } finally { release.resolve(); host.store.saveProfile = original; await host.close().catch(() => {}); }
});

test('a near-limit running profile is rejected before reserving or starting settlement IO', async t => {
  const f = await setup(t), { host, source } = f, s = host.profiles.clients.get(source.clientId);
  const initial = { version: s.version, running: s.running }, count = f.transactions.length;
  try {
    s.version = 2147483645; s.running = Promise.resolve();
    assert.throws(() => host.groundPearls.give(gift(f)), { code: 'conflict' });
    assert.equal(f.transactions.length, count); assert.equal(host.groundPearls.pending, false);
    pearlMutationGate(host.profiles).assertAvailable({ accounts: [OWNER, RECEIVER], uids: [f.uid] });
  } finally { s.version = initial.version; s.running = initial.running; await host.close().catch(() => {}); }
});

test('lost SQL response and missing receipt read retry the same request without duplicating a gift', async t => {
  let lost = false;
  const f = await setup(t, { commitHook: async raw => { if (isGive(raw) && !lost) { lost = true; throw new Error('response lost'); } } });
  const { host, world, receiver, uid } = f;
  const originalLoad = host.store.loadGroundTransaction;
  let hidden = false;
  host.store.loadGroundTransaction = async (...args) => {
    if (lost && !hidden) { hidden = true; return null; }
    return originalLoad(...args);
  };
  try {
    f.armCommitHook(); const operation = host.groundPearls.give(gift(f)); await finish(host, operation);
    const sends = f.transactions.filter(isGive);
    assert.equal(sends.length, 2); assert.deepEqual(sends[0], sends[1]);
    assert.equal(world.profiles.get(receiver.entity).pearls.bag.filter(q => q.uid === uid).length, 1);
    const rows = (await f.db.db.query("select operation_id from public.mn_ground_transactions where operation_id=$1", [operation.operationId])).rows;
    assert.equal(rows.length, 1);
  } finally { host.store.loadGroundTransaction = originalLoad; await host.close().catch(() => {}); }
});

for (const mode of ['receiver disconnect', 'receiver death', 'receiver recycle', 'close', 'completion replaced', 'command null']) {
  test(`${mode} fences a committed give before local apply`, async t => {
    const entered = deferred(), release = deferred();
    const f = await setup(t, { commitHook: async raw => { if (isGive(raw)) { entered.resolve(); await release.promise; } } });
    const { host, world, source, receiver, uid } = f;
    try {
      f.armCommitHook(); const operation = host.groundPearls.give(gift(f)); await entered.promise;
      const from = world.profiles.get(source.entity), to = world.profiles.get(receiver.entity);
      if (mode === 'receiver disconnect') receiver.socket.close();
      if (mode === 'receiver death') world.ecs.dead[receiver.entity] = 1;
      if (mode === 'receiver recycle') host.server.clients.get(receiver.clientId).entity = source.entity;
      if (mode === 'completion replaced') host.server.afterTick = () => true;
      if (mode === 'command null') host.server.onPearlCommand = null;
      release.resolve(); await host.groundAuthority.settle();
      if (mode === 'close') await assert.rejects(host.close(), { code: 'flush' });
      else host.server.step();
      await assert.rejects(operation.result);
      assert.equal(from.pearls.bag.filter(q => q.uid === uid).length, 1);
      assert.equal(to.pearls.bag.filter(q => q.uid === uid).length, 0);
      assert.equal((await f.currentStore().loadUnique(uid)).holder, RECEIVER, 'SQL stays authoritative for recovery');
      assert.equal(host.groundAuthority.status().failed, true);
    } finally { release.resolve(); await host.close().catch(() => {}); }
  });
}

for (const hookMode of ['null', 'replacement']) {
  test(`give fences a ${hookMode} command hook before reaching legacy transfer`, async t => {
    const f = await setup(t), { host, source, receiver, world, uid } = f;
    try {
      const before = copy([...world.profiles]), count = f.transactions.length;
      let replacementCalls = 0;
      host.server.onPearlCommand = hookMode === 'null' ? null : () => { replacementCalls++; return true; };
      send(source, { t: MSG.CMD, type: 'pearl', op: 'give', uid, target: receiver.entity });
      assert.equal(replacementCalls, 0); assert.equal(host.closing, true);
      assert.deepEqual([...world.profiles], before); assert.equal(f.transactions.length, count);
      assert.equal(source.socket.messages.at(-1).ev?.why, 'busy');
    } finally { await host.close().catch(() => {}); }
  });
}

for (const mode of ['second session', 'partial events']) {
  test(`${mode} apply failure rolls back both live bags and fences the committed host`, async t => {
    const f = await setup(t), { host, world, source, receiver, uid } = f;
    const originalPush = Array.prototype.push;
    try {
      let armed = false;
      if (mode === 'second session') {
        const target = host.profiles.clients.get(receiver.clientId);
        const proxy = new Proxy(target, { set(object, key, value) {
          if (armed && key === 'confirmed') { armed = false; throw new Error('second session confirmed write'); }
          return Reflect.set(object, key, value);
        } });
        host.profiles.clients.set(receiver.clientId, proxy); host.profiles.accounts.set(RECEIVER, proxy);
      }
      const operation = host.groundPearls.give(gift(f)); await host.groundAuthority.settle();
      const from = world.profiles.get(source.entity), to = world.profiles.get(receiver.entity);
      const beforeFrom = copy(from), beforeTo = copy(to), beforeLedger = copy([...world.pearlLedger]);
      const first = host.profiles.clients.get(source.clientId), second = host.profiles.clients.get(receiver.clientId);
      const sessionFields = s => ({ version: s.version, confirmed: copy(s.confirmed), last: s.last });
      const firstBefore = sessionFields(first), secondBefore = sessionFields(second);
      armed = true;
      if (mode === 'partial events') {
        Array.prototype.push = function(...values) {
          if (armed && this === world.events && values.length === 2 && values[0]?.op === 'give') {
            armed = false; originalPush.call(this, values[0]); throw new Error('partial events');
          }
          return originalPush.apply(this, values);
        };
      }
      assert.equal(host.server.step(), false); Array.prototype.push = originalPush;
      await assert.rejects(operation.result);
      assert.deepEqual(from, beforeFrom); assert.deepEqual(to, beforeTo);
      assert.deepEqual([...world.pearlLedger].map(([key, row]) => [key, { owner: row.owner, place: row.place }]),
        beforeLedger.map(([key, row]) => [key, { owner: row.owner, place: row.place }]),
        'the fence may detach an entity but keeps the rolled-back source owner');
      assert.deepEqual(sessionFields(first), firstBefore); assert.deepEqual(sessionFields(second), secondBefore);
      assert.equal(host.groundAuthority.status().failed, true);
      assert.equal((await f.currentStore().loadUnique(uid)).holder, RECEIVER);
    } finally { Array.prototype.push = originalPush; await host.close().catch(() => {}); }
  });
}
