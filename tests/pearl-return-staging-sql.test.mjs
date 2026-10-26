import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/ground-clock-sql.mjs';
import { fixture, incomingUid, WORLD, accounts, state } from './helpers/pearl-replace-staging.mjs';
import { GroundClockSession, GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { PearlReturnStaging } from '../server/pearlReturnStaging.mjs';
import { PearlPickupStaging } from '../server/pearlPickupStaging.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { StoreError } from '../server/store.mjs';
import { pearlKind } from '../server/pearlOperations.mjs';
import { PearlStartup } from '../server/pearlStartup.mjs';
import { World } from '../src/sim/world.js';
import { installInventory, attachProfile } from '../src/sim/systems/inventory.js';
import { map, A as arena } from './helpers.mjs';

const LOCAL_LEAVE = 11;
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
  const rngBefore = world.rng.state(), lootRngBefore = world.lootRng.state();
  await coordinator.start();
  assert.deepEqual(state(world), before, 'async startup leaves World untouched');
  assert.equal(coordinator.drain().state, 'ready');
  assert.equal(world.rng.state(), rngBefore, 'startup does not draw world RNG');
  assert.equal(world.lootRng.state(), lootRngBefore, 'startup does not draw loot RNG');
  return { sessions, world, coordinator };
}

