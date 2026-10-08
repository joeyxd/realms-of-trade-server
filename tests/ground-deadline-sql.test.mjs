import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/ground-clock-sql.mjs';
import { fixture, runtimeState, WORLD } from './helpers/death-drop-hydration-contract.mjs';
import { KILLER } from './helpers/death-storage.mjs';
import { GroundClockSession } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { PearlStartup } from '../server/pearlStartup.mjs';
import { DeathDropStaging } from '../server/deathDropStaging.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { World } from '../src/sim/world.js';
import { installInventory, attachProfile } from '../src/sim/systems/inventory.js';
import { map } from './helpers.mjs';

const id=n=>'d0330000-0000-4000-8000-'+String(n).padStart(12,'0');

test('SQL001–013 restore into fresh local ticks, pick using durable time, and omit the terminal source next startup',async()=>{
  const f=await fixture({backend:database,pearls:2,sources:1,worldTick:0});
  try {
    // This fixture explicitly declares its seeded numeric deadlines in the durable domain.
    assert.equal((await f.store.commitGroundClock({operationId:id(1),world:WORLD,expectedVersion:0,expectedTick:0,tick:100})).ok,true);
    const session=new GroundClockSession({store:f.store,worldId:WORLD});await session.load(0);session.drain(0);
    const deadlineClock=new GroundDeadlineClock({worldId:WORLD,sourceDomain:'durable-ground-v1',epoch:session.epoch});
    const startup=new PearlStartup({sessions:f.sessions,world:f.world,worldId:WORLD,deathDrops:true,deadlineClock,pageSize:2});
    const before=runtimeState(f.world);await startup.start();assert.deepEqual(runtimeState(f.world),before);
    assert.equal(startup.ready,false);assert.equal(startup.drain().state,'ready');
    const source=f.scenarios[0].itemDrop,d=[...f.world.drops.values()].find(d=>d.operationId===source.operationId&&d.ordinal===source.ordinal);
    assert.ok(d);assert.equal(d.pickAt,source.ground.availableAt-100);assert.equal(d.t,source.ground.expiresAt-100);
    assert.deepEqual(d.groundClock.ground,source.ground);
    const profile=await f.sessions.open(2,KILLER),entity=f.world.spawnPlayer({x:d.x,z:d.z});attachProfile(f.world,entity,profile);
    f.world.ecs.clientId[entity]=2;f.world.events.length=0;
    let sent;const base=f.sessions.store;f.sessions.store={...base,commitDeathDrop:async request=>{sent=structuredClone(request);return base.commitDeathDrop(request);}};
    const stage=new DeathDropStaging(f.sessions,f.world,WORLD,{deadlineClock}),old=structuredClone(d);
    const handle=stage.pickup({dropId:d.id,receiver:{clientId:2,entity}});await stage.settle();
    assert.equal(stage.operations.get(handle.operationId).state,'ready');assert.deepEqual(d,old);
    assert.equal(sent.at,100);assert.deepEqual(sent.drop.ground,source.ground);assert.equal(stage.drain()[0].state,'applied');
    const receipt=await f.store.loadDeathDropOperation(handle.operationId);assert.equal(receipt.request.at,100);
    assert.deepEqual(receipt.request.drop.ground,source.ground);assert.equal((await f.store.loadDeathDrop(source.operationId,source.ordinal)).state,'picked');
    const profileAfter=await f.store.loadProfile(KILLER);assert.equal((await f.store.commitDeathDrop(sent)).replay,true);
    assert.deepEqual(await f.store.loadProfile(KILLER),profileAfter);
    await session.checkpoint({operationId:id(2),localTick:60});session.drain(60);
    await f.sessions.close(2);
    const fresh=new GroundClockSession({store:f.store,worldId:WORLD});await fresh.load(0);fresh.drain(0);assert.equal(fresh.clock.tick,160);
    const world=new World(71,{map,server:true});installInventory(world,WORLD);
    const sessions=new ProfileSessions(f.store,null,{journal:f.db.journal(WORLD)});
    const nextClock=new GroundDeadlineClock({worldId:WORLD,sourceDomain:'durable-ground-v1',epoch:fresh.epoch});
    const next=new PearlStartup({sessions,world,worldId:WORLD,deathDrops:true,deadlineClock:nextClock,pageSize:2});
    await next.start();assert.equal(next.drain().state,'ready');assert.equal(world.tick,0);
    assert.equal([...world.drops.values()].some(q=>q.operationId===source.operationId&&q.ordinal===source.ordinal),false);
    for(const q of world.drops.values()) {assert.equal(q.pickAt,q.groundClock.ground.availableAt-160);assert.equal(q.t,(q.groundClock.ground.expiresAt??q.groundClock.ground.returnAt)-160);}
    assert.equal(world.events.length,0);assert.deepEqual(await f.store.loadProfile(KILLER),profileAfter);
  } finally {await f.close();}
});
