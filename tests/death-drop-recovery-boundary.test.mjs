import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { createMemoryPearlJournals, journalEntry } from '../server/pearlJournal.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { seedDeathDropScenario, pickupRequest, expiryRequest, WORLD, KILLER, deathOp } from './helpers/death-drop-storage.mjs';
const setup=async()=>{const store=createMemoryStore(),source=await seedDeathDropScenario(store);const journal=createMemoryPearlJournals(store)(WORLD);
  const s=new ProfileSessions(store,null,{journal});await s.recoverPearls();await s.open(1,KILLER);return {store,source,journal,s};};

test('drop lane descriptors reject aliases, holes and excess without leaking capabilities',async()=>{
  const {s,source}=await setup(),gate=pearlMutationGate(s),key=source.itemDrop.operationId+':'+source.itemDrop.ordinal;
  for(const drops of [[key.replace(':',':0')],['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA:1'],['bad:1'],['bad'],new Array(1),Array(257).fill(key),[key+':extra'],[{}]]) {
    assert.throws(()=>gate.reserve({drops}),error=>error instanceof StoreError && ['operation','identity'].includes(error.code));gate.assertAvailable({drops:[key]});
  }
  const token=gate.reserve({drops:[key,key]});assert.equal(gate.active(token),true);gate.release(token);
  assert.throws(()=>gate.release(token),{code:'operation'});
});

test('drop-only invalidation fences the entire receiver/UID capability after storage lanes release',async()=>{
  const {s,source,store}=await setup(),raw=await pickupRequest(store,source),gate=pearlMutationGate(s);
  const key=raw.drop.operationId+':'+raw.drop.ordinal, lanes={accounts:[KILLER],uids:[],drops:[key]};
  const token=gate.reserve(lanes);await s.commitDeathDrop(raw,token);assert.equal(s.pearls.drops.size,0);
  gate.invalidate({drops:[key]});assert.equal(gate.active(token),false);assert.throws(()=>gate.release(token),{code:'busy'});
  assert.throws(()=>gate.assertAvailable({accounts:[KILLER]}),{code:'busy'});
  assert.throws(()=>gate.assertWorldAvailable(),{code:'busy'});await s.flush();
});

test('unresolved drop UUID and receiver exclude a pearl command before asynchronous dispatch',async()=>{
  const {s,source,store}=await setup(),raw=await pickupRequest(store,source);
  let resolve;const blocked=new Promise(r=>{resolve=r;});s.store={...store,async commitDeathDrop(r){await blocked;return store.commitDeathDrop(r);}};
  const pending=s.commitDeathDrop(raw);
  try{
    await assert.rejects(s.commitPearl({operationId:deathOp(1330),uid:'not-managed',kind:'brasa',from:null,to:KILLER,expectedVersion:0},()=>[]),{code:'busy'});
    await assert.rejects(s.commitPearlGround({operationId:raw.operationId,uid:'not-managed',kind:'brasa',from:null,to:null,expectedVersion:0,world:WORLD,
      ground:{x:0,z:0,availableAt:1,returnAt:2}},()=>[]),{code:'busy'});
  }finally{resolve();await pending;await s.flush();}
});

test('memory namespace excludes legacy RPC receipt while drop is only a pending intention',async()=>{
  const {store,source,journal}=await setup(),raw=await expiryRequest(source);await journal.prepare('drop',raw);
  assert.deepEqual(await store.commitPearlGround({operationId:raw.operationId,uid:'drop:collision',kind:'brasa',from:null,to:null,
    expectedVersion:0,world:WORLD,ground:{x:0,z:0,availableAt:1,returnAt:2},profiles:[]}),{ok:false,why:'operation'});
  const changed=structuredClone(raw);changed.at++;assert.deepEqual(await store.commitDeathDrop(changed),{ok:false,why:'operation'});
  assert.equal(await store.loadDeathDropOperation(raw.operationId),null);
});

test('full paginated recovery rejects duplicate source lanes across pages without partial reservations',async()=>{
  const {store,source}=await setup();const entries=[];
  for(let i=0;i<65;i++){
    const raw=await expiryRequest(source,{operation:1500+i});
    raw.drop.operationId=deathOp(1700+i);raw.drop.ordinal=1;
    if(i===64)raw.drop={...entries[0].request.drop};
    entries.push(journalEntry(WORLD,'drop',raw));
  }
  let scans=0,reads=0;
  const journal={scope:WORLD,prepare(){assert.fail();},resolve(){assert.fail();},async list({afterId,limit}){scans++;return entries.filter(e=>!afterId||e.operationId>afterId).slice(0,limit);}};
  const s=new ProfileSessions({...store,async loadDeathDropOperation(){reads++;assert.fail();}},null,{journal});
  await assert.rejects(s.recoverPearls(),{code:'response'});assert.equal(scans,2);assert.equal(reads,0);
  assert.equal(s.pearls.drops.size,0);assert.equal(s.pearls.accountIds.size,0);assert.equal(s.pearls.operationIds.size,0);
});

test('receipt lookup failure never permits an explicit resume send, including zero-account expiry',async()=>{
  const {store,source,journal}=await setup(),raw=await expiryRequest(source);await journal.prepare('drop',raw);let sends=0;
  const s=new ProfileSessions({...store,async loadDeathDropOperation(){throw new StoreError('unavailable');},async commitDeathDrop(){sends++;assert.fail();}},null,{journal});
  await s.recoverPearls();await assert.rejects(s.resumeDeathDrop(raw.operationId),{code:'unavailable'});
  assert.equal(sends,0);assert.equal(s.pearls.drops.size,1);assert.equal(s.pearls.unresolved.size,1);
});
