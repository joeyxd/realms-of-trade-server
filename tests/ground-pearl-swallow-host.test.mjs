import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../src/net/protocol.js';
import { PEARL_ACTION_BITS } from '../src/net/pearlInputBoundary.js';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { setup, selector, calm, finish, deferred, turn, OWNER } from './helpers/ground-pearl-give-host.mjs';

const copy = structuredClone;
const swallow = f => ({ source: selector(f.source), uid: f.uid });
const isSwallow = raw => raw.request?.family === 'ground' && raw.request.operation?.from === OWNER &&
  raw.request.operation?.to === OWNER && raw.request.operation?.ground === null;
const send = (player, command) => player.socket.emit('message', Buffer.from(JSON.stringify(command)), false);
const actionCommand = seq => ({ seq, mx: 0.25, mz: -0.5, ax: 0.75, az: -0.125,
  btn: PEARL_ACTION_BITS | 1, prs: PEARL_ACTION_BITS | 1, pt: 100000 + seq, w: 0 });

test('swallow reserves its account and UIDs, then applies one same-holder receipt at tick drain', async t => {
  const entered = deferred(), release = deferred();
  const f = await setup(t, { commitHook: async raw => {
    if (isSwallow(raw)) { entered.resolve(copy(raw)); await release.promise; }
  } });
  const { host, world, source, uid } = f;
  try {
    world.ecs.xp[source.entity] = 123;
    const beforeProfile = copy(world.profiles.get(source.entity));
    const beforeEcs = Object.fromEntries(Object.entries(world.ecs).filter(([, v]) => ArrayBufferBufferView(v))
      .map(([key, v]) => [key, v[source.entity]]));
    const beforeEvents = copy(world.events), beforeLedger = copy([...world.pearlLedger]);
    const beforeMessages = source.socket.messages.length;
    const beforeClock = copy(host.groundAuthority.status().clock), beforeWorldVersion = host.worldState.version;
    f.armCommitHook();
    const operation = host.groundPearls.swallow(swallow(f));
    const gate = pearlMutationGate(host.profiles);
    for (const lanes of [{ accounts: [OWNER] }, { uids: [uid] }])
      assert.throws(() => gate.assertAvailable(lanes), { code: 'busy' }, 'reservation is synchronous before storage IO');
    assert.throws(() => host.groundPearls.swallow(swallow(f)), { code: 'busy' });
    const raw = await entered.promise, op = raw.request.operation;
    assert.equal(raw.request.family, 'ground');
    assert.equal(op.uid, uid); assert.equal(op.from, OWNER); assert.equal(op.to, OWNER); assert.equal(op.ground, null);
    assert.ok(op.expectedVersion > 1, 'the operation uses the minted and picked-up generation');
    assert.equal(op.profiles.length, 1); assert.equal(op.profiles[0].id, OWNER);
    assert.equal(op.profiles[0].data.xp, 123, 'current ECS progress is included in the one-profile CAS');
    assert.equal(op.profiles[0].data.pearls.swallowed.uid, uid);
    assert.equal(op.profiles[0].data.pearls.bag.some(p => p.uid === uid), false);
    assert.equal(op.profiles[0].expectedVersion, host.profiles.clients.get(source.clientId).version);
    assert.equal(raw.request.expectedWorldVersion, beforeWorldVersion);
    assert.equal(raw.request.clock.expectedVersion, beforeClock.version);
    assert.equal(raw.request.clock.tick, raw.request.worldData.resources.tick);
    assert.deepEqual(world.profiles.get(source.entity), beforeProfile, 'SQL completion has not published the profile');
    assert.deepEqual(Object.fromEntries(Object.entries(world.ecs).filter(([, v]) => ArrayBufferBufferView(v))
      .map(([key, v]) => [key, v[source.entity]])), beforeEcs, 'SQL completion has not applied the power effect');
    assert.deepEqual(world.events, beforeEvents); assert.deepEqual([...world.pearlLedger], beforeLedger);
    assert.equal(source.socket.messages.length, beforeMessages);
    const tick = world.tick; assert.equal(host.server.step(), false); assert.equal(world.tick, tick);

    release.resolve(); await host.groundAuthority.settle();
    assert.deepEqual(world.profiles.get(source.entity), beforeProfile, 'a durable receipt waits for the common drain');
    assert.equal(host.server.step(), true);
    await operation.result;
    const live = world.profiles.get(source.entity), session = host.profiles.clients.get(source.clientId);
    assert.equal(live.pearls.bag.some(p => p.uid === uid), false);
    assert.equal(live.pearls.swallowed.uid, uid);
    assert.equal(live.xp, 123);
    assert.deepEqual(world.pearlLedger.get(uid), { owner: `account:${OWNER}`, entity: source.entity, place: 'profile' });
    const durable = await f.currentStore().loadProfile(OWNER), unique = await f.currentStore().loadUnique(uid);
    const location = await f.currentStore().loadPearlLocation(uid);
    assert.equal(durable.version, op.profiles[0].expectedVersion + 1); assert.deepEqual(durable.data, op.profiles[0].data);
    assert.deepEqual(unique, { holder: OWNER, kind: `pearl:${op.kind}`, version: op.expectedVersion + 1 });
    assert.deepEqual(location, { world: raw.request.world, ground: null, version: op.expectedVersion + 1 });
    assert.equal(session.version, op.profiles[0].expectedVersion + 1);
    assert.equal(host.worldState.version, beforeWorldVersion + 1);
    assert.equal(host.groundAuthority.status().clock.version, beforeClock.version + 1);
    assert.equal(source.socket.messages.slice(beforeMessages).filter(m => m.ev?.type === 'pearlChanged' && m.ev.op === 'swallow').length, 1);
    assert.equal(f.transactions.filter(isSwallow).length, 1);
    gate.assertAvailable({ accounts: [OWNER], uids: [uid] });
    assert.equal(host.groundAuthority.status().failed, false);
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('real swallow command accepts only the selected UID and denies replacement, spit, and swallowed-slot transfers', async t => {
  const f = await setup(t), { host, world, source, receiver, uid } = f;
  try {
    const before = copy(world.profiles.get(source.entity));
    assert.throws(() => host.groundPearls.swallow({ source: selector(receiver), uid }), error =>
      ['session', 'ownership', 'unknown'].includes(error.code), 'a different authenticated holder cannot swallow this UID');
    const command = { t: MSG.CMD, type: 'pearl', op: 'swallow', uid };
    for (const extra of [{ replaceUid: uid }, { holder: OWNER }, { expectedVersion: 2 }, { operationId: 'client' },
      { profile: {} }, { version: 2 }]) send(source, { ...command, ...extra });
    send(source, { t: MSG.CMD, type: 'pearl', op: 'spit', uid });
    await turn();
    assert.deepEqual(world.profiles.get(source.entity), before);
    assert.equal(f.transactions.filter(isSwallow).length, 0);

    const beforeAccepted = f.transactions.filter(isSwallow).length;
    send(source, command);
    for (let i = 0; i < 100 && world.profiles.get(source.entity).pearls.swallowed === null; i++) {
      await host.groundAuthority.settle(); host.server.step(); await turn();
    }
    assert.equal(world.profiles.get(source.entity).pearls.swallowed.uid, uid);
    assert.equal(f.transactions.filter(isSwallow).length, beforeAccepted + 1);
    const after = copy(world.profiles.get(source.entity)), transactions = f.transactions.length;
    send(source, command);
    send(source, { t: MSG.CMD, type: 'pearl', op: 'spit', uid });
    send(source, { t: MSG.CMD, type: 'pearl', op: 'give', uid, target: receiver.entity });
    send(source, { t: MSG.CMD, type: 'pearl', op: 'leave', uid });
    await turn();
    assert.deepEqual(world.profiles.get(source.entity), after);
    assert.equal(f.transactions.length, transactions, 'occupied slot and swallowed UID produce no new ground receipt');
  } finally { await host.close().catch(() => {}); }
});

test('a running prior autosave is boundedly settled and rebased before swallow planning', async t => {
  const f = await setup(t), { host, world, source, uid } = f;
  const original = host.store.saveProfile, entered = deferred(), release = deferred();
  let held = false;
  host.store.saveProfile = async (...args) => {
    if (!held && args[0] === OWNER) { held = true; entered.resolve(); await release.promise; }
    return original(...args);
  };
  try {
    world.ecs.xp[source.entity] = 11;
    host.profiles.save(source.clientId, capturePearlProfile(world, source.entity));
    await entered.promise;
    world.ecs.xp[source.entity] = 33;
    const operation = host.groundPearls.swallow(swallow(f)); release.resolve();
    await finish(host, operation);
    const raw = f.transactions.find(isSwallow);
    assert.equal(raw.request.operation.profiles[0].data.xp, 33);
    assert.equal(world.profiles.get(source.entity).pearls.swallowed.uid, uid);
    assert.equal((await f.currentStore().loadProfile(OWNER)).data.xp, 33);
  } finally { release.resolve(); host.store.saveProfile = original; await host.close().catch(() => {}); }
});

test('near-limit running profile rejects swallow before reservation or settlement IO', async t => {
  const f = await setup(t), { host, source, uid } = f, session = host.profiles.clients.get(source.clientId);
  const initial = { version: session.version, running: session.running }, count = f.transactions.length;
  const save = host.store.saveProfile; let saves = 0;
  host.store.saveProfile = (...args) => { saves++; return save(...args); };
  try {
    session.version = 2147483645; session.running = Promise.resolve();
    assert.throws(() => host.groundPearls.swallow(swallow(f)), { code: 'conflict' });
    assert.equal(f.transactions.length, count); assert.equal(host.groundPearls.pending, false);
    assert.equal(saves, 0, 'the exhausted profile is rejected before autosave settlement starts');
    pearlMutationGate(host.profiles).assertAvailable({ accounts: [OWNER], uids: [uid] });
  } finally { session.version = initial.version; session.running = initial.running; host.store.saveProfile = save; await host.close().catch(() => {}); }
});

test('lost swallow response and missing receipt replay the exact operation once', async t => {
  let lost = false;
  const f = await setup(t, { commitHook: async raw => {
    if (isSwallow(raw) && !lost) { lost = true; throw new Error('response lost'); }
  } });
  const { host, world, source, uid } = f, originalLoad = host.store.loadGroundTransaction;
  let hidden = false;
  host.store.loadGroundTransaction = async (...args) => {
    if (lost && !hidden) { hidden = true; return null; }
    return originalLoad(...args);
  };
  try {
    f.armCommitHook(); const operation = host.groundPearls.swallow(swallow(f)); await finish(host, operation);
    const sends = f.transactions.filter(isSwallow);
    assert.equal(sends.length, 2); assert.deepEqual(sends[0], sends[1]);
    assert.equal(world.profiles.get(source.entity).pearls.swallowed.uid, uid);
    assert.equal(world.profiles.get(source.entity).pearls.bag.filter(p => p.uid === uid).length, 0);
    const rows = (await f.db.db.query('select operation_id from public.mn_ground_transactions where operation_id=$1',
      [operation.operationId])).rows;
    assert.equal(rows.length, 1);
  } finally { host.store.loadGroundTransaction = originalLoad; await host.close().catch(() => {}); }
});

for (const mode of ['disconnect', 'death', 'recycle', 'close', 'completion replaced', 'command null']) {
  test(`${mode} fences committed swallow before local apply`, async t => {
    const entered = deferred(), release = deferred();
    const f = await setup(t, { commitHook: async raw => {
      if (isSwallow(raw)) { entered.resolve(); await release.promise; }
    } });
    const { host, world, source, uid } = f;
    try {
      f.armCommitHook(); const operation = host.groundPearls.swallow(swallow(f)); await entered.promise;
      const profile = world.profiles.get(source.entity), session = host.profiles.clients.get(source.clientId);
      if (mode === 'disconnect') source.socket.close();
      if (mode === 'death') world.ecs.dead[source.entity] = 1;
      if (mode === 'recycle') host.server.clients.get(source.clientId).entity = source.entity + 100;
      if (mode === 'completion replaced') host.server.afterTick = () => true;
      if (mode === 'command null') host.server.onPearlCommand = null;
      release.resolve(); await host.groundAuthority.settle();
      if (mode === 'close') await assert.rejects(host.close(), { code: 'flush' });
      else host.server.step();
      await assert.rejects(operation.result);
      assert.equal(profile.pearls.bag.filter(p => p.uid === uid).length, 1);
      assert.equal(profile.pearls.swallowed, null);
      if (mode === 'recycle') assert.equal(world.profiles.get(source.entity), profile,
        'a recycled selector cannot cause a new identity to receive the committed swallow');
      else assert.equal(world.profiles.get(source.entity), undefined, 'fenced host detaches the live identity');
      assert.equal((await f.currentStore().loadUnique(uid)).holder, OWNER, 'SQL remains authoritative for recovery');
      assert.equal(host.groundAuthority.status().failed, true);
      assert.ok(session);
    } finally { release.resolve(); await host.close().catch(() => {}); }
  });
}

test('queued swallow action inputs are filtered while sequence and movement survive', async t => {
  const f = await setup(t), { host, world, source } = f, client = host.server.clients.get(source.clientId);
  const queued = actionCommand(50001);
  try {
    client.queue.push(queued); client.carry = PEARL_ACTION_BITS | 1;
    const operation = host.groundPearls.swallow(swallow(f));
    await finish(host, operation);
    assert.equal(client.last.seq, queued.seq, 'the already received command keeps its sequence');
    assert.equal(client.last.mx, queued.mx); assert.equal(client.last.mz, queued.mz);
    assert.equal(client.last.ax, queued.ax); assert.equal(client.last.az, queued.az);
    assert.equal(client.last.btn & PEARL_ACTION_BITS, 0); assert.equal(client.last.prs & PEARL_ACTION_BITS, 0);
    assert.equal(client.carry, 0);
    assert.equal(world.profiles.get(source.entity).pearls.swallowed.uid, f.uid);
  } finally { await host.close().catch(() => {}); }
});

test('partial publication failure rolls back local swallow profile, session, effect, inputs and event', async t => {
  const f = await setup(t), { host, world, source, uid } = f, client = host.server.clients.get(source.clientId);
  const queued = actionCommand(51001), originalPush = Array.prototype.push;
  try {
    client.queue.push(queued); client.last = actionCommand(51002); client.carry = PEARL_ACTION_BITS | 1;
    const operation = host.groundPearls.swallow(swallow(f)); await host.groundAuthority.settle();
    const profile = world.profiles.get(source.entity), beforeProfile = copy(profile), beforeEcs = copy(Object.fromEntries(
      Object.entries(world.ecs).filter(([, v]) => ArrayBufferBufferView(v)).map(([key, v]) => [key, v[source.entity]])));
    const beforeLedger = copy([...world.pearlLedger]), beforeEvents = copy(world.events), beforeSession = host.profiles.clients.get(source.clientId);
    const sessionFields = { version: beforeSession.version, confirmed: copy(beforeSession.confirmed), last: beforeSession.last };
    const beforeQueue = [...client.queue], beforeLast = copy(client.last), beforeCarry = client.carry;
    let armed = true;
    Array.prototype.push = function (...values) {
      if (armed && this === world.events && values.some(value => value?.op === 'swallow')) {
        armed = false; originalPush.call(this, values[0]); throw new Error('partial swallow publication');
      }
      return originalPush.apply(this, values);
    };
    try { assert.equal(host.server.step(), false); }
    finally { Array.prototype.push = originalPush; }
    await assert.rejects(operation.result);
    assert.deepEqual(profile, beforeProfile);
    assert.deepEqual([...world.pearlLedger], beforeLedger.map(([key, row]) => [key, { ...row, entity: 0 }]));
    const rolledBackEcs = Object.fromEntries(Object.entries(world.ecs).filter(([, v]) => ArrayBufferBufferView(v))
      .map(([key, v]) => [key, v[source.entity]]));
    // Host fencing also detaches/despawns the player after the failed apply.
    assert.deepEqual(rolledBackEcs, { ...beforeEcs, mask: 0, kind: 0, alive: 0 });
    assert.deepEqual(world.events.slice(0, beforeEvents.length), beforeEvents);
    assert.deepEqual(world.events.slice(beforeEvents.length), [f.source, f.receiver, f.third]
      .map(player => ({ type: 'despawn', id: player.entity })));
    assert.deepEqual(client.queue, beforeQueue);
    assert.deepEqual(client.last, beforeLast); assert.equal(client.carry, beforeCarry);
    assert.equal(beforeSession.version, sessionFields.version); assert.deepEqual(beforeSession.confirmed, sessionFields.confirmed);
    assert.equal(beforeSession.last, sessionFields.last); assert.equal(host.groundAuthority.status().failed, true);
    assert.equal((await f.currentStore().loadProfile(OWNER)).data.pearls.swallowed.uid, uid,
      'local rollback does not pretend the committed SQL transaction was reversed');
  } finally { Array.prototype.push = originalPush; await host.close().catch(() => {}); }
});

function ArrayBufferBufferView(value) { return ArrayBuffer.isView(value) && !(value instanceof DataView); }
