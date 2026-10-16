import assert from 'node:assert/strict';
import { createMemoryStore, StoreError } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { pearlMutationGate } from '../../server/pearlMutationGate.mjs';
import { deathResult } from '../../server/deathOperation.mjs';
import { makeDeath, planRequest, seedDeathStore, WORLD, VICTIM, KILLER, deathOp } from './death-storage.mjs';

export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export const memorySetup = async () => { const store = createMemoryStore(); return { store, journal: createMemoryPearlJournals(store)(WORLD) }; };
export async function setupQueue(setup, options = { lawless: true, killer: true, pearlCount: 3, loot: true }) {
  const f = await setup(), fixture = makeDeath(options), { request } = planRequest(fixture);
  await seedDeathStore(f.store, fixture, request);
  return { ...f, request, fixture };
}
export async function sessionsFor(f, store = f.store, journal = f.journal) {
  const s = new ProfileSessions(store, null, { journal }); await s.recoverPearls();
  await s.open(1, VICTIM); if (f.request.killer) await s.open(2, KILLER); return s;
}
const lanes = r => ({ accounts: r.profiles.map(p => p.id), uids: [...new Set(r.profiles.flatMap(p =>
  [...p.before.pearls.bag, ...(p.before.pearls.swallowed ? [p.before.pearls.swallowed] : [])].map(q => q.uid)))].sort() });
const blocked = (s,r) => { for (const id of lanes(r).accounts) assert.throws(() => pearlMutationGate(s).assertAvailable({ accounts: [id] }), { code: 'busy' });
  for (const uid of lanes(r).uids) assert.throws(() => pearlMutationGate(s).assertAvailable({ uids: [uid] }), { code: 'busy' }); };

