import test from 'node:test';
import assert from 'node:assert/strict';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { PearlGroundHydration } from '../server/pearlGroundHydration.mjs';
import { DeathDropStaging } from '../server/deathDropStaging.mjs';
import { stepDrops } from '../src/sim/systems/inventory.js';
import { DeathDropLifecycle, managedDeathDrop } from '../server/deathDropLifecycle.mjs';
import { fixture, runtimeState, WORLD } from './helpers/death-drop-hydration-contract.mjs';
import { setupDropStaging, memoryDropQueueSetup, finish, requestPickup } from './helpers/death-drop-staging.mjs';

const deadlineClock = (localTick, durableTick) => new GroundDeadlineClock({ worldId: WORLD,
  sourceDomain: 'durable-ground-v1', epoch: new GroundClockEpoch({ localTick, durableTick }) });
const sourceGround = (f) => f.source.request.drops.find((row) => row.kind === f.drop.kind && row.ordinal === f.drop.ordinal).ground;
const bindProjectedDrop = (f, clock) => {
  const projection = clock.project(sourceGround(f), 'drop');
  Object.assign(f.drop, projection);
  f.world.tick = 0;
  f.stage = new DeathDropStaging(f.sessions, f.world, WORLD, { deadlineClock: clock });
  return projection;
};

test('combined hydration projects signed past and future deadlines and applies only at drain', async () => {
  const f = await fixture({ pearls: 4, sources: 1, worldTick: 0 });
  const clock = deadlineClock(0, 100), before = runtimeState(f.world);
  try {
    const hydration = new PearlGroundHydration({ sessions: f.sessions, world: f.world, worldId: WORLD,
      deathDrops: true, deadlineClock: clock });
    assert.deepEqual(await hydration.start(), { state: 'ready', count: 4 +
      f.scenarios[0].death.drops.filter((d) => ['item', 'potion'].includes(d.kind)).length });
    assert.deepEqual(runtimeState(f.world), before, 'async reads and projection do not publish into World');
    const result = hydration.drain();
    assert.equal(result.state, 'applied');
    const pearlRows = [...f.world.drops.values()].filter((d) => d.kind === 'pearl');
    assert.equal(pearlRows.length, 4);
    assert.equal(pearlRows[0].pickAt, -98);
    assert.equal(pearlRows[0].t, -85);
    assert.ok(pearlRows.some((d) => d.pickAt > 0 && d.t > 0), 'later durable deadlines project into the future');
    const source = f.scenarios[0];
    for (const raw of source.death.drops.filter((d) => ['item', 'potion'].includes(d.kind))) {
      const live = [...f.world.drops.values()].find((d) => d.operationId === source.request.operationId && d.ordinal === raw.ordinal);
      assert.equal(live.t, clock.project(raw.ground, 'drop').t);
      assert.equal(live.pickAt, clock.project(raw.ground, 'drop').pickAt);
      assert.deepEqual(live.groundClock, clock.project(raw.ground, 'drop').groundClock);
    }
    assert.deepEqual(hydration.drain(), result);
  } finally { await f.close(); }
});

test('pickup is inclusive at pickAt and stores the original durable ground and mapped operation time', async () => {
  const f = await setupDropStaging(memoryDropQueueSetup, { source: 8101 });
  try {
    const ground = sourceGround(f), clock = deadlineClock(10, ground.availableAt - 2);
    const projected = bindProjectedDrop(f, clock);
    f.world.tick = projected.pickAt;
    const handle = requestPickup(f);
    await finish(f, handle);
    const ctx = f.stage.operations.get(handle.operationId);
    assert.equal(ctx.request.at, clock.at(projected.pickAt));
    assert.equal(ctx.request.at, ground.availableAt);
    assert.deepEqual(ctx.request.drop.ground, ground);
    assert.deepEqual(ctx.sourceGround, ground);
    assert.equal(ctx.request.drop.ground.expiresAt, ground.expiresAt);
    assert.equal(f.world.drops.has(f.dropId), true, 'durable success waits for the apply drain');
    assert.equal(f.stage.drain()[0].state, 'applied');
  } finally { await f.close?.(); }
});

test('expiry remains strict at t and removes an already expired signed deadline through lifecycle drain', async () => {
  const f = await setupDropStaging(memoryDropQueueSetup, { source: 8102 });
  try {
    const ground = sourceGround(f), clock = deadlineClock(0, ground.expiresAt - 20);
    const projected = bindProjectedDrop(f, clock);
    assert.equal(projected.t, 20);
    f.world.tick = projected.t;
    assert.throws(() => f.stage.expire({ dropId: f.dropId }), { code: 'ownership' });
  } finally { await f.close?.(); }
});

test('lifecycle expires a negative local deadline using the durable source ground', async () => {
  const f = await setupDropStaging(memoryDropQueueSetup, { source: 8103 });
  try {
    const ground = sourceGround(f), clock = deadlineClock(0, ground.expiresAt + 20);
    const projected = bindProjectedDrop(f, clock);
    assert.equal(projected.t, -20);
    const server = { world: f.world, assertDropApplyBoundary() {}, holdDropPublication() {} };
    const lifecycle = new DeathDropLifecycle(server, f.stage);
    assert.equal(lifecycle.drain(), false);
    const [ctx] = [...f.stage.operations.values()];
    await finish(f, { operationId: ctx.operationId });
    assert.equal(ctx.request.at, clock.at(0));
    assert.equal(ctx.request.at, ground.expiresAt + 20);
    assert.deepEqual(ctx.request.drop.ground, ground);
    assert.equal(lifecycle.drain(false), true);
    assert.equal(f.world.drops.has(f.dropId), false);
    assert.equal((await f.store.loadDeathDrop(f.drop.operationId, f.drop.ordinal)).state, 'expired');
  } finally { await f.close?.(); }
});

