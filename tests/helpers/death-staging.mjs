import assert from 'node:assert/strict';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { DeathStaging } from '../../server/deathStaging.mjs';
import { capturePearlProfile } from '../../server/pearlProfileSnapshot.mjs';
import { makeDeath, planRequest, seedDeathStore, WORLD, VICTIM, KILLER } from './death-storage.mjs';
import { memorySetup, deferred } from './death-queue-contract.mjs';
export { memorySetup, deferred, WORLD, VICTIM, KILLER };
export const row = (w, e) => Object.fromEntries(Object.entries(w.ecs).filter(([,c])=>ArrayBuffer.isView(c)&&!(c instanceof DataView)).map(([key,c])=>[key,c[e]]));
export const snapshot = (f) => ({ rows:[row(f.world,f.entity), ...(f.killerEntity?[row(f.world,f.killerEntity)]:[])],
  profiles:structuredClone([...f.world.profiles]),ledger:structuredClone([...f.world.pearlLedger]),drops:structuredClone([...f.world.drops]),
  events:structuredClone(f.world.events),nextDrop:f.world.nextDrop,dirty:[...f.world.profileDirty],rng:f.world.lootRng.state() });
export async function setupStaging(setup = memorySetup, options = {lawless:true,killer:true,pearlCount:3,loot:true}) {
  const db=await setup(), f=makeDeath(options), {request}=planRequest(f);
  await seedDeathStore(db.store,f,request);
  if(f.killerEntity && !request.killer) assert.equal((await db.store.saveProfile(KILLER,capturePearlProfile(f.world,f.killerEntity),0)).ok,true);
  const sessions=new ProfileSessions(db.store,null,{journal:db.journal});await sessions.recoverPearls();
  await sessions.open(1,VICTIM);f.world.ecs.clientId[f.entity]=1;
  if(f.killerEntity){await sessions.open(2,KILLER);f.world.ecs.clientId[f.killerEntity]=2;}
  const stage=new DeathStaging(sessions,f.world,WORLD);
  const selectors={victim:{clientId:1,entity:f.entity},seq:19,...(f.killerEntity?{killer:{clientId:2,entity:f.killerEntity}}:{})};
  return {...db,...f,sessions,stage,selectors,seedRequest:request};
}
export async function stagingContract(t,setup=memorySetup) {
  for(const options of [{pearlCount:0},{pearlCount:3,loot:true},{lawless:true,killer:true,pearlCount:9,loot:true},{killer:true,pearlCount:2}])
    await t.test('receipt precedes atomic tick apply '+JSON.stringify(options),async()=>{
      const f=await setupStaging(setup,options);
      try{
        const before=snapshot(f),rng=f.world.lootRng,profiles=f.world.profiles,events=f.world.events;
        const handle=f.stage.request(f.selectors),ctx=f.stage.operations.get(handle.operationId);
        assert.deepEqual(snapshot(f),before);assert.equal(ctx.state,'pending');assert.deepEqual(f.stage.drain(),[]);
        assert.throws(()=>f.stage.request(f.selectors),{code:'busy'});
        assert.throws(()=>f.stage.assertPublishable(1),{code:'busy'});
        await f.stage.settle();assert.equal(ctx.state,'ready');assert.deepEqual(snapshot(f),before);
        assert.ok(await f.store.loadDeathOperation(handle.operationId));
        for(const e of ctx.endpoints)assert.deepEqual((await f.store.loadProfile(e.key)).data,ctx.request.profiles.find(p=>p.id===e.key).data);
        f.stage.save(1,ctx.plan.profiles[0].before);
        assert.throws(()=>f.sessions.save(1,ctx.plan.profiles[0].before),{code:'busy'});
        assert.deepEqual(f.stage.drain(),[{operationId:handle.operationId,state:'applied'}]);
        assert.deepEqual(row(f.world,f.entity),ctx.plan.ecs.after);
        for(const p of ctx.plan.profiles)assert.deepEqual(f.world.profiles.get(p.entity),p.after);
        assert.deepEqual(f.world.events,ctx.plan.events);assert.equal(f.world.ecs.dead[f.entity],1);
        assert.equal(f.world.lootRng,rng);assert.equal(rng.state(),before.rng);assert.equal(f.world.profiles,profiles);assert.equal(f.world.events,events);
        for(const d of f.world.drops.values())if(d.kind!=='pearl')assert.ok(d.operationId===handle.operationId&&Number.isInteger(d.ordinal));
        assert.deepEqual(await f.store.listDeathDrops(WORLD),ctx.receipt.drops);
        assert.equal((await f.journal.prepare('death',{operationId:handle.operationId,...ctx.request})).state,'committed');
        f.stage.assertPublishable(1);assert.deepEqual(f.stage.drain(),[]);await f.sessions.flush();
        assert.throws(()=>f.stage.request(f.selectors),{code:'session'});
      }finally{await f.close?.();}
    });
  await t.test('lost committed reply recovers the same UUID without local apply or duplicate drops',async()=>{
    const f=await setupStaging(setup);let calls=0;
    try{
      f.sessions.store={...f.store,async commitDeath(r){calls++;const reply=await f.store.commitDeath(r);if(calls===1)throw new Error('lost');return reply;}};
      const before=snapshot(f),h=f.stage.request(f.selectors);await f.stage.settle();
      assert.equal(f.stage.operations.get(h.operationId).state,'ready');assert.deepEqual(snapshot(f),before);assert.ok(calls>=1&&calls<=2);
      assert.equal(f.stage.drain()[0].state,'applied');const drops=await f.store.listDeathDrops(WORLD);
      assert.equal(new Set(drops.map(d=>d.operationId+':'+d.ordinal)).size,drops.length);
    }finally{await f.close?.();}
  });
}
