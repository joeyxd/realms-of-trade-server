import test from 'node:test';
import assert from 'node:assert/strict';
import { DeathStaging } from '../server/deathStaging.mjs';
import { DeathDropStaging } from '../server/deathDropStaging.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { StoreError } from '../server/store.mjs';
import { setupStaging, snapshot, WORLD } from './helpers/death-staging.mjs';

const clock = (localTick=7,durableTick=2**40,worldId=WORLD) => new GroundDeadlineClock({worldId,
  sourceDomain:'durable-ground-v1',epoch:new GroundClockEpoch({localTick,durableTick})});
async function fixture(options={lawless:true,killer:true,pearlCount:3,loot:true},epoch=clock()) {
  const f=await setupStaging(undefined,options);f.world.tick=11;
  f.stage=new DeathStaging(f.sessions,f.world,WORLD,{deadlineClock:epoch});return {...f,clock:epoch};
}
const request = f => {const h=f.stage.request(f.selectors);return {h,ctx:f.stage.operations.get(h.operationId)};};

for(const options of [{pearlCount:0},{pearlCount:2,loot:true},{lawless:true,killer:true,pearlCount:9,loot:true}])
 test('new death binds durable sources to unchanged local gameplay '+JSON.stringify(options),async()=>{
  const f=await fixture(options),before=snapshot(f),{h,ctx}=request(f);
  assert.deepEqual(snapshot(f),before);assert.deepEqual(f.stage.drain(),[]);
  await f.stage.settle();assert.equal(ctx.state,'ready');assert.deepEqual(snapshot(f),before);
  assert.ok(Object.isFrozen(ctx.plan));assert.ok(Object.isFrozen(ctx.request));
  const receipt=await f.store.loadDeathOperation(h.operationId);assert.deepEqual(receipt.request,ctx.request);
  let ordinal=0;
  for(const d of ctx.plan.drops) {
    const pearl=d.kind==='pearl',q=pearl?ctx.request.pearls.find(q=>q.uid===d.pearl.uid):ctx.request.drops[ordinal++];
    assert.equal(q.ground.availableAt,f.clock.at(pearl?d.pickAt:ctx.plan.tick));
    assert.equal(q.ground[pearl?'returnAt':'expiresAt'],f.clock.at(d.t));
    assert.equal(q.ground[pearl?'returnAt':'expiresAt']-q.ground.availableAt,d.t-(pearl?d.pickAt:ctx.plan.tick));
    assert.equal(Object.hasOwn(d,'groundClock'),false);
  }
  f.world.tick=15; // Other world time may advance while these actors remain frozen.
  assert.equal(f.stage.drain()[0].state,'applied');assert.deepEqual(f.world.events,ctx.plan.events);
  for(const d of f.world.drops.values()) {
    const pearl=d.kind==='pearl',q=pearl?ctx.request.pearls.find(q=>q.uid===d.pearl.uid):ctx.request.drops[d.ordinal-1];
    const source=f.clock.assertDrop(d,pearl?'pearl':'drop',q.ground);
    assert.deepEqual(source,q.ground);assert.equal(d.pickAt,pearl?ctx.plan.drops.find(q=>q.pearl?.uid===d.pearl.uid).pickAt:11);
    assert.equal(Object.hasOwn(d.groundClock.ground,'groundClock'),false);
    if(!pearl)assert.equal(d.operationId,h.operationId);
  }
  assert.equal((await f.store.commitDeath({operationId:h.operationId,...ctx.request})).replay,true);
  assert.deepEqual(f.stage.drain(),[]);
 });

test('legacy death preserves exact raw drop shape and local storage deadlines',async()=>{
 const f=await setupStaging(),before=snapshot(f),{ctx}=request(f);await f.stage.settle();
 assert.deepEqual(snapshot(f),before);assert.equal(f.stage.drain()[0].state,'applied');
 for(const d of f.world.drops.values()) {assert.equal(Object.hasOwn(d,'groundClock'),false);
   if(d.kind!=='pearl') {assert.equal(Object.hasOwn(d,'pickAt'),false);assert.equal(ctx.request.drops[d.ordinal-1].ground.expiresAt,d.t);}}
});

test('constructor rejects another world, forged clock and Proxy without invoking caller accessors',async()=>{
 const f=await setupStaging();let calls=0;
 for(const c of [clock(0,100,'other'),Object.create(GroundDeadlineClock.prototype),
   new Proxy(clock(),{get(){calls++;throw Error('get');}})])
  assert.throws(()=>new DeathStaging(f.sessions,f.world,WORLD,{deadlineClock:c}),{code:'configuration'});
 assert.equal(calls,0);f.stage.assertPublishable(1);
});

