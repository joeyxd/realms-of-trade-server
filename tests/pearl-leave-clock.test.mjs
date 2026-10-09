import test from 'node:test';
import assert from 'node:assert/strict';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { StoreError } from '../server/store.mjs';
import { leavePearl } from '../src/sim/systems/pearls.js';
import { fixture, WORLD, accounts, incomingUid, deferred, state } from './helpers/pearl-replace-staging.mjs';

const clone = structuredClone;
const clock = (anchor = {localTick:7,durableTick:2**40}, worldId = WORLD) => new GroundDeadlineClock({
  worldId, sourceDomain:'durable-ground-v1', epoch:new GroundClockEpoch(anchor)});
const source = (f,i=0) => ({clientId:i+1,entity:f.entities[i]});
const command = f => ({action:'leave',uid:incomingUid,source:source(f)});
async function setup(options = {}, deadlineClock = clock()) {
  const f = await fixture(options); f.world.tick=11; f.clock=deadlineClock;
  f.staging=new PearlStaging(f.sessions,f.world,WORLD,{deadlineClock}); return f;
}
function helper(f) {
  const w=f.world, view={ecs:clone(w.ecs),map:w.map,raftDeck:w.raftDeck,tick:w.tick,nextDrop:1,
    drops:new Map(),profiles:clone(w.profiles),pearlLedger:new Map(),profileDirty:new Set(),events:[],
    emit(ev){this.events.push(clone(ev));}};
  assert.equal(leavePearl(view,f.entities[0],incomingUid),true);return view;
}
async function ready(f) {
  const handle=f.staging.request(command(f));await f.staging.settle();
  const ctx=f.staging.operations.get(handle.operationId);assert.equal(ctx.state,'ready');return {handle,ctx};
}

test('leave maps durable ground before IO and preserves local helper windows/events until one drain',async()=>{
  const entered=deferred(), release=deferred(); let sent;
  const f=await setup({wrapStore:base=>({...base,async commitPearlGround(raw){
    sent=clone(raw);const result=await base.commitPearlGround(raw);entered.resolve();await release.promise;return result;}})});
  try {
    const expected=helper(f), before=state(f.world), h=f.staging.request(command(f));
    assert.deepEqual(state(f.world),before);await entered.promise;assert.deepEqual(state(f.world),before);
    const d=expected.drops.get(1);assert.deepEqual(sent.ground,{x:d.x,z:d.z,
      availableAt:f.clock.at(d.pickAt),returnAt:f.clock.at(d.t)});
    assert.equal(sent.expectedVersion,1);assert.equal(sent.operationId,h.operationId);
    f.world.tick=15;const later=state(f.world);release.resolve();await f.staging.settle();assert.deepEqual(state(f.world),later);
    const ctx=f.staging.operations.get(h.operationId);assert.ok(Object.isFrozen(ctx.request.ground));
    assert.deepEqual(f.staging.drain(),[{operationId:h.operationId,state:'applied'}]);
    const live=[...f.world.drops.values()][0];assert.equal(live.pickAt,d.pickAt);assert.equal(live.t,d.t);
    assert.deepEqual(f.clock.assertDrop(live,'pearl',sent.ground),sent.ground);
    assert.deepEqual(f.world.profiles.get(f.entities[0]).pearls,expected.profiles.get(f.entities[0]).pearls);
    assert.deepEqual(f.world.events[0],expected.events[0]);assert.equal(f.world.events[1].op,'leave');
    assert.equal(JSON.stringify(f.world.events).includes('groundClock'),false);
    await f.sessions.flush();assert.deepEqual((await f.base.loadProfile(accounts[0])).data,f.world.profiles.get(f.entities[0]));
    assert.deepEqual(await f.base.loadPearlLocation(incomingUid),{world:WORLD,ground:sent.ground,version:2});
    assert.equal((await f.base.commitPearlGround(sent)).replay,true);
    const applied=state(f.world);assert.deepEqual(f.staging.drain(),[]);assert.deepEqual(state(f.world),applied);
  } finally {release.resolve();await f.staging.settle();await f.close();}
});

test('legacy leave keeps raw local ground and unmarked drop',async()=>{
  const f=await setup({},null);
  try {const expected=helper(f), {ctx}=await ready(f);const d=expected.drops.get(1);
    assert.deepEqual(ctx.request.ground,{x:d.x,z:d.z,availableAt:d.pickAt,returnAt:d.t});
    assert.equal(f.staging.drain()[0].state,'applied');assert.deepEqual([...f.world.drops.values()][0],d);
    assert.equal(Object.hasOwn(d,'groundClock'),false);
  } finally {await f.close();}
});

test('clock option rejects wrong-world, forged and proxy authorities without callbacks',async()=>{
  const f=await fixture();let callbacks=0;
  try {
    const proxy=new Proxy(clock(),{getPrototypeOf(){callbacks++;throw Error('trap');}});
    for(const bad of [clock(undefined,'island:foreign'),Object.create(GroundDeadlineClock.prototype),proxy])
      assert.throws(()=>new PearlStaging(f.sessions,f.world,WORLD,{deadlineClock:bad}),{code:'configuration'});
    assert.equal(callbacks,0);
  } finally {await f.close();}
});

