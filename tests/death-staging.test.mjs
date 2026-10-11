import test from 'node:test';
import assert from 'node:assert/strict';
import { DeathStaging } from '../server/deathStaging.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { givePearl } from '../src/sim/systems/pearls.js';
import { stagingContract,setupStaging,snapshot,deferred,row,VICTIM,KILLER,WORLD } from './helpers/death-staging.mjs';
import { deathOp,advancePearlGeneration } from './helpers/death-storage.mjs';

test('whole-death staging contract in memory',t=>stagingContract(t));
test('settles older autosave and raw ECS progress before choosing profile generations',async()=>{
 const f=await setupStaging(),started=deferred(),release=deferred();let saves=0,sends=0;
 try{
  f.sessions.store={...f.store,async saveProfile(...a){saves++;if(saves===1){started.resolve();await release.promise;}return f.store.saveProfile(...a);},
   async commitDeath(r){sends++;return f.store.commitDeath(r);}};
  const p=f.world.profiles.get(f.entity);p.gold++;f.sessions.save(1,structuredClone(p));
  f.world.ecs.xp[f.entity]=83.333333;
  const oldVersion=f.sessions.clients.get(1).version,h=f.stage.request(f.selectors),ctx=f.stage.operations.get(h.operationId);
  await started.promise;assert.equal(sends,0);assert.throws(()=>f.stage.assertPublishable(1),{code:'busy'});
  release.resolve();await f.stage.settle();assert.equal(ctx.state,'ready');
  const v=ctx.request.profiles.find(p=>p.id===VICTIM);assert.equal(v.before.xp,83.33);assert.equal(v.data.xp,75);
  assert.equal(v.expectedVersion,oldVersion+2);assert.equal(ctx.request.rules.xpBefore,83.333333);
  assert.equal(sends,1);assert.equal(f.stage.drain()[0].state,'applied');assert.equal(p.gold,74);assert.equal(p.xp,75);
 }finally{release.resolve();await f.close?.();}
});
test('managed generations are read by staging after baseline settles',async()=>{
 const f=await setupStaging(undefined,{pearlCount:2});
 try{
  await advancePearlGeneration(f.store,f.seedRequest,f.seedRequest.pearls[0].uid,2);
  const s=f.sessions.clients.get(1),stored=await f.store.loadProfile(VICTIM);s.version=stored.version;s.confirmed=structuredClone(stored.data);s.last=JSON.stringify(stored.data);
  const h=f.stage.request(f.selectors);await f.stage.settle();const ctx=f.stage.operations.get(h.operationId);
  assert.equal(ctx.state,'ready');assert.equal(ctx.request.pearls.find(q=>q.uid===f.seedRequest.pearls[0].uid).expectedVersion,5);
  assert.equal(f.stage.drain()[0].state,'applied');
 }finally{await f.close?.();}
});
test('unchanged killer pearl shares the UID gate and remains owned through Cala death',async()=>{
 const f=await setupStaging();
 try{
  const q=givePearl(f.world,f.killerEntity,'tinta'),kp=capturePearlProfile(f.world,f.killerEntity),s=f.sessions.clients.get(2);
  const result=await f.store.commitPearlGround({operationId:deathOp(880),uid:q.uid,kind:q.kind,from:null,to:KILLER,world:WORLD,ground:null,expectedVersion:0,
   profiles:[{id:KILLER,expectedVersion:s.version,data:kp}]});assert.equal(result.ok,true);
  s.version=result.profiles[0].version;s.confirmed=structuredClone(kp);s.last=JSON.stringify(kp);
  const h=f.stage.request(f.selectors);assert.throws(()=>pearlMutationGate(f.sessions).assertAvailable({uids:[q.uid]}),{code:'busy'});
  assert.throws(()=>new DeathStaging(f.sessions,f.world,WORLD).request(f.selectors),{code:'busy'});
  await f.stage.settle();assert.equal(f.stage.operations.get(h.operationId).state,'ready');assert.equal(f.stage.drain()[0].state,'applied');
  assert.equal((await f.store.loadUnique(q.uid)).holder,KILLER);assert.ok(f.world.profiles.get(f.killerEntity).pearls.bag.some(p=>p.uid===q.uid));
 }finally{await f.close?.();}
});
test('other actors can allocate drops and consume RNG during IO; IDs remap at drain without rewinding',async()=>{
 const f=await setupStaging(),started=deferred(),release=deferred();
 try{
  f.sessions.store={...f.store,async commitDeath(r){started.resolve();await release.promise;return f.store.commitDeath(r);}};
  const h=f.stage.request(f.selectors),ctx=f.stage.operations.get(h.operationId);await started.promise;
  const foreign={id:f.world.nextDrop++,kind:'potion',x:100,z:100,t:1000};f.world.drops.set(foreign.id,foreign);
  const rng=f.world.lootRng;rng();const state=rng.state();f.world.tick+=15;
  release.resolve();await f.stage.settle();assert.equal(f.stage.drain()[0].state,'applied');
  assert.equal(f.world.drops.get(foreign.id),foreign);assert.equal(f.world.nextDrop,ctx.plan.drops.length+2);assert.equal(rng.state(),state);
  for(const q of ctx.plan.ledgers)assert.equal(f.world.pearlLedger.get(q.uid).drop,q.data.drop+1);
  const loot=f.world.events.filter(e=>e.type==='loot').flatMap(e=>e.drops);assert.ok(loot.every(d=>d.id>=2&&f.world.drops.has(d.id)));
  assert.deepEqual([...f.world.drops.values()].slice(1).map(d=>[d.x,d.z,d.t]),ctx.plan.drops.map(d=>[d.x,d.z,d.t]));
 }finally{release.resolve();await f.close?.();}
});
for(const [name,mutate] of [
 ['victim raw XP',(f)=>{f.world.ecs.xp[f.entity]++;}],['victim movement',(f)=>{f.world.ecs.x[f.entity]++;}],
 ['killer raw XP',(f)=>{f.world.ecs.xp[f.killerEntity]++;}],['killer progress',(f)=>{f.world.profiles.get(f.killerEntity).gold++;}],
 ['typed column replacement',(f)=>{f.world.ecs.hp=new Float32Array(f.world.ecs.hp);}],
 ['profile replacement',(f)=>{f.world.profiles.set(f.entity,structuredClone(f.world.profiles.get(f.entity)));}],
 ['client recycle',(f)=>{f.world.ecs.clientId[f.entity]=77;}],['ledger reassignment',(f)=>{f.world.pearlLedger.get(f.owned[0].uid).entity=f.killerEntity;}],
 ['orphan ownership',(f)=>{f.world.pearlLedger.set('orphan',{place:'profile',owner:'account:'+VICTIM,entity:f.entity});}],
 ['death then revive invalidation',(f)=>{f.stage.invalidate(VICTIM);f.world.ecs.dead[f.entity]=1;f.world.ecs.dead[f.entity]=0;}],
 ['closed victim',(f)=>{f.sessions.close(1);}],['closed killer',(f)=>{f.sessions.close(2);}],
])test('committed receipt plus '+name+' fences without historical local apply',async()=>{
 const f=await setupStaging();
 try{
  const h=f.stage.request(f.selectors);await f.stage.settle();const ctx=f.stage.operations.get(h.operationId);assert.equal(ctx.state,'ready');
  mutate(f);const altered=snapshot(f);assert.equal(f.stage.drain()[0].state,'fenced');assert.deepEqual(snapshot(f),altered);
  assert.deepEqual(f.stage.drain(),[]);assert.throws(()=>f.stage.assertPublishable(1));assert.throws(()=>pearlMutationGate(f.sessions).assertAvailable({accounts:[VICTIM]}));
  assert.deepEqual((await f.store.loadProfile(VICTIM)).data,ctx.request.profiles.find(p=>p.id===VICTIM).data);
  await assert.rejects(f.sessions.flush(),{code:'flush'});assert.equal((await f.store.loadDeathOperation(h.operationId)).result.ok,true);
 }finally{await f.close?.();}
});
test('mutation before storage dispatch fences and sends no death',async()=>{
 const f=await setupStaging();let sends=0;
 try{
  f.sessions.store={...f.store,async commitDeath(r){sends++;return f.store.commitDeath(r);}};
  const h=f.stage.request(f.selectors);f.world.ecs.xp[f.entity]++;
  await f.stage.settle();assert.equal(sends,0);assert.equal(await f.store.loadDeathOperation(h.operationId),null);
  assert.equal(f.stage.drain()[0].state,'fenced');assert.equal(f.world.ecs.dead[f.entity],0);
 }finally{await f.close?.();}
});
test('selectors cannot inject account, profile, generation, UUID, getters or an async object',async()=>{
 const f=await setupStaging();let reads=0;
 try{
  for(const bad of [{...f.selectors,operationId:deathOp(10)},{...f.selectors,profiles:[]},{...f.selectors,victim:{...f.selectors.victim,key:VICTIM}},
    {...f.selectors,seq:-1},{...f.selectors,seq:1.1},{...f.selectors,victim:Promise.resolve(f.selectors.victim)},
    {...f.selectors,victim:{clientId:2,entity:f.entity}}, {...f.selectors,killer:f.selectors.victim}])assert.throws(()=>f.stage.request(bad));
  const bad={seq:0,get victim(){reads++;return f.selectors.victim;}};assert.throws(()=>f.stage.request(bad));assert.equal(reads,0);
  assert.equal(f.stage.operations.size,0);pearlMutationGate(f.sessions).assertAvailable({accounts:[VICTIM]});
  assert.throws(()=>new DeathStaging(f.sessions,f.world,WORLD,{limit:0}),{code:'configuration'});
 }finally{await f.close?.();}
});
test('drain rollback preserves durable post-death state and sticky fence after a post-apply authority check fails',async()=>{
 const f=await setupStaging();
 try{
  const h=f.stage.request(f.selectors);await f.stage.settle();const ctx=f.stage.operations.get(h.operationId),before=snapshot(f);
  const original=f.stage.assertIdentity.bind(f.stage);let faults=0;
  f.stage.assertIdentity=function(c){original(c);if(f.world.ecs.dead[f.entity]===1){faults++;throw new Error('post-apply fault');}};
  assert.equal(f.stage.drain()[0].state,'fenced');assert.deepEqual(snapshot(f),before);assert.equal(faults,1);
  assert.equal((await f.store.loadDeathOperation(h.operationId)).result.ok,true);
  assert.deepEqual((await f.store.loadProfile(VICTIM)).data,ctx.request.profiles.find(p=>p.id===VICTIM).data);
  assert.deepEqual(f.stage.drain(),[]);
 }finally{await f.close?.();}
});
test('unavailable dispatch leaves live death untouched and retains all account authority',async()=>{
 const f=await setupStaging();
 try{
  f.sessions.store={...f.store,async commitDeath(){throw new Error('network');}};
  const before=snapshot(f),h=f.stage.request(f.selectors);await f.stage.settle();assert.equal(f.stage.drain()[0].state,'fenced');
  assert.deepEqual(snapshot(f),before);assert.equal(await f.store.loadDeathOperation(h.operationId),null);
  assert.ok(f.sessions.pearls.unresolved.has(h.operationId));assert.throws(()=>f.stage.assertPublishable(1));
 }finally{await f.close?.();}
});