test('SQL001-013 expired ground pearl returns persistently, replays once, restores, then picks up', async () => {
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

    const leave = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock: originDeadlineClock });
    leave.request({ action: 'leave', uid: incomingUid,
      source: { clientId: 1, entity: f.entities[0] } });
    await leave.settle(); assert.equal(leave.drain()[0].state, 'applied');
    await f.sessions.flush();
    const originalGround = await f.store.loadPearlLocation(incomingUid);
    assert.ok(originalGround?.ground);
    const [source] = f.world.drops.values();

    const localReturnTick = source.t + 1; // Return requires a completed tick strictly after expiry.
    f.world.tick = localReturnTick;
    const beforeReturn = state(f.world);
    const returning = new PearlReturnStaging(f.sessions, f.world, WORLD, { deadlineClock: originDeadlineClock });
    const handle = returning.return({ dropId: source.id });
    await returning.settle();
    assert.deepEqual(state(f.world), beforeReturn, 'storage completion never mutates World');
    const receipt = await f.store.loadPearlGroundOperation(handle.operationId);
    assert.ok(receipt);
    assert.equal(receipt.request.uid, incomingUid);
    assert.equal(receipt.request.kind, source.pearl.kind);
    assert.equal(receipt.request.world, WORLD);
    assert.equal(receipt.request.from, null);
    assert.equal(receipt.request.to, null);
    assert.deepEqual(receipt.request.profiles, []);
    assert.ok(receipt.request.ground);
    assert.equal(receipt.request.ground.availableAt, originDeadlineClock.at(localReturnTick + 30));
    assert.equal(receipt.request.ground.returnAt,
      originDeadlineClock.at(localReturnTick + source.t - LOCAL_LEAVE));
    assert.equal(receipt.result.location.version, originalGround.version + 1);

    const replay = await f.store.commitPearlGround({ operationId: handle.operationId, ...receipt.request });
    assert.equal(replay.replay, true);
    assert.deepEqual(await f.store.loadPearlGroundOperation(handle.operationId), receipt);
    assert.equal((await f.store.loadPearlLocation(incomingUid)).version, originalGround.version + 1,
      'exact receipt replay does not advance a second generation');
    assert.deepEqual(state(f.world), beforeReturn);

    // Apply the staged return once at the held tick boundary, then checkpoint that durable time.
    assert.deepEqual(returning.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
    assert.deepEqual(returning.drain(), []);
    assert.equal(f.world.drops.has(source.id), false);
    assert.equal(f.world.drops.size, 1);
    const [returnedDrop] = f.world.drops.values();
    assert.equal(returnedDrop.pearl.uid, incomingUid);
    assert.equal(returnedDrop.pickAt, localReturnTick + 30);
    assert.equal(returnedDrop.t, localReturnTick + source.t - LOCAL_LEAVE);
    assert.equal(f.world.pearlLedger.get(incomingUid).drop, returnedDrop.id);
    await f.sessions.flush(); await f.sessions.close(1); await f.sessions.close(2);

    await originClock.checkpoint({ operationId: clockId(2), localTick: localReturnTick });
    assert.equal(originClock.drain(localReturnTick).state, 'ready');
    const { deadlineClock } = await readyClock(f.store, LOCAL_RESTORE);
    const restored = await startup(f.store, f.database.journal, deadlineClock, LOCAL_RESTORE);
    assert.equal(restored.world.events.length, 0);
    assert.equal(restored.world.drops.size, 1);
    const [hydrated] = restored.world.drops.values();
    assert.equal(hydrated.pearl.uid, incomingUid);
    assert.equal(hydrated.x, receipt.result.location.ground.x);
    assert.equal(hydrated.z, receipt.result.location.ground.z);
    assert.equal(hydrated.pickAt, 30);
    assert.equal(hydrated.t, returnedDrop.t - localReturnTick);
    assert.deepEqual(deadlineClock.assertDrop(hydrated, 'pearl'), receipt.result.location.ground);
    assert.deepEqual(restored.world.pearlLedger.get(incomingUid),
      { owner: '', entity: 0, place: 'ground', drop: hydrated.id });

    const receiverClient = 9;
    const receiverProfile = await restored.sessions.open(receiverClient, accounts[1]);
    const receiverEntity = restored.world.spawnPlayer({ x: hydrated.x, z: hydrated.z, clientId: receiverClient });
    attachProfile(restored.world, receiverEntity, receiverProfile);
    restored.world.events.length = 0;
    restored.world.tick = hydrated.pickAt - 1;
    const pickup = new PearlPickupStaging(restored.sessions, restored.world, WORLD, { deadlineClock });
    assert.throws(() => pickup.pickup({ dropId: hydrated.id,
      receiver: { clientId: receiverClient, entity: receiverEntity } }), /ownership/);
    restored.world.tick = hydrated.pickAt;
    const pickupBefore = state(restored.world);
    const pickupHandle = pickup.pickup({ dropId: hydrated.id,
      receiver: { clientId: receiverClient, entity: receiverEntity } });
    await pickup.settle(); assert.deepEqual(state(restored.world), pickupBefore);
    assert.equal(pickup.drain()[0].state, 'applied');
    assert.deepEqual(pickup.drain(), []);
    assert.equal(restored.world.drops.size, 0);
    assert.equal(restored.world.profiles.get(receiverEntity).pearls.bag.filter(q => q.uid === incomingUid).length, 1);
    assert.deepEqual(restored.world.events.map(e => e.type), ['pickup', 'unloot']);
    const pickupReceipt = await f.store.loadPearlGroundOperation(pickupHandle.operationId);
    assert.equal(pickupReceipt.result.location.version, receipt.result.location.version + 1);
    assert.equal((await f.store.loadUnique(incomingUid)).holder, accounts[1]);
    await restored.sessions.flush(); await restored.sessions.close(receiverClient);
  } finally { await f.close(); }
});

