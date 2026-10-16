import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/ground-clock-sql.mjs';
import { fixture, incomingUid, WORLD, accounts, state } from './helpers/pearl-replace-staging.mjs';
import { GroundClockSession, GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { PearlPickupStaging } from '../server/pearlPickupStaging.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { pearlKind } from '../server/pearlOperations.mjs';
import { PearlStartup } from '../server/pearlStartup.mjs';
import { World } from '../src/sim/world.js';
import { installInventory, attachProfile } from '../src/sim/systems/inventory.js';
import { map, A as arena } from './helpers.mjs';

const LOCAL_LEAVE = 11;
const LOCAL_AVAILABILITY = LOCAL_LEAVE + 30;
const LOCAL_RESTORE = 0;
const DURABLE = 2 ** 32 + 5000;
const clockId = n => `c0440000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function readyClock(store, localTick) {
  const session = new GroundClockSession({ store, worldId: WORLD });
  await session.load(localTick);
  assert.equal(session.drain(localTick).state, 'ready');
  return { session, deadlineClock: new GroundDeadlineClock({ worldId: WORLD,
    sourceDomain: 'durable-ground-v1', epoch: session.epoch }) };
}

async function startup(store, journal, deadlineClock, tick) {
  const sessions = new ProfileSessions(store, null, { journal });
  await sessions.recoverPearls();
  const world = new World(304, { map, server: true });
  installInventory(world, WORLD); world.tick = tick; world.events.length = 0;
  const coordinator = new PearlStartup({ sessions, world, worldId: WORLD, deadlineClock });
  const before = state(world);
  await coordinator.start();
  assert.deepEqual(state(world), before, 'async startup leaves World untouched');
  assert.equal(coordinator.drain().state, 'ready');
  return { sessions, world, coordinator };
}

test('SQL001-013 leave restores at availability and persistent pearl pickup applies once', async () => {
  const backend = async () => {
    const db = await database();
    return { ...db, journal: db.journal(WORLD) };
  };
  const f = await fixture({ backend });
  try {
    f.world.tick = LOCAL_LEAVE;
    const originClock = new GroundClockSession({ store: f.store, worldId: WORLD });
    await originClock.load(LOCAL_LEAVE);
    assert.equal(originClock.drain(LOCAL_LEAVE).state, 'missing');
    await originClock.initialize({ operationId: clockId(1), localTick: LOCAL_LEAVE, tick: DURABLE });
    assert.equal(originClock.drain(LOCAL_LEAVE).state, 'ready');
    const originDeadlineClock = new GroundDeadlineClock({ worldId: WORLD,
      sourceDomain: 'durable-ground-v1', epoch: originClock.epoch });

    f.staging = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock: originDeadlineClock });
    const leaveBefore = state(f.world);
    const leave = f.staging.request({ action: 'leave', uid: incomingUid,
      source: { clientId: 1, entity: f.entities[0] } });
    await f.staging.settle();
    assert.deepEqual(state(f.world), leaveBefore, 'leave receipt waits for drain');
    assert.equal(f.staging.drain()[0].state, 'applied');
    const groundRow = await f.store.loadPearlLocation(incomingUid);
    assert.ok(groundRow?.ground);
    assert.equal(groundRow.ground.availableAt, originDeadlineClock.at(LOCAL_AVAILABILITY));
    assert.equal((await f.store.loadPearlGroundOperation(leave.operationId)).request.ground.availableAt,
      groundRow.ground.availableAt);
    await f.sessions.flush();
    await f.sessions.close(1); await f.sessions.close(2);

    // Checkpoint exactly at the durable availability deadline, then restore a fresh local World at tick zero.
    f.world.tick = LOCAL_AVAILABILITY;
    await originClock.checkpoint({ operationId: clockId(2), localTick: LOCAL_AVAILABILITY });
    assert.equal(originClock.drain(LOCAL_AVAILABILITY).state, 'ready');
    const { session: restoredClock, deadlineClock } = await readyClock(f.store, LOCAL_RESTORE);
    const restored = await startup(f.store, f.database.journal, deadlineClock, LOCAL_RESTORE);
    assert.equal(restored.world.events.length, 0);
    assert.equal(restored.world.drops.size, 1);
    const [drop] = restored.world.drops.values();
    assert.equal(drop.pearl.uid, incomingUid);
    assert.equal(drop.pickAt, LOCAL_RESTORE, 'availability deadline is exactly the restored local tick');
    assert.deepEqual(deadlineClock.assertDrop(drop, 'pearl', groundRow.ground), groundRow.ground);
    assert.deepEqual(restored.world.pearlLedger.get(incomingUid),
      { owner: '', entity: 0, place: 'ground', drop: drop.id });

    // Admission happens only after startup's recovery/hydration barrier has drained.
    const receiverClient = 9;
    const receiverProfile = await restored.sessions.open(receiverClient, accounts[1]);
    const receiverEntity = restored.world.spawnPlayer({ x: drop.x, z: drop.z, clientId: receiverClient });
    attachProfile(restored.world, receiverEntity, receiverProfile);
    restored.world.events.length = 0; restored.world.profileDirty.clear();
    const pickup = new PearlPickupStaging(restored.sessions, restored.world, WORLD, { deadlineClock });
    const beforePickup = state(restored.world);
    const handle = pickup.pickup({ dropId: drop.id,
      receiver: { clientId: receiverClient, entity: receiverEntity } });
    await pickup.settle();
    assert.deepEqual(state(restored.world), beforePickup, 'receipt does not mutate World before synchronous drain');

    const receipt = await f.store.loadPearlGroundOperation(handle.operationId);
    assert.ok(receipt);
    assert.equal(receipt.request.uid, incomingUid);
    assert.equal(receipt.request.kind, drop.pearl.kind);
    assert.equal(receipt.request.world, WORLD);
    assert.equal(receipt.request.ground, null);
    assert.equal(receipt.result.location.ground, null);
    assert.equal(receipt.result.location.version, groundRow.version + 1);
    assert.deepEqual(await f.store.loadPearlLocation(incomingUid),
      { world: receipt.result.location.world, ground: receipt.result.location.ground, version: receipt.result.location.version });
    assert.deepEqual(await f.store.loadUnique(incomingUid),
      { kind: pearlKind(receipt.request.kind), holder: accounts[1], version: receipt.result.location.version });

    const profileBeforeReplay = await f.store.loadProfile(accounts[1]);
    const replay = await f.store.commitPearlGround({ operationId: handle.operationId, ...receipt.request });
    assert.equal(replay.replay, true);
    assert.deepEqual(await f.store.loadProfile(accounts[1]), profileBeforeReplay);
    assert.deepEqual(await f.store.loadPearlGroundOperation(handle.operationId), receipt);
    assert.deepEqual(state(restored.world), beforePickup);

    assert.deepEqual(pickup.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
    assert.deepEqual(pickup.drain(), []);
    assert.equal(restored.world.drops.has(drop.id), false);
    assert.deepEqual(restored.world.pearlLedger.get(incomingUid),
      { owner: `account:${accounts[1]}`, entity: receiverEntity, place: 'profile' });
    assert.equal(restored.world.profiles.get(receiverEntity).pearls.bag.filter(q => q.uid === incomingUid).length, 1);
    assert.deepEqual(restored.world.events.map(e => e.type), ['pickup', 'unloot']);
    await restored.sessions.flush();
    await restored.sessions.close(receiverClient);

    // A fresh startup sees no ground source; reopening the account recovers the single held UID.
    const afterPickup = await startup(f.store, f.database.journal, deadlineClock, LOCAL_RESTORE);
    assert.equal(afterPickup.world.drops.size, 0);
    assert.equal(afterPickup.world.pearlLedger.has(incomingUid), false);
    const reopenedClient = 10;
    const reopenedProfile = await afterPickup.sessions.open(reopenedClient, accounts[1]);
    const reopenedEntity = afterPickup.world.spawnPlayer({ x: arena.x, z: arena.z, clientId: reopenedClient });
    attachProfile(afterPickup.world, reopenedEntity, reopenedProfile);
    assert.equal(afterPickup.world.profiles.get(reopenedEntity).pearls.bag.filter(q => q.uid === incomingUid).length, 1);
    assert.deepEqual(await f.store.loadPearlLocation(incomingUid),
      { world: receipt.result.location.world, ground: receipt.result.location.ground, version: receipt.result.location.version });
    assert.deepEqual(await f.store.loadUnique(incomingUid),
      { kind: pearlKind(receipt.request.kind), holder: accounts[1], version: receipt.result.location.version });
    await afterPickup.sessions.close(reopenedClient);
    assert.equal(restoredClock.ready, true);
  } finally { await f.close(); }
});


test('SQL001-013 pickup to an existing pearl holder preserves other bag and swallowed holdings', async () => {
  const backend = async () => { const db = await database(); return { ...db, journal: db.journal(WORLD) }; };
  const f = await fixture({ backend });
  try {
    f.world.tick = LOCAL_LEAVE;
    const deadlineClock = new GroundDeadlineClock({ worldId: WORLD, sourceDomain: 'durable-ground-v1',
      epoch: new GroundClockEpoch({ localTick: LOCAL_LEAVE, durableTick: DURABLE }) });
    const leave = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock });
    leave.request({ action: 'leave', uid: incomingUid, source: { clientId: 1, entity: f.entities[0] } });
    await leave.settle(); assert.equal(leave.drain()[0].state, 'applied'); await f.sessions.flush();
    const [drop] = f.world.drops.values(), entity = f.entities[0], beforePearls = structuredClone(f.world.profiles.get(entity).pearls);
    f.world.tick = drop.pickAt; f.world.ecs.x[entity] = drop.x; f.world.ecs.z[entity] = drop.z;
    const pickup = new PearlPickupStaging(f.sessions, f.world, WORLD, { deadlineClock });
    const before = state(f.world), handle = pickup.pickup({ dropId: drop.id, receiver: { clientId: 1, entity } });
    await pickup.settle(); assert.deepEqual(state(f.world), before);
    assert.equal(pickup.operations.get(handle.operationId).state, 'ready'); assert.equal(pickup.drain()[0].state, 'applied');
    assert.deepEqual(f.world.profiles.get(entity).pearls, { ...beforePearls, bag: [...beforePearls.bag, drop.pearl] });
    await f.sessions.flush(); assert.deepEqual((await f.store.loadProfile(accounts[0])).data.pearls, f.world.profiles.get(entity).pearls);
    assert.equal((await f.store.loadUnique(incomingUid)).holder, accounts[0]); assert.equal(f.world.drops.size, 0);
    assert.deepEqual(pickup.drain(), []);
  } finally { await f.close(); }
});
