import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/ground-clock-sql.mjs';
import { fixture, incomingUid, WORLD, accounts, state } from './helpers/pearl-replace-staging.mjs';
import { GroundClockSession } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { PearlStartup } from '../server/pearlStartup.mjs';
import { World } from '../src/sim/world.js';
import { installInventory } from '../src/sim/systems/inventory.js';
import { map } from './helpers.mjs';

const LOCAL_LEAVE = 11;
const LOCAL_RESTORE = 0;
const LOCAL_CHECKPOINT = 60;
const DURABLE = 2 ** 32 + 5000;
const clockId = n => `c0330000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = structuredClone;

async function loadClock(store, localTick) {
  const session = new GroundClockSession({ store, worldId: WORLD });
  await session.load(localTick);
  assert.equal(session.drain(localTick).state, 'ready');
  return { session, deadlineClock: new GroundDeadlineClock({ worldId: WORLD,
    sourceDomain: 'durable-ground-v1', epoch: session.epoch }) };
}

async function startup(store, journal, deadlineClock, tick) {
  const sessions = new ProfileSessions(store, null, { journal });
  await sessions.recoverPearls();
  const world = new World(303, { map, server: true });
  installInventory(world, WORLD); world.tick = tick; world.events.length = 0;
  const coordinator = new PearlStartup({ sessions, world, worldId: WORLD, deadlineClock });
  const before = state(world);
  await coordinator.start();
  assert.deepEqual(state(world), before, 'asynchronous hydration leaves World untouched');
  assert.equal(coordinator.drain().state, 'ready');
  return { sessions, world, coordinator };
}

test('SQL001-013 leave writes durable ground and restores exact local projections across checkpoint', async () => {
  const backend = async () => {
    const db = await database();
    return { ...db, journal: db.journal(WORLD) };
  };
  const f = await fixture({ backend });
  try {
    f.world.tick = LOCAL_LEAVE;
    const clockSession = new GroundClockSession({ store: f.store, worldId: WORLD });
    await clockSession.load(LOCAL_LEAVE);
    assert.equal(clockSession.drain(LOCAL_LEAVE).state, 'missing');
    await clockSession.initialize({ operationId: clockId(1), localTick: LOCAL_LEAVE, tick: DURABLE });
    assert.equal(clockSession.drain(LOCAL_LEAVE).state, 'ready');
    const deadlineClock = new GroundDeadlineClock({ worldId: WORLD, sourceDomain: 'durable-ground-v1',
      epoch: clockSession.epoch });
    assert.deepEqual(deadlineClock.anchor, { localTick: LOCAL_LEAVE, durableTick: DURABLE });

    f.staging = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock });
    const before = state(f.world);
    const handle = f.staging.request({ action: 'leave', uid: incomingUid,
      source: { clientId: 1, entity: f.entities[0] } });
    const ctx = f.staging.operations.get(handle.operationId);
    assert.deepEqual(state(f.world), before, 'capture and pending IO do not mutate World');
    assert.deepEqual(f.staging.drain(), []);
    await f.staging.settle();
    assert.equal(ctx.state, 'ready');
    assert.deepEqual(state(f.world), before, 'storage receipt waits for the synchronous drain');

    const local = ctx.plan.drop;
    assert.ok(local.groundClock);
    const durableGround = { x: local.x, z: local.z,
      availableAt: deadlineClock.at(LOCAL_LEAVE + 30), returnAt: deadlineClock.at(local.t) };
    assert.deepEqual(ctx.plan.meta.ground, durableGround);
    assert.equal(local.pickAt, LOCAL_LEAVE + 30);
    assert.equal(local.t - local.pickAt, durableGround.returnAt - durableGround.availableAt);
    assert.deepEqual(deadlineClock.assertDrop(local, 'pearl', durableGround), durableGround);

    const receipt = await f.store.loadPearlGroundOperation(handle.operationId);
    assert.ok(receipt);
    assert.deepEqual(receipt.request.ground, durableGround);
    assert.equal(receipt.request.uid, incomingUid);
    assert.equal(receipt.request.kind, local.pearl.kind);
    assert.equal((await f.store.loadUnique(incomingUid)).holder, null);
    assert.deepEqual((await f.store.loadPearlLocation(incomingUid)),
      { world: WORLD, ground: durableGround, version: receipt.result.location.version });

    const beforeReplay = await f.store.loadProfile(accounts[0]);
    const committed = await f.store.commitPearlGround({ operationId: handle.operationId, ...receipt.request });
    assert.equal(committed.replay, true);
    assert.deepEqual(await f.store.loadProfile(accounts[0]), beforeReplay);
    assert.deepEqual(await f.store.loadPearlGroundOperation(handle.operationId), receipt);
    assert.deepEqual(state(f.world), before);

    assert.deepEqual(f.staging.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
    const created = [...f.world.drops.values()].find(d => d.kind === 'pearl' && d.pearl.uid === incomingUid);
    assert.ok(created);
    assert.equal(created.pickAt, local.pickAt); assert.equal(created.t, local.t);
    assert.deepEqual(deadlineClock.assertDrop(created, 'pearl', receipt.request.ground), receipt.request.ground);
    assert.deepEqual(f.world.pearlLedger.get(incomingUid), { owner: '', entity: 0, place: 'ground', drop: created.id });
    assert.equal(f.world.events.filter(e => e.type === 'loot').length, 1);
    assert.equal(f.world.events.filter(e => e.type === 'pearlChanged' && e.op === 'leave').length, 1);
    await f.sessions.flush();
    const profileAfterLeave = await f.store.loadProfile(accounts[0]);
    assert.equal(profileAfterLeave.data.pearls.bag.some(q => q.uid === incomingUid), false);
    assert.deepEqual(await f.sessions.close(1), undefined);
    await f.sessions.close(2);

    const { session: restoredClockSession, deadlineClock: restoredClock } = await loadClock(f.store, LOCAL_RESTORE);
    const restored = await startup(f.store, f.database.journal, restoredClock, LOCAL_RESTORE);
    assert.equal(restored.world.events.length, 0, 'hydration republishes no historical leave events');
    assert.equal(restored.world.drops.size, 1);
    let [hydrated] = restored.world.drops.values();
    assert.equal(hydrated.pearl.uid, incomingUid);
    assert.deepEqual(restoredClock.assertDrop(hydrated, 'pearl', receipt.request.ground), receipt.request.ground);
    assert.equal(hydrated.pickAt, receipt.request.ground.availableAt - DURABLE + LOCAL_RESTORE);
    assert.equal(hydrated.t, receipt.request.ground.returnAt - DURABLE + LOCAL_RESTORE);
    assert.equal(hydrated.t - hydrated.pickAt, local.t - local.pickAt);

    restored.world.tick = LOCAL_CHECKPOINT;
    await restoredClockSession.checkpoint({ operationId: clockId(2), localTick: LOCAL_CHECKPOINT });
    assert.equal(restoredClockSession.drain(LOCAL_CHECKPOINT).state, 'ready');
    const { deadlineClock: afterCheckpointClock } = await loadClock(f.store, LOCAL_RESTORE);
    const afterCheckpoint = await startup(f.store, f.database.journal, afterCheckpointClock, LOCAL_RESTORE);
    assert.equal(afterCheckpoint.world.events.length, 0);
    assert.equal(afterCheckpoint.world.drops.size, 1);
    [hydrated] = afterCheckpoint.world.drops.values();
    assert.ok(hydrated.pickAt < 0, 'checkpointed local time places availability in the past');
    assert.deepEqual(afterCheckpointClock.assertDrop(hydrated, 'pearl', receipt.request.ground), receipt.request.ground);
    assert.equal(hydrated.t - hydrated.pickAt, local.t - local.pickAt);
    assert.deepEqual(await f.store.loadPearlLocation(incomingUid),
      { world: WORLD, ground: durableGround, version: receipt.result.location.version });
  } finally { await f.close(); }
});