test('deadline staging rejects forged marker domain, anchor, and projected fields before dispatch', async (t) => {
  for (const [index, mutation] of [
    ['wrong domain', (drop) => { drop.groundClock.domain = 'other-clock'; }],
    ['wrong anchor', (drop) => { drop.groundClock.anchor.durableTick++; }],
    ['projection disagrees with marker', (drop) => { drop.t++; }],
    ['marker ground disagrees with durable source', (drop) => { drop.groundClock.ground.x++; }],
  ].entries()) await t.test(mutation[0], async () => {
    const f = await setupDropStaging(memoryDropQueueSetup, { source: 8110 + index });
    try {
      const ground = sourceGround(f), clock = deadlineClock(10, ground.availableAt - 2);
      const projected = clock.project(ground, 'drop');
      Object.assign(f.drop, projected);
      mutation[1](f.drop);
      f.world.tick = projected.pickAt;
      f.stage = new DeathDropStaging(f.sessions, f.world, WORLD, { deadlineClock: clock });
      let sends = 0;
      const commit = f.sessions.store.commitDeathDrop.bind(f.sessions.store);
      f.sessions.store.commitDeathDrop = async (...args) => { sends++; return commit(...args); };
      assert.throws(() => requestPickup(f), { code: 'operation' });
      assert.equal(sends, 0);
      assert.equal(f.stage.operations.size, 0);
    } finally { await f.close?.(); }
  });
});

test('hydration refuses a simultaneous legacy mapper when the durable clock is supplied', async () => {
  const f = await fixture({ pearls: 1, sources: 0, worldTick: 0 });
  try {
    assert.throws(() => new PearlGroundHydration({ sessions: f.sessions, world: f.world, worldId: WORLD,
      mapClock: (ground) => ({ availableAt: ground.availableAt, returnAt: ground.returnAt }),
      deadlineClock: deadlineClock(0, 100) }), { code: 'configuration' });
  } finally { await f.close(); }
});

test('legacy staging refuses a projected source rather than mixing local and durable clocks',async()=>{
  const f=await setupDropStaging(memoryDropQueueSetup,{source:8130});
  try {
    Object.assign(f.drop,deadlineClock(0,0).project(sourceGround(f),'drop'));
    assert.throws(()=>requestPickup(f),{code:'configuration'});
    assert.equal(f.stage.operations.size,0);
    assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'ground');
  } finally {await f.close?.();}
});

test('a consistently forged source geometry is rejected against current storage before consumption',async()=>{
  const f=await setupDropStaging(memoryDropQueueSetup,{source:8131});
  try {
    const source=sourceGround(f),clock=deadlineClock(0,source.availableAt),fake={...source,x:source.x+1};
    f.drop.x=fake.x;Object.assign(f.drop,clock.project(fake,'drop'));f.world.tick=0;
    f.world.ecs.x[f.receiver]=fake.x;f.stage=new DeathDropStaging(f.sessions,f.world,WORLD,{deadlineClock:clock});
    let sends=0;const original=f.sessions.store.commitDeathDrop;
    f.sessions.store.commitDeathDrop=async(...args)=>{sends++;return original(...args);};
    const handle=requestPickup(f);await f.stage.settle();
    assert.equal(f.stage.drain()[0].state,'fenced');assert.equal(sends,0);
    assert.equal(f.world.drops.has(f.dropId),true);assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'ground');
    assert.equal(await f.store.loadDeathDropOperation(handle.operationId),null);
  } finally {await f.close?.();}
});

test('a provenance change after a confirmed receipt fences local publication while retaining the result',async()=>{
  const f=await setupDropStaging(memoryDropQueueSetup,{source:8132});
  try {
    const source=sourceGround(f),clock=deadlineClock(0,source.availableAt);bindProjectedDrop(f,clock);
    const handle=requestPickup(f);await finish(f,handle);f.drop.groundClock.anchor.durableTick++;
    assert.equal(f.stage.drain()[0].state,'fenced');assert.equal(f.world.drops.has(f.dropId),true);
    assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'picked');
    assert.ok(await f.store.loadDeathDropOperation(handle.operationId));
  } finally {await f.close?.();}
});

test('clock provenance prevents native fallback when both source identity fields are lost',async()=>{
  const f=await setupDropStaging(memoryDropQueueSetup,{source:8133});
  try {
    const source=sourceGround(f),clock=deadlineClock(0,source.expiresAt+20);bindProjectedDrop(f,clock);
    delete f.drop.operationId;delete f.drop.ordinal;f.world.isDeathDropManaged=managedDeathDrop;
    assert.equal(managedDeathDrop(f.drop),true);stepDrops(f.world);assert.equal(f.world.drops.has(f.dropId),true);
    const lifecycle=new DeathDropLifecycle({world:f.world,assertDropApplyBoundary(){},holdDropPublication(){}},f.stage);
    assert.throws(()=>lifecycle.drain(),{code:'identity'});assert.equal(f.world.drops.has(f.dropId),true);
    assert.equal(f.stage.operations.size,0);
  } finally {await f.close?.();}
});
