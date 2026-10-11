import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { newResourceState, upgradeLoggingState } from '../../server/resourceState.mjs';
import { newCommunityState } from '../../server/communityProject.mjs';
import { createSupabaseGroundWorldAdoption } from '../../server/groundWorldAdoption.mjs';
import { GroundTransactionSession } from '../../server/groundTransactionSession.mjs';
import { hurtPlayer } from '../../src/sim/systems/combat.js';
import { database, reopenDatabase, adoptionId } from './ground-world-adoption-sql.mjs';
import { makeDeath, planRequest, VICTIM, KILLER, deathOp } from './death-storage.mjs';
import { WORLD, SEED, turn, placeInCala, composedStore } from './ground-death-host.mjs';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { groundOperation, checkedGroundPage } from '../../server/pearlGround.mjs';
import { groundTransactionOperation } from '../../server/groundTransaction.mjs';
import { profilePearls } from '../../server/pearlOperations.mjs';
import { checkedCurrentDeathDropPage } from '../../server/deathDropOperation.mjs';

const [mode,path,phase,family='death']=process.argv.slice(2),never=()=>new Promise(()=>{}),copy=structuredClone;
assert.ok(['hold','recover'].includes(mode));
assert.ok(path&&['after-journal-prepare','after-sql-commit'].includes(phase));
assert.ok(['death','drop'].includes(family));

class Socket extends EventEmitter {
  readyState=1;messages=[];
  send(raw){this.messages.push(JSON.parse(raw));}
  close(){if(this.readyState!==1)return;this.readyState=3;this.emit('close');}
  ping(){}
}

async function seedCommonDeathPearls(storage,request){
  const victim=request.profiles.find(p=>p.id===VICTIM),killer=request.profiles.find(p=>p.id===KILLER);
  const empty=copy(victim.before);empty.pearls={bag:[],swallowed:null};
  assert.equal((await storage.store.saveProfile(VICTIM,empty,0)).ok,true);
  assert.equal((await storage.store.saveProfile(KILLER,killer.before,0)).ok,true);
  for(let i=0;i<request.pearls.length;i++){
    const pearl=request.pearls[i],loaded=await storage.store.loadProfile(VICTIM),data=copy(loaded.data);
    if(data.pearls.bag.length<8)data.pearls.bag.push({uid:pearl.uid,kind:pearl.kind});
    else data.pearls.swallowed={uid:pearl.uid,kind:pearl.kind};
    const seedId=deathOp(100+i),operation=groundOperation({operationId:seedId,uid:pearl.uid,kind:pearl.kind,
      from:null,to:VICTIM,expectedVersion:0,world:WORLD,ground:null,
      profiles:[{id:VICTIM,expectedVersion:loaded.version,data}]}).request;
    const world=await storage.store.loadWorld(WORLD),clock=await storage.store.loadGroundClock(WORLD);
    const concrete=groundTransactionOperation({operationId:seedId,request:{world:WORLD,expectedWorldVersion:world.version,
      worldData:world.data,family:'ground',operation,clock:{operationId:clock.operationId,
        expectedVersion:clock.version,expectedTick:clock.tick,tick:clock.tick}}});
    const result=await storage.store.commitGroundTransaction(concrete);
    assert.equal(result.ok,true,JSON.stringify({result,seedId,operation}));
  }
  const persisted=await storage.store.loadProfile(VICTIM);
  assert.deepEqual(profilePearls(persisted.data).map(q=>q.uid).sort(),profilePearls(victim.before).map(q=>q.uid).sort());
  victim.expectedVersion=persisted.version;killer.expectedVersion=(await storage.store.loadProfile(KILLER)).version;
}

async function initialize(){
  const storage=await database(path);
  const scene=makeDeath({lawless:true,killer:true,loot:true,pearlCount:2,seed:73});scene.world.tick=500;
  const planned=planRequest(scene);planned.request.world=WORLD;
  const template=new GameHost({seed:SEED,bots:0,store:createMemoryStore(),log(){}});
  const resources=upgradeLoggingState(newResourceState(template.server.world));resources.tick=500;
  const data={v:1,seed:SEED,economy:template.server.world.economy.serialize(),resources,
    community:newCommunityState(WORLD,{madera:4,piedra:2})};
  await template.close();
  await storage.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)',[WORLD,data]);
  const adoption=createSupabaseGroundWorldAdoption(storage.adoptionClient);
  const result=await adoption.adopt({operationId:adoptionId(451),request:{world:WORLD,expectedWorldVersion:7,worldData:data}});
  assert.equal(result.ok,true,JSON.stringify(result));
  await seedCommonDeathPearls(storage,planned.request);
  await storage.close();
}

