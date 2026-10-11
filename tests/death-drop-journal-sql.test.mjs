import test from 'node:test';
import assert from 'node:assert/strict';
import { database, dropJournalSql } from './helpers/death-drop-journal-sql.mjs';
import { seedDeathDropScenario, pickupRequest, expiryRequest, WORLD, deathOp } from './helpers/death-drop-storage.mjs';
const body = r => { const { operationId, ...request } = r; return request; };

test('SQL012 exact intent/receipt/terminal identity survives reapply and replay without reopening loot', async () => {
  const f=await database(); try {
    const source=await seedDeathDropScenario(f.store), raw=await pickupRequest(f.store,source), j=f.journal(WORLD);
    const entry=await j.prepare('drop',raw); assert.equal(entry.state,'pending');
    assert.deepEqual(await j.list(),[entry]);
    const receipt=await f.store.commitDeathDrop(raw); assert.equal(receipt.ok,true);
    await j.resolve('drop',raw,'committed');
    await f.db.exec('RESET ROLE'); await f.db.exec(dropJournalSql); await f.db.exec('SET ROLE service_role');
    assert.deepEqual(await j.list(),[]); assert.equal((await j.prepare('drop',raw)).state,'committed');
    assert.deepEqual(await f.store.commitDeathDrop(raw),{...receipt,replay:true});
    assert.deepEqual(await f.store.loadDeathDrop(raw.drop.operationId,raw.drop.ordinal),receipt.drop);
    const changed=structuredClone(raw); changed.at++;
    await assert.rejects(j.prepare('drop',changed),{code:'operation'});
    assert.deepEqual(await f.store.commitDeathDrop(changed),{ok:false,why:'operation'});
  } finally { await f.close(); }
});

test('SQL012 validates exact delta and scope before persisting raw drop intents',async()=>{
  const f=await database();try {
    const source=await seedDeathDropScenario(f.store), raw=await pickupRequest(f.store,source);
    for(const mutate of [r=>r.profile.data.gold++,r=>r.profile.data.uid++,r=>r.world='other',r=>r.drop.ordinal=0,r=>r.profile.before=null]) {
      const bad=body(structuredClone(raw));mutate(bad);
      await assert.rejects(f.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',[WORLD,'drop',raw.operationId,bad]),{code:'MNP02'});
    }
    assert.equal((await f.db.query('select count(*)::int as n from public.mn_pearl_intents')).rows[0].n,0);
  }finally{await f.close();}
});

test('pending drop UUID excludes legacy receipt INSERT/UPDATE and legacy intent before its receipt exists',async()=>{
  const f=await database();try {
    const source=await seedDeathDropScenario(f.store), raw=await expiryRequest(source), j=f.journal(WORLD);
    await j.prepare('drop',raw);
    const tables=['mn_pearl_operations','mn_pearl_ground_operations','mn_pearl_batch_operations'];
    for(const [i,table] of tables.entries()) {
      await assert.rejects(f.db.query('insert into public.'+table+"(operation_id,request) values($1::uuid,'{}'::jsonb)",[raw.operationId]),{code:'MNP02'});
      const old=deathOp(1200+i);await f.db.query('insert into public.'+table+"(operation_id,request) values($1::uuid,'{}'::jsonb)",[old]);
      await assert.rejects(f.db.query('update public.'+table+' set operation_id=$1::uuid where operation_id=$2::uuid',[raw.operationId,old]),{code:'MNP02'});
      await assert.rejects(j.prepare('drop',{...raw,operationId:old}),{code:'operation'});
    }
    await assert.rejects(f.db.query('insert into public.mn_death_operations(operation_id,request) values($1::uuid,$2::jsonb)',[raw.operationId,body(source.request)]),{code:'MNP02'});
    await assert.rejects(f.db.query("insert into public.mn_pearl_intents(operation_id,scope,family,request,state) values($1::uuid,$2,'ground',$3::jsonb,'pending')",[raw.operationId,WORLD,{uid:'x',kind:'brasa',from:null,to:null,expectedVersion:0,profiles:[],world:WORLD,ground:{x:0,z:0,availableAt:1,returnAt:2}}]));
    assert.equal(await f.store.loadDeathDropOperation(raw.operationId),null);
    assert.equal((await f.store.loadDeathDrop(raw.drop.operationId,raw.drop.ordinal)).state,'ground');
  }finally{await f.close();}
});

test('terminal rejected intent retains UUID and cannot authorize a fresh drop receipt',async()=>{
  const f=await database();try {
    const raw=await expiryRequest(await seedDeathDropScenario(f.store)),j=f.journal(WORLD);
    await j.prepare('drop',raw);await j.resolve('drop',raw,'rejected');
    assert.deepEqual(await f.store.commitDeathDrop(raw),{ok:false,why:'operation'});
    await assert.rejects(f.db.query("insert into public.mn_pearl_operations(operation_id,request) values($1::uuid,'{}'::jsonb)",[raw.operationId]),{code:'MNP02'});
    assert.equal((await f.store.loadDeathDrop(raw.drop.operationId,raw.drop.ordinal)).state,'ground');
  }finally{await f.close();}
});

test('receipt-first exact drop intent is valid; changed request/family/scope is rejected',async()=>{
  const f=await database();try {
    const raw=await expiryRequest(await seedDeathDropScenario(f.store)),j=f.journal(WORLD);
    assert.equal((await f.store.commitDeathDrop(raw)).ok,true);
    const changed=structuredClone(raw);changed.at++;
    await assert.rejects(j.prepare('drop',changed),{code:'operation'});
    const entry=await j.prepare('drop',raw);assert.equal(entry.state,'pending');
    await j.resolve('drop',raw,'committed');
    await assert.rejects(f.db.query("update public.mn_pearl_intents set family='death' where operation_id=$1::uuid",[raw.operationId]),{code:'MNP02'});
    await assert.rejects(f.db.query('update public.mn_pearl_intents set scope=$1 where operation_id=$2::uuid',['other',raw.operationId]),{code:'MNP02'});
    await assert.rejects(f.db.query('update public.mn_death_drop_operations set operation_id=$1::uuid where operation_id=$2::uuid',[deathOp(1209),raw.operationId]),{code:'MNP02'});
  }finally{await f.close();}
});

test('SQL012 preserves service-only journal/function permissions and RLS',async()=>{
  const f=await database();try {
    const raw=await expiryRequest(await seedDeathDropScenario(f.store));
    for(const role of ['anon','authenticated']) {
      await f.db.exec('RESET ROLE; SET ROLE '+role);
      await assert.rejects(f.db.query('select * from public.mn_pearl_intents'),{code:'42501'});
      await assert.rejects(f.db.query('select public.mn_valid_pearl_intent($1,$2,$3::jsonb)',[WORLD,'drop',body(raw)]),{code:'42501'});
      await assert.rejects(f.db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',[WORLD,'drop',raw.operationId,body(raw)]),{code:'42501'});
      await assert.rejects(f.db.query('select * from public.mn_death_drop_states'),{code:'42501'});
    }
    await f.db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await f.journal(WORLD).prepare('drop',raw)).state,'pending');
  }finally{await f.close();}
});