test('SQL001-013 lost return reply retries exact target and startup recovers after fenced drain', async () => {
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
    await originClock.initialize({ operationId: clockId(11), localTick: LOCAL_LEAVE, tick: DURABLE });
    assert.equal(originClock.drain(LOCAL_LEAVE).state, 'ready');
    const originDeadlineClock = new GroundDeadlineClock({ worldId: WORLD,
      sourceDomain: 'durable-ground-v1', epoch: originClock.epoch });

    const leave = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock: originDeadlineClock });
    leave.request({ action: 'leave', uid: incomingUid,
      source: { clientId: 1, entity: f.entities[0] } });
    await leave.settle(); assert.equal(leave.drain()[0].state, 'applied');
    await f.sessions.flush();
    const [source] = f.world.drops.values();
    const returnTick = source.t + 1;
    f.world.tick = returnTick;

    // The SQL fixture's built-in lost-reply switch covers ground-clock RPCs. Simulate a lost
    // pearl commit response after the first SQL commit has durably completed.
    const commitPearlGround = f.store.commitPearlGround.bind(f.store);
    let loseReply = true;
    f.store.commitPearlGround = async request => {
      const result = await commitPearlGround(request);
      if (loseReply) { loseReply = false; throw new StoreError('unavailable'); }
      return result;
    };
    const beforeReturn = state(f.world);
    const returning = new PearlReturnStaging(f.sessions, f.world, WORLD, { deadlineClock: originDeadlineClock });
    const handle = returning.return({ dropId: source.id });
    await returning.settle();
    assert.deepEqual(state(f.world), beforeReturn, 'ambiguous commit and retry do not mutate World');
    const ctx = returning.operations.get(handle.operationId);
    assert.equal(ctx.state, 'ready');
    assert.ok(ctx.receipt);

    const commitCalls = f.database.calls.filter(call => call.name === 'mn_commit_pearl_ground' &&
      call.body.p_operation_id === handle.operationId);
    assert.equal(commitCalls.length, 2, 'the lost return reply is retried once');
    assert.deepEqual(commitCalls[1].body, commitCalls[0].body, 'retry preserves exact UUID and destination');
    assert.equal(commitCalls[1].body.p_operation_id, handle.operationId);
    assert.deepEqual(commitCalls[1].body.p_request.ground, ctx.request.ground);
    assert.deepEqual(commitCalls[1].body.p_request.profiles, []);
    const receipt = await f.store.loadPearlGroundOperation(handle.operationId);
    assert.ok(receipt);
    assert.deepEqual(receipt.request, ctx.request);
    assert.deepEqual(receipt.result.location.ground, ctx.request.ground);

    // The durable target survives, while decoration failure fences local apply and preserves its source.
    f.world.emit = () => { throw new Error('local decoration failure'); };
    assert.deepEqual(returning.drain(), [{ operationId: handle.operationId, state: 'fenced', code: 'unavailable' }]);
    assert.deepEqual(state(f.world), beforeReturn);
    assert.deepEqual((await f.store.loadPearlGroundOperation(handle.operationId)), receipt);
    await f.sessions.flush(); await f.sessions.close(1); await f.sessions.close(2);

    await originClock.checkpoint({ operationId: clockId(12), localTick: returnTick });
    assert.equal(originClock.drain(returnTick).state, 'ready');
    const { deadlineClock } = await readyClock(f.store, LOCAL_RESTORE);
    const recovered = await startup(f.store, f.database.journal, deadlineClock, LOCAL_RESTORE);
    assert.equal(recovered.world.events.length, 0, 'recovery publishes no historical events');
    assert.equal(recovered.world.drops.size, 1, 'the receipt destination installs once');
    const [hydrated] = recovered.world.drops.values();
    assert.equal(hydrated.pearl.uid, incomingUid);
    assert.equal(hydrated.x, receipt.result.location.ground.x);
    assert.equal(hydrated.z, receipt.result.location.ground.z);
    assert.deepEqual(deadlineClock.assertDrop(hydrated, 'pearl'), receipt.result.location.ground);
    assert.deepEqual(recovered.world.pearlLedger.get(incomingUid),
      { owner: '', entity: 0, place: 'ground', drop: hydrated.id });
    assert.deepEqual(recovered.coordinator.drain(), { state: 'ready', count: 1 });
    assert.equal(recovered.world.drops.size, 1, 'repeated startup drain does not duplicate the target');
  } finally { await f.close(); }
});
