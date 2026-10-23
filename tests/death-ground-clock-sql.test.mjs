import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/ground-clock-sql.mjs';
import { makeDeath, planRequest, seedDeathStore, WORLD, VICTIM, KILLER } from './helpers/death-storage.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { DeathStaging } from '../server/deathStaging.mjs';
import { GroundClockSession } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { PearlStartup } from '../server/pearlStartup.mjs';
import { DeathDropStaging } from '../server/deathDropStaging.mjs';
import { World } from '../src/sim/world.js';
import { installInventory, attachProfile } from '../src/sim/systems/inventory.js';
import { map } from './helpers.mjs';

const LOCAL_DEATH = 41;
const DURABLE_DEATH = 2 ** 32 + 10000;
const LOCAL_RESTORE = 0;
const LOCAL_CHECKPOINT = 30;
const clockId = n => `b0330000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = structuredClone;

async function adoptedClock(store, worldId, localTick) {
  const session = new GroundClockSession({ store, worldId });
  await session.load(localTick);
  if (localTick === LOCAL_DEATH) {
    assert.equal(session.drain(localTick).state, 'missing');
    await session.initialize({ operationId: clockId(1), localTick, tick: DURABLE_DEATH });
    assert.equal(session.drain(localTick).state, 'ready');
  } else {
    assert.equal(session.drain(localTick).state, 'ready');
  }
  return { session, deadlineClock: new GroundDeadlineClock({ worldId,
    sourceDomain: 'durable-ground-v1', epoch: session.epoch }) };
}

test('SQL001-013 persist new death deadlines in durable time and restore, pick, checkpoint, and omit terminal source', async () => {
  const db = await database();
  try {
    const f = makeDeath({ lawless: true, killer: true, pearlCount: 3, loot: true, seed: 117 });
    f.world.tick = LOCAL_DEATH;
    const { request: seedRequest } = planRequest(f);
    await seedDeathStore(db.store, f, seedRequest);
    const sessions = new ProfileSessions(db.store, null, { journal: db.journal(WORLD) });
    await sessions.recoverPearls();
    await sessions.open(1, VICTIM); f.world.ecs.clientId[f.entity] = 1;
    await sessions.open(2, KILLER); f.world.ecs.clientId[f.killerEntity] = 2;

    const { deadlineClock } = await adoptedClock(db.store, WORLD, LOCAL_DEATH);
    assert.deepEqual(deadlineClock.anchor, { localTick: LOCAL_DEATH, durableTick: DURABLE_DEATH });
    const stage = new DeathStaging(sessions, f.world, WORLD, { deadlineClock });
    const selectors = { victim: { clientId: 1, entity: f.entity }, killer: { clientId: 2, entity: f.killerEntity }, seq: 23 };
    const before = { profiles: clone([...f.world.profiles]), ledger: clone([...f.world.pearlLedger]),
      drops: clone([...f.world.drops]), events: clone(f.world.events), nextDrop: f.world.nextDrop,
      row: Object.fromEntries(Object.entries(f.world.ecs).filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
        .map(([key, c]) => [key, c[f.entity]])), rng: f.world.lootRng.state() };
    const handle = stage.request(selectors), ctx = stage.operations.get(handle.operationId);
    assert.deepEqual({ profiles: [...f.world.profiles], ledger: [...f.world.pearlLedger], drops: [...f.world.drops],
      events: f.world.events, nextDrop: f.world.nextDrop,
      row: Object.fromEntries(Object.entries(f.world.ecs).filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
        .map(([key, c]) => [key, c[f.entity]])), rng: f.world.lootRng.state() }, before);
    await stage.settle();
    assert.equal(ctx.state, 'ready');
    assert.deepEqual({ profiles: clone([...f.world.profiles]), ledger: clone([...f.world.pearlLedger]),
      drops: clone([...f.world.drops]), events: clone(f.world.events), nextDrop: f.world.nextDrop,
      row: Object.fromEntries(Object.entries(f.world.ecs).filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
        .map(([key, c]) => [key, c[f.entity]])), rng: f.world.lootRng.state() }, before);

    const receipt = await db.store.loadDeathOperation(handle.operationId);
    assert.ok(receipt);
    const localPlan = ctx.plan;
    assert.deepEqual(receipt.request,ctx.request);
    const storedProfiles = await Promise.all(receipt.request.profiles.map(p => db.store.loadProfile(p.id)));
    assert.equal((await db.store.commitDeath({operationId:handle.operationId,...ctx.request})).replay,true);
    assert.deepEqual(await Promise.all(receipt.request.profiles.map(p => db.store.loadProfile(p.id))),storedProfiles);
    for (const pearl of localPlan.drops.filter(d => d.kind === 'pearl')) {
      const source = receipt.request.pearls.find(q => q.uid === pearl.pearl.uid);
      assert.ok(source);
      assert.equal(source.ground.availableAt, deadlineClock.at(pearl.pickAt));
      assert.equal(source.ground.returnAt, deadlineClock.at(pearl.t));
      assert.equal(source.ground.returnAt - source.ground.availableAt, pearl.t - pearl.pickAt);
    }
    let ordinaryOrdinal = 0;
    for (const drop of localPlan.drops.filter(d => d.kind === 'item' || d.kind === 'potion')) {
      const source = receipt.request.drops[ordinaryOrdinal++];
      assert.equal(source.ordinal, ordinaryOrdinal);
      assert.equal(source.ground.availableAt, deadlineClock.at(localPlan.tick));
      assert.equal(source.ground.expiresAt, deadlineClock.at(drop.t));
      assert.equal(source.ground.expiresAt - source.ground.availableAt, drop.t - localPlan.tick);
    }
    assert.ok(localPlan.drops.some(d => d.kind === 'item'));
    assert.ok(localPlan.drops.some(d => d.kind === 'potion'));
    assert.deepEqual(await db.store.listDeathDrops(WORLD), receipt.result.drops);

    assert.deepEqual(stage.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
    const localDrops = [...f.world.drops.values()];
    for (const planDrop of localPlan.drops) {
      const live = planDrop.kind === 'pearl'
        ? localDrops.find(d => d.kind === 'pearl' && d.pearl.uid === planDrop.pearl.uid)
        : localDrops.find(d => d.operationId === handle.operationId && d.ordinal ===
          localPlan.drops.filter(q => q.kind === 'item' || q.kind === 'potion').indexOf(planDrop) + 1);
      assert.ok(live);
      assert.equal(live.pickAt, planDrop.kind === 'pearl' ? planDrop.pickAt : localPlan.tick);
      assert.equal(live.t, planDrop.t);
      assert.ok(live.groundClock, 'local source carries clock provenance');
      assert.deepEqual(deadlineClock.assertDrop(live, planDrop.kind === 'pearl' ? 'pearl' : 'drop'),
        planDrop.kind === 'pearl'
          ? receipt.request.pearls.find(q => q.uid === planDrop.pearl.uid).ground
          : receipt.request.drops[live.ordinal - 1].ground);
    }

    await sessions.close(1);await sessions.close(2);
    const { deadlineClock: restoredClock } = await adoptedClock(db.store, WORLD, LOCAL_RESTORE);
    assert.deepEqual(restoredClock.anchor, { localTick: LOCAL_RESTORE, durableTick: DURABLE_DEATH });
    const restoredSessions = new ProfileSessions(db.store, null, { journal: db.journal(WORLD) });
    await restoredSessions.recoverPearls();
    const restoredWorld = new World(118, { map, server: true }); installInventory(restoredWorld, WORLD);
    restoredWorld.tick = LOCAL_RESTORE;
    const startup = new PearlStartup({ sessions: restoredSessions, world: restoredWorld, worldId: WORLD,
      deathDrops: true, deadlineClock: restoredClock, pageSize: 2 });
    const runtimeBefore = { drops: clone([...restoredWorld.drops]), ledger: clone([...restoredWorld.pearlLedger]),
      nextDrop: restoredWorld.nextDrop, events: clone(restoredWorld.events) };
    await startup.start();
    assert.deepEqual({ drops: clone([...restoredWorld.drops]), ledger: clone([...restoredWorld.pearlLedger]),
      nextDrop: restoredWorld.nextDrop, events: clone(restoredWorld.events) }, runtimeBefore);
    assert.equal(startup.drain().state, 'ready');
    assert.equal(restoredWorld.tick,0);assert.equal(restoredWorld.events.length,0);
    for(const d of restoredWorld.drops.values()) {
      const family=d.kind==='pearl'?'pearl':'drop';
      const source=d.kind==='pearl'?receipt.request.pearls.find(q=>q.uid===d.pearl.uid):receipt.request.drops[d.ordinal-1];
      assert.deepEqual(restoredClock.assertDrop(d,family,source.ground),source.ground);
    }
    assert.equal(restoredWorld.drops.size, receipt.request.pearls.length + receipt.request.drops.length);
    const restoredItem = [...restoredWorld.drops.values()].find(d => d.kind === 'item');
    assert.ok(restoredItem);
    assert.equal(restoredItem.pickAt, restoredClock.project(receipt.request.drops[restoredItem.ordinal - 1].ground, 'drop').pickAt);
    assert.equal(restoredItem.t, restoredClock.project(receipt.request.drops[restoredItem.ordinal - 1].ground, 'drop').t);
    assert.deepEqual(restoredItem.groundClock.ground, receipt.request.drops[restoredItem.ordinal - 1].ground);

    const receiverProfile = await restoredSessions.open(3, KILLER);
    const receiver = restoredWorld.spawnPlayer({ x: restoredItem.x, z: restoredItem.z });
    attachProfile(restoredWorld, receiver, receiverProfile); restoredWorld.ecs.clientId[receiver] = 3;
    restoredWorld.tick=5;
    const pickup = new DeathDropStaging(restoredSessions, restoredWorld, WORLD, { deadlineClock: restoredClock });
    const pickupHandle = pickup.pickup({ dropId: restoredItem.id, receiver: { clientId: 3, entity: receiver } });
    await pickup.settle();
    const pickupCtx = pickup.operations.get(pickupHandle.operationId);
    assert.equal(pickupCtx.state, 'ready');
    assert.equal(pickupCtx.request.at, restoredClock.at(5));
    assert.deepEqual(pickupCtx.request.drop.ground, receipt.request.drops[restoredItem.ordinal - 1].ground);
    assert.equal(pickup.drain()[0].state, 'applied');
    assert.equal((await db.store.loadDeathDrop(handle.operationId, restoredItem.ordinal)).state, 'picked');

    const pickedProfile=await db.store.loadProfile(KILLER);
    await restoredSessions.close(3);
    const checkpoint = new GroundClockSession({ store: db.store, worldId: WORLD });
    await checkpoint.load(LOCAL_RESTORE); assert.equal(checkpoint.drain(LOCAL_RESTORE).state, 'ready');
    await checkpoint.checkpoint({ operationId: clockId(2), localTick: LOCAL_CHECKPOINT });
    assert.equal(checkpoint.drain(LOCAL_CHECKPOINT).state, 'ready');
    const nextClock = new GroundClockSession({ store: db.store, worldId: WORLD });
    await nextClock.load(0); assert.equal(nextClock.drain(0).state, 'ready');
    assert.equal(nextClock.clock.tick,DURABLE_DEATH+30);
    const nextWorld = new World(119, { map, server: true }); installInventory(nextWorld, WORLD); nextWorld.tick = 0;
    const nextSessions = new ProfileSessions(db.store, null, { journal: db.journal(WORLD) }); await nextSessions.recoverPearls();
    const nextStartup = new PearlStartup({ sessions: nextSessions, world: nextWorld, worldId: WORLD,
      deathDrops: true, deadlineClock: new GroundDeadlineClock({ worldId: WORLD,
        sourceDomain: 'durable-ground-v1', epoch: nextClock.epoch }), pageSize: 2 });
    await nextStartup.start(); assert.equal(nextStartup.drain().state, 'ready');
    assert.equal(nextWorld.tick,0);assert.equal(nextWorld.events.length,0);
    assert.equal(nextWorld.drops.size,receipt.request.pearls.length+receipt.request.drops.length-1);
    for(const d of nextWorld.drops.values()) {
      const source=d.kind==='pearl'?receipt.request.pearls.find(q=>q.uid===d.pearl.uid):receipt.request.drops[d.ordinal-1];
      assert.deepEqual(d.groundClock.ground,source.ground);
      assert.equal(d.pickAt,source.ground.availableAt-(DURABLE_DEATH+30));
      assert.equal(d.t,(source.ground.returnAt??source.ground.expiresAt)-(DURABLE_DEATH+30));
    }
    assert.deepEqual(await db.store.loadProfile(KILLER),pickedProfile);
    assert.equal([...nextWorld.drops.values()].some(d => d.operationId === handle.operationId && d.ordinal === restoredItem.ordinal), false);
  } finally { await db.close(); }
});
