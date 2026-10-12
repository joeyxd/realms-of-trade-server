import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGroundPearlLeave } from '../server/groundPearlLeave.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { groundResult } from '../server/pearlGround.mjs';
import { StoreError } from '../server/store.mjs';
import { fixture, WORLD, incomingUid, accounts, state } from './helpers/pearl-replace-staging.mjs';

const clock=()=>new GroundDeadlineClock({worldId:WORLD,sourceDomain:'durable-ground-v1',epoch:new GroundClockEpoch({localTick:7,durableTick:2**40})});
async function setup(){
  const f=await fixture();f.world.tick=11;const c={serverProfile:true,entity:f.entities[0]};
  const host={server:{world:f.world,clients:new Map([[1,c]])},profiles:f.sessions,worldState:{id:WORLD}};
  const unique=await f.base.loadUnique(incomingUid);
  return {...f,host,endpoint:{clientId:1,entity:f.entities[0]},row:{uid:incomingUid,kind:unique.kind.slice(6),holder:accounts[0],version:unique.version}};
}
const plan=f=>prepareGroundPearlLeave({host:f.host,deadlineClock:clock(),source:f.endpoint,uid:incomingUid,row:f.row});

test('planner prepares detached helper delta and atomically applies the exact durable receipt',async()=>{
  const f=await setup();try{
    const before=state(f.world),p=plan(f);assert.deepEqual(state(f.world),before);
    assert.equal(p.operation.from,accounts[0]);assert.equal(p.operation.to,null);assert.equal(p.operation.expectedVersion,f.row.version);
    assert.equal(p.operation.profiles[0].expectedVersion,f.sessions.clients.get(1).version);
    assert.equal(p.targetDrop.pearl.uid,incomingUid);assert.equal(p.targetDrop.groundClock.domain,'durable-ground-v1');
    assert.deepEqual(f.world.profiles.get(f.entities[0]),f.sessions.clients.get(1).confirmed);
    assert.equal(p.apply(groundResult({...p.operation,operationId:'61000000-0000-4000-8000-000000009019'})),true);
    assert.equal(f.world.profiles.get(f.entities[0]).pearls.bag.some(q=>q.uid===incomingUid),false);
    assert.equal(f.world.drops.get(p.targetDrop.id).pearl.uid,incomingUid);
    assert.deepEqual(f.world.pearlLedger.get(incomingUid),{owner:'',entity:0,place:'ground',drop:p.targetDrop.id});
    assert.equal(f.sessions.clients.get(1).version,p.operation.profiles[0].expectedVersion+1);
    assert.throws(()=>p.apply(groundResult({...p.operation,operationId:'61000000-0000-4000-8000-000000009019'})),{code:'cancelled'});
  }finally{await f.close();}
});

test('planner rejects holder, generation, profile and duplicate UID drift without mutation',async t=>{
  for(const mode of ['holder','version','profile','ledger','duplicate profile','duplicate drop','row shape'])await t.test(mode,async()=>{
    const f=await setup();try{
      if(mode==='holder')f.row.holder=accounts[1];
      if(mode==='version')f.row.version=0;
      if(mode==='profile')f.world.profiles.get(f.entities[0]).pearls.bag=[];
      if(mode==='ledger')f.world.pearlLedger.set(incomingUid,{owner:'account:elsewhere',entity:77,place:'profile'});
      if(mode==='duplicate profile')f.world.profiles.get(f.entities[1]).pearls.bag.push({uid:incomingUid,kind:f.row.kind});
      if(mode==='duplicate drop')f.world.drops.set(9876,{id:9876,kind:'pearl',pearl:{uid:incomingUid,kind:f.row.kind}});
      if(mode==='row shape')f.row.extra=true;
      const before=state(f.world);assert.throws(()=>plan(f),StoreError);assert.deepEqual(state(f.world),before);
    }finally{await f.close();}
  });
});

test('durable row accessors are rejected without invocation',async()=>{
  const f=await setup();try{
    let touched=false;const row={uid:incomingUid,kind:f.row.kind,holder:f.row.holder,version:f.row.version};
    Object.defineProperty(row,'version',{enumerable:true,get(){touched=true;return f.row.version;}});
    assert.throws(()=>prepareGroundPearlLeave({host:f.host,deadlineClock:clock(),source:f.endpoint,uid:incomingUid,row}),StoreError);
    assert.equal(touched,false);
  }finally{await f.close();}
});

test('assertBaseline allows settlement session counters while assertCurrent fences them',async()=>{
  const f=await setup();try{
    const p=plan(f),s=f.sessions.clients.get(1);s.pending={};assert.equal(p.assertBaseline(),true);
    assert.throws(()=>p.assertCurrent(),{code:'cancelled'});delete s.pending;
    f.world.ecs.facing[f.entities[0]]+=0.1;assert.throws(()=>p.assertBaseline(),{code:'cancelled'});
  }finally{await f.close();}
});

test('captured ECS progress is carried into the profile and RNG replacement fences a plan',async()=>{
  const f=await setup();try{
    const e=f.entities[0],p=f.world.profiles.get(e);f.world.ecs.xp[e]+=7;
    const staged=plan(f);assert.equal(staged.operation.profiles[0].data.xp,p.xp+7);
    assert.equal(staged.operation.profiles[0].data.gold,p.gold);
    const old=f.world.lootRng;f.world.lootRng={state:()=>old.state()};
    assert.throws(()=>staged.assertCurrent(),{code:'cancelled'});
  }finally{await f.close();}
});

test('in-place target geometry drift and allocator descriptor drift fence the plan',async()=>{
  {
    const f=await setup();try{
      const p=plan(f), spawn=f.world.map.landmarks.spawn;
      spawn.x+=0.25;
      assert.throws(()=>p.assertCurrent(),{code:'cancelled'});
    }finally{await f.close();}
  }
  {
    const f=await setup();try{
      const p=plan(f),before=state(f.world);
      Object.defineProperty(f.world,'nextDrop',{value:f.world.nextDrop,writable:false,configurable:true});
      assert.throws(()=>p.apply(groundResult({...p.operation,operationId:'61000000-0000-4000-8000-000000009019'})),{code:'cancelled'});
      assert.deepEqual(state(f.world),before);
    }finally{await f.close();}
  }
});

test('wrong receipt and publication callback failure leave all state untouched',async()=>{
  const f=await setup();try{
    f.world.emit=function(){if(this!==f.world)throw new Error('emit failed');};
    const p=plan(f),before=state(f.world),effect=groundResult({...p.operation,operationId:'61000000-0000-4000-8000-000000009019'});
    assert.throws(()=>p.apply({...effect,location:{...effect.location,version:effect.location.version+1}}),{code:'response'});
    assert.deepEqual(state(f.world),before);
    assert.throws(()=>p.apply(effect),/emit failed/);assert.deepEqual(state(f.world),before);
  }finally{await f.close();}
});

test('synchronous apply failure restores profile, receipt fields, drop order, ledger and dirty state',async()=>{
  const f=await setup();try{
    const p=plan(f),before=state(f.world),s=f.sessions.clients.get(1),orig=Set.prototype.add;
    Set.prototype.add=function(value){if(this===f.world.profileDirty)throw new Error('injected apply failure');return orig.call(this,value);};
    try{assert.throws(()=>p.apply(groundResult({...p.operation,operationId:'61000000-0000-4000-8000-000000009019'})),/injected apply failure/);}
    finally{Set.prototype.add=orig;}
    assert.deepEqual(state(f.world),before);assert.equal(s.version,p.operation.profiles[0].expectedVersion);
  }finally{await f.close();}
});
