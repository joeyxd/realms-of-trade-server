import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDeathApply } from '../server/deathApply.mjs';
import { captureDeathPlan } from '../server/deathPlan.mjs';
import { makeDeath,deathOp } from './helpers/death-storage.mjs';
import { snapshot,row } from './helpers/death-staging.mjs';

for(const options of [{pearlCount:0},{pearlCount:3,loot:true},{lawless:true,killer:true,pearlCount:9,loot:true}])
 test('detached synchronous effect restores exact local state and references '+JSON.stringify(options),()=>{
  const f=makeDeath(options),w=f.world,e=f.entity,plan=captureDeathPlan(w,e,{by:f.killerEntity}),before=snapshot(f);
  const profile=w.profiles.get(e),refs={bag:profile.bag,pearls:profile.pearls,mast:profile.mast,eq:profile.eq,stats:profile.stats};
  const effect=prepareDeathApply(w,plan,deathOp(1));assert.deepEqual(snapshot(f),before);
  effect.assertCurrent();effect.apply();effect.assertApplied();assert.deepEqual(row(w,e),plan.ecs.after);
  effect.publish();effect.assertApplied();assert.deepEqual(w.events,plan.events);
  effect.rollback();assert.deepEqual(snapshot(f),before);assert.equal(w.profiles.get(e),profile);
  for(const [key,ref] of Object.entries(refs))assert.equal(profile[key],ref);effect.rollback();assert.deepEqual(snapshot(f),before);
 });
test('ordinary persistent identity follows ordinary ordinal while remapped pearl IDs update events and ledger',()=>{
 const f=makeDeath({lawless:true,pearlCount:2,loot:true}),w=f.world,plan=captureDeathPlan(w,f.entity);
 const foreign={id:14,kind:'potion',x:0,z:0,t:99};w.drops.set(14,foreign);w.nextDrop=15;
 const before=snapshot(f),effect=prepareDeathApply(w,plan,deathOp(2));effect.apply();effect.publish();effect.assertApplied();
 assert.deepEqual(effect.drops.map(d=>d.id),plan.drops.map((_,i)=>15+i));
 assert.deepEqual(effect.drops.filter(d=>d.kind!=='pearl').map(d=>d.ordinal),[1,2,3,4]);
 for(const d of effect.drops.filter(d=>d.kind!=='pearl'))assert.equal(d.operationId,deathOp(2));
 for(const q of plan.ledgers)assert.equal(w.pearlLedger.get(q.uid).drop,14+q.data.drop);
 effect.rollback();assert.deepEqual(snapshot(f),before);assert.equal(w.drops.get(14),foreign);
});
for(const [name,mutate] of [
 ['drop identity',effect=>{effect.drops[0].ordinal=99;}],
 ['ledger identity',(_,w)=>{[...w.pearlLedger.values()].find(q=>q.place==='ground').drop=999;}],
 ['publication data',(_,w)=>{w.events[0].seq=999;}],
])test('post-apply check detects corrupt '+name,()=>{
 const f=makeDeath({pearlCount:2,loot:true}),w=f.world,plan=captureDeathPlan(w,f.entity),before=snapshot(f),effect=prepareDeathApply(w,plan,deathOp(3));
 effect.apply();effect.publish();mutate(effect,w);assert.throws(()=>effect.assertApplied(),{code:'effect'});effect.rollback();assert.deepEqual(snapshot(f),before);
});
test('allocator collision and unsafe capacity reject before a tentative write',()=>{
 const f=makeDeath({pearlCount:2}),w=f.world,plan=captureDeathPlan(w,f.entity);
 w.drops.set(w.nextDrop,{id:w.nextDrop});let before=snapshot(f);assert.throws(()=>prepareDeathApply(w,plan,deathOp(4)),{code:'busy'});assert.deepEqual(snapshot(f),before);
 w.drops.clear();w.nextDrop=Number.MAX_SAFE_INTEGER;before=snapshot(f);assert.throws(()=>prepareDeathApply(w,plan,deathOp(4)),{code:'effect'});assert.deepEqual(snapshot(f),before);
});
test('replaced container between prepare and apply aborts without mutation',()=>{
 const f=makeDeath({pearlCount:2}),w=f.world,plan=captureDeathPlan(w,f.entity),effect=prepareDeathApply(w,plan,deathOp(5));
 w.drops=new Map(w.drops);const before=snapshot(f);assert.throws(()=>effect.apply(),{code:'cancelled'});effect.rollback();assert.deepEqual(snapshot(f),before);
});
test('read-only profile field and proxied drop container reject before mutation',()=>{
 const f=makeDeath({pearlCount:2}),w=f.world,plan=captureDeathPlan(w,f.entity),p=w.profiles.get(f.entity);
 Object.defineProperty(p,'xp',{writable:false});let before=snapshot(f);assert.throws(()=>prepareDeathApply(w,plan,deathOp(6)),{code:'effect'});assert.deepEqual(snapshot(f),before);
 Object.defineProperty(p,'xp',{writable:true});const original=w.drops;w.drops=new Proxy(original,{});
 assert.throws(()=>prepareDeathApply(w,plan,deathOp(6)),{code:'effect'});w.drops=original;assert.deepEqual(snapshot(f),before);
});
test('rollback keeps pre-existing dirty marks and unrelated drops/RNG',()=>{
 const f=makeDeath({pearlCount:2,loot:true}),w=f.world;w.profileDirty.add(f.entity);const plan=captureDeathPlan(w,f.entity),effect=prepareDeathApply(w,plan,deathOp(7));
 effect.apply();effect.publish();const foreign={id:900,kind:'potion'};w.drops.set(900,foreign);w.lootRng();const state=w.lootRng.state();
 effect.rollback();assert.equal(w.drops.get(900),foreign);assert.equal(w.lootRng.state(),state);assert.ok(w.profileDirty.has(f.entity));
});
