import assert from 'node:assert/strict';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { DeathDropStaging } from '../../server/deathDropStaging.mjs';
import { attachProfile } from '../../src/sim/systems/inventory.js';
import { makeDeath, planRequest, seedDeathStore, WORLD, VICTIM, KILLER, deathOp } from './death-storage.mjs';
import { memoryDropQueueSetup, deferred } from './death-drop-queue-contract.mjs';
export { memoryDropQueueSetup, deferred, WORLD, VICTIM, KILLER };

const clone = structuredClone;
export const row = (w,e) => Object.fromEntries(Object.entries(w.ecs).filter(([,c])=>ArrayBuffer.isView(c)&&!(c instanceof DataView)).map(([k,c])=>[k,c[e]]));
export function snapshot(f) { return { profile:clone(f.world.profiles.get(f.receiver)), ecs:row(f.world,f.receiver), drops:clone([...f.world.drops]), events:clone(f.world.events), dirty:[...f.world.profileDirty], tick:f.world.tick, rng:f.world.lootRng.state() }; }

export async function setupDropStaging(setup=memoryDropQueueSetup,{kind='item',source=760,operation=1060,mode='pickup',managedPearl=false}={}) {
  const db=await setup(), f=makeDeath({lawless:true,killer:true,loot:true,seed:73});f.world.tick=10;
  const planned=planRequest(f,deathOp(source)); await seedDeathStore(db.store,f,planned.request);
  const creation=await db.store.commitDeath(planned.request);assert.equal(creation.ok,true);
  const pearls=managedPearl?[{uid:'stage-managed',kind:'brasa'},{uid:'stage-swallowed',kind:'escarcha'}]:[];
  for(const [index,pearl] of pearls.entries()){const current=await db.store.loadProfile(KILLER),data=clone(current.data);data.pearls.bag.push(pearl);assert.equal((await db.store.commitPearl({operationId:deathOp(source+20+index),...pearl,from:null,to:KILLER,expectedVersion:0,profiles:[{id:KILLER,expectedVersion:current.version,data}]})).ok,true);}
  if(pearls[1]){const current=await db.store.loadProfile(KILLER),data=clone(current.data);data.pearls.bag=data.pearls.bag.filter(p=>p.uid!==pearls[1].uid);data.pearls.swallowed=pearls[1];assert.equal((await db.store.saveProfile(KILLER,data,current.version)).ok,true);}
  const journal=typeof db.journal==='function'?db.journal(WORLD):db.journal;
  const sessions=new ProfileSessions(db.store,null,{journal}); await sessions.recoverPearls();
  const victim=await sessions.open(1,VICTIM), receiverProfile=await sessions.open(2,KILLER);
  attachProfile(f.world,f.entity,victim); attachProfile(f.world,f.killerEntity,receiverProfile);
  for(const pearl of pearls)f.world.pearlLedger.set(pearl.uid,{owner:receiverProfile.pirateId,entity:f.killerEntity,place:'profile'});
  f.world.ecs.clientId[f.entity]=1; f.world.ecs.clientId[f.killerEntity]=2;
  const selected=planned.request.drops.find(d=>d.kind===kind); assert.ok(selected);
  const id=41, drop={id,to:0,kind:selected.kind,x:selected.ground.x,z:selected.ground.z,t:selected.ground.expiresAt,
    pickAt:selected.ground.availableAt,operationId:planned.request.operationId,ordinal:selected.ordinal,
    ...(selected.item?{item:clone(selected.item)}:{})};
  f.world.drops.set(id,drop); f.world.ecs.x[f.killerEntity]=drop.x;f.world.ecs.z[f.killerEntity]=drop.z;
  const stage=new DeathDropStaging(sessions,f.world,WORLD);
  const selectors=mode==='expire'?{dropId:id}:{dropId:id,receiver:{clientId:2,entity:f.killerEntity}};
  return {...db,journal,world:f.world,entity:f.killerEntity,sessions,stage,receiver:f.killerEntity,drop,dropId:id,operation,source:planned,selectors};
}
export function requestPickup(f, receiver=2, dropId=f.dropId) { return f.stage.pickup({dropId,receiver:{clientId:receiver,entity:f.receiver}}); }
export async function finish(f,h) { await f.stage.settle(); assert.equal(f.stage.operations.get(h.operationId)?.state,'ready'); }

