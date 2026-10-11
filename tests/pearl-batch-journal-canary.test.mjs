import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createSupabaseStore } from '../server/store.mjs';
import { createSupabasePearlJournal } from '../server/pearlJournal.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { database } from './helpers/pearl-batch-journal-sql.mjs';
import { canaryClient } from './helpers/pearl-canary-sql-client.mjs';
import { journalPhases, journalFixture, newJournalManifest, checkedJournalManifest, verifyJournalPhase } from '../tools/verify-pearl-batch-journal.mjs';

function context(db,m,checks=[],calls=[]) {
  const admin=canaryClient(db,false,calls),f=journalFixture(m.ids);
  return {admin,store:createSupabaseStore(admin),journal:createSupabasePearlJournal(admin,f.scope),
    publicClient:canaryClient(db,true,calls),persist:async()=>{},record:(label)=>checks.push(label)};
}
const script=fileURLToPath(new URL('../tools/verify-pearl-batch-journal.mjs',import.meta.url));
test('SQL008 canary restarts four actual Node processes over durable local SQL',()=>{
  fs.mkdirSync('.scratch',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('.scratch','j8-process-'));
  const helper=fileURLToPath(new URL('./helpers/pearl-batch-journal-canary-process.mjs',import.meta.url));
  for(const phase of journalPhases){
    const r=spawnSync(process.execPath,[helper,phase,root],{encoding:'utf8',windowsHide:true,timeout:120000});
    assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).passed,true);
  }
  const recover=JSON.parse(fs.readFileSync(path.join(root,'recover.json'),'utf8'));
  assert.equal(recover.calls.filter((r)=>r.name==='mn_commit_pearl_batch').length,3); // One resume + two deliberate changed-request rejections.
  const verify=JSON.parse(fs.readFileSync(path.join(root,'verify.json'),'utf8'));
  assert.equal(verify.calls.filter((r)=>r.name==='mn_commit_pearl_batch').length,2); // Historical exact replays only.
});
test('SQL008 live runner stays inert without explicit opt-in',()=>{
  const r=spawnSync(process.execPath,[script],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(r.status,1);assert.match(r.stdout,/Usage:.*--live/);assert.equal(r.stderr,'');
});
test('SQL008 runner refuses scratch junction before credentials or fixture writes',()=>{
  fs.mkdirSync('.scratch',{recursive:true});const root=fs.mkdtempSync(path.resolve('.scratch','j8-path-')),outside=path.join(root,'outside');
  fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(root,'.scratch'),'junction');
  const r=spawnSync(process.execPath,[script,'--live'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(r.status,1);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('SQL008 fixture rejects altered identifiers, phases and paths before dependency access',async()=>{
  const m=newJournalManifest();checkedJournalManifest(m,'prepare');
  for(const mutate of [(q)=>q.extra=true,(q)=>q.ids.token='bad',(q)=>q.ids.accounts[1]=q.ids.accounts[0],
    (q)=>q.ids.operations.extra=randomUUID(),(q)=>q.ids.operations.death=q.ids.accounts[0],(q)=>q.since=[]]){
    const bad=structuredClone(m);mutate(bad);assert.throws(()=>checkedJournalManifest(bad,'prepare'));
  }
  assert.throws(()=>checkedJournalManifest(m,'unknown'));assert.throws(()=>checkedJournalManifest(m,'recover'));
  assert.throws(()=>checkedJournalManifest(m,'prepare','../outside.json'));
  assert.throws(()=>checkedJournalManifest(m,'prepare','.scratch/m5-j8-live-wrong.json'));
  await assert.rejects(verifyJournalPhase('invalid',m,{admin:null}),{name:'AssertionError'});
});
test('SQL008 actual SDK canary passes queue/restart phases and cleans only exact fixtures',async()=>{
  const f=await database();
  try{
    const m=newJournalManifest(),checks=[],calls=[],other=randomUUID(),p=newProfile();
    assert.equal((await f.store.saveProfile(other,p,0)).ok,true);
    for(const phase of journalPhases)await verifyJournalPhase(phase,m,context(f.db,m,checks,calls));
    assert.equal(checks.length,18);
    assert.deepEqual(await f.store.loadProfile(other),{data:p,version:1});
    assert.equal((await f.db.query('select uid from public.mn_unique_items')).rows.length,0);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_intents')).rows.length,3);
    assert.ok(Math.max(...calls.filter((r)=>r.method==='DELETE').map((r)=>r.url.length))<8100,'Conditional URLs fit live budget');
    await verifyJournalPhase('cleanup',m,context(f.db,m));
  }finally{await f.close();}
});
test('SQL008 cleanup detects profile drift before deleting any receipt or unique',async()=>{
  const f=await database();
  try{
    const m=newJournalManifest(),ctx=context(f.db,m);
    for(const phase of journalPhases.slice(0,3))await verifyJournalPhase(phase,m,ctx);
    const p=await ctx.store.loadProfile(m.ids.accounts[1]);p.data.xp++;
    assert.equal((await ctx.store.saveProfile(m.ids.accounts[1],p.data,p.version)).ok,true);
    await assert.rejects(verifyJournalPhase('cleanup',m,ctx),{name:'AssertionError'});
    assert.equal((await f.db.query('select uid from public.mn_unique_items')).rows.length,6);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_batch_operations')).rows.length,2);
  }finally{await f.close();}
});
test('SQL008 exact seeding-prefix cleanup is explicit and repeatable',async()=>{
  const f=await database();
  try{
    const m=newJournalManifest(),ctx=context(f.db,m),fixture=journalFixture(m.ids);
    for(let a=0;a<2;a++)await ctx.store.initializeProfile(m.ids.accounts[a],fixture.data[a]);
    for(const raw of fixture.grants.slice(0,2))assert.equal((await ctx.store.commitPearlGround(raw)).ok,true);
    await verifyJournalPhase('cleanup-partial',m,ctx);await verifyJournalPhase('cleanup-partial',m,ctx);
    assert.equal((await f.db.query('select player_id from public.mn_profiles')).rows.length,0);
    assert.equal((await f.db.query('select uid from public.mn_unique_items')).rows.length,0);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_intents')).rows.length,0);
  }finally{await f.close();}
});
test('SQL008 cleanup retries after a successful DELETE loses its response',async()=>{
  const f=await database();
  try{
    const m=newJournalManifest(),ctx=context(f.db,m);
    for(const phase of journalPhases.slice(0,3))await verifyJournalPhase(phase,m,ctx);
    let lost=false;
    const ambiguous={...ctx,admin:{...ctx.admin,from(table){
      const query=ctx.admin.from(table);
      return Object.assign(Object.create(query),{delete(){
        const deletion=query.delete(),then=deletion.then.bind(deletion);
        deletion.then=(yes,no)=>then((reply)=>{if(!lost){lost=true;throw new Error('Lost cleanup response');}return reply;}).then(yes,no);
        return deletion;
      }});
    }}};
    await assert.rejects(verifyJournalPhase('cleanup',m,ambiguous),/Lost cleanup response/);
    assert.ok(m.cleanup);assert.equal(lost,true);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_batch_operations')).rows.length,1);
    await verifyJournalPhase('cleanup',m,ctx);await verifyJournalPhase('cleanup',m,ctx);
    assert.equal((await f.db.query('select player_id from public.mn_profiles')).rows.length,0);
    assert.equal((await f.db.query('select uid from public.mn_unique_items')).rows.length,0);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_intents')).rows.length,3);
  }finally{await f.close();}
});