export async function deathQueueContract(t, setup) {
  for (const options of [{ pearlCount: 0 }, { pearlCount: 3, loot: true }, { lawless: true, killer: true, pearlCount: 9, loot: true }])
    await t.test('exact dispatch, detached payload and all shared lanes: '+JSON.stringify(options), async () => {
      const f = await setupQueue(setup, options), started = deferred(), release = deferred(); let calls = 0;
      try {
        const wanted = structuredClone(f.request), s = await sessionsFor(f, { ...f.store, async commitDeath(r) {
          calls++; assert.deepEqual(r,wanted); started.resolve(); await release.promise; return f.store.commitDeath(r);
        } });
        const pending = s.commitDeath(f.request); blocked(s,wanted);
        f.request.rules.xpBefore = 999; f.request.profiles[0].data.gold = 9999;
        await started.promise; blocked(s,wanted);
        await assert.rejects(s.commitDeath(wanted), { code:'busy' });
        await assert.rejects(s.commitPearlBatch({ operationId: wanted.operationId, actor: VICTIM, world: WORLD, mode:'death',
          items: wanted.pearls.length ? wanted.pearls : [{ uid:'other',kind:'brasa',expectedVersion:1,ground:{x:0,z:0,availableAt:1,returnAt:2} }] }, () => []), { code:'busy' });
        release.resolve(); const result = await pending; await s.flush();
        assert.equal(calls,1); assert.deepEqual(result.receipt,deathResult(wanted,wanted.operationId));
        assert.deepEqual(result.profiles,wanted.profiles.map(p=>({id:p.id,data:p.data})));
        for (const p of wanted.profiles) assert.deepEqual(await f.store.loadProfile(p.id),{data:p.data,version:p.expectedVersion+1});
        assert.deepEqual(await f.store.listDeathDrops(WORLD),result.receipt.drops);
        assert.equal((await f.journal.prepare('death',wanted)).state,'committed');
      } finally { release.resolve(); await f.close?.(); }
    });

  await t.test('caller capability survives receipt and journal closure; subset token cannot bypass victim/PK/UID lanes', async () => {
    const f = await setupQueue(setup);
    try { const s=await sessionsFor(f), gate=pearlMutationGate(s), r=f.request;
      const subset=gate.reserve({accounts:[VICTIM],uids:r.pearls.map(q=>q.uid)});
      await assert.rejects(s.commitDeath(r,subset),{code:'operation'}); gate.release(subset);
      const held=gate.reserve(lanes(r)); await s.commitDeath(r,held); await s.flush(); blocked(s,r);
      assert.equal(gate.active(held),true); gate.release(held); gate.assertAvailable(lanes(r));
    } finally { await f.close?.(); }
  });

  for (const who of [VICTIM,KILLER]) await t.test('pre-capture pending progress on '+who+' rejects frozen baseline before prepare/send', async () => {
    const f=await setupQueue(setup); let prepares=0,sends=0;
    try { const journal={...f.journal,async prepare(...a){prepares++;return f.journal.prepare(...a);}};
      const s=await sessionsFor(f,{...f.store,async commitDeath(r){sends++;return f.store.commitDeath(r);}},journal);
      const p=structuredClone(f.request.profiles.find(p=>p.id===who).before); p.gold++;
      s.save(who===VICTIM?1:2,p);
      await assert.rejects(s.commitDeath(f.request),{code:'conflict'});
      assert.equal(prepares,0);assert.equal(sends,0);assert.equal(await f.store.loadDeathOperation(f.request.operationId),null);
      assert.equal((await f.store.loadProfile(who)).data.gold,p.gold);
    } finally {await f.close?.();}
  });

  for (const change of ['unchanged','XP','bag','killer']) await t.test('snapshot during dispatch: '+change, async()=>{
    const f=await setupQueue(setup), started=deferred(), release=deferred();
    try { const s=await sessionsFor(f,{...f.store,async commitDeath(r){started.resolve();await release.promise;return f.store.commitDeath(r);}});
      const pending=s.commitDeath(f.request); const rejected=change==='unchanged'?null:assert.rejects(pending,{code:'conflict'});
      await started.promise; const target=change==='killer'?KILLER:VICTIM, p=structuredClone(f.request.profiles.find(p=>p.id===target).before);
      if(change==='XP')p.xp++;if(change==='bag')p.bag=[];if(change==='killer')p.gold++;
      s.save(target===VICTIM?1:2,p); release.resolve();
      if(rejected){await rejected;await assert.rejects(s.flush(),{code:'flush'});for(const row of f.request.profiles)assert.equal(s.accounts.get(row.id).version,row.expectedVersion);}
      else {await pending;await s.flush();}
      for(const row of f.request.profiles)assert.deepEqual((await f.store.loadProfile(row.id)).data,row.data);
    }finally{release.resolve();await f.close?.();}
  });

  await t.test('ambiguous prepare persists exact request; new authority reads only then explicit resume sends once',async()=>{
    const f=await setupQueue(setup);let sends=0;
    try{const store={...f.store,async commitDeath(r){sends++;assert.deepEqual(r,f.request);return f.store.commitDeath(r);}};
      const first=await sessionsFor(f,store,{...f.journal,async prepare(...a){await f.journal.prepare(...a);throw new StoreError('unavailable');}});
      await assert.rejects(first.commitDeath(f.request),{code:'unavailable'});blocked(first,f.request);assert.equal(sends,0);
      const next=new ProfileSessions(store,null,{journal:f.journal});assert.deepEqual(await next.recoverPearls(),[{operationId:f.request.operationId,outcome:'pending'}]);
      blocked(next,f.request);await assert.rejects(next.open(3,VICTIM),{code:'busy'});await assert.rejects(next.resumePearlBatch(f.request.operationId),{code:'operation'});
      await next.resumeDeath(f.request.operationId);await next.flush();assert.equal(sends,1);assert.equal((await f.journal.prepare('death',f.request)).state,'committed');
      assert.deepEqual(await next.open(3,VICTIM),f.request.profiles.find(p=>p.id===VICTIM).data);
    }finally{await f.close?.();}
  });

  await t.test('two lost commit replies and receipt outage retain lanes; restart reconciles without sending',async()=>{
    const f=await setupQueue(setup);let sends=0;
    try{const first=await sessionsFor(f,{...f.store,async commitDeath(r){sends++;await f.store.commitDeath(r);throw new StoreError('unavailable');},async loadDeathOperation(){throw new StoreError('unavailable');}});
      await assert.rejects(first.commitDeath(f.request),{code:'unavailable'});blocked(first,f.request);assert.equal(sends,2);
      const next=new ProfileSessions({...f.store,async commitDeath(){assert.fail('Recovery must not send');}},null,{journal:f.journal});
      assert.deepEqual(await next.recoverPearls(),[{operationId:f.request.operationId,outcome:'committed'}]);await next.flush();assert.equal(sends,2);
      for(const p of f.request.profiles)assert.equal((await f.store.loadProfile(p.id)).version,p.expectedVersion+1);
      assert.equal((await f.store.listDeathDrops(WORLD)).length,f.request.drops.length);
    }finally{await f.close?.();}
  });

  for(const advanced of ['profile','pearl'])await t.test('receipt recovery after advanced '+advanced+' closes conflict without historical effects',async()=>{
    const f=await setupQueue(setup);try{await f.journal.prepare('death',f.request);await f.store.commitDeath(f.request);
      if(advanced==='profile'){const p=await f.store.loadProfile(VICTIM);p.data.gold++;await f.store.saveProfile(VICTIM,p.data,p.version);}
      else{const q=f.request.pearls[0];await f.store.commitPearlGround({operationId:deathOp(75),world:WORLD,uid:q.uid,kind:q.kind,from:null,to:null,expectedVersion:q.expectedVersion+1,profiles:[],ground:{...q.ground,x:q.ground.x+1}});}
      const next=new ProfileSessions({...f.store,async commitDeath(){assert.fail('No recovery send');}},null,{journal:f.journal});
      assert.deepEqual(await next.recoverPearls(),[{operationId:f.request.operationId,outcome:'conflict'}]);await next.flush();
      assert.equal((await f.journal.prepare('death',f.request)).state,'conflict');assert.equal(next.pearls.unresolved.size,0);
    }finally{await f.close?.();}
  });

  await t.test('lost terminal reply preserves pending fence; later progress retains committed audit and retires stale context',async()=>{
    const f=await setupQueue(setup);try{let lose=true;const s=await sessionsFor(f,f.store,{...f.journal,async resolve(...a){const row=await f.journal.resolve(...a);if(lose){lose=false;throw new StoreError('unavailable');}return row;}});
      await assert.rejects(s.commitDeath(f.request),{code:'unavailable'});blocked(s,f.request);
      const row=await f.store.loadProfile(VICTIM);row.data.gold++;await f.store.saveProfile(VICTIM,row.data,row.version);
      await assert.rejects(s.reconcileDeath(f.request.operationId),{code:'conflict'});
      assert.equal(s.pearls.unresolved.size,0);assert.equal((await f.journal.prepare('death',f.request)).state,'committed');
      await assert.rejects(s.flush(),{code:'flush'});
    }finally{await f.close?.();}
  });

  await t.test('close/invalidation during journal prepare retires pending without dispatch; gameplay fence remains sticky',async()=>{
    const f=await setupQueue(setup), prepared=deferred(), release=deferred();let sends=0;
    try{const s=await sessionsFor(f,{...f.store,async commitDeath(r){sends++;return f.store.commitDeath(r);}},{...f.journal,async prepare(...a){const row=await f.journal.prepare(...a);prepared.resolve();await release.promise;return row;}});
      const gate=pearlMutationGate(s),held=gate.reserve(lanes(f.request));const pending=s.commitDeath(f.request,held);const rejected=assert.rejects(pending,{code:'cancelled'});
      await prepared.promise;s.close(1);release.resolve();await rejected;assert.equal(sends,0);assert.equal(gate.active(held),false);
      blocked(s,f.request);assert.equal((await f.journal.prepare('death',f.request)).state,'rejected');
    }finally{release.resolve();await f.close?.();}
  });
  await t.test('killer unchanged pearls also share UID lanes and survive PK-only commit',async()=>{
    const f=await setupQueue(setup);try{
      const before=await f.store.loadProfile(KILLER),data=structuredClone(before.data),q={uid:'killer:kept',kind:'tinta'};data.pearls.bag.push(q);
      assert.equal((await f.store.commitPearlGround({operationId:deathOp(701),world:WORLD,...q,from:null,to:KILLER,expectedVersion:0,ground:null,
        profiles:[{id:KILLER,expectedVersion:before.version,data}]})).ok,true);
      const row=await f.store.loadProfile(KILLER),p=f.request.profiles.find(p=>p.id===KILLER);p.expectedVersion=row.version;p.before=structuredClone(row.data);p.data=structuredClone(row.data);p.data.stats.pk++;
      const s=await sessionsFor(f),gate=pearlMutationGate(s),subset=gate.reserve({accounts:[VICTIM,KILLER],uids:f.request.pearls.map(q=>q.uid)});
      await assert.rejects(s.commitDeath(f.request,subset),{code:'operation'});gate.release(subset);
      const held=gate.reserve(lanes(f.request));await s.commitDeath(f.request,held);assert.throws(()=>gate.assertAvailable({uids:[q.uid]}),{code:'busy'});
      assert.deepEqual(await f.store.loadUnique(q.uid),{holder:KILLER,kind:'pearl:tinta',version:1});gate.release(held);await s.flush();
    }finally{await f.close?.();}
  });

  await t.test('exact retry uses historical receipt once and checks current complete authority',async()=>{
    const f=await setupQueue(setup);let sends=0;try{const s=await sessionsFor(f,{...f.store,async commitDeath(r){sends++;await f.store.commitDeath(r);throw new StoreError('unavailable');}});
      const result=await s.commitDeath(f.request);await s.flush();assert.equal(sends,2);assert.equal(result.receipt.replay,true);
      assert.deepEqual(result.profiles,f.request.profiles.map(p=>({id:p.id,data:p.data})));
      for(const p of f.request.profiles)assert.equal((await f.store.loadProfile(p.id)).version,p.expectedVersion+1);
    }finally{await f.close?.();}
  });

  await t.test('explicit resume sends original stale baseline and rejects instead of recomputing losses',async()=>{
    const f=await setupQueue(setup);let sends=0;try{await f.journal.prepare('death',f.request);
      const row=await f.store.loadProfile(VICTIM);row.data.xp++;await f.store.saveProfile(VICTIM,row.data,row.version);
      const s=new ProfileSessions({...f.store,async commitDeath(r){sends++;assert.deepEqual(r,f.request);return f.store.commitDeath(r);}},null,{journal:f.journal});
      await s.recoverPearls();assert.equal(sends,0);await assert.rejects(s.resumeDeath(f.request.operationId),{code:'conflict'});
      await s.flush();assert.equal(sends,1);assert.equal((await f.journal.prepare('death',f.request)).state,'rejected');
      assert.equal(await f.store.loadDeathOperation(f.request.operationId),null);assert.deepEqual((await f.store.loadProfile(VICTIM)).data,row.data);
    }finally{await f.close?.();}
  });

  await t.test('receipt visible but current authority read unavailable remains pending and blocks admission',async()=>{
    const f=await setupQueue(setup);try{await f.journal.prepare('death',f.request);await f.store.commitDeath(f.request);
      const s=new ProfileSessions({...f.store,async loadProfile(){throw new StoreError('unavailable');},async commitDeath(){assert.fail('No send');}},null,{journal:f.journal});
      assert.deepEqual(await s.recoverPearls(),[{operationId:f.request.operationId,outcome:'pending'}]);blocked(s,f.request);
      await assert.rejects(s.flush(),{code:'flush'});assert.equal((await f.journal.prepare('death',f.request)).state,'pending');
    }finally{await f.close?.();}
  });

}