export async function stagingApplyContract(t,setup=memoryDropQueueSetup) {
  await t.test('receipt and autosave settle without changing public state until boundary drain',async()=>{
    const f=await setupDropStaging(setup);try{const before=snapshot(f),sourceItem=clone(f.drop.item),h=requestPickup(f);await finish(f,h);assert.deepEqual(snapshot(f),before);const ctx=f.stage.operations.get(h.operationId),stored=(await f.store.loadProfile(KILLER)).data,item=ctx.request.profile.data.bag.at(-1);assert.deepEqual(stored,ctx.request.profile.data);assert.equal(item.u,ctx.before.uid);for(const key of Object.keys(sourceItem).filter(k=>k!=='u'))assert.deepEqual(item[key],sourceItem[key]);assert.deepEqual(f.stage.drain(),[{operationId:h.operationId,state:'applied'}]);assert.deepEqual(f.world.events.at(-2).item,item);assert.equal(f.world.drops.has(f.dropId),false);assert.equal(f.world.events.at(-1).type,'unloot');assert.equal(f.world.events.at(-1).why,'pick');assert.equal(f.stage.drain().length,0);}finally{await f.close?.();}
  });
  await t.test('an already running receiver autosave settles before the pickup baseline is committed',async()=>{
    const f=await setupDropStaging(setup,{source:7601}),started=deferred(),release=deferred();let writes=0;try{const base=f.sessions.store;f.sessions.store={...base,async saveProfile(...args){writes++;if(writes===1){started.resolve();await release.promise;}return base.saveProfile(...args);}};const live=f.world.profiles.get(f.receiver);live.gold++;const gold=live.gold;f.sessions.save(2,live);await started.promise;const h=requestPickup(f);await Promise.resolve();assert.equal(await f.store.loadDeathDropOperation(h.operationId),null);release.resolve();await finish(f,h);assert.equal((await f.store.loadProfile(KILLER)).data.gold,gold);assert.equal((await f.store.loadProfile(KILLER)).data.bag.at(-1).u,f.stage.operations.get(h.operationId).before.uid);assert.equal(f.stage.drain()[0].state,'applied');}finally{release.resolve();await f.close?.();}
  });
  await t.test('pickup preserves concurrent ECS progress and managed pearls in its captured full baseline',async()=>{
    const f=await setupDropStaging(setup,{source:761,managedPearl:true});try{const pearl={uid:'stage-managed',kind:'brasa'},swallowed={uid:'stage-swallowed',kind:'escarcha'};f.world.ecs.xp[f.receiver]=37.129;f.world.ecs.level[f.receiver]=4;f.world.ecs.potions[f.receiver]=3;const h=requestPickup(f);await finish(f,h);const ctx=f.stage.operations.get(h.operationId),data=(await f.store.loadProfile(KILLER)).data;assert.equal(data.xp,37.13);assert.equal(data.lvl,4);assert.equal(data.pot,3);assert.deepEqual(data.pearls.bag,[pearl]);assert.deepEqual(data.pearls.swallowed,swallowed);assert.equal(f.stage.drain()[0].state,'applied');assert.deepEqual(f.world.profiles.get(f.receiver),ctx.after);}finally{await f.close?.();}
  });
  await t.test('potion pickup updates profile and ECS potion count only at drain',async()=>{
    const f=await setupDropStaging(setup,{kind:'potion',source:762});try{const before=f.world.ecs.potions[f.receiver],h=requestPickup(f);await finish(f,h);assert.equal(f.world.ecs.potions[f.receiver],before);f.stage.drain();assert.equal(f.world.ecs.potions[f.receiver],before+1);assert.equal(f.world.profiles.get(f.receiver).pot,before+1);}finally{await f.close?.();}
  });
  await t.test('full item bag and full potion capacity reject before reserving or consuming',async()=>{
    for(const cfg of [{source:763,kind:'item',mutate:(p,f)=>{p.bag=Array.from({length:24},(_,i)=>({...f.drop.item,u:100+i}));p.uid=124;p.stats.items=24;}},{source:764,kind:'potion',mutate:(p,f)=>{f.world.ecs.potions[f.receiver]=5;p.pot=5;}}]){const f=await setupDropStaging(setup,cfg);try{cfg.mutate(f.world.profiles.get(f.receiver),f);assert.throws(()=>requestPickup(f),{code:'capacity'});assert.equal(f.world.drops.has(f.dropId),true);assert.equal(f.stage.operations.size,0);}finally{await f.close?.();}}
  });
  await t.test('wrong receiver, distance, pickup window and source identity do not create a request',async()=>{
    const f=await setupDropStaging(setup,{source:765});try{assert.throws(()=>requestPickup(f,1),{code:'session'});f.world.ecs.x[f.receiver]+=100;assert.throws(()=>requestPickup(f),{code:'ownership'});f.world.ecs.x[f.receiver]=f.drop.x;f.world.tick=f.drop.t+1;assert.throws(()=>requestPickup(f),{code:'ownership'});f.world.tick=f.drop.pickAt;f.drop.ordinal=0;assert.throws(()=>requestPickup(f),{code:'operation'});assert.equal(f.world.drops.has(f.dropId),true);}finally{await f.close?.();}
  });
  await t.test('expiration durably settles without receiver lanes and removes only after drain',async()=>{
    const f=await setupDropStaging(setup,{source:766});try{f.world.tick=f.drop.t+1;const before=snapshot(f),h=f.stage.expire({dropId:f.dropId});await finish(f,h);assert.deepEqual(snapshot(f),before);assert.equal(f.stage.drain()[0].state,'applied');assert.equal(f.world.drops.has(f.dropId),false);assert.deepEqual(f.world.events.at(-1).ids,[f.dropId]);assert.equal(f.world.events.at(-1).why,'expire');}finally{await f.close?.();}
  });
  await t.test('the account and source lanes remain busy through durable receipt and drain',async()=>{
    const f=await setupDropStaging(setup,{source:767});try{const h=requestPickup(f);assert.throws(()=>f.stage.assertPublishable(2),{code:'busy'});assert.throws(()=>requestPickup(f),{code:'busy'});await finish(f,h);assert.throws(()=>f.stage.assertPublishable(2),{code:'busy'});assert.throws(()=>requestPickup(f),{code:'busy'});f.stage.drain();f.stage.assertPublishable(2);}finally{await f.close?.();}
  });
  await t.test('lost committed reply resolves the same transition without pre-drain effects',async()=>{
    const f=await setupDropStaging(setup,{source:768});let calls=0;try{f.sessions.store={...f.store,async commitDeathDrop(r){calls++;const value=await f.store.commitDeathDrop(r);if(calls===1)throw new Error('reply lost');return value;}};const before=snapshot(f),h=requestPickup(f);await finish(f,h);const ctx=f.stage.operations.get(h.operationId),raw={operationId:h.operationId,...ctx.request};assert.ok(calls>=1&&calls<=2);assert.deepEqual(snapshot(f),before);assert.equal((await f.journal.prepare('drop',raw)).state,'committed');assert.ok(await f.store.loadDeathDropOperation(h.operationId));const terminal=await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal);assert.equal(terminal.state,'picked');assert.equal(terminal.transitionOperationId,h.operationId);assert.equal(f.stage.drain()[0].state,'applied');assert.equal(new Set((await f.store.listDeathDrops(WORLD)).map(x=>x.operationId+':'+x.ordinal)).size,(await f.store.listDeathDrops(WORLD)).length);}finally{await f.close?.();}
  });
  for(const fence of ['profile','ecs','drop','closed','tick']) await t.test(`${fence} mutation before drain fences the receipt`,async()=>{
    const f=await setupDropStaging(setup,{source:769+['profile','ecs','drop','closed','tick'].indexOf(fence)});try{const h=requestPickup(f);await finish(f,h);if(fence==='profile')f.world.profiles.get(f.receiver).gold++;if(fence==='ecs')f.world.ecs.xp[f.receiver]++;if(fence==='drop')f.drop.x++;if(fence==='closed')f.sessions.close(2);if(fence==='tick')f.world.tick++;const result=f.stage.drain()[0];assert.equal(result.state,'fenced');assert.equal(f.world.drops.has(f.dropId),true);assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'picked');}finally{await f.close?.();}
  });
  await t.test('unrelated events and drops survive the apply boundary',async()=>{
    const f=await setupDropStaging(setup,{source:774});try{const h=requestPickup(f);await finish(f,h);const extra={id:99,to:0,kind:'item',x:8,z:9,t:500,operationId:deathOp(880),ordinal:1,item:{u:99}};f.world.drops.set(99,extra);f.world.events.push({type:'kill',id:999});f.stage.drain();assert.equal(f.world.drops.get(99),extra);assert.deepEqual(f.world.events[0],{type:'kill',id:999});assert.equal(f.world.events.at(-1).type,'unloot');}finally{await f.close?.();}
  });
}