function createHost(storage,holdAt=null,holdFamily='death'){
  const baseJournal=storage.journal(WORLD),baseStore=composedStore(storage);
  const journal={...baseJournal,async prepare(raw){
    const value=await baseJournal.prepare(raw);
    if(holdAt==='after-journal-prepare'&&raw.request?.family===holdFamily){
      process.stdout.write(`READY ${phase}\n`);await never();
    }
    return value;
  }};
  const store={...baseStore,async commitGroundTransaction(raw){
    const value=await baseStore.commitGroundTransaction(raw);
    if(holdAt==='after-sql-commit'&&raw.request?.family===holdFamily){
      assert.equal(value?.ok,true,JSON.stringify(value));
      process.stdout.write(`READY ${phase}\n`);await never();
    }
    return value;
  },async listPearlGround(world,options={}){
    const page={world,afterUid:options.afterUid??null,limit:options.limit??64};
    const raw=(await storage.db.query('select public.mn_list_pearl_ground($1,$2,$3::integer) as data',
      [page.world,page.afterUid,page.limit])).rows[0].data;return checkedGroundPage(raw,page);
  },async listCurrentDeathDrops(world,options={}){
    const page={world,after:options.after??null,limit:options.limit??64};
    const raw=(await storage.db.query('select public.mn_list_current_death_drops($1,$2::uuid,$3::integer,$4::integer) as data',
      [page.world,page.after?.operationId??null,page.after?.ordinal??null,page.limit])).rows[0].data;return checkedCurrentDeathDropPage(raw,page);
  }};
  const host=new GameHost({seed:SEED,bots:0,store,worldId:WORLD,log(){},
    resolvePlayer:async(_req,msg)=>msg.token==='owner'?VICTIM:msg.token==='other'?KILLER:null,
    economicOperations:true,resourceOperations:true,loggingOperations:true,groundTransactions:{journal}});
  host.mountGroundPearls();host.mountGroundDeaths();return host;
}

async function player(host,token){
  const socket=new Socket();host.onConnection(socket,{headers:{},socket:{remoteAddress:'ground-death-process'}});
  socket.emit('message',Buffer.from(JSON.stringify({t:MSG.HELLO,v:PROTOCOL_VERSION,name:token,token})),false);
  await Promise.all([...host.joins]);
  const clientId=[...host.server.clients.keys()].at(-1),entity=host.server.clients.get(clientId)?.entity;
  assert.ok(entity,JSON.stringify({socket:socket.messages,clients:[...host.server.clients],joins:host.joins.size}));return {socket,clientId,entity};
}

async function hold(){
  await initialize();const storage=await reopenDatabase(path);let host;
  host=createHost(storage,phase,family);await host.prepare();
  const victim=await player(host,'owner'),killer=await player(host,'other');placeInCala(host,victim,killer);
  const ecs=host.server.world.ecs;
  const mortalStep=()=>{host.server.world.stepWorld=(()=>{const original=host.server.world.stepWorld.bind(host.server.world);let first=true;
    return (...args)=>{if(first){first=false;ecs.hp[victim.entity]=1;hurtPlayer(host.server.world,victim.entity,9999,
      {x:ecs.x[victim.entity],z:ecs.z[victim.entity],kind:'melee',seq:9,by:killer.entity,pierce:true,noInv:true,knock:0});}
      return original(...args);};})();assert.equal(host.server.step(),true);};
  mortalStep();
  if(family==='drop'){
    for(let i=0;i<12&&host.combatDeaths.pending;i++){await host.groundAuthority.settle();host.server.step();}
    assert.equal(host.combatDeaths.pending,false);
    const w=host.server.world,item=[...w.drops.values()].find(d=>d.kind==='item');assert.ok(item);
    await host.profiles.flush();
    w.ecs.x[killer.entity]=item.x;w.ecs.z[killer.entity]=item.z;
    const pending=host.groundPearls.pickupDrop({dropId:item.id,receiver:{clientId:killer.clientId,entity:killer.entity}});
    pending.result.catch(()=>{});
  }
  // Keep the child alive while the intercepted journal/SQL promise remains unresolved.
  await new Promise(()=>{setInterval(()=>{},1000);});
}

async function recover(){
  const storage=await reopenDatabase(path);let historical=0;
  const original=GroundTransactionSession.prototype.drain;
  GroundTransactionSession.prototype.drain=function(tick,apply=null){if(apply)historical++;return original.call(this,tick,apply);};
  let host;
  try{
    host=createHost(storage);await host.prepare();
    assert.equal(host.groundDeaths.status().ready,true);
    const victim=await player(host,'owner'),killer=await player(host,'other');
    const victimProfile=host.server.world.profiles.get(victim.entity),killerProfile=host.server.world.profiles.get(killer.entity);
    assert.equal(victimProfile.stats.deaths,1);assert.equal(killerProfile.stats.pk,1);
    if(family==='drop')assert.equal(killerProfile.stats.items,1);
    assert.equal(host.server.world.events.filter(e=>e.type==='death').length,0);
    assert.equal(victim.socket.messages.filter(m=>m.ev?.type==='death').length,0);
    assert.equal(killer.socket.messages.filter(m=>m.ev?.type==='death').length,0);
    assert.equal([...host.server.world.drops.values()].filter(d=>['item','potion'].includes(d.kind)).length,family==='drop'?3:4);
    assert.equal([...host.server.world.drops.values()].filter(d=>d.kind==='pearl').length,2);
    assert.equal(victimProfile.stats.deaths,1,'startup recovery and current hydration apply the death once');
    assert.equal(killerProfile.stats.pk,1,'startup recovery and current hydration apply PK once');
    const version=await storage.store.loadWorld(WORLD);
    assert.equal(version.version,family==='drop'?11:10);
    assert.equal(historical,0,'startup recovery does not invoke historical synchronous gameplay effects');
    process.stdout.write(JSON.stringify({phase,family,worldVersion:version.version,deaths:victimProfile.stats.deaths,
      pk:killerProfile.stats.pk,items:killerProfile.stats.items,
      ordinaryDrops:family==='drop'?3:4,pearlDrops:2,historical}));
  }finally{
    GroundTransactionSession.prototype.drain=original;
    try{await host?.close();}finally{await storage.close();}
  }
}

if(mode==='hold')await hold();else await recover();
