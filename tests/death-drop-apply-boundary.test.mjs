import test from 'node:test';
import assert from 'node:assert/strict';
import { DeathDropStaging } from '../server/deathDropStaging.mjs';
import { prepareDeathDropApply } from '../server/deathDropApply.mjs';
import { setupDropStaging } from './helpers/death-drop-staging.mjs';
import { VICTIM } from './helpers/death-storage.mjs';

const effectPlan = ctx => ({drop:ctx.drop,dropId:ctx.dropId,endpoint:ctx.endpoint,before:ctx.before,after:ctx.after,
  liveBefore:ctx.endpoint?.live,victim:ctx.request.drop.victim});

test('drop apply rollback removes only tentative writes and its own publication',async()=>{
  const f=await setupDropStaging();try{
    const before=structuredClone(f.world.profiles.get(f.entity)),pot=f.world.ecs.potions[f.entity],h=f.stage.pickup(f.selectors);
    await f.stage.settle();const ctx=f.stage.operations.get(h.operationId);assert.equal(ctx.state,'ready');
    const effect=prepareDeathDropApply(f.world,effectPlan(ctx));effect.apply();effect.publish();effect.assertApplied();
    const unrelated={type:'unrelated'};f.world.events.push(unrelated);
    const other={id:99999,to:0,kind:'gold',x:0,z:0,t:200,n:1};f.world.drops.set(other.id,other);
    f.world.profiles.get(f.entity).gold+=7;
    effect.rollback();
    assert.equal(f.world.drops.get(ctx.dropId),ctx.drop);assert.equal(f.world.drops.get(other.id),other);
    assert.deepEqual(f.world.events,[unrelated]);
    assert.deepEqual(f.world.profiles.get(f.entity),{...before,gold:before.gold+7});assert.equal(f.world.ecs.potions[f.entity],pot);
    assert.equal((await f.store.loadDeathDrop(ctx.source.operationId,ctx.source.ordinal)).state,'picked');
    effect.rollback();assert.deepEqual(f.world.events,[unrelated]);
  }finally{await f.close?.();}
});

test('apply refuses collection overrides, proxies, and nonwritable event arrays before mutation',async()=>{
  const f=await setupDropStaging();try{
    const h=f.stage.pickup(f.selectors);await f.stage.settle();const ctx=f.stage.operations.get(h.operationId),world=f.world;
    const cases=[['drops',v=>{v.delete=()=>{throw new Error('callback');};}],
      ['drops',v=>{v[Symbol.iterator]=()=>{throw new Error('iterator');};}],
      ['pearlLedger',v=>{v.entries=()=>{throw new Error('entries');};}],
      ['profileDirty',v=>{v.add=()=>{throw new Error('callback');};}],
      ['events',v=>{Object.defineProperty(v,'length',{writable:false});}]];
    for(const [key,change]of cases){const old=world[key],next=Array.isArray(old)?[...old]:old instanceof Set?new Set(old):new Map(old);change(next);world[key]=next;
      assert.throws(()=>prepareDeathDropApply(world,effectPlan(ctx)),{code:'effect'});world[key]=old;}
    const old=world.drops;world.drops=new Proxy(old,{});assert.throws(()=>prepareDeathDropApply(world,effectPlan(ctx)),{code:'effect'});world.drops=old;
    assert.equal(world.drops.get(ctx.dropId),ctx.drop);assert.deepEqual(world.events,[]);
  }finally{await f.close?.();}
});

test('nonwritable live bag fences local apply while preserving committed SQL result',async()=>{
  const f=await setupDropStaging();try{
    const h=f.stage.pickup(f.selectors);await f.stage.settle();const ctx=f.stage.operations.get(h.operationId),p=f.world.profiles.get(f.entity),before=structuredClone(p);
    Object.defineProperty(p,'bag',{writable:false});
    assert.equal(f.stage.drain()[0].state,'fenced');assert.equal(ctx.state,'fenced');
    assert.deepEqual(p,before);assert.equal(f.world.drops.get(ctx.dropId),ctx.drop);assert.deepEqual(f.world.events,[]);
    assert.equal((await f.store.loadDeathDrop(ctx.source.operationId,ctx.source.ordinal)).state,'picked');
    assert.throws(()=>f.stage.gate.assertAvailable({drops:[ctx.lane]}),{code:'busy'});
  }finally{await f.close?.();}
});

test('capture reentry swallowed by checkpoint callback rejects without leaking authority',async()=>{
  const f=await setupDropStaging();try{
    const map=f.world.map,descriptor=Object.getOwnPropertyDescriptor(map,'checkpoints');let nested=0;
    Object.defineProperty(map,'checkpoints',{configurable:true,get(){nested++;try{f.stage.expire({dropId:f.drop.id});}catch{}return descriptor.value;}});
    try{assert.throws(()=>f.stage.pickup(f.selectors),{code:'effect'});}finally{Object.defineProperty(map,'checkpoints',descriptor);}
    assert.ok(nested>0);assert.equal(f.stage.operations.size,0);assert.equal(f.stage.tasks.size,0);
    f.stage.gate.assertAvailable({accounts:[f.sessions.clients.get(2).key],drops:[f.drop.operationId+':'+f.drop.ordinal]});
    assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'ground');
  }finally{await f.close?.();}
});