test('capture reentry is rejected even if a map callback catches the nested exception',async()=>{
 const f=await setupStaging();let nested=0;const map=f.world.map;
 try{
  f.world.map={...map,lawlessAt(...args){nested++;try{f.stage.request(f.selectors);}catch{}return map.lawlessAt(...args);}};
  assert.throws(()=>f.stage.request(f.selectors),{code:'effect'});assert.ok(nested>0);assert.equal(f.stage.operations.size,0);
  pearlMutationGate(f.sessions).assertAvailable({accounts:[VICTIM]});await f.stage.settle();assert.equal(f.world.ecs.dead[f.entity],0);
 }finally{f.world.map=map;await f.close?.();}
});
test('unsafe overridden world mutators fence before any local write',async()=>{
 const f=await setupStaging();let callbacks=0;
 try{
  const h=f.stage.request(f.selectors);await f.stage.settle();const before=snapshot(f);
  f.world.drops.set=function(){callbacks++;throw new Error('unsafe callback');};
  assert.equal(f.stage.drain()[0].state,'fenced');assert.deepEqual(snapshot(f),before);assert.equal(callbacks,0);
  assert.ok(await f.store.loadDeathOperation(h.operationId));
 }finally{await f.close?.();}
});

test('independent deaths reserve separate accounts and assign non-overlapping IDs in drain order',async()=>{
 const f=await setupStaging(undefined,{killer:true,pearlCount:2,loot:true});
 try{
  const first=f.stage.request({victim:f.selectors.victim,seq:1}),second=f.stage.request({victim:f.selectors.killer,seq:2});
  assert.equal(f.stage.operations.size,2);await f.stage.settle();const a=f.stage.operations.get(first.operationId),b=f.stage.operations.get(second.operationId);
  assert.equal(a.state,'ready');assert.equal(b.state,'ready');
  assert.deepEqual(f.stage.drain(),[{operationId:first.operationId,state:'applied'},{operationId:second.operationId,state:'applied'}]);
  assert.equal(f.world.ecs.dead[f.entity],1);assert.equal(f.world.ecs.dead[f.killerEntity],1);
  assert.equal(f.world.drops.size,a.plan.drops.length+b.plan.drops.length);assert.equal(f.world.nextDrop,f.world.drops.size+1);
 }finally{await f.close?.();}
});
test('bad returned receipt after durable commit fences every affected endpoint',async()=>{
 const f=await setupStaging();
 try{
  const original=f.sessions.commitDeath.bind(f.sessions);f.sessions.commitDeath=async(...a)=>{const r=await original(...a);r.receipt.profiles[0].version++;return r;};
  const before=snapshot(f),h=f.stage.request(f.selectors);await f.stage.settle();assert.equal(f.stage.drain()[0].state,'fenced');
  assert.deepEqual(snapshot(f),before);assert.equal(f.sessions.clients.get(1).failed,true);assert.equal(f.sessions.clients.get(2).failed,true);
  assert.equal((await f.store.loadDeathOperation(h.operationId)).result.ok,true);
 }finally{await f.close?.();}
});
test('reconciliation of an ambiguous dispatch cannot release the local fence or apply a historical death',async()=>{
 const f=await setupStaging();let concrete;
 try{
  f.sessions.store={...f.store,async commitDeath(r){concrete=structuredClone(r);throw new Error('ambiguous');}};
  const before=snapshot(f),h=f.stage.request(f.selectors);await f.stage.settle();assert.equal(f.stage.drain()[0].state,'fenced');
  await f.store.commitDeath(concrete);f.sessions.store=f.store;
  await f.sessions.reconcileDeath(h.operationId).catch(()=>{});
  assert.deepEqual(f.stage.drain(),[]);assert.deepEqual(snapshot(f),before);assert.throws(()=>f.stage.assertPublishable(1));
  assert.equal(f.stage.operations.get(h.operationId).state,'fenced');
 }finally{await f.close?.();}
});
test('a changed snapshot is rejected through pending and receipt gaps, without rewriting the frozen death',async()=>{
 const f=await setupStaging();
 try{
  const h=f.stage.request(f.selectors),ctx=f.stage.operations.get(h.operationId),changed=structuredClone(ctx.plan.profiles[0].before);changed.gold++;
  assert.throws(()=>f.stage.save(1,changed),{code:'profile'});await f.stage.settle();
  assert.throws(()=>f.stage.save(1,changed),{code:'profile'});assert.equal(f.stage.drain()[0].state,'applied');assert.equal(f.world.profiles.get(f.entity).gold,73);
 }finally{await f.close?.();}
});

test('common account and UID reservations are already held inside detached gameplay map callbacks',async()=>{
 const f=await setupStaging();const map=f.world.map;let calls=0,guarded=0;
 try{
  f.world.map={...map,lawlessAt(...args){calls++;if(calls===2){
   assert.throws(()=>pearlMutationGate(f.sessions).assertAvailable({accounts:[VICTIM]}),{code:'busy'});
   assert.throws(()=>pearlMutationGate(f.sessions).assertAvailable({uids:[f.owned[0].uid]}),{code:'busy'});
   assert.throws(()=>f.sessions.save(1,f.world.profiles.get(f.entity)),{code:'busy'});guarded++;
  }return map.lawlessAt(...args);}};
  const h=f.stage.request(f.selectors);assert.equal(guarded,1);await f.stage.settle();assert.equal(f.stage.operations.get(h.operationId).state,'ready');
  assert.equal(f.stage.drain()[0].state,'applied');
 }finally{f.world.map=map;await f.close?.();}
});