for(const [name,authority] of [['overflow',()=>clock({localTick:11,durableTick:Number.MAX_SAFE_INTEGER-1})],
  ['future anchor',()=>clock({localTick:12,durableTick:100})]]) {
  test(name+' rejects leave before generation/save/commit or reservation',async()=>{
    let reads=0,saves=0,commits=0;
    const f=await setup({wrapStore:base=>({...base,loadUnique(...a){reads++;return base.loadUnique(...a);},
      saveProfile(...a){saves++;return base.saveProfile(...a);},commitPearlGround(...a){commits++;return base.commitPearlGround(...a);}})},authority());
    try {reads=saves=commits=0;const before=state(f.world);
      assert.throws(()=>f.staging.request(command(f)));assert.deepEqual(state(f.world),before);
      assert.equal(reads+saves+commits,0);assert.equal(f.staging.operations.size,0);
      f.staging.gate.assertWorldAvailable();
    } finally {await f.close();}
  });
}

test('rewinding after capture fences before IO dispatch',async()=>{
  let commits=0;
  const f=await setup({wrapStore:base=>({...base,commitPearlGround(...a){commits++;return base.commitPearlGround(...a);}})});
  try {const h=f.staging.request(command(f));f.world.tick=10;const before=state(f.world);
    await f.staging.settle();assert.equal(commits,0);assert.equal(f.staging.drain()[0].state,'fenced');
    assert.deepEqual(state(f.world),before);assert.equal(await f.base.loadPearlGroundOperation(h.operationId),null);
  } finally {await f.close();}
});

for(const [name,mutate] of [
  ['plan replacement',ctx=>{ctx.plan=clone(ctx.plan);}],
  ['request replacement',ctx=>{ctx.request=clone(ctx.request);}],
  ['false receipt',ctx=>{ctx.receipt={ok:false,why:'conflict'};}],
  ['wrong receipt ground',ctx=>{ctx.receipt.location.ground.returnAt++;}],
  ['wrong receipt UID',ctx=>{ctx.receipt.unique.uid='another-uid';}],
]) test(name+' fences local leave while retaining durable evidence',async()=>{
  const f=await setup();
  try {const before=state(f.world),{handle,ctx}=await ready(f);const evidence=await f.base.loadPearlGroundOperation(handle.operationId);
    mutate(ctx);assert.equal(f.staging.drain()[0].state,'fenced');assert.deepEqual(state(f.world),before);
    assert.deepEqual(await f.base.loadPearlGroundOperation(handle.operationId),evidence);
    assert.equal((await f.base.loadUnique(incomingUid)).holder,null);
    assert.throws(()=>f.staging.gate.assertWorldAvailable(),{code:'busy'});assert.deepEqual(f.staging.drain(),[]);
  } finally {await f.close();}
});

test('rewinding after durable receipt fences local publication',async()=>{
  const f=await setup();
  try {const {handle}=await ready(f);f.world.tick=10;const before=state(f.world);
    assert.equal(f.staging.drain()[0].state,'fenced');assert.deepEqual(state(f.world),before);
    assert.equal((await f.base.loadPearlGroundOperation(handle.operationId)).result.ok,true);
  } finally {await f.close();}
});

test('lost reply retries the exact UUID/ground and applies once',async()=>{
  const sent=[];let lost=false;
  const f=await setup({wrapStore:base=>({...base,async commitPearlGround(raw){sent.push(clone(raw));
    const receipt=await base.commitPearlGround(raw);if(!lost){lost=true;throw new StoreError('unavailable');}return receipt;}})});
  try {const before=state(f.world),{handle}=await ready(f);assert.deepEqual(state(f.world),before);
    assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal(sent[0].operationId,handle.operationId);
    assert.equal(f.staging.drain()[0].state,'applied');assert.equal(f.world.drops.size,1);
    assert.deepEqual(f.staging.drain(),[]);assert.equal((await f.base.loadUnique(incomingUid)).version,2);
  } finally {await f.close();}
});

test('postreceipt save failure rolls back marker/drop/ledger/profile/events and retains durable leave',async()=>{
  const f=await setup();
  try {const before=state(f.world),{handle}=await ready(f);f.sessions.save=()=>{throw new StoreError('unavailable');};
    assert.equal(f.staging.drain()[0].state,'fenced');assert.deepEqual(state(f.world),before);
    assert.equal((await f.base.loadPearlGroundOperation(handle.operationId)).result.ok,true);
    assert.equal((await f.base.loadUnique(incomingUid)).holder,null);assert.deepEqual(f.staging.drain(),[]);
  } finally {await f.close();}
});

test('managed generation refresh after two gives preserves captured durable deadlines',async()=>{
  const f=await setup();
  try {
    for(const [from,to] of [[0,1],[1,0]]) {
      f.staging.request({action:'give',uid:incomingUid,source:source(f,from),target:source(f,to)});
      await f.staging.settle();assert.equal(f.staging.drain()[0].state,'applied');await f.sessions.flush();
    }
    const expected=helper(f),{ctx}=await ready(f);assert.equal(ctx.plan.meta.expectedVersion,3);
    assert.equal(ctx.request.expectedVersion,3);assert.equal(ctx.request.ground.availableAt,f.clock.at(expected.drops.get(1).pickAt));
    assert.equal(f.staging.drain()[0].state,'applied');assert.equal((await f.base.loadUnique(incomingUid)).version,4);
  } finally {await f.close();}
});