test('selector accessors and forged nested fields execute no callback and reserve no lane',async()=>{
  const f=await setupDropStaging();try{
    let gets=0;const raw={receiver:f.selectors.receiver};Object.defineProperty(raw,'dropId',{enumerable:true,get(){gets++;return f.drop.id;}});
    assert.throws(()=>f.stage.pickup(raw),{code:'effect'});assert.equal(gets,0);
    for(const bad of [{...f.selectors,profile:{}},{...f.selectors,receiver:{...f.selectors.receiver,account:'forged'}},
      {...f.selectors,dropId:0},{...f.selectors,dropId:'1'}])assert.throws(()=>f.stage.pickup(bad));
    assert.equal(f.stage.operations.size,0);assert.deepEqual(f.world.events,[]);
    f.stage.gate.assertAvailable({accounts:[f.sessions.clients.get(2).key],drops:[f.drop.operationId+':'+f.drop.ordinal]});
  }finally{await f.close?.();}
});

test('expiry capability survives storage lane release and cannot be bypassed by a second coordinator',async()=>{
  const f=await setupDropStaging(undefined,{mode:'expire'});try{
    f.world.tick=f.drop.t+1;const h=f.stage.expire(f.selectors);await f.stage.settle();const ctx=f.stage.operations.get(h.operationId);
    assert.equal(ctx.state,'ready');assert.equal(f.sessions.pearls.drops.size,0);
    f.stage.gate.assertAvailable({accounts:[f.sessions.clients.get(2).key]});
    const second=new DeathDropStaging(f.sessions,f.world,f.stage.scope);assert.throws(()=>second.expire(f.selectors),{code:'busy'});
    f.stage.invalidateDrop(ctx.source.operationId,ctx.source.ordinal);
    assert.equal(f.stage.drain()[0].state,'fenced');assert.equal(f.world.drops.get(ctx.dropId),ctx.drop);
    await assert.rejects(f.sessions.reconcileDeathDrop(ctx.operationId),{code:'operation'});
    assert.throws(()=>second.expire(f.selectors),{code:'busy'});assert.deepEqual(f.world.events,[]);
    assert.equal((await f.store.loadDeathDrop(ctx.source.operationId,ctx.source.ordinal)).state,'expired');
  }finally{await f.close?.();}
});

test('duplicate live durable source rejects capture without storage send or partial reservation',async()=>{
  const f=await setupDropStaging();try{
    f.world.drops.set(999,{...structuredClone(f.drop),id:999});
    assert.throws(()=>f.stage.pickup(f.selectors),{code:'ownership'});
    assert.equal(f.stage.operations.size,0);assert.equal(f.stage.tasks.size,0);
    f.stage.gate.assertAvailable({accounts:[f.sessions.clients.get(2).key],drops:[f.drop.operationId+':'+f.drop.ordinal]});
    assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'ground');
  }finally{await f.close?.();}
});

test('apply never executes live emit or onPickup callbacks, and own recovery uses durable account identity',async()=>{
  const f=await setupDropStaging();try{
    const victim=[...f.world.profiles].find(([,p])=>p.pirateId==='account:'+VICTIM)[0];
    f.world.ecs.x[victim]=f.drop.x;f.world.ecs.z[victim]=f.drop.z;
    const before=structuredClone(f.world.profiles.get(victim)),h=f.stage.pickup({dropId:f.drop.id,receiver:{clientId:1,entity:victim}});
    await f.stage.settle();assert.equal(f.stage.operations.get(h.operationId).state,'ready');let called=0;
    f.world.emit=()=>{called++;throw new Error('live emit');};f.world.onPickup=()=>{called++;throw new Error('live pickup');};
    assert.equal(f.stage.drain()[0].state,'applied');assert.equal(called,0);
    assert.equal(f.world.events[0].back,1);assert.equal(f.world.events[0].item.u,before.uid);
    assert.equal(f.world.events[0].elem,f.world.ecs.elem[victim]);assert.deepEqual(f.world.events.at(-1),{type:'unloot',pub:1,ids:[f.drop.id],why:'pick',by:victim});
  }finally{await f.close?.();}
});

test('storage creation mismatch fences without preparing an intent or changing the World',async()=>{
  const f=await setupDropStaging();try{
    let prepares=0,commits=0;const journal=f.sessions.pearls.journal;
    f.sessions.pearls.journal={...journal,async prepare(...args){prepares++;return journal.prepare(...args);}};
    f.sessions.store={...f.store,async loadDeathDrop(...args){const row=await f.store.loadDeathDrop(...args);row.ground.x++;return row;},
      async commitDeathDrop(raw){commits++;return f.store.commitDeathDrop(raw);}};
    const before=structuredClone(f.world.profiles.get(f.entity)),h=f.stage.pickup(f.selectors);
    await f.stage.settle();assert.equal(f.stage.drain()[0].state,'fenced');assert.equal(prepares,0);assert.equal(commits,0);
    assert.equal(f.world.drops.get(f.drop.id),f.drop);assert.deepEqual(f.world.profiles.get(f.entity),before);assert.deepEqual(f.world.events,[]);
    assert.equal(await f.store.loadDeathDropOperation(h.operationId),null);assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'ground');
  }finally{await f.close?.();}
});
