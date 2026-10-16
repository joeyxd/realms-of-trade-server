// Bounded synchronous projection of one ordinary ground death-drop transition.
import { StoreError } from './store.mjs';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { deathDropOperation, deathDropInWindow, checkedCurrentDeathDrop, checkedDeathDropResult } from './deathDropOperation.mjs';
import { snapshotDropData, assertDropContainers, prepareDeathDropApply } from './deathDropApply.mjs';
import { capturePearlProfile, PEARL_PROFILE_ECS_FIELDS } from './pearlProfileSnapshot.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { sanitizeItem } from '../src/sim/items.js';
import { C, KIND } from '../src/sim/ecs.js';
import { DROPS } from '../src/data/loot.js';

const clone = structuredClone, same = (a,b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
const columns = (ecs,e) => Object.entries(ecs).filter(([,c])=>ArrayBuffer.isView(c)&&!(c instanceof DataView))
  .map(([key,column])=>({key,column,value:column[e]}));
const record = raw => {
  const value=snapshotDropData(raw);
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='clientId,entity')fail('operation');
  return value;
};

export function prepareGroundDeathDrop({host,deadlineClock,dropId,receiver=null,row,mode}) {
  const server=host?.server,w=server?.world,sessions=host?.profiles;
  if(!w||!sessions||!['pickup','expire'].includes(mode)||!Number.isSafeInteger(dropId)||dropId<1)fail('operation');
  const clock=assertGroundDeadlineClock(deadlineClock,host.worldState.id);
  const source=snapshotDropData(w.drops.get(dropId));
  if(!source||source.id!==dropId||source.to!==0||!['item','potion'].includes(source.kind)||
      !Number.isFinite(source.x)||!Number.isFinite(source.z)||!Number.isSafeInteger(source.t)||
      !Number.isSafeInteger(source.ordinal)||source.ordinal<1||typeof source.operationId!=='string'||
      Object.hasOwn(source,'pearl'))fail('operation');
  const current=checkedCurrentDeathDrop(row,{operationId:source.operationId,ordinal:source.ordinal});
  if(!current||current.state!=='ground'||current.world!==host.worldState.id||current.kind!==source.kind||
      !same(current.item,source.item??null)||current.ground.x!==source.x||current.ground.z!==source.z)fail('ownership');
  clock.assertDrop(source,'drop',current.ground);
  const durableAt=clock.at(w.tick);
  const localPick=source.pickAt??0;
  if(mode==='pickup'?(w.tick<localPick||w.tick>source.t||durableAt<current.ground.availableAt||durableAt>current.ground.expiresAt):
      (w.tick<=source.t||durableAt<=current.ground.expiresAt))fail('ownership');
  assertDropContainers(w);
  let endpoint=null,before=null,after=null;
  if(mode==='pickup'){
    const {clientId,entity}=record(receiver),ecs=w.ecs,c=server.clients.get(clientId),s=sessions.clients.get(clientId),p=w.profiles.get(entity);
    if(!Number.isSafeInteger(clientId)||clientId<1||!Number.isInteger(entity)||entity<1||entity>=ecs.cap||
       !c?.serverProfile||c.entity!==entity||!s||s.id!==clientId||sessions.accounts.get(s.key)!==s||s.closed||s.failed||
       s.pending||s.running||s.pearlBusy||!Number.isSafeInteger(s.version)||s.version<1||s.version>=2147483647||
       ecs.clientId[entity]!==clientId||!ecs.alive[entity]||ecs.dead[entity]>0||ecs.kind[entity]!==KIND.PLAYER||
       !(ecs.mask[entity]&C.PLAYER)||p?.pirateId!=='account:'+s.key)fail('session');
    if(Math.hypot(ecs.x[entity]-source.x,ecs.z[entity]-source.z)>DROPS.pickR)fail('ownership');
    before=capturePearlProfile(w,entity); after=clone(before);
    const owned=profilePearls(before),ownedUids=new Set(owned.map(q=>q.uid));
    for(const pearl of owned)if(!same(w.pearlLedger.get(pearl.uid),{owner:p.pirateId,entity,place:'profile'}))fail('ownership');
    for(const [uid,entry] of w.pearlLedger)if(entry?.place==='profile'&&
        (entry.owner===p.pirateId||entry.entity===entity)&&!ownedUids.has(uid))fail('ownership');
    for(const key of ['version','confirmed','last']){
      const d=Object.getOwnPropertyDescriptor(s,key);
      if(!d||!Object.hasOwn(d,'value')||!d.writable)fail('effect');
    }
    const confirmed=snapshotDropData(s.confirmed);
    if(!same(confirmed,sanitizeProfile(confirmed))||!(s.last===null||typeof s.last==='string'))fail('session');
    if(source.kind==='item'){
      if(after.bag.length>=24||after.uid>=2147483647||after.stats.items>=1000000000)fail('capacity');
      const item=snapshotDropData(source.item);
      if(!item||!same(item,sanitizeItem(item)))fail('operation');
      item.u=after.uid++;after.bag.push(item);after.stats.items++;
    }else{if(after.pot>=5)fail('capacity');after.pot++;}
    endpoint={clientId,key:s.key,entity,profile:p,live:snapshotDropData(p),session:s,client:c};
  }else if(receiver!==null)fail('operation');
  const creation={operationId:source.operationId,ordinal:source.ordinal,world:current.world,victim:current.victim,
    kind:current.kind,item:current.item,ground:current.ground,expectedVersion:current.version};
  const operation=deathDropOperation({operationId:'00000000-0000-4000-8000-000000000001',world:current.world,mode,at:durableAt,
    drop:creation,profile:endpoint?{id:endpoint.key,expectedVersion:endpoint.session.version,before,data:after}:null}).request;
  if(!deathDropInWindow(operation))fail('ownership');
  const liveDrop=snapshotDropData(w.drops.get(dropId)),ecs=w.ecs,profileMap=w.profiles,dropMap=w.drops,ledger=w.pearlLedger,
    dirty=w.profileDirty,events=w.events,tick=w.tick,nextDrop=w.nextDrop,names=ecs.names,name=endpoint?ecs.names[endpoint.entity]:null,
    dropEntries=[...dropMap],dropData=snapshotDropData(dropEntries),
    ledgerData=snapshotDropData([...ledger]),eventData=snapshotDropData(events),dirtyWas=endpoint?dirty.has(endpoint.entity):false,
    cols=endpoint?columns(ecs,endpoint.entity):[],native=endpoint?Object.fromEntries(PEARL_PROFILE_ECS_FIELDS.map(k=>[k,ecs[k]])):null,
    ledgerOwned=endpoint?[...ledger].filter(([,v])=>v?.place==='profile'&&(v.owner===endpoint.profile.pirateId||v.entity===endpoint.entity)) : [];
  const effect=prepareDeathDropApply(w,{drop:w.drops.get(dropId),dropId,endpoint,before,after,liveBefore:endpoint?.live,victim:current.victim});
  let applied=false;
  const assertCurrent=()=>{
    assertDropContainers(w);
    if(applied||host.server!==server||server.world!==w||w.tick!==tick||w.nextDrop!==nextDrop||w.ecs!==ecs||ecs.names!==names||
       (endpoint&&ecs.names[endpoint.entity]!==name)||w.profiles!==profileMap||w.drops!==dropMap||
       w.pearlLedger!==ledger||w.profileDirty!==dirty||w.events!==events||w.drops.get(dropId)!==effectDrop||
       !same(snapshotDropData(w.drops.get(dropId)),liveDrop)||!same(snapshotDropData([...w.drops]),dropData)||
       !same(snapshotDropData([...ledger]),ledgerData)||!same(snapshotDropData(events),eventData)||
       (endpoint&&(sessions.clients.get(endpoint.clientId)!==endpoint.session||sessions.accounts.get(endpoint.key)!==endpoint.session||
        server.clients.get(endpoint.clientId)!==endpoint.client||endpoint.session.closed||endpoint.session.failed||endpoint.session.pending||
        endpoint.session.running||endpoint.session.pearlBusy||endpoint.session.version!==sessionVersion||
        !same(endpoint.session.confirmed,sessionConfirmed)||endpoint.session.last!==sessionLast||
        Object.entries(sessionDescriptors).some(([k,d])=>{const q=Object.getOwnPropertyDescriptor(endpoint.session,k);return !q||!Object.hasOwn(q,'value')||!q.writable||q.value!==d.value;})||
        w.profiles.get(endpoint.entity)!==endpoint.profile||!same(snapshotDropData(endpoint.profile),endpoint.live)||
        !same(capturePearlProfile(w,endpoint.entity),before)||columns(ecs,endpoint.entity).length!==cols.length||
        cols.some(q=>ecs[q.key]!==q.column||!Object.is(q.column[endpoint.entity],q.value))||
        Object.entries(native).some(([k,v])=>ecs[k]!==v)||ledgerOwned.some(([uid,v])=>!same(ledger.get(uid),v))||
        [...ledger].some(([uid,v])=>v?.place==='profile'&&(v.owner===endpoint.profile.pirateId||v.entity===endpoint.entity)&&
          !ledgerOwned.some(([owned])=>owned===uid))||dirty.has(endpoint.entity)!==dirtyWas)))fail('cancelled');
    clock.assertDrop(w.drops.get(dropId),'drop',current.ground);
  };
  const effectDrop=w.drops.get(dropId),sessionVersion=endpoint?.session.version,sessionConfirmed=endpoint&&clone(endpoint.session.confirmed),sessionLast=endpoint?.session.last;
  const sessionDescriptors=endpoint?Object.fromEntries(['version','confirmed','last'].map(k=>[k,Object.getOwnPropertyDescriptor(endpoint.session,k)])):null;
  assertCurrent();
  return {operation:clone(operation),assertCurrent,apply(receipt,operationId){
    assertCurrent();const checked=checkedDeathDropResult(receipt,operation,operationId);
    if(!checked.ok||checked.replay)fail('response');
    effect.assertCurrent();const baselineVersion=endpoint?.session.version,baselineConfirmed=endpoint&&endpoint.session.confirmed,baselineLast=endpoint?.session.last;
    const session=endpoint?.session;let started=false;
    try{
      started=true;effect.apply();effect.assertApplied();
      if(session){session.version=operation.profile.expectedVersion+1;session.confirmed=clone(after);session.last=JSON.stringify(after);
        if(session.version!==checked.profiles[0].version||!same(session.confirmed,after)||session.last!==JSON.stringify(after))fail('effect');}
      effect.publish();effect.assertApplied();applied=true;return true;
    }catch(error){if(started){effect.rollback();if(session){session.version=baselineVersion;session.confirmed=baselineConfirmed;session.last=baselineLast;}
      Map.prototype.clear.call(dropMap);for(const [id,value]of dropEntries)Map.prototype.set.call(dropMap,id,value);}
      throw error;}
  }};
}
