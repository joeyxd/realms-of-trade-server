import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGroundDeathDrop } from '../server/groundDeathDrop.mjs';
import { deathDropResult } from '../server/deathDropOperation.mjs';
import { rollItem } from '../src/sim/items.js';
import { setupStaging, WORLD, VICTIM, snapshot } from './helpers/death-staging.mjs';
import { deathOp } from './helpers/death-storage.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';

const clone=structuredClone;
async function fixture(kind='item') {
  const f=await setupStaging(undefined,{killer:true,pearlCount:1}),entity=f.killerEntity,clientId=2;
  const session=f.sessions.clients.get(clientId),server={world:f.world,clients:new Map([[clientId,{entity,serverProfile:true}]])};
  const host={server,profiles:f.sessions,worldState:{id:WORLD}},operationId=deathOp(777),ordinal=1;
  const ground={x:f.world.ecs.x[entity],z:f.world.ecs.z[entity],availableAt:20,expiresAt:100};
  const deadlineClock=new GroundDeadlineClock({worldId:WORLD,sourceDomain:'durable-ground-v1',
    epoch:new GroundClockEpoch({localTick:10,durableTick:20})});
  const projected=deadlineClock.project(ground,'drop');
  const item=kind==='item'?rollItem(f.world.lootRng,{lvl:3,slot:'head',uid:900}):null;
  const row={operationId,ordinal,world:WORLD,victim:VICTIM,kind,item,ground,state:'ground',version:1,holder:null,transitionOperationId:null};
  const source={id:1,operationId,ordinal,kind,item,to:0,x:ground.x,z:ground.z,...projected};
  f.world.tick=10;f.world.drops.set(1,source);
  const receiver={clientId,entity};
  return {...f,host,row,source,receiver,deadlineClock,close:async()=>{await f.close?.();}};
}
const input=f=>({host:f.host,deadlineClock:f.deadlineClock,dropId:1,receiver:f.receiver,row:f.row,mode:'pickup'});

test('pickup plan captures live ECS progress, canonical item attributes, and applies a checked result once',async()=>{
 const f=await fixture();
 try{
  f.world.ecs.xp[f.killerEntity]=42.678;const before=capturePearlProfile(f.world,f.killerEntity),session=f.sessions.clients.get(2);
  session.confirmed.xp=0;
  const plan=prepareGroundDeathDrop(input(f));
  assert.equal(plan.operation.profile.before.xp,42.68);
  assert.deepEqual(plan.operation.profile.data.bag.at(-1),{...f.row.item,u:before.uid});
  assert.deepEqual(plan.operation.profile.data.bag.at(-1).a,f.row.item.a);
  assert.equal(plan.operation.profile.data.uid,before.uid+1);assert.equal(plan.operation.profile.data.stats.items,before.stats.items+1);
  const initial=snapshot(f),opId=deathOp(778),result=deathDropResult(plan.operation,opId);
  assert.deepEqual(snapshot(f),initial);
  assert.equal(plan.apply(result,opId),true);
  assert.equal(f.world.drops.has(1),false);
  assert.deepEqual(f.world.profiles.get(f.killerEntity).bag.at(-1),plan.operation.profile.data.bag.at(-1));
  assert.equal(session.version,plan.operation.profile.expectedVersion+1);assert.deepEqual(session.confirmed,plan.operation.profile.data);
  assert.equal(session.last,JSON.stringify(plan.operation.profile.data));assert.ok(f.world.profileDirty.has(f.killerEntity));
  assert.throws(()=>plan.assertCurrent(),{code:'cancelled'});
 }finally{await f.close?.();}
});

test('expire has no profile and requires both local and durable deadlines to pass',async()=>{
 const f=await fixture('potion');
 try{
  f.world.tick=101;const plan=prepareGroundDeathDrop({...input(f),mode:'expire',receiver:null});
  assert.equal(plan.operation.profile,null);
  const opId=deathOp(779);assert.equal(plan.apply(deathDropResult(plan.operation,opId),opId),true);
  assert.equal(f.world.drops.has(1),false);
 }finally{await f.close?.();}
});

test('stale source, tampered durable row, and early deadline are rejected',async()=>{
 for(const mutate of [f=>{f.row={...f.row,version:2};},f=>{f.row={...f.row,ground:{...f.row.ground,x:99}};},
   f=>{f.world.tick=9;},f=>{f.world.drops.get(1).groundClock.ground.expiresAt++;}]){
  const f=await fixture();try{mutate(f);assert.throws(()=>prepareGroundDeathDrop(input(f)));}finally{await f.close?.();}
 }
});

test('held pearl ledger must exactly match the captured profile ownership',async()=>{
 for(const tamper of [f=>{const [uid]=f.world.pearlLedger.keys();f.world.pearlLedger.get(uid).entity=f.killerEntity;
   f.world.pearlLedger.get(uid).owner='account:'+f.sessions.clients.get(2).key;},
   f=>f.world.pearlLedger.set('orphan',{owner:'account:'+f.sessions.clients.get(2).key,entity:f.killerEntity,place:'profile'})]){
  const f=await fixture('potion');try{tamper(f);assert.throws(()=>prepareGroundDeathDrop(input(f)),{code:'ownership'});}finally{await f.close?.();}
 }
});

test('malformed, replayed, or wrong operation receipts never apply',async()=>{
 const f=await fixture();
 try{
  const plan=prepareGroundDeathDrop(input(f)),opId=deathOp(780),receipt=deathDropResult(plan.operation,opId);
  assert.throws(()=>plan.apply({...receipt,replay:true},opId),{code:'response'});
  assert.throws(()=>plan.apply(receipt,deathOp(781)),{code:'response'});
  assert.equal(f.world.drops.has(1),true);
 }finally{await f.close?.();}
});

test('post-apply publication failure rolls back source order, profile, session, and events',async()=>{
 const f=await fixture();const originalPush=Array.prototype.push;
 try{
  const plan=prepareGroundDeathDrop(input(f)),opId=deathOp(782),before=snapshot(f),s=f.sessions.clients.get(2);
  Array.prototype.push=function(...args){if(this===f.world.events)throw new Error('publish fault');return originalPush.apply(this,args);};
  assert.throws(()=>plan.apply(deathDropResult(plan.operation,opId),opId),/publish fault/);
  assert.deepEqual(snapshot(f),before);assert.equal(s.version,plan.operation.profile.expectedVersion);
 }finally{Array.prototype.push=originalPush;await f.close?.();}
});
