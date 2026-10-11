import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals, createSupabasePearlJournal, journalEntry } from '../server/pearlJournal.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { makeDeath, planRequest, seedDeathStore, WORLD, VICTIM, deathOp } from './helpers/death-storage.mjs';
const fixture = async () => { const store=createMemoryStore(), f=makeDeath({pearlCount:1,loot:true}), {request}=planRequest(f);
  await seedDeathStore(store,f,request);return {store,request,journal:createMemoryPearlJournals(store)(WORLD)}; };

test('bound memory journals share exact death identity, terminal state and scope across reconstructed factories',async()=>{
  const f=await fixture(),r=f.request,expected=journalEntry(WORLD,'death',r);assert.deepEqual(await f.journal.prepare('death',r),expected);
  const next=createMemoryPearlJournals(f.store)(WORLD);assert.deepEqual(await next.list(),[expected]);
  const altered=structuredClone(r);altered.drops[0].ground.x++;await assert.rejects(next.prepare('death',altered),{code:'operation'});
  await assert.rejects(createMemoryPearlJournals(f.store)('other').prepare('death',r),{code:'operation'});
  assert.equal((await f.store.commitDeath(r)).ok,true);await next.resolve('death',r,'committed');
  assert.deepEqual(await f.journal.list(),[]);assert.equal((await f.journal.prepare('death',r)).state,'committed');
  await assert.rejects(next.resolve('death',r,'rejected'),{code:'operation'});
  assert.equal((await f.store.commitDeath(r)).replay,true);
});

test('pending death intent reserves UUID against all legacy receipt families before receipt exists',async()=>{
  const f=await fixture(),r=f.request;await f.journal.prepare('death',r);
  const q=r.pearls[0],single={operationId:r.operationId,uid:q.uid,kind:q.kind,from:null,to:null,expectedVersion:0,profiles:[]};
  assert.deepEqual(await f.store.commitPearl({...single,to:VICTIM,profiles:[{id:VICTIM,expectedVersion:r.profiles[0].expectedVersion,data:r.profiles[0].before}]}),{ok:false,why:'operation'});
  assert.deepEqual(await f.store.commitPearlGround({...single,world:WORLD,ground:q.ground}),{ok:false,why:'operation'});
  const p=r.profiles[0],batch={operationId:r.operationId,world:WORLD,mode:'death',profile:{id:p.id,expectedVersion:p.expectedVersion,
    data:{...p.before,pearls:{bag:[],swallowed:null}}},items:r.pearls};
  assert.deepEqual(await f.store.commitPearlBatch(batch),{ok:false,why:'operation'});
});

test('foreign-family and terminal death intents prevent a new death receipt with no partial losses',async()=>{
  for(const terminal of [null,'rejected','conflict','committed']){
    const f=await fixture(),r=f.request;
    if(terminal){await f.journal.prepare('death',r);await f.journal.resolve('death',r,terminal);}
    else await f.journal.prepare('ground',{operationId:r.operationId,uid:'other',kind:'brasa',from:null,to:null,world:WORLD,
      expectedVersion:0,profiles:[],ground:{x:0,z:0,availableAt:1,returnAt:2}});
    assert.deepEqual(await f.store.commitDeath(r),{ok:false,why:'operation'});
    assert.equal(await f.store.loadDeathOperation(r.operationId),null);assert.deepEqual((await f.store.loadProfile(VICTIM)).data,r.profiles[0].before);
  }
});

for(const mode of ['order','scope','payload','duplicate','state'])test('provider death journal rejects corrupt '+mode+' response before recovery dispatch',async()=>{
  const f=await fixture(),entry=journalEntry(WORLD,'death',f.request),r=structuredClone(entry);let sends=0;
  if(mode==='scope')r.scope='other';if(mode==='payload')r.request.profiles[0].data.gold++;if(mode==='state')r.state='committed';
  const raw=mode==='duplicate'?[entry,entry]:mode==='order'?[{...entry,operationId:deathOp(9)},entry]:[r];
  const journal=createSupabasePearlJournal({rpc:async()=>({data:raw,error:null})},WORLD);
  const s=new ProfileSessions({...f.store,async commitDeath(){sends++;}},null,{journal});
  await assert.rejects(s.recoverPearls(),{code:'response'});assert.equal(sends,0);assert.equal(s.pearls.admitting,false);
  assert.equal(s.pearls.operationIds.size,0);
});

test('backlog validation rejects death/legacy overlap before installing any partial reservations',async()=>{
  const f=await fixture(),death=journalEntry(WORLD,'death',f.request),q=f.request.pearls[0];
  const old=journalEntry(WORLD,'ground',{operationId:deathOp(2),uid:q.uid,kind:q.kind,from:null,to:VICTIM,
    expectedVersion:1,world:WORLD,ground:null,profiles:[{id:VICTIM,expectedVersion:1,data:f.request.profiles[0].before}]});
  const s=new ProfileSessions(f.store,null,{journal:{...f.journal,list:async()=>[death,old]}});
  await assert.rejects(s.recoverPearls(),{code:'response'});assert.equal(s.pearls.operationIds.size,0);
});

test('journal write detaches request before provider awaits and sanitizes provider errors',async()=>{
  const f=await fixture(),r=f.request,wanted=journalEntry(WORLD,'death',r);let args;
  const journal=createSupabasePearlJournal({rpc:async(_name,body)=>{args=body;await Promise.resolve();return {data:wanted,error:null};}},WORLD);
  const pending=journal.prepare('death',r);r.profiles[0].data.gold++;assert.deepEqual(await pending,wanted);
  assert.deepEqual(args.p_request,wanted.request);
  const bad=createSupabasePearlJournal({rpc:async()=>{throw Error('secret provider error');}},WORLD);
  await assert.rejects(bad.prepare('death',{operationId:wanted.operationId,...wanted.request}),e=>e.code==='unavailable'&&!e.message.includes('secret'));
});
