import { PGlite } from '@electric-sql/pglite';
import { database, adapters } from './death-journal-sql.mjs';
import { makeDeath, planRequest, seedDeathStore, deathOp, WORLD } from './death-storage.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { StoreError } from '../../server/store.mjs';
const [mode,location]=process.argv.slice(2);let db;
try {
  if(mode==='prepare'){
    const f=await database(location);db=f.db;const fixture=makeDeath({lawless:true,killer:true,pearlCount:3,loot:true});
    const {request}=planRequest(fixture,deathOp(950));await seedDeathStore(f.store,fixture,request);
    const j=f.journal(WORLD),s=new ProfileSessions(f.store,null,{journal:{...j,async prepare(...a){await j.prepare(...a);throw new StoreError('unavailable');}}});
    await s.recoverPearls();for(let i=0;i<request.profiles.length;i++)await s.open(i+1,request.profiles[i].id);
    let lost;try{await s.commitDeath(request);}catch(e){lost=e.code;}
    const sends=f.calls.filter(c=>c.name==='mn_commit_death').length;
    await db.close();db=null;process.stdout.write(JSON.stringify({request,lost,sends}));
  }else{
    let text='';for await(const part of process.stdin)text+=part;const request=JSON.parse(text);
    db=new PGlite(location);await db.exec('SET ROLE service_role');const f=adapters(db),j=f.journal(WORLD);
    const journal=mode==='resume'?{...j,async resolve(...a){await j.resolve(...a);throw new StoreError('unavailable');}}:j;
    const s=new ProfileSessions(f.store,null,{journal});const outcomes=await s.recoverPearls();
    const sendsBefore=f.calls.filter(c=>c.name==='mn_commit_death').length;let lost=null;
    if(mode==='resume')try{await s.resumeDeath(request.operationId);}catch(e){lost=e.code;}
    const sends=f.calls.filter(c=>c.name==='mn_commit_death').length;
    const row=await j.prepare('death',request),profiles=await Promise.all(request.profiles.map(p=>f.store.loadProfile(p.id)));
    const drops=await f.store.listDeathDrops(WORLD),receipt=await f.store.loadDeathOperation(request.operationId);
    await db.close();db=null;process.stdout.write(JSON.stringify({outcomes,sendsBefore,sends,lost,row,profiles,drops,receipt}));
  }
}catch(e){process.stderr.write(JSON.stringify({message:e.message,code:e.code}));process.exitCode=1;}finally{if(db)await db.close();}