for(const [name,c,tick] of [
 ['deadline overflow',clock(0,Number.MAX_SAFE_INTEGER-20),0],
 ['clock anchor ahead of death',clock(20,100),11],
])test('invalid '+name+' rejects before save or commit and releases reservation',async()=>{
 const f=await fixture({pearlCount:2,loot:true},c);f.world.tick=tick;const before=snapshot(f);
 let saves=0,commits=0;const save=f.sessions.save.bind(f.sessions),commit=f.sessions.commitDeath.bind(f.sessions);
 f.sessions.save=(...args)=>{saves++;return save(...args);};f.sessions.commitDeath=(...args)=>{commits++;return commit(...args);};
 assert.throws(()=>request(f),{code:'operation'});await f.stage.settle();
 assert.equal(saves,0);assert.equal(commits,0);assert.equal(f.stage.operations.size,0);assert.deepEqual(snapshot(f),before);
 f.stage.assertPublishable(1);
});

test('rewound local tick after capture fences before commit without publishing',async()=>{
 const f=await fixture(),before=snapshot(f),{h}=request(f);f.world.tick=10;await f.stage.settle();
 assert.equal((await f.store.loadDeathOperation(h.operationId)),null);assert.equal(f.stage.drain()[0].state,'fenced');
 assert.deepEqual(snapshot(f),before);
});

test('lost committed death reply recovers exact durable source and applies once at drain',async()=>{
 const f=await fixture();let calls=0;const store=f.sessions.store;
 f.sessions.store={...store,async commitDeath(r){calls++;const result=await store.commitDeath(r);if(calls===1)throw new Error('lost');return result;}};
 const before=snapshot(f),{h,ctx}=request(f);await f.stage.settle();assert.equal(ctx.state,'ready');assert.deepEqual(snapshot(f),before);
 assert.deepEqual((await f.store.loadDeathOperation(h.operationId)).request,ctx.request);
 assert.equal(f.stage.drain()[0].state,'applied');assert.deepEqual(f.stage.drain(),[]);assert.ok(calls>=1&&calls<=2);
 const drops=await f.store.listDeathDrops(WORLD);assert.equal(new Set(drops.map(d=>d.operationId+':'+d.ordinal)).size,drops.length);
});

test('private projection rejects replacement of public request before drain; committed storage remains intact',async()=>{
 const f=await fixture(),before=snapshot(f),{h,ctx}=request(f);await f.stage.settle();
 const receipt=await f.store.loadDeathOperation(h.operationId);ctx.request=structuredClone(ctx.request);
 ctx.request.drops[0].ground.expiresAt++;assert.equal(f.stage.drain()[0].state,'fenced');
 assert.deepEqual(snapshot(f),before);assert.deepEqual(await f.store.loadDeathOperation(h.operationId),receipt);
});

test('post-receipt apply failure rolls back projected drops, ECS and publication while retaining durable death',async()=>{
 const f=await fixture(),before=snapshot(f);f.stage=new DeathStaging(f.sessions,f.world,WORLD,{deadlineClock:f.clock,
 prepareInputs(){return {assertCurrent(){},apply(){throw new StoreError('effect');},assertApplied(){},rollback(){}};}});
 const {h}=request(f);await f.stage.settle();const receipt=await f.store.loadDeathOperation(h.operationId);
 assert.equal(f.stage.drain()[0].state,'fenced');assert.deepEqual(snapshot(f),before);assert.deepEqual(await f.store.loadDeathOperation(h.operationId),receipt);
});

test('new ordinary source can be picked through the same durable clock with exact ground and current time',async()=>{
 const f=await fixture(),{ctx}=request(f);await f.stage.settle();assert.equal(f.stage.drain()[0].state,'applied');
 const drop=[...f.world.drops.values()].find(d=>d.kind==='item'),e=f.killerEntity;
 f.world.ecs.x[e]=drop.x;f.world.ecs.z[e]=drop.z;f.world.tick=12;
 const stage=new DeathDropStaging(f.sessions,f.world,WORLD,{deadlineClock:f.clock});
 const h=stage.pickup({dropId:drop.id,receiver:{clientId:2,entity:e}});await stage.settle();
 const next=stage.operations.get(h.operationId);assert.equal(next.state,'ready');assert.equal(next.request.at,f.clock.at(12));
 assert.deepEqual(next.request.drop.ground,ctx.request.drops[drop.ordinal-1].ground);assert.equal(stage.drain()[0].state,'applied');
 assert.equal((await f.store.loadDeathDrop(drop.operationId,drop.ordinal)).state,'picked');
});

for(const [name,mutate] of [
 ['failed result',ctx=>{ctx.receipt={ok:false,why:'operation'};}],
 ['wrong source deadline',ctx=>{ctx.receipt=structuredClone(ctx.receipt);ctx.receipt.drops[0].ground.expiresAt++;}],
 ['replaced local plan',ctx=>{ctx.plan=structuredClone(ctx.plan);}],
])test('untrusted '+name+' after receipt fences local publication',async()=>{
 const f=await fixture(),before=snapshot(f),{h,ctx}=request(f);await f.stage.settle();
 const receipt=await f.store.loadDeathOperation(h.operationId);mutate(ctx);
 assert.equal(f.stage.drain()[0].state,'fenced');assert.deepEqual(snapshot(f),before);
 assert.deepEqual(await f.store.loadDeathOperation(h.operationId),receipt);
});
